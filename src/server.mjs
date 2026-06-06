#!/usr/bin/env node
/**
 * Windsurf Fast Context MCP Server (Node.js)
 *
 * AI-driven semantic code search via reverse-engineered Windsurf protocol.
 *
 * Configuration (environment variables):
 *   WINDSURF_API_KEY     — Windsurf API key (auto-discovered from local install if not set)
 *   FC_MAX_TURNS         — Search rounds per query (default: 3)
 *   FC_MAX_COMMANDS      — Max parallel commands per round (default: 8)
 *   FC_TIMEOUT_MS        — Connect-Timeout-Ms for streaming requests (default: 30000)
 *
 * Start:
 *   node src/server.mjs
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchWithContent, extractKeyInfo } from "./core.mjs";
import { isOpenAIBackendConfigured, searchOpenAI } from "./openai-backend.mjs";

/**
 * Parse an integer env var with optional clamping.
 * @param {string} name
 * @param {number} defaultValue
 * @param {{ min?: number, max?: number }} [opts]
 * @returns {number}
 */
function readIntEnv(name, defaultValue, opts = {}) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  const min = typeof opts.min === "number" ? opts.min : null;
  const max = typeof opts.max === "number" ? opts.max : null;
  let value = parsed;
  if (min !== null) value = Math.max(min, value);
  if (max !== null) value = Math.min(max, value);
  return value;
}

// Read config from environment
const MAX_TURNS = readIntEnv("FC_MAX_TURNS", 3, { min: 1, max: 5 });
const MAX_COMMANDS = readIntEnv("FC_MAX_COMMANDS", 8, { min: 1, max: 20 });
const TIMEOUT_MS = readIntEnv("FC_TIMEOUT_MS", 30000, { min: 1000, max: 300000 });

const server = new McpServer({
  name: "windsurf-fast-context",
  version: "1.2.0",
  instructions:
    "Windsurf Fast Context — AI-driven semantic code search. " +
    "Returns file paths with line ranges and grep keywords.\n" +
    "Tunable parameters:\n" +
    "- tree_depth (1-6, default 3): How much directory structure the remote AI sees. " +
    "REDUCE if you get payload/size errors. INCREASE for small projects where deeper structure helps.\n" +
    "- max_turns (1-5, default 3): How many search rounds. " +
    "INCREASE if results are incomplete. Use 1 for quick lookups.\n" +
    "- max_results (1-30, default 10): Maximum number of files to return.\n" +
    "- exclude_paths (string array, default []): Directory/file patterns to exclude from tree. " +
    "Use for large repos to reduce payload size (e.g. ['node_modules', 'dist', '.git']).\n" +
    "The response includes [config] and [diagnostic] lines — read them to decide if you should retry with different parameters.",
});

// ─── Tool: fast_context_search ─────────────────────────────

/**
 * Format search result object into text output.
 */
function _formatResult(result, maxTurns, maxResults, maxCommands, timeoutMs, excludePaths) {
  if (result.error) {
    const meta = result._meta || {};
    let errMsg = `Error: ${result.error}`;
    if (meta.backend) errMsg += ` [backend=${meta.backend}, model=${meta.model}]`;
    if (meta.treeDepth != null) errMsg += `\n[diagnostic] tree_depth=${meta.treeDepth}, tree_size=${meta.treeSizeKB}KB`;
    return errMsg;
  }

  const files = result.files || [];
  const rgPatterns = result.rg_patterns || [];
  const uniquePatterns = [...new Set(rgPatterns)].filter((p) => p.length >= 3);
  const meta = result._meta || {};

  if (!files.length && !uniquePatterns.length) {
    return "No relevant files found.";
  }

  const parts = [];
  const n = files.length;

  if (files.length) {
    parts.push(`Found ${n} relevant files.`);
    parts.push("");
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      const rangesStr = entry.ranges.map(([s, e]) => `L${s}-${e}`).join(", ");
      parts.push(`  [${i + 1}/${n}] ${entry.full_path} (${rangesStr})`);
    }
  } else {
    parts.push("No files found.");
  }

  if (uniquePatterns.length) {
    parts.push("");
    parts.push(`grep keywords: ${uniquePatterns.join(", ")}`);
  }

  if (meta) {
    const fbNote = meta.fellBack ? ` (fell back)` : "";
    parts.push("");
    let configLine = `[config] backend=${meta.backend || "windsurf"}, model=${meta.model || "SWE-1.6"}, tree_depth=${meta.treeDepth}${fbNote}, tree_size=${meta.treeSizeKB}KB, max_turns=${maxTurns}`;
    if (excludePaths.length) configLine += `, exclude_paths=[${excludePaths.join(", ")}]`;
    parts.push(configLine);
  }

  return parts.join("\n");
}

