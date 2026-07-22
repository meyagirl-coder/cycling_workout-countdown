/**
 * 團體訓練排程的 localStorage 讀寫（課表資料 + 設定的開始時間）。存起來是
 * 為了使用者切換分頁／背景／短暫關閉瀏覽器再打開時，排程還在，不需要重新
 * 貼一次課表、重設一次開始時間。純函式 + 依賴注入 storage，不直接綁死
 * window.localStorage，方便測試。
 *
 * 注意：這只是「儘量撐過短暫關閉」的機制，不是可靠的背景排程——分頁被完全
 * 關閉、或裝置長時間背景導致系統回收資源，都會讓「時間到自動開始」失效
 * （JavaScript 計時器沒有機會執行）。這個限制要在等待畫面上明確告知使用者
 * （見 waitingView.js），不能只藏在程式碼註解裡。
 */
const SCHEDULE_STORAGE_KEY = 'scheduled_workout';

/**
 * @param {object} workout - parseXxx() 輸出的 Workout JSON
 * @param {number} startTimestamp - 排定開始時間的 epoch ms
 * @param {Storage} [storage]
 */
export function saveSchedule(workout, startTimestamp, storage = window.localStorage) {
  const payload = JSON.stringify({ workout, startTimestamp });
  storage.setItem(SCHEDULE_STORAGE_KEY, payload);
}

/**
 * @param {Storage} [storage]
 * @returns {{workout: object, startTimestamp: number} | null} 沒有排程，或存的資料壞掉就回傳 null
 */
export function loadSchedule(storage = window.localStorage) {
  const raw = storage.getItem(SCHEDULE_STORAGE_KEY);
  if (raw === null) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.startTimestamp !== 'number' || !Number.isFinite(parsed.startTimestamp)) return null;
  if (!parsed.workout || typeof parsed.workout !== 'object') return null;

  return { workout: parsed.workout, startTimestamp: parsed.startTimestamp };
}

/** @param {Storage} [storage] */
export function clearSchedule(storage = window.localStorage) {
  storage.removeItem(SCHEDULE_STORAGE_KEY);
}
