import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseSpacePercentText } from '../src/parser/spacePercentTextParser.js';
import { workoutSchema } from '../src/schema/workoutSchema.js';

const ajv = new Ajv();
const validateWorkout = ajv.compile(workoutSchema);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function expectValidWorkout(workout) {
  const valid = validateWorkout(workout);
  if (!valid) {
    throw new Error(`Workout failed schema validation: ${JSON.stringify(validateWorkout.errors, null, 2)}`);
  }
}

describe('parseSpacePercentText', () => {
  it('parses a minute line ("Xm Y%") with no @, no w, no FTP', () => {
    const workout = parseSpacePercentText('5m 50%');
    expectValidWorkout(workout);
    expect(workout.source).toBe('paste-percent');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
  });

  it('parses a second line ("Xs Y%")', () => {
    const workout = parseSpacePercentText('30s 120%');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 30, powerStart: 120, powerEnd: 120, cadence: null }]);
  });

  it('is case-insensitive for the unit letter ("5M 50%")', () => {
    const workout = parseSpacePercentText('5M 50%');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
  });

  it('terminates a "Nx" repeat block strictly at the blank line, not by line count (regression case from user report)', () => {
    // "2x" repeats "3m 50%" + "30s 120%" (2 lines), the blank line ends the block,
    // and "5m 90%" afterwards is an independent line - not part of the repeat.
    const text = ['2x', '3m 50%', '30s 120%', '', '5m 90%'].join('\n');
    const workout = parseSpacePercentText(text);

    const on = { type: 'steady', duration: 180, powerStart: 50, powerEnd: 50, cadence: null };
    const off = { type: 'steady', duration: 30, powerStart: 120, powerEnd: 120, cadence: null };
    const standalone = { type: 'steady', duration: 300, powerStart: 90, powerEnd: 90, cadence: null };

    expect(workout.intervals).toEqual([on, off, on, off, standalone]);
  });

  it('expands a "Nx" newline-repeat block the same way as pasteTextParser.js', () => {
    const workout = parseSpacePercentText(['3x', '3m 50%', '30s 120%'].join('\n'));
    const a = { type: 'steady', duration: 180, powerStart: 50, powerEnd: 50, cadence: null };
    const b = { type: 'steady', duration: 30, powerStart: 120, powerEnd: 120, cadence: null };
    expect(workout.intervals).toEqual([a, b, a, b, a, b]);
  });

  it('parses the full user-provided example and expands both "Nx" blocks correctly', () => {
    const text = [
      '5m 50%',
      '10m 75%',
      '',
      '3x',
      '3m 50%',
      '30s 120%',
      '',
      '5m 80%',
      '',
      '2x',
      '3m 50%',
      '30s 120%',
      '',
      '5m 90%',
    ].join('\n');

    const workout = parseSpacePercentText(text);
    expectValidWorkout(workout);
    expect(workout.id).toMatch(UUID_RE);

    // 2 standalone lines + 3x2 (first "3x" block) + 1 standalone + 2x2 (second "2x" block) + 1 standalone = 14
    expect(workout.intervals).toHaveLength(14);

    const warmupA = { type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null };
    const warmupB = { type: 'steady', duration: 600, powerStart: 75, powerEnd: 75, cadence: null };
    const on = { type: 'steady', duration: 180, powerStart: 50, powerEnd: 50, cadence: null };
    const off = { type: 'steady', duration: 30, powerStart: 120, powerEnd: 120, cadence: null };
    const mid = { type: 'steady', duration: 300, powerStart: 80, powerEnd: 80, cadence: null };
    const cooldown = { type: 'steady', duration: 300, powerStart: 90, powerEnd: 90, cadence: null };

    expect(workout.intervals).toEqual([
      warmupA,
      warmupB,
      on,
      off,
      on,
      off,
      on,
      off,
      mid,
      on,
      off,
      on,
      off,
      cooldown,
    ]);
    expect(workout.totalDuration).toBe(
      300 + 600 + 3 * (180 + 30) + 300 + 2 * (180 + 30) + 300 // = 3060
    );
  });

  it('throws when the input is empty or blank', () => {
    expect(() => parseSpacePercentText('')).toThrow(/non-empty string/);
    expect(() => parseSpacePercentText('   \n  ')).toThrow(/non-empty string/);
  });

  it('reports the exact line number and content of a malformed line', () => {
    const text = '5m 50%\nnot a valid line\n10m 75%';
    expect(() => parseSpacePercentText(text)).toThrow(/line 2 \("not a valid line"\)/);
  });

  it('throws a clear error when a "Nx" block has no content lines following it', () => {
    const text = ['3x', '', '5m 50%'].join('\n');
    expect(() => parseSpacePercentText(text)).toThrow(/declares a repeat but no/);
  });

  it('throws when no valid line is found at all', () => {
    expect(() => parseSpacePercentText('nothing here matches')).toThrow(/does not match the expected/);
  });

  it('does not accidentally match TrainerDay-style "X min @ Yw" lines (distinct grammar)', () => {
    expect(() => parseSpacePercentText('10 min @ 53w')).toThrow(/does not match the expected/);
  });

  it('does not accidentally match WhatsOnZwift-style "Xmin @ Y% FTP" lines (distinct grammar)', () => {
    expect(() => parseSpacePercentText('2min @ 50% FTP')).toThrow(/does not match the expected/);
  });

  describe('optional trailing "N rpm" cadence', () => {
    it('parses a standalone line with cadence ("3m 50% 90rpm")', () => {
      const workout = parseSpacePercentText('3m 50% 90rpm');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 180, powerStart: 50, powerEnd: 50, cadence: 90 }]);
    });

    it('also accepts a space before "rpm" ("3m 50% 90 rpm")', () => {
      const workout = parseSpacePercentText('3m 50% 90 rpm');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 180, powerStart: 50, powerEnd: 50, cadence: 90 }]);
    });

    it('still defaults cadence to null when rpm is omitted (no regression)', () => {
      const workout = parseSpacePercentText('3m 50%');
      expect(workout.intervals[0].cadence).toBeNull();
    });

    // 這是本次修正的重點：single line 跟「Nx」重複區塊底下的每一行，共用同一個
    // parseIntervalLine()／SPACE_PERCENT_LINE_RE（見 spacePercentTextParser.js
    // 開頭的說明），不是兩套獨立邏輯——rpm 支援理應在兩種情境下都生效。
    it('also parses cadence on every line inside a "Nx" repeat block, not just standalone lines', () => {
      const workout = parseSpacePercentText(['2x', '3m 70% 90rpm', '1m 90% 90rpm'].join('\n'));
      const on = { type: 'steady', duration: 180, powerStart: 70, powerEnd: 70, cadence: 90 };
      const off = { type: 'steady', duration: 60, powerStart: 90, powerEnd: 90, cadence: 90 };
      expect(workout.intervals).toEqual([on, off, on, off]);
    });

    it('parses the exact user-reported case: standalone rpm line + blank line + "Nx" block with rpm on every line', () => {
      const text = ['3m 50% 90rpm', '', '4x', '3m 70% 90rpm', '1m 90% 90rpm'].join('\n');
      const workout = parseSpacePercentText(text);

      const warmup = { type: 'steady', duration: 180, powerStart: 50, powerEnd: 50, cadence: 90 };
      const on = { type: 'steady', duration: 180, powerStart: 70, powerEnd: 70, cadence: 90 };
      const off = { type: 'steady', duration: 60, powerStart: 90, powerEnd: 90, cadence: 90 };

      expect(workout.intervals).toEqual([warmup, on, off, on, off, on, off, on, off]);
      expect(workout.intervals).toHaveLength(9);
      expect(workout.totalDuration).toBe(180 + 4 * (180 + 60));
    });
  });

  describe('"Y-Z%" range syntax (regression: "區間目標" - a target band to stay within, not a linear ramp - same semantics as zwoParser.js\'s SteadyState PowerLow/PowerHigh)', () => {
    it('parses "14m 65-75%" as a flat steady segment held at the midpoint (70%), with powerRangeLow/powerRangeHigh preserved for the timeline\'s two-layer band visual', () => {
      const workout = parseSpacePercentText('14m 65-75%');
      expectValidWorkout(workout);
      expect(workout.intervals).toEqual([
        { type: 'steady', duration: 840, powerStart: 70, powerEnd: 70, cadence: null, powerRangeLow: 65, powerRangeHigh: 75 },
      ]);
    });

    it('rounds a non-integer midpoint the same way as zwoParser.js (76-82% -> 79%)', () => {
      const workout = parseSpacePercentText('5m 76-82%');
      expect(workout.intervals).toEqual([
        { type: 'steady', duration: 300, powerStart: 79, powerEnd: 79, cadence: null, powerRangeLow: 76, powerRangeHigh: 82 },
      ]);
    });

    it('still supports the optional trailing "N rpm" alongside a range ("14m 65-75% 88rpm")', () => {
      const workout = parseSpacePercentText('14m 65-75% 88rpm');
      expect(workout.intervals).toEqual([
        { type: 'steady', duration: 840, powerStart: 70, powerEnd: 70, cadence: 88, powerRangeLow: 65, powerRangeHigh: 75 },
      ]);
    });

    it('parses the exact user-provided example ("Endurance 4x" header treated as a plain "4x" repeat, alternating 14m/5m range lines)', () => {
      const text = ['4x', '14m 65-75%', '5m 76-82%'].join('\n');
      const workout = parseSpacePercentText(text);
      expectValidWorkout(workout);

      const enduranceBlock = { type: 'steady', duration: 840, powerStart: 70, powerEnd: 70, cadence: null, powerRangeLow: 65, powerRangeHigh: 75 };
      const tempoBlock = { type: 'steady', duration: 300, powerStart: 79, powerEnd: 79, cadence: null, powerRangeLow: 76, powerRangeHigh: 82 };

      expect(workout.intervals).toEqual([
        enduranceBlock,
        tempoBlock,
        enduranceBlock,
        tempoBlock,
        enduranceBlock,
        tempoBlock,
        enduranceBlock,
        tempoBlock,
      ]);
      expect(workout.totalDuration).toBe(4 * (840 + 300));
    });

    it('works the same inside a repeat block as standalone (single value and range lines can coexist)', () => {
      const text = ['5m 50%', '', '2x', '3m 60-70%', '1m 90%'].join('\n');
      const workout = parseSpacePercentText(text);

      const warmup = { type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null };
      const band = { type: 'steady', duration: 180, powerStart: 65, powerEnd: 65, cadence: null, powerRangeLow: 60, powerRangeHigh: 70 };
      const single = { type: 'steady', duration: 60, powerStart: 90, powerEnd: 90, cadence: null };

      expect(workout.intervals).toEqual([warmup, band, single, band, single]);
    });

    it('does not treat a plain single-value line as a range (no powerRangeLow/powerRangeHigh keys at all when "-" is absent)', () => {
      const workout = parseSpacePercentText('5m 50%');
      expect(workout.intervals[0]).not.toHaveProperty('powerRangeLow');
      expect(workout.intervals[0]).not.toHaveProperty('powerRangeHigh');
    });
  });
});
