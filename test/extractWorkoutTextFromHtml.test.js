import { describe, expect, it } from 'vitest';
import { extractWorkoutTextFromHtml } from '../src/parser/extractWorkoutTextFromHtml.js';
import { parsePasteText } from '../src/parser/pasteTextParser.js';

describe('extractWorkoutTextFromHtml', () => {
  it('extracts workout lines rendered as their own block elements (strict mode)', () => {
    const html = `
      <html><body>
        <nav><a href="/login">Login</a><a href="/workouts">Workouts</a></nav>
        <h1>Ramp Up 5</h1>
        <div class="segment">10 min @ 53w</div>
        <div class="segment">20 min @ 68w</div>
        <div class="segment">15 min @ 85w</div>
        <footer>© TrainerDay</footer>
      </body></html>
    `;

    const text = extractWorkoutTextFromHtml(html);
    expect(text).toBe('10 min @ 53w\n20 min @ 68w\n15 min @ 85w');
  });

  it('extracts from a table-row layout', () => {
    const html = `
      <table>
        <tr><td>10 min @ 53w</td></tr>
        <tr><td>20 min @ 68w</td></tr>
      </table>
    `;
    expect(extractWorkoutTextFromHtml(html)).toBe('10 min @ 53w\n20 min @ 68w');
  });

  it('keeps inline-tag-wrapped fragments of the same row on one line (does not fragment on <span>)', () => {
    const html = `<div><span class="duration">10 min</span> <span class="at">@</span> <span class="power">53w</span></div>`;
    expect(extractWorkoutTextFromHtml(html)).toBe('10 min @ 53w');
  });

  it('splits on <br> within a block', () => {
    const html = `<div>10 min @ 53w<br>20 min @ 68w</div>`;
    expect(extractWorkoutTextFromHtml(html)).toBe('10 min @ 53w\n20 min @ 68w');
  });

  it('preserves a "Nx" repeat block and its following lines in order', () => {
    const html = `
      <div>10 min @ 53w</div>
      <div>3x</div>
      <div>1 min @ 150w</div>
      <div>1 min @ 50w</div>
      <div>10 min @ 45w</div>
    `;
    const text = extractWorkoutTextFromHtml(html);
    expect(text).toBe('10 min @ 53w\n3x\n1 min @ 150w\n1 min @ 50w\n10 min @ 45w');
  });

  it('keeps a "Nx" block from swallowing a following segment when the page separates them with other content (e.g. a section heading)', () => {
    // Realistic layout: warmup row, a "3x" repeat block, a "Cool Down" section
    // label, then the cooldown row - the heading in between is not itself a
    // workout line, but its presence signals a real boundary. parsePasteText()
    // only stops absorbing lines into an open repeat block at a blank line, the
    // next "Nx", or the end of the text, so that gap must survive extraction as
    // a blank line or the cooldown row would get merged into the repeat block.
    const html = `
      <div>10 min @ 53w</div>
      <div>3x</div>
      <div>1 min @ 150w</div>
      <div>1 min @ 50w</div>
      <h3>Cool Down</h3>
      <div>10 min @ 45w</div>
    `;
    const text = extractWorkoutTextFromHtml(html);
    expect(text).toBe('10 min @ 53w\n3x\n1 min @ 150w\n1 min @ 50w\n\n10 min @ 45w');

    const workout = parsePasteText(text);
    const warmup = { type: 'steady', duration: 600, powerStart: 53, powerEnd: 53, cadence: null };
    const on = { type: 'steady', duration: 60, powerStart: 150, powerEnd: 150, cadence: null };
    const off = { type: 'steady', duration: 60, powerStart: 50, powerEnd: 50, cadence: null };
    const cooldown = { type: 'steady', duration: 600, powerStart: 45, powerEnd: 45, cadence: null };
    expect(workout.intervals).toEqual([warmup, on, off, on, off, on, off, cooldown]);
  });

  it('documents a known limitation: a "Nx" block with zero separating content before the next row cannot be told apart from that row being part of the repeat (matches parsePasteText\'s own blank-line/next-Nx/end-of-text termination rule)', () => {
    const html = `
      <div>10 min @ 53w</div>
      <div>3x</div>
      <div>1 min @ 150w</div>
      <div>1 min @ 50w</div>
      <div>10 min @ 45w</div>
    `;
    const workout = parsePasteText(extractWorkoutTextFromHtml(html));
    // Without any structural gap in the source, the trailing row gets absorbed
    // into the repeat block 3 times instead of appearing once as a standalone
    // cooldown - this is the same behavior parsePasteText already has for
    // manually-pasted text with no blank line before a trailing segment.
    expect(workout.intervals).toHaveLength(1 + 3 * 3);
  });

  it('strips <script> and <style> content entirely (does not pick up unrelated numbers from JS/CSS)', () => {
    const html = `
      <style>.foo { width: 10px; }</style>
      <script>const config = { retries: 3, timeout: "5 min @ 1w" };</script>
      <div>10 min @ 53w</div>
    `;
    expect(extractWorkoutTextFromHtml(html)).toBe('10 min @ 53w');
  });

  it('decodes common HTML entities', () => {
    const html = `<div>10 min &#64; 53w</div><div>20 min @ 68w &amp; more</div>`;
    // &#64; decodes to "@", so the first line becomes a valid interval line again.
    expect(extractWorkoutTextFromHtml(html)).toContain('10 min @ 53w');
  });

  it('is case-insensitive and collapses extra inline whitespace like a browser would render it', () => {
    const html = `<div>  10   MIN   @   53W  </div>`;
    expect(extractWorkoutTextFromHtml(html)).toBe('10 MIN @ 53W');
  });

  it('falls back to loose (non-full-line) extraction when no line matches exactly', () => {
    // Simulates a page where the workout text is embedded inline within a larger sentence/row,
    // e.g. "Step: 10 min @ 53w (endurance)" - not an exact full-line match.
    const html = `<div>Step: 10 min @ 53w (endurance)</div><div>Step: 20 min @ 68w (tempo)</div>`;
    const text = extractWorkoutTextFromHtml(html);
    expect(text).toBe('10 min @ 53w\n20 min @ 68w');
  });

  it('loose fallback preserves the order of interleaved "Nx" markers and interval fragments', () => {
    const html = `<div>Warmup: 10 min @ 53w</div><div>Repeat 3x block:</div><div>go 1 min @ 150w then 1 min @ 50w</div>`;
    const text = extractWorkoutTextFromHtml(html);
    expect(text).toBe('10 min @ 53w\n3x\n1 min @ 150w\n1 min @ 50w');
  });

  it('returns an empty string when nothing resembling a workout line is found anywhere', () => {
    const html = `<html><body><h1>404 Not Found</h1><p>This page does not exist.</p></body></html>`;
    expect(extractWorkoutTextFromHtml(html)).toBe('');
  });

  it('returns an empty string for non-string or blank input instead of throwing', () => {
    expect(extractWorkoutTextFromHtml('')).toBe('');
    expect(extractWorkoutTextFromHtml('   ')).toBe('');
    expect(extractWorkoutTextFromHtml(null)).toBe('');
    expect(extractWorkoutTextFromHtml(undefined)).toBe('');
  });

  it('prefers strict extraction over loose when both would find something (avoids picking up loose false-positive noise once a clean strict match exists)', () => {
    const html = `
      <div>10 min @ 53w</div>
      <div>20 min @ 68w</div>
      <footer>Your FTP estimate: 250w over 20 min @ home</footer>
    `;
    // Strict mode only picks the two clean rows; the footer sentence isn't an exact-line match
    // so it's ignored entirely once strict mode already found real interval lines.
    expect(extractWorkoutTextFromHtml(html)).toBe('10 min @ 53w\n20 min @ 68w');
  });
});
