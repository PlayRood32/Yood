<div align="center">

# 🎥 Yood

**A YouTube-first desktop app for Windows and Linux.**

Watch YouTube in a focused app window, with integrated downloads, filtering,
and an optional local player.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/Rust-1.90-orange.svg)](https://www.rust-lang.org)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-blue.svg)](https://tauri.app)

</div>

**Current version: 1.0.1**

Yood is built with Rust, Tauri, and TypeScript. It uses the official YouTube
website and account rather than recreating YouTube or requiring a separate
media service. The app is designed as a player, not a general-purpose browser.

## ✨ Features

### A focused YouTube app

- Opens YouTube in Brave app mode without ordinary browser tabs or an address
  bar. Yood's icon is used throughout the app, and browser-only shortcuts and
  context menus are suppressed while normal editing and media controls remain
  available.
- Linux uses Brave by default. Windows prefers installed or optionally bundled
  Brave and falls back to the system WebView2 runtime if Brave is unavailable.
- Keeps Google sign-in pages separate from Yood's YouTube page integration, so
  account pages are not intercepted by YouTube controls or filters.
- Provides a recovery prompt if a Google sign-in page remains open, so you can
  return to YouTube and retry without restarting Yood.
- Supports `yood://` links and single-instance behavior: opening another Yood
  link focuses the running app and routes the link to it.

### YouTube controls and filtering

- Adds Yood download controls to YouTube watch and Shorts pages.
- Adds a Watch later action and keyboard shortcuts, including `Alt+L` for the
  quick link bar.
- Uses Brave Shields in aggressive mode for YouTube together with Yood's
  network and cosmetic filter rules. WebView mode has a native request-filter
  layer as well.
- Keeps the Yood app shell and icon consistent across navigation while limiting
  YouTube-specific page integration to YouTube domains.

Ad filtering depends on the selected engine, active filter lists, and changes
to YouTube. No filter can guarantee that every ad or promotion will be removed.

### Downloads

- Downloads video, audio, and songs with `yt-dlp` and FFmpeg.
- Shows queued and active downloads with progress, speed, ETA, and errors.
- Supports configurable download concurrency and controls to pause, resume,
  cancel, retry, and remove downloads.
- Supports playlist and channel selection, duplicate/overwrite handling, and
  optional subtitles, thumbnails, and metadata.
- Opens completed files or their containing folder from the download manager.
- Displays a completion notification when a download finishes.

### Player, settings, and privacy

- Includes an optional native player window for local media and supported
  stream URLs, plus an in-player ad-skip helper.
- Provides system, light, and dark appearance options, along with settings for
  downloads, storage, filtering, privacy, and shortcuts.
- Stores app settings and logs locally. Yood's logs do not include passwords,
  cookies, or tokens; Google sign-in is handled by Google and YouTube.
- Includes a `--self-test` mode for basic startup and configuration checks.

## 🗂️ Repository layout

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
│   │       ├── 🖼️ app-icon.png
│   │       ├── 🟨 app-shell.js
│   │       ├── 🟨 background.js
│   │       ├── 🟨 content.js
│   │       ├── 🌐 manifest.json
│   │       ├── 🟨 page.js
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

`shared/` contains the frontend, extension, and filter list used by both
platforms. Build scripts stage platform-specific `yt-dlp` and FFmpeg binaries
under `src-tauri/binaries/`; those generated binaries and build outputs are not
part of the source tree.

## 📦 Build

### Requirements

- Rust stable with Rust **1.90** or newer.
- Node.js and npm.
- **Linux:** Tauri's GTK/WebKitGTK development dependencies, GStreamer
  dependencies, `curl`, `unzip`, and `sha256sum`. Exact package names vary by
  distribution; see the [Linux guide](linux/README.md).
- **Windows:** Visual Studio 2022 C++ Build Tools and the Tauri/NSIS build
  prerequisites. WebView2 is needed when Yood uses the WebView fallback.

The platform scripts check for or install the Tauri CLI and stage the required
`yt-dlp` and FFmpeg binaries.

### Linux

From the repository root:

```bash
./linux/scripts/build.sh
```

The script builds the shared frontend and Linux app. By default, the Linux
Tauri configuration creates **AppImage** and **DEB** bundles. Add
`--bundle-brave` to include portable Brave, or `--install` to install after
building. The standalone executable is produced at
`linux/src-tauri/target/release/yood`.

The Tauri RPM bundle can be built separately after staging the Linux resources,
on a system with RPM packaging tools installed:

```bash
cd linux/src-tauri
cargo tauri build --bundles rpm
```

For a development run, see [`linux/README.md`](linux/README.md) and
[`linux/run.sh`](linux/run.sh). AppImage creation uses `linuxdeploy`, which may
not work in every WSL environment; DEB and RPM packaging can be built
independently.

### Windows

From the repository root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\scripts\build-windows.ps1
```

This builds the frontend, stages `yt-dlp.exe` and `ffmpeg.exe`, and creates the
NSIS installer under
`windows\src-tauri\target\release\bundle\nsis\`. Add `-BundleBrave` to include
portable Brave; otherwise Yood uses an installed Brave when available.

See the platform-specific guides for more details:
[Linux](linux/README.md) · [Windows](windows/README.md) ·
[shared assets](shared/README.md).

## 🔗 Usage

- YouTube deep link: `yood://www.youtube.com/watch?v=VIDEO_ID`
- Download deep link: `yood://download?url=YOUTUBE_URL`
- Run `yood --self-test` to check configuration, URL policy, filters, and the
  companion extension manifest.
- Linux development helper: `./linux/run.sh brave`; self-test helper:
  `./linux/run.sh self-test`.

## 📁 Data and logs

Yood keeps its app data in the current user's local application directories:

| Data | Linux | Windows |
|---|---|---|
| Brave profile | `~/.local/share/yood/brave-profile` | `%APPDATA%\PlayRood\Yood\data\brave-profile` |
| Extension | `~/.local/share/yood/yood-extension` | `%APPDATA%\PlayRood\Yood\data\yood-extension` |
| Logs | `~/.local/share/yood/logs/yood.log` | `%APPDATA%\PlayRood\Yood\data\logs\yood.log` |

Settings, download locations, and temporary-file behavior can be configured
from the app. Logs do not contain passwords, cookies, or tokens.

## 🛠️ Troubleshooting and limitations

- **Google sign-in looks stuck:** Yood leaves Google account pages alone. If a
  sign-in page remains open, use the recovery prompt to return to YouTube and
  retry without restarting the app.
- **Download controls are missing in Brave:** make sure the current Yood build
  is running. If upgrading from a much older build does not restore the
  controls, close Yood, remove its Brave profile once, and relaunch.
- **A download button does not queue a download:** update to the latest build.
  The companion extension relays authenticated requests through its service
  worker instead of making local API requests from the YouTube page.
- **Ads still appear:** check that Yood is using Brave. Brave mode combines
  Shields, Yood's rules, and the companion extension; filtering can vary with
  YouTube changes and is not guaranteed to remove every promotion.
- **Brave was not found:** install Brave, set `YOOD_BRAVE_DIR`, or rebuild with
  `--bundle-brave`. Use `YOOD_ENGINE=brave` or `YOOD_ENGINE=webview` to select
  an engine explicitly.
- **Linux WebKit crashes on video pages:** use the default Brave engine;
  WebKit mode is available primarily as an alternative or diagnostic path.
- **DRM-protected rentals:** portable Brave builds do not include Widevine, so
  some DRM-protected content may not play.
- **Opening ordinary `https://` links:** Yood registers the `yood://` scheme
  rather than claiming every web URL on the system.

## 🧑‍💻 Development and tests

```bash
npm install --prefix shared/frontend
npm run build --prefix shared/frontend
cargo fmt --manifest-path linux/src-tauri/Cargo.toml
cargo test --manifest-path linux/src-tauri/Cargo.toml
cargo test --manifest-path windows/src-tauri/Cargo.toml
```

The Rust backends are maintained separately per platform and share the
frontend, companion extension, and filter assets.

## 📄 License and release notes

Yood is licensed under the MIT License; see [`LICENSE`](LICENSE). Version
history is in [`CHANGES.md`](CHANGES.md).
