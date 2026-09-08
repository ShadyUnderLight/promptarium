/**
 * Issue #38 §10 — user-owned data isolation under locale switching.
 *
 * The layout half of #38 is deliberately deferred until #41 → #44 settle the
 * visual layer, but *semantic* isolation is not a visual property and must not
 * wait: a locale switch may never alter the draft the user is editing, and a
 * save performed while the UI is in zh-CN must serialize exactly the same
 * machine values an English save would.
 *
 * This is intentionally a component-level regression, not a filesystem E2E:
 * one PromptDetail mounted with a multilingual / emoji / mixed-script fixture,
 * one real metadata edit, one locale switch, one save — then every user field
 * and machine enum is asserted field by field so a failure names the offender
 * instead of printing one giant object diff.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import PromptDetail from '../src/lib/components/library/PromptDetail.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';
import type { PromptDocument, PromptMetadata } from '../src/lib/prompts/types';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
  resolvePromptAssets: vi.fn(async () => []),
  pickAssetReference: vi.fn(async () => ({ failure: 'cancelled' as const })),
  revealAssetInFinder: vi.fn(async () => undefined),
}));

/** Multilingual, emoji-bearing, user-owned metadata — none of it is App copy. */
function richMetadata(): PromptMetadata {
  return {
    description: 'Review 中文 PR 🚀',
    tags: ['中文标签', 'release'],
    status: 'active',
    favorite: true,
    models: ['GPT-5'],
    created: '2026-09-04',
    variables: { repository: { description: '仓库地址', example: 'git@github.com:me/repo.git' } },
    related: ['coding/代码审查'],
    notes: '用户自己写的说明。\nSecond line with 🚀 emoji.',
    // `examples` is deliberately absent: PromptMetadata.clone() deep-clones each
    // example with `structuredClone()`, which throws DataCloneError on the
    // Svelte `$state` proxy PromptDetail holds — a pre-existing, non-localization
    // bug that is tracked separately. Examples have their own suite
    // (examples_hardening.test.ts); this file is about locale isolation.
    extra: { variantOf: 'base-prompt', 'custom-field': '自定义值' },
  };
}

const BODY = 'Review the PR for {repository}. 请检查 this code. 🚀';

function documentFixture(): PromptDocument {
  return {
    projectPath: '/proj',
    relativePath: 'coding/review.md',
    name: 'coding/review',
    folder: 'coding',
    extension: '.md',
    body: BODY,
    raw: `---\ndescription: Review 中文 PR 🚀\n---\n${BODY}`,
    metadata: richMetadata(),
    modifiedAt: 0,
    hasFrontmatter: true,
  } as PromptDocument;
}

/** What `save()` handed to `onSave` — the payload that reaches the backend. */
interface SaveCall {
  body: string;
  metadata: PromptMetadata;
  metadataDirty: boolean;
}

let saveCalls: SaveCall[] = [];

const detailProps = {
  loading: false,
  document: documentFixture(),
  onSave: vi.fn(async (_doc: PromptDocument, body: string, metadata: PromptMetadata, _prefix: unknown, metadataDirty: boolean) => {
    saveCalls.push({ body, metadata, metadataDirty });
    // `save()` reads back `body` / `metadata` / `raw` / `frontmatterPrefix`.
    return { ...documentFixture(), body, metadata };
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

function resetLibrary(): void {
  library.projects = [{ path: '/proj', name: 'My Proj' }];
  library.activeProjectPath = '/proj';
  library.allPrompts = [];
  library.prompts = [];
  library.errorCode = null;
  library.error = null;
  library.loading = false;
  library.externalChangeState = null;
}

beforeEach(() => {
  localStorage.clear();
  // jsdom exposes no real system language, so `system` resolves to English.
  setPreference('system');
  resetLibrary();
  saveCalls = [];
  detailProps.onSave.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('user-owned data survives a locale switch (Issue #38 §10)', () => {
  it('keeps the metadata draft intact and saves canonical machine values under zh-CN', async () => {
    const { container } = render(PromptDetail, { props: detailProps });

    await fireEvent.click(screen.getByText('Edit'));
    const description = container.querySelector(
      '.metadata-editor textarea:not(.notes-editor)'
    ) as HTMLTextAreaElement;
    const notes = container.querySelector('.notes-editor') as HTMLTextAreaElement;
    expect(description.value).toBe('Review 中文 PR 🚀');
    expect(notes.value).toBe(richMetadata().notes);

    // One real metadata edit — this is the only field allowed to change.
    const editedDescription = 'Review 中文 PR 🚀 (edited)';
    await fireEvent.input(description, { target: { value: editedDescription } });
    expect(container.querySelector('.dirty-dot')).toBeTruthy();

    // en → zh-CN on an already-mounted, already-dirty detail.
    setPreference('zh-CN');
    await waitFor(() => {
      expect(container.querySelector('.dirty-dot')?.getAttribute('title')).toBe('有未保存的更改');
    });
    const afterSwitch = container.querySelector(
      '.metadata-editor textarea:not(.notes-editor)'
    ) as HTMLTextAreaElement;
    expect(afterSwitch.value).toBe(editedDescription);
    expect((container.querySelector('.notes-editor') as HTMLTextAreaElement).value).toBe(
      richMetadata().notes
    );
    // The body editor buffer is untouched by the locale switch.
    expect((container.querySelector('.prompt-editor') as HTMLTextAreaElement).value).toBe(BODY);

    // Save while the UI is in zh-CN.
    await fireEvent.click(container.querySelector('.detail-actions .btn--primary') as HTMLElement);
    await waitFor(() => expect(saveCalls.length).toBe(1));

    const saved = saveCalls[0];
    expect(saved.body).toBe(BODY);
    expect(saved.metadataDirty).toBe(true);
    expect(saved.metadata.description).toBe(editedDescription);

    // Everything the user owns, byte for byte — machine enums included.
    expect(saved.metadata.tags).toEqual(['中文标签', 'release']);
    expect(saved.metadata.models).toEqual(['GPT-5']);
    expect(saved.metadata.status).toBe('active'); // machine enum, never 草稿
    expect(saved.metadata.favorite).toBe(true);
    expect(saved.metadata.created).toBe('2026-09-04');
    expect(saved.metadata.variables).toEqual({
      repository: { description: '仓库地址', example: 'git@github.com:me/repo.git' },
    });
    expect(saved.metadata.related).toEqual(['coding/代码审查']);
    expect(saved.metadata.notes).toBe(richMetadata().notes);
    expect(saved.metadata.extra).toEqual({
      variantOf: 'base-prompt',
      'custom-field': '自定义值',
    });
  });

  it('a locale switch alone never produces a save', async () => {
    const { container } = render(PromptDetail, { props: detailProps });
    await fireEvent.click(screen.getByText('Edit'));

    setPreference('zh-CN');
    await waitFor(() => expect(screen.getByText('编辑')).toBeTruthy());
    setPreference('en');
    await waitFor(() => expect(screen.getByText('Edit')).toBeTruthy());

    expect(saveCalls).toEqual([]);
    expect(container.querySelector('.dirty-dot')).toBeNull();
  });
});
