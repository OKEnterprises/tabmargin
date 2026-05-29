import { Hono } from 'hono'
import { requireAuth, requirePro } from '../auth'
import { supabaseFail, userClient } from '../db'
import type { Bindings, NoteRow } from '../types'
import {
  MAX_NOTE_BODY_BYTES,
  isValidNoteId,
  validateNoteBody,
  validateSince,
} from '../validation'

export function notesRoutes() {
  const app = new Hono<{ Bindings: Bindings }>()

  app.use('*', requireAuth, requirePro)

  app.get('/', async (c) => {
    const since = validateSince(c.req.query('since'))
    if (!since.ok) return c.json({ error: since.error }, 400)

    const sb = userClient(c.env, c.req.header('Authorization')!)
    // No secondary tiebreaker on (updated_at): an inclusive `gte` cursor
    // intentionally re-fetches the boundary note each pull, and the client
    // merge is idempotent. Add `.order('id')` here if/when this grows pagination.
    let query = sb
      .from('notes')
      .select('id, title, content, created_at, updated_at, deleted_at')
      .order('updated_at', { ascending: false })

    if (since.since) {
      query = query.gte('updated_at', since.since)
    } else {
      query = query.is('deleted_at', null)
    }

    const { data, error } = await query
    if (error) return supabaseFail(c, error)

    const notes = ((data ?? []) as NoteRow[]).map((note) => {
      if (!note.deleted_at) return note
      return {
        id: note.id,
        created_at: note.created_at,
        updated_at: note.updated_at,
        deleted_at: note.deleted_at,
      }
    })

    return c.json({ notes })
  })

  app.put('/:id', async (c) => {
    const id = c.req.param('id')
    if (!isValidNoteId(id)) return c.json({ error: 'invalid note id' }, 400)

    // Fast-path reject only: a present, oversized content-length lets us bail
    // before buffering the body. It's spoofable and counts bytes (not UTF-16
    // chars), so the post-parse char caps in validateNoteBody are authoritative.
    const contentLength = Number(c.req.header('content-length') ?? 0)
    if (contentLength > MAX_NOTE_BODY_BYTES) {
      return c.json({ error: 'note body too large' }, 413)
    }

    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json' }, 400)
    }

    const body = validateNoteBody(rawBody)
    if (!body.ok) return c.json({ error: body.error }, body.status)

    const sb = userClient(c.env, c.req.header('Authorization')!)
    const now = new Date().toISOString()
    const { data, error } = await sb
      .from('notes')
      .upsert(
        {
          id,
          title: body.title,
          content: body.content,
          updated_at: now,
          deleted_at: null,
        },
        { onConflict: 'user_id,id' }
      )
      .select('id, title, content, created_at, updated_at, deleted_at')
      .single()

    if (error) return supabaseFail(c, error)
    return c.json({ note: data })
  })

  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    if (!isValidNoteId(id)) return c.json({ error: 'invalid note id' }, 400)

    const sb = userClient(c.env, c.req.header('Authorization')!)
    const now = new Date().toISOString()
    const { data, error } = await sb
      .from('notes')
      .update({
        title: '',
        content: '',
        deleted_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .select('id, created_at, updated_at, deleted_at')
      .maybeSingle()

    if (error) return supabaseFail(c, error)
    return c.json({ ok: true, note: data })
  })

  return app
}
