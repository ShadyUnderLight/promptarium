/**
 * Issue #38 §2 — lightweight hardcoded-copy regression guard.
 *
 * This is deliberately NOT an English detector. A general "looks like an
 * English sentence" scan would fire on comments, CSS names, machine tokens and
 * test fixtures, and the only way to silence it would be to shove technical
 * strings into the catalog — exactly the failure mode Issue #38 warns about.
 *
 * Instead this locks a small, explicit set of *MessageKeys* and derives each
 * forbidden phrase from the canonical English catalog at test time:
 *
 *   - the key is the contract, so the guard survives a copy edit
 *     (`en.ts` changes value → the guard follows automatically);
 *   - at least one representative key per surface named in Issue #38 §2, so
 *     the guard is a real regression net for the core UI, not a handful of
 *     literal strings;
 *   - complete multi-word phrases only — bare words like `Save` / `Rename`
 *     collide with identifiers (`actionRename`), CSS and shortcuts, and are
 *     therefore rejected here rather than silently mis-firing later.
 *
 * If a phrase ever legitimately needs to exist in source, add an entry to
 * `ALLOWED` instead of deleting the key.
 */
/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { en } from '../src/lib/i18n/locales/en';
import type { MessageKey } from '../src/lib/i18n/locales/en';

/** Every App source file, inlined as raw text by Vite (no node fs needed). */
const sources = import.meta.glob('../src/**/*.{ts,svelte,html}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Catalogs legitimately contain the English source copy. */
const EXCLUDED = '/i18n/locales/';

/**
 * Representative already-migrated keys per surface named in Issue #38 §2, plus
 * the surfaces the Floating Shelf phases added (Issue #67). One entry per
 * surface is the floor; a few carry two where the surface has several distinct
 * copy clusters (empty states vs. field labels).
 */
const GUARDED_SURFACES: Readonly<Record<string, ReadonlyArray<MessageKey>>> = {
  ProjectSidebar: ['sidebar.empty', 'sidebar.folders.empty'],
  // Phase 2 — the Rail is icon-only, so its labels are the whole surface.
  LibraryRail: ['sidebar.rail.aria', 'sidebar.rail.collapseShelf'],
  PromptLibrary: ['library.noPromptsYet', 'library.emptyNoProjects'],
  PromptToolbar: ['toolbar.selectAll', 'toolbar.sort.modifiedDesc'],
  PromptDetail: ['detail.select.hint', 'detail.editor.hint'],
  PromptMetadata: ['meta.noVariables.body', 'meta.noRelatedCandidates'],
  // Phase 4 — the Inspector section chrome lives outside PromptMetadata.
  MetadataInspectorSection: ['detail.inspector.aria', 'detail.inspector.section.relations'],
  PromptHistory: ['history.loadMore', 'history.empty.untracked'],
  PromptCompare: ['compare.noTargets', 'compare.noBodyDiff'],
  ExamplesEditor: ['examples.editor.chooseFile', 'examples.editor.hint'],
  ExamplesSection: ['examples.confirm.replaceInput'],
  ProjectMenu: ['menu.revealInFinder', 'menu.projectColor'],
  // Dialogs own almost no multi-word copy of their own (`Cancel` / `Confirm` /
  // `Working…` are single words the guard rejects), so these point at the copy
  // the dialogs actually render from their callers.
  ConfirmDialog: ['dialog.forgetProject.title', 'confirm.unsaved.title'],
  NamePromptDialog: ['newPrompt.filenameHint', 'dialog.renamePrompt'],
  UpdateBanner: ['update.banner.checking', 'update.banner.install'],
  // Toast copy is a surface of its own — this is where #38's own example lives.
  Notices: ['notice.addProjectFirst', 'notice.projectAdded'],
};

/**
 * Every surface the guard must actually carry entries for: Issue #38 §2's list
 * plus the Floating Shelf surfaces added in Issue #67. This is checked to be the
 * exact same set as `GUARDED_SURFACES` in both directions — dropping a surface
 * would otherwise only shrink `it.each` and still pass, and adding one without
 * registering it here would leave the same hole.
 */
const REQUIRED_SURFACES = [
  'ProjectSidebar',
  'LibraryRail',
  'PromptLibrary',
  'PromptToolbar',
  'PromptDetail',
  'PromptMetadata',
  'MetadataInspectorSection',
  'PromptHistory',
  'PromptCompare',
  'ExamplesEditor',
  'ExamplesSection',
  'ProjectMenu',
  'ConfirmDialog',
  'NamePromptDialog',
  'UpdateBanner',
  'Notices',
];

/** Narrow escapes: [source path, phrase]. Keep empty if you can. */
const ALLOWED: ReadonlyArray<readonly [string, string]> = [];

const forbidden = Object.entries(GUARDED_SURFACES).flatMap(([surface, keys]) =>
  keys.map((key) => ({ surface, key, phrase: en[key] }))
);

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

  it('guards exactly the required surfaces', () => {
    const missing = REQUIRED_SURFACES.filter(
      (surface) => !GUARDED_SURFACES[surface]?.length
    );
    expect(missing).toEqual([]);
    // Set equality, not just containment: a surface that is guarded but missing
    // from REQUIRED_SURFACES could be deleted outright, because `it.each` would
    // only shrink and every assertion here would still pass.
    expect(Object.keys(GUARDED_SURFACES).sort()).toEqual([...REQUIRED_SURFACES].sort());
  });

  it('the scanner itself detects a planted phrase', () => {
    const planted = stripComments("const label = 'Project added.'; // trailing");
    expect(planted).toContain('Project added.');
  });

  it.each(forbidden)(
    '$key ($surface) — "$phrase" does not appear in App source',
    ({ key, phrase }) => {
      const offenders = scanned
        .filter((file) => file.text.includes(phrase))
        .map((file) => file.path)
        .filter(
          (path) =>
            !ALLOWED.some(
              ([allowedPath, allowed]) => allowedPath === path && allowed === phrase
            )
        );
      expect(offenders).toEqual([]);
      // `void key` keeps the key in the failure output via the test title.
      expect(key in en).toBe(true);
    }
  );

  it('only guards complete phrases, never bare words or templates', () => {
    // A single word collides with identifiers and CSS; a `{placeholder}` value
    // never appears verbatim in source, so guarding it would be a no-op.
    const tooShort = forbidden.filter(({ phrase }) => phrase.trim().split(/\s+/).length < 2);
    const templated = forbidden.filter(({ phrase }) => phrase.includes('{'));
    expect(tooShort.map((entry) => entry.key)).toEqual([]);
    expect(templated.map((entry) => entry.key)).toEqual([]);
  });
});
