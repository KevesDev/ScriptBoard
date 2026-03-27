import { contours as contoursFactory } from 'd3-contour';
import type { Layer, BrushConfig } from '@common/models';
import { renderBrushStrokeToContext } from '../engine/BrushEngine';

/** Downscale factor for flood + marching squares (full grid is too slow at 1920×1080). */
export const VECTOR_BUCKET_WORK_SCALE = 4;

function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (result) {
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
      a: 255,
    };
  }
  return { r: 0, g: 0, b: 0, a: 255 };
}

function renderVectorLayerToCanvas(
  layer: Layer,
  cw: number,
  ch: number,
  getBrushConfig: (presetId?: string) => BrushConfig,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.clearRect(0, 0, cw, ch);
  for (const stroke of layer.strokes || []) {
    const cfg = stroke.brushConfig || getBrushConfig(stroke.preset);
    renderBrushStrokeToContext(ctx, stroke, cfg);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

/**
 * Flood fill on RGBA imageData; writes 1 into `mask` for filled pixels (row-major: y * fw + x).
 * `sameColorAsFillAbortRaster` when true: if start pixel already equals fill color (opaque), abort (raster-style).
 */
function floodFillToMask(
  data: Uint8ClampedArray,
  fw: number,
  fh: number,
  startX: number,
  startY: number,
  fillRgb: { r: number; g: number; b: number; a: number },
  mask: Uint8Array,
  sameColorAsFillAbort: boolean,
): boolean {
  if (startX < 0 || startX >= fw || startY < 0 || startY >= fh) return false;

  const startPos = (startY * fw + startX) * 4;
  const startR = data[startPos];
  const startG = data[startPos + 1];
  const startB = data[startPos + 2];
  const startA = data[startPos + 3];

  if (
    sameColorAsFillAbort &&
    startR === fillRgb.r &&
    startG === fillRgb.g &&
    startB === fillRgb.b &&
    startA === fillRgb.a
  ) {
    return false;
  }

  const tolerance = 32;
  const matchColor = (pos: number) => {
    const r = data[pos];
    const g = data[pos + 1];
    const b = data[pos + 2];
    const a = data[pos + 3];
    return (
      Math.abs(r - startR) <= tolerance &&
      Math.abs(g - startG) <= tolerance &&
      Math.abs(b - startB) <= tolerance &&
      Math.abs(a - startA) <= tolerance
    );
  };

  const visited = new Uint8Array(fw * fh);
  const pixelStack: number[] = [startX, startY];
  let any = false;

  while (pixelStack.length > 0) {
    let py = pixelStack.pop()!;
    let px = pixelStack.pop()!;
    let pos = (py * fw + px) * 4;
    let idx = py * fw + px;

    if (visited[idx]) continue;

    while (py >= 0 && matchColor(pos)) {
      py--;
      pos -= fw * 4;
    }
    pos += fw * 4;
    py++;

    let reachLeft = false;
    let reachRight = false;

    while (py < fh && matchColor(pos)) {
      idx = py * fw + px;
      if (visited[idx]) break;
      visited[idx] = 1;
      mask[idx] = 1;
      any = true;

      if (px > 0) {
        if (matchColor(pos - 4)) {
          if (!reachLeft) {
            pixelStack.push(px - 1, py);
            reachLeft = true;
          }
        } else if (reachLeft) {
          reachLeft = false;
        }
      }

      if (px < fw - 1) {
        if (matchColor(pos + 4)) {
          if (!reachRight) {
            pixelStack.push(px + 1, py);
            reachRight = true;
          }
        } else if (reachRight) {
          reachRight = false;
        }
      }

      py++;
      pos += fw * 4;
    }
  }

  return any;
}

function contoursToFillPaths(
  mask: Uint8Array,
  fw: number,
  fh: number,
  scaleX: number,
  scaleY: number,
): number[][] {
  const contourGen = contoursFactory().size([fw, fh]).thresholds([0.5]).smooth(false);
  const multi = contourGen(mask as unknown as number[]);
  const fillPaths: number[][] = [];

  for (const contour of multi) {
    if (!contour.coordinates) continue;
    for (const polygon of contour.coordinates) {
      for (const ring of polygon) {
        const flatRing: number[] = [];
        for (const point of ring) {
          flatRing.push(point[0] * scaleX, point[1] * scaleY);
        }
        if (flatRing.length >= 6) {
          fillPaths.push(flatRing);
        }
      }
    }
  }
  return fillPaths;
}

/**
 * Paint-bucket fill for a **vector** layer: rasterizes that layer only (2D, same as export),
 * flood-fills at the click in a downscaled buffer, then converts the region to vector paths in board space.
 */
export function computeVectorBucketFillPaths(
  layer: Layer,
  clickX: number,
  clickY: number,
  fillHex: string,
  canvasW: number,
  canvasH: number,
  getBrushConfig: (presetId?: string) => BrushConfig,
  workScale: number = VECTOR_BUCKET_WORK_SCALE,
): number[][] | null {
  if (layer.type !== 'vector') return null;

  const full = renderVectorLayerToCanvas(layer, canvasW, canvasH, getBrushConfig);
  const workW = Math.max(1, Math.round(canvasW / workScale));
  const workH = Math.max(1, Math.round(canvasH / workScale));

  const work = document.createElement('canvas');
  work.width = workW;
  work.height = workH;
  const wctx = work.getContext('2d');
  if (!wctx) return null;
  wctx.drawImage(full, 0, 0, workW, workH);

  const imgData = wctx.getImageData(0, 0, workW, workH);
  const data = imgData.data;

  const wx = Math.floor((clickX * workW) / canvasW);
  const wy = Math.floor((clickY * workH) / canvasH);

  const fillRgb = hexToRgb(fillHex);
  const mask = new Uint8Array(workW * workH);

  const filled = floodFillToMask(data, workW, workH, wx, wy, fillRgb, mask, false);
  if (!filled) return null;

  const scaleX = canvasW / workW;
  const scaleY = canvasH / workH;
  const paths = contoursToFillPaths(mask, workW, workH, scaleX, scaleY);
  return paths.length > 0 ? paths : null;
}

/**
 * Raster layer: sample the **composite** board (what the user sees), flood at reduced resolution, then paint full-res pixels.
 * Avoids ~2M-pixel scanline stacks + keeps bucket responsive.
 */
export function applyRasterBucketFromCompositeCanvas(
  compositeCanvas: HTMLCanvasElement,
  clickX: number,
  clickY: number,
  fillHex: string,
  canvasW: number,
  canvasH: number,
  workScale: number = VECTOR_BUCKET_WORK_SCALE,
): string | null {
  const full = document.createElement('canvas');
  full.width = canvasW;
  full.height = canvasH;
  const fctx = full.getContext('2d');
  if (!fctx) return null;
  fctx.drawImage(compositeCanvas, 0, 0, canvasW, canvasH);
  const fullData = fctx.getImageData(0, 0, canvasW, canvasH);

  const workW = Math.max(1, Math.round(canvasW / workScale));
  const workH = Math.max(1, Math.round(canvasH / workScale));
  const work = document.createElement('canvas');
  work.width = workW;
  work.height = workH;
  const wctx = work.getContext('2d');
  if (!wctx) return null;
  wctx.drawImage(full, 0, 0, workW, workH);
  const small = wctx.getImageData(0, 0, workW, workH);

  const wx = Math.floor((clickX * workW) / canvasW);
  const wy = Math.floor((clickY * workH) / canvasH);
  const fillRgb = hexToRgb(fillHex);
  const mask = new Uint8Array(workW * workH);

  const filled = floodFillToMask(small.data, workW, workH, wx, wy, fillRgb, mask, true);
  if (!filled) return null;

  const d = fullData.data;
  for (let fy = 0; fy < canvasH; fy++) {
    const wy2 = Math.min(workH - 1, Math.floor((fy * workH) / canvasH));
    const row = fy * canvasW;
    for (let fx = 0; fx < canvasW; fx++) {
      const wx2 = Math.min(workW - 1, Math.floor((fx * workW) / canvasW));
      if (mask[wy2 * workW + wx2] === 0) continue;
      const i = (row + fx) * 4;
      d[i] = fillRgb.r;
      d[i + 1] = fillRgb.g;
      d[i + 2] = fillRgb.b;
      d[i + 3] = fillRgb.a;
    }
  }

  fctx.putImageData(fullData, 0, 0);
  return full.toDataURL('image/png');
}
