---
title: "deepgrep v1.1 — PRD"
status: final
created: 2026-06-07
updated: 2026-06-07
owner: Luisphan
inputDocuments:
  - "deepgrep/ROADMAP-v1.1.md"
---

# deepgrep v1.1 — Product Requirements Document

## 1. Bối cảnh

deepgrep v1.0 đã ship: MCP server semantic code search với 2 mode (fast SWE-1.6/Windsurf, deep combo qua 9router). Benchmark chứng minh **giá trị cốt lõi = deep multi-hop reasoning**. v1.1 tập trung khuếch đại core value, giảm friction khi dùng hằng ngày, tăng độ tin cậy — KHÔNG mở rộng scope (no Rust, no embedding index, no multi-repo).

## 2. Mục tiêu v1.1

- G1. User không phải tự chọn quick vs deep (auto-routing).
- G2. Query lặp không tốn token (cache hoạt động đúng).
- G3. Lỗi rõ ràng, actionable (429/403/no-key).
- G4. Setup self-verifiable (health check).

## 3. Non-goals

- Port Rust; embedding index; multi-repo/GitHub; thêm model provider mới; streaming progress (để v1.2).

## 4. Functional Requirements

### FR1 — Auto-escalation quick → deep
- WHEN query có dấu hiệu multi-hop (≥3 mệnh đề / keywords "trace/flow/across/from...to") OR quick trả 0 results, THE system SHALL tự dùng deep mode (retry 1 lần).
- THE system SHALL có param `auto_escalate` (default true) để tắt.
- THE output SHALL ghi rõ mode thực tế đã dùng (vd "[escalated to deep]").

### FR2 — Cache verify & hoàn thiện
- WHEN query + project_path + model giống hệt và codebase chưa đổi, THE system SHALL trả kết quả từ cache không gọi API.
- WHEN file trong project thay đổi (mtime), THE system SHALL invalidate cache liên quan.
- THE output metadata SHALL chứa `cache_hit: true|false`.
- THE system SHALL hỗ trợ `DEEPGREP_CACHE_DISABLED` và `DEEPGREP_CACHE_TTL_MS`.

### FR3 — Better error UX
- WHEN nhận HTTP 429, THE system SHALL trả message: model bị rate limit + gợi ý đổi model/đợi.
- WHEN nhận HTTP 403, THE system SHALL gợi ý dùng combo `deep-search` hoặc model khác.
- WHEN deep model fail, THE system SHALL suggest fallback model cụ thể.

### FR4 — Health-check tool `deepgrep_status`
- THE system SHALL cung cấp tool `deepgrep_status` trả về: key hợp lệ?, models available, Devin Desktop có cài?, config hiện tại (URL/model/fast backend).

### FR5 — Query refinement (quick mode)
- WHEN query không phải tiếng Anh hoặc quá mơ hồ, THE system SHALL gợi ý rephrase bằng code terms tiếng Anh, HOẶC tự nâng lên deep (liên kết FR1).

### FR6 — Single binary build
- THE build SHALL hỗ trợ tạo standalone binary (`bun build --compile`) cho macOS/Linux/Windows.

## 5. NFRs

- NFR1. Cache hit trả < 100ms.
- NFR2. Auto-escalation không tăng latency cho query đơn giản (heuristic local, ~0ms).
- NFR3. Không thêm dependency nặng (giữ zero system-level dep).
- NFR4. Backward compatible — config v1.0 vẫn chạy.

## 6. Success Metrics

- M1. Tỉ lệ query trả kết quả đúng tăng (nhờ auto-escalation cho multi-hop).
- M2. Token cost giảm (nhờ cache hit cho query lặp).
- Counter: latency query đơn giản không tăng.

## 7. Rủi ro

- R1. Heuristic auto-escalation sai (escalate query đơn giản → tốn token). Mitigant: param tắt + conservative threshold.
- R2. Cache invalidation miss → trả stale. Mitigant: mtime hash + TTL.
