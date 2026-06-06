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
import {
  getRepoMap,
  _parseAnswer,
  FINAL_FORCE_ANSWER_OPENAI,
  buildOpenAIPrompt,
} from "./shared.mjs";
import { buildCacheKey, getCachedResult, setCachedResult } from "./cache.mjs";

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
  const systemPrompt = buildOpenAIPrompt(maxTurns, maxCommands, maxResults);

  const { tree: repoTree, depth: actualDepth, sizeBytes: treeSizeBytes, fellBack } = getRepoMap(projectRoot, treeDepth, excludePaths);

  // Cache check
  const cacheKey = buildCacheKey({ query, model: _getOpenAIModel(), maxTurns, maxResults, treeDepth, repoMapHash: repoTree });
  const cached = getCachedResult(cacheKey);
  if (cached) {
    log?.("[openai] Cache hit");
    return { ...cached, _meta: { ...cached._meta, cache_hit: true } };
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
      messages.push({ role: "user", content: FINAL_FORCE_ANSWER_OPENAI });
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
          const result = _parseAnswer(answerXml, projectRoot);
          result.rg_patterns = [...new Set(executor.collectedRgPatterns)];
          result._meta = { treeDepth: actualDepth, treeSizeKB: +(treeSizeBytes / 1024).toFixed(1), fellBack, backend: "openai", model: _getOpenAIModel(), cache_hit: false };
          setCachedResult(cacheKey, result);
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
        const result = _parseAnswer(content, projectRoot);
        result.rg_patterns = [...new Set(executor.collectedRgPatterns)];
        result._meta = { treeDepth: actualDepth, treeSizeKB: +(treeSizeBytes / 1024).toFixed(1), fellBack, backend: "openai", model: _getOpenAIModel(), cache_hit: false };
        setCachedResult(cacheKey, result);
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


