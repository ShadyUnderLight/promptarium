import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import PromptsView from '../src/lib/components/PromptsView.svelte';
import ProjectSidebar from '../src/lib/components/library/ProjectSidebar.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';

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
    refreshAllProjects: vi.fn(async () => {}),
    selectPrompt: vi.fn(async () => {}),
    saveDocument: vi.fn(async () => {}),
  };
});

function sidebarProps(overrides: Record<string, unknown> = {}) {
  return {
    onNewPrompt: vi.fn(),
    canNavigate: vi.fn(async () => true),
    onNotice: vi.fn(),
    onModalChange: vi.fn(),
    shelfExpanded: true,
    onToggleShelf: vi.fn(),
    onFocusSearch: vi.fn(),
    onOpenHistory: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  setPreference('en');
  library.projects = [{ path: '/project', name: 'Project' }];
  library.activeProjectPath = '/project';
  library.libraryScope = { kind: 'project', projectPath: '/project' };
  library.allPrompts = [];
  library.prompts = [];
  library.folderPaths = [];
  library.allProjectsWarnings = [];
  library.error = null;
  library.errorCode = null;
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
  library.loading = false;
  library.loadingDocument = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Floating Shelf navigation rail', () => {
  it('exposes labelled shortcuts and keeps History disabled without a selection', () => {
    render(ProjectSidebar, { props: sidebarProps() });

    const rail = screen.getByRole('navigation', { name: 'Library navigation rail' });
    const railQueries = within(rail);
    expect(railQueries.getByRole('button', { name: 'All Projects' })).toBeTruthy();
    expect(railQueries.getByRole('button', { name: 'Focus search' })).toBeTruthy();
    expect(railQueries.getByRole('button', { name: 'Focus projects' })).toBeTruthy();
    expect(railQueries.getByRole('button', { name: 'Focus folders' })).toBeTruthy();
    expect(railQueries.getByRole('button', { name: 'Focus tags' })).toBeTruthy();
    expect(railQueries.getByRole('button', { name: 'Show prompt history' }).hasAttribute('disabled')).toBe(true);
    expect(railQueries.getByRole('button', { name: 'Collapse project shelf' })).toBeTruthy();
  });

  it('routes Search and Shelf actions through shell callbacks', async () => {
    const props = sidebarProps();
    render(ProjectSidebar, { props });

    const rail = screen.getByRole('navigation', { name: 'Library navigation rail' });
    const railQueries = within(rail);
    await fireEvent.click(railQueries.getByRole('button', { name: 'Focus search' }));
    await fireEvent.click(railQueries.getByRole('button', { name: 'Collapse project shelf' }));

    expect(props.onFocusSearch).toHaveBeenCalledOnce();
    expect(props.onToggleShelf).toHaveBeenCalledOnce();
  });

  it('disables Folders in All Projects instead of falling back to Smart Views', () => {
    library.libraryScope = { kind: 'all-projects' };
    render(ProjectSidebar, { props: sidebarProps() });

    const folders = within(screen.getByRole('navigation', { name: 'Library navigation rail' })).getByRole('button', {
      name: 'Focus folders',
    });
    expect(folders.hasAttribute('disabled')).toBe(true);
    expect(folders.getAttribute('aria-controls')).toBeNull();
  });

  it('focuses the requested section or its first navigation item', async () => {
    const { container } = render(ProjectSidebar, { props: sidebarProps() });
    const rail = within(screen.getByRole('navigation', { name: 'Library navigation rail' }));

    await fireEvent.click(rail.getByRole('button', { name: 'Focus projects' }));
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('.project-row')));

    await fireEvent.click(rail.getByRole('button', { name: 'Focus folders' }));
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('#project-shelf-folders')));

    await fireEvent.click(rail.getByRole('button', { name: 'Focus tags' }));
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('#project-shelf-tags')));
  });

  it('expands a collapsed Shelf before focusing the requested section', async () => {
    let rerender: (props: Record<string, unknown>) => Promise<void>;
    const props = sidebarProps({ shelfExpanded: false });
    props.onToggleShelf = vi.fn(() => {
      void rerender({ ...props, shelfExpanded: true });
    });
    const rendered = render(ProjectSidebar, { props });
    rerender = rendered.rerender;

    await fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Library navigation rail' })).getByRole('button', {
        name: 'Focus tags',
      })
    );

    await waitFor(() => {
      expect(props.onToggleShelf).toHaveBeenCalledOnce();
      expect(rendered.container.querySelector('#project-shelf')?.getAttribute('aria-hidden')).toBe('false');
      expect(document.activeElement).toBe(rendered.container.querySelector('#project-shelf-tags'));
    });
  });

  it('enables History only when a prompt document is selected', async () => {
    library.selected = {
      projectPath: '/project',
      relativePath: 'prompt.md',
      name: 'prompt',
      folder: '',
      extension: '.md',
      body: 'body',
      raw: 'body',
      metadata: {
        description: '',
        tags: [],
        status: 'active',
        favorite: false,
        models: [],
        related: [],
        extra: {},
      },
      modifiedAt: 0,
      hasFrontmatter: false,
    };

    const props = sidebarProps();
    render(ProjectSidebar, { props });

    const history = within(screen.getByRole('navigation', { name: 'Library navigation rail' })).getByRole('button', { name: 'Show prompt history' });
    expect(history.hasAttribute('disabled')).toBe(false);
    await fireEvent.click(history);
    expect(props.onOpenHistory).toHaveBeenCalledOnce();
  });
});

describe('responsive Floating Shelf contracts', () => {
  it('disables hidden Detail actions and the collapsed Shelf resizer at 720px', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 980px)' || query === '(max-width: 720px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    library.selected = {
      projectPath: '/project',
      relativePath: 'prompt.md',
      name: 'prompt',
      folder: '',
      extension: '.md',
      body: 'body',
      raw: 'body',
      metadata: {
        description: '',
        tags: [],
        status: 'active',
        favorite: false,
        models: [],
        related: [],
        extra: {},
      },
      modifiedAt: 0,
      hasFrontmatter: false,
    };
    library.selectedProjectPath = '/project';
    library.selectedName = 'prompt';

    render(PromptsView);

    await waitFor(() => {
      const rail = within(screen.getByRole('navigation', { name: 'Library navigation rail' }));
      expect(rail.getByRole('button', { name: 'Show prompt history' }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByRole('button', { name: 'Resize project sidebar' }).hasAttribute('disabled')).toBe(true);
      expect(rail.getByRole('button', { name: 'Expand project shelf' })).toBeTruthy();
    });
  });
});
