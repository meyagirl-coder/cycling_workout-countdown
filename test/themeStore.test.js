import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, loadTheme, saveTheme, VALID_THEMES } from '../src/ui/themeStore.js';

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

describe('loadTheme', () => {
  it('returns the default theme ("auto") when nothing has been saved yet', () => {
    expect(loadTheme(makeFakeStorage())).toBe('auto');
    expect(loadTheme(makeFakeStorage())).toBe(DEFAULT_THEME);
  });

  it.each(['dark', 'light', 'auto'])('returns the saved theme "%s"', (theme) => {
    const storage = makeFakeStorage({ user_theme: theme });
    expect(loadTheme(storage)).toBe(theme);
  });

  it('falls back to the default when the stored value is not a valid theme (corrupted/unexpected data)', () => {
    expect(loadTheme(makeFakeStorage({ user_theme: 'blue' }))).toBe('auto');
    expect(loadTheme(makeFakeStorage({ user_theme: '' }))).toBe('auto');
  });
});

describe('saveTheme', () => {
  it.each(['dark', 'light', 'auto'])('round-trips "%s" through loadTheme', (theme) => {
    const storage = makeFakeStorage();
    saveTheme(theme, storage);
    expect(loadTheme(storage)).toBe(theme);
  });

  it('throws on an invalid theme value instead of silently saving garbage', () => {
    const storage = makeFakeStorage();
    expect(() => saveTheme('purple', storage)).toThrow(/invalid theme/);
  });
});

describe('VALID_THEMES', () => {
  it('lists exactly dark, light, and auto', () => {
    expect(VALID_THEMES).toEqual(['dark', 'light', 'auto']);
  });
});

describe('a real window.localStorage smoke test (default storage argument)', () => {
  it('saveTheme/loadTheme work against the real localStorage when no storage argument is given', () => {
    window.localStorage.removeItem('user_theme');
    expect(loadTheme()).toBe('auto');

    saveTheme('dark');
    expect(loadTheme()).toBe('dark');
    expect(window.localStorage.getItem('user_theme')).toBe('dark');

    window.localStorage.removeItem('user_theme');
  });
});
