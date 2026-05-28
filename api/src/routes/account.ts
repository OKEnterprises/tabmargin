import { Hono } from 'hono'
import { nonce, withHtmlSecurity } from '../security'
import { resetPasswordPage } from '../views/html'
import type { Bindings } from '../types'

// Account/auth flows that are server-rendered by the Worker. The password-reset
// page is the redirect target for Supabase recovery emails — it PUTs the new
// password to Supabase /auth/v1/user, so it has nothing to do with billing.
export function accountRoutes() {
  const app = new Hono<{ Bindings: Bindings }>()

  app.get('/reset-password', (c) => {
    const n = nonce()
    // connect-src is widened to SUPABASE_URL so the inline script can call /auth/v1/user.
    withHtmlSecurity(c, n, c.env.SUPABASE_URL)
    return c.html(resetPasswordPage(n, c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY))
  })

  return app
}
