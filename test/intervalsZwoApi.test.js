import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/intervals-zwo.js';

function makeReq({ method = 'GET', eventId } = {}) {
  return { method, query: eventId === undefined ? {} : { eventId } };
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
