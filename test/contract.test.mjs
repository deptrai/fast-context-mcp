/**
 * Tests for contract.mjs — ADR-8 serialization module.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeSearchResult, serializeSnippetResult } from "../deepgrep/src/contract.mjs";
import { _formatResult } from "../deepgrep/src/server.mjs";

// minimal _meta matching real backend shape
const BASE_META = { treeDepth: 3, treeSizeKB: 12.5, fellBack: false, backend: "openai", model: "deep-search", cache_hit: false };

const RESULT_FILES = {
  files: [
    { path: "src/auth.mjs", full_path: "/p/src/auth.mjs", ranges: [[10, 20]] },
    { path: "src/db.mjs", full_path: "/p/src/db.mjs", ranges: [[1, 5]] },
  ],
  rg_patterns: ["auth", "auth", "handler", "xy"],
  _meta: { ...BASE_META },
};

const RESULT_ERROR = {
  files: [],
  rg_patterns: [],
  error: "rate limited",
  _meta: { ...BASE_META, cache_hit: false },
};

const RESULT_EMPTY = { files: [], rg_patterns: [], _meta: { ...BASE_META } };

describe("serializeSearchResult — JSON format (AC1, AC3, AC4, AC5)", () => {
  it("AC1: returns JSON string with schema_version, files, grep_keywords, meta", () => {
    const out = serializeSearchResult(RESULT_FILES, { mode: "deep" }, _formatResult, "json");
    const parsed = JSON.parse(out);
    assert.equal(parsed.schema_version, "1.0");
    assert.ok(Array.isArray(parsed.files));
    assert.ok(Array.isArray(parsed.grep_keywords));
    assert.ok(typeof parsed.meta === "object");
  });

  it("AC3: meta contains all required fields", () => {
    const out = serializeSearchResult(RESULT_FILES, { mode: "quick" }, _formatResult, "json");
    const { meta } = JSON.parse(out);
    assert.equal(meta.backend, "openai");
    assert.equal(meta.mode, "quick");
    assert.equal(typeof meta.cache_hit, "boolean");
    assert.equal(meta.tree_depth, 3);
    assert.equal(meta.tree_size_kb, 12.5);
    assert.equal(meta.fell_back, false);
  });

  it("AC4: retrieval=lexical and index_used=false (forward-looking fields)", () => {
    const out = serializeSearchResult(RESULT_FILES, { mode: "deep" }, _formatResult, "json");
    const { meta } = JSON.parse(out);
    assert.equal(meta.retrieval, "lexical");
    assert.equal(meta.index_used, false);
  });

  it("files are mapped correctly with role/score nulls", () => {
    const out = serializeSearchResult(RESULT_FILES, {}, _formatResult, "json");
    const { files } = JSON.parse(out);
    assert.equal(files[0].path, "src/auth.mjs");
    assert.equal(files[0].full_path, "/p/src/auth.mjs");
    assert.deepEqual(files[0].ranges, [[10, 20]]);
    assert.equal(files[0].role, null);
    assert.equal(files[0].score, null);
  });

  it("grep_keywords deduped and length>=3 only (excludes 'xy')", () => {
    const out = serializeSearchResult(RESULT_FILES, {}, _formatResult, "json");
    const { grep_keywords } = JSON.parse(out);
    assert.ok(grep_keywords.includes("auth"));
    assert.ok(grep_keywords.includes("handler"));
    assert.ok(!grep_keywords.includes("xy"));  // 2 chars, filtered
    assert.ok(!grep_keywords.includes("auth") || true);  // dedup check below
    // deduped: auth appears once
    assert.equal(grep_keywords.filter(k => k === "auth").length, 1);
  });

  it("error result includes error field in JSON", () => {
    const out = serializeSearchResult(RESULT_ERROR, { mode: "deep" }, _formatResult, "json");
    const parsed = JSON.parse(out);
    assert.equal(parsed.error, "rate limited");
  });

  it("schema_version is '1.0'", () => {
    const out = serializeSearchResult(RESULT_FILES, {}, _formatResult, "json");
    assert.equal(JSON.parse(out).schema_version, "1.0");
  });
});

describe("serializeSearchResult — text format (AC2: zero regression)", () => {
  it("text mode output matches _formatResult directly", () => {
    const direct = _formatResult(RESULT_FILES, 3, 10, 8, 30000, [], false);
    const via = serializeSearchResult(RESULT_FILES,
      { maxTurns: 3, maxResults: 10, maxCommands: 8, timeoutMs: 30000, excludePaths: [], includeSnippets: false },
      _formatResult, "text");
    assert.equal(via, direct);
  });

  it("text mode with default format param = text", () => {
    const direct = _formatResult(RESULT_EMPTY, 3, 10, 8, 30000, [], false);
    const via = serializeSearchResult(RESULT_EMPTY,
      { maxTurns: 3, maxResults: 10, maxCommands: 8, timeoutMs: 30000, excludePaths: [], includeSnippets: false },
      _formatResult);
    assert.equal(via, direct);
  });
});

describe("serializeSnippetResult — AC6: JSON get output", () => {
  it("text mode returns text unchanged", () => {
    const text = "## /p/a.mjs (L1-2)\n```\n1 | line\n```";
    assert.equal(serializeSnippetResult(text, new Map(), [], "text"), text);
  });

  it("json mode returns schema_version + meta with retrieval/index_used", () => {
    const snippetMap = new Map([["/p/a.mjs", "1 | line"]]);
    const files = [{ file: "/p/a.mjs", ranges: [[1, 1]] }];
    const out = serializeSnippetResult("text", snippetMap, files, "json");
    const parsed = JSON.parse(out);
    assert.equal(parsed.schema_version, "1.0");
    assert.equal(parsed.meta.retrieval, "lexical");
    assert.equal(parsed.meta.index_used, false);
    assert.equal(parsed.files[0].path, "p/a.mjs");        // short path (last-2 segments)
    assert.equal(parsed.files[0].full_path, "/p/a.mjs"); // full_path unchanged
    assert.equal(parsed.files[0].content, "1 | line");
  });

  it("json mode with plain string snippetResult returns content field", () => {
    const out = serializeSnippetResult("No files/ranges provided", null, [], "json");
    const parsed = JSON.parse(out);
    assert.equal(parsed.content, "No files/ranges provided");
  });
});
