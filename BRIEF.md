# BRIEF.md

## Chat Closeout - 2026-04-11 01:07 UTC

**Objective:** Set up the development environment for the Prospector (Unworked Gold) codebase so agents can run the app and test changes.

**What was changed:**
- Installed `wrangler` (Cloudflare CLI) globally for serving static files + Cloudflare Pages Functions
- Created `AGENTS.md` with architecture overview, dev server instructions, external service notes, and key gotchas
- Verified dev server, static assets, serverless function endpoints, and full browser-based UI interaction

**Decisions made:**
- Use `wrangler pages dev . --port 8788` as the dev server (serves both static files and `functions/` directory)
- Install wrangler globally (`npm install -g wrangler`) since the repo has no `package.json`
- No `.gitignore` was added; `.wrangler/` runtime cache is left untracked
- No lint/test tooling exists — manual browser testing is the validation method

**Open TODOs:**
- Consider adding a `.gitignore` to exclude `.wrangler/` and `node_modules/`
- Consider adding a linter (e.g., ESLint) or formatter for code quality
- Optional: configure `ANTHROPIC_KEY`, `SUPABASE_SERVICE_KEY`, `RESEND_KEY` secrets for full API functionality

**Exact next step for the next agent:** The dev environment is ready. Run `wrangler pages dev . --port 8788` from `/workspace` to start the app. Begin work on whatever feature/bug task is assigned — no further setup is needed.
