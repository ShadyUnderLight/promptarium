/**
 * Issue #66 — PromptCompare is an app-owned overlay like the four dialogs in
 * `src/lib/components/library`, but it shipped without the shared focus trap:
 * it covered the whole window while Tab kept walking the page behind it, and it
 * named itself with `aria-label` instead of its own visible heading. These tests
 * pin the trap, the accessible name, Escape, and Tab containment, so the overlay
 * cannot silently regress to a keyboard dead end again.
 *
 * Focus hand-back on close is *not* here: unmounting the component directly
 * only proves the attachment's teardown, not that closing the overlay restores
 * focus. It lives in `prompt-detail-edit-layout.test.ts`, which drives the real
 * Compare button on the real PromptDetail and lets Escape unmount the overlay.
 *
 * jsdom does not implement `offsetParent` (it is always null) while the trap
 * filters invisible focusables with exactly that property. Without the stub
 * below the trap sees zero focusables and falls back to focusing the dialog
 * itself — the assertions would then pass for the wrong reason.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import PromptCompare from '../src/lib/components/library/PromptCompare.svelte';
import type { PromptDocument, PromptMetadata, PromptSummary } from '../src/lib/prompts/types';
import { setPreference } from '../src/lib/i18n/i18n.svelte';

vi.mock('$lib/api', () => ({
  readPrompt: vi.fn(async () => null),
}));

const ORIGINAL_OFFSET_PARENT = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetParent'
);

function metadata(overrides: Partial<PromptMetadata> = {}): PromptMetadata {
  return {
    description: '',
    tags: [],
    status: 'active',
    favorite: false,
    models: [],
    related: [],
    extra: {},
    ...overrides,
  };
}

function summary(name: string): PromptSummary {
  return {
    projectPath: '/proj',
    relativePath: `${name}.md`,
    name,
    folder: '',
    extension: '.md',
    metadata: metadata(),
    modifiedAt: 0,
    hasFrontmatter: true,
  };
}

function documentFixture(): PromptDocument {
  return {
    ...summary('review'),
    body: 'Review {repo}.',
    raw: '---\nstatus: active\n---\nReview {repo}.',
  };
}

const compareProps = {
  document: documentFixture(),
  leftBody: 'Review {repo}.',
  leftMetadata: metadata(),
  leftDirty: false,
  summaries: [summary('review'), summary('other')],
};

beforeEach(() => {
  setPreference('en');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});

afterEach(() => {
  cleanup();
  if (ORIGINAL_OFFSET_PARENT) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', ORIGINAL_OFFSET_PARENT);
  } else {
    delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
  }
  vi.clearAllMocks();
});

/** The trap focuses on the animation frame after mount. */
async function dialog(): Promise<HTMLElement> {
  const element = await waitFor(() => {
    const found = document.querySelector('.compare-modal');
    if (!found) throw new Error('compare dialog not mounted');
    return found as HTMLElement;
  });
  return element;
}

describe('PromptCompare overlay (Issue #66)', () => {
  it('takes its accessible name from the visible heading', async () => {
    render(PromptCompare, { props: { ...compareProps, onClose: vi.fn() } });

    const element = await dialog();
    const labelledBy = element.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('compare-title');
    expect(element.querySelector(`#${labelledBy}`)?.textContent).toBe('Compare with…');
    // The accessible name resolves through the labelled element, not a duplicate
    // `aria-label` that could drift away from what the user actually reads.
    expect(screen.getByRole('dialog', { name: 'Compare with…' })).toBe(element);
  });

  it('moves focus into the overlay on open', async () => {
    render(PromptCompare, { props: { ...compareProps, onClose: vi.fn() } });

    const element = await dialog();
    const picker = screen.getByLabelText('Prompt to compare with');
    await waitFor(() => expect(document.activeElement).toBe(picker));
    expect(element.contains(document.activeElement)).toBe(true);
  });

  it('keeps Tab and Shift+Tab inside the overlay', async () => {
    render(PromptCompare, { props: { ...compareProps, onClose: vi.fn() } });

    const element = await dialog();
    const picker = screen.getByLabelText('Prompt to compare with');
    const close = screen.getByRole('button', { name: 'Close' });

    close.focus();
    await fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(picker);

    await fireEvent.keyDown(picker, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);

    expect(element.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(PromptCompare, { props: { ...compareProps, onClose } });

    const element = await dialog();
    await fireEvent.keyDown(element, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
