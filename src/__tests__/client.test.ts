import { CellystialClient } from '../client';
import { AuthenticationError, RateLimitError, ValidationError } from '../errors';

/** Builds a minimal `fetch` Response stand-in for the bits the client reads. */
function makeResponse(opts: {
  status?: number;
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
  arrayBuffer?: ArrayBuffer;
}): Response {
  const status = opts.status ?? 200;
  const headers = opts.headers ?? {};
  const text = opts.body ?? (opts.json !== undefined ? JSON.stringify(opts.json) : '');
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string): string | null => headers[k.toLowerCase()] ?? null },
    text: async (): Promise<string> => text,
    arrayBuffer: async (): Promise<ArrayBuffer> => opts.arrayBuffer ?? new ArrayBuffer(0),
  } as unknown as Response;
}

// A plain mock cast to fetch; we read/queue through helpers to stay independent
// of jest's version-specific generic typings.
const fetchMock = jest.fn();

function mockFetch(res: Response): void {
  fetchMock.mockImplementation(() => Promise.resolve(res));
}

function lastCall(): { url: string; init: RequestInit } {
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
  const [url, init] = calls[calls.length - 1];
  return { url, init };
}

function authHeader(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string>).Authorization;
}

describe('CellystialClient', () => {
  const apiKey = 'sk_test_key';
  let client: CellystialClient;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new CellystialClient({ apiKey });
  });

  it('throws when constructed without an apiKey', () => {
    expect(() => new CellystialClient({ apiKey: '' })).toThrow();
  });

  it('listTemplates GETs the integration endpoint with the bearer key', async () => {
    mockFetch(makeResponse({ json: [{ id: 't1', name: 'Invoice' }] }));
    const templates = await client.listTemplates();
    const { url, init } = lastCall();
    expect(url).toBe('https://api.cellystial.com/api/v1/integration/templates');
    expect(init.method).toBe('GET');
    expect(authHeader(init)).toBe(`Bearer ${apiKey}`);
    expect(templates).toEqual([{ id: 't1', name: 'Invoice' }]);
  });

  it('generatePdf returns bytes + filename + duration and sends the right body', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7').buffer;
    fetchMock.mockResolvedValue(
      makeResponse({
        arrayBuffer: pdf,
        headers: { 'content-disposition': 'attachment; filename="out.pdf"', 'x-api-duration-ms': '42' },
      }),
    );
    const result = await client.generatePdf('invoice', { total: 9 });
    const { url, init } = lastCall();
    expect(url).toBe('https://api.cellystial.com/api/v1/generate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Accept).toBe('application/pdf');
    expect(JSON.parse(init.body as string)).toEqual({ templateId: 'invoice', data: { total: 9 } });
    expect(Buffer.isBuffer(result.content)).toBe(true);
    expect(result.content.toString('utf8')).toBe('%PDF-1.7');
    expect(result.filename).toBe('out.pdf');
    expect(result.durationMs).toBe(42);
  });

  it('maps 401 to AuthenticationError and 400 to ValidationError', async () => {
    mockFetch(makeResponse({ status: 401, json: { message: 'bad key' } }));
    await expect(client.listTemplates()).rejects.toBeInstanceOf(AuthenticationError);

    mockFetch(makeResponse({ status: 400, json: { message: ['url must be an http(s) URL'] } }));
    await expect(client.createWebhook({ url: 'x', events: ['pdf.generated'] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('surfaces Retry-After (seconds) on RateLimitError for a 429', async () => {
    mockFetch(makeResponse({ status: 429, json: { message: 'slow down' }, headers: { 'retry-after': '30' } }));
    const err = await client.listTemplates().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(30);
  });

  it('leaves retryAfter null when a 429 has no Retry-After header', async () => {
    mockFetch(makeResponse({ status: 429, json: { message: 'slow down' } }));
    const err = await client.listTemplates().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBeNull();
  });

  it('createWebhook POSTs url+events+description and returns the secret', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        json: {
          id: 'wh_1',
          url: 'https://h.test/x',
          events: ['pdf.generated'],
          description: 'n8n',
          active: true,
          secret: 'whsec_live',
        },
      }),
    );
    const sub = await client.createWebhook({
      url: 'https://h.test/x',
      events: ['pdf.generated'],
      description: 'n8n',
    });
    const { url, init } = lastCall();
    expect(url).toBe('https://api.cellystial.com/api/v1/webhooks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      url: 'https://h.test/x',
      events: ['pdf.generated'],
      description: 'n8n',
    });
    expect(sub.secret).toBe('whsec_live');
    expect(sub.id).toBe('wh_1');
  });

  it('listWebhooks GETs /webhooks', async () => {
    mockFetch(makeResponse({ json: [{ id: 'wh_1', events: ['batch.completed'] }] }));
    const subs = await client.listWebhooks();
    expect(lastCall().url).toBe('https://api.cellystial.com/api/v1/webhooks');
    expect(subs).toHaveLength(1);
  });

  it('deleteWebhook DELETEs by id and tolerates a 204 empty body', async () => {
    mockFetch(makeResponse({ status: 204, body: '' }));
    await expect(client.deleteWebhook('wh_1')).resolves.toBeUndefined();
    const { url, init } = lastCall();
    expect(url).toBe('https://api.cellystial.com/api/v1/webhooks/wh_1');
    expect(init.method).toBe('DELETE');
  });
});
