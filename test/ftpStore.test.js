import { describe, expect, it } from 'vitest';
import { DEFAULT_FTP, loadFtp, saveFtp } from '../src/ui/ftpStore.js';

/** Minimal fake Storage so tests don't depend on/leak into a shared localStorage instance. */
function makeFakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

describe('loadFtp', () => {
  it('returns null when nothing has been saved yet', () => {
    expect(loadFtp(makeFakeStorage())).toBeNull();
  });

  it('returns the saved FTP as a number', () => {
    const storage = makeFakeStorage({ user_ftp: '250' });
    expect(loadFtp(storage)).toBe(250);
  });

  it('rounds a non-integer stored value', () => {
    const storage = makeFakeStorage({ user_ftp: '250.7' });
    expect(loadFtp(storage)).toBe(251);
  });

  it('returns null for corrupted/invalid stored values (non-numeric, zero, negative)', () => {
    expect(loadFtp(makeFakeStorage({ user_ftp: 'not-a-number' }))).toBeNull();
    expect(loadFtp(makeFakeStorage({ user_ftp: '0' }))).toBeNull();
    expect(loadFtp(makeFakeStorage({ user_ftp: '-50' }))).toBeNull();
  });
});

describe('saveFtp', () => {
  it('round-trips through loadFtp', () => {
    const storage = makeFakeStorage();
    saveFtp(220, storage);
    expect(loadFtp(storage)).toBe(220);
  });

  it('rounds before saving', () => {
    const storage = makeFakeStorage();
    saveFtp(199.6, storage);
    expect(loadFtp(storage)).toBe(200);
  });
});

describe('DEFAULT_FTP', () => {
  it('is a positive number usable as a fallback', () => {
    expect(DEFAULT_FTP).toBeGreaterThan(0);
  });
});
