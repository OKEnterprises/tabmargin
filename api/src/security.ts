import { cors } from 'hono/cors'
import type { Context } from 'hono'
import type { Bindings } from './types'

// Normalize every entry through new URL().origin so configured values match the
// browser-sent Origin header byte-for-byte (e.g. a trailing slash is dropped).
// Both BILLING_RETURN_URL and ALLOWED_ORIGINS go through the same path.
function addOrigin(origins: Set<string>, value: string) {
  try {
    origins.add(new URL(value).origin)
  } catch {
    // ignore: malformed origin in config, skip it rather than crash CORS
  }
}

function configuredOrigins(env: Bindings): Set<string> {
  const origins = new Set<string>()
  if (env.BILLING_RETURN_URL) addOrigin(origins, env.BILLING_RETURN_URL)
  for (const origin of env.ALLOWED_ORIGINS?.split(',') ?? []) {
    const trimmed = origin.trim()
    if (trimmed) addOrigin(origins, trimmed)
  }
  return origins
}

export const apiCors = cors({
  origin: (origin, c) => {
    if (!origin) return null
    if (origin.startsWith('moz-extension://')) return origin
    if (configuredOrigins(c.env).has(origin)) return origin
    return null
  },
  allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
})

export function nonce(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

export function withHtmlSecurity(c: Context, scriptNonce: string, connectSrc?: string) {
  const connect = connectSrc ? ` connect-src ${connectSrc};` : ''
  c.header('Content-Security-Policy',
    `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self'; font-src https://fonts.gstatic.com; style-src 'nonce-${scriptNonce}' https://fonts.googleapis.com; script-src 'nonce-${scriptNonce}';${connect}`)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
}
