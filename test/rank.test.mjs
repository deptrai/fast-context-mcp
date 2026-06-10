import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankResults } from "../deepgrep/src/rank.mjs";

const mkFile = (full_path, ranges, overrides = {}) => ({
  path: full_path.split("/").slice(-2).join("/"),
  full_path,
  ranges,
  role: null,
  score: null,
  ...overrides,
});

describe("deduplication (AC1)", () => {
  it("duplicate full_paths merged into one entry", () => {
    const r = rankResults([
      mkFile("/p/a.mjs", [[1, 5]]),
      mkFile("/p/b.mjs", [[1, 3]]),
      mkFile("/p/a.mjs", [[8, 12]]),
    ]);
    assert.equal(r.length, 2);
    assert.equal(r[0].full_path, "/p/a.mjs");
    assert.equal(r[1].full_path, "/p/b.mjs");
  });

  it("merged entry has combined ranges", () => {
    const r = rankResults([mkFile("/p/a.mjs", [[1, 5]]), mkFile("/p/a.mjs", [[10, 15]])]);
    assert.equal(r[0].ranges.length, 2);
  });

  it("first-occurrence metadata preserved", () => {
    const r = rankResults([
      mkFile("/p/a.mjs", [[1, 3]], { role: "implementation" }),
      mkFile("/p/a.mjs", [[5, 7]], { role: "caller" }),
    ]);
    assert.equal(r[0].role, "implementation");
  });

  it("does not mutate input array", () => {
    const files = [mkFile("/p/a.mjs", [[1, 5]]), mkFile("/p/a.mjs", [[8, 10]])];
    rankResults(files);
    assert.equal(files.length, 2);
  });
});

describe("range merge (AC2)", () => {
  it("overlapping ranges merged: [[1,10],[5,15]] → [[1,15]]", () => {
    const r = rankResults([mkFile("/p/a.mjs", [[1, 10], [5, 15]])]);
    assert.deepEqual(r[0].ranges, [[1, 15]]);
  });

  it("adjacent ranges merged: [[1,5],[6,10]] → [[1,10]]", () => {
    const r = rankResults([mkFile("/p/a.mjs", [[1, 5], [6, 10]])]);
    assert.deepEqual(r[0].ranges, [[1, 10]]);
  });

  it("non-overlapping preserved: [[1,3],[5,7]] → [[1,3],[5,7]]", () => {
    const r = rankResults([mkFile("/p/a.mjs", [[1, 3], [5, 7]])]);
    assert.deepEqual(r[0].ranges, [[1, 3], [5, 7]]);
  });

  it("single range unchanged", () => {
    const r = rankResults([mkFile("/p/a.mjs", [[1, 5]])]);
    assert.deepEqual(r[0].ranges, [[1, 5]]);
  });

  it("empty ranges stays empty", () => {
    const r = rankResults([mkFile("/p/a.mjs", [])]);
    assert.deepEqual(r[0].ranges, []);
  });

  it("unsorted input sorted and merged: [[10,20],[1,5],[3,12]] → [[1,20]]", () => {
    const r = rankResults([mkFile("/p/a.mjs", [[10, 20], [1, 5], [3, 12]])]);
    assert.deepEqual(r[0].ranges, [[1, 20]]);
  });
});

describe("LLM order preserved when rerank=false (AC4)", () => {
  it("default: test file first order preserved", () => {
    const r = rankResults([mkFile("/p/test/a.test.mjs", [[1,5]]), mkFile("/p/src/b.mjs", [[1,5]])]);
    assert.equal(r[0].full_path, "/p/test/a.test.mjs");
  });

  it("explicit rerank=false preserves order", () => {
    const r = rankResults([mkFile("/p/test/a.test.mjs", [[1,5]]), mkFile("/p/src/b.mjs", [[1,5]])], { rerank: false });
    assert.equal(r[0].full_path, "/p/test/a.test.mjs");
  });
});

describe("source-over-test when rerank=true (AC3, AC5)", () => {
  it("source files sorted before test files", () => {
    const r = rankResults([
      mkFile("/p/test/a.test.mjs", [[1,5]]),
      mkFile("/p/src/b.mjs", [[1,5]]),
      mkFile("/p/__tests__/c.mjs", [[1,5]]),
      mkFile("/p/src/d.mjs", [[1,5]]),
    ], { rerank: true });
    const paths = r.map((f) => f.full_path);
    assert.ok(paths.indexOf("/p/src/b.mjs") < paths.indexOf("/p/test/a.test.mjs"));
    assert.ok(paths.indexOf("/p/src/d.mjs") < paths.indexOf("/p/__tests__/c.mjs"));
  });

  it("relative order within source group preserved", () => {
    const r = rankResults([
      mkFile("/p/src/a.mjs", [[1,2]]),
      mkFile("/p/test/t.test.mjs", [[1,2]]),
      mkFile("/p/src/b.mjs", [[1,2]]),
    ], { rerank: true });
    const paths = r.map((f) => f.full_path);
    assert.ok(paths.indexOf("/p/src/a.mjs") < paths.indexOf("/p/src/b.mjs"));
  });
});

describe("edge cases", () => {
  it("empty array returns empty", () => { assert.deepEqual(rankResults([]), []); });
  it("null returns empty", () => { assert.deepEqual(rankResults(null), []); });
  it("undefined returns empty", () => { assert.deepEqual(rankResults(undefined), []); });
});
