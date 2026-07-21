/**
 * TrainerDay「完整複製」課表文字解析器：使用者直接從 TrainerDay 課表頁面整段
 * 複製貼上的完整內容，不是逐行手動輸入。跟 pasteTextParser.js（`X min @ Yw`
 * ＋獨立一行的「Nx」換行重複）文法比較接近，但有兩個關鍵差異，所以另外寫
 * 一份 parser，不是擴充既有的：
 *
 *   1. 第一行通常是「持续时间: 59m」這種總時長說明文字，不是課表資料，要
 *      識別並跳過，不能當成一行解析失敗的錯誤。
 *   2. 重複組整組寫在同一行，不是「Nx」獨立一行＋後面連續幾行的換行寫法：
 *      `NX (段落1 | 段落2 | 段落3 ...)`——括號包住整組內容，裡面用 `|`
 *      分隔任意數量的段落（可能 2 段、3 段、或更多，不是寫死 2 段），
 *      這一整行本身就自帶「重複幾次」跟「重複哪些內容」，不需要「收集到
 *      哪裡結束」的狀態機（跟 newlineRepeatTextParser.js 的「Nx 換行重複」
 *      是完全不同的機制，即使兩者都叫「Nx」）。
 *
 * 一般行是 `X min @ Yw` 或 `X sec @ Yw`（TrainerDay 完整複製的內容比手動
 * 單行輸入更常見到秒數單位，例如 `30 sec @ 110w`，所以這裡除了 `min` 也支援
 * `sec`；pasteTextParser.js 的 `X min @ Yw` 目前只有 `min` 是因為手動輸入
 * 沒遇過秒數需求，之後如果也要支援可以再擴充）。跟 TrainerDay 其他格式一樣，
 * 未登入狀態下瓦數是以 FTP=100 為基準換算的，所以「Yw」數字直接等於「Y%
 * FTP」，不需要再額外換算。
 *
 * parseTrainerDayFullText() 是純函式，跟其他 parser 一樣輸出統一的 Workout
 * JSON（見 src/schema/workoutSchema.js），不碰 UI。
 */
import { generateId } from '../utils/generateId.js';
import { stripBulletPrefix } from './newlineRepeatTextParser.js';

/** 第一行常見的總時長說明文字，例如「持续时间: 59m」——不是課表資料，跳過不解析 */
export const TRAINERDAY_FULL_DURATION_HEADER_RE = /^持续时间\s*[:：]/;

/** 一般行：`X min @ Yw` 或 `X sec @ Yw` */
export const TRAINERDAY_FULL_LINE_RE = /^(\d+(?:\.\d+)?)\s*(min|sec)\s*@\s*(\d+(?:\.\d+)?)\s*w$/i;

/** 整行寫完的重複組：`NX (段落1 | 段落2 | ...)`，`X` 大小寫都接受 */
export const TRAINERDAY_FULL_REPEAT_RE = /^(\d+)\s*[Xx]\s*\(([\s\S]+)\)$/;

/**
 * @param {string} text - 從 TrainerDay 課表頁面整段複製貼上的純文字
 * @returns {{id: string, name: string, source: 'paste-trainerday-full', totalDuration: number, intervals: Array}}
 */
export function parseTrainerDayFullText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Invalid workout text: input must be a non-empty string');
  }

  const intervals = [];
  const rawLines = text.split(/\r\n|\r|\n/);

  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = stripBulletPrefix(rawLine.trim());

    if (line === '') return; // 空行沒有意義，這個格式不靠空行判斷任何事情
    if (TRAINERDAY_FULL_DURATION_HEADER_RE.test(line)) return; // 「持续时间: 59m」是總時長說明，跳過

    const repeatMatch = line.match(TRAINERDAY_FULL_REPEAT_RE);
    if (repeatMatch) {
      const [, countStr, segmentsRaw] = repeatMatch;
      const count = Number(countStr);
      if (count <= 0) {
        throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") has an invalid repeat count`);
      }

      // 括號內用 "|" 分隔任意數量的段落，不寫死段數——2 段、3 段、更多段都一樣處理。
      const segments = segmentsRaw.split('|').map((segment) => stripBulletPrefix(segment.trim()));
      const parsedSegments = segments.map((segment) => {
        const segmentInterval = parseIntervalLine(segment);
        if (!segmentInterval) {
          throw new Error(
            `Invalid workout text: line ${lineNumber} ("${line}") has a segment ("${segment}") that does not match the expected "X min/sec @ Yw" format`
          );
        }
        return segmentInterval;
      });

      for (let i = 0; i < count; i++) {
        intervals.push(...parsedSegments);
      }
      return;
    }

    const interval = parseIntervalLine(line);
    if (!interval) {
      throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") does not match a recognized TrainerDay line format`);
    }
    intervals.push(interval);
  });

  if (intervals.length === 0) {
    throw new Error('Invalid workout text: no valid workout lines found');
  }

  const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0);

  return {
    id: generateId(),
    name: 'Untitled Workout',
    source: 'paste-trainerday-full',
    totalDuration,
    intervals,
  };
}

/** @returns {object|null} 一個穩定（steady）段，或 null（這行不是「X min/sec @ Yw」格式） */
function parseIntervalLine(line) {
  const match = line.match(TRAINERDAY_FULL_LINE_RE);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const seconds = unit === 'min' ? amount * 60 : amount; // FTP=100 基準換算，Yw 直接等於 Y% FTP
  const duration = Math.round(seconds);
  const powerPct = Math.round(Number(match[3]));

  return { type: 'steady', duration, powerStart: powerPct, powerEnd: powerPct, cadence: null };
}
