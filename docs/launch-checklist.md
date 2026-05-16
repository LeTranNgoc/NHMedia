# Launch Checklist — Translate Voice Closed Beta

> Hướng dẫn từng bước cụ thể với link để bạn launch closed beta wave 1 (50 user). Làm tuần tự từ §1 → §10. Mỗi step có **mục tiêu**, **link**, **thời gian**, **chi phí**, và **cách verify**.

**Tổng effort:** ~4–6 giờ + $5 (Chrome Web Store) + optional $20–80 (icon designer).
**Critical path** (blocking launch): §1, §3, §4, §5, §7, §8, §9, §10.
**Optional / refinement:** §2 (đẹp hơn — Sentry/Logtail có thể skip cho v1), §6 (Polar live optional cho wave 1 nếu chấp nhận free-only).

---

## 1. Cloud accounts (30 phút, $0)

Đăng ký 4 dịch vụ. Tất cả đều free-tier đủ cho closed beta.

### 1.1. Fly.io (backend hosting)

- **Link:** https://fly.io/app/sign-up
- **Sign up** bằng GitHub (gắn account `LeTranNgoc` cho thuận tiện).
- **Yêu cầu:** Add payment method (card) — Fly bắt buộc, nhưng free tier ($5/tháng credit) thường đủ cho 1–2 VM 256–512 MB.
- **Install flyctl CLI:** Powershell trên Windows:
  ```powershell
  iwr https://fly.io/install.ps1 -useb | iex
  ```
  Hoặc macOS:
  ```bash
  brew install flyctl
  ```
- **Login:** `fly auth login` → mở browser xác nhận.
- **Verify:** `fly version` in ra phiên bản.

### 1.2. Sentry (error tracking)

- **Link:** https://sentry.io/signup/
- **Sign up** bằng email (free tier 5k errors/tháng, đủ closed beta).
- **Tạo project:** sau khi vào, click **Projects** → **Create Project** → chọn **Node.js** → name `translate-voice-backend`.
- **Copy DSN:** sau khi tạo, Sentry hiện DSN dạng `https://xxxx@oxxx.ingest.sentry.io/yyyy`. Lưu lại — sẽ dùng cho `SENTRY_DSN`.
- **Tạo thêm project cho extension:** Repeat — chọn **Browser JavaScript** → name `translate-voice-extension`. Lưu DSN này cho `WXT_SENTRY_DSN`.
- **Verify:** Sentry dashboard có 2 projects.

### 1.3. Better Stack / Logtail (log aggregation)

- **Link:** https://betterstack.com/logs (đăng ký Logs product, không phải Uptime)
- **Sign up** bằng email. Free tier: 1 GB/tháng, 3 ngày retention — đủ cho closed beta.
- **Create source:** dashboard → **Sources** → **Connect source** → chọn **Node.js** → name `translate-voice-backend`.
- **Copy source token** (dạng `xxxxxxxxxxxxxxxxxxxxxxxx`). Lưu cho `LOGTAIL_SOURCE_TOKEN`.
- **Verify:** Source list có entry, status "Waiting for logs".

### 1.4. Upstash Redis (cross-process rate-limiter)

- **Link:** https://console.upstash.com/login
- **Sign up** bằng GitHub.
- **Create database:** **Create database** → name `translate-voice-rl` → Region: **AWS Singapore (ap-southeast-1)** (match Fly region) → Type: **Regional** (Global đắt hơn, không cần). Free tier: 10k commands/day, 256 MB → đủ cho closed beta.
- **Copy connection string:** sau khi tạo, scroll xuống **Connect to your database** → click **TLS (Recommended)** → copy **redis-cli** URL dạng:
  ```
  rediss://default:<password>@<region>-<id>.upstash.io:6379
  ```
  Lưu cho `REDIS_URL`. **Note:** dùng `rediss://` (TLS, 2 chữ s), không phải `redis://`.
- **Verify:** dashboard có database "Active".

---

## 2. MongoDB Atlas (15 phút, $0) — nếu chưa có

