/**
 * Pure-function tests for incremental search index planning.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  fingerprintsMatch,
  planIndexRefresh,
  summaryFingerprint,
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

function summary(name, modifiedAt = 1000, sizeBytes = 100, description = '') {
  return {
    projectPath: '/project-a',
    relativePath: name + '.md',
    name,
    folder: name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '',
    extension: '.md',
    metadata: { ...defaultMetadata, description },
    modifiedAt,
    sizeBytes,
    hasFrontmatter: false,
  };
}

function entry(name, modifiedAt, sizeBytes, bodyLower = 'alpha body', variableCount = 1) {
  const s = summary(name, modifiedAt, sizeBytes);
  return {
    summary: s,
    fingerprint: { modifiedAt, sizeBytes },
    bodyLower,
    variableCount,
  };
}

function planNames(plan) {
  return {
    reused: [...plan.reused.keys()].sort(),
    toRead: plan.toRead.map((item) => item.name).sort(),
    removed: [...plan.removed].sort(),
  };
}

console.log('fingerprints');
eq(
  fingerprintsMatch({ modifiedAt: 1, sizeBytes: 2 }, { modifiedAt: 1, sizeBytes: 2 }),
  true,
  'matching fingerprints'
);
eq(
  fingerprintsMatch({ modifiedAt: 1, sizeBytes: 2 }, { modifiedAt: 1, sizeBytes: 3 }),
  false,
  'size mismatch'
);
eq(
  fingerprintsMatch({ modifiedAt: 1, sizeBytes: 2 }, { modifiedAt: 2, sizeBytes: 2 }),
  false,
  'mtime mismatch'
);

console.log('first build reads everything');
{
  const plan = planIndexRefresh(undefined, [summary('a'), summary('b')]);
  eq(planNames(plan), { reused: [], toRead: ['a', 'b'], removed: [] }, 'no old index');
}

console.log('unchanged summaries reuse entries');
{
  const old = new Map([
    ['a', entry('a', 1000, 100)],
    ['b', entry('b', 2000, 200)],
  ]);
  const plan = planIndexRefresh(old, [summary('a', 1000, 100), summary('b', 2000, 200)]);
  eq(planNames(plan), { reused: ['a', 'b'], toRead: [], removed: [] }, 'all reused');
  eq(plan.reused.get('a')?.bodyLower, 'alpha body', 'body cache preserved');
}

console.log('single file change only rereads that file');
{
  const old = new Map([
    ['a', entry('a', 1000, 100)],
    ['b', entry('b', 2000, 200)],
  ]);
  const plan = planIndexRefresh(old, [summary('a', 1000, 100), summary('b', 2000, 201)]);
  eq(planNames(plan), { reused: ['a'], toRead: ['b'], removed: [] }, 'one changed');
}

console.log('new file only reads new file');
{
  const old = new Map([['a', entry('a', 1000, 100)]]);
  const plan = planIndexRefresh(old, [summary('a', 1000, 100), summary('new-file', 3000, 300)]);
  eq(planNames(plan), { reused: ['a'], toRead: ['new-file'], removed: [] }, 'new prompt');
}

console.log('deleted file removes entry');
{
  const old = new Map([
    ['a', entry('a', 1000, 100)],
    ['gone', entry('gone', 2000, 200)],
  ]);
  const plan = planIndexRefresh(old, [summary('a', 1000, 100)]);
  eq(planNames(plan), { reused: ['a'], toRead: [], removed: ['gone'] }, 'removed prompt');
}

console.log('rename is remove old plus read new');
{
  const old = new Map([['old-name', entry('old-name', 1000, 100)]]);
  const plan = planIndexRefresh(old, [summary('new-name', 1000, 100)]);
  eq(planNames(plan), { reused: [], toRead: ['new-name'], removed: ['old-name'] }, 'rename identity');
}

console.log('reused entry updates summary metadata');
{
  const old = new Map([['a', entry('a', 1000, 100, 'alpha body', 2)]]);
  const plan = planIndexRefresh(old, [summary('a', 1000, 100, 'updated description')]);
  eq(plan.reused.get('a')?.summary.metadata.description, 'updated description', 'summary refreshed');
  eq(plan.reused.get('a')?.bodyLower, 'alpha body', 'body cache kept');
  eq(plan.reused.get('a')?.variableCount, 2, 'variable count kept');
}

console.log('project isolation via separate maps');
{
  const projectA = new Map([['shared', entry('shared', 1000, 100)]]);
  const projectB = new Map([['shared', entry('shared', 5000, 500, 'other body', 3)]]);
  const planA = planIndexRefresh(projectA, [summary('shared', 1000, 100)]);
  const planB = planIndexRefresh(projectB, [summary('shared', 5000, 500)]);
  eq(planA.reused.get('shared')?.bodyLower, 'alpha body', 'project A cache');
  eq(planB.reused.get('shared')?.bodyLower, 'other body', 'project B cache');
}

console.log('summary fingerprint helper');
eq(summaryFingerprint(summary('x', 42, 99)), { modifiedAt: 42, sizeBytes: 99 }, 'fingerprint from summary');

if (failures > 0) {
  console.error('\n' + failures + ' search index test(s) failed');
  process.exit(1);
}

console.log('\nAll search index tests passed.');
