import { describe, expect, it } from 'vitest';
import { formatMinuteSecondLabel } from '../src/ui/formatTime.js';

describe('formatMinuteSecondLabel', () => {
  it('formats a whole number of minutes as "X 分鐘", matching the "下一組：5 分鐘 · 75% FTP" example', () => {
    expect(formatMinuteSecondLabel(300)).toBe('5 分鐘');
  });

  it('formats a sub-minute duration as "X 秒"', () => {
    expect(formatMinuteSecondLabel(30)).toBe('30 秒');
  });

  it('formats a mixed minutes+seconds duration as "X 分 Y 秒"', () => {
    expect(formatMinuteSecondLabel(90)).toBe('1 分 30 秒');
  });

  it('formats zero as "0 秒"', () => {
    expect(formatMinuteSecondLabel(0)).toBe('0 秒');
  });

  it('rounds a fractional number of seconds', () => {
    expect(formatMinuteSecondLabel(29.6)).toBe('30 秒');
  });

  it('clamps a negative value to 0 seconds', () => {
    expect(formatMinuteSecondLabel(-5)).toBe('0 秒');
  });
});
