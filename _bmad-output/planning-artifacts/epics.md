---
stepsCompleted: ["validate-prerequisites", "design-epics", "create-stories"]
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "deepgrep/ROADMAP-v1.1.md"
  - "_bmad-output/planning-artifacts/research-deepgrep-v1.2.md"
lastUpdated: 2026-06-07
---

# deepgrep v1.1 — Epic Breakdown

## Requirements Inventory

- FR1: Auto-escalation quick → deep
- FR2: Cache verify & hoàn thiện
- FR3: Better error UX
- FR4: Health-check tool `deepgrep_status`
- FR5: Query refinement (quick mode)
- FR6: Single binary build
- NFR1-4: latency, no heavy deps, backward compat

## FR Coverage Map

| FR | Story | Status |
|----|-------|--------|
| FR2, NFR1 | 1.1 | ✅ done |
| FR1, FR5, NFR2 | 1.2 | ✅ done |
| FR3 | 1.3 | ✅ done |
| FR4 | 2.1 | ✅ done |
| FR6 | 2.2 | ✅ done |
| FR7 | 3.1 | 🔲 backlog |
| FR8 | 3.2 | 🔲 backlog |

## Epic List

- **Epic 1: Core Intelligence & Reliability (P0)** — cache, auto-escalation, error UX. ✅ **Done**
- **Epic 2: Developer Experience (P1)** — health-check tool, single binary. ✅ **Done**
- **Epic 3: Token-Efficient Retrieval (v1.2)** — deepgrep_get two-stage retrieval, warm cache. 🔲 **Backlog**

**Thứ tự v1.1:** Story 1.1 → 1.2 → 1.3 → 2.1 → 2.2 (tất cả done)  
**Thứ tự v1.2:** Story 3.1 → 3.2 (optional)

---

## Epic 1: Core Intelligence & Reliability

### Story 1.1: Verify & complete result cache

As a daily user,
I want identical queries on an unchanged codebase to return instantly from cache,
so that I save time and API tokens.

**Acceptance Criteria:**
- **Given** một query đã chạy thành công, **When** chạy lại y hệt (cùng project_path + model, codebase chưa đổi), **Then** trả từ cache, KHÔNG gọi API, < 100ms
- **Given** file trong project thay đổi (mtime), **When** chạy lại query, **Then** cache miss → gọi API
- **Given** output, **Then** metadata chứa `cache_hit: true|false`
- **Given** `DEEPGREP_CACHE_DISABLED=1`, **Then** cache bị bypass hoàn toàn
- **Given** `DEEPGREP_CACHE_TTL_MS=N`, **Then** TTL áp dụng đúng

### Story 1.2: Auto-escalation quick → deep

As a user who doesn't want to pick tools,
I want deepgrep to automatically use deep mode for complex queries,
so that I always get good results without choosing.

**Acceptance Criteria:**
- **Given** query ≥3 mệnh đề hoặc chứa keywords multi-hop (trace/flow/across/from...to), **When** gọi deepgrep_search, **Then** tự escalate sang deep mode
- **Given** quick mode trả 0 results, **When** auto_escalate=true, **Then** retry bằng deep mode (1 lần)
- **Given** query đơn giản 1 vế, **Then** chạy quick, KHÔNG escalate (không tăng latency)
- **Given** `auto_escalate=false`, **Then** không bao giờ escalate
- **Given** output sau escalation, **Then** ghi rõ "[escalated to deep mode]"
- **Given** query non-English/mơ hồ, **Then** gợi ý rephrase HOẶC escalate (FR5)

### Story 1.3: Better error UX

As a user hitting rate limits or auth errors,
I want clear actionable error messages,
so that I know how to fix the problem.

**Acceptance Criteria:**
- **Given** HTTP 429, **Then** message: "Model {X} rate limited — retrying / try DEEPGREP_MODEL=deep-search"
- **Given** HTTP 403, **Then** message gợi ý dùng combo deep-search hoặc model khác
- **Given** không có key, **Then** signup URL (giữ behavior v1.0)
- **Given** deep model fail sau retry, **Then** suggest 1 fallback model cụ thể

---

## Epic 2: Developer Experience

### Story 2.1: Health-check tool `deepgrep_status`

As a new user setting up deepgrep,
I want a status command to verify my config,
so that I can debug setup without guessing.

**Acceptance Criteria:**
- **Given** tool `deepgrep_status` được gọi, **Then** trả về: key hợp lệ? (ping test), models available (list + test 1-2), Devin Desktop installed?, config hiện tại (URL/model/fast_backend)
- **Given** key sai/thiếu, **Then** báo rõ + signup URL
- **Given** Devin không cài, **Then** note fast mode cần openai backend

### Story 2.2: Single binary build

