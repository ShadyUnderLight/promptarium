/**
 * Pure-function tests for selected-document refresh decisions.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { decideSelectedRefresh } = await import(join(root, 'src/lib/library/refresh-selected.ts'));
const { summaryFingerprint } = await import(join(root, 'src/lib/library/search-index.ts'));

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error('  FAIL: ' + message);
  }
}

function eq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, message + '\n    expected ' + e + '\n    got      ' + a);
}

const defaultMetadata = {
  description: '',
  tags: [],
  status: 'active',
  favorite: false,
  models: [],
  extra: {},
};

function summary(projectPath, name, modifiedAt = 1000, sizeBytes = 100) {
  return {
    projectPath,
    relativePath: name + '.md',
    name,
    folder: '',
    extension: '.md',
    metadata: defaultMetadata,
    modifiedAt,
    sizeBytes,
    hasFrontmatter: false,
  };
}

console.log('clean selected reloads when requested');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [summary('/project-a', 'a')],
    editorDirty: false,
    openedFingerprint: summaryFingerprint(summary('/project-a', 'a')),
    reloadSelected: true,
  }),
  {
    reloadSelected: true,
    clearSelection: false,
    externalChange: null,
    preserveEditor: false,
  },
  'clean reload'
);

console.log('dirty selected skips reload and flags disk change');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [summary('/project-a', 'a', 2000, 100)],
    editorDirty: true,
    openedFingerprint: summaryFingerprint(summary('/project-a', 'a', 1000, 100)),
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: false,
    externalChange: 'disk_changed',
    preserveEditor: true,
  },
  'dirty external change'
);

console.log('dirty selected with unchanged disk stays quiet');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [summary('/project-a', 'a')],
    editorDirty: true,
    openedFingerprint: summaryFingerprint(summary('/project-a', 'a')),
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: false,
    externalChange: null,
    preserveEditor: true,
  },
  'dirty unchanged disk'
);

console.log('deleted selected clears when clean');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [],
    editorDirty: false,
    openedFingerprint: summaryFingerprint(summary('/project-a', 'a')),
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: true,
    externalChange: null,
    preserveEditor: false,
  },
  'deleted clean'
);

console.log('deleted selected stays when dirty');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [],
    editorDirty: true,
    openedFingerprint: summaryFingerprint(summary('/project-a', 'a')),
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: false,
    externalChange: 'file_missing',
    preserveEditor: true,
  },
  'deleted dirty'
);

console.log('same-name prompts in different projects resolve by projectPath');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-b',
    selectedName: 'review/common',
    summaries: [
      summary('/project-a', 'review/common', 1000, 100),
      summary('/project-b', 'review/common', 3000, 100),
    ],
    editorDirty: true,
    openedFingerprint: summaryFingerprint(summary('/project-b', 'review/common', 1000, 100)),
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: false,
    externalChange: 'disk_changed',
    preserveEditor: true,
  },
  'project-scoped dirty external change in all-projects aggregate'
);

if (failures) {
  console.error('\n' + failures + ' failure(s)');
  process.exit(1);
}

console.log('\nAll refresh-selected tests passed.');
