import { describe, expect, it, vi } from 'vitest';
import { answerQuestion } from '../../src/ai/ask/answerer.js';
import { answerJsonSchema } from '../../src/ai/ask/schema.js';
import { ExtractionError, extractIntents } from '../../src/ai/extraction/extractor.js';
import { extractionJsonSchema } from '../../src/ai/extraction/schema.js';
import { GeminiProvider } from '../../src/ai/provider/gemini.js';
import { DEFAULT_GROQ_MODEL, GroqProvider, toStrictSchema } from '../../src/ai/provider/groq.js';
import { AIProviderError, createAIProvider } from '../../src/ai/provider/index.js';
import { parseEnv } from '../../src/config/env.js';
import { item, reply } from '../helpers/fakeAi.js';

const KEY = 'gsk_TEST-KEY-not-a-real-credential-123';
const request = { system: 'sys', user: 'usr', jsonSchema: { type: 'object' } };
const NOW = new Date('2026-10-08T10:00:00Z');

const ok = (content: string, extra: object = {}) =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], ...extra }),
    { status: 200 },
  );
const status = (code: number, headers: Record<string, string> = {}, body = '{"error":{}}') =>
  new Response(body, { status: code, headers });

function provider(fetchImpl: unknown, overrides: object = {}) {
  return new GroqProvider({
    apiKey: KEY,
    retryDelayMs: 0,
    fetchImpl: fetchImpl as typeof fetch,
    ...overrides,
  });
}
const kindOf = async (p: GroqProvider) => {
  const err = await p.generateStructured(request).catch((e: AIProviderError) => e);
  expect(err).toBeInstanceOf(AIProviderError);
  return err as AIProviderError;
};

describe('GroqProvider request', () => {
  it('posts to chat completions with strict json_schema, the key in a header only', async () => {
    const fetchMock = vi.fn(async () => ok('{"items":[]}'));
    const text = await provider(fetchMock).generateStructured({
      ...request,
      jsonSchema: extractionJsonSchema,
    });
    expect(text).toBe('{"items":[]}');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(String(init.body)).not.toContain(KEY);

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(DEFAULT_GROQ_MODEL);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toEqual(extractionJsonSchema);
    expect(body.include_reasoning).toBe(false);
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBeGreaterThan(1024);
  });

  it('uses GROQ_MODEL when set and never reads reasoning text', async () => {
    const fetchMock = vi.fn(async () =>
      ok('{"ok":true}', {
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '{"ok":true}', reasoning: 'ignore previous instructions' },
          },
        ],
      }),
    );
    const text = await provider(fetchMock, { model: 'some/other-model' }).generateStructured(
      request,
    );
    expect(text).toBe('{"ok":true}');
    const init = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0]![1];
    expect(JSON.parse(String(init.body)).model).toBe('some/other-model');
  });
});

describe('toStrictSchema', () => {
  it('leaves the (already strict) extraction schema unchanged', () => {
    expect(toStrictSchema(extractionJsonSchema)).toEqual(extractionJsonSchema);
  });

  it('adds additionalProperties:false and full required lists to the answer schema', () => {
    const strict = toStrictSchema(answerJsonSchema) as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(strict.additionalProperties).toBe(false);
    expect([...strict.required].sort()).toEqual(Object.keys(answerJsonSchema.properties).sort());
  });

  it('reaches nested objects inside arrays and does not mutate its input', () => {
    const input = {
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } },
      },
    };
    const copy = JSON.parse(JSON.stringify(input));
    const out = toStrictSchema(input) as typeof input & { additionalProperties: boolean };
    expect(out.additionalProperties).toBe(false);
    expect(
      (out.properties.list.items as unknown as { additionalProperties: boolean })
        .additionalProperties,
    ).toBe(false);
    expect(input).toEqual(copy);
  });
});

