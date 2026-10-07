# GradDocs — Architecture

Zero-dependency, ES-module web app (HTML/CSS/JS). No build step. Run with `node serve.mjs` (or any static server) and open http://localhost:5173.

## Layers

```
index.html → src/main.js
  app/      shell (sidebar, topbar, router), routes, command palette (Ctrl+K), search, shortcuts, prefs
  core/     store (state + autosave), model (factories/normalisation), numbering (derived numbers),
            references (cross-reference tokens), document (linear doc model), utils, events
  storage/  adapters (localStorage, IndexedDB) + ProjectRepository (the only persistence API)
  ui/       dom helpers, icons, modal/confirm/prompt/form dialogs, toast, menu, tooltip
  figures/  diagram engine (shapes, geometry, text layout, render), templates, types registry,
            diff + versions, figures list view, editor/ (canvas, panels)
  tables/   tables list, table editor, templates, table renderers (HTML/SVG)
  structure/ project structure (outline) view, chapters (writing) view
  acronyms/ acronyms manager + automatic detection
  preview/  Word-like paginated preview
  export/   zip/png/pdf/docx writers + export view
  projects/ dashboard/ settings/  — remaining views
```

## View contract

Each route lazily imports a module whose default export is:

```js
export default {
  title: 'Figures',            // or () => string; used for breadcrumb + document.title
  layout: 'page',              // 'flush' = no scrolling page wrapper (editors)
  mount(container, ctx) {      // may be async
    // ctx = { store, project, params: { id, query }, shell, navigate(hash), href(section, itemId?, query?) }
    return { unmount() {} };   // clean up listeners
  },
};
```

Routes: `#/projects`, `#/p/<projectId>/<section>[/<itemId>][?query]` where section ∈
dashboard, structure, chapters, figures, tables, acronyms, preview, export, settings.
`figures/<id>` opens the figure editor, `tables/<id>` the table editor. Build links with `ctx.href('tables', id)`.
`ctx.shell.setBreadcrumbs([{ label, href? }])` sets the crumbs after the project name.

Views render with template strings (always escape user text with `esc()` from `ui/dom.js`) and wire
events with delegation (`on(root, 'click', '[data-action]', handler)`). Re-render on
`store.on('change', …)` and remove the listener in `unmount`.

## Store (core/store.js)

```js
store.project                     // the open project (mutable object)
store.update((p) => { … }, { activity: 'Added table X' })   // mutate + autosave + emit 'change'
store.on('change', ({ project, revision, source }) => …)     // returns unsubscribe fn
store.on('status', (s) => …)      // 'saving' | 'saved' | 'error'
await store.flush()               // persist now
store.projects                    // summaries of all projects; store.on('projects', …)
store.createProject(fields) / duplicateProject(id) / deleteProject(id) / saveImportedProject(data, { asCopy })
store.exportProjectData(id) / createBackup(reason) / restoreBackup(backup) / switchEngine('indexedDB'|'localStorage')
store.repo.listBackups(projectId) / store.repo.usage() / store.repo.engine
```

Never write to storage directly. Always mutate through `store.update` so numbering caches are invalidated and autosave runs.

## Data model (core/model.js)

```js
Project { id, name, description, type, university, college, department, supervisor, students, academicYear,
          createdAt, updatedAt, frontMatter[], chapters[], figures[], tables[], acronyms[], settings, activity[], dismissedSuggestions[] }
FrontMatter { id, kind: declaration|acknowledgements|abstract|toc|lot|lof|loa|custom, title, include, body }
Chapter  { id, title, body, sections: Section[] }
Section  { id, title, body, status: todo|draft|review|done, sections: Section[] }   // nested (1.4 → 1.4.2 → 1.4.2.1)
Figure   { id, title, type, chapterId, sectionId, description, diagram, versions[], comments[], createdAt, updatedAt }
Table    { id, title, chapterId, sectionId, description, template, columns: [{ id, width(%) }],
           rows: Cell[][] (rows[0..headerRows-1] are header rows), headerRows,
           style: { headerFill, headerTextColor, fontSize, zebra, borders: 'all'|'horizontal' }, versions[], createdAt, updatedAt }
Cell     { text, align?: left|center|right, bold?, italic?, colspan?, rowspan?, hidden? (covered by a merge) }
Acronym  { id, acronym, meaning, description, createdAt }
```

Factories: `createProject, createChapter, createSection, createFigure, createTable, createCell, createAcronym, createComment, createFrontMatterItem`.
Tree helpers: `walkSections(project, cb)`, `findNode(project, id)`, `findFigure`, `findTable`, `chapterOfSection`.
Constants: `DEFAULT_SETTINGS`, `SECTION_STATUSES`, `FRONT_MATTER_KINDS`.