Nếu đã làm theo `docs/deployment-guide.md §2.1`, skip. Nếu chưa:

- **Link:** https://www.mongodb.com/cloud/atlas/register
- Theo `deployment-guide §2.1` — tạo M0 free tier cluster ở **AWS Singapore**, tạo DB user, Network Access `0.0.0.0/0` (closed beta) hoặc lock về Fly egress IP (production hardening).
- Lưu connection string làm `MONGO_URI`.

---

## 3. Privacy policy hosting (15 phút, $0)

Chrome Web Store bắt buộc privacy policy URL HTTPS publicly accessible.

### Lựa chọn nhanh nhất: GitHub Pages

1. **Tạo repo public** `letranngoc.github.io` (nếu chưa có):
   - Link: https://github.com/new
   - Name: `letranngoc.github.io` (PHẢI match username để dùng làm root domain)
   - Public, init với README.
2. **Add privacy policy file:**
   - Mở repo → **Add file** → **Create new file** → name `privacy.md`.
   - Copy nội dung từ `docs/privacy-policy.md` của project (đã có trong repo `NHMedia`).
   - **Fill placeholders:**
     - `<YOUR_LEGAL_NAME>` → Tên cá nhân hoặc công ty (vd: `Le Tran Ngoc`)
     - `<YOUR_SUPPORT_EMAIL>` → `letranngoc.mmo@gmail.com` hoặc email riêng
     - `<YOUR_SECURITY_EMAIL>` → cùng email support cũng OK cho closed beta
     - `<YOUR_POSTAL_ADDRESS>` → địa chỉ thật (Chrome đôi khi check)
     - `<DD MONTH YYYY>` → ngày hôm nay (vd: `16 May 2026`)
   - Commit.
3. **Enable Pages:**
   - Repo **Settings** → **Pages** (sidebar) → **Source: Deploy from a branch** → branch `main` → folder `/ (root)` → Save.
   - Đợi 1–2 phút.
4. **URL sẵn sàng:** `https://letranngoc.github.io/privacy` (hoặc `https://letranngoc.github.io/privacy.html` tuỳ rendering).
5. **Verify:** mở URL trong incognito → load OK, không cần auth.

### Lưu URL này — sẽ paste vào Chrome Web Store form (§9).

---

## 4. Fly.io deploy backend (45 phút, $0)

### 4.1. Tạo Fly app

Từ folder repo (`f:\translate voice`):

```powershell
fly apps create translate-voice-backend
```

Nếu tên đã bị lấy → đổi sang tên khác (vd `tv-backend-letn`), nhớ update `fly.toml` app field.

### 4.2. Set tất cả secrets (20 phút)

Chuẩn bị giá trị, sau đó chạy 1 command (paste từng dòng):

```powershell
fly secrets set `
  MONGO_URI="mongodb+srv://..." `
  JWT_SECRET="$(node -e ""console.log(require('crypto').randomBytes(32).toString('hex'))"")" `
  RESEND_API_KEY="re_xxx" `
  GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com" `
  GOOGLE_CLIENT_SECRET="GOCSPX-xxx" `
  MAGIC_LINK_BASE_URL="https://translate-voice-backend.fly.dev" `
  CORS_ORIGINS="chrome-extension://YOUR_DEV_EXTENSION_ID" `
  DEEPGRAM_API_KEY="xxx" `
  GEMINI_API_KEY="AIza..." `
  AZURE_TRANSLATOR_KEY="xxx" `
  AZURE_SPEECH_KEY="xxx" `
  AZURE_SPEECH_REGION="southeastasia" `
  POLAR_API_KEY="polar_xxx" `
  POLAR_WEBHOOK_SECRET="whsec_xxx" `
  POLAR_PRODUCT_ID_PRO="prod_xxx" `
  POLAR_PRO_CHECKOUT_URL="https://buy.polar.sh/<slug>" `
  POLAR_SERVER="sandbox" `
  FREE_TIER_LIMIT_SECONDS=900 `
  FREE_TIER_LIMIT_TRANSLATE_CHARS=50000 `
  FREE_TIER_LIMIT_TTS_CHARS=50000 `
  MAX_ACCOUNTS_PER_FINGERPRINT=3 `
  SENTRY_DSN="https://xxx@oxxx.ingest.sentry.io/yyyy" `
  LOGTAIL_SOURCE_TOKEN="xxxxxxxxxxxx" `
  REDIS_URL="rediss://default:xxx@xxx.upstash.io:6379"
```

