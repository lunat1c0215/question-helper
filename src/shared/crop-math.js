/**
 * Maps a viewport-space rectangle onto the screenshot bitmap.
 * The content overlay renders the bitmap at 100vw x 100vh, so viewport
 * dimensions are the correct reference frame even when a scrollbar exists.
 *
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {{ width: number, height: number }} viewport
 * @param {{ width: number, height: number }} bitmap
 */
export function computeSourceRect(rect, viewport, bitmap) {
  if (!(viewport.width > 0) || !(viewport.height > 0)) {
    throw new Error('invalid viewport');
  }
  if (!(bitmap.width > 0) || !(bitmap.height > 0)) {
    throw new Error('invalid bitmap');
  }

  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;
  const x = clamp(Math.round(rect.x * scaleX), 0, bitmap.width - 1);
  const y = clamp(Math.round(rect.y * scaleY), 0, bitmap.height - 1);
  const w = clamp(Math.round(rect.w * scaleX), 1, bitmap.width - x);
  const h = clamp(Math.round(rect.h * scaleY), 1, bitmap.height - y);

  return { x, y, w, h };
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} maxSide
 */
export function fitWithin(width, height, maxSide) {
  if (!(maxSide > 0)) throw new Error('invalid maxSide');
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { w: width, h: height, scale: 1 };
  const scale = maxSide / longest;
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
