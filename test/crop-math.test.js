import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSourceRect, fitWithin } from '../src/shared/crop-math.js';

test('maps CSS pixels onto a 2x bitmap', () => {
  assert.deepEqual(
    computeSourceRect(
      { x: 100, y: 50, w: 200, h: 100 },
      { width: 1000, height: 800 },
      { width: 2000, height: 1600 },
    ),
    { x: 200, y: 100, w: 400, h: 200 },
  );
});

test('maps a 1.25 browser zoom screenshot', () => {
  assert.deepEqual(
    computeSourceRect(
      { x: 200, y: 100, w: 400, h: 200 },
      { width: 1600, height: 900 },
      { width: 2000, height: 1125 },
    ),
    { x: 250, y: 125, w: 500, h: 250 },
  );
});

test('clamps a region that overflows the bitmap', () => {
  assert.deepEqual(
    computeSourceRect(
      { x: 990, y: 790, w: 100, h: 100 },
      { width: 1000, height: 800 },
      { width: 2000, height: 1600 },
    ),
    { x: 1980, y: 1580, w: 20, h: 20 },
  );
});

test('rejects an empty viewport', () => {
  assert.throws(
    () => computeSourceRect({ x: 0, y: 0, w: 10, h: 10 }, { width: 0, height: 0 }, { width: 10, height: 10 }),
    /invalid viewport/,
  );
});

test('keeps images under the long-side limit', () => {
  assert.deepEqual(fitWithin(400, 200, 1600), { w: 400, h: 200, scale: 1 });
});

test('scales the long side down and preserves the ratio', () => {
  assert.deepEqual(fitWithin(3200, 1600, 1600), { w: 1600, h: 800, scale: 0.5 });
});

test('never produces a zero dimension', () => {
  const result = fitWithin(1, 4000, 1600);
  assert.equal(result.h, 1600);
  assert.ok(result.w >= 1);
});
