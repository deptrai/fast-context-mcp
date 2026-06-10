import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packContext } from "../deepgrep/src/pack.mjs";
import { serializePackResult } from "../deepgrep/src/contract.mjs";

// ── Fixtures ────────────────────────────────────────────────

let tmpDir, fileImpl, fileCallerUtil, fileTest;

before(() => {
  tmpDir     = mkdtempSync(join(tmpdir(), "pack-test-"));
  fileImpl   = join(tmpDir, "auth.mjs");
  fileCallerUtil = join(tmpDir, "utils.mjs");
  fileTest   = join(tmpDir, "auth.test.mjs");

  const makeLines = (n, prefix = "line") =>
    Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join("\n");

  writeFileSync(fileImpl,  makeLines(20, "auth content"));
  writeFileSync(fileCallerUtil, makeLines(10, "util content"));
  writeFileSync(fileTest,  makeLines(10, "test content"));
});

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── packContext tests ────────────────────────────────────────

describe("packContext — empty / missing input", () => {
  it("returns empty pack for files: []", () => {
    const r = packContext({ files: [], max_chars: 1000 });
    assert.deepEqual(r.snippets, []);
    assert.deepEqual(r.dropped, []);
    assert.equal(r.meta.total_chars, 0);
  });

  it("returns empty pack for undefined files", () => {
    const r = packContext({ max_chars: 1000 });
    assert.deepEqual(r.snippets, []);
  });
});

describe("packContext — budget enforcement (AC2)", () => {
  it("assembles snippets within budget", () => {
    const r = packContext({
      files: [{ file: fileImpl, ranges: [[1, 5]] }],
      max_chars: 10000,
    });
    assert.ok(r.snippets.length > 0, "should have snippets");
    assert.ok(r.meta.total_chars <= 10000, "must not exceed budget");
  });

  it("drops snippets that would exceed max_chars", () => {
    const r = packContext({
      files: [
        { file: fileImpl,  ranges: [[1, 20]] },
        { file: fileCallerUtil, ranges: [[1, 10]] },
      ],
      max_chars: 5,  // tight budget: first file already exceeds
    });
    const totalDropped = r.dropped.reduce((s, d) => s + d.count, 0);
    // At least one snippet dropped because budget is 5 chars
    assert.ok(totalDropped > 0 || r.snippets.length === 0, "must drop or have 0 snippets");
  });

  it("dropped entries have reason='budget'", () => {
    const r = packContext({
      files: [
        { file: fileImpl,  ranges: [[1, 20]] },
        { file: fileCallerUtil, ranges: [[1, 10]] },
      ],
      max_chars: 5,
    });
    assert.ok(r.dropped.every(d => d.reason === "budget"), "reason must be 'budget'");
  });

  it("meta.used_pct is 0-100", () => {
    const r = packContext({
      files: [{ file: fileImpl, ranges: [[1, 3]] }],
      max_chars: 1000,
    });
    assert.ok(r.meta.used_pct >= 0 && r.meta.used_pct <= 100);
    assert.ok(r.meta.total_chars > 0);
  });
});

describe("packContext — role labeling (AC4)", () => {
  it("labels test file as 'test' role", () => {
    const r = packContext({
      files: [{ file: fileTest, ranges: [[1, 5]] }],
      max_chars: 10000,
    });
    const testSnippets = r.snippets.filter(s => s.role === "test");
    assert.ok(testSnippets.length > 0, "test file should have 'test' role");
  });

  it("labels implementation file as 'implementation' role", () => {
    const r = packContext({
      files: [{ file: fileImpl, ranges: [[1, 5]] }],
      max_chars: 10000,
    });
    const implSnippets = r.snippets.filter(s => s.role === "implementation");
    assert.ok(implSnippets.length > 0, "auth.mjs should have 'implementation' role");
  });
});

describe("packContext — rerank integration", () => {
  it("rerank=true does not crash and returns same or reordered files", () => {
    const r = packContext({
      files: [
        { file: fileTest, ranges: [[1, 3]] },
        { file: fileImpl, ranges: [[1, 3]] },
      ],
      max_chars: 10000,
      rerank: true,
    });
    // implementation file should appear before test file when reranked
    const roles = r.snippets.map(s => s.role);
    const implIdx = roles.indexOf("implementation");
    const testIdx = roles.indexOf("test");
    if (implIdx !== -1 && testIdx !== -1) {
      assert.ok(implIdx < testIdx, "implementation should come before test when reranked");
    }
  });
});

// ── serializePackResult tests ────────────────────────────────

describe("serializePackResult — text format", () => {
  it("returns markdown with budget header", () => {
    const r = packContext({
      files: [{ file: fileImpl, ranges: [[1, 3]] }],
      max_chars: 10000,
    });
    const text = serializePackResult(r, {}, "text");
    assert.ok(text.includes("# Context Pack"), "should have Context Pack header");
    assert.ok(text.includes("chars"), "should mention chars");
  });

  it("returns no-content message for empty pack", () => {
    const text = serializePackResult({ snippets: [], dropped: [], meta: { total_chars: 0, budget_chars: 100, used_pct: 0 } }, {}, "text");
    assert.ok(text.includes("No context assembled"), "should mention no context");
  });

  it("reports dropped snippets in text", () => {
    const r = packContext({
      files: [
        { file: fileImpl,  ranges: [[1, 20]] },
        { file: fileCallerUtil, ranges: [[1, 10]] },
      ],
      max_chars: 5,
    });
    const text = serializePackResult(r, {}, "text");
    if (r.dropped.length > 0) {
      assert.ok(text.includes("omitted"), "should mention omitted snippets");
    }
  });
});

describe("serializePackResult — JSON format (AC7)", () => {
  it("returns valid JSON with schema_version=1.0", () => {
    const r = packContext({
      files: [{ file: fileImpl, ranges: [[1, 3]] }],
      max_chars: 10000,
    });
    const json = JSON.parse(serializePackResult(r, {}, "json"));
    assert.equal(json.schema_version, "1.0");
    assert.ok(Array.isArray(json.pack.snippets), "pack.snippets must be array");
    assert.equal(json.meta.retrieval, "lexical");
    assert.equal(json.meta.index_used, false);
    assert.equal(json.meta.pack_mode, true);
  });

  it("pack.dropped is present in JSON", () => {
    const r = packContext({ files: [], max_chars: 100 });
    const json = JSON.parse(serializePackResult(r, {}, "json"));
    assert.ok(Array.isArray(json.pack.dropped));
  });
});
