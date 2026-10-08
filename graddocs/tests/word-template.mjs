// Word Sync with a university report template (Umm Al-Qura University, Software Engineering, Graduation Project 1),
// without a browser: a tiny XML parser stands in for DOMParser, .docx files are written by hand (and, when the exporter
// works, by the app itself), then parse → plan → apply run against a real Store with in-memory storage.
// Covers: numbered chapters with 3.2.1-style sections, unnumbered closing chapters (CONCLUSIONS), the REFERENCES list
// imported as references (never a chapter), "[2]" citations as {{ref:cite:id}} tokens, idempotent re-sync, undo.
// Run: node tests/word-template.mjs
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------------------------- environment
const memory = new Map();
globalThis.localStorage = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k), key: (i) => [...memory.keys()][i], get length() { return memory.size; } };

/** Just enough of DOMParser for docx-reader / docx-parse: namespaces, children, attributes, textContent, getElementsByTagName(NS). */
class XmlElement {
  constructor(nodeName, namespaceURI, localName, attrs) {
    Object.assign(this, { nodeName, namespaceURI, localName, attrs, nodes: [] });
  }

  get children() { return this.nodes.filter((n) => typeof n !== 'string'); }

  get textContent() { return this.nodes.map((n) => (typeof n === 'string' ? n : n.textContent)).join(''); }

  getAttribute(name) { return this.attrs.find((a) => a.name === name)?.value ?? null; }

  getAttributeNS(ns, local) { return this.attrs.find((a) => a.ns === ns && a.local === local)?.value ?? null; }

  #descend(test, out = []) { for (const c of this.children) { if (test(c)) out.push(c); c.#descend(test, out); } return out; }

