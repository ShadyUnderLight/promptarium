/**
 * Pure vectors for Prompt Compare (Issue #14).
 *
 * diffTexts produces a unified-style patch between two current Markdown bodies
 * (not a commit patch), rendered by the same DiffViewer as Git History.
 * diffMetadata produces a deterministic list of metadata field differences.
 * Both are pure, so they are tested as plain vectors here.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { diffTexts, diffMetadata } = await import(join(root, 'src/lib/prompts/compare.ts'));
const { parseDiffLines } = await import(join(root, 'src/lib/prompts/diff-lines.ts'));

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

function kinds(patch) {
  // The patch ends with a newline, so parseDiffLines yields a trailing empty
  // context line (same artifact as a Git History patch). Ignore empty-text
  // lines when classifying so assertions target the real diff content.
  return parseDiffLines(patch)
    .filter((line) => line.text !== '')
    .map((line) => line.kind);
}

function texts(patch) {
  return parseDiffLines(patch)
    .filter((line) => line.text !== '')
    .map((line) => line.text);
}

function metadata(overrides = {}) {
  return {
    description: 'desc',
    tags: ['a', 'b'],
    status: 'active',
    favorite: false,
    models: ['ChatGPT'],
    related: ['other'],
    variables: { focus: { description: 'Focus' } },
    extra: {},
    ...overrides,
  };
}

console.log('diffTexts — identical bodies');
eq(diffTexts('same', 'same'), '', 'identical bodies produce an empty patch');
eq(diffTexts('', ''), '', 'two empty bodies produce an empty patch');

console.log('diffTexts — line add / remove / context classification');
{
  const patch = diffTexts('a\nb\nc', 'a\nx\nc');
  eq(kinds(patch), ['meta', 'context', 'remove', 'add', 'context'], 'a single replacement classifies as remove + add with context');
  assert(texts(patch).some((line) => line === '-b'), 'the removed line carries a minus prefix');
  assert(texts(patch).some((line) => line === '+x'), 'the added line carries a plus prefix');
}

{
  const patch = diffTexts('a\nb\nc', 'a\nb\nc\nd');
  eq(kinds(patch).filter((kind) => kind === 'add').length, 1, 'an appended line is one add');
  eq(kinds(patch).filter((kind) => kind === 'remove').length, 0, 'an appended line is not a remove');
}

{
  const patch = diffTexts('a\nb\nc', 'a\nc');
  eq(kinds(patch).filter((kind) => kind === 'remove').length, 1, 'a removed line is one remove');
  eq(kinds(patch).filter((kind) => kind === 'add').length, 0, 'a removed line is not an add');
}

console.log('diffTexts — edits far apart split into hunks');
{
  const a = 'a1\na2\na3\na4\na5\na6\na7\na8\na9\na10';
  const b = 'CHANGED1\na2\na3\na4\na5\na6\na7\na8\na9\nCHANGED10';
  const patch = diffTexts(a, b);
  const metas = parseDiffLines(patch).filter((line) => line.kind === 'meta');
  assert(metas.length >= 2, 'distant edits produce more than one hunk');
}

console.log('diffTexts — deterministic');
{
  const a = 'line one\nline two\nline three';
  const b = 'line one\nLINE TWO\nline three\nline four';
  eq(diffTexts(a, b), diffTexts(a, b), 'equal inputs produce identical patches');
}

console.log('diffTexts — empty side');
{
  const patch = diffTexts('', 'x\ny');
  assert(patch.length > 0, 'diff against an empty body is non-empty');
  eq(parseDiffLines(patch).filter((line) => line.kind === 'add').length, 2, 'empty -> two lines is two adds');
}

console.log('diffMetadata — identical metadata');
eq(diffMetadata(metadata(), metadata()), [], 'identical metadata produces no differences');

console.log('diffMetadata — field differences');
{
  const diffs = diffMetadata(metadata(), metadata({ status: 'draft' }));
  eq(diffs.length, 1, 'a single changed field produces one difference');
  eq(diffs[0].field, 'status', 'the changed field is named');
}

{
  const diffs = diffMetadata(metadata({ tags: ['a'] }), metadata({ tags: ['a', 'b'] }));
  eq(diffs.length, 1, 'tag change produces one difference');
  eq(diffs[0].field, 'tags', 'tag difference names the tags field');
  eq(diffs[0].left, 'a', 'left side renders the selected prompt tags');
  eq(diffs[0].right, 'a, b', 'right side renders the compared prompt tags');
}

console.log('diffMetadata — variantOf and extra');
{
  const diffs = diffMetadata(metadata({ extra: { variantOf: 'parent' } }), metadata({ extra: { variantOf: 'other' } }));
  const variant = diffs.find((d) => d.field === 'variantOf');
  assert(variant, 'variantOf difference is reported on its own row');
  assert(!diffs.find((d) => d.field === 'extra'), 'variantOf is excluded from the extra row to avoid double reporting');
}

{
  const diffs = diffMetadata(metadata({ extra: { owner: 'lmz' } }), metadata({ extra: {} }));
  const extra = diffs.find((d) => d.field === 'extra');
  assert(extra, 'an unknown extra field difference is reported on the extra row');
  eq(extra.left, 'owner: "lmz"', 'left extra renders deterministically');
  eq(extra.right, '(none)', 'missing extra renders as (none)');
}

console.log('diffMetadata — notes');
{
  const diffs = diffMetadata(metadata({ notes: 'Works best on small PRs.' }), metadata({ notes: 'Works best on large PRs.' }));
  const notes = diffs.find((d) => d.field === 'notes');
  assert(notes, 'a notes difference is reported on its own row');
  eq(notes.left, 'Works best on small PRs.', 'left side renders the selected prompt notes');
  eq(notes.right, 'Works best on large PRs.', 'right side renders the compared prompt notes');
  assert(!diffs.find((d) => d.field === 'extra'), 'notes is excluded from the extra row to avoid double reporting');
}

{
  const diffs = diffMetadata(metadata(), metadata({ notes: 'added' }));
  const notes = diffs.find((d) => d.field === 'notes');
  assert(notes, 'a notes add is reported');
  eq(notes.left, '(none)', 'missing notes renders as (none)');
  eq(notes.right, 'added', 'added notes render on the right');
}

{
  const diffs = diffMetadata(metadata({ notes: '' }), metadata());
  assert(!diffs.find((d) => d.field === 'notes'), 'empty notes and missing notes are the same state — no notes diff');
}

{
  const diffs = diffMetadata(metadata({ notes: '   ' }), metadata());
  const notes = diffs.find((d) => d.field === 'notes');
  assert(notes, 'whitespace-only notes are NOT normalized to (none)');
  eq(notes.left, '   ', 'whitespace-only notes render as-is');
  eq(notes.right, '(none)', 'missing notes renders as (none)');
}

console.log('diffMetadata — wrong-type variantOf renders honestly');
{
  const diffs = diffMetadata(metadata({ extra: { variantOf: 123 } }), metadata({ extra: { variantOf: 'parent' } }));
  const variant = diffs.find((d) => d.field === 'variantOf');
  assert(variant, 'a wrong-type variantOf still produces a variantOf difference');
  eq(variant.left, 'number: 123', 'left renders the wrong type instead of collapsing to (none)');
  eq(variant.right, 'parent', 'right renders the string value');
}

console.log('diffMetadata — examples (Issue #24)');

{
  const left = metadata({
    examples: [{ name: 'Small PR', input: 'Repo: foo/bar', output: 'Looks good' }],
  });
  const right = metadata({
    examples: [{ name: 'Small PR', input: 'Repo: foo/bar', output: 'Add a test' }],
  });
  const diffs = diffMetadata(left, right);
  const examples = diffs.find((d) => d.field === 'examples');
  assert(examples, 'an examples semantic change is reported on its own row');
  assert(!diffs.find((d) => d.field === 'extra'), 'examples is excluded from the extra row to avoid double reporting');
  eq(examples.left, JSON.stringify(left.examples[0]), 'left side renders the selected prompt examples');
  eq(examples.right, JSON.stringify(right.examples[0]), 'right side renders the compared prompt examples');
}

{
  const diffs = diffMetadata(metadata(), metadata({ examples: [{ input: 'x', output: 'y' }] }));
  const examples = diffs.find((d) => d.field === 'examples');
  assert(examples, 'an examples add is reported');
  eq(examples.left, '(none)', 'missing examples renders as (none)');
}

{
  const same = { examples: [{ input: 'x', output: 'y', assets: ['a.png'] }] };
  const diffs = diffMetadata(metadata(same), metadata(same));
  assert(!diffs.find((d) => d.field === 'examples'), 'equal examples produce no examples diff');
}

{
  const a = [{ input: 'a', output: '1' }, { input: 'b', output: '2' }];
  const b = [{ input: 'b', output: '2' }, { input: 'a', output: '1' }];
  const diffs = diffMetadata(metadata({ examples: a }), metadata({ examples: b }));
  assert(
    diffs.find((d) => d.field === 'examples'),
    'reordered examples produce an examples diff (array order is meaningful)'
  );
}

{
  // P2: malformed examples with identical typed projections still diff through
  // the authoritative raw YAML carrier — the typed projection cannot see the
  // wrong-typed `input`, so Compare must look at `examplesRawYaml`.
  const left = metadata({ examplesRawYaml: '- name: Broken\n  input: 123' });
  const right = metadata({ examplesRawYaml: '- name: Broken\n  input: 456' });
  const diffs = diffMetadata(left, right);
  assert(
    diffs.find((d) => d.field === 'examples'),
    'different malformed raw examples must produce an examples diff'
  );
}

{
  // Raw examples are authoritative over the typed projection in Compare: two
  // prompts with identical typed projections but different raw values still
  // report an examples change.
  const base = { examples: [{ name: 'Broken' }] };
  const left = metadata({ ...base, examplesRawYaml: '- name: Broken\n  input: 123' });
  const right = metadata({ ...base, examplesRawYaml: '- name: Broken\n  input: 456' });
  const diffs = diffMetadata(left, right);
  assert(
    diffs.find((d) => d.field === 'examples'),
    'raw examples must take precedence over identical typed projections'
  );
}

{
  // Identical raw canonical YAML produces no examples diff.
  const raw = '- name: Broken\n  input: 123';
  const diffs = diffMetadata(metadata({ examplesRawYaml: raw }), metadata({ examplesRawYaml: raw }));
  assert(
    !diffs.find((d) => d.field === 'examples'),
    'identical raw examples produce no examples diff'
  );
}

console.log('diffMetadata — deterministic ordering');
{
  const left = metadata();
  const right = metadata({ status: 'draft', tags: ['x'], favorite: true, models: ['Claude'] });
  eq(diffMetadata(left, right), diffMetadata(left, right), 'equal inputs produce identical metadata diffs');
}

console.log(failures === 0 ? 'compare contract: ok' : `compare contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
