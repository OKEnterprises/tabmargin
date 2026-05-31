// HTML/CSS template builders for the Worker's server-rendered pages.
// Kept out of the route modules so billing/account routes stay focused on logic.

export function landingPage(styleNonce: string, title: string, heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Fraunces:ital,opsz,wght@1,9..144,400&display=swap">
  <style nonce="${styleNonce}">
    /* Token values copied from extension/tokens.css (warm-paper palette) so these
       server-rendered pages match the app. Dark mode overrides only the custom
       properties; every element rule reads var(--…), so the base rules can't be
       defeated by source order the way the old hard-coded @media block was. */
    :root {
      color-scheme: light dark;
      --bg-canvas: #f7f3ec; --bg-recessed: #efeae0; --bg-elevated: #fcf9f3;
      --ink-primary: #2a2520; --ink-tertiary: #9d9181;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-canvas: #1a1612; --bg-recessed: #141008; --bg-elevated: #221d17;
        --ink-primary: #ebe2d4; --ink-tertiary: #5a5048;
      }
    }
    * { box-sizing: border-box; }
    body { font-family: 'Manrope', system-ui, sans-serif; background: var(--bg-canvas); color: var(--ink-primary); margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { background: var(--bg-elevated); border: 1px solid var(--bg-recessed); border-radius: 16px; padding: 48px 52px; max-width: 460px; text-align: center; }
    h1 { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-weight: 400; font-size: 38px; margin: 0 0 16px; color: var(--ink-primary); }
    p { font-size: 15px; line-height: 1.6; margin: 0 0 8px; }
    .meta { color: var(--ink-tertiary); font-size: 13px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    ${body}
    <p class="meta">You can close this tab.</p>
  </div>
</body>
</html>`
}

export function resetPasswordPage(scriptNonce: string, supabaseUrl: string, supabaseAnonKey: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TabMargin - Reset password</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Fraunces:ital,opsz,wght@1,9..144,400&display=swap">
  <style nonce="${scriptNonce}">
    /* Token values copied from extension/tokens.css (warm-paper palette) so these
       server-rendered pages match the app. Dark mode overrides only the custom
       properties; every element rule reads var(--…), so the base rules can't be
       defeated by source order the way the old hard-coded @media block was.
       (The palette has no success-green, so the confirmation uses --ink-primary.) */
    :root {
      color-scheme: light dark;
      --bg-canvas: #f7f3ec; --bg-recessed: #efeae0; --bg-elevated: #fcf9f3;
      --ink-primary: #2a2520; --ink-secondary: #6f6055; --ink-tertiary: #9d9181;
      --accent: #b87055; --accent-hover: #a35f47; --on-accent: #fff7ef;
      --danger: #9e4a3c;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-canvas: #1a1612; --bg-recessed: #141008; --bg-elevated: #221d17;
        --ink-primary: #ebe2d4; --ink-secondary: #8a7e72; --ink-tertiary: #5a5048;
        --accent: #d99373; --accent-hover: #c98365; --on-accent: #2a1f18;
        --danger: #d98b7d;
      }
    }
    * { box-sizing: border-box; }
    body { font-family: 'Manrope', system-ui, sans-serif; background: var(--bg-canvas); color: var(--ink-primary); margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { background: var(--bg-elevated); border: 1px solid var(--bg-recessed); border-radius: 16px; padding: 40px 44px; max-width: 420px; width: 100%; }
    h1 { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-weight: 400; font-size: 32px; margin: 0 0 18px; text-align: center; color: var(--ink-primary); }
    label { display: block; font-size: 13px; margin: 14px 0 6px; color: var(--ink-secondary); }
    input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--bg-recessed); background: var(--bg-canvas); font: inherit; color: var(--ink-primary); }
    input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }
    button { margin-top: 18px; width: 100%; padding: 11px; border-radius: 8px; border: 0; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600; cursor: pointer; }
    button:hover:not([disabled]) { background: var(--accent-hover); }
    button[disabled] { opacity: 0.5; cursor: default; }
    .meta { color: var(--ink-tertiary); font-size: 13px; margin-top: 16px; text-align: center; }
    .error { color: var(--danger); font-size: 13px; margin-top: 12px; }
    .ok { color: var(--ink-primary); font-size: 14px; margin-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Reset your password</h1>
    <form id="form">
      <label for="pw">New password</label>
      <input id="pw" type="password" autocomplete="new-password" required minlength="6">
      <label for="pw2">Confirm new password</label>
      <input id="pw2" type="password" autocomplete="new-password" required minlength="6">
      <button id="submit" type="submit">Set password</button>
      <div id="error" class="error" hidden></div>
    </form>
    <div id="done" hidden>
      <p class="ok">Password updated. You can close this tab and sign in from the TabMargin popup.</p>
    </div>
    <p class="meta" id="meta">This link expires shortly. Finish here.</p>
  </div>
  <script nonce="${scriptNonce}">
    const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};
    const SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};
    const params = new URLSearchParams(location.hash.slice(1));
    const accessToken = params.get('access_token');
    const type = params.get('type');
    const form = document.getElementById('form');
    const done = document.getElementById('done');
    const error = document.getElementById('error');
    const submit = document.getElementById('submit');
    function showError(msg) { error.textContent = msg; error.hidden = false; }
    if (type !== 'recovery' || !accessToken) {
      form.hidden = true;
      showError('This page must be opened from a password-reset email.');
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const pw = document.getElementById('pw').value;
      const pw2 = document.getElementById('pw2').value;
      if (pw !== pw2) return showError('Passwords do not match.');
      submit.disabled = true;
      submit.textContent = 'Saving...';
      try {
        const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + accessToken },
          body: JSON.stringify({ password: pw }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.msg || data.error_description || data.error || ('Error ' + res.status));
          submit.disabled = false;
          submit.textContent = 'Set password';
          return;
        }
        form.hidden = true;
        done.hidden = false;
        document.getElementById('meta').hidden = true;
      } catch (err) {
        showError(err.message || 'Network error');
        submit.disabled = false;
        submit.textContent = 'Set password';
      }
    });
  </script>
</body>
</html>`
}
