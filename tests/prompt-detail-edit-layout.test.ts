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

type MediaQueryListener = (event: MediaQueryListEvent) => void;

function mediaQueryStub(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<MediaQueryListener>();
  return {
    get matches() {
      return matches;
    },
    media: '(min-width: 1281px)',
    addEventListener: vi.fn((_event: string, listener: MediaQueryListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: MediaQueryListener) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn((listener: MediaQueryListener) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: MediaQueryListener) => {
      listeners.delete(listener);
    }),
    fire(next: boolean): void {
      matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

function stubInspectorMediaQuery(initialWide: boolean): ReturnType<typeof mediaQueryStub> {
  const inspectorMq = mediaQueryStub(initialWide);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => (query.includes('1281px') ? inspectorMq : mediaQueryStub(false)))
  );
  return inspectorMq;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PromptDetail edit layout (Issue #65)', () => {
  beforeEach(() => {
    stubInspectorMediaQuery(true);
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

  it('collapses the Relations section together with read-only relation blocks', async () => {
    render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    expect(screen.getByLabelText('Related prompts')).toBeTruthy();

    const relToggle = screen.getByRole('button', { name: /Related & variants/ });
    await fireEvent.click(relToggle);
    expect(relToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Related prompts')).toBeNull();
  });

  it('exposes Save on the canvas toolbar when the inspector sheet is closed at 900px', async () => {
    stubInspectorMediaQuery(false);
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

  it('preserves a closed narrow inspector sheet after a wide → narrow resize round trip', async () => {
    const inspectorMq = stubInspectorMediaQuery(false);
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    expect(container.querySelector('.editor-layout--inspector-open')).toBeFalsy();

    inspectorMq.fire(true);
    await vi.waitFor(() => expect(container.querySelector('.editor-layout--inspector-open')).toBeTruthy());

    inspectorMq.fire(false);
    await vi.waitFor(() => expect(container.querySelector('.editor-layout--inspector-open')).toBeFalsy());
  });
});
