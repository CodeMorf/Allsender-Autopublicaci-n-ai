// Morf AI — Fase 3: tests de adapters (body builders, parsers, llamada real).
// Ejecución: npx --no-install tsx --test lib/morf-ai/runtime/*.test.ts
// Usa servidor HTTP local para no depender de red externa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { MorfProviderConfig } from '../providers/types';
import {
  MorfAdapterError,
  buildMorfGeminiBody,
  buildMorfOpenAiBody,
  callMorfAdapter,
  mapMorfMessagesToGemini,
  parseMorfGeminiResponse,
  parseMorfOpenAiResponse,
} from './adapters';
import type { MorfChatMessage, MorfRequest } from './types';

function config(overrides: Partial<MorfProviderConfig> = {}): MorfProviderConfig {
  return {
    code: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: 'sk-test-123',
    capabilities: ['text', 'structured_output', 'tool_calling', 'classification'],
    ready: true,
    status: 'ready',
    ...overrides,
  };
}

function request(overrides: Partial<MorfRequest> = {}): MorfRequest {
  return {
    teamId: 1,
    moduleCode: 'sales_ai',
    capability: 'tool_calling',
    messages: [{ role: 'user', content: 'hola' }],
    ...overrides,
  };
}

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

// --- Body builders ------------------------------------------------------------

test('ADP-001: buildMorfOpenAiBody pasa model/messages y agrega tools/response_format', () => {
  const body = buildMorfOpenAiBody(
    request({ tools: [{ type: 'function', function: { name: 'buscar', parameters: {} } }], responseFormat: { type: 'json_object' } }),
    'deepseek-chat',
  );
  assert.equal(body.model, 'deepseek-chat');
  assert.equal((body.messages as MorfChatMessage[])[0].content, 'hola');
  assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'buscar', parameters: {} } }]);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('ADP-002: buildMorfOpenAiBody sin tools ni response_format no agrega claves vacías', () => {
  const body = buildMorfOpenAiBody(request(), 'deepseek-chat');
  assert.deepEqual(Object.keys(body).sort(), ['messages', 'model']);
});

test('ADP-003: mapMorfMessagesToGemini separa system y mapea roles', () => {
  const messages: MorfChatMessage[] = [
    { role: 'system', content: 'Eres un agente' },
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'ok' },
  ];
  const { system, contents } = mapMorfMessagesToGemini(messages);
  assert.equal(system, 'Eres un agente');
  assert.equal((contents as any[])[0].role, 'user');
  assert.equal((contents as any[])[1].role, 'model');
});

test('ADP-004: mapMorfMessagesToGemini convierte tool_calls y tool results', () => {
  const messages: MorfChatMessage[] = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', function: { name: 'buscar', arguments: '{"q":"zapato"}' } }],
    },
    { role: 'tool', tool_call_id: 'call_1', name: 'buscar', content: '{"ok":true}' },
  ];
  const { contents } = mapMorfMessagesToGemini(messages);
  const modelParts = (contents as any[])[0].parts;
  assert.deepEqual(modelParts[0].functionCall, { name: 'buscar', args: { q: 'zapato' } });
  const functionParts = (contents as any[])[1].parts;
  assert.deepEqual(functionParts[0].functionResponse, { name: 'buscar', response: { ok: true } });
});

test('ADP-005: buildMorfGeminiBody incluye systemInstruction, tools y JSON schema', () => {
  const body = buildMorfGeminiBody(
    request({
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hola' }],
      tools: [{ type: 'function', function: { name: 'buscar', description: 'd', parameters: { type: 'object' } } }],
      responseFormat: { type: 'json_schema', json_schema: { name: 'resp' } },
    }),
    'gemini-2.0-flash',
  );
  assert.deepEqual((body.systemInstruction as any).parts, [{ text: 'sys' }]);
  assert.deepEqual((body.tools as any)[0].functionDeclarations, [
    { name: 'buscar', description: 'd', parameters: { type: 'object' } },
  ]);
  assert.equal((body.generationConfig as any).responseMimeType, 'application/json');
  assert.deepEqual((body.generationConfig as any).responseSchema, { name: 'resp' });
});

test('ADP-006: mapMorfMessagesToGemini mapea contenido multimodal (vision) y omite imágenes en Gemini', () => {
  const messages: MorfChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Lee este comprobante' },
        { type: 'image_url', image_url: { url: 'https://cdn.example.com/proof.jpg', detail: 'high' } },
      ],
    },
  ];
  const { contents } = mapMorfMessagesToGemini(messages);
  const parts = (contents as any[])[0].parts;
  assert.deepEqual(parts, [{ text: 'Lee este comprobante' }]);
});

test('ADP-007: buildMorfOpenAiBody pasa contenido multimodal directo a providers openai-compatibles', () => {
  const messages: MorfChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Lee este comprobante' },
        { type: 'image_url', image_url: { url: 'https://cdn.example.com/proof.jpg', detail: 'high' } },
      ],
    },
  ];
  const body = buildMorfOpenAiBody(request({ messages }), 'gpt-4o-mini');
  assert.deepEqual((body.messages as MorfChatMessage[])[0].content, messages[0].content);
});

// --- Parsers ------------------------------------------------------------------

test('ADP-010: parseMorfOpenAiResponse extrae texto, toolCalls y usage', () => {
  const parsed = parseMorfOpenAiResponse({
    model: 'deepseek-chat',
    choices: [
      {
        message: {
          content: 'te llamo',
          tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'buscar', arguments: '{"q":"x"}' } }],
        },
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  });
  assert.equal(parsed.text, 'te llamo');
  assert.equal(parsed.toolCalls[0].name, 'buscar');
  assert.deepEqual(parsed.toolCalls[0].arguments, { q: 'x' });
  assert.deepEqual(parsed.usage, { inputTokens: 12, outputTokens: 4 });
  assert.equal(parsed.model, 'deepseek-chat');
});

