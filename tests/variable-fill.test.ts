import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/svelte';
import VariableFillDialog from '../src/lib/components/library/VariableFillDialog.svelte';
import PromptDetail from '../src/lib/components/library/PromptDetail.svelte';
import type { PromptDocument } from '../src/lib/prompts/types';
import { setPreference } from '../src/lib/i18n/i18n.svelte';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
  resolvePromptAssets: vi.fn(async () => []),
  pickAssetReference: vi.fn(async () => ({ failure: 'cancelled' as const })),
  revealAssetInFinder: vi.fn(async () => undefined),
}));

function documentFixture(overrides: Partial<PromptDocument> = {}): PromptDocument {
  return {
    projectPath: '/proj',
    relativePath: 'review.md',
    name: 'review',
    folder: '',
    extension: '.md',
    body: 'Review {repo} for {goal}.',
    raw: '---\nstatus: active\n---\nReview {repo} for {goal}.',
    metadata: {
      description: '',
      tags: [],
      status: 'active',
      favorite: false,
      models: [],
      variables: {
        repo: { description: 'Repository name', example: 'org/repo' },
        goal: { description: 'Review focus', example: 'security' },
      },
      related: [],
      extra: {},
    },
    modifiedAt: 0,
    hasFrontmatter: true,
    ...overrides,
  } as PromptDocument;
}

beforeEach(() => {
  setPreference('en');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VariableFillDialog', () => {
  it('按正文顺序显示唯一变量，并直接替换填写值', async () => {
    const onCopy = vi.fn(async (text: string) => {
      expect(text).toBe('Review org/repo for . Review org/repo again.');
      return true;
    });
    const onClose = vi.fn();

    render(VariableFillDialog, {
      props: {
        body: 'Review {repo} for {goal}. Review {repo} again.',
        annotations: {
          repo: { description: 'Repository name', example: 'org/repo' },
          goal: { description: 'Review focus', example: 'security' },
        },
        onCopy,
        onClose,
      },
    });

    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByText('Repository name')).toBeTruthy();
    expect(screen.getByText('Example: org/repo')).toBeTruthy();
    expect(screen.getByLabelText('Value for repo')).toBeTruthy();
    expect(screen.getByLabelText('Value for goal')).toBeTruthy();

    await fireEvent.input(screen.getByLabelText('Value for repo'), {
      target: { value: 'org/repo' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy final Prompt' }));

    await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('变量填写 Dialog 支持运行时切换英文和简体中文', async () => {
    render(VariableFillDialog, {
      props: {
        body: 'Review {repo}.',
        onCopy: async () => true,
        onClose: vi.fn(),
      },
    });

    expect(screen.getByText('Fill template variables')).toBeTruthy();
    setPreference('zh-CN');
    await waitFor(() => {
      expect(screen.getByText('填写模板变量')).toBeTruthy();
      expect(screen.getByRole('button', { name: '复制最终 Prompt' })).toBeTruthy();
    });
  });

  it('Dialog 可以安全填写名为 __proto__ 的变量', async () => {
    const onCopy = vi.fn(async (text: string) => {
      expect(text).toBe('value');
      return true;
    });
    const onClose = vi.fn();

    render(VariableFillDialog, {
      props: {
        body: '{__proto__}',
        onCopy,
        onClose,
      },
    });

    await fireEvent.input(screen.getByLabelText('Value for __proto__'), {
      target: { value: 'value' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy final Prompt' }));

    await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('剪贴板失败时保留已填写内容和 Dialog', async () => {
    const onCopy = vi.fn(async () => false);
    const onClose = vi.fn();

    render(VariableFillDialog, {
      props: {
        body: 'Review {repo}.',
        onCopy,
        onClose,
      },
    });

    await fireEvent.input(screen.getByLabelText('Value for repo'), {
      target: { value: 'org/repo' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy final Prompt' }));

    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('Review org/repo.'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Value for repo') as HTMLTextAreaElement).value).toBe('org/repo');
  });
});

describe('PromptDetail variable copy flow', () => {
  it('有变量时从当前编辑正文打开填写 Dialog 并复制', async () => {
    const onCopy = vi.fn(async () => true);
    const props = {
      document: documentFixture(),
      loading: false,
      onSave: vi.fn(async (_document: PromptDocument, body: string) => ({
        ...documentFixture(),
        body,
      })),
      onReload: vi.fn(async () => undefined),
      onCopy,
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

    render(PromptDetail, { props });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await fireEvent.input(screen.getByLabelText('Value for repo'), {
      target: { value: 'org/repo' },
    });
    await fireEvent.input(screen.getByLabelText('Value for goal'), {
      target: { value: 'security' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy final Prompt' }));

    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('Review org/repo for security.'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('无变量时直接复制正文，不打开填写 Dialog', async () => {
    const onCopy = vi.fn(async () => true);
    const props = {
      document: documentFixture({
        body: 'No variables here.',
        raw: '---\nstatus: active\n---\nNo variables here.',
      }),
      loading: false,
      onSave: vi.fn(async (_document: PromptDocument, body: string) => ({
        ...documentFixture(),
        body,
      })),
      onReload: vi.fn(async () => undefined),
      onCopy,
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

    render(PromptDetail, { props });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));

    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('No variables here.'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