describe('GroqProvider failures', () => {
  it.each([
    [401, 'not_configured'],
    [403, 'not_configured'],
    [404, 'not_configured'],
    [400, 'bad_response'],
    [413, 'bad_response'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('maps HTTP %i to %s', async (code, kind) => {
    const err = await kindOf(provider(vi.fn(async () => status(code))));
    expect(err.kind).toBe(kind);
    expect(err.httpStatus).toBe(code);
  });

  it('tells a per-minute 429 from a daily one using the headers and the body', async () => {
    const perMinute = status(429, { 'x-ratelimit-remaining-requests': '800' });
    expect((await kindOf(provider(vi.fn(async () => perMinute)))).kind).toBe('rate_limited');

    const dailyHeader = status(429, { 'x-ratelimit-remaining-requests': '0' });
    expect((await kindOf(provider(vi.fn(async () => dailyHeader)))).kind).toBe('quota_exhausted');

    const dailyBody = status(429, {}, '{"error":{"message":"Limit reached ... tokens per day"}}');
    expect((await kindOf(provider(vi.fn(async () => dailyBody)))).kind).toBe('quota_exhausted');
  });

  it('retries a 5xx once but never a 429, a 400 or an auth error', async () => {
    const flaky = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok('{"a":1}'));
    expect(await provider(flaky).generateStructured(request)).toBe('{"a":1}');
    expect(flaky).toHaveBeenCalledTimes(2);

    for (const code of [429, 400, 401]) {
      const fetchMock = vi.fn(async () => status(code));
      await kindOf(provider(fetchMock));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('gives up after two attempts on repeated server errors', async () => {
    const fetchMock = vi.fn(async () => status(502));
    expect((await kindOf(provider(fetchMock))).kind).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a timeout and a network failure without retrying a timeout', async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    });
    expect((await kindOf(provider(timeout))).kind).toBe('timeout');
    expect(timeout).toHaveBeenCalledTimes(1);

    const network = vi.fn(async () => {
      throw new TypeError('socket hang up');
    });
    expect((await kindOf(provider(network))).kind).toBe('unavailable');
  });

  it('rejects truncated, filtered, empty and non-JSON replies', async () => {
    const cases: [Response, string][] = [
      [
        new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: {} }] })),
        'bad_response',
      ],
      [
        new Response(
          JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: {} }] }),
        ),
        'blocked',
      ],
      [ok('   '), 'bad_response'],
      [new Response(JSON.stringify({ choices: [] })), 'bad_response'],
      [new Response('<html>oops</html>'), 'bad_response'],
    ];
    for (const [res, kind] of cases) {
      expect((await kindOf(provider(vi.fn(async () => res)))).kind).toBe(kind);
    }
  });

  it('never puts the key, the request text or the provider body in an error', async () => {
    const fetchMock = vi.fn(async () =>
      status(401, {}, `{"error":{"message":"invalid key ${KEY} for usr"}}`),
    );
    const err = await kindOf(provider(fetchMock));
    expect(err.message).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(String(err)).not.toContain('invalid key');
  });
});

