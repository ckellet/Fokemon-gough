# FokéMap (Fokemon GO-style web prototype)

A lightweight web app prototype for a Pokémon GO-inspired Fokemon card experience.

## Features
- Beautiful glassmorphism-based UI with responsive layout.
- Simple trainer signup (no auth for now).
- Real-time global event feed synced through a free, unauthenticated public GUN peer.
- Local collection and stats persistence.
- GitHub Pages deployment workflow included.

## Run locally
Serve this directory with any static web server.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages deploy
1. Push this repository to GitHub.
2. In repository settings, open **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`, `master`, or `work` branch to trigger deployment.

Workflow file: `.github/workflows/deploy-pages.yml`.

### Cache busting (version stamping)
The source tree intentionally references assets **without** a version query
(`app.js`, `styles.css`, …) so local dev stays simple. The deploy workflow's
**Stamp build version** step rewrites the *artifact only* (never committed): it
writes the commit SHA into `version.json` and `<meta name="app-version">` and
appends `?v=<sha>` to the locally-served assets and the `app.logic.js` import.

`version-check.js` polls `version.json` (with `no-store`) on load, on
tab-focus, and every 5 minutes. When a deploy changes the version it shows a
dismissible "Reload" banner, so already-open tabs pick up new code without
waiting for the GitHub Pages HTML cache to lapse. Don't be surprised that the
checked-in files have no `?v=` — that is added at deploy time by design.

## Battle sites (Foké Gyms)
- Deterministic battle sites scatter the world alongside POIs (see `computeBattleSitePlacements`).
- Players within ~100 m can interact: deploy a champion at a vacant site, train an owned champion, or challenge a rival.
- Champions sync through the same public GUN store under `fokemon/battleSites/<siteId>`.
- Training is a dodge mini-game — survive incoming trainer-balls to earn boosts up to `MAX_TRAINING_BOOST_PER_STAT` per stat.
- Battles resolve via the deterministic `simulateBattle` simulator that respects HP/ATK/DEF/SPD plus a type-effectiveness matrix, animated turn-by-turn with type-specific skills, comic-text hits, and KO effects.
- Run-away protection: each successful defense increments fatigue, and champions auto-retire after `MAX_CHAMPION_DEFENSES` wins or `CHAMPION_TTL_MS` (24h).

## Map and spawn system
- The map is rendered with Leaflet (CDN with SRI) and OpenStreetMap tiles.
- Fokemon spawn locations are deterministic per `(grid cell, time bucket)` — every trainer in the same ~111 m cell sees the same Fokemon in the same world coordinates.
- Grid cells default to `0.001°` (~111 m) and time buckets to 3 minutes; see `app.logic.js` (`SPAWN_CELL_DEGREES`, `SPAWN_INTERVAL_MS`).
- Local catches are persisted in `localStorage`; grid-wide catches are mirrored through GUN so the same Fokemon can't be caught twice by different trainers in the same cell during the same bucket.

## Public sync datastore notes
- GUN is **self-hosted** in `vendor/gun.min.js` and loaded with a Subresource Integrity hash — no third-party CDN at runtime for state code.
- Public relays (`relay.peer.ooo`, `gun.o8.is`) are still used for transport; if both are down the app degrades to solo mode without errors.
- Because this is public infrastructure, do not store private or sensitive data.

## Debug tools
- Press **Ctrl/Cmd + Shift + L** to open the "Override location" dialog and pin yourself to any coordinates (handy for testing battle sites without walking around). Presets for London, NYC, Tokyo, and SF are included.
- The override persists in `localStorage` (`fokemon_debug_location`) and is shown via a 🐛 DEBUG LOC chip in the bottom-left corner — click the chip to clear it.
- From the browser console: `fokeDebug.setLocation(lat, lng)`, `fokeDebug.clearLocation()`, `fokeDebug.open()`.

## iOS / App Store build
The web game can be shipped to the App Store as a native app via Capacitor — see
[`MOBILE.md`](MOBILE.md). In short: `pnpm install` then `pnpm run cap:ios`. The web
deploy above is unaffected; the native shell is an additive layer that bundles the
game (Leaflet + fonts served locally) and bridges geolocation to CoreLocation.

## Tests
```bash
node --test
```
Includes a smoke test that evaluates `app.js` against a stubbed DOM to catch undeclared-identifier regressions.
