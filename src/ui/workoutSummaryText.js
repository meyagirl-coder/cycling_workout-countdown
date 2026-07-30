/**
 * 「課表摘要」文字：把已經解析好的 Workout Schema（intervals 陣列）反向組合
 * 成一份人類易讀的課表摘要，格式參考 TrainerDay 網頁「複製」按鈕產生的文字
 * （規格：等待畫面「尚未開始的預覽狀態」要能一次看清楚整份課表結構，不用
 * 只看時間軸圖表），例如：
 *
 *   Duration: 1h 6m
 *   10 min @ 50w
 *   6X (2 min @ 120w | 4 min @ 50w)
 *   20 min @ 70w
 *
 * 故意不是「直接複製原始輸入文字」——不管課表是從貼網址／貼文字／上傳
 * ZWO／intervals.icu 哪個來源載入，Workout Schema 都是同一份格式，從這裡
 * 反向組合出來的摘要自然對所有來源都成立，不需要每個來源各自維護一份摘要
 * 產生邏輯。
 */
import { computeBandTarget } from '../engine/timerEngine.js';

/**
 * 單組時長標示，跟 TrainerDay「Workout structure」格式（
 * trainerDayWorkoutStructureParser.js 的 TRAINERDAY_STRUCTURE_LINE_RE）
 * 同一套慣例：不滿一分鐘用整數秒（"30 sec"），一分鐘以上用分鐘（"10 min"，
 * 非整分鐘用到小數，例如 90 秒是 "1.5 min"）——這是已經從實際頁面格式驗證
 * 過的慣例，不是另外發明一套新格式。
 */
function formatSegmentDuration(seconds) {
  if (seconds < 60) return `${seconds} sec`;

  const minutes = Math.round((seconds / 60) * 100) / 100;
  return `${minutes} min`;
}

/**
 * 摘要開頭「Duration: 1h 6m」這一行——刻意跟單組時長不同格式（"h"/"m"/"s"
 * 縮寫，不是 "min"），對照使用者提供的範例：總時長跟單組時長在 TrainerDay
 * 原始格式裡本來就是兩種不同的縮寫慣例，這裡照樣沿用，不要統一成同一種
 * 格式。只列出非零的時／分／秒（例如整數分鐘的課表不會多顯示「0s」），
 * 剛好整小時／整分鐘時自然退化成範例給的「1h 6m」這種簡潔格式，不是每次
 * 都硬湊三段。
 */
function formatTotalDurationHeader(totalSeconds) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  if (parts.length === 0) parts.push('0s');

  return `Duration: ${parts.join(' ')}`;
}

/**
 * 單組內容行，例如 "10 min @ 50w"——瓦數（不是 %FTP）是主要顯示單位，跟
 * 執行頁大字卡片「瓦數在上、%FTP 在下」的既有慣例一致（見 renderPlayer.js）。
 *
 *   - 「區間目標」（band）：固定顯示整個瓦數範圍（"120-150w"），不是取中點
 *     算出的單一數字——沿用 computeBandTarget() 既有的區間顯示邏輯（見該
 *     函式完整說明），跟大字卡片／倒數提示banner 用的是同一套換算。
 *   - freeride：沒有目標瓦數，顯示「free ride」。
 *   - 起訖不同（ramp 漸變、或 warmup/cooldown 本身就是漸變塑形）：用「→」
 *     表示方向性漸變，跟「-」（區間目標，沒有方向性）在視覺上刻意區分，
 *     跟 countdownAlerts.js 的既有慣例一致。
 *   - 起訖相同（一般 steady）：只顯示一個瓦數。
 */
function formatIntervalLine(iv, ftp, adjustPct) {
  const durationLabel = formatSegmentDuration(iv.duration);

  const bandTarget = computeBandTarget(iv, ftp, adjustPct);
  if (bandTarget) {
    return `${durationLabel} @ ${bandTarget.lowWatts}-${bandTarget.highWatts}w`;
  }

  if (iv.type === 'freeride') {
    return `${durationLabel} free ride`;
  }

  const startWatts = Math.round((ftp * (iv.powerStart + adjustPct)) / 100);
  const endWatts = Math.round((ftp * (iv.powerEnd + adjustPct)) / 100);
  if (startWatts === endWatts) {
    return `${durationLabel} @ ${startWatts}w`;
  }
  return `${durationLabel} @ ${startWatts}w → ${endWatts}w`;
}

/** 兩個區段（用長度 length，從 aStart／bStart 起算）的內容行是否逐行完全相同 */
function blockEquals(lines, aStart, bStart, length) {
  for (let k = 0; k < length; k++) {
    if (lines[aStart + k] !== lines[bStart + k]) return false;
  }
  return true;
}

/**
 * 把逐組展開後的內容行陣列，重新壓縮成「Nx (段落1 | 段落2)」格式——每個
 * parser（newlineRepeatTextParser.js 等）遇到「Nx」宣告時，本來就是展開成
 * N 份逐字相同的內容塞進 intervals 陣列（不是另外記一個「重複幾次」的
 * metadata），所以這裡反過來找「連續重複出現的區塊」，就能還原使用者原本
 * 打的重複結構，不需要 schema 額外记錄重複次數。
 *
 * 演算法：從左到右掃描，每個位置嘗試所有可能的區塊長度 L，找出「連續重複
 * 次數 >= 2」且「覆蓋的行數（L × 重複次數）最大」的那個 L；長度相同時取
 * 較小的 L（比較貼近使用者原本可能打的重複單位，例如寧可判斷成
 * "4X (A|B)" 也不要判斷成 "2X (A|B|A|B)"）。找不到符合的重複區塊就照原樣
 * 輸出這一行，往前移動一格。
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function compressRepeatingLines(lines) {
  const result = [];
  const n = lines.length;
  let i = 0;

  while (i < n) {
    let bestLength = 0;
    let bestCount = 0;
    const maxLength = Math.floor((n - i) / 2);

    for (let length = 1; length <= maxLength; length++) {
      let count = 1;
      while (i + (count + 1) * length <= n && blockEquals(lines, i + count * length, i, length)) {
        count++;
      }
      if (count >= 2 && count * length > bestCount * bestLength) {
        bestLength = length;
        bestCount = count;
      }
    }

    if (bestCount >= 2) {
      const block = lines.slice(i, i + bestLength);
      result.push(`${bestCount}X (${block.join(' | ')})`);
      i += bestLength * bestCount;
    } else {
      result.push(lines[i]);
      i += 1;
    }
  }

  return result;
}

/**
 * @param {{totalDuration: number, intervals: Array}} workout
 * @param {number} ftp
 * @param {number} [adjustPct] - 執行頁「調整瓦數」微調的百分比，等待畫面
 *   的預覽階段一律還是 0，保留這個參數只是為了跟 computeBandTarget() 等
 *   既有函式的呼叫慣例一致，不是這個功能真的需要支援非 0 的情境。
 * @returns {string}
 */
export function buildWorkoutSummaryText(workout, ftp, adjustPct = 0) {
  const header = formatTotalDurationHeader(workout.totalDuration);
  const lines = workout.intervals.map((iv) => formatIntervalLine(iv, ftp, adjustPct));
  const compressedLines = compressRepeatingLines(lines);

  return [header, ...compressedLines].join('\n');
}
