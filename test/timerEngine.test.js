import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseZwoXml } from '../src/parser/zwoParser.js';
import { computeCurrentTarget, createTimerEngine, TIMER_EVENTS } from '../src/engine/timerEngine.js';
import { getZoneColor } from '../src/constants/powerZones.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(filename) {
  return readFileSync(join(__dirname, 'fixtures', filename), 'utf-8');
}

/** 30 秒的合成課表：10s warmup(50->70) + 12s steady(88) + 8s freeride，方便算邊界 */
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

describe('getZoneColor', () => {
  it.each([
    [54, 'Z1'],
    [55, 'Z2'],
    [75, 'Z2'],
    [76, 'Z3'],
    [90, 'Z3'],
    [91, 'Z4'],
    [105, 'Z4'],
    [106, 'Z5'],
    [120, 'Z5'],
    [121, 'Z6'],
    [150, 'Z6'],
    [151, 'Z7'],
  ])('classifies %i%% FTP as %s', (pct, expectedZone) => {
    expect(getZoneColor(pct).key).toBe(expectedZone);
  });
});

describe('computeCurrentTarget', () => {
  const workout = makeSyntheticWorkout();

  it('returns null watts/pct for freeride segments', () => {
    const target = computeCurrentTarget(workout, 2, 3, 200);
    expect(target).toEqual({ watts: null, pct: null });
  });

  it('holds a flat percentage for steady segments regardless of elapsed time', () => {
    const start = computeCurrentTarget(workout, 1, 0, 200);
    const mid = computeCurrentTarget(workout, 1, 6, 200);
    const end = computeCurrentTarget(workout, 1, 12, 200);
    expect(start.pct).toBe(88);
    expect(mid.pct).toBe(88);
    expect(end.pct).toBe(88);
    expect(mid.watts).toBe(176); // 200 * 0.88
  });

  it('linearly interpolates ramp/warmup/cooldown segments across duration', () => {
    expect(computeCurrentTarget(workout, 0, 0, 200).pct).toBe(50);
    expect(computeCurrentTarget(workout, 0, 5, 200).pct).toBe(60); // halfway between 50 and 70
    expect(computeCurrentTarget(workout, 0, 10, 200).pct).toBe(70);
  });

  it('applies the user power adjustment immediately', () => {
    const base = computeCurrentTarget(workout, 1, 0, 200, 0);
    const bumped = computeCurrentTarget(workout, 1, 0, 200, 1);
    const lowered = computeCurrentTarget(workout, 1, 0, 200, -2);
    expect(bumped.pct).toBe(base.pct + 1);
    expect(lowered.pct).toBe(base.pct - 2);
    expect(bumped.watts).toBe(Math.round((200 * 89) / 100));
  });

  it('attaches the correct zone color', () => {
    expect(computeCurrentTarget(workout, 1, 0, 200).zoneColor.key).toBe('Z3'); // 88% -> Z3
  });
});

