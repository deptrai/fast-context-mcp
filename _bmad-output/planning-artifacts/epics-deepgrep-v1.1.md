---
stepsCompleted: ["validate-prerequisites", "design-epics", "create-stories"]
inputDocuments:
  - "_bmad-output/planning-artifacts/prd-deepgrep-v1.1.md"
  - "deepgrep/ROADMAP-v1.1.md"
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

| FR | Story |
|----|-------|
| FR2, NFR1 | 1.1 |
| FR1, FR5, NFR2 | 1.2 |
| FR3 | 1.3 |
| FR4 | 2.1 |
| FR6 | 2.2 |

## Epic List

- **Epic 1: Core Intelligence & Reliability (P0)** — cache, auto-escalation, error UX. Tác động lớn nhất tới trải nghiệm hằng ngày.
- **Epic 2: Developer Experience (P1)** — health-check tool, single binary.

**Thứ tự:** Story 1.1 → 1.2 → 1.3 → 2.1 → 2.2

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
