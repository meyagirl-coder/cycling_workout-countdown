import { describe, expect, it, vi } from 'vitest';
import { createScheduledStartRuntime, formatRemainingLabel } from '../src/ui/scheduledStartRuntime.js';

describe('formatRemainingLabel', () => {
  it('formats under an hour as mm:ss, matching the execution page\'s countdown format (formatMMSS, unpadded minutes)', () => {
    expect(formatRemainingLabel(5 * 60 * 1000 + 32 * 1000)).toBe('距離開始還有 5:32');
  });

  it('shows seconds-level precision (not rounded to the nearest minute)', () => {
    expect(formatRemainingLabel(45 * 1000)).toBe('距離開始還有 0:45');
    expect(formatRemainingLabel(90 * 1000)).toBe('距離開始還有 1:30');
  });

  it('shows "0:00" (not a vague "under a minute" message) when time is up or has passed', () => {
    expect(formatRemainingLabel(0)).toBe('距離開始還有 0:00');
  });

  it('clamps a negative remaining time to 0:00 rather than a negative label', () => {
    expect(formatRemainingLabel(-5000)).toBe('距離開始還有 0:00');
  });

  it('adds "X 小時" in front of mm:ss once an hour or more remains, with mm:ss reset to the remainder within that hour (not an unbounded minute count)', () => {
    const twoHoursFiveMinutesThirty = ((2 * 60 + 5) * 60 + 30) * 1000;
    expect(formatRemainingLabel(twoHoursFiveMinutesThirty)).toBe('距離開始還有 2 小時 5:30');
  });

  it('formats exactly one hour with zero extra minutes/seconds', () => {
    expect(formatRemainingLabel(60 * 60 * 1000)).toBe('距離開始還有 1 小時 0:00');
  });

  it('adds "X 天 Y 小時" in front of mm:ss once a day or more remains', () => {
    const twoDaysThreeHoursFiveMinutesThirty = ((2 * 24 + 3) * 60 * 60 + 5 * 60 + 30) * 1000;
    expect(formatRemainingLabel(twoDaysThreeHoursFiveMinutesThirty)).toBe('距離開始還有 2 天 3 小時 5:30');
  });

  it('formats exactly one day with zero extra hours/minutes/seconds', () => {
    expect(formatRemainingLabel(24 * 60 * 60 * 1000)).toBe('距離開始還有 1 天 0 小時 0:00');
  });
});

describe('createScheduledStartRuntime: live countdown updates', () => {
  it('calls onTick immediately on start() with the initial remaining time, without waiting for the first interval', () => {
    const now = vi.fn(() => 1_000_000);
    const onTick = vi.fn();
    const onReached = vi.fn();
    const setIntervalFn = vi.fn();

    const runtime = createScheduledStartRuntime({
      startTimestamp: 1_000_000 + 5 * 60 * 1000,
      now,
      setIntervalFn,
      clearIntervalFn: vi.fn(),
      onTick,
      onReached,
    });
    runtime.start();

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith(5 * 60 * 1000);
    expect(onReached).not.toHaveBeenCalled();
  });

  it('calls onTick again on each subsequent tick with the recalculated (shrinking) remaining time', () => {
    let currentTime = 1_000_000;
    const now = () => currentTime;
    const onTick = vi.fn();
    let tickCallback = null;
    const setIntervalFn = vi.fn((cb) => {
      tickCallback = cb;
      return 1;
    });

    const runtime = createScheduledStartRuntime({
      startTimestamp: 1_000_000 + 3 * 60 * 1000,
      now,
      setIntervalFn,
      clearIntervalFn: vi.fn(),
      tickIntervalMs: 1000,
      onTick,
      onReached: vi.fn(),
    });
    runtime.start();
    expect(onTick).toHaveBeenLastCalledWith(3 * 60 * 1000);

    currentTime += 60 * 1000; // 1 minute passes
    tickCallback();
    expect(onTick).toHaveBeenLastCalledWith(2 * 60 * 1000);

    currentTime += 60 * 1000; // another minute passes
    tickCallback();
    expect(onTick).toHaveBeenLastCalledWith(1 * 60 * 1000);
  });

  it('recalculates from now() rather than counting ticks, so a late-firing tick (background-tab throttling) still reports the correct remaining time', () => {
    let currentTime = 0;
    const now = () => currentTime;
    const onTick = vi.fn();
    let tickCallback = null;
    const setIntervalFn = vi.fn((cb) => {
      tickCallback = cb;
      return 1;
    });

    const runtime = createScheduledStartRuntime({
      startTimestamp: 10 * 60 * 1000,
      now,
      setIntervalFn,
      clearIntervalFn: vi.fn(),
      onTick,
      onReached: vi.fn(),
    });
    runtime.start();

    // Simulate a background tab: 8 minutes actually elapse before the throttled
    // setInterval finally fires once, instead of firing every second as configured.
    currentTime = 8 * 60 * 1000;
    tickCallback();
    expect(onTick).toHaveBeenLastCalledWith(2 * 60 * 1000);
  });
});

