/**
 * 模擬真實瀏覽器送出的請求標頭，給 api/*-workout.js 這些代理抓取外部網站用。
 *
 * 之前用的 User-Agent（`Mozilla/5.0 (compatible; cycling-workout-countdown/1.0)`）
 * 剛好是歷史上爬蟲慣用的格式（例如舊版 Bingbot／MSNBot），跟真正的瀏覽器
 * User-Agent 長得完全不一樣，很容易被網站的反爬蟲防護直接擋掉——實測
 * WhatsOnZwift 就是回傳 HTTP 403。改成看起來像真實 Chrome 瀏覽器的標頭，
 * 至少能過濾掉「只檢查 User-Agent／Accept 這類標頭」的簡單防護層；更進階的
 * 防護（IP 信譽、TLS 指紋辨識、JS 挑戰）不是換個標頭就能繞過的。
 */
export const BROWSER_LIKE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};