**Note:** `CORS_ORIGINS` set tạm về dev extension ID (lấy từ `chrome://extensions` sau khi load unpacked). Sau khi Chrome Web Store published, update lại theo §10.

**Tra cứu API keys** nếu chưa có:

- Deepgram: https://console.deepgram.com/project/default/keys
- Gemini: https://aistudio.google.com/apikey
- Azure Translator: https://portal.azure.com → Cognitive Services → Translator → Keys
- Azure Speech: https://portal.azure.com → Cognitive Services → Speech → Keys
- Resend: https://resend.com/api-keys
- Polar: https://sandbox.polar.sh → Settings → API → Generate token (CHỌN sandbox cho beta)

### 4.3. GCP TTS service account file

Fly secrets không lưu file. Cách giải quyết:

**Option A** (đơn giản nhất — Fly volume):

```powershell
fly volumes create gcp_secrets --region sin --size 1
```

Sau đó cập nhật `fly.toml`:

```toml
[[mounts]]
  source = "gcp_secrets"
  destination = "/app/secrets"
```

Rồi `scp` file vào machine sau khi deploy:

```powershell
fly ssh sftp shell
> put backend/secrets/gcp-tts-service-account.json /app/secrets/gcp-tts.json
> exit
```

Set secret:

```powershell
fly secrets set GOOGLE_CLOUD_TTS_KEY_FILE="/app/secrets/gcp-tts.json"
```

**Option B** (inline JSON — đơn giản, không cần volume):
Sửa `backend/src/providers/tts/google-cloud-tts-provider.ts` nhận env `GOOGLE_TTS_CREDENTIALS_JSON` (raw JSON string) thay cho file path. Defer — option A đơn giản hơn cho v1.

### 4.4. First deploy

Từ repo root:

```powershell
fly deploy
```

Đợi 3–5 phút. Output sẽ ra `https://translate-voice-backend.fly.dev`.

### 4.5. Verify

```powershell
curl https://translate-voice-backend.fly.dev/health
```

Phải return `{"ok":true,"mongo":"connected"}`.

**Tail logs:**

```powershell
fly logs
```

Phải thấy Pino logs tới Logtail (dashboard → Sources → live tail).

**Sentry check:** trigger error qua `curl -X POST https://translate-voice-backend.fly.dev/auth/magic-link/request -H "Content-Type: application/json" -d '{"email":"invalid"}'`. Lỗi 400 sẽ không vào Sentry (handled), nhưng kiểm tra dashboard sau ~5 phút có message gì.

---

## 5. Polar.sh setup (30 phút, $0 sandbox)

### 5.1. Sandbox vs Production

**Khuyến nghị closed beta wave 1:** dùng **sandbox** trước, verify webhook flow xong → switch sang live (§6) trước khi mời user trả tiền.

### 5.2. Sandbox setup

- **Link:** https://sandbox.polar.sh
- Đăng ký bằng GitHub.
- **Create organization** → name `translate-voice` (hoặc bất kỳ).

### 5.3. Tạo Pro product

- Dashboard → **Products** → **Create product**:
  - Name: `Pro`
  - Type: **Subscription**
  - Price: $5 USD / month
  - Description: "Unlimited dubbing, priority pipeline"
- Sau khi tạo → click vào product → **Checkout Links** → **Create checkout link** → copy URL (dạng `https://sandbox.polar.sh/<org>/<product>`). Đây là `POLAR_PRO_CHECKOUT_URL`.
- **Product ID** hiện trên trang product detail (dạng `prod_xxx`). Lưu cho `POLAR_PRODUCT_ID_PRO`.

