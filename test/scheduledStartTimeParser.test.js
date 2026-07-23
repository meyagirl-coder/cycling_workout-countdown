import { describe, expect, it } from 'vitest';
import { parseScheduledStartTimeInput } from '../src/ui/scheduledStartTimeParser.js';

describe('parseScheduledStartTimeInput', () => {
  it('parses "202607242000" into a Date using the browser\'s local timezone (no UTC conversion)', () => {
    const date = parseScheduledStartTimeInput('202607242000');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6); // 0-indexed: July
    expect(date.getDate()).toBe(24);
    expect(date.getHours()).toBe(20);
    expect(date.getMinutes()).toBe(0);
    expect(date.getSeconds()).toBe(0);
  });

  it('trims leading/trailing whitespace', () => {
    const date = parseScheduledStartTimeInput('  202607242000  ');
    expect(date.getFullYear()).toBe(2026);
  });

  it('accepts full-width digits (regression: CJK input methods in full-width mode produce these even with inputmode="numeric", visually indistinguishable from ASCII digits in a small field)', () => {
    const date = parseScheduledStartTimeInput('２０２６０７２４２０００');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6);
    expect(date.getDate()).toBe(24);
    expect(date.getHours()).toBe(20);
    expect(date.getMinutes()).toBe(0);
  });

  it('accepts a mix of full-width and half-width digits', () => {
    const date = parseScheduledStartTimeInput('２０2607242０00');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getHours()).toBe(20);
  });

  it('accepts midnight (00:00) and one-minute-before-midnight (23:59) boundary times', () => {
    expect(parseScheduledStartTimeInput('202601010000').getHours()).toBe(0);
    expect(parseScheduledStartTimeInput('202601012359').getMinutes()).toBe(59);
  });

  it('accepts Feb 29 on a leap year', () => {
    const date = parseScheduledStartTimeInput('202802291200');
    expect(date.getMonth()).toBe(1);
    expect(date.getDate()).toBe(29);
  });

  it('rejects Feb 29 on a non-leap year (would silently roll over to March 1 otherwise)', () => {
    expect(() => parseScheduledStartTimeInput('202702291200')).toThrow(/不是合法的日期/);
  });

  it('rejects Feb 30 (no month has that many days, would silently roll over to March otherwise)', () => {
    expect(() => parseScheduledStartTimeInput('202602301200')).toThrow(/不是合法的日期/);
  });

  it('rejects an hour of 24 or greater', () => {
    expect(() => parseScheduledStartTimeInput('202607242400')).toThrow(/時要在 00-23 之間/);
  });

  it('rejects a minute of 60 or greater', () => {
    expect(() => parseScheduledStartTimeInput('202607242060')).toThrow(/分要在 00-59 之間/);
  });

  it('rejects a month of 00 or 13', () => {
    expect(() => parseScheduledStartTimeInput('202600242000')).toThrow(/月份 00 不合法/);
    expect(() => parseScheduledStartTimeInput('202613242000')).toThrow(/月份 13 不合法/);
  });

  it('rejects input still using the old "YYYYMMDD HH:mm" format with a space and colon', () => {
    expect(() => parseScheduledStartTimeInput('20260724 20:00')).toThrow(/日期時間格式錯誤/);
  });

  it('rejects input with the wrong number of digits', () => {
    expect(() => parseScheduledStartTimeInput('2026072420')).toThrow(/日期時間格式錯誤/);
    expect(() => parseScheduledStartTimeInput('2026072420001')).toThrow(/日期時間格式錯誤/);
  });

  it('rejects a completely different format (e.g. ISO 8601)', () => {
    expect(() => parseScheduledStartTimeInput('2026-07-24T20:00:00')).toThrow(/日期時間格式錯誤/);
  });

  it('rejects an empty or blank string', () => {
    expect(() => parseScheduledStartTimeInput('')).toThrow(/日期時間格式錯誤/);
    expect(() => parseScheduledStartTimeInput('   ')).toThrow(/日期時間格式錯誤/);
  });

  it('rejects non-string input instead of throwing an unrelated TypeError', () => {
    expect(() => parseScheduledStartTimeInput(undefined)).toThrow(/日期時間格式錯誤/);
    expect(() => parseScheduledStartTimeInput(null)).toThrow(/日期時間格式錯誤/);
  });

  it('the error message includes the exact example format from the spec ("202607242000")', () => {
    expect(() => parseScheduledStartTimeInput('bad input')).toThrow(/202607242000/);
  });
});
