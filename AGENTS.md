# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

TabMargin is a Firefox extension (Manifest v2) that replaces the new tab page with a minimalist notepad. Users can create multiple notes, which are auto-saved and persist using the browser's local storage API. An optional paid cloud-sync tier (in progress) syncs notes across devices via a Cloudflare Workers + Hono API backed by Supabase Postgres.

## Repo Layout

Monorepo with two independently-deployed projects:

- `extension/` — the Firefox extension (plain HTML/CSS/JS, no build step)
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
  - `GET /me` — returns `{ email, plan: 'free' | 'pro', subscription }`
  - `GET /notes`, `PUT /notes/:id`, `DELETE /notes/:id` — gated behind `requirePro`; non-subscribers get **402 Payment Required**
  - `POST /billing/checkout` — creates Stripe Checkout Session, returns redirect URL
  - `POST /billing/portal` — creates Customer Portal Session
  - `GET /billing/success`, `GET /billing/cancel` — HTML landing pages for Stripe redirects
  - `POST /webhooks/stripe` — signature-verified, upserts the `subscriptions` row on `customer.subscription.{created,updated,deleted}`. Reads `current_period_end` from either Subscription or SubscriptionItem (moved in API 2025-04-30)

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

### Making Changes

When modifying theme behavior, remember that changes must be coordinated across three files:
- `extension/styles.css`: CSS custom properties and icon filters
- `extension/script.js`: Theme loading and `data-theme` attribute management
- `extension/popup.js`: Theme preference UI and storage

When adding new SVG icons, ensure they have appropriate CSS filters defined for both light and dark modes.
