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
const { resolveVariantFamily, classifyVariantParent, findVariantCycleMembers, wouldCreateVariantCycle } = await import(
  join(root, 'src/lib/variants/variants.ts')
);
const { getVariantOf, getVariantOfRaw, hasInvalidVariantOfType, withVariantOf } = await import(
  join(root, 'src/lib/prompts/types.ts')
);

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

console.log('variantOf — wrong YAML types are surfaced, not treated as absent');
{
  const num = summary('/p/A', 'a', 123).metadata;
  assert(getVariantOf(num) === undefined, 'getVariantOf returns undefined for a number');
  assert(hasInvalidVariantOfType(num), 'a number value is detected as a wrong type');
  const arr = summary('/p/A', 'a', ['foo']).metadata;
  assert(hasInvalidVariantOfType(arr), 'an array value is detected as a wrong type');
  eq(getVariantOfRaw(arr), ['foo'], 'the raw value is still readable');
  const missing = summary('/p/A', 'a').metadata;
  assert(!hasInvalidVariantOfType(missing), 'absent variantOf is not a wrong type');
  const empty = summary('/p/A', 'a', '').metadata;
  assert(!hasInvalidVariantOfType(empty), 'an empty string is treated as absent, not wrong type');
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
  const num = classifyVariantParent([summary('/p/A', 'x', 123)], { projectPath: '/p/A', name: 'x' });
  eq(num, { path: 'number: 123', status: 'invalid' }, 'a number variantOf is invalid, not absent');
  const arr = classifyVariantParent([summary('/p/A', 'x', ['foo'])], { projectPath: '/p/A', name: 'x' });
  eq(arr, { path: 'object: ["foo"]', status: 'invalid' }, 'an array variantOf is invalid, not absent');
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

console.log('wouldCreateVariantCycle — the UI must never create a cycle');
{
  // A <- B (B is a variant of A): A must not be able to pick B as its parent.
  const direct = [summary('/p/A', 'a'), summary('/p/A', 'b', 'a')];
  assert(wouldCreateVariantCycle(direct, { projectPath: '/p/A', name: 'a' }, 'b'), 'direct child of A is rejected as A\'s parent');
  assert(!wouldCreateVariantCycle(direct, { projectPath: '/p/A', name: 'b' }, 'a'), 'B may still pick A (A -> B is not a cycle)');

  // A <- B, B <- C: A must not pick B or C.
  const chain = [summary('/p/A', 'a'), summary('/p/A', 'b', 'a'), summary('/p/A', 'c', 'b')];
  assert(wouldCreateVariantCycle(chain, { projectPath: '/p/A', name: 'a' }, 'b'), 'direct descendant B is rejected for A');
  assert(wouldCreateVariantCycle(chain, { projectPath: '/p/A', name: 'a' }, 'c'), 'transitive descendant C is rejected for A');
  assert(!wouldCreateVariantCycle(chain, { projectPath: '/p/A', name: 'b' }, 'a'), 'middle node B may pick A');
  assert(!wouldCreateVariantCycle(chain, { projectPath: '/p/A', name: 'c' }, 'a'), 'leaf C may pick A');
  assert(!wouldCreateVariantCycle(chain, { projectPath: '/p/A', name: 'c' }, 'b'), 'leaf C may pick B');

  // Self is always rejected.
  assert(wouldCreateVariantCycle(direct, { projectPath: '/p/A', name: 'a' }, 'a'), 'a prompt can never be its own parent');

  // A missing candidate is broken, not a cycle.
  assert(!wouldCreateVariantCycle(direct, { projectPath: '/p/A', name: 'a' }, 'gone'), 'a missing candidate is not a cycle');

  // A pre-existing cycle elsewhere does not make a new cycle through A.
  const elsewhere = [summary('/p/A', 'a'), summary('/p/A', 'd', 'e'), summary('/p/A', 'e', 'd')];
  assert(!wouldCreateVariantCycle(elsewhere, { projectPath: '/p/A', name: 'a' }, 'd'), 'pointing at a pre-existing cycle not containing A is allowed');

  // No cross-project wiring: same names in another project are not A's family.
  const cross = [
    summary('/p/A', 'a'),
    summary('/p/B', 'b', 'a'),
  ];
  assert(!wouldCreateVariantCycle(cross, { projectPath: '/p/A', name: 'a' }, 'b'), 'a same-named prompt in another project is not a descendant');
}

console.log(failures === 0 ? 'variant contract: ok' : `variant contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
