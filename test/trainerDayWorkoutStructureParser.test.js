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

  describe('status labels, cadence, and Markdown bold (real "4X (interval) block" page content)', () => {
    it('ignores a leading status label ("Active"/"Rest"/"Cooldown"/"Warmup") - it does not affect duration/percentage parsing', () => {
      const workout = parseTrainerDayWorkoutStructureText('Active 5 min @ 50% (50w)');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
    });

    it('parses a trailing cadence ("N rpm") into the schema\'s cadence field', () => {
      const workout = parseTrainerDayWorkoutStructureText('Active 1 min @ 100% (100w) 90 rpm');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 60, powerStart: 100, powerEnd: 100, cadence: 90 }]);
    });

    it('leaves cadence as null when there is no trailing "N rpm" (cadence is optional, not required)', () => {
      const workout = parseTrainerDayWorkoutStructureText('Rest 4 min @ 90% (90w)');
      expect(workout.intervals[0].cadence).toBeNull();
    });

    it('handles both a status label and a trailing cadence together on the same line', () => {
      const workout = parseTrainerDayWorkoutStructureText('Cooldown 5 min @ 50% (50w) 80 rpm');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: 80 }]);
    });

    it('expands a Markdown-bold repeat declaration ("**4X**") the same way as a plain "4x" line', () => {
      const text = ['**4X**', '1 min @ 100% (100w)', '4 min @ 90% (90w)'].join('\n');
      const workout = parseTrainerDayWorkoutStructureText(text);
      const on = { type: 'steady', duration: 60, powerStart: 100, powerEnd: 100, cadence: null };
      const off = { type: 'steady', duration: 240, powerStart: 90, powerEnd: 90, cadence: null };
      expect(workout.intervals).toEqual([on, off, on, off, on, off, on, off]);
    });

    it('parses the full user-provided "4X interval block" example end to end (real TrainerDay page content: bullets, bold "Nx", indentation, status labels, cadence)', () => {
      const text = [
        '- Active 5 min @ 50% (50w) 80 rpm',
        '- **4X**',
        '  * Active 1 min @ 100% (100w) 90 rpm',
        '  * Rest 4 min @ 90% (90w) 95 rpm',
        '- Active 8 min @ 50% (50w) 85 rpm',
        '- **4X**',
        '  * Active 1 min @ 100% (100w) 90 rpm',
        '  * Rest 4 min @ 90% (90w) 95 rpm',
        '- Cooldown 5 min @ 50% (50w) 80 rpm',
      ].join('\n');

      const workout = parseTrainerDayWorkoutStructureText(text);
      expectValidWorkout(workout);

      // 1 (Active 5min) + 4x2 (1min/4min) + 1 (Active 8min) + 4x2 (1min/4min) + 1 (Cooldown 5min) = 19
      expect(workout.intervals).toHaveLength(19);

      const durations = workout.intervals.map((iv) => iv.duration);
      const powers = workout.intervals.map((iv) => iv.powerStart);
      expect(durations).toEqual([
        300, // Active 5 min
        60, 240, 60, 240, 60, 240, 60, 240, // 4X (1min/4min)
        480, // Active 8 min
        60, 240, 60, 240, 60, 240, 60, 240, // 4X (1min/4min)
        300, // Cooldown 5 min
      ]);
      expect(powers).toEqual([50, 100, 90, 100, 90, 100, 90, 100, 90, 50, 100, 90, 100, 90, 100, 90, 100, 90, 50]);

      expect(workout.totalDuration).toBe(58 * 60); // matches the page's displayed "58m"
      expect(workout.totalDuration).toBe(durations.reduce((sum, d) => sum + d, 0));
    });
  });

  describe('the full official status-label vocabulary (case-insensitive, leading "-" optional)', () => {
    const labels = ['warm-up', 'warmup', 'active', 'cooldown', 'interval', 'rest', 'free-ride', 'freeride', 'open-ended'];

    it.each(labels)('accepts "%s" as a leading label, ignoring it', (label) => {
      const workout = parseTrainerDayWorkoutStructureText(`${label} 5 min @ 50% (50w)`);
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
    });

    it.each(labels)('accepts "%s" in any letter case', (label) => {
      const workout = parseTrainerDayWorkoutStructureText(`${label.toUpperCase()} 5 min @ 50% (50w)`);
      expect(workout.intervals[0].powerStart).toBe(50);
    });

    it('accepts a leading "-" directly in front of the label (bullet dash glued to the word)', () => {
      const workout = parseTrainerDayWorkoutStructureText('- Active 5 min @ 50% (50w)');
      expect(workout.intervals[0].powerStart).toBe(50);
    });
  });

  describe('tolerant parsing principle: only missing duration/percentage is a real format error - everything else is ignorable', () => {
    it('still parses correctly when the label is an unrecognized word, not from the official list (extra info is ignored regardless of what it says)', () => {
      const workout = parseTrainerDayWorkoutStructureText('SomeRandomTag 5 min @ 50% (50w)');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
    });

    it('still parses correctly with multiple extra words before AND after the core "X min @ Y% (Zw)" segment', () => {
      const workout = parseTrainerDayWorkoutStructureText('Active Interval 1 min @ 100% (100w) 90 rpm extra trailing note');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 60, powerStart: 100, powerEnd: 100, cadence: 90 }]);
    });

    it('throws a format error only when duration or percentage cannot be found at all', () => {
      expect(() => parseTrainerDayWorkoutStructureText('Active rest day, no structured content here')).toThrow(
        /does not match the expected/
      );
    });

    it('still throws for the older TrainerDay manual-entry format "X min @ Yw" even with a status label prepended (no % or parens at all)', () => {
      expect(() => parseTrainerDayWorkoutStructureText('Active 10 min @ 53w')).toThrow(/does not match the expected/);
    });

    it('still throws for the WhatsOnZwift format "Xmin @ Y% FTP" even with a status label prepended (no parenthesized watts)', () => {
      expect(() => parseTrainerDayWorkoutStructureText('Active 2min @ 50% FTP')).toThrow(/does not match the expected/);
    });
  });

  describe('third repeat form: the self-contained bracket declaration "NX (X min @ Y% (Zw) | ...)"', () => {
    it('expands a bracket repeat declaration using this format\'s percentage-based line shape', () => {
      const text = '4X (Active 1 min @ 100% (100w) 90 rpm | Rest 4 min @ 90% (90w) 95 rpm)';
      const workout = parseTrainerDayWorkoutStructureText(text);
      const on = { type: 'steady', duration: 60, powerStart: 100, powerEnd: 100, cadence: 90 };
      const off = { type: 'steady', duration: 240, powerStart: 90, powerEnd: 90, cadence: 95 };
      expect(workout.intervals).toEqual([on, off, on, off, on, off, on, off]);
    });

    it('works alongside plain standalone lines before and after it', () => {
      const text = [
        '- Active 5 min @ 50% (50w) 80 rpm',
        '4X (Active 1 min @ 100% (100w) 90 rpm | Rest 4 min @ 90% (90w) 95 rpm)',
        '- Cooldown 5 min @ 50% (50w) 80 rpm',
      ].join('\n');
      const workout = parseTrainerDayWorkoutStructureText(text);
      expect(workout.intervals).toHaveLength(10);
      expect(workout.totalDuration).toBe(30 * 60);
    });

    it('routes correctly through parseAutoDetectedPasteText() too (regression: must not be misrouted to the plain-watts "full copy-paste" format just because both use "NX (...)" brackets)', async () => {
      const { parseAutoDetectedPasteText } = await import('../src/parser/pasteTextRouter.js');
      const text = [
        '- Active 5 min @ 50% (50w) 80 rpm',
        '4X (Active 1 min @ 100% (100w) 90 rpm | Rest 4 min @ 90% (90w) 95 rpm)',
        '- Cooldown 5 min @ 50% (50w) 80 rpm',
      ].join('\n');
      const workout = parseAutoDetectedPasteText(text);
      expect(workout.source).toBe('paste-trainerday-structure');
      expect(workout.intervals).toHaveLength(10);
    });
  });
});
