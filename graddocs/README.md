# GradDocs — Graduation Project Documentation Builder

A web app for building and maintaining everything that repeats in a graduation project report: **figures/diagrams, tables, chapters & sections, acronyms**, plus the automatically generated **Table of Contents, List of Figures, List of Tables and List of Acronyms**.

Create a figure once, then change a label, add a box or remove a feature whenever your supervisor asks. You don't redraw anything in Draw.io. Every change is autosaved and versioned, numbering updates itself, and exports are ready for Microsoft Word.

> **بالعربي:** تطبيق ويب لإدارة الـ Figures والـ Tables والفصول والاختصارات في تقرير مشروع التخرج، مع ترقيم تلقائي وقوائم تتحدث تلقائيًا (TOC / List of Figures / List of Tables)، وحفظ تلقائي، وسجل نسخ للتعديلات، وتصدير جاهز لـ Word.

## Run it

No dependencies and no build step. ES modules need an HTTP server, so opening `index.html` directly with `file://` won't work.

```bash
cd graddocs
node serve.mjs            # → http://localhost:5173
# or: npm start  /  python3 -m http.server 5173  /  npx serve
```

On the first launch a demo project, **Meyar**, is created. Data lives in your browser (localStorage by default; IndexedDB can be enabled in Settings → Storage).

## Tests

```bash
node tests/unit.mjs     # numbering, cross references, acronym detection, diff/versions (no browser)
node tests/smoke.mjs    # real-browser end-to-end test (needs Playwright + Chromium)
npm test                # both
```

## Typical workflow

| Supervisor says… | You do… |
|---|---|
| "Change this label in Figure 3" | Figures → open → double-click the text → type → Enter. Autosaved. |
| "Add a feature to the diagram" | Drag a shape from **Elements**, then drag from its blue dot to connect it. Connectors stay attached when you move things. |
| "Show me what you changed" | Turn on **Revision mode**. Changes are highlighted. **Save Revision** records "Data Analysis" → "Data & Analysis Management" with the date and who asked. |
| "Add a table" | Tables → New Table → pick a template → edit cells. |
| "Add an acronym" | Acronyms → Add Acronym (duplicates are rejected). Acronyms written as "Full Name (ABBR)" in your text are suggested automatically. |
| "Move this figure to chapter 4" | Change its chapter/section. Every figure number, list and in-text reference updates. |
| "Send me the figures" | Export → Complete Documentation Package (.zip) or the Word document (.docx). |

## Features

- **Projects:** multiple independent workspaces, plus JSON import/export, automatic backups and restore.
- **Dashboard:** totals, completion status, chapter progress, health checks (broken references, unassigned items, pending acronyms, open comments), recent activity and figures.
- **Project Structure:** front matter toggles, plus chapters, sections and subsections. You can add, rename, delete and reorder them by drag & drop or with indent/outdent, and see a live TOC.
- **Chapters:** a writing workspace with cross-reference chips (Figure 3, Table 2, Section 1.4.2) that renumber automatically, a "link plain references" helper, and inline acronym suggestions.
- **Figure editor:**
  - 16 diagram types with fully editable templates: flowchart, context diagram, use case, activity, sequence (synchronous / asynchronous / return messages), class, state, ERD, architecture, component, deployment, fishbone, hierarchy, timeline/Gantt, screenshot/image and generic.
  - Screenshots as figures: upload, paste (Ctrl+V) or drop an image; it gets a numbered caption like any figure.
  - A 40+ shape library and smart connectors (straight, orthogonal or curved) with UML and crow's-foot arrowheads.
  - Drag, resize, smart guides and grid snap; inline text editing; fonts, borders and fills; align and distribute; z-order.
  - Undo/redo, copy/paste, zoom/pan/fit, version history (view and restore), revision mode and comments attached to elements.
- **Table builder:** templates, add/delete rows and columns, merge cells, resize columns, bold/italic/alignment, header rows, zebra striping, undo/redo and versions.
- **Acronyms manager:** alphabetical list, duplicate prevention, bulk paste, automatic detection, usage counts, PDF and Word-table export.
- **References (bibliography):** add references by type or import BibTeX (Google Scholar, IEEE Xplore, Zotero), cite them in the text with the **Cite** button ([1], [2] renumber automatically), IEEE or compact style, ordered by first citation, alphabetically or manually; the References page is generated at the end of the report.
- **University report templates:** start a project from the **Umm Al-Qura University — SWE Graduation Project 1** template (Declaration with signature lines, Abstract ≤ 150 words, Acknowledgment, CONTENT, lists, Chapters 1–4 with every required section and writing hints, unnumbered Conclusions, References, and the department's formatting), or apply it to an existing project from Settings without losing anything.
- **Document Preview:** paginated A4/Letter pages with your fonts, margins and caption styles, and real page numbers in the TOC and lists. Print or save as PDF.
- **Export:**
  - Figures as SVG, PNG (DPI-tagged so Word inserts them at the right size), PDF or clipboard image.
  - Tables as SVG, PNG, PDF, HTML, CSV or "Copy for Word".
  - Lists as PDF.
  - A **.docx** with real Word fields (TOC, List of Figures/Tables, SEQ captions, cross-reference REF fields).
  - A complete documentation package (.zip).
- **Command menu** (`Ctrl/⌘+K`) for searching across figures (including text inside diagrams), tables, acronyms, chapters and sections. Press `?` for keyboard shortcuts.
- Dark/light mode, responsive layout and keyboard accessible.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md). In short:

```
src/app        shell, router, command palette, search, shortcuts
src/core       store (autosave), model, numbering (derived), references, document model
src/storage    localStorage / IndexedDB adapters + ProjectRepository (swap for Supabase)
src/ui         dom helpers, icons, modal, toast, menu, tooltip
src/figures    SVG diagram engine, templates, types registry, versions/diff, editor/
src/tables     table list, editor, templates, renderers
src/structure  outline + chapters writing view
src/acronyms   manager + detection
src/bibliography  references page, reference dialog, BibTeX import
src/preview    paginated preview
src/export     zip, png, vector pdf, docx, package
```

Numbers are **never stored**. "Figure 3", "FIG-003" and "1.4.2" are derived from document order on every change, so internal IDs stay stable and references never go stale.
