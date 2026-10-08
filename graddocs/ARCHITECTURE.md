# GradDocs — Architecture

Zero-dependency, ES-module web app (HTML/CSS/JS). No build step. Run with `node serve.mjs` (or any static server) and open http://localhost:5173.

## Layers

```
index.html → src/main.js
  app/      shell (sidebar, topbar, router), routes, command palette (Ctrl+K), search, shortcuts, prefs
  core/     store (state + autosave), model (factories/normalisation), numbering (derived numbers),
            references (cross-reference tokens), document (linear doc model), bibliography (reference
            formatting + BibTeX), presets (university report templates), utils, events
  storage/  adapters (localStorage, IndexedDB) + ProjectRepository (the only persistence API)
  ui/       dom helpers, icons, modal/confirm/prompt/form dialogs, toast, menu, tooltip
  figures/  diagram engine (shapes, geometry, text layout, render), templates, types registry,
            diff + versions, figures list view, editor/ (canvas, panels)
  tables/   tables list, table editor, templates, table renderers (HTML/SVG)
  structure/ project structure (outline) view, chapters (writing) view
  acronyms/ acronyms manager + automatic detection
  bibliography/ References page (#/p/<id>/references), reference dialog, BibTeX import
  preview/  Word-like paginated preview
  export/   zip/png/pdf (vector: pdf-vector.js + pdf-fonts.js)/docx writers + export view
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
dashboard, structure, word, chapters, figures, tables, acronyms, references, preview, export, settings.
`figures/<id>` opens the figure editor, `gantt/<id>` the Gantt editor (gantt figures redirect there), `tables/<id>` the table editor. Build links with `ctx.href('tables', id)`.
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
Project { id, name, description, type, university, college, department, supervisor, coSupervisor, students, academicYear,
          submissionDate, degreeStatement, logo (university, data URL), projectLogo (data URL), preset?, inbox?,
          createdAt, updatedAt, frontMatter[], chapters[], figures[], tables[], acronyms[], references[], settings, activity[],
          dismissedSuggestions[] }
FrontMatter { id, kind: declaration|acknowledgements|abstract|toc|lot|lof|loa|custom, title, include, body,
              hint?, wordLimit? (abstract: 150), signatures? + signatureNote? (declaration signature lines) }
Chapter  { id, title, body, numbered (false = CONCLUSIONS-style unnumbered chapter), hint?, sections: Section[] }
Section  { id, title, body, status: todo|draft|review|done, hint?, sections: Section[] }   // nested (1.4 → 1.4.2 → 1.4.2.1)
Figure   { id, title, type, chapterId, sectionId, description, diagram, versions[], comments[], imagePool?, gantt?, createdAt, updatedAt }
Table    { id, title, chapterId, sectionId, description, template, columns: [{ id, width(%) }],
           rows: Cell[][] (rows[0..headerRows-1] are header rows), headerRows,
           style: { headerFill, headerTextColor, fontSize, zebra, borders: 'all'|'horizontal' }, versions[], createdAt, updatedAt }
Cell     { text, align?: left|center|right, bold?, italic?, colspan?, rowspan?, hidden? (covered by a merge) }
Acronym  { id, acronym, meaning, description, createdAt }
Reference { id, type: journal|conference|book|chapter|web|thesis|report|other, authors (one per line), title, container,
            editors, publisher, place, year, month, volume, issue, pages, edition, doi, url, accessed, note,
            custom (verbatim text that replaces the formatted entry), source? ('word' = imported by Word Sync) }
```

`hint` is writing guidance from a report template, shown while a body is empty and never exported.
Version snapshots keep image data once per figure: their image `src` is `pool:<key>` into `figure.imagePool`;
read them with `versionSnapshot(figure, version)` (figures/versions.js).

Factories: `createProject, createChapter, createSection, createFigure, createTable, createCell, createAcronym, createReference, createComment, createFrontMatterItem`.
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
  figureOrder: Figure[], tableOrder: Table[],      // document order
  references: Map(id → { index, number, label: '[3]', cited }), referenceOrder: Reference[] }
