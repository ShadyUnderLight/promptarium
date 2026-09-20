import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import PromptDetail from '../src/lib/components/library/PromptDetail.svelte';
import VariantFamilyList from '../src/lib/components/library/VariantFamilyList.svelte';
import type { PromptDocument } from '../src/lib/prompts/types';

function documentFixture(): PromptDocument {
  return {
    projectPath: '/project',
    name: 'sample',
    relativePath: 'sample.md',
    folder: '',
    extension: '.md',
    modifiedAt: 0,
    hasFrontmatter: true,
    frontmatterPrefix: '---\nstatus: active\n---\n',
    body: 'Hello {name}',
    raw: '---\nstatus: active\n---\nHello {name}',
    metadata: {
      description: 'Desc',
      tags: ['review'],
      status: 'active',
      favorite: false,
      models: [],
      related: ['other'],
      extra: {},
    },
  };
}

const detailProps = {
  loading: false,
  onSave: vi.fn(async (_document: PromptDocument, body: string) => ({
    ...documentFixture(),
    body,
  })),
  onReload: vi.fn(async () => undefined),
  onCopy: vi.fn(async () => true),
  onReveal: vi.fn(),
  onRename: vi.fn(),
  onMove: vi.fn(),
  onDuplicate: vi.fn(),
  onDuplicateAsVariant: vi.fn(),
  onDeleteRequest: vi.fn(),
  onDirtyChange: vi.fn(),
  onDismissExternalChange: vi.fn(),
  onNotice: vi.fn(),
  onNavigate: vi.fn(),
};

type ResizeObserverCallback = (entries: ResizeObserverEntry[]) => void;

