import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/svelte';
import PromptsView from '../src/lib/components/PromptsView.svelte';
import * as api from '../src/lib/api';
import { setPreference } from '../src/lib/i18n/i18n.svelte';
import { library } from '../src/lib/library.svelte';

beforeEach(() => {
  localStorage.clear();
  setPreference('en');
  library.searchQuery = '';
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function shortcut(key: string, modifier: 'meta' | 'ctrl'): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: modifier === 'meta',
    ctrlKey: modifier === 'ctrl',
  });
  window.dispatchEvent(event);
  return event;
}

describe('Variable Fill Dialog modal shortcut isolation', () => {
  it('blocks find/new/save shortcuts while filling variables', async () => {
    const savePrompt = vi.spyOn(api, 'savePrompt');
    const { container } = render(PromptsView);

    await waitFor(() => expect(screen.getByText('pr checklist')).toBeTruthy());
    await fireEvent.click(screen.getByText('pr checklist'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy Prompt' })).toBeTruthy());

    await fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    const editor = screen.getByLabelText('Prompt Markdown');
    await fireEvent.input(editor, {
      target: { value: 'Review the PR for {ticket}. Focus on {concern} in {scope}.' },
    });
    await waitFor(() => expect(container.querySelector('.dirty-dot')).toBeTruthy());

    await fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    const ticketInput = screen.getByLabelText('Value for ticket');
    ticketInput.focus();

    const findEvent = shortcut('f', 'meta');
    expect(findEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ticketInput);
    expect(dialog.contains(document.activeElement)).toBe(true);

    const newEvent = shortcut('n', 'ctrl');
    expect(newEvent.defaultPrevented).toBe(true);
    expect(screen.queryByRole('heading', { name: 'New prompt' })).toBeNull();

    const saveEvent = shortcut('s', 'ctrl');
    expect(saveEvent.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(savePrompt).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Prompt Markdown')).toBe(editor);
    expect(container.querySelector('.dirty-dot')).toBeTruthy();
  });
});
