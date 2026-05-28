import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  subscription: { status: 'active', current_period_end: null as string | null } as any,
  notesResult: [] as any[],
  lastQuery: {} as Record<string, any>,
  upsertPayload: null as any,
  updatePayload: null as any,
}))

class Query {
  table: string
  result: { data: any; error: any } | null = null

  constructor(table: string) {
    this.table = table
  }

  select(value: string) {
    mockState.lastQuery.select = value
    return this
  }

  order(column: string, options: object) {
    mockState.lastQuery.order = [column, options]
    return this
  }

  is(column: string, value: unknown) {
    mockState.lastQuery.is = [column, value]
    return this
  }

  gte(column: string, value: string) {
    mockState.lastQuery.gte = [column, value]
    return this
  }

  upsert(value: any) {
    mockState.upsertPayload = value
    this.result = {
      data: { ...value, created_at: '2026-05-27T00:00:00.000Z' },
      error: null,
    }
    return this
  }

  update(value: any) {
    mockState.updatePayload = value
    this.result = {
      data: { id: 'note_1', created_at: '2026-05-27T00:00:00.000Z', ...value },
      error: null,
    }
    return this
  }

  eq(column: string, value: string) {
    mockState.lastQuery.eq = [column, value]
    return this
  }

  maybeSingle() {
    if (this.table === 'subscriptions') {
      return Promise.resolve({ data: mockState.subscription, error: null })
    }
    return Promise.resolve(this.result ?? { data: null, error: null })
  }

  single() {
    return Promise.resolve(this.result ?? { data: null, error: null })
  }

  then(resolve: (value: { data: any[]; error: null }) => unknown, reject: (reason: unknown) => unknown) {
    return Promise.resolve({ data: mockState.notesResult, error: null }).then(resolve, reject)
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => new Query(table),
    auth: {
      getUser: vi.fn(),
    },
  })),
}))

const { default: app } = await import('../index')

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_PRICE_ID: 'price_test',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  BILLING_RETURN_URL: 'https://api.tabmargin.com',
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: 'Bearer token',
    ...extra,
  }
}

describe('notes API', () => {
  beforeEach(() => {
    mockState.subscription = { status: 'active', current_period_end: null }
    mockState.notesResult = []
    mockState.lastQuery = {}
    mockState.upsertPayload = null
    mockState.updatePayload = null
  })

  it('rejects unauthenticated notes requests', async () => {
    const res = await app.request('/notes', {}, env)
    expect(res.status).toBe(401)
  })

  it('requires an active pro subscription', async () => {
    mockState.subscription = null
    const res = await app.request('/notes', { headers: authHeaders() }, env)
    expect(res.status).toBe(402)
  })

  it('fetches only active notes by default', async () => {
    mockState.notesResult = [{ id: 'note_1', title: 'A', content: 'B', created_at: '2026-05-27T00:00:00.000Z', updated_at: '2026-05-27T00:00:00.000Z', deleted_at: null }]
    const res = await app.request('/notes', { headers: authHeaders() }, env)
    expect(res.status).toBe(200)
    expect(mockState.lastQuery.is).toEqual(['deleted_at', null])
    expect(await res.json()).toEqual({ notes: mockState.notesResult })
  })

  it('returns tombstones without content for incremental fetches', async () => {
    mockState.notesResult = [{ id: 'note_1', title: '', content: '', created_at: '2026-05-27T00:00:00.000Z', updated_at: '2026-05-27T00:01:00.000Z', deleted_at: '2026-05-27T00:01:00.000Z' }]
    const res = await app.request('/notes?since=2026-05-27T00%3A00%3A00.000Z', { headers: authHeaders() }, env)
    expect(res.status).toBe(200)
    expect(mockState.lastQuery.gte).toEqual(['updated_at', '2026-05-27T00:00:00.000Z'])
    expect(await res.json()).toEqual({
      notes: [{
        id: 'note_1',
        created_at: '2026-05-27T00:00:00.000Z',
        updated_at: '2026-05-27T00:01:00.000Z',
        deleted_at: '2026-05-27T00:01:00.000Z',
      }],
    })
  })

  it('validates note payloads and ignores client timestamps', async () => {
    const res = await app.request('/notes/note_1', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: 'Title', content: 'Body', updated_at: '1999-01-01T00:00:00.000Z' }),
    }, env)

    expect(res.status).toBe(200)
    expect(mockState.upsertPayload.title).toBe('Title')
    expect(mockState.upsertPayload.content).toBe('Body')
    expect(mockState.upsertPayload.updated_at).not.toBe('1999-01-01T00:00:00.000Z')
    expect(mockState.upsertPayload.deleted_at).toBeNull()
  })

  it('rejects oversized note content', async () => {
    const res = await app.request('/notes/note_1', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: 'Title', content: 'x'.repeat(200_001) }),
    }, env)

    expect(res.status).toBe(413)
  })

  it('clears note content when deleting', async () => {
    const res = await app.request('/notes/note_1', {
      method: 'DELETE',
      headers: authHeaders(),
    }, env)

    expect(res.status).toBe(200)
    expect(mockState.updatePayload.title).toBe('')
    expect(mockState.updatePayload.content).toBe('')
    expect(mockState.updatePayload.deleted_at).toBeTruthy()
    expect(mockState.updatePayload.updated_at).toBe(mockState.updatePayload.deleted_at)
  })
})
