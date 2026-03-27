import type { TimelineCameraKeyframe, TimelineLayerKeyframe } from '@common/models';

const DEF_CAM = { panX: 0, panY: 0, zoom: 1, rotationDeg: 0 };
const DEF_LAYER = { offsetX: 0, offsetY: 0, scale: 1, opacityMul: 1 };

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function bracket<T extends { timeSec: number }>(t: number, sorted: T[]): { prev: T | null; next: T | null } {
  if (sorted.length === 0) return { prev: null, next: null };
  if (t <= sorted[0]!.timeSec) return { prev: null, next: sorted[0]! };
  if (t >= sorted[sorted.length - 1]!.timeSec) return { prev: sorted[sorted.length - 1]!, next: null };
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.timeSec <= t) lo = mid;
    else hi = mid;
  }
  return { prev: sorted[lo]!, next: sorted[hi]! };
}

export function sampleCameraAtTime(
  t: number,
  keyframes: TimelineCameraKeyframe[],
): { panX: number; panY: number; zoom: number; rotationDeg: number } {
  const sorted = [...keyframes].sort((a, b) => a.timeSec - b.timeSec);
  const { prev, next } = bracket(t, sorted);
  if (!prev && !next) return { ...DEF_CAM };
  if (!prev && next) return { panX: next.panX, panY: next.panY, zoom: next.zoom, rotationDeg: next.rotationDeg };
  if (prev && !next) return { panX: prev.panX, panY: prev.panY, zoom: prev.zoom, rotationDeg: prev.rotationDeg };
  const p = prev!;
  const n = next!;
  const u = (t - p.timeSec) / Math.max(1e-9, n.timeSec - p.timeSec);
  return {
    panX: lerp(p.panX, n.panX, u),
    panY: lerp(p.panY, n.panY, u),
    zoom: lerp(p.zoom, n.zoom, u),
    rotationDeg: lerp(p.rotationDeg, n.rotationDeg, u),
  };
}

export function sampleLayerAtTime(
  t: number,
  panelId: string | null,
  layerId: string | null,
  keyframes: TimelineLayerKeyframe[],
): { offsetX: number; offsetY: number; scale: number; opacityMul: number } {
  if (!panelId || !layerId) return { ...DEF_LAYER };
  const sorted = keyframes
    .filter((k) => k.panelId === panelId && k.layerId === layerId)
    .sort((a, b) => a.timeSec - b.timeSec);
  const { prev, next } = bracket(t, sorted);
  if (!prev && !next) return { ...DEF_LAYER };
  if (!prev && next) {
    return {
      offsetX: next.offsetX,
      offsetY: next.offsetY,
      scale: next.scale,
      opacityMul: next.opacityMul,
    };
  }
  if (prev && !next) {
    return {
      offsetX: prev.offsetX,
      offsetY: prev.offsetY,
      scale: prev.scale,
      opacityMul: prev.opacityMul,
    };
  }
  const p = prev!;
  const n = next!;
  const u = (t - p.timeSec) / Math.max(1e-9, n.timeSec - p.timeSec);
  return {
    offsetX: lerp(p.offsetX, n.offsetX, u),
    offsetY: lerp(p.offsetY, n.offsetY, u),
    scale: lerp(p.scale, n.scale, u),
    opacityMul: lerp(p.opacityMul, n.opacityMul, u),
  };
}
