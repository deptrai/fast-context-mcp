---
title: "deepgrep v1.2 — Research & Đề xuất tính năng"
author: "Mary (Business Analyst)"
date: 2026-06-07
status: draft
baseline: "v1.1 done (auto-escalation, cache, error UX, deepgrep_status, binary build)"
stepsCompleted: []
---

# deepgrep v1.2 — Research & Đề xuất tính năng

> Tài liệu phân tích của analyst. Mục tiêu: chọn hướng phát triển tiếp theo cho deepgrep dựa trên (1) lợi thế cốt lõi hiện có, (2) bối cảnh cạnh tranh 2026, (3) chi phí/lợi ích thực tế cho một sản phẩm bạn tự dùng trước.

---

## 1. Xuất phát điểm: deepgrep là gì sau v1.1

Sau v1.1, deepgrep đã có:

- **Hai mode** — `deepgrep_search` (quick, SWE-1.6 free) và `deepgrep_deep` (gpt-5.5/deep-search combo).
- **Auto-escalation** — quick tự nâng lên deep khi query đa-vế hoặc trả 0 kết quả (`escalate.mjs`).
- **Cache** — mtime-hash invalidation, không cache kết quả rỗng (giữ escalation hoạt động).
- **Error UX** — `friendlyError()` map 429/403/401 thành thông điệp actionable.
- **`deepgrep_status`** — health-check tool (key, model, Devin Desktop detection).
- **Binary** — `bun build --compile` (59MB, chạy không cần Node).
- **Concurrent-safe** — config truyền qua opts, không mutate `process.env`.

**Lợi thế cốt lõi (moat) cần bảo vệ:**
1. **Zero-index** — không cần build/embedding index, chạy ngay trên repo bất kỳ. Đây là điểm khác biệt lớn nhất so với Augment Context Engine, codesearch (cần index).
2. **Reasoning, không chỉ match** — AI suy luận multi-hop, tìm theo intent.
3. **BYOM** — chạy được mọi backend OpenAI-compatible (9router, Anthropic proxy, Ollama).

---

## 2. Bối cảnh cạnh tranh (2026)

| Sản phẩm | Cơ chế | Điểm mạnh | Điểm yếu so với deepgrep |
|----------|--------|-----------|--------------------------|
| Augment Context Engine | Embedding index, real-time | Recall cao, context lớn | Cần index, setup nặng, không zero-config |
| codesearch / CodeGrok | Index + semantic | Nhanh khi đã index | Mất bước index, ràng buộc hạ tầng |
| GitHub MCP | API GitHub | Tích hợp GitHub sâu | Chỉ repo trên GitHub, không local |
| grep / ripgrep | Text/regex | Cực nhanh, free | Không hiểu intent, không multi-hop |
| ai-grep | LLM + grep | Hiểu intent cơ bản | Một-shot, không reasoning loop, không cache |

**Nhận định (red flag):** Code search MCP đang **commodity hóa** — nhiều tool mới ra, ai cũng "AI + grep". Để không bị nhạt nhòa, deepgrep cần khuếch đại 2 thứ mà tool index-based **không làm được rẻ**: (a) zero-config trên repo lạ, (b) tiết kiệm token cho agent.

---

## 3. Insight then chốt: "token budget" là chiến trường thật của MCP

Khi deepgrep chạy trong một MCP client (Claude/Cursor/Kiro), người dùng thực sự **không phải con người mà là một AI agent khác**. Agent đó có context window hữu hạn và bị tính tiền theo token. Pain point lớn nhất của agent không phải "tìm có đúng file không" (deepgrep đã làm tốt) mà là:

> Sau khi deepgrep trả về 10 file + line ranges, agent phải **đọc lại toàn bộ file** để lấy code → đốt token gấp nhiều lần.

Đây chính là khe hở để deepgrep tạo khác biệt rõ rệt mà **không phá moat zero-index**.

---

## 4. Bốn đề xuất tính năng v1.2

### F1 — Token-efficient two-stage retrieval ⭐ (ƯU TIÊN CAO NHẤT)

**Vấn đề:** deepgrep trả file + ranges, nhưng agent phải tự `read_file` lại → tốn token, mất round-trip.

**Giải pháp:** Thêm tool `deepgrep_get(file, ranges)` — trả về **chính xác** đoạn code theo range, đã có line numbers, đã cap theo budget. Tận dụng `snippets.mjs` (đã viết sẵn `readSnippets`).

