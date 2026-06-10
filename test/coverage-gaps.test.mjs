/**
 * coverage-gaps.test.mjs — fills specific coverage gaps identified by TEA workflow (2026-06-11).
 * Targets: roles.mjs, pack.mjs, contract.mjs, rank.mjs
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { labelRole, calculateMatchDensity } from "../deepgrep/src/roles.mjs";
import { packContext } from "../deepgrep/src/pack.mjs";
import { serializeSearchResult, serializeSnippetResult, serializePackResult } from "../deepgrep/src/contract.mjs";
import { _formatResult } from "../deepgrep/src/server.mjs";
import { rankResults } from "../deepgrep/src/rank.mjs";

// ── Fixtures ─────────────────────────────────────────────────

let tmpDir, realFile;

before(() => {
  tmpDir   = mkdtempSync(join(tmpdir(), "gaps-test-"));
  realFile = join(tmpDir, "impl.mjs");
  writeFileSync(realFile, Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n"));
});

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── roles.mjs gaps ────────────────────────────────────────────

describe("labelRole — coverage gaps", () => {
  it(".env matches config pattern", () => {
    assert.equal(labelRole({ path: "/project/.env" }), "config");
    assert.equal(labelRole({ path: "/project/.env.production" }), "config");
  });

  it("matchDensity=0.1 (exact lower boundary) falls through to 'implementation'", () => {
    // <0.1 → caller; >=0.3 → implementation; 0.1 is NOT <0.1 → falls to default 'implementation'
    assert.equal(labelRole({ path: "/project/src/auth.mjs", matchDensity: 0.1 }), "implementation");
  });
});

describe("calculateMatchDensity — coverage gaps", () => {
  it("multi-word query matches exact phrase", () => {
    const content = "export function login auth\nother line\nother";
    const d = calculateMatchDensity(content, "login auth");
    assert.ok(d > 0, "should find multi-word phrase");
  });
});

// ── pack.mjs gaps ─────────────────────────────────────────────

describe("packContext — coverage gaps", () => {
  it("max_lines param is advisory only — does not enforce a line cap (ADR-9)", () => {
    const r = packContext({
      files: [{ file: realFile, ranges: [[1, 5]] }],
      max_chars: 10000,
      max_lines: 1,  // advisory hint only — must NOT drop snippets
    });
    assert.ok(r.snippets.length > 0, "max_lines hint should not prevent snippet assembly");
  });

  it("nonexistent file path is skipped gracefully (not counted as dropped)", () => {
    const r = packContext({
      files: [{ file: "/tmp/definitely-does-not-exist-abc999.mjs", ranges: [[1, 5]] }],
      max_chars: 10000,
    });
    // readSnippets returns no content → `if (!content) continue` branch
    assert.equal(r.snippets.length, 0);
    assert.equal(r.dropped.length, 0, "unreachable file is skipped, not dropped");
    assert.equal(r.meta.total_chars, 0);
  });

  it("max_chars=0 causes all snippets to be dropped (budget exceeded immediately)", () => {
    const r = packContext({
      files: [{ file: realFile, ranges: [[1, 3]] }],
      max_chars: 0,
    });
    const totalDropped = r.dropped.reduce((s, d) => s + d.count, 0);
    assert.ok(totalDropped > 0 || r.snippets.length === 0, "all snippets dropped when budget=0");
    assert.equal(r.meta.used_pct, 0, "used_pct=0 when max_chars=0");
  });
});

// ── contract.mjs gaps ─────────────────────────────────────────

const BASE_META = {
  treeDepth: 3, treeSizeKB: 12, fellBack: false,
  backend: "openai", model: "deep-search", cache_hit: false,
};

describe("toJsonContract — mode auto-detection", () => {
  it("opts.mode absent + backend='openai' → meta.mode='deep'", () => {
    const result = { files: [], rg_patterns: [], _meta: { ...BASE_META, backend: "openai" } };
    const json = JSON.parse(serializeSearchResult(result, {}, _formatResult, "json"));
    assert.equal(json.meta.mode, "deep");
  });

  it("opts.mode absent + backend='windsurf' → meta.mode='quick'", () => {
    const result = { files: [], rg_patterns: [], _meta: { ...BASE_META, backend: "windsurf" } };
    const json = JSON.parse(serializeSearchResult(result, {}, _formatResult, "json"));
    assert.equal(json.meta.mode, "quick");
  });
});

describe("serializePackResult — empty-snippets-with-drops text branch", () => {
  it("shows 'No snippets fit' + dropped list when snippets=[] but dropped>0", () => {
    const packResult = {
      snippets: [],
      dropped: [{ role: "implementation", count: 2, reason: "budget" }],
      meta: { total_chars: 0, budget_chars: 5, used_pct: 0 },
    };
    const text = serializePackResult(packResult, {}, "text");
    assert.ok(text.includes("No snippets fit"), "should say no snippets fit within budget");
    assert.ok(text.includes("omitted"), "should report dropped count");
    assert.ok(text.includes("implementation"), "should name the dropped role");
  });
});

describe("serializeSnippetResult — coverage gaps", () => {
  it("single-segment file path uses f.file as path in JSON output", () => {
    const map   = new Map([["server.mjs", "1 | const x = 1;"]]);
    const files = [{ file: "server.mjs", ranges: [[1, 1]] }];
    const json  = JSON.parse(serializeSnippetResult("", map, files, "json"));
    assert.equal(json.files[0].path,      "server.mjs");
    assert.equal(json.files[0].full_path, "server.mjs");
  });

  it("empty Map (size=0) in JSON mode encodes textOutput as content field", () => {
    const emptyMap = new Map();
    const json = JSON.parse(serializeSnippetResult("fallback text", emptyMap, [], "json"));
    assert.equal(json.content, "fallback text");
  });
});

// ── rank.mjs gaps ─────────────────────────────────────────────

describe("rankResults — coverage gaps", () => {
  it(".spec. pattern treated as test file when rerank=true", () => {
    const r = rankResults([
      { path: "auth.spec.ts",  full_path: "/p/auth.spec.ts",  ranges: [[1, 5]] },
      { path: "src/auth.mjs",  full_path: "/p/src/auth.mjs",  ranges: [[1, 5]] },
    ], { rerank: true });
    assert.equal(r[0].full_path, "/p/src/auth.mjs",  "source file before spec file");
    assert.equal(r[1].full_path, "/p/auth.spec.ts",  "spec file sorted last");
  });

  it("files without full_path collapse under same undefined key (dedup by undefined)", () => {
    const r = rankResults([
      { path: "a.mjs", ranges: [[1, 5]] },
      { path: "b.mjs", ranges: [[20, 25]] },  // non-adjacent so mergeRanges keeps both
    ]);
    assert.equal(r.length, 1, "both undefined-key entries merge into one");
    assert.equal(r[0].ranges.length, 2, "non-adjacent ranges from both entries preserved");
  });

  it("file missing ranges property is handled gracefully → empty ranges", () => {
    const r = rankResults([{ path: "a.mjs", full_path: "/p/a.mjs" }]);
    assert.deepEqual(r[0].ranges, []);
  });
});
