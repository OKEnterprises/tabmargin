import type { Context } from 'hono'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Bindings } from './types'

export function userClient(env: Bindings, authHeader: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function serviceClient(env: Bindings): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function supabaseFail(c: Context, error: { message: string; code?: string }) {
  // Log the raw PostgREST detail server-side; return a generic message so we
  // don't leak schema/driver internals to clients. PGRST303 = JWT expired/invalid.
  console.error('supabase error:', error)
  if (error.code === 'PGRST303') {
    return c.json({ error: 'session expired', code: 'token_expired' }, 401)
  }
  return c.json({ error: 'internal error' }, 500)
}
