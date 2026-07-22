/**
 * 主題選擇（dark／light／auto）的 localStorage 讀寫（key: user_theme）。跟
 * ftpStore.js 一樣是純函式 + 依賴注入 storage，不直接綁死 window.localStorage，
 * 方便測試。
 */
const THEME_STORAGE_KEY = 'user_theme';

export const VALID_THEMES = ['dark', 'light', 'auto'];

/** 使用者從未選過主題時的預設值——跟隨系統設定，不強制套用任何一個 */
export const DEFAULT_THEME = 'auto';

/**
 * @param {Storage} [storage]
 * @returns {'dark'|'light'|'auto'} 已儲存且合法的主題；從未設定過或存了壞
 *   資料（例如被其他程式碼寫入非預期的值）就回傳預設值 'auto'，不會讓畫面
 *   卡在一個無法識別的主題狀態
 */
export function loadTheme(storage = window.localStorage) {
  const raw = storage.getItem(THEME_STORAGE_KEY);
  return VALID_THEMES.includes(raw) ? raw : DEFAULT_THEME;
}

/**
 * @param {'dark'|'light'|'auto'} theme
 * @param {Storage} [storage]
 */
export function saveTheme(theme, storage = window.localStorage) {
  if (!VALID_THEMES.includes(theme)) {
    throw new Error(`saveTheme: invalid theme "${theme}", expected one of ${VALID_THEMES.join('/')}`);
  }
  storage.setItem(THEME_STORAGE_KEY, theme);
}