As a user without Node,
I want a standalone binary,
so that I can run deepgrep without installing Node.

**Acceptance Criteria:**
- **Given** `bun build --compile`, **Then** tạo binary chạy được không cần Node
- **Given** CI release, **Then** build binary cho macOS/Linux/Windows
- **Given** binary, **Then** mọi tool (search/deep/status) hoạt động như npx version


---

## Epic 3: Token-Efficient Retrieval (v1.2)

> Insight từ competitive analysis (Augment Context Engine): Augment nổi bật vì **assembled context** — agent không phải tự đọc thêm file sau search. deepgrep hiện chỉ trả file + ranges, buộc agent phải `read_file` lại → tốn token. Epic này đóng gap đó với approach token-efficient hơn Augment (agent chọn chủ động file nào cần đọc).

### Story 3.1: Tool `deepgrep_get` — Two-stage code retrieval

As a developer (or AI agent) using deepgrep,
I want to fetch exact code snippets by file + line ranges without reading the whole file,
so that I save tokens and get only the code I actually need.

**Acceptance Criteria:**
- **Given** một list `{file, ranges}` (output từ deepgrep_search), **When** gọi `deepgrep_get`, **Then** trả code đúng range, có line numbers, không đọc ngoài range
- **Given** `FC_SNIPPET_MAX_LINES` set, **Then** tổng lines trả về không vượt budget đó
- **Given** file binary, **Then** trả `[binary file — snippet omitted]` không crash
- **Given** range out-of-bounds, **Then** bỏ qua gracefully, trả range hợp lệ còn lại
- **Given** mảng `files` rỗng (hoặc `ranges` rỗng), **Then** trả message rõ ràng ("No files/ranges provided") KHÔNG crash
- **Given** không cần API key, **Then** tool hoạt động pure local (không gọi API)
- **Given** output, **Then** format rõ ràng: `file_path`, `line_start`, `line_end`, code block với line numbers

**Ví dụ output mẫu (reference cho test assert):**
```
## src/auth.mjs (L10-14)
10 | export function login(user, pass) {
11 |   const hash = hashPassword(pass);
12 |   const record = db.findUser(user);
13 |   if (!record) return null;
14 |   return record.hash === hash;
```

**Notes kỹ thuật:**
- Tái dụng `src/snippets.mjs` → `readSnippets(files)` (đã implement sẵn)
- Thêm tool vào `src/server.mjs` tương tự deepgrep_status (không cần API key)
- **Input schema (ADR-6, Option A):** `files: z.array(z.object({ file: z.string(), ranges: z.array(z.tuple([z.number(), z.number()])) }))` — structured, self-documenting. Field `file` = absolute path (khớp `full_path` từ deepgrep_search).
- Stateless: không liên kết session search→get. Agent tự truyền ranges từ output search.
- Tool description nêu rõ 2-step workflow để LLM consumer biết khi nào gọi.
- Xem `architecture.md` ADR-6.

---

### Story 3.2: Warm cache (optional, DEFER)

As a user working repeatedly on the same repo,
I want to pre-warm the search cache for common queries,
so that my first real query returns instantly.

**Acceptance Criteria:**
- **Given** MCP tool `deepgrep_warm` được gọi với project_path, **Then** precompute repo map và cache metadata
- **Given** sau warm, query search đầu tiên không phải rebuild repo map từ đầu

**Notes (ADR-7):**
- Expose dưới dạng **MCP tool `deepgrep_warm`**, KHÔNG phải CLI subcommand (deepgrep là stdio MCP server, không phải CLI app).
- **DEFER** trừ khi đo được repo-map computation là bottleneck thật (hiện ~100ms cho medium repo). Ship Story 3.1 trước, đánh giá lại sau.
- Xem `architecture.md` ADR-7.

---

## Epic 4: Portable Context Engine (v1.3) — 🔲 Backlog

> Vision shift (2026-06-08): deepgrep evolves from "semantic search tool" → "zero-index context engine". Same job as Augment Context Engine, different architecture: on-demand assembly, no persistent index. See prd.md §9.

**Theme:** Assemble task-specific code context under an explicit token budget — without indexing.

**Architecture constraints:** ADR-8 (single contract module), ADR-9 (pack = thin orchestrator, 4 binding constraints), ADR-10 (forward-compat for indexed tier). See architecture.md.

**Execution order (dependency-driven):** 4.1 → 4.3 → 4.2. Contract first (4.1), then ranking/roles produce the structured fields (4.3), then pack assembles ranked+labeled input under budget (4.2). Building pack before ranking would force inline ranking that contradicts 4.3.

### Story 4.1: Stable structured output contract  [do FIRST]

