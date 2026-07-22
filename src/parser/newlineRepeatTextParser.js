/**
 * 共用的「Nx 換行重複」文字掃描器：適用於「重複次數獨立一行宣告（例如
 * `3x`），後面連續幾行課表內容要重複 N 次」這種寫法的格式——pasteTextParser.js
 * （TrainerDay 格式）跟 spacePercentTextParser.js（「時長 百分比」格式）都是
 * 這種寫法，只有「一行課表內容長什麼樣子」不同，所以把這套狀態機抽出來共用，
 * 不必各自維護一份幾乎一樣、容易顧此失彼的重複區塊收集邏輯。
 *
 * 重複區塊的終止規則（唯一標準，不是行數、不是有沒有項目符號前綴）：
 *
 *   1. 讀到「Nx」這一行，開始收集接下來的行，直到遇到空行（或文字結束）為
 *      止——這些行就是這次要重複 N 次的內容。
 *   2. 空行本身不算資料，純粹是區塊分隔的信號，讀到就結束目前的收集。
 *   3. 空行後如果馬上又是「Nx」，代表開始下一個新的重複區塊；如果不是，就
 *      是一行獨立內容（不重複），直到遇到下一個空行或下一個「Nx」為止。
 *   4. 支援常見的清單項目符號前綴（`stripBulletPrefix()`），但這個符號只
 *      影響「這行讀起來是什麼」，完全不影響上面 1-3 點「什麼時候算區塊結束」
 *      的判斷。
 *
 * 例：
 *   2x
 *   3m 50%
 *   30s 120%
 *   <空行>
 *   5m 90%
 * → 「3m 50%」「30s 120%」合起來重複 2 次，遇到空行後這個重複區塊結束；
 *   「5m 90%」是空行後的獨立一行，不重複。
 *
 * 另外，即使沒有空行分隔，「下一個 Nx 宣告」本身也會立刻結束目前正在收集的
 * 區塊（等同於一個隱性的空行）——這是為了讓連續兩個重複區塊可以緊接著寫，
 * 不強制中間一定要留空行。
 *
 * **縮排也可以是區塊終止信號（第二種終止規則，跟空行並存）**：有些來源
 * （例如 TrainerDay「Workout structure」用 Markdown 巢狀清單呈現重複組，
 * `**4X**` 底下用兩個空格 + `*` 縮排列出重複內容，緊接著下一個不縮排的
 * 項目沒有空行分隔）沒有空行可用，只能靠縮排深度判斷。規則：
 *   1. 「Nx」宣告那一行本身的縮排（原始行前面的空白字元數，不含符號）記
 *      成這個區塊的 `headerIndent`。
 *   2. 只要區塊收集到「至少一行縮排嚴格大於 headerIndent」的內容行，這個
 *      區塊就標記為「用縮排判斷邊界」（`usesIndentBoundary`）。
 *   3. 一旦標記了，之後只要遇到縮排 `<= headerIndent` 的行（不管是不是空
 *      行），就視為區塊結束，立刻 flush，再把這行當作全新的一行重新判斷
 *      （可能是下一個 Nx 宣告，也可能是一行獨立內容）。
 *   4. 如果區塊裡的內容行縮排從頭到尾都跟 `headerIndent` 一樣（既有的
 *      「扁平」寫法，例如 `2x` 後面直接接不縮排的內容行），永遠不會標記
 *      `usesIndentBoundary`，這條規則完全不介入，行為跟以前一模一樣——
 *      這是刻意設計成「只在真的有縮排差異時才生效」，不會誤判既有格式裡
 *      「每一行都不縮排」的重複區塊在寫完第一行就結束。
 */
export const REPEAT_LINE_RE = /^(\d+)\s*x$/i;

/**
 * 使用者從課表頁面複製貼上時，常常會連著清單的項目符號一起複製（例如
 * 「‧ 10 min @ 53w」），這個符號會讓原本合法的格式行判斷失敗——比對格式前
 * 先去掉。跟 pasteTextRouter.js（判斷貼上的文字是哪一種格式）、
 * whatsOnZwiftParser.js 共用同一份，不然只有部分地方去掉符號、其他地方沒去
 * 掉，還是會判斷失敗。
 */
export function stripBulletPrefix(line) {
  return line.replace(/^[-*•‣◦]\s*/, '');
}

/**
 * 有些來源（例如 TrainerDay「Workout structure」）的重複組宣告是用 Markdown
 * 粗體包住的（`**4X**`），不是純文字 `4X`——比對格式前先把 `**` 去掉。跟
 * `stripBulletPrefix()` 一樣，是「這行讀起來是什麼」的正規化，不影響重複
 * 區塊的判斷邏輯本身。
 */
