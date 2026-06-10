---
story_id: "4.1"
story_key: "4-stable-output-contract"
epic: 4
status: in-progress
created: 2026-06-08
baseline_commit: caabb7d
covers: ["FR9", "ADR-8"]
---

# Story 4.1: Stable structured output contract (`output_format=json`)

## Story

As an agent builder,
I want stable JSON/metadata output from deepgrep tools,
so that I can reliably compose deepgrep with other tools and agents without parsing free-form text.

## Context (read before starting)

This is the FIRST story of Epic 4 (Portable Context Engine, v1.3) — execution order **4.1 → 4.3 → 4.2**. It is the foundation: Story 4.3 (ranking) and 4.2 (pack) both serialize through the contract built here.

**Key insight:** deepgrep already has a stable internal result shape `{files, rg_patterns, _meta, error?}` produced by both backends (`core.mjs`, `openai-backend.mjs`). This story does NOT invent new data — it exposes the existing shape as JSON via a single serialization seam. The text path (`_formatResult`) stays byte-for-byte unchanged.

**Architecture authority:** ADR-8 (architecture.md). Bound by it.

## Acceptance Criteria

- **AC1:** Given any `deepgrep_search`/`deepgrep_deep`/`deepgrep_get` call, When `output_format="json"` param passed, Then returns JSON string matching ADR-8 schema: `{schema_version, files[], grep_keywords[], meta{}}`
- **AC2:** Given `output_format` omitted or `"text"` (default), Then output is identical to current behavior — zero regression, byte-for-byte unchanged
- **AC3:** Given JSON output, Then `meta` includes: `backend`, `mode` ("quick"|"deep"|"escalated"), `cache_hit`, `retrieval` ("lexical"), `index_used` (false), `tree_depth`, `tree_size_kb`, `fell_back`
- **AC4:** Given forward-looking fields `retrieval` and `index_used`, Then always `"lexical"` and `false` respectively in v1.3 (reserved for Epic 5 — non-breaking when added)
- **AC5:** Given all serialization logic, Then it lives in ONE new module `src/contract.mjs` — no JSON formatting in tool handlers or backend code
- **AC6:** Given `deepgrep_get` with `output_format="json"`, Then returns `{schema_version, files: [{path, ranges, content}], meta: {retrieval, index_used}}`
- **AC7:** Given tests, Then unit tests cover: JSON mode search result, JSON mode get result, text mode unchanged, schema_version present, forward fields present

## Tasks

### T1. Create `deepgrep/src/contract.mjs` (NEW module)

- [x] Export `serializeSearchResult(result, opts, format)`:
  - `format === "text"` → delegate to existing `_formatResult` (import or pass-in)
  - `format === "json"` → `toJsonContract(result, opts)`
- [x] Implement `toJsonContract(result, opts)` building ADR-8 schema from internal `{files, rg_patterns, _meta, error?}`:
  - `schema_version: "1.0"`
  - `files`: map each to `{path, full_path, ranges, role: null, score: null}` (role/score reserved for 4.3/4.2)
  - `grep_keywords`: from `result.rg_patterns` (dedup, filter len ≥ 3 — match existing `_formatResult` logic)
  - `meta`: `{backend, mode, cache_hit, retrieval: "lexical", index_used: false, tree_depth, tree_size_kb, fell_back}` from `result._meta`
  - `error`: include `{error}` field when `result.error` present
- [x] Export `serializeSnippetResult(snippetResult, format)` for `deepgrep_get` JSON path
- [x] `node --check` passes

### T2. Wire `output_format` param into 3 tools in `server.mjs`

- [x] Add zod param to `deepgrep_search`, `deepgrep_deep`, `deepgrep_get`:
  ```js
  output_format: z.enum(["text", "json"]).default("text")
    .describe("Output format. 'text' (default) for human-readable; 'json' for stable machine-parseable contract.")
  ```
- [x] In each handler: after producing `result`, call `serializeSearchResult(result, opts, output_format)` instead of inline `_formatResult`
- [x] `deepgrep_get`: route through `serializeSnippetResult`
- [x] CRITICAL: text path must stay identical — when `output_format="text"`, call the SAME `_formatResult` with SAME args as today

### T3. Refactor `_formatResult` access (minimal)

