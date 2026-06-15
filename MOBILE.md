# FokéGo — iOS (App Store) build

The web game is wrapped in a native iOS shell with [Capacitor](https://capacitorjs.com).
The web app itself is unchanged and still deploys to GitHub Pages exactly as before —
the native build is an additive layer.

## How it works

```
index.html, app.js, styles.css, vendor/, audio/   ← the web game (untouched)
        │
        │  npm run build:mobile   (scripts/build-mobile.mjs)
        ▼
www/                                                ← self-contained bundle
        │  • Leaflet + Outfit font served locally (no CDNs)
        │  • native-geolocation.js injected before app.js
        │
        │  npx cap sync ios
        ▼
ios/  (Xcode project) ──► Archive ──► App Store Connect
```

- **Self-contained:** Leaflet and the Outfit font are vendored under `vendor/` and the
  build rewrites the CDN `<link>`/`<script>` tags to local paths. The app launches
  offline and ships no remotely-loaded code (Apple guideline 2.5.2). Map tiles
  (`tile.openstreetmap.org`) and the GUN relays stay remote — that's runtime data over
  HTTPS, which is expected and allowed.
- **Geolocation:** WKWebView doesn't expose `navigator.geolocation` to page JS, so
  [`native-geolocation.js`](native-geolocation.js) bridges it onto the
  `@capacitor/geolocation` plugin. It's inert on the web build. `app.js` is not modified.

## One-time prerequisites

1. **Apple Developer Program** membership ($99/yr) — https://developer.apple.com/programs/
2. Xcode (16+; built and tested against Xcode 26.5) and its command-line tools.
3. `npm install` in the repo root (installs Capacitor + plugins).
4. Decide the **bundle identifier**. It's currently `uk.co.kedos.fokego` in
   [`capacitor.config.json`](capacitor.config.json) — change it if you want a different
   one, then re-run `npx cap sync ios`. It must match the App ID you register in your
   Apple Developer account.

## Build & run locally

> **⚠️ Always run `npm run cap:sync` (or `npm run cap:ios`) after every clone, checkout,
> or `git pull` — before opening or building in Xcode.**
>
> Capacitor's own `ios/.gitignore` deliberately excludes two generated files —
> `ios/App/App/capacitor.config.json` and `ios/App/App/config.xml` — so they are **not**
> in the repo. The Xcode project lists them as required bundle resources, so a fresh
> checkout opened directly in Xcode fails with *"capacitor.config.json is missing, and
> config.xml couldn't be found."* `cap sync` regenerates them; that error means sync
> hasn't been run yet. Using `npm run cap:ios` avoids this entirely — it syncs before
> opening Xcode.

```bash
npm install            # once
npm run cap:ios        # build:mobile → cap sync ios → open Xcode
```

Or step by step:

```bash
npm run build:mobile   # assemble www/
npx cap sync ios       # copy www/ into the iOS project + wire plugins
npx cap open ios       # open in Xcode
```

In Xcode: pick a Simulator or a connected device and press ▶︎ Run.
For real GPS + card tilt, test on a **physical device** — the Simulator can only
fake a static location (Features ▸ Location) and has no motion sensor.

**Re-run `npm run cap:sync` after any change to the web game** so the native bundle
picks it up.

## Ship to the App Store

1. In Xcode, select **Signing & Capabilities** for the `App` target → choose your Team.
   Xcode will create/manage the signing certificate and provisioning profile.
2. Set the version/build numbers (target ▸ General, or `MARKETING_VERSION` /
   `CURRENT_PROJECT_VERSION`).
3. Add an **app icon** and (optionally) a launch image in `App/Assets.xcassets`.
4. Select destination **Any iOS Device (arm64)** → **Product ▸ Archive**.
5. In the Organizer, **Distribute App ▸ App Store Connect ▸ Upload**.
6. In [App Store Connect](https://appstoreconnect.apple.com): create the app record,
   add screenshots, description, age rating, and the **Privacy ▸ Location** disclosure
   (we request *When In Use* for the live-map gameplay), then submit for review.

## Things to know before you submit

- **⚠️ Trademark / IP risk (guideline 5.2).** The name "FokéGo"/"FokéMap", the
  Poké-styled creatures, and the Pokémon-Go-like premise carry real risk of rejection
  on review, independent of the technical wrapping. The "folder creatures" framing helps
  but doesn't eliminate it. Worth settling naming/art before submission.
- **Minimum functionality (guideline 4.2).** Because content is bundled (not a remote
  URL) and the app uses native location, this is a real app, not "a website in a box" —
  but keep leaning into native capabilities if review pushes back.
- **OpenStreetMap tile policy.** The app pulls tiles directly from
  `tile.openstreetmap.org`, whose [usage policy](https://operations.osmfoundation.org/policies/tiles/)
  discourages heavy app traffic. Fine for launch; move to a proper tile provider
  (e.g. MapTiler, Stadia, Thunderforest) if usage grows.
- **Updates.** Bundled content means web changes reach users only via an App Store
  resubmission (`npm run cap:sync` → Archive → upload). If you later want
  push-without-resubmission, add a Capacitor live-update solution
  (e.g. `@capgo/capacitor-updater`) — Apple permits JS/asset OTA updates that don't
  change the app's purpose.

## Android (later)

The same `www/` bundle works for Android: `npm i @capacitor/android`,
`npx cap add android`, mirror the geolocation permission, and the geolocation shim +
local assets already work unchanged.
