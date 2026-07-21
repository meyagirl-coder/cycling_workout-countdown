/**
 * 共用的「Nx 換行重複」文字掃描器：適用於「重複次數獨立一行宣告（例如
 * `3x`），後面連續幾行課表內容要重複 N 次」這種寫法的格式——pasteTextParser.js
 * （TrainerDay 格式）跟 spacePercentTextParser.js（「時長 百分比」格式）都是
 * 這種寫法，只有「一行課表內容長什麼樣子」不同，所以把這套狀態機抽出來共用，
 * 不必各自維護一份幾乎一樣、容易顧此失彼的重複區塊收集邏輯。
 *
 * 重複區塊的收集規則（兩種格式共用）：「Nx」後面連續符合 parseLine() 的行都
 * 算這組要重複的內容，直到遇到空行、下一個「Nx」宣告、或文字結束為止。
 */
export const REPEAT_LINE_RE = /^(\d+)\s*x$/i;

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
  let pendingRepeat = null; // { count, lineNumber, raw, lines: [] } - 目前正在收集的「Nx」重複區塊

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
    const line = rawLine.trim();

    if (line === '') {
      flushPendingRepeat();
      return;
    }

    const repeatMatch = line.match(REPEAT_LINE_RE);
    if (repeatMatch) {
      flushPendingRepeat();
      const count = Number(repeatMatch[1]);
      if (count <= 0) {
        throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") has an invalid repeat count`);
      }
      pendingRepeat = { count, lineNumber, raw: rawLine, lines: [] };
      return;
    }

    const interval = parseLine(line);
    if (!interval) {
      throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") does not match the expected ${formatDescription} format`);
    }

    if (pendingRepeat) {
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
