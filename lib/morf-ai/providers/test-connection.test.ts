// Morf AI — Test de conexión real (Fase 2): URL/payload builders y llamada HTTP.
// Se usa un servidor HTTP local para no depender de red externa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildMorfAiTestPayload, buildMorfAiTestUrl, testMorfAiProviderConnection, MorfTestConnectionError } from './test-connection';

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

test('buildMorfAiTestUrl: openai-compatible apunta a /chat/completions', () => {
  assert.equal(buildMorfAiTestUrl('openai-compatible', 'https://api.deepseek.com/v1/', 'deepseek-chat'), 'https://api.deepseek.com/v1/chat/completions');
});

test('buildMorfAiTestUrl: gemini apunta a :generateContent', () => {
  assert.equal(buildMorfAiTestUrl('gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.0-flash'), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
});

test('buildMorfAiTestPayload: openai-compatible incluye model, messages y max_tokens', () => {
  const payload = buildMorfAiTestPayload('openai-compatible', 'deepseek-chat') as { model: string; messages: { role: string; content: string }[]; max_tokens: number };
  assert.equal(payload.model, 'deepseek-chat');
  assert.equal(payload.messages[0].content, 'ping');
  assert.equal(payload.max_tokens, 1);
});

test('buildMorfAiTestPayload: gemini usa contents/parts', () => {
  const payload = buildMorfAiTestPayload('gemini', 'gemini-2.0-flash') as { contents: { role: string; parts: { text: string }[] }[] };
  assert.deepEqual(payload.contents, [{ role: 'user', parts: [{ text: 'ping' }] }]);
});

test('testMorfAiProviderConnection: happy path openai-compatible con Bearer', async () => {
  let seenUrl = '';
  let seenAuth = '';
  let seenBody: any = null;
  const server = await startServer((req, res, body) => {
    seenUrl = req.url || '';
    seenAuth = String(req.headers['authorization'] || '');
    seenBody = JSON.parse(body || '{}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'chatcmpl-test' }));
  });

  try {
    const result = await testMorfAiProviderConnection({ kind: 'openai-compatible', baseUrl: server.url, model: 'deepseek-chat', apiKey: 'sk-test-123', timeoutMs: 3000 });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.match(result.message, /HTTP 200/);
    assert.equal(seenUrl, '/chat/completions');
    assert.equal(seenAuth, 'Bearer sk-test-123');
    assert.equal(seenBody.model, 'deepseek-chat');
  } finally {
    await server.close();
  }
});

test('testMorfAiProviderConnection: gemini usa x-goog-api-key y payload contents', async () => {
  let seenUrl = '';
  let seenKey = '';
  let seenBody: any = null;
  const server = await startServer((req, res, body) => {
    seenUrl = req.url || '';
    seenKey = String(req.headers['x-goog-api-key'] || '');
    seenBody = JSON.parse(body || '{}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pong' }] } }] }));
  });

  try {
    const result = await testMorfAiProviderConnection({ kind: 'gemini', baseUrl: server.url, model: 'gemini-2.0-flash', apiKey: 'AIza-test', timeoutMs: 3000 });
    assert.equal(result.ok, true);
    assert.match(seenUrl, /:generateContent$/);
    assert.equal(seenKey, 'AIza-test');
    assert.ok(seenBody.contents);
  } finally {
    await server.close();
  }
});

test('testMorfAiProviderConnection: HTTP 401 devuelve ok=false con el detalle', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
  });

  try {
    const result = await testMorfAiProviderConnection({ kind: 'openai-compatible', baseUrl: server.url, model: 'deepseek-chat', apiKey: 'sk-bad', timeoutMs: 3000 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.message, /401/);
    assert.match(result.message, /Invalid API key/);
  } finally {
    await server.close();
  }
});

test('testMorfAiProviderConnection: timeout devuelve ok=false sin colgar', async () => {
  const server = await startServer((req, res) => {
    // Nunca responde.
    setTimeout(() => { res.writeHead(200); res.end(); }, 2000);
  });

  try {
    const result = await testMorfAiProviderConnection({ kind: 'openai-compatible', baseUrl: server.url, model: 'deepseek-chat', apiKey: 'sk-test', timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.match(result.message, /tiempo de espera agotado/);
  } finally {
    await server.close();
  }
});

test('testMorfAiProviderConnection: input inválido lanza MorfTestConnectionError', async () => {
  await assert.rejects(
    () => testMorfAiProviderConnection({ kind: 'openai-compatible', baseUrl: 'no-es-url', model: 'm', apiKey: 'k' }),
    (error: any) => error instanceof MorfTestConnectionError && error.code === 'invalid_base_url',
  );
  await assert.rejects(
    () => testMorfAiProviderConnection({ kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: '', apiKey: 'k' }),
    (error: any) => error instanceof MorfTestConnectionError && error.code === 'missing_model',
  );
  await assert.rejects(
    () => testMorfAiProviderConnection({ kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: '' }),
    (error: any) => error instanceof MorfTestConnectionError && error.code === 'missing_api_key',
  );
});

test('testMorfAiProviderConnection: mensajes con datos tipo secreto quedan saneados', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(500);
    res.end('boom sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890');
  });

  try {
    const result = await testMorfAiProviderConnection({ kind: 'openai-compatible', baseUrl: server.url, model: 'm', apiKey: 'sk-test', timeoutMs: 3000 });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /sk-or-v1-abcdef/);
  } finally {
    await server.close();
  }
});
