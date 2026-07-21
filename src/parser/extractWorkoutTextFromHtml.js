/**
 * 從公開課表頁面（例如 TrainerDay 未登入狀態）的完整 HTML 裡，撈出符合
 * 「貼上課表文字」parser 認得的行（`X min @ Yw`／`Nx` 重複組宣告），組成一份
 * 可以直接餵給 parsePasteText() 的純文字——不重寫一份新的課表解析邏輯，
 * 「什麼樣的行算課表內容」這件事跟 pasteTextParser.js 共用同一套正則。
 *
 * 沒有實際頁面的即時 HTML 結構可以核對（開發環境的網路政策擋掉了
 * app.trainerday.com），所以這裡刻意不依賴任何猜測出來的 CSS class／id，
 * 改用兩層文字模式擷取，對頁面標記結構的變化有一定容忍度：
 *
 *   1. 嚴格模式：把 HTML 轉成一行一個區塊元素的純文字，只留下「整行」剛好
 *      符合課表行格式的行——如果課表在頁面上是逐行渲染的（例如每組是自己的
 *      <div>/<tr>），這個模式準確度最高，不容易誤判到無關的頁面文字。兩個
 *      課表行之間如果原本夾著其他文字（例如區段標題「Cool Down」），會保留
 *      成一個空行——這對 parsePasteText() 判斷「Nx」重複組在哪裡結束很重要
 *      （見下方 extractStrict 的說明）。
 *   2. 寬鬆模式：嚴格模式什麼都沒找到時的備援，直接在整份轉換後的文字裡搜尋
 *      「X min @ Yw」與「Nx」片段（不要求整行只有這個內容），照出現順序組合。
 *      容忍度較高，但也更容易誤判到頁面上剛好長得像的其他文字。
 *
 * 兩種模式都找不到就回傳空字串，呼叫端（api/trainerday-workout.js）視為
 * 擷取失敗，提示使用者改用「直接複製貼上文字內容」。
 *
 * 已知限制：如果頁面把「Nx」重複組的內容跟後面緊接著的另一組（例如收操）
 * 中間完全沒有任何其他文字或標記隔開，純文字擷取沒辦法分辨兩者的邊界在
 * 哪裡，`parsePasteText()` 會依它原本的規則（空行／下一個 Nx／文字結束才
 * 算重複組結束）把後面那一行也吃進重複組裡——這個模組沒有實際 TrainerDay
 * 頁面的 HTML 可以核對（開發環境網路政策擋掉了 app.trainerday.com），如果
 * 部署後發現抓到的課表跟預期不同，請改用「直接複製貼上文字內容」。
 */
import { INTERVAL_LINE_RE, REPEAT_LINE_RE } from './pasteTextParser.js';

const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BR_RE = /<br\s*\/?>/gi;
const BLOCK_CLOSE_RE = /<\/(p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|tbody|thead|button|nav|main|pre)>/gi;
const TAG_RE = /<[^>]+>/g;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const INTERVAL_SEARCH_RE = /\d+(?:\.\d+)?\s*min\s*@\s*\d+(?:\.\d+)?\s*w/gi;
const REPEAT_SEARCH_RE = /(?:^|[^\w])(\d+)\s*x(?=[^\w]|$)/gi;

/** @returns {string} HTML 轉出的純文字，區塊元素之間用換行分隔（保留 inline 元素在同一行內） */
function htmlToLines(html) {
  let text = html.replace(SCRIPT_STYLE_RE, ' ');
  // 原始 HTML 排版用的換行/縮排先全部壓成單一空白，這樣同一個區塊裡被
  // inline 標籤（例如 <span>）拆開的文字（"10 min <span>@</span> 53w"）才不
  // 會被誤判成好幾行——只有下面明確處理的區塊標籤／<br> 才會真的換行。
  text = text.replace(/\s+/g, ' ');
  text = text.replace(BR_RE, '\n').replace(BLOCK_CLOSE_RE, '\n');
  text = text.replace(TAG_RE, '');
  text = decodeHtmlEntities(text);

  return text.split('\n').map((line) => line.trim());
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()]);
}

/**
 * 嚴格模式：只留下整行剛好符合課表格式的行；如果兩個課表行之間原本夾著別的
 * 內容（不管是真的空白行,還是其他非課表文字),保留成一個空行——
 * parsePasteText() 靠空行判斷「Nx」重複組在哪裡結束，這裡如果把中間的雜訊
 * 直接砍光、兩個課表行硬接在一起，重複組會誤吃到不屬於它的下一行。
 */
function extractStrict(lines) {
  const result = [];
  let sawMatch = false;
  let pendingGap = false;

  for (const line of lines) {
    const isMatch = line !== '' && (INTERVAL_LINE_RE.test(line) || REPEAT_LINE_RE.test(line));
    if (isMatch) {
      if (sawMatch && pendingGap) result.push('');
      result.push(line);
      sawMatch = true;
      pendingGap = false;
    } else if (sawMatch) {
      pendingGap = true;
    }
  }

  return result;
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
 * @param {string} html - 課表公開頁面的完整 HTML
 * @returns {string} 可以直接餵給 parsePasteText() 的純文字；擷取失敗回傳空字串
 */
export function extractWorkoutTextFromHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return '';

  const lines = htmlToLines(html);

  const strictLines = extractStrict(lines);
  if (strictLines.some((line) => INTERVAL_LINE_RE.test(line))) {
    return strictLines.join('\n');
  }

  const looseLines = extractLoose(lines);
  if (looseLines.length === 0) return '';
  return looseLines.join('\n');
}
