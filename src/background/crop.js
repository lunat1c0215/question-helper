import { computeSourceRect, fitWithin } from '../shared/crop-math.js';

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.9;

/**
 * @param {string} shot data URL produced by captureVisibleTab
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {{ width: number, height: number }} viewport
 */
export async function cropToJpeg(shot, rect, viewport, options = {}) {
  const maxSide = options.maxSide ?? MAX_SIDE;
  const quality = options.quality ?? JPEG_QUALITY;

  const bitmap = await createImageBitmap(dataUrlToBlob(shot));
  try {
    const source = computeSourceRect(rect, viewport, {
      width: bitmap.width,
      height: bitmap.height,
    });
    const target = fitWithin(source.w, source.h, maxSide);

    const canvas = new OffscreenCanvas(target.w, target.h);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('OffscreenCanvas 2d context unavailable');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.w,
      source.h,
      0,
      0,
      target.w,
      target.h,
    );

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return {
      dataUrl: await blobToDataUrl(blob),
      bytes: blob.size,
      width: target.w,
      height: target.h,
    };
  } finally {
    bitmap.close?.();
  }
}

/**
 * @param {string} dataUrl
 */
function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('invalid data URL');
  const mime = match[1] || 'image/png';

  if (!match[2]) {
    return new Blob([decodeURIComponent(match[3])], { type: mime });
  }

  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * @param {Blob} blob
 */
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
