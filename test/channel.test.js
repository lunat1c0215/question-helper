import test from 'node:test';
import assert from 'node:assert/strict';

import { createChannelSplitter } from '../src/shared/channel.js';

function run(chunks) {
  const splitter = createChannelSplitter();
  const out = [];
  for (const chunk of chunks) out.push(...splitter.push(chunk));
  out.push(...splitter.end());
  return out;
}

test('splits answer and explanation from one chunk', () => {
  assert.deepEqual(run(['【答案】A【解析】因为']), [
    { channel: 'answer', text: 'A' },
    { channel: 'explanation', text: '因为' },
  ]);
});

test('streams the answer before the explanation marker arrives', () => {
  assert.deepEqual(run(['【答案】A', 'B【解', '析】C']), [
    { channel: 'answer', text: 'A' },
    { channel: 'answer', text: 'B' },
    { channel: 'explanation', text: 'C' },
  ]);
});

test('keeps a partial answer marker buffered across chunks', () => {
  const splitter = createChannelSplitter();
  assert.deepEqual(splitter.push('【答'), []);
  assert.deepEqual(splitter.push('案】X'), [{ channel: 'answer', text: 'X' }]);
});

test('drops preamble before the answer marker', () => {
  assert.deepEqual(run(['好的，答案：42']), [{ channel: 'answer', text: '42' }]);
});

test('treats marker-free output as the answer', () => {
  assert.deepEqual(run(['just text']), [{ channel: 'answer', text: 'just text' }]);
});

test('supports the bracket marker variants', () => {
  assert.deepEqual(run(['[答案] B [详解] 说明']), [
    { channel: 'answer', text: 'B ' },
    { channel: 'explanation', text: '说明' },
  ]);
});

test('flushes the trailing explanation buffer', () => {
  const splitter = createChannelSplitter();
  assert.deepEqual(splitter.push('【答案】1【解析】abc'), [
    { channel: 'answer', text: '1' },
    { channel: 'explanation', text: 'abc' },
  ]);
  assert.deepEqual(splitter.end(), []);
});

test('drops the newline that follows each marker', () => {
  assert.deepEqual(run(['【答案】\nA\n【解析】\nB']), [
    { channel: 'answer', text: 'A\n' },
    { channel: 'explanation', text: 'B' },
  ]);
});
