/**
 * Issue #66 — ConfirmDialog never handled Enter itself, and nothing recorded
 * which button a bare Enter actually activates. The answer follows from the
 * markup: the trap moves focus to the first focusable child, and that child is
 * Cancel. So Enter means "keep editing / cancel / keep the project" and can
 * never reach Delete, Forget or Discard. That is the intended contract — these
 * tests pin it so a reorder of the buttons (or a "fix" that makes Enter confirm)
 * fails loudly instead of silently arming a destructive default.
 *
 * jsdom does not implement `offsetParent` (always null) while the trap filters
 * invisibles with exactly that property, so it is stubbed here; without it the
 * trap would find no focusable and focus the dialog container instead.
 *
 * jsdom also implements no keyboard activation for buttons at all: keydown and
 * keyup Enter on a focused `<button>`, and on a `<button type="submit">` inside
 * a form, each dispatch zero clicks. `@testing-library/user-event` — which would
 * model it — is not a dependency of this project, and adding one just for this
 * test is not worth it. So the platform's activation is applied explicitly, to
 * whatever currently holds focus, honouring `preventDefault()`. What the test
 * pins is the whole path (focused element → its handler), not jsdom's plumbing.
 *
 * Focus hand-back on close is deliberately absent: unmounting the dialog here
 * would only prove the attachment's teardown, not that a real parent clears its
 * pending confirm and restores focus. That lives in `unsaved-navigation.test.ts`,
 * which cancels a real guard raised from a real list row inside `PromptsView`.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ConfirmDialog from '../src/lib/components/library/ConfirmDialog.svelte';
import { setPreference } from '../src/lib/i18n/i18n.svelte';

const ORIGINAL_OFFSET_PARENT = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetParent'
);

function confirmProps(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Delete prompt?',
    message: 'Delete “review” permanently?',
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

/**
 * Press Enter on whatever holds focus, the way a browser does it.
 *
 * jsdom dispatches no click for a key press (see the file header), so the
 * activation is applied by hand to the *same* element the key went to. That
 * keeps the assertion honest: if the trap ever lands somewhere else, this
 * presses Enter on that element instead, and the destructive spy catches it.
 *
 * A handler that calls `preventDefault()` takes the key over, and a browser then
 * skips the button's default activation — so the synthetic click only happens
 * when nothing claimed the event. Without that, adding `preventDefault()` to a
 * future Enter handler would silently disable Enter and this test would still
 * pass.
 */
function pressEnter(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) throw new Error('nothing is focused');
  const keydown = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  active.dispatchEvent(keydown);
  if (!keydown.defaultPrevented) fireEvent.click(active);
  active.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true })
  );
}

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

describe('ConfirmDialog Enter contract (Issue #66)', () => {
  it('sends a bare Enter to Cancel, never to the destructive action', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(ConfirmDialog, { props: confirmProps({ onCancel, onConfirm }) });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    );

    pressEnter();

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps Cancel ahead of the destructive button in focus order', async () => {
    render(ConfirmDialog, { props: confirmProps() });

    const dialog = screen.getByRole('dialog', { name: 'Delete prompt?' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });

    await waitFor(() => expect(document.activeElement).toBe(cancel));

    // The contract above holds only because the trap lands on the first
    // focusable and that is Cancel. If Cancel stops being first, Enter starts
    // arming Delete, and the test above is what goes red — this one localises
    // the cause to the markup order.
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled])')
    );
    expect(focusables[0]).toBe(cancel);
    expect(focusables.indexOf(confirm)).toBeGreaterThan(0);
  });

  it('cancels on Escape', async () => {
    const onCancel = vi.fn();
    render(ConfirmDialog, { props: confirmProps({ onCancel }) });

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables both buttons while the confirmed action is in flight', async () => {
    let release: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    render(ConfirmDialog, { props: confirmProps({ onConfirm }) });

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const busy = screen.getByRole('button', { name: 'Working…' });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(busy.hasAttribute('disabled')).toBe(true);
    expect(cancel.hasAttribute('disabled')).toBe(true);

    release?.();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(false)
    );
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false);
  });
});
