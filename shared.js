// ─── Notes Section (SQLite via sql.js, persisted in IndexedDB) ─
let db = null;
let SQL = null;
function getPageKey() {
  return window.location.pathname.split('/').pop().replace('.html', '') || 'index';
}

// IndexedDB helpers
function openNotesDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('BackendHandbookNotes', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('sqlite')) {
        d.createObjectStore('sqlite');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function loadDBFromIndexedDB() {
  return openNotesDB().then(idb => {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction('sqlite', 'readonly');
      const store = tx.objectStore('sqlite');
      const req = store.get('database');
      req.onsuccess = () => { idb.close(); resolve(req.result); };
      req.onerror = () => { idb.close(); reject(req.error); };
    });
  });
}

function saveDBToIndexedDB(data) {
  return openNotesDB().then(idb => {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction('sqlite', 'readwrite');
      const store = tx.objectStore('sqlite');
      const req = store.put(data, 'database');
      req.onsuccess = () => { idb.close(); resolve(); };
      req.onerror = () => { idb.close(); reject(req.error); };
    });
  });
}

// Migrate existing localStorage notes to SQLite
function migrateLocalStorageNotes() {
  const dbKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('notes_')) dbKeys.push(key);
  }
  if (dbKeys.length === 0) return;

  const stmt = db.prepare(`INSERT OR REPLACE INTO notes (page_key, content, updated_at) VALUES (?, ?, datetime('now'))`);
  dbKeys.forEach(k => {
    const pageKey = k.replace('notes_', '');
    const content = localStorage.getItem(k);
    stmt.run([pageKey, content]);
    localStorage.removeItem(k);
  });
  stmt.free();
  persistDB();
}

function initSQLite() {
  // Load sql.js from CDN
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.js';
  script.onload = () => {
    initSqlJs({
      locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/${file}`
    }).then(async (sqlLib) => {
      SQL = sqlLib;
      try {
        const existing = await loadDBFromIndexedDB();
        if (existing) {
          db = new SQL.Database(new Uint8Array(existing));
        } else {
          db = new SQL.Database();
        }
      } catch (e) {
        db = new SQL.Database();
      }

      // Create notes table
      db.run(`CREATE TABLE IF NOT EXISTS notes (
        page_key TEXT PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        updated_at TEXT
      )`);

      // Migrate any old localStorage notes
      migrateLocalStorageNotes();

      // Re-inject notes if content is already rendered
      const existingSection = document.getElementById('notesSection');
      if (!existingSection) injectNotes();
    });
  };
  script.onerror = () => {
    // Fallback: just use localStorage if sql.js fails to load
    console.warn('sql.js failed to load, falling back to localStorage');
    injectNotesFallback();
  };
  document.head.appendChild(script);
}

function persistDB() {
  const data = db.export();
  saveDBToIndexedDB(Array.from(data));
}

function getNoteContent(pageKey) {
  const result = db.exec(`SELECT content FROM notes WHERE page_key = ?`, [pageKey]);
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0] || '';
  }
  return '';
}

function saveNoteContent(pageKey, content) {
  db.run(`INSERT OR REPLACE INTO notes (page_key, content, updated_at) VALUES (?, ?, datetime('now'))`,
    [pageKey, content]);
  persistDB();
}

function deleteNoteContent(pageKey) {
  db.run(`DELETE FROM notes WHERE page_key = ?`, [pageKey]);
  persistDB();
}

function getAllNotes() {
  const result = db.exec(`SELECT page_key, content, updated_at FROM notes ORDER BY page_key`);
  if (result.length === 0) return [];
  return result[0].values.map(row => ({
    page_key: row[0],
    content: row[1],
    updated_at: row[2]
  }));
}

// Fallback notes using localStorage if sql.js fails
function injectNotesFallback() {
  const content = document.querySelector('.content');
  if (!content || document.getElementById('notesSection')) return;
  injectNotesUI(content, true);
}

function injectNotes() {
  const content = document.querySelector('.content');
  if (!content || document.getElementById('notesSection')) return;
  injectNotesUI(content, false);
}

function injectNotesUI(content, isFallback) {
  const div = document.createElement('div');
  div.id = 'notesSection';
  div.className = 'notes-section';
  div.innerHTML = `
    <div class="notes-header" onclick="toggleNotes()">
      <div class="notes-header-left">
        <span class="notes-chevron" id="notesChevron">▶</span>
        <span class="notes-title">📝 Notes <span style="font-weight:400;font-size:10px;color:var(--text3)">(SQLite)</span></span>
      </div>
      <span style="font-size:11px;color:var(--text3)">Click to expand</span>
    </div>
    <div class="notes-body" id="notesBody">
      <div class="notes-toolbar">
        <button class="notes-btn" onclick="exportNotes()" title="Download .sqlite database file">📥 Export .sqlite</button>
        <button class="notes-btn" onclick="document.getElementById('notesFileInput').click()" title="Import from .sqlite or .json file">📤 Import</button>
        <button class="notes-btn" onclick="clearNotes()" title="Clear notes for this page">🗑 Clear</button>
        <input type="file" id="notesFileInput" class="file-input-hidden" accept=".sqlite,.json" onchange="importNotes(event)">
      </div>
      <textarea class="notes-textarea" id="notesTextarea" placeholder="Write your notes here..." ${isFallback ? 'data-fallback="1"' : ''}></textarea>
      <div class="notes-footer">
        <span class="notes-status" id="notesStatus">Ready</span>
        <span id="notesCount">0 words</span>
      </div>
    </div>
  `;
  content.appendChild(div);

  const pageKey = getPageKey();
  const textarea = document.getElementById('notesTextarea');

  if (isFallback) {
    // localStorage fallback
    const saved = localStorage.getItem('notes_' + pageKey);
    if (saved) { textarea.value = saved; updateNotesCount(); }
    let saveTimer;
    textarea.addEventListener('input', () => {
      updateNotesCount(); setStatus('saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        localStorage.setItem('notes_' + pageKey, textarea.value);
        setStatus('saved');
      }, 400);
    });
  } else {
    // SQLite mode
    const saved = getNoteContent(pageKey);
    if (saved) { textarea.value = saved; updateNotesCount(); }

    let saveTimer;
    textarea.addEventListener('input', () => {
      updateNotesCount(); setStatus('saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveNoteContent(pageKey, textarea.value);
        setStatus('saved');
      }, 400);
    });
  }

  // Restore collapsed state
  const wasOpen = localStorage.getItem('notesSection_open') === '1';
  if (wasOpen) {
    const body = document.getElementById('notesBody');
    const chevron = document.getElementById('notesChevron');
    body.classList.add('open');
    chevron.classList.add('open');
  }
}

function toggleNotes() {
  const body = document.getElementById('notesBody');
  const chevron = document.getElementById('notesChevron');
  if (!body || !chevron) return;
  const isOpen = body.classList.toggle('open');
  chevron.classList.toggle('open');
  localStorage.setItem('notesSection_open', isOpen ? '1' : '0');
}

function updateNotesCount() {
  const ta = document.getElementById('notesTextarea');
  if (!ta) return;
  const text = ta.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = ta.value.length;
  const el = document.getElementById('notesCount');
  if (el) el.textContent = `${words} words · ${chars} chars`;
}

function setStatus(state) {
  const el = document.getElementById('notesStatus');
  if (!el) return;
  if (state === 'saving') {
    el.textContent = 'Saving...';
    el.className = 'notes-status saving';
  } else if (state === 'saved') {
    el.textContent = '\u2713 Saved';
    el.className = 'notes-status saved';
    setTimeout(() => { el.textContent = 'Ready'; el.className = 'notes-status'; }, 2000);
  } else if (state === 'loading') {
    el.textContent = 'Loading...';
    el.className = 'notes-status saving';
  } else {
    el.textContent = 'Ready';
    el.className = 'notes-status';
  }
}

function exportNotes() {
  if (SQL && db) {
    // Export as .sqlite
    const data = db.export();
    const blob = new Blob([data], { type: 'application/x-sqlite3' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backend-handbook-notes.sqlite';
    a.click();
    URL.revokeObjectURL(a.href);
  } else {
    // Fallback: export as JSON
    const notes = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('notes_')) notes[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), notes }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backend-handbook-notes-fallback.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

function importNotes(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  // .sqlite import
  if (file.name.endsWith('.sqlite')) {
    if (!SQL || !db) { alert('SQLite not loaded yet. Please wait and try again.'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = new Uint8Array(e.target.result);
        const newDb = new SQL.Database(buffer);
        // Verify it has notes table
        const tables = newDb.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='notes'`);
        if (tables.length === 0) { alert('This .sqlite file does not contain a notes table.'); newDb.close(); return; }
        // Swap databases
        db.close();
        db = newDb;
        // Persist to IndexedDB
        persistDB();
        // Reload current page notes
        const pageKey = getPageKey();
        const content = getNoteContent(pageKey);
        const ta = document.getElementById('notesTextarea');
        if (ta) { ta.value = content; updateNotesCount(); }
        setStatus('saved');
        document.getElementById('notesStatus').textContent = '\u2713 Imported .sqlite';
      } catch (err) {
        alert('Failed to import .sqlite file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  // .json import (backward compat)
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);
      if (json.notes) {
        let count = 0;
        if (SQL && db) {
          // SQLite mode
          const stmt = db.prepare(`INSERT OR REPLACE INTO notes (page_key, content, updated_at) VALUES (?, ?, datetime('now'))`);
          Object.keys(json.notes).forEach(key => {
            stmt.run([key.replace('notes_', ''), json.notes[key]]);
            count++;
          });
          stmt.free();
          persistDB();
        } else {
          // Fallback mode: write to localStorage
          Object.keys(json.notes).forEach(key => {
            if (key.startsWith('notes_')) {
              localStorage.setItem(key, json.notes[key]);
              count++;
            }
          });
        }
        // Reload current page
        const pageKey = getPageKey();
        const saved = SQL && db ? getNoteContent(pageKey) : localStorage.getItem('notes_' + pageKey);
        const ta = document.getElementById('notesTextarea');
        if (ta) { ta.value = saved || ''; updateNotesCount(); }
        setStatus('saved');
        const statusEl = document.getElementById('notesStatus');
        if (statusEl) statusEl.textContent = `\u2713 Imported ${count} pages`;
        setTimeout(() => { if (statusEl) { statusEl.textContent = 'Ready'; statusEl.className = 'notes-status'; } }, 3000);
      }
    } catch (err) {
      alert('Invalid file format.');
    }
  };
  reader.readAsText(file);
}

