import { formatMMSS } from './formatTime.js';

/**
 * 排定開始時間的倒數邏輯：定期檢查「現在」跟排定時間的差距，還沒到就回報
 * 剩餘時間（給等待畫面即時更新用，每秒都要更新，見下方 formatRemainingLabel()
 * 的說明），時間到就觸發一次回呼並停止。
 *
 * 跟 worker/workerRuntime.js 同樣的設計：把「跟 setInterval / Date.now 綁定」
 * 的部分抽成依賴注入（now / setIntervalFn / clearIntervalFn），這樣測試時
 * 可以完全掌控時間與 interval 觸發時機，不需要真的等待時間流逝，也能模擬
 * 「分頁切到背景、setInterval 被降頻」的情境——用差值（startTimestamp -
 * now()）判斷而不是累加 tick 次數，就算某次 setInterval 因為背景降頻晚了
 * 才觸發，下一次 tick 一樣能正確算出「時間已經到了」。
 */
const DEFAULT_TICK_INTERVAL_MS = 1000;

/**
 * @param {object} opts
 * @param {number} opts.startTimestamp - 排定開始時間的 epoch ms
 * @param {() => number} [opts.now]
 * @param {typeof setInterval} [opts.setIntervalFn]
 * @param {typeof clearInterval} [opts.clearIntervalFn]
 * @param {number} [opts.tickIntervalMs]
 * @param {(remainingMs: number) => void} opts.onTick - 還沒到排定時間時，每次 tick 都會呼叫一次
 * @param {() => void} opts.onReached - 時間到（remainingMs <= 0）時呼叫一次，之後自動停止，不會再呼叫 onTick
 */
export function createScheduledStartRuntime({
  startTimestamp,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
  onTick,
  onReached,
}) {
  let intervalId = null;

  function checkAndEmit() {
    const remainingMs = startTimestamp - now();
    if (remainingMs <= 0) {
      stop();
      onReached();
    } else {
      onTick(remainingMs);
    }
  }

  function start() {
    if (intervalId !== null) return;
    checkAndEmit(); // 立刻算一次，畫面不用空等第一個 tickIntervalMs 才有內容
    intervalId = setIntervalFn(checkAndEmit, tickIntervalMs);
  }

  function stop() {
    if (intervalId !== null) {
      clearIntervalFn(intervalId);
      intervalId = null;
    }
  }

  return { start, stop, isRunning: () => intervalId !== null };
}

/**
 * 「距離開始還有 mm:ss」的大字倒數標示，給等待畫面用——規格要求精確到
 * 分秒、每秒即時更新（不是只精確到分鐘），格式刻意重用 `formatMMSS()`
 * （執行頁本組倒數計時用的同一個函式），讓使用者在等待畫面跟執行頁看到的
 * 是同一種「mm:ss」視覺語言，不是兩套不一致的時間表示法。
 *
 * 剩餘時間超過 1 小時（甚至超過 1 天）時，mm:ss 只精確表示「這一小時內」
 * 還剩多少分秒（分鐘部分歸零重算，不會出現「125:32」這種超過 60 的分鐘
 * 數），前面另外加上小時／天數：
 *   - < 1 小時：`距離開始還有 05:32`
 *   - 1 小時–1 天：`距離開始還有 3 小時 05:32`
 *   - >= 1 天：`距離開始還有 2 天 3 小時 05:32`
 *
 * @param {number} remainingMs
 */
export function formatRemainingLabel(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mmss = formatMMSS(totalSeconds % 3600);

  if (days > 0) return `距離開始還有 ${days} 天 ${hours} 小時 ${mmss}`;
  if (hours > 0) return `距離開始還有 ${hours} 小時 ${mmss}`;
  return `距離開始還有 ${mmss}`;
}
