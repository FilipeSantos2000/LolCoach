const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoreBounds, resizeFrom, defaultBounds, MIN_SIZE } = require('../src/bounds');

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };

test('restores saved bounds that are still on a screen', () => {
  const saved = { x: 2000, y: 100, width: 400, height: 500 };
  assert.deepEqual(restoreBounds(saved, [primary, second], primary), saved);
});

test('falls back to default when the screen is gone or data is bad', () => {
  const onSecond = { x: 3000, y: 100, width: 400, height: 500 };
  assert.deepEqual(restoreBounds(onSecond, [primary], primary), defaultBounds(primary));
  assert.deepEqual(restoreBounds(null, [primary], primary), defaultBounds(primary));
  assert.deepEqual(restoreBounds({ x: 'a' }, [primary], primary), defaultBounds(primary));
});

test('keeps partly off-screen windows if enough is visible', () => {
  const saved = { x: 1800, y: 100, width: 320, height: 460 }; // 120px visible
  assert.deepEqual(restoreBounds(saved, [primary], primary), saved);
  const hidden = { x: 1890, y: 100, width: 320, height: 460 }; // 30px visible
  assert.deepEqual(restoreBounds(hidden, [primary], primary), defaultBounds(primary));
});

test('enforces minimum size', () => {
  const tiny = restoreBounds({ x: 10, y: 10, width: 50, height: 50 }, [primary], primary);
  assert.equal(tiny.width, MIN_SIZE.width);
  assert.equal(tiny.height, MIN_SIZE.height);

  const start = { x: 10, y: 20, width: 320, height: 460 };
  assert.deepEqual(resizeFrom(start, 80, -60), { x: 10, y: 20, width: 400, height: 400 });
  assert.deepEqual(resizeFrom(start, -1000, -1000), { x: 10, y: 20, ...MIN_SIZE });
});
