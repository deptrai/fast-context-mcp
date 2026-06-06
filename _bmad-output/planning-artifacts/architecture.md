---
title: "Fast Context MCP — Architecture"
status: draft
created: 2026-06-06
updated: 2026-06-06
author: Winston (System Architect)
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/epics.md"
---

# Fast Context MCP — Architecture

> Triết lý: boring technology, developer productivity, trade-offs thay vì verdicts.
> Tài liệu này mô tả kiến trúc **hiện tại** (as-built) và **mục tiêu** (target, sau khi roadmap FR12–FR17 hoàn thành), nêu rõ ranh giới giữa hai trạng thái.

## 1. Tổng quan kiến trúc

Fast Context MCP là một **MCP stdio server** (Node.js ESM, không state, sống theo session) cho AI-driven semantic code search. Kiến trúc cốt lõi là một **agentic search loop**: server gửi query + repo map cho một LLM, LLM ra lệnh search, server thực thi cục bộ, lặp N vòng, trả về file + line ranges.

```
┌─────────────┐   stdio/MCP    ┌──────────────────────────────────────┐
│ MCP Client  │ ◄────────────► │           server.mjs (MCP)           │
│ (Kiro, etc) │   JSON-RPC     │  tools: fast_context_search,         │
└─────────────┘                │         deep_context_search,         │
                               │         extract_windsurf_key         │
                               └───────────────┬──────────────────────┘
                                               │ dispatch by mode
                          ┌────────────────────┴────────────────────┐
                          ▼                                          ▼
              ┌───────────────────────┐                ┌────────────────────────┐
              │  Windsurf backend     │                │  OpenAI-compat backend  │
              │  (core.mjs)           │                │  (openai-backend.mjs)   │
              │  Connect-RPC/Protobuf │                │  Chat Completions       │
              │  model: SWE-1.6       │                │  model: combo/9router   │
              └───────────┬───────────┘                └────────────┬───────────┘
                          │  agentic loop (N turns)                  │
                          └────────────────────┬─────────────────────┘
                                               ▼
                               ┌──────────────────────────────┐
                               │  ToolExecutor (executor.mjs)  │
                               │  rg / readfile / tree /        │
                               │  ls / glob — LOCAL, parallel   │
                               └──────────────────────────────┘
```

## 2. Technology Stack

| Layer | Choice | Version | Rationale |
|-------|--------|---------|-----------|
| Runtime | Node.js | >= 18 (ESM) | `node:test`, native fetch, AbortSignal.timeout sẵn có |
| MCP framework | `@modelcontextprotocol/sdk` | ^1.0.0 | Chuẩn MCP chính thức |
| Search binary | `@vscode/ripgrep` | ^1.15.9 | rg bundled, cross-platform, no system install |
| Directory tree | `tree-node-cli` | ^1.6.0 | Thay `tree` hệ thống, cross-platform |
| Local DB read | `sql.js` | ^1.14.0 | WASM, đọc `state.vscdb` không cần native compile |
| Schema validation | `zod` | ^3.25.0 | Yêu cầu của MCP SDK cho tool params |
| Wire protocol (Windsurf) | hand-written Protobuf + Connect-RPC | — | `protobuf.mjs`, không dùng lib nặng |

**Nguyên tắc:** zero system-level dependency. Mọi binary (rg, tree, sqlite) bundled qua npm → cài xong chạy ngay trên macOS/Windows/Linux.

## 3. Source Structure (as-built)

| Module | LOC | Trách nhiệm | Exports |
|--------|-----|-------------|---------|
| `server.mjs` | 351 | MCP entry, đăng ký 3 tools, route fast/deep, format output | — (entry) |
| `core.mjs` | 1227 | Windsurf backend: auth/JWT, protobuf request, streaming, agentic loop, repo map, answer parse | `search`, `searchWithContent`, `extractKeyInfo` |
| `openai-backend.mjs` | 423 | OpenAI-compatible backend: chat completions loop, tool calling, response validation | `searchOpenAI`, `isOpenAIBackendConfigured` |
| `executor.mjs` | 591 | ToolExecutor: rg/readfile/tree/ls/glob cục bộ, truncate, remap path | `ToolExecutor` |
| `extract-key.mjs` | 110 | Trích API key từ Devin/Windsurf SQLite, đa nền tảng | `getDbPath`, `extractKey` |
| `protobuf.mjs` | 235 | Protobuf encoder/decoder + Connect-RPC frames | `ProtobufEncoder`, `decodeVarint`, `extractStrings`, `connectFrameEncode`, `connectFrameDecode` |

