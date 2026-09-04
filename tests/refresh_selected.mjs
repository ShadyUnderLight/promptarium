/**
 * Pure-function tests for selected-document refresh decisions.
 *
 * Refresh never replaces a dirty editor buffer; only a deleted/renamed file
 * surfaces as an external change while dirty. Disk-content conflicts are the
 * save-time `expectedRaw` full-text compare's job, so no mtime/size
 * prediction exists here.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { decideSelectedRefresh } = await import(join(root, 'src/lib/library/refresh-selected.ts'));

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

function summary(projectPath, name, modifiedAt = 1000) {
  return {
    projectPath,
    relativePath: name + '.md',
    name,
    folder: '',
    extension: '.md',
    metadata: defaultMetadata,
    modifiedAt,
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

console.log('dirty selected reloads when requested');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [summary('/project-a', 'a')],
    editorDirty: true,
    reloadSelected: true,
  }),
  {
    reloadSelected: true,
    clearSelection: false,
    externalChange: null,
    preserveEditor: false,
  },
  'dirty explicit reload'
);

console.log('dirty selected skips reload and keeps the editor buffer');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [summary('/project-a', 'a')],
    editorDirty: true,
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: false,
    externalChange: null,
    preserveEditor: true,
  },
  'dirty buffer preserved without mtime/size prediction'
);

console.log('clean selected without reload stays quiet');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [summary('/project-a', 'a')],
    editorDirty: false,
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: false,
    externalChange: null,
    preserveEditor: false,
  },
  'clean no reload'
);

console.log('deleted selected clears when clean');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-a',
    selectedName: 'a',
    summaries: [],
    editorDirty: false,
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
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: false,
    externalChange: 'file_missing',
    preserveEditor: true,
  },
  'deleted dirty flags file_missing'
);

console.log('same-name prompts in different projects resolve by projectPath');
eq(
  decideSelectedRefresh({
    selectedProjectPath: '/project-b',
    selectedName: 'review/common',
    summaries: [summary('/project-a', 'review/common'), summary('/project-b', 'review/common')],
    editorDirty: true,
    reloadSelected: false,
  }),
  {
    reloadSelected: false,
    clearSelection: false,
    externalChange: null,
    preserveEditor: true,
  },
  'project-scoped selected resolves within its own project'
);

console.log('created/duplicated prompt present in summary never false-flags an external change');
{
  eq(
    decideSelectedRefresh({
      selectedProjectPath: '/project-a',
      selectedName: 'new-prompt',
      summaries: [summary('/project-a', 'new-prompt', 1000)],
      editorDirty: true,
      reloadSelected: false,
    }),
    {
      reloadSelected: false,
      clearSelection: false,
      externalChange: null,
      preserveEditor: true,
    },
    'fresh create stays quiet while dirty'
  );
}

if (failures) {
  console.error('\n' + failures + ' failure(s)');
  process.exit(1);
}

console.log('\nAll refresh-selected tests passed.');
