import { describe, expect, it } from 'vitest';
import { extractTrainerDayWorkoutStructureFromHtml } from '../src/parser/extractTrainerDayWorkoutStructureFromHtml.js';
import { parseTrainerDayWorkoutStructureText } from '../src/parser/trainerDayWorkoutStructureParser.js';

describe('extractTrainerDayWorkoutStructureFromHtml', () => {
  it('extracts workout lines rendered as their own block elements (strict mode)', () => {
    const html = `
      <html><body>
        <nav><a href="/login">Login</a><a href="/workouts">Workouts</a></nav>
        <h1>Ramp Up 5</h1>
        <div class="segment">5 min @ 50% (50w)</div>
        <div class="segment">5 min @ 55% (55w)</div>
        <div class="segment">5 min @ 60% (60w)</div>
        <footer>© TrainerDay</footer>
      </body></html>
    `;

    const text = extractTrainerDayWorkoutStructureFromHtml(html);
    expect(text).toBe('5 min @ 50% (50w)\n5 min @ 55% (55w)\n5 min @ 60% (60w)');
  });

  it('extracts from a table-row layout', () => {
    const html = `
      <table>
        <tr><td>5 min @ 50% (50w)</td></tr>
        <tr><td>5 min @ 55% (55w)</td></tr>
      </table>
    `;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('5 min @ 50% (50w)\n5 min @ 55% (55w)');
  });

  it('keeps inline-tag-wrapped fragments of the same row on one line (does not fragment on <span>)', () => {
    const html = `<div><span class="duration">5 min</span> <span class="at">@</span> <span class="pct">50%</span> <span class="watts">(50w)</span></div>`;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('5 min @ 50% (50w)');
  });

  it('splits on <br> within a block', () => {
    const html = `<div>5 min @ 50% (50w)<br>5 min @ 55% (55w)</div>`;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('5 min @ 50% (50w)\n5 min @ 55% (55w)');
  });

  it('preserves a "Nx" repeat block and its following lines in order', () => {
    const html = `
      <div>5 min @ 50% (50w)</div>
      <div>3x</div>
      <div>2 min @ 105% (210w)</div>
      <div>1 min @ 50% (100w)</div>
      <div>5 min @ 45% (90w)</div>
    `;
    const text = extractTrainerDayWorkoutStructureFromHtml(html);
    expect(text).toBe('5 min @ 50% (50w)\n3x\n2 min @ 105% (210w)\n1 min @ 50% (100w)\n5 min @ 45% (90w)');
  });

  describe('nested lists (real "4X interval block" page rendering)', () => {
    it('separates a repeat declaration from its nested <ul> sub-items instead of gluing them onto one line (regression: the <li> holding "4X" never closes before the nested list opens)', () => {
      // <li><b>4X</b><ul><li>...</li>...</ul></li> - the outer <li> has no closing
      // tag between "4X" and the nested <ul>, so only BLOCK_CLOSE_RE (closing tags)
      // can't separate them; the nested <ul>'s own OPENING tag must also count as
      // a line boundary, or "4X" and the first nested item end up concatenated onto
      // a single unrecognizable line and get silently dropped by the strict-mode filter.
      const html = `
        <ul>
          <li>Active 5 min @ 50% (50w) 80 rpm</li>
          <li><b>4X</b>
            <ul>
              <li>Active 1 min @ 100% (100w) 90 rpm</li>
              <li>Rest 4 min @ 90% (90w) 95 rpm</li>
            </ul>
          </li>
          <li>Cooldown 5 min @ 50% (50w) 80 rpm</li>
        </ul>
      `;
      const text = extractTrainerDayWorkoutStructureFromHtml(html);
      const lines = text.split('\n');
      expect(lines).toContain('4X');
      expect(lines).toContain('Active 1 min @ 100% (100w) 90 rpm');
      expect(lines).toContain('Rest 4 min @ 90% (90w) 95 rpm');
    });

    it('does not introduce a spurious blank line between sibling block elements that have nothing between them (regression guard for the fix above)', () => {
      // Must not treat every adjacent pair of block elements as if something was
      // omitted between them - only genuine nested-list openings should split lines.
      const html = '<div>5 min @ 50% (50w)</div><div>5 min @ 55% (55w)</div><div>5 min @ 60% (60w)</div>';
      expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('5 min @ 50% (50w)\n5 min @ 55% (55w)\n5 min @ 60% (60w)');
    });

    it('parses the full user-provided "4X interval block" example end to end straight from realistic nested-<ul> HTML (19 intervals, 58 minutes)', () => {
      const html = `
        <ul>
          <li>Active 5 min @ 50% (50w) 80 rpm</li>
          <li><b>4X</b>
            <ul>
              <li>Active 1 min @ 100% (100w) 90 rpm</li>
              <li>Rest 4 min @ 90% (90w) 95 rpm</li>
            </ul>
          </li>
          <li>Active 8 min @ 50% (50w) 85 rpm</li>
          <li><b>4X</b>
            <ul>
              <li>Active 1 min @ 100% (100w) 90 rpm</li>
              <li>Rest 4 min @ 90% (90w) 95 rpm</li>
            </ul>
          </li>
          <li>Cooldown 5 min @ 50% (50w) 80 rpm</li>
        </ul>
      `;
      const text = extractTrainerDayWorkoutStructureFromHtml(html);
      const workout = parseTrainerDayWorkoutStructureText(text);
      expect(workout.intervals).toHaveLength(19);
      expect(workout.totalDuration).toBe(58 * 60);
    });
  });

  it('strips <script> and <style> content entirely (does not pick up unrelated numbers from JS/CSS)', () => {
    const html = `
      <style>.foo { width: 10px; }</style>
      <script>const config = { retries: 3, timeout: "5 min @ 1% (1w)" };</script>
      <div>5 min @ 50% (50w)</div>
    `;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('5 min @ 50% (50w)');
  });

  it('decodes common HTML entities', () => {
    const html = `<div>5 min &#64; 50% (50w)</div><div>5 min @ 55% (55w) &amp; more</div>`;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toContain('5 min @ 50% (50w)');
  });

  it('is case-insensitive and collapses extra inline whitespace like a browser would render it', () => {
    const html = `<div>  5   MIN   @   50%   (50W)  </div>`;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('5 MIN @ 50% (50W)');
  });

  it('falls back to loose (non-full-line) extraction when no line matches exactly', () => {
    const html = `<div>Step: 5 min @ 50% (50w) (endurance)</div><div>Step: 5 min @ 55% (55w) (tempo)</div>`;
    const text = extractTrainerDayWorkoutStructureFromHtml(html);
    expect(text).toBe('5 min @ 50% (50w)\n5 min @ 55% (55w)');
  });

  it('loose fallback preserves the order of interleaved "Nx" markers and interval fragments', () => {
    const html = `<div>Warmup: 5 min @ 50% (50w)</div><div>Repeat 3x block:</div><div>go 2 min @ 105% (210w) then 1 min @ 50% (100w)</div>`;
    const text = extractTrainerDayWorkoutStructureFromHtml(html);
    expect(text).toBe('5 min @ 50% (50w)\n3x\n2 min @ 105% (210w)\n1 min @ 50% (100w)');
  });

  it('returns an empty string when nothing resembling a workout line is found anywhere', () => {
    const html = `<html><body><h1>404 Not Found</h1><p>This page does not exist.</p></body></html>`;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('');
  });

  it('does NOT pick up the older "X min @ Yw" format (no percent sign, no parens) - that format is not what this extractor targets', () => {
    const html = `<div>10 min @ 53w</div>`;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('');
  });

  it('returns an empty string for non-string or blank input instead of throwing', () => {
    expect(extractTrainerDayWorkoutStructureFromHtml('')).toBe('');
    expect(extractTrainerDayWorkoutStructureFromHtml('   ')).toBe('');
    expect(extractTrainerDayWorkoutStructureFromHtml(null)).toBe('');
    expect(extractTrainerDayWorkoutStructureFromHtml(undefined)).toBe('');
  });

  it('prefers strict extraction over loose when both would find something', () => {
    const html = `
      <div>5 min @ 50% (50w)</div>
      <div>5 min @ 55% (55w)</div>
      <footer>Your FTP estimate: 250w, based on 5 min @ 100% (250w) test</footer>
    `;
    expect(extractTrainerDayWorkoutStructureFromHtml(html)).toBe('5 min @ 50% (50w)\n5 min @ 55% (55w)');
  });

  it('extracts a status-labeled, cadence-suffixed line and a bold "**4X**" repeat declaration in strict mode (real "4X interval block" page rendering)', () => {
    const html = `
      <div>- Active 5 min @ 50% (50w) 80 rpm</div>
      <div>- **4X**</div>
      <div>* Active 1 min @ 100% (100w) 90 rpm</div>
      <div>* Rest 4 min @ 90% (90w) 95 rpm</div>
    `;
    const text = extractTrainerDayWorkoutStructureFromHtml(html);
    expect(text).toBe(
      [
        '- Active 5 min @ 50% (50w) 80 rpm',
        '- **4X**',
        '* Active 1 min @ 100% (100w) 90 rpm',
        '* Rest 4 min @ 90% (90w) 95 rpm',
      ].join('\n')
    );
    const workout = parseTrainerDayWorkoutStructureText(text);
    expect(workout.intervals).toHaveLength(9); // 1 + 4x2
  });

  it('extracts the full 12-line user-provided "ramp-up-5" example and it parses correctly end to end', () => {
    const html = [
      '<div>5 min @ 50% (50w)</div>',
      '<div>5 min @ 55% (55w)</div>',
      '<div>5 min @ 60% (60w)</div>',
      '<div>5 min @ 65% (65w)</div>',
      '<div>5 min @ 70% (70w)</div>',
      '<div>5 min @ 75% (75w)</div>',
      '<div>5 min @ 80% (80w)</div>',
      '<div>5 min @ 85% (85w)</div>',
      '<div>5 min @ 90% (90w)</div>',
      '<div>5 min @ 95% (95w)</div>',
      '<div>5 min @ 100% (100w)</div>',
      '<div>5 min @ 50% (50w)</div>',
    ].join('');

    const text = extractTrainerDayWorkoutStructureFromHtml(html);
    const workout = parseTrainerDayWorkoutStructureText(text);
    expect(workout.intervals).toHaveLength(12);
    expect(workout.intervals.map((iv) => iv.powerStart)).toEqual([50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 50]);
  });
});
