import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initPlayerApp } from '../src/ui/playerApp.js';
import { createWorkerRuntime } from '../src/worker/workerRuntime.js';

/** jsdom has no real Worker; initPlayerApp only needs postMessage/onmessage to exist without throwing for these tests. */
class MockWorker {
  postMessage() {}
  terminate() {}
}

/**
 * 跟上面的 MockWorker 不同，這支是「真的會動」的假 Worker：內部接到真正的
 * createWorkerRuntime()，postMessage() 同步呼叫 runtime.handleMessage()，
 * runtime 送出的狀態再同步回呼 this.onmessage —— 讓 client.onUpdate() 真的
 * 會觸發、engine 的 play/pause/tick 都是真實邏輯（連 setInterval 節奏也是
 * 真的，可以用 vi.advanceTimersByTime() 控制），只是省去真的開一個 Worker
 * 執行緒。只有「頁面狀態保存」這個 describe 需要真實的狀態變化（存
 * localStorage 靠 client.onUpdate() 觸發），其餘測試都還是用上面單純的
 * no-op MockWorker 就夠了。
 */
class RealisticMockWorker {
  constructor() {
    this.onmessage = null;
    this.runtime = createWorkerRuntime({
      postMessage: (message) => {
        if (this.onmessage) this.onmessage({ data: message });
      },
    });
  }

  postMessage(message) {
    this.runtime.handleMessage(message);
  }

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

describe('initPlayerApp: 頁面狀態保存 (page state persistence across reload/tab-switch)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 22, 10, 0, 0));
    window.localStorage.clear();
    vi.stubGlobal('Worker', RealisticMockWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  // 貼上課表文字內容全程同步，不需要 vi.waitFor（同 「團體訓練排程」describe 的說明）。
  function submitPasteText(root, text) {
    root.querySelector('.upload-paste-textarea').value = text;
    root.querySelector('.upload-paste-form').dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('debounced-saves the URL/paste-text draft inputs and restores them on a simulated reload', () => {
    const { root } = setup();
    const urlInput = root.querySelector('.upload-url-input');
    const pasteTextarea = root.querySelector('.upload-paste-textarea');

    urlInput.value = 'https://app.trainerday.com/workouts/abc';
    urlInput.dispatchEvent(new Event('input'));
    pasteTextarea.value = '5m 60%';
    pasteTextarea.dispatchEvent(new Event('input'));

    // 還沒過 debounce 時間，不應該已經存進 localStorage
    expect(window.localStorage.getItem('upload_draft_inputs')).toBeNull();

    vi.advanceTimersByTime(500);
    expect(window.localStorage.getItem('upload_draft_inputs')).not.toBeNull();

    // 模擬「重新整理頁面」：全新的 root + 全新一次 initPlayerApp() 呼叫
    const { root: reloadedRoot } = setup();
    expect(reloadedRoot.querySelector('.upload-url-input').value).toBe('https://app.trainerday.com/workouts/abc');
    expect(reloadedRoot.querySelector('.upload-paste-textarea').value).toBe('5m 60%');
  });

  it('coalesces rapid edits into a single debounced save carrying both fields\' latest values', () => {
    const { root } = setup();
    const urlInput = root.querySelector('.upload-url-input');
    const pasteTextarea = root.querySelector('.upload-paste-textarea');

    urlInput.value = 'https://app.trainerday.com/workouts/a';
    urlInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(100);
    urlInput.value = 'https://app.trainerday.com/workouts/abc';
    urlInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(100);
    pasteTextarea.value = '5m 60%';
    pasteTextarea.dispatchEvent(new Event('input'));

    expect(window.localStorage.getItem('upload_draft_inputs')).toBeNull();
    vi.advanceTimersByTime(500);

    const saved = JSON.parse(window.localStorage.getItem('upload_draft_inputs'));
    expect(saved.url).toBe('https://app.trainerday.com/workouts/abc');
    expect(saved.pasteText).toBe('5m 60%');
  });

  it('persists the workout + progress on every update, and restores to the player screen paused at the same point after a simulated reload', () => {
    const { root } = setup();
    submitPasteText(root, '5m 60%');
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    const workoutName = root.querySelector('.workout-name').textContent;

    // 剛載入、還沒按播放：課表資料本身就已經存進 localStorage，進度是 idle/0
    const savedAfterLoad = JSON.parse(window.localStorage.getItem('workout_progress'));
    expect(savedAfterLoad.workout.intervals).toHaveLength(1);
    expect(savedAfterLoad.status).toBe('idle');
    expect(savedAfterLoad.elapsedTotal).toBe(0);

    // 開始播放，經過 1 秒（5 個 200ms tick）
    root.querySelector('.btn-play-pause').click();
    vi.advanceTimersByTime(1000);

    const savedWhileRunning = JSON.parse(window.localStorage.getItem('workout_progress'));
    expect(savedWhileRunning.status).toBe('running');
    expect(savedWhileRunning.elapsedTotal).toBeGreaterThan(0);

    // 模擬「重新整理頁面」：全新的 root + 全新一次 initPlayerApp() 呼叫
    const { root: reloadedRoot } = setup();

    expect(reloadedRoot.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    expect(reloadedRoot.querySelector('.upload-mount').classList.contains('hidden')).toBe(true);
    expect(reloadedRoot.querySelector('.workout-name').textContent).toBe(workoutName);
    // 規格：重新整理後不會自動恢復播放，一律停在「已暫停」，但課表跟進度要還在
    expect(reloadedRoot.querySelector('.interval-progress').textContent).toContain('已暫停');
    expect(reloadedRoot.querySelector('.elapsed-time').textContent).toContain(String(Math.floor(savedWhileRunning.elapsedTotal)));

    const savedAfterReload = JSON.parse(window.localStorage.getItem('workout_progress'));
    expect(savedAfterReload.status).toBe('paused');
    expect(savedAfterReload.elapsedTotal).toBe(savedWhileRunning.elapsedTotal);
  });

  it('clears the saved workout progress when returning home, so a subsequent reload shows the upload screen again', () => {
    const { root } = setup();
    submitPasteText(root, '5m 60%');
    expect(window.localStorage.getItem('workout_progress')).not.toBeNull();

    root.querySelector('.btn-return-home').click();

    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(false);
    expect(window.localStorage.getItem('workout_progress')).toBeNull();

    // 模擬「重新整理頁面」：沒有殘留進度可以復原，應該正常顯示上傳畫面
    const { root: reloadedRoot } = setup();
    expect(reloadedRoot.querySelector('.upload-mount').classList.contains('hidden')).toBe(false);
    expect(reloadedRoot.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
  });
});
