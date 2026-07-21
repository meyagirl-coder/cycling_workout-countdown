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
});
