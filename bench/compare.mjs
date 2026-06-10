#!/usr/bin/env node
/**
 * bench/compare.mjs — Compare two benchmark result files.
 *
 * Usage:
 *   node bench/compare.mjs                          # latest vs previous
 *   node bench/compare.mjs <file-a> <file-b>        # explicit files
 *
 * Exit code 1 if any benchmark regresses > REGRESSION_THRESHOLD.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "results");
const REGRESSION  = 0.10;   // >10% slower = regression
const IMPROVEMENT = 0.10;   // >10% faster = improvement

// ─── Load files ───────────────────────────────────────────

function loadResult(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function findTwoLatest() {
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith(".json") && f !== "latest.json")
    .sort()
    .reverse();
  if (files.length < 2) {
    console.error("Need at least 2 result files to compare. Run `npm run bench` twice.");
    process.exit(1);
  }
  return [join(RESULTS_DIR, files[1]), join(RESULTS_DIR, files[0])]; // [older, newer]
}

const args = process.argv.slice(2);
const [pathA, pathB] = args.length >= 2 ? [args[0], args[1]] : findTwoLatest();

const a = loadResult(pathA);
const b = loadResult(pathB);

// ─── Build lookup ─────────────────────────────────────────

const mapA = Object.fromEntries(a.results.map(r => [r.name, r]));
const mapB = Object.fromEntries(b.results.map(r => [r.name, r]));

// ─── Print header ─────────────────────────────────────────

const COL = 58;
console.log("\n" + "═".repeat(110));
console.log("  BENCHMARK COMPARISON");
console.log("═".repeat(110));
console.log(`  Baseline : ${a.date.slice(0, 16)}  Node ${a.node}  ${a.platform}/${a.arch}`);
console.log(`  Current  : ${b.date.slice(0, 16)}  Node ${b.node}  ${b.platform}/${b.arch}`);
console.log(`  ${"Name".padEnd(COL)}  ${"Before".padStart(10)}  ${"After".padStart(10)}  ${"Δ ops/s".padStart(10)}  ${"Δ %".padStart(8)}  Status`);
console.log("─".repeat(110));

// ─── Compare ──────────────────────────────────────────────

let regressions = 0, improvements = 0, unchanged = 0;

for (const name of Object.keys(mapB)) {
  const before = mapA[name];
  const after  = mapB[name];
  if (!before) { console.log(`  ${name.padEnd(COL)}  [new benchmark]`); continue; }

  const delta     = (after.mean - before.mean) / before.mean;  // positive = slower
  const deltaOps  = after.ops - before.ops;
  const arrow     = delta > REGRESSION ? "🔴 REGRESS" : delta < -IMPROVEMENT ? "🟢 IMPROVE" : "   ok     ";
  const deltaStr  = `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`;

  if (delta > REGRESSION)      regressions++;
  else if (delta < -IMPROVEMENT) improvements++;
  else                           unchanged++;

  console.log(
    `  ${name.padEnd(COL)}` +
    `  ${before.ops.toLocaleString().padStart(10)}` +
    `  ${after.ops.toLocaleString().padStart(10)}` +
    `  ${(deltaOps >= 0 ? "+" : "") + deltaOps.toLocaleString().padStart(9)}` +
    `  ${deltaStr.padStart(8)}  ${arrow}`
  );
}

// Benchmarks removed in current run
for (const name of Object.keys(mapA)) {
  if (!mapB[name]) console.log(`  ${name.padEnd(COL)}  [removed]`);
}

// ─── Summary ──────────────────────────────────────────────

console.log("─".repeat(110));
console.log(`  🔴 Regressions: ${regressions}  🟢 Improvements: ${improvements}  ✅ Unchanged: ${unchanged}`);
console.log("═".repeat(110) + "\n");

if (regressions > 0) {
  console.error(`❌ ${regressions} regression(s) detected (>${(REGRESSION * 100).toFixed(0)}% slower). Failing.\n`);
  process.exit(1);
}
