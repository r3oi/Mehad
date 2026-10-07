// Tiny shared state of the Word sync feature: events, the "busy" lock, the pending-review marker and
// browser capability checks. Kept separate (and light) so the app-wide watcher can start without
// loading the .docx parser; the heavy modules are imported when a Word file actually changes.
import { Emitter } from '../core/events.js';

/** Events: 'status' (watcher mode), 'synced', 'busy', 'pending', 'relink', 'undone'. */
export const wordEvents = new Emitter();
export const wordState = { busy: false, lastApplied: null, lastInfo: null, pending: null };

export const supportsLiveWatch = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

/** Run `fn` unless another sync is running. Resolves undefined when busy. */
export async function withLock(fn) {
  if (wordState.busy) return undefined;
  wordState.busy = true; wordEvents.emit('busy', true);
  try { return await fn(); } finally { wordState.busy = false; wordEvents.emit('busy', false); }
}

export function setPending(value) {
  wordState.pending = value;
  wordEvents.emit('pending', value);
}

/** Can we read this handle? `ask` may show the browser's permission prompt (needs a user gesture). */
export async function hasReadPermission(handle, ask = false) {
  try {
    if (!handle?.queryPermission) return !!handle;
    let state = await handle.queryPermission({ mode: 'read' });
    if (state !== 'granted' && ask && handle.requestPermission) state = await handle.requestPermission({ mode: 'read' });
    return state === 'granted';
  } catch { return false; }
}