function clearNotes() {
  if (!confirm('Clear all notes for this page?')) return;
  const pageKey = getPageKey();
  if (SQL && db) {
    deleteNoteContent(pageKey);
  } else {
    localStorage.removeItem('notes_' + pageKey);
  }
  const ta = document.getElementById('notesTextarea');
  if (ta) { ta.value = ''; updateNotesCount(); setStatus('saved'); }
}

// ─── Go to Notes (sidebar shortcut) ────────────────────
function goToNotes() {
  const section = document.getElementById('notesSection');
  if (!section) return;
  // Open the notes section if collapsed
  const body = document.getElementById('notesBody');
  const chevron = document.getElementById('notesChevron');
  if (body && !body.classList.contains('open')) {
    body.classList.add('open');
    if (chevron) chevron.classList.add('open');
    localStorage.setItem('notesSection_open', '1');
  }
  // Scroll to the notes section
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Focus the textarea after a short delay for smooth animation
  setTimeout(() => {
    const ta = document.getElementById('notesTextarea');
    if (ta) ta.focus();
  }, 400);
}

// ─── PWA Service Worker Registration ─────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ─── Font Size Controls ────────────────────────────────
function setFontSize(size) {
  const sizes = { small: '14px', medium: '16px', large: '19px' };
  if (!sizes[size]) return;
  document.documentElement.style.setProperty('--font-size-base', sizes[size]);
  localStorage.setItem('pref_fontSize', size);
  // Update active button
  document.querySelectorAll('.font-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === size);
  });
}

function loadFontSizePref() {
  const saved = localStorage.getItem('pref_fontSize') || 'medium';
  setFontSize(saved);
}

// ─── Reading Mode ───────────────────────────────────────
function toggleReadingMode() {
  const isActive = document.body.classList.toggle('reading-mode');
  localStorage.setItem('pref_readingMode', isActive ? '1' : '0');
  const btn = document.getElementById('readingModeBtn');
  if (btn) btn.classList.toggle('active', isActive);
  ensureFocusBar();
}

function ensureFocusBar() {
  if (document.querySelector('.focus-mode-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'focus-mode-bar';
  bar.innerHTML = `
    <span>\uD83D\uDCD6 Focus Mode</span>
    <button class="focus-mode-exit-btn" onclick="toggleReadingMode()">\u2190 Exit Focus Mode</button>
    <span style="font-size:10px;color:var(--text3)">Press <kbd style="background:var(--bg3);padding:1px 5px;border-radius:3px;border:1px solid var(--border);font-size:10px">R</kbd> to toggle</span>
  `;
  document.body.prepend(bar);
}

function loadReadingModePref() {
  if (localStorage.getItem('pref_readingMode') === '1') {
    document.body.classList.add('reading-mode');
    const btn = document.getElementById('readingModeBtn');
    if (btn) btn.classList.add('active');
    ensureFocusBar();
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initSQLite();
    initTheme();
    loadFontSizePref();
    loadReadingModePref();
    loadAccentPref();
    calculateReadingTimes();
    loadBookmark();
    addPermalinks();
    injectRelatedSections();
    buildReadingDashboard();
    updateDashboard();
  });
} else {
  initSQLite();
  initTheme();
  loadFontSizePref();
  loadReadingModePref();
  loadAccentPref();
  calculateReadingTimes();
  loadBookmark();
  addPermalinks();
  injectRelatedSections();
  buildReadingDashboard();
  updateDashboard();
}

// ─── Sidebar ──────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('pref_theme', newTheme);
  const icon = document.getElementById('themeIcon');
  const text = document.getElementById('themeText');
  if (icon) icon.textContent = isDark ? '\uD83C\uDF19' : '\u2600';
  if (text) text.textContent = isDark ? 'Dark' : 'Light';
}

