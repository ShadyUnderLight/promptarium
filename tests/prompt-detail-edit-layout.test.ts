import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import PromptDetail from '../src/lib/components/library/PromptDetail.svelte';
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
      related: [],
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PromptDetail edit layout (Issue #65)', () => {
  it('keeps metadata in the inspector and drops preview footer sections in Edit', async () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));

    const inspector = container.querySelector('#prompt-metadata-inspector');
    expect(inspector).toBeTruthy();
    expect(within(inspector as HTMLElement).getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(container.querySelector('.detail-footer')).toBeNull();
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
});
