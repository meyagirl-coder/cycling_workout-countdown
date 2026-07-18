import { describe, expect, it, vi } from 'vitest';
import { formatDurationLabel, formatMMSS } from '../src/ui/formatTime.js';
import { buildTimelineSegments, computeCursorPct } from '../src/ui/timelineSegments.js';
import { createPlayerView } from '../src/ui/renderPlayer.js';

function makeWorkout() {
  return {
    id: 'ui-test-workout',
    name: 'UI Test Workout',
    source: 'zwo',
    totalDuration: 50,
    intervals: [
      { type: 'warmup', duration: 12, powerStart: 50, powerEnd: 70, cadence: null },
      { type: 'steady', duration: 10, powerStart: 88, powerEnd: 88, cadence: 90 },
      { type: 'freeride', duration: 8, powerStart: null, powerEnd: null, cadence: null },
      { type: 'cooldown', duration: 20, powerStart: 70, powerEnd: 50, cadence: null },
    ],
  };
}

function makeIdleState(overrides = {}) {
  return {
    status: 'idle',
    currentIntervalIndex: 0,
    elapsedInInterval: 0,
    elapsedTotal: 0,
    powerAdjustPct: 0,
    startTimestamp: null,
    ...overrides,
  };
}

describe('formatMMSS', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [600, '10:00'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatMMSS(seconds)).toBe(expected);
  });

  it('clamps negative values to 0:00', () => {
    expect(formatMMSS(-5)).toBe('0:00');
  });
});

describe('formatDurationLabel', () => {
  it('omits the hour component under an hour', () => {
    expect(formatDurationLabel(90)).toBe('1:30');
  });

  it('includes hours once the duration reaches an hour', () => {
    expect(formatDurationLabel(3661)).toBe('1:01:01');
  });
});

describe('buildTimelineSegments', () => {
  it('computes proportional start/width and zone colors per interval, null color for freeride', () => {
    const segments = buildTimelineSegments(makeWorkout());

    expect(segments).toHaveLength(4);
    expect(segments[0]).toMatchObject({ type: 'warmup', startPct: 0, widthPct: 24 }); // 12/50
    expect(segments[1]).toMatchObject({ type: 'steady', startPct: 24, widthPct: 20 }); // 10/50
    expect(segments[1].color).toBe('green'); // 88% FTP -> Z3
    expect(segments[2]).toMatchObject({ type: 'freeride', startPct: 44, widthPct: 16, color: null });
    expect(segments[3]).toMatchObject({ type: 'cooldown', startPct: 60, widthPct: 40 });
  });
});

describe('computeCursorPct', () => {
  it('maps elapsed/total to a 0-100 percentage, clamped at the edges', () => {
    expect(computeCursorPct(0, 50)).toBe(0);
    expect(computeCursorPct(25, 50)).toBe(50);
    expect(computeCursorPct(999, 50)).toBe(100);
    expect(computeCursorPct(10, 0)).toBe(0);
  });
});

describe('createPlayerView', () => {
  it('renders workout name, total duration, and interval progress', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createPlayerView(root, { onPlayPause: vi.fn(), onSkip: vi.fn(), onRedo: vi.fn(), onStop: vi.fn() });

    view.update(makeWorkout(), makeIdleState(), 200);

    expect(root.querySelector('.workout-name').textContent).toBe('UI Test Workout');
    expect(root.querySelector('.total-duration').textContent).toContain('0:50');
    expect(root.querySelector('.interval-progress').textContent).toContain('第 1 / 4 組');
  });

  it('shows the countdown and target watt for a steady segment', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createPlayerView(root, { onPlayPause: vi.fn(), onSkip: vi.fn(), onRedo: vi.fn(), onStop: vi.fn() });

    const state = makeIdleState({ status: 'running', currentIntervalIndex: 1, elapsedInInterval: 4, elapsedTotal: 16 });
    view.update(makeWorkout(), state, 200);

    expect(root.querySelector('.countdown-number').textContent).toBe('0:06'); // 10 - 4
    expect(root.querySelector('.target-watt').textContent).toBe('176 W'); // 200 * 0.88
    expect(root.querySelector('.target-pct').textContent).toBe('88% FTP');
    expect(root.querySelector('.play-pause-btn')).toBeNull(); // sanity: no stray selector typo
    expect(root.querySelector('.btn-play-pause').textContent).toContain('暫停');
  });

  it('hides the target watt for freeride segments', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createPlayerView(root, { onPlayPause: vi.fn(), onSkip: vi.fn(), onRedo: vi.fn(), onStop: vi.fn() });

    const state = makeIdleState({ status: 'running', currentIntervalIndex: 2, elapsedInInterval: 2, elapsedTotal: 34 });
    view.update(makeWorkout(), state, 200);

    expect(root.querySelector('.target-watt').textContent).toBe('自由騎乘');
    expect(root.querySelector('.target-pct').textContent).toBe('');
    expect(root.querySelector('.status-panel').className).toContain('zone-none');
  });

  it('disables controls and shows the finished banner once the workout is finished', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createPlayerView(root, { onPlayPause: vi.fn(), onSkip: vi.fn(), onRedo: vi.fn(), onStop: vi.fn() });

    const state = makeIdleState({ status: 'finished', currentIntervalIndex: 3, elapsedInInterval: 20, elapsedTotal: 50 });
    view.update(makeWorkout(), state, 200);

    expect(root.querySelector('.btn-play-pause').disabled).toBe(true);
    expect(root.querySelector('.btn-skip').disabled).toBe(true);
    expect(root.querySelector('.btn-redo').disabled).toBe(true);
    expect(root.querySelector('.btn-stop').disabled).toBe(true);
    expect(root.querySelector('.finished-banner').classList.contains('hidden')).toBe(false);
  });

  it('wires button clicks to the provided handlers', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = { onPlayPause: vi.fn(), onSkip: vi.fn(), onRedo: vi.fn(), onStop: vi.fn() };
    const view = createPlayerView(root, handlers);
    view.update(makeWorkout(), makeIdleState(), 200);

    root.querySelector('.btn-play-pause').click();
    root.querySelector('.btn-skip').click();
    root.querySelector('.btn-redo').click();
    root.querySelector('.btn-stop').click();

    expect(handlers.onPlayPause).toHaveBeenCalledTimes(1);
    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
    expect(handlers.onRedo).toHaveBeenCalledTimes(1);
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
  });
});
