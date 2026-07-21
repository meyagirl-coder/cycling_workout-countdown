/**
 * 從 WhatsOnZwift 課表頁面的完整 HTML 裡，撈出符合 WhatsOnZwift 文字格式的行
 * （ramp／steady／複合重複組的兩行），組成一份可以直接餵給
 * parseWhatsOnZwiftText() 的純文字——「什麼樣的行算課表內容」跟
 * whatsOnZwiftParser.js 共用同一套正則，不重寫一份新的判斷邏輯。
 *
 * 沒有實際頁面的即時 HTML 結構可以核對（開發環境的網路政策擋掉了
 * whatsonzwift.com），所以刻意不依賴任何猜測出來的 CSS class／id，改用
 * htmlTextExtraction.js 共用的「HTML 轉一行一個區塊元素」邏輯，只留下整行
 * 剛好符合三種課表行格式的行；兩個課表行之間如果原本夾著其他文字，保留成
 * 一個空行——parseWhatsOnZwiftText() 會忽略空行（包括複合重複組兩行中間夾
 * 著空行的情況），所以這裡就算頁面結構在兩行之間插了其他東西，也不會影響
 * 重複組能不能正確配對。
 *
 * 跟 extractWorkoutTextFromHtml.js（TrainerDay）不同，這裡刻意不做「寬鬆
 * 模式」的片段搜尋備援——WhatsOnZwift 的複合重複組格式（「Nx 第一段,」+
 * 下一行「第二段」兩行合起來才算一組）比 TrainerDay 單純的「X min @ Yw」
 * 複雜很多，如果不要求整行完全符合格式、只在一大段文字裡搜尋片段，很容易
 * 把不相關的內容誤組成一個「看起來合理但其實是錯的」複合重複組——這種
 * 「安靜地算錯」比直接擷取失敗、提示使用者改用「貼上課表文字內容」更危險，
 * 所以沒有比對到任何整行格式就直接視為擷取失敗。
 */
import { WOZ_RAMP_LINE_RE, WOZ_REPEAT_FIRST_LINE_RE, WOZ_STEADY_LINE_RE } from './whatsOnZwiftParser.js';
import { collapseToMatchingLines, htmlToLines } from './htmlTextExtraction.js';

/**
 * @param {string} html - WhatsOnZwift 課表頁面的完整 HTML
 * @returns {string} 可以直接餵給 parseWhatsOnZwiftText() 的純文字；擷取失敗回傳空字串
 */
export function extractWhatsOnZwiftTextFromHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return '';

  const lines = htmlToLines(html);
  const matchedLines = collapseToMatchingLines(
    lines,
    (line) => WOZ_REPEAT_FIRST_LINE_RE.test(line) || WOZ_RAMP_LINE_RE.test(line) || WOZ_STEADY_LINE_RE.test(line)
  );

  if (matchedLines.length === 0) return '';
  return matchedLines.join('\n');
}
