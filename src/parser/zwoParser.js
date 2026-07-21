/**
 * .zwo (Zwift workout file) 解析器 — Phase 1 技術規格 §3
 *
 * parseZwoXml() 是純函式：輸入 XML 字串，輸出統一的 Workout JSON（見
 * src/schema/workoutSchema.js），不碰 UI、不碰 localStorage，方便單獨測試。
 */
import { generateId } from '../utils/generateId.js';

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
    const tag = el.tagName.toLowerCase();

    if (tag === 'intervalst') {
      intervals.push(...parseIntervalsTElement(el));
      continue;
    }

    const type = TAG_TYPE_MAP[tag];
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

  if (type === 'steady') {
    const power = parsePowerAttr(el, 'Power');
    if (power !== null) {
      return { type: 'steady', duration, powerStart: power, powerEnd: power, cadence };
    }

    // 有些工具（例如 intervals.icu 的課表產生器）匯出的 SteadyState 不是單一
    // Power，而是用 PowerLow/PowerHigh 表示一個範圍。跟 Warmup/Ramp/Cooldown
    // 一樣線性內插處理；但既然瓦數會變化、不是真的「穩定」，schema 的 type
    // 歸類成 ramp，避免畫面上標成「穩定」卻其實在變動，造成誤導。
    const powerLow = parsePowerAttr(el, 'PowerLow');
    const powerHigh = parsePowerAttr(el, 'PowerHigh');
    if (powerLow === null || powerHigh === null) {
      throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing a required Power attribute (or PowerLow/PowerHigh)`);
    }
    return { type: 'ramp', duration, powerStart: powerLow, powerEnd: powerHigh, cadence };
  }

  if (type === 'warmup' || type === 'ramp' || type === 'cooldown') {
    const powerStart = parsePowerAttr(el, 'PowerLow');
    const powerEnd = parsePowerAttr(el, 'PowerHigh');
    if (powerStart === null || powerEnd === null) {
      throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing PowerLow/PowerHigh attributes`);
    }
    return { type, duration, powerStart, powerEnd, cadence };
  }

  // freeride: 沒有目標瓦數，powerStart/powerEnd 維持 null
  return { type, duration, powerStart: null, powerEnd: null, cadence };
}

/**
 * <IntervalsT> 是「開／關間歇」的標準寫法：把它展開成 Repeat 次的
 * 高強度（OnPower/OnDuration/Cadence）+ 恢復（OffPower/OffDuration/
 * CadenceResting）交替組別，各自當作一個 steady 組別塞進 intervals 陣列——
 * schema 本身沒有「重複區塊」的概念，展開成一般組別是唯一能讓計時引擎正確
 * 逐組播放的方式。
 */
function parseIntervalsTElement(el) {
  const repeat = parseIntAttr(el, 'Repeat');
  if (repeat === null || repeat <= 0) {
    throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing a required Repeat attribute`);
  }

  const onDuration = parseIntAttr(el, 'OnDuration');
  const offDuration = parseIntAttr(el, 'OffDuration');
  if (onDuration === null || offDuration === null) {
    throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing OnDuration/OffDuration attributes`);
  }

  const onPower = parsePowerAttr(el, 'OnPower');
  const offPower = parsePowerAttr(el, 'OffPower');
  if (onPower === null || offPower === null) {
    throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing OnPower/OffPower attributes`);
  }

  const onCadence = parseIntAttr(el, 'Cadence');
  const offCadence = parseIntAttr(el, 'CadenceResting');

  const expanded = [];
  for (let i = 0; i < repeat; i++) {
    expanded.push({ type: 'steady', duration: onDuration, powerStart: onPower, powerEnd: onPower, cadence: onCadence });
    expanded.push({ type: 'steady', duration: offDuration, powerStart: offPower, powerEnd: offPower, cadence: offCadence });
  }
  return expanded;
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

