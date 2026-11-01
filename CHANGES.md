# 📝 Changelog

## 🛠️ v1.0.1 — Sign-in, downloads and YouTube controls

- Keep Yood bootstrap overlays and page integration scripts limited to
  YouTube domains so Google account pages remain unaffected during sign-in.
- Route Brave extension requests to the authenticated local download API
  through the extension service worker, avoiding cross-origin localhost
  requests from YouTube page context.
- Route Yood download and Watch later clicks in the capture phase so
  YouTube's own event handlers cannot swallow them.
- Make the URL bar toggle closed when activated again, and keep only the
  left-side URL control beside back, forward, and reload.
- Update the repository layout and Linux build instructions to reflect the
  current `build.sh` workflow.

## 🏷️ v1.0.0

First tagged release.

Layout:

- monorepo split into `linux/`, `windows/` and `shared/`
- `shared/` holds the companion extension, filter lists and frontend,
  referenced from both `src-tauri` trees via `../../shared/...`
- `linux/` builds AppImage/deb only, `windows/` builds NSIS only

YouTube integration:

- Brave app mode as the stable engine, isolated profile, Shields on
  with aggressive mode for YouTube plus Yood custom filters
- download buttons on watch / Shorts pages via the companion extension
- Alt+L quick-open bar, in-player ad-skip helper
- `yood://` deep links with single-instance handling
  (`yood://www.youtube.com/watch?v=ID`, `yood://download?url=...`)

Downloads:

- video / audio / songs modes through bundled `yt-dlp` + `ffmpeg`
- queue with concurrency limit, live progress, speed and ETA
- pause / resume / cancel / retry / remove, open file / open folder
- playlist and channel selection, duplicate handling, disk-space checks,
  subtitle / thumbnail / metadata options in advanced modes

Filtering:

- Brave Shields lists plus Yood built-in rules as custom filters
- extension `declarativeNetRequest` rules and cosmetic hiding
- Rust filter layer for WebView mode, 24h background updates with
  local cache and rollback, tracking protection optional

App:

- native-looking settings (appearance, playback, downloads, privacy,
  filtering, shortcuts, storage, about)
- local logging with levels ERROR/WARN/INFO/DEBUG/TRACE, no passwords,
  cookies or tokens in logs
- `yood --self-test` smoke test
- per-user Linux install script (no root), Windows NSIS installer
- Google sign-in inside the app with an external-browser fallback
  if the embedded view is refused

Notes:

- the embedded WebKit view is debug-only on Linux (`YOOD_WEBVIEW=1`).
  Brave app mode is the supported path for watching.
- release bundles need real `yt-dlp` / `ffmpeg` binaries staged before
  packaging (see `prepare-binaries.sh` / `build-windows.ps1`).
