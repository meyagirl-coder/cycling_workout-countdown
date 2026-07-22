/**
 * Vercel Serverless Function：代理抓取 TrainerDay 公開課表頁面（未登入狀態，
 * 不需要帳號或 API key）。前端只送課表網址，伺服器端（不受瀏覽器 CORS 限制）
 * 抓回完整 HTML，用 extractTrainerDayWorkoutStructureFromHtml() 撈出頁面
 * 「Workout structure」區塊的課表文字後直接回傳純文字——解析成 Workout
 * JSON 的邏輯留給前端既有的 parseTrainerDayWorkoutStructureText()，跟「直接
 * 貼文字」共用同一套 parser，不重寫一份。
 *
 * 只允許抓取 app.trainerday.com 底下的網址，避免這支 proxy 被當成任意網址
 * 的 SSRF 跳板。
 *
 * 這個功能第一次做的時候（`X min @ Yw` 舊格式）因為抓不到「Workout
 * structure」這種格式的課表文字（頁面回傳 200，但擷取不到預期格式）而移除
 * 過一次——當時的開發沙箱環境本身連不上 app.trainerday.com，沒辦法核對
 * 實際頁面結構，只能照猜測寫擷取邏輯，猜錯了格式。這次改成對接使用者實測
 * 過的「Workout structure」格式（`X min @ Y% (Zw)`），如果部署後這支 proxy
 * 又抓不到內容，請改用「貼上課表文字內容」，並回報實際的頁面結構以便調整
 * 擷取邏輯。
 */
import { extractTrainerDayWorkoutStructureFromHtml } from '../src/parser/extractTrainerDayWorkoutStructureFromHtml.js';
import { BROWSER_LIKE_HEADERS } from '../src/utils/httpFetchHeaders.js';

const ALLOWED_HOST = 'app.trainerday.com';

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
    res.status(400).json({ error: '網址格式錯誤，請確認貼上的是完整的 TrainerDay 課表網址' });
    return;
  }

  if (targetUrl.hostname !== ALLOWED_HOST || (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:')) {
    res.status(400).json({ error: `只支援 ${ALLOWED_HOST} 的課表網址` });
    return;
  }
  targetUrl.protocol = 'https:'; // 一律用 https 抓取，不管使用者貼的是 http 還是 https

  let upstreamRes;
  try {
    upstreamRes = await fetch(targetUrl.toString(), { headers: BROWSER_LIKE_HEADERS });
  } catch {
    res.status(502).json({ error: '連線 TrainerDay 失敗，請稍後再試，或改用「貼上課表文字內容」' });
    return;
  }

  if (!upstreamRes.ok) {
    if (upstreamRes.status === 404) {
      res.status(404).json({ error: '在 TrainerDay 上找不到這份課表，請確認網址是否正確，或改用「貼上課表文字內容」' });
      return;
    }
    if (upstreamRes.status === 403) {
      res.status(502).json({ error: 'TrainerDay 拒絕了這個抓取請求（可能有反爬蟲防護），請改用「貼上課表文字內容」' });
      return;
    }
    res.status(502).json({ error: `TrainerDay 回傳錯誤（HTTP ${upstreamRes.status}），請改用「貼上課表文字內容」` });
    return;
  }

  const html = await upstreamRes.text();
  const workoutText = extractTrainerDayWorkoutStructureFromHtml(html);

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
