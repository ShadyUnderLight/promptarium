/**
 * Regression coverage for the packaged macOS dialog boundary.
 *
 * WKWebView does not provide JavaScript prompt/confirm panels. These tests
 * run the real sidebar/menu/example components with the Tauri branch enabled
 * and verify that the app-owned callbacks receive the request instead of
 * touching the browser-native APIs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import ProjectSidebar from '../src/lib/components/library/ProjectSidebar.svelte';
import ExamplesEditor from '../src/lib/components/library/ExamplesEditor.svelte';
import { library } from '../src/lib/library.svelte';
import { isTauri, pickAssetReference, resolvePromptAssets } from '$lib/api';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => true),
  pickAssetReference: vi.fn(),
  resolvePromptAssets: vi.fn(),
  revealInFinder: vi.fn(),
}));

const isTauriMock = vi.mocked(isTauri);
const pickAssetReferenceMock = vi.mocked(pickAssetReference);
const resolvePromptAssetsMock = vi.mocked(resolvePromptAssets);

const sidebarBaseProps = {
  onNewPrompt: () => {},
  canNavigate: async () => true,
  onNotice: () => {},
  onModalChange: () => {},
};

beforeEach(() => {
  isTauriMock.mockReturnValue(true);
  library.projects = [{ path: '/proj', name: 'My Proj' }];
  library.activeProjectPath = '/proj';
  library.libraryScope = { kind: 'project', projectPath: '/proj' };
  library.allPrompts = [];
  library.prompts = [];
  library.folderPaths = [];
  library.allProjectsWarnings = [];
  library.errorCode = null;
  library.error = null;
  library.folderFilter = '';
  library.tagFilter = '';
  library.smartView = 'all';
  resolvePromptAssetsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Tauri sidebar dialog routing', () => {
  it('routes folder actions to app-owned dialogs', async () => {
    library.folderPaths = ['notes'];
    const requestName = vi.fn(async () => 'delete');
    const requestConfirm = vi.fn(async () => false);
    const nativePrompt = vi.spyOn(window, 'prompt');
    const nativeConfirm = vi.spyOn(window, 'confirm');

    render(ProjectSidebar, {
      props: { ...sidebarBaseProps, requestName, requestConfirm },
    });

    await fireEvent.contextMenu(screen.getByText('notes'));
    await waitFor(() => expect(requestConfirm).toHaveBeenCalled());

    expect(requestName).toHaveBeenCalledWith(
      'Folder action: rename or delete',
      'rename',
      { label: 'Folder action: rename or delete', hint: '' }
    );
    expect(requestConfirm).toHaveBeenCalledWith(
      'Delete empty folder?',
      'Delete empty folder “notes”?',
      { confirmLabel: 'Delete folder', destructive: true }
    );
    expect(nativePrompt).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('routes project-menu rename and forget to app-owned dialogs', async () => {
    const requestName = vi.fn(async () => 'My Proj');
    const requestConfirm = vi.fn(async () => false);
    const nativePrompt = vi.spyOn(window, 'prompt');
    const nativeConfirm = vi.spyOn(window, 'confirm');

    const { container } = render(ProjectSidebar, {
      props: { ...sidebarBaseProps, requestName, requestConfirm },
    });
    const projectRow = container.querySelector('.project-row:not(.project-row--all)');
    if (!projectRow) throw new Error('project row not rendered');

    await fireEvent.contextMenu(projectRow);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename label…' }));
    await waitFor(() => expect(requestName).toHaveBeenCalledWith(
      'Project label',
      'My Proj',
      { label: 'Project label', hint: '' }
    ));
    expect(nativePrompt).not.toHaveBeenCalled();

    await fireEvent.contextMenu(projectRow);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Forget project…' }));
    await waitFor(() => expect(requestConfirm).toHaveBeenCalledWith(
      'Forget project?',
      'Forget “My Proj”? The folder and all Markdown files will stay on disk.',
      { confirmLabel: 'Forget project', destructive: true }
    ));
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});

describe('Tauri example replacement dialog routing', () => {
  it('asks through the app-owned confirm callback before dropping inline input', async () => {
    pickAssetReferenceMock.mockResolvedValue({ reference: 'assets/new.txt' });
    const requestConfirm = vi.fn(async () => false);
    const onChange = vi.fn();
    const nativeConfirm = vi.spyOn(window, 'confirm');

    render(ExamplesEditor, {
      props: {
        examples: [{ name: 'A', input: 'inline input' }],
        projectPath: '/proj',
        requestConfirm,
        onChange,
      },
    });

    await fireEvent.click(screen.getAllByRole('button', { name: /Choose file instead/ })[0]!);
    await waitFor(() => expect(requestConfirm).toHaveBeenCalledWith(
      'Replace inline text?',
      'This example has inline input text. Replace it with the file reference?',
      { confirmLabel: 'Replace', cancelLabel: 'Cancel' }
    ));
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
