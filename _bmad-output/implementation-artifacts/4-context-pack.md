---
story_id: "4.2"
story_key: "4-context-pack"
epic: 4
status: ready-for-dev
created: 2026-06-10
baseline_commit: aebe89a
covers: ["FR10", "NFR6", "NFR7", "ADR-9"]
execution_order: "4.1 → 4.3 → 4.2"
depends_on: ["4-stable-output-contract (done)", "4-ranking-dedup (done)"]
---

# Story 4.2: Context Pack (`deepgrep_pack`)

## Story

Với tư cách AI agent,
tôi muốn một context pack đã lắp ráp gọn từ kết quả search,
để tôi có thể trả lời hoặc chỉnh sửa mà không cần đọc cả file.

## Context (đọc trước khi bắt đầu)

Đây là story **CUỐI CÙNG** của Epic 4. Thứ tự thực thi: **4.1 → 4.3 → 4.2**.

**Tại sao 4.2 làm cuối:** Story này lắp ráp kết quả đã ranked+dedup từ 4.3, áp dụng role labels, và budget dưới `max_chars`. Phụ thuộc vào:
- Story 4.1: `contract.mjs` là serialization seam — pack output cũng đi qua đây
- Story 4.3: `rank.mjs#rankResults` cung cấp deduped+sorted files làm input cho pack

**ADR-9 binding constraints (4 điều BẮT BUỘC):**
1. **New tool, not hidden mode** — `deepgrep_pack` đăng ký tool thứ 5, tái dụng `readSnippets` + `formatSnippetToolOutput` từ Story 3.1
2. **Budget unit = `max_chars` enforced** — `max_lines` chỉ là hint; output KHÔNG BAO GIỜ vượt `max_chars`; dropped snippets được báo cáo rõ
3. **Role labeling = `src/roles.mjs` pure function** — heuristic path-based ONLY (không AST/tree-sitter); mỗi case phải có test fixture
4. **Stateless (kế thừa ADR-6)** — input `{query?, files?, ranges?, max_chars, max_lines?}`; không session linkage; files/ranges trực tiếp = pure local (no API key)

**Zero-index moat preservation:** Nếu pack parse symbols/AST, nó đã vào địa hạt Serena và phá vỡ lợi thế zero-index. Heuristic PHẢI đơn giản: path patterns, filename, match density — KÊ HẾT ĐÂY.

## Acceptance Criteria

- **AC1:** Cho một query (hoặc files/ranges từ search trước), Khi gọi `deepgrep_pack`, Thì trả về snippets hàng đầu grouped by role + sorted (qua `rank.mjs`), trong budget
- **AC2:** Cho budget `max_chars` (enforced) và `max_lines` (hint), Thì output không bao giờ vượt `max_chars`; snippets bị loại được báo cáo `[N snippets omitted]`
- **AC3:** Cho files/ranges trực tiếp, Thì pure local — không API key (như `deepgrep_get`)
- **AC4:** Cho mỗi snippet, Thì role label qua `src/roles.mjs`: `implementation|caller|config|test|docs|type` — CHỈ path + filename + match density, KHÔNG AST
- **AC5:** Cho implementation, Thì tái dụng `readSnippets` + `formatSnippetToolOutput` — KHÔNG duplicate snippet I/O
- **AC6:** Cho mỗi heuristic role case, Thì đi kèm test fixture (chặn heuristic creep)
- **AC7:** Cho output format, Thì hỗ trợ `output_format=json` qua `contract.mjs` (như search/get tools)

## Tasks

### T1. Create `deepgrep/src/roles.mjs` (NEW — pure module)

- [ ] Export `labelRole({path, full_path, query?, matchDensity?})`:
  - Returns: `"implementation" | "caller" | "config" | "test" | "docs" | "type"`
  - Heuristics ALLOWED: path patterns, filename, matchDensity (matches/total_lines ratio)
  - Heuristics FORBIDDEN: AST, tree-sitter, import graph, symbol resolution
