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

function legacyMediaQueryStub(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<QueryListener>();
  return {
    get matches() {
      return matches;
    },
    addListener: vi.fn((listener: QueryListener) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: QueryListener) => {
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
  library.sidebarWidth = 244;
  library.libraryWidth = 362;
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
    expect(railQueries.getByRole('button', { name: 'Focus projects' }).getAttribute('aria-current')).toBe('true');
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

  it('reports the active folder and tag filters on the Rail', async () => {
    library.folderFilter = 'notes';
    library.tagFilter = '';
    const { container } = render(ProjectSidebar, { props: sidebarProps() });
    const rail = within(screen.getByRole('navigation', { name: 'Library navigation rail' }));

    expect(rail.getByRole('button', { name: 'Focus folders' }).getAttribute('aria-current')).toBe('true');
    expect(rail.getByRole('button', { name: 'Focus tags' }).getAttribute('aria-current')).toBeNull();

    library.folderFilter = '';
    library.tagFilter = 'release';
    await waitFor(() => {
      expect(rail.getByRole('button', { name: 'Focus folders' }).getAttribute('aria-current')).toBeNull();
      expect(rail.getByRole('button', { name: 'Focus tags' }).getAttribute('aria-current')).toBe('true');
    });
    expect(container.querySelector('.library-rail__spacer')).toBeNull();
  });
});

/**
 * Issue #67 — the Shelf's current item has to be *reported*, not only painted.
 * `sidebar-nav__item--active` is a colour, and before this the only
 * `aria-current` in the app sat on the Rail, so a screen reader could not tell
 * which Smart View, folder or tag the list below was filtered by.
 */
describe('Floating Shelf current item semantics (Issue #67)', () => {
  /** Shelf items carry a count span, and folder rows lead with a glyph. */
  function shelfItem(container: HTMLElement, label: string): HTMLElement {
    const item = Array.from(
      container.querySelectorAll<HTMLElement>('.sidebar-nav__item')
    ).find((candidate) =>
      Array.from(candidate.children).some((child) => child.textContent?.trim() === label)
    );
    if (!item) throw new Error(`no Shelf nav item labelled ${label}`);
    return item;
  }

  function isCurrent(container: HTMLElement, label: string): boolean {
    return shelfItem(container, label).getAttribute('aria-current') === 'true';
  }

  it('marks the current Smart View and clears the marker from the others', async () => {
    library.smartView = 'favorites';
    const { container } = render(ProjectSidebar, { props: sidebarProps() });

    expect(isCurrent(container, 'Favorites')).toBe(true);
    for (const label of ['All prompts', 'Needs Attention', 'Draft', 'Archived']) {
      expect(isCurrent(container, label)).toBe(false);
    }

    library.smartView = 'draft';
    await waitFor(() => expect(isCurrent(container, 'Draft')).toBe(true));
    expect(isCurrent(container, 'Favorites')).toBe(false);
  });

  it('keeps All prompts current only while no folder or tag narrows it', async () => {
    library.folderPaths = ['notes'];
    library.allPrompts = [
      {
        projectPath: '/project',
        relativePath: 'notes/prompt.md',
        name: 'prompt',
        folder: 'notes',
        extension: '.md',
        metadata: {
          description: '',
          tags: ['release'],
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

    expect(isCurrent(container, 'All prompts')).toBe(true);

    library.folderFilter = 'notes';
    await waitFor(() => expect(isCurrent(container, 'notes')).toBe(true));
    expect(isCurrent(container, 'All prompts')).toBe(false);

    // Folder and tag filters are one slot each in the Shelf, so hand the slot over.
    library.folderFilter = '';
    library.tagFilter = 'release';
    await waitFor(() => expect(isCurrent(container, '#release')).toBe(true));
    expect(isCurrent(container, 'notes')).toBe(false);
    expect(isCurrent(container, 'All prompts')).toBe(false);
  });

  /**
   * The composition the reducer does allow. It is the case `smartViewActive()`
   * is easiest to "simplify" wrongly — folding the folder/tag guard into every
   * view instead of only `all` would silently drop the marker from Needs
   * Attention the moment a folder is picked — and it puts two `aria-current`
   * markers on the Shelf at once, which is correct because they sit on two
   * different navigation dimensions.
   */
  it('keeps Needs Attention and the folder current together, and All prompts not', async () => {
    library.folderPaths = ['notes'];
    library.allPrompts = [
      {
        projectPath: '/project',
        relativePath: 'notes/prompt.md',
        name: 'prompt',
        folder: 'notes',
        extension: '.md',
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
      },
    ];
    const { container } = render(ProjectSidebar, { props: sidebarProps() });

    // Both markers are reached through the sidebar's own reducer rather than a
    // hand-set fixture: the folder click yields All prompts + folder, and Needs
    // Attention is the one view that keeps the folder when it is picked.
    await fireEvent.click(shelfItem(container, 'notes'));
    await waitFor(() => expect(isCurrent(container, 'notes')).toBe(true));
    expect(isCurrent(container, 'All prompts')).toBe(false);

    await fireEvent.click(shelfItem(container, 'Needs Attention'));
    await waitFor(() => expect(isCurrent(container, 'Needs Attention')).toBe(true));

    expect(isCurrent(container, 'notes')).toBe(true);
    expect(isCurrent(container, 'All prompts')).toBe(false);
    expect(library.smartView).toBe('needs-attention');
    expect(library.folderFilter).toBe('notes');
    expect(library.tagFilter).toBe('');
  });
});

describe('responsive Floating Shelf contracts', () => {
  it('resizes from rendered pane widths when persisted widths are capped', async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    library.sidebarWidth = 360;
    library.libraryWidth = 520;

    const { container } = render(PromptsView);
    const sidebarResizer = screen.getByRole('button', { name: 'Resize project sidebar' });
    const libraryResizer = screen.getByRole('button', { name: 'Resize prompt library' });

    await waitFor(() => {
      const workspace = container.querySelector<HTMLElement>('.library-workspace');
      expect(workspace?.style.getPropertyValue('--sidebar-effective-width').trim()).toBe('272px');
      expect(workspace?.style.getPropertyValue('--library-effective-width').trim()).toBe('384px');
    });

    await fireEvent.pointerDown(sidebarResizer, { clientX: 300 });
    await fireEvent.pointerMove(window, { clientX: 290 });
    await fireEvent.pointerUp(window, { clientX: 290 });
    await waitFor(() => expect(library.sidebarWidth).toBe(262));

    await fireEvent.pointerDown(libraryResizer, { clientX: 600 });
    await fireEvent.pointerMove(window, { clientX: 590 });
    await fireEvent.pointerUp(window, { clientX: 590 });
    await waitFor(() => expect(library.libraryWidth).toBe(374));

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
  });

  it('preserves capped preferred widths during outward drags and restores them after a round trip', async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    library.sidebarWidth = 360;
    library.libraryWidth = 520;

    const { container } = render(PromptsView);
    const sidebarResizer = screen.getByRole('button', { name: 'Resize project sidebar' });
    const libraryResizer = screen.getByRole('button', { name: 'Resize prompt library' });

    await waitFor(() => {
      const workspace = container.querySelector<HTMLElement>('.library-workspace');
      expect(workspace?.style.getPropertyValue('--sidebar-effective-width').trim()).toBe('272px');
      expect(workspace?.style.getPropertyValue('--library-effective-width').trim()).toBe('384px');
    });

    await fireEvent.pointerDown(sidebarResizer, { clientX: 300 });
    await fireEvent.pointerMove(window, { clientX: 310 });
    await fireEvent.pointerUp(window, { clientX: 310 });
    await waitFor(() => {
      expect(library.sidebarWidth).toBe(360);
      expect(JSON.parse(localStorage.getItem('prompt-library-ui') ?? '{}').sidebarWidth).toBe(360);
    });

    await fireEvent.pointerDown(libraryResizer, { clientX: 600 });
    await fireEvent.pointerMove(window, { clientX: 610 });
    await fireEvent.pointerUp(window, { clientX: 610 });
    await waitFor(() => {
      expect(library.libraryWidth).toBe(520);
      expect(JSON.parse(localStorage.getItem('prompt-library-ui') ?? '{}').libraryWidth).toBe(520);
    });

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => {
      const workspace = container.querySelector<HTMLElement>('.library-workspace');
      expect(workspace?.style.getPropertyValue('--sidebar-effective-width').trim()).toBe('360px');
      expect(workspace?.style.getPropertyValue('--library-effective-width').trim()).toBe('520px');
    });

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => {
      const workspace = container.querySelector<HTMLElement>('.library-workspace');
      expect(workspace?.style.getPropertyValue('--sidebar-effective-width').trim()).toBe('272px');
      expect(workspace?.style.getPropertyValue('--library-effective-width').trim()).toBe('384px');
    });

    await fireEvent.pointerDown(sidebarResizer, { clientX: 300 });
    await fireEvent.pointerMove(window, { clientX: 290 });
    await fireEvent.pointerMove(window, { clientX: 300 });
    await fireEvent.pointerUp(window, { clientX: 300 });
    await waitFor(() => expect(library.sidebarWidth).toBe(360));

    await fireEvent.pointerDown(libraryResizer, { clientX: 600 });
    await fireEvent.pointerMove(window, { clientX: 590 });
    await fireEvent.pointerMove(window, { clientX: 600 });
    await fireEvent.pointerUp(window, { clientX: 600 });
    await waitFor(() => expect(library.libraryWidth).toBe(520));

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
  });

  it('keeps effective pane widths continuous around the 1280px boundary', async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    library.sidebarWidth = 360;
    library.libraryWidth = 520;

    const { container } = render(PromptsView);
    const workspace = () => container.querySelector<HTMLElement>('.library-workspace');
    const expectedWidths = [
      [1279, 311, 444],
      [1280, 311, 445],
      [1281, 312, 445],
      [1300, 319, 457],
      [1360, 343, 493],
      [1439, 360, 520],
      [1440, 360, 520],
    ] as const;

    for (const [width, sidebarWidth, libraryWidth] of expectedWidths) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      window.dispatchEvent(new Event('resize'));
      await waitFor(() => {
        expect(workspace()?.style.getPropertyValue('--sidebar-effective-width').trim()).toBe(
          `${sidebarWidth}px`
        );
        expect(workspace()?.style.getPropertyValue('--library-effective-width').trim()).toBe(
          `${libraryWidth}px`
        );
      });
    }

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
  });

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

  it('supports legacy MediaQueryList listener APIs', async () => {
    const shelfQuery = legacyMediaQueryStub(false);
    const detailQuery = legacyMediaQueryStub(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) =>
        query === '(max-width: 980px)' ? shelfQuery : detailQuery
      )
    );

    render(PromptsView);
    const rail = within(screen.getByRole('navigation', { name: 'Library navigation rail' }));
    await waitFor(() => {
      expect(rail.getByRole('button', { name: 'Collapse project shelf' })).toBeTruthy();
    });
    expect(shelfQuery.addListener).toHaveBeenCalledOnce();
    // PromptsView owns the 720px detail rail listener; PromptDetail measures its own container.
    expect(detailQuery.addListener).toHaveBeenCalledOnce();

    shelfQuery.fire(true);
    await waitFor(() => {
      expect(rail.getByRole('button', { name: 'Expand project shelf' })).toBeTruthy();
    });

    cleanup();
    expect(shelfQuery.removeListener).toHaveBeenCalledOnce();
    expect(detailQuery.removeListener).toHaveBeenCalledOnce();
  });
});
