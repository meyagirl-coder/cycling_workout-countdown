/**
 * WhatsOnZwift 課表文字解析器。跟 pasteTextParser.js（TrainerDay 格式）文法
 * 不一樣，所以另外寫一份，不是擴充既有 parser：
 *
 *   - `Xmin from A to B% FTP` -> ramp 段，A/B 直接就是 %FTP（有明確寫
 *     「FTP」字樣，不是像 TrainerDay 那樣用瓦數代表 FTP=100 時的百分比，
 *     不能套用「瓦數＝百分比」那個假設）
 *   - `Xmin @ Y% FTP` -> steady 段，Y 直接就是 %FTP
 *   - `Nx Xmin @ Y% FTP, Zmin @ W% FTP` -> 複合重複組：兩段寫在同一行、用
 *     逗號分隔，合起來重複 N 次——跟 pasteTextParser.js 的「Nx」換行展開是
 *     不同的寫法（那邊是重複次數獨立一行、接下來連續幾行都算），這裡的兩段
 *     內容跟重複次數本來就在同一行，不需要「往下收集到哪裡結束」的邏輯。
 *
 * parseWhatsOnZwiftText() 是純函式，跟其他 parser 一樣輸出統一的 Workout
 * JSON（見 src/schema/workoutSchema.js），不碰 UI。
 */
import { generateId } from '../utils/generateId.js';

// exported so extractWhatsOnZwiftTextFromHtml.js 可以用同一套正則判斷「這行
// 是不是課表內容」，兩邊對「合法格式」的認定不會不小心兜不起來。
export const WOZ_RAMP_LINE_RE = /^(\d+(?:\.\d+)?)\s*min\s+from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)%\s*FTP$/i;
export const WOZ_STEADY_LINE_RE = /^(\d+(?:\.\d+)?)\s*min\s*@\s*(\d+(?:\.\d+)?)%\s*FTP$/i;
export const WOZ_REPEAT_LINE_RE =
  /^(\d+)x\s+(\d+(?:\.\d+)?)\s*min\s*@\s*(\d+(?:\.\d+)?)%\s*FTP\s*,\s*(\d+(?:\.\d+)?)\s*min\s*@\s*(\d+(?:\.\d+)?)%\s*FTP$/i;

/**
 * @param {string} text - 從 WhatsOnZwift 課表頁面複製（或抓取後擷取出）的純文字
 * @returns {{id: string, name: string, source: 'whatsonzwift', totalDuration: number, intervals: Array}}
 */
export function parseWhatsOnZwiftText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Invalid workout text: input must be a non-empty string');
  }

  const intervals = [];
  const rawLines = text.split(/\r\n|\r|\n/);

  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === '') return;

    const repeatMatch = line.match(WOZ_REPEAT_LINE_RE);
    if (repeatMatch) {
      const [, countStr, dur1, pct1, dur2, pct2] = repeatMatch;
      const count = Number(countStr);
      if (count <= 0) {
        throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") has an invalid repeat count`);
      }
      const first = makeSteady(dur1, pct1);
      const second = makeSteady(dur2, pct2);
      for (let i = 0; i < count; i++) {
        intervals.push(first, second);
      }
      return;
    }

    const rampMatch = line.match(WOZ_RAMP_LINE_RE);
    if (rampMatch) {
      const [, durStr, fromPct, toPct] = rampMatch;
      intervals.push(makeRamp(durStr, fromPct, toPct));
      return;
    }

    const steadyMatch = line.match(WOZ_STEADY_LINE_RE);
    if (steadyMatch) {
      const [, durStr, pctStr] = steadyMatch;
      intervals.push(makeSteady(durStr, pctStr));
      return;
    }

    throw new Error(`Invalid workout text: line ${lineNumber} ("${line}") does not match a recognized WhatsOnZwift line format`);
  });

  if (intervals.length === 0) {
    throw new Error('Invalid workout text: no valid workout lines found');
  }

  const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0);

  return {
    id: generateId(),
    name: 'Untitled Workout',
    source: 'whatsonzwift',
    totalDuration,
    intervals,
  };
}

function makeSteady(durationMinStr, pctStr) {
  const duration = Math.round(Number(durationMinStr) * 60);
  const pct = Math.round(Number(pctStr));
  return { type: 'steady', duration, powerStart: pct, powerEnd: pct, cadence: null };
}

function makeRamp(durationMinStr, fromPctStr, toPctStr) {
  const duration = Math.round(Number(durationMinStr) * 60);
  const from = Math.round(Number(fromPctStr));
  const to = Math.round(Number(toPctStr));
  return { type: 'ramp', duration, powerStart: from, powerEnd: to, cadence: null };
}
