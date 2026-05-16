# Icon Design Brief — Translate Voice

> Brief cho designer (hoặc AI image gen tool như Midjourney / DALL-E) để tạo icon Chrome Web Store quality. Current icons trong `extension/public/icon-*.png` là placeholder 79-306 byte cần thay.

---

## 1. Brand essence

- **Product:** Real-time Vietnamese voice-over cho YouTube
- **Personality:** Trustworthy, friendly, accessible, modern
- **Avoid:** Generic translator icons (globe + arrow), robot/AI tropes, YouTube red (legal risk + visual confusion)

---

## 2. Concept ideas (pick 1 hoặc combine)

### Option A — Speech bubble + Vietnamese diacritic
- Speech bubble shape (representing voice/dubbing)
- Vietnamese letter "Ă" or "Ư" or "VN" inside the bubble
- Conveys: voice + Vietnamese language

### Option B — Sound wave + flag dot
- Stylized sound waveform (3-5 vertical bars, ascending)
- Single red dot in the lower-right corner (Vietnamese flag accent, but DO NOT use full flag — copyright/political risk)
- Conveys: audio + Vietnamese origin

### Option C — Headphone + Vietnamese diacritic accent
- Minimalist headphone outline
- Vietnamese tone-mark (accent grave `̀` or circumflex `̂`) above
- Conveys: listening + Vietnamese

**Recommended: Option A** — most recognizable at 16×16 (tray icon size). Speech bubble silhouette stays readable when scaled down; sound waves blur into a single line at 16×16.

---

## 3. Technical requirements

| Spec | Value |
|---|---|
| Format | PNG, RGBA (transparent background) |
| Sizes | 16×16, 48×48, 128×128 (3 files, same design scaled) |
| Color depth | 8-bit/channel, alpha enabled |
| File size | Each < 50KB (Chrome cap 16KB/32KB/128KB but smaller is better) |
| Padding | 10-12% padding inside the canvas (Chrome adds its own frame at small sizes) |
| Style | Flat or subtle gradient — no skeuomorphic shadows, no 3D |

### 16×16 special handling
- 16×16 is the **hardest size**. Most icons fail here.
- Test the icon by squinting at 16×16 — if you can't read it, simplify.
- Use only 1-2 colors at 16×16. Detail < 2px is invisible.
- Outline weight: minimum 1px at 16×16, scale up proportionally.

---

## 4. Color palette (suggested)

| Role | Hex | Notes |
|---|---|---|
| Primary | `#2563EB` (blue-600 Tailwind) | Trust, calm, tech |
| Accent | `#FBBF24` (amber-400) | Warm, friendly highlight |
| Optional VN accent | `#DC2626` (red-600) | Vietnam flag color — use sparingly, as a 4-8px dot only |
| Background | transparent | Required |

Avoid:
- ❌ YouTube red (`#FF0000`) — visual conflict with parent platform
- ❌ Pure black/white — too generic
- ❌ Gradients spanning >2 colors — blurs at small sizes

---

## 5. Promo tile assets (post-launch, optional but helpful for featured)

Chrome Web Store rewards listings with promo tiles. After v1 launches and gets 100+ installs, consider:

| Asset | Spec | Purpose |
|---|---|---|
| Small promo tile | 440×280 PNG/JPG | Required for "featured" sections |
| Large promo tile | 920×680 | Search results, suggested |
| Marquee | 1400×560 | Front-page features |

Tile content guidelines:
- Logo top-left at ~80px
- Tagline center: "Real-time Vietnamese voice-over for YouTube" — Inter Bold 32-40px
- Right side: stylized phone/laptop mockup with extension popup visible
- Background: subtle gradient from primary blue → lighter blue
- No screenshot-looking content (Chrome rejects "deceptive" tiles)

---

## 6. Screenshots (1280×800, 1-5 ảnh, bắt buộc ≥1)

Capture sau khi backend deployed + extension installed:

1. **Extension popup with quota bars** (320×640 → embedded into 1280×800 with annotation)
   - Annotation: "Quota dashboard tracks your daily free-tier usage"
2. **YouTube video with Vietnamese subtitle overlay**
   - Show a real video frame (use Creative Commons content to avoid copyright)
   - Annotation: "Bilingual subtitles flow side-by-side"
3. **Language picker** (popup showing 7 source + 1 target VN)
   - Annotation: "7 source languages, Vietnamese target"
4. **In-page badge ON state**
   - Annotation: "Toggle translation on any YouTube tab"
5. **Pro upgrade flow**
   - Annotation: "Upgrade to Pro $5/month for unlimited dubbing"

**Tools cho annotation:** Figma (free) — duplicate the 1280×800 frame template, drop screenshot, add text + arrow.

---

## 7. Quick options nếu KHÔNG có designer

### Option 1 — AI image generation
- **Midjourney v6:** prompt = `"Chrome browser extension icon, speech bubble with letter A and Vietnamese tone mark, flat design, blue #2563EB primary color, amber accent, 128x128, transparent background, simple, professional, --no shadows --no 3d"`
- **DALL-E 3** via ChatGPT Plus: same prompt
- **Output:** 1 PNG ở 1024×1024, downscale qua https://imagecompressor.com/ hoặc ImageMagick

### Option 2 — Stock icon platforms
- **Iconfinder, Flaticon** — search "voice translation" license CC0/PRO
- Adjust colors trong Figma/Photopea (free Photoshop alternative)

### Option 3 — Hire on Fiverr / 99designs
- $20-80 cho icon set 16/48/128 + promo tile
- 24-48h turnaround
- Search keyword: "chrome extension icon design"

---

## 8. Acceptance checklist

Designer hand off — verify trước khi commit vào `extension/public/`:

- [ ] 3 PNG files: `icon-16.png`, `icon-48.png`, `icon-128.png` — exact sizes
- [ ] Transparent background (verify trên dark + light Chrome theme)
- [ ] File size < 50KB each
- [ ] 16×16 readable at actual size (test trong Chrome dev mode load unpacked)
- [ ] Design consistent across 3 sizes (not 3 different concepts)
- [ ] No text smaller than 3px at 16×16
- [ ] No copyrighted elements (Vietnam flag full, YouTube logo, etc.)

Sau khi commit, run `pnpm -F extension build` và verify icons xuất hiện trong `.output/chrome-mv3/icon-*.png`.

---

## Unresolved questions

1. Brand colors — chọn từ palette trên hay user có color guideline khác?
2. Có dùng Vietnam flag dot không (legal risk thấp ở scale nhỏ, nhưng có thể trigger political review ở 1 số region)?
3. Designer hire / AI gen / DIY Figma — user pick approach nào?
