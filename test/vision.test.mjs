import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribePages, cleanModelOutput, NO_CONTENT, VisionError } from '../src/lib/vision.js';
import { buildRequest, getProvider, parseResponse, classifyHttpError, PROVIDERS } from '../src/lib/providers.js';

const A = { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5' };

const ok = (text, stop = 'end_turn') => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ content: [{ type: 'text', text }], stop_reason: stop }) });
const okOA = (text) => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });
const err = (status, message = '', headers = new Map()) => ({ ok: false, status, headers, text: async () => JSON.stringify({ error: { message } }) });
const pages = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, hint: `t${i + 1}`, getImage: async () => 'AAAA' }));
const noSleep = async () => {};

test('transcribe en orden y manda cabeceras correctas', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const n = body.messages[0].content[1].text.match(/Diapositiva (\d+) de/)[1];
    return ok(`## Diapositiva ${n}: x`);
  };
  const r = await transcribePages({ pages: pages(5), ai: A, label: 'Diapositiva', fetchImpl, sleep: noSleep });
  assert.deepEqual(r.map((x) => x.markdown), [1, 2, 3, 4, 5].map((n) => `## Diapositiva ${n}: x`));
  assert.equal(calls[0].init.headers['x-api-key'], 'k');
  assert.equal(calls[0].init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(calls[0].body.messages[0].content[0].source.media_type, 'image/jpeg');
});

test('reintenta 429 y 500 y luego funciona', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? err(429) : n === 2 ? err(500) : ok('listo'));
  const r = await transcribePages({ pages: pages(1), ai: A, fetchImpl, sleep: noSleep });
  assert.equal(r[0].markdown, 'listo');
  assert.equal(n, 3);
});

test('error por página no detiene las demás', async () => {
  const fetchImpl = async (_u, init) => (JSON.parse(init.body).messages[0].content[1].text.includes('Página 2 de') ? err(400, 'bad') : ok('bien'));
  const r = await transcribePages({ pages: pages(3), ai: A, fetchImpl, sleep: noSleep });
  assert.equal(r[0].markdown, 'bien');
  assert.ok(r[1].error);
  assert.equal(r[2].markdown, 'bien');
});

test('401 es fatal y lanza', async () => {
  await assert.rejects(transcribePages({ pages: pages(4), ai: A, fetchImpl: async () => err(401), sleep: noSleep }), (e) => e instanceof VisionError && e.fatal);
});

test('sin saldo (400 billing) es fatal', async () => {
  await assert.rejects(transcribePages({ pages: pages(2), ai: A, fetchImpl: async () => err(400, 'credit balance is too low'), sleep: noSleep }), /saldo/);
});

test('cancelar lanza AbortError', async () => {
  const c = new AbortController();
  const fetchImpl = async () => { c.abort(); return ok('x'); };
  await assert.rejects(transcribePages({ pages: pages(3), ai: A, fetchImpl, signal: c.signal, sleep: noSleep }), { name: 'AbortError' });
});

test('cleanModelOutput', () => {
  assert.equal(cleanModelOutput(NO_CONTENT), null);
  assert.equal(cleanModelOutput('```markdown\n## A\n```'), '## A');
  assert.match(cleanModelOutput('hola', true), /se cortó/);
  assert.equal(cleanModelOutput('<think>x</think>\n## A'), '## A');
});

test('la respuesta de red caída reintenta y termina como error de página', async () => {
  const fetchImpl = async () => { throw new TypeError('fail'); };
  const r = await transcribePages({ pages: pages(1), ai: A, fetchImpl, sleep: noSleep });
  assert.match(r[0].error, /conectar/);
});

const textOf = (req) => (req.body.messages?.[0]?.content?.find?.((p) => p.type === 'text') || req.body.contents?.[0]?.parts?.find?.((p) => p.text)).text;