- [x] `_formatResult` currently lives in `server.mjs`. Either: (a) export it so `contract.mjs` imports it, OR (b) move it into `contract.mjs` and re-import into `server.mjs`. Prefer (a) — smaller blast radius.
- [x] Do NOT change `_formatResult` logic. Only change its visibility.

### T4. Unit tests `deepgrep/test/contract.test.mjs`

- [x] AC1: search result → JSON has schema_version + files + grep_keywords + meta
- [x] AC3/AC4: meta has all fields incl. retrieval="lexical", index_used=false
- [x] AC6: snippet result → JSON shape
- [x] AC2: text mode output unchanged (snapshot or equality vs _formatResult direct call)
- [x] error result → JSON includes error field
- [x] Pattern: `node:test`, follow `server-format-result.test.mjs` style (mirror or import)

### T5. Verify

- [x] `node --check deepgrep/src/contract.mjs && node --check deepgrep/src/server.mjs`
- [x] `node --test 'test/**/*.test.mjs'` — all pass incl. new contract tests
- [x] Manual: call each tool with `output_format=json` via MCP, confirm schema

## Dev Notes

### Internal result shape (already exists — DO NOT change backends)

Both backends return this shape (verified in `core.mjs` + `openai-backend.mjs`):
```js
{
  files: [{ path, full_path, ranges: [[start,end],...] }],
  rg_patterns: ["keyword", ...],
  _meta: { treeDepth, treeSizeKB, fellBack, backend, model, cache_hit, projectRoot? },
  error?: "message"   // present only on failure
}
```
`contract.mjs` reads this and serializes. It NEVER calls a backend or mutates the result.

### Reuse map — DO NOT reimplement

| Need | Reuse | From |
|------|-------|------|
| Text formatting | `_formatResult(result, maxTurns, maxResults, maxCommands, timeoutMs, excludePaths, includeSnippets)` | `server.mjs:111` |
| grep keyword dedup/filter | same logic as `_formatResult` (`[...new Set(rg_patterns)].filter(p=>p.length>=3)`) | `server.mjs` |
| Snippet reading (get tool) | `formatSnippetToolOutput({files})` / `readSnippets` | `server.mjs:83`, `snippets.mjs` |

### Field mapping: internal `_meta` → JSON `meta`

| Internal | JSON contract |
|----------|---------------|
| `_meta.backend` | `meta.backend` |
| (derive) | `meta.mode` — "quick"/"deep"/"escalated" based on call path |
| `_meta.cache_hit` | `meta.cache_hit` |
| — | `meta.retrieval` = `"lexical"` (constant v1.3) |
| — | `meta.index_used` = `false` (constant v1.3) |
| `_meta.treeDepth` | `meta.tree_depth` |
| `_meta.treeSizeKB` | `meta.tree_size_kb` |
| `_meta.fellBack` | `meta.fell_back` |

### Constraints (from ADR-8)

- NFR3: no new dependencies — pure JS only.
- NFR4: backward compat — `output_format` defaults to `"text"`, existing callers unaffected.
- Single seam: ALL JSON serialization in `contract.mjs`. If you write `JSON.stringify` in a tool handler, the design is wrong.
- `schema_version: "1.0"` is mandatory — it is the escape hatch for future breaking changes.
- `retrieval` + `index_used` are forward-looking for Epic 5 (indexed tier). Hardcode `"lexical"`/`false` now; do NOT omit them.

### Anti-patterns to avoid

- ❌ Adding JSON branches inside each tool handler (fans out, drifts) → use the single module
- ❌ Touching `core.mjs`/`openai-backend.mjs` (backends already emit the right shape)
- ❌ Changing `_formatResult` logic (text mode must stay byte-identical)
- ❌ Inventing fields not in ADR-8 schema (keep contract minimal + versioned)

### Open submodule note

`deepgrep/` is an open-source git submodule. Edits land there → require submodule commit + parent pointer bump (same flow as Story 3.1). Tests in repo `test/` import from `../deepgrep/src/`; run suite from main repo root.

## Dev Agent Record

_(populated during dev-story)_


### Review Findings

