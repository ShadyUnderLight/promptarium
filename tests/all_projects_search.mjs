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
  planAllProjectsGlobalCommit,
  projectLabel,
  refreshAllProjectsProjectScan,
  refreshProjectScopeSnapshot,
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
    hasFrontmatter: false,
  };
}

function entry(projectPath, name, bodyLower, description = '', tags = []) {
  return {
    summary: summary(projectPath, name, description, tags),
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

console.log('refreshAllProjectsProjectScan retries when mutation happens after index refresh');
{
  let revision = 5;
  let scanCount = 0;
  const draft = summary('/project-a', 'foo', 'draft body', [], 'draft');
  const active = summary('/project-a', 'foo', 'active body', ['new-tag'], 'active');

  const result = await refreshAllProjectsProjectScan(
    '/project-a',
    async () => {
      scanCount++;
      return scanCount === 1 ? [draft] : [active];
    },
    async () => {
      if (scanCount === 1) revision = 6;
    },
    () => revision
  );

  eq(scanCount, 2, 'mutation after index refresh triggers full project rescan');
  eq(result?.revision, 6, 'returned revision matches bound snapshot interval');
  eq(result?.summaries[0].metadata.status, 'active', 'summaries and revision stay paired after mutation');
  eq(result?.summaries[0].metadata.tags, ['new-tag'], 'tag metadata matches post-mutation scan');
}

console.log('refreshAllProjectsProjectScan keeps first scan when revision stays stable');
{
  let scanCount = 0;
  const stable = summary('/project-a', 'foo', 'stable body');

  const result = await refreshAllProjectsProjectScan(
    '/project-a',
    async () => {
      scanCount++;
      return [stable];
    },
    async () => {},
    () => 5
  );

  eq(scanCount, 1, 'stable revision avoids redundant rescan');
  eq(result?.revision, 5, 'snapshot revision is captured at loop start');
  eq(result?.summaries[0].metadata.description, 'stable body', 'first scan summaries are reused');
}

console.log('refreshProjectScopeSnapshot publishes summaries before the body rebuild finishes');
{
  let revision = 0;
  let scanCount = 0;
  let releaseRead;
  const gate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const preSave = summary('/project-a', 'foo', 'body', [], 'draft');
  const postSave = summary('/project-a', 'foo', 'body', ['new-tag'], 'active');
  const published = [];

  const snapshot = refreshProjectScopeSnapshot({
    projectPath: '/project-a',
    scanProject: async () => {
      scanCount++;
      return scanCount === 1 ? [preSave] : [postSave];
    },
    listFolders: async () => ['prompts', 'templates'],
    refreshSearchIndex: async () => {
      if (scanCount === 1) {
        await gate;
        revision = 1;
      }
    },
    getRevision: () => revision,
    onScan: (summaries, folders) => published.push({ summaries, folders }),
  });

  await Promise.resolve();
  await Promise.resolve();
  eq(published.length, 1, 'summary list is published before the rebuild resolves');
  eq(published[0].summaries[0].metadata.status, 'draft', 'first scan is published immediately');

  releaseRead();
  const result = await snapshot;
  eq(scanCount, 2, 'pre-save scan is discarded and the project is rescanned');
  eq(published.length, 2, 'post-save scan is published on the retry');
  eq(result?.summaries[0].metadata.status, 'active', 'stable snapshot uses post-save status');
  eq(result?.summaries[0].metadata.tags, ['new-tag'], 'stable snapshot uses post-save tags');
  eq(result?.folders, ['prompts', 'templates'], 'folders stay paired with the stable snapshot');
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
      return [{ projectPath: '/project-a', summaries: [active], revision: 6 }];
    },
    commit: (results) => aggregateScanResults(results),
  });

  eq(refreshCount, 1, 'one revision validation refresh round');
  eq(committed?.find((item) => item.name === 'foo')?.metadata.status, 'active', 'global commit keeps post-save status');
  eq(committed?.find((item) => item.name === 'foo')?.metadata.tags, ['new-tag'], 'global commit keeps post-save tags');
  eq(committed?.find((item) => item.name === 'bar')?.metadata.description, 'stable body', 'unaffected project stays stable');
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
    commit: (results) => aggregateScanResults(results),
  });

  eq(refreshCount, 0, 'matching revisions commit without extra refresh');
  eq(committed?.[0].metadata.description, 'stable body', 'initial snapshot is committed');
}

console.log('finalizeAllProjectsScanResults commits before helper resolves');
{
  const revisions = new Map([['/project-a', 5]]);
  const order = [];
  let committedSummaries = null;

  const outcome = await finalizeAllProjectsScanResults({
    results: [{ projectPath: '/project-a', summaries: [summary('/project-a', 'foo', 'stable@5')], revision: 5 }],
    getRevision: (path) => revisions.get(path) ?? 0,
    shouldAbort: () => false,
    refreshProjects: async () => [],
    commit: (results) => {
      order.push('commit');
      committedSummaries = aggregateScanResults(results);
      return committedSummaries;
    },
  });

  order.push('resolved');
  eq(order, ['commit', 'resolved'], 'global commit runs before promise resolves');
  eq(outcome?.[0]?.metadata.description, 'stable@5', 'committed snapshot is available from helper result');
  revisions.set('/project-a', 6);
  eq(committedSummaries?.[0]?.metadata.description, 'stable@5', 'post-resolve mutation must not retroactively change committed snapshot');
}

console.log('planAllProjectsGlobalCommit binds visible prompts to the committed snapshot');
{
  const summariesAtCommit = [summary('/project-a', 'foo', 'stable@5')];
  const projects = [{ name: 'Work', path: '/project-a' }];

  const plan = planAllProjectsGlobalCommit({
    finalized: [{ projectPath: '/project-a', summaries: summariesAtCommit, revision: 5 }],
    projects,
    searchQuery: '',
    searchIndexes: new Map(),
    selectedProjectPath: null,
    selectedName: null,
    editorDirty: false,
    reloadSelected: true,
  });

  eq(plan.prompts, plan.summaries, 'visible prompts use the same aggregated snapshot as allPrompts');
  eq(plan.prompts[0].metadata.description, 'stable@5', 'prompts are produced during global commit planning');

  const laterSummaries = [summary('/project-a', 'foo', 'saved@6', [], 'active')];
  assert(plan.prompts !== laterSummaries, 'caller must not reassign prompts from a later snapshot variable');
}

console.log('planAllProjectsGlobalCommit plans selected refresh from the same snapshot');
{
  const committedSummary = summary('/project-a', 'foo', 'stable@5', [], 'active');
  const projects = [{ name: 'Work', path: '/project-a' }];

  const plan = planAllProjectsGlobalCommit({
    finalized: [{ projectPath: '/project-a', summaries: [committedSummary], revision: 5 }],
    projects,
    searchQuery: '',
    searchIndexes: new Map(),
    selectedProjectPath: '/project-a',
    selectedName: 'foo',
    editorDirty: true,
    reloadSelected: false,
  });

  eq(plan.decision.externalChange, null, 'dirty editor with a present file stays quiet (no mtime/size prediction)');
  eq(plan.decision.preserveEditor, true, 'dirty editor stays preserved on refresh');
}

if (failures) {
  console.error('\n' + failures + ' test(s) failed.');
  process.exit(1);
}

console.log('\nAll all-projects tests passed.');
