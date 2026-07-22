/**
 * 「貼上課表文字內容」欄位收到的純文字可能是五種已知格式之一：
 *   - TrainerDay「完整複製」格式（優先判斷之一，見下方）：第一行常見
 *     「持续时间: 59m」總時長說明（跳過不解析）＋ `X min/sec @ Yw` 一般行
 *     ＋整行寫完的重複組 `NX (段落1 | 段落2 | ...)`
 *   - TrainerDay「Workout structure」格式（優先判斷之一，見下方）：頁面上
 *     「Workout structure」區塊顯示的 `X min @ Y% (Zw)` 一般行 + 獨立一行的
 *     「Nx」換行重複——跟「完整複製」格式不同，這裡的百分比是明寫的
 *     （`Y%`），括號內的 `Zw` 是依課表作者實際 FTP 換算出來的瓦數，跟這個
 *     App 的使用者 FTP 無關，直接忽略
 *   - TrainerDay 手動輸入格式：`X min @ Yw` + 獨立一行的「Nx」換行重複
 *   - WhatsOnZwift 格式：`Xmin @ Y% FTP`／`Xmin from A to B% FTP`／複合
 *     重複組寫成兩行（`Nx Xmin @ Y% FTP,` 接著下一行 `Zmin @ W% FTP`）
 *   - 「時長 百分比」格式：`Xm Y%`／`Xs Y%` + 獨立一行的「Nx」換行重複
 *
 * parseAutoDetectedPasteText() 只做「判斷是哪一種格式，交給對應的 parser
 * 處理」，不重複實作任何解析邏輯。
 *
 * TrainerDay「完整複製」格式優先判斷：只要整份文字裡出現「持续时間」總時長
 * 說明行，或是整行寫完的重複組 `NX (...)`，就直接判定是這個格式——這兩種
 * 寫法是這個格式獨有的，不會出現在其他格式裡，不需要跟「第一個看起來像
 * 課表內容的行」的判斷搶順序，使用者要求這個格式優先於舊的手動輸入格式。
 *
 * 其餘格式的判斷邏輯：找第一個看起來像課表內容的行（先去掉常見的清單項目
 * 符號前綴，例如從網頁清單複製貼上時常帶著的「‧ 」「* 」，不然這幾個符號
 * 會讓下面的格式判斷全部落空；再略過空行跟單獨的「Nx」宣告——那種行在多種
 * 格式裡都可能出現，不能用來判斷是哪一種格式），依它符合哪個格式的正則
 * 決定要用哪個 parser 解析「整份」文字（各 parser 內部也會做同樣的符號
 * 去除，不是只有這裡判斷格式時去除、實際解析時又漏掉）。`X min @ Y% (Zw)`
 * （TrainerDay「Workout structure」格式）跟 `X min @ Yw`（TrainerDay 手動
 * 輸入格式）先判斷前者，因為前者的正則比較嚴格（多了 `%` 跟括號），不會
 * 誤判到後者身上，順序對調也不影響結果，只是保持「更明確的格式先判斷」的
 * 習慣。如果第一個看起來像內容的行不符合任何已知格式，最後再試一次
 * TrainerDay「完整複製」格式的一般行寫法（`X min/sec @ Yw`，含手動輸入
 * 格式沒有的秒數單位）——涵蓋「整段複製但剛好沒有總時長行也沒有重複組」的
 * 情況。
 */
import { INTERVAL_LINE_RE, parsePasteText } from './pasteTextParser.js';
import { REPEAT_LINE_RE, stripBulletPrefix } from './newlineRepeatTextParser.js';
import { SPACE_PERCENT_LINE_RE, parseSpacePercentText } from './spacePercentTextParser.js';
import {
  TRAINERDAY_FULL_DURATION_HEADER_RE,
  TRAINERDAY_FULL_LINE_RE,
  TRAINERDAY_FULL_REPEAT_RE,
  parseTrainerDayFullText,
} from './trainerDayFullTextParser.js';
import {
  TRAINERDAY_STRUCTURE_LINE_RE,
  parseTrainerDayWorkoutStructureText,
} from './trainerDayWorkoutStructureParser.js';
import { WOZ_RAMP_LINE_RE, WOZ_REPEAT_FIRST_LINE_RE, WOZ_STEADY_LINE_RE, parseWhatsOnZwiftText } from './whatsOnZwiftParser.js';

/**
 * @param {string} text - 使用者貼上的純文字
 * @returns {object} Workout JSON（實際結構依偵測出的格式，由對應的 parser 決定）
 */
export function parseAutoDetectedPasteText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Invalid workout text: input must be a non-empty string');
  }

  const lines = text.split(/\r\n|\r|\n/).map((line) => stripBulletPrefix(line.trim()));

  const hasTrainerDayFullOnlyMarkers = lines.some(
    (line) => TRAINERDAY_FULL_DURATION_HEADER_RE.test(line) || TRAINERDAY_FULL_REPEAT_RE.test(line)
  );
  if (hasTrainerDayFullOnlyMarkers) return parseTrainerDayFullText(text);

  const firstContentLine = lines.find((line) => line !== '' && !REPEAT_LINE_RE.test(line));

  if (firstContentLine) {
    if (TRAINERDAY_STRUCTURE_LINE_RE.test(firstContentLine)) return parseTrainerDayWorkoutStructureText(text);
    if (INTERVAL_LINE_RE.test(firstContentLine)) return parsePasteText(text);
    if (
      WOZ_STEADY_LINE_RE.test(firstContentLine) ||
      WOZ_RAMP_LINE_RE.test(firstContentLine) ||
      WOZ_REPEAT_FIRST_LINE_RE.test(firstContentLine)
    ) {
      return parseWhatsOnZwiftText(text);
    }
    if (SPACE_PERCENT_LINE_RE.test(firstContentLine)) return parseSpacePercentText(text);
    if (TRAINERDAY_FULL_LINE_RE.test(firstContentLine)) return parseTrainerDayFullText(text);
  }

  throw new Error(
    `Invalid workout text: could not recognize the workout text format (expected "X min @ Yw", WhatsOnZwift's "%FTP" style, "Xm Y%"/"Xs Y%", TrainerDay's full copy-paste format, or TrainerDay's "Workout structure" format)`
  );
}
