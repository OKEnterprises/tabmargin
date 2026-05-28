(function (root) {
  function remoteToLocal(remote) {
    return {
      id: remote.id,
      // Keep blank titles blank; the UI renders a placeholder rather than a
      // stored "Untitled Note" sentinel (see updateCurrentNote / renderNotesList).
      title: remote.title ?? '',
      content: remote.content || '',
      createdAt: remote.created_at,
      updatedAt: remote.updated_at
    };
  }

  function sortNotes(notes) {
    return [...notes].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  function mergeRemoteNotes({ notes, currentNoteId, remoteNotes, dirtyNoteIds, pendingDeleteIds, createFallbackNote }) {
    const byId = new Map(notes.map(note => [note.id, note]));
    const dirty = new Set(dirtyNoteIds);
    const pendingDelete = new Set(pendingDeleteIds);
    let nextCurrentNoteId = currentNoteId;

    for (const remote of remoteNotes) {
      // A delete we've queued but not yet confirmed: the note is already gone
      // locally, and the inclusive `since` cursor commonly re-returns the still
      // -live row. Skip it so it doesn't resurrect before the delete lands.
      if (pendingDelete.has(remote.id)) {
        byId.delete(remote.id);
        continue;
      }

      if (remote.deleted_at) {
        byId.delete(remote.id);
        dirty.delete(remote.id);
        continue;
      }

      const local = byId.get(remote.id);
      if (!local) {
        byId.set(remote.id, remoteToLocal(remote));
        continue;
      }

      if (dirty.has(remote.id)) continue;

      const localTime = new Date(local.updatedAt).getTime();
      const remoteTime = new Date(remote.updated_at).getTime();
      if (remoteTime >= localTime) {
        byId.set(remote.id, remoteToLocal(remote));
      }
    }

    let nextNotes = sortNotes(byId.values());
    if (nextNotes.length === 0) {
      const fresh = createFallbackNote();
      nextNotes = [fresh];
      nextCurrentNoteId = fresh.id;
      dirty.add(fresh.id);
    } else if (!nextNotes.find(note => note.id === nextCurrentNoteId)) {
      nextCurrentNoteId = nextNotes[0].id;
    }

    return {
      notes: nextNotes,
      currentNoteId: nextCurrentNoteId,
      dirtyNoteIds: [...dirty],
    };
  }

  const api = { mergeRemoteNotes, remoteToLocal };
  root.TabMarginSync = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
