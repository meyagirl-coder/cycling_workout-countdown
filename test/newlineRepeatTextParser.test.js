import { describe, expect, it } from 'vitest';
import { parseNewlineRepeatText, stripBulletPrefix, stripMarkdownBold } from '../src/parser/newlineRepeatTextParser.js';

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

describe('stripMarkdownBold', () => {
  it('strips a "**...**" bold wrapper around a repeat declaration (TrainerDay "Workout structure" Markdown rendering)', () => {
    expect(stripMarkdownBold('**4X**')).toBe('4X');
  });

  it('strips "**" markers that appear anywhere in the line, not just at the very start/end', () => {
    expect(stripMarkdownBold('- **4X**')).toBe('- 4X');
  });

  it('leaves a line with no "**" unchanged', () => {
    expect(stripMarkdownBold('4x')).toBe('4x');
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

describe('parseNewlineRepeatText: indentation can also terminate a repeat block (no blank line needed)', () => {
  it('a deeper-indented block body, followed by a same-indent line with no blank line in between, still ends the block', () => {
    // Mirrors TrainerDay's "Workout structure" Markdown rendering: "2x" (indent 0),
    // body lines indented two spaces, then straight back to an unindented line - no blank line anywhere.
    const text = ['2x', '  A', '  B', 'C'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B', 'C']);
  });

  it('two indented repeat blocks back to back with an unindented line between them, no blank lines anywhere', () => {
    const text = ['2x', '  A', '  B', 'independent', '3x', '  C'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B', 'independent', 'C', 'C', 'C']);
  });

  it('does not apply the indent-boundary rule when every body line has the same indent as the "Nx" line (flat format keeps its old blank-line-only behavior)', () => {
    // Regression: must not start ending flat-format blocks after just one line once no line is ever
    // more indented than the header - this is the pre-existing (and much more common) format.
    const text = ['2x', 'A', 'B', 'C'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
  });

  it('an indented block that runs to the end of the text (no trailing line to trigger the boundary) still flushes correctly', () => {
    const text = ['2x', '  A', '  B'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('a blank line still works as a terminator even for an indented block (both rules coexist)', () => {
    const text = ['2x', '  A', '  B', '', 'C'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B', 'C']);
  });
});

describe('parseNewlineRepeatText: third repeat form - the self-contained bracket declaration "NX (seg1 | seg2 | ...)"', () => {
  it('expands a bracket repeat declaration on its own, independent of any blank-line/indent state', () => {
    const text = ['3x (A | B)'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
  });

  it('accepts an uppercase "X" and any number of "|"-separated segments (not just 2)', () => {
    const text = ['2X (A | B | C)'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
  });

  it('a bracket line surrounded by independent lines (before and after) parses each independently, in order', () => {
    const text = ['before', '3x (A | B)', 'after'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['before', 'A', 'B', 'A', 'B', 'A', 'B', 'after']);
  });

  it('a bracket line flushes a still-open newline-style "Nx" block first, acting as an implicit boundary', () => {
    const text = ['2x', 'A', 'B', '3x (C | D)'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    // "2x" has no blank line before the bracket line, but the bracket line itself must still close it out.
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B', 'C', 'D', 'C', 'D', 'C', 'D']);
  });

  it('strips bullet prefixes and Markdown bold from each bracket segment individually', () => {
    const text = ['2x (- **A** | * B)'].join('\n');
    const result = parseNewlineRepeatText(text, parseLabelLine, '"<label>"');
    expect(result.map((r) => r.label)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('throws a clear, segment-specific error when a bracket segment does not match the expected format', () => {
    const parseOnlyDigits = (line) => (/^\d+$/.test(line) ? { label: line } : null);
    const text = ['2x (1 | not-a-digit)'];
    expect(() => parseNewlineRepeatText(text.join('\n'), parseOnlyDigits, '"<digits>"')).toThrow(
      /segment \("not-a-digit"\) that does not match the expected "<digits>" format/
    );
  });

  it('throws on a zero or negative bracket repeat count', () => {
    expect(() => parseNewlineRepeatText('0x (A)', parseLabelLine, '"<label>"')).toThrow(/invalid repeat count/);
  });
});
