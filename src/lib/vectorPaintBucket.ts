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

/**
 * Renders the vector layer to an offscreen canvas.
 * @param expandWidth Injecting a thickness modifier here acts as Morphological Dilation to close line gaps.
 */
function renderVectorLayerToCanvas(
  layer: Layer,
  cw: number,
  ch: number,
  getBrushConfig: (presetId?: string) => BrushConfig,
  expandWidth: number = 0
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.clearRect(0, 0, cw, ch);
  
  for (const stroke of layer.strokes || []) {
    const cfg = stroke.brushConfig || getBrushConfig(stroke.preset);
    let s = stroke;
    
    // Artificially thicken lines if gap closing is requested
    if (expandWidth > 0 && stroke.tool !== 'fill') {
      s = { ...stroke, width: stroke.width + expandWidth };
    }
    
    renderBrushStrokeToContext(ctx, s, cfg);
  }
  
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

/**
 * Fast Morphological Dilation of a boolean mask.
 * Used to expand the flood-filled area so it naturally slips under the anti-aliased edges of the original line art.
 */
function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  out.set(mask);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 1) {
        const minY = Math.max(0, y - radius);
        const maxY = Math.min(h - 1, y + radius);
        const minX = Math.max(0, x - radius);
        const maxX = Math.min(w - 1, x + radius);
        
        for (let dy = minY; dy <= maxY; dy++) {
          for (let dx = minX; dx <= maxX; dx++) {
            // Circular bounding check for natural rounded corners
            if ((dx - x) * (dx - x) + (dy - y) * (dy - y) <= radius * radius) {
              out[dy * w + dx] = 1;
            }
          }
        }
      }
    }
  }
  return out;
}

// --- Path Math Pipeline (Simplification, Resampling, Smoothing, Topology) ---

