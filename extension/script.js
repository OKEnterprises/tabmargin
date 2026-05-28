// State management
let state = {
  notes: [],
  currentNoteId: null,
  saveTimeout: null
};

// Sync state
const dirtyNotes = new Set();
const pendingDeletes = new Set();
let isSignedIn = false;
let isSyncing = false;
let syncError = false;
let needsUpgrade = false;
let flushTimer = null;
let lastSyncAt = null;
let editEpoch = 0;

// DOM elements
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebar');
const newNoteBtn = document.getElementById('newNoteBtn');
const notesList = document.getElementById('notesList');
const noteTitle = document.getElementById('noteTitle');
const editor = document.getElementById('editor');
const charCount = document.getElementById('charCount');
const wordCount = document.getElementById('wordCount');
const saveStatus = document.getElementById('saveStatus');
const exportBtn = document.getElementById('exportBtn');
const deleteBtn = document.getElementById('deleteBtn');

// Storage functions
async function loadNotes() {
  try {
    const result = await browser.storage.local.get([
      'notes',
      'currentNoteId',
      'dirtyNoteIds',
      'pendingDeleteIds',
      'lastSyncAt'
    ]);

    if (result.notes && result.notes.length > 0) {
      state.notes = result.notes;
      state.currentNoteId = result.currentNoteId || state.notes[0].id;
    } else {
      // Create default note if none exist
      const defaultNote = createNewNote();
      state.notes = [defaultNote];
      state.currentNoteId = defaultNote.id;
      await saveNotes();
    }
    loadSyncState(result);
  } catch (error) {
    console.error('Error loading notes:', error);
    // Create default note on error
    const defaultNote = createNewNote();
    state.notes = [defaultNote];
    state.currentNoteId = defaultNote.id;
  }
}

function loadSyncState(result) {
  dirtyNotes.clear();
  pendingDeletes.clear();
  (result.dirtyNoteIds || []).forEach(id => dirtyNotes.add(id));
  (result.pendingDeleteIds || []).forEach(id => pendingDeletes.add(id));
  lastSyncAt = result.lastSyncAt || null;
}

async function saveSyncState() {
  await browser.storage.local.set({
    dirtyNoteIds: [...dirtyNotes],
    pendingDeleteIds: [...pendingDeletes],
    lastSyncAt
  });
}

async function saveNotes() {
  try {
    await browser.storage.local.set({
      notes: state.notes,
      currentNoteId: state.currentNoteId,
      dirtyNoteIds: [...dirtyNotes],
      pendingDeleteIds: [...pendingDeletes],
      lastSyncAt
    });
    updateSaveStatus('saved');
    scheduleFlush();
  } catch (error) {
    console.error('Error saving notes:', error);
    updateSaveStatus('error');
  }
}

