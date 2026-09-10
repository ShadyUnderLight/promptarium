import { describe, expect, it } from 'vitest';

/**
 * Issue #44 window-chrome contract — conditional on adoption.
 *
 * Overlay removes the native title bar as a drag surface, so whenever the
 * config keeps `titleBarStyle: "Overlay"` the app MUST expose a working drag
 * surface: at least one data-tauri-drag-region in the DOM plus the
 * `core:window:allow-start-dragging` ACL (core:default does NOT include it —
 * cargo test / generate_context! stay green without it because the gap only
 * shows up when the window is dragged). Rejecting Overlay and rolling the
 * config back is a legal outcome of #44 and makes this test vacuously pass.
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
  it('provides a working drag surface whenever Overlay is enabled', () => {
    if (!overlayOn) return;
    expect(dragRegionUsed).toBe(true);
    expect(capability.permissions).toContain('core:window:allow-start-dragging');
  });
});
