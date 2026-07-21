import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/whatsonzwift-workout.js';

function makeReq({ method = 'GET', url } = {}) {
  return { method, query: { ...(url === undefined ? {} : { url }) } };
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

afterEach(() => {
  vi.unstubAllGlobals();
});

const VALID_URL = 'https://whatsonzwift.com/workouts/over-unders';

describe('api/whatsonzwift-workout handler', () => {
  it('rejects non-GET methods', async () => {
    const req = makeReq({ method: 'POST', url: VALID_URL });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('rejects a missing url param', async () => {
    const req = makeReq({});
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/url/);
  });

  it('rejects an unparseable url', async () => {
    const req = makeReq({ url: 'not a url' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('rejects urls outside whatsonzwift.com (SSRF guard)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ url: 'https://evil.example.com/workouts/foo' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('whatsonzwift.com');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) protocol even if the hostname string matches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ url: 'file://whatsonzwift.com/etc/passwd' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the www subdomain', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<div>2min @ 50% FTP</div>' });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ url: 'https://www.whatsonzwift.com/workouts/over-unders' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('fetches the given url over https and extracts/relays the workout text', async () => {
    const html = '<div>2min @ 50% FTP</div><div>3min @ 51% FTP</div>';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ url: VALID_URL });
    const res = makeRes();

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(VALID_URL);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('2min @ 50% FTP\n3min @ 51% FTP');
    expect(res.headers['Content-Type']).toContain('text/plain');
    expect(res.headers['Cache-Control']).toContain('no-store');
  });

  it('upgrades a plain http:// url to https before fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<div>2min @ 50% FTP</div>' });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ url: 'http://whatsonzwift.com/workouts/foo' });
    const res = makeRes();

    await handler(req, res);

    expect(fetchMock.mock.calls[0][0]).toBe('https://whatsonzwift.com/workouts/foo');
  });

  it('extracts and relays the full Over-Unders example unchanged', async () => {
    const html = [
      '<div>5min from 40 to 105% FTP</div>',
      '<div>2min @ 50% FTP</div>',
      '<div>3x 2min @ 105% FTP,</div>',
      '<div>1min @ 90% FTP</div>',
      '<div>3min @ 51% FTP</div>',
      '<div>3x 2min @ 105% FTP,</div>',
      '<div>1min @ 91% FTP</div>',
      '<div>5min from 70 to 40% FTP</div>',
    ].join('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html }));

    const req = makeReq({ url: VALID_URL });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(
      [
        '5min from 40 to 105% FTP',
        '2min @ 50% FTP',
        '3x 2min @ 105% FTP,',
        '1min @ 90% FTP',
        '3min @ 51% FTP',
        '3x 2min @ 105% FTP,',
        '1min @ 91% FTP',
        '5min from 70 to 40% FTP',
      ].join('\n')
    );
  });

  it('returns 422 with a fallback hint when no workout content can be extracted from the page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<html><body>Not found</body></html>' });
    vi.stubGlobal('fetch', fetchMock);

    const req = makeReq({ url: VALID_URL });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatch(/貼上課表文字內容/);
  });

  it('maps an upstream network failure to a 502 with a fallback hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const req = makeReq({ url: VALID_URL });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/貼上課表文字內容/);
  });

  it('maps a 404 from WhatsOnZwift to a 404 with a clear message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const req = makeReq({ url: VALID_URL });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/找不到/);
  });

  it('maps any other non-ok upstream status to a 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const req = makeReq({ url: VALID_URL });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain('500');
  });
});
