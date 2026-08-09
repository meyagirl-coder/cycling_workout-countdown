/**
 * 主要訓練時間軸的顯示尺寸模式。這是純視覺偏好，不改變課表資料、計時或
 * 互動邏輯；獨立存放也避免和主題設定混在同一個 localStorage key 裡。
 */
const CHART_SCALE_MODE_STORAGE_KEY = 'workout-chart-scale-mode';

export const VALID_CHART_SCALE_MODES = ['auto', 'fixed'];
export const DEFAULT_CHART_SCALE_MODE = 'auto';

/** @param {Storage} [storage] */
export function loadChartScaleMode(storage = window.localStorage) {
  const mode = storage.getItem(CHART_SCALE_MODE_STORAGE_KEY);
  return VALID_CHART_SCALE_MODES.includes(mode) ? mode : DEFAULT_CHART_SCALE_MODE;
}

/** @param {'auto'|'fixed'} mode @param {Storage} [storage] */
export function saveChartScaleMode(mode, storage = window.localStorage) {
  if (!VALID_CHART_SCALE_MODES.includes(mode)) {
    throw new Error(`saveChartScaleMode: invalid mode "${mode}", expected ${VALID_CHART_SCALE_MODES.join('/')}`);
  }
  storage.setItem(CHART_SCALE_MODE_STORAGE_KEY, mode);
}
