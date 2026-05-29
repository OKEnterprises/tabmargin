// Storage/environment adapter — WEB variant (app.tabmargin.com).
//
// Mirror of extension/storage.js with a localStorage backend instead of
// browser.storage.local. Loaded FIRST, before sync.js/api.js/script.js/popup.js/
// app.js. Everything downstream calls only TabMarginStorage / TabMarginEnv, so
// those shared files are byte-identical to the extension's (the build copies
// them straight from ../extension — see build.sh).
//
// NOTE: localStorage here is a *different store* from the extension's
// browser.storage.local (different origin entirely), so the extension and the
// web app never share local data — only cloud sync (Pro) bridges them.
(function (root) {
  const PREFIX = 'tm:';

  function read(key) {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  root.TabMarginStorage = {
    // browser.storage.local.get takes a string or array and returns an object
    // containing only the keys that exist — mirror that (absent keys omitted),
    // since loadNotes() and getSession() rely on missing keys being undefined.
    get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) {
        const v = read(k);
        if (v !== undefined) out[k] = v;
      }
      return Promise.resolve(out);
    },
    set(obj) {
      // localStorage stores strings only — JSON-encode every value.
      for (const k of Object.keys(obj)) {
        localStorage.setItem(PREFIX + k, JSON.stringify(obj[k]));
      }
      return Promise.resolve();
    },
    remove(key) {
      const list = Array.isArray(key) ? key : [key];
      for (const k of list) localStorage.removeItem(PREFIX + k);
      return Promise.resolve();
    },
    onChanged(cb) {
      // The 'storage' event fires only in OTHER tabs of this origin (never the
      // tab that wrote) — which matches how the extension used onChanged to
      // propagate theme/auth between its popup and newtab contexts. Normalize to
      // the (changes, area) shape the listeners expect: changes[key] = {newValue},
      // area === 'local'.
      window.addEventListener('storage', (e) => {
        if (!e.key || e.key.indexOf(PREFIX) !== 0) return;
        const key = e.key.slice(PREFIX.length);
        let newValue;
        try { newValue = e.newValue === null ? undefined : JSON.parse(e.newValue); }
        catch { newValue = undefined; }
        cb({ [key]: { newValue } }, 'local');
      });
    },
  };

  root.TabMarginEnv = {
    // Billing redirects navigate the current tab to Stripe (the extension opens
    // a new tab instead). Returns a promise to match the extension variant's
    // `await TabMarginEnv.openUrl(url)` in popup.js.
    openUrl: (url) => { window.location.assign(url); return Promise.resolve(); },
    // Defer the editor boot so app.js can gate it behind login (the site requires
    // sign-in; the extension leaves this unset and boots immediately).
    deferInit: true,
  };
})(window);