```

Unnumbered chapters get number '' and label = their title, don't use up a chapter number, and their sections are
unnumbered too. Reference numbers follow `settings.references.order`: 'citation' (first citation in the text, then
never-cited ones), 'alphabetical' (first author) or 'manual' (list order).

Document order = chapter order → section order (depth-first) → array order within a section. Unassigned items come last.
Helpers: `captionText(project, 'figure'|'table', item)`, `chapterHeading(project, chapter)`,
`moveInDocumentOrder(project, 'figures'|'tables', id, ±1)`, `locationLabel(project, chapterId, sectionId)`.

## Cross references (core/references.js)

Bodies store `{{ref:fig:<id>}}`, `{{ref:tab:<id>}}`, `{{ref:sec:<id>}}`, `{{ref:ch:<id>}}` tokens, resolved at render time.
Citations are the same kind of token: `{{ref:cite:<referenceId>}}` → "[3]" (a deleted reference shows "[?]").
`makeRef(kind, id)`, `refInfo(project, kind, id) → { text, ok, title }`, `resolveText`, `resolveHTML(project, body, { chipClass, editable })`,
`parseBlocks(body) → [{ type: 'p'|'li', text }]` (one paragraph per line; lines starting with "- " are bullets),
`findPlainReferences`, `linkPlainReferences(project, body) → { body, count }`, `findBrokenReferences`, `findUsages`.

### Placing figures/tables inside text

A body line containing only `{{figure:<id>}}` or `{{table:<id>}}` places that item at that exact spot.
Numbering follows the real order: inside a body, placed items come in line order, then unplaced items of that
section. A placement wins over the item's `chapterId`/`sectionId` (first placement counts; missing/duplicate ones
are reported by `findBrokenPlacements`). Helpers in references.js: `makePlacement`, `placementsIn`,
`insertPlacement`, `removePlacements`, `clearPlacement(project, kind, id)` (call it when an item moves or is deleted).
`parseBlocks` returns `{ type: 'figure'|'table', id }` blocks for placement lines.

## Document model (core/document.js)

`buildDocument(project)` → `{ titlePage, front[], toc[], figures[], tables[], acronyms[], body[], references }` — the single
source for Document Preview and the Word export. Body blocks: chapter, heading, paragraph, bullet, figure, table.
TOC entries have kind front|chapter|section|references; `references.entries` are formatted runs ([{ text, italic }])
for the References page after the last chapter. `titlePage.layout` is 'classic' or 'submission' (university cover).

## Bibliography & report templates

`core/bibliography.js`: `REFERENCE_TYPES`, `formatReference(ref, 'ieee'|'compact')`, `formatReferenceRuns`,
`parseNames`, `parseBibTeX`, `findDuplicateReference`, `referenceShortLabel`. Pure functions.

`core/presets.js`: `PRESETS` (currently `uqu-swe-gp1`: Umm Al-Qura University, SWE Graduation Project 1 — front matter,
4 chapters with hints, unnumbered Conclusions, References, and the measured formatting), `presetProjectFields(id, fields)`
for `store.createProject`, and for existing projects (inside `store.update`) `applyPresetFormatting(project, id)` and
`mergePresetStructure(project, id)` — both add and rename but never delete or reorder the user's chapters.

## Word Sync (src/word/)

Word → GradDocs only; the user's .docx is never written. `docx-reader.js` (ZIP + DecompressionStream, DOMParser) →
`docx-parse.js` (headings, front matter, captions, tables, pictures, acronyms) → `plan.js` (change set against the project;
diagrams made in GradDocs are only linked, never replaced) → `review-dialog.js` → apply in one `store.update` after
`store.createBackup('Before Word sync')`. Link state lives in `project.wordLink` (fileName, lastModified, autoSync, history,
map, hashes). `watcher.js` (started in main.js) polls the File System Access handle (stored in IndexedDB `graddocs-word`)
every 3 s and auto-applies safe changes; other browsers fall back to picking the file again.

Report templates: a REFERENCES / BIBLIOGRAPHY heading is never a chapter — its entries become `project.references`
(`type: 'other'`, `custom` = the Word text, `source: 'word'`; only those are ever updated or removed, matched via
`wordLink.hashes.refs`), and the first import sets `settings.references.order = 'manual'` so numbers match Word.
In-text `[n]`, `[1], [2]`, `[1]–[3]` become `{{ref:cite:id}}` tokens (`refs.js`). Closing chapters after the numbered
ones (CONCLUSIONS, SUMMARY, FUTURE WORK …) come in with `numbered: false` (`wordLink.hashes.numbered`).

## Diagram generation & auto-layout

- `figures/layout.js`: `autoLayout(diagram, { mode: 'layered'|'tree'|'auto', direction: 'TB'|'LR', ids })` — layered (Sugiyama-style) or tidy-tree layout, undoable when called through `editor.mutate`.
- `figures/generate/`: `spec.js` (JSON diagram spec, validation, AI prompt), `to-diagram.js` (`specToDiagram`), `text-parse.js` (arrow lists, indented outlines, Mermaid subset), `ai.js` (Claude Messages API, browser-direct; key in `prefs.get('ai')`, never stored in projects), `generate-dialog.js`.
- `types.js` also exports `figureFonts(project)`.


From a picture: `generateSpecFromImage(dataURL, { type, note })` (ai.js) sends the image as a base64 `image` content block
with `IMAGE_TASK` (spec.js) and the same structured-output schema; without a key `buildImageChatPrompt(type, note)` gives the
prompt to paste next to the picture in any chatbot. The dialog's "From image" tab reads files, drops and Ctrl+V pastes
through `imageFromFile` (editor/image-import.js), so SVGs are rasterised and large pictures downscaled before sending.
## Rendering APIs

- `figures/render.js`: `renderFigureSVG(figureOrDiagram, { padding, background }) → { svg, width, height }` (standalone SVG string),
  `renderThumbnail(figureOrDiagram) → svg markup that scales to its container`.
- `tables/table-render.js`: `renderTableHTML(project, table, opts) → string`, `renderTableSVG(project, table, opts) → { svg, width, height }`.
- `export/png.js`: `svgToPngBlob(svg, width, height, { scale, dpi })`.
- `export/pdf.js`: `svgToPdfBlob(svg, width, height, { title })` → vector PDF (selectable text; falls back to raster only on failure).

## UI kit

- `ui/dom.js`: `esc, $, $$, h, on, Disposer, highlight, flash, fromHTML`
- `ui/icons.js`: `icon(name, cls)` → inline SVG string (see names in the file)
- `ui/modal.js`: `openModal({ title, subtitle, size: 'sm'|'lg'|'xl', body, footer, onMount, onClose })`, `confirmDialog`, `promptDialog`, `formDialog({ fields })`, `closeAllModals()`.
  Note: `body`/`footer` strings and `confirmDialog({ message })` are HTML — escape user text with `esc()`.
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

## Gantt charts (src/figures/gantt/)

A figure of type `gantt` keeps its schedule as data in `figure.gantt` (`{ tasks: [{ id, name, start, end, level }],
weekStart, color, showIdle, showWbs, showDates }`) and `figure.diagram` is **always rebuilt** from it with
`ganttDiagram(gantt, figureFonts(project))` (gantt-model.js) after every edit, so previews and exports see an ordinary
diagram. A task followed by deeper ones is a phase spanning its sub-tasks; WBS numbers and grey "no work" weeks are
derived. gantt-editor.js is the table editor (paste from Excel, undo/redo); gantt-ops.js holds the pure row operations.

## Updates from Claude (src/inbox/)

The site reads `graddocs/inbox/inbox.json` from the repository (raw.githubusercontent.com, see inbox/README.md for the
schema) when a project opens and every 10 minutes, matches items to the project by name, and offers them in a review
dialog (top-bar pill, dashboard card). Applying sets `project.projectLogo` or adds/updates a figure by id (gantt items
get their diagram generated); `project.inbox = { applied, dismissed }` remembers what was handled. Input is untrusted:
inbox.js validates items and only accepts data:/https: images.
