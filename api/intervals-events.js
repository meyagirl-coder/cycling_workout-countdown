/**
 * Vercel Serverless Function：列出 intervals.icu 行事曆上的課表事件，方便找
 * event ID 來測試「貼上課表網址」這個功能。跟 api/intervals-zwo.js 用同一組
 * 環境變數（Athlete ID／API Key 都不會出現在回應裡）。
 *
 * 直接在瀏覽器打開 /api/intervals-events 就會用預設區間（過去 7 天到未來 30
 * 天）查詢；也可以自己帶 ?oldest=YYYY-MM-DD&newest=YYYY-MM-DD 覆蓋範圍。
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const athleteId = process.env.INTERVALS_ICU_ATHLETE_ID;
  const apiKey = process.env.INTERVALS_ICU_API_KEY;
  if (!athleteId || !apiKey) {
    res.status(500).json({ error: '伺服器缺少 INTERVALS_ICU_ATHLETE_ID 或 INTERVALS_ICU_API_KEY 環境變數' });
    return;
  }

  const oldestParam = Array.isArray(req.query.oldest) ? req.query.oldest[0] : req.query.oldest;
  const newestParam = Array.isArray(req.query.newest) ? req.query.newest[0] : req.query.newest;
  const range = resolveDateRange(oldestParam, newestParam);
  if (!range) {
    res.status(400).json({ error: 'oldest/newest 必須是 YYYY-MM-DD 格式的日期' });
    return;
  }

  const upstreamUrl = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events?oldest=${range.oldest}&newest=${range.newest}`;
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
    res.status(502).json({ error: `intervals.icu 回傳錯誤（HTTP ${upstreamRes.status}）` });
    return;
  }

  const events = await upstreamRes.json();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    oldest: range.oldest,
    newest: range.newest,
    count: Array.isArray(events) ? events.length : null,
    events,
  });
}

function resolveDateRange(oldestParam, newestParam) {
  const oldest = oldestParam || formatDate(daysFromNow(-7));
  const newest = newestParam || formatDate(daysFromNow(30));
  if (!DATE_RE.test(oldest) || !DATE_RE.test(newest)) return null;
  return { oldest, newest };
}

function daysFromNow(deltaDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}
