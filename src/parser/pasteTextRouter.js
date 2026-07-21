/**
 * 「貼上課表文字內容」欄位收到的純文字可能是四種已知格式之一：
 *   - TrainerDay「完整複製」格式（主要格式，見下方優先判斷）：第一行常見
 *     「持续时间: 59m」總時長說明（跳過不解析）＋ `X min/sec @ Yw` 一般行
 *     ＋整行寫完的重複組 `NX (段落1 | 段落2 | ...)`
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
 * 寫法是這個格式獨有的，不會出現在其他三種格式裡，不需要跟「第一個看起來
 * 像課表內容的行」的判斷搶順序，用者要求這個格式優先於舊的手動輸入格式。
 *
 * 其餘三種格式的判斷邏輯不變：找第一個看起來像課表內容的行（先去掉常見的
 * 清單項目符號前綴，例如從網頁清單複製貼上時常帶著的「‧ 」「* 」，不然這
 * 幾個符號會讓下面的格式判斷全部落空；再略過空行跟單獨的「Nx」宣告——那
 * 種行在 TrainerDay 手動輸入格式跟「時長 百分比」格式裡都可能出現，不能
 * 用來判斷是哪一種格式），依它符合哪個格式的正則決定要用哪個 parser 解析
 * 「整份」文字（各 parser 內部也會做同樣的符號去除，不是只有這裡判斷格式
 * 時去除、實際解析時又漏掉）。如果第一個看起來像內容的行不符合任何已知
 * 格式，最後再試一次 TrainerDay「完整複製」格式的一般行寫法（`X min/sec @
 * Yw`，含手動輸入格式沒有的秒數單位）——涵蓋「整段複製但剛好沒有總時長行
 * 也沒有重複組」的情況。
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
    `Invalid workout text: could not recognize the workout text format (expected "X min @ Yw", WhatsOnZwift's "%FTP" style, "Xm Y%"/"Xs Y%", or TrainerDay's full copy-paste format)`
  );
}