### 5.4. API token

- **Settings → API → Generate new token** → name `translate-voice-backend` → Permissions: read+write subscriptions, products. Copy token (dạng `polar_oat_xxx`). Lưu cho `POLAR_API_KEY`.

### 5.5. Webhook setup

- Backend Fly URL: `https://translate-voice-backend.fly.dev/billing/webhook`
- Dashboard → **Webhooks** → **Create webhook**:
  - URL: `https://translate-voice-backend.fly.dev/billing/webhook`
  - Format: **Raw**
  - Events: tick `subscription.created`, `subscription.updated`, `subscription.canceled`
- Sau khi tạo → click webhook → **Reveal secret** → copy (dạng `whsec_xxx`). Lưu cho `POLAR_WEBHOOK_SECRET`.

### 5.6. Update Fly secrets với các giá trị mới

```powershell
fly secrets set `
  POLAR_API_KEY="polar_oat_xxx" `
  POLAR_PRODUCT_ID_PRO="prod_xxx" `
  POLAR_PRO_CHECKOUT_URL="https://sandbox.polar.sh/<org>/<product>" `
  POLAR_WEBHOOK_SECRET="whsec_xxx" `
  POLAR_SERVER="sandbox"
```

Fly tự redeploy sau khi update secrets.

---

## 6. Polar sandbox smoke test (30 phút, $0)

Theo `docs/deployment-guide.md §7.4` — 9-step E2E. Tóm tắt:

1. Sign in qua extension (load unpacked với backend Fly URL — sửa `extension/.env` hoặc build với `VITE_BACKEND_API_URL=https://translate-voice-backend.fly.dev`).
2. `curl https://translate-voice-backend.fly.dev/billing/me -H "Authorization: Bearer <JWT>"` → `tier: 'free'`.
3. Click Upgrade trong popup → mở sandbox checkout.
4. Pay với Polar test card: số `4242 4242 4242 4242`, expiry bất kỳ tương lai, CVC `123`.
5. Theo dõi `fly logs` → phải thấy `[polar-webhook] Pro subscription activated for user ...`.
6. Mongo Atlas → cluster → **Collections** → `subscriptions` → tìm document với `userId=<your-id>`, `status='active'`, `tier='pro'`.
7. Reload popup → tier badge "Pro" + "Unlimited" quota.
8. Re-fetch `/billing/me` → `{ tier: 'pro', limits: { seconds: null, ... } }`.
9. **Cancel test:** Polar sandbox dashboard → cancel subscription → log phải thấy `subscription.canceled` event.

**Pass criteria:** tất cả 9 step xong, không có error trong Fly logs hoặc Sentry.

---

## 7. Design icons + screenshots (30–90 phút, $0–80)

### 7.1. Icons (16/48/128 PNG)

Hiện tại `extension/public/icon-*.png` là placeholder. Chrome reject ngay.

**3 lựa chọn:**

**Option A — AI gen (rẻ + nhanh):**

- Midjourney v6 ($10/tháng):
  ```
  Chrome browser extension icon, speech bubble with letter A and Vietnamese tone mark, flat design, blue #2563EB primary color, amber accent, 128x128, transparent background, simple, professional, --no shadows --no 3d --no text-blur
  ```
- DALL-E 3 qua ChatGPT Plus ($20/tháng).
- Output: 1024×1024 PNG → resize sang 16/48/128 qua https://imageresizer.com/ (drag-drop).

**Option B — Fiverr designer ($20–80, 24–48h):**

- https://www.fiverr.com/categories/graphics-design/icon-design
- Search "chrome extension icon", filter rating ≥4.8.
- Brief: gửi `docs/icon-design-brief.md` từ repo.

**Option C — Tự design Figma:**

- https://www.figma.com/ free tier.
- Theo brief trong `docs/icon-design-brief.md`.

**Sau khi có icons:**

1. Replace 3 file: `extension/public/icon-16.png`, `icon-48.png`, `icon-128.png`.
2. `pnpm -F extension build` → verify icons xuất hiện trong `.output/chrome-mv3/`.

