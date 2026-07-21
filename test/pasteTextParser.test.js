import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { computeCurrentTarget } from '../src/engine/timerEngine.js';
import { parsePasteText } from '../src/parser/pasteTextParser.js';
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

describe('parsePasteText', () => {
  it('parses a basic list of "X min @ Yw" lines into steady intervals, Yw mapping directly to Y% FTP', () => {
    const text = ['10 min @ 53w', '20 min @ 68w', '15 min @ 85w', '10 min @ 98w', '5 min @ 50w'].join('\n');

    const workout = parsePasteText(text);
    expectValidWorkout(workout);

    expect(workout.id).toMatch(UUID_RE);
    expect(workout.source).toBe('paste');
    expect(workout.totalDuration).toBe(10 * 60 + 20 * 60 + 15 * 60 + 10 * 60 + 5 * 60);
    expect(workout.intervals).toEqual([
      { type: 'steady', duration: 600, powerStart: 53, powerEnd: 53, cadence: null },
      { type: 'steady', duration: 1200, powerStart: 68, powerEnd: 68, cadence: null },
      { type: 'steady', duration: 900, powerStart: 85, powerEnd: 85, cadence: null },
      { type: 'steady', duration: 600, powerStart: 98, powerEnd: 98, cadence: null },
      { type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null },
    ]);
  });

  it('is tolerant of case, whitespace, and blank lines between entries', () => {
    const text = '10 MIN @ 53W\n\n  20   min   @   68w  \n';
    const workout = parsePasteText(text);

    expect(workout.intervals).toEqual([
      { type: 'steady', duration: 600, powerStart: 53, powerEnd: 53, cadence: null },
      { type: 'steady', duration: 1200, powerStart: 68, powerEnd: 68, cadence: null },
    ]);
  });

  it('handles a real-world copy/paste with bullet-prefixed lines and no space between "min" and "@" (regression)', () => {
    // Verbatim example reported as failing: each line prefixed with "* " (list bullet)
    // and no space in "min@" - both must be tolerated, and the number before "w" must
    // still map directly to %FTP (TrainerDay's FTP=100 baseline convention).
    const text = ['* 10 min@ 53w', '* 20 min@ 68w', '* 15 min@ 85w', '* 10 min@ 98w', '* 5 min@ 50w'].join('\n');

    const workout = parsePasteText(text);
    expectValidWorkout(workout);

    expect(workout.intervals.map((iv) => iv.powerStart)).toEqual([53, 68, 85, 98, 50]);
    expect(workout.intervals).toEqual([
      { type: 'steady', duration: 600, powerStart: 53, powerEnd: 53, cadence: null },
      { type: 'steady', duration: 1200, powerStart: 68, powerEnd: 68, cadence: null },
      { type: 'steady', duration: 900, powerStart: 85, powerEnd: 85, cadence: null },
      { type: 'steady', duration: 600, powerStart: 98, powerEnd: 98, cadence: null },
      { type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null },
    ]);
  });

  it('strips other common bullet markers too ("-", "•")', () => {
    const text = ['- 10 min @ 53w', '• 20 min @ 68w'].join('\n');
    const workout = parsePasteText(text);
    expect(workout.intervals.map((iv) => iv.powerStart)).toEqual([53, 68]);
  });

  it('the "Yw" value is stored as %FTP, not watts - displayed watts always come from %FTP × the user\'s real FTP, never the raw "w" number', () => {
    // Regression: "53w" must NOT be shown to the user as "53 W" - it's 53% of
    // whatever FTP the user configured, e.g. 106W at FTP=200 (200 * 0.53), not 53W.
    const text = ['* 10 min@ 53w', '* 20 min@ 68w', '* 15 min@ 85w', '* 10 min@ 98w', '* 5 min@ 50w'].join('\n');
    const workout = parsePasteText(text);
    const ftp = 200;

    const displayedWatts = workout.intervals.map((_, i) => computeCurrentTarget(workout, i, 0, ftp).watts);
    expect(displayedWatts).toEqual([106, 136, 170, 196, 100]);
  });

  it('rounds fractional minutes to the nearest second', () => {
    const workout = parsePasteText('1.5 min @ 100w');
    expect(workout.intervals).toEqual([{ type: 'steady', duration: 90, powerStart: 100, powerEnd: 100, cadence: null }]);
  });

  it('generates a unique id on every parse', () => {
    const text = '10 min @ 53w';
    const first = parsePasteText(text);
    const second = parsePasteText(text);
    expect(first.id).not.toBe(second.id);
  });

  it('throws when the input is empty or blank', () => {
    expect(() => parsePasteText('')).toThrow(/non-empty string/);
    expect(() => parsePasteText('   \n  \n')).toThrow(/non-empty string/);
  });

  it('throws when no line matches the expected format at all', () => {
    expect(() => parsePasteText('this is not a workout')).toThrow(/does not match the expected "X min @ Yw" format/);
  });

  it('reports the exact line number and content of a malformed line instead of silently skipping it', () => {
    const text = '10 min @ 53w\n20 minutes at 68 watts\n15 min @ 85w';
    expect(() => parsePasteText(text)).toThrow(/line 2 \("20 minutes at 68 watts"\)/);
  });

  it('reports the first malformed line even when earlier lines parsed fine (does not silently fall back to a partial workout)', () => {
    const text = '10 min @ 53w\n20 min @ 68w\nbroken line here\n5 min @ 50w';
    expect(() => parsePasteText(text)).toThrow(/line 3/);
  });

  describe('repeat blocks ("Nx" followed by lines to repeat)', () => {
    it('expands a "3x" block into 3 repetitions of the lines that follow it', () => {
      const text = ['3x', '1 min @ 150w', '1 min @ 50w'].join('\n');
      const workout = parsePasteText(text);
      expectValidWorkout(workout);

      const on = { type: 'steady', duration: 60, powerStart: 150, powerEnd: 150, cadence: null };
      const off = { type: 'steady', duration: 60, powerStart: 50, powerEnd: 50, cadence: null };
      expect(workout.intervals).toEqual([on, off, on, off, on, off]);
    });

    it('combines a leading warmup line, a "3x" repeat block, and a trailing cooldown line in the right order', () => {
      const text = ['10 min @ 53w', '', '3x', '1 min @ 150w', '1 min @ 50w', '', '10 min @ 45w'].join('\n');

      const workout = parsePasteText(text);
      expectValidWorkout(workout);

      const warmup = { type: 'steady', duration: 600, powerStart: 53, powerEnd: 53, cadence: null };
      const on = { type: 'steady', duration: 60, powerStart: 150, powerEnd: 150, cadence: null };
      const off = { type: 'steady', duration: 60, powerStart: 50, powerEnd: 50, cadence: null };
      const cooldown = { type: 'steady', duration: 600, powerStart: 45, powerEnd: 45, cadence: null };

      expect(workout.intervals).toEqual([warmup, on, off, on, off, on, off, cooldown]);
      expect(workout.totalDuration).toBe(600 + 3 * (60 + 60) + 600);
    });

    it('handles multiple separate repeat blocks in the same paste, each with its own count', () => {
      const text = ['2x', '1 min @ 150w', '1 min @ 50w', '', '3x', '30 min @ 200w'].join('\n');
      const workout = parsePasteText(text);

      const on = { type: 'steady', duration: 60, powerStart: 150, powerEnd: 150, cadence: null };
      const off = { type: 'steady', duration: 60, powerStart: 50, powerEnd: 50, cadence: null };
      const sprint = { type: 'steady', duration: 1800, powerStart: 200, powerEnd: 200, cadence: null };

      expect(workout.intervals).toEqual([on, off, on, off, sprint, sprint, sprint]);
    });

    it('terminates a repeat block at the next "Nx" declaration even without a blank line in between', () => {
      const text = ['2x', '1 min @ 150w', '3x', '1 min @ 50w'].join('\n');
      const workout = parsePasteText(text);

      const on = { type: 'steady', duration: 60, powerStart: 150, powerEnd: 150, cadence: null };
      const off = { type: 'steady', duration: 60, powerStart: 50, powerEnd: 50, cadence: null };

      expect(workout.intervals).toEqual([on, on, off, off, off]);
    });

    it('is case-insensitive for the repeat count line ("3X")', () => {
      const text = ['3X', '1 min @ 150w'].join('\n');
      const workout = parsePasteText(text);
      expect(workout.intervals).toHaveLength(3);
    });

    it('throws a clear error when a repeat block declares a count but has no interval lines after it', () => {
      const text = ['3x', '', '10 min @ 53w'].join('\n');
      expect(() => parsePasteText(text)).toThrow(/line 1 \("3x"\) declares a repeat but no "X min @ Yw" lines follow it/);
    });

    it('throws a clear error for a zero repeat count', () => {
      expect(() => parsePasteText(['0x', '1 min @ 150w'].join('\n'))).toThrow(/line 1 \("0x"\) has an invalid repeat count/);
    });
  });
});
