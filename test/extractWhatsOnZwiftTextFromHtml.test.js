import { describe, expect, it } from 'vitest';
import { extractWhatsOnZwiftTextFromHtml } from '../src/parser/extractWhatsOnZwiftTextFromHtml.js';
import { parseWhatsOnZwiftText } from '../src/parser/whatsOnZwiftParser.js';

describe('extractWhatsOnZwiftTextFromHtml', () => {
  it('extracts the full Over-Unders example from block-per-row markup and matches the page\'s "Duration: 33m"', () => {
    const html = `
      <html><body>
        <nav><a href="/login">Login</a></nav>
        <h1>Over-Unders</h1>
        <div class="segment">5min from 40 to 105% FTP</div>
        <div class="segment">2min @ 50% FTP</div>
        <div class="segment">3x 2min @ 105% FTP,</div>
        <div class="segment">1min @ 90% FTP</div>
        <div class="segment">3min @ 51% FTP</div>
        <div class="segment">3x 2min @ 105% FTP,</div>
        <div class="segment">1min @ 91% FTP</div>
        <div class="segment">5min from 70 to 40% FTP</div>
        <footer>© WhatsOnZwift</footer>
      </body></html>
    `;

    const text = extractWhatsOnZwiftTextFromHtml(html);
    expect(text).toBe(
      [
        '5min from 40 to 105% FTP',
        '2min @ 50% FTP',
        '3x 2min @ 105% FTP,',
        '1min @ 90% FTP',
        '3min @ 51% FTP',
        '3x 2min @ 105% FTP,',
        '1min @ 91% FTP',
        '5min from 70 to 40% FTP',
      ].join('\n')
    );

    const workout = parseWhatsOnZwiftText(text);
    expect(workout.totalDuration).toBe(33 * 60);
    expect(workout.intervals).toHaveLength(16);
  });

  it('extracts from a table-row layout', () => {
    const html = `
      <table>
        <tr><td>2min @ 50% FTP</td></tr>
        <tr><td>3min @ 51% FTP</td></tr>
      </table>
    `;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('2min @ 50% FTP\n3min @ 51% FTP');
  });

  it('keeps inline-tag-wrapped fragments of each half of a repeat block on one line', () => {
    const html = `<div><span>3x</span> <span>2min @ 105% FTP</span>,</div><div><span>1min @ 90% FTP</span></div>`;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('3x 2min @ 105% FTP,\n1min @ 90% FTP');
  });

  it('strips <script> and <style> content entirely', () => {
    const html = `
      <script>const config = { note: "2min @ 999% FTP" };</script>
      <div>2min @ 50% FTP</div>
    `;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('2min @ 50% FTP');
  });

  it('preserves a gap between the second half of a repeat block and a following unrelated segment', () => {
    const html = `
      <div>3x 2min @ 105% FTP,</div>
      <div>1min @ 90% FTP</div>
      <h3>Cool Down</h3>
      <div>5min from 70 to 40% FTP</div>
    `;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('3x 2min @ 105% FTP,\n1min @ 90% FTP\n\n5min from 70 to 40% FTP');
  });

  it('preserves a gap between the two halves of a repeat block if the source separates them, and parseWhatsOnZwiftText still parses it correctly', () => {
    // Some intervening block-level content (e.g. an empty wrapper) between the two rows -
    // the extractor keeps it as a blank line, and parseWhatsOnZwiftText tolerates blank
    // lines even in the middle of a repeat block (see whatsOnZwiftParser.test.js).
    const html = `<div>3x 2min @ 105% FTP,</div><p></p><div>1min @ 90% FTP</div>`;
    const text = extractWhatsOnZwiftTextFromHtml(html);
    expect(text).toBe('3x 2min @ 105% FTP,\n\n1min @ 90% FTP');

    const workout = parseWhatsOnZwiftText(text);
    expect(workout.intervals).toHaveLength(6);
  });

  it('returns an empty string when nothing resembling a WhatsOnZwift line is found anywhere (no loose fallback)', () => {
    const html = `<html><body><h1>404 Not Found</h1><p>2min at some other unrelated pace</p></body></html>`;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('');
  });

  it('does not fall back to loosely matching partial/embedded text (unlike the TrainerDay extractors)', () => {
    // A sentence that merely contains fragments resembling the format should not be picked up,
    // since WhatsOnZwift's compound repeat format is too easy to misassemble from loose fragments.
    const html = `<div>Step: 2min @ 50% FTP (recovery)</div>`;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('');
  });

  it('does not pick up a single line with a comma in the middle as the old (wrong) one-line compound format', () => {
    const html = `<div>3x 2min @ 105% FTP, 1min @ 90% FTP</div>`;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('');
  });

  it('does NOT pick up the TrainerDay "Workout structure" format (parenthesized watts) - these are different sites with different formats', () => {
    const html = `<div>5 min @ 50% (50w)</div>`;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('');
  });

  it('returns an empty string for non-string or blank input instead of throwing', () => {
    expect(extractWhatsOnZwiftTextFromHtml('')).toBe('');
    expect(extractWhatsOnZwiftTextFromHtml('   ')).toBe('');
    expect(extractWhatsOnZwiftTextFromHtml(null)).toBe('');
    expect(extractWhatsOnZwiftTextFromHtml(undefined)).toBe('');
  });
});
