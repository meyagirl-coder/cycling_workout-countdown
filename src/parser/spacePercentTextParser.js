/**
 * 「時長 百分比」課表文字解析器：跟 pasteTextParser.js（TrainerDay 格式，
 * `X min @ Yw`）並存的第三種手動貼上格式，例如 `5m 50%`——沒有 `@`、沒有
 * `w`、沒有 `FTP` 字樣，單位用 `m`（分鐘）／`s`（秒），數字直接就是 %FTP。
 * 行尾可以再接一段選填的「N rpm」踏頻資訊（例如 `3m 50% 90rpm`），沒有就是
 * `cadence: null`。
 *
 * 也支援「Nx」換行重複寫法，語意跟 pasteTextParser.js 一致（見
 * newlineRepeatTextParser.js 共用的狀態機）：單獨一行的「Nx」宣告接下來
 * 連續的 `Xm Y%`／`Xs Y%` 行要重複 N 次，直到遇到空行、下一個「Nx」宣告、
 * 或文字結束。
 *
 * 這裡刻意只有一份 `SPACE_PERCENT_LINE_RE` + parseIntervalLine()：不管是
 * 獨立一行、還是「Nx」重複區塊裡收集到的每一行，newlineRepeatTextParser.js
 * 的狀態機都是呼叫同一個 parseIntervalLine() 函式（見 parseSpacePercentText()
 * 呼叫 parseNewlineRepeatText() 時傳進去的那個），沒有另外維護一套給重複
 * 區塊專用、規則比較寬鬆或嚴格的版本——rpm 支援只要在這個正則加一次，兩種
 * 情境就會同時生效，不用擔心以後改規則漏改其中一邊。
 *
 * parseSpacePercentText() 是純函式，跟其他 parser 一樣輸出統一的 Workout
 * JSON，不碰 UI。
 */
import { generateId } from '../utils/generateId.js';
import { parseNewlineRepeatText } from './newlineRepeatTextParser.js';

// exported so pasteTextRouter.js 可以用同一套正則判斷貼上的文字是不是這個格式。
// 行尾的「N rpm」是選填群組（第 4 組），沒有就是 undefined。
export const SPACE_PERCENT_LINE_RE = /^(\d+(?:\.\d+)?)\s*(m|s)\s+(\d+(?:\.\d+)?)%(?:\s+(\d+(?:\.\d+)?)\s*rpm)?$/i;

/**
 * @param {string} text - 使用者貼上的純文字
 * @returns {{id: string, name: string, source: 'paste-percent', totalDuration: number, intervals: Array}}
 */
export function parseSpacePercentText(text) {
  const intervals = parseNewlineRepeatText(text, parseIntervalLine, '"Xm Y%" or "Xs Y%"');
  const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0);

  return {
    id: generateId(),
    name: 'Untitled Workout',
    source: 'paste-percent',
    totalDuration,
    intervals,
  };
}

/** @returns {object|null} 一個穩定（steady）段，或 null（這行不是「Xm Y%」／「Xs Y%」格式） */
function parseIntervalLine(line) {
  const match = line.match(SPACE_PERCENT_LINE_RE);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const seconds = unit === 'm' ? amount * 60 : amount;
  const duration = Math.round(seconds);
  const powerPct = Math.round(Number(match[3]));
  const cadence = match[4] != null ? Math.round(Number(match[4])) : null;

  return { type: 'steady', duration, powerStart: powerPct, powerEnd: powerPct, cadence };
}
