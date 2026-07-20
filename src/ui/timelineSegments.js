import { getZoneColor } from '../constants/powerZones.js';

/** getZoneColor() 判斷區間用的邊界值（55/75/90/105/120/150），拿來算 ramp/warmup/cooldown 中途跨區間的時間點 */
const ZONE_BOUNDARIES = [55, 75, 90, 105, 120, 150];

/**
 * 把一個組別依「瞬時瓦數對應的功率區間」切成好幾段：瓦數連續變化的組別
 * （ramp／warmup／cooldown），只要曲線中途跨過區間邊界，就切成好幾個顏色不同
 * 的小段——跟下方大字卡片背景色用的是同一套 getZoneColor() 邏輯，不是整組
 * 取一個固定平均色。freeride 沒有目標瓦數，整組維持單一個 null 色段；穩定
 * （steady）或起訖瓦數相同時本來就只有一個區間，也是單一色段。
 */
function sliceIntervalByZone(iv) {
  if (iv.type === 'freeride' || iv.powerStart === null || iv.powerEnd === null) {
    return [{ startOffset: 0, endOffset: iv.duration, color: null }];
  }

  const { duration, powerStart, powerEnd } = iv;

  if (duration <= 0 || powerStart === powerEnd) {
    return [{ startOffset: 0, endOffset: duration, color: getZoneColor(powerStart).color }];
  }

  const lo = Math.min(powerStart, powerEnd);
  const hi = Math.max(powerStart, powerEnd);

  const offsets = new Set([0, duration]);
  for (const boundary of ZONE_BOUNDARIES) {
    if (boundary > lo && boundary < hi) {
      const ratio = (boundary - powerStart) / (powerEnd - powerStart);
      offsets.add(ratio * duration);
    }
  }

  const sorted = Array.from(offsets).sort((a, b) => a - b);
  const slices = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const startOffset = sorted[i];
    const endOffset = sorted[i + 1];
    const midRatio = (startOffset + endOffset) / 2 / duration;
    const midPct = powerStart + (powerEnd - powerStart) * midRatio;
    slices.push({ startOffset, endOffset, color: getZoneColor(midPct).color });
  }
  return slices;
}

/**
 * 時間軸的顏色分段（每段是一個瞬時功率區間，不是整個組別一種顏色）。
 *
 * @param {object} workout
 * @param {number} [adjustPct] - 使用者 ±1% 微調的累加值。套用方式要跟
 *   computeCurrentTarget() 一致（整條曲線平移），這樣時間軸顏色才會跟下方大字
 *   卡片背景色永遠同步。
 */
export function buildTimelineSegments(workout, adjustPct = 0) {
  const total = workout.totalDuration;
  let acc = 0;
  const segments = [];

  workout.intervals.forEach((iv, intervalIndex) => {
    const shifted =
      iv.powerStart === null || iv.powerEnd === null
        ? iv
        : { ...iv, powerStart: iv.powerStart + adjustPct, powerEnd: iv.powerEnd + adjustPct };

    for (const slice of sliceIntervalByZone(shifted)) {
      const startPct = total > 0 ? ((acc + slice.startOffset) / total) * 100 : 0;
      const widthPct = total > 0 ? ((slice.endOffset - slice.startOffset) / total) * 100 : 0;
      segments.push({ type: iv.type, intervalIndex, startPct, widthPct, color: slice.color });
    }
    acc += iv.duration;
  });

  return segments;
}

/** 每個組別交界處在時間軸上的位置（百分比），用來畫組別分隔線——跟顏色是否相同無關 */
export function buildIntervalBoundaries(workout) {
  const total = workout.totalDuration;
  if (total <= 0) return [];

  let acc = 0;
  const boundaries = [];
  for (let i = 0; i < workout.intervals.length - 1; i++) {
    acc += workout.intervals[i].duration;
    boundaries.push((acc / total) * 100);
  }
  return boundaries;
}

/** 目前播放游標在時間軸上的位置（百分比，0-100） */
export function computeCursorPct(elapsedTotal, totalDuration) {
  if (totalDuration <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsedTotal / totalDuration) * 100));
}
