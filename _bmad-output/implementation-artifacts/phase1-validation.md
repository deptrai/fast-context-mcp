# Phase 1: Validation MVP — Ship to learn, not to perfect

**Mục tiêu DUY NHẤT:** Trong 2 tuần, biết được "có người lạ trả tiền không?"
**Thành công = 1 user lạ trả $5+** (không phải downloads, không phải stars)
**Timeline:** 3 ngày build + 11 ngày học từ user thật

---

## Nguyên tắc chỉ đạo

1. **KHÔNG build tính năng mới.** Tool hiện tại đủ để validate.
2. **Paywall từ ngày 1.** Deep mode = paid. Phải đo willingness-to-pay.
3. **Đo mọi thứ.** Signup, activation, payment — không đo = bay mù.
4. **Manual OK.** Tuần đầu issue key bằng tay cũng được. Đừng over-engineer.

---

## Ngày 1: Tool + Tracking foundation

### Task 1.1: Fork + rebrand package
- Package: `@chainlens/code-search` (org bạn own)
- Version: `1.0.0`
- Repo mới private: `deptrai/chainlens-code-search`
- Loại bỏ file internal khỏi published: `9ROUTER_BUG_REPORT.md`, `SONNET_4.6_ISSUES.md`, `_bmad-output/`

### Task 1.2: Config + gating
- `FC_DEEP_BASE_URL` default = `https://router.chainlens.net/v1`
- Deep mode KHÔNG có key → trả message signup (không crash):
  ```
  ⚡ Deep search requires an API key.
  Get yours free: https://codesearch.chainlens.net
  Set: FC_DEEP_API_KEY=your-key
  💡 fast_context_search works free without a key.
  ```
- Fast mode (SWE-1.6) vẫn free, không cần key → tạo "aha moment" ngay

### Task 1.3: Telemetry (QUAN TRỌNG — validation cốt lõi)
Thêm tracking tối thiểu, privacy-respecting:
- **Mỗi deep query** → 9router đã log (key, timestamp, model). Đảm bảo log đủ: key_id, query_count, success/fail.
- **Tool-side ping (opt-in, anonymous):** khi user chạy lần đầu, gửi 1 event ẩn danh `{event: "install", version, os}` về 1 endpoint đơn giản. CÓ disclaimer trong README + env `FC_NO_TELEMETRY=1` để tắt.
- Mục đích: biết bao nhiêu install thật vs bao nhiêu dùng deep (conversion funnel).

---

## Ngày 2: Signup + Payment

### Task 2.1: Landing page (1 trang, đo được)
Stack nhanh nhất: Vercel + Next.js hoặc static + form. Phải có:
- Hero + demo GIF (fast search trong Kiro)
- Pricing: **Free** (fast unlimited + 10 deep/ngày) / **Pro $15/mo** (deep unlimited)
- "Get Free Key" → signup
- MCP config snippet (copy button)
- **Analytics:** Plausible/Umami (privacy-friendly) hoặc PostHog (free tier) → đo visit, click, signup

### Task 2.2: Signup flow
**MVP option A (tự động):**
```
POST /api/signup { email } → tạo key fc-free-xxx trong 9router → email key
```
**MVP option B (manual, tuần 1):**
- Tally/Typeform form → bạn nhận email → generate key thủ công → reply
- Đủ cho 20-50 user đầu. Đừng build auth system phức tạp vội.

### Task 2.3: Stripe payment
- Stripe Payment Link (KHÔNG cần code) cho Pro $15/mo
- User trả → Stripe webhook hoặc bạn manual → upgrade key `fc-free-*` → `fc-pro-*`
- Tuần 1 manual upgrade OK. Tự động hoá khi có >5 paying users.

### Task 2.4: Tier enforcement trên 9router
- `fc-free-*`: 10 deep queries/ngày (rate limit đã có)
- `fc-pro-*`: unlimited (hoặc 2000/ngày safety cap)
- Khi free hết quota → 429 → tool hiển thị: "Daily free limit reached. Upgrade: [link]"

