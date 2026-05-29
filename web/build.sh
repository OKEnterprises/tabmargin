#!/usr/bin/env sh
# Build the static bundle for Cloudflare Pages (app.tabmargin.com).
#
# No bundler. The shared core (sync.js / api.js / script.js / popup.js) and the
# shared styles are copied verbatim from the canonical extension/ directory; the
# web-specific overlays (storage.js / app.js / web.css / index.html / _headers)
# are layered on top. The web storage.js shadows the extension's — it's the one
# file that differs between the two surfaces (localStorage vs browser.storage).
set -e
cd "$(dirname "$0")"

DIST=dist
rm -rf "$DIST"
mkdir -p "$DIST"

# Shared logic — canonical copies live in ../extension (also where api/src/sync.test.ts imports from)
cp ../extension/sync.js ../extension/api.js ../extension/script.js ../extension/popup.js "$DIST"/

# Shared styles
cp ../extension/tokens.css ../extension/styles.css ../extension/popup.css "$DIST"/

# Web-specific overlays (these win over any same-named file copied above)
cp storage.js app.js web.css index.html _headers "$DIST"/

echo "Built $DIST/ ($(ls -1 "$DIST" | wc -l | tr -d ' ') files)"