## Numbering is derived (core/numbering.js)

Numbers are **never stored**. `getNumbering(project)` (cached per change) returns:

```js
{ chapters: Map(id → { index, number: '1', label: 'Chapter 1', title }),
  sections: Map(id → { number: '1.4.2', label: 'Section 1.4.2', depth, chapterId, parentId, title }),
  outline: [{ kind, id, number, depth, title, chapterId }],
  figures: Map(id → { index, number: '3', label: 'Figure 3', code: 'FIG-003', chapterId, sectionId, location }),
  tables:  Map(id → { … 'Table 2', 'TAB-002' … }),
  figureOrder: Figure[], tableOrder: Table[] }       // document order
```

Document order = chapter order → section order (depth-first) → array order within a section. Unassigned items come last.
Helpers: `captionText(project, 'figure'|'table', item)`, `chapterHeading(project, chapter)`,
`moveInDocumentOrder(project, 'figures'|'tables', id, ±1)`, `locationLabel(project, chapterId, sectionId)`.

## Cross references (core/references.js)

Bodies store `{{ref:fig:<id>}}`, `{{ref:tab:<id>}}`, `{{ref:sec:<id>}}`, `{{ref:ch:<id>}}` tokens, resolved at render time.
`makeRef(kind, id)`, `refInfo(project, kind, id) → { text, ok, title }`, `resolveText`, `resolveHTML(project, body, { chipClass, editable })`,
`parseBlocks(body) → [{ type: 'p'|'li', text }]` (one paragraph per line; lines starting with "- " are bullets),
`findPlainReferences`, `linkPlainReferences(project, body) → { body, count }`, `findBrokenReferences`, `findUsages`.

## Document model (core/document.js)

`buildDocument(project)` → `{ titlePage, front[], toc[], figures[], tables[], acronyms[], body[] }` — the single
source for Document Preview and the Word export. Body blocks: chapter, heading, paragraph, bullet, figure, table.

## Rendering APIs

- `figures/render.js`: `renderFigureSVG(figureOrDiagram, { padding, background }) → { svg, width, height }` (standalone SVG string),
  `renderThumbnail(figureOrDiagram) → svg markup that scales to its container`.
- `tables/table-render.js`: `renderTableHTML(project, table, opts) → string`, `renderTableSVG(project, table, opts) → { svg, width, height }`.
- `export/png.js`: `svgToPngBlob(svg, width, height, { scale, dpi })`.

## UI kit

- `ui/dom.js`: `esc, $, $$, h, on, Disposer, highlight, flash, fromHTML`
- `ui/icons.js`: `icon(name, cls)` → inline SVG string (see names in the file)
- `ui/modal.js`: `openModal({ title, subtitle, size: 'sm'|'lg'|'xl', body, footer, onMount, onClose })`, `confirmDialog`, `promptDialog`, `formDialog({ fields })`
- `ui/toast.js`: `toast(msg, { type: 'success'|'error'|'info'|'warning', action: { label, onClick } })`, `toastError(err, title)`
- `ui/menu.js`: `openMenu(anchorElOrPoint, items)` — items: `{ label, icon, shortcut, danger, disabled, onClick } | '-' | { heading }`
- Tooltips: any element with `data-tip="…"` (+ optional `data-kbd="Ctrl K"`).

CSS classes (styles/components.css): `.page .page-header .titles .subtitle .actions .btn .btn-primary .btn-ghost .btn-soft .btn-danger .btn-sm .btn-icon
.btn-group .card .card-header .card-body .card-footer .grid .grid-2/3/4 .list .list-item .list-group-title .badge(-primary/success/warning/danger/info)
.input .select .textarea .input-sm .field .field-row .form-grid .checkbox .switch .segmented .tabs .tab .empty-state .callout(-info/warning/danger/success)
.kv .progress .toolbar .input-group .data-table .thumb .ref-chip .section-title .muted .row .col .spacer .truncate`.
Design tokens live in styles/tokens.css (`var(--primary)`, `--surface`, `--border`, `--muted`, …) and support dark mode.

## Persistence

`storage/adapters.js` — `LocalStorageAdapter` (default) and `IndexedDBAdapter`, both key/value with the same async API.
`storage/repository.js` — `ProjectRepository` (projects, backups, meta). To move to Supabase/PostgreSQL implement the same
interface (see `storage/supabase-repository.example.js`) and pass it to `new Store(repo)` in `core/store.js`.
