/**
 * Self-update — the reactive state behind the update banner and the footer's
 * update affordance.
 *
 * Checks GitHub Releases for a newer signed build and installs it in-app. This
 * only ever fetches. Any failure (offline, GitHub unreachable, no release yet)
 * is swallowed on the launch-time path so it can never block the app from
 * starting.
 *
 * **The banner tells you once; the footer always knows.** A version surfaces the
 * banner at most once per install, ever — see `markSeen` below for why that is
 * recorded on *render* rather than on a click. The footer
 * (`src/routes/+page.svelte`) is the permanent quiet channel that keeps a
 * dismissed-or-missed update reachable forever.
 *
 * The `@tauri-apps/*` imports are static but import-safe: they only touch the
 * Tauri IPC bridge when their functions are actually called, and every caller
 * guards on `isTauri()` first (this app's convention is a guard at each call
 * site, not one centralized wrapper).
 */
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'uptodate' | 'error';

/**
 * `newVersion` is deliberately independent of `status`: it stays set while
 * `status` is 'idle', which is exactly the "banner seen and gone, update still
 * pending" state the footer renders `Update to vX` from.
 */
export const update = $state<{
  status: UpdateStatus;
  newVersion: string;
  progress: number;
  error: string;
}>({ status: 'idle', newVersion: '', progress: 0, error: '' });

/** The update returned by the last successful check(), held until the user installs it. */
let pending: Update | null = null;

// --- Seen-version memory ----------------------------------------------------
// The updater plugin has no skip/dismiss primitive, so this is entirely ours.
// One key, read/written directly, following src/lib/theme.ts's convention —
// there is no storage wrapper module in this app and this does not justify one.

const STORAGE_KEY = 'promptcompose-update-seen';

function getSeen(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

/**
 * Record a version as seen. Called the moment the banner is committed to render
 * — NOT when the user clicks something.
 *
 * That is the load-bearing half of "never nag": ignoring a banner *is* a
 * decision, and it is the most common one. Recording only explicit dismissals
 * would re-surface the banner on every launch to precisely the user who already
 * showed you they were not interested. Whether they hit ×, ignore it, or quit
 * the app two seconds later, this version never auto-surfaces again — the footer
 * keeps it reachable.
 */
function markSeen(version: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, version);
}

// --- Transient-status auto-dismiss ------------------------------------------
// 'checking' / 'uptodate' / 'error' are answers to a question the user just
// asked, so they expire on their own. 'available' and 'downloading' never do:
// 'available' is the one status the user must be able to act on, and it has a ×
// right there. This state is module-level (no component + onDestroy to clear a
// timer), so every transition routes through setStatus to keep exactly one timer.

const TRANSIENT_DISMISS_MS = 4000;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(status: UpdateStatus): void {
  update.status = status;
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (status === 'checking' || status === 'uptodate' || status === 'error') {
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      update.status = 'idle';
    }, TRANSIENT_DISMISS_MS);
  }
}

/**
 * @param silent when true (the launch-time call) stay quiet unless an *unseen*
 *   update is available; when false (the footer's manual check) also surface
 *   "checking", "you're up to date", errors, and an already-seen update.
 *
 * A manual check always surfaces the banner, even for a version already seen:
 * the user explicitly asked, and an explicit action must never be silently
 * swallowed.
 */
export async function checkForUpdates(silent = true): Promise<void> {
  // Never let a check stomp an in-flight download or overlap another check.
  if (update.status === 'downloading' || update.status === 'checking') return;
  if (!silent) {
    update.error = '';
    setStatus('checking');
  }
  try {
    const found = await check();
    // `check()` returns null when there is nothing newer (comparison is
    // strictly-greater semver against the running version). The version guard is
    // defensive: plugins-workspace#2998 reports some versions returning a
    // non-null Update carrying empty data, which would otherwise render a banner
    // advertising "Update available — v". Costs nothing if that report is noise.
    if (!found || !found.version?.trim()) {
      pending = null;
      update.newVersion = '';
      setStatus(silent ? 'idle' : 'uptodate');
      return;
    }
    pending = found;
    update.newVersion = found.version;
    if (silent && getSeen() === found.version) {
      // Already told them about this one. Stay quiet — the footer now reads
      // `Update to v{found.version}` off update.newVersion.
      setStatus('idle');
      return;
    }
    markSeen(found.version);
    setStatus('available');
  } catch (err) {
    // Never let an update check break startup.
    console.error('[updater]', err);
    if (silent) {
      setStatus('idle');
    } else {
      update.error = err instanceof Error ? err.message : String(err);
      setStatus('error');
    }
  }
}

/**
 * The footer's one click target: reveal a known-pending update, or run a manual
 * check when none is known. Keeps the footer dumb — it renders a label and calls
 * this.
 *
 * Revealing rather than installing is deliberate. Installing relaunches the app,
 * which discards any in-memory editor draft, so the footer click surfaces the
 * banner and lets `Update & restart` — a button that states its consequence — be
 * the confirm. It mirrors the two-step, consequence-labelled pattern the project
 * manager's Remove already uses.
 */
export async function openUpdatePrompt(): Promise<void> {
  if (pending && update.newVersion) {
    setStatus('available');
    return;
  }
  await checkForUpdates(false);
}

/** Download the pending update with progress, then relaunch into the new build. */
export async function installUpdate(): Promise<void> {
  // Reentrancy guard: two triggers (e.g. the footer revealing the banner while
  // one is already downloading) would otherwise start two concurrent
  // downloadAndInstall() calls, each racing writes to update.progress.
  if (!pending || update.status === 'downloading') return;
  update.progress = 0;
  update.error = '';
  setStatus('downloading');

  let total = 0;
  let downloaded = 0;
  try {
    await pending.downloadAndInstall((event: DownloadEvent) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0;
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          if (total > 0) {
            update.progress = Math.round((downloaded / total) * 100);
          }
          break;
        case 'Finished':
          update.progress = 100;
          break;
      }
    });
    await relaunch();
  } catch (err) {
    console.error('[updater]', err);
    update.error = err instanceof Error ? err.message : String(err);
    setStatus('error');
  }
}

/**
 * The × — close the banner now. The version was already recorded as seen when
 * the banner rendered, so this only takes it off screen; `update.newVersion`
 * survives and the footer keeps the update reachable.
 */
export function dismiss(): void {
  setStatus('idle');
}
