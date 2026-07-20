import { describe, expect, it } from 'vitest';
import { extractEventId } from '../src/integrations/intervalsIcu.js';

describe('extractEventId', () => {
  it('returns a bare numeric ID as-is', () => {
    expect(extractEventId('123456789')).toBe('123456789');
  });

  it('extracts the trailing numeric segment from a calendar event URL', () => {
    expect(extractEventId('https://intervals.icu/calendar/i123456/i987654321')).toBe('987654321');
  });

  it('extracts the numeric segment from a workout builder URL with extra path/query', () => {
    expect(extractEventId('https://intervals.icu/workouts/55512345/edit?tab=steps')).toBe('55512345');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(extractEventId('  42  ')).toBe('42');
  });

  it('returns null for empty, whitespace-only, or non-numeric input', () => {
    expect(extractEventId('')).toBeNull();
    expect(extractEventId('   ')).toBeNull();
    expect(extractEventId('https://intervals.icu/calendar')).toBeNull();
    expect(extractEventId(null)).toBeNull();
    expect(extractEventId(undefined)).toBeNull();
  });
});