### Target structure (sau roadmap)

```
src/
├── server.mjs              # MCP entry — chỉ dispatch + format (mỏng đi)
├── shared.mjs              # [Story 1.2] prompt templates, getRepoMap, parseAnswer
├── cache.mjs               # [Story 2.1] result cache (in-memory + TTL)
├── backends/
│   ├── index.mjs           # [Story 3.3] registry/factory
│   ├── windsurf.mjs        # wrap core protobuf backend
│   └── openai.mjs          # wrap OpenAI-compatible backend
├── executor.mjs            # giữ nguyên
├── extract-key.mjs         # giữ nguyên
└── protobuf.mjs            # giữ nguyên
test/                       # [Story 3.1] node:test
```

## 4. Kiến trúc cốt lõi: Agentic Search Loop

Cả 2 backend chia sẻ cùng mô hình:

1. `getRepoMap(projectRoot, treeDepth, excludePaths)` → cây thư mục ánh xạ thành `/codebase` ảo, adaptive fallback khi > 250KB (`MAX_TREE_BYTES`).
2. Gửi `system prompt + (query + repo map)` lên model.
3. Model trả `tool_call`:
   - `restricted_exec` (rg/readfile/tree/ls/glob, ≤ `maxCommands` song song) → `ToolExecutor.execToolCallAsync`
   - `answer` (XML) → kết thúc
4. Kết quả thực thi đẩy lại model, lặp tới `maxTurns`.
5. Turn cuối ép trả answer (Windsurf: inject FINAL_FORCE_ANSWER; OpenAI: `tool_choice: {function: answer}`).
6. `_parseAnswer` → `{files:[{path, full_path, ranges}], rg_patterns, _meta}` với **path-traversal guard**.

**Khác biệt 2 backend (có chủ đích, phải giữ):**
- Windsurf dùng format text `[TOOL_CALLS]name[ARGS]{json}` parse thủ công; OpenAI dùng `tool_calls` chuẩn.
- System prompt khác nhau (Windsurf chi tiết hơn). → Story 1.2 phải tham số hoá, KHÔNG ép chung.

## 5. Backend Abstraction (target — Story 3.3)

Interface thống nhất, factory chọn backend theo config:

```
interface Backend {
  async search({ query, projectRoot, maxTurns, maxCommands,
                 maxResults, treeDepth, timeoutMs, excludePaths,
                 onProgress }) : Promise<{
    files: Array<{path, full_path, ranges}>,
    rg_patterns: string[],
    _meta: { backend, model, treeDepth, treeSizeKB, fellBack, ... },
    error?: string
  }>
}
```

- `WindsurfBackend` (free, SWE-1.6) — tự discover apiKey/jwt; là **free fallback**.
- `OpenAIBackend` (paid, combo `deep-search` qua 9router) — Sonnet 4.6 → GPT-5.5 fallback ở tầng proxy.
- Thêm provider mới = implement interface + đăng ký registry, **không sửa server.mjs**.

Đây là hiện thực hoá repositioning "multi-backend AI code search" (PRD OQ1=yes).

## 6. Resilience & Error Handling

- `FastContextError` phân loại: `TIMEOUT | PAYLOAD_TOO_LARGE | RATE_LIMITED | AUTH_ERROR | SERVER_ERROR | NETWORK_ERROR`.
- Auto-retry: streaming request retry tối đa 2 lần (trừ 4xx ≠ 429); context trimming khi payload/timeout.
- OpenAI backend: response validation (`_isValidResponse`) + retry 1 lần khi malformed (đối phó bug proxy multi-turn — xem `9ROUTER_BUG_REPORT.md`).
- Turn compensation: vòng không có lệnh hợp lệ không tính (tối đa 2 lần, chống vòng lặp vô hạn).
- Combo `deep-search` fallback ở tầng 9router (Sonnet → GPT-5.5).

