# Chrome Web Store Submission Checklist

> Submission package cho extension "Translate Voice" — Chrome MV3 + Vietnamese dubbing for YouTube. Áp dụng cho closed beta launch wave 1 (50 user invite).

---

## 1. Pre-submission hard requirements

### 1.1 Developer account
- [ ] Đăng ký tại https://chrome.google.com/webstore/devconsole/ ($5 one-time fee, accept-only)
- [ ] Verified email khớp với owner của repo `LeTranNgoc/NHMedia`
- [ ] 2FA enabled (Chrome Web Store yêu cầu)
- [ ] Payment profile setup (cần cho future tier feature, không bắt buộc launch v1)

### 1.2 Host privacy policy
- [ ] URL HTTPS, publicly accessible, không sau auth wall
- [ ] Tùy chọn host:
  - GitHub Pages: `https://letranngoc.github.io/NHMedia/privacy` (cheapest, manual edit)
  - Netlify drop: drag-drop HTML file (1 phút)
  - Vercel: project free tier
  - Trang riêng `translate-voice.io/privacy` nếu đã có domain
- [ ] URL phải stable — Chrome reject nếu 404

### 1.3 Asset files (graphics)
| Asset | Spec | Status | Notes |
|---|---|---|---|
| Icon 16×16 PNG | 16×16, RGBA, ≤16KB | ❌ Placeholder | Cho extension tray |
| Icon 48×48 PNG | 48×48, RGBA, ≤32KB | ❌ Placeholder | Cho extension manage page |
| Icon 128×128 PNG | 128×128, RGBA, ≤128KB | ❌ Placeholder | Cho store listing |
| Promo tile small | 440×280 PNG/JPG, ≤1MB | ❌ Chưa có | Bắt buộc nếu featured |
| Promo tile large (optional) | 920×680 | ❌ | Để sau |
| Promo tile marquee (optional) | 1400×560 | ❌ | Chỉ cần khi featured |
| Screenshots | 1280×800 hoặc 640×400, PNG/JPG, 1-5 ảnh | ❌ Chưa có | Bắt buộc ≥1 |

Xem `docs/icon-design-brief.md` cho concept icon. Screenshots cần extension chạy thực tế (sau khi backend deploy).

---

## 2. Store listing copy

### 2.1 Manifest fields

**`name`:** `Translate Voice — Vietnamese voice-over for YouTube`
- Limit: 75 char (đang dùng 50)
- Tránh emoji (Chrome cho phép nhưng mobile render lỗi)

**`description` (manifest, 132 char limit):**

EN: `Real-time Vietnamese voice-over for any YouTube video. Auto-detects subtitles, dubs in natural neural voice.` (108)

VI: `Lồng tiếng Việt real-time cho mọi video YouTube. Tự động đọc phụ đề có sẵn, giọng nói neural tự nhiên.` (105)

Hiện tại trong `wxt.config.ts:6` là "Lồng tiếng Việt real-time cho YouTube" (37 char) — nên expand cho SEO.

### 2.2 Store listing (≤16000 char)

**EN version:**

```
Translate Voice puts a real-time Vietnamese voice-over on top of any YouTube video — without changing your viewing experience.

═══ HOW IT WORKS ═══
1. Install the extension, sign in with Google or magic-link email.
2. Open any YouTube video, click the Translate Voice badge.
3. Listen to the original audio dubbed in natural Vietnamese, while the original subtitle (if any) flows side-by-side.

═══ KEY FEATURES ═══
✓ Real-time pipeline — first dubbed audio frame in under 1.5s
✓ Subtitle-first mode — uses YouTube's own captions when available (zero quota cost, sub-500ms latency)
✓ 7 source languages — English, Japanese, Korean, French, German, Hindi, Chinese
✓ Neural voice quality — Google Cloud Neural2 + Azure Speech as fallback
✓ Privacy-respecting — captured audio never stored, only streamed for translation

═══ PRICING ═══
• Free tier: 15 minutes/day of dubbed audio
• Pro $5/month: unlimited dubbing, priority pipeline

═══ HOW IT'S DIFFERENT ═══
Most translation extensions only do text subtitles. Translate Voice generates actual Vietnamese SPEECH that plays alongside the original — useful for cooking videos, podcasts, lectures, anything where you want your eyes free and just want to listen.

═══ SUPPORT ═══
• Issues: github.com/LeTranNgoc/NHMedia/issues
• Privacy policy: <YOUR_HOSTED_URL>
• Email: <YOUR_SUPPORT_EMAIL>

═══ BETA ═══
This is a closed beta release. Wave 1 = 50 invited users. Expect occasional rough edges — we're shipping improvements weekly.
```

