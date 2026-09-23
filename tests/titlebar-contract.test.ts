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
  app?: {
    windows?: Array<{
      titleBarStyle?: string;
      hiddenTitle?: boolean;
      trafficLightPosition?: { x?: number; y?: number };
      minWidth?: number;
      minHeight?: number;
    }>;
  };
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
    const windowConfig = tauriConf.app?.windows?.[0];
    expect(overlayOn).toBe(true);
    expect(windowConfig?.hiddenTitle).toBe(true);
    expect(windowConfig?.trafficLightPosition).toEqual({ x: 16, y: 26 });
    expect(titleBlockDraggable).toBe(true);
    expect(capability.permissions).toContain('core:window:allow-start-dragging');
  });
});

/**
 * Phase 7 packaged acceptance (Issue #68) recorded one measured fact: a 720x600
 * resize request is clamped back to 900x600, so the `@media (max-width: 720px)`
 * branch in src/app.css is unreachable inside the .app. This contract pins the
 * *configuration* those two numbers come from — lowering minWidth to 720 or
 * less would make the branch reachable again and silently invalidate the
 * recorded pass without failing anything else.
 *
 * Scope, deliberately narrow: this reads src-tauri/tauri.conf.json only. It
 * does NOT prove the shipped .app was built with this config (a CLI
 * `--config` override happens at build time and is invisible here), and it does
 * NOT verify that a real window clamps at runtime — that was measured with the
 * AX probe and is recorded in project_docs/, not asserted here. There is no
 * automation channel that could assert the packaged window: the release build
 * ships no devtools, and WKWebView's DOM is not exposed through AX.
 */
describe('min-window config contract (Issue #68)', () => {
  it('pins the configured minimum that keeps the 720px branch unreachable', () => {
    const windowConfig = tauriConf.app?.windows?.[0];
    expect(windowConfig?.minWidth).toBe(900);
    expect(windowConfig?.minHeight).toBe(600);
  });
});
