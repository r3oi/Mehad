// "Generate a diagram" dialog: describe it with AI, rebuild it from a picture, type text / Mermaid, or paste JSON —
// with a live preview. A picture is read by Claude (with an API key) or by any chatbot through a copied prompt.
//
//   openGenerateDialog({ project, mode: 'new' | 'insert', hasContent }) → Promise<null | result>
//   result = { diagram, spec, type (figure type id), title, mode: 'replace' | 'add' }
//
// 'new'    used by the New Figure dialog (the caller creates the figure from the result)
// 'insert' used inside the editor; the dialog also asks whether to replace the diagram or add to the canvas
import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal } from '../../ui/modal.js';
import { toast } from '../../ui/toast.js';
import { renderThumbnail, computeBounds } from '../render.js';
import { figureTypes, figureFonts } from '../types.js';
import { href } from '../../app/routes.js';
import { t, isRTL, lang } from '../../i18n/index.js';
import { buildDiagramFromSpec } from './to-diagram.js';
import { SpecError, SPEC_TYPES, figureTypeOf, suggestTitle, buildChatPrompt, buildImageChatPrompt, compactSpec } from './spec.js';
import { parseText } from './text-parse.js';
import { generateSpec, generateSpecFromImage, getAIConfig, modelName, AIError, KEYS_URL } from './ai.js';
import { imageFromFile, isImageFile, titleFromFileName, IMAGE_ACCEPT } from '../editor/image-import.js';
import { pickFile } from '../../core/utils.js';

const AUTO = isRTL ? ' dir="auto"' : '';

// Examples are sample content (not interface text): Arabic ones are offered in the Arabic interface.
const EXAMPLES = {
  en: {
    ai: [
      { label: 'Login flowchart', text: 'Login flowchart: the user enters a username and password. If the credentials are valid, show the dashboard; otherwise show an error message and ask for the credentials again.' },
      { label: 'Library use cases', text: 'Use case diagram of a library system: a Member searches the catalogue, borrows books and returns books. A Librarian manages books and members. Borrowing a book includes checking the membership.' },
      { label: 'Context diagram', text: 'Context diagram of a student project management system: Students submit project data and receive feedback reports, Supervisors send comments and receive progress reports, and Administrators manage user accounts and receive usage statistics.' },
      { label: 'Login sequence', text: 'Sequence diagram: the user opens the mobile app, the app sends a login request to the server, the server checks the database and returns an access token to the app.' },
      { label: 'School classes', text: 'Class diagram of a school: Person has a name and an email. Student and Teacher inherit from Person. A Teacher teaches many Courses and a Course has many Students.' },
      { label: 'Online shop ERD', text: 'ER diagram of an online shop: a Customer places many Orders, an Order contains many Products, and each Product belongs to one Category.' },
      { label: '3-tier architecture', text: 'System architecture with three layers: presentation (web app and mobile app), application (REST API with authentication service and business logic) and data (PostgreSQL database and file storage).' },
    ],
    arrows: 'Start -> Enter username and password\nEnter username and password -> Credentials valid?\nCredentials valid? -> Show dashboard : Yes\nCredentials valid? -> Show error : No\nShow error -> Enter username and password\nShow dashboard -> End',
    outline: 'Library System\n  Users\n    Students\n    Staff\n  Books\n    Catalogue\n    Borrowing',
  },
  ar: {
    ai: [
      { label: 'مخطط تسجيل الدخول', text: 'مخطط انسيابي لتسجيل الدخول: يدخل المستخدم اسم المستخدم وكلمة المرور، فإذا كانت البيانات صحيحة تُعرض لوحة التحكم، وإلا تظهر رسالة خطأ ويُطلب إدخال البيانات من جديد.' },
      { label: 'حالات استخدام المكتبة', text: 'مخطط حالات استخدام لنظام مكتبة: العضو يبحث في الفهرس ويستعير الكتب ويرجعها، وأمين المكتبة يدير الكتب والأعضاء. استعارة الكتاب تتضمن التحقق من العضوية.' },
      { label: 'مخطط السياق', text: 'مخطط سياق لنظام إدارة مشاريع الطلاب: الطالب يرسل بيانات المشروع ويستلم تقارير التغذية الراجعة، والمشرف يرسل الملاحظات ويستلم تقارير التقدم، والمسؤول يدير حسابات المستخدمين ويستلم إحصاءات الاستخدام.' },
      { label: 'تسلسل تسجيل الدخول', text: 'مخطط تسلسل: يفتح المستخدم تطبيق الجوال، فيرسل التطبيق طلب تسجيل الدخول إلى الخادم، ويتحقق الخادم من قاعدة البيانات ثم يعيد رمز الدخول إلى التطبيق.' },
      { label: 'فئات المدرسة', text: 'مخطط فئات لنظام مدرسة: الشخص له اسم وبريد إلكتروني. الطالب والمعلم يرثان من الشخص. المعلم يدرّس عدة مقررات، والمقرر فيه عدة طلاب.' },
      { label: 'كيانات المتجر', text: 'مخطط كيانات وعلاقات لمتجر إلكتروني: العميل يقدّم عدة طلبات، والطلب يحتوي على عدة منتجات، وكل منتج ينتمي إلى تصنيف واحد.' },
      { label: 'معمارية من ثلاث طبقات', text: 'معمارية نظام من ثلاث طبقات: طبقة العرض (تطبيق ويب وتطبيق جوال)، وطبقة التطبيق (واجهة برمجية مع خدمة المصادقة ومنطق العمل)، وطبقة البيانات (قاعدة بيانات وتخزين ملفات).' },
    ],
    arrows: 'بداية -> إدخال اسم المستخدم وكلمة المرور\nإدخال اسم المستخدم وكلمة المرور -> هل البيانات صحيحة؟\nهل البيانات صحيحة؟ -> عرض لوحة التحكم : نعم\nهل البيانات صحيحة؟ -> عرض رسالة خطأ : لا\nعرض رسالة خطأ -> إدخال اسم المستخدم وكلمة المرور\nعرض لوحة التحكم -> نهاية',
    outline: 'نظام المكتبة\n  المستخدمون\n    الطلاب\n    الموظفون\n  الكتب\n    الفهرس\n    الاستعارة',
  },
}[lang === 'ar' ? 'ar' : 'en'];

