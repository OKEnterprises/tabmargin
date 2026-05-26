// TabMargin API client — shared by popup (auth UI) and newtab (sync engine).
// No build step; loaded via <script> tag, exposes window.TabMarginAPI.

(function () {
  const SUPABASE_URL = 'https://lktbfmoaodwmkdywkmfs.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_eBYGppKqlRMhzB8JTXcRGg_Gt4BszpL';
  const API_URL = 'https://api.tabmargin.com';

  async function supabaseAuth(path, body) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error_description || data.msg || data.error || `auth ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function storeSession(session) {
    return browser.storage.local.set({
      auth: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: Date.now() + (session.expires_in * 1000),
        user: { id: session.user.id, email: session.user.email },
      },
    });
  }

  async function getSession() {
    const { auth } = await browser.storage.local.get('auth');
    return auth || null;
  }

  async function signUp(email, password) {
    const data = await supabaseAuth('/signup', { email, password });
    // If email confirmation is required, signup returns user without session
    if (data.access_token) {
      await storeSession(data);
      return { signedIn: true };
    }
    return { signedIn: false, needsConfirm: true };
  }

  async function signIn(email, password) {
    const data = await supabaseAuth('/token?grant_type=password', { email, password });
    await storeSession(data);
    return { signedIn: true };
  }

  async function requestPasswordReset(email) {
    const redirectTo = encodeURIComponent(`${API_URL}/reset-password`);
    await supabaseAuth(`/recover?redirect_to=${redirectTo}`, { email });
    return { ok: true };
  }

  async function signOut() {
    const session = await getSession();
    if (session?.access_token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
      }).catch(() => {});
    }
    await browser.storage.local.remove('auth');
  }

  async function refreshSession() {
    const session = await getSession();
    if (!session?.refresh_token) return null;
    try {
      const data = await supabaseAuth('/token?grant_type=refresh_token', {
        refresh_token: session.refresh_token,
      });
      await storeSession(data);
      return data;
    } catch {
      await browser.storage.local.remove('auth');
      return null;
    }
  }

  async function apiRequest(path, options = {}, retried = false) {
    const session = await getSession();
    if (!session) throw new Error('Not signed in');

    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        ...(options.headers || {}),
      },
    });

    if (res.status === 401 && !retried) {
      const refreshed = await refreshSession();
      if (refreshed) return apiRequest(path, options, true);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let body = null;
      try { body = JSON.parse(text); } catch {}
      const err = new Error(body?.error || `API ${res.status}`);
      err.status = res.status;
      err.code = body?.code;
      throw err;
    }

    return res.json();
  }

  async function fetchRemoteNotes() {
    const data = await apiRequest('/notes');
    return data.notes || [];
  }

  async function getMe() {
    return apiRequest('/me');
  }

  async function createCheckoutUrl() {
    const data = await apiRequest('/billing/checkout', { method: 'POST' });
    return data.url;
  }

  async function createPortalUrl() {
    const data = await apiRequest('/billing/portal', { method: 'POST' });
    return data.url;
  }

  async function pushNote(note) {
    return apiRequest(`/notes/${encodeURIComponent(note.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: note.title,
        content: note.content,
        updated_at: note.updatedAt,
      }),
    });
  }

  async function deleteRemoteNote(id) {
    return apiRequest(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  window.TabMarginAPI = {
    getSession,
    signUp,
    signIn,
    signOut,
    requestPasswordReset,
    fetchRemoteNotes,
    pushNote,
    deleteRemoteNote,
    getMe,
    createCheckoutUrl,
    createPortalUrl,
  };
})();
