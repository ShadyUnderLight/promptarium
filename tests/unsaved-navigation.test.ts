/**
 * The unsaved-changes guard is the other half of the macOS dialog fix, and the
 * half with no test until now.
 *
 * `canNavigate()` used to be `window.confirm(...)`, which on macOS WKWebView
 * returns `false` **without showing anything** — so with an unsaved edit every
 * guarded action (select another prompt, rename, move, duplicate, delete) was
 * silently cancelled and the user was never asked. It now resolves through the
 * in-app ConfirmDialog.
 *
 * These tests drive the real shell so that swapping the guard back to a native
 * call fails here instead of regressing quietly, and they pin the modal
 * contracts the review called out: while any modal is open the global
 * shortcuts (⌘N/⌘F/⌘S) must not reach the page behind it — including the
 * naming dialog Prompt Detail owns, which the shell only learned about once it
 * reported its state up.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import PromptsView from '../src/lib/components/PromptsView.svelte';
import { library, saveDocument, selectPrompt } from '../src/lib/library.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';
import type { PromptDocument, PromptSummary } from '../src/lib/prompts/types';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
  resolvePromptAssets: vi.fn(async () => []),
  pickAssetReference: vi.fn(async () => ({ failure: 'cancelled' as const })),
  revealAssetInFinder: vi.fn(async () => undefined),
  revealInFinder: vi.fn(async () => undefined),
}));

// Keep the real `library` state and every other export; stub only the calls
// that would reach the (unmocked) backend or the filesystem.
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

const selectPromptMock = selectPrompt as unknown as Mock;
const saveDocumentMock = saveDocument as unknown as Mock;

const metadata = {
  description: '',
  tags: [],
  status: 'active' as const,
  favorite: false,
  models: [],
  related: [],
  extra: {},
};

function documentFixture(name: string): PromptDocument {
  return {
    projectPath: '/proj',
    relativePath: `${name}.md`,
    name,
    folder: '',
    extension: '.md',
    body: `body of ${name}`,
    raw: `---\nstatus: active\n---\nbody of ${name}`,
    metadata,
    modifiedAt: 0,
    hasFrontmatter: true,
  } as PromptDocument;
}

function summaryFixture(name: string): PromptSummary {
  return {
    projectPath: '/proj',
    relativePath: `${name}.md`,
    name,
    folder: '',
    extension: '.md',
    metadata,
    modifiedAt: 0,
    hasFrontmatter: true,
  } as PromptSummary;
}

/** The prompt-list row whose title is exactly `name`. */
function rowFor(container: HTMLElement, name: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>('.prompt-list-item')].find(
    (item) => item.querySelector('.prompt-list-item__title')?.textContent?.trim() === name
  );
  if (!row) throw new Error(`no prompt row titled ${name}`);
  return row;
}

/** Put the editor into edit mode with an unsaved change, so the guard engages. */
async function makeEditorDirty(container: HTMLElement): Promise<void> {
  await fireEvent.click(screen.getByRole('tab', { name: '编辑' }));
  const editor = container.querySelector('#prompt-body') as HTMLTextAreaElement;
  await fireEvent.input(editor, { target: { value: 'unsaved edit' } });
  await waitFor(() => expect(container.querySelector('.dirty-dot')).not.toBeNull());
}

