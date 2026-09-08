/**
 * Issue #37 — Full UI localization regression tests.
 *
 * Covers the issue's checklist at component level:
 *  - Prompt Detail tabs / actions / notices render in English and zh-CN, and a
 *    runtime locale switch updates the same mounted component;
 *  - a dirty editor stays dirty across a locale switch and the prompt body is
 *    never modified by switching;
 *  - the status machine value renders `Draft` / `草稿` per locale while the
 *    `<option>` values stay the canonical draft/active/archived enums;
 *  - every Health machine code has a display message in both catalogs and the
 *    derivation itself stays locale-independent (code/severity/params);
 *  - history empty reasons localize through the stable reason enum.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import PromptDetail from '../src/lib/components/library/PromptDetail.svelte';
import PromptHistory from '../src/lib/components/library/PromptHistory.svelte';
import PromptMetadataEditor from '../src/lib/components/library/PromptMetadata.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';
import { en } from '../src/lib/i18n/locales/en';
import { zhCN } from '../src/lib/i18n/locales/zh-CN';
import type { MessageKey } from '../src/lib/i18n/locales/en';
import type { PromptDocument } from '../src/lib/prompts/types';
import { derivePromptHealth } from '../src/lib/health/health';

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
  onSave: vi.fn(async (_doc: PromptDocument, body: string) => {
    return { ...documentFixture(), body };
  }),
  onReload: vi.fn(async () => undefined),
  onCopy: () => {},
  onReveal: () => {},
  onRename: () => {},
  onMove: () => {},
  onDuplicate: () => {},
  onDuplicateAsVariant: () => {},
  onDeleteRequest: () => {},
  onDirtyChange: () => {},
  onDismissExternalChange: () => {},
  onNotice: () => {},
  onNavigate: () => {},
};

beforeEach(() => {
  localStorage.clear();
  setPreference('system');
  library.externalChangeState = null;
  library.searchIndexVersion = 0;
  library.allPrompts = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Prompt Detail shell per locale (Issue #37)', () => {
  it('English detail renders tabs, actions and shell copy', () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
    expect(screen.getByText('Copy Prompt')).toBeTruthy();
    expect(screen.getByText('Reveal')).toBeTruthy();
    expect(screen.getByText('Duplicate as Variant')).toBeTruthy();
    const section = container.querySelector('section.prompt-detail');
    expect(section?.getAttribute('aria-label')).toBe('Prompt detail');
  });

  it('zh-CN detail renders 预览/编辑/历史/复制提示词', () => {
    setPreference('zh-CN');
    render(PromptDetail, { props: { ...detailProps, document: documentFixture() } });
    expect(screen.getByText('预览')).toBeTruthy();
    expect(screen.getByText('编辑')).toBeTruthy();
    expect(screen.getByText('历史')).toBeTruthy();
    expect(screen.getByText('复制提示词')).toBeTruthy();
    expect(screen.getByText('创建变体副本')).toBeTruthy();
    expect(screen.queryByText('Preview')).toBeNull();
  });

  it('runtime locale switch updates the same mounted detail without reloading', async () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    expect(screen.getByText('Copy Prompt')).toBeTruthy();

    setPreference('zh-CN');
    await waitFor(() => {
      expect(container.textContent).toContain('复制提示词');
      expect(container.textContent).not.toContain('Copy Prompt');
    });

    setPreference('en');
    await waitFor(() => {
      expect(container.textContent).toContain('Copy Prompt');
    });
  });

  it('dirty state survives a locale switch and the prompt body is untouched', async () => {
    const { container } = render(PromptDetail, {
      props: { ...detailProps, document: documentFixture() },
    });
    // Enter Edit mode and type — dirty dot appears.
    await fireEvent.click(screen.getByText('Edit'));
    const editor = screen.getByLabelText('Prompt Markdown') as HTMLTextAreaElement;
    await fireEvent.input(editor, { target: { value: 'Hello {focus} changed' } });
    expect(container.querySelector('.dirty-dot')).toBeTruthy();
    expect((editor as HTMLTextAreaElement).value).toBe('Hello {focus} changed');

    setPreference('zh-CN');
    await waitFor(() => {
      expect(container.querySelector('.dirty-dot')?.getAttribute('title')).toBe('有未保存的更改');
    });
    // The editor buffer is the same DOM node and its value is unchanged.
    expect((container.querySelector('.prompt-editor') as HTMLTextAreaElement).value).toBe(
      'Hello {focus} changed'
    );
  });
});

describe('status machine value vs display label (Issue #37)', () => {
  it('status: draft renders Draft in English', () => {
    render(PromptMetadataEditor, {
      props: {
        metadata: { ...documentFixture().metadata, status: 'draft' },
        body: '',
        editing: false,
        onChange: () => {},
      },
    });
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.queryByText('draft')).toBeNull();
  });

  it('the same machine value renders 草稿 in zh-CN', async () => {
    setPreference('zh-CN');
    render(PromptMetadataEditor, {
      props: {
        metadata: { ...documentFixture().metadata, status: 'draft' },
        body: '',
        editing: false,
        onChange: () => {},
      },
    });
    expect(screen.getByText('草稿')).toBeTruthy();
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('editing in zh-CN keeps the canonical option values draft/active/archived', () => {
    setPreference('zh-CN');
    const { container } = render(PromptMetadataEditor, {
      props: { metadata: documentFixture().metadata, body: '', editing: true, onChange: () => {} },
    });
    const values = [...container.querySelectorAll('select option')].map((o) =>
      o.getAttribute('value')
    );
    expect(values).toContain('active');
    expect(values).toContain('draft');
    expect(values).toContain('archived');
  });
});

describe('health: machine code → localized display (Issue #37)', () => {
  const CODES = Object.keys(en).filter((key) => key.startsWith('health.'));

  it('every health catalog entry is keyed by a health.<CODE> path in both locales', () => {
    expect(CODES.length).toBeGreaterThan(0);
    for (const key of CODES as MessageKey[]) {
      expect(zhCN[key]).toBeTruthy();
      expect(key.startsWith('health.')).toBe(true);
    }
  });

  it('the same code produces different display per locale', () => {
    setPreference('en');
    expect(en['health.UNDOCUMENTED_VARIABLE' as MessageKey]).toContain('{name}');
    setPreference('zh-CN');
    expect(zhCN['health.UNDOCUMENTED_VARIABLE' as MessageKey]).toContain('{name}');
    expect(zhCN['health.UNDOCUMENTED_VARIABLE' as MessageKey]).not.toBe(
      en['health.UNDOCUMENTED_VARIABLE' as MessageKey]
    );
    setPreference('en');
  });

  it('derivation stays locale-independent: code/severity/params are identical objects', () => {
    const input = {
      projectPath: '/p',
      name: 'review',
      variableNames: ['focus'],
      bodyEmpty: false,
      related: ['gone'],
      projectPromptNames: new Set(['review']),
    };
    const first = derivePromptHealth(input);
    const second = derivePromptHealth(input);
    expect(first).toEqual(second);
    const broken = first.find((issue) => issue.code === 'BROKEN_RELATED_PROMPT');
    expect(broken?.params).toEqual({ path: 'gone' });
    expect(broken?.severity).toBe('warning');
    // No authoritative English message leaks from the core.
    expect(JSON.stringify(first)).not.toContain('message');
  });
});

describe('history empty reasons localize (Issue #37)', () => {
  const base = {
    loading: false,
    loadingMore: false,
    page: null,
    selectedCommit: null,
    diff: null,
    diffLoading: false,
    error: null,
    onSelectCommit: () => {},
    onLoadMore: () => {},
  };

  it('not-a-repository renders in English then Chinese on the same mounted component', async () => {
    const { container } = render(PromptHistory, {
      props: { ...base, repo: { available: false, reason: 'not-a-repository' } },
    });
    expect(container.textContent).toContain('not inside a Git repository');

    setPreference('zh-CN');
    await waitFor(() => {
      expect(container.textContent).toContain('此项目不在 Git 仓库中');
      expect(container.textContent).not.toContain('not inside a Git repository');
    });
    setPreference('en');
  });

  it('untracked prompts get their own message', () => {
    render(PromptHistory, {
      props: {
        ...base,
        repo: { available: true },
        page: { tracked: false, commits: [], nextCursor: undefined },
      },
    });
    expect(screen.getByText('This prompt has no Git history yet.')).toBeTruthy();
  });
});
