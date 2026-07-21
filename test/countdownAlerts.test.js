import { describe, expect, it, vi } from 'vitest';
import { TIMER_EVENTS } from '../src/engine/timerEngine.js';
import { COUNTDOWN_FINISHING_SOON_TEXT, handleTimerEvents } from '../src/ui/countdownAlerts.js';

function makeWorkout() {
  return {
    id: 'alerts-test-workout',
    name: 'Alerts Test Workout',
    source: 'zwo',
    totalDuration: 57,
    intervals: [
      { type: 'warmup', duration: 12, powerStart: 50, powerEnd: 70, cadence: null },
      { type: 'steady', duration: 20, powerStart: 88, powerEnd: 88, cadence: 90 },
      { type: 'freeride', duration: 10, powerStart: null, powerEnd: null, cadence: null },
      { type: 'cooldown', duration: 15, powerStart: 60, powerEnd: 40, cadence: null },
    ],
  };
}

function makeState(overrides = {}) {
  return {
    status: 'running',
    currentIntervalIndex: 0,
    elapsedInInterval: 0,
    elapsedTotal: 0,
    powerAdjustPct: 0,
    startTimestamp: null,
    ...overrides,
  };
}

function makeDeps() {
  return { playBeep: vi.fn(), speak: vi.fn(), showNextIntervalBanner: vi.fn() };
}

describe('handleTimerEvents: countdownWarning (10 seconds before the CURRENT interval ends)', () => {
  it('plays a beep and shows/speaks a preview of the upcoming steady interval (duration + %FTP)', () => {
    const deps = makeDeps();
    // currentIntervalIndex 0 (warmup) is about to end; the upcoming interval is index 1 (steady, 88%)
    const state = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：20 秒 · 88% FTP');
    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledWith('10 秒後進入下一組，88% FTP，持續 20 秒');
  });

  it('matches the "下一組：5 分鐘 · 75% FTP" example format for a minute-scale steady interval', () => {
    const deps = makeDeps();
    const workout = {
      ...makeWorkout(),
      intervals: [
        { type: 'steady', duration: 60, powerStart: 50, powerEnd: 50, cadence: null },
        { type: 'steady', duration: 300, powerStart: 75, powerEnd: 75, cadence: null },
      ],
    };
    const state = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout, state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：5 分鐘 · 75% FTP');
  });

  it('shows a "XX% -> YY% FTP" range (not a single number) when the upcoming interval ramps', () => {
    const deps = makeDeps();
    // currentIntervalIndex 2 (freeride) is about to end; upcoming is index 3 (cooldown, 60% -> 40%)
    const state = makeState({ currentIntervalIndex: 2 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：15 秒 · 60% → 40% FTP');
    expect(deps.speak).toHaveBeenCalledWith('10 秒後進入下一組，60% 到 40% FTP，持續 15 秒');
  });

  it('applies the user\'s power adjustment to the previewed percentage', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 0, powerAdjustPct: 5 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：20 秒 · 93% FTP');
  });

  it('shows "自由騎乘" with no percentage when the upcoming interval is freeride', () => {
    const deps = makeDeps();
    // currentIntervalIndex 1 (steady) is about to end; upcoming is index 2 (freeride)
    const state = makeState({ currentIntervalIndex: 1 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：自由騎乘 · 10 秒');
    expect(deps.speak).toHaveBeenCalledWith('10 秒後進入下一組，自由騎乘，持續 10 秒');
  });

  it('shows "即將完成" instead of a nonexistent next interval when the CURRENT interval is the last one', () => {
    const deps = makeDeps();
    // currentIntervalIndex 3 (cooldown) is the last interval - there is no "next" interval
    const state = makeState({ currentIntervalIndex: 3 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith(COUNTDOWN_FINISHING_SOON_TEXT);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('即將完成');
    expect(deps.speak).toHaveBeenCalledWith('10 秒後即將完成');
  });
});

describe('handleTimerEvents: intervalChanged (unchanged existing format: mm:ss + watts)', () => {
  it('shows the next-interval banner with duration/%FTP/watts on intervalChanged', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
    expect(deps.playBeep).not.toHaveBeenCalled();
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it('shows a banner without wattage for a freeride segment', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 2, elapsedInInterval: 0, elapsedTotal: 32 });
    handleTimerEvents([TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ...deps, ftp: 200 });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：自由騎乘 · 0:10');
  });
});

describe('handleTimerEvents: multiple events in the same batch', () => {
  it('handles both a countdown warning and an interval change if they arrive together (interval-changed banner wins, shown last)', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING, TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    // both the countdown preview and the interval-changed banner fire; the last call is what's visible
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(2);
    expect(deps.showNextIntervalBanner).toHaveBeenLastCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
  });

  it('does nothing for workoutFinished or an empty event list', () => {
    const deps = makeDeps();
    handleTimerEvents([TIMER_EVENTS.WORKOUT_FINISHED], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });
    handleTimerEvents([], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });

    expect(deps.playBeep).not.toHaveBeenCalled();
    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.showNextIntervalBanner).not.toHaveBeenCalled();
  });
});
