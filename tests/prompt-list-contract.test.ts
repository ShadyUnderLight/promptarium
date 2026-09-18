/**
 * Issue #64 — Prompt list row contract: excerpt fallback, health severity, DOM hierarchy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import PromptListItem from '../src/lib/components/library/PromptListItem.svelte';
import PromptDetail from '../src/lib/components/library/PromptDetail.svelte';
import type { PromptDocument, PromptSummary } from '../src/lib/prompts/types';
import { setPreference } from '../src/lib/i18n/i18n.svelte';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
  resolvePromptAssets: vi.fn(async () => []),
  pickAssetReference: vi.fn(async () => ({ failure: 'cancelled' as const })),
  revealAssetInFinder: vi.fn(async () => undefined),
}));

const { promptHealth, promptBodyExcerpt } = vi.hoisted(() => ({
  promptHealth: vi.fn(() => [] as Array<{ code: string; severity: 'warning' | 'error'; params?: Record<string, string> }>),
  promptBodyExcerpt: vi.fn(() => null as string | null),
}));

vi.mock('$lib/library.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/library.svelte')>();
  return {
    ...actual,
    promptHealth,
    promptBodyExcerpt,
  };
});

function summary(overrides: Partial<PromptSummary> = {}): PromptSummary {
  return {
    projectPath: '/proj',
    relativePath: 'a.md',
    name: 'a',
    folder: 'notes',
    extension: '.md',
    metadata: {
      description: '',
      tags: ['coding'],
      status: 'draft',
      favorite: false,
      models: [],
      related: [],
      extra: {},
    },
    modifiedAt: 1_700_000_000_000,
    hasFrontmatter: false,
    ...overrides,
  };
}

const listItemProps = {
  selected: false,
  checked: false,
  variableCount: 2,
  onSelect: () => {},
  onToggle: () => {},
};

const detailProps = {
  loading: false,
  onSave: vi.fn(async (document: PromptDocument) => document),
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

beforeEach(() => {
  setPreference('en');
  promptHealth.mockReturnValue([]);
  promptBodyExcerpt.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PromptListItem contract (Issue #64)', () => {
  it('prefers metadata description over body excerpt', () => {
    promptBodyExcerpt.mockReturnValue('Body excerpt text');
    const { container } = render(PromptListItem, {
      props: {
        ...listItemProps,
        prompt: summary({ metadata: { ...summary().metadata, description: 'From metadata' } }),
      },
    });
    const description = container.querySelector('.prompt-list-item__description');
    expect(description?.textContent).toBe('From metadata');
    expect(description?.classList.contains('prompt-list-item__description--excerpt')).toBe(false);
  });

  it('falls back to body excerpt when description is empty', () => {
    promptBodyExcerpt.mockReturnValue('First line from the prompt body');
    const { container } = render(PromptListItem, {
      props: { ...listItemProps, prompt: summary() },
    });
    const description = container.querySelector('.prompt-list-item__description');
    expect(description?.textContent).toBe('First line from the prompt body');
    expect(description?.classList.contains('prompt-list-item__description--excerpt')).toBe(true);
  });

  it('applies error severity styling on the health badge', () => {
    promptHealth.mockReturnValue([
      { code: 'INVALID_RELATED_PROMPT', severity: 'error', params: { path: 'missing' } },
    ]);
    const { container } = render(PromptListItem, {
      props: { ...listItemProps, prompt: summary() },
    });
    const badge = container.querySelector('.health-badge');
    expect(badge?.classList.contains('health-badge--error')).toBe(true);
    expect(badge?.classList.contains('health-badge--warning')).toBe(false);
  });

  it('applies warning severity styling when no error issues exist', () => {
    promptHealth.mockReturnValue([{ code: 'EMPTY_BODY', severity: 'warning' }]);
    const { container } = render(PromptListItem, {
      props: { ...listItemProps, prompt: summary() },
    });
    const badge = container.querySelector('.health-badge');
    expect(badge?.classList.contains('health-badge--warning')).toBe(true);
    expect(badge?.classList.contains('health-badge--error')).toBe(false);
  });

  it('keeps name before description before meta in the DOM', () => {
    const { container } = render(PromptListItem, {
      props: {
        ...listItemProps,
        prompt: summary({ metadata: { ...summary().metadata, description: 'Desc' } }),
      },
    });
    const body = container.querySelector('.prompt-list-item__body');
    const children = [...body!.children].map((node) => node.className);
    expect(children[0]).toContain('prompt-list-item__title-row');
    expect(children[1]).toContain('prompt-list-item__description');
    expect(children[2]).toContain('prompt-list-item__meta');
  });
});

describe('PromptDetail header contract (Issue #64)', () => {
  it('shows status and tags in the header chips row', () => {
    const document: PromptDocument = {
      ...summary({
        metadata: {
          description: 'Desc',
          tags: ['review', 'coding'],
          status: 'draft',
          favorite: true,
          models: [],
          related: [],
          extra: {},
        },
      }),
      body: 'Body',
      raw: 'Body',
    };
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document },
    });
    const chips = container.querySelector('.detail-header__chips');
    expect(chips).toBeTruthy();
    expect(chips?.textContent).toContain('Draft');
    expect(chips?.textContent).toContain('#review');
    expect(chips?.textContent).toContain('#coding');
    expect(container.querySelector('.detail-header .status-chip--draft')).toBeTruthy();
  });
});
