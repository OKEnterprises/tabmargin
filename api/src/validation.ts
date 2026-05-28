export const MAX_NOTE_TITLE_LENGTH = 300
export const MAX_NOTE_CONTENT_LENGTH = 200_000
export const MAX_NOTE_BODY_BYTES = 220_000
const NOTE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

export type NoteInput =
  | { ok: true; title: string; content: string }
  | { ok: false; status: 400 | 413; error: string }

export function isValidNoteId(id: string): boolean {
  return NOTE_ID_RE.test(id)
}

export function isIsoDate(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed)
}

export function validateSince(value: string | undefined): { ok: true; since?: string } | { ok: false; error: string } {
  if (!value) return { ok: true }
  if (!isIsoDate(value)) return { ok: false, error: 'invalid since' }
  return { ok: true, since: value }
}

export function validateNoteBody(body: unknown): NoteInput {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'invalid note body' }
  }
  const { title, content } = body as { title?: unknown; content?: unknown }
  if (typeof title !== 'string' || typeof content !== 'string') {
    return { ok: false, status: 400, error: 'title and content are required' }
  }
  if (title.length > MAX_NOTE_TITLE_LENGTH) {
    return { ok: false, status: 413, error: 'title too large' }
  }
  if (content.length > MAX_NOTE_CONTENT_LENGTH) {
    return { ok: false, status: 413, error: 'content too large' }
  }
  return { ok: true, title: title.trim() || 'Untitled Note', content }
}
