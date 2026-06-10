#!/usr/bin/env node
/**
 * bench/benchmark.mjs — Comprehensive performance benchmarks for deepgrep modules.
 *
 * Modules: rank, roles, escalate, cache (hash + mtime), snippets, contract, pack
 * Run:     node bench/benchmark.mjs
 * Output:  function | mean (ms) | p50 | p95 | ops/s
 */

import { performance } from "node:perf_hooks";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { rankResults }                         from "../deepgrep/src/rank.mjs";
import { labelRole, calculateMatchDensity }    from "../deepgrep/src/roles.mjs";
import { shouldEscalate }                      from "../deepgrep/src/escalate.mjs";
import { buildCacheKey, computeMtimeHash }     from "../deepgrep/src/cache.mjs";
import { readSnippets }                        from "../deepgrep/src/snippets.mjs";
import { serializeSearchResult,
         serializePackResult }                 from "../deepgrep/src/contract.mjs";
import { _formatResult }                       from "../deepgrep/src/server.mjs";
import { packContext }                         from "../deepgrep/src/pack.mjs";

// ─── Runner ───────────────────────────────────────────────

const COL = 58;
const RESULTS = [];

function bench(name, fn, { iterations = 5000, warmup = 200 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const times = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    times[i] = performance.now() - t0;
  }
  times.sort();
  const mean  = times.reduce((s, t) => s + t, 0) / iterations;
  const p50   = times[Math.floor(iterations * 0.50)];
  const p95   = times[Math.floor(iterations * 0.95)];
  const p99   = times[Math.floor(iterations * 0.99)];
  const ops   = Math.round(1000 / mean);
  RESULTS.push({ name, mean, p50, p95, p99, ops, iterations });
  console.log(
    `  ${name.padEnd(COL)}` +
    `mean=${mean.toFixed(4)}ms  p50=${p50.toFixed(4)}ms  p95=${p95.toFixed(4)}ms` +
    `  ops/s=${ops.toLocaleString().padStart(10)}`
  );
}

