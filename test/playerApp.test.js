import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initPlayerApp } from '../src/ui/playerApp.js';
import { getLocalDateString } from '../src/utils/localDate.js';
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

    setScheduleTime(root, '202607241005');
    submitPasteText(root, '5m 60%');

    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 5分0秒');
  });

  it('live-updates the countdown every second as time passes while waiting (即時更新，精確到秒，不是只精確到分鐘)', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '202607241005');
    submitPasteText(root, '5m 60%');
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 5分0秒');

    vi.advanceTimersByTime(1000); // 1 second passes
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 4分59秒');

    vi.advanceTimersByTime(2 * 60 * 1000); // 2 more minutes pass
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 2分59秒');

    vi.advanceTimersByTime(2 * 60 * 1000); // another 2 minutes pass
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 59秒');
  });

  it('auto-transitions to the player screen the instant the scheduled time is reached, with no user click (時間一到自動觸發開始)', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '202607241005');
    submitPasteText(root, '5m 60%');
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 1000); // exactly reach the scheduled time

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
  });

  it('starts playing immediately (skips the waiting screen) when the scheduled time is already in the past', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 2, 0));
    const { root } = setup();

    setScheduleTime(root, '202607241000'); // 2 minutes in the past, workout is 5 minutes long
    submitPasteText(root, '5m 60%');

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(true);
  });

  it('jumps straight to the live "catch-up" position (elapsed = now - startTime), not a restart from 0, and is actively running (not paused) at that position (regression: a late joiner reported the player restarting from interval 1 / 0:00 instead of catching up to the group\'s actual progress)', () => {
    vi.stubGlobal('Worker', RealisticMockWorker);
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    // 10-minute workout, two 5-minute intervals; scheduled 7 minutes in the past ->
    // should land inside the 2nd interval, 2 minutes into it (420s elapsed)
    setScheduleTime(root, '202607240953'); // 09:53, 7 minutes before "now" (10:00)
    submitPasteText(root, '5m 60%\n5m 70%');

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.interval-progress').textContent).toContain('第 2 / 2 組');
    expect(root.querySelector('.interval-progress').textContent).toContain('進行中'); // actively running, not paused
    expect(root.querySelector('.elapsed-time').textContent).toContain('7:00'); // 7 minutes total elapsed
  });

  it('shows "課表已結束" and stays on the current screen instead of jumping to a nonexistent point when the elapsed time exceeds the workout\'s total duration', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 40, 0));
    const { root } = setup();

    setScheduleTime(root, '202607241000'); // 40 minutes in the past, but the workout is only 5 minutes long
    submitPasteText(root, '5m 60%');

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
    const errorEl = root.querySelector('.upload-error');
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/課表已結束/);
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

    setScheduleTime(root, '202607241005');
    submitPasteText(root, '5m 60%');

    const saved = JSON.parse(window.localStorage.getItem('scheduled_workout'));
    expect(saved.startTimestamp).toBe(new Date(2026, 6, 24, 10, 5, 0).getTime());
    expect(saved.workout.intervals).toHaveLength(1);
    expect(saved.workout.intervals[0].powerStart).toBe(60);
  });

  it('clears the saved localStorage schedule once the scheduled time triggers auto-start', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const { root } = setup();

    setScheduleTime(root, '202607241005');
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
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 5分0秒');
  });

  it('immediately starts playing on boot when the restored schedule\'s time has already passed', () => {
    vi.setSystemTime(new Date(2026, 6, 24, 10, 2, 0));
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

    setScheduleTime(root, '202607241005');
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

    setScheduleTime(root, '202607241005');
    submitPasteText(root, '5m 60%');
    root.querySelector('.btn-cancel-schedule').click();

    vi.advanceTimersByTime(10 * 60 * 1000); // well past the (cancelled) scheduled time

    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(false);
  });
});

