// Storage/environment adapter — EXTENSION variant.
//
// This is the one file that differs between the extension and the hosted web
// app (web/storage.js is the localStorage variant). Everything downstream —
// sync.js, api.js, script.js, popup.js — talks to TabMarginStorage / TabMarginEnv
// and never touches browser.* directly, so the two surfaces share one codebase.
//
// Must be the FIRST <script> on every page (before sync.js/api.js/script.js/popup.js).
(function (root) {
  const local = browser.storage.local;

  // Surface mirrors the slice of browser.storage.local the app already used:
  // get(string|string[]) -> Promise<object> (absent keys omitted), set(obj),
  // remove(string|string[]), and onChanged(cb) where cb(changes, area) sees
  // changes[key] = { newValue } and area === 'local'. The web variant normalizes
  // the window 'storage' event into this same shape.
  root.TabMarginStorage = {
    get: (keys) => local.get(keys),
    set: (obj) => local.set(obj),
    remove: (key) => local.remove(key),
    onChanged: (cb) => browser.storage.onChanged.addListener(cb),
  };

  root.TabMarginEnv = {
    // Billing pages (Stripe checkout/portal) open in a new tab from the popup,
    // then the popup closes. The web variant replaces this with location.assign.
    openUrl: (url) => browser.tabs.create({ url, active: true }).then(() => window.close()),
    // deferInit is intentionally unset: the extension boots the editor immediately
    // (script.js), unchanged from before. The web variant sets it true so app.js
    // can gate the editor behind login.
  };
})(window);
