/**
 * All Projects search aggregation and identity tests.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  aggregateScanResults,
  compareSearchHits,
  mergeSearchResults,
  projectLabel,
} = await import(join(root, 'src/lib/library/all-projects.ts'));
const { promptKey } = await import(join(root, 'src/lib/library/scope.ts'));

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

function summary(projectPath, name, description = '', tags = []) {
  return {
    projectPath,
    relativePath: name + '.md',
    name,
    folder: name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '',
    extension: '.md',
    metadata: { ...defaultMetadata, description, tags: [...tags] },
    modifiedAt: 1000,
    sizeBytes: 100,
    hasFrontmatter: false,
  };
}

function entry(projectPath, name, bodyLower, description = '', tags = []) {
  return {
    summary: summary(projectPath, name, description, tags),
    fingerprint: { modifiedAt: 1000, sizeBytes: 100 },
    bodyLower,
    variableCount: 0,
  };
}

console.log('promptKey identity');
const keyA = promptKey('/project-a', 'review/common');
const keyB = promptKey('/project-b', 'review/common');
assert(keyA !== keyB, 'same relative name in different projects must not collide');

console.log('aggregateScanResults');
const aggregated = aggregateScanResults([
  { projectPath: '/project-a', summaries: [summary('/project-a', 'review/common', 'body A')] },
  { projectPath: '/project-b', summaries: [summary('/project-b', 'review/common', 'body B')] },
]);
eq(aggregated.length, 2, 'both same-name prompts are kept');
eq(
  aggregated.map((item) => item.projectPath + ':' + item.name).sort(),
  ['/project-a:review/common', '/project-b:review/common'],
  'aggregate keeps project identity'
);

console.log('mergeSearchResults');
const projects = [
  { name: 'Work', path: '/project-a' },
  { name: 'Personal', path: '/project-b' },
];
const indexes = new Map([
  [
    '/project-a',
    new Map([
      ['review/common', entry('/project-a', 'review/common', 'alpha product photography guide', 'product photography', ['image'])],
    ]),
  ],
  [
    '/project-b',
    new Map([
      ['review/common', entry('/project-b', 'review/common', 'beta product photography notes', 'photo notes', ['image'])],
      ['marketing/amazon-product-photo', entry('/project-b', 'marketing/amazon-product-photo', 'amazon product photo prompt', 'amazon product photo', ['sales'])],
    ]),
  ],
]);

const merged = mergeSearchResults(projects, indexes, 'amazon product');
eq(
  merged.map((item) => projectLabel(projects, item.projectPath) + ':' + item.name),
  ['Personal:marketing/amazon-product-photo'],
  'global search finds the expected cross-project hit'
);

const bothNames = mergeSearchResults(projects, indexes, 'review/common');
eq(
  bothNames.map((item) => item.projectPath + ':' + item.name).sort(),
  ['/project-a:review/common', '/project-b:review/common'],
  'same relative name in two projects both appear in global results'
);

const tagHits = mergeSearchResults(projects, indexes, 'image');
eq(tagHits.length, 2, 'tag search finds prompts in both projects');

console.log('compareSearchHits deterministic tie-break');
const tie = compareSearchHits(
  { summary: summary('/project-b', 'z-prompt'), score: 10 },
  { summary: summary('/project-a', 'a-prompt'), score: 10 },
  projects
);
assert(tie < 0, 'equal score sorts by project label then prompt name');

if (failures) {
  console.error('\n' + failures + ' test(s) failed.');
  process.exit(1);
}

console.log('\nAll all-projects tests passed.');
