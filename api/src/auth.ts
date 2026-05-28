import type { MiddlewareHandler } from 'hono'
import { supabaseFail, userClient } from './db'
import type { Bindings, SubRow } from './types'

export function isActivePro(sub: SubRow | null): boolean {
  if (!sub) return false
  if (!['active', 'trialing'].includes(sub.status)) return false
  if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) return false
  return true
}

// Cheap gate: asserts a `Bearer <jwt>` header is present and forwards it to
// PostgREST via userClient(). It does NOT verify the token itself — Supabase
// RLS (auth.uid() = user_id) is the authoritative check on every /notes and
// /me query, and a bad/expired token surfaces as a downstream 401/PGRST303.
// Handlers that need the user object (e.g. checkout) additionally call
// sb.auth.getUser(); /billing/portal skips it because its only query is the
// RLS-gated subscriptions lookup.
export const requireAuth: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}

export const requirePro: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const sb = userClient(c.env, c.req.header('Authorization')!)
  const { data, error } = await sb
    .from('subscriptions')
    .select('status, current_period_end')
    .maybeSingle()

  // A genuine query failure must not be mistaken for "no subscription" — that
  // would tell a paying customer to upgrade (402) on a transient DB hiccup.
  // supabaseFail maps PGRST303 -> 401 and everything else -> 500.
  if (error) return supabaseFail(c, error)
  if (!isActivePro(data as SubRow | null)) {
    return c.json({ error: 'subscription required', code: 'upgrade_required' }, 402)
  }
  await next()
}
