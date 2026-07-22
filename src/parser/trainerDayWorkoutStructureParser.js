/**
 * TrainerDay 課表頁面「Workout structure」區塊的文字格式：跟已支援的
 * 「完整複製」格式（trainerDayFullTextParser.js，`X min @ Yw`，瓦數直接等於
 * FTP=100 基準下的百分比）不一樣，這裡的每一行是 `X min @ Y% (Zw)`——百分比
 * 是明寫的（不需要「未登入時瓦數=FTP=100 基準」這個假設），括號內的 `Zw` 是
 * 依照課表作者實際 FTP 換算出來的瓦數，跟這個 App 的使用者 FTP 無關，直接
 * 忽略，只取前面的 `Y%`。
 *
 * 也支援「Nx」換行重複寫法，語意跟 pasteTextParser.js／
 * spacePercentTextParser.js 一致（見 newlineRepeatTextParser.js 共用的
 * 狀態機）：單獨一行的「Nx」宣告接下來連續的 `X min @ Y% (Zw)` 行要重複 N
 * 次，直到遇到空行、下一個「Nx」宣告、或文字結束。
 *
 * parseTrainerDayWorkoutStructureText() 是純函式，跟其他 parser 一樣輸出
 * 統一的 Workout JSON（見 src/schema/workoutSchema.js），不碰 UI。
 */
import { generateId } from '../utils/generateId.js';
import { parseNewlineRepeatText, REPEAT_LINE_RE } from './newlineRepeatTextParser.js';

// exported so pasteTextRouter.js 可以用同一套正則判斷貼上的文字是不是這個格式
export const TRAINERDAY_STRUCTURE_LINE_RE = /^(\d+(?:\.\d+)?)\s*(min|sec)\s*@\s*(\d+(?:\.\d+)?)%\s*\(\s*\d+(?:\.\d+)?\s*w\s*\)$/i;
export { REPEAT_LINE_RE };

/**
 * @param {string} text - 使用者貼上的「Workout structure」文字
 * @returns {{id: string, name: string, source: 'paste-trainerday-structure', totalDuration: number, intervals: Array}}
 */
export function parseTrainerDayWorkoutStructureText(text) {
  const intervals = parseNewlineRepeatText(text, parseIntervalLine, '"X min @ Y% (Zw)"');
  const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0);

  return {
    id: generateId(),
    name: 'Untitled Workout',
    source: 'paste-trainerday-structure',
    totalDuration,
    intervals,
  };
}

/** @returns {object|null} 一個穩定（steady）段，或 null（這行不是「X min/sec @ Y% (Zw)」格式） */
function parseIntervalLine(line) {
  const match = line.match(TRAINERDAY_STRUCTURE_LINE_RE);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const seconds = unit === 'min' ? amount * 60 : amount;
  const duration = Math.round(seconds);
  const powerPct = Math.round(Number(match[3])); // 明寫的百分比，括號內的瓦數忽略

  return { type: 'steady', duration, powerStart: powerPct, powerEnd: powerPct, cadence: null };
}
