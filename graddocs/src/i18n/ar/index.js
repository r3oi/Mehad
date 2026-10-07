// All Arabic dictionaries merged into one lookup table.
import common from './common.js';
import shell from './shell.js';
import figures from './figures.js';
import tables from './tables.js';
import structure from './structure.js';
import workspace from './workspace.js';
import output from './output.js';
import word from './word.js';
import generate from './generate.js';
import placement from './placement.js';
import bibliography from './bibliography.js';
import documentOut from './document.js';
import templates from './templates.js';

export const AR = { ...common, ...shell, ...workspace, ...structure, ...tables, ...output, ...figures, ...word, ...generate, ...placement, ...bibliography, ...documentOut, ...templates };
