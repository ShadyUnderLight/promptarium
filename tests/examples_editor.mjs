/**
 * Examples editor helper contract vectors (Issue #26 §6/§9).
 *
 * The pure helpers in `src/lib/examples/editor-helpers.ts` own every mutation
 * of the `examples` array in the CRUD editor. These vectors pin the invariants
 * the editor relies on: every function returns a *new* array (the source is
 * never mutated), array position is the only ordering, and input↔file
 * replacement is explicit (never a silent delete).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  exampleDisplayName,
  addExample,
  removeExample,
  moveExample,
  updateExampleField,
  addAsset,
  addBlankAsset,
  removeAsset,
  updateAsset,
  stripBlankAssetEntries,
  effectiveMetadataForSave,
  replaceInputWithFile,
  replaceOutputWithFile,
  clearFileRef,
  hasExampleContent,
  assetResolutionKey,
} = await import(join(root, 'src/lib/examples/editor-helpers.ts'));

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
function sameReference(actual, expected, message) {
  assert(actual === expected, message + ' (must not create a new array)');
}

console.log('exampleDisplayName — name wins, deterministic fallback otherwise');

{
  eq(exampleDisplayName({ name: 'Small PR' }, 0), 'Small PR', 'uses the name');
  eq(exampleDisplayName({ name: '  ' }, 2), 'Example 3', 'blank name falls back');
  eq(exampleDisplayName({}, 0), 'Example 1', 'missing name falls back');
}

console.log('addExample — appends one blank example without mutating source');

{
  const source = [{ name: 'A' }];
  const next = addExample(source);
  eq(next.length, 2, 'appends one');
  eq(next[1], {}, 'appended example is blank');
  eq(source.length, 1, 'source array untouched');
  sameReference(next[0], source[0], 'existing example reused by reference (no deep copy needed)');
}

console.log('removeExample — removes by index, clamps, never mutates');

{
  const source = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  eq(removeExample(source, 1).map((e) => e.name), ['A', 'C'], 'removes at index');
  eq(removeExample(source, 9).length, 3, 'out-of-range is a no-op');
  eq(removeExample(source, -1).length, 3, 'negative index is a no-op');
  eq(source.length, 3, 'source untouched');
}

console.log('moveExample — deterministic reorder with clamped bounds');

{
  const source = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  eq(moveExample(source, 2, -1).map((e) => e.name), ['A', 'C', 'B'], 'moves up');
  eq(moveExample(source, 0, 1).map((e) => e.name), ['B', 'A', 'C'], 'moves down');
  eq(moveExample(source, 0, -1).map((e) => e.name), ['A', 'B', 'C'], 'cannot move above the top');
  eq(moveExample(source, 2, 1).map((e) => e.name), ['A', 'B', 'C'], 'cannot move below the bottom');
  eq(moveExample(source, 9, 1), source, 'out-of-range returns the same array');
}

console.log('updateExampleField — sets/deletes fields, keeps siblings and extra');

{
  const source = [{ name: 'A', extra: { keep: true } }];
  const set = updateExampleField(source, 0, 'name', 'Renamed');
  eq(set[0].name, 'Renamed', 'updates the field');
  eq(set[0].extra, { keep: true }, 'keeps nested extra');
  eq(source[0].name, 'A', 'source example untouched');
  const cleared = updateExampleField(source, 0, 'name', undefined);
  assert(!('name' in cleared[0]), 'undefined deletes the field');
  eq(updateExampleField(source, 5, 'name', 'X'), source, 'out-of-range returns the same array');
}

console.log('addAsset — appends, ignores blanks, keeps order');

{
  const source = [{ name: 'A' }];
  const next = addAsset(source, 0, 'assets/a.png');
  eq(next[0].assets, ['assets/a.png'], 'appends one asset');
  eq(addAsset(source, 0, '  ')[0].assets, undefined, 'blank reference is ignored');
  const two = addAsset(addAsset(source, 0, 'assets/a.png'), 0, 'assets/b.png');
  eq(two[0].assets, ['assets/a.png', 'assets/b.png'], 'appends in order (no dedup)');
  eq(source[0].assets, undefined, 'source untouched');
}

console.log('removeAsset / updateAsset — index-based edits');

{
  const source = [{ name: 'A', assets: ['a', 'b', 'c'] }];
  eq(removeAsset(source, 0, 1)[0].assets, ['a', 'c'], 'removes at index');
  eq(removeAsset(source, 0, 9)[0].assets, ['a', 'b', 'c'], 'out-of-range is a no-op');
  eq(updateAsset(source, 0, 1, 'B')[0].assets, ['a', 'B', 'c'], 'replaces at index');
  // A blank value is kept as an editor-only draft row (so clearing a field mid-
  // edit never removes the row the user is typing in); it is dropped later by
  // stripBlankAssetEntries at save time.
  eq(updateAsset(source, 0, 1, '   ')[0].assets, ['a', '', 'c'], 'blank keeps the draft row');
  eq(source[0].assets, ['a', 'b', 'c'], 'source untouched');
}

console.log('input↔file replacement — explicit, never silent');

{
  const source = [{ name: 'A', input: 'inline input', output: 'inline output' }];
  const withInputFile = replaceInputWithFile(source, 0, 'examples/in.txt');
  eq(withInputFile[0].inputFile, 'examples/in.txt', 'sets the file reference');
  assert(!('input' in withInputFile[0]), 'clears the inline input');
  eq(source[0].input, 'inline input', 'source untouched');
  const withOutputFile = replaceOutputWithFile(source, 0, 'examples/out.txt');
  eq(withOutputFile[0].outputFile, 'examples/out.txt', 'sets the output file reference');
  assert(!('output' in withOutputFile[0]), 'clears the inline output');
  const cleared = clearFileRef(withInputFile, 0, 'inputFile');
  assert(!('inputFile' in cleared[0]), 'clearFileRef removes the reference');
  eq(cleared[0].input, undefined, 'inline input was already cleared (replacement contract)');
}

console.log('hasExampleContent — name counts as content');

{
  assert(!hasExampleContent({}), 'empty example has no content');
  assert(hasExampleContent({ name: 'A' }), 'name counts');
  assert(hasExampleContent({ assets: ['x'] }), 'assets count');
  assert(hasExampleContent({ notes: 'note' }), 'notes count');
}

console.log('Add blank draft rows — editable row appears, typed value enters dirty/save, blank never persists');

{
  // Regression (Issue #26 §6): "Add blank" previously called addAsset(..., '')
  // which trims and ignores blanks — the button did nothing. A draft row is now
  // an empty asset entry in `examples`: it renders as an editable row and, once
  // typed, its value is part of the in-memory metadata (dirty/save) before any
  // blur — it never lives in child-local state.
  eq(addBlankAsset([{ name: 'A' }], 0)[0].assets, [''],
    'Add blank opens one editable row (empty asset entry appears)');

  // The draft row participates in the dirty/save lifecycle: typing writes the
  // value straight into `examples`, exactly like the picker path would.
  const typed = addBlankAsset([{ name: 'A' }], 0);
  eq(updateAsset(typed, 0, 0, 'assets/new-output.png')[0].assets, ['assets/new-output.png'],
    'typed draft value flows into metadata before blur');

  // A draft row is bound to its example by array position: removing or moving
  // an *earlier* example must never re-target the draft onto a later example.
  // The draft is a real blank asset entry (['']) so it travels with its example.
  const abc = [
    { name: 'A' },
    { name: 'B', assets: [''] },
    { name: 'C' },
  ];
  eq(removeExample(abc, 0)[0], { name: 'B', assets: [''] },
    'blank draft follows its example across removal (never crosses by index)');
  eq(moveExample(abc, 2, -1).find((e) => e.name === 'B'), { name: 'B', assets: [''] },
    'blank draft follows its example across reorder');

  // Empty entries never reach the persisted file: stripBlankAssetEntries is the
  // single strip point called at save time, and returns the same reference when
  // there is nothing to strip.
  eq(stripBlankAssetEntries([{ name: 'A', assets: ['a', '', 'c'] }])[0].assets, ['a', 'c'],
    'blank asset entries are stripped before persisting');
  const noBlanks = [{ name: 'A', assets: ['a', 'c'] }];
  sameReference(stripBlankAssetEntries(noBlanks), noBlanks,
    'no-blank input returns the same array (no churn on unrelated saves)');
  const noAssets = [{ name: 'A' }];
  sameReference(stripBlankAssetEntries(noAssets), noAssets,
    'examples without assets are untouched');
  eq(addAsset([{ name: 'A' }], 0, '  ')[0].assets, undefined,
    'addAsset (picker path) still drops blanks — blank draft rows only enter via addBlankAsset');
}

console.log('effectiveMetadataForSave — net-zero drafts never rewrite the raw AST');

{
  const original = {
    description: 'd',
    tags: [],
    status: 'active',
    favorite: false,
    models: [],
    related: [],
    extra: {},
    examples: [{ name: 'A', assets: ['assets/a.png'] }],
    examplesRaw: { seq: [{ map: { name: 'A' } }] },
  };

  // Net-zero: "Add blank" appended '' to A's assets and updateExamples dropped
  // examplesRaw; nothing was typed. The raw AST must be restored and the save
  // must not be treated as a real metadata edit.
  const blankOnly = { ...original, examples: [{ name: 'A', assets: ['assets/a.png', ''] }] };
  delete blankOnly.examplesRaw;
  const r1 = effectiveMetadataForSave(blankOnly, original);
  assert(r1.effective.examplesRaw === original.examplesRaw, 'raw AST restored on a net-zero draft');
  assert(r1.dirty === false, 'net-zero draft is not a real metadata edit');

  // Add blank -> Remove: examples are fully back to the original but examplesRaw
  // is still gone from the editor metadata. Same net-zero outcome.
  const removed = { ...original, examples: original.examples };
  delete removed.examplesRaw;
  const r2 = effectiveMetadataForSave(removed, original);
  assert(r2.dirty === false, 'Add blank -> Remove is not a real metadata edit');
  assert(r2.effective.examplesRaw === original.examplesRaw, 'raw AST restored after Remove');

  // A real typed edit keeps examplesRaw deleted and marks the metadata dirty.
  const typed = { ...original, examples: [{ name: 'A', assets: ['assets/typed.png'] }] };
  delete typed.examplesRaw;
  const r3 = effectiveMetadataForSave(typed, original);
  assert(r3.dirty === true, 'a real examples edit is dirty');
  assert(r3.effective.examplesRaw === undefined, 'a real examples edit keeps examplesRaw deleted');

  // An empty draft alongside a real other-field edit: the other field saves, and
  // the unchanged examples keep using the original raw AST.
  const otherEdit = {
    ...original,
    description: 'changed',
    examples: [{ name: 'A', assets: ['assets/a.png', ''] }],
  };
  delete otherEdit.examplesRaw;
  const r4 = effectiveMetadataForSave(otherEdit, original);
  assert(r4.dirty === true, 'other-field edit is still dirty');
  assert(r4.effective.examplesRaw === original.examplesRaw,
    'unchanged examples keep the raw AST even when other fields save');

  // Files without a raw AST (created / duplicated): a net-zero draft is still
  // not a real edit, and there is nothing to restore.
  const noRaw = { ...original, examples: [{ name: 'A', assets: ['assets/a.png'] }] };
  delete noRaw.examplesRaw;
  const noRawBlank = { ...noRaw, examples: [{ name: 'A', assets: ['assets/a.png', ''] }] };
  delete noRawBlank.examplesRaw;
  const r5 = effectiveMetadataForSave(noRawBlank, noRaw);
  assert(r5.dirty === false, 'net-zero draft is not dirty when the file had no raw AST');
  assert(r5.effective.examplesRaw === undefined, 'no raw AST to restore');
}

console.log('assetResolutionKey — project-scoped identity never collides across Projects (Issue #30 P2)');

{
  // Two Projects that share the same `index:role:reference` must produce
  // different keys: a stale resolution entry from Project A must never be read
  // back as Project B's state after a Project switch.
  const a = assetResolutionKey('/projects/a', { index: 0, role: 'asset', sub: 1, reference: 'assets/ref.png' });
  const b = assetResolutionKey('/projects/b', { index: 0, role: 'asset', sub: 1, reference: 'assets/ref.png' });
  assert(a !== b, 'same ref under different Projects produces different keys');

  // The identity is deterministic for the same Project + ref.
  const aAgain = assetResolutionKey('/projects/a', { index: 0, role: 'asset', sub: 1, reference: 'assets/ref.png' });
  assert(a === aAgain, 'same Project + ref is deterministic');

  // Example index, role and asset sub-index are part of the identity, and
  // inputFile/outputFile stay distinct from assets.
  assert(assetResolutionKey('/projects/a', { index: 1, role: 'asset', sub: 1, reference: 'assets/ref.png' }) !== a, 'example index is part of the identity');
  assert(assetResolutionKey('/projects/a', { index: 0, role: 'outputFile', reference: 'assets/ref.png' }) !== a, 'role is part of the identity');
  assert(assetResolutionKey('/projects/a', { index: 0, role: 'asset', reference: 'assets/ref.png' }) !== a, 'asset sub index is part of the identity');
  assert(assetResolutionKey('/projects/a', { index: 0, role: 'asset', sub: 1, reference: 'assets/other.png' }) !== a, 'reference is part of the identity');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('examples editor contract ok');