const MERMAID_FLOW = 'flowchart TD\n  A([Start]) --> B[/Enter credentials/]\n  B --> C{Valid?}\n  C -->|Yes| D[Show dashboard]\n  C -->|No| E[Show error]\n  E --> B\n  D --> F([End])';
const MERMAID_SEQ = 'sequenceDiagram\n  participant U as User\n  participant A as Web App\n  participant D as Database\n  U->>A: login()\n  A->>D: find user\n  D-->>A: user record\n  A-)D: write audit log\n  A-->>U: show dashboard';
const MERMAID_CLASS = 'classDiagram\n  class Person {\n    +String name\n    +getName() String\n  }\n  Person <|-- Student\n  Person <|-- Teacher\n  Teacher "1" --> "*" Course : teaches';
const JSON_FLOW = JSON.stringify({
  type: 'flowchart', title: 'Login flow',
  nodes: [{ id: 'n1', label: 'Start', kind: 'start' }, { id: 'n2', label: 'Enter credentials', kind: 'io' }, { id: 'n3', label: 'Credentials valid?', kind: 'decision' }, { id: 'n4', label: 'Show dashboard' }, { id: 'n5', label: 'Show error' }, { id: 'n6', label: 'End', kind: 'end' }],
  edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4', label: 'Yes' }, { from: 'n3', to: 'n5', label: 'No' }, { from: 'n5', to: 'n2' }, { from: 'n4', to: 'n6' }],
}, null, 2);
const JSON_SEQ = JSON.stringify({
  type: 'sequence', title: 'Login sequence', participants: ['User', 'Web App', 'Database'],
  messages: [{ from: 'User', to: 'Web App', label: 'login()' }, { from: 'Web App', to: 'Database', label: 'find user' }, { from: 'Database', to: 'Web App', label: 'user record', reply: true }, { from: 'Web App', to: 'Database', label: 'write audit log', async: true }, { from: 'Web App', to: 'User', label: 'dashboard', reply: true }],
}, null, 2);

/** Thumbnail that is never blown up more than 1.5× (a single shape should not fill the whole preview). */
function previewSVG(diagram) {
  const b = computeBounds(diagram);
  const svg = renderThumbnail(diagram);
  if (b.empty) return svg;
  return svg.replace('<svg ', `<svg style="max-width:${Math.round((b.w + 32) * 1.5)}px;max-height:${Math.round((b.h + 32) * 1.5)}px" `);
}

