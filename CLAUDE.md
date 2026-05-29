# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TabMargin is a Firefox extension (Manifest v2) that replaces the new tab page with a minimalist notepad. Users can create multiple notes, which are auto-saved and persist using the browser's local storage API. An optional paid cloud-sync tier (in progress) syncs notes across devices via a Cloudflare Workers + Hono API backed by Supabase Postgres.

The same experience is also a **hosted web app** at `app.tabmargin.com` (for people who don't use the extension — e.g. iPad users), with a marketing landing page at `tabmargin.com`. The web app reuses the extension's code verbatim through a storage adapter (see "Shared core & storage adapter" below); the web app **requires login**, and like the extension, free users get a local-only notepad while cross-device sync requires Pro.

## Repo Layout

Monorepo with independently-deployed projects:

- `extension/` — the Firefox extension (plain HTML/CSS/JS, no build step). **Canonical home of the shared core** (`sync.js`, `api.js`, `script.js`, `popup.js`) — the web app copies these.
- `web/` — the hosted web app `app.tabmargin.com` (Cloudflare Pages). A thin shell (`storage.js`, `app.js`, `web.css`, `index.html`) over the shared core, assembled by `build.sh` (a `cp`, not a bundler).
- `site/` — the marketing landing page `tabmargin.com` (Cloudflare Pages). Standalone static HTML/CSS; no shared deps.
- `api/` — Cloudflare Workers API (TypeScript, Hono) handling cloud sync against Supabase
- `supabase/migrations/` — Supabase schema & RLS policies, managed with the Supabase CLI (`supabase db push`)

## Architecture

### Core Components

**Main Application (`extension/newtab.html`, `extension/script.js`, `extension/styles.css`)**
- `newtab.html`: Single-page application with sidebar, editor, and status bar
- `script.js`: Manages state (notes array, current note ID), handles auto-save with 500ms debounce, and listens for theme changes via `browser.storage.onChanged`
- `styles.css`: Theme system using CSS custom properties with three modes: system (default), light, and dark

**Settings Popup (`extension/popup.html`, `extension/popup.js`, `extension/popup.css`)**
- Accessible via toolbar icon click
- Saves theme preference to `browser.storage.local`
- Changes propagate instantly to all open tabs via storage listener

**Sync API (`api/src/` — `index.ts` composes the modular `routes/`, `auth.ts`, `db.ts`, `security.ts`, `validation.ts`, `types.ts`)**
- Hono app on Cloudflare Workers
- Forwards the user's Supabase JWT to PostgREST for `/notes/*` and `/me`; RLS on the `notes` and `subscriptions` tables enforces per-user access (Worker uses the anon key for these paths — no RLS bypass)
- Webhook path uses the service-role key (RLS-bypassing) because Stripe webhook requests have no user context
- Endpoints:
  - `GET /health` — liveness probe, returns `{ ok: true }`
  - `GET /me` — returns `{ email, plan: 'free' | 'pro', subscription }`
  - `GET /notes`, `PUT /notes/:id`, `DELETE /notes/:id` — gated behind `requirePro`; non-subscribers get **402 Payment Required**
  - `POST /billing/checkout` — creates Stripe Checkout Session, returns redirect URL
  - `POST /billing/portal` — creates Customer Portal Session
  - `GET /billing/success`, `GET /billing/cancel` — HTML landing pages for Stripe redirects
  - `GET /reset-password` — server-rendered password-reset page (Supabase recovery-email redirect target); its CSP widens `connect-src` to `SUPABASE_URL` so the inline script can PUT to `/auth/v1/user`. Lives in `routes/account.ts`.
  - `POST /webhooks/stripe` — signature-verified, upserts the `subscriptions` row on `customer.subscription.{created,updated,deleted}`. Reads `current_period_end` from either Subscription or SubscriptionItem (moved in API 2025-04-30). The Stripe client pins `apiVersion` `2025-02-24.acacia`.

**Storage Schema**
```javascript
{
  notes: [
    {
      id: "timestamp-string",
      title: "string",
      content: "string",
      createdAt: "ISO-8601",
      updatedAt: "ISO-8601"
    }
  ],
  currentNoteId: "timestamp-string",
  theme: "system" | "light" | "dark"
}
```

### Shared core & storage adapter

The extension and the web app run the **same** `sync.js` / `api.js` / `script.js` / `popup.js`. The only thing that differs between the two surfaces is storage, abstracted behind a small adapter that each surface provides in its own `storage.js`:

- `window.TabMarginStorage` — `get(keys)→Promise<obj>`, `set(obj)`, `remove(key)`, `onChanged(cb)` where `cb(changes, area)` sees `changes[key] = { newValue }`, `area === 'local'`. Extension impl wraps `browser.storage.local` / `browser.storage.onChanged`; web impl wraps `localStorage` (JSON-encoded) and normalizes the window `storage` event to the same shape.
- `window.TabMarginEnv` — `openUrl(url)` (extension: new tab + close popup; web: `location.assign`) and `deferInit` (web sets it so `app.js` can gate the editor behind login; the extension boots immediately).

Consequences to keep in mind:
- **No `browser.*` outside `extension/storage.js`.** Anything in the shared files must go through `TabMarginStorage` / `TabMarginEnv` or it will break on the web. (`grep -rn 'browser\.' extension/*.js` should only hit `storage.js` + comments.)
- **`storage.js` loads first** on every page, before `sync.js`/`api.js`/`script.js`/`popup.js`.
- The extension's `browser.storage.local` and the web's `localStorage` are **separate stores on separate origins** — they share no data. Only cloud sync (Pro) bridges the two surfaces.
- `script.js` exposes `window.TabMarginEditor = { init, refreshAuthState }`; `popup.js` exposes `window.TabMarginAccount = { renderAccountView }` and calls an optional `window.TabMarginOnAuthChange(session)` hook. These are no-ops/unused in the extension and are how `web/app.js` drives the login gate.

### Theme System Implementation

The theme system uses a data attribute approach:
- `script.js` sets `document.documentElement.setAttribute('data-theme', theme)` on load and when changed
- `styles.css` defines CSS custom properties for three states:
  - `:root` - base light theme
  - `:root[data-theme="dark"]` - forced dark
  - `:root[data-theme="light"]` - forced light (overrides system preference)
  - `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])` - system dark mode

SVG icon colors are adjusted using CSS filter properties that change based on theme.

### Key Design Decisions

- **No build step**: Plain HTML/CSS/JS for simplicity
- **Monospace font throughout**: Applied to `body` and cascades to all elements
- **Auto-save timing**: 500ms debounce prevents excessive writes
- **Sidebar behavior**: Uses `display: none` when hidden (not transform) to avoid animation overlap bugs
- **Default note**: Always creates one note on first run; never allows zero notes

## Development Workflow

### Testing the Extension

Load in Firefox for development:
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `extension/manifest.json`
4. Open a new tab to see the extension
5. Changes require clicking "Reload" in about:debugging

### Running the API locally

```
cd api
cp .dev.vars.example .dev.vars   # paste Supabase URL + anon key
npm install
npm run dev                       # wrangler dev — http://localhost:8787
```

The `.dev.vars` file is gitignored; production secrets are configured via `wrangler secret put`.

### Running & deploying the web app (`app.tabmargin.com`) and site (`tabmargin.com`)

Build the web app locally (copies the shared core from `extension/` + web overlays into `web/dist/`):

```
cd web && sh build.sh           # or: npm run build
python3 -m http.server 8795 --directory dist   # then open http://localhost:8795
```

`web/dist/` is gitignored (a build artifact). Note `api.js` hardcodes the production API/Supabase URLs, so local web testing hits production (same as the extension).

Both web surfaces deploy as **Cloudflare Pages** projects from this repo:

| Project | Custom domain | Root dir | Build command | Output dir |
|---|---|---|---|---|
| `tabmargin-app` | `app.tabmargin.com` | `web` | `sh build.sh` | `dist` |
| `tabmargin-site` | `tabmargin.com`, `www.tabmargin.com` | `site` | *(none)* | `.` |

After first deploy, set the API's CORS allow-list so the web app can call it — add `https://app.tabmargin.com` (mandatory) to `ALLOWED_ORIGINS` (Cloudflare dashboard var / `wrangler secret put ALLOWED_ORIGINS`; `security.ts` reads it at runtime — no code deploy needed). `tabmargin.com` only needs adding if the landing itself ever calls the API (it currently just deep-links to the app). `BILLING_RETURN_URL` stays pointed at the Worker — its `/billing/success|cancel` pages are platform-neutral and the web app re-checks `/me` on focus to flip the plan badge after Stripe.

Verify CORS: `curl -H 'Origin: https://app.tabmargin.com' https://api.tabmargin.com/health -i` should echo `access-control-allow-origin: https://app.tabmargin.com`.

### Running the tests

```
cd api && npm test          # vitest run
```

This single suite covers both the API routes (`src/routes/notes.test.ts`) and the
extension's sync-merge logic (`src/sync.test.ts`, which imports `extension/sync.js`
directly), so it's the one command to run after changing either side of the sync path.

`npm run typecheck` type-checks `src/` (test files are excluded from the main
`tsconfig.json`; `tsconfig.test.json` + `npm run typecheck:test` cover them).

### Versioning policy

The extension (`extension/manifest.json`) and the API (`api/package.json`) version
independently. The manifest version is the AMO-published add-on version (user-facing,
must increase on every AMO upload); the API's `package.json` version is internal and
not user-visible. Bumping one does not require bumping the other.

### Making Changes

When modifying theme behavior, remember that changes must be coordinated across three files:
- `extension/styles.css`: CSS custom properties and icon filters
- `extension/script.js`: Theme loading and `data-theme` attribute management
- `extension/popup.js`: Theme preference UI and storage

When adding new SVG icons, ensure they have appropriate CSS filters defined for both light and dark modes.
