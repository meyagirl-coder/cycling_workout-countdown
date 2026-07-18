/**
 * .zwo (Zwift workout file) 解析器 — Phase 1 技術規格 §3
 *
 * parseZwoXml() 是純函式：輸入 XML 字串，輸出統一的 Workout JSON（見
 * src/schema/workoutSchema.js），不碰 UI、不碰 localStorage，方便單獨測試。
 */

/** ZWO 標籤名稱（小寫比對）→ 統一 schema 的 interval type */
const TAG_TYPE_MAP = {
  warmup: 'warmup',
  steadystate: 'steady',
  ramp: 'ramp',
  freeride: 'freeride',
  cooldown: 'cooldown',
};

/**
 * @param {string} xmlString - .zwo 檔案內容
 * @returns {{id: string, name: string, source: 'zwo', totalDuration: number, intervals: Array}}
 */
export function parseZwoXml(xmlString) {
  if (typeof xmlString !== 'string' || xmlString.trim() === '') {
    throw new Error('Invalid ZWO XML: input must be a non-empty string');
  }

  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`Invalid ZWO XML: failed to parse XML (${parserError.textContent.trim()})`);
  }

  const root = doc.querySelector('workout_file');
  if (!root) {
    throw new Error('Invalid ZWO XML: missing <workout_file> root element');
  }

  const workoutEl = root.querySelector('workout');
  if (!workoutEl) {
    throw new Error('Invalid ZWO XML: missing <workout> element');
  }

  const nameEl = root.querySelector('name');
  const name = nameEl && nameEl.textContent.trim() ? nameEl.textContent.trim() : 'Untitled Workout';

  const intervals = [];
  for (const el of Array.from(workoutEl.children)) {
    const type = TAG_TYPE_MAP[el.tagName.toLowerCase()];
    if (!type) continue; // 略過不支援的標籤（例如 textnotifications）

    intervals.push(parseIntervalElement(el, type));
  }

  if (intervals.length === 0) {
    throw new Error('Invalid ZWO XML: no supported interval elements found in <workout>');
  }

  const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0);

  return {
    id: generateId(),
    name,
    source: 'zwo',
    totalDuration,
    intervals,
  };
}

function parseIntervalElement(el, type) {
  const duration = parseIntAttr(el, 'Duration');
  if (duration === null) {
    throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing a required Duration attribute`);
  }

  const cadence = parseIntAttr(el, 'Cadence');
  let powerStart = null;
  let powerEnd = null;

  if (type === 'steady') {
    const power = parsePowerAttr(el, 'Power');
    if (power === null) {
      throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing a required Power attribute`);
    }
    powerStart = power;
    powerEnd = power;
  } else if (type === 'warmup' || type === 'ramp' || type === 'cooldown') {
    powerStart = parsePowerAttr(el, 'PowerLow');
    powerEnd = parsePowerAttr(el, 'PowerHigh');
    if (powerStart === null || powerEnd === null) {
      throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing PowerLow/PowerHigh attributes`);
    }
  }
  // freeride: 沒有目標瓦數，powerStart/powerEnd 維持 null

  return { type, duration, powerStart, powerEnd, cadence };
}

function parseIntAttr(el, attrName) {
  const raw = el.getAttribute(attrName);
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  if (Number.isNaN(value)) return null;
  return Math.round(value);
}

/** ZWO 的 Power 是 0–1 的小數（0.88 = 88% FTP），轉成整數百分比存進 schema */
function parsePowerAttr(el, attrName) {
  const raw = el.getAttribute(attrName);
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older browsers/runtimes)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