// Auto dark/light mode based on system preference
function initTheme() {
  const saved = localStorage.getItem('pref_theme');
  if (saved) {
    const html = document.documentElement;
    const isDark = saved === 'dark';
    html.setAttribute('data-theme', saved);
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    if (icon) icon.textContent = isDark ? '\uD83C\uDF19' : '\u2600';
    if (text) text.textContent = isDark ? 'Dark' : 'Light';
    return;
  }
  // Auto-detect system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    const html = document.documentElement;
    if (html.getAttribute('data-theme') !== 'dark') {
      html.setAttribute('data-theme', 'dark');
    }
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    if (icon) icon.textContent = '\uD83C\uDF19';
    if (text) text.textContent = 'Dark';
  }
  // Listen for OS-level changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('pref_theme')) {
        const html = document.documentElement;
        html.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        const icon = document.getElementById('themeIcon');
        const text = document.getElementById('themeText');
        if (icon) icon.textContent = e.matches ? '\uD83C\uDF19' : '\u2600';
        if (text) text.textContent = e.matches ? 'Dark' : 'Light';
      }
    });
  }
}

// ─── Section Permalinks ────────────────────────────────
function addPermalinks() {
  const headings = document.querySelectorAll('.content h2[id], .content h3[id], .content h4[id]');
  headings.forEach(h => {
    if (h.querySelector('.permalink')) return;
    const link = document.createElement('a');
    link.className = 'permalink';
    link.href = '#' + h.id;
    link.textContent = '#';
    link.title = 'Link to this section';
    link.onclick = (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(window.location.href.split('#')[0] + '#' + h.id).then(() => {
        showPermalinkToast('Link copied: ' + h.id);
      });
    };
    h.appendChild(link);
  });
}

function showPermalinkToast(msg) {
  const existing = document.querySelector('.permalink-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'permalink-toast';
  toast.textContent = '\uD83D\uDD17 ' + msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 500);
    }, 2000);
  });
}

// ─── Code Block Copy Badge ─────────────────────────────
(function() {
  const COPIED_KEY = 'copied_code_blocks';
  function getCopied() {
    try { return JSON.parse(localStorage.getItem(COPIED_KEY)) || {}; } catch { return {}; }
  }
  function markCopied(blockId) {
    const data = getCopied();
    data[blockId] = true;
    localStorage.setItem(COPIED_KEY, JSON.stringify(data));
  }
  // Enhance existing copyCode to add badge
  const origCopyCode = window.copyCode;
  window.copyCode = function(btn) {
    const pre = btn.closest('.code-block').querySelector('pre');
    if (!pre) return;
    navigator.clipboard.writeText(pre.innerText).then(() => {
      btn.textContent = '\u2713 Copied!';
      btn.classList.add('copied');
      // Add a small checkmark badge to the code block header
      const header = btn.closest('.code-header');
      if (header) {
        let badge = header.querySelector('.copy-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'copy-badge';
          header.querySelector('.code-lang').after(badge);
        }
        badge.textContent = '\u2713';
        badge.title = 'Previously copied';
      }
      // Track in localStorage
      const lang = (btn.closest('.code-block').querySelector('.code-lang')?.textContent || 'code').trim();
      markCopied(lang + '_' + pre.innerText.length);
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 2000);
    });
  };
  // Restore badges on page load
  window.addEventListener('DOMContentLoaded', () => {
    const copied = getCopied();
    document.querySelectorAll('.code-block').forEach(block => {
      const lang = (block.querySelector('.code-lang')?.textContent || 'code').trim();
      const pre = block.querySelector('pre');
      const key = lang + '_' + (pre ? pre.innerText.length : '');
      if (copied[key]) {
        const header = block.querySelector('.code-header');
        if (header) {
          let badge = header.querySelector('.copy-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'copy-badge';
            header.querySelector('.code-lang').after(badge);
          }
          badge.textContent = '\u2713';
        }
      }
    });
  });
})();

// ─── Touch-friendly Sidebar Swipe ──────────────────────
(function() {
  let touchStartX = 0;
  let touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;
    // Only horizontal swipes, > 60px, and not on interactive elements
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
    const target = e.target;
    if (target.closest('input') || target.closest('textarea') || target.closest('select') || target.closest('.sidebar')) return;
    if (dx > 0) {
      // Swipe right → open sidebar
      const sidebar = document.getElementById('sidebar');
      if (sidebar && !sidebar.classList.contains('open') && window.innerWidth <= 768) {
        toggleSidebar();
      }
    } else {
      // Swipe left → close sidebar
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('open')) {
        toggleSidebar();
      }
    }
  }, { passive: true });
})();

// ─── Accent Color Picker ───────────────────────────────
const ACCENT_COLORS = [
  { name: 'Blue', accent: '#58a6ff', accent5: '#bc8cff' },
  { name: 'Green', accent: '#3fb950', accent5: '#56d364' },
  { name: 'Purple', accent: '#bc8cff', accent5: '#d2a8ff' },
  { name: 'Orange', accent: '#d29922', accent5: '#f0883e' },
  { name: 'Pink', accent: '#f85149', accent5: '#ff7b72' },
  { name: 'Teal', accent: '#39d353', accent5: '#7ee787' },
  { name: 'Cyan', accent: '#58a6ff', accent5: '#79c0ff' },
];

function openColorPicker() {
  const existing = document.getElementById('colorPickerModal');
  if (existing) { existing.classList.toggle('open'); return; }
  const modal = document.createElement('div');
  modal.id = 'colorPickerModal';
  modal.className = 'color-picker-modal';
  modal.innerHTML = `
    <div class="color-picker-content" onclick="event.stopPropagation()">
      <div class="color-picker-header">
        <span>\uD83C\uDFA8 Accent Color</span>
        <button class="color-picker-close" onclick="closeColorPicker()">&times;</button>
      </div>
      <div class="color-swatches">
        ${ACCENT_COLORS.map((c, i) => `
          <button class="color-swatch" data-index="${i}" style="--swatch:${c.accent}" onclick="setAccentColor(${i})" title="${c.name}">
            <span class="swatch-inner"></span>
          </button>
        `).join('')}
      </div>
      <div style="padding:8px 16px 12px;font-size:11px;color:var(--text3)">
        Click a color to apply. Persists across pages.
        <button onclick="resetAccentColor()" style="margin-left:8px;padding:2px 8px;border:1px solid var(--border);background:var(--bg3);border-radius:4px;color:var(--text2);font-size:11px;cursor:pointer">Reset</button>
      </div>
    </div>
  `;
  modal.onclick = () => closeColorPicker();
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
  highlightCurrentColor();
}

