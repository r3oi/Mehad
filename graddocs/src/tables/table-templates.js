// Starting points offered by the "New Table" dialog. build() returns fresh
// content every time (new column ids) so templates can be used repeatedly.
// `name` and `description` are interface text: English here, translated with t() when the gallery renders.
// The header / body text that build() inserts is report content and stays English.
import { uid } from '../core/utils.js';
import { createCell } from '../core/model.js';

const columnsOf = (widths) => widths.map((width) => ({ id: uid('col'), width }));
const row = (cells, fields = {}) => cells.map((text) => createCell(text, fields));
const centred = (cells) => cells.map((text) => createCell(text, { align: 'center' }));

export const TABLE_TEMPLATES = [
  {
    id: 'feature',
    name: 'Feature Table',
    description: 'List the main features of your system with an ID, a name and a short description.',
    build() {
      return {
        columns: columnsOf([16, 28, 56]),
        rows: [
          row(['Feature ID', 'Feature Name', 'Description']),
          row(['F-1', '', '']),
          row(['F-2', '', '']),
          row(['F-3', '', '']),
          row(['F-4', '', '']),
        ],
        headerRows: 1,
      };
    },
  },
  {
    id: 'comparison',
    name: 'Comparison Table',
    description: 'Compare your system with existing ones, feature by feature, using ticks and crosses.',
    build() {
      return {
        columns: columnsOf([34, 22, 22, 22]),
        rows: [
          [createCell('Feature'), ...centred(['Our System', 'System A', 'System B'])],
          [createCell('Feature 1'), ...centred(['✓', '✓', '✗'])],
          [createCell('Feature 2'), ...centred(['✓', '✗', '✓'])],
          [createCell('Feature 3'), ...centred(['✓', '✗', '✗'])],
          [createCell('Feature 4'), ...centred(['✓', '✓', '✓'])],
        ],
        headerRows: 1,
      };
    },
  },
  {
    id: 'requirements',
    name: 'Requirements Table',
    description: 'Functional and non-functional requirements with a type and a priority.',
    build() {
      return {
        columns: columnsOf([13, 51, 21, 15]),
        rows: [
          row(['Req. ID', 'Requirement', 'Type', 'Priority']),
          row(['FR-1', '', 'Functional', 'High']),
          row(['FR-2', '', 'Functional', 'Medium']),
          row(['NFR-1', '', 'Non-functional', 'High']),
          row(['NFR-2', '', 'Non-functional', 'Medium']),
        ],
        headerRows: 1,
      };
    },
  },
  {
    id: 'roles',
    name: 'User Roles Table',
    description: 'Describe each type of user and what they are allowed to do.',
    build() {
      return {
        columns: columnsOf([22, 38, 40]),
        rows: [
          row(['Role', 'Description', 'Permissions']),
          row(['Administrator', '', '']),
          row(['Registered User', '', '']),
          row(['Guest', '', '']),
        ],
        headerRows: 1,
      };
    },
  },
  {
    id: 'testcase',
    name: 'Test Case Table',
    description: 'Test cases with steps, expected and actual results, and a pass/fail status.',
    build() {
      return {
        columns: columnsOf([9, 19, 24, 19, 19, 10]),
        rows: [
          row(['Test ID', 'Description', 'Steps', 'Expected Result', 'Actual Result', 'Status']),
          row(['TC-01', '', '', '', '', '']),
          row(['TC-02', '', '', '', '', '']),
          row(['TC-03', '', '', '', '', '']),
        ],
        headerRows: 1,
        style: { fontSize: 10 },
      };
    },
  },
  {
    id: 'generic',
    name: 'Generic Table',
    description: 'A plain 3 × 3 table to start from scratch.',
    build() {
      return {
        columns: columnsOf([33.34, 33.33, 33.33]),
        rows: [
          row(['Column 1', 'Column 2', 'Column 3']),
          row(['', '', '']),
          row(['', '', '']),
        ],
        headerRows: 1,
      };
    },
  },
];

export const templateById = (id) => TABLE_TEMPLATES.find((t) => t.id === id) || TABLE_TEMPLATES[TABLE_TEMPLATES.length - 1];
