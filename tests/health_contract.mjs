/**
 * Pure vectors for Prompt Health derivation (Issue #13).
 *
 * Health is deterministic structural checking only — never an AI quality score.
 * Every input here is pre-parsed (frontmatterError, bodyEmpty, variableNames,
 * variables, related, projectPromptNames), mirroring how the app derives health
 * from its disposable search index without ever re-reading a body. Relation
 * target existence is scoped by the caller to the source prompt's own project.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { derivePromptHealth } = await import(join(root, 'src/lib/health/health.ts'));

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

function codes(issues) {
  return issues.map((issue) => issue.code);
}

/** A healthy prompt; override only what a test scenario needs. */
function base({ projectPath = '/p', name = 'review', ...overrides } = {}) {
  return {
    projectPath,
    name,
    bodyEmpty: false,
    variableNames: [],
    related: [],
    projectPromptNames: new Set(['review']),
    ...overrides,
  };
}

console.log('health rules');

eq(derivePromptHealth(base()), [], 'valid normal prompt has no issues');

eq(
  codes(derivePromptHealth(base({ bodyEmpty: true }))),
  ['EMPTY_BODY'],
  'whitespace-only body is EMPTY_BODY'
);

eq(
  codes(derivePromptHealth(base({ frontmatterError: 'frontmatter must be a YAML mapping' }))),
  ['INVALID_FRONTMATTER'],
  'malformed frontmatter is INVALID_FRONTMATTER'
);

eq(
  codes(derivePromptHealth(base({ variableNames: ['focus'] }))),
  ['UNDOCUMENTED_VARIABLE'],
  'body variable without annotation is UNDOCUMENTED_VARIABLE'
);

eq(
  codes(
    derivePromptHealth(
      base({
        variableNames: ['focus'],
        variables: {
          focus: { description: 'Focus area' },
          language: { description: 'Output language' },
        },
      })
    )
  ),
  ['STALE_VARIABLE_DOCUMENTATION'],
  'annotation without a body variable is STALE_VARIABLE_DOCUMENTATION'
);

eq(
  codes(derivePromptHealth(base({ related: ['other'], projectPromptNames: new Set(['review', 'other']) }))),
  [],
  'valid related target produces no relation issue'
);

eq(
  codes(derivePromptHealth(base({ related: ['gone'] }))),
  ['BROKEN_RELATED_PROMPT'],
  'missing related target is BROKEN_RELATED_PROMPT'
);

eq(
  codes(derivePromptHealth(base({ related: ['../escape'] }))),
  ['INVALID_RELATED_PROMPT'],
  'path-escape related target is INVALID_RELATED_PROMPT'
);

eq(
  codes(derivePromptHealth(base({ related: ['other.md'] }))),
  ['INVALID_RELATED_PROMPT'],
  'related with a .md suffix is INVALID_RELATED_PROMPT'
);

eq(
  codes(derivePromptHealth(base({ related: ['review'] }))),
  ['SELF_RELATED_PROMPT'],
  'self relation is SELF_RELATED_PROMPT'
);

{
  const invalid = derivePromptHealth(base({ related: ['../escape'] }))[0];
  assert(invalid && invalid.severity === 'error', 'INVALID_RELATED_PROMPT is severity error');
}

console.log('empty body + leftover annotation');

eq(
  codes(derivePromptHealth(base({ bodyEmpty: true, variableNames: [], variables: { focus: {} } }))),
  ['EMPTY_BODY', 'STALE_VARIABLE_DOCUMENTATION'],
  'empty body with a leftover annotation reports EMPTY_BODY and stale'
);

console.log('deterministic multi-issue ordering');

{
  const input = base({
    frontmatterError: 'x',
    bodyEmpty: true,
    variableNames: ['focus', 'model'],
    related: ['gone', 'other.md'],
  });
  eq(
    codes(derivePromptHealth(input)),
    [
      'INVALID_FRONTMATTER',
      'EMPTY_BODY',
      'UNDOCUMENTED_VARIABLE',
      'UNDOCUMENTED_VARIABLE',
      'BROKEN_RELATED_PROMPT',
      'INVALID_RELATED_PROMPT',
    ],
    'multiple issues are sorted by a fixed code order'
  );
  eq(
    derivePromptHealth(input),
    derivePromptHealth(input),
    'equal inputs produce identical ordered issues'
  );
}

console.log('compatibility: plain Markdown');

eq(
  codes(derivePromptHealth(base({ variableNames: [], variables: {}, related: [] }))),
  [],
  'plain Markdown with no variables or relations is not flagged'
);

console.log(failures === 0 ? 'health contract: ok' : `health contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