function closeColorPicker() {
  const modal = document.getElementById('colorPickerModal');
  if (modal) modal.classList.remove('open');
}

function setAccentColor(index) {
  const color = ACCENT_COLORS[index];
  if (!color) return;
  document.documentElement.style.setProperty('--accent', color.accent);
  document.documentElement.style.setProperty('--accent5', color.accent5);
  localStorage.setItem('pref_accent', index.toString());
  highlightCurrentColor();
}

function resetAccentColor() {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent5');
  localStorage.removeItem('pref_accent');
  closeColorPicker();
}

function loadAccentPref() {
  const saved = localStorage.getItem('pref_accent');
  if (saved !== null) {
    setAccentColor(parseInt(saved));
  }
}

function highlightCurrentColor() {
  const saved = localStorage.getItem('pref_accent');
  document.querySelectorAll('.color-swatch').forEach((sw, i) => {
    sw.classList.toggle('active', saved === i.toString());
  });
}

// ─── Reading Dashboard ─────────────────────────────────
function buildReadingDashboard() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || document.getElementById('readingDashboard')) return;

  const nav = sidebar.querySelector('nav');
  if (!nav) return;

  const dashboard = document.createElement('div');
  dashboard.id = 'readingDashboard';
  dashboard.className = 'reading-dashboard';
  dashboard.innerHTML = `
    <div class="rd-title">\uD83D\uDCCA Reading Dashboard</div>
    <div class="rd-stats">
      <div class="rd-stat" id="rdChapters"><span class="rd-val">-</span><span class="rd-lbl">Chapters</span></div>
      <div class="rd-stat" id="rdBookmarks"><span class="rd-val">-</span><span class="rd-lbl">Bookmarks</span></div>
      <div class="rd-stat" id="rdNotes"><span class="rd-val">-</span><span class="rd-lbl">Pages w/ Notes</span></div>
    </div>
  `;
  nav.insertBefore(dashboard, nav.firstChild);
  updateDashboard();
}

function updateDashboard() {
  const chaptersEl = document.getElementById('rdChapters');
  const bookmarksEl = document.getElementById('rdBookmarks');
  const notesEl = document.getElementById('rdNotes');
  if (!chaptersEl) return;
  // Chapters completed
  const completed = (() => { try { return JSON.parse(localStorage.getItem('completed_chapters')) || {}; } catch { return {}; } })();
  const total = document.querySelectorAll('.chapter-checkmark').length;
  const done = Object.keys(completed).filter(k => completed[k]).length;
  chaptersEl.querySelector('.rd-val').textContent = done + '/' + total;
  // Bookmarks
  let bookmarkCount = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('bookmark_')) bookmarkCount++;
  }
  bookmarksEl.querySelector('.rd-val').textContent = bookmarkCount;
  // Notes
  let notesCount = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('notes_')) notesCount++;
  }
  notesEl.querySelector('.rd-val').textContent = notesCount;
}

// ─── Search Within Page ────────────────────────────────
function openPageSearch() {
  const existing = document.getElementById('pageSearchModal');
  if (existing) { existing.classList.add('open'); focusPageSearch(); return; }
  const modal = document.createElement('div');
  modal.id = 'pageSearchModal';
  modal.className = 'page-search-modal';
  modal.innerHTML = `
    <div class="page-search-content" onclick="event.stopPropagation()">
      <div class="page-search-input-wrap">
        <span class="page-search-icon">\uD83D\uDD0D</span>
        <input class="page-search-input" id="pageSearchInput" placeholder="Search this page..." autofocus>
      </div>
      <div class="page-search-results" id="pageSearchResults">
        <div class="page-search-empty">Start typing to search on this page</div>
      </div>
    </div>
  `;
  modal.onclick = () => closePageSearch();
  document.body.appendChild(modal);
  requestAnimationFrame(() => {
    modal.classList.add('open');
    setTimeout(() => document.getElementById('pageSearchInput')?.focus(), 100);
  });
}

function closePageSearch() {
  const modal = document.getElementById('pageSearchModal');
  if (modal) modal.classList.remove('open');
}

function focusPageSearch() {
  setTimeout(() => document.getElementById('pageSearchInput')?.focus(), 100);
}

function filterPageSearch(val) {
  const results = document.getElementById('pageSearchResults');
  if (!results) return;
  const q = val.toLowerCase().trim();
  if (!q) {
    results.innerHTML = '<div class="page-search-empty">Start typing to search on this page</div>';
    return;
  }
  const content = document.querySelector('.content');
  if (!content) return;
  const textNodes = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text && text.toLowerCase().includes(q)) {
      textNodes.push({ node, text: text.substring(0, 200) });
    }
  }
  if (!textNodes.length) {
    results.innerHTML = '<div class="page-search-empty">No matches found</div>';
    return;
  }
  results.innerHTML = textNodes.map((item, i) => {
    const idx = item.text.toLowerCase().indexOf(q);
    const before = item.text.substring(0, idx);
    const match = item.text.substring(idx, idx + q.length);
    const after = item.text.substring(idx + q.length);
    return `<div class="page-search-result" onclick="goToPageSearchResult(${i})">
      <span class="page-search-match">...${before}<strong style="color:var(--accent)">${match}</strong>${after}...</span>
    </div>`;
  }).join('');
  window._pageSearchNodes = textNodes;
}

function goToPageSearchResult(index) {
  const nodes = window._pageSearchNodes;
  if (!nodes || !nodes[index]) return;
  const el = nodes[index].node.parentElement;
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background 0.5s';
    el.style.background = 'rgba(188,140,255,0.15)';
    el.style.borderRadius = '4px';
    setTimeout(() => { el.style.background = 'transparent'; }, 1500);
  }
  closePageSearch();
}

