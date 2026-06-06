---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories"]
inputDocuments: ["_bmad-output/planning-artifacts/prd.md"]
---

# fast-context-mcp - Epic Breakdown

## Overview

This document decomposes the PRD requirements for `fast-context-mcp` into implementable stories. FR1–FR11 (core search, deep search, credentials) are **already implemented** in the current codebase; the epics below focus on the **roadmap requirements (FR12–FR17)** and related NFRs that represent actual development work.

## Requirements Inventory

### Functional Requirements

FR1: Tool `fast_context_search` trả file + line ranges + grep keywords từ query ngôn ngữ tự nhiên. *(implemented)*
FR2: Tham số `tree_depth`, `max_turns`, `max_results`, `exclude_paths`. *(implemented)*
FR3: Adaptive tree-depth fallback khi cây > 250KB. *(implemented)*
FR4: Thực thi lệnh cục bộ song song + truncate output. *(implemented)*
FR5: Path-traversal protection khi parse answer XML. *(implemented)*
FR6: Tool `deep_context_search` dùng OpenAI-compatible backend, model cấu hình được. *(implemented)*
FR7: Response validation + auto-retry khi malformed. *(implemented)*
FR8: Forced `tool_choice` ép answer ở turn cuối. *(implemented)*
FR9: Tool `extract_windsurf_key` đa nền tảng (Devin Desktop + Windsurf). *(implemented)*
FR10: Auto-discover key, hỗ trợ nhiều prefix. *(implemented)*
FR11: Cấu hình qua env vars. *(implemented)*
FR12: Đồng bộ README với code thật (sql.js, model mặc định, deep_context_search, Devin Desktop). *(roadmap)*
FR13: Tách shared code (prompt template, getRepoMap, parseAnswer) ra module chung. *(roadmap)*
FR14: Caching kết quả theo hash(query + tree state). *(roadmap)*
FR15: Option trả kèm code snippet (không chỉ line ranges). *(roadmap)*
FR16: Test suite cho protobuf, answer parsing + path guard, key extraction fallback. *(roadmap)*
FR17: Đồng bộ version server.mjs ↔ package.json + bump. *(roadmap)*

### NonFunctional Requirements

NFR1: Hiệu năng — fast mode < 5s, deep mode < 90s, chạy lệnh song song.
NFR2: Bảo mật — không log key, path guard, cân nhắc bỏ auto-disable TLS verification.
NFR3: Tương thích — macOS/Windows/Linux, Node >= 18, không cần dependency hệ thống.
NFR4: Khả năng phục hồi — phân loại lỗi, auto-retry, context trimming, combo fallback.
NFR5: Bảo trì — không trùng code, có test, comment nhất quán English.
NFR6: Quan sát được — metadata chẩn đoán [config]/[diagnostic].

### Additional Requirements

- Repositioning: định vị lại thành "multi-backend AI code search", giảm nhấn mạnh Windsurf (OQ1=yes).
- License: thuần MIT, không monetize (OQ2).

### UX Design Requirements

N/A — CLI/MCP stdio server, không có UI.

### FR Coverage Map

| Requirement | Epic.Story |
|---|---|
| FR12, FR17 | 1.1 |
| FR13, NFR5 | 1.2 |
| NFR5 | 1.3 |
| FR14, NFR1 | 2.1 |
| FR15 | 2.2 |
| FR16, NFR5 | 3.1 |
| NFR2 | 3.2 |
| Repositioning, FR13 | 3.3 |

## Epic List

- **Story 1: Technical Debt Cleanup & Refactor** — README sync, extract shared module, code cleanup, version bump. Tất cả trong 1 session.
- **Story 2: Search Enhancement** — Result caching + optional code snippets. Tất cả trong 1 session.
- **Story 3: Resilience & Architecture** — Unit tests, TLS hardening, unified backend interface. Tất cả trong 1 session.

**Thứ tự implement:** Story 1 → Story 2 → Story 3 (3 phụ thuộc shared.mjs từ Story 1).

---

## Epic 1: Technical Debt Cleanup & Documentation Sync

Đưa tài liệu và cấu trúc code về đúng trạng thái thực tế sau khi thêm Devin Desktop support + deep_context_search, loại bỏ trùng lặp và nợ kỹ thuật để dev sau này không bị lạc.

### Story 1.1: Sync README and version with actual implementation

As a developer evaluating fast-context-mcp,
I want the README and version metadata to match the real code,
So that I can trust the docs and configure the tool correctly.

**Acceptance Criteria:**

**Given** README hiện ghi `better-sqlite3`
**When** tôi đọc phần Dependencies
**Then** nó phải ghi `sql.js` (đúng với package.json)
**And** bảng env vars phải có `FC_DEEP_BASE_URL`, `FC_DEEP_API_KEY`, `FC_DEEP_MODEL`
**And** mục Setup phải mô tả Devin Desktop path (không chỉ Windsurf)
**And** model mặc định ghi đúng (`MODEL_SWE_1_6_SLOW`)
**And** mục MCP Tools phải có `deep_context_search`

