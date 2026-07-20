import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseZwoXml } from '../src/parser/zwoParser.js';
import { createWorkerRuntime } from '../src/worker/workerRuntime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(filename) {
  return readFileSync(join(__dirname, 'fixtures', filename), 'utf-8');
}

/** 30 秒的合成課表：10s warmup(50->70) + 12s steady(88) + 8s freeride */
function makeSyntheticWorkout() {
  return {
    id: 'synthetic',
    name: 'Synthetic Test Workout',
    source: 'zwo',
    totalDuration: 30,
    intervals: [
      { type: 'warmup', duration: 10, powerStart: 50, powerEnd: 70, cadence: null },
      { type: 'steady', duration: 12, powerStart: 88, powerEnd: 88, cadence: 90 },
      { type: 'freeride', duration: 8, powerStart: null, powerEnd: null, cadence: null },
    ],
  };
}

/** 假的 setInterval/clearInterval：只記錄 callback，什麼時候「觸發」由測試自己決定 */
function createFakeScheduler() {
  let nextId = 1;
  const active = new Map();
  return {
    setIntervalFn: (cb) => {
      const id = nextId++;
      active.set(id, cb);
      return id;
    },
    clearIntervalFn: (id) => {
      active.delete(id);
    },
    fireAll() {
      for (const cb of Array.from(active.values())) cb();
    },
    activeCount() {
      return active.size;
    },
  };
}

/** 假的時鐘：測試手動推進「現在時間」，模擬分頁被降頻、interval 不準時觸發 */
function createFakeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

function createHarness(clock, scheduler, tickIntervalMs = 200) {
  const messages = [];
  const runtime = createWorkerRuntime({
    postMessage: (message) => messages.push(message),
    now: clock.now,
    setIntervalFn: scheduler.setIntervalFn,
    clearIntervalFn: scheduler.clearIntervalFn,
    tickIntervalMs,
  });
  return { runtime, messages };
}