// ─── Related Sections ──────────────────────────────────
const RELATED_SECTIONS = {
  'request-lifecycle': [
    { title: 'Load Balancers', url: 'backend-fundamentals.html#load-balancers', desc: 'How requests are routed' },
    { title: 'Rate Limiting', url: 'api-design.html#rate-limiting', desc: 'Protecting your API from abuse' },
  ],
  'client-server': [
    { title: 'Microservices', url: 'microservices.html#design', desc: 'Breaking down the monolith' },
    { title: 'Application Layers', url: 'backend-fundamentals.html#layers', desc: 'Layered architecture pattern' },
  ],
  'layers': [
    { title: 'Client-Server Architecture', url: 'backend-fundamentals.html#client-server', desc: 'Foundational architecture' },
    { title: 'Microservices', url: 'microservices.html#communication', desc: 'Service communication patterns' },
  ],
  'concurrency': [
    { title: 'Connection Pooling', url: 'backend-fundamentals.html#processes', desc: 'Managing database connections' },
    { title: 'Performance Engineering', url: 'backend-performance.html#profiling', desc: 'Profiling concurrent systems' },
  ],
  'rest': [
    { title: 'API Versioning', url: 'api-design.html#versioning', desc: 'Managing API evolution' },
    { title: 'Pagination Strategies', url: 'api-design.html#pagination', desc: 'Efficient data retrieval' },
  ],
  'pagination': [
    { title: 'Database Indexes', url: 'database-engineering.html#indexes', desc: 'Optimizing paginated queries' },
    { title: 'REST APIs', url: 'api-design.html#rest', desc: 'Resource design fundamentals' },
  ],
  'rate-limiting': [
    { title: 'Caching Strategies', url: 'caching-guide.html#strategies', desc: 'Reduce load with caching' },
    { title: 'REST API Design', url: 'api-design.html#rest', desc: 'Rate limiting in REST' },
  ],
  'graphql': [
    { title: 'REST APIs', url: 'api-design.html#rest', desc: 'Comparing with GraphQL' },
    { title: 'gRPC', url: 'api-design.html#grpc', desc: 'Alternative RPC framework' },
  ],
  'grpc': [
    { title: 'GraphQL', url: 'api-design.html#graphql', desc: 'Alternative query language' },
    { title: 'Microservices', url: 'microservices.html#communication', desc: 'Service-to-service communication' },
  ],
  'what-is-backend': [
    { title: 'Request Lifecycle', url: 'backend-fundamentals.html#request-lifecycle', desc: 'How requests flow end-to-end' },
    { title: 'HTTP Deep Dive', url: 'backend-fundamentals.html#http', desc: 'Understanding the protocol' },
  ],
  'http': [
    { title: 'Request Lifecycle', url: 'backend-fundamentals.html#request-lifecycle', desc: 'HTTP in the full lifecycle' },
    { title: 'REST APIs', url: 'api-design.html#rest', desc: 'REST over HTTP' },
  ],
  'processes': [
    { title: 'Concurrency Models', url: 'backend-fundamentals.html#concurrency', desc: 'Threads, goroutines, async' },
    { title: 'Performance Engineering', url: 'backend-performance.html#latency', desc: 'Latency and throughput' },
  ],
  'load-balancers': [
    { title: 'Request Lifecycle', url: 'backend-fundamentals.html#request-lifecycle', desc: 'LB in the request flow' },
    { title: 'Scalability', url: 'backend-fundamentals.html#scalability', desc: 'Horizontal vs vertical scaling' },
  ],
  'scalability': [
    { title: 'Load Balancers', url: 'backend-fundamentals.html#load-balancers', desc: 'Distributing traffic' },
    { title: 'Replication', url: 'database-engineering.html#replication', desc: 'Database replication' },
  ],
  'sql': [
    { title: 'Database Indexes', url: 'database-engineering.html#indexes', desc: 'Query optimization' },
    { title: 'Connection Pooling', url: 'backend-fundamentals.html#processes', desc: 'Managing connections' },
  ],
  'nosql': [
    { title: 'SQL & Relational DBs', url: 'database-engineering.html#sql', desc: 'Comparing with SQL' },
    { title: 'Caching Strategies', url: 'caching-guide.html#strategies', desc: 'Redis for caching' },
  ],
  'indexes': [
    { title: 'Pagination Strategies', url: 'api-design.html#pagination', desc: 'Efficient pagination with indexes' },
    { title: 'Performance Engineering', url: 'backend-performance.html#latency', desc: 'Query performance' },
  ],
  'transactions': [
    { title: 'SAGA Pattern', url: 'distributed-systems.html#patterns', desc: 'Distributed transactions' },
    { title: 'Replication', url: 'database-engineering.html#replication', desc: 'Consistency across replicas' },
  ],
  'replication': [
    { title: 'Sharding', url: 'database-engineering.html#sharding', desc: 'Horizontal partitioning' },
    { title: 'CAP Theorem', url: 'distributed-systems.html#cap', desc: 'Consistency trade-offs' },
  ],
  'sharding': [
    { title: 'Replication', url: 'database-engineering.html#replication', desc: 'Data redundancy' },
    { title: 'Distributed Systems', url: 'distributed-systems.html#cap', desc: 'Distributed data patterns' },
  ],
  'cap': [
    { title: 'Consensus Algorithms', url: 'distributed-systems.html#consensus', desc: 'Raft, Paxos' },
    { title: 'Eventual Consistency', url: 'distributed-systems.html#patterns', desc: 'Consistency models' },
  ],
  'consensus': [
    { title: 'CAP Theorem', url: 'distributed-systems.html#cap', desc: 'The theorem behind consensus' },
    { title: 'Distributed Systems', url: 'distributed-systems.html#patterns', desc: 'Resilience patterns' },
  ],
  'kafka': [
    { title: 'Message Queues', url: 'message-queues.html#patterns', desc: 'Messaging patterns' },
    { title: 'Consumer Groups', url: 'message-queues.html#rabbitmq', desc: 'Comparing queue systems' },
  ],
  'rabbitmq': [
    { title: 'Kafka', url: 'message-queues.html#kafka', desc: 'Comparing message brokers' },
    { title: 'Message Queue Patterns', url: 'message-queues.html#patterns', desc: 'Delivery semantics' },
  ],
  'deployments': [
    { title: 'Incident Management', url: 'production-engineering.html#incidents', desc: 'Handling deployment issues' },
    { title: 'Disaster Recovery', url: 'production-engineering.html#dr', desc: 'Recovery strategies' },
  ],
  'incidents': [
    { title: 'Deployment Strategies', url: 'production-engineering.html#deployments', desc: 'Safe deployments' },
    { title: 'Postmortems', url: 'production-engineering.html#dr', desc: 'Learning from incidents' },
  ],
  'metrics': [
    { title: 'Performance Engineering', url: 'backend-performance.html#latency', desc: 'Key performance metrics' },
    { title: 'Logging', url: 'observability.html#logging', desc: 'Structured logging' },
  ],
  'logging': [
    { title: 'Distributed Tracing', url: 'observability.html#tracing', desc: 'Trace across services' },
    { title: 'Metrics', url: 'observability.html#metrics', desc: 'Quantitative monitoring' },
  ],
  'tracing': [
    { title: 'Logging', url: 'observability.html#logging', desc: 'Log aggregation' },
    { title: 'Metrics', url: 'observability.html#metrics', desc: 'Service metrics' },
  ],
};

