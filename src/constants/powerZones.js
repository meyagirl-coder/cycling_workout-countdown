/**
 * Coggan 七區間功率區間表 — Phase 1 技術規格 §2
 * 顏色由 powerPct 即時算出，不存在 workout schema 裡。
 */
export const POWER_ZONES = [
  { key: 'Z1', label: '恢復', maxPct: 55, color: 'gray' },
  { key: 'Z2', label: '有氧耐力', maxPct: 75, color: 'blue' },
  { key: 'Z3', label: '節奏', maxPct: 90, color: 'green' },
  { key: 'Z4', label: '閾值', maxPct: 105, color: 'yellow' },
  { key: 'Z5', label: '最大攝氧', maxPct: 120, color: 'orange' },
  { key: 'Z6', label: '無氧', maxPct: 150, color: 'red' },
  { key: 'Z7', label: '神經肌力', maxPct: Infinity, color: 'purple' },
];

/**
 * @param {number} pct - 目前功率佔 FTP 的百分比（例如 88 代表 88% FTP）
 * @returns {{key: string, label: string, color: string}}
 */
export function getZoneColor(pct) {
  if (pct < 55) return zoneInfo(POWER_ZONES[0]);
  for (let i = 1; i < POWER_ZONES.length; i++) {
    if (pct <= POWER_ZONES[i].maxPct) return zoneInfo(POWER_ZONES[i]);
  }
  return zoneInfo(POWER_ZONES[POWER_ZONES.length - 1]);
}

function zoneInfo(zone) {
  return { key: zone.key, label: zone.label, color: zone.color };
}
