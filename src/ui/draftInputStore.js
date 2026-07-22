/**
 * 首頁「貼課表網址」／「貼上課表文字內容」這兩個輸入框的草稿內容
 * localStorage 讀寫（key: `upload_draft_inputs`）——使用者打字打到一半時重新
 * 整理頁面、或切換分頁/App 再切回來，這兩個欄位要自動帶回剛才輸入的內容，
 * 不用重新打字。
 *
 * 跟 ftpStore.js／scheduleStore.js 一樣是純函式 + 依賴注入 storage，方便測試。
 *
 * 過期規則：跟執行進度（workoutProgressStore.js）一致，只在「當天」有效，
 * 不是今天存的視為過期回傳 null——避免好幾天前隨手打的殘留文字某天忽然
 * 冒出來，使用者搞不清楚這是不是自己剛打的。
 */
import { getLocalDateString } from '../utils/localDate.js';

const DRAFT_STORAGE_KEY = 'upload_draft_inputs';

/**
 * @param {{ url?: string, pasteText?: string }} draft
 * @param {Storage} [storage]
 */
export function saveDraftInputs({ url = '', pasteText = '' }, storage = window.localStorage) {
  const payload = JSON.stringify({ url, pasteText, savedAtDate: getLocalDateString() });
  storage.setItem(DRAFT_STORAGE_KEY, payload);
}

/**
 * @param {Storage} [storage]
 * @returns {{url: string, pasteText: string}|null} 今天存的草稿；沒存過、存了
 *   壞資料、或不是今天存的都回傳 null
 */
export function loadDraftInputs(storage = window.localStorage) {
  const raw = storage.getItem(DRAFT_STORAGE_KEY);
  if (raw === null) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.savedAtDate !== getLocalDateString()) return null;

  const url = typeof parsed.url === 'string' ? parsed.url : '';
  const pasteText = typeof parsed.pasteText === 'string' ? parsed.pasteText : '';
  if (!url && !pasteText) return null; // 兩個欄位都是空的就沒什麼好復原的

  return { url, pasteText };
}

/** @param {Storage} [storage] */
export function clearDraftInputs(storage = window.localStorage) {
  storage.removeItem(DRAFT_STORAGE_KEY);
}
