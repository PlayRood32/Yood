# 🪟 Yood for Windows

Windows-only build. Shared code lives in [`../shared/`](../shared/). Root guide: [`../README.md`](../README.md).

## 🔧 Build

From an elevated-not-required PowerShell prompt, run the command from the `windows` directory (or use the repository-root path in the equivalent command):

```powershell
Set-Location windows
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
# Optional portable Brave fallback:
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1 -BundleBrave
```

Result: `src-tauri\target\release\bundle\nsis\Yood_*_x64-setup.exe`

## 🧑‍💻 Development

```powershell
npm install --prefix ..\shared\frontend
npm run build --prefix ..\shared\frontend
cargo tauri dev --config src-tauri\tauri.conf.json
```

## 📝 Notes

- `tauri.conf.json` targets `nsis` only, resources point at `../../shared/...`
- Rust `CREATE_NO_WINDOW` guards prevent console flashes (`reg.exe`, `rundll32`, `yt-dlp`, Brave child)
- `windows_subsystem = "windows"` is set for release GUI builds (no console window)
- Windows prefers an installed or bundled Brave. Yood loads its companion extension and seeds aggressive Shields settings in its isolated profile. If Brave is unavailable, it falls back to Tauri WebView, which uses WebView2 request interception and the shared TypeScript integration.
- If buttons still don't show after upgrading from an old build, delete `%APPDATA%\PlayRood\Yood\data\brave-profile` once and relaunch

## 🗂️ Layout

- `src-tauri/` — Rust backend + `tauri.conf.json` (Windows-only)
- `scripts/build-windows.ps1` — automated prereq check + verified yt-dlp/ffmpeg staging + NSIS build; portable Brave is opt-in with `-BundleBrave` (an installed system Brave is used by default when available)
