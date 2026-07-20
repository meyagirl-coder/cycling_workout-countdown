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
  INTERVAL_CHANGED: 'intervalChanged',
  WORKOUT_FINISHED: 'workoutFinished',
};

const COUNTDOWN_WARNING_SECONDS = 10;

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
      if (duration > COUNTDOWN_WARNING_SECONDS && prevRemaining > COUNTDOWN_WARNING_SECONDS && remaining <= COUNTDOWN_WARNING_SECONDS) {
        events.push(TIMER_EVENTS.COUNTDOWN_WARNING);
      }
    }

    return result(events);
  }

  function getState() {
    return buildState();
  }

  return { play, pause, skip, redo, stop, adjustPower, tick, getState };
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
