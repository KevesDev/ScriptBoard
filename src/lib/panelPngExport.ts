import * as PIXI from 'pixi.js';
import type { Layer, BrushConfig } from '@common/models';
import { stripImageDataUrlToRawBase64 } from '@common/imagePayload';
import { renderLayersIntoContainer } from '../engine/pixiStoryboardDraw';

let exportApp: PIXI.Application | null = null;

function getExportApp(width: number, height: number): PIXI.Application {
  if (!exportApp) {
    exportApp = new PIXI.Application({
      width,
      height,
      backgroundColor: 0xffffff,
      backgroundAlpha: 1,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: false,
      hello: false,
    });
  } else if (exportApp.renderer.width !== width || exportApp.renderer.height !== height) {
    exportApp.renderer.resize(width, height);
  }
  return exportApp;
}

/**
 * Rasterizes visible panel layers to a PNG base64 string (no `data:` prefix), for file export.
 */
export async function rasterizePanelLayersToPngBase64(
  layers: Layer[],
  width: number,
  height: number,
  getBrushConfig: (presetId?: string) => BrushConfig,
): Promise<string> {
  const app = getExportApp(width, height);
  const root = new PIXI.Container();
  try {
    renderLayersIntoContainer(root, layers, {
      width,
      height,
      getBrushConfig,
      isActiveSkin: false,
    });
    // Pixi extract defaults to getLocalBounds() → tight crop; fixed region = full canvas (project resolution).
    const fullFrame = new PIXI.Rectangle(0, 0, width, height);
    const fromExtract = await app.renderer.extract.base64(
      root,
      'image/png',
      1,
      fullFrame,
    );
    return stripImageDataUrlToRawBase64(fromExtract);
  } finally {
    root.destroy({ children: true, texture: false, baseTexture: false });
  }
}

/**
 * Stack multiple panel layer sets (back → front) into one full-frame PNG for multi-track export / preview.
 */
export async function rasterizeCompositeStackToPngBase64(
  stacks: Layer[][],
  width: number,
  height: number,
  getBrushConfig: (presetId?: string) => BrushConfig,
): Promise<string> {
  const app = getExportApp(width, height);
  const root = new PIXI.Container();
  try {
    for (const layers of stacks) {
      const sub = new PIXI.Container();
      renderLayersIntoContainer(sub, layers, {
        width,
        height,
        getBrushConfig,
        isActiveSkin: false,
      });
      root.addChild(sub);
    }
    const fullFrame = new PIXI.Rectangle(0, 0, width, height);
    const fromExtract = await app.renderer.extract.base64(root, 'image/png', 1, fullFrame);
    return stripImageDataUrlToRawBase64(fromExtract);
  } finally {
    root.destroy({ children: true, texture: false, baseTexture: false });
  }
}
