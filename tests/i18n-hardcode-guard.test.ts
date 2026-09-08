/**
 * Issue #38 §2 — lightweight hardcoded-copy regression guard.
 *
 * This is deliberately NOT an English detector. A general "looks like an
 * English sentence" scan would fire on comments, CSS names, machine tokens and
 * test fixtures, and the only way to silence it would be to shove technical
 * strings into the catalog — exactly the failure mode Issue #38 warns about.
 *
 * Instead this locks a small, explicit blocklist of *complete phrases* that
 * already live in the catalog. If one of them reappears in `src/`, someone has
 * re-hardcoded copy that was already migrated. False positives are near-zero
 * because these are multi-word UI sentences, not bare words like `Save`.
 *
 * Adding a phrase is a one-line change here; if a phrase ever legitimately
 * needs to exist in source, add an entry to `ALLOWED` instead of deleting it.
 */
/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

/** Every App source file, inlined as raw text by Vite (no node fs needed). */
const sources = import.meta.glob('../src/**/*.{ts,svelte,html}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Catalogs legitimately contain the English source copy. */
const EXCLUDED = '/i18n/locales/';

/**
 * Complete English phrases that must only ever come from the catalog.
 * Each one is the current `en.ts` value of an already-migrated key.
 */
const FORBIDDEN_PHRASES = [
  'Add a prompt project first.', // notice.addProjectFirst
  'No prompts yet', // library.noPromptsYet
  'Choose file…', // examples.editor.chooseFile
  'Project added.', // notice.projectAdded
  'Load earlier commits', // history.loadMore
];

/** Narrow escapes: [source path, phrase]. Keep empty if you can. */
const ALLOWED: ReadonlyArray<readonly [string, string]> = [];

/** Drop `//` and `/* *\/` comment text so doc copy never trips the guard. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    .join('\n');
}

const scanned = Object.entries(sources)
  .filter(([path]) => !path.includes(EXCLUDED))
  .map(([path, source]) => ({ path: path.replace('../src/', ''), text: stripComments(source) }))
  .sort((a, b) => a.path.localeCompare(b.path));

describe('hardcoded App-owned copy guard (Issue #38)', () => {
  it('scans a non-empty set of source files', () => {
    // Guards against the guard silently passing because the glob matched nothing.
    expect(scanned.length).toBeGreaterThan(20);
  });

  it('the scanner itself detects a planted phrase', () => {
    const planted = stripComments("const label = 'Project added.'; // trailing");
    expect(planted).toContain('Project added.');
  });

  it.each(FORBIDDEN_PHRASES)('%s does not appear in App source', (phrase) => {
    const offenders = scanned
      .filter((file) => file.text.includes(phrase))
      .map((file) => file.path)
      .filter((path) => !ALLOWED.some(([allowedPath, allowed]) => allowedPath === path && allowed === phrase));
    expect(offenders).toEqual([]);
  });
});
