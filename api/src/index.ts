import { Hono } from 'hono'
import { apiCors } from './security'
import { billingRoutes } from './routes/billing'
import { meRoutes } from './routes/me'
import { notesRoutes } from './routes/notes'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', apiCors)

app.get('/health', (c) => c.json({ ok: true }))
app.route('/', meRoutes())
app.route('/notes', notesRoutes())
app.route('/', billingRoutes())

export default app