test('Gemini: URL, cabecera, cuerpo y respuesta', async () => {
  const p = getProvider('gemini');
  const req = buildRequest({ provider: p, apiKey: 'AIza', model: 'gemini-3.8-flash' }, { system: 'S', text: 'T', image: 'IMG' });
  assert.equal(req.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(req.headers['x-goog-api-key'], 'AIza');
  assert.equal(req.body.systemInstruction.parts[0].text, 'S');
  assert.equal(req.body.contents[0].parts[0].inlineData.data, 'IMG');
  const gemma = buildRequest({ provider: p, apiKey: 'k', model: 'gemma-4-31b-it' }, { system: 'S', text: 'T', image: 'IMG' });
  assert.equal(gemma.body.systemInstruction, undefined);
  assert.match(gemma.body.contents[0].parts[1].text, /^S[\s\S]*T$/);
  const r = parseResponse(p, { candidates: [{ content: { parts: [{ text: 'pensando', thought: true }, { text: '## Hola' }] }, finishReason: 'MAX_TOKENS' }] });
  assert.deepEqual(r, { text: '## Hola', truncated: true });
  assert.throws(() => parseResponse(p, { promptFeedback: { blockReason: 'SAFETY' } }), /bloque/);
});

test('OpenAI-compatible: OpenRouter, Groq y local sin clave', async () => {
  for (const id of ['openrouter', 'groq']) {
    const p = getProvider(id);
    const req = buildRequest({ provider: p, apiKey: 'K', model: p.models[0].id }, { system: 'S', text: 'T', image: 'IMG' });
    assert.equal(req.url, `${p.baseUrl}/chat/completions`);
    assert.equal(req.headers.authorization, 'Bearer K');
    assert.equal(req.body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,IMG');
  }
  const c = buildRequest({ provider: getProvider('custom'), apiKey: '', model: 'llama3.2-vision', baseUrl: 'http://localhost:11434/v1/' }, { system: 'S', text: 'T', image: 'I' });
  assert.equal(c.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(c.headers.authorization, undefined);
  assert.deepEqual(parseResponse(getProvider('groq'), { choices: [{ message: { content: 'x' }, finish_reason: 'length' }] }), { text: 'x', truncated: true });
  assert.throws(() => parseResponse(getProvider('groq'), { error: { message: 'boom' } }), /boom/);
});

test('clasificación de errores', () => {
  const ctx = { provider: getProvider('gemini'), model: 'm' };
  assert.equal(classifyHttpError(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}', ctx).kind, 'auth');
  assert.equal(classifyHttpError(429, '{"error":{"message":"quota","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}', ctx).kind, 'quota');
  const rate = classifyHttpError(429, '{"error":{"details":[{"retryDelay":"27s"}]}}', ctx);
  assert.equal(rate.kind, 'rate');
  assert.equal(rate.retryAfter, 27);
  assert.equal(classifyHttpError(429, '{"error":{"message":"Rate limit exceeded: free-models-per-day"}}', { provider: getProvider('openrouter'), model: 'm' }).fatal, true);
  assert.equal(classifyHttpError(400, '{"error":{"message":"This model does not support image input"}}', ctx).kind, 'model');
  assert.equal(classifyHttpError(404, '{}', { provider: getProvider('custom'), model: 'm' }).kind, 'model');
});

test('cada proveedor tiene lo necesario', () => {
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.label && p.format && p.baseUrl && p.concurrency >= 1);
    if (p.id !== 'custom') assert.ok(p.models.length > 0 && p.keyUrl);
  }
  assert.ok(PROVIDERS.filter((p) => p.free).length >= 4);
});

test('429 por minuto espera lo que pide el proveedor y reintenta', async () => {
  const waits = [];
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? err(429, 'x', new Map([['retry-after', '7']])) : okOA('listo'));
  const g = { provider: 'groq', apiKey: 'k', model: 'meta-llama/llama-4-scout-17b-16e-instruct' };
  const r = await transcribePages({ pages: pages(1), ai: g, fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(r[0].markdown, 'listo');
  assert.ok(waits[0] >= 7000 && waits[0] < 8000);
});

test('cuota diaria a mitad: conserva lo leído y marca el resto', async () => {
  let n = 0;
  const fetchImpl = async () => (++n <= 2 ? okOA('bien') : err(429, 'free-models-per-day'));
  const o = { provider: 'openrouter', apiKey: 'k', model: 'openrouter/free' };
  const r = await transcribePages({ pages: pages(5), ai: o, fetchImpl, sleep: noSleep });
  assert.equal(r.filter((x) => x.markdown === 'bien').length, 2);
  assert.ok(r.every(Boolean));
  assert.match(r.stopped, /límite diario/);
});

test('respuesta 200 con error dentro (OpenRouter) no revienta', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ error: { message: 'Provider returned error' } }) });
  const o = { provider: 'openrouter', apiKey: 'k', model: 'openrouter/free' };
  const r = await transcribePages({ pages: pages(1), ai: o, fetchImpl, sleep: noSleep });
  assert.match(r[0].error, /Provider returned error/);
});
