/**
 * OpenAI-compatible backend for Fast Context search.
 *
 * Allows using any OpenAI-compatible API (9router, Anthropic via proxy, etc.)
 * instead of Windsurf's proprietary protobuf protocol.
 *
 * Env vars:
 *   FC_OPENAI_BASE_URL   — e.g. https://router.chainlens.net/v1
 *   FC_OPENAI_API_KEY    — API key for the endpoint
 *   FC_OPENAI_MODEL      — Model ID, e.g. kr/claude-haiku-4.5
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ToolExecutor } from "./executor.mjs";

// ─── Config ────────────────────────────────────────────────

function _getOpenAIBaseUrl() { return process.env.FC_OPENAI_BASE_URL || ""; }
function _getOpenAIApiKey() { return process.env.FC_OPENAI_API_KEY || ""; }
function _getOpenAIModel() { return process.env.FC_OPENAI_MODEL || "kr/claude-haiku-4.5"; }

/**
 * Check if OpenAI backend is configured.
 * @returns {boolean}
 */
export function isOpenAIBackendConfigured() {
  return !!(_getOpenAIBaseUrl() && _getOpenAIApiKey());
}

// ─── Tool Schema for OpenAI function calling ───────────────

function _buildOpenAITools(maxCommands) {
  const commandProps = {};
  for (let i = 1; i <= maxCommands; i++) {
    commandProps[`command${i}`] = {
      type: "object",
      description: `Command ${i}. Must have a "type" field of rg, readfile, or tree.`,
      properties: {
        type: { type: "string", enum: ["rg", "readfile", "tree", "ls", "glob"] },
        pattern: { type: "string" },
        path: { type: "string" },
        file: { type: "string" },
        start_line: { type: "integer" },
        end_line: { type: "integer" },
        levels: { type: "integer" },
        include: { type: "array", items: { type: "string" } },
        exclude: { type: "array", items: { type: "string" } },
        long_format: { type: "boolean" },
        all: { type: "boolean" },
        type_filter: { type: "string" },
      },
      required: ["type"],
    };
  }

  return [
    {
      type: "function",
      function: {
        name: "restricted_exec",
        description: "Execute restricted commands (rg, readfile, tree, ls, glob) in parallel.",
        parameters: { type: "object", properties: commandProps, required: ["command1"] },
      },
    },
    {
      type: "function",
      function: {
        name: "answer",
        description: "Final answer with relevant files and line ranges in XML format.",
        parameters: {
          type: "object",
          properties: { answer: { type: "string", description: "The final answer in XML format." } },
          required: ["answer"],
        },
      },
    },
  ];
}

// ─── OpenAI API Call ───────────────────────────────────────

/**
 * Validate that a response from the OpenAI-compatible endpoint has correct shape.
 * Defense-in-depth for cases where proxy returns 200 but malformed body.
 * @param {Object} body - parsed JSON response
 * @returns {boolean}
 */
function _isValidResponse(body) {
  const c = body?.choices?.[0];
  if (!c) return false;
  if (c.finish_reason === undefined || c.finish_reason === null) return false;
  if (c.message?.tool_calls) {
    for (const tc of c.message.tool_calls) {
      try { JSON.parse(tc.function.arguments); } catch { return false; }
    }
  }
  return true;
}

/**
 * Call OpenAI-compatible chat completions endpoint.
 * @param {Array} messages - OpenAI format messages
 * @param {Object[]} tools - OpenAI tools array
 * @param {number} timeoutMs
 * @param {boolean} forceAnswer - Force model to call answer tool
 * @returns {Promise<Object>} response choice
 */
