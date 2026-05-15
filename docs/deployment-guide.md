# Deployment Guide — Translate Voice MVP

> **Mục đích:** Hướng dẫn từng bước cấu hình API keys + chạy backend + load extension + smoke E2E. Áp dụng cho local dev hoặc closed beta (chưa deploy production).
>
> **Đối tượng:** Solo dev hoặc team nhỏ chạy MVP lần đầu.
>
> **Thời gian ước tính:** 2-3 giờ (bao gồm tạo accounts ở 6 services).

---

## Mục lục

1. [Pre-requisites](#1-pre-requisites)
2. [Provision API keys (6 services)](#2-provision-api-keys-6-services)
3. [Configure backend `.env`](#3-configure-backend-env)
4. [Run backend locally](#4-run-backend-locally)
5. [Load extension trong Chrome](#5-load-extension-trong-chrome)
6. [Configure extension URLs (nếu khác localhost)](#6-configure-extension-urls)
7. [End-to-end smoke test](#7-end-to-end-smoke-test)
8. [Troubleshooting common issues](#8-troubleshooting-common-issues)
9. [Production deployment checklist](#9-production-deployment-checklist)

---

## 1. Pre-requisites

Cài đặt local (verify từng tool):

```bash
# Node.js >= 20
node --version    # → v20.x.x hoặc cao hơn (project dev với v25)

# pnpm >= 10
pnpm --version    # → 10.x.x

# git
git --version

# Chrome / Edge >= 113
# Mở Chrome → chrome://version → check "Google Chrome" line
```

Nếu thiếu Node: tải từ https://nodejs.org/ (LTS recommended).
Nếu thiếu pnpm: `npm install -g pnpm@10`.

**MongoDB:** dùng MongoDB Atlas (cloud, free tier M0 đủ cho MVP). Hướng dẫn ở Step 2.

---

## 2. Provision API keys (6 services)

Tổng cộng 6 services cần đăng ký. Đi tuần tự — dependencies giữa services là độc lập.

### 2.1. MongoDB Atlas (database)

1. Truy cập https://www.mongodb.com/cloud/atlas/register
2. Đăng ký bằng email (Google sign-up khuyến nghị)
3. Sau khi vào dashboard, click **Build a Database**
4. Chọn **M0 Free Tier** (512MB, đủ cho MVP)
5. Region: chọn **AWS Singapore (ap-southeast-1)** hoặc **AWS Tokyo (ap-northeast-1)** (gần Việt Nam nhất)
6. Cluster name: `translate-voice-dev`
7. Sau khi cluster created (~3 phút):
   - **Database Access** → Add New Database User
     - Authentication: Password
     - Username: `tv-backend`
     - Password: generate mật khẩu mạnh, **lưu lại** (sẽ vào .env)
     - Built-in role: **Atlas admin** (cho dev đơn giản; production nên giới hạn về `readWrite`)
   - **Network Access** → Add IP Address
     - **Allow Access from Anywhere** (`0.0.0.0/0`) — tiện cho dev
     - Production: lock về IP của VPS hosting backend
8. Quay về **Database** tab → click **Connect** trên cluster → **Drivers** → Node.js 5.5+
9. Copy connection string, dạng:
   ```
   mongodb+srv://tv-backend:<password>@translate-voice-dev.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
10. Thay `<password>` bằng password ở bước 7, thêm `/translate-voice` trước `?` để chỉ định DB name:
    ```
    mongodb+srv://tv-backend:YOUR_PASSWORD@translate-voice-dev.xxxxx.mongodb.net/translate-voice?retryWrites=true&w=majority
    ```
11. **Lưu vào tạm:** đây là `MONGO_URI` trong .env

### 2.2. Deepgram (ASR — speech to text)

1. Truy cập https://console.deepgram.com/signup
2. Đăng ký (có $200 free credit ban đầu, đủ ~10 giờ audio)
3. Sau khi vào console → **API Keys** (sidebar)
4. Click **Create a New API Key**:
   - Name: `translate-voice-dev`
   - Permissions: **Admin** (cho dev; production: Member với scope cụ thể)
   - Project: default
5. Copy API key (dạng `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
6. **Lưu vào tạm:** `DEEPGRAM_API_KEY`

### 2.3. Google Cloud (TTS + OAuth)

Phần này có 2 dịch vụ riêng — Cloud TTS và OAuth — đều cần làm trên 1 GCP project.

#### 2.3.a. Tạo GCP project

1. Truy cập https://console.cloud.google.com/
2. Đăng nhập bằng Google account
3. Click dropdown project (top bar) → **NEW PROJECT**
   - Name: `translate-voice`
   - Organization: (để trống nếu cá nhân)
4. Click **CREATE**, đợi ~30 giây
5. Sau khi project tạo xong, chọn nó từ dropdown

#### 2.3.b. Enable Cloud TTS API + tạo service account

1. **APIs & Services** → **Library** (sidebar)
2. Tìm "Cloud Text-to-Speech API" → click → **Enable**
3. Đợi ~1 phút
4. **IAM & Admin** → **Service Accounts** → **CREATE SERVICE ACCOUNT**
   - Name: `tts-backend`
   - Description: `Translate Voice backend TTS access`
   - Click **CREATE AND CONTINUE**
5. Role: **Cloud Text-to-Speech User** (tìm trong dropdown)
   - Click **CONTINUE** → **DONE**
6. Click vào service account vừa tạo → tab **KEYS** → **ADD KEY** → **Create new key** → **JSON** → **CREATE**
7. File JSON tự động download. **ĐỪNG COMMIT FILE NÀY VÀO GIT.**
8. Tạo folder `f:\translate voice\backend\secrets\` (folder này phải nằm trong .gitignore — verify)
9. Đổi tên file JSON thành `gcp-tts-service-account.json`, đặt vào `f:\translate voice\backend\secrets\gcp-tts-service-account.json`
10. **Lưu vào tạm:** `GOOGLE_CLOUD_TTS_KEY_FILE=./secrets/gcp-tts-service-account.json`

⚠️ Verify `.gitignore` (đã có) chứa:
```
.env
secrets/
*.json   # nếu muốn extra paranoid
```
File `backend/.gitignore` cần thêm `secrets/` nếu chưa. Check bằng `git status` — file không nên xuất hiện.

#### 2.3.c. Tạo OAuth 2.0 Client ID (cho Google sign-in)

1. **APIs & Services** → **OAuth consent screen**
2. User Type: **External** → **CREATE**
3. App info:
   - App name: `Translate Voice`
   - User support email: email của bạn
   - App logo: (skip cho dev)
   - App domain: (skip cho dev)
   - Authorized domains: thêm domain backend của bạn (nếu deploy thật) hoặc skip cho localhost
   - Developer contact: email của bạn
4. **SAVE AND CONTINUE**
5. Scopes: **ADD OR REMOVE SCOPES** → tick `.../auth/userinfo.email` + `.../auth/userinfo.profile` → **UPDATE** → **SAVE AND CONTINUE**
6. Test users (vì app ở dạng Testing): **ADD USERS** → thêm email Gmail bạn dùng để test → **SAVE AND CONTINUE**
7. Quay lại **Credentials** → **CREATE CREDENTIALS** → **OAuth client ID**
8. Application type: **Web application**
9. Name: `translate-voice-web`
10. Authorized redirect URIs: thêm cả 2:
    ```
    http://localhost:3000/auth/google/callback
    https://YOUR-PRODUCTION-DOMAIN/auth/google/callback  (nếu có)
    ```
11. **CREATE**
12. Popup hiện ra `Client ID` + `Client Secret`. Copy cả 2.
13. **Lưu vào tạm:**
    - `GOOGLE_OAUTH_CLIENT_ID=<client-id>`
    - `GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>`

### 2.4. Gemini API (translation)

1. Truy cập https://aistudio.google.com/apikey
2. Đăng nhập bằng Google account (cùng account với GCP project trên hoặc khác — đều OK)
3. Click **Create API key** → chọn project `translate-voice` (đã tạo ở Step 2.3.a) hoặc new project
4. Copy key (dạng `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`)
5. **Lưu vào tạm:** `GEMINI_API_KEY`

Free tier Gemini Flash 2.0: 15 RPM, 1500 requests/day — đủ cho dev. Cần upgrade billing khi vào prod.

### 2.5. Resend (email — magic link)

1. Truy cập https://resend.com/signup
2. Đăng ký
3. **API Keys** → **Create API Key**
   - Name: `translate-voice-dev`
   - Permission: **Sending access** → All domains
4. Copy key (dạng `re_xxxxxxxxxxxxxxxxxxxxxxxx`)
5. **Lưu vào tạm:** `RESEND_API_KEY`

**Email "from" address:**
- Free tier: dùng `onboarding@resend.dev` (test domain Resend cung cấp — nhanh nhất cho dev)
- Production: verify domain riêng → setup DKIM (https://resend.com/docs/dashboard/domains/introduction)
- **Lưu vào tạm:** `EMAIL_FROM=onboarding@resend.dev`

### 2.6. Polar.sh (billing — subscription)

1. Truy cập https://polar.sh/signup
2. Đăng ký bằng GitHub hoặc email
3. Tạo Organization mới (tên gì cũng được, ví dụ `translate-voice`)
4. **Settings** → **API** → **Generate new token**
   - Name: `backend-dev`
   - Scopes: `products:read`, `products:write`, `checkouts:read`, `checkouts:write`, `subscriptions:read`, `subscriptions:write`
5. Copy token (dạng `polar_oat_xxxxx...`)
6. **Lưu vào tạm:** `POLAR_API_KEY`

**Tạo product Pro $9/month:**
1. **Products** → **New Product**
2. Name: `Translate Voice Pro`
3. Pricing: **Recurring** → **Monthly** → **$9.00 USD**
4. **Create**
5. Sau khi created, copy product ID từ URL (dạng `abc-123-def`)
6. **Lưu vào tạm:** `POLAR_PRODUCT_ID_PRO`

**Webhook:**
1. **Settings** → **Webhooks** → **Add Endpoint**
2. URL: `http://localhost:3000/billing/webhook` (cho dev; cần ngrok tunnel để Polar bắn được — xem Step 8.4)
3. Events: tick **subscription.created**, **subscription.updated**, **subscription.canceled**
4. **Create**
5. Copy webhook signing secret (dạng `whsec_xxxx...`)
6. **Lưu vào tạm:** `POLAR_WEBHOOK_SECRET`

⚠️ **Sandbox vs Production:**
- Polar có cả `sandbox.polar.sh` (test) và `polar.sh` (live). MVP nên start với sandbox.
- URL validation trong code chấp nhận cả 2 (`*.polar.sh`).

---

## 3. Configure backend `.env`

```bash
cd "f:/translate voice"
cp .env.example .env
```

Mở `.env`, điền tất cả giá trị đã lưu ở Step 2:

```bash
# Server
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development

# MongoDB (Step 2.1)
MONGO_URI=mongodb+srv://tv-backend:YOUR_PASSWORD@translate-voice-dev.xxxxx.mongodb.net/translate-voice?retryWrites=true&w=majority

# Auth (tự generate)
JWT_SECRET=GENERATE_BELOW
JWT_EXPIRES_IN=7d

# Magic Link (Step 2.5)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=onboarding@resend.dev

# Google OAuth (Step 2.3.c)
GOOGLE_OAUTH_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=YOUR_CLIENT_SECRET

# ASR (Step 2.2)
DEEPGRAM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Translate (Step 2.4)
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# TTS (Step 2.3.b)
GOOGLE_CLOUD_TTS_KEY_FILE=./secrets/gcp-tts-service-account.json

# Billing (Step 2.6)
POLAR_API_KEY=polar_oat_xxxxxxxxxxxxxxxxxxxx
POLAR_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
POLAR_PRODUCT_ID_PRO=abc-123-def

# Sign-in (will set after first extension load — Step 5)
ALLOWED_EXTENSION_IDS=
```

**Generate JWT_SECRET:**
```bash
# Mở PowerShell terminal:
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))

# Hoặc Node:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Copy output, paste vào `JWT_SECRET=...` (phải ≥32 chars).

⚠️ **NEVER commit `.env`** — đã có trong `.gitignore`.

---

## 4. Run backend locally

```bash
cd "f:/translate voice"
pnpm install                    # nếu chưa
pnpm -F backend dev
```

Expected output:
```
backend listening on port 3000
```

**Kiểm tra MongoDB connect:**
```bash
curl http://localhost:3000/health
# Response: {"ok":true,"mongo":"connected","uptime":2}
```

**Kiểm tra magic link gửi email:**
```bash
curl -X POST http://localhost:3000/auth/magic-link/request \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR-EMAIL@gmail.com"}'
# Response: 204 No Content
```

Mở Gmail của bạn → kiểm tra email mới từ `onboarding@resend.dev`. Click link → backend trả JSON `{ token: "<JWT>", user: {...} }`. JWT là bằng chứng auth flow hoạt động.

**Kiểm tra Deepgram + Gemini + TTS:**
Phần này cần WS connection từ extension. Sẽ test ở Step 7.

Nếu boot lỗi: xem [Troubleshooting](#8-troubleshooting-common-issues).

---

## 5. Load extension trong Chrome

1. Mở Chrome → truy cập `chrome://extensions`
2. Bật **Developer mode** (toggle góc trên phải)
3. Click **Load unpacked**
4. Chọn folder `f:\translate voice\extension\.output\chrome-mv3\`
   - Nếu folder chưa tồn tại: chạy `pnpm -F extension build` trong terminal trước
5. Extension load xong, hiển thị tile "Translate Voice"

**Lấy Extension ID:**
- Trên tile của extension, dưới tên có dòng `ID: abcdefghijklmnopqrstuvwxyzabcdef`
- Copy ID này
- Quay lại `.env` backend, set:
  ```
  ALLOWED_EXTENSION_IDS=abcdefghijklmnopqrstuvwxyzabcdef
  ```
- Restart backend: Ctrl+C → `pnpm -F backend dev` lại

**Pin extension:**
- Click icon puzzle ở Chrome toolbar
- Tìm "Translate Voice" → click icon ghim → giờ extension hiện trên toolbar

---

## 6. Configure extension URLs

Nếu backend chạy ở `localhost:3000` (default dev), không cần config gì. Extension đã được build với URL `ws://localhost:3001/ws` và `http://localhost:3000`.

⚠️ Lưu ý: WS URL extension dùng là `:3001` nhưng backend chạy `:3000`. Đây là discrepancy. Fix:

**Option A:** Đổi backend port sang 3001
```bash
# Trong .env:
PORT=3001
```

**Option B:** Đổi extension WS URL sang 3000
Build extension với env override:
```bash
cd extension
echo "WXT_WS_URL=ws://localhost:3000/ws/translate" > .env
echo "WXT_API_BASE=http://localhost:3000" >> .env
pnpm build
# Re-load unpacked trong Chrome
```

**Option C (production):**
```bash
cd extension
echo "WXT_WS_URL=wss://api.your-domain.com/ws/translate" > .env.production
echo "WXT_API_BASE=https://api.your-domain.com" >> .env.production
pnpm build --mode production
```

Recommended: **Option A** cho dev (đổi backend PORT=3001).

Sau khi đổi config nào: reload extension qua `chrome://extensions` → click reload icon trên tile.

---

## 7. End-to-end smoke test

### 7.1. Sign in

1. Click icon extension trên toolbar → popup mở ra
2. Click tab **Account**
3. Click **Đăng nhập với Google**
4. Popup mới mở → chọn Google account của bạn (account đã add vào "Test users" ở Step 2.3.c)
5. Allow scopes (email, profile)
6. Popup tự đóng, quay lại extension popup → thấy email của bạn + nút "Đăng xuất"

✅ Sign-in thành công nếu thấy email + sign-out button.

**Hoặc test magic link:**
1. Account tab → "Đăng nhập bằng email"
2. Nhập email → "Gửi link đăng nhập"
3. Mở Gmail → click link trong email → trang HTML hiện token
4. Copy token, paste vào textarea trong extension popup → "Lưu token"
5. Reload popup → thấy email logged in

### 7.2. Tạo subscription (optional — chỉ cần nếu test billing)

1. Account tab → click "Nâng cấp lên Pro" (chỉ hiện khi đang free tier)
2. Tab mới mở Polar checkout (sandbox)
3. Test card: `4242 4242 4242 4242`, exp future, CVC any
4. Hoàn tất → Polar gửi webhook → backend upgrade user
5. Reload extension popup → Account tab → badge "Pro"

⚠️ Webhook chỉ hoạt động nếu backend tiếp cận được từ Polar. Cho dev local: **ngrok tunnel** (xem Step 8.4).

### 7.3. Translate YouTube video

1. Mở YouTube → chọn video tiếng Anh (ví dụ TED Talk ngắn)
2. Click icon extension → tab **Main** → toggle **Bật**
3. Status indicator: idle → capturing → translating → playing
4. Nghe — voice tiếng Việt fade in ~1-1.5s sau giọng tiếng Anh
5. Status badge "VN: ON ●" hiện top-right trên trang YouTube

Test variations:
- **Voice-over mode**: âm gốc ducked xuống 30%, voice VN đè lên
- **Replacement mode**: âm gốc mute hoàn toàn, chỉ voice VN
- **Subtitle on**: text VN hiện dưới video
- **Ngôn ngữ khác**: thử video Japanese / Korean / French / German
- **Pause/seek**: VN audio stop ngay khi pause, resume khi play

### 7.4. Test quota gate

Free tier 15 phút/ngày = 900s. Để test nhanh:

**Hardcoded short cap cho dev:** sửa `backend/src/lib/usage-tracker.ts` `FREE_TIER_LIMIT_SECONDS = 60` (1 phút). Restart backend. Test → sau 1 phút WS close 4003 → extension popup hiện banner "Đã hết quota miễn phí hôm nay".

Nhớ revert lại 900 sau khi test xong.

### 7.4. Smoke test Polar Pro upgrade flow (sandbox)

> Mục đích: verify webhook → Mongo `tier='pro'` xảy ra sau khi user pay sandbox checkout. Cần làm trước public beta.

**Prerequisites:**
- Polar dashboard ở **sandbox** mode (`sandbox.polar.sh`), Pro product đã tạo + checkout link copied vào `.env` (`POLAR_PRO_CHECKOUT_URL`)
- Backend chạy local + expose qua tunnel (ngrok / cloudflared) để Polar webhook gọi tới được. Vd `ngrok http 3000` → set Polar webhook URL `https://<id>.ngrok-free.app/billing/webhook`
- Polar webhook secret đã set vào `.env` (`POLAR_WEBHOOK_SECRET`)
- Backend log mở để theo dõi

**Checklist:**

1. **Sign in qua extension** với 1 tài khoản test (Google OAuth hoặc magic link). Note `userId` từ Mongo `users` collection.
2. **Verify free tier ban đầu:**
   ```bash
   curl http://localhost:3000/billing/me \
     -H "Authorization: Bearer <JWT_from_chrome_storage>"
   # → { tier: 'free', usageToday: {...}, limits: { seconds, translateChars, ttsChars } }
   ```
3. **Click Upgrade button trong popup** → mở Polar sandbox checkout. Confirm URL chứa `customer_external_id=<userId>` (server-side derived).
4. **Pay** với Polar sandbox test card (xem Polar docs cho test card numbers).
5. **Theo dõi backend log** — phải thấy:
   ```
   [polar-webhook] received event: subscription.created
   [polar-webhook] verified signature
   [polar-webhook] Pro subscription activated for user <userId>
   ```
6. **Verify Mongo state:**
   ```js
   db.subscriptions.findOne({ userId: ObjectId("<userId>") })
   // → { ..., status: 'active', tier: 'pro', polarSubscriptionId: 'sub_xxx', createdAt: <recent> }
   ```
7. **Reload popup** → tier badge phải hiện "Pro" và quota bars phải hiện "Unlimited".
8. **Re-fetch /billing/me** → `{ tier: 'pro', limits: { seconds: null, translateChars: null, ttsChars: null } }`.
9. **Test cancel flow:** Cancel sub trong Polar dashboard → backend log phải thấy `subscription.canceled` event → Mongo `subscriptions` row có `status: 'canceled'` + `endsAt` set. Pipeline vẫn cho user dùng đến `endsAt` (per `getTier` logic).

**Fail signals & triage:**
- Webhook không tới → check ngrok tunnel còn live, Polar webhook URL đúng (`/billing/webhook` không phải `/webhook`).
- Signature mismatch trong log → `POLAR_WEBHOOK_SECRET` trong `.env` không khớp với secret trên Polar dashboard.
- Mongo không update → check `productId` trong event payload khớp `POLAR_PRODUCT_ID_PRO`. Polar có nhiều product, webhook handler ignore unknown product IDs (intentional, log warning).
- `customer_external_id` mismatch → user pay cho user khác. Check JWT-derived ID trong checkout URL khớp Polar metadata.

**Cleanup sau test:**
- Polar sandbox không thật charge, không cần refund manual.
- Có thể delete subscription row trong Mongo nếu muốn re-test từ free state: `db.subscriptions.deleteOne({ userId: ObjectId("<userId>") })`.

---

## 8. Troubleshooting common issues

### 8.1. Backend không boot — "Missing required env: ..."

→ Step 3: thiếu env var. Check `.env` đầy đủ. Production guard fail-fast vì secrets là `''` hoặc `'placeholder'`.

### 8.2. Backend boot OK nhưng `/health` returns `mongo: "error"`

→ MongoDB connection fail. Kiểm tra:
- `MONGO_URI` đúng password chưa
- IP whitelist trong Atlas có `0.0.0.0/0` chưa
- Cluster đang active (không suspended)

### 8.3. Magic link không nhận được email

→ Resend dashboard → **Emails** tab → xem log:
- "Delivered" → check spam folder Gmail
- "Bounced" / "Failed" → kiểm tra email format
- "Suppressed" → email đã bị suppress (rare cho dev)
- Không thấy → backend chưa call Resend (check backend logs)

### 8.4. Polar webhook không bắn về localhost

Local backend không tiếp cận được từ Polar's servers. Dùng **ngrok**:

```bash
# Cài ngrok: https://ngrok.com/download
ngrok http 3000
# Output: https://abc123.ngrok-free.app -> localhost:3000
```

Copy URL ngrok, cập nhật webhook URL trong Polar dashboard:
- Polar Settings → Webhooks → edit → URL: `https://abc123.ngrok-free.app/billing/webhook`
- Save

Trigger lại webhook (test bằng cách subscribe + cancel trong sandbox). Backend logs sẽ thấy webhook arrive.

### 8.5. Extension popup không mở / blank

→ DevTools popup: right-click extension icon → **Inspect popup**. Xem Console tab:
- Lỗi network: backend down or URL sai → check Step 6
- Lỗi React render: refresh popup, copy stack trace
- "CORS error": backend CORS chưa allow extension origin → fix `app.ts` CORS function

### 8.6. Click "Đăng nhập với Google" → "Authorization Error"

→ Step 2.3.c: redirect URI sai
- Lỗi `redirect_uri_mismatch` → Google Cloud Console → Credentials → edit OAuth client → thêm `http://localhost:3000/auth/google/callback`
- Lỗi "App is unverified" → bạn không phải test user. Thêm Gmail vào Step 2.3.c → "Test users"

### 8.7. Click "Bật" trên YouTube nhưng status stuck "Idle"

→ Service Worker DevTools: `chrome://extensions` → tile extension → **Service Worker** link → console:
- "tabCapture permission denied" → manifest chưa có `tabCapture` (rare; check `wxt.config.ts`)
- "Failed to fetch streamId" → user gesture không capture (lý do hay gặp: popup click bị async qua nhiều layers → user gesture expire). Reload popup, click trực tiếp.
- "auth_required" → chưa sign in. Quay lại Step 7.1.

### 8.8. Status "capturing" nhưng không nghe voice VN

→ Offscreen DevTools: `chrome://extensions` → **inspect views: offscreen.html**:
- "WebSocket close 4001" → JWT sai/expired. Sign out + sign in lại.
- "WebSocket close 4003" → quota exceeded. Reset usage trong Mongo Atlas (DB tools → `usage_log` → delete docs cho userId).
- "Deepgram error" → API key sai or quota exhausted. Check Deepgram dashboard.
- Backend logs có "Gemini error" → API key sai or rate limit. Gemini Flash free tier 15 RPM.

### 8.9. Voice VN nghe robotic / quality kém

→ Google Cloud TTS Neural2 vi-VN — đã là chất lượng cao nhất trong free tier. Upgrade path:
- ElevenLabs Vietnamese (premium, $50/1M chars) — v1.1 roadmap
- FPT.AI Vietnamese — local provider, cần verify streaming latency trước khi swap

### 8.10. CRLF warnings khi git commit

→ Windows line endings. An toàn, không ảnh hưởng. Tắt warning:
```bash
git config --global core.autocrlf true
```

---

## 9. Production deployment checklist

Trước khi mở public beta:

### Backend
- [ ] Deploy lên VPS / cloud (Fly.io, Railway, Render — chọn provider có WebSocket support tốt)
- [ ] MongoDB Atlas: upgrade từ M0 lên M10+ (free tier giới hạn 500 connections, M0 không có production SLA)
- [ ] Network Access trong Atlas: lock về IP của VPS (xoá `0.0.0.0/0`)
- [ ] HTTPS bắt buộc — dùng Let's Encrypt (Caddy/Nginx) hoặc Cloudflare proxy
- [ ] WSS endpoint (`wss://`) — không phải `ws://`
- [ ] Set `NODE_ENV=production` — kích hoạt env fail-fast guard
- [ ] Rotate tất cả keys lần cuối trước launch (dev keys không nên dùng prod)
- [ ] Backup MongoDB tự động (Atlas có sẵn cho M10+)
- [ ] Setup logging: Datadog / Logtail / similar
- [ ] Setup error tracking: Sentry / Highlight
- [ ] Rate limit nghiêm hơn `/auth/magic-link/request` (10/hour/email, 100/hour/IP)
- [ ] Polar webhook URL: cập nhật về production domain

### Extension
- [ ] Build production: `pnpm -F extension build --mode production`
- [ ] Manifest version bump
- [ ] Tạo icons thật (16/48/128 + 1280x800 store screenshot)
- [ ] Privacy policy URL (Chrome Web Store yêu cầu cho extensions có data collection)
- [ ] Tạo developer account Chrome Web Store ($5 one-time)
- [ ] Upload zip của `.output/chrome-mv3/` → Chrome Web Store dashboard
- [ ] Submit for review (1-3 ngày)
- [ ] Sau khi published, lấy production Extension ID → cập nhật `ALLOWED_EXTENSION_IDS` trên backend

### Monitoring (week 1)
- [ ] Daily active users (DAU)
- [ ] Cost per user/day (target < $0.10 cho free, > $5 cho Pro)
- [ ] Pipeline p95 latency (target < 1.3s)
- [ ] Free→Pro conversion rate
- [ ] Customer support tickets — most common issues

### Known weaknesses to address before scale
- Sign-in magic link bridge: copy-paste UX → SSE flow
- Free-tier abuse: device fingerprinting OR phone verification
- Translation prompt injection: `systemInstruction` API
- WS JWT scope: 7d → 1hr ticket endpoint
- Email rate-limiter: in-memory → Redis
- SW restart resilience: persist to `chrome.storage.session`

Xem `plans/reports/review-260513-0845-mvp-production-readiness.md` cho full list.

---

## 10. Operator notes — data-semantic cutovers

> Operational gotchas mà analytics / billing consumers cần biết khi diễn giải `usage_log` qua các deploys.

### `usage_log.translateCharsToday` — output → input chars (commit e8a6c34, 2026-05-15)

Trước commit `e8a6c34`, `translateCharsToday` được tăng theo độ dài chuỗi **dịch (output)**:

```
onTranslateComplete?.(translatedText.length)   // ❌ old
```

Sau commit (review finding I3), counter đổi sang chuỗi **gốc (input)** để khớp với cách Azure Translator + Google Cloud Translate tính phí:

```
onTranslateComplete?.(srcText.length)          // ✅ new
```

**Hệ quả vận hành:**

- Rows ghi trước `e8a6c34` (mọi prod deploy ≤ 2026-05-15) chứa **OUTPUT length**.
- Rows ghi từ `e8a6c34` trở đi chứa **INPUT length**.
- Output thường lớn hơn input cho EN→VI / EN→JA / EN→DE (1.1-1.4×); ngược lại cho VI→EN / JA→EN.
- **Analytics SQL/aggregation cộng `translateCharsToday` qua mốc cutover sẽ trộn hai đơn vị** — biểu đồ cost-per-user có thể đứt gãy. Nếu chart-watcher báo "translate chars giảm 25% sau deploy ngày X" → đây là semantics shift, không phải user behavior thay đổi.
- Quota cap (`FREE_TIER_LIMIT_TRANSLATE_CHARS`) áp lên cùng counter → free user post-cutover có thể **dùng được nhiều hơn một chút** so với trước, vì output thường > input. Acceptable, không reset cap.

**Recovery option (nếu cần lịch sử thuần input):** không có. Output→input mapping cần re-translate, không khả thi với 50k+ rows. Tốt nhất là note mốc cutover trong dashboard và phân tích từng giai đoạn riêng.

---

## Câu hỏi còn mở

1. Production domain cho backend chưa quyết — Fly.io vs Railway vs VPS?
2. Polar.sh vs Stripe — Polar đơn giản hơn nhưng less mature. Switch nếu gặp blocker.
3. Real Vietnamese voice quality cần A/B test (Google Cloud Neural2 vs ElevenLabs) trước public launch.
4. Mobile Safari / Firefox support — defer to v2; Firefox không có `chrome.tabCapture` MV3 API.