function injectRelatedSections() {
  const headings = document.querySelectorAll('.content h2[id], .content h3[id]');
  headings.forEach(h => {
    const related = RELATED_SECTIONS[h.id];
    if (!related || h.querySelector('.related-sections')) return;
    const div = document.createElement('div');
    div.className = 'related-sections';
    div.innerHTML = `
      <div class="related-title">\uD83D\uDD17 Continue Reading</div>
      <div class="related-links">
        ${related.map(r => `<a href="${r.url}" class="related-link">
          <span class="related-link-title">${r.title}</span>
          <span class="related-link-desc">${r.desc}</span>
        </a>`).join('')}
      </div>
    `;
    h.after(div);
  });
}
function switchTab(btn, tabId) {
  const container = btn.closest('.tabs');
  if (!container) return;
  container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add('active');
}
function copyCode(btn) {
  const pre = btn.closest('.code-block').querySelector('pre');
  if (!pre) return;
  navigator.clipboard.writeText(pre.innerText).then(() => {
    btn.textContent = '\u2713 Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}
// ─── Scroll: Progress Bar + Back to Top ────────────────
const backToTopBtn = document.createElement('button');
backToTopBtn.className = 'back-to-top';
backToTopBtn.innerHTML = '↑';
backToTopBtn.title = 'Back to top';
backToTopBtn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
document.body.appendChild(backToTopBtn);

window.addEventListener('scroll', () => {
  const bar = document.getElementById('progressBar');
  if (bar) {
    const winH = document.documentElement.scrollHeight - window.innerHeight;
    const pct = winH > 0 ? (window.scrollY / winH) * 100 : 0;
    bar.style.width = pct + '%';
  }
  // Back to top visibility
  backToTopBtn.classList.toggle('visible', window.scrollY > 500);
});

// TOC active state
const tocLinks = document.querySelectorAll('.toc-list a');
if (tocLinks.length) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        tocLinks.forEach(l => l.classList.remove('active'));
        const active = document.querySelector(`.toc-list a[href="#${entry.target.id}"]`);
        if (active) active.classList.add('active');
      }
    });
  }, { rootMargin: '-10% 0% -80% 0%' });
  document.querySelectorAll('h2[id], h3[id]').forEach(h => observer.observe(h));
}

// ─── Reading Time Per Section ──────────────────────────
function calculateReadingTimes() {
  const content = document.querySelector('.content');
  if (!content) return;
  const headings = content.querySelectorAll('h2[id], h3[id]');
  if (!headings.length) return;

  const sections = [];
  headings.forEach((h, i) => {
    const nextH = headings[i + 1];
    let wordCount = 0;
    let el = h.nextElementSibling;
    while (el && el !== nextH) {
      const text = el.textContent || '';
      wordCount += text.trim().split(/\s+/).filter(Boolean).length;
      el = el.nextElementSibling;
    }
    const readTime = Math.max(1, Math.round(wordCount / 200));
    sections.push({ id: h.id, time: readTime, heading: h });

    // Add reading time badge if not already present
    if (!h.querySelector('.reading-time-badge')) {
      const badge = document.createElement('span');
      badge.className = 'reading-time-badge';
      badge.textContent = `${readTime} min`;
      h.appendChild(badge);
    }
  });

  // Also update TOC with reading times
  const tocLinks = document.querySelectorAll('.toc-list a');
  tocLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    const id = href.slice(1);
    const section = sections.find(s => s.id === id);
    if (!section) return;
    // Add reading time next to TOC entry
    let timeSpan = link.querySelector('.toc-read-time');
    if (!timeSpan) {
      timeSpan = document.createElement('span');
      timeSpan.className = 'toc-read-time';
      link.appendChild(timeSpan);
    }
    timeSpan.textContent = `${section.time}m`;
  });
}

// ─── Continue Reading Bookmark ─────────────────────────
function getBookmarkKey() {
  return 'bookmark_' + getPageKey();
}

function setBookmark() {
  const headings = document.querySelectorAll('.content h2[id], .content h3[id]');
  if (!headings.length) {
    showBookmarkToast('Bookmarked current position', null);
    localStorage.setItem(getBookmarkKey(), JSON.stringify({
      sectionId: null,
      sectionName: 'Top of page',
      scrollY: window.scrollY
    }));
    return;
  }

  // Find nearest heading above current scroll position
  let nearest = { id: null, name: 'Top of page', y: 0 };
  headings.forEach(h => {
    const rect = h.getBoundingClientRect();
    const absY = rect.top + window.scrollY;
    if (absY <= window.scrollY + 100 && absY >= nearest.y) {
      nearest = { id: h.id, name: h.textContent.replace(/\d+\s*min$/, '').trim(), y: absY };
    }
  });

  const bookmark = {
    sectionId: nearest.id,
    sectionName: nearest.name,
    scrollY: window.scrollY
  };

  localStorage.setItem(getBookmarkKey(), JSON.stringify(bookmark));
  showBookmarkToast('🔖 Bookmarked: ' + nearest.name);
  updateBookmarkBadges(bookmark);
}

function loadBookmark() {
  const data = localStorage.getItem(getBookmarkKey());
  if (!data) return;

  try {
    const bookmark = JSON.parse(data);
    if (!bookmark || !bookmark.sectionName) return;

    // Show a resume toast after reading position restores
    setTimeout(() => {
      const toast = document.createElement('div');
      toast.className = 'bookmark-resume-toast';
      const sectionName = bookmark.sectionName;
      const sectionId = bookmark.sectionId;
      toast.innerHTML = `
        <span>🔖 <strong>Resume from:</strong> ${sectionName}</span>
        <button onclick="resumeFromBookmark()">Go</button>
      `;
      document.body.appendChild(toast);
      requestAnimationFrame(() => {
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
          toast.classList.remove('show');
          setTimeout(() => toast.remove(), 500);
        }, 6000);
      });
    }, 200);
  } catch {}
}

function resumeFromBookmark() {
  const data = localStorage.getItem(getBookmarkKey());
  if (!data) return;
  try {
    const bookmark = JSON.parse(data);
    if (bookmark.sectionId) {
      const el = document.getElementById(bookmark.sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Brief highlight
        el.style.transition = 'background 0.5s';
        el.style.background = 'rgba(188,140,255,0.12)';
        el.style.borderRadius = '4px';
        setTimeout(() => {
          el.style.background = 'transparent';
        }, 1500);
      }
    } else if (bookmark.scrollY) {
      window.scrollTo({ top: bookmark.scrollY, behavior: 'smooth' });
    }
  } catch {}
}

function showBookmarkToast(msg) {
  const existing = document.querySelector('.bookmark-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'bookmark-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 500);
    }, 3000);
  });
}

function updateBookmarkBadges(bookmark) {
  const btn = document.getElementById('bookmarkBtn');
  if (!btn) return;
  if (bookmark) {
    btn.classList.add('bookmarked');
    btn.title = 'Bookmarked: ' + bookmark.sectionName + ' — Click to update';
  } else {
    btn.classList.remove('bookmarked');
    btn.title = 'Bookmark this section';
  }
}

