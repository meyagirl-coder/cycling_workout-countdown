/**
 * 從 TrainerDay 課表頁面的完整 HTML 裡，撈出「Workout structure」區塊顯示的
 * `X min @ Y% (Zw)` 行（跟獨立一行的「Nx」重複組宣告），組成一份可以直接餵
 * 給 parseTrainerDayWorkoutStructureText() 的純文字——「什麼樣的行算課表
 * 內容」跟 trainerDayWorkoutStructureParser.js 共用同一套正則，不重寫一份
 * 新的判斷邏輯。
 *
 * 這個沙箱環境的網路政策擋掉了 app.trainerday.com，沒辦法抓實際頁面的即時
 * HTML 結構核對，所以刻意不依賴任何猜測出來的 CSS class／id，改用兩層文字
 * 模式擷取，對頁面標記結構的變化有一定容忍度：
 *
 *   1. 嚴格模式：把 HTML 轉成一行一個區塊元素的純文字，只留下「整行」剛好
 *      符合課表行格式的行——如果課表在頁面上是逐行渲染的（例如每組是自己的
 *      <div>/<tr>），這個模式準確度最高，不容易誤判到無關的頁面文字。兩個
 *      課表行之間如果原本夾著其他文字，會保留成一個空行——這對
 *      parseTrainerDayWorkoutStructureText() 判斷「Nx」重複組在哪裡結束
 *      很重要。
 *   2. 寬鬆模式：嚴格模式什麼都沒找到時的備援，直接在整份轉換後的文字裡
 *      搜尋「X min @ Y% (Zw)」與「Nx」片段（不要求整行只有這個內容），照
 *      出現順序組合。容忍度較高，但也更容易誤判到頁面上剛好長得像的其他
 *      文字。
 *
 * 兩種模式都找不到就回傳空字串，呼叫端（api/trainerday-workout.js）視為
 * 擷取失敗，提示使用者改用「貼上課表文字內容」。
 */
import { REPEAT_LINE_RE, TRAINERDAY_STRUCTURE_LINE_RE } from './trainerDayWorkoutStructureParser.js';
import { collapseToMatchingLines, htmlToLines } from './htmlTextExtraction.js';
import { stripBulletPrefix, stripMarkdownBold } from './newlineRepeatTextParser.js';

const INTERVAL_SEARCH_RE = /\d+(?:\.\d+)?\s*(?:min|sec)\s*@\s*\d+(?:\.\d+)?%\s*\(\s*\d+(?:\.\d+)?\s*w\s*\)/gi;
const REPEAT_SEARCH_RE = /(?:^|[^\w])(\d+)\s*x(?=[^\w]|$)/gi;

/**
 * 嚴格模式：只留下整行剛好符合課表格式的行，保留有意義的段落間隔。判斷前先
 * 做跟 parseTrainerDayWorkoutStructureText() 一樣的正規化（去項目符號、去
 * Markdown 粗體）——如果頁面本身用類似 Markdown 的方式渲染課表結構（例如
 * 重複組宣告字面上就是 `**4X**`），這裡不正規化的話，即使正則本身已經支援
 * 狀態標籤／踏頻，還是會因為多出來的 `**` 而整行判斷失敗。
 */
function extractStrict(lines) {
  return collapseToMatchingLines(lines, (line) => {
    const normalized = stripBulletPrefix(stripMarkdownBold(line));
    return TRAINERDAY_STRUCTURE_LINE_RE.test(normalized) || REPEAT_LINE_RE.test(normalized);
  });
}

/** 寬鬆模式：不要求整行只有課表內容，直接在合併後的文字裡依出現順序搜尋片段 */
function extractLoose(lines) {
  const combined = lines.join(' ');
  const matches = [];

  // 用同一個字串跑兩個獨立的 global regex，各自記錄命中位置，再依位置排序、
  // 合併成一份照原文順序的清單——這樣「Nx」跟它後面的組別行才不會亂掉順序。
  for (const match of combined.matchAll(INTERVAL_SEARCH_RE)) {
    matches.push({ index: match.index, text: match[0].trim() });
  }
  for (const match of combined.matchAll(REPEAT_SEARCH_RE)) {
    matches.push({ index: match.index + match[0].indexOf(match[1]), text: `${match[1]}x` });
  }

  return matches.sort((a, b) => a.index - b.index).map((m) => m.text);
}

/**
 * @param {string} html - TrainerDay 課表頁面的完整 HTML
 * @returns {string} 可以直接餵給 parseTrainerDayWorkoutStructureText() 的純文字；擷取失敗回傳空字串
 */
export function extractTrainerDayWorkoutStructureFromHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return '';

  const lines = htmlToLines(html);

  const strictLines = extractStrict(lines);
  // 跟 extractStrict() 內部判斷用的是同一套正規化（去項目符號、去 Markdown
  // 粗體）——這裡只是再次確認「至少有一行是真的課表內容行，不是只湊到一堆
  // 空行」，不正規化的話，一份全部是「- Active ...」「- **4X**」這種格式的
  // 頁面會在這一步整批判斷失敗，回退去用準確度較低的寬鬆模式。
  if (strictLines.some((line) => TRAINERDAY_STRUCTURE_LINE_RE.test(stripBulletPrefix(stripMarkdownBold(line))))) {
    return strictLines.join('\n');
  }

  const looseLines = extractLoose(lines);
  if (looseLines.length === 0) return '';
  return looseLines.join('\n');
}