As an agent builder,
I want stable JSON/metadata output from deepgrep tools,
so that I can reliably compose deepgrep with other tools and agents.

**Acceptance Criteria:**
- **Given** any search/deep/get call, **When** `output_format=json`, **Then** returns the ADR-8 schema incl. `schema_version`, `files[]`, `grep_keywords[]`, `meta{backend,mode,cache_hit,retrieval,index_used,...}`
- **Given** the forward-looking fields, **Then** `retrieval="lexical"` and `index_used=false` always (reserved for Epic 5 — non-breaking)
- **Given** existing text mode (default), **Then** unchanged (backward compat)
- **Given** all serialization, **Then** it lives in ONE module `src/contract.mjs` — no per-tool JSON branches
- **Given** JSON output, **Then** covered by tests for search + get

### Story 4.3: Result ranking + dedup  [do SECOND]

As a developer,
I want results ordered by usefulness with duplicates merged,
so that the first few files are usually enough.

**Acceptance Criteria:**
- **Given** multiple results, **Then** duplicate file paths merged; overlapping ranges in same file merged
- **Given** a query not asking for tests, **Then** source preferred over test/docs (path heuristic: `/test/`, `.test.`, `__tests__/`)
- **Given** deep-mode results (LLM already ordered), **Then** rerank only applies for multi-file results or explicit `rerank=true` — default trusts LLM order
- **Given** ranking logic, **Then** it lives in pure module `src/rank.mjs` (testable in isolation, no tool-handler coupling)

### Story 4.2: Context Pack (`deepgrep_pack`)  [do LAST]

As an AI agent,
I want a compact assembled context pack from search results,
so that I can answer or edit without reading whole files.

**Acceptance Criteria (bound by ADR-9):**
- **Given** a query (or files/ranges from prior search), **When** calling `deepgrep_pack`, **Then** returns top snippets grouped by role + ordered (via `src/rank.mjs`), within budget
- **Given** `max_chars` budget (enforced) and optional `max_lines` (hint), **Then** output never exceeds `max_chars`; dropped snippets reported explicitly
- **Given** files/ranges supplied directly, **Then** pure local — no API key required (inherits ADR-6 stateless posture)
- **Given** each snippet, **Then** role label via `src/roles.mjs` heuristic (implementation/caller/config/test/docs/type) — path + filename + match-density only, NO AST / language server
- **Given** implementation, **Then** reuses `readSnippets` + `formatSnippetToolOutput` (Story 3.1), never duplicates snippet I/O
- **Given** each role heuristic case, **Then** it ships with a test fixture (guards heuristic creep)

---

## Epic 5: Optional Indexed Tier (v2.0) — 🔒 Gated / Aspirational

> NORTH STAR, NOT BACKLOG. An Augment-style persistent context engine, but local-first and opt-in. Do NOT start until the gate passes. See prd.md §9 North Star.

**Gate (≥2 must be measurably true before opening):**
1. Zero-index measured too slow / recall-poor on large repos
2. Repeated need for multi-repo or persistent project memory
3. Agent flows need cross-session context
4. Repo size exceeds on-demand embedding practicality

**If gate never passes, this epic is never built — and that is an acceptable outcome.** The zero-index moat is the priority.

### Story 5.1 (gated): Local-first incremental index

As a user with a large repo where zero-index is too slow,
I want an opt-in local index,
so that retrieval stays fast without sending code to a cloud service.

**Acceptance Criteria (draft, refine at gate time):**
- **Given** `deepgrep index`, **Then** builds local `.deepgrep/` index incrementally (mtime-based)
- **Given** indexed mode, **Then** same output contract as zero-index (hidden backend)
- **Given** no index, **Then** zero-index mode still works as default (non-breaking)
- **Given** BYOM, **Then** embeddings use caller-provided model, no lock-in
- **Constraint:** still NO symbol graph / refactor / editing (Serena territory)

### Story 5.2 (gated): Multi-repo context (maybe)

As a developer working across related repos,
I want context assembly to span multiple local repos,
so that cross-repo tasks have relevant context.

**Status:** Placeholder. Define only if multi-repo demand is real at gate time.

## Roadmap Summary (updated 2026-06-08)

| Version | Theme | Status |
|---------|-------|--------|
| v1.1 | Core Intelligence + Developer Experience (Epics 1-2) | ✅ Done |
| v1.2 | Token-Efficient Retrieval — `deepgrep_get` (Epic 3) | ✅ 3.1 done, 3.2 wont-do |
| v1.3 | Portable Context Engine (Epic 4) | 🔲 Backlog |
| v1.5 | Distribution: CLI parity, single binary, integration recipes | 🔲 Future |
| v2.0 | Optional Indexed Tier (Epic 5) | 🔒 Gated / aspirational |