describe('initPlayerApp: 一鍵開團連結 (group-join link via URL params: source/source_url/startTime)', () => {
  const TRAINERDAY_URL = 'https://app.trainerday.com/workouts/abc';
  const VALID_WORKOUT_STRUCTURE_TEXT = '5 min @ 50% (50w)';

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState(null, '', '/');
  });

  function setUrlSearch(search) {
    window.history.pushState(null, '', `/?${search}`);
  }

  function stubTrainerDayFetch() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => VALID_WORKOUT_STRUCTURE_TEXT });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('does nothing special (normal upload screen) when the URL has no group-join params at all', () => {
    const { root } = setup();
    expect(root.querySelector('.upload-mount').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.upload-ftp-prompt').classList.contains('hidden')).toBe(true);
  });

  it('shows a clear error for an unsupported source value, without attempting any fetch', () => {
    setUrlSearch('source=TP&source_url=' + encodeURIComponent(TRAINERDAY_URL) + '&startTime=202607242000');
    const fetchMock = stubTrainerDayFetch();
    const { root } = setup();

    expect(root.querySelector('.upload-error').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.upload-error').textContent).toMatch(/課表來源「TP」目前不支援/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a clear error for a malformed startTime, without attempting any fetch', () => {
    setUrlSearch('source=TD&source_url=' + encodeURIComponent(TRAINERDAY_URL) + '&startTime=2026-07-24');
    const fetchMock = stubTrainerDayFetch();
    const { root } = setup();

    expect(root.querySelector('.upload-error').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.upload-error').textContent).toMatch(/startTime 開始時間格式錯誤/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto-loads the workout and enters the waiting screen when FTP is already set and startTime is in the future', async () => {
    window.localStorage.setItem('user_ftp', '250');
    vi.setSystemTime(new Date(2026, 6, 24, 19, 0, 0));
    setUrlSearch('source=TD&source_url=' + encodeURIComponent(TRAINERDAY_URL) + '&startTime=202607242000');
    const fetchMock = stubTrainerDayFetch();

    const { root } = setup();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(false);
    });

    expect(root.querySelector('.upload-ftp-prompt').classList.contains('hidden')).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent(TRAINERDAY_URL));
  });

  it('auto-loads the workout and starts playing immediately when FTP is already set and startTime is already in the past', async () => {
    window.localStorage.setItem('user_ftp', '250');
    vi.setSystemTime(new Date(2026, 6, 24, 20, 2, 0));
    setUrlSearch('source=TD&source_url=' + encodeURIComponent(TRAINERDAY_URL) + '&startTime=202607242000');
    stubTrainerDayFetch();

    const { root } = setup();
    await vi.waitFor(() => {
      expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    });
    expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(true);
  });

  it('shows the FTP setup prompt (not an immediate fetch) when FTP has never been set on this device', () => {
    setUrlSearch('source=TD&source_url=' + encodeURIComponent(TRAINERDAY_URL) + '&startTime=202607242000');
    const fetchMock = stubTrainerDayFetch();

    const { root } = setup();

    expect(root.querySelector('.upload-ftp-prompt').classList.contains('hidden')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proceeds with the deferred group-join flow once the user types a valid FTP', async () => {
    setUrlSearch('source=TD&source_url=' + encodeURIComponent(TRAINERDAY_URL) + '&startTime=202607242000');
    const fetchMock = stubTrainerDayFetch();
    vi.setSystemTime(new Date(2026, 6, 24, 19, 0, 0));

    const { root } = setup();
    expect(root.querySelector('.upload-ftp-prompt').classList.contains('hidden')).toBe(false);

    const ftpInput = root.querySelector('.upload-ftp-input');
    ftpInput.value = '230';
    ftpInput.dispatchEvent(new Event('input'));

    expect(root.querySelector('.upload-ftp-prompt').classList.contains('hidden')).toBe(true);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(window.localStorage.getItem('user_ftp')).toBe('230');
  });

  it('proceeds with the deferred group-join flow using 100W when "先跳過" is clicked', async () => {
    setUrlSearch('source=TD&source_url=' + encodeURIComponent(TRAINERDAY_URL) + '&startTime=202607242000');
    const fetchMock = stubTrainerDayFetch();
    vi.setSystemTime(new Date(2026, 6, 24, 19, 0, 0));

    const { root } = setup();
    root.querySelector('.upload-ftp-skip-btn').click();

    expect(root.querySelector('.upload-ftp-prompt').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-ftp-input').value).toBe('100');
    expect(window.localStorage.getItem('user_ftp')).toBe('100');
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(root.querySelector('.waiting-mount').classList.contains('hidden')).toBe(false);
    });
  });

  it('does not process the URL params at all when a schedule or in-progress workout is already saved (avoids clobbering existing state)', () => {
    const workout = {
      id: 'existing-workout',
      name: 'Existing',
      source: 'paste-percent',
      totalDuration: 300,
      intervals: [{ type: 'steady', duration: 300, powerStart: 60, powerEnd: 60, cadence: null }],
    };
    window.localStorage.setItem('workout_progress', JSON.stringify({ workout, elapsedTotal: 10, powerAdjustPct: 0, status: 'paused', savedAtDate: getLocalDateString() }));

    setUrlSearch('source=TP&source_url=not-even-valid&startTime=bad'); // would normally throw a clear error
    const { root } = setup();

    // no error shown - the malformed group-join params were never even parsed, because
    // a higher-priority restore (in-progress workout) took over first
    expect(root.querySelector('.upload-error').classList.contains('hidden')).toBe(true);
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

  it('throttles progress saves while running to at most once per elapsed second, instead of on every 200ms worker tick (regression: a real user reported the player freezing mid-workout after a long, uninterrupted play session — writing to localStorage 5x/second for the full duration was suspected of eventually tripping some browser-side limit)', () => {
    const { root } = setup();
    submitPasteText(root, '10m 60%');
    root.querySelector('.btn-play-pause').click();

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    setItemSpy.mockClear();

    vi.advanceTimersByTime(3000); // 15 worker ticks (200ms each) while running

    const progressWrites = setItemSpy.mock.calls.filter(([key]) => key === 'workout_progress');
    // ~3 seconds of running time should produce ~3 saves (once per whole second
    // crossed), not 15 - one per 200ms tick would defeat the whole point of throttling.
    expect(progressWrites.length).toBeGreaterThan(0);
    expect(progressWrites.length).toBeLessThanOrEqual(4);

    setItemSpy.mockRestore();
  });

  it('does not throttle a status-changing save (e.g. pause) - it always saves immediately regardless of the elapsed-second throttle', () => {
    const { root } = setup();
    submitPasteText(root, '10m 60%');
    root.querySelector('.btn-play-pause').click();
    vi.advanceTimersByTime(1000); // lands on a whole-second boundary, already saved as "running"

    root.querySelector('.btn-play-pause').click(); // pause - same elapsed second, but a real status change

    const saved = JSON.parse(window.localStorage.getItem('workout_progress'));
    expect(saved.status).toBe('paused');
  });

  it('a saveWorkoutProgress() failure (e.g. a browser rejecting the write) does not stop the player screen from continuing to render subsequent ticks (regression for the reported mid-workout freeze)', () => {
    const { root } = setup();
    submitPasteText(root, '10m 60%');
    root.querySelector('.btn-play-pause').click();

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError (simulated)');
    });

    vi.advanceTimersByTime(2000); // several ticks while every save attempt throws

    // the countdown/elapsed-time display must keep advancing even though every
    // save attempt during this window threw - rendering must not be blocked by it
    expect(root.querySelector('.elapsed-time').textContent).toContain('2');
    expect(consoleErrorSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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
