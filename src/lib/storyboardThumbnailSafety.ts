import type { Layer } from '@common/models';

/** True if any visible layer should produce non-empty pixels when rendered. */
export function panelLayersHaveDrawableContent(layers: Layer[] | undefined): boolean {
  if (!layers?.length) return false;
  for (const l of layers) {
    if (!l.visible) continue;
    if (l.type === 'raster' && l.dataBase64 && l.dataBase64.length > 80) return true;
    if (l.type === 'vector' && l.strokes && l.strokes.length > 0) return true;
    // Rare: pixels stored on a vector-shaped layer
    if (l.type === 'vector' && l.dataBase64 && l.dataBase64.length > 80) return true;
  }
  return false;
}

/**
 * Count pixels in a 160×90 storyboard thumbnail that are not “blank paper”
 * (non-transparent and not near-white). Used to avoid saving an empty Pixi capture
 * over a good stored thumbnail while textures are still loading.
 */
export function countInkPixelsInStoryboardThumbnailDataUrl(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 90;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(99999);
        return;
      }
      ctx.drawImage(img, 0, 0);
      let d: ImageData;
      try {
        d = ctx.getImageData(0, 0, 160, 90);
      } catch {
        resolve(99999);
        return;
      }
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        const a = d.data[i + 3]!;
        if (a < 10) continue;
        const r = d.data[i]!;
        const g = d.data[i + 1]!;
        const b = d.data[i + 2]!;
        if (r < 252 || g < 252 || b < 252) n++;
      }
      resolve(n);
    };
    img.onerror = () => resolve(99999);
    img.src = dataUrl;
  });
}
