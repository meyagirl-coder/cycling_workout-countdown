import { describe, expect, it } from 'vitest';
import { parseAutoDetectedPasteText } from '../src/parser/pasteTextRouter.js';

describe('parseAutoDetectedPasteText', () => {
  it('detects and routes TrainerDay-style text ("X min @ Yw")', () => {
    const workout = parseAutoDetectedPasteText('10 min @ 53w\n20 min @ 68w');
    expect(workout.source).toBe('paste');
    expect(workout.intervals).toHaveLength(2);
    expect(workout.intervals[0]).toEqual({ type: 'steady', duration: 600, powerStart: 53, powerEnd: 53, cadence: null });
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

  it('detects and routes a WhatsOnZwift compound repeat line', () => {
    const workout = parseAutoDetectedPasteText('3x 2min @ 105% FTP, 1min @ 90% FTP');
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
