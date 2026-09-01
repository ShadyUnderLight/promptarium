/**
 * All Projects search aggregation and identity tests.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  aggregateScanResults,
  compareSearchHits,
  finalizeAllProjectsScanResults,
  mergeSearchResults,
  projectLabel,
  refreshAllProjectsProjectScan,
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

function summary(projectPath, name, description = '', tags = [], status = 'active') {
  return {
    projectPath,
    relativePath: name + '.md',
    name,
    folder: name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '',
    extension: '.md',
    metadata: { ...defaultMetadata, description, tags: [...tags], status },
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
  { projectPath: '/project-a', revision: 0, summaries: [summary('/project-a', 'review/common', 'body A')] },
  { projectPath: '/project-b', revision: 0, summaries: [summary('/project-b', 'review/common', 'body B')] },
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

console.log('mergeSearchResults ignores stale indexes outside registered projects');
const indexesWithGhost = new Map(indexes);
indexesWithGhost.set(
  '/project-ghost',
  new Map([
    [
      'ghost-only',
      entry('/project-ghost', 'ghost-only', 'ghost-only-keyword body', 'ghost only', []),
    ],
  ])
);
const registeredOnly = [{ name: 'Work', path: '/project-a' }];
eq(
  mergeSearchResults(registeredOnly, indexesWithGhost, 'ghost-only-keyword').length,
  0,
  'forgotten project index must not appear in global search'
);

console.log('mergeSearchResults ignores unhealthy projects this refresh');
const onlyHealthyA = [{ name: 'Work', path: '/project-a' }];
eq(
  mergeSearchResults(onlyHealthyA, indexes, 'image').map((item) => item.projectPath),
  ['/project-a'],
  'failed scan project must not contribute search hits'
);

console.log('compareSearchHits deterministic tie-break');
const tie = compareSearchHits(
  { summary: summary('/project-b', 'z-prompt'), score: 10 },
  { summary: summary('/project-a', 'a-prompt'), score: 10 },
  projects
);
assert(tie < 0, 'equal score sorts by project label then prompt name');

const sameLabelProjects = [
  { name: 'Work', path: '/project-a' },
  { name: 'Work', path: '/project-b' },
];
const tieSameLabel = compareSearchHits(
  { summary: summary('/project-b', 'shared'), score: 10 },
  { summary: summary('/project-a', 'shared'), score: 10 },
  sameLabelProjects
);
assert(tieSameLabel !== 0, 'same label and prompt name still tie-breaks by projectPath');

console.log('refreshAllProjectsProjectScan rescans summaries after index retry');
{
  let scanCount = 0;
  const draft = summary('/project-a', 'foo', 'draft body', [], 'draft');
  const active = summary('/project-a', 'foo', 'active body', ['new-tag'], 'active');

  const result = await refreshAllProjectsProjectScan(
    '/project-a',
    async () => {
      scanCount++;
      return scanCount === 1 ? [draft] : [active];
    },
    async () => ({ retried: true }),
    () => 1
  );

  eq(scanCount, 2, 'stale index retry triggers a second summary scan');
  eq(result.revision, 1, 'project scan records revision at completion');
  eq(result.summaries[0].metadata.status, 'active', 'aggregated summaries match post-save scan');
  eq(result.summaries[0].metadata.tags, ['new-tag'], 'aggregated tag metadata matches post-save scan');
}

console.log('refreshAllProjectsProjectScan keeps first scan when index did not retry');
{
  let scanCount = 0;
  const stable = summary('/project-a', 'foo', 'stable body');

  const result = await refreshAllProjectsProjectScan(
    '/project-a',
    async () => {
      scanCount++;
      return [stable];
    },
    async () => ({ retried: false }),
    () => 5
  );

  eq(scanCount, 1, 'no retry avoids redundant rescan');
  eq(result.summaries[0].metadata.description, 'stable body', 'first scan summaries are reused');
}

console.log('finalizeAllProjectsScanResults refreshes project mutated after its scan completed');
{
  const revisions = new Map([
    ['/project-a', 5],
    ['/project-b', 5],
  ]);
  let refreshCount = 0;

  const draft = summary('/project-a', 'foo', 'draft body', [], 'draft');
  const active = summary('/project-a', 'foo', 'active body', ['new-tag'], 'active');
  const bStable = summary('/project-b', 'bar', 'stable body');

  const initial = [
    { projectPath: '/project-a', summaries: [draft], revision: 5 },
    { projectPath: '/project-b', summaries: [bStable], revision: 5 },
  ];

  revisions.set('/project-a', 6);

  const committed = await finalizeAllProjectsScanResults({
    results: initial,
    getRevision: (path) => revisions.get(path) ?? 0,
    shouldAbort: () => false,
    refreshProjects: async (paths) => {
      refreshCount++;
      eq(paths, ['/project-a'], 'only stale project is refreshed before global commit');
      return [{ projectPath: '/project-a', summaries: [active], revision: revisions.get('/project-a') ?? 0 }];
    },
  });

  const summaries = aggregateScanResults(committed ?? []);
  eq(refreshCount, 1, 'one revision validation refresh round');
  eq(summaries.find((item) => item.name === 'foo')?.metadata.status, 'active', 'global commit keeps post-save status');
  eq(summaries.find((item) => item.name === 'foo')?.metadata.tags, ['new-tag'], 'global commit keeps post-save tags');
  eq(summaries.find((item) => item.name === 'bar')?.metadata.description, 'stable body', 'unaffected project stays stable');
}

console.log('finalizeAllProjectsScanResults skips refresh when all revisions match');
{
  const revisions = new Map([['/project-a', 5]]);
  let refreshCount = 0;

  const committed = await finalizeAllProjectsScanResults({
    results: [{ projectPath: '/project-a', summaries: [summary('/project-a', 'foo', 'stable body')], revision: 5 }],
    getRevision: (path) => revisions.get(path) ?? 0,
    shouldAbort: () => false,
    refreshProjects: async () => {
      refreshCount++;
      return [];
    },
  });

  eq(refreshCount, 0, 'matching revisions commit without extra refresh');
  eq(aggregateScanResults(committed ?? [])[0].metadata.description, 'stable body', 'initial snapshot is committed');
}

if (failures) {
  console.error('\n' + failures + ' test(s) failed.');
  process.exit(1);
}

console.log('\nAll all-projects tests passed.');
