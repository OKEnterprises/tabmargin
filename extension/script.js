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
    const result = await browser.storage.local.get(['notes', 'currentNoteId']);

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
  } catch (error) {
    console.error('Error loading notes:', error);
    // Create default note on error
    const defaultNote = createNewNote();
    state.notes = [defaultNote];
    state.currentNoteId = defaultNote.id;
  }
}

async function saveNotes() {
  try {
    await browser.storage.local.set({
      notes: state.notes,
      currentNoteId: state.currentNoteId
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
    id: Date.now().toString(),
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
  const nextTitle = noteTitle.value.trim() || 'Untitled Note';
  const nextContent = editor.value;
  if (currentNote.title === nextTitle && currentNote.content === nextContent) return;
  currentNote.title = nextTitle;
  currentNote.content = nextContent;
  currentNote.updatedAt = new Date().toISOString();
  dirtyNotes.add(currentNote.id);
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
    renderNotesList();
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
    try {
      await TabMarginAPI.pushNote(note);
      dirtyNotes.delete(id);
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
}

async function pullAndMerge() {
  if (!isSignedIn || isSyncing) return;

  // capture any in-flight edits so LWW keeps the user's current typing
  updateCurrentNote();

  isSyncing = true;
  syncError = false;
  renderStatus();

  try {
    const remoteNotes = await TabMarginAPI.fetchRemoteNotes();
    needsUpgrade = false;
    mergeRemote(remoteNotes);
    await browser.storage.local.set({
      notes: state.notes,
      currentNoteId: state.currentNoteId
    });
    renderNotesList();
    loadCurrentNote();
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
  const byId = new Map(state.notes.map(n => [n.id, n]));
  const remoteIds = new Set(remoteNotes.map(r => r.id));

  for (const remote of remoteNotes) {
    if (remote.deleted_at) {
      byId.delete(remote.id);
      continue;
    }
    const local = byId.get(remote.id);
    if (!local) {
      byId.set(remote.id, remoteToLocal(remote));
    } else {
      const localTime = new Date(local.updatedAt).getTime();
      const remoteTime = new Date(remote.updated_at).getTime();
      if (remoteTime > localTime) {
        byId.set(remote.id, remoteToLocal(remote));
        dirtyNotes.delete(remote.id);
      } else if (localTime > remoteTime) {
        dirtyNotes.add(remote.id);
      }
    }
  }

  // Anything we still have locally that the server doesn't know about
  // needs to be pushed — this covers notes created before sign-in.
  for (const id of byId.keys()) {
    if (!remoteIds.has(id)) dirtyNotes.add(id);
  }

  state.notes = [...byId.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (state.notes.length === 0) {
    const fresh = createNewNote();
    state.notes = [fresh];
    state.currentNoteId = fresh.id;
    dirtyNotes.add(fresh.id);
  } else if (!state.notes.find(n => n.id === state.currentNoteId)) {
    state.currentNoteId = state.notes[0].id;
  }
}

async function refreshAuthState() {
  const session = await TabMarginAPI.getSession();
  const wasSignedIn = isSignedIn;
  isSignedIn = !!session;

  if (isSignedIn && !wasSignedIn) {
    pullAndMerge();
  } else if (!isSignedIn && wasSignedIn) {
    dirtyNotes.clear();
    pendingDeletes.clear();
    syncError = false;
    needsUpgrade = false;
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