### 7.2. Screenshots (1280×800, 1–5 ảnh)

Chrome bắt buộc ≥1, recommend 3–5.

**Capture sau khi backend deployed:**

1. Load extension dev unpacked, mở https://www.youtube.com/watch?v=<creative-commons-video> (vd Big Buck Bunny).
2. Toggle Translate Voice ON → đợi pipeline chạy → screenshot full window 1280×800.
3. Repeat cho:
   - Popup quota bars
   - Language picker
   - Bilingual subtitle overlay
   - Pro upgrade button

**Tool:**

- Windows: built-in Snipping Tool (Win+Shift+S) → save PNG. Resize/annotate qua https://www.photopea.com/ (free Photoshop alternative).
- Annotations: dùng Figma free để add text + arrow trên 1280×800 frame template.

---

## 8. Chrome Web Store dev account (10 phút, $5)

- **Link:** https://chrome.google.com/webstore/devconsole/
- Đăng nhập bằng Google account (account này sẽ own publishing).
- **Accept developer agreement** + pay **$5 one-time** registration fee (Visa/Mastercard).
- **Verify identity** (Google đôi khi yêu cầu) — submit ID nếu có prompt.
- **Enable 2FA** trên Google account nếu chưa (Chrome yêu cầu cho publishers).

---

## 9. Submit Chrome Web Store (45 phút + 1–3 ngày review)

### 9.1. Production build

```powershell
pnpm -F extension build --mode production
```

Output: `.output/chrome-mv3/`. **Note version trong `extension/package.json`** — bump nếu muốn (vd `0.1.0` → `0.2.0`).

### 9.2. Zip the build

```powershell
Compress-Archive -Path .output/chrome-mv3/* -DestinationPath translate-voice-v0.1.0.zip
```

Size phải < 50 MB (current ~42.5 MB).

### 9.3. Upload + fill listing

1. Chrome Web Store dashboard → **New item** → upload `translate-voice-v0.1.0.zip`.
2. **Store listing tab:**
   - Title: paste từ `docs/chrome-store-submission.md §2.1` (`Translate Voice — Vietnamese voice-over for YouTube`)
   - Summary: paste từ `§2.1 description`
   - Description: paste full block từ `§2.2 EN version`
   - Category: **Productivity**
   - Language: English (primary) + Vietnamese
   - Upload icons + screenshots + promo tile small (nếu có)
   - **Privacy policy URL:** paste GitHub Pages URL từ §3 (vd `https://letranngoc.github.io/privacy`)
3. **Privacy practices tab:**
   - Trả lời theo `docs/chrome-store-submission.md §4` (collect email + usage data; KHÔNG collect financial/location/etc).
   - Permission justifications: paste từ `§3` cho mỗi permission (`tabCapture`, `offscreen`, `storage`, `identity`, `activeTab`, host `*://*.youtube.com/*`).
   - Single purpose statement: paste từ `§2.4`.
   - Remote code: **No** (tick).
4. **Distribution tab:**
   - Visibility: **Private** (chỉ trusted tester emails see) cho closed beta wave 1.
   - Hoặc **Unlisted** (anyone với link install được, nhưng không xuất hiện trong store search) — cho phép invite-by-link.
   - **Public** ONLY sau wave 2+.
   - Countries: All countries (hoặc chỉ Vietnam + diaspora).

### 9.4. Submit for review

- Click **Submit for review**.
- Wait time: **1–3 ngày làm việc** thường. First-time publisher có thể tới 7 ngày.
- Email notification khi approved / rejected.

### 9.5. Common rejection reasons (đọc trước để tránh):

- Permission không justify rõ → triple-check §3 paste đúng.
- Privacy policy 404 → mở URL trong incognito verify.
- Icons quá đơn giản / placeholder → đảm bảo design real.
- Screenshot không thể hiện functionality → 1 ảnh phải show extension running on YouTube.

---

## 10. Post-approval: production wiring (15 phút)

Sau khi Chrome approve + extension published:

