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
 * 狀態機，包含縮排也可以當區塊終止信號這條規則）：單獨一行的「Nx」宣告
 * 接下來連續的 `X min @ Y% (Zw)` 行要重複 N 次，直到遇到空行、下一個
 * 「Nx」宣告、縮排深度掉回宣告那一行的水準、或文字結束。
 *
 * 更複雜的實際頁面內容（比對照組 12 行 ramp-up 範例更貼近真實課表）還會有
 * 兩個額外元素，都是「描述性資訊」，不影響時長／百分比的判斷：
 *   - **行首的狀態標籤**（例如 `Active`／`Rest`／`Cooldown`／`Warmup`）：
 *     純文字說明，直接忽略，不影響這行本身是不是合法的課表行。
 *   - **行尾的踏頻**（例如 `90 rpm`）：Workout Schema 本來就有 `cadence`
 *     欄位，能抓到就存進去；抓不到（沒有這段文字）就維持 `null`，不影響
 *     主要的時長／百分比解析。
 * 另外，重複組宣告也可能用 Markdown 粗體包住（`**4X**`），一樣由
 * newlineRepeatTextParser.js 的 `stripMarkdownBold()` 統一處理。
 *
 * parseTrainerDayWorkoutStructureText() 是純函式，跟其他 parser 一樣輸出
 * 統一的 Workout JSON（見 src/schema/workoutSchema.js），不碰 UI。
 */
import { generateId } from '../utils/generateId.js';
import { parseNewlineRepeatText, REPEAT_LINE_RE } from './newlineRepeatTextParser.js';

// exported so pasteTextRouter.js 可以用同一套正則判斷貼上的文字是不是這個格式
// 行首容許 0 個以上的「狀態標籤」單字（例如 "Active "／"Cooldown "），行尾
// 容許選填的 "N rpm" 踏頻資訊——兩者都是描述性文字，不影響核心的
// `X min @ Y% (Zw)` 判斷。
export const TRAINERDAY_STRUCTURE_LINE_RE =
  /^(?:[A-Za-z]+\s+)*(\d+(?:\.\d+)?)\s*(min|sec)\s*@\s*(\d+(?:\.\d+)?)%\s*\(\s*\d+(?:\.\d+)?\s*w\s*\)(?:\s+(\d+(?:\.\d+)?)\s*rpm)?$/i;
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
  const cadence = match[4] !== undefined ? Math.round(Number(match[4])) : null; // 行尾的 "N rpm"，沒有就是 null

  return { type: 'steady', duration, powerStart: powerPct, powerEnd: powerPct, cadence };
}
