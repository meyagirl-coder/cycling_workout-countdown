/**
 * FTP 設定值的 localStorage 讀寫（規格 §6，key: user_ftp）。純函式 + 依賴注入
 * storage，不直接綁死 window.localStorage，方便測試。
 */
const FTP_STORAGE_KEY = 'user_ftp';

/** 使用者從未設定過 FTP 時的預設值——畫面上要讓使用者清楚知道這只是預設、可以修改 */
export const DEFAULT_FTP = 200;

/**
 * @param {Storage} [storage]
 * @returns {number|null} 已儲存且合法（>0）的 FTP；從未設定過或存了壞資料就回傳 null
 */
export function loadFtp(storage = window.localStorage) {
  const raw = storage.getItem(FTP_STORAGE_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/**
 * @param {number} ftp
 * @param {Storage} [storage]
 */
export function saveFtp(ftp, storage = window.localStorage) {
  storage.setItem(FTP_STORAGE_KEY, String(Math.round(ftp)));
}
