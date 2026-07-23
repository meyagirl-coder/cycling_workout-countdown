/**
 * 「一鍵開團連結」網址參數的解析／產生（規格：團體訓練排程功能的延伸）。
 * 純函式，不碰 DOM／fetch，方便單獨測試。
 *
 * 網址格式：
 *   https://.../?source=TD&source_url={課表網址}&startTime={yyyyMMddHHmm}
 *
 * 三個參數：
 *   - source：課表來源代碼，目前只支援 "TD"（TrainerDay）。未來要擴充
 *     "TP"（TrainingPeaks）／"interval"（intervals.icu）時，只要在
 *     SUPPORTED_GROUP_JOIN_SOURCES 加一筆，呼叫端（playerApp.js）再接上對應
 *     的下載/解析 handler 就好，這裡的驗證邏輯不用改。
 *   - source_url：課表網址本身，網址裡含有 `:`／`/`／`?` 這類特殊字元，
 *     一定要做過 URL encode 才能正確當成單一個 query 參數值傳遞——用
 *     URLSearchParams 组／解析 query string 時會自動處理 encode/decode，
 *     不需要呼叫端自己手動處理。
 *   - startTime：跟「設定開始時間」欄位統一格式（yyyyMMddHHmm），直接共用
 *     scheduledStartTimeParser.js 的解析邏輯，不另外維護一套規則。
 *
 * parseGroupJoinParams() 對「完全沒帶任何開團參數」的一般網址回傳 null（不是
 * 錯誤——一般使用者手動貼課表本來就不會帶這些參數）；但只要偵測到任何一個
 * 開團參數存在，就代表使用者是透過分享連結進來的，這時候三個參數都要合法，
 * 少一個或格式錯誤都要丟出清楚的錯誤訊息，不能悄悄忽略、也不能誤判成別的
 * 東西——使用者點連結卡在一個看不懂發生什麼事的畫面，比清楚的錯誤訊息更糟。
 */
import { parseScheduledStartTimeInput } from './scheduledStartTimeParser.js';

/** source 代碼 -> 顯示用名稱，目前只支援 TrainerDay；未來擴充 TP／intervals.icu 時加在這裡 */
export const SUPPORTED_GROUP_JOIN_SOURCES = { TD: 'TrainerDay' };

/** source=TD 的 source_url 網址主機白名單，跟 uploadView.js 的「貼課表網址」欄位一致 */
const TRAINERDAY_HOSTS = new Set(['app.trainerday.com']);

/**
 * @param {URLSearchParams} searchParams
 * @returns {{source: string, sourceUrl: string, startTime: Date} | null} 完全
 *   沒有任何開團參數時回傳 null；否則回傳解析＋驗證過的結果，任何一個環節
 *   不合法就丟出 Error（.message 是可以直接顯示給使用者看的中文訊息）
 */
export function parseGroupJoinParams(searchParams) {
  const source = searchParams.get('source');
  const sourceUrl = searchParams.get('source_url');
  const startTimeText = searchParams.get('startTime');

  if (source === null && sourceUrl === null && startTimeText === null) {
    return null;
  }

  if (!source || !Object.prototype.hasOwnProperty.call(SUPPORTED_GROUP_JOIN_SOURCES, source)) {
    const supportedList = Object.keys(SUPPORTED_GROUP_JOIN_SOURCES).join('/');
    throw new Error(`開團連結的課表來源「${source ?? '（缺少）'}」目前不支援，目前只支援 source=${supportedList}`);
  }

  if (!sourceUrl) {
    throw new Error('開團連結缺少 source_url 參數（課表網址）');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error('開團連結的 source_url 課表網址格式錯誤，請確認網址有正確做 URL encode');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('開團連結的 source_url 課表網址格式錯誤，請確認網址有正確做 URL encode');
  }
  if (source === 'TD' && !TRAINERDAY_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new Error('開團連結的 source_url 不是 TrainerDay 課表網址（source=TD 只接受 app.trainerday.com 的網址）');
  }

  if (!startTimeText) {
    throw new Error('開團連結缺少 startTime 參數（開始時間）');
  }

  let startTime;
  try {
    startTime = parseScheduledStartTimeInput(startTimeText);
  } catch (err) {
    throw new Error(`開團連結的 startTime 開始時間格式錯誤：${err.message}`);
  }

  return { source, sourceUrl, startTime };
}

/**
 * 「產生分享連結」小工具用：把課表網址＋開始時間文字組成完整、正確 encode
 * 過的開團連結。用 URLSearchParams 组 query string，特殊字元的 encode 交給
 * 瀏覽器內建實作處理，不用自己手動 encodeURIComponent 拼字串（容易漏掉邊界
 * 情況）。
 *
 * @param {string} baseUrl - App 網址（不含 query string），例如 window.location.origin + window.location.pathname
 * @param {{source?: string, sourceUrl: string, startTimeText: string}} params
 * @returns {string} 完整分享連結；sourceUrl／startTimeText 任一個是空字串就丟出 Error
 */
export function buildGroupJoinLink(baseUrl, { source = 'TD', sourceUrl, startTimeText }) {
  if (!sourceUrl || !sourceUrl.trim()) {
    throw new Error('請輸入課表網址');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl.trim());
  } catch {
    throw new Error('課表網址格式錯誤，請確認是完整的網址（例如 https://app.trainerday.com/...）');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('課表網址格式錯誤，請確認是完整的網址（例如 https://app.trainerday.com/...）');
  }
  if (source === 'TD' && !TRAINERDAY_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new Error('目前只支援 TrainerDay 課表網址（app.trainerday.com）');
  }

  // 沿用同一套 yyyyMMddHHmm 解析／驗證邏輯，格式錯誤時的訊息跟「設定開始
  // 時間」欄位一致，使用者不會看到兩套不同的錯誤說明。
  parseScheduledStartTimeInput(startTimeText);

  const url = new URL(baseUrl);
  url.searchParams.set('source', source);
  url.searchParams.set('source_url', sourceUrl.trim());
  url.searchParams.set('startTime', startTimeText.trim());
  return url.toString();
}
