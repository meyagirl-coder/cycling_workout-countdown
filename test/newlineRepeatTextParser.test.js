import { describe, expect, it } from 'vitest';
import { stripBulletPrefix } from '../src/parser/newlineRepeatTextParser.js';

describe('stripBulletPrefix', () => {
  it('strips a "* " list bullet (regression: real-world copy/paste from a bulleted list)', () => {
    expect(stripBulletPrefix('* 10 min @ 53w')).toBe('10 min @ 53w');
  });

  it('strips other common bullet characters ("-", "•", "‣", "◦")', () => {
    expect(stripBulletPrefix('- 10 min @ 53w')).toBe('10 min @ 53w');
    expect(stripBulletPrefix('• 10 min @ 53w')).toBe('10 min @ 53w');
    expect(stripBulletPrefix('‣ 10 min @ 53w')).toBe('10 min @ 53w');
    expect(stripBulletPrefix('◦ 10 min @ 53w')).toBe('10 min @ 53w');
  });

  it('strips a bullet with no following space', () => {
    expect(stripBulletPrefix('*10 min @ 53w')).toBe('10 min @ 53w');
  });

  it('leaves a line with no bullet prefix unchanged', () => {
    expect(stripBulletPrefix('10 min @ 53w')).toBe('10 min @ 53w');
  });

  it('only strips a leading bullet, not one that appears mid-line', () => {
    expect(stripBulletPrefix('10 min @ 53w - recovery')).toBe('10 min @ 53w - recovery');
  });
});
