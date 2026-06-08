---
title: "deepgrep v1.1/v1.2 — PRD"
status: living-document
created: 2026-06-07
updated: 2026-06-07
owner: Luisphan
inputDocuments:
  - "deepgrep/ROADMAP-v1.1.md"
  - "_bmad-output/planning-artifacts/research-deepgrep-v1.2.md"
---

# deepgrep v1.1 — Product Requirements Document

## 1. Bối cảnh

deepgrep v1.0 đã ship: MCP server semantic code search với 2 mode (fast SWE-1.6/Windsurf, deep combo qua 9router). Benchmark chứng minh **giá trị cốt lõi = deep multi-hop reasoning**.

**v1.1** (done): Khuếch đại core value, giảm friction hằng ngày, tăng độ tin cậy — auto-escalation, cache, error UX, deepgrep_status, binary build.

**v1.2** (planning): Token-efficient retrieval — đóng gap với Augment Context Engine theo cách nhẹ hơn, zero-index, không cần enterprise setup. Insight: Augment nổi bật vì assembled context, deepgrep v1.2 thêm `deepgrep_get` để agent không phải `read_file` toàn bộ.

**Positioning:** deepgrep = zero-setup semantic code search, no index, BYOM, token-efficient. Cho individual dev và team nhỏ — không cạnh tranh trực tiếp Augment enterprise ($60+/dev/tháng).

## 2. Mục tiêu v1.1

- G1. User không phải tự chọn quick vs deep (auto-routing).
- G2. Query lặp không tốn token (cache hoạt động đúng).
- G3. Lỗi rõ ràng, actionable (429/403/no-key).
- G4. Setup self-verifiable (health check).

## 3. Non-goals

- v1.1: Port Rust; embedding index; multi-repo/GitHub; thêm model provider mới; streaming progress.
- v1.2: Index-based search; symbol-aware AST parsing (phá moat zero-index); cross-repo (hoãn v1.3).

## 4. Functional Requirements

> ✅ v1.1 (done) · 🔲 v1.2 (backlog)

### ✅ FR1 — Auto-escalation quick → deep
- WHEN query có dấu hiệu multi-hop (≥3 mệnh đề / keywords "trace/flow/across/from...to") OR quick trả 0 results, THE system SHALL tự dùng deep mode (retry 1 lần).
- THE system SHALL có param `auto_escalate` (default true) để tắt.
- THE output SHALL ghi rõ mode thực tế đã dùng (vd "[escalated to deep]").

### ✅ FR2 — Cache verify & hoàn thiện
- WHEN query + project_path + model giống hệt và codebase chưa đổi, THE system SHALL trả kết quả từ cache không gọi API.
- WHEN file trong project thay đổi (mtime), THE system SHALL invalidate cache liên quan.
- THE output metadata SHALL chứa `cache_hit: true|false`.
- THE system SHALL hỗ trợ `DEEPGREP_CACHE_DISABLED` và `DEEPGREP_CACHE_TTL_MS`.

### ✅ FR3 — Better error UX
- WHEN nhận HTTP 429, THE system SHALL trả message: model bị rate limit + gợi ý đổi model/đợi.
- WHEN nhận HTTP 403, THE system SHALL gợi ý dùng combo `deep-search` hoặc model khác.
- WHEN deep model fail, THE system SHALL suggest fallback model cụ thể.

### ✅ FR4 — Health-check tool `deepgrep_status`
- THE system SHALL cung cấp tool `deepgrep_status` trả về: key hợp lệ?, models available, Devin Desktop có cài?, config hiện tại (URL/model/fast backend).

### ✅ FR5 — Query refinement (quick mode)
- WHEN query không phải tiếng Anh hoặc quá mơ hồ, THE system SHALL gợi ý rephrase bằng code terms tiếng Anh, HOẶC tự nâng lên deep (liên kết FR1).

### ✅ FR6 — Single binary build
- THE build SHALL hỗ trợ tạo standalone binary (`bun build --compile`) cho macOS/Linux/Windows.

### 🔲 FR7 — Token-efficient two-stage retrieval (`deepgrep_get`)
- THE system SHALL cung cấp tool `deepgrep_get` nhận `{file, ranges}[]` và trả code snippets với line numbers.
- THE tool SHALL KHÔNG gọi API (pure local file read).
- THE tool SHALL tôn trọng `FC_SNIPPET_MAX_LINES` / `FC_LINE_MAX_CHARS`.
- THE tool SHALL handle binary files gracefully.
- THE tool SHALL bỏ qua out-of-bounds ranges mà không crash.
- **Rationale:** Augment Context Engine assembled context là killer feature. deepgrep_get là phiên bản token-efficient: agent chọn chủ động file nào cần, không phải đọc toàn bộ. Tái dụng `snippets.mjs` đã có.

### 🔲 FR8 — Warm cache (optional)
- THE system SHALL cung cấp lệnh/tool để precompute repo map và warm cache trước khi query.
- **Priority:** P1 optional, ship kèm FR7 nếu còn budget.

## 5. NFRs

- NFR1. Cache hit trả < 100ms.
- NFR2. Auto-escalation không tăng latency cho query đơn giản (heuristic local, ~0ms).
- NFR3. Không thêm dependency nặng (giữ zero system-level dep).
- NFR4. Backward compatible — config v1.0 vẫn chạy.
- NFR5. `deepgrep_get` không gọi API, latency < 50ms cho file thông thường.

## 6. Success Metrics

- M1. Tỉ lệ query trả kết quả đúng tăng (nhờ auto-escalation cho multi-hop). ✅ v1.1
- M2. Token cost giảm (nhờ cache hit cho query lặp). ✅ v1.1
- M3. Token cost per task giảm khi dùng deepgrep_get thay read_file. 🔲 v1.2
- Counter: latency query đơn giản không tăng.

## 7. Rủi ro

- R1. Heuristic auto-escalation sai (escalate query đơn giản → tốn token). Mitigant: param tắt + conservative threshold. ✅ mitigated
- R2. Cache invalidation miss → trả stale. Mitigant: mtime hash + TTL. ✅ mitigated
- R3. deepgrep_get ranges sai (từ AI hallucinate) → trả code không đúng. Mitigant: luôn hiển thị line numbers, user/agent verify được.

## 8. Competitive Positioning (v1.2 context)

**Augment Context Engine** là điểm tham chiếu chính cho Epic 3. Key insights:
- Augment mạnh ở scale (400k+ files), temporal context (commit history), cross-repo — enterprise $60+/dev/tháng
- deepgrep KHÔNG cạnh tranh trực tiếp. deepgrep = zero-setup, zero-index, BYOM cho individual dev/team nhỏ
- Gap cần đóng: deepgrep thiếu assembled context (agent phải read_file thêm sau search)
- `deepgrep_get` (FR7) đóng gap này theo cách token-efficient: agent chủ động chọn đoạn cần đọc
- Xem đầy đủ: `_bmad-output/planning-artifacts/research-deepgrep-v1.2.md`
