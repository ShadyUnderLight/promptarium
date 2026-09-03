/**
 * Pure vectors for Related Prompts / Backlinks derivation (Issue #12).
 *
 * `related` in frontmatter is explicit; `Referenced by` is derived and never
 * written back. Resolution is scoped to the source prompt's project, so
 * same-named prompts in different projects never cross-wire. Invalid values
 * are surfaced, never silently normalized, and a self relation never recurses.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  resolveRelations,
  isCanonicalRelationPath,
  addRelatedEntry,
  removeRelatedEntry,
} = await import(join(root, 'src/lib/relations/relations.ts'));
const { aggregateScanResults } = await import(join(root, 'src/lib/library/all-projects.ts'));

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

function summary(projectPath, name, related = []) {
  return {
    projectPath,
    relativePath: name + '.md',
    name,
    folder: name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '',
    extension: '.md',
    metadata: {
      description: '',
      tags: [],
      status: 'active',
      favorite: false,
      models: [],
      related,
      extra: {},
    },
    modifiedAt: 0,
    hasFrontmatter: true,
  };
}

function linkStatuses(resolution) {
  return resolution.related.map((link) => link.status);
}

function linkTargets(resolution) {
  return resolution.related.map((link) => (link.target ? link.target.name : null));
}

function backlinkNames(resolution) {
  return resolution.referencedBy.map((prompt) => prompt.name);
}

console.log('resolveRelations — outgoing');
{
  const summaries = [
    summary('/p/A', 'coding/github/review-pr', ['coding/github/fix-pr']),
    summary('/p/A', 'coding/github/fix-pr'),
  ];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'coding/github/review-pr' });
  eq(linkStatuses(resolved), ['ok'], 'single target resolves');
  eq(linkTargets(resolved), ['coding/github/fix-pr'], 'resolved target carries the project-relative name');
  eq(resolved.related[0].target.projectPath, '/p/A', 'resolved target carries the source project path');
}

{
  const summaries = [
    summary('/p/A', 'a', ['b', 'c/d', 'e']),
    summary('/p/A', 'b'),
    summary('/p/A', 'c/d'),
    summary('/p/A', 'e'),
  ];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'a' });
  eq(linkTargets(resolved), ['b', 'c/d', 'e'], 'multi-target order is preserved as written');
}

{
  const summaries = [
    summary('/p/A', 'a', ['b', 'b', 'c', 'b']),
    summary('/p/A', 'b'),
    summary('/p/A', 'c'),
  ];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'a' });
  eq(linkTargets(resolved), ['b', 'c'], 'duplicate entries dedupe preserving first-appearance order');
}

{
  const summaries = [
    summary('/p/A', '写作/客户回复', ['检查/清单']),
    summary('/p/A', '检查/清单'),
  ];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: '写作/客户回复' });
  eq(linkStatuses(resolved), ['ok'], 'unicode nested folder path resolves');
}

console.log('resolveRelations — broken / invalid / self');
{
  const summaries = [summary('/p/A', 'a', ['coding/gone', 'b']), summary('/p/A', 'b')];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'a' });
  eq(linkStatuses(resolved), ['missing', 'ok'], 'missing target is broken, not hidden and not invalid');
}

{
  const summaries = [summary('/p/A', 'a', ['/Users/x', '../outside', 'b.md', 'a//b', ''])];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'a' });
  eq(
    linkStatuses(resolved),
    ['invalid', 'invalid', 'invalid', 'invalid', 'invalid'],
    'absolute / escape / .md / empty-segment / empty values are invalid, never normalized'
  );
}

{
  const summaries = [summary('/p/A', 'a', ['a'])];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'a' });
  eq(linkStatuses(resolved), ['self'], 'external hand-written self relation is surfaced safely');
  assert(!backlinkNames(resolved).includes('a'), 'self relation never appears as a backlink');
}

console.log('resolveRelations — no cross-project wiring');
{
  const summaries = [
    summary('/p/A', 'foo', ['shared/review']),
    summary('/p/A', 'shared/review'),
    summary('/p/B', 'shared/review'),
  ];
  // The selected prompt lives in project A; the other project has a same-named
  // prompt that must never become a backlink or a resolution target.
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'shared/review' });
  eq(backlinkNames(resolved), ['foo'], 'A backlink comes only from the same project');
  assert(
    resolved.referencedBy[0].projectPath === '/p/A',
    'backlink source keeps project A identity, not the same-named prompt in B'
  );
  const resolvedInB = resolveRelations(summaries, { projectPath: '/p/B', name: 'shared/review' });
  eq(backlinkNames(resolvedInB), [], 'project B has no same-project references');
}

console.log('resolveRelations — backlinks');
{
  const summaries = [summary('/p/A', 'a', ['b']), summary('/p/A', 'b')];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'b' });
  eq(backlinkNames(resolved), ['a'], 'A -> B means B incoming contains A');
}

{
  const summaries = [summary('/p/A', 'a', ['b']), summary('/p/A', 'c', ['b']), summary('/p/A', 'b')];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'b' });
  eq(backlinkNames(resolved), ['a', 'c'], 'A,C -> B means B incoming has both, sorted by name');
}

{
  const withA = [summary('/p/A', 'a', ['b']), summary('/p/A', 'b')];
  const withoutA = [summary('/p/A', 'b')];
  const resolved = resolveRelations(withoutA, { projectPath: '/p/A', name: 'b' });
  eq(backlinkNames(resolved), [], 'deleting A rebuilds B backlinks without A');
}

{
  const summaries = [
    summary('/p/A', 'a', ['b.md']), // invalid .md suffix: never a backlink source
    summary('/p/A', 'b'),
  ];
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'b' });
  eq(backlinkNames(resolved), [], 'non-canonical relation values do not become backlinks');
}

console.log('related editor helpers — add / remove by index');
{
  assert(
    JSON.stringify(addRelatedEntry(['a'], 'b')) === JSON.stringify(['a', 'b']),
    'add appends a new path'
  );
  assert(
    JSON.stringify(addRelatedEntry(['a', 'b'], 'b')) === JSON.stringify(['a', 'b']),
    'add is a no-op for an already-present path'
  );
  assert(
    JSON.stringify(addRelatedEntry(['a'], '')) === JSON.stringify(['a']),
    'add ignores an empty path'
  );
  // The backend preserves verbatim duplicates from hand-edited files, so the
  // editor renders the raw list and removal is by index: removing one copy
  // must leave the other intact (the P2 duplicate-key / value-based-removal
  // regression that a pure resolver test cannot see).
  assert(
    JSON.stringify(removeRelatedEntry(['coding/a', 'coding/a'], 0)) === JSON.stringify(['coding/a']),
    'removing index 0 of a duplicate pair keeps the remaining copy'
  );
  assert(
    JSON.stringify(removeRelatedEntry(['coding/a', 'coding/a'], 1)) === JSON.stringify(['coding/a']),
    'removing index 1 of a duplicate pair keeps the leading copy'
  );
  assert(
    JSON.stringify(removeRelatedEntry(['a', 'b', 'c'], 1)) === JSON.stringify(['a', 'c']),
    'removes exactly the entry at the given index'
  );
  assert(
    JSON.stringify(removeRelatedEntry(['a'], 5)) === JSON.stringify(['a']),
    'out-of-range index is a no-op'
  );
  assert(
    JSON.stringify(removeRelatedEntry([], 0)) === JSON.stringify([]),
    'removal from an empty list is a no-op'
  );
}

console.log('resolveRelations — relatedOverride drives outgoing, backlinks stay on disk');
{
  const summaries = [
    summary('/p/A', 'a', ['b', 'gone']),
    summary('/p/A', 'b'),
    summary('/p/A', 'c', ['b']),
  ];
  // The editor's local copy says `a` now links only to `c`, while the disk
  // summary still says ['b', 'gone']. The override must win for the outgoing
  // list; backlinks are computed from other prompts on disk.
  const resolved = resolveRelations(summaries, { projectPath: '/p/A', name: 'a' }, ['c']);
  eq(linkTargets(resolved), ['c'], 'override replaces the source outgoing list');
  eq(linkStatuses(resolved), ['ok'], 'override entries are still resolved and classified');
  eq(backlinkNames(resolved), [], 'backlinks never come from the override');
}
{
  // An empty override hides outgoing while the disk copy still carries links
  // (dirty editor removed all relations, not yet saved).
  const summaries = [summary('/p/A', 'a', ['b']), summary('/p/A', 'b')];
  const edited = resolveRelations(summaries, { projectPath: '/p/A', name: 'a' }, []);
  eq(linkStatuses(edited), [], 'empty override shows no outgoing while unsaved');
  const diskView = resolveRelations(summaries, { projectPath: '/p/A', name: 'b' });
  eq(backlinkNames(diskView), ['a'], 'disk summaries still provide backlinks for other prompts');
}

console.log('integration — scan -> allPrompts rebuild -> backlinks update');
{
  // scan v1: foo -> shared/review, committed through the real All Projects
  // aggregation before the relation resolver runs.
  let all = aggregateScanResults([
    {
      projectPath: '/p/A',
      revision: 1,
      summaries: [
        summary('/p/A', 'shared/review'),
        summary('/p/A', 'foo', ['shared/review']),
      ],
    },
  ]);
  let resolved = resolveRelations(all, { projectPath: '/p/A', name: 'shared/review' });
  eq(backlinkNames(resolved), ['foo'], 'backlink derives from the committed scan');

  // External edit removes the relation; the project is re-scanned and the
  // rebuilt allPrompts no longer produce the backlink.
  all = aggregateScanResults([
    {
      projectPath: '/p/A',
      revision: 2,
      summaries: [
        summary('/p/A', 'shared/review'),
        summary('/p/A', 'foo'),
      ],
    },
  ]);
  resolved = resolveRelations(all, { projectPath: '/p/A', name: 'shared/review' });
  eq(backlinkNames(resolved), [], 're-scan with changed metadata rebuilds backlinks');

  // A forgotten project is dropped from the roster, so its scan never enters
  // the aggregate and its relation index cannot pollute a registered project.
  const forgotten = {
    projectPath: '/p/GONE',
    revision: 1,
    summaries: [
      summary('/p/GONE', 'shared/review'),
      summary('/p/GONE', 'foo', ['shared/review']),
    ],
  };
  const registered = resolveRelations(all, { projectPath: '/p/A', name: 'shared/review' });
  eq(backlinkNames(registered), [], 'forgotten project (excluded from aggregate) does not pollute All Projects');
  // When a scan is present, resolution still stays inside that project only.
  const gone = resolveRelations(aggregateScanResults([forgotten]), {
    projectPath: '/p/GONE',
    name: 'shared/review',
  });
  eq(backlinkNames(gone), ['foo'], 'included scan resolves within its own project only');
}

console.log('isCanonicalRelationPath');
{
  const valid = ['coding/github/fix-pr', 'review/检查清单', 'a-b_c', 'x'];
  for (const value of valid) {
    assert(isCanonicalRelationPath(value), value + ' should be canonical');
  }
  const invalid = ['', 'x.md', '/abs', 'a/../b', '../x', 'a//b', 'a\\b', 'a:b', 'a/..', '.'];
  for (const value of invalid) {
    assert(!isCanonicalRelationPath(value), value + ' should be invalid');
  }
}

console.log(failures === 0 ? 'relation contract: ok' : `relation contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