- [ ] Implement heuristic cases:
  - `test`: `/test/`, `.test.`, `__tests__/`, `/spec/`, `.spec.`
  - `config`: `/config/`, `.config.`, `package.json`, `tsconfig.json`, `.env`
  - `docs`: `/docs/`, `README`, `.md` files
  - `type`: `.d.ts`, `/types/`, `/interfaces/`
  - `implementation`: high matchDensity (>0.3) OR query keywords in filename
  - `caller`: low matchDensity (<0.1) — mentions target but not definition
- [ ] Guard: if path doesn't match any pattern, default to `"implementation"`
- [ ] `node --check` passes

### T2. Create `deepgrep/src/pack.mjs` (NEW — orchestrator)

- [ ] Export `packContext({query?, files?, ranges?, max_chars, max_lines?, rerank?})`:
  - Call `rankResults(files, {rerank})` from `rank.mjs` — get deduped+sorted files
  - For each file, call `labelRole({path: file.full_path, query, matchDensity})`
  - Group files by role: `{implementation: [], caller: [], config: [], test: [], docs: [], type: []}`
  - Call `readSnippets(files)` from `snippets.mjs` — ONE call, all files
  - Assemble output respecting `max_chars` budget:
    - Priority order: implementation → caller → config → type → docs → test
    - Accumulate chars; stop when budget reached
    - Track dropped: `{role, count, reason: "budget"}`
  - Return `{snippets: [{role, path, ranges, content}], dropped: [{role, count}], meta: {total_chars, budget_used_pct}}`
- [ ] Budget enforcement: NEVER exceed `max_chars`; `max_lines` is advisory only
- [ ] `node --check` passes

### T3. Add `deepgrep_pack` tool to `server.mjs`

- [ ] Register tool (pattern như `deepgrep_get`):
  ```js
  server.tool("deepgrep_pack",
    "Assemble ranked, role-labeled context pack from search results. " +
    "Use after deepgrep_search or provide files/ranges directly. " +
    "Budget is enforced via max_chars (required). No API key needed when files/ranges provided.",
    {
      query: z.string().optional().describe("Original search query (helps role detection)"),
      files: z.array(z.object({
        file: z.string(),
        ranges: z.array(z.tuple([z.number().int(), z.number().int()]))
      })).optional().describe("Files/ranges from deepgrep_search or manual"),
      max_chars: z.number().int().min(100).describe("Hard budget limit (required)"),
      max_lines: z.number().int().optional().describe("Soft line limit hint"),
      rerank: z.boolean().default(false).describe("Apply source-before-test sort"),
      output_format: z.enum(["text", "json"]).default("text")
    },
    async ({query, files, max_chars, max_lines, rerank, output_format}) => { ... }
  )
  ```
- [ ] Handler logic:
  - Validate: `files` required (or derive from last search — TBD if session needed)
  - Call `packContext({query, files, max_chars, max_lines, rerank})`
  - Serialize via `contract.mjs#serializePackResult(packResult, output_format)`
- [ ] Text format: group by role, markdown headers, budget report
- [ ] JSON format: ADR-8 extension `{schema_version, snippets: [{role, path, ranges, content}], dropped, meta}`

### T4. Extend `contract.mjs` với pack serialization

- [ ] Export `serializePackResult(packResult, opts, format)`:
  - `format === "text"` → role-grouped markdown với headers
  - `format === "json"` → ADR-8 contract extension
- [ ] Text format template:
  ```
  # Context Pack (budget: N/M chars used)
  
  ## Implementation
  ### path/to/file.js (L1-20)
  ```code
  [snippet content]
  ```
  
  ## Caller
  [repeat pattern...]
  
  [N snippets omitted due to budget limit]
  ```
- [ ] JSON schema extension (ADR-8 compatible):
  ```js
  {
    schema_version: "1.0",
    pack: {
      snippets: [{role, path, full_path, ranges, content}],
      dropped: [{role, count, reason}],
      meta: {budget_chars, used_chars, used_pct}
    },
    meta: {retrieval: "lexical", index_used: false, pack_mode: true}
  }
  ```

