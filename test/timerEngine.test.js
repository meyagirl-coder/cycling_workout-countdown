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
    // 每個區間邊界的兩側都各測一次（規格：Z1 <=55、Z2 56-75、Z3 76-90、
    // Z4 91-105、Z5 106-120、Z6 121-150、Z7 >150）
    [0, 'Z1'],
    [1, 'Z1'],
    [50, 'Z1'],
    [54, 'Z1'],
    [55, 'Z1'], // regression: 55% must land in Z1, not Z2
    [56, 'Z2'],
    [74, 'Z2'],
    [75, 'Z2'],
    [76, 'Z3'],
    [89, 'Z3'],
    [90, 'Z3'], // regression: 90% must land in Z3 (green), not Z5 (orange)
    [91, 'Z4'], // regression: 91% must land in Z4 (yellow), not Z5 (orange)
    [104, 'Z4'],
    [105, 'Z4'], // regression: 105% must land in Z4 (yellow), not Z5 (orange)
    [106, 'Z5'],
    [119, 'Z5'],
    [120, 'Z5'],
    [121, 'Z6'],
    [149, 'Z6'],
    [150, 'Z6'],
    [151, 'Z7'],
    [999, 'Z7'],
  ])('classifies %i%% FTP as %s', (pct, expectedZone) => {
    expect(getZoneColor(pct).key).toBe(expectedZone);
  });

  it.each([
    ['Z1', 'gray'],
    ['Z2', 'blue'],
    ['Z3', 'green'],
    ['Z4', 'yellow'],
    ['Z5', 'orange'],
    ['Z6', 'red'],
    ['Z7', 'purple'],
  ])('maps %s to the %s color', (zoneKey, expectedColor) => {
    const pctByZone = { Z1: 55, Z2: 75, Z3: 90, Z4: 105, Z5: 120, Z6: 150, Z7: 200 };
    expect(getZoneColor(pctByZone[zoneKey]).color).toBe(expectedColor);
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

  describe('countdownWarning / shortCountdownTick (規格：組別時長 > 20 秒才走正常 10 秒預告規則，<= 20 秒走短間歇例外)', () => {
    /** 20 秒門檻測試專用：19s／20s（剛好等於門檻，仍要走短間歇）／25s（正常規則）三段 */
    function makeThresholdTestWorkout() {
      return {
        id: 'threshold-test',
        name: 'Threshold Test Workout',
        source: 'zwo',
        totalDuration: 19 + 20 + 25,
        intervals: [
          { type: 'steady', duration: 19, powerStart: 60, powerEnd: 60, cadence: null },
          { type: 'steady', duration: 20, powerStart: 65, powerEnd: 65, cadence: null },
          { type: 'steady', duration: 25, powerStart: 70, powerEnd: 70, cadence: null },
        ],
      };
    }

    it('emits countdownWarning only once remaining time crosses 10s, only for segments longer than 20s', () => {
      const engine = createTimerEngine(makeThresholdTestWorkout());
      engine.play(0);
      engine.tick(39_000); // 19 + 20 = 39s in, switch into the 25s segment, remaining = 25s

      const stillAbove = engine.tick(50_000); // remaining = 14s, no warning yet
      expect(stillAbove.events).not.toContain(TIMER_EVENTS.COUNTDOWN_WARNING);

      const crossed = engine.tick(55_000); // remaining = 9s, crossed the 10s threshold
      expect(crossed.events).toContain(TIMER_EVENTS.COUNTDOWN_WARNING);
      expect(crossed.events).not.toContain(TIMER_EVENTS.SHORT_COUNTDOWN_TICK);

      const staysBelow = engine.tick(56_000); // remaining = 8s, already warned, no repeat
      expect(staysBelow.events).not.toContain(TIMER_EVENTS.COUNTDOWN_WARNING);
    });

    it('never fires countdownWarning for a segment 20s or shorter, even well before the last 5 seconds', () => {
      const workout = makeSyntheticWorkout(); // first segment (warmup) is exactly 10s, <=20
      const engine = createTimerEngine(workout);
      engine.play(0);

      for (let s = 1; s <= 4; s++) {
        const { events } = engine.tick(s * 1000);
        expect(events).not.toContain(TIMER_EVENTS.COUNTDOWN_WARNING);
      }
    });

    it('a segment exactly 20s long takes the short-interval path, not the normal countdownWarning path (boundary regression: <= not <)', () => {
      const engine = createTimerEngine(makeThresholdTestWorkout());
      engine.play(0);
      engine.tick(19_000); // switch into the 20s segment, remaining = 20s

      // walk through to remaining = 5s (elapsedInInterval = 15s within this segment, at t=34s)
      for (let t = 20_000; t <= 33_000; t += 1000) engine.tick(t);
      const atFive = engine.tick(34_000); // remaining = 5s
      expect(atFive.events).toContain(TIMER_EVENTS.SHORT_COUNTDOWN_TICK);
      expect(atFive.events).not.toContain(TIMER_EVENTS.COUNTDOWN_WARNING);
    });

    it('fires shortCountdownTick exactly once at each of the last 5 seconds (5-4-3-2-1) for a short segment', () => {
      const workout = makeSyntheticWorkout(); // steady segment (index 1) is 12s
      const engine = createTimerEngine(workout);
      engine.play(0);

      // remaining goes 12,11,...,1,0 as elapsedInInterval (within this segment) goes 0..12,
      // i.e. absolute time 10s..22s (the first tick(10_000) call is the INTERVAL_CHANGED
      // transition from the 10s warmup into this segment, not a short-tick threshold
      // crossing). shortCountdownTick should fire when remaining crosses each of
      // 5,4,3,2,1 - i.e. at absolute t = 10+7=17 (remaining 5), 18 (4), 19 (3), 20 (2), 21 (1).
      const tickCountsByAbsoluteSecond = {};
      for (let t = 10_000; t <= 22_000; t += 1000) {
        const { events } = engine.tick(t);
        const count = events.filter((e) => e === TIMER_EVENTS.SHORT_COUNTDOWN_TICK).length;
        if (count > 0) tickCountsByAbsoluteSecond[t / 1000] = count;
      }

      expect(tickCountsByAbsoluteSecond).toEqual({ 17: 1, 18: 1, 19: 1, 20: 1, 21: 1 });
    });

    it('never fires countdownWarning for the same short segment (mutually exclusive with shortCountdownTick)', () => {
      const workout = makeSyntheticWorkout();
      const engine = createTimerEngine(workout);
      engine.play(0);
      engine.tick(10_000);

      for (let t = 11_000; t <= 22_000; t += 1000) {
        const { events } = engine.tick(t);
        expect(events).not.toContain(TIMER_EVENTS.COUNTDOWN_WARNING);
      }
    });

    it('fires shortCountdownTick multiple times in one tick if a throttled background tab skips over several threshold seconds at once', () => {
      const workout = makeSyntheticWorkout(); // 12s steady segment
      const engine = createTimerEngine(workout);
      engine.play(0);
      engine.tick(10_000); // enter the 12s segment, remaining = 12s
      engine.tick(15_000); // remaining = 7s, still above all short-tick thresholds

      // simulate a big gap (backgrounded tab) jumping straight to remaining = 2s,
      // skipping over the 5/4/3/2 threshold crossings in a single tick (1 is not yet
      // crossed since remaining=2 is not <= 1)
      const { events } = engine.tick(20_000); // remaining = 2s
      const shortTicks = events.filter((e) => e === TIMER_EVENTS.SHORT_COUNTDOWN_TICK);
      expect(shortTicks).toHaveLength(4); // crossed 5, 4, 3, and 2
    });

    it('does not fire shortCountdownTick again for a threshold already crossed in a previous tick', () => {
      const workout = makeSyntheticWorkout();
      const engine = createTimerEngine(workout);
      engine.play(0);
      engine.tick(10_000);
      engine.tick(17_000); // remaining = 5s, fires once

      const repeat = engine.tick(17_500); // still remaining ~4.5s rounding aside, no new integer crossed yet within same second
      // no new threshold crossed between 17.0s and 17.5s ticks (still within the same "5" bucket boundary already passed)
      expect(repeat.events.filter((e) => e === TIMER_EVENTS.SHORT_COUNTDOWN_TICK)).toHaveLength(0);
    });
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

  describe('restore (page-reload recovery, see workoutProgressStore.js)', () => {
    it('restores currentIntervalIndex/elapsedInInterval derived from the saved elapsedTotal, landing on "paused"', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      // 15s in: 10s warmup + 5s into the 12s steady interval (index 1).
      const { state } = engine.restore({ elapsedTotal: 15, powerAdjustPct: 0, status: 'paused' });

      expect(state.status).toBe('paused');
      expect(state.currentIntervalIndex).toBe(1);
      expect(state.elapsedInInterval).toBe(5);
      expect(state.elapsedTotal).toBe(15);
    });

    it('restores powerAdjustPct', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      const { state } = engine.restore({ elapsedTotal: 0, powerAdjustPct: 3, status: 'idle' });
      expect(state.powerAdjustPct).toBe(3);
    });

    it('defaults powerAdjustPct to 0 when omitted', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      const { state } = engine.restore({ elapsedTotal: 0, status: 'idle' });
      expect(state.powerAdjustPct).toBe(0);
    });

    it('restores "idle" as-is when elapsedTotal is 0 and the saved status says idle (never actually started)', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      const { state } = engine.restore({ elapsedTotal: 0, powerAdjustPct: 0, status: 'idle' });
      expect(state.status).toBe('idle');
    });

    it('converts a saved "running" status into "paused" - never auto-resumes playback on restore', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      const { state } = engine.restore({ elapsedTotal: 15, powerAdjustPct: 0, status: 'running' });
      expect(state.status).toBe('paused');
    });

    it('restores to "finished" when the saved elapsedTotal already reached the end, regardless of the saved status', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      const { state } = engine.restore({ elapsedTotal: 30, powerAdjustPct: 0, status: 'paused' });
      expect(state.status).toBe('finished');
    });

    it('clamps a negative elapsedTotal to 0 instead of producing a broken state', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      const { state } = engine.restore({ elapsedTotal: -5, powerAdjustPct: 0, status: 'paused' });
      expect(state.elapsedTotal).toBe(0);
      expect(state.currentIntervalIndex).toBe(0);
    });

    it('a restored engine can be resumed normally with play() afterwards, continuing from the restored point', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      engine.restore({ elapsedTotal: 15, powerAdjustPct: 0, status: 'paused' });

      const { state: playedState } = engine.play(100_000);
      expect(playedState.status).toBe('running');

      const { state: tickedState } = engine.tick(102_000); // 2s later
      expect(tickedState.elapsedTotal).toBe(17);
      expect(tickedState.currentIntervalIndex).toBe(1);
      expect(tickedState.elapsedInInterval).toBe(7);
    });

    it('getState() after restore() reflects the restored snapshot (not stale idle-at-zero data)', () => {
      const engine = createTimerEngine(makeSyntheticWorkout());
      engine.restore({ elapsedTotal: 15, powerAdjustPct: 0, status: 'paused' });
      expect(engine.getState().elapsedTotal).toBe(15);
    });
  });
});
