// "Describe with AI": natural-language description (Arabic or English) → diagram spec, using the Claude
// Messages API straight from the browser (no server in between).
//
//  • Request:  POST https://api.anthropic.com/v1/messages with the headers x-api-key, anthropic-version and
//              anthropic-dangerous-direct-browser-access (the API's opt-in for browser CORS calls).
//              The student's own API key is used; it lives only in this browser (prefs 'ai' → { apiKey, model })
//              and is never part of project data, backups or exports.
//  • Output:   structured outputs — output_config.format = json_schema (SPEC_JSON_SCHEMA), so the reply is
//              guaranteed to be parseable JSON of the right shape. (Forced tool_choice is not used: Sonnet 5.5 and
//              Opus 5.5 reject it.) If the API rejects the schema/beta parts, the request is repeated once in
//              plain "reply with JSON only" form and the JSON is extracted from the text.
//  • Models:   claude-sonnet-5-5 (default, balanced) · claude-haiku-5-5 (fast and cheapest) · claude-opus-5-5 (strongest).
//              Thinking stays on its adaptive default; output_config.effort keeps latency reasonable.
import { prefs } from '../../app/prefs.js';
import { t } from '../../i18n/index.js';
import { SPEC_INSTRUCTIONS, SPEC_JSON_SCHEMA, parseJsonLoose, SpecError } from './spec.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';
export const KEYS_URL = 'https://console.anthropic.com/settings/keys';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const TIMEOUT_MS = 120000;

