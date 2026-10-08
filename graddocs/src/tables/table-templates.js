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
    id: 'usecase',
    name: 'Use Case Description',
    description: 'Describe one use case: ID, actors, conditions and the main and alternative flows.',
    build() {
      // Item labels are bold; steps are numbered, one per line, inside a single cell.
      const item = (label, text) => [createCell(label, { bold: true }), createCell(text)];
      return {
        columns: columnsOf([24, 76]),
        rows: [
          row(['Item', 'Description']),
          item('Use Case ID', 'UC-01'),
          item('Use Case Name', 'Submit Project Report'),
          item('Actor(s)', 'Student (primary), Supervisor (secondary)'),
          item('Description', 'The student uploads a project report so that the assigned supervisor can review it.'),
          item('Preconditions', 'The student is logged in and belongs to a project group.'),
          item('Postconditions', 'The report is stored in the system and the supervisor is notified.'),
          item('Main Flow', '1. The student selects “Submit Report”.\n2. The system displays the upload form.\n3. The student attaches the report file and confirms.\n4. The system validates and saves the file.\n5. The system notifies the supervisor.'),
          item('Alternative Flow(s)', '3a. The student saves the report as a draft.\n3a1. The system keeps the draft and returns to step 2.'),
          item('Exceptions', '4a. The file type or size is not allowed: the system rejects the file and shows an error message.'),
        ],
        headerRows: 1,
      };
    },
  },
  {
    id: 'risks',
    name: 'Risk Management Table',
    description: 'Identify project risks with their type, probability, impact and mitigation strategy.',
    build() {
      return {
        columns: columnsOf([8, 25, 10, 15, 11, 31]),
        rows: [
          [createCell('Risk ID', { align: 'center' }), createCell('Risk Description'), ...centred(['Type', 'Probability', 'Impact']), createCell('Mitigation Strategy')],
          [createCell('R-01', { align: 'center' }), createCell('A team member becomes unavailable during exams or illness, delaying tasks.'), ...centred(['Project', 'Medium', 'High']), createCell('Share knowledge between members, keep tasks small and add buffer time to the schedule.')],
          [createCell('R-02', { align: 'center' }), createCell('Requirements change late in the project after supervisor feedback.'), ...centred(['Project', 'High', 'Medium']), createCell('Review the requirements with the supervisor every two weeks and freeze them before implementation starts.')],
          [createCell('R-03', { align: 'center' }), createCell('The system is too slow when many users are connected at the same time.'), ...centred(['Product', 'Low', 'High']), createCell('Run load tests early and optimise database queries and caching.')],
        ],
        headerRows: 1,
        style: { fontSize: 10 },
      };
    },
  },
  {
    id: 'swhw',
    name: 'Software & Hardware Requirements',
    description: 'List the software and hardware needed to build and run the project, with versions.',
    build() {
      return {
        columns: columnsOf([13, 24, 33, 30]),
        rows: [
          row(['Type', 'Item', 'Purpose', 'Version / Specification']),
          row(['Software', 'Visual Studio Code', 'Source-code editor used for development.', '1.90 or later']),
          row(['Software', 'PostgreSQL', 'Relational database that stores the system data.', 'Version 16']),
          row(['Software', 'Git and GitHub', 'Version control and team collaboration.', 'Git 2.45']),
          row(['Hardware', 'Development laptop', 'Development and testing of the system.', 'Intel Core i7, 16 GB RAM, 512 GB SSD']),
          row(['Hardware', 'Android test phone', 'Testing the mobile application.', 'Android 13, 6 GB RAM']),
        ],
        headerRows: 1,
      };
    },
  },
  {
    id: 'nfr',
    name: 'Non-Functional Requirements',
    description: 'Non-functional requirements by category, each with a measurable acceptance criterion.',
    build() {
      return {
        columns: columnsOf([10, 18, 38, 34]),
        rows: [
          row(['ID', 'Category', 'Requirement', 'Measure / Acceptance Criteria']),
          row(['NFR-01', 'Security', 'The system shall authenticate every user before giving access to any data.', 'Passwords are stored hashed; an account is locked after 5 failed log-in attempts.']),
          row(['NFR-02', 'Performance', 'The system shall respond quickly to user actions.', '95% of pages load in under 3 seconds with 100 concurrent users.']),
          row(['NFR-03', 'Usability', 'A new user shall be able to use the main features without training.', '90% of test users finish the main task in under 5 minutes.']),
          row(['NFR-04', 'Reliability', 'The system shall be available during working hours.', 'Availability of at least 99% per month.']),
          row(['NFR-05', 'Maintainability', 'The code shall be modular and documented so new developers can extend it.', 'Every module has unit tests covering at least 70% of its code.']),
          row(['NFR-06', 'Scalability', 'The system shall support growth in the number of users.', 'Handles 10 times the expected load by adding servers, without redesign.']),
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
