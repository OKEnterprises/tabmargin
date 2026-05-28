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
  console.error('supabase error:', error)
  const status = error.code === 'PGRST303' ? 401 : 500
  return c.json({ error: error.message, code: error.code }, status)
}