**VI version (cho store listing Vietnamese region):**

```
Translate Voice phủ giọng nói tiếng Việt real-time lên bất kỳ video YouTube nào — không thay đổi trải nghiệm xem.

═══ CÁCH HOẠT ĐỘNG ═══
1. Cài extension, đăng nhập bằng Google hoặc magic-link email.
2. Mở video YouTube bất kỳ, click badge Translate Voice.
3. Nghe audio gốc được lồng tiếng Việt tự nhiên, phụ đề gốc (nếu có) chạy song song.

═══ TÍNH NĂNG CHÍNH ═══
✓ Pipeline real-time — frame audio Việt đầu tiên trong dưới 1.5s
✓ Subtitle-first — đọc thẳng phụ đề YouTube có sẵn (không tốn quota, độ trễ dưới 500ms)
✓ 7 ngôn ngữ nguồn — Anh, Nhật, Hàn, Pháp, Đức, Hindi, Trung
✓ Chất lượng giọng Neural — Google Cloud Neural2 + Azure Speech dự phòng
✓ Tôn trọng quyền riêng tư — audio capture không lưu trữ, chỉ stream để dịch

═══ GIÁ ═══
• Free: 15 phút/ngày lồng tiếng
• Pro $5/tháng: không giới hạn, pipeline ưu tiên

═══ KHÁC BIỆT ═══
Đa số extension dịch chỉ làm phụ đề text. Translate Voice tạo GIỌNG NÓI tiếng Việt thật, phát song song với audio gốc — hữu ích cho video nấu ăn, podcast, bài giảng, mọi khi bạn muốn rảnh mắt mà chỉ cần nghe.

═══ HỖ TRỢ ═══
• Báo lỗi: github.com/LeTranNgoc/NHMedia/issues
• Chính sách bảo mật: <YOUR_HOSTED_URL>
• Email: <YOUR_SUPPORT_EMAIL>

═══ BETA ═══
Phiên bản closed beta. Wave 1 chỉ 50 user được mời. Có thể vẫn còn lỗi nhỏ — chúng tôi update hàng tuần.
```

### 2.3 Category + tags
- **Primary category:** Productivity
- **Secondary:** Accessibility (Vietnamese voice serves visual impairment + language learners)
- **Tags:** vietnamese, translation, dubbing, accessibility, youtube, voice-over, learning, language

### 2.4 Single purpose statement
Chrome Web Store yêu cầu **"single purpose"** — 1 dòng:

> "Provides real-time Vietnamese voice-over (audio dubbing) for YouTube videos."

Không phải multi-tool. Permissions justify trong section 3.

---

## 3. Permission justifications (MV3 mandatory)

Mỗi permission trong `manifest.json` cần lý giải trong submission form. Copy-paste verbatim:

### `tabCapture`
> "Capture the audio track of the active YouTube tab to send to our translation service. Audio is streamed in real-time and never stored. Only the active tab is captured, only after the user explicitly enables the extension via the popup or the in-page badge."

### `offscreen`
> "Run an offscreen document to process audio in a separate context with access to AudioContext + WebSocket. Required because tab-captured MediaStreams cannot be handled directly by service workers in MV3. The offscreen document is created lazily — only after the user enables capture."

### `storage`
> "Persist user preferences (source language, target language, audio mode) via chrome.storage.sync, and store the auth JWT in chrome.storage.local. Both are scoped to this extension and never shared."

### `identity`
> "Initiate Google OAuth sign-in via chrome.identity.launchWebAuthFlow. Required so the user can authenticate without sharing their password with our extension."

### `activeTab`
> "Inject the in-page badge + subtitle overlay only into the active YouTube tab when the user explicitly enables capture. No background scanning of tabs."

