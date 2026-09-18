/**
 * Coggan 七區間功率區間表 — Phase 1 技術規格 §2
 * 顏色由 powerPct 即時算出，不存在 workout schema 裡。
 * 區間邊界：Z1 <55、Z2 55–75、Z3 76–90、Z4 91–105、Z5 106–120、Z6 121–150、Z7 >=151。
 */
export const POWER_ZONES = [
  { key: 'Z1', label: '恢復', maxPct: 55, color: 'gray' },
  { key: 'Z2', label: '有氧耐力', maxPct: 75, color: 'blue' },
  { key: 'Z3', label: '節奏', maxPct: 90, color: 'green' },
  { key: 'Z4', label: '閾值', maxPct: 105, color: 'yellow' },
  { key: 'Z5', label: '最大攝氧', maxPct: 120, color: 'red' },
  { key: 'Z6', label: '無氧', maxPct: 150, color: 'purple' },
  { key: 'Z7', label: '神經肌力', maxPct: Infinity, color: 'black' },
];

/**
 * @param {number} pct - 目前功率佔 FTP 的百分比（例如 88 代表 88% FTP）
 * @returns {{key: string, label: string, color: string}}
 */
export function getZoneColor(pct) {
  for (let index = 0; index < POWER_ZONES.length; index += 1) {
    const zone = POWER_ZONES[index];
    // Z1 的 55% 是不包含邊界，因此 55% 進入 Z2。
    if (index === 0 ? pct < zone.maxPct : pct <= zone.maxPct) return zoneInfo(zone);
  }
  return zoneInfo(POWER_ZONES[POWER_ZONES.length - 1]);
}

function zoneInfo(zone) {
  return { key: zone.key, label: zone.label, color: zone.color };
}
