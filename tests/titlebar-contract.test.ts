import { describe, expect, it } from 'vitest';

/**
 * Issue #44 resolved: Adopt.
 *
 * The merged product contract is:
 * Overlay + drag surface + start-dragging ACL.
 *
 * Overlay removes the native title bar as a drag surface, so the topbar title
 * block must keep its data-tauri-drag-region and the main capability must
 * keep `core:window:allow-start-dragging` (core:default does NOT include it —
 * cargo test / generate_context! stay green without it because the gap only
 * shows up when the window is dragged). A future deliberate rollback of the
 * adopted Overlay must update this contract together with the implementation.
 */

const configs = import.meta.glob('../src-tauri/{tauri.conf.json,capabilities/default.json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const sources = import.meta.glob('../src/**/*.svelte', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const tauriConf = JSON.parse(configs['../src-tauri/tauri.conf.json']) as {
  app?: { windows?: Array<{ titleBarStyle?: string }> };
};
const capability = JSON.parse(configs['../src-tauri/capabilities/default.json']) as {
  permissions: string[];
};

const overlayOn = (tauriConf.app?.windows ?? []).some((w) => w.titleBarStyle === 'Overlay');
// Scoped to the topbar title block on purpose: a drag region elsewhere in the
// app must not stand in for the title bar's drag surface.
const promptsView = sources['../src/lib/components/PromptsView.svelte'] ?? '';
const titleBlockDraggable =
  /class="library-topbar__title"[^>]*data-tauri-drag-region/.test(promptsView) ||
  /data-tauri-drag-region[^>]*class="library-topbar__title"/.test(promptsView);

describe('titlebar adoption contract (Issue #44)', () => {
  it('keeps the adopted Overlay titlebar wired for dragging', () => {
    expect(overlayOn).toBe(true);
    expect(titleBlockDraggable).toBe(true);
    expect(capability.permissions).toContain('core:window:allow-start-dragging');
  });
});
