/**
 * 「時長 百分比」課表文字解析器：跟 pasteTextParser.js（TrainerDay 格式，
 * `X min @ Yw`）並存的第三種手動貼上格式，例如 `5m 50%`——沒有 `@`、沒有
 * `w`、沒有 `FTP` 字樣，單位用 `m`（分鐘）／`s`（秒），數字直接就是 %FTP。
 *
 * 也支援「Nx」換行重複寫法，語意跟 pasteTextParser.js 一致（見
 * newlineRepeatTextParser.js 共用的狀態機）：單獨一行的「Nx」宣告接下來
 * 連續的 `Xm Y%`／`Xs Y%` 行要重複 N 次，直到遇到空行、下一個「Nx」宣告、
 * 或文字結束。
 *
 * parseSpacePercentText() 是純函式，跟其他 parser 一樣輸出統一的 Workout
 * JSON，不碰 UI。
 */
import { generateId } from '../utils/generateId.js';
import { parseNewlineRepeatText } from './newlineRepeatTextParser.js';

// exported so pasteTextRouter.js 可以用同一套正則判斷貼上的文字是不是這個格式
export const SPACE_PERCENT_LINE_RE = /^(\d+(?:\.\d+)?)\s*(m|s)\s+(\d+(?:\.\d+)?)%$/i;

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

  return { type: 'steady', duration, powerStart: powerPct, powerEnd: powerPct, cadence: null };
}
