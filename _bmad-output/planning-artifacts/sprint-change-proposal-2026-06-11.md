---
title: "Sprint Change Proposal — Roadmap Correction Post Epic 4"
date: 2026-06-11
trigger: "Epic 4 complete; cross-repo zero-index unimplemented; Epic 5 gate analysis reveals better zero-index path"
scope: Moderate
status: draft
---

# Sprint Change Proposal — Roadmap Correction Post Epic 4

## Section 1: Issue Summary

### Problem Statement

deepgrep v1.3 (Epic 4 — Portable Context Engine) đã hoàn thành toàn bộ. Không còn backlog story nào.
Roadmap hiện tại dự kiến tiếp theo là Epic 5 (indexed tier, gated), nhưng 3 vấn đề cần giải quyết:

**Vấn đề 1: Cross-repo search (F2) bị bỏ sót ở v1.2/v1.3**
- Research doc v1.2 (Mary, 2026-06-07) đề xuất F2: `project_paths: string[]` parallel search
- F2 được đánh giá "giá trị thật, effort trung bình, để v1.2 sau F1 hoặc v1.3"
- Thực tế: F1 (`deepgrep_get`) đã ship (Story 3.1), nhưng F2 chưa bao giờ vào epics/sprint
- User confirmed: "có, không những tôi mà user bình thường cũng cần" (multi-repo need là Condition 2 của Epic 5 gate)

**Vấn đề 2: Epic 5 gate đang bị nhầm về hướng đi**
- Epic 5 (indexed tier) được design để giải quyết large-repo recall/perf degradation
- Benchmark 2026-06-11: chainlens 527k lines → recall@3=91.7%, deepgrep 13k → 83.3%, 9router 157k → 77.8%
- Kết luận: zero-index scale TỐT HƠN dự kiến; indexed tier không giải quyết vấn đề đang có
- Conditions 2+3 của gate đã confirmed (multi-repo + cross-session) nhưng cả 2 có thể giải quyết zero-index

**Vấn đề 3: v1.5 roadmap chưa được define**
- Roadmap chỉ nói "v1.5: CLI parity, binary đơn, công thức tích hợp" — placeholder, chưa có epic/story
- Cross-repo zero-index F2 nên nằm ở v1.5, không phải Epic 5

### Evidence

- `_bmad-output/planning-artifacts/research-deepgrep-v1.2.md` — F2 proposal (Mary, 2026-06-07)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — tất cả v1.1/1.2/1.3 = done
- `bench/results/epic5-gate-benchmark-prompt.md` + eval results — benchmark data
- User confirmation (2026-06-11): Condition 2 (multi-repo) + Condition 3 (cross-session within 1 repo)
- Perplexity research (2026-06-11): cross-repo MCP tools là trend đang nổi

---

## Section 2: Impact Analysis

### Checklist Results

**1.1 — Trigger Story:** N/A — không phải bug trong story cụ thể; đây là strategic pivot sau Epic 4 complete  
**1.2 — Issue Type:** Strategic pivot + roadmap gap (F2 bị bỏ sót)  
**1.3 — Evidence:** Benchmark data + user confirmation + research doc

**2.1 — Current epic:** Epic 4 DONE — không impact  
**2.2 — Epic changes needed:**  
- Epic 5: Re-scope; tách "cross-repo zero-index" ra khỏi Epic 5 → Epic 6 (hoặc v1.5 Epic)
- Epic 5: Giữ gated nhưng re-define scope = ONLY indexed tier (không phải cross-repo)  
**2.3 — Future epics:** v1.5 cần định nghĩa; v2.0 (Epic 5) cần re-evaluate  
**2.4 — New epic needed:** Có — Epic 6 (v1.5): Cross-repo zero-index + distribution  
**2.5 — Priority change:** v1.5 (cross-repo) trước v2.0 (indexed tier)

**3.1 — PRD conflicts:**
- FR12 (gated): hiện gắn với indexed tier; cần tách FR12a (cross-repo zero-index) và FR12b (indexed tier)
- M5: "Agent integration recipes adopted by ≥ 3 distinct MCP clients" → v1.5 scope
- v1.5 roadmap section chưa có FR/story

**3.2 — Architecture conflicts:**
- ADR-9 không conflict — pack.mjs đã design stateless, `files[]` param clean
- Không cần ADR mới cho cross-repo zero-index (chỉ parallel search, không state)
- ADR-10 (indexed tier lifecycle) vẫn còn đúng cho Epic 5 khi gate mở sau

**3.3 — UX/UI:** N/A — MCP tool, không có UI  
**3.4 — Other artifacts:** sprint-status.yaml cần thêm Epic 6 entries

**4.1 — Option 1: Direct Adjustment** ✅ VIABLE
- Thêm Epic 6 (v1.5) vào epics.md với cross-repo zero-index stories
- Update PRD: thêm FR13 (cross-repo zero-index), tách FR12
- Update sprint-status.yaml: thêm Epic 6 entries
- Effort: Low-Medium | Risk: Low