### T5. Unit tests `test/pack.test.mjs` + `test/roles.test.mjs`

- [ ] `roles.test.mjs`:
  - Each heuristic case với test fixture (AC6 requirement)
  - `test` pattern: `/test/auth.test.js` → `"test"`
  - `config` pattern: `/config/database.js`, `package.json` → `"config"`
  - `docs` pattern: `/docs/api.md`, `README.md` → `"docs"`
  - `type` pattern: `types/user.d.ts` → `"type"`
  - `implementation` high density: `matchDensity: 0.5` → `"implementation"`
  - `caller` low density: `matchDensity: 0.05` → `"caller"`
  - Default fallback: unknown pattern → `"implementation"`
- [ ] `pack.test.mjs`:
  - Budget enforcement: 3 files, budget=100 chars → only first 2 files, dropped report
  - Role grouping: mixed files → grouped by implementation/caller/test order
  - Rerank integration: calls `rankResults` with correct opts
  - Empty input: `files: []` → empty pack with meta
  - JSON vs text output: same input → different serialization formats
- [ ] Pattern: `node:test`, pure function tests, no I/O except test fixtures

### T6. Verify

- [ ] `node --check deepgrep/src/roles.mjs && node --check deepgrep/src/pack.mjs && node --check deepgrep/src/contract.mjs && node --check deepgrep/src/server.mjs`
- [ ] `node --test 'test/**/*.test.mjs'` — all pass including new pack + roles tests
- [ ] Manual: call `deepgrep_pack` với files/ranges → verify role grouping, budget enforcement
- [ ] Manual: test both `output_format=text` and `output_format=json`

## Dev Notes

### Architecture Compliance (ADR-9)

**BINDING CONSTRAINT 1: New tool, not hidden mode**
- `deepgrep_pack` is the 5th MCP tool registered in `server.mjs`
- MUST reuse `readSnippets(files)` from `snippets.mjs` (Story 3.1)
- MUST reuse `formatSnippetToolOutput` pattern for text mode
- NEVER duplicate snippet file I/O — pack is an orchestrator, not a reimplementation

**BINDING CONSTRAINT 2: Budget unit = `max_chars` enforced**
- `max_chars` is the hard limit — output never exceeds this
- `max_lines` is advisory hint only (UX convenience)
- Dropped snippets MUST be reported: `[3 implementation snippets omitted to fit budget]`
- Budget accounting: accumulate `snippet.content.length` until limit

**BINDING CONSTRAINT 3: Role labeling = pure function, heuristic-bounded**
- `roles.mjs#labelRole()` is PURE: no I/O, no side effects, no external calls
- Heuristics ALLOWED: path patterns, filename analysis, match density
- Heuristics FORBIDDEN: AST parsing, tree-sitter, import resolution, symbol analysis
- Guard against heuristic creep: every case needs test fixture proving value

**BINDING CONSTRAINT 4: Stateless (kế thừa ADR-6)**
- No session linkage search→pack
- When `files/ranges` supplied directly: pure local, no API key needed
- Input schema: `{query?, files?, ranges?, max_chars, max_lines?}`

### Role Heuristic Design (Zero-Index Moat Preservation)

**Critical insight:** deepgrep's moat is zero-index — no parsing, no build step, works on any codebase instantly. Role labeling MUST preserve this advantage.

**SAFE heuristics (keep zero-index property):**
- Path patterns: `/test/`, `.test.`, `__tests__/` → `"test"`
- Filename patterns: `config.js`, `package.json` → `"config"`
- File extension: `.d.ts` → `"type"`, `.md` → `"docs"`
- Match density: if query="auth" and file has 20 "auth" matches in 50 lines → high density → `"implementation"`

**DANGEROUS heuristics (break zero-index moat):**
- AST parsing to detect function definitions
- Import/export analysis
- Symbol resolution across files
- Language server queries
- Tree-sitter syntax analysis

**Match density calculation:**
```js
function calculateMatchDensity(content, query) {
  if (!query) return 0;
  const lines = content.split('
');
  const matches = content.toLowerCase().split(query.toLowerCase()).length - 1;
  return matches / lines.length;  // matches per line
}
```

