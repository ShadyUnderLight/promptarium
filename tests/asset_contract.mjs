/**
 * Asset References & Safety contract vectors (Issue #25).
 *
 * Path safety is Rust's job (see store.rs `resolve_asset`); this file only
 * pins the frontend seam's contract shape in the browser/dev path: one
 * classification per reference, the reference string preserved, and a dev
 * fallback that never invents path rules (conservatively `missing`, since the
 * browser fixture has no real filesystem).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { resolvePromptAssets, revealAssetInFinder } = await import(
  join(root, 'src/lib/api.ts')
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

console.log('resolvePromptAssets — dev path returns one classification per reference');

{
  const references = ['assets/a.png', 'b.md', 'outputs/result.json'];
  const results = await resolvePromptAssets('/mock/project', references);
  assert(Array.isArray(results), 'returns an array');
  eq(results.length, references.length, 'one result per reference');
  for (let i = 0; i < results.length; i++) {
    eq(results[i].reference, references[i], 'preserves the reference string');
    assert('state' in results[i], 'classifies state');
  }
}

console.log('revealAssetInFinder — dev path is a safe no-op');

{
  // Reaching this line without throwing is the contract (no filesystem in dev).
  await revealAssetInFinder('/mock/project', 'assets/a.png');
  assert(true, 'dev reveal is a safe no-op');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('asset contract ok');
