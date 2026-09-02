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
  removeAsset,
  updateAsset,
  replaceInputWithFile,
  replaceOutputWithFile,
  clearFileRef,
  hasExampleContent,
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
  eq(updateAsset(source, 0, 1, '   ')[0].assets, ['a', 'c'], 'blank replacement removes');
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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('examples editor contract ok');