**4.2 — Option 2: Rollback** ❌ NOT VIABLE  
- Không có gì cần rollback; Epic 4 hoàn toàn đúng

**4.3 — Option 3: PRD MVP Review** ❌ NOT VIABLE  
- MVP đã achieved; đây là expansion, không phải reduction

**4.4 — Selected approach: Option 1 (Direct Adjustment)**  
Rationale: Không có code cần thay đổi; chỉ cần update roadmap artifacts. Low risk, high value.

---

## Section 3: Recommended Approach

**Hybrid: Direct Adjustment + Roadmap Expansion**

1. **Tách Epic 5** — giữ gated, re-define scope = indexed tier only (không phải cross-repo)
2. **Thêm Epic 6 (v1.5)** — cross-repo zero-index + distribution (CLI binary, integration recipes)
3. **Update PRD** — thêm FR13 (cross-repo zero-index), update roadmap table
4. **Update sprint-status.yaml** — thêm Epic 6 stories dưới dạng backlog
5. **Keep Epic 5 gated** — 2/4 conditions confirmed; nhưng cross-repo có thể done zero-index trước

**Không cần:**
- Rollback bất kỳ code nào
- Thay đổi architecture
- Thay đổi Epic 5 gate conditions (vẫn ≥2/4)

---

## Section 4: Detailed Change Proposals

### CP1: Update `epics.md` — Thêm Epic 6 (v1.5)

**THÊM sau Epic 5, trước Tóm tắt Roadmap:**

```markdown
## Epic 6: Phân phối & Cross-repo (v1.5)

> Mở rộng deepgrep từ "single-repo context engine" → "multi-repo context engine".
> Zero-index, không cần build step, không cần indexing.

**Stories:**

### Story 6.1: Cross-repo search (`project_paths`)

Với tư cách lập trình viên làm việc trên nhiều repo liên quan,
tôi muốn search song song trên nhiều project paths,
để agent có context từ cả monorepo lẫn các micro-repo liên quan.

**Tiêu chí Chấp nhận:**
- **Cho** `project_paths: string[]` được truyền vào `deepgrep_search` / `deepgrep_deep`,
  **Thì** search chạy parallel trên tất cả paths, kết quả merge + dedup theo `full_path`
- **Cho** `project_path` (singular) vẫn được truyền, **Thì** hành vi cũ được giữ nguyên (backward compat)
- **Cho** một path fail (không tồn tại / timeout), **Thì** path đó được bỏ qua với warning; các path khác vẫn chạy
- **Cho** kết quả merge, **Thì** `full_path` là absolute path và duy nhất; no duplicates
- **Cho** JSON output contract, **Thì** `meta.project_paths` liệt kê tất cả paths đã search
- **Không cần** API key bổ sung; dùng cùng backends đang có

**Ghi chú kỹ thuật:**
- Implement `Promise.all()` parallel search trên N paths
- Tái dụng `rankResults` từ `rank.mjs` để dedup + merge kết quả tổng hợp
- Không cần index, không cần state — pure zero-index
- Tree size có thể bùng nổ khi search nhiều large repos → cần `max_results_per_path` optional param

### Story 6.2: Distribution (CLI binary + integration recipes)

Với tư cách developer muốn dùng deepgrep không cần npx,
tôi muốn binary đơn standalone cho macOS/Linux/Windows,
để setup là `./deepgrep` thay vì `npx deepgrep`.

**Tiêu chí Chấp nhận:**
- **Cho** `npm run build:binary`, **Thì** tạo ra binary standalone chạy được không cần Node.js
- **Cho** binary, **Thì** ripgrep và dependencies được bundle đúng cách
- **Cho** README, **Thì** có integration recipes cho Claude Code, Cursor, Kiro, Continue.dev
- **Ghi chú:** Đây là re-attempt của Story 2.2 (đã defer do Bun compile issues với @vscode/ripgrep)

---
```

### CP2: Update `epics.md` — Update Roadmap Table

**OLD:**
```
| v1.5 | Phân phối: CLI parity, binary đơn, công thức tích hợp | 🔲 Tương lai |
| v2.0 | Tầng Đánh Chỉ mục Tùy chọn (Epic 5) | 🔒 Có cổng / khát vọng |
```

**NEW:**
```
| v1.5 | Cross-repo zero-index + Phân phối (Epic 6) | 🔲 Backlog |
| v2.0 | Tầng Đánh Chỉ mục Tùy chọn (Epic 5) | 🔒 Có cổng (2/4 điều kiện đã xác nhận) |
```

---

### CP3: Update `prd.md` — Thêm FR13 + Update roadmap section

