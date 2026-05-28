import { Hono } from 'hono'
import Stripe from 'stripe'
import { requireAuth } from '../auth'
import { serviceClient, userClient } from '../db'
import { nonce, withHtmlSecurity } from '../security'
import type { Bindings } from '../types'

function getStripe(env: Bindings): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  })
}

function landingPage(styleNonce: string, title: string, heading: string, body: string): string {
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
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { font-family: 'Manrope', system-ui, sans-serif; background: #f7f3ec; color: #2a2520; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    @media (prefers-color-scheme: dark) { body { background: #1a1612; color: #ebe2d4; } .card { background: #221d17; } .meta { color: #8a7e72; } }
    .card { background: #fcf9f3; border-radius: 16px; padding: 48px 52px; max-width: 460px; text-align: center; }
    h1 { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-weight: 400; font-size: 38px; margin: 0 0 16px; }
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

function resetPasswordPage(scriptNonce: string, supabaseUrl: string, supabaseAnonKey: string): string {
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
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { font-family: 'Manrope', system-ui, sans-serif; background: #f7f3ec; color: #2a2520; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    @media (prefers-color-scheme: dark) { body { background: #1a1612; color: #ebe2d4; } .card { background: #221d17; } .meta { color: #8a7e72; } input { background: #1a1612; color: #ebe2d4; border-color: #3a342c; } }
    .card { background: #fcf9f3; border-radius: 16px; padding: 40px 44px; max-width: 420px; width: 100%; }
    h1 { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-weight: 400; font-size: 32px; margin: 0 0 18px; text-align: center; }
    label { display: block; font-size: 13px; margin: 14px 0 6px; }
    input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #d8cfbf; background: #fff; font: inherit; color: inherit; }
    button { margin-top: 18px; width: 100%; padding: 11px; border-radius: 8px; border: 0; background: #2a2520; color: #fcf9f3; font: inherit; font-weight: 500; cursor: pointer; }
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

export function billingRoutes() {
  const app = new Hono<{ Bindings: Bindings }>()

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

    if (!sub?.stripe_customer_id) return c.json({ error: 'no subscription' }, 404)

    const stripe = getStripe(c.env)
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${c.env.BILLING_RETURN_URL}/billing/success`,
    })

    return c.json({ url: session.url })
  })

  app.get('/billing/success', (c) => {
    const n = nonce()
    withHtmlSecurity(c, n)
    return c.html(landingPage(
      n,
      'TabMargin - Subscribed',
      'You are in.',
      '<p>Cloud sync is now active on your TabMargin account. Open a new tab and your notes will start syncing in the background.</p>'
    ))
  })

  app.get('/billing/cancel', (c) => {
    const n = nonce()
    withHtmlSecurity(c, n)
    return c.html(landingPage(
      n,
      'TabMargin - Checkout cancelled',
      'No charge.',
      '<p>You closed checkout before subscribing. Head back to TabMargin whenever you are ready.</p>'
    ))
  })

  app.get('/reset-password', (c) => {
    const n = nonce()
    withHtmlSecurity(c, n, c.env.SUPABASE_URL)
    return c.html(resetPasswordPage(n, c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY))
  })

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
        let sub: Stripe.Subscription
        try {
          sub = await stripe.subscriptions.retrieve(eventSub.id)
        } catch (err) {
          console.error('failed to retrieve subscription', eventSub.id, err)
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
        break
    }

    return c.json({ received: true })
  })

  return app
}
