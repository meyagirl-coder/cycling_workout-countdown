/**
 * 共用的「HTML → 一行一個區塊元素的純文字」工具，給各家課表網站的擷取模組
 * （例如 extractTrainerDayWorkoutStructureFromHtml.js）共用——「怎麼把 HTML
 * 轉成一行一行的文字」跟「哪些行算課表內容」是兩件事，這裡只處理前者，後者
 * 由各自的 parser 提供判斷用的正則。
 */
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BR_RE = /<br\s*\/?>/gi;
const BLOCK_CLOSE_RE = /<\/(p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|tbody|thead|button|nav|main|pre)>/gi;
const TAG_RE = /<[^>]+>/g;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtmlEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()]);
}

/**
 * @param {string} html
 * @returns {string[]} 一行一個區塊元素的純文字（inline 元素保留在同一行內），
 *   已 trim；沒有文字內容的區塊元素會是空字串（保留，不過濾），呼叫端可以
 *   用它來判斷兩個有意義的行之間原本是否隔著其他內容。
 */
export function htmlToLines(html) {
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

/**
 * 把 htmlToLines() 的結果篩選成只留下符合 isMatch() 的行；如果兩個符合的行
 * 之間原本夾著別的內容（不管是空白行還是其他文字），保留成一個空行——
 * 課表文字 parser 靠空行判斷「Nx」重複組在哪裡結束，這裡如果把中間的雜訊
 * 直接砍光、兩行硬接在一起，重複組會誤吃到不屬於它的下一行。
 *
 * @param {string[]} lines
 * @param {(line: string) => boolean} isMatch
 * @returns {string[]}
 */
export function collapseToMatchingLines(lines, isMatch) {
  const result = [];
  let sawMatch = false;
  let pendingGap = false;

  for (const line of lines) {
    const matched = line !== '' && isMatch(line);
    if (matched) {
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