// ─── Reading Position Auto-Saver ───────────────────────
(function() {
  const pageKey = getPageKey();
  const savedPos = localStorage.getItem('scroll_' + pageKey);
  if (savedPos) {
    // Show a little toast
    const toast = document.createElement('div');
    toast.className = 'position-toast';
    toast.textContent = '↕ Resuming where you left off';
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedPos));
        toast.classList.add('show');
        setTimeout(() => {
          toast.classList.remove('show');
          setTimeout(() => toast.remove(), 500);
        }, 2500);
      }, 50);
    });
  }
  // Save on scroll (debounced)
  let scrollTimer;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      localStorage.setItem('scroll_' + pageKey, window.scrollY.toString());
    }, 500);
  }, { passive: true });
})();

// ─── Search Index (all pages) ───────────────────────────
const SEARCH_INDEX = [
  { title: 'Home', desc: 'Backend Engineering Handbook — complete reference guide covering fundamentals to distributed systems', chapter: 'Home', icon: '🏠', url: 'index.html', keywords: 'home, handbook, backend, engineering, reference' },
  { title: 'Backend Fundamentals', desc: 'Request lifecycle, HTTP, client-server, application layers, concurrency, threading, memory', chapter: 'Chapter 1', icon: '⚡', url: 'backend-fundamentals.html', keywords: 'request lifecycle, client server, concurrency, event loop, threading, http, load balancer, scalability' },
  { title: 'API Design', desc: 'REST, GraphQL, gRPC, versioning, pagination, rate limiting, idempotency, OpenAPI', chapter: 'Chapter 2', icon: '🔌', url: 'api-design.html', keywords: 'rest API, graphql, grpc, pagination, rate limiting, versioning, idempotency, openapi' },
  { title: 'Database Engineering', desc: 'SQL, NoSQL, indexes, ACID transactions, replication, sharding, connection pools, N+1', chapter: 'Chapter 3', icon: '🗄', url: 'database-engineering.html', keywords: 'sql, nosql, index, b-tree, acid, transaction, replication, sharding, connection pool, N+1' },
  { title: 'Performance Engineering', desc: 'Latency, throughput, P50/P95/P99, CPU profiling, memory, GC tuning, load testing', chapter: 'Chapter 4', icon: '📈', url: 'backend-performance.html', keywords: 'latency, throughput, percentiles, profiling, gc tuning, load testing, k6, optimization' },
  { title: 'Caching Masterclass', desc: 'Redis deep dive, cache strategies, invalidation, stampede prevention, CDN', chapter: 'Chapter 5', icon: '💾', url: 'caching-guide.html', keywords: 'cache, redis, memcached, cache-aside, write-through, invalidation, stampede, cdn' },
  { title: 'Auth & Security', desc: 'JWT, OAuth2, RBAC, ABAC, OWASP Top 10, SQL injection, XSS, secrets management', chapter: 'Chapter 6', icon: '🔐', url: 'authentication-security.html', keywords: 'authentication, authorization, jwt, oauth, rbac, abac, owasp, sql injection, xss, csrf' },
  { title: 'Message Queues', desc: 'Kafka, RabbitMQ, SQS, delivery semantics, consumer groups, dead letter queues', chapter: 'Chapter 7', icon: '📬', url: 'message-queues.html', keywords: 'kafka, rabbitmq, sqs, message queue, producer, consumer, dlq, pub-sub' },
  { title: 'Distributed Systems', desc: 'CAP theorem, consensus algorithms, Raft, Paxos, SAGA, CQRS, event sourcing, resilience', chapter: 'Chapter 8', icon: '🌐', url: 'distributed-systems.html', keywords: 'cap theorem, raft, paxos, consensus, saga, cqrs, event sourcing, circuit breaker, consistency' },
  { title: 'Microservices', desc: 'Monolith vs microservices, decomposition, API gateway, service mesh, design patterns', chapter: 'Chapter 9', icon: '🧩', url: 'microservices.html', keywords: 'microservices, monolith, api gateway, service mesh, envoy, istio, decomposition' },
  { title: 'Observability', desc: 'Metrics, logs, traces, Prometheus, Grafana, OpenTelemetry, Jaeger, SLOs, SLAs', chapter: 'Chapter 10', icon: '📊', url: 'observability.html', keywords: 'observability, metrics, logs, traces, prometheus, grafana, opentelemetry, jaeger, slo' },
  { title: 'Production Engineering', desc: 'Deployment strategies, feature flags, health checks, incident management, disaster recovery', chapter: 'Chapter 11', icon: '🚀', url: 'production-engineering.html', keywords: 'deployment, blue-green, canary, feature flag, health check, incident, disaster recovery, sla' },
  { title: 'System Design', desc: 'Design WhatsApp, Netflix, Uber, Instagram, YouTube, Twitter — real-world system design', chapter: 'Chapter 12', icon: '🏗', url: 'system-design.html', keywords: 'system design, whatsapp, netflix, uber, instagram, youtube, twitter, scalability' },
  { title: 'Senior Engineer Roadmap', desc: 'Junior to Principal career progression, skills, expectations, 6-month learning paths', chapter: 'Chapter 13', icon: '📈', url: 'senior-engineer-roadmap.html', keywords: 'senior, staff, principal, career, roadmap, junior, mid, learning path, mentorship' },
  { title: 'Interview Guide', desc: '100 backend interview Q&As — beginner to Staff-level system design and distributed systems', chapter: 'Chapter 14', icon: '💼', url: 'interview-guide.html', keywords: 'interview, questions, answers, system design, distributed, coding, preparation' },
];

// ─── Global Search Dialog (Ctrl+K) ─────────────────────
function openSearch() {
  closeShortcutsHelp();
  const existing = document.getElementById('globalSearchModal');
  if (existing) { existing.classList.add('open'); focusSearchInput(); return; }
  const modal = document.createElement('div');
  modal.id = 'globalSearchModal';
  modal.className = 'search-modal';
  modal.innerHTML = `
    <div class="search-modal-content" onclick="event.stopPropagation()">
      <div class="search-modal-input-wrap">
        <span class="modal-search-icon">🔍</span>
        <input class="search-modal-input" id="globalSearchInput" placeholder="Search all chapters..." autofocus>
        <span class="search-modal-esc">Esc</span>
      </div>
      <div class="search-modal-results" id="globalSearchResults">
        <div class="search-modal-empty">Start typing to search across all chapters</div>
      </div>
    </div>
  `;
  modal.onclick = () => closeSearch();
  document.body.appendChild(modal);
  requestAnimationFrame(() => {
    modal.classList.add('open');
    focusSearchInput();
  });
}

function focusSearchInput() {
  const inp = document.getElementById('globalSearchInput');
  if (inp) setTimeout(() => inp.focus(), 100);
}

function closeSearch() {
  const modal = document.getElementById('globalSearchModal');
  if (modal) modal.classList.remove('open');
}

