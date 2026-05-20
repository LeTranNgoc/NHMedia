# Privacy Policy — Translate Voice

> **Template** — user copy ra file riêng + host công khai trước khi submit Chrome Web Store. Thay placeholder `<...>` bằng giá trị thật.

**Effective date:** <DD MONTH YYYY>
**Last updated:** <DD MONTH YYYY>

---

## 1. Who we are

Translate Voice ("the extension", "we", "us") is a Chrome browser extension that provides real-time Vietnamese voice-over for YouTube videos. The extension is operated by **<YOUR_LEGAL_NAME>** (`<YOUR_SUPPORT_EMAIL>`).

---

## 2. What data we collect

We collect the **minimum** data necessary to operate the service.

### 2.1 Account data (required to sign in)

- **Email address** — to authenticate you via Google OAuth or magic-link.
- **Google OAuth profile ID** — when you sign in with Google, we receive a Google-issued user ID. We do NOT receive your password, name, photo, or contact list.

### 2.2 Usage data (required for quota enforcement)

- **Seconds of audio captured** — daily for free tier (15 min/day cap), monthly for paid tiers (5h / 15h / 40h / 200h per month depending on tier).
- **Characters translated per day** — to enforce the translate-chars quota (free tier only; unlimited on paid tiers).
- **Characters synthesized as speech per day** — to enforce the TTS-chars quota (free tier only; unlimited on paid tiers).

We do **NOT** store the content of the audio, the transcripts, or the translations themselves. Only the **counts** are persisted.

### 2.3 Audio data (streamed, never stored)

When you enable capture on a YouTube tab:

- The extension captures the audio track of the active tab.
- The audio is streamed in real-time to our backend via a WebSocket connection.
- The backend forwards the audio to a third-party automatic-speech-recognition (ASR) service (Deepgram), which returns a text transcript.
- The transcript is translated to Vietnamese by Google Gemini or Microsoft Azure Translator.
- The translation is synthesized to speech by Google Cloud Text-to-Speech or Microsoft Azure Speech.
- The synthesized audio is streamed back to the extension for playback.

**Nothing in this pipeline is persisted on our servers.** Audio buffers are processed in-memory and discarded. Transcripts and translations are forwarded immediately and not logged.

### 2.4 Billing data (paid tiers only)

If you upgrade to a paid tier (Starter $4.99/mo, Standard $9.99/mo, Pro $19.99/mo, or Unlimited $39.99/mo):

- Payment is processed by **Polar.sh**. Card numbers, billing address, and tax details are collected by Polar, never by us.
- We store **only** a Polar subscription ID + the Polar product ID identifying your tier + status (`active` / `canceled`) + the time window the subscription is valid for. This is what we use to unlock the corresponding tier on your account.

### 2.5 Technical data

- A JWT (JSON web token) is stored in `chrome.storage.local` to keep you signed in. It expires after 7 days.
- User preferences (source language, target language, audio mode) are stored in `chrome.storage.sync` and roam across your Chrome installations.

We do **NOT** collect:

- Browsing history outside YouTube
- Cookies from other sites
- Keystrokes or clipboard content
- Geolocation
- Device fingerprints beyond what is necessary to detect free-tier abuse (hashed extension install ID + IP at sign-up only, not on every request)

---

## 3. How we use the data

| Data                  | Purpose                                            | Legal basis (EU GDPR)                      |
| --------------------- | -------------------------------------------------- | ------------------------------------------ |
| Email + OAuth ID      | Authenticate sign-in, identify your account        | Contract — required to deliver the service |
| Per-day usage counts  | Enforce free-tier quota; show usage in popup       | Legitimate interest — prevent abuse        |
| Streamed audio        | Generate the dubbed Vietnamese audio you requested | Contract — that IS the service             |
| Polar subscription ID | Unlock Pro tier when you pay                       | Contract                                   |
| JWT                   | Keep you signed in between sessions                | Legitimate interest — UX                   |

We do **NOT**:

- Sell your data to third parties
- Use your data for advertising or profiling
- Train AI models on your audio, transcripts, or usage
- Share data with any party except the processors listed in Section 4

---

## 4. Third-party data processors

We share data with the following processors strictly to deliver the service:

