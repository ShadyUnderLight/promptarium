import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import NewPromptDialog from '../src/lib/components/library/NewPromptDialog.svelte';
import type { PromptDocument } from '../src/lib/prompts/types';
import {
  clearDeepSeekApiKey,
  deepseekCredentialStatus,
  generatePromptFilenameSuggestions,
  isTauri,
  setDeepSeekApiKey,
} from '$lib/api';
import type { FilenameSuggestionResult } from '$lib/api';
import { setPreference } from '$lib/i18n/i18n.svelte';

vi.mock('$lib/api', () => ({
  clearDeepSeekApiKey: vi.fn(),
  deepseekCredentialStatus: vi.fn(),
  generatePromptFilenameSuggestions: vi.fn(),
  isTauri: vi.fn(() => false),
  setDeepSeekApiKey: vi.fn(),
}));

const statusMock = vi.mocked(deepseekCredentialStatus);
const generateMock = vi.mocked(generatePromptFilenameSuggestions);
const setKeyMock = vi.mocked(setDeepSeekApiKey);
const clearKeyMock = vi.mocked(clearDeepSeekApiKey);

const project = { name: 'engineering', path: '/proj' };
const suggestions = ['PR 代码审查', 'GitHub 变更检查', '代码质量检查'];

function documentFixture(): PromptDocument {
  return {
    projectPath: '/proj',
    relativePath: 'manual-name.md',
    name: 'manual-name',
    folder: '',
    extension: '.md',
    body: 'body',
    raw: 'body',
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
    hasFrontmatter: false,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForCredentialStatus(): Promise<void> {
  await waitFor(() => expect(statusMock).toHaveBeenCalledOnce());
}

function renderDialog(options: {
  defaultFolder?: string;
  onCreate?: (projectPath: string, name: string, body: string, metadata: unknown) => Promise<PromptDocument>;
} = {}) {
  const onCreate =
    options.onCreate ??
    vi.fn(async () => documentFixture());
  const onClose = vi.fn();
  render(NewPromptDialog, {
    props: {
      projects: [project],
      defaultProjectPath: project.path,
      defaultFolder: options.defaultFolder,
      onCreate,
      onClose,
    },
  });
  return { onCreate, onClose };
}

beforeEach(() => {
  setPreference('en');
  vi.mocked(isTauri).mockReturnValue(true);
  statusMock.mockResolvedValue({ configured: true, supported: true });
  generateMock.mockResolvedValue({ names: suggestions });
  setKeyMock.mockResolvedValue({
    status: { configured: true, supported: true },
  });
  clearKeyMock.mockResolvedValue({
    status: { configured: false, supported: true },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setPreference('en');
});

describe('NewPromptDialog AI naming', () => {
  it('empty body disables AI naming and does not request', async () => {
    renderDialog();
    await waitForCredentialStatus();

    const button = screen.getByRole('button', { name: 'AI naming' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Enter the prompt content first.')).toBeTruthy();
    await fireEvent.click(button);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('typing does not request and explicit click requests once, showing three candidates', async () => {
    renderDialog();
    await waitForCredentialStatus();
    const body = screen.getByRole('textbox', { name: 'Prompt Markdown' });

    await fireEvent.input(body, { target: { value: 'Review this pull request.' } });
    expect(generateMock).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    await waitFor(() => expect(generateMock).toHaveBeenCalledOnce());
    expect(generateMock).toHaveBeenCalledWith('Review this pull request.');
    expect(screen.getByText('AI filename suggestions')).toBeTruthy();
    for (const suggestion of suggestions) {
      expect(screen.getByRole('button', { name: suggestion })).toBeTruthy();
    }
  });

  it('opens credential setup without uploading body when no key is configured', async () => {
    statusMock.mockResolvedValue({ configured: false, supported: true });
    renderDialog();
    await waitForCredentialStatus();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Prompt Markdown' }), {
      target: { value: 'Private prompt body.' },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    expect(screen.getByLabelText('DeepSeek API Key')).toBeTruthy();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('selecting a suggestion preserves a folder prefix and replaces only the leaf', async () => {
    renderDialog({ defaultFolder: 'coding' });
    await waitForCredentialStatus();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Prompt Markdown' }), {
      target: { value: 'Review a PR.' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    await waitFor(() => expect(screen.getByRole('button', { name: suggestions[0] })).toBeTruthy());

    const filename = screen.getByRole('textbox', { name: /Filename/ }) as HTMLInputElement;
    expect(filename.value).toBe('coding/');
    await fireEvent.click(screen.getByRole('button', { name: suggestions[0] }));
    expect(filename.value).toBe('coding/PR 代码审查');

    await fireEvent.input(filename, { target: { value: 'coding/old-name' } });
    await fireEvent.click(screen.getByRole('button', { name: suggestions[1] }));
    expect(filename.value).toBe('coding/GitHub 变更检查');
  });

  it('does not overwrite a manually entered filename when suggestions arrive', async () => {
    renderDialog();
    await waitForCredentialStatus();
    const filename = screen.getByRole('textbox', { name: /Filename/ }) as HTMLInputElement;
    const body = screen.getByRole('textbox', { name: 'Prompt Markdown' });

    await fireEvent.input(filename, { target: { value: 'my-manual-name' } });
    await fireEvent.input(body, { target: { value: 'Review a PR.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    await waitFor(() => expect(screen.getByText('AI filename suggestions')).toBeTruthy());
    expect(filename.value).toBe('my-manual-name');
  });

  it('ignores a late response after the prompt body changes', async () => {
    const requestA = deferred<FilenameSuggestionResult>();
    generateMock.mockReturnValueOnce(requestA.promise);
    renderDialog();
    await waitForCredentialStatus();
    const body = screen.getByRole('textbox', { name: 'Prompt Markdown' });

    await fireEvent.input(body, { target: { value: 'Prompt A' } });
    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    await fireEvent.input(body, { target: { value: 'Prompt B' } });

    requestA.resolve({ names: ['过时建议一', '过时建议二', '过时建议三'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText('过时建议一')).toBeNull();
    expect(screen.queryByText('AI filename suggestions')).toBeNull();
  });

  it('keeps Cancel available while naming is busy', async () => {
    const request = deferred<FilenameSuggestionResult>();
    generateMock.mockReturnValueOnce(request.promise);
    const { onClose } = renderDialog();
    await waitForCredentialStatus();
    const body = screen.getByRole('textbox', { name: 'Prompt Markdown' });

    await fireEvent.input(body, { target: { value: 'Review a PR.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();

    request.resolve({ names: suggestions });
  });

  it.each([
    ['network', 'Unable to connect to DeepSeek.'],
    ['timeout', 'DeepSeek took too long to respond.'],
    ['bad-response', 'DeepSeek returned an unreadable result.'],
  ] as const)('localizes the %s failure without blocking manual naming', async (failure, message) => {
    generateMock.mockResolvedValue({ names: [], failure });
    renderDialog();
    await waitForCredentialStatus();

    await fireEvent.input(screen.getByRole('textbox', { name: 'Prompt Markdown' }), {
      target: { value: 'Review a PR.' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Create prompt' })).toBeTruthy();
  });

  it('localizes failures while manual creation still works', async () => {
    generateMock.mockResolvedValue({ names: [], failure: 'auth-failed' });
    const { onCreate } = renderDialog();
    await waitForCredentialStatus();
    const body = screen.getByRole('textbox', { name: 'Prompt Markdown' });
    const filename = screen.getByRole('textbox', { name: /Filename/ });

    await fireEvent.input(body, { target: { value: 'Review a PR.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    await waitFor(() => expect(screen.getByText('The DeepSeek API key is invalid.')).toBeTruthy());

    await fireEvent.input(filename, { target: { value: 'manual-review' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith('/proj', 'manual-review', 'Review a PR.', expect.anything());
  });

  it('switches locale without changing body, filename, candidates or API key input', async () => {
    renderDialog();
    await waitForCredentialStatus();
    const filename = screen.getByRole('textbox', { name: /Filename/ }) as HTMLInputElement;
    const body = screen.getByRole('textbox', { name: 'Prompt Markdown' }) as HTMLTextAreaElement;

    await fireEvent.input(filename, { target: { value: 'coding/review-pr' } });
    await fireEvent.input(body, { target: { value: 'Review a PR.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const keyInput = screen.getByLabelText('DeepSeek API Key') as HTMLInputElement;
    await fireEvent.input(keyInput, { target: { value: 'sk-user-secret' } });
    await fireEvent.click(screen.getByRole('button', { name: 'AI naming' }));
    await waitFor(() => expect(screen.getByText('AI filename suggestions')).toBeTruthy());

    setPreference('zh-CN');
    await waitFor(() => expect(screen.getByText('AI 文件名建议')).toBeTruthy());
    expect(body.value).toBe('Review a PR.');
    expect(filename.value).toBe('coding/review-pr');
    expect(keyInput.value).toBe('sk-user-secret');
    expect(screen.getByText(suggestions[0])).toBeTruthy();
  });

  it('saves a password input without returning it to the UI or creating a frontend copy', async () => {
    statusMock.mockResolvedValue({ configured: false, supported: true });
    const { onClose } = renderDialog();
    await waitForCredentialStatus();
    await fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek API Key' }));
    const keyInput = screen.getByLabelText('DeepSeek API Key') as HTMLInputElement;
    expect(keyInput.type).toBe('password');

    await fireEvent.input(keyInput, { target: { value: 'sk-user-secret' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save API Key' }));
    await waitFor(() => expect(setKeyMock).toHaveBeenCalledWith('sk-user-secret'));
    expect(screen.queryByLabelText('DeepSeek API Key')).toBeNull();
    expect(screen.getByText('DeepSeek configured')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear API Key' }));
    await waitFor(() => expect(clearKeyMock).toHaveBeenCalledOnce());
    expect(screen.queryByText('DeepSeek configured')).toBeNull();
    expect(screen.getByRole('button', { name: 'Configure DeepSeek API Key' })).toBeTruthy();
  });
});
