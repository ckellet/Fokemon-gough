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

## Tests
```bash
node --test
```
Includes a smoke test that evaluates `app.js` against a stubbed DOM to catch undeclared-identifier regressions.
