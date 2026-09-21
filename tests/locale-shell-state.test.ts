/**
 * Issue #67 — a locale switch is a rendering change and nothing else.
 *
 * `locale-user-data-isolation.test.ts` already proves the switch cannot touch an
 * editor draft or the machine values a save serializes. This closes the other
 * half of the acceptance criterion at the level the user is looking at: the
 * Shell must keep the search box, the active filters, the List/Grid density, the
 * selected Prompt and the collapsed Shelf across the switch.
 *
 * The assertions hold *node references* captured before the switch, so a
 * remount that resets the search box fails here even though the final state
 * would look identical.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import PromptsView from '../src/lib/components/PromptsView.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference, t } from '../src/lib/i18n/i18n.svelte';
import type { PromptSummary } from '../src/lib/prompts/types';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
  resolvePromptAssets: vi.fn(async () => []),
  pickAssetReference: vi.fn(async () => ({ failure: 'cancelled' as const })),
  revealAssetInFinder: vi.fn(async () => undefined),
  revealInFinder: vi.fn(async () => undefined),
}));

vi.mock('$lib/library.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/library.svelte')>();
  return {
    ...actual,
    initLibrary: vi.fn(async () => {}),
    stopFilesystemWatch: vi.fn(async () => {}),
    refreshLibrary: vi.fn(async () => {}),
    selectPrompt: vi.fn(async () => {}),
    saveDocument: vi.fn(async () => {}),
  };
});

function summary(overrides: Partial<PromptSummary> = {}): PromptSummary {
  return {
    projectPath: '/project',
    relativePath: 'notes/review.md',
    name: 'notes/review',
    folder: 'notes',
    extension: '.md',
    metadata: {
      description: 'Review the PR',
      tags: ['release'],
      status: 'active',
      favorite: false,
      models: [],
      related: [],
      extra: {},
    },
    modifiedAt: 1_700_000_000_000,
    hasFrontmatter: true,
    ...overrides,
  };
}

const MATCHED = summary();
const FILTERED_OUT = summary({
  relativePath: 'drafts/outline.md',
  name: 'drafts/outline',
  folder: 'drafts',
  metadata: { ...summary().metadata, tags: ['writing'], status: 'draft' },
});

beforeEach(() => {
  localStorage.clear();
  setPreference('en');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );

  library.projects = [{ path: '/project', name: 'Project' }];
  library.activeProjectPath = '/project';
  library.libraryScope = { kind: 'project', projectPath: '/project' };
  library.folderPaths = ['notes', 'drafts'];
  library.allPrompts = [MATCHED, FILTERED_OUT];
  library.prompts = [MATCHED, FILTERED_OUT];
  library.error = null;
  library.errorCode = null;
  library.allProjectsWarnings = [];
  library.loading = false;
  library.loadingDocument = false;
  library.selected = null;
  library.selectedProjectPath = null;
  library.selectedName = null;
  library.smartView = 'all';
  library.folderFilter = '';
  library.tagFilter = '';
  library.searchQuery = '';
  library.modelFilter = '';
  library.sort = 'modified-desc';
  library.viewMode = 'list';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Shell state survives a locale switch (Issue #67)', () => {
  it('keeps search, filters, density, selection and the collapsed Shelf', async () => {
    const { container } = render(PromptsView);

    const shelfToggle = screen.getByRole('button', { name: 'Collapse project shelf' });
    expect(shelfToggle.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(shelfToggle);
    await waitFor(() => expect(shelfToggle.getAttribute('aria-expanded')).toBe('false'));

    library.searchQuery = 'review';
    // Folder and tag are one slot each in the Shelf, and `applyNavigationAction`
    // is what enforces it: picking a folder clears the tag and picking a tag
    // clears the folder, while only Needs Attention composes with either — and
    // never with both. A fixture holding both filters is a state the app cannot
    // reach, so the test would be preserving something no user can produce.
    library.folderFilter = 'notes';
    library.viewMode = 'grid';
    library.selected = {
      ...MATCHED,
      body: 'Review the PR',
      raw: 'Review the PR',
    };
    library.selectedProjectPath = '/project';
    library.selectedName = MATCHED.name;

    const searchBox = screen.getByLabelText(t('topbar.search.aria')) as HTMLInputElement;
    const rows = await waitFor(() => {
      const found = container.querySelectorAll('.prompt-list-item');
      if (found.length !== 1) throw new Error(`expected 1 filtered row, got ${found.length}`);
      return found;
    });

    await waitFor(() => expect(searchBox.value).toBe('review'));
    expect(container.querySelector('.prompt-list--grid')).toBeTruthy();
    expect(rows[0].getAttribute('aria-selected')).toBe('true');

    setPreference('zh-CN');
    // The same node now renders Chinese copy — this is what makes the rest of
    // the assertions about "unchanged" rather than "never rendered".
    await waitFor(() =>
      expect(searchBox.getAttribute('aria-label')).toBe(t('topbar.search.aria'))
    );
    expect(searchBox.getAttribute('aria-label')).not.toBe('Search all prompts');
    expect(document.documentElement.lang).toBe('zh-CN');

    // The same element references, still holding the pre-switch state.
    expect(searchBox.value).toBe('review');
    expect(container.querySelector('.prompt-list--grid')).toBeTruthy();
    expect(container.querySelectorAll('.prompt-list-item').length).toBe(1);
    expect(
      container.querySelector('.prompt-list-item')?.getAttribute('aria-selected')
    ).toBe('true');
    expect(shelfToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: '展开项目书架' })).toBe(shelfToggle);

    // And the machine state behind them never moved.
    expect(library.searchQuery).toBe('review');
    expect(library.folderFilter).toBe('notes');
    // Tag is the other half of that same single slot, and the reducer cleared it
    // when the folder was picked — hence the fixture above.
    expect(library.tagFilter).toBe('');
    expect(library.viewMode).toBe('grid');
    expect(library.smartView).toBe('all');
    expect(library.selectedName).toBe(MATCHED.name);

    // And the Shelf still points at the folder. The rendered marker matters as
    // much as the value behind it: this is the aria-current the switch is not
    // allowed to drop.
    expect(
      container.querySelector('.sidebar-nav__item[aria-current="true"]')?.textContent
    ).toContain('notes');
  });
});
