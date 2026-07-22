import { describe, expect, it } from 'vitest';
import { clearSchedule, loadSchedule, saveSchedule } from '../src/ui/scheduleStore.js';

/** Minimal in-memory Storage stand-in, same pattern as ftpStore.test.js's fake storage */
function makeFakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const SAMPLE_WORKOUT = {
  id: 'schedule-test-workout',
  name: 'Group Ride',
  source: 'paste-percent',
  totalDuration: 1800,
  intervals: [{ type: 'steady', duration: 1800, powerStart: 70, powerEnd: 70, cadence: null }],
};

describe('scheduleStore', () => {
  it('round-trips a saved schedule (workout + startTimestamp) through loadSchedule', () => {
    const storage = makeFakeStorage();
    const startTimestamp = Date.parse('2026-07-24T20:00:00');

    saveSchedule(SAMPLE_WORKOUT, startTimestamp, storage);
    const loaded = loadSchedule(storage);

    expect(loaded).toEqual({ workout: SAMPLE_WORKOUT, startTimestamp });
  });

  it('returns null when nothing has been saved yet', () => {
    const storage = makeFakeStorage();
    expect(loadSchedule(storage)).toBeNull();
  });

  it('clearSchedule removes the saved schedule so loadSchedule returns null afterward', () => {
    const storage = makeFakeStorage();
    saveSchedule(SAMPLE_WORKOUT, Date.now() + 60000, storage);
    expect(loadSchedule(storage)).not.toBeNull();

    clearSchedule(storage);
    expect(loadSchedule(storage)).toBeNull();
  });

  it('overwrites a previously saved schedule with the newest saveSchedule call', () => {
    const storage = makeFakeStorage();
    saveSchedule(SAMPLE_WORKOUT, 1000, storage);
    const secondWorkout = { ...SAMPLE_WORKOUT, name: 'Second Workout' };
    saveSchedule(secondWorkout, 2000, storage);

    const loaded = loadSchedule(storage);
    expect(loaded.workout.name).toBe('Second Workout');
    expect(loaded.startTimestamp).toBe(2000);
  });

  it('returns null instead of throwing when the stored value is corrupted JSON', () => {
    const storage = makeFakeStorage();
    storage.setItem('scheduled_workout', 'not valid json {{{');
    expect(loadSchedule(storage)).toBeNull();
  });

  it('returns null when the stored value is valid JSON but missing required fields', () => {
    const storage = makeFakeStorage();
    storage.setItem('scheduled_workout', JSON.stringify({ workout: SAMPLE_WORKOUT })); // no startTimestamp
    expect(loadSchedule(storage)).toBeNull();

    storage.setItem('scheduled_workout', JSON.stringify({ startTimestamp: 1000 })); // no workout
    expect(loadSchedule(storage)).toBeNull();
  });

  it('returns null when startTimestamp is not a finite number', () => {
    const storage = makeFakeStorage();
    storage.setItem('scheduled_workout', JSON.stringify({ workout: SAMPLE_WORKOUT, startTimestamp: 'not a number' }));
    expect(loadSchedule(storage)).toBeNull();

    storage.setItem('scheduled_workout', JSON.stringify({ workout: SAMPLE_WORKOUT, startTimestamp: NaN }));
    expect(loadSchedule(storage)).toBeNull();
  });

  it('defaults to window.localStorage when no storage is passed (real-browser usage)', () => {
    window.localStorage.clear();
    const startTimestamp = Date.now() + 3600000;
    saveSchedule(SAMPLE_WORKOUT, startTimestamp);
    expect(loadSchedule()).toEqual({ workout: SAMPLE_WORKOUT, startTimestamp });
    clearSchedule();
    expect(loadSchedule()).toBeNull();
  });
});
