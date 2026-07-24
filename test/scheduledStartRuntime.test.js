import { describe, expect, it, vi } from 'vitest';
import { createScheduledStartRuntime, formatRemainingLabel } from '../src/ui/scheduledStartRuntime.js';

describe('formatRemainingLabel', () => {
  it('formats under a minute as just seconds', () => {
    expect(formatRemainingLabel(45 * 1000)).toBe('距離開始還有 45秒');
  });

  it('formats under an hour as X分Y秒', () => {
    expect(formatRemainingLabel(3 * 60 * 1000 + 10 * 1000)).toBe('距離開始還有 3分10秒');
  });

  it('formats under a day as X小時Y分Z秒, matching the example format exactly', () => {
    const threeHoursTwoMinutesTenSeconds = (3 * 3600 + 2 * 60 + 10) * 1000;
    expect(formatRemainingLabel(threeHoursTwoMinutesTenSeconds)).toBe('距離開始還有 3小時2分10秒');
  });

  it('formats a day or more as X天Y小時Z分W秒', () => {
    const twoDaysThreeHoursTwoMinutesTenSeconds = (2 * 86400 + 3 * 3600 + 2 * 60 + 10) * 1000;
    expect(formatRemainingLabel(twoDaysThreeHoursTwoMinutesTenSeconds)).toBe('距離開始還有 2天3小時2分10秒');
  });

  it('shows seconds-level precision (not rounded to the nearest minute)', () => {
    expect(formatRemainingLabel(90 * 1000)).toBe('距離開始還有 1分30秒');
  });

  it('shows "0秒" (not a vague "under a minute" message) when time is up or has passed', () => {
    expect(formatRemainingLabel(0)).toBe('距離開始還有 0秒');
  });

  it('clamps a negative remaining time to 0秒 rather than a negative label', () => {
    expect(formatRemainingLabel(-5000)).toBe('距離開始還有 0秒');
  });

  it('does not skip intermediate units once a larger unit is present, even if they are zero', () => {
    expect(formatRemainingLabel(60 * 60 * 1000)).toBe('距離開始還有 1小時0分0秒');
    expect(formatRemainingLabel(24 * 60 * 60 * 1000)).toBe('距離開始還有 1天0小時0分0秒');
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
