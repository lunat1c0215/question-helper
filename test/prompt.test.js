import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExtractText,
  buildSystemPrompt,
  buildUserText,
  SYSTEM_PROMPT,
} from '../src/shared/prompt.js';

test('multi-choice system prompt demands every correct option', () => {
  const prompt = buildSystemPrompt('multi');
  assert.match(prompt, /多选题/);
  assert.match(prompt, /全部正确选项/);
  assert.match(prompt, /不能只写一个/);
  assert.match(prompt, /【答案】/);
  assert.match(prompt, /【解析】/);
});

test('single-choice prompt stays free of multi-choice instructions', () => {
  assert.doesNotMatch(SYSTEM_PROMPT, /多选题/);
  assert.doesNotMatch(buildSystemPrompt('single'), /多选题/);
});

test('multi-choice user text asks for all correct options', () => {
  assert.match(buildUserText('', '', 'multi'), /多选题/);
  assert.match(buildUserText('', '', 'multi'), /所有正确选项/);
  assert.match(buildUserText('', '', 'single'), /请作答截图中的题目/);
});

test('multi-choice extraction nudges the query to include every option', () => {
  assert.match(buildExtractText('multi'), /全部选项/);
  assert.doesNotMatch(buildExtractText('single'), /全部选项/);
});
