/**
 * Prompt Detail naming steps must go through the in-app dialog, never
 * `window.prompt`.
 *
 * macOS runs Tauri on a WKWebView whose UI delegate implements no JavaScript
 * prompt panel, so `window.prompt` resolves to `null` **without showing
 * anything**: Duplicate / Duplicate as Variant / Rename / Move silently did
 * nothing. These tests drive the dialog itself — if a naming step is ever
 * routed back through the native call there is no dialog to type into, so the
 * tests fail instead of quietly regressing again.
 *
 * All four actions are covered, plus the contract the dialog owes its caller on
 * the way out: a blank submit closes without acting, exactly as the native
 * prompt did.
 *
 * The shell's side of the contract — that the shortcuts yield while one of
 * these dialogs is open — lives in unsaved-navigation.test.ts, which drives the
 * real shell and sees the dialog through the DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import PromptDetail from '../src/lib/components/library/PromptDetail.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';
import type { PromptDocument } from '../src/lib/prompts/types';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
  resolvePromptAssets: vi.fn(async () => []),
  pickAssetReference: vi.fn(async () => ({ failure: 'cancelled' as const })),
  revealAssetInFinder: vi.fn(async () => undefined),
}));

function documentFixture(overrides: Partial<PromptDocument> = {}): PromptDocument {
  return {
    projectPath: '/proj',
    relativePath: 'a.md',
    name: 'a',
    folder: '',
    extension: '.md',
    body: 'Hello {focus} body',
    raw: '---\nstatus: active\n---\nHello {focus} body',
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
  } as PromptDocument;
}

const detailProps = {
  loading: false,
  onSave: vi.fn(async (document: PromptDocument, body: string) => ({ ...document, body })),
  onReload: vi.fn(async () => undefined),
  onCopy: async () => true,
  onReveal: () => {},
  onRename: vi.fn(),
  onMove: vi.fn(),
  onDuplicate: vi.fn(),
  onDuplicateAsVariant: vi.fn(),
  onDeleteRequest: vi.fn(),
  onDirtyChange: () => {},
  onDismissExternalChange: () => {},
  onNotice: () => {},
  onNavigate: () => {},
};

interface DialogParts {
  input: HTMLInputElement;
  confirm: HTMLButtonElement;
  cancel: HTMLButtonElement;
}

/** The dialog itself, or null when no dialog is open. */
function openDialog(container: HTMLElement): DialogParts | null {
  const dialog = container.querySelector('dialog.modal');
  if (!dialog) return null;
  return {
    input: dialog.querySelector('input') as HTMLInputElement,
    confirm: dialog.querySelector('.modal__actions .btn--primary') as HTMLButtonElement,
    cancel: dialog.querySelector('.modal__actions .btn--ghost') as HTMLButtonElement,
  };
}

/** Let the awaited name request settle before asserting on its outcome. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  setPreference('zh-CN');
  library.externalChangeState = null;
  library.searchIndexVersion = 0;
  library.allPrompts = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Prompt Detail naming dialog (window.prompt is unusable on macOS)', () => {
  it('创建副本 asks for a name in-app and hands it to onDuplicate', async () => {
    const document = documentFixture();
    const { container } = render(PromptDetail, { props: { ...detailProps, document } });

    await fireEvent.click(screen.getByText('创建副本'));

    const dialog = openDialog(container);
    expect(dialog).not.toBeNull();
    // Dialog title and its prefilled suggestion both come from the existing copy.
    expect(screen.getByText('副本的新文件名')).toBeTruthy();
    expect(dialog!.input.value).toBe('a-copy');

    await fireEvent.input(dialog!.input, { target: { value: 'a-copy-2' } });
    await fireEvent.click(dialog!.confirm);

    await waitFor(() => expect(detailProps.onDuplicate).toHaveBeenCalledTimes(1));
    expect(detailProps.onDuplicate).toHaveBeenCalledWith(document, 'a-copy-2');
    expect(openDialog(container)).toBeNull();
  });

  it('创建变体副本 suggests <name>-variant and hands it to onDuplicateAsVariant', async () => {
    const document = documentFixture();
    const { container } = render(PromptDetail, { props: { ...detailProps, document } });

    await fireEvent.click(screen.getByText('创建变体副本'));

    const dialog = openDialog(container);
    expect(dialog).not.toBeNull();
    expect(screen.getByText('变体副本的新文件名')).toBeTruthy();
    expect(dialog!.input.value).toBe('a-variant');

    await fireEvent.click(dialog!.confirm);

    await waitFor(() => expect(detailProps.onDuplicateAsVariant).toHaveBeenCalledTimes(1));
    expect(detailProps.onDuplicateAsVariant).toHaveBeenCalledWith(document, 'a-variant');
  });

  it('重命名 keeps its no-op when the name is unchanged, and renames on change', async () => {
    const document = documentFixture();
    const { container } = render(PromptDetail, { props: { ...detailProps, document } });

    await fireEvent.click(screen.getByText('重命名'));
    await fireEvent.click(openDialog(container)!.confirm);
    await flush();
    expect(detailProps.onRename).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByText('重命名'));
    await fireEvent.input(openDialog(container)!.input, { target: { value: 'codes/review' } });
    await fireEvent.click(openDialog(container)!.confirm);

    await waitFor(() => expect(detailProps.onRename).toHaveBeenCalledWith(document, 'codes/review'));
  });

  it('移动 asks for the relative path in-app and hands it to onMove', async () => {
    const document = documentFixture();
    const { container } = render(PromptDetail, { props: { ...detailProps, document } });

    await fireEvent.click(screen.getByText('移动'));

    const dialog = openDialog(container);
    expect(dialog).not.toBeNull();
    expect(screen.getByText('移动提示词到相对路径')).toBeTruthy();
    expect(dialog!.input.value).toBe('a');

    // Same-name move stays a no-op, like it did before the dialog swap.
    await fireEvent.click(dialog!.confirm);
    await flush();
    expect(detailProps.onMove).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByText('移动'));
    await fireEvent.input(openDialog(container)!.input, { target: { value: 'codes/review' } });
    await fireEvent.click(openDialog(container)!.confirm);

    await waitFor(() => expect(detailProps.onMove).toHaveBeenCalledWith(document, 'codes/review'));
    expect(openDialog(container)).toBeNull();
  });

  it('a blank submit closes without acting, matching the native prompt it replaced', async () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });

    await fireEvent.click(screen.getByText('创建副本'));
    await fireEvent.input(openDialog(container)!.input, { target: { value: '   ' } });
    await fireEvent.click(openDialog(container)!.confirm);
    await flush();

    // The dialog must not sit there looking broken on an empty answer.
    expect(openDialog(container)).toBeNull();
    expect(detailProps.onDuplicate).not.toHaveBeenCalled();
  });

  it('取消 closes the dialog without acting', async () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });

    await fireEvent.click(screen.getByText('创建副本'));
    expect(openDialog(container)).not.toBeNull();

    await fireEvent.click(openDialog(container)!.cancel);
    await flush();

    expect(openDialog(container)).toBeNull();
    expect(detailProps.onDuplicate).not.toHaveBeenCalled();
  });
});
