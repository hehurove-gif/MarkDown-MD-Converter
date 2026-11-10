import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribePages, cleanModelOutput, NO_CONTENT, VisionError } from '../src/lib/vision.js';

const ok = (text, stop = 'end_turn') => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ content: [{ type: 'text', text }], stop_reason: stop }) });
const err = (status, message = '', headers = new Map()) => ({ ok: false, status, headers, json: async () => ({ error: { message } }) });
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
  const r = await transcribePages({ pages: pages(5), apiKey: 'k', label: 'Diapositiva', fetchImpl, sleep: noSleep });
  assert.deepEqual(r.map((x) => x.markdown), [1, 2, 3, 4, 5].map((n) => `## Diapositiva ${n}: x`));
  assert.equal(calls[0].init.headers['x-api-key'], 'k');
  assert.equal(calls[0].init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(calls[0].body.messages[0].content[0].source.media_type, 'image/jpeg');
});

test('reintenta 429 y 500 y luego funciona', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? err(429) : n === 2 ? err(500) : ok('listo'));
  const r = await transcribePages({ pages: pages(1), apiKey: 'k', fetchImpl, sleep: noSleep });
  assert.equal(r[0].markdown, 'listo');
  assert.equal(n, 3);
});

test('error por página no detiene las demás', async () => {
  const fetchImpl = async (_u, init) => (JSON.parse(init.body).messages[0].content[1].text.includes('Página 2 de') ? err(400, 'bad') : ok('bien'));
  const r = await transcribePages({ pages: pages(3), apiKey: 'k', fetchImpl, sleep: noSleep });
  assert.equal(r[0].markdown, 'bien');
  assert.ok(r[1].error);
  assert.equal(r[2].markdown, 'bien');
});

test('401 es fatal y lanza', async () => {
  await assert.rejects(transcribePages({ pages: pages(4), apiKey: 'k', fetchImpl: async () => err(401), sleep: noSleep }), (e) => e instanceof VisionError && e.fatal);
});

test('sin saldo (400 billing) es fatal', async () => {
  await assert.rejects(transcribePages({ pages: pages(2), apiKey: 'k', fetchImpl: async () => err(400, 'credit balance is too low'), sleep: noSleep }), /saldo/);
});

test('cancelar lanza AbortError', async () => {
  const c = new AbortController();
  const fetchImpl = async () => { c.abort(); return ok('x'); };
  await assert.rejects(transcribePages({ pages: pages(3), apiKey: 'k', fetchImpl, signal: c.signal, sleep: noSleep }), { name: 'AbortError' });
});

test('cleanModelOutput', () => {
  assert.equal(cleanModelOutput(NO_CONTENT), null);
  assert.equal(cleanModelOutput('```markdown\n## A\n```'), '## A');
  assert.match(cleanModelOutput('hola', 'max_tokens'), /se cortó/);
});

test('la respuesta de red caída reintenta y termina como error de página', async () => {
  const fetchImpl = async () => { throw new TypeError('fail'); };
  const r = await transcribePages({ pages: pages(1), apiKey: 'k', fetchImpl, sleep: noSleep });
  assert.match(r[0].error, /conectar/);
});