describe('createWorkerRuntime', () => {
  it('emits the initial idle state on init without starting the loop', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime, messages } = createHarness(clock, scheduler);

    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'state',
      state: {
        status: 'idle',
        currentIntervalIndex: 0,
        elapsedInInterval: 0,
        elapsedTotal: 0,
        powerAdjustPct: 0,
        startTimestamp: null,
      },
      events: [],
    });
    expect(scheduler.activeCount()).toBe(0);
  });

  it('starts exactly one interval loop on play(), even if play is sent twice', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });

    runtime.handleMessage({ type: 'play' });
    expect(scheduler.activeCount()).toBe(1);
    expect(runtime.isLoopRunning()).toBe(true);

    runtime.handleMessage({ type: 'play' });
    expect(scheduler.activeCount()).toBe(1);
  });

  it('ticks the engine and emits fresh state every time the interval fires', () => {
    const clock = createFakeClock(1_000_000);
    const scheduler = createFakeScheduler();
    const { runtime, messages } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });
    runtime.handleMessage({ type: 'play' });
    messages.length = 0;

    clock.advance(5000);
    scheduler.fireAll();

    expect(messages).toHaveLength(1);
    expect(messages[0].state.elapsedTotal).toBe(5);
    expect(messages[0].state.currentIntervalIndex).toBe(0);
  });

  it('stays accurate even when the interval only fires once after a long background-tab gap', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime, messages } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() }); // 10 + 12 + 8 = 30s total
    runtime.handleMessage({ type: 'play' });
    messages.length = 0;

    // The tab gets backgrounded: 25 real seconds pass, but a throttled
    // browser only actually invokes the setInterval callback once.
    clock.advance(25_000);
    scheduler.fireAll();

    expect(messages).toHaveLength(1); // one throttled firing, not 125 ticks worth
    const { state } = messages[0];
    expect(state.currentIntervalIndex).toBe(2); // 10 + 12 = 22, so 3s into freeride
    expect(state.elapsedInInterval).toBe(3);
    expect(state.elapsedTotal).toBe(25);
  });

  it('pause stops the loop and freezes elapsed time regardless of how long it stays backgrounded', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime, messages } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });
    runtime.handleMessage({ type: 'play' });

    clock.advance(5000);
    scheduler.fireAll();

    messages.length = 0;
    runtime.handleMessage({ type: 'pause' });
    expect(scheduler.activeCount()).toBe(0);
    expect(runtime.isLoopRunning()).toBe(false);
    expect(messages[0].state.status).toBe('paused');
    expect(messages[0].state.elapsedTotal).toBe(5);

    // Backgrounded/paused for a long time - no interval left to even fire.
    clock.advance(600_000);
    expect(scheduler.activeCount()).toBe(0);

    runtime.handleMessage({ type: 'play' });
    expect(scheduler.activeCount()).toBe(1);

    clock.advance(2000);
    scheduler.fireAll();
    const resumed = messages[messages.length - 1];
    expect(resumed.state.elapsedTotal).toBe(7); // 5s before pause + 2s after resume
  });

  it('passes skip/redo/stop through to the engine, and stop halts the loop', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime, messages } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });
    runtime.handleMessage({ type: 'play' });

    messages.length = 0;
    runtime.handleMessage({ type: 'skip' });
    expect(messages[0].events).toContain('intervalChanged');
    expect(messages[0].state.currentIntervalIndex).toBe(1);
    expect(scheduler.activeCount()).toBe(1); // still running, loop untouched

    messages.length = 0;
    runtime.handleMessage({ type: 'redo' });
    expect(messages[0].state.currentIntervalIndex).toBe(1);
    expect(messages[0].state.elapsedInInterval).toBe(0);

    messages.length = 0;
    runtime.handleMessage({ type: 'stop' });
    expect(messages[0].events).toContain('workoutFinished');
    expect(messages[0].state.status).toBe('finished');
    expect(scheduler.activeCount()).toBe(0);
    expect(runtime.isLoopRunning()).toBe(false);
  });

  it('automatically stops the loop once the workout finishes naturally via ticking', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime, messages } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });
    runtime.handleMessage({ type: 'play' });

    clock.advance(30_000); // exactly totalDuration
    scheduler.fireAll();

    const last = messages[messages.length - 1];
    expect(last.state.status).toBe('finished');
    expect(last.events).toContain('workoutFinished');
    expect(scheduler.activeCount()).toBe(0);
    expect(runtime.isLoopRunning()).toBe(false);
  });

  it('emits countdownWarning once the interval fires past the 10s-remaining threshold', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime, messages } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });
    runtime.handleMessage({ type: 'play' });

    clock.advance(10_000); // enter the 12s steady segment, remaining = 12s
    scheduler.fireAll();

    messages.length = 0;
    clock.advance(4000); // remaining = 8s, crossed the 10s threshold
    scheduler.fireAll();

    expect(messages[0].events).toContain('countdownWarning');
  });

  it('accumulates adjustPower and reflects it in getState()', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });

    runtime.handleMessage({ type: 'adjustPower', delta: 1 });
    runtime.handleMessage({ type: 'adjustPower', delta: 1 });
    runtime.handleMessage({ type: 'adjustPower', delta: -1 });

    expect(runtime.getState().powerAdjustPct).toBe(1);
  });

  it('throws a clear error if a command is sent before init', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime } = createHarness(clock, scheduler);

    expect(() => runtime.handleMessage({ type: 'play' })).toThrow(/before "init"/);
  });

  it('throws on an unknown message type', () => {
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout: makeSyntheticWorkout() });

    expect(() => runtime.handleMessage({ type: 'nope' })).toThrow(/unknown message type/i);
  });

  it('runs a full real .zwo workout to a clean finish, ticked irregularly like a throttled worker', () => {
    const workout = parseZwoXml(loadFixture('basic_warmup_steady_cooldown.zwo')); // 600 + 720 + 300 = 1620s
    const clock = createFakeClock(0);
    const scheduler = createFakeScheduler();
    const { runtime, messages } = createHarness(clock, scheduler);
    runtime.handleMessage({ type: 'init', workout });
    runtime.handleMessage({ type: 'play' });
    messages.length = 0;

    // Fire the "interval" at irregular, coarse steps instead of a steady
    // cadence - this is what a throttled background tab looks like.
    const stepsSincePlay = [700, 1300, 1621]; // deliberately uneven
    let elapsedSoFar = 0;
    for (const s of stepsSincePlay) {
      clock.advance((s - elapsedSoFar) * 1000);
      elapsedSoFar = s;
      scheduler.fireAll();
    }

    const last = messages[messages.length - 1];
    expect(last.state.status).toBe('finished');
    expect(scheduler.activeCount()).toBe(0);
  });
});
