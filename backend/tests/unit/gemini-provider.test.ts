import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../../src/ai/provider/gemini.js';
import { AIProviderError, createAIProvider } from '../../src/ai/provider/index.js';
import { parseEnv } from '../../src/config/env.js';

const KEY = 'TEST-KEY-not-a-real-credential-123';
const request = { system: 'sys', user: 'usr', jsonSchema: { type: 'object' } };

const ok = (text: string, extra: object = {}) =>
  new Response(
    JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
      ...extra,
    }),
    { status: 200 },
  );
const status = (code: number) =>
  new Response(JSON.stringify({ error: { code } }), { status: code });

function provider(fetchImpl: typeof fetch, overrides: object = {}) {
  return new GeminiProvider({
    apiKey: KEY,
    model: 'configured-model-x',
    retryDelayMs: 0,
    fetchImpl,
    ...overrides,
  });
}

describe('GeminiProvider request', () => {
  it('calls generateContent for the configured model with the key in a header only', async () => {
    const fetchMock = vi.fn(async () => ok('{"items":[]}'));
    const text = await provider(fetchMock as unknown as typeof fetch).generateStructured(request);
    expect(text).toBe('{"items":[]}');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/models/configured-model-x:generateContent');
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(String(init.body)).not.toContain(KEY);

    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.contents[0].parts[0].text).toBe('usr');
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
      temperature: 0,
    });
  });

  it('joins multi-part text', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { finishReason: 'STOP', content: { parts: [{ text: '{"a":' }, { text: '1}' }] } },
            ],
          }),
        ),
    );
    expect(await provider(f as unknown as typeof fetch).generateStructured(request)).toBe(
      '{"a":1}',
    );
  });
});

describe('GeminiProvider failures', () => {
  const kindOf = async (p: GeminiProvider) => {
    try {
      await p.generateStructured(request);
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      return err as AIProviderError;
    }
    throw new Error('expected failure');
  };

  it('retries once on 503 and succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok('{"items":[]}'));
    expect(await provider(f as unknown as typeof fetch).generateStructured(request)).toBe(
      '{"items":[]}',
    );
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt limit (no long retry loops)', async () => {
    const f = vi.fn(async () => status(503));
    const err = await kindOf(provider(f as unknown as typeof fetch));
    expect(err.kind).toBe('unavailable');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('reports a short-term rate limit without retrying (a retry would only spend quota)', async () => {
    const f = vi.fn(async () => status(429));
    const err = await kindOf(provider(f as unknown as typeof fetch));
    expect(err.kind).toBe('rate_limited');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('recognises an exhausted daily quota and does not retry', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              details: [
                { violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
              ],
            },
          }),
          { status: 429 },
        ),
    );
    const err = await kindOf(provider(f as unknown as typeof fetch));
    expect(err.kind).toBe('quota_exhausted');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])(
    'treats %i as a configuration problem and does not retry',
    async (code) => {
      const f = vi.fn(async () => status(code));
      const err = await kindOf(provider(f as unknown as typeof fetch));
      expect(err.kind).toBe('not_configured');
      expect(f).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry other client errors', async () => {
    const f = vi.fn(async () => status(400));
    const err = await kindOf(provider(f as unknown as typeof fetch));
    expect(err.kind).toBe('unavailable');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('reports network failures as unavailable (after one retry)', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const err = await kindOf(provider(f as unknown as typeof fetch));
    expect(err.kind).toBe('unavailable');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('reports a timeout without retrying', async () => {
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(init.signal?.reason));
        }),
    );
    const err = await kindOf(provider(f as unknown as typeof fetch, { timeoutMs: 20 }));
    expect(err.kind).toBe('timeout');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('reports blocked prompts and safety-blocked candidates', async () => {
    const blockedPrompt = vi.fn(
      async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })),
    );
    expect((await kindOf(provider(blockedPrompt as unknown as typeof fetch))).kind).toBe('blocked');

    const blockedCandidate = vi.fn(
      async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] })),
    );
    expect((await kindOf(provider(blockedCandidate as unknown as typeof fetch))).kind).toBe(
      'blocked',
    );
  });

  it.each([
    ['no candidates', JSON.stringify({})],
    [
      'truncated output',
      JSON.stringify({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }],
      }),
    ],
    [
      'empty text',
      JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '  ' }] } }],
      }),
    ],
    ['non-JSON body', '<html>oops</html>'],
  ])('treats %s as a bad response', async (_name, body) => {
    const f = vi.fn(async () => new Response(body));
    expect((await kindOf(provider(f as unknown as typeof fetch))).kind).toBe('bad_response');
  });

  it('never puts the API key or the provider body into error messages', async () => {
    const f = vi.fn(async () => new Response(`leaked ${KEY}`, { status: 500 }));
    const err = await kindOf(provider(f as unknown as typeof fetch));
    expect(err.message).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });
});

describe('provider abstraction and configuration', () => {
  const base = { SESSION_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgres://u:p@localhost:5432/d' };

  it('createAIProvider returns an "unconfigured" provider without a key or model', async () => {
    for (const env of [
      parseEnv(base),
      parseEnv({ ...base, GEMINI_API_KEY: 'k' }),
      parseEnv({ ...base, GEMINI_MODEL: 'm' }),
    ]) {
      await expect(createAIProvider(env).generateStructured(request)).rejects.toMatchObject({
        kind: 'not_configured',
      });
    }
  });

  it('createAIProvider returns a Gemini provider when key and model are set', () => {
    const p = createAIProvider(parseEnv({ ...base, GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' }));
    expect(p).toBeInstanceOf(GeminiProvider);
  });

  it('no model name is hardcoded in application source', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.ts')) files.push(full);
      }
    };
    walk(join(__dirname, '../../src'));
    const offenders = files.filter((f) => /gemini-\d/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('Gemini-specific code is confined to the provider module', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.ts')) files.push(full);
      }
    };
    walk(join(__dirname, '../../src'));
    const outside = files
      .filter((f) => !f.replaceAll('\\', '/').includes('/ai/provider/'))
      .filter((f) => !f.endsWith('config/env.ts'))
      .filter((f) =>
        /generativelanguage|x-goog-api-key|GeminiProvider/.test(readFileSync(f, 'utf8')),
      );
    expect(outside).toEqual([]);
  });
});