/** Let a fire-and-forget handler settle before asserting its side effects. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const unsavedTitle = '放弃未保存的改动？';

beforeEach(() => {
  localStorage.clear();
  // jsdom implements no matchMedia; the shell reads it once for the theme.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  );
  setPreference('zh-CN');
  library.projects = [{ path: '/proj', name: 'My Proj' }];
  library.activeProjectPath = '/proj';
  library.libraryScope = { kind: 'project', projectPath: '/proj' };
  library.allPrompts = [summaryFixture('a'), summaryFixture('b')];
  library.prompts = [summaryFixture('a'), summaryFixture('b')];
  library.folderPaths = [];
  library.allProjectsWarnings = [];
  library.selected = documentFixture('a');
  library.selectedName = 'a';
  library.selectedProjectPath = '/proj';
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
  library.externalChangeState = null;
  library.searchIndexVersion = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('unsaved-changes guard (window.confirm is unusable on macOS)', () => {
  it('dirty navigation opens the in-app ConfirmDialog instead of silently cancelling', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { container } = render(PromptsView);
    await makeEditorDirty(container);

    await fireEvent.click(rowFor(container, 'b'));

    expect(await screen.findByText(unsavedTitle)).toBeTruthy();
    expect(screen.getByText('此提示词有未保存的更改。放弃并继续？')).toBeTruthy();
    // The guard asked in-app; it never touched the native confirm.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(selectPromptMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('Cancel keeps editing: no navigation, dialog closes', async () => {
    const { container } = render(PromptsView);
    await makeEditorDirty(container);

    await fireEvent.click(rowFor(container, 'b'));
    await fireEvent.click(await screen.findByText('继续编辑'));

    await waitFor(() => expect(screen.queryByText(unsavedTitle)).toBeNull());
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(container.querySelector('.dirty-dot')).not.toBeNull();
  });

  it('Discard navigates', async () => {
    const { container } = render(PromptsView);
    await makeEditorDirty(container);

    await fireEvent.click(rowFor(container, 'b'));
    await fireEvent.click(await screen.findByText('放弃更改'));

    await waitFor(() => expect(selectPromptMock).toHaveBeenCalledWith('/proj', 'b'));
  });

  it('a clean editor navigates without asking', async () => {
    const { container } = render(PromptsView);

    await fireEvent.click(rowFor(container, 'b'));

    await waitFor(() => expect(selectPromptMock).toHaveBeenCalledWith('/proj', 'b'));
    expect(screen.queryByText(unsavedTitle)).toBeNull();
  });
});

describe('global shortcuts yield while a modal is open', () => {
  function searchInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('.global-search input') as HTMLInputElement;
  }

  function openNamingDialog(container: HTMLElement): HTMLInputElement {
    const dialog = container.querySelector('dialog[aria-labelledby="name-prompt-title"]');
    if (!dialog) throw new Error('naming dialog did not open');
    return dialog.querySelector('input') as HTMLInputElement;
  }

  it('control: with no modal open the shortcuts are still live', async () => {
    const { container } = render(PromptsView);

    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(document.activeElement).toBe(searchInput(container));

    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    await waitFor(() => expect(container.querySelector('.new-prompt-dialog')).not.toBeNull());
  });

  it('⌘N and ⌘F do not reach the page behind the naming dialog', async () => {
    const { container } = render(PromptsView);

    await fireEvent.click(screen.getByText('重命名'));
    const field = openNamingDialog(container);

    fireEvent.keyDown(field, { key: 'n', metaKey: true });
    fireEvent.keyDown(field, { key: 'f', metaKey: true });

    // No second modal stacked on top, and the search box behind did not grab
    // focus away from the dialog.
    expect(container.querySelector('.new-prompt-dialog')).toBeNull();
    expect(document.activeElement).not.toBe(searchInput(container));
    expect(field.isConnected).toBe(true);
  });

  it('⌘S does not save the editor behind the naming dialog', async () => {
    const { container } = render(PromptsView);
    await makeEditorDirty(container);

    await fireEvent.click(screen.getByText('重命名'));
    fireEvent.keyDown(openNamingDialog(container), { key: 's', metaKey: true });
    await flush();

    expect(saveDocumentMock).not.toHaveBeenCalled();
  });

  it('⌘F does not steal focus while the unsaved ConfirmDialog is open', async () => {
    const { container } = render(PromptsView);
    await makeEditorDirty(container);

    await fireEvent.click(rowFor(container, 'b'));
    const dialog = (await screen.findByText(unsavedTitle)).closest('dialog')!;

    fireEvent.keyDown(dialog, { key: 'f', metaKey: true });

    expect(document.activeElement).not.toBe(searchInput(container));
    expect(container.querySelector('.new-prompt-dialog')).toBeNull();
  });
});
