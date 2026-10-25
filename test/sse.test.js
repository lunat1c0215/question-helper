import test from 'node:test';
import assert from 'node:assert/strict';

import { createSseParser } from '../src/shared/sse.js';

function collect() {
  const events = [];
  const warnings = [];
  let done = 0;
  const parser = createSseParser({
    onMessage: (payload) => events.push(payload),
    onWarn: (error) => warnings.push(error),
    onDone: () => {
      done += 1;
    },
  });
  return { parser, events, warnings, done: () => done };
}

test('parses an event split across chunks', () => {
  const { parser, events } = collect();
  parser.push('data: {"a":1}\n\ndata: {"a"');
  parser.push(':2}\n\n');
  assert.deepEqual(events, [{ a: 1 }, { a: 2 }]);
});

test('handles CRLF and several events in one chunk', () => {
  const { parser, events } = collect();
  parser.push('data: {"n":1}\r\n\r\ndata: {"n":2}\r\n\r\n');
  assert.deepEqual(events, [{ n: 1 }, { n: 2 }]);
});

test('repairs a CRLF pair split across chunks', () => {
  const { parser, events } = collect();
  parser.push('data: {"n":1}\r');
  parser.push('\n\r\ndata: {"n":2}\n\n');
  assert.deepEqual(events, [{ n: 1 }, { n: 2 }]);
});

test('reports a malformed payload without emitting an event', () => {
  const { parser, events, warnings } = collect();
  parser.push('data: not-json\n\n');
  assert.equal(events.length, 0);
  assert.equal(warnings.length, 1);
});

test('ignores comment lines and reports [DONE]', () => {
  const { parser, events, done } = collect();
  parser.push(': keep-alive\n\ndata: [DONE]\n\n');
  assert.equal(events.length, 0);
  assert.equal(done(), 1);
});

test('flushes a trailing event without a blank line', () => {
  const { parser, events } = collect();
  parser.push('data: {"tail":true}');
  parser.flush();
  assert.deepEqual(events, [{ tail: true }]);
});

test('propagates errors thrown by the message handler', () => {
  const parser = createSseParser({
    onMessage() {
      throw new Error('boom');
    },
  });
  assert.throws(() => parser.push('data: {"x":1}\n\n'), /boom/);
});
