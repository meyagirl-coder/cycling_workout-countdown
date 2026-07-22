/**
 * 共用的「HTML → 一行一個區塊元素的純文字」工具，給各家課表網站的擷取模組
 * （例如 extractTrainerDayWorkoutStructureFromHtml.js）共用——「怎麼把 HTML
 * 轉成一行一行的文字」跟「哪些行算課表內容」是兩件事，這裡只處理前者，後者
 * 由各自的 parser 提供判斷用的正則。
 */
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BR_RE = /<br\s*\/?>/gi;
const BLOCK_CLOSE_RE = /<\/(p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|tbody|thead|button|nav|main|pre)>/gi;
// 巢狀清單（例如重複組底下用 <ul>/<ol> 列出子項目，中間那個 <li>「4X」自己
// 沒有先閉合就直接開了下一層清單：`<li>4X<ul><li>...`）：只靠 BLOCK_CLOSE_RE
// （只認閉合標籤）的話，「4X」跟它底下第一個子項目的文字會被黏在同一行
// （因為中間沒有任何閉合標籤，只有巢狀清單的開始標籤），導致「4X」這個重複
// 宣告本身連同底下的內容整行都判斷不出格式、被完全丟棄。這幾個「純容器」
// 標籤（本身不會直接夾文字，只用來包住其他區塊子元素）的開始標籤也要視為
// 換行點，才能把「4X」跟它底下的子項目拆成各自獨立的行。故意只加這幾個純
// 容器標籤，不含 li／div／p 等「本身會直接夾文字」的標籤——那些標籤的開始
// 標籤如果也觸發換行，會在兩個相鄰、之間什麼都沒有的區塊元素間多插入一個
// 空行，誤觸發 collapseToMatchingLines() 的「兩個相符行之間夾著別的內容」
// 判斷，把明明緊接在一起的課表行誤判成中間有缺漏。
const NESTING_CONTAINER_OPEN_RE = /<(?:ul|ol|table|tbody|thead)(?:\s[^>]*)?>/gi;
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
  text = text.replace(BR_RE, '\n').replace(BLOCK_CLOSE_RE, '\n').replace(NESTING_CONTAINER_OPEN_RE, '\n');
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
