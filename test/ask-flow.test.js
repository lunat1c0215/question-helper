import test from 'node:test';
import assert from 'node:assert/strict';

import { ask } from '../src/background/llm.js';

const settings = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  model: 'deepseek-flash',
  maxTokens: 900,
  search: { enabled: true, count: 5 },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(text) {
  const payload =
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
    'data: [DONE]\n\n';
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const cut = 24;
      controller.enqueue(encoder.encode(payload.slice(0, cut)));
      controller.enqueue(encoder.encode(payload.slice(cut)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function installFetch({ needsSearch = true, searchStatus = 200 } = {}) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: target, body });

    if (target.endsWith('/v1/tools/search')) {
      if (searchStatus !== 200) {
        return jsonResponse({ error: { message: 'no balance' } }, searchStatus);
      }
      return jsonResponse({
        results: [
          {
            title: '参考标题',
            summary: '参考摘要内容',
            rerank_score: 2.4,
            url: 'https://e.test/a',
          },
        ],
      });
    }

    if (body.stream === false) {
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                stem: '1+1=?',
                options: [],
                needs_search: needsSearch,
                query: '1+1',
              }),
            },
          },
        ],
      });
    }

    return sseResponse('【答案】\n42\n【解析】\n因为 1+1=2。');
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function runAsk() {
  const statuses = [];
  const deltas = [];
  await ask({
    imageDataUrl: 'data:image/png;base64,AAAA',
    settings,
    signal: new AbortController().signal,
    onDelta: (delta) => deltas.push(delta),
    onStatus: (text) => statuses.push(text),
  });
  return { statuses, deltas };
}

test('never reports an extraction stage and streams the searched answer', async () => {
  const stub = installFetch();
  try {
    const { statuses, deltas } = await runAsk();

    assert.deepEqual(statuses, ['联网检索…', '作答中…']);
    assert.ok(!statuses.some((text) => text.includes('识别')));

    const answer = deltas
      .filter((delta) => delta.channel === 'answer')
      .map((delta) => delta.text)
      .join('');
    assert.match(answer, /42/);

    const chat = stub.calls.at(-1);
    assert.match(chat.body.messages[1].content[0].text, /参考网页/);
  } finally {
    stub.restore();
  }
});

test('skips the search call when the extractor says no lookup is needed', async () => {
  const stub = installFetch({ needsSearch: false });
  try {
    const { statuses } = await runAsk();

    assert.deepEqual(statuses, ['作答中…']);
    assert.equal(
      stub.calls.filter((call) => call.url.endsWith('/v1/tools/search')).length,
      0,
    );
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('degrades to a plain answer when search is rejected', async () => {
  const stub = installFetch({ searchStatus: 402 });
  try {
    const { statuses, deltas } = await runAsk();

    assert.deepEqual(statuses, ['联网检索…', '检索失败，直接作答']);
    assert.match(
      deltas
        .filter((delta) => delta.channel === 'answer')
        .map((delta) => delta.text)
        .join(''),
      /42/,
    );
    const chat = stub.calls.at(-1);
    assert.ok(!chat.body.messages[1].content[0].text.includes('参考网页'));
  } finally {
    stub.restore();
  }
});
