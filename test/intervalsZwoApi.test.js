import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/intervals-zwo.js';

function makeReq({ method = 'GET', eventId, extraQuery = {} } = {}) {
  return { method, query: { ...(eventId === undefined ? {} : { eventId }), ...extraQuery } };
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

describe('api/intervals-zwo handler', () => {
  it('rejects non-GET methods', async () => {
    const req = makeReq({ method: 'POST', eventId: '123' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('rejects a missing eventId', async () => {
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/eventId/);
  });

  it('rejects a non-numeric eventId', async () => {
    const req = makeReq({ eventId: 'abc123' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when the athlete ID or API key env vars are missing', async () => {
    delete process.env.INTERVALS_ICU_API_KEY;
    const req = makeReq({ eventId: '123' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/INTERVALS_ICU_API_KEY/);
  });

  it('calls intervals.icu with the correct URL and Basic Auth header, then relays the .zwo body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<workout_file><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>',
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ eventId: '4242' });
    const res = makeRes();

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://intervals.icu/api/v1/athlete/i999999/events/4242/download.zwo');

    const expectedAuth = `Basic ${Buffer.from('API_KEY:secret-test-key').toString('base64')}`;
    expect(calledOptions.headers.Authorization).toBe(expectedAuth);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('xml');
    expect(res.body).toContain('<SteadyState');
    expect(res.headers['Cache-Control']).toContain('no-store');
    expect(res.headers.Pragma).toBe('no-cache');
    expect(res.headers.Expires).toBe('0');
  });

  it('ignores unrelated query params (e.g. a frontend cache-busting _t=timestamp) when resolving eventId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<workout_file></workout_file>' });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ eventId: '4242', extraQuery: { _t: '1784500000000' } });
    const res = makeRes();

    await handler(req, res);

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://intervals.icu/api/v1/athlete/i999999/events/4242/download.zwo');
  });

  it('never mixes up two different event IDs requested back-to-back (regression: wrong workout loaded)', async () => {
    const contentByEventId = {
      111: '<workout_file><name>0714 Endurance</name><workout><SteadyState Duration="60" Power="0.6"/></workout></workout_file>',
      222: '<workout_file><name>0720 SST</name><workout><SteadyState Duration="60" Power="0.9"/></workout></workout_file>',
    };
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const match = url.match(/events\/(\d+)\/download\.zwo$/);
      const id = match?.[1];
      return { ok: true, status: 200, text: async () => contentByEventId[id] ?? '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const resFor111 = makeRes();
    await handler(makeReq({ eventId: '111' }), resFor111);
    expect(resFor111.body).toContain('0714 Endurance');
    expect(resFor111.body).not.toContain('0720 SST');

    const resFor222 = makeRes();
    await handler(makeReq({ eventId: '222' }), resFor222);
    expect(resFor222.body).toContain('0720 SST');
    expect(resFor222.body).not.toContain('0714 Endurance');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/events/111/');
    expect(fetchMock.mock.calls[1][0]).toContain('/events/222/');
  });

  it('maps an upstream network failure to a 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const req = makeReq({ eventId: '4242' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
  });

  it('maps a 401 from intervals.icu to a clear auth-failure message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const req = makeReq({ eventId: '4242' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/認證失敗/);
  });

  it('maps a 404 from intervals.icu to a 404 with a clear message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const req = makeReq({ eventId: '4242' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/找不到/);
  });

  it('maps any other non-ok upstream status to a generic 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const req = makeReq({ eventId: '4242' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain('500');
  });
});
