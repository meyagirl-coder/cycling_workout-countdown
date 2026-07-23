/**
 * 倒數提示模式（語音報數／逼逼聲倒數）的 localStorage 讀寫（key:
 * countdown_alert_mode）。跟 themeStore.js 一樣是純函式 + 依賴注入 storage，
 * 不直接綁死 window.localStorage，方便測試。
 *
 * 兩個模式互斥（見 countdownAlerts.js 的說明）：
 *   - 'voice'（模式 A，預設）：只有語音報數，不播放嗶聲。
 *   - 'beep'（模式 B）：只播放三聲嗶聲，不語音報數；「下一組預告」也只顯示
 *     文字 banner，不語音唸出動態內容。
 */
export const ALERT_MODE_VOICE = 'voice';
export const ALERT_MODE_BEEP = 'beep';

export const VALID_ALERT_MODES = [ALERT_MODE_VOICE, ALERT_MODE_BEEP];

/** 使用者從未選過時的預設值——維持既有的語音報數行為，不因為新增這個選項改變老使用者的體驗 */
export const DEFAULT_ALERT_MODE = ALERT_MODE_VOICE;

const ALERT_MODE_STORAGE_KEY = 'countdown_alert_mode';

/**
 * @param {Storage} [storage]
 * @returns {'voice'|'beep'} 已儲存且合法的模式；從未設定過或存了壞資料就
 *   回傳預設值 'voice'，不會讓畫面卡在一個無法識別的模式狀態
 */
export function loadAlertMode(storage = window.localStorage) {
  const raw = storage.getItem(ALERT_MODE_STORAGE_KEY);
  return VALID_ALERT_MODES.includes(raw) ? raw : DEFAULT_ALERT_MODE;
}

/**
 * @param {'voice'|'beep'} mode
 * @param {Storage} [storage]
 */
export function saveAlertMode(mode, storage = window.localStorage) {
  if (!VALID_ALERT_MODES.includes(mode)) {
    throw new Error(`saveAlertMode: invalid mode "${mode}", expected one of ${VALID_ALERT_MODES.join('/')}`);
  }
  storage.setItem(ALERT_MODE_STORAGE_KEY, mode);
}
