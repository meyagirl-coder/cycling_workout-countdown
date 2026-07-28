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

    // <SteadyState> 帶 PowerLow/PowerHigh、沒有 Power：這個組合不是 Zwift
    // 官方 ZWO 格式本來就支援的寫法（官方的 SteadyState 只有單一 Power
    // 屬性；PowerLow/PowerHigh 是 Warmup/Ramp/Cooldown 才有、代表逐秒線性
    // 漸變的官方屬性）。這裡遇過的幾個第三方課表產生工具（例如 IntervalCoach
    // ／intervals.icu）借用同樣的屬性名稱，套在 SteadyState 上表達「這組
    // 期間維持在這個瓦數區間內即可」的目標範圍（regression: IntervalCoach
    // 匯出的「Endurance」「Threshold」這類長時間定額區間段——見
    // test/fixtures/IntervalCoach_節奏推升間歇.zwo／
    // IntervalCoach_閾值衝刺_正確版.zwo——標籤本身就是「穩定狀態」，訓練
    // 意圖是整段維持在區間內，不是逐秒精確爬升；真的要逐秒線性漸變的意圖，
    // 這些工具會用真正的 <Ramp> 標籤，或本來就是漸變形狀的
    // <Warmup>/<Cooldown>，不會用 <SteadyState>）。曾經誤判成跟
    // Warmup/Ramp/Cooldown 一樣線性內插（把 type 標成 'ramp'），畫面上會
    // 顯示成整組瓦數一路平滑漸變，跟使用者「這幾分鐘維持在這個區間內」的
    // 實際訓練意圖不符。這裡改成跟一般只有單一 Power 屬性的 SteadyState
    // 一樣處理：取區間中點當作整組期間維持不變的目標值（type 仍然是
    // 'steady'，powerStart 跟 powerEnd 相等，timerEngine.js 的內插公式在
    // 兩者相等時自然算出固定值，不需要額外的特殊分支；時間軸顏色／下一組
    // 預告文字等其他畫面邏輯也都是直接比較 powerStart/powerEnd 是否相等
    // 來決定要不要顯示範圍，不是看 type，所以這裡不需要另外調整）。
    const powerLow = parsePowerAttr(el, 'PowerLow');
    const powerHigh = parsePowerAttr(el, 'PowerHigh');
    if (powerLow === null || powerHigh === null) {
      throw new Error(`Invalid ZWO XML: <${el.tagName}> is missing a required Power attribute (or PowerLow/PowerHigh)`);
    }
    const midpoint = Math.round((powerLow + powerHigh) / 2);
    return { type: 'steady', duration, powerStart: midpoint, powerEnd: midpoint, cadence };
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