/** Models the student can choose in Settings → AI. `effort` is the thinking depth we ask for. */
export const AI_MODELS = [
  { id: 'claude-sonnet-5-5', tier: 'balanced', effort: 'medium', fallback: true },
  { id: 'claude-haiku-5-5', tier: 'fast', effort: 'low', fallback: false },
  { id: 'claude-opus-5-5', tier: 'strong', effort: 'medium', fallback: true },
];
export const modelInfo = (id) => AI_MODELS.find((m) => m.id === id) || AI_MODELS[0];
/** Display name of a model tier (UI text). */
export const modelLabel = (id) => {
  const tier = modelInfo(id).tier;
  if (tier === 'fast') return t('Claude Haiku 5.5 — fast and cheapest');
  if (tier === 'strong') return t('Claude Opus 5.5 — strongest');
  return t('Claude Sonnet 5.5 — balanced (recommended)');
};
export const modelName = (id) => ({ 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5', 'claude-opus-5-5': 'Claude Opus 5.5' }[modelInfo(id).id]);

// ---------------------------------------------------------------------------
// Settings (this browser only)

export function getAIConfig() {
  let saved = prefs.get('ai', {});
  if (!saved || typeof saved !== 'object') saved = {};
  return { apiKey: String(saved.apiKey || '').trim(), model: modelInfo(saved.model).id };
}

export function setAIConfig(patch) {
  const next = { ...getAIConfig(), ...patch };
  prefs.set('ai', { apiKey: String(next.apiKey || '').trim(), model: modelInfo(next.model).id });
  return getAIConfig();
}

export const hasAIKey = () => !!getAIConfig().apiKey;

/** sk-ant-api03-…abcd — enough to recognise a key without exposing it. */
export function maskKey(key) {
  const k = String(key || '');
  return k.length > 14 ? `${k.slice(0, 10)}…${k.slice(-4)}` : k ? '•'.repeat(k.length) : '';
}

// ---------------------------------------------------------------------------
// Errors

export class AIError extends Error {
  constructor(code, message, { status = 0 } = {}) {
    super(message);
    this.name = 'AIError';
    this.code = code; // no-key | auth | rate-limit | billing | network | timeout | aborted | overloaded | bad-request | refused | truncated | bad-response | http
    this.status = status;
  }
}

function httpError(status, payload) {
  const detail = String(payload?.error?.message || '').trim();
  if (status === 401) return new AIError('auth', t('The API key was not accepted (401). Check the key in Settings → AI.'), { status });
  if (status === 403) return new AIError('auth', t('This API key is not allowed to use the selected model (403). Check your Anthropic account or choose another model in Settings → AI.'), { status });
  if (status === 404) return new AIError('bad-request', t('The selected model was not found (404). Choose another model in Settings → AI.'), { status });
  if (status === 413) return new AIError('bad-request', t('The description is too long for one request (413).'), { status });
  if (status === 429) return new AIError('rate-limit', t('Too many requests, or the usage limit was reached (429). Wait a minute and try again.'), { status });
  if (status === 400 && /credit balance|billing/i.test(detail)) return new AIError('billing', t('Your Anthropic account has no credit left. Add credit in the Anthropic console, then try again.'), { status });
  if (status === 400) return new AIError('bad-request', t('The request was rejected (400): {detail}', { detail: detail || '—' }), { status });
  if (status >= 500) return new AIError('overloaded', t('Claude is temporarily unavailable ({status}). Try again in a minute.', { status }), { status });
  return new AIError('http', t('Unexpected answer from the API ({status}): {detail}', { status, detail: detail || '—' }), { status });
}

// ---------------------------------------------------------------------------
// Request

/** The Messages API request body (exported for tests). */
export function buildRequest(description, { type = 'auto', model = DEFAULT_MODEL, plain = false } = {}) {
  const info = modelInfo(model);
  const hint = type && type !== 'auto' ? `Diagram type: ${type}.\n\n` : '';
  const body = {
    model: info.id,
    max_tokens: 16000,
    system: SPEC_INSTRUCTIONS,
    messages: [{ role: 'user', content: `${hint}DESCRIPTION:\n${String(description).trim()}\n\nReply with the JSON diagram spec only.` }],
  };
  if (!plain) {
    body.output_config = { effort: info.effort, format: { type: 'json_schema', schema: SPEC_JSON_SCHEMA } };
    // If the safety classifiers decline a request, the API re-runs it on a fallback model by itself.
    if (info.fallback) body.fallbacks = 'default';
  }
  return body;
}

function headers(apiKey, { beta = false } = {}) {
  const h = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (beta) h['anthropic-beta'] = FALLBACK_BETA;
  return h;
}

async function post(body, { apiKey, signal, fetchImpl }) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let res;
  try {
    res = await fetchImpl(API_URL, { method: 'POST', headers: headers(apiKey, { beta: !!body.fallbacks }), body: JSON.stringify(body), signal: ctl.signal });
  } catch (err) {
    if (timedOut) throw new AIError('timeout', t('Claude took too long to answer. Try again, or pick the faster model in Settings → AI.'));
    if (err?.name === 'AbortError' || ctl.signal.aborted) throw new AIError('aborted', t('Cancelled.'));
    throw new AIError('network', t('Could not reach the Anthropic API. Check your internet connection and any blocker or firewall.'));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
  let payload = null;
  try { payload = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw httpError(res.status, payload);
  if (!payload) throw new AIError('bad-response', t('The answer from the API could not be read.'));
  return payload;
}

/**
 * Ask Claude for a diagram spec.
 * → { spec: object (raw, validate with buildDiagramFromSpec), model, usage }
 * options: { type, config: { apiKey, model } (defaults to the saved settings), signal, fetchImpl }
 */
export async function generateSpec(description, { type = 'auto', config = getAIConfig(), signal, fetchImpl } = {}) {
  const text = String(description ?? '').trim();
  if (!text) throw new AIError('bad-request', t('Describe the diagram first.'));
  if (!config.apiKey) throw new AIError('no-key', t('No API key yet. Add yours in Settings → AI, or use “Copy prompt” with ChatGPT or Claude.'));
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const ctx = { apiKey: config.apiKey, signal, fetchImpl: doFetch };

  let data;
  try {
    data = await post(buildRequest(text, { type, model: config.model }), ctx);
  } catch (err) {
    // The schema / fallback parts are newer than the rest: if the API refuses them, ask once more in plain form.
    if (err instanceof AIError && err.code === 'bad-request' && err.status === 400) data = await post(buildRequest(text, { type, model: config.model, plain: true }), ctx);
    else throw err;
  }

  if (data.stop_reason === 'refusal') throw new AIError('refused', t('Claude declined this request. Rephrase the description and try again.'));
  const reply = (data.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  if (data.stop_reason === 'max_tokens' && !reply.trim()) throw new AIError('truncated', t('The answer was cut off because the diagram is too large. Describe a smaller diagram, or split it into two figures.'));
  let spec;
  try { spec = parseJsonLoose(reply); } catch (err) {
    if (err instanceof SpecError) throw new AIError(data.stop_reason === 'max_tokens' ? 'truncated' : 'bad-response', data.stop_reason === 'max_tokens'
      ? t('The answer was cut off because the diagram is too large. Describe a smaller diagram, or split it into two figures.')
      : t('Claude did not return a usable diagram. Try again or rephrase the description.'));
    throw err;
  }
  return { spec, model: data.model || config.model, usage: data.usage || null };
}