**Given** server.mjs ghi `version: "1.2.0"` còn package.json là `1.2.1`
**When** đồng bộ version
**Then** cả hai phải khớp và bump lên `1.3.0` (do thêm tính năng mới)

### Story 1.2: Extract shared code into a common module

As a maintainer,
I want the duplicated logic between core.mjs and openai-backend.mjs in one place,
So that prompt/parsing changes only need to be made once.

**Acceptance Criteria:**

**Given** `SYSTEM_PROMPT_TEMPLATE`, `getRepoMap`, `_parseAnswer`, `_excludePatternToRegex` bị copy ở cả 2 file
**When** tạo module `src/shared.mjs`
**Then** các hàm dùng chung được export từ `shared.mjs`
**And** `core.mjs` và `openai-backend.mjs` import từ `shared.mjs` thay vì định nghĩa lại
**And** không còn circular import
**And** chạy lại benchmark cũ cho kết quả tương đương (không regression)

### Story 1.3: Code cleanup — comments and unused imports

As a maintainer,
I want consistent English comments and no dead imports,
So that the codebase is clean and lint-friendly.

**Acceptance Criteria:**

**Given** core.mjs có comment tiếng Trung (phần compensation logic)
**When** dọn cleanup
**Then** mọi comment chuyển sang English nhất quán
**And** các import thừa (`existsSync`, `statSync`, `join` trong core.mjs) được xóa
**And** `node --check` pass cho tất cả file trong src/

---

## Epic 2: Search Quality & Performance

Tăng hiệu quả tìm kiếm và giảm chi phí/round-trip thông qua caching và trả kèm nội dung code.

### Story 2.1: Result caching by query + tree state

As an AI agent making repeated searches,
I want identical queries on an unchanged codebase to return cached results,
So that I save time and API tokens (especially in deep mode).

**Acceptance Criteria:**

**Given** một query đã chạy trên codebase chưa thay đổi
**When** chạy lại cùng query + cùng project_path
**Then** kết quả được trả từ cache, không gọi API model
**And** cache key = hash(query + model + tree snapshot)
**And** cache invalidate khi file trong project thay đổi (mtime/hash)
**And** có env var để tắt cache (`FC_CACHE_DISABLED`)
**And** cache có TTL hợp lý (mặc định cấu hình được)

### Story 2.2: Optional code snippets in output

As a caller AI,
I want the option to receive the actual code lines, not just line ranges,
So that I avoid an extra round-trip to read the files.

**Acceptance Criteria:**

**Given** tham số `include_snippets: true`
**When** search trả kết quả
**Then** mỗi file kèm nội dung các dòng trong range (đã truncate hợp lý)
**And** mặc định `include_snippets: false` (giữ behavior cũ)
**And** snippet tôn trọng giới hạn độ dài để không làm response quá lớn

---

## Epic 3: Resilience & Testing

Đảm bảo độ bền vững dài hạn: test coverage, bảo mật, và kiến trúc multi-backend thống nhất giảm phụ thuộc Windsurf.

### Story 3.1: Unit test suite

As a maintainer,
I want unit tests for the critical pure-logic modules,
So that refactors don't silently break protocol encoding or parsing.

**Acceptance Criteria:**

**Given** chưa có test nào
**When** thêm test framework (node:test built-in)
**Then** có test cho `protobuf.mjs` (encode/decode round-trip, varint, frames)
**And** có test cho answer XML parsing + path-traversal guard (`_parseAnswer`)
**And** có test cho `extract-key` multi-path fallback (Devin → Windsurf)
**And** `npm test` chạy được và pass
**And** thêm script `test` vào package.json

### Story 3.2: Security hardening — TLS verification opt-in

As a security-conscious user,
I want TLS certificate verification to stay on by default,
So that the tool is not silently vulnerable to MITM.

**Acceptance Criteria:**

**Given** code hiện auto-disable TLS verification khi fetch lỗi
**When** review lại logic `_applyTlsFallback`
**Then** TLS verification KHÔNG tự động tắt
**And** chỉ tắt khi user explicit set env var (vd `FC_ALLOW_INSECURE_TLS=1`)
**And** khi tắt, in cảnh báo rõ ràng ra stderr
**And** README ghi rõ rủi ro của tùy chọn này

### Story 3.3: Unified multi-backend interface

As a maintainer repositioning the project,
I want a single backend abstraction,
So that fast/deep modes share one code path and new providers are easy to add.

**Acceptance Criteria:**

**Given** 2 backend (Windsurf protobuf + OpenAI-compatible) hiện tách rời
**When** tạo interface chung `Backend` (search method thống nhất)
**Then** cả 2 backend implement cùng interface
**And** việc thêm provider mới chỉ cần implement interface, không sửa server.mjs
**And** README định vị lại là "multi-backend AI code search" (Windsurf là free fallback)
**And** không regression: cả fast_context_search và deep_context_search vẫn hoạt động đúng
