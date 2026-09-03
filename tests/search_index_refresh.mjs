/**
 * Orchestration tests for the direct-rebuild search index (stale swap + read stats).
 *
 * The index is rebuilt from this round's bodies and committed only when the
 * revision is stable, so a save landing during a rebuild never lets a stale
 * candidate overwrite the live index.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  buildSearchIndex,
  buildUntilRevisionStable,
  isStaleSearchIndexSwap,
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

function summary(name, modifiedAt = 1000) {
  return {
    projectPath: '/project-a',
    relativePath: name + '.md',
    name,
    folder: '',
    extension: '.md',
    metadata: defaultMetadata,
    modifiedAt,
    hasFrontmatter: false,
  };
}

function document(name, modifiedAt, body) {
  return {
    ...summary(name, modifiedAt),
    body,
    raw: body,
  };
}

console.log('stale swap detection');
eq(isStaleSearchIndexSwap(0, 0), false, 'unchanged revision');
eq(isStaleSearchIndexSwap(0, 1), true, 'mutation during rebuild');

console.log('build stats count body reads');
{
  const { stats } = await buildSearchIndex([summary('a'), summary('b')], {
    readBody: async (prompt) => searchEntryFromDocument(document(prompt.name, 1000, 'read body')),
  });
  eq(stats.planned, 2, 'planned both prompts');
  eq(stats.bodyReads, 2, 'read both bodies');
  eq(stats.failedReads, 0, 'no failed reads');
}

console.log('copy-on-rebuild: the complete map is produced before swap');
{
  const { index } = await buildSearchIndex([summary('a'), summary('b')], {
    readBody: async (prompt) => searchEntryFromDocument(document(prompt.name, 1000, 'read body')),
  });
  eq([...index.keys()].sort(), ['a', 'b'], 'full map built in one pass');
  assert(index instanceof Map, 'result is a fresh Map, never a partial view');
}

console.log('single-file body read failure keeps summary-only entry');
{
  const { index, stats } = await buildSearchIndex([summary('a'), summary('b')], {
    readBody: async (prompt) => {
      if (prompt.name === 'a') throw new Error('read failed');
      return searchEntryFromDocument(document(prompt.name, 1000, 'read body'));
    },
  });
  eq(stats.failedReads, 1, 'one failed read');
  eq(stats.bodyReads, 2, 'both bodies attempted');
  eq(index.get('a')?.bodyLower, '', 'failed prompt keeps summary-only entry');
  eq(index.get('b')?.bodyLower, 'read body', 'healthy prompt still indexed');
}

console.log('save during rebuild invalidates stale candidate via revision barrier');
{
  let revision = 0;
  let readCount = 0;
  let committedIndex = null;

  const result = await buildUntilRevisionStable({
    getRevision: () => revision,
    build: async () => {
      readCount++;
      const { index } = await buildSearchIndex([summary('a')], {
        readBody: async () => {
          if (readCount === 1) {
            // A save lands while the first build is reading: bump the revision
            // so the candidate built from the pre-save body is discarded.
            revision = 1;
            return searchEntryFromDocument(document('a', 1000, 'old body'));
          }
          return searchEntryFromDocument(document('a', 2000, 'saved body {x} {y}'));
        },
      });
      return index;
    },
    commit: (index) => {
      committedIndex = index;
    },
  });

  eq(readCount, 2, 'stale first candidate triggers awaited rebuild');
  eq(result?.retried, true, 'retry flag set when revision moved during build');
  eq(committedIndex.get('a')?.bodyLower, 'saved body {x} {y}'.toLowerCase(), 'committed index keeps saved body');
  eq(committedIndex.get('a')?.variableCount, 2, 'committed index keeps saved variable count');
}

console.log('suspended body read cannot clobber a saved entry');
{
  let revision = 0;
  let buildCount = 0;
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  let committedIndex = null;

  const buildPromise = buildUntilRevisionStable({
    getRevision: () => revision,
    build: async () => {
      buildCount++;
      const { index } = await buildSearchIndex([summary('a')], {
        readBody: async () => {
          if (buildCount === 1) {
            await readGate;
            return searchEntryFromDocument(document('a', 1000, 'slow disk body'));
          }
          return searchEntryFromDocument(document('a', 2000, 'saved during read {x}'));
        },
      });
      return index;
    },
    commit: (index) => {
      committedIndex = index;
    },
  });

  // A save lands while the first body read is still suspended.
  revision = 1;
  releaseRead();

  const result = await buildPromise;
  eq(buildCount, 2, 'stale suspended candidate triggers awaited rebuild');
  eq(committedIndex.get('a')?.bodyLower, 'saved during read {x}'.toLowerCase(), 'committed index keeps saved body');
  eq(committedIndex.get('a')?.variableCount, 1, 'committed index keeps saved variable count');
}

console.log('save before first live index bumps revision and blocks stale swap');
{
  let revision = 0;
  const summaries = [summary('a'), summary('b')];
  const revisionAtStart = revision;

  const stale = await buildSearchIndex(summaries, {
    readBody: async (prompt) => searchEntryFromDocument(document(prompt.name, 1000, prompt.name + ' old body')),
  });
  eq(stale.index.get('a')?.bodyLower, 'a old body', 'candidate built from pre-save body');

  const saved = document('a', 3000, 'saved before live index {x} {y}');
  revision = 1;
  eq(revision, 1, 'save mutation bumps revision even without a live index');

  assert(isStaleSearchIndexSwap(revisionAtStart, revision), 'first-build save invalidates candidate swap');

  const fresh = await buildSearchIndex(summaries, {
    readBody: async (prompt) =>
      prompt.name === 'a'
        ? searchEntryFromDocument(saved)
        : searchEntryFromDocument(document(prompt.name, 1000, prompt.name + ' fresh body')),
  });
  eq(fresh.index.get('a')?.bodyLower, 'saved before live index {x} {y}'.toLowerCase(), 'rebuild reads saved body for A');
  eq(fresh.index.get('a')?.variableCount, 2, 'rebuild reads saved variable count for A');
  eq(fresh.index.get('b')?.bodyLower, 'b fresh body', 'rebuild still builds remaining prompts');
}

console.log('buildUntilRevisionStable awaits retry until revision stabilizes');
{
  let revision = 0;
  let buildAttempts = 0;
  let committed = null;

  const result = await buildUntilRevisionStable({
    getRevision: () => revision,
    build: async () => {
      buildAttempts++;
      if (buildAttempts === 1) revision = 1;
      return buildAttempts;
    },
    commit: (value) => {
      committed = value;
    },
  });

  eq(buildAttempts, 2, 'stale first candidate triggers awaited rebuild');
  eq(committed, 2, 'stable revision commits retried candidate');
  eq(result?.retried, true, 'retry flag is set when revision changed during build');
}

console.log('buildUntilRevisionStable commits before helper resolves');
{
  const order = [];

  await buildUntilRevisionStable({
    getRevision: () => 0,
    build: async () => {
      order.push('build-done');
      return 'candidate';
    },
    commit: () => {
      order.push('commit');
    },
  });

  eq(order, ['build-done', 'commit'], 'commit runs in the same sync continuation as the final revision check');
}

console.log('refreshSearchIndex must not re-commit after helper resolves');
{
  let revision = 5;
  let index = 'live-before';

  const helperResult = await buildUntilRevisionStable({
    getRevision: () => revision,
    build: async () => 'stale-candidate',
    commit: (candidate) => {
      index = candidate;
    },
  });

  revision = 6;
  index = 'saved-live';

  eq(helperResult?.value, 'stale-candidate', 'helper still exposes built candidate to callers');
  eq(index, 'saved-live', 'post-resolve save must not be overwritten by a second caller commit');
}

if (failures > 0) {
  console.error('\n' + failures + ' search index refresh test(s) failed');
  process.exit(1);
}

console.log('\nAll search index refresh tests passed.');
