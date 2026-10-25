import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyStreamError } from '../src/background/llm.js';

test('explains a truncated stream as a token budget problem', () => {
  const error = emptyStreamError({ finishReason: 'length' });
  assert.equal(error.code, 'BAD_RESPONSE');
  assert.match(error.message, /max_tokens/);
});

test('explains a reasoning-only stream', () => {
  const error = emptyStreamError({ finishReason: 'stop', sawReasoning: true });
  assert.match(error.message, /思考/);
});

test('includes the finish reason when it is known', () => {
  const error = emptyStreamError({ finishReason: 'content_filter' });
  assert.match(error.message, /content_filter/);
});

test('stays generic when nothing is known', () => {
  const error = emptyStreamError({});
  assert.equal(error.message, '模型未返回内容');
});
