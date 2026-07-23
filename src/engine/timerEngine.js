/**
 * 倒數計時引擎 — Phase 1 技術規格 §4
 *
 * 純邏輯，不含 UI、不含 setInterval/Web Worker。呼叫端（之後接 Web Worker 或
 * requestAnimationFrame）負責定期呼叫 tick(now)，引擎只回傳「現在第幾組、
 * 這組剩幾秒、目標瓦數多少」所需的狀態。
 *
 * 為了避免背景分頁計時器降頻造成的漂移，狀態不是每個 tick 累加秒數算出來
 * 的，而是靠 startTimestamp + Date.now() 重新計算 elapsedTotal，再從
 * elapsedTotal 反推目前在哪一組、這組經過幾秒。
 */
import { getZoneColor } from '../constants/powerZones.js';

export const TIMER_EVENTS = {
  COUNTDOWN_WARNING: 'countdownWarning',
  SHORT_COUNTDOWN_TICK: 'shortCountdownTick',
  INTERVAL_CHANGED: 'intervalChanged',
  WORKOUT_FINISHED: 'workoutFinished',
};

const COUNTDOWN_WARNING_SECONDS = 10;

/**
 * 短間歇例外規則（規格：以「組別時長」判斷走哪一條倒數提示路徑）：
 *   - 組別時長 > 20 秒：正常規則，剩餘 10 秒時觸發一次 COUNTDOWN_WARNING
 *     （提示音＋語音預告下一組＋banner，見 countdownAlerts.js）。
 *   - 組別時長 <= 20 秒（含剛好 20 秒——邊界值刻意用 `>`/`<=` 一組互斥，不是
 *     `>` / `<`，避免剛好 20 秒的組別兩條路徑都沒有、或兩條路徑都觸發）：
 *     短間歇例外，只在最後 5 秒逐秒觸發 SHORT_COUNTDOWN_TICK（5-4-3-2-1，
 *     每秒一次提示音），不觸發語音預告——組別太短，插入一段「10 秒後進入
 *     下一組...」的語音報讀反而會佔掉這組大半時間，體驗更差。
 */
const SHORT_INTERVAL_THRESHOLD_SECONDS = 20;
const SHORT_COUNTDOWN_TICK_SECONDS = [5, 4, 3, 2, 1];

/**
 * 純函式：計算目前這一秒的目標瓦數／%FTP／功率區間顏色。
 * ramp 類型逐秒線性內插；freeride 沒有目標瓦數。
 *
 * @param {object} workout
 * @param {number} intervalIndex
 * @param {number} elapsedInInterval
 * @param {number} ftp
 * @param {number} [adjustPct] - 使用者 ±1% 微調的累加值
 */
export function computeCurrentTarget(workout, intervalIndex, elapsedInInterval, ftp, adjustPct = 0) {
  const iv = workout.intervals[intervalIndex];
  if (!iv) {
    throw new Error(`computeCurrentTarget: no interval at index ${intervalIndex}`);
  }

  if (iv.type === 'freeride') {
    return { watts: null, pct: null };
  }

  const ratio = iv.duration > 0 ? clamp01(elapsedInInterval / iv.duration) : 0;
  const pct = iv.powerStart + (iv.powerEnd - iv.powerStart) * ratio;
  const adjustedPct = pct + adjustPct;
  const watts = Math.round((ftp * adjustedPct) / 100);

  return { watts, pct: adjustedPct, zoneColor: getZoneColor(adjustedPct) };
}

/**
 * 建立一份課表的計時引擎實例。狀態機：
 *   idle → running → paused → running → finished
 * skip / redo / stop 隨時可觸發，不限狀態。
 *
 * @param {object} workout - parseZwoXml() 輸出的 Workout JSON
 */
