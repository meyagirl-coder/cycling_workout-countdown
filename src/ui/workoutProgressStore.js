/**
 * 執行頁「目前這份課表＋目前進度」的 localStorage 讀寫（key:
 * `workout_progress`）——重新整理頁面、或切分頁/App 再切回來時，執行頁不會
 * 整個變回空白的上傳畫面，而是回到「同一份課表、停在同一個進度點」（規格：
 * 課表資料本身要跟進度一起存，不是只有計時器停住、課表資料整個消失）。
 *
 * 跟 ftpStore.js／scheduleStore.js 一樣是純函式 + 依賴注入 storage，方便測試。
 *
 * 過期規則：跟草稿輸入（draftInputStore.js）一致，只在「當天」有效——用
 * localDate.js 的 getLocalDateString() 判斷，不是當天存的視為過期，回傳
 * null（避免好幾天前忘記關掉的分頁殘留的舊進度，某天重新整理時忽然冒出來）。
 * 另外，使用者主動載入新課表、或按下「回到主畫面」時，呼叫端
 * （playerApp.js）會呼叫 clearWorkoutProgress() 主動清掉，不用等過期。
 */
import { getLocalDateString } from '../utils/localDate.js';

const PROGRESS_STORAGE_KEY = 'workout_progress';

/**
 * @param {object} workout
 * @param {{ status: string, elapsedTotal: number, powerAdjustPct: number }} state - 跟
 *   client.onUpdate() 拿到的 state 同一個形狀，只取用得到的三個欄位
 * @param {Storage} [storage]
 */
export function saveWorkoutProgress(workout, state, storage = window.localStorage) {
  const payload = JSON.stringify({
    workout,
    elapsedTotal: state.elapsedTotal,
    powerAdjustPct: state.powerAdjustPct,
    status: state.status,
    savedAtDate: getLocalDateString(),
  });
  storage.setItem(PROGRESS_STORAGE_KEY, payload);
}

/**
 * @param {Storage} [storage]
 * @returns {{workout: object, elapsedTotal: number, powerAdjustPct: number, status: string}|null}
 *   合法且是「今天」存的進度；沒存過、存了壞資料、或不是今天存的都回傳 null
 */
export function loadWorkoutProgress(storage = window.localStorage) {
  const raw = storage.getItem(PROGRESS_STORAGE_KEY);
  if (raw === null) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.savedAtDate !== getLocalDateString()) return null;
  if (!parsed.workout || typeof parsed.workout !== 'object') return null;
  if (typeof parsed.elapsedTotal !== 'number' || !Number.isFinite(parsed.elapsedTotal) || parsed.elapsedTotal < 0) return null;

  const powerAdjustPct = typeof parsed.powerAdjustPct === 'number' && Number.isFinite(parsed.powerAdjustPct) ? parsed.powerAdjustPct : 0;
  const status = typeof parsed.status === 'string' ? parsed.status : 'paused';

  return { workout: parsed.workout, elapsedTotal: parsed.elapsedTotal, powerAdjustPct, status };
}

/** @param {Storage} [storage] */
export function clearWorkoutProgress(storage = window.localStorage) {
  storage.removeItem(PROGRESS_STORAGE_KEY);
}