function getSqDist(px: number, py: number, p1x: number, p1y: number, p2x: number, p2y: number) {
  let dx = p2x - p1x;
  let dy = p2y - p1y;
  
  if (dx !== 0 || dy !== 0) {
    const t = ((px - p1x) * dx + (py - p1y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { 
      p1x = p2x; 
      p1y = p2y; 
    } else if (t > 0) { 
      p1x += dx * t; 
      p1y += dy * t; 
    }
  }
  dx = px - p1x; 
  dy = py - p1y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points: number[], first: number, last: number, sqTolerance: number, simplified: number[]) {
  let maxSqDist = sqTolerance;
  let index = -1;
  const p1x = points[first];
  const p1y = points[first + 1];
  const p2x = points[last];
  const p2y = points[last + 1];

  for (let i = first + 2; i < last; i += 2) {
    const d = getSqDist(points[i], points[i + 1], p1x, p1y, p2x, p2y);
    if (d > maxSqDist) {
      index = i;
      maxSqDist = d;
    }
  }

  if (maxSqDist > sqTolerance) {
    if (index - first > 2) {
      simplifyDPStep(points, first, index, sqTolerance, simplified);
    }
    simplified.push(points[index], points[index + 1]);
    if (last - index > 2) {
      simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
  }
}

function simplifyDP(points: number[], tolerance: number): number[] {
  if (points.length <= 4) return points;
  const sqTolerance = tolerance * tolerance;
  const last = points.length - 2;
  const simplified = [points[0], points[1]];
  
  simplifyDPStep(points, 0, last, sqTolerance, simplified);
  simplified.push(points[last], points[last + 1]);
  return simplified;
}

/**
 * Resamples a path to ensure no single line segment is longer than `maxLen`.
 * This prevents Chaikin smoothing from over-chamfering large, straight bounding boxes.
 */
function resamplePath(points: number[], maxLen: number): number[] {
  const resampled: number[] = [];
  const numPts = points.length / 2;
  
  for (let i = 0; i < numPts; i++) {
    const p1x = points[i * 2];
    const p1y = points[i * 2 + 1];
    const p2x = points[((i + 1) % numPts) * 2];
    const p2y = points[((i + 1) % numPts) * 2 + 1];

    resampled.push(p1x, p1y);

    const dx = p2x - p1x;
    const dy = p2y - p1y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > maxLen) {
      const steps = Math.ceil(dist / maxLen);
      for (let j = 1; j < steps; j++) {
        resampled.push(p1x + dx * (j / steps), p1y + dy * (j / steps));
      }
    }
  }
  return resampled;
}

function chaikinSmooth(points: number[], iterations: number = 2): number[] {
  if (points.length < 6) return points;
  let current = points;
  
  for (let i = 0; i < iterations; i++) {
    const next: number[] = [];
    const numPts = current.length / 2;
    
    for (let j = 0; j < numPts; j++) {
      const p1x = current[j * 2];
      const p1y = current[j * 2 + 1];
      const p2x = current[((j + 1) % numPts) * 2];
      const p2y = current[((j + 1) % numPts) * 2 + 1];
      
      next.push(
        0.75 * p1x + 0.25 * p2x, 
        0.75 * p1y + 0.25 * p2y,
        0.25 * p1x + 0.75 * p2x, 
        0.25 * p1y + 0.75 * p2y
      );
    }
    current = next;
  }
  return current;
}

/**
 * Evaluates topological winding order using the Shoelace Theorem (Signed Area).
 */
function getSignedArea(path: number[]): number {
  let area = 0;
  const n = Math.floor(path.length / 2);
  if (n < 3) return 0;
  
  for (let i = 0; i < n; i++) {
    const x1 = path[i * 2];
    const y1 = path[i * 2 + 1];
    const x2 = path[((i + 1) % n) * 2];
    const y2 = path[((i + 1) % n) * 2 + 1];
    area += (x1 * y2 - x2 * y1);
  }
  return area / 2;
}

function reversePath(path: number[]): void {
  const n = Math.floor(path.length / 2);
  for (let i = 0; i < Math.floor(n / 2); i++) {
    const opposite = n - 1 - i;
    
    let tmp = path[i * 2]; 
    path[i * 2] = path[opposite * 2]; 
    path[opposite * 2] = tmp;
    
    tmp = path[i * 2 + 1]; 
    path[i * 2 + 1] = path[opposite * 2 + 1]; 
    path[opposite * 2 + 1] = tmp;
  }
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
      
      // ringIndex 0 is ALWAYS the exterior boundary. ringIndex > 0 are Holes.
      for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
        const ring = polygon[ringIndex];
        const isHole = ringIndex > 0;
        
        const flatRing: number[] = [];
        for (const point of ring) {
          // Project to Canvas Space IMMEDIATELY.
          // This prevents quantized smoothing from creating a magnified gap.
          flatRing.push(point[0] * scaleX, point[1] * scaleY);
        }
        
        if (flatRing.length >= 6) {
          // Canvas-Space Math
          // Simplifying with a 2.0 pixel tolerance ensures it perfectly hugs the line art
          const simplified = simplifyDP(flatRing, 2.0);
          const resampled = resamplePath(simplified, 30); 
          const smoothed = chaikinSmooth(resampled, 2);

          // Enforce Winding Topology for PIXI Renderer (Shoelace Theorem)
          const area = getSignedArea(smoothed);
          if (isHole && area > 0) {
            reversePath(smoothed);   // Force holes to be negative area
          }
          if (!isHole && area < 0) {
            reversePath(smoothed);  // Force exterior to be positive area
          }

          fillPaths.push(smoothed);
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

  // 1. Gap Closing Dilation (Width expansion)
  const GAP_CLOSE_EXPAND = 4; 
  const full = renderVectorLayerToCanvas(layer, canvasW, canvasH, getBrushConfig, GAP_CLOSE_EXPAND);
  
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

  // 2. Flood Fill
  const filled = floodFillToMask(data, workW, workH, wx, wy, fillRgb, mask, false);
  if (!filled) return null;

  // 3. Precise Mask Dilation
  // Increased the mathematical bleed to guarantee it penetrates 
  // the anti-aliased edge of the line art, killing the conflation seam.
  const canvasBleed = (GAP_CLOSE_EXPAND / 2) + 2; 
  const DILATION_RADIUS = Math.ceil(canvasBleed / workScale);
  const dilatedMask = dilateMask(mask, workW, workH, DILATION_RADIUS);

  // 4. Contour Extraction & Vectorization
  const scaleX = canvasW / workW;
  const scaleY = canvasH / workH;
  const paths = contoursToFillPaths(dilatedMask, workW, workH, scaleX, scaleY);
  
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