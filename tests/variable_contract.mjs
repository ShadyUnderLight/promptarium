/**
 * Pure vectors for the variable-contract derivation (documented /
 * undocumented / stale). The body is the single source of truth for which
 * variables exist; frontmatter annotations only describe them.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { deriveVariableContract } = await import(
  join(root, 'src/lib/variables/contract.ts')
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

console.log('variable contract derivation');
eq(
  deriveVariableContract('Review {repository}.', { repository: { description: 'Repo name or URL', example: 'org/repo' } }),
  { documented: [{ name: 'repository', description: 'Repo name or URL', example: 'org/repo' }], undocumented: [], stale: [] },
  'body variable with annotation is documented'
);
eq(
  deriveVariableContract('Review {repository}.', undefined),
  { documented: [], undocumented: [{ name: 'repository' }], stale: [] },
  'body variable without metadata is undocumented'
);
eq(
  deriveVariableContract('Review {repository}.', { repository: { description: 'Repo' }, language: { description: 'Output language' } }),
  {
    documented: [{ name: 'repository', description: 'Repo', example: undefined }],
    undocumented: [],
    stale: [{ name: 'language', description: 'Output language', example: undefined }],
  },
  'annotation without a body variable is stale documentation'
);
eq(
  deriveVariableContract('Review {repository} for {repository}.', { repository: { description: 'Repo' } }),
  { documented: [{ name: 'repository', description: 'Repo', example: undefined }], undocumented: [], stale: [] },
  'repeated {name} still counts as one documented variable'
);
eq(
  deriveVariableContract('Review {{repository}}.', { repository: { description: 'Repo' } }),
  { documented: [], undocumented: [], stale: [{ name: 'repository', description: 'Repo', example: undefined }] },
  'escaped {{name}} is not a variable, so its annotation is stale'
);
eq(
  deriveVariableContract('Review {a.b} and {my var}.', undefined),
  { documented: [], undocumented: [], stale: [] },
  'grammar-invalid braces stay literal and are never undocumented variables'
);
eq(
  deriveVariableContract('Review {x-1_Y} and {ticket}.', { ticket: { description: 'Ticket', example: 'ABC-1' }, 'x-1_Y': { example: 'z' } }),
  {
    documented: [
      { name: 'x-1_Y', description: undefined, example: 'z' },
      { name: 'ticket', description: 'Ticket', example: 'ABC-1' },
    ],
    undocumented: [],
    stale: [],
  },
  'first-appearance order is preserved and hyphen/underscore names are documented'
);

console.log(failures === 0 ? 'variable contract: ok' : `variable contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
