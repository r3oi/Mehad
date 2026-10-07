// Remembers the Word file a project is linked to. A FileSystemFileHandle (File System Access API,
// Chromium browsers) can be stored in IndexedDB, so the link survives page reloads; the permission
// to read it may have to be granted again after a reload (needs a user click).
// Own tiny database, separate from the project storage: 'graddocs-word' / 'handles'.

const DB_NAME = 'graddocs-word';
const STORE = 'handles';
const memory = new Map(); // projectId → handle (also used when IndexedDB is unavailable, and by tests)

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the Word link database'));
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      let result;
      const req = fn(t.objectStore(STORE));
      if (req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error('Word link transaction failed'));
      t.onabort = () => reject(t.error || new Error('Word link transaction aborted'));
    });
  } finally { db.close(); }
}

/** Remember a handle for a project (memory always; IndexedDB when the handle can be cloned). */
export async function saveHandle(projectId, handle) {
  memory.set(projectId, handle);
  try { await tx('readwrite', (s) => s.put(handle, projectId)); return true; } catch { return false; }
}

/** The stored handle for a project, or null. */
export async function loadHandle(projectId) {
  if (memory.has(projectId)) return memory.get(projectId);
  try {
    const handle = await tx('readonly', (s) => s.get(projectId));
    if (handle) { memory.set(projectId, handle); return handle; }
  } catch { /* no stored handle */ }
  return null;
}

export async function deleteHandle(projectId) {
  memory.delete(projectId);
  try { await tx('readwrite', (s) => s.delete(projectId)); } catch { /* nothing stored */ }
}

export const hasMemoryHandle = (projectId) => memory.has(projectId);
