# Epic 5 Gate — Large Repo Benchmark Agent Prompt

## Bối cảnh (đọc trước khi bắt đầu)

deepgrep là zero-index MCP code search tool. Trước khi implement Epic 5 (optional indexed tier),
cần mở "gate" bằng cách chứng minh ≥2 trong 4 điều kiện sau:

1. Zero-index quá chậm / recall kém trên **large repos** (measured)
2. Nhu cầu multi-repo hoặc persistent memory — **ĐÃ CONFIRMED bởi user**
3. Agent flows cần cross-session context — **ĐÃ CONFIRMED (trong 1 repo)**
4. Repo size vượt threshold on-demand embedding

Gate hiện tại: **2/4 confirmed** (Condition 2 + 3).
**Chỉ cần thêm 1 condition nữa → gate mở.**

Benchmark này kiểm tra Condition 1 và 4 trên large repos thực tế.

---

## Mục tiêu benchmark

Chạy `deepgrep_search` eval trên ít nhất **2 large repos** (10k+ files hoặc 50k+ LOC):

**Metrics cần đo:**
- `recall@3` — có ≥70% queries trả file đúng trong top-3 không?
- `latency_p50` — median query time (target: <10s)
- `latency_p95` — 95th percentile (nếu >30s → performance issue)
- `file_count` — tổng số files trong repo (để đánh giá Condition 4)
- `tree_depth_needed` — tree_depth=3 có đủ không hay phải tăng lên?

**Gate verdict:**
- Nếu recall@3 < 70% trên large repo → **Condition 1 MET**
- Nếu latency_p50 > 10s trên large repo → **Condition 1 MET**  
- Nếu file_count > 20k files → **Condition 4 MET**

---

## Repos để benchmark

Chọn **ít nhất 2** trong số này (ưu tiên theo thứ tự):

### Option A — NestJS (recommended, medium-large)
```bash
git clone https://github.com/nestjs/nest /tmp/bench-nestjs --depth=1
```
- ~2,000 files TypeScript
- Framework patterns phức tạp: modules, controllers, services, decorators
- Query ground truth dễ design

### Option B — Strapi (large full-stack)
```bash
git clone https://github.com/strapi/strapi /tmp/bench-strapi --depth=1
```
- ~5,000+ files TypeScript/JavaScript
- Multi-package monorepo

### Option C — Cal.com (large Next.js app)
```bash
git clone https://github.com/calcom/cal.com /tmp/bench-calcom --depth=1
```
- ~10,000+ files TypeScript/React
- Real-world enterprise complexity

### Option D — VSCode (very large, optional)
```bash
git clone https://github.com/microsoft/vscode /tmp/bench-vscode --depth=1
```
- ~80,000+ files — chỉ dùng nếu muốn test extreme scale

---

## Setup

### 1. Đảm bảo deepgrep server chạy được
```bash
node --check /Users/luisphan/Documents/fast-context-mcp/deepgrep/src/server.mjs
```

### 2. Load API key
```bash
# Hoặc set trực tiếp:
export DEEPGREP_API_KEY="your-key-here"
# Hoặc dùng key từ Claude Desktop config (eval.mjs tự load)
```

### 3. Đo file count của repo
```bash
find /tmp/bench-nestjs -type f -name "*.ts" -o -name "*.js" | wc -l
find /tmp/bench-nestjs -type f | wc -l
```

---

## Cách chạy eval trên large repo

Eval harness hiện tại (`bench/eval.mjs`) hardcode `PROJECT_PATH` = deepgrep repo.
Cần adapt để chạy trên large repo. Có 2 cách:

### Cách 1 — Modify eval.mjs tạm thời (recommended)
```bash
PROJECT_PATH=/tmp/bench-nestjs node bench/eval.mjs
```
Nhưng queries hiện tại specific cho deepgrep codebase — cần viết query set mới.

### Cách 2 — Viết eval script mới `bench/eval-large.mjs`

Viết `bench/eval-large.mjs` với query set generic cho bất kỳ TypeScript repo nào.

---

## Query Set cho Large Repos

Đây là query set generic — hoạt động trên bất kỳ large TypeScript/JS repo nào:

```js
// Dùng cho NestJS
const QUERIES_NESTJS = [
  { q: "dependency injection module provider registration",     e: ["module", "provider"] },
  { q: "HTTP request handler controller decorator route",       e: ["controller"] },
  { q: "middleware guard interceptor pipeline request",         e: ["guard", "middleware"] },
  { q: "database entity schema model repository",               e: ["entity", "schema"] },
  { q: "authentication JWT token validation strategy",          e: ["auth", "jwt", "strategy"] },
  { q: "error handling exception filter HTTP status",           e: ["filter", "exception"] },
  { q: "configuration env variables service inject",            e: ["config"] },
  { q: "unit test spec describe it mock jest",                  e: [".spec", ".test"] },
  { q: "interceptor transform response serialization",          e: ["interceptor", "serializ"] },
  { q: "pipe validation transform DTO class-validator",         e: ["pipe", "dto", "valid"] },
];

// Dùng cho bất kỳ JS/TS repo
const QUERIES_GENERIC = [
  { q: "authentication login user password token",              e: ["auth"] },
  { q: "database connection query ORM repository",              e: ["db", "database", "repository"] },
  { q: "HTTP request handler middleware route",                 e: ["router", "handler", "middleware"] },
  { q: "error handling exception catch throw",                  e: ["error", "exception"] },
  { q: "configuration environment variables setup",             e: ["config", "env"] },
  { q: "test unit describe it mock assertion",                  e: [".test", ".spec"] },
  { q: "cache invalidation TTL expiry store",                   e: ["cache"] },
  { q: "logging logger debug info warn error",                  e: ["log", "logger"] },
  { q: "validation schema input sanitize",                      e: ["valid", "schema"] },
  { q: "event emitter listener subscribe publish",              e: ["event", "emitter"] },
];
```

