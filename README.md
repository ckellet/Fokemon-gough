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

## Public sync datastore notes
- This prototype uses GUN via CDN (`gun-manhattan.herokuapp.com`) for public unauthenticated synchronization.
- Because this is public infrastructure, do not store private or sensitive data.
