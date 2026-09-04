/**
 * Component-level regression for Issue #35 P0 — the missing-project recovery
 * UI must be driven by `library.errorCode` (machine state), never by an
 * English substring of the error message; and switching the active locale must
 * NOT alter the recovery branch — only the display copy translates.
 *
 * These two behaviors map directly onto the issue's acceptance checklist:
 *  - "missing Project recovery UI 由 structured state/code 触发，而不是英文 error text"
 *  - "changing locale does not alter the recovery branch selected"
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import ProjectSidebar from '../src/lib/components/library/ProjectSidebar.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
}));

const noopProps = {
  onNewPrompt: () => {},
  canNavigate: () => true,
  onNotice: () => {},
};

beforeEach(() => {
  localStorage.clear();
  // jsdom exposes no real system language, so `system` resolves to English.
  setPreference('system');
  // Project-scoped library pointing at a folder that no longer exists.
  library.projects = [{ path: '/missing/proj', name: 'Proj' }];
  library.activeProjectPath = '/missing/proj';
  library.libraryScope = { kind: 'project', projectPath: '/missing/proj' };
  library.allPrompts = [];
  library.folderPaths = [];
  library.allProjectsWarnings = [];
  library.errorCode = 'PROJECT_FOLDER_NOT_FOUND';
  library.error = '/missing/proj';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('missing-project recovery (Issue #35 P0)', () => {
  it('renders the recovery banner from errorCode, not from an English substring', () => {
    render(ProjectSidebar, { props: noopProps });
    expect(screen.getByText('Project folder not found')).toBeTruthy();
    expect(screen.getByText('/missing/proj')).toBeTruthy();
  });

  it('keeps the same recovery branch when the locale changes; only the copy translates', async () => {
    const { container } = render(ProjectSidebar, { props: noopProps });
    expect(screen.getByText('Project folder not found')).toBeTruthy();

    setPreference('zh-CN');

    // Same machine-driven branch, translated display copy (Svelte re-renders
    // asynchronously, so wait for the locale switch to flush).
    await waitFor(() => {
      expect(container.querySelector('.missing-project')).not.toBeNull();
      expect(screen.getByText('项目文件夹未找到')).toBeTruthy();
      expect(screen.queryByText('Project folder not found')).toBeNull();
    });
  });

  it('does not render the banner when a different machine state is set', () => {
    library.errorCode = null;
    library.error = null;
    render(ProjectSidebar, { props: noopProps });
    expect(screen.queryByText('Project folder not found')).toBeNull();
    expect(screen.queryByText('项目文件夹未找到')).toBeNull();
  });
});
