Place your app icon source image here as `icon-source.png`.

Recommended:
- size: 1024x1024 (or larger)
- transparent background
- no watermark

Build icons:
- `pnpm icons:build`
- `pnpm icons:mac` (macOS only, generates `build/icons/icon.icns`)

Notes:
- If `assets/icon-source.png` is missing, scripts fallback to `src/assets/vue.svg`.
- Replace the fallback by adding your own `assets/icon-source.png`.
