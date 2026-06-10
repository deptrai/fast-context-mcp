#!/usr/bin/env node
/**
 * bench/eval.mjs — E2E quality evaluation: recall@1/3/5 for deepgrep_search.
 *
 * Runs 12 queries against the deepgrep codebase itself (ground truth known).
 * Measures: recall@1, recall@3, recall@5, mean rank per query.
 *
 * Usage:
 *   node bench/eval.mjs                    # reads keys from Claude Desktop config
 *   DEEPGREP_API_KEY=xxx node bench/eval.mjs
 *
 * Saves: bench/results/eval-YYYY-MM-DDTHH-mm.json
 * Exit:  0 if recall@3 ≥ 70% (M4 pass), 1 otherwise
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn }                                   from "node:child_process";
import { createInterface }                         from "node:readline";
import { homedir }                                 from "node:os";
import { join, dirname }                           from "node:path";
import { fileURLToPath }                           from "node:url";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "results");
const SERVER_PATH = join(__dirname, "../deepgrep/src/server.mjs");
const PROJECT_PATH = join(__dirname, "../deepgrep");

// ─── Load API keys from Claude Desktop config ─────────────

function loadEnvFromConfig() {
  const candidates = [
    join(homedir(), "Library/Application Support/Claude/claude_desktop_config.json"),
    join(homedir(), ".config/claude/claude_desktop_config.json"),
  ];
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(readFileSync(p, "utf-8"));
      const env = cfg?.mcpServers?.deepgrep?.env || {};
      for (const [k, v] of Object.entries(env)) {
        if (v && !process.env[k]) process.env[k] = v;
      }
      return;
    } catch {}
  }
}

loadEnvFromConfig();

if (!process.env.DEEPGREP_API_KEY) {
  console.error("❌  DEEPGREP_API_KEY not set. Set via env or Claude Desktop config.");
  process.exit(1);
}

// ─── MCP client (same stdio pattern as mcp-integration.test.mjs) ──

class McpClient {
  constructor() {
    this.proc = spawn(process.execPath, [SERVER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.pending = new Map();
    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => {
      const t = line.trim();
      if (!t.startsWith("{")) return;
      try {
        const msg = JSON.parse(t);
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    });
  }

  request(id, method, params = {}, timeoutMs = 90000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout id=${id} method=${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async initialize() {
    const r = await this.request(1, "initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "eval-harness", version: "1.0" },
    });
    this.notify("notifications/initialized");
    return r;
  }

  close() { this.rl.close(); this.proc.kill(); }
}

// ─── Query set with ground truth ─────────────────────────

// expect[0] = primary; expect[1+] = acceptable alternatives
const QUERIES = [
  { q: "cache key hashing mtime hash sha256",                    e: ["cache.mjs"]           },
  { q: "role labeling heuristics path patterns implementation",  e: ["roles.mjs"]           },
  { q: "context pack budget enforcement max_chars dropped",      e: ["pack.mjs"]            },
  { q: "auto escalation quick to deep mode shouldEscalate",     e: ["escalate.mjs"]        },
  { q: "read file snippet line ranges readFileSync",            e: ["snippets.mjs"]        },
  { q: "JSON output contract schema serialization ADR-8",       e: ["contract.mjs"]        },
  { q: "ranking deduplication overlapping ranges mergeRanges",  e: ["rank.mjs"]            },
  { q: "health check tool status report formatHealthReport",    e: ["health.mjs"]          },
  { q: "MCP tool registration deepgrep_search handler server",  e: ["server.mjs"]          },
  { q: "ripgrep executor rg command dispatch execCommand",      e: ["executor.mjs"]        },
  { q: "openai backend retry 429 rate limit friendlyError",     e: ["openai-backend.mjs"]  },
  { q: "windsurf protobuf core search loop protocol",           e: ["core.mjs"]            },
];

// ─── Helpers ──────────────────────────────────────────────

function parseFiles(text) {
  return [...text.matchAll(/\[\d+\/\d+\]\s+(\S+)\s+\(/g)]
    .map(m => m[1]);
}

function hits(files, expected, n) {
  return files.slice(0, n).some(f => expected.some(e => f.includes(e))) ? 1 : 0;
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  const client = new McpClient();
  await client.initialize();

  const records = [];
  let id = 2, r1 = 0, r3 = 0, r5 = 0;
  const N = QUERIES.length;

  console.log(`\n${"═".repeat(96)}`);
  console.log("  deepgrep — E2E Quality Eval   (recall@1 / recall@3 / recall@5)");
  console.log(`  Project : ${PROJECT_PATH}`);
  console.log(`  Queries : ${N}   |   M4 target: recall@3 ≥ 70%`);
  console.log("═".repeat(96));
  console.log(`  ${"Query".padEnd(52)}  ${"Expected".padEnd(20)} @1 @3 @5  rank  time`);
  console.log("─".repeat(96));

  for (const { q, e } of QUERIES) {
    let files = [], err = null, rank = -1;
    const t0 = Date.now();
    try {
      const res = await client.request(id++, "tools/call", {
        name: "deepgrep_search",
        arguments: { query: q, project_path: PROJECT_PATH, max_results: 10, tree_depth: 3 },
      });
      files = parseFiles(res.result?.content?.[0]?.text || "");
      rank  = files.findIndex(f => e.some(x => f.includes(x))) + 1;
    } catch (ex) { err = ex.message; }

    const sec  = ((Date.now() - t0) / 1000).toFixed(1) + "s";
    const at1  = hits(files, e, 1);
    const at3  = hits(files, e, 3);
    const at5  = hits(files, e, 5);
    r1 += at1; r3 += at3; r5 += at5;

    const icon  = at1 ? "✅" : at3 ? "🟡" : at5 ? "🟠" : err ? "💥" : "❌";
    const rStr  = rank > 0 ? `#${rank}` : err ? "ERR" : "miss";
    console.log(
      `  ${q.slice(0, 52).padEnd(52)}  ${e[0].padEnd(20)}` +
      `  ${at1}  ${at3}  ${at5}  ${rStr.padEnd(5)} ${sec}  ${icon}`
    );
    records.push({ query: q, expected: e, files: files.slice(0, 10),
                   at1, at3, at5, rank, durationMs: Date.now() - t0, error: err || null });
  }

  client.close();

  const m4pass = r3 / N >= 0.70;
  console.log("─".repeat(96));
  console.log(`  recall@1: ${(r1/N*100).toFixed(1)}%   recall@3: ${(r3/N*100).toFixed(1)}%   recall@5: ${(r5/N*100).toFixed(1)}%   (n=${N})`);
  console.log(`  M4 (recall@3 ≥ 70%) : ${m4pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log("═".repeat(96) + "\n");

  // ─── Save results ────────────────────────────────────────
  try { mkdirSync(RESULTS_DIR, { recursive: true }); } catch {}
  const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const file = join(RESULTS_DIR, `eval-${ts}.json`);
  writeFileSync(file, JSON.stringify({
    date: new Date().toISOString(), node: process.version,
    project_path: PROJECT_PATH,
    metrics: { recall_at_1: r1/N, recall_at_3: r3/N, recall_at_5: r5/N, m4_pass: m4pass, n: N },
    results: records,
  }, null, 2));
  console.log(`  Saved → bench/results/eval-${ts}.json\n`);

  process.exit(m4pass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