### 10.1. Lấy production extension ID

- Chrome Web Store published URL: `https://chrome.google.com/webstore/detail/<slug>/<extension-id>`
- Hoặc dashboard → item → copy ID (32-char hex).

### 10.2. Update Fly secret

```powershell
fly secrets set CORS_ORIGINS="chrome-extension://<PROD_ID>,chrome-extension://<DEV_ID>"
```

**Note:** giữ DEV_ID để bạn vẫn test dev unpacked được cùng lúc.

Cũng update `ALLOWED_EXTENSION_IDS` nếu đã set:

```powershell
fly secrets set ALLOWED_EXTENSION_IDS="<PROD_ID>,<DEV_ID>"
```

### 10.3. Polar webhook URL (verify đã set đúng)

Polar dashboard → Webhook → URL phải là `https://translate-voice-backend.fly.dev/billing/webhook`. Đã set ở §5.5 — chỉ verify lại.

### 10.4. Switch Polar sang LIVE (nếu muốn nhận thanh toán thật)

Trước khi mời user trả tiền:

1. Đăng ký https://polar.sh (production, KHÔNG sandbox) — link riêng từ sandbox.
2. Repeat §5.3–5.5 trên production environment.
3. Update Fly secrets:
   ```powershell
   fly secrets set `
     POLAR_API_KEY="polar_oat_<live>" `
     POLAR_PRODUCT_ID_PRO="prod_<live>" `
     POLAR_PRO_CHECKOUT_URL="https://buy.polar.sh/<live-slug>" `
     POLAR_WEBHOOK_SECRET="whsec_<live>" `
     POLAR_SERVER="production"
   ```

### 10.5. Wave 1 invite (50 user)

- Tạo waitlist form: Tally.so (free), Google Form, hoặc Notion form.
- Email template (sample):

  ```
  Subject: You're in! Translate Voice closed beta wave 1

  Cài extension tại: <chrome-web-store-url>
  Đăng nhập bằng Google hoặc email magic-link.
  Free 15 phút/ngày dubbing, Pro $5/tháng unlimited.

  Feedback: <github-issues-url>
  ```

### 10.6. Monitor week 1

- **Fly metrics:** `fly status` → check uptime, machine health
- **Sentry:** dashboard daily → triage errors
- **Logtail:** dashboard search "error" → spot patterns
- **Upstash:** check command count (free tier 10k/day)
- **Polar:** dashboard → MRR + churn
- **Chrome Web Store:** dashboard → installs, uninstalls, reviews — respond reviews trong 48h

---

## Tổng hợp checklist

- [ ] §1.1 Fly.io account + flyctl install
- [ ] §1.2 Sentry — 2 DSNs (backend + extension)
- [ ] §1.3 Logtail source token
- [ ] §1.4 Upstash Redis URL
- [ ] §2 MongoDB Atlas (nếu chưa)
- [ ] §3 Privacy policy hosted (GitHub Pages)
- [ ] §4 Fly deploy + verify `/health`
- [ ] §5 Polar sandbox setup
- [ ] §6 Polar smoke test 9 steps PASS
- [ ] §7 Icons + 3–5 screenshots
- [ ] §8 Chrome dev account $5
- [ ] §9 Submit + wait approval
- [ ] §10 Post-approval CORS update + invite wave 1

---

## Unresolved questions

1. Có register domain riêng `translate-voice.io` không, hay dùng `translate-voice-backend.fly.dev` cho v1?
2. Polar live (§10.4) ngay khi launch hay defer 1–2 tuần sau wave 1 (chỉ free)?
3. Waitlist tool — Tally / Google Form / Notion / tự host?

## References

- Cook + review reports: `plans/reports/*.md`
- Deployment local + production checklist: `docs/deployment-guide.md`
- Chrome Web Store submission detail: `docs/chrome-store-submission.md`
- Privacy policy template: `docs/privacy-policy.md`
- Icon design brief: `docs/icon-design-brief.md`
- Operator semantic cutover notes: `docs/deployment-guide.md §10`