- [x] [Review][Patch] Roadmap table v2.0: "Gated / aspirational" không dịch [epics.md]
- [x] [Review][Patch] Roadmap table v1.5: "Future" không dịch [epics.md]
- [x] [Review][Patch] Section heading: "Bản đồ Phủ sóng FR" → "Bản đồ Bao phủ FR" ("phủ sóng" = độ phủ tín hiệu viễn thông) [epics.md]
- [x] [Review][Patch] Story 4.1 title: "stable" bổ nghĩa sai cho "cấu trúc" thay vì "hợp đồng" — nên là "Hợp đồng output ổn định có cấu trúc" [epics.md]
- [x] [Review][Patch] Story 4.1 AC5: "được test bao phủ cho search + get" → "được bao phủ bởi các bài test cho search + get" [epics.md]
- [x] [Review][Patch] FR10 + Story 4.2 ACs: "cưỡng chế" → "bắt buộc" (sai ngữ nghĩa cho "enforced") [epics.md]
- [x] [Review][Patch] Story 3.2 Notes: "Bộc lộ dưới dạng" → "Cung cấp dưới dạng" (sai sắc thái cho "Expose as") [epics.md]
- [x] [Review][Patch] Story 5.1/5.2 titles: "(có cổng)" → "(có cổng kiểm soát)" cho nhất quán [epics.md]
- [x] [Review][Patch] Story 3.2 title: "Warm cache" giữ nguyên tiếng Anh, thân dịch là "làm nóng cache" [epics.md]
- [x] [Review][Patch] Requirements Inventory: "NFR6 (budget pack)" → "NFR6 (pack budget)" (đảo thứ tự từ) [epics.md]
- [x] [Review][Patch] Requirements Inventory: "NFRs" → "NFR" bỏ số nhiều không có chủ ý [epics.md]
- [x] [Review][Patch] Inconsistent "done": ba cách dịch "xong"/"Xong"/"đã xong" — chuẩn hóa về "đã xong" [epics.md]
- [x] [Review][Patch] FR Coverage Map: xác nhận FR3–FR8 rows thay thế đúng bản gốc tiếng Anh (diff hiển thị là pure additions) [epics.md]
- [x] [Review][Defer] "bypass" → "bỏ qua" mất nghĩa vượt qua cơ chế [epics.md] — deferred, chấp nhận được ở mức tài liệu summary

---

## Senior Developer Review (AI)
Date: 2026-06-10 | Reviewers: Blind Hunter + Edge Case Hunter + Acceptance Auditor

### Review Findings

**0 decision-needed · 8 patch · 3 defer · 4 dismissed**

#### Patch items (must fix)

- [ ] [Review][Patch] Pre-escalate path corrupts JSON: unchecked text append after serializeSearchResult [deepgrep/src/server.mjs:308-309]
- [ ] [Review][Patch] OpenAI fast-path empty-result escalation corrupts JSON: missing output_format guard [deepgrep/src/server.mjs:342]
- [ ] [Review][Patch] refineHintForOutput dead variable: non-English hint dropped in windsurf/openai fast paths [deepgrep/src/server.mjs:315]
- [ ] [Review][Patch] Double readSnippets in deepgrep_get JSON path: files read twice, TOCTOU risk [deepgrep/src/server.mjs:525-528]
- [ ] [Review][Patch] isEmpty uses fragile text-string matching when structural wsEmpty already available [deepgrep/src/server.mjs:374-375]
- [ ] [Review][Patch] deepgrep_get JSON: path and full_path both absolute — inconsistent with search output schema [deepgrep/src/contract.mjs:78-84]
- [ ] [Review][Patch] ranges field omitted when undefined: missing ?? [] fallback in toJsonContract [deepgrep/src/contract.mjs:28]
- [ ] [Review][Patch] result.error serializes to {} if value is an Error object: no defensive String() conversion [deepgrep/src/contract.mjs:52]

#### Deferred items

- [x] [Review][Defer] grep_keywords drops < 3-char patterns (id, db, fs) — pre-existing behavior matching _formatResult, intentional
- [x] [Review][Defer] raw_response field invisible in JSON contract — pre-existing limitation of search path, not in AC scope
- [x] [Review][Defer] toSnippetJsonContract `|| null` drops empty-string content — low impact edge case, future hardening

#### Dismissed

- AC7 false positive: test/contract.test.mjs committed in parent repo (7c66fff), auditor only saw submodule diff
- meta.backend defaults to "windsurf" — intentional per ADR-8 spec
- index_used/retrieval hardcoded — intentional forward-looking constants per ADR-8
- toJsonContract null crash — caught by outer try/catch in all call sites

---

### Action Required

Review outcome: **8 patch findings** — story set back to `in-progress` until patches applied.
