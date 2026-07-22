import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearWorkoutProgress, loadWorkoutProgress, saveWorkoutProgress } from '../src/ui/workoutProgressStore.js';

/** Minimal fake Storage so tests don't depend on/leak into a shared localStorage instance. */
function makeFakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

function makeWorkout(overrides = {}) {
  return {
    id: 'progress-test-workout',
    name: 'Progress Test',
    source: 'zwo',
    totalDuration: 1800,
    intervals: [
      { type: 'steady', duration: 900, powerStart: 60, powerEnd: 60, cadence: null },
      { type: 'steady', duration: 900, powerStart: 80, powerEnd: 80, cadence: null },
    ],
    ...overrides,
  };
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

describe('loadWorkoutProgress', () => {
  it('returns null when nothing has been saved yet', () => {
    expect(loadWorkoutProgress(makeFakeStorage())).toBeNull();
  });

  it('round-trips the workout, elapsedTotal, powerAdjustPct, and status through saveWorkoutProgress', () => {
    const storage = makeFakeStorage();
    const workout = makeWorkout();
    saveWorkoutProgress(workout, { elapsedTotal: 450, powerAdjustPct: 2, status: 'paused' }, storage);

    expect(loadWorkoutProgress(storage)).toEqual({ workout, elapsedTotal: 450, powerAdjustPct: 2, status: 'paused' });
  });

  it('round-trips a "running" status as-is (playerApp.js is responsible for treating it as paused on restore)', () => {
    const storage = makeFakeStorage();
    saveWorkoutProgress(makeWorkout(), { elapsedTotal: 30, powerAdjustPct: 0, status: 'running' }, storage);
    expect(loadWorkoutProgress(storage).status).toBe('running');
  });

  it('defaults powerAdjustPct to 0 and status to "paused" when missing from a corrupted/older payload', () => {
    const storage = makeFakeStorage({
      workout_progress: JSON.stringify({ workout: makeWorkout(), elapsedTotal: 100, savedAtDate: todayString() }),
    });
    expect(loadWorkoutProgress(storage)).toEqual({ workout: makeWorkout(), elapsedTotal: 100, powerAdjustPct: 0, status: 'paused' });
  });

  it('returns null for corrupted JSON', () => {
    expect(loadWorkoutProgress(makeFakeStorage({ workout_progress: 'not json' }))).toBeNull();
  });

  it('returns null when workout is missing or not an object', () => {
    const storage = makeFakeStorage({
      workout_progress: JSON.stringify({ elapsedTotal: 100, savedAtDate: todayString() }),
    });
    expect(loadWorkoutProgress(storage)).toBeNull();
  });

  it('returns null when elapsedTotal is missing, non-numeric, or negative', () => {
    expect(
      loadWorkoutProgress(makeFakeStorage({ workout_progress: JSON.stringify({ workout: makeWorkout(), savedAtDate: todayString() }) }))
    ).toBeNull();
    expect(
      loadWorkoutProgress(
        makeFakeStorage({ workout_progress: JSON.stringify({ workout: makeWorkout(), elapsedTotal: 'nope', savedAtDate: todayString() }) })
      )
    ).toBeNull();
    expect(
      loadWorkoutProgress(
        makeFakeStorage({ workout_progress: JSON.stringify({ workout: makeWorkout(), elapsedTotal: -5, savedAtDate: todayString() }) })
      )
    ).toBeNull();
  });

  it('returns null when the saved payload is not from today (expired)', () => {
    const storage = makeFakeStorage({
      workout_progress: JSON.stringify({ workout: makeWorkout(), elapsedTotal: 100, savedAtDate: '2000-01-01' }),
    });
    expect(loadWorkoutProgress(storage)).toBeNull();
  });
});

describe('clearWorkoutProgress', () => {
  it('removes the stored progress so a subsequent load returns null', () => {
    const storage = makeFakeStorage();
    saveWorkoutProgress(makeWorkout(), { elapsedTotal: 10, powerAdjustPct: 0, status: 'paused' }, storage);
    clearWorkoutProgress(storage);
    expect(loadWorkoutProgress(storage)).toBeNull();
  });
});

describe('saveWorkoutProgress: real window.localStorage smoke test (default storage argument)', () => {
  afterEach(() => {
    window.localStorage.removeItem('workout_progress');
  });

  it('saves and loads against the real localStorage when no storage argument is given', () => {
    const workout = makeWorkout();
    saveWorkoutProgress(workout, { elapsedTotal: 300, powerAdjustPct: -1, status: 'paused' });
    expect(loadWorkoutProgress()).toEqual({ workout, elapsedTotal: 300, powerAdjustPct: -1, status: 'paused' });
  });
});

describe('savedAtDate day-boundary behavior (system-clock dependent)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('progress saved "yesterday" is expired once the clock rolls over to a new day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T23:59:00'));
    const storage = makeFakeStorage();
    saveWorkoutProgress(makeWorkout(), { elapsedTotal: 100, powerAdjustPct: 0, status: 'paused' }, storage);

    vi.setSystemTime(new Date('2026-07-22T00:01:00'));
    expect(loadWorkoutProgress(storage)).toBeNull();
  });
});