function section(title) {
  console.log(`\n${"─".repeat(100)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(100));
}

// ─── Data generators ──────────────────────────────────────

function makeFiles(n, withDups = false) {
  const mod = withDups ? Math.floor(n / 2) : n;
  return Array.from({ length: n }, (_, i) => ({
    path:      `src/module${i % mod}.mjs`,
    full_path: `/project/src/module${i % mod}.mjs`,
    ranges:    [[i * 10 + 1, i * 10 + 5], [i * 10 + 8, i * 10 + 12]],
    role: null, score: null,
  }));
}

function makeResult(nFiles) {
  return {
    files:       makeFiles(nFiles),
    rg_patterns: Array.from({ length: 20 }, (_, i) => `keyword${i % 10}`),
    _meta: { backend: "openai", model: "deep-search", treeDepth: 3,
             treeSizeKB: 120, fellBack: false, cache_hit: false },
  };
}

const F10    = makeFiles(10);
const F100   = makeFiles(100);
const F1000  = makeFiles(1000);
const FDUP   = makeFiles(200, true);   // 100 unique × 2 entries each
const R10    = makeResult(10);
const R100   = makeResult(100);

const DENSE_CONTENT  = Array.from({ length: 500 },
  (_, i) => `${i % 5 === 0 ? "export function auth" : "  const x"} = ${i};`).join("\n");
const SPARSE_CONTENT = Array.from({ length: 500 },
  (_, i) => `  const variable_${i} = ${i};`).join("\n");

// ─── 1. rank.mjs — rankResults() ──────────────────────────

section("1. rank.mjs — rankResults()  [pure: dedup + merge + optional sort]");

bench("rankResults(10 files,   rerank=false)",                () => rankResults(F10,   { rerank: false }));
bench("rankResults(10 files,   rerank=true)",                 () => rankResults(F10,   { rerank: true  }));
bench("rankResults(100 files,  rerank=false)",                () => rankResults(F100,  { rerank: false }), { iterations: 2000 });
bench("rankResults(100 files,  rerank=true)",                 () => rankResults(F100,  { rerank: true  }), { iterations: 2000 });
bench("rankResults(1000 files, rerank=false)",                () => rankResults(F1000, { rerank: false }), { iterations: 500  });
bench("rankResults(1000 files, rerank=true)",                 () => rankResults(F1000, { rerank: true  }), { iterations: 500  });
bench("rankResults(200 files,  50% dupes, rerank=false)",     () => rankResults(FDUP,  { rerank: false }), { iterations: 2000 });
bench("rankResults(200 files,  50% dupes, rerank=true)",      () => rankResults(FDUP,  { rerank: true  }), { iterations: 2000 });

// ─── 2. roles.mjs — labelRole() + calculateMatchDensity() ─

section("2. roles.mjs — labelRole() + calculateMatchDensity()  [pure string matching]");

const PATHS = [
  { path: "/project/test/auth.test.js" },
  { path: "/project/src/auth.mjs" },
  { path: "/project/config/db.js" },
  { path: "/project/docs/README.md" },
  { path: "/project/src/types/user.d.ts" },
];

bench("labelRole — test pattern (first match)",                     () => labelRole({ path: "/project/test/auth.test.mjs" }));
bench("labelRole — docs pattern (4th array check)",                 () => labelRole({ path: "/project/docs/api.md" }));
bench("labelRole — implementation default (all arrays miss)",       () => labelRole({ path: "/project/src/server.mjs" }));
bench("labelRole — matchDensity shortcut (skips pattern checks)",   () => labelRole({ path: "/project/src/auth.mjs", matchDensity: 0.45 }));
bench("labelRole × 100 calls (tight loop / pack hot path)",        () => {
  for (let i = 0; i < 100; i++) labelRole(PATHS[i % 5]);
}, { iterations: 500 });

bench("calculateMatchDensity — 500 lines, query='auth', dense",     () => calculateMatchDensity(DENSE_CONTENT,  "auth"));
bench("calculateMatchDensity — 500 lines, query='auth', sparse",    () => calculateMatchDensity(SPARSE_CONTENT, "auth"));
bench("calculateMatchDensity — 500 lines, empty query (early exit)",() => calculateMatchDensity(DENSE_CONTENT,  ""));
bench("calculateMatchDensity — 500 lines, multi-word query",        () => calculateMatchDensity(DENSE_CONTENT,  "export function"));

// ─── 3. escalate.mjs — shouldEscalate() ──────────────────

section("3. escalate.mjs — shouldEscalate()  [regex construction per call]");

bench("shouldEscalate — simple 1-clause (no escalate)",             () => shouldEscalate("find auth middleware"));
bench("shouldEscalate — multi-hop keyword 'trace' (fast path hit)", () => shouldEscalate("trace data flow from login to session"));
bench("shouldEscalate — 3-clause query (clause counting)",          () => shouldEscalate("find auth handler and validate token and check permissions"));
bench("shouldEscalate — non-ASCII Vietnamese query",                () => shouldEscalate("tìm hàm xác thực người dùng"));
bench("shouldEscalate — long query, all checks triggered",          () =>
  shouldEscalate(
    "trace the full path of how a user login request flows from " +
    "the API route through the auth service, token validator, " +
    "and database layer, as well as the error handling pipeline"
  ));

// ─── 4. cache.mjs — buildCacheKey() [pure sha256] ─────────

section("4. cache.mjs — buildCacheKey()  [pure: string concat + sha256]");

const BASE_OPTS = {
  query: "find authentication middleware",
  model: "deep-search", maxTurns: 3, maxResults: 10, treeDepth: 3,
  repoMap: "src/\n  auth.mjs\n  server.mjs\n  cache.mjs\n",
  mtimeHash: "a3f8c9b2e1d4f6a8",
  excludePaths: [],
};
const OPTS_EXCL  = { ...BASE_OPTS, excludePaths: ["node_modules", "dist", ".git"] };
const OPTS_LARGE = {
  ...BASE_OPTS,
  repoMap: "src/\n" + Array.from({ length: 200 }, (_, i) => `  module${i}.mjs`).join("\n"),
};

bench("buildCacheKey — no excludePaths, small repoMap",             () => buildCacheKey(BASE_OPTS));
bench("buildCacheKey — 3 excludePaths (sort overhead)",             () => buildCacheKey(OPTS_EXCL));
bench("buildCacheKey — no excludePaths, large repoMap (~10KB)",     () => buildCacheKey(OPTS_LARGE));

// ─── 5. cache.mjs — computeMtimeHash() [filesystem walk] ─

section("5. cache.mjs — computeMtimeHash()  [file I/O: readdirSync + statSync + sha256]");

const TMP_BASE = mkdtempSync(join(tmpdir(), "deepgrep-bench-"));
const TMP_SIZES = [50, 200, 500, 1000];
const TMP_DIRS = {};

for (const n of TMP_SIZES) {
  const dir = join(TMP_BASE, `size-${n}`);
  mkdirSync(dir);
  for (let i = 0; i < n; i++)
    writeFileSync(join(dir, `file${i}.mjs`), `export const x${i} = ${i};\n`);
  TMP_DIRS[n] = dir;
}

bench("computeMtimeHash —  50 files, no excludes",  () => computeMtimeHash(TMP_DIRS[50],   []), { iterations: 300, warmup: 10 });
bench("computeMtimeHash — 200 files, no excludes",  () => computeMtimeHash(TMP_DIRS[200],  []), { iterations: 100, warmup: 5  });
bench("computeMtimeHash — 500 files, no excludes",  () => computeMtimeHash(TMP_DIRS[500],  []), { iterations: 50,  warmup: 3  });
bench("computeMtimeHash — 1000 files, no excludes", () => computeMtimeHash(TMP_DIRS[1000], []), { iterations: 20,  warmup: 2  });
bench("computeMtimeHash — 500 files, 3 excludes",   () => computeMtimeHash(TMP_DIRS[500], ["file1","file2","file3"]), { iterations: 50, warmup: 3 });

// ─── 6. snippets.mjs — readSnippets() [file I/O + line iteration] ─

section("6. snippets.mjs — readSnippets()  [file I/O: readFileSync + line split + budget]");

const SNIP_DIR = join(TMP_BASE, "snippets");
mkdirSync(SNIP_DIR);

const SNIP_SMALL  = join(SNIP_DIR, "small.mjs");
const SNIP_MEDIUM = join(SNIP_DIR, "medium.mjs");
const SNIP_LARGE  = join(SNIP_DIR, "large.mjs");

writeFileSync(SNIP_SMALL,  Array.from({ length: 100  }, (_, i) => `export function fn${i}() { return ${i}; }`).join("\n"));
writeFileSync(SNIP_MEDIUM, Array.from({ length: 500  }, (_, i) => `const line${i} = ${i};`).join("\n"));
writeFileSync(SNIP_LARGE,  Array.from({ length: 2000 }, (_, i) => `  // line ${i}: ${i % 10 === 0 ? "export" : "local"}`).join("\n"));

bench("readSnippets — 1 small  (100 lines),  [1,20]",   () =>
  readSnippets([{ full_path: SNIP_SMALL,  ranges: [[1, 20]]  }]), { iterations: 1000, warmup: 50 });
bench("readSnippets — 1 medium (500 lines),  [1,50]",   () =>
  readSnippets([{ full_path: SNIP_MEDIUM, ranges: [[1, 50]]  }]), { iterations: 500, warmup: 20 });
bench("readSnippets — 1 large  (2000 lines), [1,200]",  () =>
  readSnippets([{ full_path: SNIP_LARGE,  ranges: [[1, 200]] }]), { iterations: 200, warmup: 10 });
bench("readSnippets — 5 small files, 1 range each",     () =>
  readSnippets(Array.from({ length: 5  }, () => ({ full_path: SNIP_SMALL,  ranges: [[1, 20]]         }))), { iterations: 500, warmup: 20 });
bench("readSnippets — 10 medium files, 2 ranges each",  () =>
  readSnippets(Array.from({ length: 10 }, () => ({ full_path: SNIP_MEDIUM, ranges: [[1,30],[100,130]] }))), { iterations: 200, warmup: 10 });
bench("readSnippets — large file, budget cap (50 lines)", () => {
  process.env.FC_SNIPPET_MAX_LINES = "50";
  readSnippets([{ full_path: SNIP_LARGE, ranges: [[1, 2000]] }]);
  delete process.env.FC_SNIPPET_MAX_LINES;
}, { iterations: 200, warmup: 10 });

// ─── 7. contract.mjs — serialize functions ────────────────

section("7. contract.mjs — serializeSearchResult() + serializePackResult()  [pure string/JSON]");

const SERIAL_OPTS = { maxTurns: 3, maxResults: 10, maxCommands: 8,
  timeoutMs: 30000, excludePaths: [], includeSnippets: false, mode: "quick" };

const PACK_SNIPS = Array.from({ length: 10 }, (_, i) => ({
  role: ["implementation","caller","test","config","docs"][i % 5],
  path: `src/mod${i}.mjs`, full_path: `/p/src/mod${i}.mjs`,
  ranges: [[1, 10]], content: SPARSE_CONTENT.slice(0, 300),
}));

bench("serializeSearchResult — text,  10 files",             () =>
  serializeSearchResult(R10,  SERIAL_OPTS, _formatResult, "text"));
bench("serializeSearchResult — json,  10 files",             () =>
  serializeSearchResult(R10,  { mode: "quick" }, _formatResult, "json"));
bench("serializeSearchResult — json, 100 files + rerank",    () =>
  serializeSearchResult(R100, { mode: "deep", rerank: true }, _formatResult, "json"), { iterations: 1000 });
bench("serializePackResult   — text, 10 snippets + dropped", () =>
  serializePackResult({ snippets: PACK_SNIPS,
    dropped: [{ role: "test", count: 3, reason: "budget" }],
    meta: { total_chars: 3000, budget_chars: 5000, used_pct: 60 } }, {}, "text"), { iterations: 2000 });
bench("serializePackResult   — json, 10 snippets",           () =>
  serializePackResult({ snippets: PACK_SNIPS, dropped: [],
    meta: { total_chars: 3000, budget_chars: 5000, used_pct: 60 } }, {}, "json"), { iterations: 2000 });

// ─── 8. pack.mjs — packContext() [composite] ──────────────

section("8. pack.mjs — packContext()  [composite: rankResults + labelRole + readSnippets + budget]");

const PACK5  = Array.from({ length: 5  }, () => ({ file: SNIP_SMALL, ranges: [[1, 20]] }));
const PACK10 = Array.from({ length: 10 }, (_, i) => ({
  file: [SNIP_SMALL, SNIP_MEDIUM, SNIP_LARGE][i % 3], ranges: [[1, 30]],
}));

bench("packContext —  5 files, budget=10000, rerank=false",         () =>
  packContext({ files: PACK5,  max_chars: 10000               }), { iterations: 500, warmup: 20 });
bench("packContext —  5 files, budget=10000, rerank=true",          () =>
  packContext({ files: PACK5,  max_chars: 10000, rerank: true }), { iterations: 500, warmup: 20 });
bench("packContext — 10 mixed, budget=5000,  rerank=false",         () =>
  packContext({ files: PACK10, max_chars: 5000                }), { iterations: 300, warmup: 10 });
bench("packContext — 10 mixed, budget=500  (tight, many dropped)",  () =>
  packContext({ files: PACK10, max_chars: 500                 }), { iterations: 300, warmup: 10 });
bench("packContext — 10 mixed, query provided (richer labeling)",   () =>
  packContext({ files: PACK10, max_chars: 10000, query: "auth middleware" }), { iterations: 300, warmup: 10 });

// ─── Cleanup + Final summary ──────────────────────────────

rmSync(TMP_BASE, { recursive: true, force: true });

console.log("\n" + "═".repeat(100));
console.log("  BENCHMARK COMPLETE");
console.log("═".repeat(100));
console.log(`  Total benchmarks : ${RESULTS.length}`);
console.log(`  Node.js           : ${process.version}`);
console.log(`  Platform/arch     : ${process.platform}/${process.arch}`);

const byMean = [...RESULTS].sort((a, b) => b.mean - a.mean);
console.log("\n  ─── Top 5 slowest (by mean) ───────────────────────────");
for (const r of byMean.slice(0, 5))
  console.log(`    ${r.name.padEnd(58)} ${r.mean.toFixed(4)}ms  ops/s=${r.ops.toLocaleString()}`);

console.log("\n  ─── Top 5 fastest (by mean) ───────────────────────────");
for (const r of [...RESULTS].sort((a,b) => a.mean - b.mean).slice(0, 5))
  console.log(`    ${r.name.padEnd(58)} ${r.mean.toFixed(4)}ms  ops/s=${r.ops.toLocaleString()}`);

console.log("\n" + "═".repeat(100) + "\n");
