<div align="center">

# 🎥 Yood

A small, private desktop YouTube app. Yood uses Brave app mode when available; Windows falls back to Tauri WebView if Brave is not installed.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/Rust-stable-orange.svg)](https://www.rust-lang.org)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-blue.svg)](https://tauri.app)

</div>

Current version: **1.0.1**

Yood is a Rust/Tauri app. The main window is just YouTube itself; Yood adds the download manager, filtering, settings, and an optional local player around it.

---

## ✨ What it does

- Opens the real YouTube site in Brave app mode when Brave is available, and falls back to Tauri WebView on Windows otherwise.
- In Brave mode, keeps Brave Shields on with aggressive mode for YouTube, plus Yood's own rules.
- Injects download buttons on watch and Shorts pages through a companion extension.
- Handles `yood://` deep links and single-instance focus.
- Downloads video / audio / songs with `yt-dlp` + `ffmpeg`, with live progress.
- Optional native player window and ad-skip helper.

## 🗂️ Project layout

```text
├── 📁 linux
│   ├── 📁 scripts
│   │   └── 🐚 build.sh
│   ├── 📁 src-tauri
│   │   ├── 📁 capabilities
│   │   │   └── ⚙️ default.json
│   │   ├── 📁 gstreamer
│   │   │   ├── 🔧 libgstautodetect.so
│   │   │   └── 🔧 libgstpipewire.so
│   │   ├── 📁 icons
│   │   │   ├── 🖼️ icon.ico
│   │   │   ├── 🖼️ icon.png
│   │   │   └── 🖼️ icon.svg
│   │   ├── 📁 src
│   │   │   ├── 🦀 browser.rs
│   │   │   ├── 🦀 commands.rs
│   │   │   ├── 🦀 desktop.rs
│   │   │   ├── 🦀 download.rs
│   │   │   ├── 🦀 error.rs
│   │   │   ├── 🦀 filtering.rs
│   │   │   ├── 🦀 lib.rs
│   │   │   ├── 🦀 logging.rs
│   │   │   ├── 🦀 main.rs
│   │   │   ├── 🦀 models.rs
│   │   │   ├── 🦀 process.rs
│   │   │   ├── 🦀 secure.rs
│   │   │   ├── 🦀 security.rs
│   │   │   ├── 🦀 settings.rs
│   │   │   └── 🦀 updates.rs
│   │   ├── 🦀 build.rs
│   │   ├── 📦 Cargo.lock
│   │   ├── 📦🦀 Cargo.toml
│   │   └── ⚙️ tauri.conf.json
│   ├── 📖 README.md
│   └── 🐚 run.sh
├── 📁 shared
│   ├── 📁 extension
│   │   └── 📁 yood
│   │       ├── 🟨 background.js
│   │       ├── 🟨 content.js
│   │       ├── 🌐 manifest.json
│   │       └── ⚙️ rules.json
│   ├── 📁 filters
│   │   └── 📝 default.txt
│   ├── 📁 frontend
│   │   ├── 🟦 bootstrap.ts
│   │   ├── 🌐 downloads.html
│   │   ├── 🟦 downloads.ts
│   │   ├── 🌐 index.html
│   │   ├── 🟦 injection.ts
│   │   ├── 📦 package-lock.json
│   │   ├── 📦 package.json
│   │   ├── 🌐 player.html
│   │   ├── 🟦 player.ts
│   │   └── ⚙️🟦 tsconfig.json
│   └── 📖 README.md
├── 📁 windows
│   ├── 📁 scripts
│   │   └── 🪟 build-windows.ps1
│   ├── 📁 src-tauri
│   │   ├── 📁 capabilities
│   │   │   └── ⚙️ default.json
│   │   ├── 📁 icons
│   │   │   ├── 🖼️ icon.ico
│   │   │   ├── 🖼️ icon.png
│   │   │   └── 🖼️ icon.svg
│   │   ├── 📁 src
│   │   │   ├── 🦀 browser.rs
│   │   │   ├── 🦀 commands.rs
│   │   │   ├── 🦀 desktop.rs
│   │   │   ├── 🦀 download.rs
│   │   │   ├── 🦀 error.rs
│   │   │   ├── 🦀 filtering.rs
│   │   │   ├── 🦀 lib.rs
│   │   │   ├── 🦀 logging.rs
│   │   │   ├── 🦀 main.rs
│   │   │   ├── 🦀 models.rs
│   │   │   ├── 🦀 process.rs
│   │   │   ├── 🦀 secure.rs
│   │   │   ├── 🦀 security.rs
│   │   │   ├── 🦀 settings.rs
│   │   │   └── 🦀 updates.rs
│   │   ├── 🦀 build.rs
│   │   ├── 📦 Cargo.lock
│   │   ├── 📦🦀 Cargo.toml
│   │   └── ⚙️ tauri.conf.json
│   └── 📖 README.md
├── 📝 CHANGES.md
├── ⚖️ LICENSE
├── 📖 README.md
└── 📝 Yood_Technical_Specification.md
```

`shared/` is referenced from both `src-tauri` trees via `../../shared/...`.

## ✅ Requirements

Linux runtime:
- Brave (bundled portable or system `brave` / `brave-browser` / `brave-bin`)
- WebKit/GStreamer runtime for the optional WebView mode

Build:
- Rust toolchain (MSRV 1.80)
- Node.js
- Tauri Linux deps (WebKitGTK etc.)
- `curl`, `unzip`, `sha256sum`

Windows build additionally requires Visual Studio 2022 C++ Build Tools. The Windows application uses the system WebView2 runtime by default.

## 🐧 Linux build

One script does everything:

```bash
./linux/scripts/build.sh
```

It checks prerequisites, stages `yt-dlp` and `ffmpeg`, builds the frontend, and runs `cargo tauri build`. Add `--bundle-brave` if you want a portable Brave included.

For a quick dev run:

```bash
./linux/run.sh brave
```

## 🪟 Windows build

From PowerShell at the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\scripts\build-windows.ps1
```

That handles prerequisites, downloads `yt-dlp.exe` / `ffmpeg.exe`, builds the frontend, and produces the NSIS installer.

## 🔗 Usage notes

- Deep links: `yood://www.youtube.com/watch?v=ID`, `yood://download?url=...`
- A second `yood <url>` focuses the running instance instead of opening another.
- Self-test: `yood --self-test` (Linux or Windows) checks config, URL policy, filters, and extension manifest.

## 📁 Config and logs

Linux:
- Brave profile: `~/.local/share/com.playrood.yood/data/brave-profile`
- Extension: `~/.local/share/com.playrood.yood/data/yood-extension`
- Logs: `~/.local/share/com.playrood.yood/logs/yood.log`

Windows:
- Brave profile: `%APPDATA%\PlayRood\Yood\data\brave-profile`
- Logs: `%APPDATA%\PlayRood\Yood\logs\yood.log`

Logs never contain passwords, cookies, or tokens.

## ⚠️ Known limits

- On Linux, WebKit can still crash on YouTube player pages, so Linux defaults to Brave. Windows prefers installed or bundled Brave and falls back to Tauri WebView if none is found. Override with `YOOD_ENGINE=brave` or `YOOD_ENGINE=webview`.
- Hotspot-style DRM rentals are out of scope (no Widevine in portable Brave builds; regular YouTube doesn't need it).
- `https://` links can't open Yood without claiming all web traffic; use the `yood://` scheme.
- Release bundles must stage real `yt-dlp`/`ffmpeg` binaries before packaging. `linux/scripts/build.sh` and `build-windows.ps1` do this for you.

## 🛠️ Troubleshooting

- **Google sign-in appears stuck**: Yood does not run its YouTube integration on Google's sign-in page. If it stays open for 12 seconds, use the recovery banner to return to YouTube and retry without restarting Yood.
- **Download button does not queue a download**: update to the latest build. Brave's companion extension now relays its authenticated local requests through its service worker instead of issuing cross-origin localhost requests from the YouTube page.
- **Download buttons / Alt+L missing in Brave**: Chromium needs Developer Mode in the profile. Yood seeds it on first creation. If you ran an older build, delete the profile once and relaunch.
- **YouTube ads**: confirm the Yood log says it started with `Brave`. Brave mode uses Shields in aggressive mode, Yood's custom rules, and the companion extension; install Brave or build with bundled Brave if Yood falls back to WebView.
- **No Brave found**: set `YOOD_BRAVE_DIR`, run `./linux/scripts/build.sh --bundle-brave`, or install `brave-bin`. Use `YOOD_SKIP_BRAVE=1` + `YOOD_ENGINE=webview` for a WebView-only setup.
- **WebKit crashes on video pages (Linux)**: use Brave mode (default on Linux). `YOOD_ENGINE=webview` is the diagnostic path.

## 🧑‍💻 Development

```bash
cargo fmt
cargo check --manifest-path linux/src-tauri/Cargo.toml
cargo test --manifest-path linux/src-tauri/Cargo.toml
npm run build --prefix shared/frontend
```

## 📄 License

MIT. See `linux/src-tauri/Cargo.toml`.
