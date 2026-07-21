/**
 * 「貼上課表文字內容」欄位收到的純文字可能是三種已知格式之一：
 *   - TrainerDay 格式：`X min @ Yw` + 獨立一行的「Nx」換行重複
 *   - WhatsOnZwift 格式：`Xmin @ Y% FTP`／`Xmin from A to B% FTP`／複合
 *     重複組寫成兩行（`Nx Xmin @ Y% FTP,` 接著下一行 `Zmin @ W% FTP`）
 *   - 「時長 百分比」格式：`Xm Y%`／`Xs Y%` + 獨立一行的「Nx」換行重複
 *
 * parseAutoDetectedPasteText() 只做「判斷是哪一種格式，交給對應的 parser
 * 處理」，不重複實作任何解析邏輯：找第一個看起來像課表內容的行（略過空行
 * 跟單獨的「Nx」宣告——那種行在 TrainerDay 格式跟「時長 百分比」格式裡都
 * 可能出現，不能用來判斷是哪一種格式），依它符合哪個格式的正則決定要用
 * 哪個 parser 解析「整份」文字。三種格式的行形狀差異夠大（有沒有 `@`、有
 * 沒有 `w` 字尾、有沒有 `FTP` 字樣、還是「純數字＋單位＋百分比」），不會
 * 互相誤判。
 */
import { INTERVAL_LINE_RE, parsePasteText } from './pasteTextParser.js';
import { REPEAT_LINE_RE } from './newlineRepeatTextParser.js';
import { SPACE_PERCENT_LINE_RE, parseSpacePercentText } from './spacePercentTextParser.js';
import { WOZ_RAMP_LINE_RE, WOZ_REPEAT_FIRST_LINE_RE, WOZ_STEADY_LINE_RE, parseWhatsOnZwiftText } from './whatsOnZwiftParser.js';

/**
 * @param {string} text - 使用者貼上的純文字
 * @returns {object} Workout JSON（實際結構依偵測出的格式，由對應的 parser 決定）
 */
export function parseAutoDetectedPasteText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Invalid workout text: input must be a non-empty string');
  }

  const lines = text.split(/\r\n|\r|\n/).map((line) => line.trim());
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
  }

  throw new Error(
    `Invalid workout text: could not recognize the workout text format (expected "X min @ Yw", WhatsOnZwift's "%FTP" style, or "Xm Y%"/"Xs Y%")`
  );
}
