import test from 'node:test';
import assert from 'node:assert/strict';

import { webSearch } from '../src/background/search.js';

const settings = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  search: { count: 5 },
};

function installFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(calls.length, init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('posts the documented search body to /v1/tools/search', async () => {
  const stub = installFetch(() => jsonResponse({ results: [{ title: 'x' }] }));
  try {
    const results = await webSearch({
      query: '  牛顿第二定律  ',
      oriQuestion: '牛顿第二定律',
      settings,
      signal: new AbortController().signal,
    });

    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, 'https://api.deepseek.com/v1/tools/search');
    const body = JSON.parse(stub.calls[0].init.body);
    assert.deepEqual(body, {
      query: '牛顿第二定律',
      count: 5,
      need_content: false,
      ori_question: '牛顿第二定律',
    });
    assert.match(stub.calls[0].init.headers.Authorization, /^Bearer sk-test$/);
    assert.deepEqual(results, [{ title: 'x' }]);
  } finally {
    stub.restore();
  }
});

test('clamps count to the 1-10 range', async () => {
  const stub = installFetch(() => jsonResponse({ results: [] }));
  try {
    await webSearch({
      query: 'a',
      settings: { ...settings, search: { count: 50 } },
      signal: new AbortController().signal,
    });
    await webSearch({
      query: 'b',
      settings: { ...settings, search: { count: 0 } },
      signal: new AbortController().signal,
    });

    assert.equal(JSON.parse(stub.calls[0].init.body).count, 10);
    assert.equal(JSON.parse(stub.calls[1].init.body).count, 1);
  } finally {
    stub.restore();
  }
});

test('retries once on 429 then succeeds', async () => {
  const stub = installFetch((call) =>
    call === 1 ? jsonResponse({ error: { message: 'slow down' } }, 429) : jsonResponse({ results: [] }),
  );
  try {
    const results = await webSearch({
      query: 'x',
      settings,
      signal: new AbortController().signal,
    });
    assert.equal(stub.calls.length, 2);
    assert.deepEqual(results, []);
  } finally {
    stub.restore();
  }
});

test('does not retry a 402 and explains the balance problem', async () => {
  const stub = installFetch(() => jsonResponse({ error: { message: 'no balance' } }, 402));
  try {
    await assert.rejects(
      webSearch({ query: 'x', settings, signal: new AbortController().signal }),
      (error) => {
        assert.equal(error.code, 'HTTP');
        assert.match(error.message, /余额/);
        return true;
      },
    );
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('returns no results for an empty query without calling the network', async () => {
  const stub = installFetch(() => jsonResponse({ results: [{ title: 'x' }] }));
  try {
    assert.deepEqual(
      await webSearch({ query: '   ', settings, signal: new AbortController().signal }),
      [],
    );
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
