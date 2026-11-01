(function () {
  "use strict";

  var iconUrl = chrome.runtime.getURL("app-icon.png");
  var shortcuts = new Set([
    "b", "d", "f", "h", "j", "l", "n", "o", "p", "s", "t", "u"
  ]);

  function applyAppIcon() {
    if (!document.head) return;
    var icons = document.head.querySelectorAll('link[rel~="icon"]');
    var icon = null;
    for (var i = 0; i < icons.length; i++) {
      if (icons[i].getAttribute("data-yood-app-icon") === "true") {
        icon = icons[i];
      } else {
        icons[i].remove();
      }
    }
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      icon.setAttribute("data-yood-app-icon", "true");
      document.head.appendChild(icon);
    }
    if (icon.href !== iconUrl) icon.href = iconUrl;
    if (icon.type !== "image/png") icon.type = "image/png";
  }

  var observer = new MutationObserver(applyAppIcon);
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "rel"]
    });
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "rel"]
      });
      applyAppIcon();
    }, { once: true });
  }
  applyAppIcon();

  document.addEventListener("keydown", function (event) {
    var key = String(event.key || "").toLowerCase();
    var browserShortcut = (event.ctrlKey || event.metaKey) &&
      (shortcuts.has(key) || (event.shiftKey && (key === "i" || key === "j" || key === "c" || key === "n")));
    if (browserShortcut || key === "f6" || key === "f11" || key === "f12" ||
        (event.ctrlKey && key === "tab") || (event.shiftKey && key === "f10")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener("contextmenu", function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (target && target.closest("input, textarea, [contenteditable='true'], video, audio")) return;
    event.preventDefault();
  }, true);
})();