async function _callOpenAI(messages, tools, timeoutMs = 60000, forceAnswer = false) {
  const url = `${_getOpenAIBaseUrl()}/chat/completions`;
  const body = {
    model: _getOpenAIModel(),
    messages,
    tools,
    tool_choice: forceAnswer
      ? { type: "function", function: { name: "answer" } }
      : "auto",
    max_tokens: 4096,
    stream: false,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${_getOpenAIApiKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`OpenAI API error: HTTP ${resp.status} - ${text.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  // Validate response shape — retry once if malformed (defense-in-depth)
  if (!_isValidResponse(data)) {
    // Single retry after short delay
    await new Promise(r => setTimeout(r, 2000));
    const retryResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${_getOpenAIApiKey()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!retryResp.ok) {
      const text = await retryResp.text().catch(() => "");
      throw new Error(`OpenAI API error (retry): HTTP ${retryResp.status} - ${text.slice(0, 200)}`);
    }
    const retryData = await retryResp.json();
    return retryData.choices?.[0] || null;
  }
  return data.choices?.[0] || null;
}

// ─── Search with OpenAI Backend ────────────────────────────

/**
 * Build system prompt (same logic as Windsurf backend).
 */
import { readdirSync } from "node:fs";

/**
 * Import the shared utilities from core.
 * We re-use: buildSystemPrompt, getRepoMap, _parseAnswer, FINAL_FORCE_ANSWER
 */

const SYSTEM_PROMPT_TEMPLATE = `You are an expert software engineer, responsible for providing context \
to another engineer to solve a code issue in the current codebase. \
The user will present you with a description of the issue, and it is \
your job to provide a series of file paths with associated line ranges \
that contain ALL the information relevant to understand and correctly \
address the issue.

# IMPORTANT:
- Include ENTIRE semantic blocks (functions, classes, definitions).
- Minimize the number of files while covering all relevant context.
- Start NARROW, then widen only if needed.

# ENVIRONMENT
- Working directory: /codebase
- Use the restricted_exec tool to run commands (rg, readfile, tree, ls, glob)
- Default EXCLUDES: node_modules, .git, dist, build, coverage, .venv, target, out, __pycache__, vendor

# TOOL USE
- Use restricted_exec with multiple commands per call (up to {max_commands}).
- You have at most {max_turns} turns. Use them wisely.
- Each command result is truncated to 50 lines.

# ANSWER FORMAT
When ready, call the "answer" tool with XML:
<ANSWER>
  <file path="/codebase/src/auth/handler.ts">
    <range>10-60</range>
  </file>
</ANSWER>

If no relevant files exist, return: <ANSWER></ANSWER>
Aim to return at most {max_results} files.`;

const FINAL_FORCE_ANSWER =
  "You have no turns left. Now you MUST call the answer tool with your final ANSWER.";

function _buildSystemPrompt(maxTurns, maxCommands, maxResults) {
  return SYSTEM_PROMPT_TEMPLATE
    .replaceAll("{max_turns}", String(maxTurns))
    .replaceAll("{max_commands}", String(maxCommands))
    .replaceAll("{max_results}", String(maxResults));
}

/**
 * Execute search using OpenAI-compatible backend.
 * Same interface as the Windsurf `search()` function.
 */
export async function searchOpenAI({
  query,
  projectRoot,
  maxTurns = 3,
  maxCommands = 8,
  maxResults = 10,
  treeDepth = 3,
  timeoutMs = 60000,
  excludePaths = [],
  onProgress = null,
}) {
  const log = (msg) => onProgress?.(msg);
  projectRoot = resolve(projectRoot);

  const executor = new ToolExecutor(projectRoot);
  const tools = _buildOpenAITools(maxCommands);
  const systemPrompt = _buildSystemPrompt(maxTurns, maxCommands, maxResults);

  // Import getRepoMap and _parseAnswer from core
  const { default: treeNodeCli } = await import("tree-node-cli");
  const { readdirSync: readdirSyncFs } = await import("node:fs");

  // Inline getRepoMap (to avoid circular import)
  const MAX_TREE_BYTES = 250 * 1024;
  function _excludePatternToRegex(pattern) {
    if (!/[*?]/.test(pattern)) {
      return new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
    }
    let regex = "^";
    for (const c of pattern) {
      if (c === "*") regex += ".*";
      else if (c === "?") regex += ".";
      else if (".+^${}()|[]\\".includes(c)) regex += "\\" + c;
      else regex += c;
    }
    return new RegExp(regex + "$");
  }

  const rootPattern = new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  const dirName = projectRoot.split("/").pop() || projectRoot.split("\\").pop() || projectRoot;
  const excludeRegexes = excludePaths.length ? excludePaths.map(_excludePatternToRegex) : [];

  let repoTree = "/codebase\n(fallback)";
  let actualDepth = 0;
  let treeSizeBytes = 0;
  let fellBack = false;

  for (let L = treeDepth; L >= 1; L--) {
    try {
      const opts = { maxDepth: L };
      if (excludeRegexes.length) opts.exclude = excludeRegexes;
      const stdout = treeNodeCli(projectRoot, opts);
      let treeStr = stdout.replace(rootPattern, "/codebase");
      const lines = treeStr.split("\n");
      if (lines[0] === dirName) { lines[0] = "/codebase"; treeStr = lines.join("\n"); }
      const sz = Buffer.byteLength(treeStr, "utf-8");
      if (sz <= MAX_TREE_BYTES) {
        repoTree = treeStr; actualDepth = L; treeSizeBytes = sz; fellBack = L < treeDepth;
        break;
      }
    } catch { /* try lower */ }
  }

  log?.(`[openai] Repo map: tree -L ${actualDepth} (${(treeSizeBytes / 1024).toFixed(1)}KB), model=${_getOpenAIModel()}`);

  const userContent = `Problem Statement: ${query}\n\nRepo Map (tree -L ${actualDepth} /codebase):\n\`\`\`text\n${repoTree}\n\`\`\``;

  // OpenAI format messages
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const totalRounds = maxTurns + 2; // +1 for search, +1 for forced answer

  for (let turn = 0; turn < totalRounds; turn++) {
    const isLastTurn = turn >= totalRounds - 1;
    const isSecondLast = turn >= totalRounds - 2;
    const forceAnswer = isLastTurn;
    log?.(`[openai] Turn ${turn + 1}/${totalRounds}${forceAnswer ? " (forcing answer)" : ""}`);

    // On second-to-last turn, add a user message nudging for answer
    if (isSecondLast && !forceAnswer) {
      messages.push({ role: "user", content: FINAL_FORCE_ANSWER });
    }

    let choice;
    try {
      choice = await _callOpenAI(messages, tools, timeoutMs, forceAnswer);
    } catch (e) {
      // On rate limit, wait and retry once
      if (e.status === 429 && turn < totalRounds - 1) {
        log?.("[openai] Rate limited, waiting 3s...");
        await new Promise(r => setTimeout(r, 3000));
        try {
          choice = await _callOpenAI(messages, tools, timeoutMs, forceAnswer);
        } catch (e2) {
          return {
            files: [],
            error: `OpenAI backend error: ${e2.message}`,
            _meta: { treeDepth: actualDepth, treeSizeKB: +(treeSizeBytes / 1024).toFixed(1), fellBack, projectRoot, backend: "openai", model: _getOpenAIModel() },
          };
        }
      } else {
        return {
          files: [],
          error: `OpenAI backend error: ${e.message}`,
          _meta: { treeDepth: actualDepth, treeSizeKB: +(treeSizeBytes / 1024).toFixed(1), fellBack, projectRoot, backend: "openai", model: _getOpenAIModel() },
        };
      }
    }

    if (!choice) {
      return { files: [], error: "No response from OpenAI backend", _meta: { backend: "openai", model: _getOpenAIModel() } };
    }

    const msg = choice.message;

    // If model wants to call tools
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Add assistant message with tool_calls
      messages.push(msg);

      for (const tc of msg.tool_calls) {
        const fnName = tc.function?.name || "";
        let args;
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          args = {};
        }

        if (fnName === "answer") {
          const answerXml = args.answer || "";
          log?.("[openai] Received final answer");
          const result = _parseAnswerLocal(answerXml, projectRoot);
          result.rg_patterns = [...new Set(executor.collectedRgPatterns)];
          result._meta = { treeDepth: actualDepth, treeSizeKB: +(treeSizeBytes / 1024).toFixed(1), fellBack, backend: "openai", model: _getOpenAIModel() };
          return result;
        }

        if (fnName === "restricted_exec") {
          const cmds = Object.keys(args).filter((k) => k.startsWith("command"));
          log?.(`[openai] Executing ${cmds.length} local commands`);
          const results = await executor.execToolCallAsync(args);

          // Add tool result
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: results,
          });
        }
      }
    } else {
      // No tool calls — check if content contains answer XML
      const content = msg.content || "";
      if (content.includes("<ANSWER>")) {
        log?.("[openai] Received inline answer");
        const result = _parseAnswerLocal(content, projectRoot);
        result.rg_patterns = [...new Set(executor.collectedRgPatterns)];
        result._meta = { treeDepth: actualDepth, treeSizeKB: +(treeSizeBytes / 1024).toFixed(1), fellBack, backend: "openai", model: _getOpenAIModel() };
        return result;
      }

      // Model responded with text but no tool call — add and continue
      messages.push(msg);
    }
  }

  return {
    files: [],
    error: "Max turns reached without answer (OpenAI backend)",
    rg_patterns: [...new Set(executor.collectedRgPatterns)],
    _meta: { treeDepth: actualDepth, treeSizeKB: +(treeSizeBytes / 1024).toFixed(1), fellBack, projectRoot, backend: "openai", model: _getOpenAIModel() },
  };
}

// ─── Local answer parser (avoid circular import from core) ─

import { relative, sep, isAbsolute } from "node:path";

function _parseAnswerLocal(xmlText, projectRoot) {
  const files = [];
  const resolvedRoot = resolve(projectRoot);
  const fileRegex = /<file\s+path=(["'])([^"']+)\1>([\s\S]*?)<\/file>/g;
  let fm;
  while ((fm = fileRegex.exec(xmlText)) !== null) {
    const vpath = fm[2];
    let rel = vpath.replace(/^\/codebase[\/\\]?/, "");
    rel = rel.replace(/^[\/\\]+/, "");
    const fullPath = resolve(projectRoot, rel);
    const relToRoot = relative(resolvedRoot, fullPath);
    if (relToRoot === ".." || relToRoot.startsWith(`..${sep}`) || isAbsolute(relToRoot)) continue;

    const ranges = [];
    const rangeRegex = /<range>(\d+)-(\d+)<\/range>/g;
    let rm;
    while ((rm = rangeRegex.exec(fm[3])) !== null) {
      ranges.push([parseInt(rm[1], 10), parseInt(rm[2], 10)]);
    }
    files.push({ path: rel, full_path: fullPath, ranges });
  }
  return { files };
}
