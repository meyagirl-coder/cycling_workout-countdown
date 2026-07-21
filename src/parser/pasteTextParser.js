/**
 * 貼上純文字課表的解析器：使用者從公開課表頁面（例如 TrainerDay 未登入狀態）
 * 複製貼上的純文字，不需要上傳檔案或串接帳號。
 *
 * 已知格式（每行一組）：`X min @ Yw`，例如 `10 min @ 53w`。這類公開頁面在未
 * 登入狀態下瓦數是以 FTP=100 為基準換算的，所以這裡的「Yw」數字直接等於
 * 「Y% FTP」，不需要再額外換算。
 *
 * 也支援「重複組」寫法：單獨一行的「Nx」（例如 `3x`）宣告接下來連續的
 * `X min @ Yw` 行要重複 N 次，直到遇到空行、下一個「Nx」宣告、或文字結束。
 *
 * parsePasteText() 是純函式：輸入貼上的文字，輸出統一的 Workout JSON（見
 * src/schema/workoutSchema.js），不碰 UI，方便單獨測試。目前只處理最基本的
 * 「時長 @ 瓦數」單行格式；漸變段（例如 `53-68w`）留待之後擴充。
 */
import { generateId } from '../utils/generateId.js';

// exported so other modules that need to recognize the same line shapes
// (例如從網頁 HTML 撈課表文字的 extractWorkoutTextFromHtml()）可以重複使用
// 同一套定義，不必自己重寫一份容易走鐘的正則表達式。
export const INTERVAL_LINE_RE = /^(\d+(?:\.\d+)?)\s*min\s*@\s*(\d+(?:\.\d+)?)\s*w$/i;
export const REPEAT_LINE_RE = /^(\d+)\s*x$/i;

/**
 * @param {string} text - 使用者貼上的純文字
 * @returns {{id: string, name: string, source: 'paste', totalDuration: number, intervals: Array}}
 */
export function parsePasteText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Invalid workout text: input must be a non-empty string');
  }

  const intervals = [];
  let pendingRepeat = null; // { count, lineNumber, raw, lines: [] } - 目前正在收集的「Nx」重複區塊

  function flushPendingRepeat() {
    if (!pendingRepeat) return;
    if (pendingRepeat.lines.length === 0) {
      throw new Error(
        `Invalid workout text: line ${pendingRepeat.lineNumber} ("${pendingRepeat.raw.trim()}") declares a repeat but no "X min @ Yw" lines follow it`
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

    const interval = parseIntervalLine(line);
    if (!interval) {
      throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") does not match the expected "X min @ Yw" format`);
    }

    if (pendingRepeat) {
      pendingRepeat.lines.push(interval);
    } else {
      intervals.push(interval);
    }
  });

  flushPendingRepeat();

  if (intervals.length === 0) {
    throw new Error('Invalid workout text: no valid "X min @ Yw" lines found');
  }

  const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0);

  return {
    id: generateId(),
    name: 'Untitled Workout',
    source: 'paste',
    totalDuration,
    intervals,
  };
}

/** @returns {object|null} 一個穩定（steady）段，或 null（這行不是「X min @ Yw」格式） */
function parseIntervalLine(line) {
  const match = line.match(INTERVAL_LINE_RE);
  if (!match) return null;

  const minutes = Number(match[1]);
  const watts = Number(match[2]); // FTP=100 基準換算，Yw 直接等於 Y% FTP
  const duration = Math.round(minutes * 60);
  const powerPct = Math.round(watts);

  return { type: 'steady', duration, powerStart: powerPct, powerEnd: powerPct, cadence: null };
}