describe('createScheduledStartRuntime: auto-trigger when the scheduled time arrives', () => {
  it('calls onReached (not onTick) once remainingMs reaches zero or below, and stops ticking', () => {
    let currentTime = 0;
    const now = () => currentTime;
    const onTick = vi.fn();
    const onReached = vi.fn();
    const clearIntervalFn = vi.fn();
    let tickCallback = null;
    const setIntervalFn = vi.fn((cb) => {
      tickCallback = cb;
      return 42;
    });

    const runtime = createScheduledStartRuntime({
      startTimestamp: 5000,
      now,
      setIntervalFn,
      clearIntervalFn,
      onTick,
      onReached,
    });
    runtime.start();
    expect(onReached).not.toHaveBeenCalled();

    currentTime = 5000; // exactly the scheduled time
    tickCallback();

    expect(onReached).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith(42);
    expect(runtime.isRunning()).toBe(false);
  });

  it('fires immediately on start() (no waiting for a tick) when the scheduled time has already passed', () => {
    const now = () => 10_000;
    const onTick = vi.fn();
    const onReached = vi.fn();
    const clearIntervalFn = vi.fn();

    const runtime = createScheduledStartRuntime({
      startTimestamp: 5_000, // 5 seconds in the past
      now,
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn,
      onTick,
      onReached,
    });
    runtime.start();

    expect(onReached).toHaveBeenCalledTimes(1);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('does not call onTick again after onReached has fired', () => {
    let currentTime = 0;
    const now = () => currentTime;
    const onTick = vi.fn();
    const onReached = vi.fn();
    let tickCallback = null;
    const setIntervalFn = vi.fn((cb) => {
      tickCallback = cb;
      return 1;
    });

    const runtime = createScheduledStartRuntime({
      startTimestamp: 5000,
      now,
      setIntervalFn,
      clearIntervalFn: vi.fn(),
      onTick,
      onReached,
    });
    runtime.start();

    currentTime = 6000; // past the scheduled time
    tickCallback();
    expect(onReached).toHaveBeenCalledTimes(1);

    // even if something were to call the (now-cleared) interval callback again,
    // stop() already nulled out the interval id - isRunning() reflects that.
    expect(runtime.isRunning()).toBe(false);
  });
});

describe('createScheduledStartRuntime: stop() and double-start guards', () => {
  it('stop() clears the interval and isRunning() becomes false', () => {
    const clearIntervalFn = vi.fn();
    const runtime = createScheduledStartRuntime({
      startTimestamp: 999999999999,
      now: () => 0,
      setIntervalFn: vi.fn(() => 7),
      clearIntervalFn,
      onTick: vi.fn(),
      onReached: vi.fn(),
    });
    runtime.start();
    expect(runtime.isRunning()).toBe(true);

    runtime.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(7);
    expect(runtime.isRunning()).toBe(false);
  });

  it('calling start() twice does not register a second interval', () => {
    const setIntervalFn = vi.fn(() => 1);
    const runtime = createScheduledStartRuntime({
      startTimestamp: 999999999999,
      now: () => 0,
      setIntervalFn,
      clearIntervalFn: vi.fn(),
      onTick: vi.fn(),
      onReached: vi.fn(),
    });
    runtime.start();
    runtime.start();

    expect(setIntervalFn).toHaveBeenCalledTimes(1);
  });

  it('calling stop() when not running does nothing (no error, clearIntervalFn not called)', () => {
    const clearIntervalFn = vi.fn();
    const runtime = createScheduledStartRuntime({
      startTimestamp: 999999999999,
      now: () => 0,
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn,
      onTick: vi.fn(),
      onReached: vi.fn(),
    });
    runtime.stop();
    expect(clearIntervalFn).not.toHaveBeenCalled();
  });
});
