// Lightweight client-side version watcher.
//
// Each deploy stamps the commit SHA into <meta name="app-version"> and into
// version.json (see .github/workflows/deploy-pages.yml). When a new deploy
// changes version.json, any tab that's already open notices and offers a
// reload. This is how fresh code reaches clients even though GitHub Pages
// serves HTML with a short cache and the site has no service worker.
//
// In local dev / unstamped builds the version is "dev" and this is inert.

const META = document.querySelector('meta[name="app-version"]');
const LOADED_VERSION = (META?.content || "").trim();
const POLL_MS = 5 * 60 * 1000;

// Skip entirely when running unstamped (local dev, file://, first load
// before the deploy pipeline has stamped a real version).
const ENABLED = Boolean(LOADED_VERSION) && LOADED_VERSION !== "dev";

let bannerShown = false;
let timer = null;

async function fetchLatestVersion() {
  try {
    // no-store + a cache-busting query defeats both the browser cache and
    // any intermediary so we always see the freshly deployed version.json.
    const res = await fetch(`version.json?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const v = typeof data?.version === "string" ? data.version.trim() : "";
    return v || null;
  } catch {
    return null;
  }
}

function stopPolling() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function showBanner() {
  if (bannerShown) return;
  bannerShown = true;
  stopPolling();

  const bar = document.createElement("div");
  bar.setAttribute("role", "status");
  // Inline styles so the banner still works if styles.css is itself stale.
  bar.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:16px",
    "transform:translateX(-50%)",
    "z-index:99999",
    "display:flex",
    "align-items:center",
    "gap:12px",
    "max-width:calc(100vw - 24px)",
    "padding:10px 14px",
    "border-radius:999px",
    "background:rgba(20,20,28,0.92)",
    "color:#fff",
    "font:600 14px/1.2 'Outfit',system-ui,sans-serif",
    "box-shadow:0 8px 28px rgba(0,0,0,0.35)",
    "backdrop-filter:blur(8px)",
    "-webkit-backdrop-filter:blur(8px)",
  ].join(";");

  const label = document.createElement("span");
  label.textContent = "A new version is available.";
  label.style.cssText =
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.style.cssText = [
    "cursor:pointer",
    "border:0",
    "border-radius:999px",
    "padding:7px 16px",
    "font:700 14px/1 'Outfit',system-ui,sans-serif",
    "color:#13131c",
    "background:#7cf6c8",
  ].join(";");
  reload.addEventListener("click", () => {
    window.location.reload();
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss update notice");
  dismiss.textContent = "✕";
  dismiss.style.cssText = [
    "cursor:pointer",
    "border:0",
    "background:transparent",
    "color:rgba(255,255,255,0.7)",
    "font:700 16px/1 system-ui,sans-serif",
    "padding:4px",
  ].join(";");
  dismiss.addEventListener("click", () => bar.remove());

  bar.append(label, reload, dismiss);
  document.body.appendChild(bar);
}

async function check() {
  if (bannerShown) return;
  const latest = await fetchLatestVersion();
  if (latest && latest !== LOADED_VERSION) showBanner();
}

function startPolling() {
  if (!ENABLED || bannerShown) return;
  stopPolling();
  timer = setInterval(check, POLL_MS);
}

if (ENABLED) {
  // Check on first paint, whenever the tab regains focus, and on an interval.
  check();
  startPolling();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("focus", check);
}