---

## Tasks cho Agent

### Task 1: Clone repos + đo file count

```bash
# Clone 2 repos
git clone https://github.com/nestjs/nest /tmp/bench-nestjs --depth=1
git clone https://github.com/strapi/strapi /tmp/bench-strapi --depth=1

# Đo file count
echo "NestJS files:"
find /tmp/bench-nestjs -type f \( -name "*.ts" -o -name "*.js" \) | grep -v node_modules | wc -l
find /tmp/bench-nestjs -type f | grep -v node_modules | wc -l

echo "Strapi files:"
find /tmp/bench-strapi -type f \( -name "*.ts" -o -name "*.js" \) | grep -v node_modules | wc -l
find /tmp/bench-strapi -type f | grep -v node_modules | wc -l
```

### Task 2: Chạy deepgrep_search trên each repo + đo timing

Dùng MCP client pattern từ `bench/eval.mjs` (McpClient class), chạy 10 queries với:
- `project_path` = path của repo đang test
- `tree_depth = 3` (default)
- `max_results = 10`
- Timeout 60s per query

Ghi lại:
- `durationMs` per query
- Files trả về (để tính recall)
- Errors nếu có

### Task 3: Tính metrics

Cho mỗi repo:
```
recall@3 = queries có expected file trong top-3 / total queries
latency_p50 = median(durationMs)
latency_p95 = 95th percentile(durationMs)  
```

**Nếu tree_depth=3 trả 0 results cho nhiều queries → thử tree_depth=4 và ghi lại.**

### Task 4: Save results

Save vào `bench/results/epic5-gate-REPO-DATE.json`:
```json
{
  "repo": "nestjs",
  "repo_path": "/tmp/bench-nestjs",
  "file_count_ts": 2134,
  "file_count_total": 3200,
  "tree_depth_used": 3,
  "metrics": {
    "recall_at_3": 0.7,
    "latency_p50_ms": 4200,
    "latency_p95_ms": 8900,
    "n": 10
  },
  "gate_verdict": {
    "condition_1_met": false,
    "condition_4_met": false,
    "reason": "recall@3=70% passes threshold; latency p50=4.2s OK"
  },
  "results": [...]
}
```

### Task 5: Gate verdict

**Sau khi chạy xong cả 2 repos, report:**

```
═══════════════════════════════════════
  Epic 5 Gate — Large Repo Benchmark
═══════════════════════════════════════

Condition 2 (multi-repo need):    ✅ CONFIRMED (by user)
Condition 3 (cross-session):      ✅ CONFIRMED (by user, within 1 repo)

--- Large Repo Results ---
NestJS  (N files):  recall@3=X%  p50=Xs  → Condition 1: ✅/❌
Strapi  (N files):  recall@3=X%  p50=Xs  → Condition 1: ✅/❌
File count >20k:                          → Condition 4: ✅/❌

--- Verdict ---
Total conditions met: X/4
Gate status: OPEN ✅ / CLOSED ❌

Next step if OPEN: Run bmad-correct-course to update PRD gate status,
then bmad-create-story for Story 5.1
```

---

## Điều kiện mở gate

| Condition | Met khi nào |
|-----------|------------|
| 1 | recall@3 < 70% HOẶC latency_p50 > 10s trên large repo |
| 4 | file_count_total > 20,000 files trong 1 repo |

**Hiện tại Condition 2 + 3 đã confirmed. Chỉ cần 1 trong 2 remaining để mở gate.**

---

## Notes cho Agent

- Nếu deepgrep_search bị `resource_exhausted` error (API rate limit) → retry sau 60s hoặc
  dùng `auto_escalate=false` để chỉ dùng Windsurf backend (không cần DEEPGREP_API_KEY)
- Nếu tree_depth=3 quá chậm (>30s) trên very large repo → đó là evidence cho Condition 1
- Đừng test trên VSCode trừ khi muốn test extreme scale — quá lớn sẽ timeout
- Kết quả save vào `bench/results/` và commit vào repo

---

## Repo: /Users/luisphan/Documents/fast-context-mcp
## Server: /Users/luisphan/Documents/fast-context-mcp/deepgrep/src/server.mjs
## Eval harness pattern: bench/eval.mjs (McpClient class + parseFiles + hits functions)
