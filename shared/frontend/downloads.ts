export { };

interface DownloadItem {
  id: string;
  title: string;
  channel: string;
  status: string;
  progress: number;
  speed?: string;
  eta?: string;
  thumbnail?: string;
  error?: string;
  completed_at?: string | null;
}

type DownloadInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type DownloadEvent = { payload: DownloadItem };
const nativeWindow = window as unknown as {
  __YOOD_NATIVE__?: { invoke?: DownloadInvoke };
  __TAURI_INTERNALS__?: { invoke?: DownloadInvoke };
  __TAURI__?: {
    core?: { invoke?: DownloadInvoke };
    event?: { listen?: (event: string, callback: (event: DownloadEvent) => void) => Promise<() => void> };
  };
};
const invoke = nativeWindow.__YOOD_NATIVE__?.invoke
  ?? nativeWindow.__TAURI_INTERNALS__?.invoke
  ?? nativeWindow.__TAURI__?.core?.invoke;
const list = document.querySelector<HTMLElement>("#list")!;
const headCount = document.querySelector<HTMLElement>("#head-count")!;
const toast = document.querySelector<HTMLElement>("#download-toast")!;
const pageStartedAt = Date.now();
const knownStatuses = new Map<string, string>();
const notifiedCompletions = new Set<string>();
let toastTimer = 0;

function notifyCompletion(item: DownloadItem): void {
  if (item.status !== "completed" || notifiedCompletions.has(item.id)) return;
  const completedAt = Date.parse(item.completed_at ?? "");
  if (!Number.isFinite(completedAt) || completedAt < pageStartedAt - 2_000) return;
  notifiedCompletions.add(item.id);
  toast.textContent = `Download finished${item.title ? `: ${item.title}` : ""}`;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 5_000);
}

function safeThumbnail(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return "";
    if (["i.ytimg.com", "img.youtube.com", "yt3.ggpht.com", "lh3.googleusercontent.com"].includes(host)) {
      return url.href;
    }
  } catch {
    // Ignore malformed metadata.
  }
  return "";
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function render(items: DownloadItem[]): void {
  const safeItems = items.slice(0, 1000);
  for (const item of safeItems) {
    const previous = knownStatuses.get(item.id);
    knownStatuses.set(item.id, item.status);
    if (previous !== undefined || item.completed_at) notifyCompletion(item);
  }
  const active = safeItems.filter((item) =>
    ["downloading", "paused", "queued", "interrupted"].includes(item.status),
  ).length;
  headCount.textContent = active > 0
    ? `${active} active`
    : safeItems.length > 0
      ? `${safeItems.length} total`
      : "";

  list.replaceChildren();
  if (safeItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No downloads yet";
    list.append(empty);
    return;
  }

  for (const item of safeItems) {
    const row = document.createElement("div");
    row.className = "row";
    const thumbnail = safeThumbnail(item.thumbnail);
    if (thumbnail) {
      const image = document.createElement("img");
      image.className = "thumb";
      image.alt = "";
      image.loading = "lazy";
      image.src = thumbnail;
      image.addEventListener("error", () => image.remove(), { once: true });
      row.append(image);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "t";
    title.textContent = text(item.title, text(item.id, "Download"));
    const detail = document.createElement("div");
    detail.className = "s";
    const statusLabel = item.status === "completed" ? "Completed" : item.status;
    const parts = [statusLabel, item.speed, item.eta ? `ETA ${item.eta}` : "", item.error]
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    detail.textContent = [text(item.channel), ...parts].filter(Boolean).join(" · ");
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    const pct = Math.max(0, Math.min(100, Number(item.progress) || 0));
    fill.style.width = `${pct}%`;
    bar.append(fill);
    meta.append(title, detail, bar);
    row.append(meta);
    list.append(row);
  }
}

async function refresh(): Promise<void> {
  if (document.hidden) return;
  try {
    const items = await invoke?.("list_downloads") as DownloadItem[] | undefined;
    if (Array.isArray(items)) render(items);
  } catch {
    // The backend may be starting; the next visible refresh retries.
  }
}

void nativeWindow.__TAURI__?.event?.listen?.("download-updated", (event) => {
  if (event?.payload) notifyCompletion(event.payload);
  void refresh();
});
void refresh();
window.setInterval(() => { void refresh(); }, 3000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
