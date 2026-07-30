import { describe, expect, it } from 'vitest';
import { buildWorkoutSummaryText } from '../src/ui/workoutSummaryText.js';

function iv(overrides) {
  return { type: 'steady', duration: 60, powerStart: 60, powerEnd: 60, cadence: null, ...overrides };
}

describe('buildWorkoutSummaryText', () => {
  it('reproduces the user-provided reference example exactly: header + flat segment + repeat block + flat segment', () => {
    const workout = {
      totalDuration: 10 * 60 + 6 * (2 * 60 + 4 * 60) + 20 * 60,
      intervals: [
        iv({ duration: 10 * 60, powerStart: 50, powerEnd: 50 }),
        ...Array.from({ length: 6 }, () => [
          iv({ duration: 2 * 60, powerStart: 120, powerEnd: 120 }),
          iv({ duration: 4 * 60, powerStart: 50, powerEnd: 50 }),
        ]).flat(),
        iv({ duration: 20 * 60, powerStart: 70, powerEnd: 70 }),
      ],
    };

    const text = buildWorkoutSummaryText(workout, 100);

    expect(text).toBe(['Duration: 1h 6m', '10 min @ 50w', '6X (2 min @ 120w | 4 min @ 50w)', '20 min @ 70w'].join('\n'));
  });

  it('shows a single flat wattage for a plain steady interval (start === end)', () => {
    const workout = { totalDuration: 300, intervals: [iv({ duration: 300, powerStart: 65, powerEnd: 65 })] };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 5m\n5 min @ 130w');
  });

  it('shows a "start -> end" arrow for a ramp-shaped interval (start !== end), distinct from the band dash', () => {
    const workout = { totalDuration: 600, intervals: [iv({ type: 'ramp', duration: 600, powerStart: 50, powerEnd: 100 })] };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 10m\n10 min @ 100w → 200w');
  });

  it('shows the full wattage range (not a single midpoint number) for a "區間目標" band interval, reusing computeBandTarget()', () => {
    const workout = {
      totalDuration: 300,
      intervals: [iv({ duration: 300, powerStart: 70, powerEnd: 70, powerRangeLow: 65, powerRangeHigh: 75 })],
    };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 5m\n5 min @ 130-150w');
  });

  it('shows the band range correctly regardless of which raw attribute (low/high) is numerically larger', () => {
    const workout = {
      totalDuration: 300,
      intervals: [iv({ duration: 300, powerStart: 70, powerEnd: 70, powerRangeLow: 75, powerRangeHigh: 65 })],
    };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 5m\n5 min @ 130-150w');
  });

  it('labels a freeride interval distinctly, with no wattage', () => {
    const workout = { totalDuration: 300, intervals: [iv({ type: 'freeride', duration: 300, powerStart: null, powerEnd: null })] };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 5m\n5 min free ride');
  });

  it('formats sub-minute durations in seconds, and non-whole-minute durations as decimal minutes', () => {
    const workout = {
      totalDuration: 30 + 90,
      intervals: [iv({ duration: 30, powerStart: 100, powerEnd: 100 }), iv({ duration: 90, powerStart: 100, powerEnd: 100 })],
    };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 2m\n30 sec @ 200w\n1.5 min @ 200w');
  });

  it('collapses a single repeated line (not just multi-line blocks) into an Nx group', () => {
    const workout = {
      totalDuration: 60 * 4,
      intervals: Array.from({ length: 4 }, () => iv({ duration: 60, powerStart: 90, powerEnd: 90 })),
    };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 4m\n4X (1 min @ 180w)');
  });

  it('does not merge two different single-line segments into a bogus repeat group', () => {
    const workout = {
      totalDuration: 120,
      intervals: [iv({ duration: 60, powerStart: 50, powerEnd: 50 }), iv({ duration: 60, powerStart: 90, powerEnd: 90 })],
    };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 2m\n1 min @ 100w\n1 min @ 180w');
  });

  it('prefers the smaller repeat unit when a larger block would cover the exact same lines (4X (A|B) over 2X (A|B|A|B))', () => {
    const a = iv({ duration: 60, powerStart: 50, powerEnd: 50 });
    const b = iv({ duration: 120, powerStart: 90, powerEnd: 90 });
    const workout = { totalDuration: (60 + 120) * 4, intervals: [a, b, a, b, a, b, a, b] };
    expect(buildWorkoutSummaryText(workout, 200)).toBe('Duration: 12m\n4X (1 min @ 100w | 2 min @ 180w)');
  });

  it('detects a repeat block in the middle while leaving distinct warmup/cooldown segments before and after untouched', () => {
    const warmup = iv({ type: 'warmup', duration: 300, powerStart: 40, powerEnd: 60 });
    const work = iv({ duration: 60, powerStart: 110, powerEnd: 110 });
    const rest = iv({ duration: 30, powerStart: 50, powerEnd: 50 });
    const cooldown = iv({ type: 'cooldown', duration: 300, powerStart: 60, powerEnd: 40 });
    const totalDuration = 300 + (60 + 30) * 3 + 300;
    const workout = { totalDuration, intervals: [warmup, work, rest, work, rest, work, rest, cooldown] };

    const text = buildWorkoutSummaryText(workout, 200);
    expect(text).toBe(
      [`Duration: ${formatExpectedHeader(totalDuration)}`, '5 min @ 80w → 120w', '3X (1 min @ 220w | 30 sec @ 100w)', '5 min @ 120w → 80w'].join('\n')
    );
  });

  it('applies adjustPct (power adjustment) consistently to plain, ramp, and band wattages', () => {
    const workout = {
      totalDuration: 600,
      intervals: [
        iv({ duration: 300, powerStart: 100, powerEnd: 100 }),
        iv({ duration: 300, powerStart: 100, powerEnd: 100, powerRangeLow: 90, powerRangeHigh: 110 }),
      ],
    };
    expect(buildWorkoutSummaryText(workout, 200, 10)).toBe('Duration: 10m\n5 min @ 220w\n5 min @ 200-240w');
  });
});

function formatExpectedHeader(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.length > 0 ? parts.join(' ') : '0s';
}
