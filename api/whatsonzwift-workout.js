/**
 * Vercel Serverless Function：代理抓取 WhatsOnZwift 公開課表頁面。前端只送
 * 課表網址，伺服器端（不受瀏覽器 CORS 限制）抓回完整 HTML，用
 * extractWhatsOnZwiftTextFromHtml() 撈出課表文字後直接回傳純文字——解析成
 * Workout JSON 的邏輯留給前端既有的 parseWhatsOnZwiftText()，跟
 * api/trainerday-workout.js 是同一種設計（proxy 只負責抓取＋擷取，解析永遠
 * 只在前端發生一次）。
 *
 * 只允許抓取 whatsonzwift.com（含 www 子網域）底下的網址，避免這支 proxy
 * 被當成任意網址的 SSRF 跳板。
 *
 * 這個功能之前整個移除過一次：實測時（透過部署在 Vercel 的正式環境，不是
 * 開發沙箱）WhatsOnZwift 直接回傳 `HTTP 403`，換過偽裝成真實瀏覽器的
 * User-Agent／Accept 標頭後仍然被擋，判斷是比 User-Agent 檢查更進階的
 * 防護（IP 信譽／TLS 指紋辨識／JS 挑戰之類），不是換標頭能繞過的——這是
 * WhatsOnZwift 網站本身的反爬蟲政策，不是「擷取邏輯抓錯格式」這種可以
 * 修正的問題。這次重新加回來，是因為使用者要求同時測試 TrainerDay／
 * WhatsOnZwift 兩邊的網址抓取（TrainerDay 那邊已經確認新的擷取格式可行），
 * 讓使用者能實際在 Vercel 正式環境重新驗證一次「這個反爬蟲防護是不是仍然
 * 存在」，如果還是 403，就是網站本身的政策，不會因為誰在呼叫而改變。
 */
import { extractWhatsOnZwiftTextFromHtml } from '../src/parser/extractWhatsOnZwiftTextFromHtml.js';
import { BROWSER_LIKE_HEADERS } from '../src/utils/httpFetchHeaders.js';

const ALLOWED_HOSTS = new Set(['whatsonzwift.com', 'www.whatsonzwift.com']);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!rawUrl) {
    res.status(400).json({ error: '缺少 url 參數' });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: '網址格式錯誤，請確認貼上的是完整的 WhatsOnZwift 課表網址' });
    return;
  }

  if (!ALLOWED_HOSTS.has(targetUrl.hostname) || (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:')) {
    res.status(400).json({ error: '只支援 whatsonzwift.com 的課表網址' });
    return;
  }
  targetUrl.protocol = 'https:'; // 一律用 https 抓取，不管使用者貼的是 http 還是 https

  let upstreamRes;
  try {
    upstreamRes = await fetch(targetUrl.toString(), { headers: BROWSER_LIKE_HEADERS });
  } catch {
    res.status(502).json({ error: '連線 WhatsOnZwift 失敗，請稍後再試，或改用「貼上課表文字內容」' });
    return;
  }

  if (!upstreamRes.ok) {
    if (upstreamRes.status === 404) {
      res.status(404).json({ error: '在 WhatsOnZwift 上找不到這份課表，請確認網址是否正確，或改用「貼上課表文字內容」' });
      return;
    }
    if (upstreamRes.status === 403) {
      res.status(502).json({ error: 'WhatsOnZwift 拒絕了這個抓取請求（可能有反爬蟲防護），請改用「貼上課表文字內容」' });
      return;
    }
    res.status(502).json({ error: `WhatsOnZwift 回傳錯誤（HTTP ${upstreamRes.status}），請改用「貼上課表文字內容」` });
    return;
  }

  const html = await upstreamRes.text();
  const workoutText = extractWhatsOnZwiftTextFromHtml(html);

  if (!workoutText) {
    res.status(422).json({ error: '在這個頁面找不到課表內容，網頁結構可能已改變，請改用「貼上課表文字內容」' });
    return;
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(workoutText);
}
