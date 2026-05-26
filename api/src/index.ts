import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

type Bindings = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_ID: string
  STRIPE_WEBHOOK_SECRET: string
  BILLING_RETURN_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}))

// ---------- helpers ----------

function userClient(env: Bindings, authHeader: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function serviceClient(env: Bindings): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getStripe(env: Bindings): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  })
}

function supabaseFail(c: any, error: { message: string; code?: string }) {
  console.error('supabase error:', error)
  const status = error.code === 'PGRST303' ? 401 : 500
  return c.json({ error: error.message, code: error.code }, status)
}

type SubRow = {
  status: string
  current_period_end: string | null
}

function isActivePro(sub: SubRow | null): boolean {
  if (!sub) return false
  if (!['active', 'trialing'].includes(sub.status)) return false
  if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) return false
  return true
}

// ---------- public ----------

app.get('/health', (c) => c.json({ ok: true }))

// ---------- authenticated ----------

const requireAuth: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}

app.get('/me', requireAuth, async (c) => {
  const sb = userClient(c.env, c.req.header('Authorization')!)
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData.user) return c.json({ error: 'unauthorized' }, 401)

  const { data: sub } = await sb
    .from('subscriptions')
    .select('status, current_period_end, cancel_at_period_end')
    .maybeSingle()

  const pro = isActivePro(sub as SubRow | null)

  return c.json({
    email: userData.user.email,
    plan: pro ? 'pro' : 'free',
    subscription: sub || null,
  })
})

// ---------- notes (pro-gated) ----------

const requirePro: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const sb = userClient(c.env, c.req.header('Authorization')!)
  const { data, error } = await sb
    .from('subscriptions')
    .select('status, current_period_end')
    .maybeSingle()

  if (error && error.code === 'PGRST303') {
    return c.json({ error: error.message, code: error.code }, 401)
  }
  if (!isActivePro(data as SubRow | null)) {
    return c.json({ error: 'subscription required', code: 'upgrade_required' }, 402)
  }
  await next()
}

app.use('/notes', requireAuth, requirePro)
app.use('/notes/*', requireAuth, requirePro)

app.get('/notes', async (c) => {
  const sb = userClient(c.env, c.req.header('Authorization')!)
  const { data, error } = await sb
    .from('notes')
    .select('id, title, content, created_at, updated_at, deleted_at')
    .order('updated_at', { ascending: false })

  if (error) return supabaseFail(c, error)
  return c.json({ notes: data })
})

app.put('/notes/:id', async (c) => {
  const sb = userClient(c.env, c.req.header('Authorization')!)
  const id = c.req.param('id')
  const body = await c.req.json<{
    title: string
    content: string
    updated_at: string
  }>()

  const { data, error } = await sb
    .from('notes')
    .upsert(
      {
        id,
        title: body.title,
        content: body.content,
        updated_at: body.updated_at,
      },
      { onConflict: 'id' }
    )
    .select()
    .single()

  if (error) return supabaseFail(c, error)
  return c.json({ note: data })
})

app.delete('/notes/:id', async (c) => {
  const sb = userClient(c.env, c.req.header('Authorization')!)
  const { error } = await sb
    .from('notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', c.req.param('id'))

  if (error) return supabaseFail(c, error)
  return c.json({ ok: true })
})

// ---------- billing ----------

app.post('/billing/checkout', requireAuth, async (c) => {
  const sb = userClient(c.env, c.req.header('Authorization')!)
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData.user) return c.json({ error: 'unauthorized' }, 401)

  const stripe = getStripe(c.env)

  const { data: existingSub } = await sb
    .from('subscriptions')
    .select('stripe_customer_id')
    .maybeSingle()

  let customerId = existingSub?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userData.user.email,
      metadata: { supabase_user_id: userData.user.id },
    })
    customerId = customer.id
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: c.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${c.env.BILLING_RETURN_URL}/billing/success`,
    cancel_url: `${c.env.BILLING_RETURN_URL}/billing/cancel`,
    client_reference_id: userData.user.id,
    metadata: { supabase_user_id: userData.user.id },
    allow_promotion_codes: true,
  })

  return c.json({ url: session.url })
})

app.post('/billing/portal', requireAuth, async (c) => {
  const sb = userClient(c.env, c.req.header('Authorization')!)
  const { data: sub } = await sb
    .from('subscriptions')
    .select('stripe_customer_id')
    .maybeSingle()

  if (!sub?.stripe_customer_id) {
    return c.json({ error: 'no subscription' }, 404)
  }

  const stripe = getStripe(c.env)
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${c.env.BILLING_RETURN_URL}/billing/success`,
  })

  return c.json({ url: session.url })
})

// ---------- billing landing pages ----------

