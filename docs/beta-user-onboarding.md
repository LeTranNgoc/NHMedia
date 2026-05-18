# Translate Voice — Hướng dẫn cho Beta User

> Đọc cái này nếu bạn vừa nhận lời mời beta. Mục tiêu: từ "click link" → "nghe lồng tiếng câu đầu tiên" trong **5 phút**.

## Yêu cầu

- **Trình duyệt:** Chrome 120+ hoặc Edge 120+ (Chromium-based). Firefox/Safari chưa hỗ trợ.
- **Hệ điều hành:**
  - **Windows 10/11** ✅ — giọng `Microsoft Hanh` / `Microsoft An` (vi-VN) cài sẵn (Settings → Time & Language → Speech → Add voice → Tiếng Việt).
  - **macOS** ✅ — giọng `Linh` (vi-VN) cài sẵn.
  - **Linux** ⚠️ — phụ thuộc speech-dispatcher. Chất lượng giọng thay đổi. Backend tự động fallback Cloud TTS.
- **Mic / audio output:** loa hoặc tai nghe đang hoạt động (test bằng cách phát 1 video bất kỳ).
- **Tài khoản Google** (để đăng nhập) — không bắt buộc Gmail, chỉ cần Google account.

## Bước 1 — Cài extension (1 phút)

1. Mở Chrome Web Store: **https://chromewebstore.google.com/detail/translate-voice/<EXTENSION_ID>**
   _(Beta wave 1: dùng link unlisted gửi trong email mời.)_
2. Bấm **Add to Chrome** → **Add extension**.
3. Sau khi cài, icon Translate Voice xuất hiện ở thanh extension (góc phải URL bar). **Click vào icon biểu tượng puzzle → ghim 📌** Translate Voice để thấy ngay.

## Bước 2 — Đăng nhập (1 phút)

1. Click icon Translate Voice. Popup hiện ra.
2. Tab **Account** → bấm **Sign in with Google**.
3. Chrome mở tab Google chọn account → cho phép → tab đóng lại tự động.
4. Popup chuyển sang trạng thái "Logged in as <email>".

Nếu Google chặn (organization restriction), click **Sign in with email** → nhập email → check inbox → click magic link.

## Bước 3 — Test lồng tiếng (2 phút)

1. Mở YouTube: **https://www.youtube.com**
2. Chọn 1 video tiếng Anh có CC (chữ "CC" ở thanh điều khiển video).
3. **Bật CC** trên YouTube (click nút CC dưới video) — KHÔNG BẮT BUỘC, extension tự động bật nếu video có caption track.
4. Phát video.
5. Click icon Translate Voice → tab **Main** → bật toggle **Translate Voice ON**.
6. Đợi 2-3 giây, bạn sẽ nghe giọng Vietnamese phát cùng lúc với speaker.

## Bước 4 — Tinh chỉnh (1 phút)

Tab **Settings**:

- **Source language:** mặc định `auto` (English chuẩn nhất). Đổi nếu video tiếng khác.
- **Target language:** mặc định `Vietnamese (Tiếng Việt)`.
- **Audio mode:** mặc định `Voice-over` (giảm âm thanh gốc, chồng dub lên). Đổi `Replacement` để mute hẳn audio gốc.
- **Ducking percent:** 30% — âm thanh gốc giảm còn 30% khi dub phát. Tăng để dub rõ hơn.
- **Speech rate:** 1.56 — tốc độ đọc dub. Giảm 1.0-1.2 nếu thấy nhanh, tăng 1.8-2.0 cho video talky.
- **Subtitle:** ON — hiện text Vietnamese ở dưới video. Tắt nếu muốn nghe-only.
- **Auto CC:** ON — tự động dùng YouTube CC khi có. OFF buộc dùng ASR (chậm hơn, tốn quota).

## Bước 5 — Daily usage caps

Free tier có giới hạn ngày:

- **Audio capture:** 15 phút/ngày
- **Translate:** 50,000 ký tự/ngày
- **TTS:** 50,000 ký tự/ngày

Reset 00:00 UTC mỗi ngày. Hit cap → extension dừng + popup hiện "quota exceeded".

Upgrade Pro (nếu đã enable) trong tab **Account** → **Upgrade to Pro** — giới hạn cao hơn 20× + ưu tiên audio quality.

## Troubleshooting

### "Không nghe được dub"

1. Check loa / tai nghe có ON không (test video khác).
2. Mở popup → Main → status badge có nói "Capturing" không?
3. Reload tab YouTube → toggle OFF rồi ON lại.
4. Nếu vẫn không → reload extension: `chrome://extensions` → tìm Translate Voice → bấm 🔄.

### "Dub bị trễ lâu"

- Voice-over kiểu này luôn trễ 1-1.5s sau speaker. Đó là bình thường.
- Trễ > 3s: backend quá tải. Báo cho admin (link Discord trong email mời).

### "Dub bị ngắt giữa chừng"

- Tab YouTube chuyển video → extension auto-restart (~2-3 giây gián đoạn). Bình thường.
- Liên tục ngắt: clear cache, reload extension. Nếu vẫn → bug, gửi log (xem dưới).

### "Một câu lồng tiếng 2-3 lần"

- Đã fix trong build 2026-05-19. Nếu vẫn gặp, bạn đang dùng build cũ → update extension trên Chrome Web Store.

### Gửi log cho dev khi gặp bug

1. Click icon Translate Voice → right-click → **Inspect popup**.
2. Tab **Console** → click chuột phải → **Save as...** → file `popup-log.txt`.
3. Đồng thời: `chrome://extensions` → tìm Translate Voice → click **service worker** → **Console** → save.
4. Gửi cả 2 file qua Discord (kèm video URL + thời điểm bug xảy ra).

## Privacy

- Audio từ tab capture chỉ stream tới backend Translate Voice, không lưu.
- Translation + TTS đi qua Groq (Llama) + Google Cloud TTS. Không lưu transcript.
- Detail: [privacy-policy.md](./privacy-policy.md)

## Feedback

- Discord: <BETA_DISCORD_INVITE>
- Email: <BETA_FEEDBACK_EMAIL>
- Báo bug: kèm video URL + log (xem trên) + mô tả 1-2 câu.

Welcome to closed beta. 🎙️
