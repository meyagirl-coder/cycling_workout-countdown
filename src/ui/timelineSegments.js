import { getZoneColor } from '../constants/powerZones.js';

/**
 * 把課表轉成時間軸圖需要的區塊資料：每組的起始位置／寬度（佔總時長的百分比）
 * 與功率區間顏色。freeride 沒有目標瓦數，color 給 null，交給 UI 層畫成中性樣式。
 */
export function buildTimelineSegments(workout) {
  const total = workout.totalDuration;
  let acc = 0;

  return workout.intervals.map((iv) => {
    const startPct = total > 0 ? (acc / total) * 100 : 0;
    const widthPct = total > 0 ? (iv.duration / total) * 100 : 0;
    acc += iv.duration;

    const color = iv.type === 'freeride' ? null : getZoneColor((iv.powerStart + iv.powerEnd) / 2).color;

    return { type: iv.type, startPct, widthPct, color };
  });
}

/** 目前播放游標在時間軸上的位置（百分比，0-100） */
export function computeCursorPct(elapsedTotal, totalDuration) {
  if (totalDuration <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsedTotal / totalDuration) * 100));
}
