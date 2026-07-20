import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/intervals-events.js';

function makeReq({ method = 'GET', query = {} } = {}) {
  return { method, query };
}

function makeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    send(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.INTERVALS_ICU_ATHLETE_ID = 'i999999';
  process.env.INTERVALS_ICU_API_KEY = 'secret-test-key';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('api/intervals-events handler', () => {
  it('rejects non-GET methods', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('returns 500 when the athlete ID or API key env vars are missing', async () => {
    delete process.env.INTERVALS_ICU_ATHLETE_ID;
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/INTERVALS_ICU_ATHLETE_ID/);
  });

  it('rejects malformed oldest/newest query params', async () => {
    const req = makeReq({ query: { oldest: 'not-a-date' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('defaults the query window to today through 30 days forward, not a fixed lookback range', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://intervals.icu/api/v1/athlete/i999999/events?oldest=2026-07-21&newest=2026-08-20');

    const expectedAuth = `Basic ${Buffer.from('API_KEY:secret-test-key').toString('base64')}`;
    expect(calledOptions.headers.Authorization).toBe(expectedAuth);

    expect(res.statusCode).toBe(200);
    expect(res.body.today).toBe('2026-07-21');
    expect(res.body.events).toEqual([]);
    expect(res.body.nearest).toBeNull();
  });

  it('sets strong cache-prevention headers so no intermediate cache can serve a stale/wrong response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.headers['Cache-Control']).toContain('no-store');
    expect(res.headers.Pragma).toBe('no-cache');
    expect(res.headers.Expires).toBe('0');
  });

  it('uses an explicit `today` query param (the browser\'s local date) instead of the server clock, fixing the UTC-vs-local-timezone offset', async () => {
    // Server clock says 2026-07-20 (e.g. still UTC-side of midnight), but the
    // caller (uploadView.js, using the browser's local date) says it's
    // already 2026-07-21 locally - `today` must win.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T20:00:00Z'));

    const events = [
      { id: 1, name: '0720 ride', start_date_local: '2026-07-20T06:00:00' },
      { id: 2, name: '0721 ride', start_date_local: '2026-07-21T06:00:00' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => events }));

    const req = makeReq({ query: { today: '2026-07-21' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.body.today).toBe('2026-07-21');
    // The server-clock-only default (2026-07-20) would have wrongly kept
    // event 1 and picked it as `nearest`; with the client's local date it's
    // correctly excluded as already past.
    expect(res.body.events.map((e) => e.id)).toEqual([2]);
    expect(res.body.nearest.id).toBe(2);

    const [calledUrl] = vi.mocked(fetch).mock.calls[0];
    expect(calledUrl).toContain('oldest=2026-07-21'); // default oldest also derives from `today`, not the server clock
  });

  it('rejects a malformed `today` query param', async () => {
    const req = makeReq({ query: { today: '21-07-2026' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('honors an explicit oldest query param for the upstream request, but still filters the response to today-or-later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));

    const events = [
      { id: 1, name: 'Old ride', start_date_local: '2026-01-05T06:00:00' },
      { id: 2, name: 'Upcoming ride', start_date_local: '2026-07-25T06:00:00' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => events }));

    const req = makeReq({ query: { oldest: '2026-01-01', newest: '2026-12-31' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.body.oldest).toBe('2026-01-01'); // honored for the upstream query
    expect(res.body.newest).toBe('2026-12-31');
    // ...but the past-dated event is still excluded from the actual results.
    expect(res.body.events.map((e) => e.id)).toEqual([2]);
    expect(res.body.nearest.id).toBe(2);
  });

  it('excludes past-dated events even when they fall inside the queried range', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));

    const events = [
      { id: 1, name: 'Yesterday', start_date_local: '2026-07-20T06:00:00' },
      { id: 2, name: 'Today', start_date_local: '2026-07-21T06:00:00' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => events }));

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    // Today's own event is included ("today or future"); yesterday's is not.
    expect(res.body.events.map((e) => e.id)).toEqual([2]);
    expect(res.body.nearest.id).toBe(2);
  });

  it('sorts multiple upcoming events ascending and picks the nearest one as `nearest` (e.g. a weekly Tue/Thu plan)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z')); // a Tuesday

    const thisThursday = { id: 1, name: 'Thu intervals', start_date_local: '2026-07-23T06:00:00' };
    const nextTuesday = { id: 2, name: 'Next Tue SST', start_date_local: '2026-07-28T06:00:00' };
    const nextThursday = { id: 3, name: 'Next Thu intervals', start_date_local: '2026-07-30T06:00:00' };
    // Deliberately out of chronological order, as a real API response might be.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [nextThursday, thisThursday, nextTuesday] }));

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.body.events.map((e) => e.id)).toEqual([1, 2, 3]); // nearest-first
    expect(res.body.nearest).toEqual(thisThursday);
    expect(res.body.count).toBe(3);
  });

  it('returns nearest: null and an empty events array when nothing upcoming is found', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));

    const events = [{ id: 1, name: 'Long gone', start_date_local: '2026-01-01T06:00:00' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => events }));

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.body.count).toBe(0);
    expect(res.body.events).toEqual([]);
    expect(res.body.nearest).toBeNull();
  });

  it('maps a network failure to a 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
  });

  it('maps a 401 from intervals.icu to a clear auth-failure message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/認證失敗/);
  });

  it('maps any other non-ok upstream status to a generic 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain('500');
  });
});