| Processor                    | What we send                                           | Why                                                                 | Their privacy policy                                 |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------- |
| Deepgram (US)                | Audio frames (streamed, not stored by us)              | Speech-to-text transcription                                        | https://deepgram.com/privacy                         |
| Google Cloud (Google LLC)    | Transcript text + signed-in user's email (for billing) | Translation (Gemini), text-to-speech (Cloud Neural2), OAuth sign-in | https://policies.google.com/privacy                  |
| Microsoft Azure (Microsoft)  | Transcript text                                        | Translation fallback, text-to-speech fallback                       | https://privacy.microsoft.com                        |
| Polar Software Inc. (US)     | Email + a Polar-side customer ID                       | Subscription billing                                                | https://polar.sh/legal/privacy                       |
| MongoDB Atlas (MongoDB Inc.) | Account record, usage counts, subscription state       | Database hosting                                                    | https://www.mongodb.com/legal/privacy/privacy-policy |
| Fly.io (US)                  | Backend server hosting                                 | Application runtime                                                 | https://fly.io/legal/privacy-policy/                 |
| Resend (US)                  | Email address + a magic-link token                     | Send sign-in emails                                                 | https://resend.com/legal/privacy-policy              |

We do not transfer your data to any other party.

---

## 5. Data retention

| Data                             | Retained for                                  |
| -------------------------------- | --------------------------------------------- |
| Account record (email, OAuth ID) | Until you delete your account                 |
| Daily usage counters             | 30 days, then deleted                         |
| Subscription records             | 7 years (legal accounting requirement)        |
| Magic-link tokens                | 15 minutes (auto-expired in DB via TTL index) |
| Streamed audio + transcripts     | 0 — never stored                              |
| Logs                             | 14 days                                       |

When you delete your account, all data except subscription records is removed within 7 days. Subscription records are retained because some jurisdictions require us to keep billing history.

---

## 6. Your rights

If you live in the EU/UK (GDPR), California (CCPA/CPRA), or a comparable jurisdiction, you have the right to:

- **Access** — request a copy of your data
- **Correct** — fix inaccurate data
- **Delete** — close your account and remove your data
- **Portability** — receive your data in machine-readable format
- **Object** — opt out of legitimate-interest processing
- **Withdraw consent** — stop using the extension at any time

To exercise any of these rights, email **`<YOUR_SUPPORT_EMAIL>`** with subject "Privacy request" and we will respond within 30 days.

---

## 7. Children's privacy

Translate Voice is not directed at children under 13 (under 16 in some EU countries). We do not knowingly collect data from children. If you believe a child has signed up, email us and we will delete the account.

---

## 8. Security

- All network traffic uses TLS 1.2+ (HTTPS / WSS).
- JWTs are signed with HS256 + a 32-byte secret rotated periodically.
- Database access is restricted by IP allowlist + role-based credentials.
- Polar webhook payloads are verified by HMAC SHA-256 before processing.
- We do not store passwords (OAuth and magic-link only).

No system is 100% secure. If you discover a vulnerability, please email **`<YOUR_SECURITY_EMAIL>`** with subject "Security disclosure" — we follow a 90-day responsible disclosure window.

---

## 9. Changes to this policy

If we change this policy, we will:

- Update the "Last updated" date at the top.
- For material changes, send an in-extension notification + email to your account address.
- Continued use after the effective date constitutes acceptance.

---

## 10. Contact

- **General:** `<YOUR_SUPPORT_EMAIL>`
- **Security:** `<YOUR_SECURITY_EMAIL>`
- **Data Protection Officer (EU):** `<YOUR_DPO_EMAIL>` (not required for our size; provide if you appoint one)
- **Legal entity / postal address:** `<YOUR_LEGAL_NAME>`, `<YOUR_POSTAL_ADDRESS>`

---

> **Where to host this file:**
>
> 1. Copy this markdown to a public URL — GitHub Pages, Netlify drop, Vercel, hoặc subpath của domain (vd `translate-voice.io/privacy`).
> 2. URL phải HTTPS + publicly accessible (không sau auth).
> 3. Paste URL vào Chrome Web Store submission form ("Privacy policy URL").
> 4. Paste URL vào `chrome-store-submission.md §1.2` để team biết.
