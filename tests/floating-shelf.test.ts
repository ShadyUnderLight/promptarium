import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import ProjectSidebar from '../src/lib/components/library/ProjectSidebar.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
}));

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
});

afterEach(() => {
  cleanup();
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
