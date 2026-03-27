import { ColorMatrixFilter, type ColorMatrix } from '@pixi/filter-color-matrix';

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '#888888').replace('#', '').trim();
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6) return { r: 1, g: 0.4, b: 0.4 };
  const v = parseInt(h, 16);
  if (!Number.isFinite(v)) return { r: 1, g: 0.4, b: 0.4 };
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

/** Color-matrix tint (diagonal rgb) × alpha on source alpha. */
export function onionTintMatrix(hex: string, opacity: number): number[] {
  const { r, g, b } = hexToRgb01(hex);
  const a = Math.max(0, Math.min(1, opacity));
  return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, a, 0];
}

export function makeOnionTintFilter(hex: string, opacity: number): ColorMatrixFilter {
  const f = new ColorMatrixFilter();
  f.matrix = onionTintMatrix(hex, opacity) as ColorMatrix;
  return f;
}
