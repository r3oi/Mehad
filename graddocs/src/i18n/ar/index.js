// All Arabic dictionaries merged into one lookup table.
import common from './common.js';
import shell from './shell.js';
import figures from './figures.js';
import tables from './tables.js';
import structure from './structure.js';
import workspace from './workspace.js';
import output from './output.js';

export const AR = { ...common, ...shell, ...workspace, ...structure, ...tables, ...output, ...figures };
