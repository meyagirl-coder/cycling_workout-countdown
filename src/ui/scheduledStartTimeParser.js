/**
 * 「設定開始時間」欄位的文字格式解析：`yyyyMMddHHmm`（年月日時分連續 12 位
 * 數字，不含空格或冒號），例如 `202607242000` 代表 2026/07/24 20:00。純
 * 函式，不碰 DOM，方便單獨測試；用 `new Date(year, monthIndex, day, hour,
 * minute)` 建構，這個建構子用的是瀏覽器所在裝置的當地時區，不是 UTC，符合
 * 「用使用者裝置當地時區」的規格要求，不需要額外時區換算。
 *
 * 這個純數字、無分隔符的格式是刻意跟「一鍵開團連結」網址參數的 `startTime`
 * 統一用同一套格式、同一套解析邏輯（見 groupJoinLinkParser.js）——原本欄位
 * 用的 `YYYYMMDD HH:mm`（含空格＋冒號）格式放進網址參數裡還要另外處理
 * URL-safe 字元，不如直接統一成純數字格式，兩邊共用這裡的解析函式，不用
 * 各自維護一份格式規則。
 *
 * 格式錯誤（位數不對、超出合法範圍、月份沒有那一天等）一律拋出清楚指出
 * 問題的 Error，不做靜默失敗或猜測使用者的意圖。
 */
const FORMAT_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

const FORMAT_ERROR_MESSAGE = '日期時間格式錯誤，請用「202607242000」這種格式（年月日時分連續 12 位數字，不含空格或冒號，24 小時制）';

/**
 * @param {string} text - 使用者輸入的文字，例如 "202607242000"
 * @returns {Date}
 */
export function parseScheduledStartTimeInput(text) {
  if (typeof text !== 'string') {
    throw new Error(FORMAT_ERROR_MESSAGE);
  }

  const trimmed = text.trim();
  const match = trimmed.match(FORMAT_RE);
  if (!match) {
    throw new Error(FORMAT_ERROR_MESSAGE);
  }

  const [, yyyy, mm, dd, hh, min] = match;
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(min);

  if (month < 1 || month > 12) {
    throw new Error(`${FORMAT_ERROR_MESSAGE}（月份 ${mm} 不合法）`);
  }
  if (hour > 23) {
    throw new Error(`${FORMAT_ERROR_MESSAGE}（時間 ${hh}:${min} 不合法，時要在 00-23 之間）`);
  }
  if (minute > 59) {
    throw new Error(`${FORMAT_ERROR_MESSAGE}（時間 ${hh}:${min} 不合法，分要在 00-59 之間）`);
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  // new Date() 對超出範圍的日期（例如 2 月 30 日）會自動往後推算成合法日期
  // （變成 3 月 2 日），而不是拋錯——用組回來的欄位比對輸入是否一致，抓出
  // 這種「看起來合法、實際上該月沒有那一天」的輸入，不能默默接受一個跟
  // 使用者輸入不同的日期。
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`${FORMAT_ERROR_MESSAGE}（${yyyy}-${mm}-${dd} 不是合法的日期）`);
  }

  return date;
}
