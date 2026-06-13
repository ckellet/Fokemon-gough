// Assembles the self-contained web bundle that Capacitor ships inside the
// native app. Run via `npm run build:mobile`.
//
// The web app (served by GitHub Pages) is left completely untouched. This
// script copies the runtime files into ./www and rewrites a NATIVE variant of
// index.html that:
//   * loads Leaflet + the Outfit font from local vendor/ copies (no CDNs), so
//     the app launches offline and contains no remotely-loaded executable code
//     (Apple review guideline 2.5.2);
//   * injects native-geolocation.js before app.js to bridge
//     navigator.geolocation onto the Capacitor Geolocation plugin.
//
// Map tiles (tile.openstreetmap.org) and the GUN relays stay remote — that's
// runtime *data* over HTTPS, not bundled code, which is expected and allowed.

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const www = resolve(root, "www");

const r = (p) => resolve(root, p);

// 1. Clean output dir.
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

// 2. Copy runtime files + asset dirs verbatim.
const files = ["app.js", "app.logic.js", "styles.css", "version.json", "native-geolocation.js"];
const dirs = ["vendor", "audio"];

for (const f of files) {
  if (!existsSync(r(f))) throw new Error(`build-mobile: missing required file ${f}`);
  cpSync(r(f), resolve(www, f));
}
for (const d of dirs) {
  if (!existsSync(r(d))) throw new Error(`build-mobile: missing required dir ${d}/`);
  cpSync(r(d), resolve(www, d), { recursive: true });
}

// 3. Transform index.html into the native variant.
let html = readFileSync(r("index.html"), "utf8");

const replacements = [
  // Leaflet CSS (unpkg) -> local
  {
    re: /<link\s+rel="stylesheet"\s+href="https:\/\/unpkg\.com\/leaflet@[^>]*?>/s,
    to: '<link rel="stylesheet" href="vendor/leaflet/leaflet.css" />',
    name: "leaflet css",
  },
  // Leaflet JS (unpkg) -> local (keep defer; drop SRI/crossorigin which are
  // meaningless and would block a local file)
  {
    re: /<script\s+src="https:\/\/unpkg\.com\/leaflet@[\s\S]*?<\/script>/,
    to: '<script src="vendor/leaflet/leaflet.js" defer></script>',
    name: "leaflet js",
  },
  // Google Fonts stylesheet -> local @font-face css
  {
    re: /<link\s+href="https:\/\/fonts\.googleapis\.com\/css2[^>]*?>/s,
    to: '<link rel="stylesheet" href="vendor/fonts/outfit.css" />',
    name: "fonts css",
  },
  // Drop now-unused preconnects (googleapis, gstatic, unpkg). The OSM tile
  // preconnect is intentionally kept — tiles are still fetched at runtime.
  {
    re: /\s*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"[^>]*>/s,
    to: "",
    name: "drop googleapis preconnect",
  },
  {
    re: /\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>/s,
    to: "",
    name: "drop gstatic preconnect",
  },
  {
    re: /\s*<link rel="preconnect" href="https:\/\/unpkg\.com"[^>]*>/s,
    to: "",
    name: "drop unpkg preconnect",
  },
  // Bridge geolocation: load the shim immediately before the app module.
  {
    re: /(<script\s+type="module"\s+src="app\.js"><\/script>)/,
    to: '<script src="native-geolocation.js"></script>\n    $1',
    name: "inject geolocation shim",
  },
];

for (const { re, to, name } of replacements) {
  if (!re.test(html)) throw new Error(`build-mobile: index.html transform "${name}" matched nothing — did the markup change?`);
  html = html.replace(re, to);
}

// Mark this as the native build for anyone inspecting the source.
html = html.replace(
  /<meta name="app-version" content="[^"]*" \/>/,
  '$&\n    <meta name="fokego-build" content="native-capacitor" />'
);

writeFileSync(resolve(www, "index.html"), html, "utf8");

// 4. Guard: no remote code/style/font references should remain.
const banned = ["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const offenders = banned.filter((b) => html.includes(b));
if (offenders.length) {
  throw new Error(`build-mobile: native index.html still references remote assets: ${offenders.join(", ")}`);
}

console.log("build-mobile: wrote self-contained bundle to www/");
console.log("  files:", files.join(", "));
console.log("  dirs: ", dirs.map((d) => d + "/").join(", "));
console.log("  index.html: CDN Leaflet+fonts -> local, geolocation shim injected");
