/**
 * Scheduler tests for coalesced filesystem refresh triggers.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { FsRefreshScheduler } = await import(join(root, 'src/lib/library/fs-refresh-scheduler.ts'));

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error('  FAIL: ' + message);
  }
}

function createFakeClock() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    clock: {
      setTimeout(callback, delayMs) {
        const id = nextId++;
        timers.set(id, { at: now + delayMs, callback });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
  };
}

console.log('debounces refresh triggers');
{
  const fake = createFakeClock();
  const scheduler = new FsRefreshScheduler(300, fake.clock);
  let runs = 0;
  scheduler.notify(async () => {
    runs++;
  });
  scheduler.notify(async () => {
    runs++;
  });
  assert(runs === 0, 'no immediate refresh');
  fake.advance(299);
  assert(runs === 0, 'still debouncing');
  fake.advance(1);
  assert(runs === 1, 'single refresh after debounce');
}

console.log('queues one follow-up refresh while in flight');
{
  const fake = createFakeClock();
  const scheduler = new FsRefreshScheduler(0, fake.clock);
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  scheduler.notify(async () => {
    runs++;
    if (runs === 1) await gate;
  });
  fake.advance(0);
  assert(runs === 1, 'first refresh started');
  scheduler.notify(async () => {
    runs++;
  });
  fake.advance(0);
  assert(runs === 1, 'second refresh waits');
  release();
  await Promise.resolve();
  await Promise.resolve();
  assert(runs === 2, 'queued refresh runs once');
}

console.log('single-flight covers a full rebuild that happens inside the refresh task');
{
  const fake = createFakeClock();
  const scheduler = new FsRefreshScheduler(0, fake.clock);
  const events = [];
  let active = 0;
  let maxActive = 0;
  let runCount = 0;
  let releaseRead;
  const gate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  // Models refreshLibrary: the refresh task now AWAITS the full index rebuild
  // (slow body reads) before returning. The scheduler must hold its single-flight
  // boundary for the whole build, so a second refresh never runs a parallel full
  // rebuild; the queued run re-executes the same task only after the first ends.
  const refreshTask = async () => {
    runCount++;
    active++;
    maxActive = Math.max(maxActive, active);
    events.push('refresh-' + runCount + '-start');
    await gate;
    events.push('refresh-' + runCount + '-end');
    active--;
  };
  scheduler.notify(refreshTask);
  fake.advance(0);
  assert(events.join() === 'refresh-1-start', 'first refresh starts its rebuild');
  scheduler.notify(refreshTask);
  fake.advance(0);
  assert(maxActive === 1, 'second refresh never starts a build while the first is in flight');
  assert(events.join() === 'refresh-1-start', 'second refresh is queued behind the in-flight rebuild');
  releaseRead();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(maxActive === 1, 'still no overlap across the queued re-run');
  assert(
    events.join() === 'refresh-1-start,refresh-1-end,refresh-2-start,refresh-2-end',
    'queued refresh re-runs only after the first fully completes'
  );
}

if (failures) {
  console.error('\n' + failures + ' failure(s)');
  process.exit(1);
}

console.log('\nAll fs-refresh-scheduler tests passed.');
