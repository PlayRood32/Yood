const DEFAULTS_URL = chrome.runtime.getURL("defaults.json");
const LOCAL_API_PATHS = {
  "/downloads": ["GET"],
  "/enqueue": ["POST"],
  "/pick-folder": ["POST"],
  "/inspect": ["POST"],
  "/cookies": ["POST"],
};

// Brave keeps its Cookies database exclusively locked while running, so
// yt-dlp cannot read the browser profile directly. Export the signed-in
// YouTube cookies through the extension API into a local Netscape jar that
// yt-dlp can use via --cookies (private videos, age gates, etc.).
async function exportYoutubeCookies() {
  const cookies = await chrome.cookies.getAll({});
  const relevant = cookies.filter((cookie) => {
    const domain = String(cookie.domain || "").toLowerCase();
    return domain === "youtube.com" || domain.endsWith(".youtube.com") ||
      domain === "youtu.be" || domain.endsWith(".youtu.be") ||
      domain === "youtube-nocookie.com" || domain.endsWith(".youtube-nocookie.com");
  });
  const seen = new Set();
  const lines = ["# Netscape HTTP Cookie File", "# Exported by Yood for yt-dlp"];
  for (const cookie of relevant) {
    const key = `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = cookie.domain.startsWith(".") ? cookie.domain : `.${cookie.domain}`;
    const includeSubdomains = cookie.hostOnly ? "FALSE" : "TRUE";
    const path = cookie.path || "/";
    const secure = cookie.secure ? "TRUE" : "FALSE";
    const expires = cookie.session || typeof cookie.expirationDate !== "number"
      ? "0" : String(Math.floor(cookie.expirationDate));
    lines.push([domain, includeSubdomains, path, secure, expires, cookie.name, cookie.value].join("\t"));
  }
  return lines.join("\n") + "\n";
}

async function localApiRequest(message) {
  const path = message.path;
  const method = message.method;
  if (!Object.hasOwn(LOCAL_API_PATHS, path) || !LOCAL_API_PATHS[path].includes(method)) {
    throw new Error("unsupported local API request");
  }
  if (method === "POST" && (typeof message.body !== "string" || message.body.length > 262144)) {
    throw new Error("invalid local API request body");
  }

  const defaultsResponse = await fetch(DEFAULTS_URL, { cache: "no-store" });
  if (!defaultsResponse.ok) throw new Error("Yood defaults unavailable");
  const defaults = await defaultsResponse.json();
  if (!Number.isInteger(defaults.progress_port) || defaults.progress_port < 1 || defaults.progress_port > 65535 ||
      typeof defaults.progress_token !== "string" || !/^[a-f0-9]{32,64}$/i.test(defaults.progress_token)) {
    throw new Error("Yood local API is unavailable");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === "/inspect" ? 30000 : 8000);
  let body;
  try {
    const response = await fetch(`http://127.0.0.1:${defaults.progress_port}${path}`, {
      method,
      headers: {
        "X-Yood-Token": defaults.progress_token,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? message.body : undefined,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    try {
      body = await response.json();
    } catch {
      throw new Error("Yood returned an invalid local API response");
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "yood-defaults") {
    fetch(DEFAULTS_URL, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("defaults unavailable");
        return response.json();
      })
      .then((data) => sendResponse(data))
      .catch(() => sendResponse(null));
    return true;
  }
  if (message && message.type === "yood-local-request") {
    localApiRequest(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message && message.type === "yood-export-cookies") {
    exportYoutubeCookies()
      .then((jar) => localApiRequest({ path: "/cookies", method: "POST", body: jar }))
      .then((response) => {
        if (response.error) throw new Error(response.error);
        const body = response.body || {};
        if (!response.ok || body.ok !== true) {
          throw new Error(body.error || "could not store YouTube cookies");
        }
        return body.count || 0;
      })
      .then((count) => sendResponse({ ok: true, count }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }
  return undefined;
});
