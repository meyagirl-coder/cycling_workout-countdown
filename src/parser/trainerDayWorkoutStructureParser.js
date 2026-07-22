/**
 * TrainerDay 課表頁面「Workout structure」區塊的文字格式：跟已支援的
 * 「完整複製」格式（trainerDayFullTextParser.js，`X min @ Yw`，瓦數直接等於
 * FTP=100 基準下的百分比）不一樣，這裡的每一行是 `X min @ Y% (Zw)`——百分比
 * 是明寫的（不需要「未登入時瓦數=FTP=100 基準」這個假設），括號內的 `Zw` 是
 * 依照課表作者實際 FTP 換算出來的瓦數，跟這個 App 使用者自己的 FTP 無關，直接
 * 忽略，只取前面的 `Y%`。
 *
 * 支援三種「重複」寫法：
 *   1. 「Nx」獨立一行＋後面連續幾行內容（見 newlineRepeatTextParser.js 共用
 *      的狀態機），直到遇到空行、下一個「Nx」宣告、縮排深度掉回宣告那一行
 *      的水準、或文字結束。
 *   2. 縮排星號代表重複區塊範圍（例如 `**4X**` 底下用兩個空格＋`*` 列出重複
 *      內容），也是同一套狀態機（縮排終止規則）處理，不是另一套邏輯。
 *   3. 整行寫完的括號重複組 `NX (段落1 | 段落2 | ...)`，跟
 *      trainerDayFullTextParser.js 的寫法一樣，也是共用
 *      newlineRepeatTextParser.js 的 `BRACKET_REPEAT_LINE_RE` 處理（自帶次數
 *      跟內容，不需要「收集到哪裡結束」，遇到就直接展開）。
 *
 * 實際頁面內容比對照組 12 行 ramp-up 範例更複雜，還有兩個「描述性資訊」，
 * 不影響時長／百分比的判斷：
 *   - **行首的狀態標籤**：平台官方定義的類型（不分大小寫，前面的清單符號可
 *     有可無）：`warm-up`／`warmup`、`active`、`cooldown`、`interval`、
 *     `rest`、`free-ride`／`freeride`、`open-ended`。
 *   - **行尾的踏頻**（例如 `90 rpm`）：Workout Schema 本來就有 `cadence`
 *     欄位，能抓到就存進去；抓不到（沒有這段文字）就維持 `null`。
 * 另外，重複組宣告也可能用 Markdown 粗體包住（`**4X**`），由
 * newlineRepeatTextParser.js 的 `stripMarkdownBold()` 統一處理。
 *
 * **判斷原則（實際解析每一行內容時採用）**：不管一行裡出現多少狀態標籤字、
 * 或額外資訊（括號瓦數、踏頻），只要能抓到「時長」跟「百分比」（用
 * `X min/sec @ Y%` 這個核心片段辨認）就算解析成功，不要求整行只有這個內容，
 * 前後可以有任意其他文字；只有整行完全找不到這個核心片段，才算真正的格式
 * 錯誤。這是刻意跟下面 `TRAINERDAY_STRUCTURE_LINE_RE` 的嚴格版本分開：那個
 * 嚴格版本只用在「判斷貼上的文字是不是這個格式」（pasteTextRouter.js／
 * extractTrainerDayWorkoutStructureFromHtml.js），用官方標籤清單＋整行錨定
 * 結構，避免跟 WhatsOnZwift 的「%FTP」格式（沒有括號瓦數）混淆；一旦已經
 * 判定是這個格式，實際逐行解析就改用更寬容的版本，不需要整行剛好符合預期
 * 結構，才不會被課表作者寫法上的細節差異卡住。括號瓦數 `(Zw)` 仍然是必要
 * 條件（用來跟 WhatsOnZwift 的「% FTP」字面寫法區分），不是「隨便抓到數字
 * ＋% 就算」。
 *
 * parseTrainerDayWorkoutStructureText() 是純函式，跟其他 parser 一樣輸出
 * 統一的 Workout JSON（見 src/schema/workoutSchema.js），不碰 UI。
 */
import { generateId } from '../utils/generateId.js';
import { BRACKET_REPEAT_LINE_RE, parseNewlineRepeatText, REPEAT_LINE_RE } from './newlineRepeatTextParser.js';

// exported so pasteTextRouter.js／extractTrainerDayWorkoutStructureFromHtml.js 可以
// 用同一套正則判斷貼上（或抓回來）的文字是不是這個格式——用官方定義的狀態
// 標籤清單（不是隨便抓任何英文單字），行尾容許選填的 "N rpm" 踏頻資訊，兩者
// 都是描述性文字，不影響核心的 `X min @ Y% (Zw)` 判斷。這是「格式偵測用」的
// 嚴格版本，實際逐行解析時用的是下面更寬容的 CORE_INTERVAL_RE（見檔案開頭
// 說明）。
const STATUS_LABEL_ALTERNATION = 'warm-?up|active|cooldown|interval|rest|free-?ride|open-ended';
export const TRAINERDAY_STRUCTURE_LINE_RE = new RegExp(
  `^(?:(?:${STATUS_LABEL_ALTERNATION})\\s+)*(\\d+(?:\\.\\d+)?)\\s*(min|sec)\\s*@\\s*(\\d+(?:\\.\\d+)?)%\\s*\\(\\s*\\d+(?:\\.\\d+)?\\s*w\\s*\\)(?:\\s+(\\d+(?:\\.\\d+)?)\\s*rpm)?$`,
  'i'
);
export { REPEAT_LINE_RE, BRACKET_REPEAT_LINE_RE };

// 實際逐行解析用的寬容版本：不要求整行只有這個內容，只找「時長 @ 百分比
// (瓦數)」這段核心片段——行首多少個狀態標籤字、行尾有沒有踏頻，都不影響
// 判斷是否解析成功，只要抓不到這段核心片段才算格式錯誤。
const CORE_INTERVAL_RE = /(\d+(?:\.\d+)?)\s*(min|sec)\s*@\s*(\d+(?:\.\d+)?)\s*%\s*\(\s*\d+(?:\.\d+)?\s*w\s*\)/i;
const CADENCE_RE = /(\d+(?:\.\d+)?)\s*rpm/i;

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

/**
 * @returns {object|null} 一個穩定（steady）段，或 null（這行完全找不到
 *   「X min/sec @ Y% (Zw)」這段核心片段——不管前後還有什麼其他文字）
 */
function parseIntervalLine(line) {
  const match = line.match(CORE_INTERVAL_RE);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const seconds = unit === 'min' ? amount * 60 : amount;
  const duration = Math.round(seconds);
  const powerPct = Math.round(Number(match[3])); // 明寫的百分比，括號內的瓦數忽略

  const cadenceMatch = line.match(CADENCE_RE);
  const cadence = cadenceMatch ? Math.round(Number(cadenceMatch[1])) : null; // 行尾的 "N rpm"，沒有就是 null

  return { type: 'steady', duration, powerStart: powerPct, powerEnd: powerPct, cadence };
}