export function createTimerEngine(workout) {
  if (!workout || !Array.isArray(workout.intervals) || workout.intervals.length === 0) {
    throw new Error('createTimerEngine: workout must contain at least one interval');
  }

  let status = 'idle';
  let elapsedTotal = 0;
  let startTimestamp = null;
  let powerAdjustPct = 0;

  function refreshElapsedIfRunning(now) {
    if (status === 'running') {
      elapsedTotal = Math.max(0, (now - startTimestamp) / 1000);
    }
  }

  function buildState() {
    const { index, elapsedInInterval } = locateIntervalAt(workout, elapsedTotal);
    return {
      status,
      currentIntervalIndex: index,
      elapsedInInterval,
      elapsedTotal,
      powerAdjustPct,
      startTimestamp,
    };
  }

  function result(events) {
    return { state: buildState(), events };
  }

  function play(now = Date.now()) {
    if (status === 'idle' || status === 'paused') {
      status = 'running';
      startTimestamp = now - elapsedTotal * 1000;
    }
    return result([]);
  }

  function pause(now = Date.now()) {
    if (status === 'running') {
      refreshElapsedIfRunning(now);
      status = 'paused';
      startTimestamp = null;
    }
    return result([]);
  }

  function skip(now = Date.now()) {
    refreshElapsedIfRunning(now);
    const { index } = locateIntervalAt(workout, elapsedTotal);
    const nextIndex = index + 1;
    const events = [];

    if (nextIndex >= workout.intervals.length) {
      elapsedTotal = workout.totalDuration;
      if (status !== 'finished') {
        status = 'finished';
        events.push(TIMER_EVENTS.WORKOUT_FINISHED);
      }
    } else {
      elapsedTotal = cumulativeStart(workout, nextIndex);
      events.push(TIMER_EVENTS.INTERVAL_CHANGED);
    }

    if (status === 'running') startTimestamp = now - elapsedTotal * 1000;
    return result(events);
  }

  function redo(now = Date.now()) {
    refreshElapsedIfRunning(now);
    const { index } = locateIntervalAt(workout, elapsedTotal);
    elapsedTotal = cumulativeStart(workout, index);
    if (status === 'running') startTimestamp = now - elapsedTotal * 1000;
    return result([]);
  }

  function stop(now = Date.now()) {
    refreshElapsedIfRunning(now);
    const events = status !== 'finished' ? [TIMER_EVENTS.WORKOUT_FINISHED] : [];
    status = 'finished';
    startTimestamp = null;
    return result(events);
  }

  function adjustPower(deltaPct) {
    powerAdjustPct += deltaPct;
    return result([]);
  }

  /**
   * 從先前存下來的進度重新建立狀態（頁面重新整理後復原用，見
   * workoutProgressStore.js）：直接設定 `elapsedTotal`／`powerAdjustPct`，
   * `currentIntervalIndex`／`elapsedInInterval` 照舊由 `buildState()` 從
   * `elapsedTotal` 反推，不需要另外還原。
   *
   * 狀態一律不會恢復成 `running`——就算存檔當下正在跑，重新整理後也只會停
   * 在暫停狀態，不會自動恢復播放（跟使用者當下沒有點擊互動就自動開始播放
   * 是兩回事，這裡單純是「資料還在，畫面停在原地」，仍然需要使用者自己按
   * 播放）。已經跑完（`elapsedTotal` 到達 `totalDuration`）的話固定回到
   * `finished`，不管存檔當下的 `savedStatus` 是什麼，避免恢復出一個「已經
   * 跑完但狀態卻不是 finished」的不一致狀態。
   *
   * @param {{ elapsedTotal: number, powerAdjustPct?: number, status?: string }} saved
   */
  function restore({ elapsedTotal: savedElapsedTotal, powerAdjustPct: savedPowerAdjustPct, status: savedStatus }) {
    elapsedTotal = Math.max(0, savedElapsedTotal);
    powerAdjustPct = savedPowerAdjustPct ?? 0;
    startTimestamp = null;

    const located = locateIntervalAt(workout, elapsedTotal);
    if (located.finished) {
      status = 'finished';
    } else if (savedStatus === 'idle') {
      status = 'idle';
    } else {
      status = 'paused';
    }

    return result([]);
  }

  function tick(now = Date.now()) {
    if (status !== 'running') return result([]);

    const before = locateIntervalAt(workout, elapsedTotal);
    const prevRemaining = workout.intervals[before.index].duration - before.elapsedInInterval;

    elapsedTotal = Math.max(0, (now - startTimestamp) / 1000);
    const after = locateIntervalAt(workout, elapsedTotal);

    const events = [];
    if (after.finished) {
      status = 'finished';
      events.push(TIMER_EVENTS.WORKOUT_FINISHED);
    } else if (after.index !== before.index) {
      events.push(TIMER_EVENTS.INTERVAL_CHANGED);
    } else {
      const duration = workout.intervals[after.index].duration;
      const remaining = duration - after.elapsedInInterval;

      if (duration > SHORT_INTERVAL_THRESHOLD_SECONDS) {
        if (prevRemaining > COUNTDOWN_WARNING_SECONDS && remaining <= COUNTDOWN_WARNING_SECONDS) {
          events.push(TIMER_EVENTS.COUNTDOWN_WARNING);
        }
      } else {
        // 短間歇例外：逐一檢查 5/4/3/2/1 每個秒數點有沒有被這次 tick 跨過——
        // 不是只挑一個門檻，是因為分頁切到背景時 setInterval 可能被降頻，一次
        // tick 可能跨過不只一個整數秒，這裡確保每個被跨過的秒數都各自觸發一次
        // SHORT_COUNTDOWN_TICK，不會因為降頻漏掉中間的提示音。
        for (const threshold of SHORT_COUNTDOWN_TICK_SECONDS) {
          if (prevRemaining > threshold && remaining <= threshold) {
            events.push(TIMER_EVENTS.SHORT_COUNTDOWN_TICK);
          }
        }
      }
    }

    return result(events);
  }

  function getState() {
    return buildState();
  }

  return { play, pause, skip, redo, stop, adjustPower, tick, getState, restore };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function cumulativeStart(workout, index) {
  let acc = 0;
  for (let i = 0; i < index; i++) acc += workout.intervals[i].duration;
  return acc;
}

/**
 * 依 elapsedTotal（整份課表的累積秒數）反推目前是第幾組、這組經過幾秒。
 * elapsedTotal >= totalDuration 時回傳 finished: true，並停在最後一組的結尾。
 */
function locateIntervalAt(workout, elapsedTotal) {
  const clamped = Math.max(0, elapsedTotal);
  let acc = 0;

  for (let i = 0; i < workout.intervals.length; i++) {
    const duration = workout.intervals[i].duration;
    if (clamped < acc + duration) {
      return { index: i, elapsedInInterval: clamped - acc, finished: false };
    }
    acc += duration;
  }

  const lastIndex = workout.intervals.length - 1;
  return { index: lastIndex, elapsedInInterval: workout.intervals[lastIndex].duration, finished: true };
}
