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
  it('focuses Cancel, so a bare Enter can never take the destructive action', async () => {
    render(ConfirmDialog, { props: confirmProps() });

    const dialog = screen.getByRole('dialog', { name: 'Delete prompt?' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });

    await waitFor(() => expect(document.activeElement).toBe(cancel));

    // What makes Enter safe is only the focus order, so assert the order itself:
    // if Cancel stops being the first focusable, Enter lands on Delete again.
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    );
    expect(focusables[0]).toBe(cancel);
    expect(focusables).toContain(confirm);
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

  it('hands focus back to whatever opened it', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Delete';
    document.body.append(trigger);
    trigger.focus();

    render(ConfirmDialog, { props: confirmProps() });
    const dialog = screen.getByRole('dialog', { name: 'Delete prompt?' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    cleanup();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
