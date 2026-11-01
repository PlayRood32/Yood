const DEFAULTS_URL = chrome.runtime.getURL("defaults.json");
const LOCAL_API_PATHS = {
  "/downloads": ["GET"],
  "/enqueue": ["POST"],
  "/pick-folder": ["POST"],
};

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
  const timeout = setTimeout(() => controller.abort(), 8000);
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
  return undefined;
});
