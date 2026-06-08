---
stepsCompleted: ["validate-prerequisites", "design-epics", "create-stories"]
inputDocuments:
  - "_bmad-output/planning-artifacts/prd-deepgrep-v1.1.md"
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
- Xem `architecture-deepgrep-v1.1.md` ADR-6.

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
- Xem `architecture-deepgrep-v1.1.md` ADR-7.
