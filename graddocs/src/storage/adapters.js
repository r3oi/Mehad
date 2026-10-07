// Key/value storage adapters. Each adapter implements:
//   name, label
//   get(key) → Promise<any|null>      set(key, value) → Promise<void>
//   remove(key) → Promise<void>       keys(prefix) → Promise<string[]>
//   usage() → Promise<{ used, quota }>
// plus optional setSync(key, value) for flushing during page unload.

const NS = 'graddocs:';

export class LocalStorageAdapter {
  name = 'localStorage';
  label = 'Browser localStorage';

  static isAvailable() {
    try { const k = `${NS}__probe`; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch { return false; }
  }

  async get(key) { return this.getSync(key); }
  getSync(key) {
    const raw = localStorage.getItem(NS + key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async set(key, value) { this.setSync(key, value); }
  setSync(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch (err) {
      if (isQuotaError(err)) {
        const e = new Error('Browser storage is full. Switch to IndexedDB in Settings → Storage, or download a backup and delete old projects.');
        e.code = 'QUOTA_EXCEEDED';
        throw e;
      }
      throw err;
    }
  }

  async remove(key) { localStorage.removeItem(NS + key); }

  async keys(prefix = '') {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(NS + prefix)) out.push(k.slice(NS.length));
    }
    return out;
  }

  async usage() {
    let used = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(NS)) used += (k.length + (localStorage.getItem(k)?.length || 0)) * 2;
    }
    return { used, quota: 5 * 1024 * 1024 * 2 };
  }
}

export class IndexedDBAdapter {
  name = 'indexedDB';
  label = 'IndexedDB (large projects)';
  #db = null;

  static isAvailable() { return typeof indexedDB !== 'undefined'; }

  #open() {
    if (this.#db) return Promise.resolve(this.#db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('graddocs', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
      req.onsuccess = () => { this.#db = req.result; resolve(this.#db); };
      req.onerror = () => reject(req.error || new Error('Could not open IndexedDB'));
    });
  }

  async #tx(mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const store = tx.objectStore('kv');
      let result;
      const req = fn(store);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async get(key) { const v = await this.#tx('readonly', (s) => s.get(key)); return v === undefined ? null : v; }
  async set(key, value) { await this.#tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(value)), key)); }
  async remove(key) { await this.#tx('readwrite', (s) => s.delete(key)); }
  async keys(prefix = '') {
    const all = await this.#tx('readonly', (s) => s.getAllKeys());
    return (all || []).map(String).filter((k) => k.startsWith(prefix));
  }
  async usage() {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { used: usage, quota };
    }
    return { used: 0, quota: 0 };
  }
}

function isQuotaError(err) {
  return err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014 || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/** Engine preference lives in localStorage so we know which adapter to boot with. */
export function preferredEngine() {
  try { return localStorage.getItem(`${NS}engine`) || 'localStorage'; } catch { return 'localStorage'; }
}
export function setPreferredEngine(name) {
  try { localStorage.setItem(`${NS}engine`, name); } catch { /* ignore */ }
}

export function createAdapter(name = preferredEngine()) {
  if (name === 'indexedDB' && IndexedDBAdapter.isAvailable()) return new IndexedDBAdapter();
  if (LocalStorageAdapter.isAvailable()) return new LocalStorageAdapter();
  if (IndexedDBAdapter.isAvailable()) return new IndexedDBAdapter();
  throw new Error('No persistent storage is available in this browser (private mode?).');
}
