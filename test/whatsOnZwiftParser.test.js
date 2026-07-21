import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseWhatsOnZwiftText } from '../src/parser/whatsOnZwiftParser.js';
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

describe('parseWhatsOnZwiftText', () => {
  it('parses a ramp line ("Xmin from A to B% FTP") using the percentages verbatim, no watt conversion', () => {
    const workout = parseWhatsOnZwiftText('5min from 40 to 105% FTP');
    expectValidWorkout(workout);
    expect(workout.source).toBe('whatsonzwift');
    expect(workout.intervals).toEqual([{ type: 'ramp', duration: 300, powerStart: 40, powerEnd: 105, cadence: null }]);
  });

  it('parses a descending ramp line the same way (no assumption that A < B)', () => {
    const workout = parseWhatsOnZwiftText('5min from 70 to 40% FTP');
    expect(workout.intervals).toEqual([{ type: 'ramp', duration: 300, powerStart: 70, powerEnd: 40, cadence: null }]);
  });

  it('parses a steady line ("Xmin @ Y% FTP")', () => {
    const workout = parseWhatsOnZwiftText('2min @ 50% FTP');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 120, powerStart: 50, powerEnd: 50, cadence: null }]);
  });

  it('expands a compound repeat line ("Nx Xmin @ Y% FTP, Zmin @ W% FTP") into N pairs, comma-separated on one line', () => {
    const workout = parseWhatsOnZwiftText('3x 2min @ 105% FTP, 1min @ 90% FTP');
    const on = { type: 'steady', duration: 120, powerStart: 105, powerEnd: 105, cadence: null };
    const off = { type: 'steady', duration: 60, powerStart: 90, powerEnd: 90, cadence: null };
    expect(workout.intervals).toEqual([on, off, on, off, on, off]);
  });

  it('parses the full Over-Unders example and matches the page\'s displayed "Duration: 33m" and interval breakdown', () => {
    const text = [
      '5min from 40 to 105% FTP',
      '2min @ 50% FTP',
      '3x 2min @ 105% FTP, 1min @ 90% FTP',
      '3min @ 51% FTP',
      '3x 2min @ 105% FTP, 1min @ 91% FTP',
      '5min from 70 to 40% FTP',
    ].join('\n');

    const workout = parseWhatsOnZwiftText(text);
    expectValidWorkout(workout);

    expect(workout.id).toMatch(UUID_RE);
    expect(workout.totalDuration).toBe(33 * 60); // matches the page's "Duration: 33m"
    expect(workout.intervals).toHaveLength(16); // 1 + 1 + 6 + 1 + 6 + 1

    const rampUp = { type: 'ramp', duration: 300, powerStart: 40, powerEnd: 105, cadence: null };
    const warmdown = { type: 'steady', duration: 120, powerStart: 50, powerEnd: 50, cadence: null };
    const overA = { type: 'steady', duration: 120, powerStart: 105, powerEnd: 105, cadence: null };
    const underA = { type: 'steady', duration: 60, powerStart: 90, powerEnd: 90, cadence: null };
    const rest = { type: 'steady', duration: 180, powerStart: 51, powerEnd: 51, cadence: null };
    const overB = { type: 'steady', duration: 120, powerStart: 105, powerEnd: 105, cadence: null };
    const underB = { type: 'steady', duration: 60, powerStart: 91, powerEnd: 91, cadence: null };
    const rampDown = { type: 'ramp', duration: 300, powerStart: 70, powerEnd: 40, cadence: null };

    expect(workout.intervals).toEqual([
      rampUp,
      warmdown,
      overA,
      underA,
      overA,
      underA,
      overA,
      underA,
      rest,
      overB,
      underB,
      overB,
      underB,
      overB,
      underB,
      rampDown,
    ]);
  });

  it('generates a unique id on every parse', () => {
    const text = '2min @ 50% FTP';
    expect(parseWhatsOnZwiftText(text).id).not.toBe(parseWhatsOnZwiftText(text).id);
  });

  it('is tolerant of blank lines between entries', () => {
    const workout = parseWhatsOnZwiftText('2min @ 50% FTP\n\n3min @ 51% FTP');
    expect(workout.intervals).toHaveLength(2);
  });

  it('throws when the input is empty or blank', () => {
    expect(() => parseWhatsOnZwiftText('')).toThrow(/non-empty string/);
    expect(() => parseWhatsOnZwiftText('   \n  ')).toThrow(/non-empty string/);
  });

  it('reports the exact line number and content of a malformed line instead of silently skipping it', () => {
    const text = '2min @ 50% FTP\nsome unrelated line\n3min @ 51% FTP';
    expect(() => parseWhatsOnZwiftText(text)).toThrow(/line 2 \("some unrelated line"\)/);
  });

  it('throws a clear error for a zero repeat count in a compound repeat line', () => {
    expect(() => parseWhatsOnZwiftText('0x 2min @ 105% FTP, 1min @ 90% FTP')).toThrow(/invalid repeat count/);
  });

  it('throws when no valid line is found at all', () => {
    expect(() => parseWhatsOnZwiftText('not a workout')).toThrow(/does not match a recognized WhatsOnZwift line format/);
  });
});