**THÊM sau FR12:**
```markdown
### 🔲 FR13 — Cross-repo search (`project_paths`, v1.5)
- THE system SHALL chấp nhận `project_paths: string[]` thay cho `project_path: string`
- WHEN nhiều paths được truyền vào, THE system SHALL search parallel trên tất cả paths
- THE merged results SHALL được dedup theo `full_path` (absolute path duy nhất)
- WHEN một path fail, THE system SHALL tiếp tục với các paths còn lại + log warning
- THE output contract SHALL thêm `meta.project_paths[]` liệt kê paths đã search
- THE existing `project_path` (singular) SHALL vẫn hoạt động (backward compat)
- **Zero-index:** Không cần build step, không cần API key bổ sung
```

**UPDATE roadmap table trong §9:**
```
| v1.5 | Cross-repo zero-index + distribution (Epic 6) | 🔲 Backlog |
```

---

### CP4: Update `architecture.md` — Thêm note về cross-repo

**THÊM vào Section 7 (Story → Module map):**
```
| 6.1 Cross-repo search | server.mjs (update deepgrep_search + deepgrep_deep schema), rank.mjs (reuse dedup) |
| 6.2 Distribution | package.json, build scripts |
```

**THÊM ADR placeholder:**
```markdown
### ADR-11 (v1.5): Cross-repo parallel search — no state, reuse rankResults

**Decision:** `project_paths` triggers `Promise.all()` parallel search; results merged via `rankResults`
dedup logic. No index, no session state. Single `project_path` remains unchanged (backward compat).
Tree size risk: each path generates independent repo map; N paths × tree_size can exceed context.
Mitigation: `max_results_per_path` param (optional, default=10) caps per-repo results.
```

---

### CP5: Update `sprint-status.yaml` — Thêm Epic 6 entries

**THÊM sau Epic 5 entries:**
```yaml
  # ── v1.5 (backlog) — Cross-repo + Distribution ───────────
  # Epic 6: Multi-repo zero-index context engine
  # Không cần indexing — parallel search trên N project_paths
  6-cross-repo-search: backlog          # Story 6.1: project_paths[] parallel search
  6-distribution: backlog               # Story 6.2: binary build + integration recipes
```

**UPDATE last_updated:**
```yaml
last_updated: 2026-06-11 (Sprint Change Proposal — Roadmap Correction Post Epic 4)
```

---

### CP6: Update Epic 5 description trong `epics.md`

**UPDATE Epic 5 intro để clarify scope (cross-repo là Epic 6 now):**

OLD: "Story 5.2 (có cổng kiểm soát): Ngữ cảnh đa repo (có thể)"

NEW STATUS NOTE thêm vào đầu Epic 5:
```
> **Note (2026-06-11):** Cross-repo zero-index (project_paths parallel search) đã được tách
> ra thành Epic 6 (v1.5) — không cần indexing. Epic 5 tập trung hoàn toàn vào local
> indexed tier cho repos quá lớn để zero-index. Gate conditions 2+3 confirmed;
> tuy nhiên Condition 2 (multi-repo) sẽ được giải quyết ở Epic 6 trước.
```

---

## Section 5: Implementation Handoff

**Change Scope: MODERATE** — cần update nhiều planning artifacts nhưng không có code changes.

**Handoff Plan:**

| Task | Owner | Effort |
|------|-------|--------|
| Update `epics.md` — thêm Epic 6, update roadmap table, Epic 5 note | Developer agent | Low |
| Update `prd.md` — thêm FR13, update roadmap | Developer agent | Low |
| Update `architecture.md` — thêm ADR-11, Story-Module map | Developer agent | Low |
| Update `sprint-status.yaml` — thêm Epic 6 entries | Developer agent | Low |
| Tạo Story 6.1 (`bmad-create-story`) | Next session | Medium |

**Success Criteria:**
- `sprint-status.yaml` có entries `6-cross-repo-search: backlog` và `6-distribution: backlog`
- `epics.md` có Epic 6 với Story 6.1 + 6.2
- `prd.md` có FR13 (cross-repo zero-index)
- `architecture.md` có ADR-11
- Epic 5 vẫn gated nhưng note rõ cross-repo được tách ra Epic 6

**Không làm:**
- Không thay đổi bất kỳ code nào trong `deepgrep/`
- Không thay đổi tests
- Không mở Epic 5 gate (vẫn giữ gated)
- Không xóa Epic 5 (indexed tier vẫn là North Star cho large repos)

---

## Workflow Completion Checklist

- [x] 1.1 Trigger identified: Strategic pivot post Epic 4 complete
- [x] 1.2 Issue type: Roadmap gap (F2 bị bỏ sót) + Epic 5 scope clarification
- [x] 1.3 Evidence: benchmark data, user confirmation, research doc
- [x] 2.1-2.5 Epic impact: Epic 6 mới, Epic 5 re-scoped
- [x] 3.1-3.4 Artifact conflicts: PRD (FR13), Architecture (ADR-11), sprint-status
- [x] 4.4 Path: Option 1 Direct Adjustment
- [x] 5.1-5.2 Proposal drafted
- [N/A] 6.x UX/UI — không applicable

**Scope: MODERATE**
**Handoff: Developer agent** (apply CP1-CP6 to planning artifacts)
