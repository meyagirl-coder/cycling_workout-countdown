/**
 * Vercel Serverless Function：列出 intervals.icu 行事曆上「今天或未來」的課表
 * 事件，方便找 event ID 來測試「貼上課表網址」這個功能。跟 api/intervals-zwo.js
 * 用同一組環境變數（Athlete ID／API Key 都不會出現在回應裡）。
 *
 * 直接在瀏覽器打開 /api/intervals-events 就會用預設區間（今天到未來 30 天）
 * 查詢；也可以自己帶 ?oldest=YYYY-MM-DD&newest=YYYY-MM-DD 覆蓋範圍。不管
 * oldest 帶了什麼，回應永遠只列出今天（含）以後的事件，已經過去的日期一律
 * 濾掉；`events` 依日期由近到遠排序，`nearest` 是其中離今天最近、還沒發生的
 * 那一筆（找不到就是 null）——這就是「查詢最近一筆行事曆訓練代碼」要用的欄位。
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

  const rawEvents = await upstreamRes.json();
  const upcoming = keepTodayOrLaterSortedAscending(rawEvents, range.today);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    today: range.today,
    oldest: range.oldest,
    newest: range.newest,
    count: upcoming.length,
    nearest: upcoming.length > 0 ? upcoming[0] : null,
    events: upcoming,
  });
}

/**
 * 只留下「今天（含）或未來」的事件，依 start_date_local 由近到遠排序。用字串
 * 比較（不是 new Date() 解析）：start_date_local 是固定格式的 ISO 本地時間
 * 字串，字典序本來就等於時間先後順序，也不會因為時區解讀不同而算錯。
 */
function keepTodayOrLaterSortedAscending(events, todayDateStr) {
  if (!Array.isArray(events)) return [];

  return events
    .filter((event) => typeof event?.start_date_local === 'string' && event.start_date_local.slice(0, 10) >= todayDateStr)
    .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));
}

function resolveDateRange(oldestParam, newestParam) {
  const today = formatDate(new Date());
  const oldest = oldestParam || today;
  const newest = newestParam || formatDate(daysFromNow(30));
  if (!DATE_RE.test(oldest) || !DATE_RE.test(newest)) return null;
  return { oldest, newest, today };
}

function daysFromNow(deltaDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}