function filterSearch(val) {
  const results = document.getElementById('globalSearchResults');
  if (!results) return;
  const q = val.toLowerCase().trim();
  if (!q) {
    results.innerHTML = '<div class="search-modal-empty">Start typing to search across all chapters</div>';
    return;
  }
  const filtered = SEARCH_INDEX.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.desc.toLowerCase().includes(q) ||
    item.keywords.toLowerCase().includes(q)
  );
  if (!filtered.length) {
    results.innerHTML = '<div class="search-modal-empty">No results found</div>';
    return;
  }
  results.innerHTML = filtered.map(item => `
    <a class="search-modal-result" href="${item.url}" onclick="closeSearch()">
      <span class="result-icon">${item.icon}</span>
      <div class="result-info">
        <div class="result-title">${highlightMatch(item.title, q)}</div>
        <div class="result-desc">${highlightMatch(item.desc, q)}</div>
        <div class="result-chapter">${item.chapter}</div>
      </div>
    </a>
  `).join('');
}

function highlightMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return text.slice(0, idx) + '<strong style="color:var(--accent)">' +
    text.slice(idx, idx + query.length) + '</strong>' + text.slice(idx + query.length);
}

// ─── Keyboard Shortcuts Help ───────────────────────────
function openShortcutsHelp() {
  closeSearch();
  const existing = document.getElementById('shortcutsHelp');
  if (existing) { existing.classList.add('open'); return; }
  const modal = document.createElement('div');
  modal.id = 'shortcutsHelp';
  modal.className = 'shortcuts-help';
  modal.innerHTML = `
    <div class="shortcuts-help-content" onclick="event.stopPropagation()">
      <div class="shortcuts-help-title">⌨️ Keyboard Shortcuts</div>
      <div class="shortcut-row"><span class="action">Search all chapters</span><span class="keys"><span class="key">Ctrl</span><span class="key">K</span></span></div>
      <div class="shortcut-row"><span class="action">Toggle sidebar</span><span class="keys"><span class="key">B</span></span></div>
      <div class="shortcut-row"><span class="action">Previous chapter</span><span class="keys"><span class="key">[</span></span></div>
      <div class="shortcut-row"><span class="action">Next chapter</span><span class="keys"><span class="key">]</span></span></div>
      <div class="shortcut-row"><span class="action">Toggle dark/light</span><span class="keys"><span class="key">T</span></span></div>
      <div class="shortcut-row"><span class="action">Toggle reading mode</span><span class="keys"><span class="key">R</span></span></div>
      <div class="shortcut-row"><span class="action">Show this help</span><span class="keys"><span class="key">?</span></span></div>
      <div class="shortcut-row"><span class="action">Close overlay</span><span class="keys"><span class="key">Esc</span></span></div>
      <div style="margin-top:16px;font-size:11px;color:var(--text3);text-align:center">Press <span class="key" style="font-size:11px">?</span> anytime to show this</div>
    </div>
  `;
  modal.onclick = () => closeShortcutsHelp();
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

function closeShortcutsHelp() {
  const modal = document.getElementById('shortcutsHelp');
  if (modal) modal.classList.remove('open');
}

// ─── Keyboard Shortcuts ─────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Ignore if typing in input/textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape') {
      e.target.blur();
    }
    return;
  }

  // Ctrl+K or Cmd+K → search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openSearch();
    return;
  }

  // Esc → close overlays
  if (e.key === 'Escape') {
    closeSearch();
    closeShortcutsHelp();
    return;
  }

  // Single key shortcuts (skip if in reading mode)
  if (document.body.classList.contains('reading-mode')) return;

  switch (e.key) {
    case '?':
      e.preventDefault();
      openShortcutsHelp();
      break;
    case 'b':
    case 'B':
      toggleSidebar();
      break;
    case '[':
      {
        const prev = document.querySelector('.footer-nav-btn.prev');
        if (prev) { e.preventDefault(); prev.click(); }
      }
      break;
    case ']':
      {
        const next = document.querySelector('.footer-nav-btn.next');
        if (next) { e.preventDefault(); next.click(); }
      }
      break;
    case 't':
    case 'T':
      toggleTheme();
      break;
    case 'r':
    case 'R':
      if (document.getElementById('readingModeBtn')) {
        toggleReadingMode();
      }
      break;
  }
});

// ─── Chapter Completion Tracking ────────────────────────
(function() {
  const COMPLETE_KEY = 'completed_chapters';
  function getCompleted() {
    try { return JSON.parse(localStorage.getItem(COMPLETE_KEY)) || {}; } catch { return {}; }
  }
  function saveCompleted(data) {
    localStorage.setItem(COMPLETE_KEY, JSON.stringify(data));
    updateProgressCounter();
  }
  function toggleCompleted(pageKey) {
    const data = getCompleted();
    if (data[pageKey]) delete data[pageKey];
    else data[pageKey] = true;
    saveCompleted(data);
    updateCheckmarks();
  }
  function updateCheckmarks() {
    const data = getCompleted();
    document.querySelectorAll('.chapter-checkmark').forEach(el => {
      const key = el.dataset.page;
      el.classList.toggle('done', !!data[key]);
      el.textContent = data[key] ? '✓' : '';
    });
  }
  function updateProgressCounter() {
    const data = getCompleted();
    const total = document.querySelectorAll('.chapter-checkmark').length;
    const done = Object.keys(data).filter(k => data[k]).length;
    const el = document.getElementById('progressCounter');
    if (el) el.textContent = `📊 ${done}/${total} chapters complete`;
  }

  // Add checkmarks after DOM is ready
  function initCheckmarks() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const links = sidebar.querySelectorAll('.nav-item[href*=".html"]');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('http') || href === 'index.html') return;
      const pageKey = href.split('#')[0].replace('.html', '');
      const check = document.createElement('span');
      check.className = 'chapter-checkmark';
      check.dataset.page = pageKey;
      check.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCompleted(pageKey);
      };
      link.insertBefore(check, link.firstChild);
    });
    updateCheckmarks();

    // Add progress counter before Quick Reference section
    const sectionTitles = sidebar.querySelectorAll('.nav-section-title');
    const quickRef = Array.from(sectionTitles).find(s => s.textContent.includes('Quick Reference'));
    if (quickRef && !document.getElementById('progressCounter')) {
      const counter = document.createElement('div');
      counter.id = 'progressCounter';
      counter.className = 'progress-counter';
      quickRef.parentNode.insertBefore(counter, quickRef.parentNode.firstChild);
      updateProgressCounter();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCheckmarks);
  } else {
    initCheckmarks();
  }
})();

// ─── Search modal input handler (delegated) ─────────────
document.addEventListener('input', (e) => {
  if (e.target.id === 'globalSearchInput') {
    filterSearch(e.target.value);
  }
});

// ─── Global search on Enter ─────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement?.id === 'globalSearchInput') {
    const first = document.querySelector('.search-modal-result');
    if (first) first.click();
  }
});
