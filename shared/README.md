# 📦 Shared

Single source of truth for both platforms.

- `extension/yood/` — companion extension (`app-shell.js` keeps the Yood icon and blocks browser-only shortcuts, `content.js` provides YouTube UI, `page.js` handles main-world request filtering, and `rules.json` configures `declarativeNetRequest`)
- `filters/default.txt` — built-in ad rules, also seeded as Brave custom filters
- `frontend/` — `bootstrap.ts`, `injection.ts`, `player.ts`, built `dist/`

Referenced from:

- `../linux/src-tauri/tauri.conf.json` → `../../shared/frontend/dist`, `../../shared/filters`, `../../shared/extension`
- `../windows/src-tauri/tauri.conf.json` → same
- Rust `include_str!("../../../shared/...")` in `browser.rs`, `lib.rs`, `filtering.rs`

## 🔧 Build

```bash
npm install --prefix frontend
npm run build --prefix frontend
```

Brave runs in app mode without browser tabs or an address bar. The app-shell extension keeps the Yood icon on navigated pages and blocks browser-only shortcuts; YouTube controls and ad filtering remain limited to YouTube. Google sign-in pages do not receive the YouTube integration; if one remains open for 12 seconds, the bootstrap shows a recovery option to return to YouTube and retry without restarting Yood. The Brave companion extension sends authenticated local download requests through its service worker to avoid page-origin localhost restrictions. Download completion timestamps are exposed to the UI so completion toasts are not missed between polls.
