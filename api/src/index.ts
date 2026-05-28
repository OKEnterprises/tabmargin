import { Hono } from 'hono'
import { apiCors } from './security'
import { accountRoutes } from './routes/account'
import { billingRoutes } from './routes/billing'
import { meRoutes } from './routes/me'
import { notesRoutes } from './routes/notes'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', apiCors)

// URL surface (route modules declare their own full paths, so meRoutes /
// billingRoutes / accountRoutes all mount at '/'):
//   GET    /health                          — liveness probe
//   GET    /me                              — meRoutes
//   GET    /notes, PUT/DELETE /notes/:id    — notesRoutes (gated by requirePro)
//   POST   /billing/checkout, /billing/portal, /webhooks/stripe
//   GET    /billing/success, /billing/cancel  — billingRoutes
//   GET    /reset-password                  — accountRoutes
app.get('/health', (c) => c.json({ ok: true }))
app.route('/', meRoutes())
app.route('/notes', notesRoutes())
app.route('/', billingRoutes())
app.route('/', accountRoutes())

export default app
