/**
 * 貼上純文字課表的解析器：使用者從公開課表頁面（例如 TrainerDay 未登入狀態）
 * 複製貼上的純文字，不需要上傳檔案或串接帳號。
 *
 * 已知格式（每行一組）：`X min @ Yw`，例如 `10 min @ 53w`。這類公開頁面在未
 * 登入狀態下瓦數是以 FTP=100 為基準換算的，所以這裡的「Yw」數字直接等於
 * 「Y% FTP」，不需要再額外換算。
 *
 * 也支援「重複組」寫法：單獨一行的「Nx」（例如 `3x`）宣告接下來連續的
 * `X min @ Yw` 行要重複 N 次，直到遇到空行、下一個「Nx」宣告、或文字結束。
 * 「Nx 換行重複」這套狀態機跟 spacePercentTextParser.js 共用，見
 * newlineRepeatTextParser.js。
 *
 * parsePasteText() 是純函式：輸入貼上的文字，輸出統一的 Workout JSON（見
 * src/schema/workoutSchema.js），不碰 UI，方便單獨測試。目前只處理最基本的
 * 「時長 @ 瓦數」單行格式；漸變段（例如 `53-68w`）留待之後擴充。
 */
import { generateId } from '../utils/generateId.js';
import { parseNewlineRepeatText, REPEAT_LINE_RE } from './newlineRepeatTextParser.js';

// exported so other modules that need to recognize the same line shapes
// （例如判斷貼上文字是哪一種格式的 pasteTextRouter.js）可以重複使用同一套
// 定義，不必自己重寫一份容易走鐘的正則表達式。
export const INTERVAL_LINE_RE = /^(\d+(?:\.\d+)?)\s*min\s*@\s*(\d+(?:\.\d+)?)\s*w$/i;
export { REPEAT_LINE_RE };

/**
 * @param {string} text - 使用者貼上的純文字
 * @returns {{id: string, name: string, source: 'paste', totalDuration: number, intervals: Array}}
 */
export function parsePasteText(text) {
  const intervals = parseNewlineRepeatText(text, parseIntervalLine, '"X min @ Yw"');
  const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0);

  return {
    id: generateId(),
    name: 'Untitled Workout',
    source: 'paste',
    totalDuration,
    intervals,
  };
}

/** @returns {object|null} 一個穩定（steady）段，或 null（這行不是「X min @ Yw」格式） */
function parseIntervalLine(line) {
  const match = line.match(INTERVAL_LINE_RE);
  if (!match) return null;

  const minutes = Number(match[1]);
  const watts = Number(match[2]); // FTP=100 基準換算，Yw 直接等於 Y% FTP
  const duration = Math.round(minutes * 60);
  const powerPct = Math.round(watts);

  return { type: 'steady', duration, powerStart: powerPct, powerEnd: powerPct, cadence: null };
}
