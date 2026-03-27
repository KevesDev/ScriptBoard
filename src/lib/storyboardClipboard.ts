import type { Stroke } from '@common/models';

export const STORYBOARD_CLIPBOARD_STORAGE_KEY = 'scriptboard_clipboard';

export type StoryboardClipboardPayloadV1 = {
  version: 1;
  strokes: Stroke[];
};

export function strokeBounds(stroke: Stroke): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let any = false;

  for (let j = 0; j < stroke.points.length; j += 3) {
    any = true;
    minX = Math.min(minX, stroke.points[j]!);
    maxX = Math.max(maxX, stroke.points[j]!);
    minY = Math.min(minY, stroke.points[j + 1]!);
    maxY = Math.max(maxY, stroke.points[j + 1]!);
  }

  if (stroke.fillPaths) {
    for (const ring of stroke.fillPaths) {
      for (let k = 0; k < ring.length; k += 2) {
        any = true;
        minX = Math.min(minX, ring[k]!);
        maxX = Math.max(maxX, ring[k]!);
        minY = Math.min(minY, ring[k + 1]!);
        maxY = Math.max(maxY, ring[k + 1]!);
      }
    }
  }

  if (!any) return null;
  return { minX, maxX, minY, maxY };
}

/** True if any stroke vertex lies inside the axis-aligned rectangle (marquee selection). */
export function strokeAnyPointInRect(
  stroke: Stroke,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): boolean {
  for (let j = 0; j < stroke.points.length; j += 3) {
    const px = stroke.points[j]!;
    const py = stroke.points[j + 1]!;
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) return true;
  }
  if (stroke.fillPaths) {
    for (const ring of stroke.fillPaths) {
      for (let k = 0; k < ring.length; k += 2) {
        const px = ring[k]!;
        const py = ring[k + 1]!;
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) return true;
      }
    }
  }
  return false;
}

export function cloneStrokesDeep(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    points: [...s.points],
    fillPaths: s.fillPaths?.map((ring) => [...ring]),
    brushConfig: s.brushConfig ? { ...s.brushConfig } : undefined,
  }));
}

export function offsetStrokesBy(strokes: Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((s) => {
    const points = [...s.points];
    for (let i = 0; i < points.length; i += 3) {
      points[i]! += dx;
      points[i + 1]! += dy;
    }
    const fillPaths = s.fillPaths?.map((ring) => {
      const copy = [...ring];
      for (let k = 0; k < copy.length; k += 2) {
        copy[k]! += dx;
        copy[k + 1]! += dy;
      }
      return copy;
    });
    return { ...s, points, fillPaths };
  });
}

export function selectionBoundsFromStrokes(strokes: Stroke[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    const b = strokeBounds(s);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX - 10, y: minY - 10, w: maxX - minX + 20, h: maxY - minY + 20 };
}

export function serializeStoryboardClipboard(strokes: Stroke[]): string {
  const payload: StoryboardClipboardPayloadV1 = { version: 1, strokes: cloneStrokesDeep(strokes) };
  return JSON.stringify(payload);
}

/** Accepts v1 wrapper or legacy raw `Stroke[]` JSON. */
export function parseStoryboardClipboard(json: string): Stroke[] | null {
  try {
    const data = JSON.parse(json) as unknown;
    if (Array.isArray(data)) {
      if (data.length === 0) return [];
      return cloneStrokesDeep(data as Stroke[]);
    }
    if (
      data &&
      typeof data === 'object' &&
      (data as StoryboardClipboardPayloadV1).version === 1 &&
      Array.isArray((data as StoryboardClipboardPayloadV1).strokes)
    ) {
      return cloneStrokesDeep((data as StoryboardClipboardPayloadV1).strokes);
    }
    return null;
  } catch {
    return null;
  }
}
