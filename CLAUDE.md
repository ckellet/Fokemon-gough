# FokéGo — project notes

A location-based "catch creatures on a live map" web game (vanilla JS — no framework),
also shipped as a native iOS app via Capacitor.

- **Web game:** `index.html`, `app.js`, `app.logic.js`, `styles.css`, `vendor/`, `audio/`.
  Pure game logic lives in `app.logic.js` (unit-tested); `app.js` is the DOM/UI layer.
- **Identity/auth:** `identity.js` — per-user GUN/SEA key pair, gated by Sign in with Apple
  on native. See `MOBILE.md`.
- **iOS app:** Capacitor wrapper under `ios/`. Build details in `MOBILE.md`.

## Package manager: pnpm (not npm)

Use **pnpm** for everything — `pnpm install`, `pnpm test`, `pnpm run <script>`. Do **not**
run `npm install` here (it creates a conflicting `package-lock.json`; this repo uses
`pnpm-lock.yaml`).

**`pnpm-workspace.yaml` sets `nodeLinker: hoisted` — do not remove it.** This makes
`node_modules` flat (real folders) like npm's, instead of pnpm's default `.pnpm` symlink
store. It's **required** for the Capacitor iOS build: `cap sync` writes `node_modules`
paths into `ios/App/CapApp-SPM/Package.swift`, and Xcode's Swift Package Manager cannot
reliably resolve pnpm's symlinked `.pnpm` paths (you get *"package … cannot be accessed /
doesn't exist in file system"* in Xcode). Hoisted layout fixes this. (Confirmed: pnpm v11
reads this from `pnpm-workspace.yaml`, not `.npmrc`.)

## Common commands

```bash
pnpm install            # install deps (flat layout via nodeLinker: hoisted)
pnpm test               # node --test (logic + smoke tests)
pnpm run build:mobile   # assemble the self-contained www/ bundle
pnpm run cap:sync       # build:mobile + cap sync ios
pnpm run cap:ios        # build:mobile + cap sync ios + open Xcode
```

## Gotcha: after changing dependencies

When you add/update/remove a dependency, the `node_modules` paths baked into
`Package.swift` change. So:

1. `pnpm install` then `pnpm run cap:sync` (regenerates `Package.swift`).
2. In Xcode, **File → Packages → Reset Package Caches** → **Resolve Package Versions**
   (or just quit and reopen Xcode) so SPM re-resolves against the new paths. Skipping this
   leaves Xcode pointing at stale package paths and the build fails.
