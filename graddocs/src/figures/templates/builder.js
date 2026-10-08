// Tiny DSL used by templates (and handy for scripted diagrams).
import { uid } from '../../core/utils.js';
import { DEFAULT_FONT } from '../render.js';

export const A = {
  n: { x: 0.5, y: 0 }, s: { x: 0.5, y: 1 }, e: { x: 1, y: 0.5 }, w: { x: 0, y: 0.5 },
  ne: { x: 1, y: 0 }, nw: { x: 0, y: 0 }, se: { x: 1, y: 1 }, sw: { x: 0, y: 1 },
};

export function builder({ fontFamily = DEFAULT_FONT.fontFamily, fontSize = DEFAULT_FONT.fontSize } = {}) {
  const elements = [];
  const api = {
    elements,
    /** node(shape, x, y, w, h, text, style?, { id }) */
    node(shape, x, y, w, h, text = '', style = {}, extra = {}) {
      const el = { id: extra.id || uid('n'), type: 'node', shape, x, y, w, h, text, style: { ...style } };
      elements.push(el);
      return el;
    },
    /** edge(from, to, { text, routing, from: anchor, to: anchor, style, id }) — from/to may be nodes or {x,y}. */
    edge(from, to, opts = {}) {
      const end = (v, anchor) => (v?.type === 'node' ? { id: v.id, ...(anchor ? { anchor: typeof anchor === 'string' ? A[anchor] : anchor } : {}) } : { x: v.x, y: v.y });
      const el = {
        id: opts.id || uid('e'), type: 'edge',
        source: end(from, opts.from), target: end(to, opts.to),
        routing: opts.routing || 'orthogonal', text: opts.text || '', style: { ...(opts.style || {}) },
      };
      elements.push(el);
      return el;
    },
    diagram(extra = {}) {
      return { width: 1200, height: 800, background: '#ffffff', defaults: { fontFamily, fontSize }, elements, ...extra };
    },
  };
  return api;
}
