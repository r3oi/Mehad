// Global keyboard shortcuts and the shortcuts help dialog.
// Views handle their own context shortcuts (e.g. the figure editor handles
// Delete / Ctrl+D / Ctrl+Z) and may set `event.defaultPrevented` to opt out.
import { modKey, modLabel, isTypingTarget } from '../core/utils.js';
import { openModal, hasOpenModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { t } from '../i18n/index.js';

export function installGlobalShortcuts(shell) {
  document.addEventListener('keydown', async (e) => {
    if (e.defaultPrevented) return;
    const mod = modKey(e);
    if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      (await import('./command-palette.js')).openPalette(shell);
      return;
    }
    if (mod && (e.key === 's' || e.key === 'S')) {
      // The figure/table editors intercept Ctrl+S first (save version).
      e.preventDefault();
      if (!shell.store.project) return;
      await shell.store.flush();
      toast(t('All changes saved'), { type: 'success', duration: 1600 });
      return;
    }
    if (e.key === '?' && !isTypingTarget(e.target) && !hasOpenModal()) {
      e.preventDefault();
      showShortcutsHelp();
    }
  });
}

const GROUPS = [
  ['General', [
    [[modLabel, 'K'], 'Command menu & search'],
    [[modLabel, 'S'], 'Save now (in editors: save a version)'],
    [['?'], 'Show keyboard shortcuts'],
  ]],
  ['Figure editor', [
    [[modLabel, 'Z'], 'Undo'],
    [[modLabel, 'Y'], 'Redo (also ⇧+{mod}+Z)'],
    [['Delete'], 'Delete selected elements'],
    [[modLabel, 'D'], 'Duplicate selection'],
    [[modLabel, 'C'], 'Copy'], [[modLabel, 'V'], 'Paste'],
    [[modLabel, 'A'], 'Select all'],
    [['Enter'], 'Edit text of selected element'],
    [['←', '↑', '→', '↓'], 'Nudge (hold ⇧ for 10px)'],
    [['V'], 'Select tool'], [['T'], 'Text'], [['R'], 'Rectangle'], [['U'], 'Rounded rectangle'], [['O'], 'Ellipse'], [['D'], 'Diamond'],
    [['Double-click'], 'Edit text / add a text label'], [['Esc'], 'Cancel tool, clear selection'],
    [['L'], 'Line'], [['A'], 'Arrow'], [['C'], 'Connector'], [['H'], 'Hand (pan) — or hold Space'],
    [[modLabel, '+'], 'Zoom in'], [[modLabel, '−'], 'Zoom out'], [['⇧', '1'], 'Fit to screen'],
  ]],
  ['Table editor', [
    [['Tab'], 'Next cell (adds a row at the end)'], [['⇧', 'Tab'], 'Previous cell'],
    [['Enter'], 'Cell below'], [['⇧', 'Enter'], 'New line in cell'],
    [['⇧', 'Click'], 'Select a range (or drag)'],
    [[modLabel, 'B'], 'Bold'], [[modLabel, 'I'], 'Italic'],
    [[modLabel, 'Z'], 'Undo'], [[modLabel, 'Y'], 'Redo'],
    [[modLabel, 'S'], 'Save a version'],
  ]],
];

export function showShortcutsHelp() {
  openModal({
    title: t('Keyboard shortcuts'), size: 'lg', footer: false,
    body: `<div class="grid grid-2" style="gap:24px">${GROUPS.map(([title, rows]) => `
      <div><div class="section-title">${t(title)}</div>
        <div class="col" style="gap:7px">${rows.map(([keys, label]) => `
          <div class="row" style="justify-content:space-between;font-size:13px"><span>${t(label, { mod: modLabel })}</span><span class="row" style="gap:3px" dir="ltr">${keys.map((k) => `<kbd>${t(k)}</kbd>`).join('')}</span></div>`).join('')}
        </div></div>`).join('')}</div>`,
  });
}
