import { Hono } from 'hono'
import { requireAuth, isActivePro } from '../auth'
import { userClient } from '../db'
import type { Bindings, SubRow } from '../types'

export function meRoutes() {
  const app = new Hono<{ Bindings: Bindings }>()

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

  return app
}
