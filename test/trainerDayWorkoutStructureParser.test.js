import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseTrainerDayWorkoutStructureText } from '../src/parser/trainerDayWorkoutStructureParser.js';
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

describe('parseTrainerDayWorkoutStructureText', () => {
  it('parses a basic "X min @ Y% (Zw)" line, using the explicit percentage and ignoring the parenthesized watts', () => {
    const workout = parseTrainerDayWorkoutStructureText('5 min @ 50% (50w)');
    expectValidWorkout(workout);
    expect(workout.source).toBe('paste-trainerday-structure');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
  });

  it('ignores the parenthesized watts even when they do NOT match the percentage (real FTP != 100)', () => {
    // e.g. author's real FTP is 250W, so 50% shows as "(125w)", not "(50w)" - only the % matters.
    const workout = parseTrainerDayWorkoutStructureText('5 min @ 50% (125w)');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
  });

  it('parses a "X sec @ Y% (Zw)" line (seconds)', () => {
    const workout = parseTrainerDayWorkoutStructureText('30 sec @ 110% (275w)');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 30, powerStart: 110, powerEnd: 110, cadence: null }]);
  });

  it('tolerates a bullet-list prefix and extra whitespace inside the parentheses', () => {
    const workout = parseTrainerDayWorkoutStructureText('* 5 min @ 50% ( 50w )');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
  });

  it('parses the full user-provided 12-line "Workout structure" example (ramp-up-5)', () => {
    const text = [
      '5 min @ 50% (50w)',
      '5 min @ 55% (55w)',
      '5 min @ 60% (60w)',
      '5 min @ 65% (65w)',
      '5 min @ 70% (70w)',
      '5 min @ 75% (75w)',
      '5 min @ 80% (80w)',
      '5 min @ 85% (85w)',
      '5 min @ 90% (90w)',
      '5 min @ 95% (95w)',
      '5 min @ 100% (100w)',
      '5 min @ 50% (50w)',
    ].join('\n');

    const workout = parseTrainerDayWorkoutStructureText(text);
    expectValidWorkout(workout);
    expect(workout.id).toMatch(UUID_RE);
    expect(workout.intervals).toHaveLength(12);
    expect(workout.intervals.map((iv) => iv.powerStart)).toEqual([50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 50]);
    expect(workout.intervals.every((iv) => iv.duration === 300)).toBe(true);
    expect(workout.totalDuration).toBe(12 * 300);
  });

  it('expands a "Nx" newline-repeat block the same way as pasteTextParser.js', () => {
    const workout = parseTrainerDayWorkoutStructureText(['3x', '2 min @ 105% (210w)', '1 min @ 50% (100w)'].join('\n'));
    const on = { type: 'steady', duration: 120, powerStart: 105, powerEnd: 105, cadence: null };
    const off = { type: 'steady', duration: 60, powerStart: 50, powerEnd: 50, cadence: null };
    expect(workout.intervals).toEqual([on, off, on, off, on, off]);
  });

  it('generates a unique id on every parse', () => {
    const text = '5 min @ 50% (50w)';
    expect(parseTrainerDayWorkoutStructureText(text).id).not.toBe(parseTrainerDayWorkoutStructureText(text).id);
  });

  it('throws when the input is empty or blank', () => {
    expect(() => parseTrainerDayWorkoutStructureText('')).toThrow(/non-empty string/);
    expect(() => parseTrainerDayWorkoutStructureText('   \n  ')).toThrow(/non-empty string/);
  });

  it('reports the exact line number and content of a malformed line', () => {
    const text = '5 min @ 50% (50w)\nnot a valid line\n5 min @ 55% (55w)';
    expect(() => parseTrainerDayWorkoutStructureText(text)).toThrow(/line 2 \("not a valid line"\)/);
  });

  it('does NOT match the older TrainerDay manual-entry format "X min @ Yw" (no percent sign, no parens)', () => {
    expect(() => parseTrainerDayWorkoutStructureText('10 min @ 53w')).toThrow(/does not match the expected/);
  });

  it('does NOT match the WhatsOnZwift format "Xmin @ Y% FTP" (says FTP, not parenthesized watts)', () => {
    expect(() => parseTrainerDayWorkoutStructureText('2min @ 50% FTP')).toThrow(/does not match the expected/);
  });
});
