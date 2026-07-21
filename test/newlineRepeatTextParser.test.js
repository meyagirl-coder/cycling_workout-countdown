import { describe, expect, it } from 'vitest';
import { parseNewlineRepeatText, stripBulletPrefix } from '../src/parser/newlineRepeatTextParser.js';

/** dummy line parser for testing the shared state machine in isolation: "<label>" -> { label } */
function parseLabelLine(line) {
  return { label: line };
}

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

describe('parseNewlineRepeatText: repeat-block termination rule (blank line is the only terminator)', () => {
  it('the user-provided example: "2x" block of 2 lines, terminated by a blank line, followed by an independent line', () => {
    const text = ['2x', 'A', 'B', '', 'C'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B', 'C']);
  });

  it('does NOT repeat all lines up to the next "Nx"/end-of-text when there is a blank line partway through the block (regression: line count must not matter, only the blank line does)', () => {
    // Same shape as the example above but with 3 lines before the blank line - only "A", "B" belong
    // to the "2x" block; "C" is independent even though it's the 3rd content line, not the 2nd.
    const text = ['2x', 'A', 'B', '', 'C', 'D'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B', 'C', 'D']);
  });

  it('a bullet-prefixed line inside a repeat block still belongs to the block - the prefix does not affect block membership', () => {
    const text = ['2x', '* A', '* B', '', 'C'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B', 'C']);
  });

  it('a new "Nx" immediately after a repeat block (no blank line) still closes the previous block', () => {
    const text = ['2x', 'A', '3x', 'B'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'A', 'B', 'B', 'B']);
  });

  it('multiple independent lines in a row after a blank line are all independent, not repeated', () => {
    const text = ['2x', 'A', '', 'B', 'C', 'D'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'A', 'B', 'C', 'D']);
  });
});
