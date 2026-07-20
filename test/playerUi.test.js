import { describe, expect, it, vi } from 'vitest';
import { formatDurationLabel, formatMMSS } from '../src/ui/formatTime.js';
import { buildIntervalBoundaries, buildTimelineSegments, computeCursorPct } from '../src/ui/timelineSegments.js';
import { createPlayerView } from '../src/ui/renderPlayer.js';

function makeWorkout() {
  return {
    id: 'ui-test-workout',
    name: 'UI Test Workout',
    source: 'zwo',
    totalDuration: 50,
    intervals: [
      // 50->70 crosses the 55 boundary partway through -> 2 zone-color slices (gray then blue)
      { type: 'warmup', duration: 12, powerStart: 50, powerEnd: 70, cadence: null },
      { type: 'steady', duration: 10, powerStart: 88, powerEnd: 88, cadence: 90 },
      { type: 'freeride', duration: 8, powerStart: null, powerEnd: null, cadence: null },
      // 70->50 crosses the 55 boundary going down -> 2 zone-color slices (blue then gray)
      { type: 'cooldown', duration: 20, powerStart: 70, powerEnd: 50, cadence: null },
    ],
  };
}

/** A workout whose ramp/cooldown sweep through several Coggan zones, for slicing tests. */
function makeZoneCrossingWorkout() {
  return {
    id: 'zone-crossing-workout',
    name: 'Zone Crossing Test',
    source: 'zwo',
    totalDuration: 220,
    intervals: [
      { type: 'ramp', duration: 100, powerStart: 40, powerEnd: 80, cadence: null }, // crosses 55 and 75
      { type: 'steady', duration: 20, powerStart: 88, powerEnd: 88, cadence: 90 },
      { type: 'freeride', duration: 30, powerStart: null, powerEnd: null, cadence: null },
      { type: 'cooldown', duration: 70, powerStart: 130, powerEnd: 40, cadence: null }, // crosses 120/105/90/75/55
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
  it('splits a ramp into one slice per zone it climbs through, colored by the instantaneous %FTP, not a flat average', () => {
    const segments = buildTimelineSegments(makeZoneCrossingWorkout());
    const rampSlices = segments.filter((seg) => seg.type === 'ramp');

    // 40->80% FTP crosses the 55 and 75 boundaries, so it should read as three
    // zones (Z1 gray, Z2 blue, Z3 green), not one averaged color for the whole ramp.
    expect(rampSlices.map((s) => s.color)).toEqual(['gray', 'blue', 'green']);
    expect(rampSlices[0].startPct).toBeCloseTo(0);
    expect(rampSlices.at(-1).startPct + rampSlices.at(-1).widthPct).toBeCloseTo((100 / 220) * 100);
  });

  it('splits a descending cooldown through every zone it passes on the way down', () => {
    const segments = buildTimelineSegments(makeZoneCrossingWorkout());
    const cooldownSlices = segments.filter((seg) => seg.type === 'cooldown');

    // 130->40% FTP descends through Z6/Z5/Z4/Z3/Z2/Z1 in that order.
    expect(cooldownSlices.map((s) => s.color)).toEqual(['red', 'orange', 'yellow', 'green', 'blue', 'gray']);
  });

  it('keeps a single slice for flat (steady) segments and null-colored freeride segments', () => {
    const segments = buildTimelineSegments(makeZoneCrossingWorkout());

    const steadySlices = segments.filter((seg) => seg.type === 'steady');
    expect(steadySlices).toHaveLength(1);
    expect(steadySlices[0].color).toBe('green'); // 88% FTP -> Z3

    const freerideSlices = segments.filter((seg) => seg.type === 'freeride');
    expect(freerideSlices).toEqual([{ type: 'freeride', intervalIndex: 2, startPct: expect.any(Number), widthPct: expect.any(Number), color: null }]);
  });

  it('slices are contiguous and cover exactly 0-100% of the timeline with no gaps or overlaps', () => {
    const segments = buildTimelineSegments(makeZoneCrossingWorkout());

    expect(segments[0].startPct).toBeCloseTo(0);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startPct).toBeCloseTo(segments[i - 1].startPct + segments[i - 1].widthPct);
    }
    const last = segments.at(-1);
    expect(last.startPct + last.widthPct).toBeCloseTo(100);
  });

  it('shifts which zone a segment falls into when adjustPct is applied, matching computeCurrentTarget\'s offset', () => {
    const workout = makeZoneCrossingWorkout();
    const base = buildTimelineSegments(workout).find((seg) => seg.type === 'steady');
    expect(base.color).toBe('green'); // 88%

    const shifted = buildTimelineSegments(workout, -40).find((seg) => seg.type === 'steady');
    expect(shifted.color).toBe('gray'); // 88% - 40% = 48% -> Z1
  });

  it('produces two zone-colored slices for the simpler UI-test workout (warmup and cooldown each cross the 55% boundary once)', () => {
    const segments = buildTimelineSegments(makeWorkout());

    expect(segments).toHaveLength(6);
    const warmupSlices = segments.filter((seg) => seg.type === 'warmup');
    expect(warmupSlices.map((s) => s.color)).toEqual(['gray', 'blue']);
    const cooldownSlices = segments.filter((seg) => seg.type === 'cooldown');
    expect(cooldownSlices.map((s) => s.color)).toEqual(['blue', 'gray']);
  });
});