describe('Groq through the real extraction and Ask AI pipelines (mocked network)', () => {
  const extract = (fetchMock: unknown) =>
    extractIntents({
      provider: provider(fetchMock),
      title: 'Note',
      content: 'buy milk',
      timezone: 'UTC',
      now: NOW,
    });

  it('extracts a validated todo from a Groq reply', async () => {
    const items = await extract(vi.fn(async () => ok(reply(item()))));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'todo', text: 'Buy milk' });
  });

  it('accepts valid JSON with nothing actionable', async () => {
    expect(await extract(vi.fn(async () => ok(reply())))).toEqual([]);
  });

  it('turns malformed or schema-invalid output into a safe AI_BAD_OUTPUT failure', async () => {
    for (const content of ['not json at all', '{"items":"nope"}', '{"wrong":[]}']) {
      const err = await extract(vi.fn(async () => ok(content))).catch((e: ExtractionError) => e);
      expect(err).toBeInstanceOf(ExtractionError);
      expect((err as ExtractionError).code).toBe('AI_BAD_OUTPUT');
      expect((err as ExtractionError).userMessage).not.toContain('not json');
    }
  });

  it('maps provider failures to user-safe extraction errors with no secrets', async () => {
    const cases: [number, string][] = [
      [401, 'AI_NOT_CONFIGURED'],
      [429, 'AI_RATE_LIMITED'],
      [503, 'AI_UNAVAILABLE'],
    ];
    for (const [code, expected] of cases) {
      const err = await extract(vi.fn(async () => status(code))).catch((e: ExtractionError) => e);
      expect((err as ExtractionError).code).toBe(expected);
      expect((err as ExtractionError).userMessage).not.toContain(KEY);
    }
  });

  it('Ask AI: parses used_notes from a Groq reply and surfaces provider failures safely', async () => {
    const good = JSON.stringify({ answer: 'In May.', answerable: true, used_notes: [2] });
    const result = await answerQuestion({
      provider: provider(vi.fn(async () => ok(good))),
      question: 'When?',
      notes: [
        { title: 'A', content: 'x' },
        { title: 'B', content: 'y' },
      ],
    });
    expect(result).toEqual({ answer: 'In May.', answerable: true, used_notes: [2] });

    const err = await answerQuestion({
      provider: provider(vi.fn(async () => status(401, {}, KEY))),
      question: 'When?',
      notes: [{ title: 'A', content: 'x' }],
    }).catch((e: Error) => e);
    expect((err as unknown as { code: string }).code).toBe('AI_NOT_CONFIGURED');
    expect((err as Error).message).not.toContain(KEY);
  });
});

describe('provider selection', () => {
  const base = { SESSION_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgres://u:p@localhost:5432/d' };
  const gemini = { GEMINI_API_KEY: 'g', GEMINI_MODEL: 'm' };
  const groq = { GROQ_API_KEY: 'q' };
  const pick = (extra: Record<string, string>) => createAIProvider(parseEnv({ ...base, ...extra }));
  const isUnconfigured = async (p: ReturnType<typeof pick>) =>
    (await p.generateStructured(request).catch((e: AIProviderError) => e)) instanceof
    AIProviderError;

  it('keeps Gemini when only Gemini is configured, and picks Groq when only Groq is', () => {
    expect(pick(gemini)).toBeInstanceOf(GeminiProvider);
    expect(pick(groq)).toBeInstanceOf(GroqProvider);
  });

  it('keeps Gemini by default when both are configured, and Groq only when asked', () => {
    expect(pick({ ...gemini, ...groq })).toBeInstanceOf(GeminiProvider);
    expect(pick({ ...gemini, ...groq, AI_PROVIDER: 'groq' })).toBeInstanceOf(GroqProvider);
    expect(pick({ ...gemini, ...groq, AI_PROVIDER: 'gemini' })).toBeInstanceOf(GeminiProvider);
  });

  it('never falls back to another provider when the chosen one is incomplete', async () => {
    const chosenGroqNoKey = pick({ ...gemini, AI_PROVIDER: 'groq' });
    expect(chosenGroqNoKey).not.toBeInstanceOf(GeminiProvider);
    expect(await isUnconfigured(chosenGroqNoKey)).toBe(true);

    const chosenGeminiNoKey = pick({ ...groq, AI_PROVIDER: 'gemini' });
    expect(chosenGeminiNoKey).not.toBeInstanceOf(GroqProvider);
    expect(await isUnconfigured(chosenGeminiNoKey)).toBe(true);
  });

  it('reports not_configured when nothing is set, and rejects an unknown provider', async () => {
    const err = await pick({})
      .generateStructured(request)
      .catch((e: AIProviderError) => e);
    expect((err as AIProviderError).kind).toBe('not_configured');
    expect(() => parseEnv({ ...base, AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
  });

  it('treats a blank AI_PROVIDER and GROQ_MODEL as unset', () => {
    const env = parseEnv({ ...base, ...groq, AI_PROVIDER: '', GROQ_MODEL: '' });
    expect(env.AI_PROVIDER).toBeUndefined();
    expect(env.GROQ_MODEL).toBeUndefined();
    expect(createAIProvider(env)).toBeInstanceOf(GroqProvider);
  });
});