function landingPage(title: string, heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Fraunces:ital,opsz,wght@1,9..144,400&display=swap">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Manrope', system-ui, sans-serif;
      background: #f7f3ec;
      color: #2a2520;
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1612; color: #ebe2d4; }
      .card { background: #221d17; }
      .meta { color: #8a7e72; }
    }
    .card {
      background: #fcf9f3;
      border-radius: 16px;
      padding: 48px 52px;
      max-width: 460px;
      text-align: center;
    }
    h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-style: italic;
      font-weight: 400;
      font-size: 38px;
      margin: 0 0 16px;
      letter-spacing: -0.02em;
    }
    p { font-size: 15px; line-height: 1.6; margin: 0 0 8px; }
    .meta { color: #8a7e72; font-size: 13px; margin-top: 20px; }
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

function resetPasswordPage(supabaseUrl: string, supabaseAnonKey: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TabMargin — Reset password</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Fraunces:ital,opsz,wght@1,9..144,400&display=swap">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Manrope', system-ui, sans-serif;
      background: #f7f3ec;
      color: #2a2520;
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1612; color: #ebe2d4; }
      .card { background: #221d17; }
      .meta { color: #8a7e72; }
      input { background: #1a1612; color: #ebe2d4; border-color: #3a342c; }
    }
    .card {
      background: #fcf9f3;
      border-radius: 16px;
      padding: 40px 44px;
      max-width: 420px;
      width: 100%;
    }
    h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-style: italic;
      font-weight: 400;
      font-size: 32px;
      margin: 0 0 18px;
      letter-spacing: -0.02em;
      text-align: center;
    }
    label { display: block; font-size: 13px; margin: 14px 0 6px; }
    input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid #d8cfbf;
      background: #fff;
      font: inherit;
      color: inherit;
    }
    button {
      margin-top: 18px;
      width: 100%;
      padding: 11px;
      border-radius: 8px;
      border: 0;
      background: #2a2520;
      color: #fcf9f3;
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
    button[disabled] { opacity: 0.5; cursor: default; }
    .meta { color: #8a7e72; font-size: 13px; margin-top: 16px; text-align: center; }
    .error { color: #b04a3a; font-size: 13px; margin-top: 12px; }
    .ok { color: #3a7a4a; font-size: 14px; margin-top: 12px; text-align: center; }
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
    <p class="meta" id="meta">This link expires shortly — finish here.</p>
  </div>
  <script>
    const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};
    const SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};
    const params = new URLSearchParams(location.hash.slice(1));
    const accessToken = params.get('access_token');
    const type = params.get('type');
    const form = document.getElementById('form');
    const done = document.getElementById('done');
    const error = document.getElementById('error');
    const submit = document.getElementById('submit');

    function showError(msg) {
      error.textContent = msg;
      error.hidden = false;
    }

    if (type !== 'recovery' || !accessToken) {
      form.hidden = true;
      showError('This page must be opened from a password-reset email.');
      error.hidden = false;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const pw = document.getElementById('pw').value;
      const pw2 = document.getElementById('pw2').value;
      if (pw !== pw2) return showError('Passwords do not match.');
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + accessToken,
          },
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
</html>`;
}

app.get('/billing/success', (c) =>
  c.html(landingPage(
    'TabMargin — Subscribed',
    'You’re in.',
    '<p>Cloud sync is now active on your TabMargin account. Open a new tab and your notes will start syncing in the background.</p>'
  ))
)

app.get('/reset-password', (c) =>
  c.html(resetPasswordPage(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY))
)

app.get('/billing/cancel', (c) =>
  c.html(landingPage(
    'TabMargin — Checkout cancelled',
    'No charge.',
    '<p>You closed checkout before subscribing. Head back to TabMargin whenever you’re ready.</p>'
  ))
)

// ---------- stripe webhook ----------

app.post('/webhooks/stripe', async (c) => {
  const signature = c.req.header('stripe-signature')
  if (!signature) return c.json({ error: 'no signature' }, 400)

  const body = await c.req.text()
  const stripe = getStripe(c.env)

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('webhook signature verification failed:', err)
    return c.json({ error: 'invalid signature' }, 400)
  }

  const sbAdmin = serviceClient(c.env)

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const eventSub = event.data.object as Stripe.Subscription

      // Re-fetch the canonical subscription. Stripe does not guarantee event
      // ordering, so a late-arriving .created snapshot (status=incomplete) could
      // otherwise overwrite an already-applied .updated (status=active).
      // Re-fetching makes every delivery idempotent on current truth.
      let sub: Stripe.Subscription
      try {
        sub = await stripe.subscriptions.retrieve(eventSub.id)
      } catch (err) {
        console.error('failed to retrieve subscription', eventSub.id, err)
        // Ack so Stripe doesn't retry indefinitely; the next event will reconcile.
        break
      }

      const customer = await stripe.customers.retrieve(sub.customer as string)
      if (customer.deleted) break

      const userId = (customer as Stripe.Customer).metadata.supabase_user_id
      console.log('webhook', event.type, { customerId: customer.id, userId, subId: sub.id, status: sub.status })
      if (!userId) {
        console.error('no supabase_user_id on customer', customer.id, 'metadata:', (customer as Stripe.Customer).metadata)
        break
      }

      // current_period_end moved from Subscription to SubscriptionItem in API 2025-04-30.
      // Read from either location to stay compatible across SDK/API versions.
      const periodEndUnix =
        (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end ??
        (sub.items.data[0] as Stripe.SubscriptionItem & { current_period_end?: number })?.current_period_end

      const { error } = await sbAdmin.from('subscriptions').upsert(
        {
          user_id: userId,
          stripe_customer_id: customer.id,
          stripe_subscription_id: sub.id,
          status: sub.status,
          price_id: sub.items.data[0]?.price.id,
          current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

      if (error) console.error('subscription upsert error:', error)
      break
    }
    default:
      // unhandled event type — ack so Stripe doesn't retry
      break
  }

  return c.json({ received: true })
})

export default app
