import { describe, expect, it } from 'vitest';
import { ALERT_MODE_BEEP, ALERT_MODE_VOICE, DEFAULT_ALERT_MODE, loadAlertMode, saveAlertMode, VALID_ALERT_MODES } from '../src/ui/alertModeStore.js';

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

describe('loadAlertMode', () => {
  it('returns the default mode ("voice") when nothing has been saved yet', () => {
    expect(loadAlertMode(makeFakeStorage())).toBe('voice');
    expect(loadAlertMode(makeFakeStorage())).toBe(DEFAULT_ALERT_MODE);
  });

  it.each(['voice', 'beep'])('returns the saved mode "%s"', (mode) => {
    const storage = makeFakeStorage({ countdown_alert_mode: mode });
    expect(loadAlertMode(storage)).toBe(mode);
  });

  it('falls back to the default when the stored value is not a valid mode (corrupted/unexpected data)', () => {
    expect(loadAlertMode(makeFakeStorage({ countdown_alert_mode: 'both' }))).toBe('voice');
    expect(loadAlertMode(makeFakeStorage({ countdown_alert_mode: '' }))).toBe('voice');
  });
});

describe('saveAlertMode', () => {
  it.each(['voice', 'beep'])('round-trips "%s" through loadAlertMode', (mode) => {
    const storage = makeFakeStorage();
    saveAlertMode(mode, storage);
    expect(loadAlertMode(storage)).toBe(mode);
  });

  it('throws on an invalid mode value instead of silently saving garbage', () => {
    const storage = makeFakeStorage();
    expect(() => saveAlertMode('both', storage)).toThrow(/invalid mode/);
  });
});

describe('ALERT_MODE_VOICE / ALERT_MODE_BEEP / VALID_ALERT_MODES', () => {
  it('lists exactly voice and beep, mutually exclusive', () => {
    expect(ALERT_MODE_VOICE).toBe('voice');
    expect(ALERT_MODE_BEEP).toBe('beep');
    expect(VALID_ALERT_MODES).toEqual(['voice', 'beep']);
  });
});

describe('a real window.localStorage smoke test (default storage argument)', () => {
  it('saveAlertMode/loadAlertMode work against the real localStorage when no storage argument is given', () => {
    window.localStorage.removeItem('countdown_alert_mode');
    expect(loadAlertMode()).toBe('voice');

    saveAlertMode('beep');
    expect(loadAlertMode()).toBe('beep');
    expect(window.localStorage.getItem('countdown_alert_mode')).toBe('beep');

    window.localStorage.removeItem('countdown_alert_mode');
  });
});
