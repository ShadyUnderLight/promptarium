/**
 * Issue #36 — Core UI localization regression tests.
 *
 * Covers the issue's checklist at component level:
 *  - English / zh-CN sidebar renders the core App-owned copy;
 *  - runtime locale switch updates the same mounted component;
 *  - user data (project name, tag/folder text) stays unchanged through a
 *    locale switch;
 *  - plural counts come from the catalog, never from an English
 *    `count === 1 ? '' : 's'` suffix;
 *  - library empty states translate under both locales;
 *  - sort/view machine enums stay untouched while their display labels and
 *    representative aria-labels switch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import ProjectSidebar from '../src/lib/components/library/ProjectSidebar.svelte';
import PromptLibrary from '../src/lib/components/library/PromptLibrary.svelte';
import PromptToolbar from '../src/lib/components/library/PromptToolbar.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';
import type { PromptSummary } from '../src/lib/prompts/types';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
}));

const sidebarProps = {
  onNewPrompt: () => {},
  canNavigate: () => true,
  onNotice: () => {},
};

const libraryProps = {
  onSelectPrompt: () => {},
  onNewPrompt: () => {},
  onBatch: () => Promise.resolve(true),
};

function summary(overrides: Partial<PromptSummary> = {}): PromptSummary {
  return {
    projectPath: '/proj',
    relativePath: 'a.md',
    name: 'a',
    folder: 'root',
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
    hasFrontmatter: true,
    ...overrides,
  } as PromptSummary;
}

function resetLibrary(): void {
  library.projects = [{ path: '/proj', name: 'My Proj' }];
  library.activeProjectPath = '/proj';
  library.libraryScope = { kind: 'project', projectPath: '/proj' };
  library.allPrompts = [];
  library.prompts = [];
  library.prompts = [];
  library.folderPaths = [];
  library.allProjectsWarnings = [];
  library.allProjectsHealthyPaths = [];
  library.errorCode = null;
  library.error = null;
  library.loading = false;
  library.refreshing = false;
  library.searchQuery = '';
  library.smartView = 'all';
  library.folderFilter = '';
  library.tagFilter = '';
  library.modelFilter = '';
  library.sort = 'modified-desc';
  library.viewMode = 'list';
}

beforeEach(() => {
  localStorage.clear();
  // jsdom exposes no real system language, so `system` resolves to English.
  setPreference('system');
  resetLibrary();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('sidebar render per locale (Issue #36)', () => {
  it('English sidebar renders Projects, All Projects, Needs Attention, New prompt', () => {
    render(ProjectSidebar, { props: sidebarProps });
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('All Projects')).toBeTruthy();
    expect(screen.getByText('Needs Attention')).toBeTruthy();
    // The new-prompt button renders "＋ New prompt" — match the label fragment.
    expect(screen.getByText(/New prompt/)).toBeTruthy();
  });

  it('zh-CN sidebar renders 项目, 全部项目, 需要处理, 新建提示词', async () => {
    setPreference('zh-CN');
    render(ProjectSidebar, { props: sidebarProps });
    expect(screen.getByText('项目')).toBeTruthy();
    expect(screen.getByText('全部项目')).toBeTruthy();
    expect(screen.getByText('需要处理')).toBeTruthy();
    expect(screen.getByText(/新建提示词/)).toBeTruthy();
  });

  it('runtime locale switch updates the same mounted component', async () => {
    const { container } = render(ProjectSidebar, { props: sidebarProps });
    expect(screen.getByText('Projects')).toBeTruthy();

    setPreference('zh-CN');
    await waitFor(() => {
      expect(container.textContent).toContain('项目');
      expect(container.textContent).not.toContain('Projects');
    });

    setPreference('en');
    await waitFor(() => {
      expect(container.textContent).toContain('Projects');
      expect(container.textContent).not.toContain('项目');
    });
  });

  it('user project name stays unchanged through a locale switch', async () => {
    const { container } = render(ProjectSidebar, { props: sidebarProps });
    expect(container.textContent).toContain('My Proj');

    setPreference('zh-CN');
    await waitFor(() => {
      expect(container.textContent).toContain('项目');
    });
    expect(container.textContent).toContain('My Proj');
  });

  it('sidebar navigation aria-label switches with the locale', async () => {
    const { container } = render(ProjectSidebar, { props: sidebarProps });
    const aside = container.querySelector('aside');
    expect(aside?.getAttribute('aria-label')).toBe('Prompt Library navigation');

    setPreference('zh-CN');
    await waitFor(() => {
      expect(aside?.getAttribute('aria-label')).toBe('提示词库导航');
    });
  });
});

describe('all-projects warning counts (Issue #36 plural rule)', () => {
  function warn(n: number): void {
    library.allProjectsWarnings = Array.from({ length: n }, (_, i) => ({
      projectPath: '/p' + i,
      error: 'boom',
    }));
    library.libraryScope = { kind: 'all-projects' };
  }

  it('1 failed project renders the English singular', () => {
    warn(1);
    render(ProjectSidebar, { props: sidebarProps });
    expect(screen.getByText('1 project could not refresh')).toBeTruthy();
  });

  it('2 failed projects render the English plural', () => {
    warn(2);
    render(ProjectSidebar, { props: sidebarProps });
    expect(screen.getByText('2 projects could not refresh')).toBeTruthy();
  });

  it('zh-CN renders count copy without any English plural suffix logic', async () => {
    warn(2);
    setPreference('zh-CN');
    const { container } = render(ProjectSidebar, { props: sidebarProps });
    expect(container.textContent).toContain('2 个项目刷新失败');
    expect(container.textContent).not.toContain('projects could not refresh');
  });
});

describe('library states per locale (Issue #36)', () => {
  it('no-project empty state renders in English and Chinese', async () => {
    library.projects = [];
    render(PromptLibrary, { props: libraryProps });
    expect(screen.getByText('Choose a prompt project')).toBeTruthy();
    cleanup();

    setPreference('zh-CN');
    render(PromptLibrary, { props: libraryProps });
    expect(screen.getByText('选择一个提示词项目')).toBeTruthy();
  });

  it('no-prompts-yet and no-matching states render in both locales', async () => {
    render(PromptLibrary, { props: libraryProps });
    expect(screen.getByText('No prompts yet')).toBeTruthy();
    cleanup();

    library.searchQuery = 'zzz-no-match';
    render(PromptLibrary, { props: libraryProps });
    expect(screen.getByText('No matching prompts')).toBeTruthy();
    expect(screen.getByText('Try another search or clear a filter.')).toBeTruthy();
    cleanup();

    setPreference('zh-CN');
    render(PromptLibrary, { props: libraryProps });
    expect(screen.getByText('没有匹配的提示词')).toBeTruthy();
    expect(screen.getByText('尝试其他搜索条件或清除筛选。')).toBeTruthy();
  });

  it('user prompt names survive the locale switch', async () => {
    // visiblePrompts() filters `library.prompts` (the search snapshot), so the
    // fixture must populate both the roster and the visible snapshot.
    const one = summary();
    library.allPrompts = [one];
    library.prompts = [one];
    const { container } = render(PromptLibrary, { props: libraryProps });
    expect(container.textContent).toContain('a');

    setPreference('zh-CN');
    await waitFor(() => {
      // Toolbar count line proves the same component re-rendered in zh-CN.
      expect(container.textContent).toContain('1 个提示词');
    });
    expect(container.textContent).toContain('a');
  });
});

describe('toolbar controls: machine state vs display copy (Issue #36)', () => {
  it('sort enum value stays stable while the label switches language', async () => {
    const { container } = render(PromptToolbar, {
      props: { ...libraryProps, selectedCount: 0, onSelectAll: () => {}, onClearSelection: () => {}, onBatch: () => {} },
    });
    const select = container.querySelector('select');
    expect(select?.value).toBe('modified-desc');
    expect(screen.getByText('Modified newest')).toBeTruthy();

    setPreference('zh-CN');
    await waitFor(() => {
      expect(screen.getByText('最近修改')).toBeTruthy();
    });
    expect(select?.value).toBe('modified-desc');
    expect(screen.queryByText('Modified newest')).toBeNull();
  });

  it('representative aria-labels switch with the locale', async () => {
    const { container } = render(PromptToolbar, {
      props: { ...libraryProps, selectedCount: 0, onSelectAll: () => {}, onClearSelection: () => {}, onBatch: () => {} },
    });
    const select = container.querySelector('select[aria-label="Sort prompts"]');
    expect(select).toBeTruthy();

    setPreference('zh-CN');
    await waitFor(() => {
      expect(container.querySelector('select[aria-label="提示词排序"]')).toBeTruthy();
    });
  });

  it('batch toolbar counts translate', async () => {
    render(PromptToolbar, {
      props: { selectedCount: 3, onSelectAll: () => {}, onClearSelection: () => {}, onBatch: () => {} },
    });
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByText('Select all')).toBeTruthy();

    setPreference('zh-CN');
    await waitFor(() => {
      expect(screen.getByText('已选择 3 项')).toBeTruthy();
      expect(screen.getByText('全选')).toBeTruthy();
    });
  });
});
