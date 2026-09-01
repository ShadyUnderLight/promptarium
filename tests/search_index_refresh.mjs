/**
 * Orchestration tests for incremental search index refresh (stale swap + read stats).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  buildSearchIndexFromPlan,
  isStaleSearchIndexSwap,
  planIndexRefresh,
  searchEntryFromDocument,
} = await import(join(root, 'src/lib/library/search-index.ts'));

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

function summary(name, modifiedAt = 1000, sizeBytes = 100) {
  return {
    projectPath: '/project-a',
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

function document(name, modifiedAt, sizeBytes, body) {
  return {
    ...summary(name, modifiedAt, sizeBytes),
    body,
    raw: body,
  };
}

function entry(name, modifiedAt, sizeBytes, bodyLower, variableCount) {
  return searchEntryFromDocument(document(name, modifiedAt, sizeBytes, bodyLower));
}

console.log('stale swap detection');
eq(isStaleSearchIndexSwap(0, 0), false, 'unchanged revision');
eq(isStaleSearchIndexSwap(0, 1), true, 'mutation during rebuild');

console.log('build stats count body reads separately from selected reuse');
{
  const plan = planIndexRefresh(undefined, [summary('a'), summary('b')]);
  const selected = searchEntryFromDocument(document('a', 1000, 100, 'selected body'));
  const { stats } = await buildSearchIndexFromPlan(plan, {
    projectPath: '/project-a',
    selectedEntry: (prompt) => (prompt.name === 'a' ? selected : null),
    readBody: async (prompt) => searchEntryFromDocument(document(prompt.name, 1000, 100, 'read body')),
  });
  eq(stats.planned, 2, 'planned both prompts');
  eq(stats.selectedReuses, 1, 'one selected reuse');
  eq(stats.bodyReads, 1, 'one native body read');
}

console.log('deferred rebuild does not clobber a saved entry when revision changes');
{
  const projectPath = '/project-a';
  const oldIndex = new Map([['a', entry('a', 1000, 100, 'old body')]]);
  const scanSummaries = [summary('a', 1000, 100)];
  const revisionAtStart = 0;

  const plan = planIndexRefresh(oldIndex, scanSummaries);
  const { index: staleCandidate } = await buildSearchIndexFromPlan(plan, {
    projectPath,
    readBody: async () => {
      throw new Error('unchanged prompt should reuse cached body without reading');
    },
  });
  eq(staleCandidate.get('a')?.bodyLower, 'old body'.toLowerCase(), 'candidate reuses stale cached body');

  const saved = document('a', 2000, 150, 'saved body {x} {y}');
  const liveIndex = new Map([['a', searchEntryFromDocument(saved)]]);
  const revision = 1;

  assert(isStaleSearchIndexSwap(revisionAtStart, revision), 'save bumped revision during rebuild');
  assert(!isStaleSearchIndexSwap(revisionAtStart, revisionAtStart), 'swap proceeds when revision unchanged');

  const replan = planIndexRefresh(liveIndex, scanSummaries);
  eq(replan.toRead.map((item) => item.name), ['a'], 'replan rereads prompt whose live fingerprint diverged');
  const { index: freshIndex } = await buildSearchIndexFromPlan(replan, {
    projectPath,
    readBody: async () => searchEntryFromDocument(saved),
  });
  eq(freshIndex.get('a')?.bodyLower, 'saved body {x} {y}'.toLowerCase(), 'fresh index keeps saved body');
  eq(freshIndex.get('a')?.variableCount, 2, 'fresh index keeps saved variable count');
}

console.log('replan after save preserves unrelated reused entries');
{
  const savedA = document('a', 3000, 120, 'newer saved body {a}');
  const liveIndex = new Map([
    ['a', searchEntryFromDocument(savedA)],
    ['b', entry('b', 2000, 200, 'stable body')],
  ]);
  const staleScan = [summary('a', 1000, 100), summary('b', 2000, 200)];
  const replan = planIndexRefresh(liveIndex, staleScan);
  eq(replan.toRead.map((item) => item.name), ['a'], 'only changed prompt is reread');
  eq([...replan.reused.keys()], ['b'], 'stable prompt stays reused');
}

console.log('suspended body read cannot clobber a saved entry');
{
  const projectPath = '/project-a';
  const plan = planIndexRefresh(undefined, [summary('a', 1000, 100)]);
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });

  const buildPromise = buildSearchIndexFromPlan(plan, {
    projectPath,
    readBody: async () => {
      await readGate;
      return searchEntryFromDocument(document('a', 1000, 100, 'slow disk body'));
    },
  });

  const saved = document('a', 2000, 150, 'saved during read {x}');
  const liveIndex = new Map([['a', searchEntryFromDocument(saved)]]);
  const revisionAtStart = 0;
  const revisionAfterSave = 1;

  assert(isStaleSearchIndexSwap(revisionAtStart, revisionAfterSave), 'save during suspended read');

  releaseRead();
  const { index: staleCandidate, stats } = await buildPromise;
  eq(stats.bodyReads, 1, 'one deferred body read');
  eq(staleCandidate.get('a')?.bodyLower, 'slow disk body'.toLowerCase(), 'candidate built from slow read');

  const replan = planIndexRefresh(liveIndex, [summary('a', 1000, 100)]);
  const { index: freshIndex } = await buildSearchIndexFromPlan(replan, {
    projectPath,
    readBody: async () => searchEntryFromDocument(saved),
  });
  eq(freshIndex.get('a')?.bodyLower, 'saved during read {x}'.toLowerCase(), 'replan keeps saved body');
  eq(freshIndex.get('a')?.variableCount, 1, 'replan keeps saved variable count');
}

if (failures > 0) {
  console.error('\n' + failures + ' search index refresh test(s) failed');
  process.exit(1);
}

console.log('\nAll search index refresh tests passed.');
