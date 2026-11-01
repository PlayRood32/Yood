(function () {
  "use strict";
  if (window.__YOOD_PAGE_AD_BLOCK__) return;
  window.__YOOD_PAGE_AD_BLOCK__ = true;

  var AD_TOKENS = [
    "doubleclick.net",
    "googleadservices.com",
    "googlesyndication.com",
    "adservice.google.com",
    "jnn-pa.googleapis.com",
    "youtube.com/api/stats/ads",
    "youtube.com/pagead",
    "youtube.com/ptracking",
    "youtube.com/get_midroll_info",
    "youtube.com/ad_break"
  ];
  var PLAYER_AD_KEYS = {
    adplacements: 1, adslots: 1, adcueranges: 1, playerads: 1,
    adparams: 1, adbreakheartbeatparams: 1, adplaybackcontext: 1,
    adbreakservicerenderer: 1, adslotrenderer: 1, adlayoutrenderer: 1,
    instreamvideoadrenderer: 1, playerlegacydesktopwatchadsrenderer: 1,
    promotedsparkleswebrenderer: 1, companionslotrenderer: 1,
    actioncompanionadrenderer: 1
  };

  function blockedUrl(raw) {
    var url;
    try { url = new URL(String(raw), location.href); }
    catch (e) { return false; }
    var host = url.hostname.toLowerCase();
    if (host === "googlevideo.com" || host.slice(-16) === ".googlevideo.com" ||
        host === "ytimg.com" || host.slice(-10) === ".ytimg.com" ||
        host === "gstatic.com" || host.slice(-12) === ".gstatic.com") return false;
    var href = url.href.toLowerCase();
    for (var i = 0; i < AD_TOKENS.length; i++) {
      var token = AD_TOKENS[i];
      if (host === token || host.slice(-token.length - 1) === "." + token ||
          href.indexOf(token) !== -1) return true;
    }
    return false;
  }

  function isPlayerApiRequest(raw) {
    try {
      var url = new URL(raw, location.href);
      var host = url.hostname.toLowerCase();
      return (host === "youtube.com" || host.slice(-12) === ".youtube.com") &&
        /^\/youtubei\/v1\/(player|next)(\/|$)/.test(url.pathname);
    } catch (e) {
      return false;
    }
  }

  function stripAdPayload(payload) {
    var queue = [payload];
    var changed = false;
    var inspected = 0;
    while (queue.length && inspected < 20000) {
      inspected++;
      var current = queue.pop();
      if (!current || typeof current !== "object") continue;
      var keys = Object.keys(current);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (PLAYER_AD_KEYS[key.toLowerCase()]) {
          try {
            delete current[key];
            changed = true;
          } catch (e) { /* keep processing the response */ }
        } else if (current[key] && typeof current[key] === "object") {
          queue.push(current[key]);
        }
      }
    }
    return changed;
  }

  function stripResponse(response) {
    try {
      var contentType = response.headers.get("content-type") || "";
      if (!/json/i.test(contentType) || response.status === 204 ||
          response.status === 205 || response.status === 304) return response;
      return response.clone().text().then(function (raw) {
        if (!raw || raw.length > 8 * 1024 * 1024) return response;
        var payload;
        try { payload = JSON.parse(raw); }
        catch (e) { return response; }
        if (!stripAdPayload(payload)) return response;
        var headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        return new Response(JSON.stringify(payload), {
          status: response.status,
          statusText: response.statusText,
          headers: headers
        });
      }).catch(function () { return response; });
    } catch (e) {
      return response;
    }
  }

  try {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var raw = null;
      try {
        raw = typeof input === "string" ? input :
          input instanceof URL ? input.href : input && input.url;
      } catch (e) { raw = null; }
      var url = null;
      try { url = raw ? new URL(String(raw), location.href).href : null; }
      catch (e) { url = null; }
      if (url && blockedUrl(url)) {
        return Promise.reject(new DOMException("Blocked by Yood", "AbortError"));
      }
      var promise = originalFetch(input, init);
      return url && isPlayerApiRequest(url) ?
        promise.then(stripResponse) : promise;
    };
  } catch (e) { /* declarative rules remain active if fetch cannot be patched */ }

  try {
    var xhrPrototype = window.XMLHttpRequest.prototype;
    var originalOpen = xhrPrototype.open;
    var originalSend = xhrPrototype.send;
    var xhrUrls = new WeakMap();
    xhrPrototype.open = function (method, url) {
      try { xhrUrls.set(this, new URL(String(url), location.href).href); }
      catch (e) { xhrUrls.delete(this); }
      return originalOpen.apply(this, arguments);
    };
    xhrPrototype.send = function () {
      if (blockedUrl(xhrUrls.get(this))) {
        try { this.abort(); } catch (e) { /* already closed */ }
        return;
      }
      return originalSend.apply(this, arguments);
    };
  } catch (e) { /* declarative rules remain active if XHR cannot be patched */ }
})();