// Note operations
function createNewNote() {
  return {
    // Collision-resistant id: a bare Date.now() string can repeat for notes
    // created in the same millisecond. base36 time + random suffix stays within
    // the server's id charset and works on the Firefox 79 baseline (no
    // crypto.randomUUID, which needs FF 95+).
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    title: 'Untitled Note',
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function addNewNote() {
  const newNote = createNewNote();
  state.notes.unshift(newNote);
  state.currentNoteId = newNote.id;
  dirtyNotes.add(newNote.id);

  renderNotesList();
  loadCurrentNote();
  saveNotes();
  noteTitle.focus();
}

function getCurrentNote() {
  return state.notes.find(note => note.id === state.currentNoteId);
}

function updateCurrentNote() {
  const currentNote = getCurrentNote();
  if (!currentNote) return;
  const nextTitle = noteTitle.value.trim();
  const nextContent = editor.value;
  if (currentNote.title === nextTitle && currentNote.content === nextContent) return;
  currentNote.title = nextTitle;
  currentNote.content = nextContent;
  currentNote.updatedAt = new Date().toISOString();
  dirtyNotes.add(currentNote.id);
  // Bump on every real edit so an in-flight pull can tell whether the user typed
  // during its await and avoid clobbering the live editor (see pullAndMerge).
  editEpoch++;
}

function switchNote(noteId) {
  updateCurrentNote();
  if (deleteConfirmTimeout) resetDeleteConfirm();

  state.currentNoteId = noteId;
  loadCurrentNote();
  saveNotes();
}

let deleteConfirmTimeout = null;

function resetDeleteConfirm() {
  deleteBtn.classList.remove('confirming');
  clearTimeout(deleteConfirmTimeout);
  deleteConfirmTimeout = null;
}

function performDelete() {
  resetDeleteConfirm();

  if (state.notes.length === 1) {
    const currentNote = getCurrentNote();
    currentNote.title = 'Untitled Note';
    currentNote.content = '';
    currentNote.updatedAt = new Date().toISOString();
    dirtyNotes.add(currentNote.id);
    noteTitle.value = '';
    editor.value = '';
    updateStats();
    renderNotesList();
    saveNotes();
    return;
  }

  const deletedId = state.currentNoteId;
  const currentIndex = state.notes.findIndex(note => note.id === deletedId);
  state.notes = state.notes.filter(note => note.id !== deletedId);
  const newIndex = currentIndex >= state.notes.length ? state.notes.length - 1 : currentIndex;
  state.currentNoteId = state.notes[newIndex].id;

  pendingDeletes.add(deletedId);
  dirtyNotes.delete(deletedId);

  renderNotesList();
  loadCurrentNote();
  saveNotes();
}

function deleteCurrentNote() {
  if (deleteBtn.classList.contains('confirming')) {
    performDelete();
    return;
  }

  deleteBtn.classList.add('confirming');
  deleteConfirmTimeout = setTimeout(resetDeleteConfirm, 3000);
}

// UI functions
function loadCurrentNote() {
  const currentNote = getCurrentNote();
  if (currentNote) {
    noteTitle.value = currentNote.title === 'Untitled Note' ? '' : currentNote.title;
    editor.value = currentNote.content;
    updateStats();
    renderNotesList();
  }
}

function renderNotesList() {
  notesList.innerHTML = '';

  state.notes.forEach(note => {
    const noteItem = document.createElement('div');
    noteItem.className = 'note-item';
    noteItem.dataset.noteId = note.id;
    if (note.id === state.currentNoteId) {
      noteItem.classList.add('active');
    }

    const title = document.createElement('div');
    title.className = 'note-item-title';
    title.textContent = note.title;

    const preview = document.createElement('div');
    preview.className = 'note-item-preview';
    preview.textContent = note.content.substring(0, 50) || 'Empty note';

    noteItem.appendChild(title);
    noteItem.appendChild(preview);

    noteItem.addEventListener('click', () => switchNote(note.id));
    notesList.appendChild(noteItem);
  });
}

function updateActiveNoteListItem() {
  const currentNote = getCurrentNote();
  if (!currentNote) return;
  for (const item of notesList.children) {
    if (item.dataset.noteId !== currentNote.id) continue;
    item.querySelector('.note-item-title').textContent = currentNote.title;
    item.querySelector('.note-item-preview').textContent =
      currentNote.content.substring(0, 50) || 'Empty note';
    return;
  }
  renderNotesList();
}

function updateStats() {
  const text = editor.value;
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  charCount.textContent = `${chars} character${chars !== 1 ? 's' : ''}`;
  wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
}

let localSaveState = 'saved'; // 'saving' | 'saved' | 'error'

function updateSaveStatus(status) {
  localSaveState = status;
  renderStatus();
}

function renderStatus() {
  saveStatus.classList.remove('saving', 'saved', 'error', 'synced');

  if (localSaveState === 'error') {
    saveStatus.textContent = 'Error saving';
    saveStatus.classList.add('error');
    return;
  }
  if (localSaveState === 'saving') {
    saveStatus.textContent = 'Saving';
    saveStatus.classList.add('saving');
    return;
  }
  if (!isSignedIn) {
    saveStatus.textContent = 'Saved';
    saveStatus.classList.add('saved');
    return;
  }
  if (needsUpgrade) {
    saveStatus.textContent = 'Upgrade to sync';
    saveStatus.classList.add('error');
    return;
  }
  if (syncError) {
    saveStatus.textContent = 'Sync error';
    saveStatus.classList.add('error');
    return;
  }
  if (isSyncing || dirtyNotes.size > 0 || pendingDeletes.size > 0) {
    saveStatus.textContent = 'Syncing';
    saveStatus.classList.add('saving');
    return;
  }
  saveStatus.textContent = 'Synced';
  saveStatus.classList.add('saved', 'synced');
}

// Auto-save with debouncing
function autoSave() {
  updateSaveStatus('saving');

  clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(() => {
    updateCurrentNote();
    updateActiveNoteListItem();
    saveNotes();
  }, 500); // Save 500ms after user stops typing
}

// Export functionality
function exportNote() {
  const currentNote = getCurrentNote();
  if (!currentNote) return;

  const blob = new Blob([currentNote.content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentNote.title}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Sync engine ----
function scheduleFlush() {
  if (!isSignedIn) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushPending, 200);
}

function remoteToLocal(r) {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

async function flushPending() {
  if (!isSignedIn) return;
  if (isSyncing) return;
  if (dirtyNotes.size === 0 && pendingDeletes.size === 0) return;

  isSyncing = true;
  renderStatus();

  let hadFailure = false;
  let hitUpgrade = false;

  for (const id of [...pendingDeletes]) {
    if (hitUpgrade) break;
    try {
      await TabMarginAPI.deleteRemoteNote(id);
      pendingDeletes.delete(id);
      await saveSyncState();
    } catch (err) {
      if (err.status === 402) { hitUpgrade = true; break; }
      console.error('Delete failed for', id, err);
      hadFailure = true;
    }
  }

  for (const id of [...dirtyNotes]) {
    if (hitUpgrade) break;
    const note = state.notes.find(n => n.id === id);
    if (!note) {
      dirtyNotes.delete(id);
      continue;
    }
    // Snapshot what we send. The note object is mutated in place by
    // updateCurrentNote(), so a keystroke landing during this await would
    // otherwise have its dirty flag cleared below and never get pushed.
    const pushedTitle = note.title;
    const pushedContent = note.content;
    try {
      const result = await TabMarginAPI.pushNote(note);
      const editedDuringPush =
        note.title !== pushedTitle || note.content !== pushedContent;
      if (editedDuringPush) {
        // Leave it dirty so the next flush re-pushes the newer content, and
        // don't apply the server timestamps — the local copy is now ahead.
        continue;
      }
      if (result.note) {
        note.createdAt = result.note.created_at;
        note.updatedAt = result.note.updated_at;
        lastSyncAt = maxIso(lastSyncAt, result.note.updated_at);
      }
      dirtyNotes.delete(id);
      await saveNotes();
    } catch (err) {
      if (err.status === 402) { hitUpgrade = true; break; }
      console.error('Push failed for', id, err);
      hadFailure = true;
    }
  }

  isSyncing = false;
  needsUpgrade = hitUpgrade;
  syncError = hadFailure && !hitUpgrade;
  renderStatus();

  // Re-push notes left dirty by a mid-flight edit. Guarded on no failures so a
  // persistent network error doesn't hot-loop the 200ms flush.
  if (!hitUpgrade && !hadFailure && dirtyNotes.size > 0) scheduleFlush();
}

async function pullAndMerge() {
  if (!isSignedIn || isSyncing) return;

  // capture any in-flight edits so LWW keeps the user's current typing
  updateCurrentNote();
  const epochAtPull = editEpoch;

  isSyncing = true;
  syncError = false;
  renderStatus();

  try {
    const remoteNotes = await TabMarginAPI.fetchRemoteNotes(lastSyncAt);
    needsUpgrade = false;
    // Flush anything typed *during* the await into state (and mark it dirty) so
    // the merge treats the current note as a local edit instead of overwriting it.
    updateCurrentNote();
    mergeRemote(remoteNotes);
    for (const remote of remoteNotes) {
      lastSyncAt = maxIso(lastSyncAt, remote.updated_at);
    }
    await browser.storage.local.set({
      notes: state.notes,
      currentNoteId: state.currentNoteId,
      dirtyNoteIds: [...dirtyNotes],
      pendingDeleteIds: [...pendingDeletes],
      lastSyncAt
    });
    // renderNotesList already refreshed the list + active highlight. Only reset
    // the editor from state if the user hasn't typed since the pull began;
    // otherwise leave their live text untouched (state already matches it).
    renderNotesList();
    if (editEpoch === epochAtPull) {
      loadCurrentNote();
    }
  } catch (err) {
    console.error('Pull failed:', err);
    if (err.status === 402) {
      needsUpgrade = true;
    } else {
      syncError = true;
    }
  } finally {
    isSyncing = false;
    renderStatus();
  }

  if (!needsUpgrade) await flushPending();
}

function mergeRemote(remoteNotes) {
  const merged = TabMarginSync.mergeRemoteNotes({
    notes: state.notes,
    currentNoteId: state.currentNoteId,
    remoteNotes,
    dirtyNoteIds: [...dirtyNotes],
    pendingDeleteIds: [...pendingDeletes],
    createFallbackNote: createNewNote
  });

  state.notes = merged.notes;
  state.currentNoteId = merged.currentNoteId;
  dirtyNotes.clear();
  merged.dirtyNoteIds.forEach(id => dirtyNotes.add(id));
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

async function refreshAuthState() {
  const session = await TabMarginAPI.getSession();
  const wasSignedIn = isSignedIn;
  isSignedIn = !!session;

  if (isSignedIn && !wasSignedIn) {
    if (!lastSyncAt && dirtyNotes.size === 0 && pendingDeletes.size === 0) {
      state.notes.forEach(note => dirtyNotes.add(note.id));
      await saveSyncState();
    }
    pullAndMerge();
  } else if (!isSignedIn && wasSignedIn) {
    dirtyNotes.clear();
    pendingDeletes.clear();
    syncError = false;
    needsUpgrade = false;
    await saveSyncState();
  }
  renderStatus();
}

// Event listeners
toggleSidebarBtn.addEventListener('click', () => {
  sidebar.classList.toggle('hidden');
});

newNoteBtn.addEventListener('click', addNewNote);

noteTitle.addEventListener('input', () => {
  updateStats();
  autoSave();
});

editor.addEventListener('input', () => {
  updateStats();
  autoSave();
});

exportBtn.addEventListener('click', exportNote);
deleteBtn.addEventListener('click', deleteCurrentNote);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + N: New note
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    addNewNote();
  }

  // Ctrl/Cmd + S: Manual save (already auto-saving, but for user comfort)
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    updateCurrentNote();
    saveNotes();
  }

  // Ctrl/Cmd + E: Export
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
    e.preventDefault();
    exportNote();
  }
});

// Theme management
async function loadTheme() {
  try {
    const result = await browser.storage.local.get('theme');
    const theme = result.theme || 'system';
    applyTheme(theme);
  } catch (error) {
    console.error('Error loading theme:', error);
    applyTheme('system');
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Listen for theme + auth changes from settings popup
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.theme) {
    applyTheme(changes.theme.newValue);
  }
  if (changes.auth) {
    refreshAuthState();
  }
});

// Pull on window focus when signed in
window.addEventListener('focus', () => {
  if (isSignedIn) pullAndMerge();
});

// Initialize
async function init() {
  await loadTheme();
  await loadNotes();
  loadCurrentNote();
  editor.focus();

  // refreshAuthState fires pullAndMerge in the background when signed in
  await refreshAuthState();
}

// Start the application
init();
