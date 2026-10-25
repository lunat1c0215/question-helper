import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, normalizeSettings } from '../src/background/settings.js';

test('defaults the selection border to a visible but subtle opacity', () => {
  const settings = normalizeSettings({});
  assert.equal(settings.display.selectionOpacity, 0.4);
  assert.equal(DEFAULT_SETTINGS.display.selectionOpacity, 0.4);
});

test('clamps the selection border opacity to 0-1', () => {
  assert.equal(normalizeSettings({ display: { selectionOpacity: 1.6 } }).display.selectionOpacity, 1);
  assert.equal(normalizeSettings({ display: { selectionOpacity: -2 } }).display.selectionOpacity, 0);
  assert.equal(normalizeSettings({ display: { selectionOpacity: 0 } }).display.selectionOpacity, 0);
});

test('keeps other display settings independent of the border opacity', () => {
  const settings = normalizeSettings({ display: { selectionOpacity: 0.6, opacity: 0.7 } });
  assert.equal(settings.display.selectionOpacity, 0.6);
  assert.equal(settings.display.opacity, 0.7);
});

test('falls back when the border opacity is not a number', () => {
  assert.equal(
    normalizeSettings({ display: { selectionOpacity: 'abc' } }).display.selectionOpacity,
    0.4,
  );
});