test('ADP-011: parseMorfOpenAiResponse tolera content null y arguments rotos', () => {
  const parsed = parseMorfOpenAiResponse({
    choices: [{ message: { content: null, tool_calls: [{ function: { name: 'f', arguments: 'no-json' } }] } }],
  });
  assert.equal(parsed.text, null);
  assert.deepEqual(parsed.toolCalls[0].arguments, {});
});

test('ADP-012: parseMorfGeminiResponse une partes y mapea functionCall + usageMetadata', () => {
  const parsed = parseMorfGeminiResponse({
    candidates: [
      {
        content: {
          parts: [{ text: 'a' }, { text: 'b' }, { functionCall: { name: 'buscar', args: { q: 'y' } } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 7 },
  });
  assert.equal(parsed.text, 'a\nb');
  assert.equal(parsed.toolCalls[0].name, 'buscar');
  assert.deepEqual(parsed.usage, { inputTokens: 20, outputTokens: 7 });
});

// --- Llamada real -------------------------------------------------------------

test('ADP-020: callMorfAdapter openai-compatible usa Bearer y parsea la respuesta', async () => {
  let seenUrl = '';
  let seenAuth = '';
  let seenBody: any = null;
  const server = await startServer((req, res, body) => {
    seenUrl = req.url || '';
    seenAuth = String(req.headers['authorization'] || '');
    seenBody = JSON.parse(body || '{}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'deepseek-chat',
        choices: [{ message: { content: 'respuesta' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    );
  });

  try {
    const result = await callMorfAdapter(config({ baseUrl: server.url }), request(), 3000);
    assert.equal(seenUrl, '/chat/completions');
    assert.equal(seenAuth, 'Bearer sk-test-123');
    assert.equal(seenBody.model, 'deepseek-chat');
    assert.equal(result.text, 'respuesta');
    assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 2 });
    assert.equal(result.model, 'deepseek-chat');
  } finally {
    await server.close();
  }
});

test('ADP-021: callMorfAdapter gemini usa x-goog-api-key y URL :generateContent', async () => {
  let seenUrl = '';
  let seenKey = '';
  let seenBody: any = null;
  const server = await startServer((req, res, body) => {
    seenUrl = req.url || '';
    seenKey = String(req.headers['x-goog-api-key'] || '');
    seenBody = JSON.parse(body || '{}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } }));
  });

  try {
    const result = await callMorfAdapter(
      config({ code: 'gemini', baseUrl: server.url, model: 'gemini-2.0-flash', apiKey: 'AIza-test' }),
      request(),
      3000,
    );
    assert.match(seenUrl, /:generateContent$/);
    assert.equal(seenKey, 'AIza-test');
    assert.equal(seenBody.contents[0].role, 'user');
    assert.equal(result.text, 'ok');
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 1 });
  } finally {
    await server.close();
  }
});

test('ADP-022: modelHint sobreescribe el modelo en URL y body', async () => {
  let seenUrl = '';
  let seenBody: any = null;
  const server = await startServer((req, res, body) => {
    seenUrl = req.url || '';
    seenBody = JSON.parse(body || '{}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'x' } }] }));
  });

  try {
    await callMorfAdapter(config({ baseUrl: server.url }), request({ modelHint: 'otro-modelo' }), 3000);
    assert.equal(seenBody.model, 'otro-modelo');
    assert.match(seenUrl, /\/chat\/completions$/);
  } finally {
    await server.close();
  }
});

test('ADP-023: HTTP 401 lanza MorfAdapterError http con mensaje saneado', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid key sk-or-v1-abcdef1234567890' } }));
  });

  try {
    await assert.rejects(
      callMorfAdapter(config({ baseUrl: server.url }), request(), 3000),
      (error: unknown) => {
        assert.ok(error instanceof MorfAdapterError);
        assert.equal((error as MorfAdapterError).code, 'http');
        assert.equal((error as MorfAdapterError).status, 401);
        assert.ok(!/sk-or-v1-abcdef1234567890/.test((error as MorfAdapterError).message));
        assert.ok((error as MorfAdapterError).message.includes('[REDACTED]'));
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test('ADP-024: timeout lanza MorfAdapterError timeout sin colgar', async () => {
  const server = await startServer((_req, _res) => {
    // El servidor nunca responde.
  });

  try {
    await assert.rejects(
      callMorfAdapter(config({ baseUrl: server.url }), request(), 100),
      (error: unknown) => {
        assert.ok(error instanceof MorfAdapterError);
        assert.equal((error as MorfAdapterError).code, 'timeout');
        assert.match((error as MorfAdapterError).message, /tiempo de espera/i);
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test('ADP-025: respuesta no JSON lanza invalid_response', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('no es json');
  });

  try {
    await assert.rejects(
      callMorfAdapter(config({ baseUrl: server.url }), request(), 3000),
      (error: unknown) => {
        assert.ok(error instanceof MorfAdapterError);
        assert.equal((error as MorfAdapterError).code, 'invalid_response');
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test('ADP-026: sin modelo lanza invalid_config antes de hacer fetch', async () => {
  await assert.rejects(
    callMorfAdapter(config({ model: '' }), request(), 3000),
    (error: unknown) => {
      assert.ok(error instanceof MorfAdapterError);
      assert.equal((error as MorfAdapterError).code, 'invalid_config');
      return true;
    },
  );
});
