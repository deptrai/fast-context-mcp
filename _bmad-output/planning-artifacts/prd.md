---
title: "Fast Context MCP — Product Requirements Document"
status: final
created: 2026-06-06
updated: 2026-06-06
owner: Luisphan
---

# Fast Context MCP — PRD

## 1. Tổng quan & Tầm nhìn

**Fast Context MCP** là một MCP server (Node.js, ESM) cung cấp khả năng **tìm kiếm code theo ngữ nghĩa bằng AI** cho mọi client tương thích MCP (Kiro, Claude Code, Claude Desktop, Cursor). Thay vì index trước, server cho một AI model "đọc" cấu trúc dự án rồi tự ra lệnh `rg`/`readfile`/`tree` thực thi cục bộ qua nhiều vòng, trả về **đường dẫn file + line ranges + grep keywords**.

**Tầm nhìn:** Trở thành công cụ semantic code search **đa backend, không cần index, không phụ thuộc một nhà cung cấp model duy nhất** — kết hợp được cả model miễn phí (tốc độ cao) lẫn model chất lượng cao (độ chính xác cao) qua một interface thống nhất.

**Vấn đề giải quyết:**
- Các công cụ code search dựa trên embedding/graph cần build index trước, dễ stale, và không "hiểu" intent phức tạp.
- Grep thuần không hiểu ngữ nghĩa.
- Fast Context cho AI suy luận như một developer thật: nhìn cây thư mục → đoán → grep → đọc → lặp.

## 2. Người dùng mục tiêu

- **Developers** dùng AI IDE muốn hỏi codebase bằng ngôn ngữ tự nhiên ("logic xác thực nằm đâu?"). `[ASSUMPTION]`
- **AI agents** (như Kiro) cần lấy context chính xác trước khi sửa code, dùng tool này như một bước gather-context. `[ASSUMPTION]`

## 3. Bối cảnh & Ràng buộc hiện tại

- **Runtime:** Node.js >= 18, ESM. Zero system-level dependency (ripgrep qua `@vscode/ripgrep`, tree qua `tree-node-cli`, SQLite qua `sql.js`).
- **Backend 1 (free):** Protocol reverse-engineered của Windsurf/Devin (`server.self-serve.windsurf.com`, Connect-RPC + Protobuf), model SWE-1.6. **Rủi ro:** protocol không công khai, hardcode version (`WS_APP_VER`), có thể hỏng khi nhà cung cấp đổi API.
- **Backend 2 (paid):** OpenAI-compatible API (9router/bất kỳ), dùng cho `deep_context_search` với combo `deep-search` (Sonnet 4.6 → GPT-5.5 fallback).
- **Auth:** Tự trích API key từ Devin Desktop / Windsurf local SQLite; hỗ trợ prefix `devin-session-*` và `sk-*`.
- **License:** MIT, open source. `[ASSUMPTION]` không monetize.

## 4. Mục tiêu (Goals) & Phi mục tiêu (Non-goals)

**Goals:**
- G1. Cung cấp semantic code search chính xác, không cần index, cross-platform (macOS/Windows/Linux).
- G2. Hỗ trợ đa backend/đa model qua interface thống nhất, cho phép đánh đổi tốc độ ↔ chất lượng.
- G3. Bền vững trước thay đổi của một nhà cung cấp model đơn lẻ.
- G4. Dễ cấu hình trong MCP client, tự discover credentials.

**Non-goals:**
- NG1. Không xây GUI riêng.
- NG2. Không thay thế các tool call-graph/blast-radius (như code-review-graph) — bổ trợ, không cạnh tranh.
- NG3. Không tự host/train model.

## 5. Yêu cầu chức năng (Functional Requirements)

### FR-Group A: Core Search
- **FR1.** Tool `fast_context_search`: nhận query ngôn ngữ tự nhiên + project_path, trả về danh sách file + line ranges + grep keywords.
- **FR2.** Tham số điều chỉnh: `tree_depth` (1-6), `max_turns` (1-5), `max_results` (1-30), `exclude_paths`.
- **FR3.** Adaptive tree-depth fallback: tự hạ độ sâu khi cây thư mục vượt 250KB.
- **FR4.** Thực thi lệnh cục bộ song song (rg/readfile/tree/ls/glob), truncate output (50 dòng / 250 ký tự).
- **FR5.** Path-traversal protection khi parse answer XML (chặn `../`, đường dẫn ngoài root).