export function stripMarkdownBold(line) {
  return line.replace(/\*\*/g, '');
}

/** 算原始行（未 trim）前面的空白字元數，用來判斷縮排深度（見上方規則說明）。 */
function leadingWhitespaceCount(rawLine) {
  const match = rawLine.match(/^[ \t]*/);
  return match ? match[0].length : 0;
}

/**
 * @param {string} text
 * @param {(line: string) => object|null} parseLine - 把一行（已 trim、確認
 *   不是空行/Nx 宣告）轉成 interval 物件；不是合法格式回傳 null
 * @param {string} formatDescription - 錯誤訊息裡用來描述「合法格式長怎樣」
 *   的字串，例如 `"X min @ Yw"`（含引號，直接嵌進錯誤訊息）
 * @returns {Array} intervals
 */
export function parseNewlineRepeatText(text, parseLine, formatDescription) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Invalid workout text: input must be a non-empty string');
  }

  const intervals = [];
  // 目前正在收集的「Nx」重複區塊（規則 1）；null 代表現在讀到的每一行都是
  // 獨立內容，不屬於任何重複區塊（規則 3）。
  let pendingRepeat = null; // { count, lineNumber, raw, lines: [] }

  // 規則 2：把目前收集到的區塊依 count 展開塞進 intervals，然後清空
  // pendingRepeat——遇到空行、遇到下一個「Nx」宣告、或文字讀完都會呼叫這個。
  function flushPendingRepeat() {
    if (!pendingRepeat) return;
    if (pendingRepeat.lines.length === 0) {
      throw new Error(
        `Invalid workout text: line ${pendingRepeat.lineNumber} ("${pendingRepeat.raw.trim()}") declares a repeat but no ${formatDescription} lines follow it`
      );
    }
    for (let i = 0; i < pendingRepeat.count; i++) {
      intervals.push(...pendingRepeat.lines);
    }
    pendingRepeat = null;
  }

  const rawLines = text.split(/\r\n|\r|\n/);
  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    // 規則 4：項目符號前綴、Markdown 粗體符號都只影響這行讀起來是什麼，不
    // 影響下面的區塊判斷。粗體要先去掉再去項目符號——「**4X**」的第一個
    // `*` 不是清單符號，如果先跑 stripBulletPrefix 會只吃掉半邊的 `**`。
    const line = stripBulletPrefix(stripMarkdownBold(rawLine.trim()));

    // 規則 1、2：空行是區塊終止信號之一，讀到就結束目前的收集，空行本身
    // 不算資料、不解析。
    if (line === '') {
      flushPendingRepeat();
      return;
    }

    // 縮排終止規則（見檔案開頭的說明）：區塊一旦出現過縮排嚴格大於
    // headerIndent 的內容行，之後只要縮排掉回 headerIndent（或更淺），就
    // 視為區塊結束——不需要空行、也不需要遇到下一個「Nx」才觸發。flush 完
    // 之後這一行不 return，繼續往下當成全新的一行處理。
    const lineIndent = leadingWhitespaceCount(rawLine);
    if (pendingRepeat && pendingRepeat.usesIndentBoundary && lineIndent <= pendingRepeat.headerIndent) {
      flushPendingRepeat();
    }

    const repeatMatch = line.match(REPEAT_LINE_RE);
    if (repeatMatch) {
      // 規則 3：沒有空行分隔也一樣——「Nx」宣告本身就會結束前一個還在收集的
      // 區塊（等同於一個隱性的空行），讓連續兩個重複區塊可以緊接著寫。
      flushPendingRepeat();
      const count = Number(repeatMatch[1]);
      if (count <= 0) {
        throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") has an invalid repeat count`);
      }
      pendingRepeat = { count, lineNumber, raw: rawLine, lines: [], headerIndent: lineIndent, usesIndentBoundary: false };
      return;
    }

    const interval = parseLine(line);
    if (!interval) {
      throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") does not match the expected ${formatDescription} format`);
    }

    // 規則 1 vs 規則 3：正在收集重複區塊就塞進 pendingRepeat.lines（區塊內
    // 容），否則就是空行後的獨立一行，直接塞進最終的 intervals。
    if (pendingRepeat) {
      if (lineIndent > pendingRepeat.headerIndent) {
        pendingRepeat.usesIndentBoundary = true;
      }
      pendingRepeat.lines.push(interval);
    } else {
      intervals.push(interval);
    }
  });

  flushPendingRepeat();

  if (intervals.length === 0) {
    throw new Error(`Invalid workout text: no valid ${formatDescription} lines found`);
  }

  return intervals;
}
