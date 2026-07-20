import { describe, expect, it, vi } from 'vitest';
import { TIMER_EVENTS } from '../src/engine/timerEngine.js';
import { COUNTDOWN_SPEECH_TEXT, handleTimerEvents } from '../src/ui/countdownAlerts.js';

function makeWorkout() {
  return {
    id: 'alerts-test-workout',
    name: 'Alerts Test Workout',
    source: 'zwo',
    totalDuration: 50,
    intervals: [
      { type: 'warmup', duration: 12, powerStart: 50, powerEnd: 70, cadence: null },
      { type: 'steady', duration: 20, powerStart: 88, powerEnd: 88, cadence: 90 },
      { type: 'freeride', duration: 10, powerStart: null, powerEnd: null, cadence: null },
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

describe('handleTimerEvents', () => {
  it('plays a beep and speaks the countdown warning exactly once on countdownWarning', () => {
    const deps = makeDeps();
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledWith(COUNTDOWN_SPEECH_TEXT);
    expect(deps.showNextIntervalBanner).not.toHaveBeenCalled();
  });

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
    handleTimerEvents([TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：自由騎乘 · 0:10');
  });

  it('handles both a countdown warning and an interval change if they arrive together', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING, TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
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
