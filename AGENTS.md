# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

Prospector (branded "Unworked Gold") is a static gold prospecting web application deployed on Cloudflare Pages. It consists of vanilla HTML/CSS/JS (no build step, no bundler) with two Cloudflare Pages Functions for serverless API endpoints.

### Architecture

| Component | Path | Notes |
|---|---|---|
| Main map app | `index.html` | ~4600 lines, loads Mapbox + Supabase from CDN |
| Dashboard | `dashboard.html` | User dashboard for saved claims/logs |
| Shared styles | `style.css` | CSS variables, responsive layout |
| Claude AI proxy | `functions/api/claude.js` | Requires `ANTHROPIC_KEY` env var |
| Alerts cron | `functions/api/alerts.js` | Requires `SUPABASE_SERVICE_KEY` + `RESEND_KEY` |

### Running the Dev Server

```
wrangler pages dev . --port 8788
```

This serves both static files and the `functions/` directory (Cloudflare Pages Functions convention). No build step is needed.

- The app loads at `http://localhost:8788/`
- Dashboard loads at `http://localhost:8788/dashboard` (Cloudflare Pages strips `.html` extensions)
- API endpoints: `POST /api/claude`, `POST /api/alerts`

### External Services

The app depends on hosted SaaS services (no local databases):

- **Supabase** (auth + PostgreSQL database) — URL and anon key are hardcoded in the HTML files
- **Mapbox** — token is fetched dynamically from Supabase `app_config` table at runtime
- **NWS / USGS / Coinbase APIs** — public APIs called directly from the browser, no keys needed

### Linting / Testing

There are no automated tests or lint configurations in this repo. The project uses vanilla HTML/CSS/JS with no build tools, package manager, or test framework. Manual browser testing via `wrangler pages dev` is the primary validation method.

### Key Gotchas

- There is no `package.json` in the repo — wrangler is installed globally
- The Supabase anon key is hardcoded in both `index.html` and `dashboard.html` (in `window.PROSPECTOR_CONFIG`)
- Mapbox GL JS is loaded dynamically only after the Mapbox token is retrieved from Supabase
- The `functions/api/claude.js` endpoint will return a 500 error without `ANTHROPIC_KEY` set — this is expected and doesn't affect core map functionality
- The `functions/api/alerts.js` endpoint requires `SUPABASE_SERVICE_KEY` and `RESEND_KEY` — only needed for email alerts