### Host permission `*://*.youtube.com/*`
> "Inject the content script that displays the badge, reads the YouTube caption track (when available), and renders the bilingual subtitle overlay on YouTube watch pages. Limited to youtube.com — no other sites."

---

## 4. Privacy questions (form section)

Chrome Web Store hỏi 10+ data-handling questions. Câu trả lời cho extension này:

| Question | Answer |
|---|---|
| Personally identifiable information collected? | YES — Email (sign-in only) |
| Health information? | NO |
| Financial information? | NO (payment processed by Polar.sh, never touches our extension) |
| Authentication information? | YES — Google OAuth tokens, magic-link JWT |
| Personal communications? | NO |
| Location? | NO |
| Web history? | NO |
| User activity? | YES — usage seconds + translate/TTS character counts per user per day (for quota enforcement) |
| Website content? | YES — audio of YouTube videos the user watches (streamed for translation, never stored) |

**Single purpose attestation:** ✅ Tick "Yes — this extension has a single purpose"

**Remote code statement:** Tick "No" — no remote code execution. (TTS audio data ≠ code; WASM bundled in `/ort/` is signed at build time.)

---

## 5. Pre-submission test checklist

- [ ] Production build: `pnpm -F extension build --mode production`
- [ ] Build output size < 50MB (Chrome cap; hiện ~42.5MB, OK)
- [ ] Zip `.output/chrome-mv3/` → `translate-voice-v0.1.0.zip` (< 50MB)
- [ ] Load unpacked vào Chrome dev mode, smoke test E2E (theo `docs/deployment-guide.md §7`)
- [ ] Test trên 3 video YouTube: có CC, không CC, video tiếng Pháp/Đức/Hàn (verify multi-lang)
- [ ] Verify permissions trong manifest match permission justifications
- [ ] Verify privacy policy URL accessible (curl returns 200)
- [ ] Version bump trong `package.json` + `wxt.config.ts` nếu cần (chuẩn semver: 0.1.0 → 0.2.0 cho closed beta)

---

## 6. Submission workflow

1. **Upload** `translate-voice-v0.1.0.zip` qua https://chrome.google.com/webstore/devconsole/
2. **Fill listing** (copy từ §2.2, screenshots, icons, promo tile)
3. **Fill permission justifications** (§3)
4. **Fill privacy questions** (§4)
5. **Submit for review**
6. **Wait 1-3 business days** (đôi khi tới 7 ngày — first submission của 1 publisher thường lâu hơn)
7. **Post-approval:** lấy production Extension ID → cập nhật `backend/.env`:
   ```
   ALLOWED_EXTENSION_IDS=<production_id>,<dev_id_for_continued_testing>
   ```
8. **Restart backend** + verify rejected extension ID không kết nối được

### Rejection-prone reasons (Chrome strict)
- Permission không justify rõ ràng (vd. xin `tabs` nhưng không dùng) → reject
- Privacy policy URL 404 hoặc behind auth → reject
- Icons placeholder/blank → reject
- Screenshots không thể hiện thực tế functionality → reject
- "Affiliated marketing" trong description → reject
- Single purpose statement không match thực tế → reject

---

## 7. Post-launch monitoring

Trong 7 ngày đầu sau publish:

- [ ] Chrome Web Store dashboard daily check: installs, uninstalls, ratings
- [ ] Reviews phản hồi: trả lời trong 48h (Chrome đánh giá publisher responsiveness)
- [ ] Crash reports: nếu có > 1% crash rate, hold rollout + investigate
- [ ] Permission warnings prompt: monitor user drop-off ở permission screen (target < 30%)

---

## Unresolved questions

1. Privacy policy URL — host ở đâu? GitHub Pages (free, simple) hay subdomain `translate-voice.io/privacy`?
2. Support email — `letranngoc.mmo@gmail.com` hay tạo `support@translate-voice.io`?
3. Domain `translate-voice.io` đã đăng ký chưa? Nếu chưa: cần check availability + đăng ký (~$15/year).
4. Icons graphics — designer làm hay dùng AI image gen (DALL-E / Midjourney)? Brief có trong `docs/icon-design-brief.md`.
