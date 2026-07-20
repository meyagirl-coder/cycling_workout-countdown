/**
 * Vercel Serverless Function：代理 intervals.icu 的 download.zwo 端點。
 *
 * 前端只送 eventId（使用者貼的課表網址/ID 解析出來的數字），Athlete ID 跟
 * API Key 都不會出現在前端或回應裡 —— 只從 Vercel 環境變數讀取：
 *   INTERVALS_ICU_ATHLETE_ID  例如 "i123456"（intervals.icu 個人設定頁看得到）
 *   INTERVALS_ICU_API_KEY     intervals.icu Settings -> Developer Settings 產生的 API Key
 *
 * intervals.icu 的 API 認證方式是 HTTP Basic Auth，帳號固定寫死是 "API_KEY"
 * 這個字面字串，密碼才是真正的 API Key（這是 intervals.icu 官方文件寫的慣例）。
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const eventId = Array.isArray(req.query.eventId) ? req.query.eventId[0] : req.query.eventId;
  if (!eventId || !/^\d+$/.test(eventId)) {
    res.status(400).json({ error: 'eventId 必須是正整數' });
    return;
  }

  const athleteId = process.env.INTERVALS_ICU_ATHLETE_ID;
  const apiKey = process.env.INTERVALS_ICU_API_KEY;
  if (!athleteId || !apiKey) {
    res.status(500).json({ error: '伺服器缺少 INTERVALS_ICU_ATHLETE_ID 或 INTERVALS_ICU_API_KEY 環境變數' });
    return;
  }

  const upstreamUrl = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events/${encodeURIComponent(eventId)}/download.zwo`;
  const basicAuth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
  } catch {
    res.status(502).json({ error: '連線 intervals.icu 失敗，請稍後再試' });
    return;
  }

  if (!upstreamRes.ok) {
    if (upstreamRes.status === 401 || upstreamRes.status === 403) {
      res.status(502).json({ error: 'intervals.icu 認證失敗，請確認 Athlete ID／API Key 是否正確' });
      return;
    }
    if (upstreamRes.status === 404) {
      res.status(404).json({ error: '在 intervals.icu 上找不到這個課表，請確認 event ID 是否正確' });
      return;
    }
    res.status(502).json({ error: `intervals.icu 回傳錯誤（HTTP ${upstreamRes.status}）` });
    return;
  }

  const zwoText = await upstreamRes.text();
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(zwoText);
}
