import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseTrainerDayFullText } from '../src/parser/trainerDayFullTextParser.js';
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

describe('parseTrainerDayFullText', () => {
  it('parses a basic "X min @ Yw" line', () => {
    const workout = parseTrainerDayFullText('5 min @ 50w');
    expectValidWorkout(workout);
    expect(workout.source).toBe('paste-trainerday-full');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
  });

  it('parses a "X sec @ Yw" line (seconds, not supported by the older manual-entry format)', () => {
    const workout = parseTrainerDayFullText('30 sec @ 110w');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 30, powerStart: 110, powerEnd: 110, cadence: null }]);
  });

  it('skips the "持续时间: 59m" duration header line without treating it as data', () => {
    const workout = parseTrainerDayFullText(['持续时间: 59m', '5 min @ 50w'].join('\n'));
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
  });

  it('skips the duration header regardless of its exact duration text or colon style (full-width "：")', () => {
    const workout = parseTrainerDayFullText(['持续时间：1h 5m', '5 min @ 50w'].join('\n'));
    expect(workout.intervals).toHaveLength(1);
  });

  it('expands an inline "NX (segment | segment)" repeat block with 2 segments', () => {
    const workout = parseTrainerDayFullText('2X (8 min @ 64w | 2 min @ 90w)');
    const a = { type: 'steady', duration: 480, powerStart: 64, powerEnd: 64, cadence: null };
    const b = { type: 'steady', duration: 120, powerStart: 90, powerEnd: 90, cadence: null };
    expect(workout.intervals).toEqual([a, b, a, b]);
  });

  it('expands an inline repeat block with 3 segments (not hardcoded to 2)', () => {
    const workout = parseTrainerDayFullText('2X (8 min @ 64w | 2 min @ 90w | 1 min @ 110w)');
    const a = { type: 'steady', duration: 480, powerStart: 64, powerEnd: 64, cadence: null };
    const b = { type: 'steady', duration: 120, powerStart: 90, powerEnd: 90, cadence: null };
    const c = { type: 'steady', duration: 60, powerStart: 110, powerEnd: 110, cadence: null };
    expect(workout.intervals).toEqual([a, b, c, a, b, c]);
  });

  it('expands an inline repeat block with 5 segments (arbitrary segment count, not hardcoded)', () => {
    const workout = parseTrainerDayFullText('1X (1 min @ 10w | 1 min @ 20w | 1 min @ 30w | 1 min @ 40w | 1 min @ 50w)');
    expect(workout.intervals.map((iv) => iv.powerStart)).toEqual([10, 20, 30, 40, 50]);
  });

  it('accepts a lowercase "x" for the repeat count', () => {
    const workout = parseTrainerDayFullText('2x (1 min @ 100w)');
    expect(workout.intervals).toHaveLength(2);
  });

  it('accepts an uppercase "X" for the repeat count', () => {
    const workout = parseTrainerDayFullText('2X (1 min @ 100w)');
    expect(workout.intervals).toHaveLength(2);
  });

  it('throws a clear error for a zero repeat count on an inline block', () => {
    expect(() => parseTrainerDayFullText('0X (1 min @ 100w)')).toThrow(/invalid repeat count/);
  });

  it('throws a clear error when a segment inside the parentheses does not match the expected line format', () => {
    expect(() => parseTrainerDayFullText('2X (1 min @ 100w | not a valid segment)')).toThrow(
      /segment \("not a valid segment"\) that does not match/
    );
  });

  it('generates a unique id on every parse', () => {
    const text = '5 min @ 50w';
    expect(parseTrainerDayFullText(text).id).not.toBe(parseTrainerDayFullText(text).id);
  });

  it('throws when the input is empty or blank', () => {
    expect(() => parseTrainerDayFullText('')).toThrow(/non-empty string/);
    expect(() => parseTrainerDayFullText('   \n  ')).toThrow(/non-empty string/);
  });

  it('reports the exact line number and content of a malformed line', () => {
    const text = '5 min @ 50w\nnot a valid line\n10 min @ 75w';
    expect(() => parseTrainerDayFullText(text)).toThrow(/line 2 \("not a valid line"\)/);
  });

  it('throws when no valid line is found at all', () => {
    expect(() => parseTrainerDayFullText('持续时间: 59m')).toThrow(/no valid workout lines found/);
  });

  it('parses the full user-provided example end to end', () => {
    const text = [
      '持续时间: 59m',
      '5 min @ 50w',
      '5 min @ 80w',
      '3 min @ 50w',
      '1 min @ 70w',
      '1 min @ 90w',
      '30 sec @ 110w',
      '3 min @ 50w',
      '1 min @ 70w',
      '1 min @ 90w',
      '30 sec @ 110w',
      '3 min @ 50w',
      '1 min @ 70w',
      '1 min @ 90w',
      '30 sec @ 110w',
      '3 min @ 50w',
      '1 min @ 70w',
      '1 min @ 90w',
      '30 sec @ 110w',
      '2X (8 min @ 64w | 2 min @ 90w | 1 min @ 110w)',
      '5 min @ 50w',
    ].join('\n');

    const workout = parseTrainerDayFullText(text);
    expectValidWorkout(workout);
    expect(workout.id).toMatch(UUID_RE);

    // 2 standalone lines (50w/80w) + 16 standalone lines (4x "3-1-1-0.5min" blocks written
    // out, not via Nx) + 6 from the 2X(...) block + 1 trailing standalone = 25. Total
    // duration (3540s = 59m) matches the page's own "持续时间: 59m" header - a good
    // sanity check that nothing was mis-parsed.
    expect(workout.intervals).toHaveLength(25);
    expect(workout.totalDuration).toBe(59 * 60);

    const w50 = { type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null };
    const w80 = { type: 'steady', duration: 300, powerStart: 80, powerEnd: 80, cadence: null };
    const m3_50 = { type: 'steady', duration: 180, powerStart: 50, powerEnd: 50, cadence: null };
    const m1_70 = { type: 'steady', duration: 60, powerStart: 70, powerEnd: 70, cadence: null };
    const m1_90 = { type: 'steady', duration: 60, powerStart: 90, powerEnd: 90, cadence: null };
    const s30_110 = { type: 'steady', duration: 30, powerStart: 110, powerEnd: 110, cadence: null };
    const m8_64 = { type: 'steady', duration: 480, powerStart: 64, powerEnd: 64, cadence: null };
    const m2_90 = { type: 'steady', duration: 120, powerStart: 90, powerEnd: 90, cadence: null };
    const m1_110 = { type: 'steady', duration: 60, powerStart: 110, powerEnd: 110, cadence: null };

    expect(workout.intervals).toEqual([
      w50,
      w80,
      m3_50,
      m1_70,
      m1_90,
      s30_110,
      m3_50,
      m1_70,
      m1_90,
      s30_110,
      m3_50,
      m1_70,
      m1_90,
      s30_110,
      m3_50,
      m1_70,
      m1_90,
      s30_110,
      m8_64,
      m2_90,
      m1_110,
      m8_64,
      m2_90,
      m1_110,
      w50,
    ]);
  });
});