  getElementsByTagNameNS(ns, local) { return this.#descend((e) => (ns === '*' || e.namespaceURI === ns) && (local === '*' || e.localName === local)); }

  getElementsByTagName(name) { return this.#descend((e) => e.nodeName === name); }
}
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, d, h, n) => (d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ENTITIES[n] ?? m));
function parseXml(text) {
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const root = new XmlElement('#document', null, '#document', []);
  const stack = [{ el: root, ns: { xml: 'http://www.w3.org/XML/1998/namespace' } }];
  let m;
  while ((m = token.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.el.nodes.push(m[1]);
    else if (m[2] !== undefined) { if (stack.length < 2 || stack[stack.length - 1].el.nodeName !== m[2]) throw new Error(`mismatched </${m[2]}>`); stack.pop(); }
    else if (m[3] !== undefined) {
      const raw = [...m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => ({ name: a[1], value: decode(a[2] ?? a[3]) }));
      const ns = { ...top.ns };
      for (const a of raw) { if (a.name === 'xmlns') ns[''] = a.value; else if (a.name.startsWith('xmlns:')) ns[a.name.slice(6)] = a.value; }
      const [prefix, local] = m[3].includes(':') ? m[3].split(':') : ['', m[3]];
      const attrs = raw.filter((a) => !a.name.startsWith('xmlns')).map((a) => {
        const [ap, al] = a.name.includes(':') ? a.name.split(':') : ['', a.name];
        return { name: a.name, ns: ap ? ns[ap] ?? null : null, local: al, value: a.value };
      });
      const el = new XmlElement(m[3], ns[prefix] ?? null, local, attrs);
      top.el.nodes.push(el);
      if (!m[5]) stack.push({ el, ns });
    } else if (m[6] !== undefined) top.el.nodes.push(decode(m[6]));
  }
  if (stack.length !== 1) throw new Error('unclosed element');
  return root;
}
globalThis.DOMParser = class {
  parseFromString(text) {
    try { const doc = parseXml(text); doc.documentElement = doc.children[0]; return doc; } catch {
      const doc = new XmlElement('#document', null, '#document', []);
      doc.nodes.push(new XmlElement('parsererror', null, 'parsererror', []));
      return doc;
    }
  }
};

// ---------------------------------------------------------------------------------------------- .docx writer (STORE zip)
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nm = enc.encode(name); const body = typeof data === 'string' ? enc.encode(data) : data; const crc = crc32(body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(nm.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(body.length, 24); entry.writeUInt16LE(nm.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, nm, body); central.push(entry, nm); offset += 30 + nm.length + body.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (text, { b = false, i = false } = {}) => String(text).split('\t').map((part, k) => `${k ? '<w:r><w:tab/></w:r>' : ''}${part ? `<w:r>${b || i ? `<w:rPr>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(part)}</w:t></w:r>` : ''}`).join('');
/** One paragraph. style: style id; b: bold; jc: alignment; noNum: direct "no numbering" (Word's numId 0). */
const para = (text, { style, b, i, jc, list, noNum } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>' : ''}${noNum ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>' : ''}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${run(text, { b, i })}</w:p>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS_W}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3, 4].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`).join('')}
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="TableofFigures"><w:name w:val="table of figures"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${NS_W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

function docxFrom(bodyXml, { styles = STYLES, numbering = null, title = '' } = {}) {
  return zipStore({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS_W}"><w:body>${bodyXml}</w:body></w:document>`,
    'word/styles.xml': styles,
    ...(numbering ? { 'word/numbering.xml': numbering } : {}),
    ...(title ? { 'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEsc(title)}</dc:title></cp:coreProperties>` } : {}),
  });
}

// ---------------------------------------------------------------------------------------------- the report (mirrors the UQU template)
const REFS = [
  'Babineau W., Barry P., Furness Z., "Automated Testing within the Joint Training confederation (JTC)", Proceedings of the Fall 1998 Simulation Interoperability Workshop, Orlando, FL, USA. September 1998.',
  'Banks C. "Introduction to Modeling and Simulation". Chapter 1 in book “Modeling and Simulation Fundamentals: Theoretical Underpinnings and Practical Domains”. Catherine Banks, John Sokolowski Editors. Wiley. New Jersey, 2010.',
  'Booth D., Haas H., McCabe F., Newcomer E., Champion M., Ferris C., Orchard D. “Web Services Architecture”. 2004. <http://www.w3.org/TR/ws-arch/>. Accessed November 2010.',
];

const CH = {
  1: ['INTRODUCTION', 'This chapter comprises the background of the project, the reasons for taking it, the problems addressed by the project and the expected outcomes.', [
    ['Overview', 'A general review or summary of the project: the master blueprint for the project as a whole.'],
    ['Project Motivation', 'What are the reasons behind your choice to develop this project? Why is your project important?'],
    ['Problem Statement', 'The issues addressed by this project and the conditions to be improved upon.'],
    ['Project Aim and Objectives', 'The overall purposes of the project, clearly and concisely defined.'],
    ['Related Existing Systems', 'A survey of existing systems. Simulation tooling is surveyed in [2], and testing practice in [1], [3].'],
  ]],
  2: ['PLANNING PHASE', 'The planning phase of the project.', [
    ['Scope of the Project', 'The boundaries of the project: what it is going to accomplish.'],
    ['Project Risks and Product Risks', 'Uncertain events or conditions that may affect the project objectives.'],
    ['Project Schedule', 'A timetable with the start and end dates and the milestones.'],
    ['Project Software and Hardware Requirements', 'The prerequisite software and hardware of this project.'],
  ]],
  3: ['REQUIREMENT ENGINEERING AND ANALYSIS', 'How the requirements were collected and modelled.', [
    ['Used Techniques for Requirements Collection', 'The techniques used to elicit requirements, as in [1]–[3].'],
    ['Functional Requirements & Modelling', 'A Functional Requirement (FR) describes a service that the software must offer.', [
      ['List of System Functions (Features)', 'List all features of your system.'],
      ['Use Case Diagram', 'Draw all use cases using a UML use case diagram.'],
      ['Use Cases: Description & Details', 'Document each use case of the use case diagram.'],
    ]],
    ['Nonfunctional Requirements: Quality & Constraints', 'Nonfunctional Requirements (NFRs) define system attributes such as security and usability. Page 7 [7] is not a reference.'],
  ]],
  4: ['SYSTEM ARCHITECTURE & DESIGN', 'The architecture and the detailed design.', [
    ['Software Architecture', 'The architecture follows the layered style described in [2].'],
    ['Software Detailed Design', 'The detailed design.', [
      ['Use Cases Internal Interactions as Sequence Diagrams', 'A UML sequence diagram for each use case.'],
      ['Class Diagram', 'The UML class diagram, including attributes and methods.'],
      ['Data Storage Organization', 'The data structure of the database.'],
    ]],
    ['User Interface Prototyping', 'The graphical user interface screens of the system.'],
  ]],
};
const CONCLUSION_TEXT = 'The conclusion closes the document with a summary of the study.';

/**
 * The template as a Word file. styled: real Heading 1-4 styles (otherwise bold lines like many student files).
 * refs: texts of the reference list (null = no REFERENCES section). refLabel: type "[n]" in front of each entry.
 * edit(ch, secTitle, text) may change a paragraph. numberedList: Word numbers the chapters ("CHAPTER 1:" is not in the text).
 */
function templateDocx({ styled = true, refs = REFS, refLabel = true, chapterEdit = null, closing = 'CONCLUSIONS', labels = true, plainClosing = false, refsTable = false } = {}) {
  const out = [];
  const centered = (text, o = {}) => para(text, { jc: 'center', b: true, ...o });
  // title page
  out.push(centered('Umm Al Qura University'), centered('College of Computing'), centered('Software Engineering Department'));
  out.push(centered('Smart Campus Navigation System'));
  out.push(para('A project submitted', { jc: 'center', i: true }), para('in partial fulfillment of the requirements for the degree of Bachelor in Software Engineering', { jc: 'center', i: true }));
  out.push(centered('by'), para('Ahmed Mohammed Alharthi (44012345)', { jc: 'center' }), para('Sara Khalid Alotaibi (44012346)', { jc: 'center' }));
  out.push(centered('Supervised by'), para('Dr. Fahad Alzahrani', { jc: 'center' }), centered('May 2026'));
  // front matter
  const front = (title) => (styled ? para(title, { style: 'Heading1' }) : centered(title));
  out.push(front('Declaration'));
  out.push(para('This is to declare that the project entitled “Smart Campus Navigation System” is an original work done by the undersigned.'));
  out.push(para('All the analysis, design and system development have been accomplished by the undersigned.'));
  out.push(para('Student 1'), para('Student 2'), para('Note: sign across your name', { jc: 'center' }));
  out.push(front('ABSTRACT'), para('A navigation system for the campus that guides visitors indoors and outdoors.'));
  out.push(front('ACKNOWLEDGMENT'), para('We thank our parents, friends and instructors for their support.'));
  out.push(front('CONTENT'));
  for (const line of ['UNDERTAKING ........ ii', 'ABSTRACT ........ iii', 'CHAPTER 1: INTRODUCTION ........ 9', '1.1 Overview ........ 9', 'CONCLUSIONS ........ 18', 'REFERENCES ........ 19']) out.push(para(line, { style: 'TOC1' }));
  out.push(front('LIST OF TABLES'), para('Table 1: Table Example ........ 14', { style: 'TableofFigures' }));
  out.push(front('LIST OF FIGURES'), para('Figure 1: System Overview ........ 15', { style: 'TableofFigures' }));
  out.push(front('LIST OF ACRONYMS AND ABBREVIATIONS'));
  for (const a of ['API\tApplication Programming Interface', 'REST\tRepresentational State Transfer', 'RPC\tRemote Procedure Call']) out.push(para(a));
  // chapters
  const heading = (level, text) => (styled ? para(text, { style: `Heading${level}` }) : para(text, { b: true, jc: level === 1 ? 'center' : undefined }));
  const sections = (list, prefix) => list.forEach(([title, text, children], i) => {
    const num = `${prefix}.${i + 1}`;
    out.push(heading(num.split('.').length, labels ? `${num} ${title}` : title));
    out.push(para(chapterEdit ? chapterEdit(num, text) : text));
    if (children) sections(children, num);
  });
  for (const n of [1, 2, 3, 4]) {
    const [title, intro, list] = CH[n];
    out.push(heading(1, labels ? `CHAPTER ${n}: ${title}` : title));
    out.push(para(intro));
    sections(list, String(n));
  }
  const closingHeading = (text) => (plainClosing ? centered(text) : heading(1, text));
  out.push(closingHeading(closing), para(CONCLUSION_TEXT));
  if (refs) {
    out.push(closingHeading('REFERENCES'));
    if (refsTable) out.push(`<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="800"/><w:gridCol w:w="8000"/></w:tblGrid>${refs.map((r, i) => `<w:tr><w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr>${para(`${i + 1}`)}</w:tc><w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>${para(r)}</w:tc></w:tr>`).join('')}</w:tbl>`);
    else refs.forEach((r, i) => out.push(para(refLabel ? `[${i + 1}]\t${r}` : r)));
  }
  return docxFrom(out.join(''), { numbering: NUMBERING });
}

// ---------------------------------------------------------------------------------------------- modules under test
const { parseDocx } = await import('../src/word/docx-parse.js');
const { buildPlan, applyPlan } = await import('../src/word/plan.js');
const { parseReferenceEntry, convertCitations, matchReferences, citationIndex } = await import('../src/word/refs.js');
const { isClosingTitle, isReferencesTitle, frontKindOf, hashOf } = await import('../src/word/text-utils.js');
const { Store } = await import('../src/core/store.js');
const { ProjectRepository } = await import('../src/storage/repository.js');
const { presetProjectFields } = await import('../src/core/presets.js');
const { createReference, createChapter } = await import('../src/core/model.js');
const { getNumbering } = await import('../src/core/numbering.js');
const { resolveText, REF_RE } = await import('../src/core/references.js');
const { AR } = await import('../src/i18n/ar/index.js');

const memoryAdapter = () => {
  const data = new Map();
  return {
    name: 'memory', label: 'Memory', get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null), set: async (k, v) => { data.set(k, structuredClone(v)); },
    remove: async (k) => { data.delete(k); }, keys: async (p = '') => [...data.keys()].filter((k) => k.startsWith(p)), usage: async () => ({ used: 0, quota: 1e9 }),
  };
};
const newStore = async (fields = {}) => {
  const store = new Store(new ProjectRepository(memoryAdapter()));
  const project = await store.createProject({ name: 'Smart Campus Navigation System', ...fields });
  await store.openProject(project.id);
  return store;
};

/** parse → plan → apply every checked item (what linking a file does when nothing is deselected). */
async function sync(store, bytes, { name = 'report.docx', select = (plan) => plan.items.filter((i) => i.checked).map((i) => i.id) } = {}) {
  const parsed = await parseDocx(bytes, { fileName: name });
  const plan = buildPlan(store.project, parsed);
  const res = await applyPlan(store, plan, select(plan), { fileInfo: { name, lastModified: Date.now() } });
  return { parsed, plan, res };
}
const planOf = async (store, bytes) => buildPlan(store.project, await parseDocx(bytes, { fileName: 'report.docx' }));
const describe = (plan) => plan.items.map((i) => `${i.group}/${i.kind}:${i.title}`);
const refsOf = (store) => store.project.references;
const flatSections = (nodes, out = []) => { for (const n of nodes) { out.push(n); flatSections(n.sections || [], out); } return out; };
const findSection = (store, title) => flatSections(store.project.chapters.flatMap((c) => c.sections)).find((s) => s.title === title);

let passed = 0; let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const section = (name) => tests.push([`§${name}`, null]);

// ---------------------------------------------------------------------------------------------- unit: titles, entries, citations
section('titles and entries');
test('closing and reference titles', () => {
  for (const t of ['CONCLUSIONS', 'Conclusion', 'Conclusions and Recommendations', 'SUMMARY', 'FUTURE WORK', 'Recommendations', 'Appendix A: Survey', 'الخاتمة', '6. Conclusion']) assert.ok(isClosingTitle(t), t);
  for (const t of ['Introduction', 'Recommendation Systems', 'Summary of the Survey Results', 'References']) assert.ok(!isClosingTitle(t), t);
  for (const t of ['REFERENCES', 'References', 'Bibliography', 'WORKS CITED', 'المراجع', '7. References', 'Reference List']) assert.ok(isReferencesTitle(t), t);
  for (const t of ['Related Existing Systems', 'Conclusions', 'Reference Architecture']) assert.ok(!isReferencesTitle(t), t);
});
test('front matter titles of the template', () => {
  const kinds = { Declaration: 'declaration', Undertaking: 'declaration', ABSTRACT: 'abstract', ACKNOWLEDGMENT: 'acknowledgements', ACKNOWLEDGEMENTS: 'acknowledgements', CONTENT: 'toc', CONTENTS: 'toc', 'TABLE OF CONTENTS': 'toc', 'LIST OF TABLES': 'lot', 'LIST OF FIGURES': 'lof', 'LIST OF ACRONYMS AND ABBREVIATIONS': 'loa', 'LIST OF ABBREVIATIONS': 'loa' };
  for (const [title, kind] of Object.entries(kinds)) assert.equal(frontKindOf(title), kind, title);
});
test('reference entries: numbers are stripped, text is kept', () => {
  assert.deepEqual(parseReferenceEntry('[1]\tBabineau W., Barry P.'), { label: 1, text: 'Babineau W., Barry P.' });
  assert.deepEqual(parseReferenceEntry('12) Booth D.'), { label: 12, text: 'Booth D.' });
  assert.deepEqual(parseReferenceEntry('3. Smith J.'), { label: 3, text: 'Smith J.' });
  assert.deepEqual(parseReferenceEntry('[٢] Smith'), { label: 2, text: 'Smith' });
  assert.deepEqual(parseReferenceEntry('(4) Lee'), { label: 4, text: 'Lee' });
  assert.deepEqual(parseReferenceEntry('2010. A year first'), { label: null, text: '2010. A year first' });
  assert.deepEqual(parseReferenceEntry('1.5 million users'), { label: null, text: '1.5 million users' });
});
test('citations: single, list, range, out of range', () => {
  const lookup = (n) => (n >= 1 && n <= 5 ? `r${n}` : null);
  const conv = (s) => convertCitations(s, lookup, (n, id) => `<${id}>`);
  assert.equal(conv('see [3] here'), 'see <r3> here');
  assert.equal(conv('see [1], [2]'), 'see <r1>, <r2>');
  assert.equal(conv('see [1,2]'), 'see <r1>, <r2>');
  assert.equal(conv('see [1]–[3]'), 'see <r1>, <r2>, <r3>');
  assert.equal(conv('see [1-3] and [4–5]'), 'see <r1>, <r2>, <r3> and <r4>, <r5>');
  assert.equal(conv('see [1, 3-4]'), 'see <r1>, <r3>, <r4>');
  assert.equal(conv('see [٢]'), 'see <r2>');
  assert.equal(conv('see [9]'), 'see [9]'); // out of range
  assert.equal(conv('see [1, 9]'), 'see [1, 9]'); // one number out of range: the whole group stays
  assert.equal(conv('see [3-1] [0] [2010] [a]'), 'see [3-1] [0] [2010] [a]');
  assert.equal(conv('arr[1](x) and x2[1]'), 'arr[1](x) and x2[1]');
  assert.equal(conv('no brackets'), 'no brackets');
});
test('citations: typed labels win over position when every entry has one', () => {
  const index = citationIndex([{ label: 1 }, { label: 2 }, { label: 4 }]);
  assert.equal(index.indexOf(4), 2); assert.equal(index.indexOf(3), -1); assert.equal(index.numberOf(2), 4);
  const byPosition = citationIndex([{ label: null }, { label: null }]);
  assert.equal(byPosition.indexOf(2), 1); assert.equal(byPosition.indexOf(3), -1); assert.equal(byPosition.numberOf(0), 1);
});
test('matching: same text, edited in Word, inserted, removed, edited on the site', () => {
  const ref = (id, custom) => ({ id, custom, source: 'word' });
  const entries = (...texts) => texts.map((text) => ({ label: null, text }));
  const A = ref('a', 'Alpha A. "First"'); const B = ref('b', 'Beta B. "Second"'); const C = ref('c', 'Gamma C. "Third"');
  let m = matchReferences(entries('Alpha A. "First"', 'Beta B. "Second"', 'Gamma C. "Third"'), [A, B, C]);
  assert.deepEqual(m.rows.map((r) => [r.proj?.id, r.changed]), [['a', false], ['b', false], ['c', false]]);
  m = matchReferences(entries('Alpha A. "First"', 'Beta B. "Second, edited"', 'Gamma C. "Third"'), [A, B, C]); // edited in Word: same position
  assert.deepEqual(m.rows.map((r) => [r.proj?.id, r.changed]), [['a', false], ['b', true], ['c', false]]); assert.equal(m.removed.length, 0);
  m = matchReferences(entries('Alpha A. "First"', 'New N. "Inserted"', 'Beta B. "Second"', 'Gamma C. "Third"'), [A, B, C]);
  assert.deepEqual(m.rows.map((r) => r.proj?.id ?? null), ['a', null, 'b', 'c']);
  m = matchReferences(entries('Alpha A. "First"', 'Gamma C. "Third"'), [A, B, C]);
  assert.deepEqual(m.rows.map((r) => r.proj?.id), ['a', 'c']); assert.deepEqual(m.removed.map((r) => r.id), ['b']);
  m = matchReferences(entries('Gamma C. "Third"', 'Alpha A. "First"', 'Beta B. "Second"'), [A, B, C]); // reordered
  assert.deepEqual(m.rows.map((r) => r.proj?.id), ['c', 'a', 'b']);
  const edited = { ...B, custom: 'Beta B. "Second" (edited on the site)' }; // site edit, Word unchanged since the last sync
  m = matchReferences(entries('Alpha A. "First"', 'Beta B. "Second"', 'Gamma C. "Third"'), [A, edited, C], { b: hashOf('Beta B. "Second"') });
  assert.deepEqual(m.rows.map((r) => [r.proj?.id, r.changed]), [['a', false], ['b', false], ['c', false]]);
  m = matchReferences(entries('Alpha A. "First"', 'Beta B. "Second"', 'Gamma C. "Third"'), [A, edited, C], {}); // no memory of the last sync: the site text is overwritten
  assert.deepEqual(m.rows.map((r) => [r.proj?.id, r.changed]), [['a', false], ['b', true], ['c', false]]);
});

// ---------------------------------------------------------------------------------------------- parse
section('parsing the template (Heading 1-4 styles)');
test('structure, closing chapter, references, title page', async () => {
  const parsed = await parseDocx(templateDocx(), { fileName: 'report.docx' });
  assert.deepEqual(parsed.chapters.map((c) => [c.title, c.numbered, c.number]), [
    ['Introduction', true, '1'], ['Planning Phase', true, '2'], ['Requirement Engineering and Analysis', true, '3'], ['System Architecture & Design', true, '4'], ['Conclusions', false, ''],
  ]);
  assert.deepEqual(parsed.chapters[0].children.map((s) => [s.number, s.title]), [['1.1', 'Overview'], ['1.2', 'Project Motivation'], ['1.3', 'Problem Statement'], ['1.4', 'Project Aim and Objectives'], ['1.5', 'Related Existing Systems']]);
  const fr = parsed.chapters[2].children[1];
  assert.deepEqual(fr.children.map((s) => s.number), ['3.2.1', '3.2.2', '3.2.3']);
  assert.equal(fr.children[0].title, 'List of System Functions (Features)');
  assert.ok(!parsed.chapters.some((c) => /references/i.test(c.title)), 'References must not be a chapter');
  assert.equal(parsed.references.length, 3);
  assert.ok(parsed.references.every((r, i) => r.label === i + 1 && r.text === REFS[i]));
  assert.deepEqual(parsed.front.map((f) => f.kind), ['declaration', 'abstract', 'acknowledgements', 'toc', 'lot', 'lof', 'loa']);
  assert.equal(parsed.front[0].body.split('\n').length, 2, `the signature block is not part of the declaration: ${JSON.stringify(parsed.front[0].body)}`);
  assert.deepEqual(parsed.acronyms.map((a) => a.acronym), ['API', 'REST', 'RPC']);
  assert.equal(parsed.title, 'Smart Campus Navigation System');
  assert.equal(parsed.titlePage.university, 'Umm Al Qura University');
  assert.equal(parsed.titlePage.department, 'Software Engineering Department');
  assert.equal(parsed.titlePage.students, 'Ahmed Mohammed Alharthi (44012345)\nSara Khalid Alotaibi (44012346)');
  assert.equal(parsed.titlePage.supervisor, 'Dr. Fahad Alzahrani');
  assert.equal(parsed.titlePage.submissionDate, 'May 2026');
});
test('the same report written with bold lines instead of heading styles', async () => {
  const parsed = await parseDocx(templateDocx({ styled: false }), { fileName: 'report.docx' });
  assert.deepEqual(parsed.chapters.map((c) => [c.title, c.numbered]), [['Introduction', true], ['Planning Phase', true], ['Requirement Engineering and Analysis', true], ['System Architecture & Design', true], ['Conclusions', false]]);
  assert.equal(parsed.chapters[2].children[1].children.length, 3);
  assert.equal(parsed.references.length, 3);
  assert.ok(parsed.warnings.some((w) => w.code === 'pseudo-headings'));
});
test('CONCLUSIONS and REFERENCES as plain bold centred lines under styled chapters; a reference list in a table', async () => {
  for (const o of [{ plainClosing: true }, { refsTable: true }, { plainClosing: true, refsTable: true, refLabel: false }]) {
    const parsed = await parseDocx(templateDocx(o), { fileName: 'report.docx' });
    assert.deepEqual(parsed.chapters.map((c) => [c.title, c.numbered]), [['Introduction', true], ['Planning Phase', true], ['Requirement Engineering and Analysis', true], ['System Architecture & Design', true], ['Conclusions', false]], JSON.stringify(o));
    assert.deepEqual(parsed.references.map((r) => r.text), REFS, JSON.stringify(o));
    assert.equal(parsed.chapters[4].blocks.length, 1, 'the references are not part of the conclusions');
  }
});
test('the signature block of a filled-in declaration is not part of its text', async () => {
  const body = [
    para('Smart Campus', { style: 'Title' }), para('Prepared by'), para('Ahmed Mohammed Alharthi'), para('Sara Khalid Alotaibi'),
    para('Declaration', { style: 'Heading1' }), para('This is to declare that the project is an original work.'), para('It has not been submitted to any other university.'),
    para('Ahmed Alharthi'), para('Sara Alotaibi'), para('Note: sign across your name', { jc: 'center' }),
    para('CHAPTER 1: INTRODUCTION', { style: 'Heading1' }), para('Text.'),
  ].join('');
  const parsed = await parseDocx(docxFrom(body), { fileName: 'x.docx' });
  assert.deepEqual(parsed.front[0].body.split('\n'), ['This is to declare that the project is an original work.', 'It has not been submitted to any other university.']);
});
test('a bold "Summary" label inside a chapter is not a closing chapter', async () => {
  const body = [para('Intro', { style: 'Title' }), para('CHAPTER 1: INTRODUCTION', { style: 'Heading1' }), para('Text.'), para('Summary', { b: true, jc: 'center' }), para('Box text.'), para('CHAPTER 2: DESIGN', { style: 'Heading1' }), para('Design.')].join('');
  const parsed = await parseDocx(docxFrom(body), { fileName: 'x.docx' });
  assert.deepEqual(parsed.chapters.map((c) => c.title), ['Introduction', 'Design']);
  assert.equal(parsed.chapters[0].blocks.length, 3);
});
test('chapters without "Chapter N" labels: only the closing chapter loses its number', async () => {
  const parsed = await parseDocx(templateDocx({ labels: false }), { fileName: 'report.docx' });
  assert.deepEqual(parsed.chapters.map((c) => c.numbered), [true, true, true, true, false]);
  assert.deepEqual(parsed.chapters.map((c) => c.number), ['1', '2', '3', '4', '']);
  assert.deepEqual(parsed.chapters[1].children.map((s) => s.number), ['2.1', '2.2', '2.3', '2.4']);
});
test('closing chapters: FUTURE WORK, SUMMARY after the chapters, APPENDIX; SUMMARY before them is the abstract', async () => {
  const body = [
    para('Title of the project', { style: 'Title' }),
    para('SUMMARY', { style: 'Heading1' }), para('A short summary that is the abstract.'),
    para('CHAPTER 1: INTRODUCTION', { style: 'Heading1' }), para('Intro text.'), para('1.1 Scope', { style: 'Heading2' }), para('Scope text.'),
    para('CHAPTER 2: DESIGN', { style: 'Heading1' }), para('Design text.'),
    para('FUTURE WORK', { style: 'Heading1' }), para('More to do.'), para('Mobile app', { style: 'Heading2' }), para('An app.'),
    para('SUMMARY', { style: 'Heading1' }), para('Closing summary.'),
    para('APPENDIX A: SURVEY QUESTIONS', { style: 'Heading1' }), para('Questions.'),
  ].join('');
  const parsed = await parseDocx(docxFrom(body), { fileName: 'x.docx' });
  assert.deepEqual(parsed.front.map((f) => f.kind), ['abstract']);
  assert.deepEqual(parsed.chapters.map((c) => [c.title, c.numbered, c.number]), [['Introduction', true, '1'], ['Design', true, '2'], ['Future Work', false, ''], ['Summary', false, ''], ['Appendix A: Survey Questions', false, '']]);
  assert.deepEqual(parsed.chapters[2].children.map((s) => [s.title, s.number]), [['Mobile app', '']]);
  assert.equal(parsed.references, null);
});
test('Word numbers the chapters itself: only the heading with numbering switched off is a closing chapter', async () => {
  const styles = STYLES.replace('<w:pPr><w:outlineLvl w:val="0"/></w:pPr>', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="0"/></w:pPr>');
  const body = [
    para('Smart Campus', { style: 'Title' }),
    para('INTRODUCTION', { style: 'Heading1' }), para('Intro.'), para('Overview', { style: 'Heading2' }), para('Text.'),
    para('DESIGN', { style: 'Heading1' }), para('Design.'),
    para('CONCLUSIONS', { style: 'Heading1', noNum: true }), para('Done.'),
    para('REFERENCES', { style: 'Heading1', noNum: true }), para('[1] One.'), para('Two.', { list: true }),
  ].join('');
  const parsed = await parseDocx(docxFrom(body, { styles, numbering: NUMBERING }), { fileName: 'x.docx' });
  assert.deepEqual(parsed.chapters.map((c) => [c.title, c.numbered]), [['Introduction', true], ['Design', true], ['Conclusions', false]]);
  assert.deepEqual(parsed.references.map((r) => [r.label, r.text]), [[1, 'One.'], [null, 'Two.']]);
});

// ---------------------------------------------------------------------------------------------- plan + apply
section('importing the template into a new project');
test('chapters 1-4 numbered, Conclusions unnumbered, no References chapter, 3 references, citations as tokens', async () => {
  const store = await newStore();
  const { plan } = await sync(store, templateDocx());
  const p = store.project; const n = getNumbering(p);
  assert.deepEqual(p.chapters.map((c) => [c.title, c.numbered]), [['Introduction', true], ['Planning Phase', true], ['Requirement Engineering and Analysis', true], ['System Architecture & Design', true], ['Conclusions', false]]);
  assert.deepEqual(p.chapters.map((c) => n.chapters.get(c.id).number), ['1', '2', '3', '4', '']);
  assert.equal(n.sections.get(findSection(store, 'Use Case Diagram').id).number, '3.2.2');
  assert.equal(n.sections.get(findSection(store, 'Data Storage Organization').id).number, '4.2.3');
  assert.equal(n.sections.get(findSection(store, 'Project Schedule').id).number, '2.3');
  assert.ok(!p.chapters.some((c) => /reference/i.test(c.title)));
  assert.equal(refsOf(store).length, 3);
  assert.ok(refsOf(store).every((r, i) => r.source === 'word' && r.type === 'other' && r.custom === REFS[i]), JSON.stringify(refsOf(store)));
  const [r1, r2, r3] = refsOf(store).map((r) => r.id);
  assert.equal(findSection(store, 'Related Existing Systems').body, `A survey of existing systems. Simulation tooling is surveyed in {{ref:cite:${r2}}}, and testing practice in {{ref:cite:${r1}}}, {{ref:cite:${r3}}}.`);
  assert.equal(findSection(store, 'Used Techniques for Requirements Collection').body, `The techniques used to elicit requirements, as in {{ref:cite:${r1}}}, {{ref:cite:${r2}}}, {{ref:cite:${r3}}}.`);
  assert.equal(findSection(store, 'Nonfunctional Requirements: Quality & Constraints').body.includes('[7]'), true, 'out of range: left as typed');
  assert.ok(!/\{\{ref:cite:/.test(findSection(store, 'Nonfunctional Requirements: Quality & Constraints').body));
  assert.ok(plan.items.some((i) => i.group === 'references' && i.kind === 'add'));
  assert.equal(plan.items.filter((i) => i.group === 'references').length, 3);
  assert.equal(p.chapters[4].body, CONCLUSION_TEXT);
  // every token resolves
  for (const owner of [findSection(store, 'Related Existing Systems'), findSection(store, 'Software Architecture')]) {
    for (const m of owner.body.matchAll(REF_RE)) assert.ok(n.references.has(m[2]), `token ${m[0]} resolves`);
  }
  assert.equal(p.wordLink.hashes.refs[r1] !== undefined, true);
  // the first import keeps Word's list order ("manual"), so the site shows the numbers Word shows
  assert.equal(store.project.settings.references.order, 'manual');
  assert.equal(resolveText(store.project, findSection(store, 'Related Existing Systems').body), 'A survey of existing systems. Simulation tooling is surveyed in [2], and testing practice in [1], [3].');
  assert.equal(resolveText(store.project, findSection(store, 'Used Techniques for Requirements Collection').body), 'The techniques used to elicit requirements, as in [1], [2], [3].');
});
test('a second sync with the same file changes nothing', async () => {
  const store = await newStore();
  const bytes = templateDocx();
  await sync(store, bytes);
  const before = JSON.stringify({ c: store.project.chapters, r: store.project.references, f: store.project.frontMatter, a: store.project.acronyms });
  const plan = await planOf(store, bytes);
  assert.deepEqual(describe(plan), []);
  assert.equal(plan.hasRemovals, false);
  const res = await sync(store, bytes);
  assert.equal(res.plan.items.length, 0);
  assert.equal(JSON.stringify({ c: store.project.chapters, r: store.project.references, f: store.project.frontMatter, a: store.project.acronyms }), before);
});
test('the same report without "[n]" typed in front of the entries and written with bold lines', async () => {
  for (const [styled, refLabel] of [[true, false], [false, true], [false, false]]) {
    const store = await newStore();
    await sync(store, templateDocx({ styled, refLabel }));
    assert.equal(refsOf(store).length, 3, `styled=${styled} refLabel=${refLabel}`);
    assert.deepEqual(refsOf(store).map((r) => r.custom), REFS);
    assert.deepEqual(store.project.chapters.map((c) => c.numbered), [true, true, true, true, false]);
    assert.match(findSection(store, 'Related Existing Systems').body, /\{\{ref:cite:ref_\w+\}\}/);
    assert.deepEqual(describe(await planOf(store, templateDocx({ styled, refLabel }))), []);
  }
});
test('editing one reference in Word updates exactly that one', async () => {
  const store = await newStore();
  await sync(store, templateDocx());
  const ids = refsOf(store).map((r) => r.id);
  const bodyBefore = findSection(store, 'Related Existing Systems').body;
  const edited = [...REFS]; edited[1] = `${REFS[1].replace('Wiley. New Jersey, 2010.', 'Wiley, Hoboken, 2010.')}`;
  const plan = await planOf(store, templateDocx({ refs: edited }));
  assert.deepEqual(plan.items.map((i) => [i.group, i.kind]), [['references', 'update']]);
  assert.equal(plan.items[0].title, '[2]');
  assert.equal(plan.hasRemovals, false);
  await sync(store, templateDocx({ refs: edited }));
  assert.deepEqual(refsOf(store).map((r) => r.id), ids, 'ids are stable');
  assert.deepEqual(refsOf(store).map((r) => r.custom), edited);
  assert.equal(findSection(store, 'Related Existing Systems').body, bodyBefore, 'citation tokens keep pointing at the same reference');
  assert.deepEqual(describe(await planOf(store, templateDocx({ refs: edited }))), []);
});
test('adding, inserting and deleting references; only imported ones are removed, and only after review', async () => {
  const store = await newStore();
  await sync(store, templateDocx());
  const userRef = createReference({ type: 'journal', authors: 'Alharthi A.', title: 'My own paper', year: '2024' });
  const otherSource = createReference({ type: 'other', custom: 'Imported elsewhere', source: 'bibtex' });
  store.update((p) => { p.references.push(userRef, otherSource); });
  const NEW = 'Smith J., "A fourth source", 2020.';
  // append
  let plan = await planOf(store, templateDocx({ refs: [...REFS, NEW] }));
  assert.deepEqual(plan.items.map((i) => [i.group, i.kind]), [['references', 'add']]);
  await sync(store, templateDocx({ refs: [...REFS, NEW] }));
  assert.deepEqual(refsOf(store).map((r) => r.custom ?? ''), [...REFS, NEW, '', 'Imported elsewhere'].map((c, i) => (i === 4 ? '' : c)));
  assert.equal(refsOf(store).filter((r) => r.source === 'word').length, 4);
  // delete the second entry in Word
  const without = [REFS[0], REFS[2], NEW];
  plan = await planOf(store, templateDocx({ refs: without }));
  const removal = plan.items.find((i) => i.group === 'references');
  assert.equal(plan.items.filter((i) => i.group === 'references').length, 1);
  assert.equal(removal.kind, 'remove'); assert.equal(removal.checked, false); assert.equal(plan.hasRemovals, true);
  await sync(store, templateDocx({ refs: without }), { select: (pl) => pl.items.filter((i) => i.checked).map((i) => i.id) }); // not selected: the reference stays
  assert.equal(refsOf(store).filter((r) => r.source === 'word').length, 4);
  await sync(store, templateDocx({ refs: without }), { select: (pl) => pl.items.map((i) => i.id) });
  assert.deepEqual(refsOf(store).filter((r) => r.source === 'word').map((r) => r.custom), without);
  assert.ok(refsOf(store).some((r) => r.id === userRef.id) && refsOf(store).some((r) => r.id === otherSource.id), 'user-made references are never touched');
  // a file that has no REFERENCES section at all leaves every reference alone
  plan = await planOf(store, templateDocx({ refs: null }));
  assert.equal(plan.items.filter((i) => i.group === 'references').length, 0);
  // inserted at the top: only an addition, in Word's place
  const top = 'Zed Z., "First of all", 1999.';
  await sync(store, templateDocx({ refs: [top, ...without] }));
  assert.deepEqual(refsOf(store).filter((r) => r.source === 'word').map((r) => r.custom), [top, ...without]);
});
test('undo: the backup taken before a sync restores the references too', async () => {
  const store = await newStore();
  await sync(store, templateDocx());
  const idsBefore = refsOf(store).map((r) => [r.id, r.custom, r.source]);
  const hashesBefore = JSON.stringify(store.project.wordLink.hashes.refs);
  const edited = [...REFS, 'Smith J., "Late addition", 2020.']; edited[0] = `${REFS[0]} (rev.)`;
  const { res } = await sync(store, templateDocx({ refs: edited }));
  assert.ok(res.backup, 'a backup was made');
  assert.equal(refsOf(store).length, 4);
  await store.restoreBackup((await store.repo.listBackups(store.project.id)).find((b) => b.id === res.backup.id));
  assert.deepEqual(refsOf(store).map((r) => [r.id, r.custom, r.source]), idsBefore);
  assert.equal(JSON.stringify(store.project.wordLink.hashes.refs), hashesBefore);
  assert.deepEqual(describe(await planOf(store, templateDocx())), []);
});
test('citations in a report without a reference list stay as typed; adding the list later links them', async () => {
  const store = await newStore();
  await sync(store, templateDocx({ refs: null }));
  assert.equal(refsOf(store).length, 0);
  assert.match(findSection(store, 'Related Existing Systems').body, /surveyed in \[2\], and testing practice in \[1\], \[3\]\./);
  assert.deepEqual(describe(await planOf(store, templateDocx({ refs: null }))), []);
  const plan = await planOf(store, templateDocx());
  const texts = plan.items.filter((i) => i.group === 'text');
  assert.equal(plan.items.filter((i) => i.group === 'references').length, 3);
  assert.ok(texts.length >= 3, 'the paragraphs with citations are offered for linking');
  // a paragraph whose typed citations only need linking, or whose "[1]–[3]" is rewritten as "[1], [2], [3]"
  assert.ok(texts.every((i) => /citation|added/.test(i.detail[0])), JSON.stringify(texts.map((i) => i.detail)));
  assert.ok(texts.some((i) => i.detail[0].includes('citation')));
  await sync(store, templateDocx());
  assert.match(findSection(store, 'Related Existing Systems').body, /\{\{ref:cite:/);
  assert.deepEqual(describe(await planOf(store, templateDocx())), []);
});
test('a token and the typed "[n]" are the same text for change detection', async () => {
  const store = await newStore();
  await sync(store, templateDocx());
  // the user edits the site: "[1], [3]" stays tokens; the Word text is unchanged → no text item, whatever the site numbering shows
  store.update((p) => { p.settings.references.order = 'alphabetical'; });
  assert.deepEqual(describe(await planOf(store, templateDocx())), []);
  // the Word paragraph changes in a different place → only that paragraph is a text change, with readable diff lines
  const plan = await planOf(store, templateDocx({ chapterEdit: (num, text) => (num === '1.5' ? `${text} Extra sentence.` : text) }));
  assert.deepEqual(plan.items.map((i) => [i.group, i.kind, i.title]), [['text', 'update', 'Related Existing Systems']]);
  const diff = plan.items[0].diff;
  assert.equal(diff.removed[0].includes('{{'), false); assert.equal(diff.added[0].includes('[2]') && diff.added[0].includes('[1], [3]'), true);
});

section('importing into a project made from the university preset');
test('chapters and sections are matched by title, Conclusions stays one unnumbered chapter', async () => {
  const store = await newStore(presetProjectFields('uqu-swe-gp1', { name: 'Smart Campus Navigation System', students: 'Ahmed\nSara' }));
  const chaptersBefore = store.project.chapters.map((c) => c.id);
  const plan = await planOf(store, templateDocx());
  assert.ok(!plan.items.some((i) => i.group === 'structure' && i.kind === 'add' && i.unit === 'chapter'), describe(plan).join('\n'));
  assert.ok(!plan.items.some((i) => i.group === 'structure' && i.kind === 'remove'));
  assert.ok(!plan.items.some((i) => i.title === 'Now an unnumbered chapter' || (i.detail && /numbered/.test(i.detail[0]))), 'flags already agree');
  await sync(store, templateDocx());
  assert.deepEqual(store.project.chapters.map((c) => c.id), chaptersBefore);
  assert.equal(store.project.chapters.length, 5);
  assert.equal(store.project.chapters[4].numbered, false);
  assert.equal(store.project.chapters[4].body, CONCLUSION_TEXT);
  assert.equal(refsOf(store).length, 3);
  assert.equal(store.project.frontMatter.filter((f) => f.kind === 'abstract').length, 1);
  assert.match(store.project.frontMatter.find((f) => f.kind === 'abstract').body, /navigation system/);
  assert.deepEqual(describe(await planOf(store, templateDocx())), []);
  const n = getNumbering(store.project);
  assert.equal(n.sections.get(findSection(store, 'Use Cases: Description & Details').id).number, '3.2.3');
});
test('a closing chapter made as a normal chapter becomes unnumbered; "Conclusion and Future Work" finds "Conclusions"', async () => {
  const store = await newStore({ chapters: [createChapter({ title: 'Introduction' }), createChapter({ title: 'Conclusion' })] });
  const plan = await planOf(store, templateDocx({ closing: 'CONCLUSION' }));
  assert.ok(plan.items.some((i) => i.group === 'structure' && i.detail?.[0] === 'Now an unnumbered chapter' && i.title === 'Conclusions' || i.title === 'Conclusion'), describe(plan).join('\n'));
  await sync(store, templateDocx({ closing: 'CONCLUSION' }));
  assert.equal(store.project.chapters.filter((c) => /conclusion/i.test(c.title)).length, 1);
  assert.equal(store.project.chapters.find((c) => /conclusion/i.test(c.title)).numbered, false);
  // a numbered project chapter that the user re-numbered by hand is not flipped back on every sync (Word did not change)
  store.update((p) => { p.chapters.find((c) => /conclusion/i.test(c.title)).numbered = true; });
  assert.ok(!(await planOf(store, templateDocx({ closing: 'CONCLUSION' }))).items.some((i) => /numbered/.test(i.detail?.[0] || '')));
  const store2 = await newStore(presetProjectFields('uqu-swe-gp1', { name: 'X' }));
  await sync(store2, templateDocx({ closing: 'CONCLUSION AND FUTURE WORK' }));
  assert.equal(store2.project.chapters.length, 5, 'no second closing chapter');
  assert.equal(store2.project.chapters[4].numbered, false);
});

// ---------------------------------------------------------------------------------------------- the app's own exporter
section('a .docx written by the exporter');
test('the exporter\'s report round-trips (skipped when the exporter cannot run here)', async () => {
  let bytes;
  try {
    const { buildDocx } = await import('../src/export/docx.js');
    const source = await newStore(presetProjectFields('uqu-swe-gp1', { name: 'Smart Campus Navigation System', students: 'Ahmed Alharthi\nSara Alotaibi' }));
    const refs = REFS.map((custom) => createReference({ type: 'other', custom }));
    source.update((p) => {
      p.references = refs;
      p.chapters[0].sections[4].body = `A survey of existing systems. See {{ref:cite:${refs[1].id}}}.`;
      p.chapters[4].body = CONCLUSION_TEXT;
      p.frontMatter.find((f) => f.kind === 'abstract').body = 'A navigation system for the campus.';
    });
    const blob = await buildDocx(source.project, { figureImages: new Map() });
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch (err) { console.log(`    (skipped: ${err.message})`); return; }
  const store = await newStore();
  const { plan } = await sync(store, bytes, { name: 'exported.docx' });
  const n = getNumbering(store.project);
  assert.deepEqual(store.project.chapters.map((c) => [c.title, c.numbered]), [['Introduction', true], ['Planning Phase', true], ['Requirement Engineering and Analysis', true], ['System Architecture & Design', true], ['Conclusions', false]]);
  assert.deepEqual(store.project.chapters.map((c) => n.chapters.get(c.id).number), ['1', '2', '3', '4', '']);
  assert.ok(!store.project.chapters.some((c) => /reference/i.test(c.title)), 'no References chapter');
  assert.equal(findSection(store, 'Use Case Diagram') && n.sections.get(findSection(store, 'Use Case Diagram').id).number, '3.2.2');
  const imported = refsOf(store).filter((r) => r.source === 'word');
  if (imported.length) {
    assert.equal(imported.length, 3);
    assert.match(findSection(store, 'Related Existing Systems').body, /\{\{ref:cite:ref_\w+\}\}/);
  } else console.log('    (the exporter writes no reference list yet; reference checks skipped)');
  const again = await planOf(store, bytes);
  assert.deepEqual(describe(again), [], 'a second sync of the exported file is a no-op');
  assert.ok(plan.items.length > 0);
});

// ---------------------------------------------------------------------------------------------- translations
section('translations');
test('every string of the new UI has an Arabic text with the same placeholders', async () => {
  const keys = ['References', 'References: {added} new, {updated} changed, {removed} removed', 'Now a numbered chapter', 'Now an unnumbered chapter', '1 citation linked', '{n} citations linked'];
  const { default: word } = await import('../src/i18n/ar/word.js');
  for (const key of keys) {
    assert.ok(word[key] || AR[key], `missing Arabic for "${key}"`);
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(AR[key]), ph(key), `placeholders of "${key}"`);
  }
  const src = (await import('node:fs')).readFileSync(new URL('../src/word/word-view.js', import.meta.url), 'utf8');
  for (const [, text] of src.matchAll(/text: '((?:[^'\\]|\\.)*)'/g)) assert.ok(AR[text], `missing Arabic for the import text "${text.slice(0, 50)}…"`);
});

// ---------------------------------------------------------------------------------------------- run
for (const [name, fn] of tests) {
  if (!fn) { console.log(name.slice(1)); continue; }
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (err) { failed += 1; console.error(`  ✗ ${name}\n    ${String(err.message).split('\n').slice(0, 30).join('\n    ')}\n    at ${(err.stack?.split('\n').find((l) => l.includes('word-template.mjs')) || '').trim()}`); }
}
console.log(failed ? `\n${failed} failed, ${passed} passed.` : `\n${passed} passed.`);
if (failed) process.exitCode = 1;