const shapesConnectors = (s, c) => (isRTL ? t('Shapes: {shapes} · Connectors: {connectors}', { shapes: s, connectors: c }) : `${s} shapes · ${c} connectors`);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

const TAB_ORDER = ['ai', 'image', 'text', 'json'];
const AI_TABS = new Set(['ai', 'image']);

export function openGenerateDialog({ project, mode = 'insert', hasContent = false, tab: startTab = 'ai' } = {}) {
  const fonts = figureFonts(project);
  const inputs = { ai: '', text: '', json: '', note: '' };
  const results = { ai: null, image: null, text: null, json: null };
  let picture = null; // { src, width, height, name } for the "From image" tab
  let tab = startTab;
  let type = 'auto';
  let insertMode = hasContent ? 'add' : 'replace';
  let busy = false;
  let controller = null;
  let outcome = null;
  const timers = {};
  const settingsHref = project?.id ? href(project.id, 'settings', null, { tab: 'ai' }) : '#/projects';

  const typeOptions = `<option value="auto">${t('Auto (let the text decide)')}</option>${figureTypes().filter((ft) => SPEC_TYPES.includes(ft.id)).map((ft) => `<option value="${ft.id}">${esc(ft.name)}</option>`).join('')}`;
  const chips = (list) => `<div class="gen-chips" role="group" aria-label="${t('Examples')}"><span class="gen-chips-label">${t('Examples')}</span>${list.map((x, i) => `<button type="button" class="gen-chip" data-example="${i}"${AUTO}>${esc(x.label)}</button>`).join('')}</div>`;

  const textExamples = [
    { label: t('Arrow list'), text: EXAMPLES.arrows },
    { label: t('Indented outline'), text: EXAMPLES.outline },
    { label: t('Mermaid flowchart'), text: MERMAID_FLOW },
    { label: t('Mermaid sequence'), text: MERMAID_SEQ },
    { label: t('Mermaid class diagram'), text: MERMAID_CLASS },
  ];
  const jsonExamples = [{ label: t('Flowchart'), text: JSON_FLOW }, { label: t('Sequence Diagram'), text: JSON_SEQ }];
  const examplesOf = { ai: EXAMPLES.ai, text: textExamples, json: jsonExamples };
  const keyStatus = '<div data-key-status></div>';
  const aiButtons = (act) => `
            <div class="gen-actions">
              <button type="button" class="btn btn-primary" data-act="${act}">${icon(act === 'convert' ? 'wand' : 'sparkles', 'icon-sm')}<span data-generate-label>${act === 'convert' ? t('Convert with AI') : t('Generate with AI')}</span></button>
              <button type="button" class="btn btn-ghost" data-act="stop" hidden>${t('Stop')}</button>
              <button type="button" class="btn" data-act="${act === 'convert' ? 'copy-image-prompt' : 'copy-prompt'}">${icon('copy', 'icon-sm')}${t('Copy prompt for ChatGPT / Claude')}</button>
            </div>`;

  const body = `
    <div class="gen">
      <div class="tabs gen-tabs" role="tablist" aria-label="${t('How to describe the diagram')}">
        <button type="button" class="tab" role="tab" data-tab="ai" id="gen-tab-ai">${icon('sparkles', 'icon-sm')}${t('Describe with AI')}</button>
        <button type="button" class="tab" role="tab" data-tab="image" id="gen-tab-image">${icon('image', 'icon-sm')}${t('From image')}</button>
        <button type="button" class="tab" role="tab" data-tab="text" id="gen-tab-text">${icon('type', 'icon-sm')}${t('Text or Mermaid')}</button>
        <button type="button" class="tab" role="tab" data-tab="json" id="gen-tab-json">${icon('fileText', 'icon-sm')}${t('Paste JSON')}</button>
      </div>
      <div class="gen-body">
        <div class="gen-input">
          <div class="field gen-type"><label for="gen-type">${t('Diagram type')}</label><select id="gen-type" class="select" data-type>${typeOptions}</select></div>

          <section class="gen-panel" data-panel="ai" role="tabpanel" aria-labelledby="gen-tab-ai">
            <div class="field"><label for="gen-ai">${t('Describe the diagram')}</label>
              <textarea id="gen-ai" class="textarea gen-textarea" rows="7" data-input="ai"${AUTO} placeholder="${esc(t('For example: a login flowchart — the user enters a username and password; if the credentials are valid show the dashboard, otherwise show an error and try again. Arabic or English.'))}"></textarea></div>
            ${chips(EXAMPLES.ai)}
            ${keyStatus}
            ${aiButtons('generate')}
            <p class="hint gen-hint">${t('No API key? Copy the prompt, paste it into ChatGPT or Claude, then paste the JSON answer in the “Paste JSON” tab.')} <button type="button" class="gen-link" data-act="goto-json">${t('Open “Paste JSON”')}</button></p>
          </section>

          <section class="gen-panel" data-panel="image" role="tabpanel" aria-labelledby="gen-tab-image" hidden>
            <div class="field"><label>${t('Picture of the diagram')}</label>
              <div class="gen-drop" data-drop tabindex="0" role="button" aria-label="${esc(t('Choose a picture of the diagram'))}"></div></div>
            <div class="field"><label for="gen-note">${t('Notes for the AI (optional)')}</label>
              <textarea id="gen-note" class="textarea" rows="2" data-note${AUTO} placeholder="${esc(t('For example: it is a use case diagram; ignore the handwritten notes at the bottom.'))}"></textarea></div>
            ${keyStatus}
            ${aiButtons('convert')}
            <p class="hint gen-hint">${t('No API key? Copy the prompt, open ChatGPT or Claude, attach the picture and paste the prompt, then paste the JSON answer in the “Paste JSON” tab.')} <button type="button" class="gen-link" data-act="goto-json">${t('Open “Paste JSON”')}</button></p>
          </section>

          <section class="gen-panel" data-panel="text" role="tabpanel" aria-labelledby="gen-tab-text" hidden>
            <div class="field"><label for="gen-text">${t('Text or Mermaid code')}</label>
              <textarea id="gen-text" class="textarea gen-textarea mono" rows="10" data-input="text" spellcheck="false" dir="auto" placeholder="${esc('Start -> Login\nLogin -> Valid? \nValid? -> Dashboard : Yes\nValid? -> Error : No')}"></textarea></div>
            <div class="gen-detected" data-detected aria-live="polite"></div>
            ${chips(textExamples)}
            <p class="hint gen-hint">${t('One connection per line (A -> B : label), an indented outline for a tree, or Mermaid code. A name ending in “?” becomes a decision.')}</p>
          </section>

          <section class="gen-panel" data-panel="json" role="tabpanel" aria-labelledby="gen-tab-json" hidden>
            <div class="field"><label for="gen-json">${t('Diagram JSON')}</label>
              <textarea id="gen-json" class="textarea gen-textarea mono" rows="12" data-input="json" spellcheck="false" dir="ltr" placeholder='{ "type": "flowchart", "nodes": [ … ], "edges": [ … ] }'></textarea></div>
            ${chips(jsonExamples)}
            <p class="hint gen-hint">${t('Paste the JSON answer from ChatGPT or Claude. Extra text around it and code fences are fine.')}</p>
          </section>
        </div>

        <div class="gen-side">
          <div class="section-title">${t('Preview')}</div>
          <div class="gen-preview" data-gen-preview></div>
          <div class="gen-meta" data-meta></div>
          <div data-messages class="gen-messages"></div>
          <button type="button" class="gen-link" data-act="edit-json" hidden>${t('Edit as JSON')}</button>
        </div>
      </div>
    </div>`;

  const insertChoice = mode === 'insert'
    ? `<div class="left"><div class="segmented gen-insert" role="group" aria-label="${t('Where to put the diagram')}">
        <button type="button" data-insert="replace">${t('Replace diagram')}</button>
        <button type="button" data-insert="add">${t('Add to canvas')}</button></div></div>` : '';

  return new Promise((resolve) => {
    const modal = openModal({
      title: t('Generate a diagram'),
      subtitle: t('Describe it, type it or paste it — then check the preview before using it.'),
      size: 'xl',
      className: 'gen-modal',
      body,
      footer: `${insertChoice}<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="button" class="btn btn-primary" data-act="apply" disabled>${icon('check', 'icon-sm')}${mode === 'insert' ? t('Insert diagram') : t('Use this diagram')}</button>`,
      onClose: () => { controller?.abort(); Object.values(timers).forEach(clearTimeout); resolve(outcome); },
    });
    const root = modal.root;
    const $ = (sel) => root.querySelector(sel);
    const applyBtn = $('[data-act="apply"]');

    // ------------------------------------------------------------ rendering
    function renderKeyStatus() {
      const cfg = getAIConfig();
      const html = cfg.apiKey
        ? `<div class="gen-key ok">${icon('checkCircle', 'icon-sm')}<span>${t('Using {model}. Your key stays in this browser.', { model: `<bdi>${esc(modelName(cfg.model))}</bdi>` })}</span></div>`
        : `<div class="callout callout-info gen-key-missing">${icon('info')}<div>${t('No API key yet. Add yours in Settings → AI to generate directly, or copy the prompt and use any chatbot.')} <a class="gen-link" href="${settingsHref}">${t('Open Settings')}</a></div></div>`;
      root.querySelectorAll('[data-key-status]').forEach((el) => { el.innerHTML = html; });
    }

    function renderDrop() {
      const drop = $('[data-drop]');
      drop.classList.toggle('has-image', !!picture);
      drop.innerHTML = picture
        ? `<img src="${picture.src}" alt=""><div class="gen-drop-bar"><span class="truncate"${AUTO}>${esc(picture.name || t('Pasted picture'))}</span><span class="gen-link">${t('Change picture')}</span></div>`
        : `${icon('upload')}<strong>${t('Choose a picture of the diagram')}</strong><span>${t('A screenshot, scan, photo or hand drawing — drop it here or paste it with Ctrl+V')}</span>`;
    }

    function render() {
      root.querySelectorAll('[data-tab]').forEach((b) => { const on_ = b.dataset.tab === tab; b.classList.toggle('active', on_); b.setAttribute('aria-selected', on_); b.tabIndex = on_ ? 0 : -1; });
      root.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
      root.querySelectorAll('[data-insert]').forEach((b) => { const on_ = b.dataset.insert === insertMode; b.classList.toggle('active', on_); b.setAttribute('aria-pressed', on_); });
      const r = results[tab];
      const preview = $('[data-gen-preview]');
      preview.innerHTML = r?.ok ? previewSVG(r.diagram) : `<div class="gen-empty">${icon(tab === 'ai' ? 'sparkles' : tab === 'image' ? 'image' : 'diagram')}<span>${busy ? (tab === 'image' ? t('Claude is reading the picture…') : t('Asking Claude…')) : t('The preview appears here.')}</span></div>`;
      preview.classList.toggle('busy', busy);
      const n = r?.ok ? r.diagram.elements : [];
      $('[data-meta]').textContent = r?.ok ? shapesConnectors(n.filter((e) => e.type === 'node').length, n.filter((e) => e.type === 'edge').length) : '';
      const msgs = [];
      if (r && !r.ok) msgs.push(`<div class="callout callout-danger" role="alert">${icon('alert')}<div>${r.errors.map((e) => `<div${AUTO}>${esc(e)}</div>`).join('')}</div></div>`);
      if (r?.ok && r.warnings?.length) msgs.push(`<div class="callout callout-warning">${icon('info')}<div>${r.warnings.slice(0, 5).map((e) => `<div${AUTO}>${esc(e)}</div>`).join('')}${r.warnings.length > 5 ? `<div>${t('…and {n} more notes', { n: r.warnings.length - 5 })}</div>` : ''}</div></div>`);
      $('[data-messages]').innerHTML = msgs.join('');
      root.querySelector('[data-act="edit-json"]').hidden = !(AI_TABS.has(tab) && r?.ok);
      const detected = $('[data-detected]');
      detected.textContent = tab === 'text' && r?.ok && r.format ? t('Detected: {format}', { format: formatName(r.format) }) : '';
      applyBtn.disabled = !r?.ok || busy;
      for (const act of ['generate', 'convert']) $(`[data-act="${act}"]`).disabled = busy;
      root.querySelectorAll('[data-act="stop"]').forEach((b) => { b.hidden = !busy; });
      root.querySelectorAll('[data-generate-label]').forEach((el) => {
        const convert = !!el.closest('[data-act="convert"]');
        el.textContent = busy ? (convert ? t('Reading the picture…') : t('Generating…')) : (convert ? t('Convert with AI') : t('Generate with AI'));
      });
    }

    const formatName = (f) => ({ arrows: t('Arrow list'), outline: t('Indented outline'), mermaid: t('Mermaid'), steps: t('List of steps') }[f] || f);

    // ------------------------------------------------------------ computing results
    function compute(which) {
      const text = inputs[which];
      if (!text.trim()) { results[which] = null; return; }
      const forced = type === 'auto' ? undefined : type;
      try {
        let built;
        if (which === 'text') {
          const parsed = parseText(text, { type });
          built = buildDiagramFromSpec(parsed.spec, { ...fonts, type: forced });
          built.warnings = [...parsed.warnings, ...built.warnings];
          built.format = parsed.format;
        } else built = buildDiagramFromSpec(text, { ...fonts, type: forced });
        results[which] = { ok: true, ...built };
      } catch (err) {
        results[which] = { ok: false, errors: err instanceof SpecError ? err.messages : [t('Something went wrong'), String(err?.message || err)] };
        if (!(err instanceof SpecError)) console.error(err);
      }
    }
    function schedule(which) {
      clearTimeout(timers[which]);
      timers[which] = setTimeout(() => { compute(which); if (tab === which) render(); }, 220);
    }

    // ------------------------------------------------------------ AI
    async function runAI() {
      if (busy) return;
      const description = inputs.ai.trim();
      if (!description) { toast(t('Describe the diagram first.'), { type: 'info' }); $('[data-input="ai"]').focus(); return; }
      const cfg = getAIConfig();
      if (!cfg.apiKey) {
        toast(t('No API key yet. Add yours in Settings → AI, or use “Copy prompt” with ChatGPT or Claude.'), { type: 'error', title: t('AI generation failed'), duration: 7000 });
        renderKeyStatus();
        return;
      }
      busy = true; controller = new AbortController(); results.ai = null; render();
      try {
        const { spec } = await generateSpec(description, { type, config: cfg, signal: controller.signal });
        const built = buildDiagramFromSpec(spec, { ...fonts, type: type === 'auto' ? undefined : type });
        results.ai = { ok: true, ...built, description };
        inputs.json = JSON.stringify(compactSpec(built.spec), null, 2);
        results.json = null;
      } catch (err) {
        if (err instanceof AIError && err.code === 'aborted') results.ai = null;
        else {
          const messages = err instanceof SpecError ? [t('Claude returned a diagram that could not be drawn:'), ...err.messages] : [err.message];
          results.ai = { ok: false, errors: messages };
          if (!(err instanceof AIError) && !(err instanceof SpecError)) console.error(err);
          toast(messages[messages.length > 1 ? 1 : 0], { type: 'error', title: t('AI generation failed'), duration: 7000 });
        }
      } finally {
        busy = false; controller = null;
        if (root.isConnected) render();
      }
    }

    async function runImage() {
      if (busy) return;
      if (!picture) { toast(t('Choose a picture of the diagram first.'), { type: 'info' }); return; }
      const cfg = getAIConfig();
      if (!cfg.apiKey) {
        toast(t('No API key yet. Add yours in Settings → AI, or use “Copy prompt” with ChatGPT or Claude.'), { type: 'error', title: t('AI generation failed'), duration: 7000 });
        renderKeyStatus();
        return;
      }
      busy = true; controller = new AbortController(); results.image = null; render();
      try {
        const { spec } = await generateSpecFromImage(picture.src, { type, note: inputs.note, config: cfg, signal: controller.signal });
        const built = buildDiagramFromSpec(spec, { ...fonts, type: type === 'auto' ? undefined : type });
        results.image = { ok: true, ...built, description: titleFromFileName(picture.name) };
        inputs.json = JSON.stringify(compactSpec(built.spec), null, 2);
        results.json = null;
      } catch (err) {
        if (err instanceof AIError && err.code === 'aborted') results.image = null;
        else {
          const messages = err instanceof SpecError ? [t('Claude returned a diagram that could not be drawn:'), ...err.messages] : [err.message];
          results.image = { ok: false, errors: messages };
          if (!(err instanceof AIError) && !(err instanceof SpecError)) console.error(err);
          toast(messages[messages.length > 1 ? 1 : 0], { type: 'error', title: t('AI generation failed'), duration: 7000 });
        }
      } finally {
        busy = false; controller = null;
        if (root.isConnected) render();
      }
    }

    async function usePicture(file) {
      if (!file) return;
      if (!isImageFile(file)) { toast(t('Choose an image file (PNG, JPG, WebP, GIF or SVG).'), { type: 'warning' }); return; }
      try {
        picture = await imageFromFile(file);
        if (!picture.name) picture.name = file.name || '';
        results.image = null;
        renderDrop(); render();
      } catch (err) { toast(err.message || t('Could not read the image'), { type: 'error' }); }
    }

    // ------------------------------------------------------------ actions
    function apply() {
      const r = results[tab];
      if (!r?.ok) return;
      outcome = {
        diagram: r.diagram, spec: r.spec, type: figureTypeOf(r.spec.type), mode: insertMode,
        title: suggestTitle(r.spec, r.description || ''),
      };
      modal.close();
    }

    const actions = {
      generate: runAI,
      convert: runImage,
      stop: () => controller?.abort(),
      apply,
      async 'copy-prompt'() {
        const ok = await copyText(buildChatPrompt(inputs.ai, type));
        if (ok) toast(t('Prompt copied — paste it into ChatGPT or Claude, then paste the JSON answer in the “Paste JSON” tab.'), { type: 'success', duration: 6000 });
        else toast(t('Could not copy to the clipboard.'), { type: 'error' });
      },
      async 'copy-image-prompt'() {
        const ok = await copyText(buildImageChatPrompt(type, inputs.note));
        if (ok) toast(t('Prompt copied — attach the picture in ChatGPT or Claude, paste the prompt, then paste the JSON answer in the “Paste JSON” tab.'), { type: 'success', duration: 7000 });
        else toast(t('Could not copy to the clipboard.'), { type: 'error' });
      },
      'goto-json': () => switchTab('json'),
      'edit-json': () => switchTab('json'),
    };

    function switchTab(next) {
      tab = next;
      const area = $(`[data-input="${next}"]`);
      if (area && area.value !== inputs[next]) area.value = inputs[next];
      if (!AI_TABS.has(next) && inputs[next].trim() && !results[next]) compute(next);
      render();
      (area || $('[data-drop]'))?.focus();
    }

    root.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
      if (e.target.closest('[data-drop]')) { pickFile(IMAGE_ACCEPT).then(usePicture); return; }
      const ins = e.target.closest('[data-insert]');
      if (ins) { insertMode = ins.dataset.insert; render(); return; }
      const ex = e.target.closest('[data-example]');
      if (ex) {
        const sample = examplesOf[tab][Number(ex.dataset.example)];
        inputs[tab] = sample.text;
        const area = $(`[data-input="${tab}"]`);
        area.value = sample.text;
        if (!AI_TABS.has(tab)) compute(tab); else results.ai = null;
        render();
        area.focus();
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act && actions[act.dataset.act]) actions[act.dataset.act]();
    });
    root.addEventListener('input', (e) => {
      if (e.target.matches('[data-note]')) { inputs.note = e.target.value; return; }
      const area = e.target.closest('[data-input]');
      if (area) {
        const which = area.dataset.input;
        inputs[which] = area.value;
        if (which !== 'ai') schedule(which); // the AI result stays on screen until the next generation
        return;
      }
    });
    root.addEventListener('change', (e) => {
      if (!e.target.matches('[data-type]')) return;
      type = e.target.value;
      for (const which of ['text', 'json']) if (inputs[which].trim()) compute(which);
      if (results.ai?.ok) { try { results.ai = { ...results.ai, ...buildDiagramFromSpec(results.ai.spec, { ...fonts, type: type === 'auto' ? undefined : type }) }; } catch { /* keep the old preview */ } }
      render();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('[data-input]')) {
        e.preventDefault();
        if (tab === 'ai') runAI(); else apply();
      }
      if (e.target.matches('[data-drop]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickFile(IMAGE_ACCEPT).then(usePicture); }
      if (e.target.matches('[data-tab]') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const order = TAB_ORDER;
        const step = (e.key === 'ArrowRight') === !isRTL ? 1 : -1;
        switchTab(order[(order.indexOf(tab) + step + order.length) % order.length]);
        $(`[data-tab="${tab}"]`).focus();
      }
    });

    // A picture can also be pasted (Ctrl+V) anywhere in the dialog, or dropped on the drop zone.
    root.addEventListener('paste', (e) => {
      const file = [...(e.clipboardData?.files || [])].find(isImageFile);
      if (!file) return;
      e.preventDefault();
      if (tab !== 'image') switchTab('image');
      usePicture(file);
    });
    const drop = $('[data-drop]');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      usePicture([...(e.dataTransfer?.files || [])].find(isImageFile) || e.dataTransfer?.files?.[0]);
    });

    renderKeyStatus();
    renderDrop();
    render();
    requestAnimationFrame(() => ($(`[data-input="${tab}"]`) || $('[data-drop]'))?.focus());
  });
}