### Priority Order (Budget Allocation)

When budget runs out, keep higher-priority roles:

1. **`implementation`** — likely contains the main logic being queried
2. **`caller`** — shows how the implementation is used
3. **`config`** — configuration affecting behavior
4. **`type`** — type definitions/interfaces
5. **`docs`** — documentation and examples
6. **`test`** — test cases and specifications (lowest priority for agent context)

### Integration Points

**Story 4.3 dependency:**
- `pack.mjs` imports `rankResults` from `rank.mjs`
- Pack calls `rankResults(files, {rerank})` BEFORE role labeling
- This ensures dedup+range-merge happens before budget allocation

**Story 4.1 dependency:**
- Pack output serializes through `contract.mjs#serializePackResult`
- Text mode: role-grouped markdown format
- JSON mode: ADR-8 contract extension with pack-specific schema

**Story 3.1 dependency:**
- Pack MUST reuse `readSnippets(files)` — no file I/O duplication
- Pack MUST reuse existing snippet formatting patterns where applicable

### Expected File Structure After Implementation

```
deepgrep/src/
├── pack.mjs          [NEW] packContext() orchestrator
├── roles.mjs         [NEW] labelRole() pure heuristics  
├── contract.mjs      [UPDATE] add serializePackResult()
├── server.mjs        [UPDATE] add deepgrep_pack tool
├── rank.mjs          [EXISTS] rankResults() from Story 4.3
└── snippets.mjs      [EXISTS] readSnippets() from Story 3.1

test/
├── pack.test.mjs     [NEW] pack orchestration tests
├── roles.test.mjs    [NEW] heuristic fixture tests
└── contract.test.mjs [UPDATE] add pack serialization tests
```

### Previous Story Intelligence (từ Story 4.3)

**Patterns established:**
- Pure module pattern: export functions, no side effects, `node --check` validation
- Test pattern: `node:test`, pure function tests, no I/O/mocks needed
- Integration with `contract.mjs`: add new serialization functions, preserve existing paths
- Zod schema pattern: descriptive `.describe()` strings, sensible defaults

**Lessons learned:**
- `rankResults` integration: call it early in pipeline, pass through unchanged files format
- Contract integration: extend `contract.mjs` rather than inline JSON formatting
- Test fixtures: concrete examples beat abstract edge cases for heuristic validation

**Code patterns to follow:**
- Import: `import { rankResults } from "./rank.mjs"`
- Export: `export function labelRole(opts) { ... }`
- Schema: `z.string().optional().describe("Clear description")`
- Validation: `node --check` as gate, not afterthought

### Anti-patterns to Avoid

**❌ Reinventing snippet I/O**
- Don't reimplement file reading — call `readSnippets(files)`
- Don't duplicate range validation — trust `snippets.mjs` logic

**❌ Breaking zero-index moat**
- Don't parse syntax trees even if "just for better heuristics"
- Don't call language servers even if available
- Don't resolve imports even for "better role detection"

**❌ Violating budget constraints**
- Don't exceed `max_chars` even "just by a few characters"
- Don't ignore dropped snippets — report them explicitly

**❌ Coupling to search session**
- Don't store pack state between calls
- Don't assume files came from specific search — treat input as facts

### Latest Technical Context

**Node.js compatibility:** deepgrep targets Node 18+ (existing constraint)
- ESM modules: `import`/`export`, not CommonJS
- Built-in test runner: `node:test`, not external framework
- Standard lib: `node:fs`, `node:path` for file operations

**Zod validation:** v3.25.0 patterns established in codebase
- Schema composition: `z.object()`, `z.array()`, `z.enum()`
- Runtime validation with descriptive errors
- Default values: `.default(false)` vs `.optional()`

**MCP tool pattern:** established in existing tools
- Tool description: single string, explain use case and parameters
- Schema object: flat parameter structure, avoid nested objects
- Handler: async function, return `{content: [{type: "text", text}]}`

## Dev Agent Record

_(populated during dev-story)_
