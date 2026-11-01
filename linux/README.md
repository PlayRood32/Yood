# 🐧 Yood for Linux

Linux-only build. Shared code lives in [`../shared/`](../shared/). Root guide: [`../README.md`](../README.md).

## 🚀 Quick start

```bash
npm install --prefix ../shared/frontend
npm run build --prefix ../shared/frontend
./run.sh brave
```

## 🦁 Brave engine

```bash
./scripts/build.sh --bundle-brave
./run.sh brave
```

Uses the bundled portable Brave first (`src-tauri/binaries/linux-x86_64/brave/brave`), then `/opt/brave-bin/brave`, `/opt/brave.com/brave/brave`, then `brave` / `brave-browser` / `brave-bin` on `PATH`.

## 🔧 Build

```bash
./scripts/build.sh
```

Add `--bundle-brave` to include portable Brave. The script stages `yt-dlp` and FFmpeg, builds the shared frontend, and runs `cargo tauri build`. Targets: `appimage`, `deb`. Resources include `gstreamer/` plus `../../shared/filters` and `../../shared/extension`.

## 🧪 Self-test

```bash
./run.sh self-test
```

## 🗂️ Layout

- `src-tauri/` — Rust backend + `tauri.conf.json` (Linux-only)
- `scripts/build.sh` — stages dependencies and builds AppImage/DEB packages
- `run.sh` — Linux-only helper (no Windows commands)