server.tool(
  "fast_context_search",
  "AI-driven semantic code search using Windsurf's Devstral model. " +
  "Searches a codebase with natural language and returns relevant file paths with line ranges, " +
  "plus suggested grep keywords for follow-up searches.\n" +
  "Parameter tuning guide:\n" +
  "- tree_depth: Controls how much directory structure the remote AI sees before searching. " +
  "If you get a payload/size error, REDUCE this value. " +
  "If search results are too shallow (missing files in deep subdirectories), INCREASE this value.\n" +
  "- max_turns: Controls how many search-execute-feedback rounds the remote AI gets. " +
  "If results are incomplete or the AI didn't find enough files, INCREASE this value. " +
  "If you want a quick rough answer, use 1.\n" +
  "Response includes a [config] line showing actual parameters used — use this to decide adjustments on retry.",
  {
    query: z.string().describe(
      'Natural language search query (e.g. "where is auth handled", "database connection pool")'
    ),
    project_path: z
      .string()
      .default("")
      .describe("Absolute path to project root. Empty = current working directory."),
    tree_depth: z
      .number()
      .int()
      .min(1)
      .max(6)
      .default(3)
      .describe(
        "Directory tree depth for the initial repo map sent to the remote AI. " +
        "Default 3. Use 1-2 for huge monorepos (>5000 files) or if you get payload size errors. " +
        "Use 4-6 for small projects (<200 files) where you want the AI to see deeper structure. " +
        "Auto falls back to a lower depth if tree output exceeds 250KB."
      ),
    max_turns: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(MAX_TURNS)
      .describe(
        "Number of search rounds. Each round: remote AI generates search commands → local execution → results sent back. " +
        "Default 3. Use 1 for quick simple lookups. Use 4-5 for complex queries requiring deep tracing across many files. " +
        "More rounds = better results but slower and uses more API quota."
      ),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10)
      .describe(
        "Maximum number of files to return. Default 10. " +
        "Use a smaller value (3-5) for focused queries. " +
        "Use a larger value (15-30) for broad exploration queries."
      ),
    exclude_paths: z
      .array(z.string())
      .default([])
      .describe(
        "Directory/file patterns to exclude from tree and search context. " +
        "Useful for reducing payload size on large repos. " +
        "Examples: ['node_modules', 'dist', '.git', 'build', 'coverage', '*.min.*']"
      ),
  },
  async ({ query, project_path, tree_depth, max_turns, max_results, exclude_paths }) => {
    let projectPath = project_path || process.cwd();

    try {
      const { statSync } = await import("node:fs");
      if (!statSync(projectPath).isDirectory()) {
        return { content: [{ type: "text", text: `Error: project path does not exist: ${projectPath}` }] };
      }
    } catch {
      return { content: [{ type: "text", text: `Error: project path does not exist: ${projectPath}` }] };
    }

    try {
      let result;
      // Always use Windsurf/SWE-1.6 backend for fast search
      const text = await searchWithContent({
        query,
        projectRoot: projectPath,
        maxTurns: max_turns,
        maxCommands: MAX_COMMANDS,
        maxResults: max_results,
        treeDepth: tree_depth,
        timeoutMs: TIMEOUT_MS,
        excludePaths: exclude_paths,
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const code = e.code || "UNKNOWN";
      return {
        content: [{
          type: "text", text:
            `Error [${code}]: ${e.message}\n\n` +
            `[hint] Suggestions based on error type:\n` +
            `  - Reduce tree_depth (current: ${tree_depth})\n` +
            `  - Add exclude_paths to filter large directories (e.g. ['node_modules', 'dist'])\n` +
            `  - Narrow project_path to a subdirectory\n` +
            `  - Reduce max_turns (current: ${max_turns})`
        }]
      };
    }
  }
);

// ─── Tool: deep_context_search ─────────────────────────────

const DEEP_BASE_URL = process.env.FC_DEEP_BASE_URL || "";
const DEEP_API_KEY = process.env.FC_DEEP_API_KEY || "";
const DEEP_MODEL = process.env.FC_DEEP_MODEL || "deep-search";

server.tool(
  "deep_context_search",
  "Deep AI-driven semantic code search using Claude Sonnet via 9router. " +
  "More thorough than fast_context_search but slower (20-40s). " +
  "Use when fast_context_search returns 0 results or when you need comprehensive cross-file analysis.\n" +
  "Returns file paths with line ranges + grep keywords.\n" +
  "Best for: complex queries, tracing data flows, understanding architecture, finding all related code across a monorepo.",
  {
    query: z.string().describe(
      'Natural language search query (e.g. "how is auth middleware connected to the database layer")'
    ),
    project_path: z
      .string()
      .default("")
      .describe("Absolute path to project root. Empty = current working directory."),
    tree_depth: z
      .number()
      .int()
      .min(1)
      .max(6)
      .default(3)
      .describe("Directory tree depth. Default 3. Use 1-2 for huge repos."),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10)
      .describe("Maximum files to return. Default 10."),
    exclude_paths: z
      .array(z.string())
      .default([])
      .describe("Patterns to exclude (e.g. ['node_modules', 'dist', '.git'])"),
  },
  async ({ query, project_path, tree_depth, max_results, exclude_paths }) => {
    if (!DEEP_BASE_URL || !DEEP_API_KEY) {
      return { content: [{ type: "text", text: "Error: deep_context_search not configured. Set FC_DEEP_BASE_URL and FC_DEEP_API_KEY env vars." }] };
    }

    let projectPath = project_path || process.cwd();
    try {
      const { statSync } = await import("node:fs");
      if (!statSync(projectPath).isDirectory()) {
        return { content: [{ type: "text", text: `Error: project path does not exist: ${projectPath}` }] };
      }
    } catch {
      return { content: [{ type: "text", text: `Error: project path does not exist: ${projectPath}` }] };
    }

    // Temporarily set env for OpenAI backend
    const prevBase = process.env.FC_OPENAI_BASE_URL;
    const prevKey = process.env.FC_OPENAI_API_KEY;
    const prevModel = process.env.FC_OPENAI_MODEL;
    process.env.FC_OPENAI_BASE_URL = DEEP_BASE_URL;
    process.env.FC_OPENAI_API_KEY = DEEP_API_KEY;
    process.env.FC_OPENAI_MODEL = DEEP_MODEL;

    try {
      const result = await searchOpenAI({
        query,
        projectRoot: projectPath,
        maxTurns: 3,
        maxCommands: MAX_COMMANDS,
        maxResults: max_results,
        treeDepth: tree_depth,
        timeoutMs: 90000,
        excludePaths: exclude_paths.length ? exclude_paths : ["node_modules", "dist", ".git", "build", ".next"],
      });
      return { content: [{ type: "text", text: _formatResult(result, 3, max_results, MAX_COMMANDS, 90000, exclude_paths) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error [deep]: ${e.message}` }] };
    } finally {
      // Restore env
      if (prevBase !== undefined) process.env.FC_OPENAI_BASE_URL = prevBase; else delete process.env.FC_OPENAI_BASE_URL;
      if (prevKey !== undefined) process.env.FC_OPENAI_API_KEY = prevKey; else delete process.env.FC_OPENAI_API_KEY;
      if (prevModel !== undefined) process.env.FC_OPENAI_MODEL = prevModel; else delete process.env.FC_OPENAI_MODEL;
    }
  }
);

// ─── Tool: extract_windsurf_key ────────────────────────────

server.tool(
  "extract_windsurf_key",
  "Extract Windsurf API Key from local installation. " +
  "Auto-detects OS (macOS/Windows/Linux) and reads the API key from " +
  "Windsurf's local database. Set the result as WINDSURF_API_KEY env var.",
  {},
  async () => {
    const result = await extractKeyInfo();

    if (result.error) {
      const text = `Error: ${result.error}\n${result.hint || ""}\nDB path: ${result.db_path || "N/A"}`;
      return { content: [{ type: "text", text }] };
    }

    const key = result.api_key;
    const text =
      `Windsurf API Key extracted successfully\n\n` +
      `  Key: ${key.slice(0, 30)}...${key.slice(-10)}\n` +
      `  Length: ${key.length}\n` +
      `  Source: ${result.db_path}\n\n` +
      `Usage:\n` +
      `  export WINDSURF_API_KEY="${key}"`;

    return { content: [{ type: "text", text }] };
  }
);

// ─── Start ─────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
