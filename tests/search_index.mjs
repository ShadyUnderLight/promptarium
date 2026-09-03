/**
 * Pure-function tests for the direct-rebuild search index.
 *
 * Every refresh rebuilds each entry from this round's body read — there is no
 * mtime/size identity reuse — so an unchanged summary still picks up a
 * changed body, and a single failed body read degrades to a summary-only entry
 * without clearing the rest of the index.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildSearchIndex, searchEntryFromDocument } = await import(
  join(root, 'src/lib/library/search-index.ts')
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

const defaultMetadata = {
  description: '',
  tags: [],
  status: 'active',
  favorite: false,
  models: [],
  extra: {},
};

function summary(name, modifiedAt = 1000, description = '') {
  return {
    projectPath: '/project-a',
    relativePath: name + '.md',
    name,
    folder: name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '',
    extension: '.md',
    metadata: { ...defaultMetadata, description },
    modifiedAt,
    hasFrontmatter: false,
  };
}

function document(name, modifiedAt, body) {
  return {
    ...summary(name, modifiedAt),
    body,
    raw: body,
  };
}

console.log('searchEntryFromDocument derives search fields from the body');
{
  const entry = searchEntryFromDocument(document('a', 1000, 'body with {var1} and {var2}'));
  eq(entry.bodyLower, 'body with {var1} and {var2}', 'body lowered for search');
  eq(entry.variableCount, 2, 'variable count from one body pass');
  eq(entry.variableNames, ['var1', 'var2'], 'variable names in first-appearance order');
  eq(entry.bodyEmpty, false, 'non-empty body');
}

console.log('empty body is flagged by the parser pass');
{
  const entry = searchEntryFromDocument(document('a', 1000, '   '));
  eq(entry.bodyEmpty, true, 'whitespace-only body');
  eq(entry.variableCount, 0, 'no variables');
}

console.log('first build reads every body');
{
  const { index, stats } = await buildSearchIndex([summary('a'), summary('b')], {
    readBody: async (prompt) => searchEntryFromDocument(document(prompt.name, 1000, 'body of ' + prompt.name)),
  });
  eq(stats.planned, 2, 'planned both prompts');
  eq(stats.bodyReads, 2, 'read both bodies');
  eq(stats.failedReads, 0, 'no failed reads');
  eq([...index.keys()].sort(), ['a', 'b'], 'both entries indexed');
  eq(index.get('a')?.bodyLower, 'body of a', 'body searchable');
}

console.log('single-file body read failure keeps a summary-only entry');
{
  const { index, stats } = await buildSearchIndex([summary('a'), summary('b')], {
    readBody: async (prompt) => {
      if (prompt.name === 'a') throw new Error('read failed');
      return searchEntryFromDocument(document(prompt.name, 1000, 'body of ' + prompt.name));
    },
  });
  eq(stats.failedReads, 1, 'one failed read counted');
  eq(stats.bodyReads, 2, 'both bodies attempted');
  eq(index.get('a')?.bodyLower, '', 'failed prompt keeps summary-only entry');
  eq(index.get('b')?.bodyLower, 'body of b', 'healthy prompt unaffected');
}

console.log('summary unchanged but body changed this round is picked up (no mtime/size reuse)');
{
  const summaries = [summary('a', 1000, 'same description')];
  const first = await buildSearchIndex(summaries, {
    readBody: async () => searchEntryFromDocument(document('a', 1000, 'old body')),
  });
  eq(first.index.get('a')?.bodyLower, 'old body', 'first round reads old body');

  const second = await buildSearchIndex(summaries, {
    readBody: async () => searchEntryFromDocument(document('a', 1000, 'new body')),
  });
  eq(second.index.get('a')?.bodyLower, 'new body', 'identical summary still picks up the new body');
}

console.log('entry summary reflects the read document (authoritative disk state)');
{
  const diskDescription = 'description from the read document';
  const { index } = await buildSearchIndex([summary('a', 1000)], {
    readBody: async () =>
      searchEntryFromDocument({
        ...document('a', 1000, 'body'),
        metadata: { ...defaultMetadata, description: diskDescription },
      }),
  });
  eq(index.get('a')?.summary.metadata.description, diskDescription, 'summary comes from this round body read');
}

console.log('project isolation via separate maps');
{
  const build = async (body) => {
    const { index } = await buildSearchIndex([summary('shared', 1000)], {
      readBody: async () => searchEntryFromDocument({ ...document('shared', 1000, body) }),
    });
    return index;
  };
  const projectA = await build('alpha body');
  const projectB = await build('other body');
  eq(projectA.get('shared')?.bodyLower, 'alpha body', 'project A body');
  eq(projectB.get('shared')?.bodyLower, 'other body', 'project B body');
}

if (failures > 0) {
  console.error('\n' + failures + ' search index test(s) failed');
  process.exit(1);
}

console.log('\nAll search index tests passed.');
