/**
 * Duplicate / Duplicate as Variant regression vectors (Issue #15).
 *
 * `duplicatePrompt` and `duplicateAsVariant` are thin wrappers over the pure
 * metadata builders in `duplicate.ts`; the Svelte/tauri layers are not
 * imported here. These tests lock the Issue #15 acceptance requirement that
 * Duplicate and Duplicate as Variant both preserve `notes`, so a future
 * refactor of `cloneMetadata` away from a generic spread cannot silently drop
 * the field.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { cloneMetadata, duplicateMetadata, variantMetadata } = await import(join(root, 'src/lib/prompts/duplicate.ts'));
const { getVariantOf } = await import(join(root, 'src/lib/prompts/types.ts'));

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

function metadata(overrides = {}) {
  return {
    description: 'desc',
    tags: ['a', 'b'],
    status: 'active',
    favorite: false,
    models: ['ChatGPT'],
    related: ['other'],
    extra: {},
    ...overrides,
  };
}

console.log('cloneMetadata — notes and nested fields are preserved');

{
  const source = metadata({ notes: 'foo\nbar' });
  const copy = cloneMetadata(source);
  eq(copy.notes, 'foo\nbar', 'cloneMetadata preserves multiline notes');
  eq(copy.description, 'desc', 'cloneMetadata preserves supported fields');
  assert(copy !== source, 'cloneMetadata returns a new object');
  assert(copy.extra !== source.extra, 'cloneMetadata deep-copies extra');
  assert(copy.tags !== source.tags, 'cloneMetadata deep-copies tags');
}

{
  const fresh = cloneMetadata(undefined);
  eq(fresh.notes, undefined, 'cloning undefined metadata yields no notes');
  eq(fresh.description, '', 'cloning undefined metadata yields defaults');
}

console.log('duplicateMetadata — Duplicate preserves notes (Issue #15)');

{
  const source = metadata({ notes: 'foo\nbar' });
  const duplicate = duplicateMetadata(source);
  eq(duplicate.notes, source.notes, 'Duplicate copies notes verbatim');
  eq(getVariantOf(duplicate), undefined, 'Duplicate does not add variantOf');
}

console.log('variantMetadata — Duplicate as Variant preserves notes + variantOf');

{
  const source = metadata({ notes: 'foo\nbar' });
  const variant = variantMetadata(source, 'coding/base');
  eq(variant.notes, source.notes, 'Duplicate as Variant copies notes verbatim');
  eq(getVariantOf(variant), 'coding/base', 'Duplicate as Variant sets variantOf to the source');
}

{
  const source = metadata({ notes: 'foo\nbar' });
  const nested = variantMetadata(source, 'coding/base');
  nested.notes = 'changed';
  nested.extra.variantOf = 'changed';
  eq(source.notes, 'foo\nbar', 'mutating the variant copy does not touch the source notes');
  eq(source.extra.variantOf, undefined, 'mutating the variant copy does not touch the source extra');
}

console.log('cloneMetadata — examples deep copy (Issue #24)');

{
  const source = metadata({
    examples: [
      {
        name: 'Small PR',
        input: 'Repo: foo/bar',
        output: 'Looks good',
        assets: ['a.png', 'b.png'],
        extra: { custom: 1, nested: { list: ['x', 'y'] } },
      },
    ],
    examplesRaw: {
      kind: 'sequence',
      items: [{ kind: 'string', value: 'raw' }],
    },
  });
  const copy = cloneMetadata(source);
  eq(copy.examples, source.examples, 'cloneMetadata preserves examples');
  assert(copy.examples !== source.examples, 'cloneMetadata returns a new examples array');
  assert(copy.examples[0] !== source.examples[0], 'cloneMetadata deep-copies each example');
  assert(copy.examples[0].assets !== source.examples[0].assets, 'cloneMetadata deep-copies example assets');
  assert(copy.examples[0].extra !== source.examples[0].extra, 'cloneMetadata deep-copies example extra');
  assert(
    copy.examples[0].extra.nested !== source.examples[0].extra.nested,
    'cloneMetadata deep-copies nested objects inside examples[].extra'
  );
  assert(
    copy.examples[0].extra.nested.list !== source.examples[0].extra.nested.list,
    'cloneMetadata deep-copies nested arrays inside examples[].extra'
  );
  copy.examples[0].input = 'changed';
  copy.examples[0].extra.nested.list.push('z');
  eq(source.examples[0].input, 'Repo: foo/bar', 'mutating the copy does not touch the source example');
  eq(source.examples[0].extra.nested.list, ['x', 'y'], 'mutating a nested copy array does not touch the source');
  eq(copy.examplesRaw, source.examplesRaw, 'cloneMetadata preserves the raw examples AST');
  assert(copy.examplesRaw !== source.examplesRaw, 'cloneMetadata deep-copies examplesRaw');
}

{
  const fresh = cloneMetadata(metadata());
  eq(fresh.examples, undefined, 'cloning metadata without examples yields no examples');
  eq(fresh.examplesRaw, undefined, 'cloning metadata without examplesRaw yields none');
}

if (failures) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('All duplicate-contract tests passed.');