describe('createTimerEngine', () => {
  it('starts in idle state at interval 0', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    const state = engine.getState();
    expect(state).toEqual({
      status: 'idle',
      currentIntervalIndex: 0,
      elapsedInInterval: 0,
      elapsedTotal: 0,
      powerAdjustPct: 0,
      startTimestamp: null,
    });
  });

  it('advances elapsedInInterval while running, derived from timestamps not tick counts', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    const t0 = 1_000_000;
    engine.play(t0);

    const { state } = engine.tick(t0 + 5_000);
    expect(state.status).toBe('running');
    expect(state.currentIntervalIndex).toBe(0);
    expect(state.elapsedInInterval).toBe(5);
    expect(state.elapsedTotal).toBe(5);
  });

  it('auto-advances to the next interval exactly at the duration boundary and emits intervalChanged', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    const t0 = 0;
    engine.play(t0);
    engine.tick(t0 + 5_000);

    const { state, events } = engine.tick(t0 + 10_000); // warmup duration is exactly 10s
    expect(state.currentIntervalIndex).toBe(1);
    expect(state.elapsedInInterval).toBe(0);
    expect(events).toContain(TIMER_EVENTS.INTERVAL_CHANGED);
  });

  it('marks the workout finished once elapsed time reaches the total duration', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    engine.play(0);
    engine.tick(22_000); // enter freeride (10 + 12)

    const { state, events } = engine.tick(30_000); // total duration
    expect(state.status).toBe('finished');
    expect(state.currentIntervalIndex).toBe(2); // clamped to the last interval
    expect(state.elapsedInInterval).toBe(8); // freeride's full duration
    expect(events).toContain(TIMER_EVENTS.WORKOUT_FINISHED);
  });

  it('emits countdownWarning only once remaining time crosses 10s, and only for segments longer than 10s', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    engine.play(0);
    engine.tick(10_000); // switch into the 12s steady segment, remaining = 12s

    const stillAbove = engine.tick(11_000); // remaining = 11s, no warning yet
    expect(stillAbove.events).not.toContain(TIMER_EVENTS.COUNTDOWN_WARNING);

    const crossed = engine.tick(14_000); // remaining = 8s, crossed the 10s threshold
    expect(crossed.events).toContain(TIMER_EVENTS.COUNTDOWN_WARNING);

    const staysBelow = engine.tick(15_000); // remaining = 7s, already warned, no repeat
    expect(staysBelow.events).not.toContain(TIMER_EVENTS.COUNTDOWN_WARNING);
  });

  it('never fires countdownWarning for a segment whose duration is 10s or less', () => {
    const workout = makeSyntheticWorkout(); // first segment (warmup) is exactly 10s
    const engine = createTimerEngine(workout);
    engine.play(0);

    for (let s = 1; s <= 9; s++) {
      const { events } = engine.tick(s * 1000);
      expect(events).not.toContain(TIMER_EVENTS.COUNTDOWN_WARNING);
    }
  });

  it('freezes elapsedTotal on pause and resumes correctly without counting paused time', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    engine.play(0);
    engine.tick(5_000);

    const paused = engine.pause(8_000);
    expect(paused.state.status).toBe('paused');
    expect(paused.state.elapsedTotal).toBe(8);

    // Ticking while paused must not advance time, even after a long real-world gap.
    const whilePaused = engine.tick(20_000);
    expect(whilePaused.state.elapsedTotal).toBe(8);
    expect(whilePaused.state.status).toBe('paused');

    engine.play(25_000);
    const resumed = engine.tick(27_000); // 2s of real time after resuming
    expect(resumed.state.elapsedTotal).toBe(10);
  });

  it('is resilient to a single large time jump (e.g. a throttled background tab)', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    engine.play(0);

    // Only one tick ever fires, 25s later - simulates a backgrounded tab.
    const { state } = engine.tick(25_000);
    expect(state.currentIntervalIndex).toBe(2); // 10 (warmup) + 12 (steady) = 22, so 3s into freeride
    expect(state.elapsedInInterval).toBe(3);
    expect(state.elapsedTotal).toBe(25);
  });

  it('skip() jumps to the next interval and finishes the workout after the last one', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());

    const first = engine.skip(); // idle -> still idle, moves to interval 1
    expect(first.state.currentIntervalIndex).toBe(1);
    expect(first.state.elapsedInInterval).toBe(0);
    expect(first.state.status).toBe('idle');
    expect(first.events).toContain(TIMER_EVENTS.INTERVAL_CHANGED);

    const second = engine.skip();
    expect(second.state.currentIntervalIndex).toBe(2);

    const third = engine.skip();
    expect(third.state.status).toBe('finished');
    expect(third.state.elapsedTotal).toBe(30);
    expect(third.events).toContain(TIMER_EVENTS.WORKOUT_FINISHED);
  });

  it('redo() resets elapsedInInterval to 0 without changing interval index or status', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    engine.play(0);
    engine.tick(15_000); // 5s into the steady segment (index 1)

    const { state } = engine.redo(15_000);
    expect(state.currentIntervalIndex).toBe(1);
    expect(state.elapsedInInterval).toBe(0);
    expect(state.status).toBe('running');
  });

  it('stop() finishes the workout early while preserving the position it stopped at', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    engine.play(0);
    engine.tick(15_000); // 5s into the steady segment (index 1)

    const { state, events } = engine.stop(15_000);
    expect(state.status).toBe('finished');
    expect(state.currentIntervalIndex).toBe(1);
    expect(state.elapsedInInterval).toBe(5);
    expect(events).toContain(TIMER_EVENTS.WORKOUT_FINISHED);

    const again = engine.stop(16_000);
    expect(again.events).not.toContain(TIMER_EVENTS.WORKOUT_FINISHED);
  });

  it('adjustPower accumulates ±1% steps', () => {
    const engine = createTimerEngine(makeSyntheticWorkout());
    engine.adjustPower(1);
    engine.adjustPower(1);
    const { state } = engine.adjustPower(-1);
    expect(state.powerAdjustPct).toBe(1);
  });

  it('runs a full real .zwo workout second-by-second to a clean finish', () => {
    const workout = parseZwoXml(loadFixture('basic_warmup_steady_cooldown.zwo'));
    const engine = createTimerEngine(workout);
    engine.play(0);

    let intervalChangedCount = 0;
    let finishedEvents = 0;
    let lastState = engine.getState();

    for (let s = 1; s <= workout.totalDuration; s++) {
      const { state, events } = engine.tick(s * 1000);
      if (events.includes(TIMER_EVENTS.INTERVAL_CHANGED)) intervalChangedCount++;
      if (events.includes(TIMER_EVENTS.WORKOUT_FINISHED)) finishedEvents++;
      lastState = state;
    }

    expect(intervalChangedCount).toBe(workout.intervals.length - 1);
    expect(finishedEvents).toBe(1);
    expect(lastState.status).toBe('finished');

    // Spot-check the warmup ramp midpoint: 50% -> 70% over 600s, so t=300s should read 60%.
    const midWarmup = computeCurrentTarget(workout, 0, 300, 200);
    expect(midWarmup.pct).toBe(60);
    expect(midWarmup.watts).toBe(120);
  });
});
