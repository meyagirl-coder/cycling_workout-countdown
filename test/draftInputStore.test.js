import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraftInputs, loadDraftInputs, saveDraftInputs } from '../src/ui/draftInputStore.js';

/** Minimal fake Storage so tests don't depend on/leak into a shared localStorage instance. */
function makeFakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

describe('loadDraftInputs', () => {
  it('returns null when nothing has been saved yet', () => {
    expect(loadDraftInputs(makeFakeStorage())).toBeNull();
  });

  it('round-trips both fields through saveDraftInputs', () => {
    const storage = makeFakeStorage();
    saveDraftInputs({ url: 'https://app.trainerday.com/workouts/abc', pasteText: '5m 50%' }, storage);
    expect(loadDraftInputs(storage)).toEqual({ url: 'https://app.trainerday.com/workouts/abc', pasteText: '5m 50%' });
  });

  it('round-trips when only one field has content', () => {
    const storage = makeFakeStorage();
    saveDraftInputs({ url: '', pasteText: '5m 50%' }, storage);
    expect(loadDraftInputs(storage)).toEqual({ url: '', pasteText: '5m 50%' });
  });

  it('returns null when both fields are empty (nothing meaningful to restore)', () => {
    const storage = makeFakeStorage();
    saveDraftInputs({ url: '', pasteText: '' }, storage);
    expect(loadDraftInputs(storage)).toBeNull();
  });

  it('returns null for corrupted JSON', () => {
    expect(loadDraftInputs(makeFakeStorage({ upload_draft_inputs: 'not json' }))).toBeNull();
  });

  it('returns null when the saved payload is not from today (expired)', () => {
    const storage = makeFakeStorage({
      upload_draft_inputs: JSON.stringify({ url: 'https://example.com', pasteText: '', savedAtDate: '2000-01-01' }),
    });
    expect(loadDraftInputs(storage)).toBeNull();
  });

  it('treats a missing/non-string field as an empty string rather than throwing', () => {
    const storage = makeFakeStorage({
      upload_draft_inputs: JSON.stringify({ pasteText: '5m 50%', savedAtDate: todayString() }),
    });
    expect(loadDraftInputs(storage)).toEqual({ url: '', pasteText: '5m 50%' });
  });
});

describe('clearDraftInputs', () => {
  it('removes the stored draft so a subsequent load returns null', () => {
    const storage = makeFakeStorage();
    saveDraftInputs({ url: 'https://example.com', pasteText: '' }, storage);
    clearDraftInputs(storage);
    expect(loadDraftInputs(storage)).toBeNull();
  });
});

describe('saveDraftInputs: real window.localStorage smoke test (default storage argument)', () => {
  beforeEach(() => {
    window.localStorage.removeItem('upload_draft_inputs');
  });

  afterEach(() => {
    window.localStorage.removeItem('upload_draft_inputs');
  });

  it('saves and loads against the real localStorage when no storage argument is given', () => {
    saveDraftInputs({ url: 'https://app.trainerday.com/workouts/abc', pasteText: '5m 50%' });
    expect(loadDraftInputs()).toEqual({ url: 'https://app.trainerday.com/workouts/abc', pasteText: '5m 50%' });
  });
});

describe('savedAtDate day-boundary behavior (system-clock dependent)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a draft saved "today" via saveDraftInputs() is still loadable at the same instant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T10:00:00'));
    const storage = makeFakeStorage();
    saveDraftInputs({ url: 'https://example.com', pasteText: '' }, storage);
    expect(loadDraftInputs(storage)).toEqual({ url: 'https://example.com', pasteText: '' });
  });

  it('a draft saved "yesterday" is expired once the clock rolls over to a new day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T23:59:00'));
    const storage = makeFakeStorage();
    saveDraftInputs({ url: 'https://example.com', pasteText: '' }, storage);

    vi.setSystemTime(new Date('2026-07-22T00:01:00'));
    expect(loadDraftInputs(storage)).toBeNull();
  });
});
