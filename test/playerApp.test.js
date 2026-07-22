import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initPlayerApp } from '../src/ui/playerApp.js';

/** jsdom has no real Worker; initPlayerApp only needs postMessage/onmessage to exist without throwing for these tests. */
class MockWorker {
  postMessage() {}
  terminate() {}
}

beforeEach(() => {
  vi.stubGlobal('Worker', MockWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function selectFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function setup() {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  initPlayerApp(root);
  return { root };
}

const VALID_ZWO = '<workout_file><workout><SteadyState Duration="60" Power="0.7" /></workout></workout_file>';

/**
 * jsdom's File implementation in this environment doesn't support .text() (throws
 * "not a function"), so a real `File`/`Blob` can't be read here. handleFileSelected()
 * only touches `.name` and `.text()` on whatever it's given, so a plain duck-typed
 * fake object exercises the exact same code path without depending on jsdom's Blob
 * support - this mirrors how a real browser's File behaves for the purposes of this
 * validation logic.
 */
function fakeFile(name, content) {
  return { name, text: () => Promise.resolve(content) };
}

describe('initPlayerApp: .zwo file upload validation (accept attribute intentionally removed, see uploadView.js)', () => {
  it('accepts a file named with a lowercase ".zwo" extension and parses it', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('my-workout.zwo', VALID_ZWO));

    await vi.waitFor(() => {
      expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    });
  });

  it('accepts a file named with an uppercase ".ZWO" extension (case-insensitive)', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('MY-WORKOUT.ZWO', VALID_ZWO));

    await vi.waitFor(() => {
      expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    });
  });

  it('rejects a file with a non-.zwo extension with a clear error, without attempting to parse it', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('photo.jpg', 'not xml at all, just some random text'));

    await vi.waitFor(() => {
      const errorEl = root.querySelector('.upload-error');
      expect(errorEl.classList.contains('hidden')).toBe(false);
    });

    expect(root.querySelector('.upload-error').textContent).toBe('這不是合法的 zwo 檔案，請選擇副檔名為 .zwo 的課表檔案。');
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
  });

  it('rejects a file with no extension at all', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('workout', VALID_ZWO));

    await vi.waitFor(() => {
      expect(root.querySelector('.upload-error').classList.contains('hidden')).toBe(false);
    });
    expect(root.querySelector('.upload-error').textContent).toContain('這不是合法的 zwo 檔案');
  });

  it('still surfaces the underlying parser error for a .zwo-named file with invalid content (extension check alone is not enough)', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('broken.zwo', 'this is not xml'));

    await vi.waitFor(() => {
      const errorEl = root.querySelector('.upload-error');
      expect(errorEl.classList.contains('hidden')).toBe(false);
    });

    expect(root.querySelector('.upload-error').textContent).toContain('無法解析這份 .zwo 檔案：');
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
  });
});

describe('initPlayerApp: 團體訓練排程 (group-ride scheduling)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  function setScheduleTime(root, text) {
    root.querySelector('.upload-schedule-input').value = text;
    root.querySelector('.upload-schedule-submit').click();
  }

  // 貼上課表文字內容全程同步（沒有 await file.text() 或 fetch），送出當下
  // loadWorkout() 就已經跑完，畫面切換不需要等 vi.waitFor。
  function submitPasteText(root, text) {
    root.querySelector('.upload-paste-textarea').value = text;
    root.querySelector('.upload-paste-form').dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('shows the waiting screen (not the player) when the scheduled time is in the future, with correct workout info and live countdown', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '20260724 10:05');
    submitPasteText(root, '5m 60%');

    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 5 分');
  });

  it('live-updates the countdown as time passes while waiting (即時更新)', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '20260724 10:05');
    submitPasteText(root, '5m 60%');
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 5 分');

    vi.advanceTimersByTime(2 * 60 * 1000); // 2 minutes pass
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 3 分');

    vi.advanceTimersByTime(2 * 60 * 1000); // another 2 minutes pass
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 1 分');
  });

  it('auto-transitions to the player screen the instant the scheduled time is reached, with no user click (時間一到自動觸發開始)', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '20260724 10:05');
    submitPasteText(root, '5m 60%');
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 1000); // exactly reach the scheduled time

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
  });

  it('starts playing immediately (skips the waiting screen) when the scheduled time is already in the past', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 10, 0));
    const { root } = setup();

    setScheduleTime(root, '20260724 10:00'); // 10 minutes in the past
    submitPasteText(root, '5m 60%');

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(true);
  });

  it('does not show the waiting screen when no start time was set (existing manual-start behavior is unchanged)', () => {
    const { root } = setup();
    submitPasteText(root, '5m 60%');

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
  });

  it('saves the schedule (workout + startTimestamp) to localStorage once a workout loads with a pending start time', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '20260724 10:05');
    submitPasteText(root, '5m 60%');

    const saved = JSON.parse(window.localStorage.getItem('scheduled_workout'));
    expect(saved.startTimestamp).toBe(new Date(2026, 6, 24, 10, 5, 0).getTime());
    expect(saved.workout.intervals).toHaveLength(1);
    expect(saved.workout.intervals[0].powerStart).toBe(60);
  });

  it('clears the saved localStorage schedule once the scheduled time triggers auto-start', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '20260724 10:05');
    submitPasteText(root, '5m 60%');
    expect(window.localStorage.getItem('scheduled_workout')).not.toBeNull();

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(window.localStorage.getItem('scheduled_workout')).toBeNull();
  });

  it('restores a future-scheduled waiting screen from localStorage on boot, with no user action required (localStorage 讀取排程正確)', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const workout = {
      id: 'restored-workout',
      name: 'Restored Group Ride',
      source: 'paste-percent',
      totalDuration: 300,
      intervals: [{ type: 'steady', duration: 300, powerStart: 60, powerEnd: 60, cadence: null }],
    };
    window.localStorage.setItem(
      'scheduled_workout',
      JSON.stringify({ workout, startTimestamp: new Date(2026, 6, 24, 10, 5, 0).getTime() })
    );

    const { root } = setup();

    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.waiting-workout-name').textContent).toBe('Restored Group Ride');
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 5 分');
  });

  it('immediately starts playing on boot when the restored schedule\'s time has already passed', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 10, 0));
    const workout = {
      id: 'restored-past-workout',
      name: 'Restored Past Ride',
      source: 'paste-percent',
      totalDuration: 300,
      intervals: [{ type: 'steady', duration: 300, powerStart: 60, powerEnd: 60, cadence: null }],
    };
    window.localStorage.setItem(
      'scheduled_workout',
      JSON.stringify({ workout, startTimestamp: new Date(2026, 6, 24, 10, 0, 0).getTime() })
    );

    const { root } = setup();

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
    expect(window.localStorage.getItem('scheduled_workout')).toBeNull();
  });

  it('does not restore anything on boot when no schedule was ever saved (shows the normal upload screen)', () => {
    const { root } = setup();
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
  });

  it('cancelling from the waiting screen returns to the upload screen and clears the saved schedule', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '20260724 10:05');
    submitPasteText(root, '5m 60%');
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(false);

    root.querySelector('.btn-cancel-schedule').click();

    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(false);
    expect(window.localStorage.getItem('scheduled_workout')).toBeNull();
  });

  it('does not auto-trigger anymore after the schedule was cancelled (the runtime ticker was actually stopped, not just hidden)', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '20260724 10:05');
    submitPasteText(root, '5m 60%');
    root.querySelector('.btn-cancel-schedule').click();

    vi.advanceTimersByTime(10 * 60 * 1000); // well past the (cancelled) scheduled time

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(false);
  });
});
