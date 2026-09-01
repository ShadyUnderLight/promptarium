export type RefreshTask = () => Promise<void>;

export interface SchedulerClock {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

const defaultClock: SchedulerClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

/** Coalesce filesystem refresh triggers with debounce and single-flight queueing. */
export class FsRefreshScheduler {
  private readonly debounceMs: number;
  private readonly clock: SchedulerClock;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight = false;
  private queued = false;

  constructor(debounceMs = 300, clock: SchedulerClock = defaultClock) {
    this.debounceMs = debounceMs;
    this.clock = clock;
  }

  notify(onRefresh: RefreshTask): void {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.run(onRefresh);
    }, this.debounceMs);
  }

  private async run(onRefresh: RefreshTask): Promise<void> {
    if (this.refreshInFlight) {
      this.queued = true;
      return;
    }
    this.refreshInFlight = true;
    try {
      await onRefresh();
    } finally {
      this.refreshInFlight = false;
      if (this.queued) {
        this.queued = false;
        void this.run(onRefresh);
      }
    }
  }
}
