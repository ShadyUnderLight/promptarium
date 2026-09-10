import { describe, expect, it } from 'vitest';

/**
 * Issue #44 window-chrome contract.
 *
 * titleBarStyle Overlay removes the native title bar as a drag surface, so
 * every data-tauri-drag-region in the DOM is load-bearing. Tauri enforces the
 * drag call at runtime through the ACL, and `core:default` does NOT include
 * `core:window:allow-start-dragging` — cargo test / generate_context! stay
 * green without it because the gap only shows up when the window is dragged.
 * This test fails the build instead.
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
const dragRegionUsed = Object.values(sources).some((s) => s.includes('data-tauri-drag-region'));

describe('titlebar drag contract (Issue #44)', () => {
  it('declares core:window:allow-start-dragging when Overlay + drag region are in play', () => {
    expect(overlayOn).toBe(true);
    expect(dragRegionUsed).toBe(true);
    expect(capability.permissions).toContain('core:window:allow-start-dragging');
  });
});
