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
const {
  BODY_EXCERPT_MAX_LENGTH,
  bodyExcerptFromBody,
  buildSearchIndex,
  searchEntryFromDocument,
  stripMarkdownForExcerpt,
  truncateExcerptText,
} = await import(join(root, 'src/lib/library/search-index.ts'));

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

console.log('bodyExcerpt preserves case and strips Markdown');
{
  const entry = searchEntryFromDocument(
    document('a', 1000, '# Title\n\nHello **World** with `code` and [link](https://x.test)')
  );
  eq(entry.bodyExcerpt, 'Title Hello World with code and link', 'excerpt keeps readable text');
  eq(
    bodyExcerptFromBody('# Title\n- first\n- second'),
    'Title first second',
    'multi-line list markers are stripped before whitespace flattening'
  );
  eq(
    bodyExcerptFromBody('Intro\n> quoted text\n1. first\n2. second'),
    'Intro quoted text first second',
    'blockquote and ordered-list markers are stripped per line'
  );
  eq(
    stripMarkdownForExcerpt('UPPER lower MiXeD'),
    'UPPER lower MiXeD',
    'excerpt does not lowercase'
  );
  eq(bodyExcerptFromBody('   '), undefined, 'whitespace-only body has no excerpt');
}

console.log('fenced code blocks keep inner text for excerpt');
{
  const fenced = '```ts\nconst value = 42;\n```';
  eq(bodyExcerptFromBody(fenced), 'const value = 42;', 'code-only prompt keeps body text');
  const entry = searchEntryFromDocument(document('code', 1000, fenced));
  eq(entry.bodyExcerpt, 'const value = 42;', 'search entry stores fenced-code excerpt');

  const mixed =
    'Intro text\n\n```python\ndef hello():\n    print("hello")\n```\n\nTail text';
  eq(
    bodyExcerptFromBody(mixed),
    'Intro text def hello(): print("hello") Tail text',
    'prose plus fenced code keeps both sides of the block'
  );

  eq(
    bodyExcerptFromBody('Use ```literal``` delimiters'),
    'Use literal delimiters',
    'inline triple-backtick prose is not treated as a fence'
  );

  const tildeFence = '~~~python\nprint("hello")\n~~~';
  eq(bodyExcerptFromBody(tildeFence), 'print("hello")', 'tilde fences unwrap like backtick fences');

  const tildeMixed = 'Before\n\n~~~js\nconst x = 1;\n~~~\n\nAfter';
  eq(
    bodyExcerptFromBody(tildeMixed),
    'Before const x = 1; After',
    'prose plus tilde fence keeps surrounding text'
  );

  eq(
    stripMarkdownForExcerpt('Use ```literal``` delimiters'),
    'Use literal delimiters',
    'inline triple-backtick prose is not treated as a fence'
  );

  const dunderInit = '```python\ndef __init__(self):\n    pass\n```';
  eq(
    bodyExcerptFromBody(dunderInit),
    'def __init__(self): pass',
    'fenced code keeps dunder names out of markdown emphasis stripping'
  );

  eq(bodyExcerptFromBody('Call `__init__`'), 'Call __init__', 'inline code keeps dunder names');

  const jsLiterals = '```js\nconst s = "**literal**";\nconst link = "[x](y)";\n```';
  eq(
    bodyExcerptFromBody(jsLiterals),
    'const s = "**literal**"; const link = "[x](y)";',
    'fenced code keeps markdown-like punctuation verbatim'
  );

  eq(
    bodyExcerptFromBody('[see `foo`](https://x.test)'),
    'see foo',
    'outer link markdown wraps inline code without leaving residue'
  );
  eq(
    bodyExcerptFromBody('**use `__init__` here**'),
    'use __init__ here',
    'outer emphasis wraps inline code without leaving residue'
  );
  eq(
    bodyExcerptFromBody('_around `code` text_'),
    'around code text',
    'outer underscore emphasis wraps inline code'
  );

  eq(bodyExcerptFromBody('Use {__name__}'), 'Use {__name__}', 'dunder variable names stay verbatim');
  eq(bodyExcerptFromBody('Use {_x_}'), 'Use {_x_}', 'underscore variable names stay verbatim');
  eq(
    bodyExcerptFromBody('**Value {__name__}**'),
    'Value {__name__}',
    'outer emphasis does not rewrite variable tokens'
  );

  const variableEntry = searchEntryFromDocument(
    document('vars', 1000, 'Fill in {__name__} and {_x_}')
  );
  eq(variableEntry.bodyExcerpt, 'Fill in {__name__} and {_x_}', 'search entry excerpt keeps variable tokens');
  eq(variableEntry.variableNames, ['__name__', '_x_'], 'variable names match excerpt tokens');
}

console.log('bodyExcerpt truncates with an ellipsis');
{
  const long = 'word '.repeat(40).trim();
  const excerpt = bodyExcerptFromBody(long);
  assert(excerpt && excerpt.endsWith('…'), 'long body is truncated');
  assert(
    Array.from(excerpt).length <= BODY_EXCERPT_MAX_LENGTH,
    'excerpt respects max length in code points'
  );
}

console.log('bodyExcerpt truncates without splitting emoji code points');
{
  const boundary = 'a'.repeat(117) + '😀zz';
  const excerpt = bodyExcerptFromBody(boundary, 119);
  eq(excerpt, 'a'.repeat(117) + '😀…', 'emoji at the truncation boundary stays intact');
  assert(!excerpt.includes('\uFFFD'), 'no replacement character from split surrogates');
  eq(Array.from(excerpt).length, 119, 'truncated excerpt stays within the code-point budget');
  eq(
    truncateExcerptText('中文😀混合', 4),
    '中文😀…',
    'mixed CJK and emoji truncate on code-point boundaries'
  );
}

console.log('failed body read keeps summary-only entry without excerpt');
{
  const { index } = await buildSearchIndex([summary('a')], {
    readBody: async () => {
      throw new Error('read failed');
    },
  });
  eq(index.get('a')?.bodyExcerpt, undefined, 'no excerpt without a body read');
  eq(index.get('a')?.bodyLower, '', 'summary-only entry');
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
