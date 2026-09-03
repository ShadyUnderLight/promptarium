/**
 * Component-level regression tests for the Issue #30 hardening.
 *
 * These tests mount the real components and exercise their event / async
 * wiring — the layers the pure-helper contract tests in examples_editor.mjs
 * cannot reach:
 *
 * P1 — Cmd+S input sync (Edit view). inputFile / outputFile must write into
 *   the editor metadata on every `input` event, never only on blur via
 *   `change`. A test that fires only an `input` event (never `change`) fails
 *   the moment either field regresses back to `onchange`, so Cmd+S without
 *   blur would once again save the old value.
 *
 * P2 — project-scoped resolver lifecycle (Edit + Preview views). A new resolve
 *   request must not show the previous Project's resolution, a slow stale
 *   response must never overwrite the current request, and a rejected resolver
 *   must leave an empty map without raising an unhandled rejection.
 *
 * The upper layers (dirty = JSON diff of metadata; save through
 * `effectiveMetadataForSave`) are covered by the pure-helper tests; this file
 * locks the component wiring that feeds them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import ExamplesEditor from '../src/lib/components/library/ExamplesEditor.svelte';
import ExamplesSection from '../src/lib/components/library/ExamplesSection.svelte';
import type { ResolvedPromptAsset } from '../src/lib/prompts/types';
import { resolvePromptAssets, pickAssetReference, revealAssetInFinder } from '$lib/api';

vi.mock('$lib/api', () => ({
  resolvePromptAssets: vi.fn(),
  pickAssetReference: vi.fn(),
  revealAssetInFinder: vi.fn(),
}));

const resolveMock = vi.mocked(resolvePromptAssets);
const pickMock = vi.mocked(pickAssetReference);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const RESOLVED: ResolvedPromptAsset = { reference: 'assets/ref.png', state: 'resolved', kind: 'image' };
const MISSING: ResolvedPromptAsset = { reference: 'assets/ref.png', state: 'missing' };

const singleExample = [{ name: 'E', assets: ['assets/ref.png'] }];

describe('P1 — Cmd+S input sync (Edit view, oninput not onchange)', () => {
  beforeEach(() => {
    // The asset-state preview effect settles with an empty result so it never
    // touches the assertions below.
    resolveMock.mockResolvedValue([]);
    pickMock.mockResolvedValue({ error: 'Selection cancelled.' });
  });

  it('inputFile: the first typed character enters metadata immediately (no blur)', async () => {
    const onChange = vi.fn();
    render(ExamplesEditor, {
      props: {
        examples: [{ name: 'A', inputFile: 'examples/old.txt' }],
        projectPath: '/p',
        onChange,
      },
    });
    const input = screen.getByLabelText('Input file reference') as HTMLInputElement;
    // Fire only `input` (never `change`): an `onchange`-bound field would not
    // react and this test would fail.
    await fireEvent.input(input, { target: { value: 'e' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0]![0] as { inputFile?: string }[];
    expect(updated[0]!.inputFile).toBe('e');
  });

  it('outputFile: typing writes through immediately (no blur needed)', async () => {
    const onChange = vi.fn();
    render(ExamplesEditor, {
      props: {
        examples: [{ name: 'A', outputFile: 'examples/old.txt' }],
        projectPath: '/p',
        onChange,
      },
    });
    const input = screen.getByLabelText('Output file reference') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'examples/new.txt' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0]![0] as { outputFile?: string }[];
    expect(updated[0]!.outputFile).toBe('examples/new.txt');
  });

  it('editing a file reference while another field is already dirty keeps the latest ref in metadata', async () => {
    const onChange = vi.fn();
    render(ExamplesEditor, {
      props: {
        // `notes` is already a live edit upstream; the file ref must not be
        // saved with the stale value once the user types into it.
        examples: [{ name: 'A', notes: 'edited elsewhere', inputFile: 'examples/old.txt' }],
        projectPath: '/p',
        onChange,
      },
    });
    const input = screen.getByLabelText('Input file reference') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'examples/new.txt' } });
    const updated = onChange.mock.calls.at(-1)![0] as { inputFile?: string; notes?: string }[];
    expect(updated[0]!.inputFile).toBe('examples/new.txt');
    expect(updated[0]!.notes).toBe('edited elsewhere');
  });
});

describe('P2 — project-scoped resolver lifecycle (Edit view)', () => {
  it('switching Projects never shows the previous Ready; a slow stale response cannot overwrite', async () => {
    const projectA = '/p/a';
    const projectB = '/p/b';
    const dA = deferred<ResolvedPromptAsset[]>();
    const dB = deferred<ResolvedPromptAsset[]>();
    resolveMock.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

    const { rerender } = render(ExamplesEditor, {
      props: { examples: singleExample, projectPath: projectA, onChange: vi.fn() },
    });

    // Project A resolves Ready and shows the chip.
    dA.resolve([{ ...RESOLVED }]);
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy());

    // Switch to B: the new request starts, B's response is still pending.
    await rerender({ examples: singleExample, projectPath: projectB, onChange: vi.fn() });
    expect(resolveMock).toHaveBeenCalledTimes(2);
    expect(resolveMock.mock.calls[1]![0]).toBe(projectB);
    // B must not show A's Ready while pending.
    expect(screen.queryByText('Ready')).toBeNull();

    // A's response arrives late (it was cancelled by the switch): it must not
    // write back into B's view.
    dA.resolve([{ ...RESOLVED }]);
    await waitFor(() => expect(resolveMock.mock.calls[1]![0]).toBe(projectB));
    expect(screen.queryByText('Ready')).toBeNull();

    // B then resolves Missing.
    dB.resolve([{ ...MISSING }]);
    await waitFor(() => expect(screen.getByText('Missing')).toBeTruthy());
    expect(screen.queryByText('Ready')).toBeNull();
  });

  it('a rejected resolver clears the previous Project state and raises no unhandled rejection', async () => {
    const projectA = '/p/a';
    const projectB = '/p/b';
    const dA = deferred<ResolvedPromptAsset[]>();
    const dB = deferred<ResolvedPromptAsset[]>();
    resolveMock.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

    const { rerender } = render(ExamplesEditor, {
      props: { examples: singleExample, projectPath: projectA, onChange: vi.fn() },
    });
    dA.resolve([{ ...RESOLVED }]);
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy());

    // Switch to B and make its resolver reject.
    await rerender({ examples: singleExample, projectPath: projectB, onChange: vi.fn() });
    dB.reject(new Error('project unavailable'));

    // Old A state must be gone; no stale Ready, no error chip (empty map).
    await waitFor(() => expect(screen.queryByText('Ready')).toBeNull());
    expect(screen.queryByText('Missing')).toBeNull();
    expect(screen.queryByText('Invalid')).toBeNull();
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });
});

describe('P2 — project-scoped resolver lifecycle (Preview view)', () => {
  it('switching Projects never shows the previous Ready; a slow stale response cannot overwrite', async () => {
    const projectA = '/p/a';
    const projectB = '/p/b';
    const dA = deferred<ResolvedPromptAsset[]>();
    const dB = deferred<ResolvedPromptAsset[]>();
    resolveMock.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

    const { rerender } = render(ExamplesSection, {
      props: { examples: singleExample, projectPath: projectA, refreshVersion: 0 },
    });

    dA.resolve([{ ...RESOLVED }]);
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy());

    await rerender({ examples: singleExample, projectPath: projectB, refreshVersion: 0 });
    expect(resolveMock).toHaveBeenCalledTimes(2);
    expect(resolveMock.mock.calls[1]![0]).toBe(projectB);
    expect(screen.queryByText('Ready')).toBeNull();

    dA.resolve([{ ...RESOLVED }]);
    await waitFor(() => expect(resolveMock.mock.calls[1]![0]).toBe(projectB));
    expect(screen.queryByText('Ready')).toBeNull();

    dB.resolve([{ ...MISSING }]);
    await waitFor(() => expect(screen.getByText('Missing')).toBeTruthy());
    expect(screen.queryByText('Ready')).toBeNull();
  });

  it('a rejected resolver clears the previous Project state and raises no unhandled rejection', async () => {
    const projectA = '/p/a';
    const projectB = '/p/b';
    const dA = deferred<ResolvedPromptAsset[]>();
    const dB = deferred<ResolvedPromptAsset[]>();
    resolveMock.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

    const { rerender } = render(ExamplesSection, {
      props: { examples: singleExample, projectPath: projectA, refreshVersion: 0 },
    });
    dA.resolve([{ ...RESOLVED }]);
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy());

    await rerender({ examples: singleExample, projectPath: projectB, refreshVersion: 0 });
    dB.reject(new Error('project unavailable'));

    await waitFor(() => expect(screen.queryByText('Ready')).toBeNull());
    expect(screen.queryByText('Missing')).toBeNull();
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });
});