describe('buildIntervalBoundaries', () => {
  it('returns one boundary position per gap between intervals (n-1 for n intervals)', () => {
    const boundaries = buildIntervalBoundaries(makeWorkout());
    // interval end times: 12, 22, 30 (out of 50s total) - the final 50 isn't a boundary.
    expect(boundaries).toHaveLength(3);
    expect(boundaries[0]).toBeCloseTo(24); // 12/50
    expect(boundaries[1]).toBeCloseTo(44); // 22/50
    expect(boundaries[2]).toBeCloseTo(60); // 30/50
  });

  it('returns an empty array for a single-interval workout', () => {
    const workout = { totalDuration: 10, intervals: [{ type: 'steady', duration: 10, powerStart: 88, powerEnd: 88, cadence: null }] };
    expect(buildIntervalBoundaries(workout)).toEqual([]);
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

  it('renders a divider between every interval and multiple zone-colored slices for the warmup/cooldown ramps', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createPlayerView(root, { onPlayPause: vi.fn(), onSkip: vi.fn(), onRedo: vi.fn(), onStop: vi.fn() });

    view.update(makeWorkout(), makeIdleState(), 200);

    // 4 intervals -> 3 dividers, regardless of whether neighboring colors match.
    expect(root.querySelectorAll('.timeline-divider')).toHaveLength(3);

    // warmup (50->70%) and cooldown (70->50%) each cross the 55% boundary once,
    // so they should render as 2 segments apiece instead of one flat block.
    const segments = root.querySelectorAll('.timeline-segment');
    expect(segments).toHaveLength(6);
    const warmupSegments = Array.from(segments).filter((el) => el.title === '熱身');
    expect(warmupSegments).toHaveLength(2);
    expect(warmupSegments[0].className).toContain('zone-gray');
    expect(warmupSegments[1].className).toContain('zone-blue');
  });

  it('keeps the timeline zone colors in sync with the status-panel background as powerAdjustPct changes', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createPlayerView(root, { onPlayPause: vi.fn(), onSkip: vi.fn(), onRedo: vi.fn(), onStop: vi.fn() });

    // Parked in the steady segment (88% FTP) at the very start of it, so the
    // status panel's live zone color should equal the timeline slice under it.
    const state = makeIdleState({ status: 'running', currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    view.update(makeWorkout(), state, 200);

    const findSteadySegmentClass = () =>
      Array.from(root.querySelectorAll('.timeline-segment')).find((el) => el.title === '穩定').className;

    expect(findSteadySegmentClass()).toContain('zone-green');
    expect(root.querySelector('.status-panel').className).toContain('zone-green');

    // Dial power down by 40%: 88% - 40% = 48% FTP, which drops from Z3 (green) to Z1 (gray).
    view.update(makeWorkout(), { ...state, powerAdjustPct: -40 }, 200);

    expect(findSteadySegmentClass()).toContain('zone-gray');
    expect(root.querySelector('.status-panel').className).toContain('zone-gray');
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
