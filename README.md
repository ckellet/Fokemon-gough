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

## Map and spawn system
- The map is rendered with Leaflet (CDN with SRI) and OpenStreetMap tiles.
- Fokemon spawn locations are deterministic per `(grid cell, time bucket)` — every trainer in the same ~111 m cell sees the same Fokemon in the same world coordinates.
- Grid cells default to `0.001°` (~111 m) and time buckets to 3 minutes; see `app.logic.js` (`SPAWN_CELL_DEGREES`, `SPAWN_INTERVAL_MS`).
- Local catches are persisted in `localStorage`; grid-wide catches are mirrored through GUN so the same Fokemon can't be caught twice by different trainers in the same cell during the same bucket.

## Public sync datastore notes
- GUN is **self-hosted** in `vendor/gun.min.js` and loaded with a Subresource Integrity hash — no third-party CDN at runtime for state code.
- Public relays (`relay.peer.ooo`, `gun.o8.is`) are still used for transport; if both are down the app degrades to solo mode without errors.
- Because this is public infrastructure, do not store private or sensitive data.

## Tests
```bash
node --test
```
Includes a smoke test that evaluates `app.js` against a stubbed DOM to catch undeclared-identifier regressions.
