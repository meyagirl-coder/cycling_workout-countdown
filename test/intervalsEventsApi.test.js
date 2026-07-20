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

  it('defaults to a 7-days-back / 30-days-forward window and calls the correct upstream URL with Basic Auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toMatch(/^https:\/\/intervals\.icu\/api\/v1\/athlete\/i999999\/events\?oldest=\d{4}-\d{2}-\d{2}&newest=\d{4}-\d{2}-\d{2}$/);

    const expectedAuth = `Basic ${Buffer.from('API_KEY:secret-test-key').toString('base64')}`;
    expect(calledOptions.headers.Authorization).toBe(expectedAuth);

    expect(res.statusCode).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  it('honors explicit oldest/newest query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ query: { oldest: '2026-01-01', newest: '2026-01-31' } });
    const res = makeRes();

    await handler(req, res);

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://intervals.icu/api/v1/athlete/i999999/events?oldest=2026-01-01&newest=2026-01-31');
    expect(res.body.oldest).toBe('2026-01-01');
    expect(res.body.newest).toBe('2026-01-31');
  });

  it('relays the event list and count from intervals.icu', async () => {
    const events = [
      { id: 111, name: 'SST 3x12', start_date_local: '2026-07-21T06:00:00', type: 'Ride' },
      { id: 222, name: 'Endurance Ride', start_date_local: '2026-07-23T06:00:00', type: 'Ride' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => events }));

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('json');
    expect(res.body.count).toBe(2);
    expect(res.body.events).toEqual(events);
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
