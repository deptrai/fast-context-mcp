---
story_id: "4.3"
story_key: "4-ranking-dedup"
epic: 4
status: done
created: 2026-06-10
baseline_commit: b62a7286e93983960f8be64e6bb3da456d17075f
covers: ["FR11"]
execution_order: "4.1 → 4.3 → 4.2"
depends_on: "4-stable-output-contract (done)"
---

# Story 4.3: Result ranking + dedup (`rank.mjs`)

## Story

As a developer,
I want results ordered by usefulness with duplicates merged,
so that the first few files are usually enough without manual filtering.

## Context (read before starting)

This is the **SECOND** story of Epic 4. Execution order: **4.1 → 4.3 → 4.2**.

**Why 4.3 before 4.2:** Story 4.2 (Context Pack `deepgrep_pack`) assembles ranked+labeled input. It depends on ranking (4.3) to produce ordered, deduped results before budgeting.

**Foundation from 4.1:** `contract.mjs` is the serialization seam. `serializeSearchResult(result, opts, formatText, format)` is where ranking integrates — apply `rankResults` to `result.files` before serializing to either text or JSON. This keeps tool handlers completely untouched.

**ADR-8 context:** `files[].role` and `files[].score` are currently `null` (reserved). This story does NOT populate `score` (that's for embeddings, later). `role` is Story 4.2 territory. Story 4.3 only provides ordering + dedup.

## Acceptance Criteria

- **AC1:** Given multiple results with duplicate `full_path`, Then file paths merged into a single entry with combined ranges; no duplicate `full_path` values in output
- **AC2:** Given a single file with overlapping or adjacent ranges (e.g. `[[1,10],[5,15]]`), Then ranges merged to non-overlapping sorted intervals (e.g. `[[1,15]]`)
- **AC3:** Given a query not asking for tests and `rerank=true`, Then source files sorted before test/docs files (path heuristic: `/test/`, `.test.`, `__tests__/` → test)
- **AC4:** Given deep-mode results (LLM already ordered), When `rerank` is omitted or `false`, Then file ORDER is preserved (dedup+range-merge still applies, sort does not)
- **AC5:** Given `rerank=true`, Then sorting applies regardless of backend mode
- **AC6:** Given ranking logic, Then all logic lives in pure module `src/rank.mjs` — no coupling to server.mjs, no MCP SDK import, no backend calls
- **AC7:** Given tests, Then unit tests cover: dedup by full_path, range merge (overlapping, adjacent, non-overlapping, single), source-over-test sort, LLM order preserved when rerank=false

## Tasks

### T1. Create `deepgrep/src/rank.mjs` (NEW — pure module)

- [x] Export `rankResults(files, opts = {})`:
  - Calls `deduplicateFiles(files)` → merged by `full_path`
  - Calls `mergeRanges(f.ranges)` on each file → sorted, non-overlapping intervals
  - If `opts.rerank === true`: calls `sortByRelevance(files, opts)` → source-before-test
  - Returns modified files array; original `result.files` NOT mutated (return new array)
- [x] Implement `deduplicateFiles(files)`:
  - Group by `full_path`; keep first entry's metadata, concat all ranges
  - Preserve first-occurrence order (insertion order)
- [x] Implement `mergeRanges(ranges)`:
  - Input: `[[start,end],...]` (1-indexed inclusive)
  - Sort by start; merge overlapping/adjacent (where `end+1 >= nextStart`)
  - Return sorted merged intervals; empty array → empty array
- [x] Implement `sortByRelevance(files, opts)`:
  - `isTestFile(path)`: true if path contains `/test/`, `.test.`, `__tests__/`, `/spec/`, `.spec.`
  - Sort: non-test before test; within each group preserve relative order (stable sort)
- [x] `node --check` passes

### T2. Integrate `rankResults` into `contract.mjs#serializeSearchResult`

- [x] Import: `import { rankResults } from "./rank.mjs";`
- [x] In `serializeSearchResult`: apply ranking to result BEFORE serializing:
  ```js
  export function serializeSearchResult(result, opts, formatText, format = "text") {
    const ranked = { ...result, files: rankResults(result.files || [], opts) };
    if (format === "json") return toJsonContract(ranked, opts);
    return formatText(ranked, opts.maxTurns ?? 3, ...);
  }
  ```
- [x] `opts.rerank` flows through from tool handler → `serializeSearchResult` → `rankResults`
- [x] Both text AND JSON modes get ranked results (consistency)

### T3. Add `rerank` param to `deepgrep_search` + `deepgrep_deep` in `server.mjs`

- [x] Add to `deepgrep_search` schema (after `output_format`):
  ```js
  rerank: z.boolean().default(false)
    .describe("If true, sort results: source files before test/docs. Default false (trusts LLM order).")
  ```
- [x] Add to `deepgrep_deep` schema (same position)
- [x] Destructure `rerank` in each handler
- [x] Pass through to `serializeSearchResult` opts: `{ ..., rerank }`
- [x] `deepgrep_get` does NOT get `rerank` — snippet retrieval is not a search result
- [x] `node --check deepgrep/src/server.mjs` passes

### T4. Unit tests `test/rank.test.mjs`

- [x] `deduplicateFiles`: same full_path merged, ranges concatenated, first-occurrence order preserved
- [x] `mergeRanges`: overlapping `[[1,10],[5,15]]` → `[[1,15]]`; adjacent `[[1,5],[6,10]]` → `[[1,10]]`; non-overlapping `[[1,3],[5,7]]` → `[[1,3],[5,7]]`; empty → `[]`; single → unchanged
- [x] `rankResults` dedup+merge without rerank: order preserved
- [x] `rankResults` with `rerank=true`: test files sorted after source
- [x] `rankResults` with `rerank=false`: LLM order preserved even when test files precede source
- [x] `serializeSearchResult` integration: ranked files appear correctly in JSON output (import from contract.mjs)
- [x] Pattern: `node:test`, pure function tests, no I/O, no mocks needed — follow `test/server-format-result.test.mjs` style

### T5. Verify

- [x] `node --check deepgrep/src/rank.mjs && node --check deepgrep/src/contract.mjs && node --check deepgrep/src/server.mjs`
- [x] `node --test 'test/**/*.test.mjs'` — all pass incl. new rank tests
- [x] Manual: call `deepgrep_search` with `rerank=true` → verify source files first
- [x] Manual: call `deepgrep_search` with `rerank=false` (default) → verify order unchanged

### Review Findings

- [x] [Review][Patch] Missing `serializeSearchResult` integration test required by AC7 [test/rank.test.mjs:1] — AC7/T4 explicitly require a `serializeSearchResult` integration test proving ranked files appear correctly in JSON output, but `test/rank.test.mjs` only imports/tests `rankResults`; no test imports `contract.mjs` or exercises text/JSON serialization after ranking.

## Dev Notes

### Integration point in `contract.mjs` (UPDATE)

Current `serializeSearchResult` (Story 4.1):
```js
export function serializeSearchResult(result, opts, formatText, format = "text") {
  if (format === "json") return toJsonContract(result, opts);
  return formatText(result, opts.maxTurns ?? 3, ...);
}
```

After this story:
```js
import { rankResults } from "./rank.mjs";   // add at top of contract.mjs

export function serializeSearchResult(result, opts, formatText, format = "text") {
  const ranked = { ...result, files: rankResults(result.files || [], opts) };
  if (format === "json") return toJsonContract(ranked, opts);
  return formatText(ranked, opts.maxTurns ?? 3, opts.maxResults ?? 10,
    opts.maxCommands ?? 8, opts.timeoutMs ?? 30000,
    opts.excludePaths ?? [], opts.includeSnippets ?? false);
}
```

Key: `result` is NOT mutated. Spread `{ ...result, files: [...] }` creates a new object.

### `rankResults` function signature

```js
// src/rank.mjs
export function rankResults(files, opts = {}) → Array
// files: Array<{ path, full_path, ranges, role, score, ... }>
// opts: { rerank?: boolean }
// Returns: new array — never mutates input
```

`files[].role` and `files[].score` are passed through unchanged (still null from 4.1). Story 4.3 does NOT set these fields. Story 4.2 sets `role`; score is for future embedding-based ranking.

### rerank param flow

```
zod schema (server.mjs) → handler destructure
  → serializeSearchResult(result, { ..., rerank }, formatText, format)
    → rankResults(files, { rerank })
```

`rerank` is optional boolean, defaults to `false`. Never required.

### Existing tests that must stay green

- `test/contract.test.mjs` (12 tests) — `serializeSearchResult` text mode must stay byte-identical (AC2 of story 4.1). Ranking does not change text output structure; it only reorders files. Tests use a 2-file fixture — after dedup+merge they should produce identical output since there are no duplicates or overlapping ranges in the fixture.
- All 271 existing tests — zero regressions.

### Anti-patterns to avoid

- ❌ Mutating `result.files` in place — always return a new array
- ❌ Putting rank logic in server.mjs tool handlers — `rank.mjs` only, pure functions
- ❌ Tree-sitter or AST parsing for role detection — path heuristics only (Serena territory)
- ❌ Sorting all results by test/source when `rerank=false` — trust LLM order, only dedup+merge
- ❌ Importing MCP SDK or any external dep in `rank.mjs` — pure JS only, no new dependencies

### Submodule note

`deepgrep/` is a git submodule. Changes to `rank.mjs`, `contract.mjs`, `server.mjs` require submodule commit + parent pointer bump (same flow as Story 4.1 / Story 3.1).

## Dev Agent Record

_(populated during dev-story)_