function stubInspectorResizeObserver(initialWidth: number) {
  let callback: ResizeObserverCallback | undefined;
  const observer = {
    observe: vi.fn(() => emit(initialWidth)),
    disconnect: vi.fn(),
    fire(width: number): void {
      emit(width);
    },
  };
  function emit(width: number): void {
    callback?.([{ contentRect: { width } } as ResizeObserverEntry]);
  }
  vi.stubGlobal(
    'ResizeObserver',
    vi.fn(function (nextCallback: ResizeObserverCallback) {
      callback = nextCallback;
      return observer;
    })
  );
  return observer;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PromptDetail edit layout (Issue #65)', () => {
  beforeEach(() => {
    stubInspectorResizeObserver(720);
  });

  it('keeps metadata in the inspector and drops preview footer sections in Edit', async () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));

    const inspector = container.querySelector('#prompt-metadata-inspector');
    expect(inspector).toBeTruthy();
    expect(within(inspector as HTMLElement).getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(container.querySelector('.detail-footer')).toBeNull();
    expect(container.querySelector('.prompt-detail--edit')).toBeTruthy();
    expect(container.querySelector('.editor-canvas .prompt-editor')).toBeTruthy();
    expect(container.querySelectorAll('.variable-inspector').length).toBe(0);
  });

  it('orders inspector sections for scanning', async () => {
    render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));

    const titles = Array.from(
      document.querySelectorAll('.metadata-inspector-section__title'),
      (node) => node.textContent?.trim()
    );
    expect(titles).toEqual([
      'Status & favorite',
      'Tags, models & dates',
      'Variables',
      'Examples & assets',
      'Related & variants',
      'Notes & health',
    ]);
  });

  it('keeps collapsed section regions addressable for aria-controls', async () => {
    render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    const relationRegion = screen.getByRole('region', { name: 'Related prompts', hidden: true });
    const relationBody = document.getElementById('metadata-section-relations-body') as HTMLDivElement;
    expect(relationRegion.hasAttribute('hidden')).toBe(false);
    expect(relationBody.hidden).toBe(false);

    const relToggle = screen.getByRole('button', { name: /Related & variants/ });
    await fireEvent.click(relToggle);
    expect(relToggle.getAttribute('aria-expanded')).toBe('false');
    expect(relToggle.getAttribute('aria-controls')).toBe('metadata-section-relations-body');
    expect(relationBody.hidden).toBe(true);
  });

  it('exposes Save on the canvas toolbar when the narrow Detail sheet is closed', async () => {
    stubInspectorResizeObserver(456);
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));

    const canvasToolbar = container.querySelector('.editor-canvas__toolbar');
    expect(canvasToolbar).toBeTruthy();
    expect(within(canvasToolbar as HTMLElement).getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(container.querySelector('.editor-layout--inspector-open')).toBeFalsy();
  });

  it('keeps Save visible while showing the raw file in Edit', async () => {
    const document: PromptDocument = {
      ...documentFixture(),
      frontmatterError: 'invalid yaml',
      raw: '---\nbad\n---\nBody',
    };
    render(PromptDetail, {
      props: { ...detailProps, document },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    await fireEvent.input(screen.getByLabelText('Prompt Markdown'), { target: { value: 'Changed body' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Show raw file' }));

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(screen.queryByLabelText('Prompt Markdown')).toBeNull();
  });

  it('restores the body selection after a Preview/Edit round trip', async () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));

    const editor = container.querySelector('#prompt-body') as HTMLTextAreaElement;
    editor.setSelectionRange(1, 6);
    await fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));

    await vi.waitFor(() => {
      const restored = container.querySelector('#prompt-body') as HTMLTextAreaElement;
      expect(restored.selectionStart).toBe(1);
      expect(restored.selectionEnd).toBe(6);
    });
  });

  it('marks the unsaved state with more than a colour', async () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    expect(container.querySelectorAll('.dirty-dot').length).toBe(0);

    await fireEvent.input(screen.getByLabelText('Prompt Markdown'), {
      target: { value: 'Changed body' },
    });

    const dots = await vi.waitFor(() => {
      const found = [...container.querySelectorAll('.dirty-dot')];
      if (!found.length) throw new Error('no unsaved marker rendered');
      return found;
    });
    // A 0.42rem colour swatch is nothing to a screen reader, and nothing to a
    // user who cannot tell the warning hue from the surface behind it.
    for (const dot of dots) {
      expect(dot.getAttribute('role')).toBe('img');
      expect(dot.getAttribute('aria-label')).toBe('Unsaved changes');
    }
  });

  it('derives the variant family from the current draft metadata', () => {
    const current = documentFixture();
    const summary = (name: string, extra: Record<string, unknown> = {}) => ({
      ...current,
      name,
      relativePath: `${name}.md`,
      metadata: { ...current.metadata, extra },
    });
    const draftMetadata = { ...current.metadata, extra: { variantOf: 'parent-b' } };
    const { container } = render(VariantFamilyList, {
      props: {
        document: { ...current, metadata: { ...current.metadata, extra: { variantOf: 'parent-a' } } },
        summaries: [
          summary('sample', { variantOf: 'parent-a' }),
          summary('parent-a'),
          summary('parent-b'),
          summary('sibling-b', { variantOf: 'parent-b' }),
        ],
        metadataOverride: draftMetadata,
        onNavigate: vi.fn(),
      },
    });

    expect(container.textContent).toContain('parent b');
    expect(container.textContent).not.toContain('parent a');
  });

  it('switches the Inspector mode from the actual Detail width', async () => {
    const inspectorObserver = stubInspectorResizeObserver(639);
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    expect(container.querySelector('.editor-layout--inspector-open')).toBeFalsy();

    inspectorObserver.fire(640);
    await vi.waitFor(() => expect(container.querySelector('.editor-layout--inspector-open')).toBeTruthy());

    inspectorObserver.fire(639);
    await vi.waitFor(() => expect(container.querySelector('.editor-layout--inspector-open')).toBeFalsy());
  });

  it('preserves a closed narrow inspector sheet after a wide → narrow resize round trip', async () => {
    const inspectorObserver = stubInspectorResizeObserver(456);
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    expect(container.querySelector('.editor-layout--inspector-open')).toBeFalsy();

    inspectorObserver.fire(720);
    await vi.waitFor(() => expect(container.querySelector('.editor-layout--inspector-open')).toBeTruthy());

    inspectorObserver.fire(456);
    await vi.waitFor(() => expect(container.querySelector('.editor-layout--inspector-open')).toBeFalsy());
  });
});