Quy trình 2 bước cho agent:
1. `deepgrep_search` → danh sách file + ranges (rẻ, không kèm code).
2. `deepgrep_get` → lấy đúng đoạn code cần, không đọc thừa.

**Vì sao đây là feature số 1:**
- Tận dụng code có sẵn (`snippets.mjs`) → effort thấp, risk thấp.
- Marketing rõ ràng: **"10x token savings"** — đo được, demo được.
- Không đụng tới moat zero-index, chỉ làm dày thêm.
- Giải đúng pain point thật của persona (AI agent), không phải tính năng "cho có".

**Acceptance (nháp):**
- `deepgrep_get` nhận `file` (path) + `ranges` ([[s,e]]) hoặc nhận trực tiếp output id từ search trước.
- Tôn trọng `FC_SNIPPET_MAX_LINES` / `FC_LINE_MAX_CHARS`.
- Bỏ qua range out-of-bounds, đánh dấu binary file.
- Output có line numbers để agent trích dẫn chính xác.

**Files:** `src/snippets.mjs` (tái dùng), `src/server.mjs` (thêm tool), README.

---

### F2 — Cross-repo search (`project_paths: string[]`)

**Vấn đề:** Hiện chỉ search 1 repo. Dev thực tế hay làm việc trên monorepo tách thành nhiều repo (frontend + backend + shared lib).

**Giải pháp:** Cho phép `project_paths` là mảng; chạy song song rồi merge + rank kết quả theo relevance.

**Đánh giá:** Giá trị thật nhưng phức tạp hơn (merge/rank, tree size bùng nổ, token cost cao). **Để v1.2 sau F1, hoặc v1.3.**

---

### F3 — Warm cache command

**Vấn đề:** Lần query đầu trên repo lớn vẫn chậm.

**Giải pháp:** Lệnh `deepgrep warm` / tool hâm nóng cache các query phổ biến hoặc precompute repo map.

**Đánh giá:** Nice-to-have, effort thấp. Có thể kèm F1 nếu còn budget. Không phải động lực chính.

---

### F4 — Symbol-aware mode (KHÔNG khuyến nghị)

**Ý tưởng:** Parse AST / build symbol table để tìm theo symbol chính xác.

**Khuyến cáo: KHÔNG làm.** Lý do:
- Phá vỡ moat **zero-index** — đây là thứ khiến deepgrep khác biệt.
- Đụng trực diện với tool index-based đã trưởng thành (đánh vào sân nhà của họ).
- Effort cao, phải maintain parser đa ngôn ngữ.
- Nếu cần symbol-level, đã có `code-review-graph` / ctags — không cần deepgrep ôm.

---

## 5. Khuyến nghị của analyst

**Chốt v1.2 = F1 (token-efficient retrieval) làm trọng tâm**, kèm F3 (warm cache) nếu còn budget. Hoãn F2 sang v1.3, loại bỏ F4.

Lý do ra quyết định:
- **Khác biệt hóa đo được** giữa thị trường đang commodity hóa: "deepgrep tiết kiệm 10x token cho agent của bạn".
- **Bảo vệ moat** zero-index thay vì đánh đổi nó.
- **ROI cao**: tận dụng `snippets.mjs` có sẵn → ship nhanh, ít rủi ro.
- **Đúng persona**: tối ưu cho AI-agent-as-user, không phải tính năng phô trương.

### Đề xuất scope v1.2

| Ưu tiên | Feature | Effort | Trạng thái |
|---------|---------|--------|------------|
| P0 | F1 — `deepgrep_get` two-stage retrieval | Thấp | Đề xuất làm |
| P1 | F3 — Warm cache | Thấp | Optional |
| P2 | F2 — Cross-repo | Trung-Cao | Hoãn v1.3 |
| — | F4 — Symbol-aware | Cao | Loại bỏ |

---

## 6. Next steps

1. Nếu chốt hướng F1 → chuyển sang PM (`bmad-create-prd`) viết PRD v1.2 hoặc đi thẳng spec/story cho `deepgrep_get`.
2. Thiết kế chi tiết API `deepgrep_get` (input shape: file+ranges vs reference-id từ search trước).
3. Cập nhật README với positioning "token-efficient" + so sánh token tiết kiệm.

> Phần benchmark token-saving cụ thể sẽ đo sau khi prototype F1 — dùng cùng repo 9router để đối chứng "đọc full file" vs "deepgrep_get range".
