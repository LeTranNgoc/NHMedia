# Onboarding Checklist

> Print this. Tick boxes as you complete. Estimated total: **~1 giờ** nếu trơn tru.

Toàn bộ chi tiết click-by-click: [deployment-guide.md](./deployment-guide.md)

---

## Phần A — Local prep (5 phút)

- [x] **Repo cloned**: `git clone ...` (đã xong nếu bạn đang đọc cái này)
- [x] **Dependencies installed**: `pnpm install` (đã xong từ Phase 01)
- [x] **`.env` created**: `pnpm setup` đã tạo `.env` + sinh `JWT_SECRET`
- [x] **`backend/secrets/` folder ready**: gitignored, sẵn sàng nhận GCP service account JSON

→ Verify: `node scripts/check-env.cjs` (sẽ báo 9 keys còn thiếu)

---

## Phần B — Provision 6 services (~45 phút)

Mỗi service mở tab mới, copy key về cuối, paste vào `.env`. Order không quan trọng — chạy parallel càng tốt.

### B1. MongoDB Atlas — 5 phút
- [ ] Sign up: https://www.mongodb.com/cloud/atlas/register
- [ ] Create cluster M0 free (region Singapore/Tokyo)
- [ ] Database user: `tv-backend` + password mạnh
- [ ] Network Access: `0.0.0.0/0` (dev only)
- [ ] Copy connection string, thêm `/translate-voice` trước `?`
- [ ] Paste vào `.env` → `MONGO_URI=...`

### B2. Deepgram — 3 phút
- [ ] Sign up: https://console.deepgram.com/signup
- [ ] Create API Key (Admin permission)
- [ ] Paste → `DEEPGRAM_API_KEY=...`

### B3. Google Cloud (3 sub-tasks) — 25 phút
- [ ] Create GCP project `translate-voice`: https://console.cloud.google.com
- [ ] **Cloud TTS**:
  - [ ] Enable Cloud Text-to-Speech API
  - [ ] Create service account `tts-backend` with role "Cloud Text-to-Speech User"
  - [ ] Download JSON key → save to `backend/secrets/gcp-tts-service-account.json`
- [ ] **OAuth 2.0**:
  - [ ] Configure OAuth consent screen (External, app name = Translate Voice)
  - [ ] Add Gmail của bạn vào "Test users"
  - [ ] Create OAuth client ID (Web app)
  - [ ] Authorized redirect URI: `http://localhost:3000/auth/google/callback`
  - [ ] Paste → `GOOGLE_OAUTH_CLIENT_ID=...`
  - [ ] Paste → `GOOGLE_OAUTH_CLIENT_SECRET=...`

### B4. Gemini API — 2 phút
- [ ] Get key: https://aistudio.google.com/apikey
- [ ] Select project `translate-voice` (reuse từ B3)
- [ ] Paste → `GEMINI_API_KEY=...`

### B5. Resend — 3 phút
- [ ] Sign up: https://resend.com/signup
- [ ] Create API Key (Sending access, all domains)
- [ ] Paste → `RESEND_API_KEY=...`
- [ ] `EMAIL_FROM` đã default sẵn `onboarding@resend.dev` — không đổi

### B6. Polar.sh — 7 phút
- [ ] Sign up: https://polar.sh/signup
- [ ] Settings → API → Generate token (scopes: products, checkouts, subscriptions)
- [ ] Paste → `POLAR_API_KEY=...`
- [ ] Products → New Product: "Translate Voice Pro" — Monthly $9 USD
- [ ] Copy product ID → `POLAR_PRODUCT_ID_PRO=...`
- [ ] Settings → Webhooks → Add Endpoint:
  - URL: `http://localhost:3000/billing/webhook` (sẽ swap sau khi có ngrok)
  - Events: subscription.created, updated, canceled
- [ ] Copy webhook signing secret → `POLAR_WEBHOOK_SECRET=...`

---

## Phần C — Verify local boot (5 phút)

- [ ] `node scripts/check-env.cjs` → **9 ready / 0 missing**
- [ ] Place `gcp-tts-service-account.json` vào `backend/secrets/`
- [ ] `pnpm dev:backend` → log "backend listening on port 3000"
- [ ] Test health: `curl http://localhost:3000/health` → `{"ok":true,"mongo":"connected"}`
- [ ] Test magic link:
  ```
  curl -X POST http://localhost:3000/auth/magic-link/request \
       -H "Content-Type: application/json" \
       -d '{"email":"YOUR-EMAIL@gmail.com"}'
  ```
  → 204 + email arrives in inbox

---

## Phần D — Load extension (3 phút)

- [ ] `pnpm -F extension build` → `extension/.output/chrome-mv3/` ready
- [ ] Chrome → `chrome://extensions` → Developer mode ON → Load unpacked
- [ ] Select `extension/.output/chrome-mv3/`
- [ ] Copy Extension ID từ tile
- [ ] Update `.env`: `ALLOWED_EXTENSION_IDS=<ID-vừa-copy>`
- [ ] Restart backend: Ctrl+C → `pnpm dev:backend`

---

## Phần E — E2E smoke test (5 phút)

- [ ] Click extension icon → Account tab → "Đăng nhập với Google"
- [ ] Chọn Gmail (Test user từ B3)
- [ ] Sau redirect → popup hiện email + nút "Đăng xuất" → **AUTH WORKS**
- [ ] Account tab hiển thị "Free" badge + 0/15 phút usage → **BILLING API WORKS**
- [ ] Mở YouTube → English video bất kỳ
- [ ] Extension icon → Main tab → toggle "Bật"
- [ ] Status: idle → capturing → translating → playing
- [ ] Nghe voice tiếng Việt trong ~1.5s sau giọng tiếng Anh → **PIPELINE WORKS** 🎉

---

## Phần F — Webhook tunnel (chỉ cần test billing — 10 phút)

- [ ] Install ngrok: https://ngrok.com/download
- [ ] `ngrok http 3000` → copy `https://abc-123.ngrok-free.app`
- [ ] Polar dashboard → edit webhook → URL: `https://abc-123.ngrok-free.app/billing/webhook`
- [ ] Test subscription:
  - [ ] Extension popup → Account → "Nâng cấp lên Pro" → opens Polar checkout (sandbox)
  - [ ] Test card: `4242 4242 4242 4242`, exp future, CVC any
  - [ ] Reload extension popup → Account tab → "Pro" badge → **BILLING FLOW WORKS**

---

## Status legend

✅ Done: tasks pre-completed by setup script  
🟡 Manual: requires you to sign up / click through  
🔴 Blocker: must complete before next step  

Stuck? See [deployment-guide.md](./deployment-guide.md) Section 8 (Troubleshooting).