---

## Ngày 3: Publish + Launch prep

### Task 3.1: Publish npm
```bash
npm publish --access public
npx @chainlens/code-search  # test
```

### Task 3.2: Pre-launch checklist
- [ ] Fast mode work không cần key (aha moment)
- [ ] Deep mode không key → signup message rõ ràng
- [ ] Free key: 10 deep/ngày, hết → upgrade prompt
- [ ] Pro key: unlimited
- [ ] Landing page live + analytics chạy
- [ ] Signup → nhận key (auto hoặc manual)
- [ ] Stripe link → upgrade hoạt động
- [ ] README 30s setup cho Kiro/Claude/Cursor

### Task 3.3: Launch posts (chuẩn bị sẵn)
Viết sẵn 3-4 posts, đăng rải trong tuần:
- **Reddit:** r/ChatGPTCoding, r/LocalLLaMA, r/cursor — "I built a free AI code search MCP tool"
- **X/Twitter:** dev/MCP community, tag liên quan
- **Discord:** MCP server community, Cursor, Claude dev servers
- **Hacker News:** Show HN (nếu đủ tự tin về polish)
- Tone: chia sẻ giá trị, không spam bán hàng. Free tier là hook.

---

## Tuần 2: HỌC TỪ USER THẬT (quan trọng hơn build)

### Metrics dashboard (theo dõi hàng ngày)
| Metric | Nguồn | Câu hỏi trả lời |
|--------|-------|-----------------|
| Landing visits | Analytics | Người ta có quan tâm? |
| Signup rate | Signup count / visits | Value prop có rõ? |
| Install → first deep query | Telemetry + 9router log | Onboarding có work? |
| Free → Pro conversion | Stripe | Có ai trả tiền?? ← QUAN TRỌNG NHẤT |
| Daily active (deep queries) | 9router log | Có ai dùng lại? (retention) |

### Talk to users (5-10 cuộc)
- Mỗi signup → email cá nhân hỏi: dùng IDE gì, tìm gì, có hữu ích không, sẵn sàng trả bao nhiêu
- Cuộc nói chuyện > mọi giả định. Đây là gold.

---

## Decision Gate cuối tuần 2

| Kết quả | Ý nghĩa | Hành động |
|---------|---------|-----------|
| ≥3 người lạ trả tiền | Có signal! | Tiếp tục, optimize funnel |
| Nhiều signup, 0 trả tiền | Value chưa đủ / giá sai | Điều chỉnh pricing/positioning |
| Ít signup | Marketing/positioning sai | Đổi messaging, thử kênh khác |
| Gần như 0 mọi thứ | Thị trường yếu | Cân nhắc pivot |

---

## KHÔNG làm trong Phase 1 (chống over-engineering)

- ❌ Context Engine, embedding index, dependency graph
- ❌ Full auth system (manual key issuance OK)
- ❌ Dashboard phức tạp (Stripe + 9router log đủ)
- ❌ Multi-repo, GitHub integration
- ❌ Tự động hoá mọi thứ (manual đến khi đau mới tự động hoá)

---

## Rủi ro pháp lý cần xử TRƯỚC khi nhận tiền

- [ ] Xác nhận quyền resell các model qua chainlens.net (ToS upstream — kr/cx providers)
- [ ] Windsurf SWE-1.6 free mode: nếu rủi ro ToS cao → đổi fast mode sang Haiku qua router
- [ ] Terms of Service + Privacy Policy đơn giản trên landing (telemetry disclosure)
- [ ] Cost model: đảm bảo không lỗ mỗi deep query sau khi trừ chi phí model

---

## Tổng kết

**Tuần này KHÔNG phải về code đẹp. Về 1 câu hỏi: có ai trả tiền?**
Ship nhanh, đo kỹ, nói chuyện với user, để dữ liệu quyết định side-income vs startup.
