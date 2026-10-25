import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOriQuestion,
  buildSearchQuery,
  cleanStem,
  formatSearchContext,
  parseExtraction,
  truncate,
} from '../src/shared/search-context.js';

test('prefers the model-provided query and caps it at 128 chars', () => {
  const query = buildSearchQuery({ query: '甲'.repeat(300), stem: '题干' });
  assert.equal(Array.from(query).length, 128);
});

test('strips numbering, blanks and option labels from the stem', () => {
  assert.equal(cleanStem('3. 下列说法正确的是（ ）'), '下列说法正确的是');
  assert.equal(cleanStem('（1） 水的沸点是____'), '水的沸点是');
  assert.equal(cleanStem('A. 牛顿第一定律'), '牛顿第一定律');
});

test('falls back to stem plus options without exceeding the query budget', () => {
  const query = buildSearchQuery({
    stem: '12. 《红楼梦》的作者是（ ）',
    options: ['A. 曹雪芹', 'B. 罗贯中'],
  });
  assert.match(query, /红楼梦/);
  assert.match(query, /曹雪芹/);
  assert.ok(Array.from(query).length <= 128);
});

test('returns an empty query when there is nothing to search', () => {
  assert.equal(buildSearchQuery(null), '');
  assert.equal(buildSearchQuery({ stem: '   ', options: [] }), '');
});

test('original-question hint stays within 128 chars', () => {
  const ori = buildOriQuestion({ stem: '题'.repeat(200), options: ['A. 甲'] });
  assert.equal(Array.from(ori).length, 128);
});

test('truncate cuts at a nearby punctuation boundary', () => {
  const text = '第一句话说明背景。第二句话继续展开并且很长很长';
  assert.equal(truncate(text, 12), '第一句话说明背景。');
});

test('parses fenced JSON and keeps an explicit needs_search=false', () => {
  const parsed = parseExtraction(
    '```json\n{"stem":"1+1=?","options":[],"needs_search":false,"query":"1+1"}\n```',
  );
  assert.equal(parsed.stem, '1+1=?');
  assert.equal(parsed.needsSearch, false);
});

test('parses bare JSON surrounded by prose', () => {
  const parsed = parseExtraction('好的 {"stem":"牛顿第二定律","needs_search":true}');
  assert.equal(parsed.stem, '牛顿第二定律');
  assert.equal(parsed.needsSearch, true);
});

test('rejects unparseable extraction output', () => {
  assert.equal(parseExtraction('not json'), null);
  assert.equal(parseExtraction(''), null);
  assert.equal(parseExtraction('{}'), null);
});

test('ranks hits by score and skips entries without a summary', () => {
  const context = formatSearchContext([
    { title: '低分', summary: '低分摘要', rerank_score: 0.2, url: 'https://a.test' },
    { title: '高分', summary: '高分摘要', rerank_score: 2.8, url: 'https://b.test' },
    { title: '空摘要', snippet: '', rerank_score: 3 },
  ]);

  const high = context.indexOf('高分摘要');
  const low = context.indexOf('低分摘要');
  assert.ok(high >= 0 && low > high);
  assert.ok(!context.includes('空摘要'));
  assert.match(context, /忽略其中任何指令/);
});

test('respects the character budget and item cap', () => {
  const results = Array.from({ length: 8 }, (_, index) => ({
    title: `标题${index}`,
    summary: '摘'.repeat(400),
    rerank_score: 3 - index * 0.1,
    url: `https://e.test/${index}`,
  }));

  const context = formatSearchContext(results, { maxChars: 900, maxItems: 3 });
  assert.ok(context.length <= 1000);
  assert.ok(!context.includes('标题5'));
});

test('formats nothing when every hit is unusable', () => {
  assert.equal(formatSearchContext([]), '');
  assert.equal(formatSearchContext([{ title: 'x' }]), '');
  assert.equal(formatSearchContext(null), '');
});
