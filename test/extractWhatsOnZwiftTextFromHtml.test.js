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
        <div class="segment">3x 2min @ 105% FTP, 1min @ 90% FTP</div>
        <div class="segment">3min @ 51% FTP</div>
        <div class="segment">3x 2min @ 105% FTP, 1min @ 91% FTP</div>
        <div class="segment">5min from 70 to 40% FTP</div>
        <footer>© WhatsOnZwift</footer>
      </body></html>
    `;

    const text = extractWhatsOnZwiftTextFromHtml(html);
    expect(text).toBe(
      [
        '5min from 40 to 105% FTP',
        '2min @ 50% FTP',
        '3x 2min @ 105% FTP, 1min @ 90% FTP',
        '3min @ 51% FTP',
        '3x 2min @ 105% FTP, 1min @ 91% FTP',
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

  it('keeps inline-tag-wrapped fragments of a compound repeat line on one line', () => {
    const html = `<div><span>3x</span> <span>2min @ 105% FTP</span>, <span>1min @ 90% FTP</span></div>`;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('3x 2min @ 105% FTP, 1min @ 90% FTP');
  });

  it('strips <script> and <style> content entirely', () => {
    const html = `
      <script>const config = { note: "2min @ 999% FTP" };</script>
      <div>2min @ 50% FTP</div>
    `;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('2min @ 50% FTP');
  });

  it('preserves a gap between a compound repeat line and a following unrelated segment', () => {
    const html = `
      <div>3x 2min @ 105% FTP, 1min @ 90% FTP</div>
      <h3>Cool Down</h3>
      <div>5min from 70 to 40% FTP</div>
    `;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('3x 2min @ 105% FTP, 1min @ 90% FTP\n\n5min from 70 to 40% FTP');
  });

  it('returns an empty string when nothing resembling a WhatsOnZwift line is found anywhere (no loose fallback)', () => {
    const html = `<html><body><h1>404 Not Found</h1><p>2min at some other unrelated pace</p></body></html>`;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('');
  });

  it('does not fall back to loosely matching partial/embedded text (unlike the TrainerDay extractor)', () => {
    // A sentence that merely contains fragments resembling the format should not be picked up,
    // since WhatsOnZwift's compound repeat format is too easy to misassemble from loose fragments.
    const html = `<div>Step: 2min @ 50% FTP (recovery)</div>`;
    expect(extractWhatsOnZwiftTextFromHtml(html)).toBe('');
  });

  it('returns an empty string for non-string or blank input instead of throwing', () => {
    expect(extractWhatsOnZwiftTextFromHtml('')).toBe('');
    expect(extractWhatsOnZwiftTextFromHtml('   ')).toBe('');
    expect(extractWhatsOnZwiftTextFromHtml(null)).toBe('');
    expect(extractWhatsOnZwiftTextFromHtml(undefined)).toBe('');
  });
});
