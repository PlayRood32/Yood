interface Window {
  __YOOD_BOOT__?: { complete: () => void };
  __YOOD_RELEASE_AD_SHIELD__?: () => void;
}

const BOOTSTRAP_AD_SELECTORS = [
  "ytd-ad-slot-renderer",
  "ytd-in-feed-ad-layout-renderer",
  "ytd-banner-promo-renderer",
  "ytd-display-ad-renderer",
  "ytd-promoted-video-renderer",
  "ytd-compact-promoted-video-renderer",
  "ytd-promoted-sparkles-web-renderer",
  "ytd-companion-slot-renderer",
  "ytd-action-companion-ad-renderer",
  "ytd-player-legacy-desktop-watch-ads-renderer",
  "#player-ads",
  "#masthead-ad",
  ".ytp-ad-module",
  ".ytp-ad-overlay-container",
  ".ytp-ad-player-overlay",
  ".ytp-ad-text",
  ".video-ads",
];
const BOOTSTRAP_AD_SELECTOR = BOOTSTRAP_AD_SELECTORS.join(",");
const BOOTSTRAP_AD_CARD_SELECTOR = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-playlist-video-renderer",
  "ytd-reel-item-renderer",
].join(",");

function removeBootstrapAds(root: ParentNode = document): void {
  const renderers: Element[] = [];
  if (root instanceof Element && root.matches(BOOTSTRAP_AD_SELECTOR)) renderers.push(root);
  renderers.push(...root.querySelectorAll(BOOTSTRAP_AD_SELECTOR));
  for (const renderer of renderers) {
    if (!renderer.isConnected) continue;
    const card = renderer.closest(BOOTSTRAP_AD_CARD_SELECTOR);
    if (card) {
      card.setAttribute("data-yood-ad-removed", "");
      card.remove();
    } else {
      renderer.remove();
    }
  }
}

function installBootstrapAdShield(): void {
  const install = (): void => {
    if (!document.documentElement) return;
    const style = document.createElement("style");
    style.id = "yood-bootstrap-ad-shield";
    style.textContent = `${BOOTSTRAP_AD_SELECTOR},[data-yood-ad-removed] { display:none!important; }`;
    document.documentElement.appendChild(style);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) removeBootstrapAds(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__YOOD_RELEASE_AD_SHIELD__ = () => {
      observer.disconnect();
      style.remove();
    };
    removeBootstrapAds();
  };
  if (document.documentElement) install();
  else document.addEventListener("DOMContentLoaded", install, { once: true });
}

function installAuthRecovery(): void {
  window.setTimeout(() => {
    const host = location.hostname.toLowerCase();
    const isAuthHost = host === "accounts.google.com" || host.endsWith(".accounts.google.com") ||
      host === "accounts.youtube.com" || host.endsWith(".accounts.youtube.com");
    if (!isAuthHost) return;
    if (document.getElementById("yood-auth-recovery")) return;

    const show = (): void => {
      if (!document.body || document.getElementById("yood-auth-recovery")) return;
      const banner = document.createElement("aside");
      banner.id = "yood-auth-recovery";
      banner.setAttribute("role", "status");
      banner.style.cssText = "position:fixed;z-index:2147483647;top:8px;left:8px;right:8px;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 14px;border:1px solid #555;border-radius:10px;background:#202124;color:#f1f3f4;font:14px system-ui,sans-serif;box-shadow:0 4px 20px #0008";

      const message = document.createElement("span");
      message.textContent = "Google sign-in is taking longer than expected. You can return to YouTube and retry without closing Yood.";

      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Return to YouTube";
      retry.style.cssText = "padding:7px 12px;border:0;border-radius:16px;background:#8ab4f8;color:#202124;cursor:pointer";
      retry.addEventListener("click", () => {
        window.location.replace("https://www.youtube.com/");
      });

      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Dismiss";
      close.style.cssText = "padding:7px 12px;border:1px solid #777;border-radius:16px;background:transparent;color:inherit;cursor:pointer";
      close.addEventListener("click", () => banner.remove());

      banner.append(message, retry, close);
      document.body.appendChild(banner);
    };

    if (document.body) show();
    else document.addEventListener("DOMContentLoaded", show, { once: true });
  }, 12000);
}

(() => {
  const host = location.hostname.toLowerCase();
  const isAuthHost = host === "accounts.google.com" || host.endsWith(".accounts.google.com") ||
    host === "accounts.youtube.com" || host.endsWith(".accounts.youtube.com");
  if (isAuthHost) {
    installAuthRecovery();
    return;
  }
  if (
    host !== "youtube.com" &&
    !host.endsWith(".youtube.com") &&
    host !== "youtu.be" &&
    !host.endsWith(".youtu.be") &&
    host !== "youtube-nocookie.com" &&
    !host.endsWith(".youtube-nocookie.com")
  ) return;

  installBootstrapAdShield();
  const install = (): void => {
    const documentRoot = document.documentElement;
    if (!documentRoot || document.getElementById("yood-boot")) return;

    const style = document.createElement("style");
    style.id = "yood-boot-style";
    style.textContent = `
      #yood-boot { position: fixed; inset: 0; z-index: 2147483647; display: grid;
        place-items: center; color-scheme: dark; background: #0f0f0f; color: #f1f1f1;
        font: 15px system-ui, sans-serif; }
      #yood-boot-card { width: min(460px, calc(100vw - 48px)); padding: 28px;
        border: 1px solid #444; border-radius: 14px; background: #212121;
        box-shadow: 0 12px 48px #0008; text-align: center; }
      #yood-boot-title { font-size: 22px; font-weight: 650; margin-bottom: 10px; }
      #yood-boot-message { color: #aaa; line-height: 1.5; }
      #yood-boot-retry { display: none; margin-top: 18px; padding: 9px 18px;
        border: 0; border-radius: 18px; color: white; background: #065fd4; cursor: pointer; }
    `;
    documentRoot.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "yood-boot";
    overlay.innerHTML = `<div id="yood-boot-card" role="status" aria-live="polite">
      <div id="yood-boot-title">Yood</div>
      <div id="yood-boot-message">Connecting to YouTube…</div>
      <button id="yood-boot-retry" type="button">Retry</button>
    </div>`;
    documentRoot.appendChild(overlay);

    let finished = false;
    let observer: MutationObserver | undefined;
    const timeout = window.setTimeout(() => {
      if (finished) return;
      const message = overlay.querySelector<HTMLElement>("#yood-boot-message");
      const button = overlay.querySelector<HTMLElement>("#yood-boot-retry");
      if (message) message.textContent = "YouTube did not finish loading. Check your network and WebKit/GStreamer packages.";
      if (button) button.style.display = "inline-block";
    }, 12000);
    const complete = (): void => {
      if (finished) return;
      finished = true;
      observer?.disconnect();
      window.clearTimeout(timeout);
      overlay.remove();
      style.remove();
    };
    window.__YOOD_BOOT__ = { complete };
    overlay.querySelector<HTMLButtonElement>("#yood-boot-retry")?.addEventListener("click", () => window.location.reload());

    const checkForYouTube = (): void => {
      if (document.querySelector("ytd-app, ytd-page-manager")) complete();
    };
    observer = new MutationObserver(checkForYouTube);
    observer.observe(documentRoot, { childList: true, subtree: true });
    checkForYouTube();
  };

  if (document.documentElement) install();
  else document.addEventListener("DOMContentLoaded", install, { once: true });
})();
