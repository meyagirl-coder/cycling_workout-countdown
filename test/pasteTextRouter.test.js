import { describe, expect, it } from 'vitest';
import { parseAutoDetectedPasteText } from '../src/parser/pasteTextRouter.js';

describe('parseAutoDetectedPasteText', () => {
  it('detects and routes TrainerDay-style text ("X min @ Yw")', () => {
    const workout = parseAutoDetectedPasteText('10 min @ 53w\n20 min @ 68w');
    expect(workout.source).toBe('paste');
    expect(workout.intervals).toHaveLength(2);
    expect(workout.intervals[0]).toEqual({ type: 'steady', duration: 600, powerStart: 53, powerEnd: 53, cadence: null });
  });

  it('detects and routes TrainerDay-style text with bullet-list prefixes and no space before "@" (regression)', () => {
    const text = ['* 10 min@ 53w', '* 20 min@ 68w', '* 15 min@ 85w', '* 10 min@ 98w', '* 5 min@ 50w'].join('\n');
    const workout = parseAutoDetectedPasteText(text);
    expect(workout.source).toBe('paste');
    expect(workout.intervals.map((iv) => iv.powerStart)).toEqual([53, 68, 85, 98, 50]);
  });

  it('detects and routes TrainerDay-style "Nx" newline-repeat text', () => {
    const workout = parseAutoDetectedPasteText(['3x', '1 min @ 150w', '1 min @ 50w'].join('\n'));
    expect(workout.source).toBe('paste');
    expect(workout.intervals).toHaveLength(6);
  });

  it('detects and routes WhatsOnZwift-style text (literal "% FTP")', () => {
    const workout = parseAutoDetectedPasteText('2min @ 50% FTP\n3min @ 51% FTP');
    expect(workout.source).toBe('whatsonzwift');
    expect(workout.intervals).toHaveLength(2);
  });

  it('detects and routes a WhatsOnZwift ramp line ("from A to B% FTP")', () => {
    const workout = parseAutoDetectedPasteText('5min from 40 to 105% FTP');
    expect(workout.source).toBe('whatsonzwift');
    expect(workout.intervals[0].type).toBe('ramp');
  });

  it('detects and routes a WhatsOnZwift two-line compound repeat block', () => {
    const workout = parseAutoDetectedPasteText(['3x 2min @ 105% FTP,', '1min @ 90% FTP'].join('\n'));
    expect(workout.source).toBe('whatsonzwift');
    expect(workout.intervals).toHaveLength(6);
  });

  it('detects and routes the new "Xm Y%" space-percent format', () => {
    const workout = parseAutoDetectedPasteText('5m 50%\n10m 75%');
    expect(workout.source).toBe('paste-percent');
    expect(workout.intervals).toHaveLength(2);
  });

  it('detects and routes the "Xs Y%" second-based space-percent format', () => {
    const workout = parseAutoDetectedPasteText('30s 120%');
    expect(workout.source).toBe('paste-percent');
  });

  it('detects and routes a space-percent "Nx" newline-repeat block that starts the text', () => {
    const workout = parseAutoDetectedPasteText(['3x', '3m 50%', '30s 120%'].join('\n'));
    expect(workout.source).toBe('paste-percent');
    expect(workout.intervals).toHaveLength(6);
  });

  it('routes and parses a space-percent line with trailing "N rpm" cadence, including inside a "Nx" block (regression: first line\'s rpm suffix used to fail routing entirely)', () => {
    const text = ['3m 50% 90rpm', '', '4x', '3m 70% 90rpm', '1m 90% 90rpm'].join('\n');
    const workout = parseAutoDetectedPasteText(text);
    expect(workout.source).toBe('paste-percent');
    expect(workout.intervals).toHaveLength(9);
    expect(workout.intervals.every((iv) => iv.cadence === 90)).toBe(true);
  });

  it('parses the full user-provided space-percent example end to end (14 intervals)', () => {
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

    const workout = parseAutoDetectedPasteText(text);
    expect(workout.source).toBe('paste-percent');
    expect(workout.intervals).toHaveLength(14);
  });

  describe('TrainerDay "full copy-paste" format (priority format)', () => {
    it('detects and routes text with a "持续时间: 59m" duration header, even though the rest looks like the older manual-entry format', () => {
      const workout = parseAutoDetectedPasteText(['持续时间: 59m', '5 min @ 50w', '10 min @ 75w'].join('\n'));
      expect(workout.source).toBe('paste-trainerday-full');
      expect(workout.intervals).toHaveLength(2);
    });

    it('detects and routes text with an inline "NX (segment | segment)" repeat block, even with no duration header', () => {
      const workout = parseAutoDetectedPasteText('2X (8 min @ 64w | 2 min @ 90w | 1 min @ 110w)');
      expect(workout.source).toBe('paste-trainerday-full');
      expect(workout.intervals).toHaveLength(6);
    });

    it('takes priority over the older TrainerDay manual-entry format when a duration header is present, not just falls back to it', () => {
      // Without the header this text would be ambiguous with the older "X min @ Yw" format;
      // the header must force routing to the new parser.
      const workout = parseAutoDetectedPasteText(['持续时间: 10m', '5 min @ 50w', '5 min @ 60w'].join('\n'));
      expect(workout.source).toBe('paste-trainerday-full');
    });

    it('falls back to the new parser for a "X sec @ Yw" line with no header/repeat markers (the older format has no "sec" support)', () => {
      const workout = parseAutoDetectedPasteText('30 sec @ 110w');
      expect(workout.source).toBe('paste-trainerday-full');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 30, powerStart: 110, powerEnd: 110, cadence: null }]);
    });

    it('still routes a plain "X min @ Yw"-only paste (no header, no inline repeat, no "sec") to the older format unchanged (backward compatible)', () => {
      const workout = parseAutoDetectedPasteText('10 min @ 53w\n20 min @ 68w');
      expect(workout.source).toBe('paste');
    });

    it('parses the full user-provided example end to end (25 intervals, matching the "持续时间: 59m" header)', () => {
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

      const workout = parseAutoDetectedPasteText(text);
      expect(workout.source).toBe('paste-trainerday-full');
      expect(workout.intervals).toHaveLength(25);
      expect(workout.totalDuration).toBe(59 * 60);
    });
  });

  describe('TrainerDay "Workout structure" format ("X min @ Y% (Zw)")', () => {
    it('detects and routes a basic "X min @ Y% (Zw)" line, distinct from the older "X min @ Yw" format', () => {
      const workout = parseAutoDetectedPasteText('5 min @ 50% (50w)');
      expect(workout.source).toBe('paste-trainerday-structure');
      expect(workout.intervals).toEqual([{ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: null }]);
    });

    it('does not get misrouted to the older TrainerDay manual-entry format ("paste") just because both start with "X min @"', () => {
      const workout = parseAutoDetectedPasteText('5 min @ 50% (50w)\n5 min @ 55% (55w)');
      expect(workout.source).toBe('paste-trainerday-structure');
      expect(workout.source).not.toBe('paste');
    });

    it('routes an "Nx" newline-repeat block in this format correctly', () => {
      const workout = parseAutoDetectedPasteText(['3x', '2 min @ 105% (210w)', '1 min @ 50% (100w)'].join('\n'));
      expect(workout.source).toBe('paste-trainerday-structure');
      expect(workout.intervals).toHaveLength(6);
    });

    it('parses the full user-provided 12-line "ramp-up-5" example end to end', () => {
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

      const workout = parseAutoDetectedPasteText(text);
      expect(workout.source).toBe('paste-trainerday-structure');
      expect(workout.intervals).toHaveLength(12);
      expect(workout.intervals.map((iv) => iv.powerStart)).toEqual([50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 50]);
    });

    it('detects and routes real page content with a leading status label, bullet prefix, and trailing cadence on the first line', () => {
      const text = ['- Active 5 min @ 50% (50w) 80 rpm', '- Rest 4 min @ 90% (90w) 95 rpm'].join('\n');
      const workout = parseAutoDetectedPasteText(text);
      expect(workout.source).toBe('paste-trainerday-structure');
      expect(workout.intervals[0]).toEqual({ type: 'steady', duration: 300, powerStart: 50, powerEnd: 50, cadence: 80 });
    });

    it('parses the full user-provided "4X interval block" example end to end (bullets, bold "**4X**", indentation, status labels, cadence)', () => {
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

      const workout = parseAutoDetectedPasteText(text);
      expect(workout.source).toBe('paste-trainerday-structure');
      expect(workout.intervals).toHaveLength(19);
      expect(workout.totalDuration).toBe(58 * 60);
    });

    it('routes a "%"-based bracket repeat "NX (X min @ Y% (Zw) | ...)" to this format, not the plain-watts "full copy-paste" format (both use the same bracket syntax - only the percentage sign disambiguates them)', () => {
      const text = [
        '- Active 5 min @ 50% (50w) 80 rpm',
        '4X (Active 1 min @ 100% (100w) 90 rpm | Rest 4 min @ 90% (90w) 95 rpm)',
        '- Cooldown 5 min @ 50% (50w) 80 rpm',
      ].join('\n');
      const workout = parseAutoDetectedPasteText(text);
      expect(workout.source).toBe('paste-trainerday-structure');
      expect(workout.intervals).toHaveLength(10);
      expect(workout.totalDuration).toBe(30 * 60);
    });

    it('a "%"-free bracket repeat still routes to the plain-watts "full copy-paste" format unchanged (regression)', () => {
      const workout = parseAutoDetectedPasteText('2X (8 min @ 64w | 2 min @ 90w | 1 min @ 110w)');
      expect(workout.source).toBe('paste-trainerday-full');
      expect(workout.intervals).toHaveLength(6);
    });
  });

  it('throws when the input is empty or blank', () => {
    expect(() => parseAutoDetectedPasteText('')).toThrow(/non-empty string/);
    expect(() => parseAutoDetectedPasteText('   \n  ')).toThrow(/non-empty string/);
  });

  it('throws a clear "could not recognize the format" error when nothing matches any known format', () => {
    expect(() => parseAutoDetectedPasteText('this is not any recognized workout format')).toThrow(
      /could not recognize the workout text format/
    );
  });

  it('throws the same recognizable-format error when the text is only a standalone "Nx" line with no content', () => {
    expect(() => parseAutoDetectedPasteText('3x')).toThrow(/could not recognize the workout text format/);
  });

  it('delegates malformed-line errors to the detected format\'s own parser (line-specific message)', () => {
    // First content line matches TrainerDay's format, so the rest of the text should be parsed as
    // TrainerDay format - and a later malformed line should surface that specific parser's error.
    const text = '10 min @ 53w\nsome garbage line';
    expect(() => parseAutoDetectedPasteText(text)).toThrow(/line 2 \("some garbage line"\)/);
  });
});
