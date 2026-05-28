import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { mergeRemoteNotes } = require('../../extension/sync.js')

function fallbackNote() {
  return {
    id: 'fresh',
    title: 'Untitled Note',
    content: '',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  }
}

describe('sync merge helper', () => {
  it('removes local notes when a remote tombstone arrives', () => {
    const result = mergeRemoteNotes({
      notes: [{
        id: 'note_1',
        title: 'Title',
        content: 'Body',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:00:00.000Z',
      }],
      currentNoteId: 'note_1',
      remoteNotes: [{
        id: 'note_1',
        updated_at: '2026-05-27T00:01:00.000Z',
        deleted_at: '2026-05-27T00:01:00.000Z',
      }],
      dirtyNoteIds: [],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes).toEqual([fallbackNote()])
    expect(result.dirtyNoteIds).toEqual(['fresh'])
  })

  it('keeps explicitly dirty local notes when remote absence is unknown', () => {
    const result = mergeRemoteNotes({
      notes: [{
        id: 'local_1',
        title: 'Local',
        content: 'Draft',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:02:00.000Z',
      }],
      currentNoteId: 'local_1',
      remoteNotes: [],
      dirtyNoteIds: ['local_1'],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes[0].id).toBe('local_1')
    expect(result.dirtyNoteIds).toEqual(['local_1'])
  })

  it('does not mark clean local notes dirty just because the remote response omits them', () => {
    const result = mergeRemoteNotes({
      notes: [{
        id: 'local_1',
        title: 'Local',
        content: 'Draft',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:02:00.000Z',
      }],
      currentNoteId: 'local_1',
      remoteNotes: [],
      dirtyNoteIds: [],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes[0].id).toBe('local_1')
    expect(result.dirtyNoteIds).toEqual([])
  })

  it('uses server timestamps when accepting remote changes', () => {
    const result = mergeRemoteNotes({
      notes: [{
        id: 'note_1',
        title: 'Old',
        content: 'Old',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:00:00.000Z',
      }],
      currentNoteId: 'note_1',
      remoteNotes: [{
        id: 'note_1',
        title: 'New',
        content: 'New',
        created_at: '2026-05-27T00:00:00.000Z',
        updated_at: '2026-05-27T00:10:00.000Z',
        deleted_at: null,
      }],
      dirtyNoteIds: [],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes[0].title).toBe('New')
    expect(result.notes[0].updatedAt).toBe('2026-05-27T00:10:00.000Z')
  })

  it('does not resurrect deleted notes when a later tombstone is present', () => {
    const result = mergeRemoteNotes({
      notes: [],
      currentNoteId: 'note_1',
      remoteNotes: [{
        id: 'note_1',
        updated_at: '2026-05-27T00:10:00.000Z',
        deleted_at: '2026-05-27T00:10:00.000Z',
      }],
      dirtyNoteIds: [],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes).toEqual([fallbackNote()])
    expect(result.currentNoteId).toBe('fresh')
  })
})
