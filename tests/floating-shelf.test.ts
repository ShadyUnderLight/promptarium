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

type QueryListener = (event: MediaQueryListEvent) => void;

function mediaQueryStub(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<QueryListener>();
  return {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_event: string, listener: QueryListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: QueryListener) => {
      listeners.delete(listener);
    }),
    fire(next: boolean): void {
      matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
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
  library.allProjectsHealthyPaths = [];
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
  library.fsWatchAvailable = true;
  library.fsWatchMessage = null;
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
    const shelfToggle = railQueries.getByRole('button', { name: 'Collapse project shelf' });
    await fireEvent.click(shelfToggle);

    expect(props.onFocusSearch).toHaveBeenCalledOnce();
    expect(props.onToggleShelf).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(shelfToggle);
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
    const projects = screen.getByRole('group', { name: 'Projects' });
    const folders = screen.getByRole('group', { name: 'Folders' });
    const tags = screen.getByRole('group', { name: 'Tags' });

    await fireEvent.click(rail.getByRole('button', { name: 'Focus projects' }));
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('.project-row')));
    expect(document.activeElement).not.toBe(projects);

    await fireEvent.click(rail.getByRole('button', { name: 'Focus folders' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(folders);
    });

    await fireEvent.click(rail.getByRole('button', { name: 'Focus tags' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(tags);
    });
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

  it('keeps the complete Tag value available as a tooltip', () => {
    const longTag = 'a-tag-name-that-is-longer-than-the-sidebar-width';
    library.allPrompts = [
      {
        projectPath: '/project',
        relativePath: 'prompt.md',
        name: 'prompt',
        folder: '',
        extension: '.md',
        metadata: {
          description: '',
          tags: [longTag],
          status: 'active',
          favorite: false,
          models: [],
          related: [],
          extra: {},
        },
        modifiedAt: 0,
        hasFrontmatter: false,
      },
    ];

    const { container } = render(ProjectSidebar, { props: sidebarProps() });
    const tagButton = container.querySelector<HTMLButtonElement>('.sidebar-section--tags .sidebar-nav__item');
    expect(tagButton?.getAttribute('title')).toBe('#' + longTag);
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

  it('keeps an All Projects partial-refresh warning visible while the Shelf is collapsed', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 980px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    library.libraryScope = { kind: 'all-projects' };
    library.allProjectsWarnings = [{ projectPath: '/project', error: 'permission denied' }];

    const { container } = render(PromptsView);

    const warning = await screen.findByRole('status');
    expect(warning.textContent).toContain('1 project could not refresh');
    expect(screen.getByRole('button', { name: 'Show failed project details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand project shelf' })).toBeTruthy();
    const warningDetail = container.querySelector<HTMLElement>('#project-shelf-warnings');
    const scrollIntoView = vi.fn();
    if (!warningDetail) throw new Error('warning detail did not render');
    warningDetail.scrollIntoView = scrollIntoView;

    await fireEvent.click(screen.getByRole('button', { name: 'Show failed project details' }));
    await waitFor(() => {
      const visibleWarningDetail = screen.getByRole('group', { name: '1 project could not refresh' });
      expect(container.querySelector('#project-shelf')?.getAttribute('aria-hidden')).toBe('false');
      expect(screen.queryByRole('button', { name: 'Show failed project details' })).toBeNull();
      expect(screen.getByText('Project — permission denied')).toBeTruthy();
      expect(visibleWarningDetail).toBe(warningDetail);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(document.activeElement).toBe(visibleWarningDetail);
    });
  });

  it('keeps focus on the Shelf toggle if warning details disappear during expansion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 980px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    library.libraryScope = { kind: 'all-projects' };
    library.allProjectsWarnings = [{ projectPath: '/project', error: 'permission denied' }];

    render(PromptsView);

    const click = fireEvent.click(screen.getByRole('button', { name: 'Show failed project details' }));
    library.allProjectsWarnings = [];
    await click;

    await waitFor(() => {
      const toggle = screen.getByRole('button', { name: 'Collapse project shelf' });
      expect(document.activeElement).toBe(toggle);
    });
  });

  it('keeps missing-project recovery visible while the Shelf is collapsed', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 980px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    library.errorCode = 'PROJECT_FOLDER_NOT_FOUND';
    library.error = '/missing/proj';
    library.activeProjectPath = '/missing/proj';
    library.libraryScope = { kind: 'project', projectPath: '/missing/proj' };

    const { container } = render(PromptsView);
    const summary = await screen.findByRole('status');
    expect(within(summary).getByText('Project folder not found')).toBeTruthy();
    expect(within(summary).getByText('/missing/proj')).toBeTruthy();
    expect(within(summary).getByRole('button', { name: 'Show recovery options' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand project shelf' })).toBeTruthy();

    await fireEvent.click(within(summary).getByRole('button', { name: 'Show recovery options' }));
    await waitFor(() => {
      const recovery = screen.getByRole('group', { name: 'Project folder not found' });
      expect(container.querySelector('#project-shelf')?.getAttribute('aria-hidden')).toBe('false');
      expect(screen.getByRole('button', { name: 'Locate folder' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
      expect(document.activeElement).toBe(recovery);
    });
  });

  it('reacts to mounted breakpoint change events', async () => {
    const shelfQuery = mediaQueryStub(false);
    const detailQuery = mediaQueryStub(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) =>
        query === '(max-width: 980px)' ? shelfQuery : detailQuery
      )
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
    const rail = within(screen.getByRole('navigation', { name: 'Library navigation rail' }));

    await waitFor(() => {
      expect(rail.getByRole('button', { name: 'Collapse project shelf' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Resize project sidebar' }).hasAttribute('disabled')).toBe(false);
      expect(rail.getByRole('button', { name: 'Show prompt history' }).hasAttribute('disabled')).toBe(false);
    });

    const shelf = document.getElementById('project-shelf');
    if (!shelf) throw new Error('project shelf did not render');
    const shelfControl = within(shelf).getByRole('button', { name: 'All Projects' });
    shelfControl.focus();
    shelfQuery.fire(true);
    await waitFor(() => {
      expect(rail.getByRole('button', { name: 'Expand project shelf' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Resize project sidebar' }).hasAttribute('disabled')).toBe(true);
      expect(document.activeElement).toBe(rail.getByRole('button', { name: 'Expand project shelf' }));
    });

    shelfQuery.fire(false);
    await waitFor(() => {
      expect(rail.getByRole('button', { name: 'Collapse project shelf' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Resize project sidebar' }).hasAttribute('disabled')).toBe(false);
    });

    detailQuery.fire(true);
    await waitFor(() =>
      expect(rail.getByRole('button', { name: 'Show prompt history' }).hasAttribute('disabled')).toBe(true)
    );

    detailQuery.fire(false);
    await waitFor(() =>
      expect(rail.getByRole('button', { name: 'Show prompt history' }).hasAttribute('disabled')).toBe(false)
    );
  });
});
