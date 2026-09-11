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
 *
 * The fixture carries the full §10 surface: tags, models, variables, related,
 * notes, unknown YAML (`extra`), examples with asset refs and unknown nested
 * example keys, and the `examplesRaw` preservation AST.
 *
 * Queries go through the accessibility seam (role + accessible name) rather
 * than styling classes: #42/#43 will rewrite these components, and this test
 * must keep protecting the locale/data contract across a pure markup change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import PromptDetail from '../src/lib/components/library/PromptDetail.svelte';
import { library } from '../src/lib/library.svelte';
import { setPreference, t } from '../src/lib/i18n/i18n.svelte';
import type {
  PromptDocument,
  PromptMetadata,
  PromptExample,
  RawYaml,
} from '../src/lib/prompts/types';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
  resolvePromptAssets: vi.fn(async () => []),
  pickAssetReference: vi.fn(async () => ({ failure: 'cancelled' as const })),
  revealAssetInFinder: vi.fn(async () => undefined),
}));

/** Multilingual, emoji-bearing, user-owned metadata — none of it is App copy. */
const EXAMPLES: PromptExample[] = [
  {
    name: '示例 A',
    input: '请检查 this code.',
    outputFile: 'assets/结果.txt',
    assets: ['assets/图.png', 'assets/report.pdf'],
    extra: { 'custom-键': '自定义值', nested: { preserved: true } },
  },
];

/** The `examples` AST read from disk; an unrelated save must pass it through. */
const EXAMPLES_RAW: RawYaml = {
  kind: 'sequence',
  items: [{ kind: 'string', value: 'hand-written node' }],
};

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
    examples: EXAMPLES.map((example) => ({ ...example })),
    examplesRaw: EXAMPLES_RAW,
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
/** `onDirtyChange` is the component's own dirty contract — no DOM needed. */
let dirtyCalls: boolean[] = [];

const detailProps = {
  loading: false,
  document: documentFixture(),
  onSave: vi.fn(async (_doc: PromptDocument, body: string, metadata: PromptMetadata, _prefix: unknown, metadataDirty: boolean) => {
    saveCalls.push({ body, metadata, metadataDirty });
    // `save()` reads back `body` / `metadata` / `raw` / `frontmatterPrefix`.
    return { ...documentFixture(), body, metadata };
  }),
  onReload: vi.fn(async () => undefined),
  onCopy: async () => true,
  onReveal: () => {},
  onRename: () => {},
  onMove: () => {},
  onDuplicate: () => {},
  onDuplicateAsVariant: () => {},
  onDeleteRequest: () => {},
  onDirtyChange: (dirty: boolean) => {
    dirtyCalls.push(dirty);
  },
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

/** Accessible-name query for the two metadata textareas. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function descriptionBox(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: t('meta.description') }) as HTMLTextAreaElement;
}

function notesBox(): HTMLTextAreaElement {
  // The notes label also carries a hint span, so match the leading text.
  return screen.getByRole('textbox', {
    name: new RegExp(`^${escapeForRegExp(t('meta.usageNotes'))}`),
  }) as HTMLTextAreaElement;
}

function bodyBox(): HTMLTextAreaElement {
  return screen.getByLabelText(t('detail.editor.label')) as HTMLTextAreaElement;
}

beforeEach(() => {
  localStorage.clear();
  // jsdom exposes no real system language, so `system` resolves to English.
  setPreference('system');
  resetLibrary();
  saveCalls = [];
  dirtyCalls = [];
  detailProps.onSave.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('user-owned data survives a locale switch (Issue #38 §10)', () => {
  it('keeps the metadata draft intact and saves canonical machine values under zh-CN', async () => {
    render(PromptDetail, { props: detailProps });

    await fireEvent.click(screen.getByRole('tab', { name: t('detail.tab.edit') }));
    expect(descriptionBox().value).toBe('Review 中文 PR 🚀');
    expect(notesBox().value).toBe(richMetadata().notes);
    expect(bodyBox().value).toBe(BODY);

    // One real metadata edit — this is the only field allowed to change.
    const editedDescription = 'Review 中文 PR 🚀 (edited)';
    await fireEvent.input(descriptionBox(), { target: { value: editedDescription } });
    await waitFor(() => expect(dirtyCalls.at(-1)).toBe(true));

    // en → zh-CN on an already-mounted, already-dirty detail.
    setPreference('zh-CN');
    await waitFor(() => expect(t('detail.dirty.title')).toBe('有未保存的更改'));
    expect(descriptionBox().value).toBe(editedDescription);
    expect(notesBox().value).toBe(richMetadata().notes);
    // The body editor buffer is untouched by the locale switch.
    expect(bodyBox().value).toBe(BODY);
    // A locale switch is not an edit: the dirty flag never flips back.
    expect(dirtyCalls.at(-1)).toBe(true);

    // Save while the UI is in zh-CN.
    await fireEvent.click(screen.getByRole('button', { name: t('detail.save') }));
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

    // §10 examples / asset refs / raw examples preservation / unknown YAML.
    expect(saved.metadata.examples).toEqual(EXAMPLES);
    expect(saved.metadata.examples?.[0].assets).toEqual(['assets/图.png', 'assets/report.pdf']);
    expect(saved.metadata.examples?.[0].extra).toEqual({
      'custom-键': '自定义值',
      nested: { preserved: true },
    });
    expect(saved.metadata.examplesRaw).toEqual(EXAMPLES_RAW);
    expect(saved.metadata.extra).toEqual({
      variantOf: 'base-prompt',
      'custom-field': '自定义值',
    });
  });

  it('a locale switch alone never produces a save', async () => {
    render(PromptDetail, { props: detailProps });
    await fireEvent.click(screen.getByRole('tab', { name: t('detail.tab.edit') }));

    setPreference('zh-CN');
    await waitFor(() => expect(t('detail.tab.edit')).toBe('编辑'));
    setPreference('en');
    await waitFor(() => expect(t('detail.tab.edit')).toBe('Edit'));

    expect(saveCalls).toEqual([]);
    expect(dirtyCalls.some(Boolean)).toBe(false);
  });

  it('editing an unrelated field on a prompt that carries examples does not crash', async () => {
    // Regression: `PromptMetadata.clone()` used `structuredClone(example)`, which
    // throws DataCloneError on the `$state` proxy PromptDetail holds, so any
    // metadata edit on a prompt with examples took the whole editor down.
    render(PromptDetail, { props: detailProps });
    await fireEvent.click(screen.getByRole('tab', { name: t('detail.tab.edit') }));

    await fireEvent.input(descriptionBox(), { target: { value: 'edited with examples present' } });
    await waitFor(() => expect(dirtyCalls.at(-1)).toBe(true));

    await fireEvent.click(screen.getByRole('button', { name: t('detail.save') }));
    await waitFor(() => expect(saveCalls.length).toBe(1));
    expect(saveCalls[0].metadata.examples).toEqual(EXAMPLES);
  });
});