### FR-Group B: Deep Search (multi-backend)
- **FR6.** Tool `deep_context_search`: dùng OpenAI-compatible backend với model cấu hình được (mặc định combo `deep-search`).
- **FR7.** Response validation: phát hiện response malformed (thiếu `finish_reason`, `tool_calls` args lỗi) và tự retry 1 lần.
- **FR8.** Hỗ trợ forced `tool_choice` để ép model trả answer ở turn cuối.

### FR-Group C: Credentials & Config
- **FR9.** Tool `extract_windsurf_key`: trích API key từ Devin Desktop / Windsurf local DB, đa nền tảng.
- **FR10.** Auto-discover key nếu env var không set; hỗ trợ nhiều prefix key.
- **FR11.** Cấu hình qua env vars (model, turns, commands, timeout, OpenAI backend URL/key/model).

### FR-Group D: Roadmap (cải tiến đề xuất)
- **FR12.** `[ASSUMPTION]` Đồng bộ tài liệu: README khớp code thật (sql.js không phải better-sqlite3, model mặc định, tool deep_context_search, Devin Desktop).
- **FR13.** `[ASSUMPTION]` Tách shared code (`SYSTEM_PROMPT_TEMPLATE`, `getRepoMap`, `_parseAnswer`) ra module chung giữa 2 backend.
- **FR14.** `[ASSUMPTION]` Caching kết quả theo hash(query + tree state) để tiết kiệm API call (đặc biệt deep mode).
- **FR15.** `[ASSUMPTION]` Option trả kèm code snippet (không chỉ line ranges) để giảm round-trip cho caller.
- **FR16.** `[ASSUMPTION]` Test suite: unit test cho protobuf encode/decode, answer XML parsing + path guard, key extraction fallback.
- **FR17.** `[ASSUMPTION]` Đồng bộ version giữa server.mjs và package.json; bump phù hợp.

## 6. Yêu cầu phi chức năng (NFRs)

- **NFR1. Hiệu năng:** fast mode trả kết quả < 5s điển hình; deep mode < 90s. Chạy lệnh song song.
- **NFR2. Bảo mật:** Không log giá trị API key; path-traversal guard; TLS fallback chỉ khi cần và có cảnh báo rõ ràng. `[NOTE FOR PM]` Cân nhắc bỏ auto-disable TLS verification (rủi ro MITM).
- **NFR3. Tương thích:** macOS/Windows/Linux; Node >= 18; không cần cài dependency hệ thống.
- **NFR4. Khả năng phục hồi:** Phân loại lỗi (TIMEOUT/PAYLOAD/RATE_LIMITED/AUTH); auto-retry + context trimming; combo fallback giữa models.
- **NFR5. Khả năng bảo trì:** Không trùng code giữa backend; có test; comment nhất quán một ngôn ngữ (English).
- **NFR6. Quan sát được:** Trả metadata chẩn đoán (`[config]`, `[diagnostic]`) để caller AI tự điều chỉnh tham số.

## 7. Success Metrics & Counter-metrics

- **M1.** Tỉ lệ query trả kết quả đúng (accuracy) — đo qua benchmark định kỳ. `[ASSUMPTION]`
- **M2.** Adoption: npm installs, GitHub stars. `[ASSUMPTION]`
- **Counter-metric C1.** Tỉ lệ lỗi/fail (0 results, ERR) không tăng khi thêm tính năng.
- **Counter-metric C2.** Latency p50/p95 không xấu đi sau khi thêm caching/validation.

## 8. Rủi ro & Giả định

- **R1 (cao).** Phụ thuộc protocol Windsurf không công khai → có thể hỏng bất cứ lúc nào. *Giảm thiểu:* multi-backend, giữ OpenAI-compatible làm đường chính, Windsurf là free fallback.
- **R2 (trung bình).** Proxy bên thứ ba (9router) có bug multi-turn tool calling → đã có response validation + combo fallback.
- **R3 (thấp).** ToS của Windsurf/Devin về reverse-engineering. `[NOTE FOR PM]`

## 9. Open Questions

- OQ1. Có nên định vị lại dự án thành "multi-backend AI code search" (giảm nhấn mạnh Windsurf)? `[ASSUMPTION] có`
- OQ2. Có monetize không, hay giữ thuần MIT? `[ASSUMPTION] thuần MIT`
- OQ3. Mức độ ưu tiên giữa nhóm "dọn nợ kỹ thuật" (FR12-13,17) và "tính năng mới" (FR14-15)?
