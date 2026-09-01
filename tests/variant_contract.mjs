/**
 * Pure vectors for Prompt Variants (Issue #14).
 *
 * `variantOf` in frontmatter is the explicit, user-owned parent relation inside
 * the same project. Resolution is scoped by the source prompt's project (two
 * projects with the same name never cross-wire), uses the same canonical
 * relative-path rules as `related`, and surfaces invalid / broken / self values
 * instead of hiding or normalizing them. Family members (parent / children /
 * siblings) are derived state and are never written back to any Markdown file.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { resolveVariantFamily, classifyVariantParent, findVariantCycleMembers } = await import(
  join(root, 'src/lib/variants/variants.ts')
);
const { getVariantOf, withVariantOf } = await import(join(root, 'src/lib/prompts/types.ts'));

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

function summary(projectPath, name, variantOf) {
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
      related: [],
      extra: variantOf ? { variantOf } : {},
    },
    modifiedAt: 0,
    sizeBytes: 0,
    hasFrontmatter: true,
  };
}

function childNames(family) {
  return family.children.map((prompt) => prompt.name);
}

function siblingNames(family) {
  return family.siblings.map((prompt) => prompt.name);
}

console.log('variantOf read / write helpers');
{
  const base = summary('/p/A', 'a').metadata;
  assert(getVariantOf(base) === undefined, 'missing variantOf reads as undefined');
  assert(getVariantOf({ ...base, extra: { variantOf: '' } }) === undefined, 'empty variantOf reads as undefined');
  const set = withVariantOf(base, 'coding/review');
  eq(getVariantOf(set), 'coding/review', 'withVariantOf sets the parent path');
  assert(!('variantOf' in withVariantOf(set, undefined).extra), 'withVariantOf(undefined) removes the key');
  assert(!('variantOf' in withVariantOf(set, '').extra), 'withVariantOf(empty) removes the key');
  eq(withVariantOf(base, '  coding/review ').extra.variantOf, 'coding/review', 'withVariantOf trims the path');
}

console.log('classifyVariantParent');
{
  const summaries = [summary('/p/A', 'review'), summary('/p/A', 'review-claude', 'review')];
  const ok = classifyVariantParent(summaries, { projectPath: '/p/A', name: 'review-claude' });
  eq(ok, { path: 'review', status: 'ok', target: { projectPath: '/p/A', name: 'review' } }, 'canonical target resolves');
  assert(classifyVariantParent(summaries, { projectPath: '/p/A', name: 'review' }) === null, 'no variantOf is null');
  const missing = classifyVariantParent([summary('/p/A', 'review-claude', 'gone')], {
    projectPath: '/p/A',
    name: 'review-claude',
  });
  eq(missing.status, 'missing', 'non-existent parent is missing, not hidden');
  const invalid = classifyVariantParent([summary('/p/A', 'x', '../escape')], { projectPath: '/p/A', name: 'x' });
  eq(invalid.status, 'invalid', 'path-escape parent is invalid');
  const withMd = classifyVariantParent([summary('/p/A', 'x', 'review.md')], { projectPath: '/p/A', name: 'x' });
  eq(withMd.status, 'invalid', 'variantOf with a .md suffix is invalid');
  const self = classifyVariantParent([summary('/p/A', 'x', 'x')], { projectPath: '/p/A', name: 'x' });
  eq(self.status, 'self', 'self variantOf is self');
  const abs = classifyVariantParent([summary('/p/A', 'x', '/Users/me/p')], { projectPath: '/p/A', name: 'x' });
  eq(abs.status, 'invalid', 'absolute variantOf is invalid');
}

console.log('resolveVariantFamily — parent');
{
  const summaries = [summary('/p/A', 'review'), summary('/p/A', 'review-claude', 'review')];
  const family = resolveVariantFamily(summaries, { projectPath: '/p/A', name: 'review-claude' });
  eq(family.parent.status, 'ok', 'child resolves its parent');
  eq(family.parent.target.name, 'review', 'parent target carries the project-relative name');
  assert(childNames(family).length === 0, 'a child has no children of its own here');
}

console.log('resolveVariantFamily — children');
{
  const summaries = [
    summary('/p/A', 'review'),
    summary('/p/A', 'review-claude', 'review'),
    summary('/p/A', 'review-gpt', 'review'),
    summary('/p/A', 'other'),
  ];
  const family = resolveVariantFamily(summaries, { projectPath: '/p/A', name: 'review' });
  eq(childNames(family), ['review-claude', 'review-gpt'], 'parent lists its children sorted by name');
  eq(siblingNames(family), [], 'parent has no siblings');
}

console.log('resolveVariantFamily — siblings');
{
  const summaries = [
    summary('/p/A', 'review'),
    summary('/p/A', 'review-claude', 'review'),
    summary('/p/A', 'review-gpt', 'review'),
  ];
  const family = resolveVariantFamily(summaries, { projectPath: '/p/A', name: 'review-claude' });
  eq(siblingNames(family), ['review-gpt'], 'a child sees its siblings under the shared parent');
  assert(!childNames(family).includes('review-claude'), 'a child is never its own sibling');
}

console.log('resolveVariantFamily — invalid/self never become children');
{
  const summaries = [
    summary('/p/A', 'review'),
    summary('/p/A', 'bad-md', 'review.md'),
    summary('/p/A', 'escape', '../review'),
    summary('/p/A', 'self', 'self'),
  ];
  const family = resolveVariantFamily(summaries, { projectPath: '/p/A', name: 'review' });
  eq(childNames(family), [], 'non-canonical or self variantOf values are not family members');
}

console.log('resolveVariantFamily — no cross-project wiring');
{
  const summaries = [
    summary('/p/A', 'review'),
    summary('/p/A', 'review-claude', 'review'),
    summary('/p/B', 'review'),
    summary('/p/B', 'review-claude', 'review'),
  ];
  const inA = resolveVariantFamily(summaries, { projectPath: '/p/A', name: 'review' });
  eq(childNames(inA), ['review-claude'], 'project A children come only from project A');
  const inB = resolveVariantFamily(summaries, { projectPath: '/p/B', name: 'review' });
  eq(childNames(inB), ['review-claude'], 'project B children come only from project B');
  // A prompt in A must not resolve its parent against the same-named prompt in B.
  const childA = resolveVariantFamily(summaries, { projectPath: '/p/A', name: 'review-claude' });
  eq(childA.parent.target.projectPath, '/p/A', 'child parent stays inside its own project');
}

console.log('findVariantCycleMembers');
{
  const noCycle = [summary('/p/A', 'a', 'b'), summary('/p/A', 'b', 'c'), summary('/p/A', 'c')];
  eq(findVariantCycleMembers(noCycle, '/p/A'), [], 'a simple chain with no loop has no cycle members');

  const two = [summary('/p/A', 'a', 'b'), summary('/p/A', 'b', 'a')];
  eq(findVariantCycleMembers(two, '/p/A'), ['a', 'b'], 'A -> B -> A marks both members');

  const three = [summary('/p/A', 'a', 'b'), summary('/p/A', 'b', 'c'), summary('/p/A', 'c', 'b')];
  eq(findVariantCycleMembers(three, '/p/A'), ['b', 'c'], 'B -> C -> B marks only the loop members');

  // A chain leading into a loop marks the loop, not the tail.
  const tail = [summary('/p/A', 'a', 'b'), summary('/p/A', 'b', 'c'), summary('/p/A', 'c', 'b')];
  eq(findVariantCycleMembers(tail, '/p/A'), ['b', 'c'], 'a tail leading into a cycle is not itself a member');

  const self = [summary('/p/A', 'a', 'a')];
  eq(findVariantCycleMembers(self, '/p/A'), [], 'a self reference is not reported as a cycle');

  const selfAndCycle = [summary('/p/A', 'self', 'self'), summary('/p/A', 'a', 'b'), summary('/p/A', 'b', 'a')];
  eq(
    findVariantCycleMembers(selfAndCycle, '/p/A'),
    ['a', 'b'],
    'self reference is excluded while a real cycle is still found'
  );

  const broken = [summary('/p/A', 'a', 'b'), summary('/p/A', 'b', 'gone')];
  eq(findVariantCycleMembers(broken, '/p/A'), [], 'a missing edge terminates the walk, not a cycle');

  const crossProject = [summary('/p/A', 'a', 'b'), summary('/p/A', 'b', 'a'), summary('/p/B', 'a', 'b')];
  eq(findVariantCycleMembers(crossProject, '/p/A'), ['a', 'b'], 'cycle detection is scoped to the project');
}

console.log(failures === 0 ? 'variant contract: ok' : `variant contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