## 7. Security Architecture

| Concern | Hiện tại | Target (Story 3.2) |
|---------|----------|--------------------|
| API key | Trích từ local SQLite; không log giá trị | Giữ nguyên; reference theo tên |
| Path traversal | `_parseAnswer` reject `../` + path ngoài root | Giữ; bổ sung test (Story 3.1) |
| TLS | **Auto-disable verification khi fetch lỗi** ⚠️ MITM risk | Opt-in `FC_ALLOW_INSECURE_TLS=1` + cảnh báo stderr |
| Command injection | `execFile` với args array (không shell string) | Giữ — đã an toàn |
| Untrusted output | Output rg/file truncate, không eval | Giữ |

**Quyết định kiến trúc (ADR):** TLS auto-fallback là nợ bảo mật phải trả — mặc định verification BẬT, chỉ tắt khi user chủ động opt-in.

## 8. Performance & Caching (target — Story 2.1)

- Fast mode (SWE-1.6): p50 ~2-5s. Deep mode (combo): ~20-90s.
- Lệnh thực thi song song (`Promise.all` trong `execToolCallAsync`), output truncate (50 dòng / 250 ký tự).
- **Cache (target):** in-memory Map per-process, key = hash(query + model + params + tree snapshot + mtime aggregate), TTL cấu hình (`FC_CACHE_TTL_MS`), bypass `FC_CACHE_DISABLED`. Phù hợp MCP stdio process sống lâu — KHÔNG persistent (tránh over-engineering).

## 9. Testing Strategy (target — Story 3.1)

- Framework: `node:test` built-in (no new dep).
- Unit-testable pure logic: `protobuf.mjs` (round-trip), `_parseAnswer` (+ path guard), `extract-key` (fallback priority).
- Network layer (fetch) = ngoài scope unit; cân nhắc integration test riêng sau.
- `npm test` = `node --test`.

## 10. Configuration & Deployment

- Phân phối: npm package `@sammysnake/fast-context-mcp`, chạy qua `npx` trong MCP client config.
- Cấu hình thuần env vars: `WS_MODEL`, `FC_MAX_TURNS`, `FC_MAX_COMMANDS`, `FC_TIMEOUT_MS`, `FC_RESULT_MAX_LINES`, `FC_LINE_MAX_CHARS`, `FC_DEEP_BASE_URL/API_KEY/MODEL` (+ target: `FC_CACHE_*`, `FC_ALLOW_INSECURE_TLS`).
- Không build step (ESM thuần). Node >= 18.

## 11. Key Risks & Trade-offs

| Rủi ro | Mức | Trade-off / Giảm thiểu |
|--------|-----|------------------------|
| Phụ thuộc protocol Windsurf không công khai (hardcode `WS_APP_VER`) | Cao | Multi-backend: OpenAI-compat là đường chính bền vững, Windsurf là free fallback |
| Proxy bên thứ ba (9router) bug multi-turn | TB | Response validation + retry + combo fallback |
| Varint encoder 32-bit (field/length > 2³¹ sai) | Thấp | Thực tế không chạm; ghi nhận giới hạn |
| Không deterministic (model-dependent) | TB | Chấp nhận; combo + retry giảm variance |

## 12. Architecture Decision Records (tóm tắt)

- **ADR-1:** Agentic search loop thay vì pre-built index → luôn fresh, không stale, không setup. Đánh đổi: chậm hơn (network + inference) so với vector lookup.
- **ADR-2:** Hand-written protobuf thay vì lib → nhẹ, kiểm soát wire format Windsurf. Đánh đổi: tự maintain.
- **ADR-3:** Multi-backend với interface chung → bền vững trước thay đổi 1 provider. Đánh đổi: thêm 1 lớp abstraction.
- **ADR-4:** In-memory cache per-process (không persistent) → đơn giản, đủ cho stdio session. Đánh đổi: không share cache giữa session.
- **ADR-5:** TLS verification mặc định BẬT (opt-in mới tắt) → an toàn mặc định. Đánh đổi: user sau proxy self-signed phải set env var.
