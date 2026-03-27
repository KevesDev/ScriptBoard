import * as PIXI from 'pixi.js';
import { getStroke } from 'perfect-freehand';
import { BrushTextureManager, computeBrushStamps } from './BrushEngine';
import type { Stroke, Layer, BrushConfig } from '@common/models';

PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL_LEGACY;
PIXI.settings.SPRITE_MAX_TEXTURES = Math.min(PIXI.settings.SPRITE_MAX_TEXTURES ?? 16, 16);

const noiseTextureCache = new Map<string, PIXI.Texture>();

const getNoiseTexture = (color: string): PIXI.Texture => {
  if (noiseTextureCache.has(color)) {
    return noiseTextureCache.get(color)!;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * 64;
      const y = Math.random() * 64;
      ctx.globalAlpha = Math.random() * 0.5 + 0.1;
      ctx.fillRect(x, y, 1, 1);
      if (Math.random() > 0.8) ctx.fillRect(x, y, 2, 2);
    }
  }
  const texture = PIXI.Texture.from(canvas);
  noiseTextureCache.set(color, texture);
  return texture;
};

const whitePixiTextureCache = new Map<string, PIXI.Texture>();

const getWhitePixiTexture = (config: BrushConfig): PIXI.Texture | null => {
  if (!config.textureBase64) return null;
  if (whitePixiTextureCache.has(config.id)) {
    return whitePixiTextureCache.get(config.id)!;
  }
  const img = BrushTextureManager.getTextureSync(config.textureBase64, config.id);
  if (!img) return null;
  const whiteCanvas = BrushTextureManager.getTintedTexture(img, '#ffffff', config.id);
  const baseTexture = new PIXI.BaseTexture(whiteCanvas);
  const texture = new PIXI.Texture(baseTexture);
  whitePixiTextureCache.set(config.id, texture);
  return texture;
};

export const drawStampsToContainer = (container: PIXI.Container, stroke: Stroke, config: BrushConfig) => {
  if (!config.textureBase64) return;
  const texture = getWhitePixiTexture(config);
  if (!texture) return;
  const stamps = computeBrushStamps(stroke, config);
  const isEraser = stroke.tool === 'eraser';
  const numericColor = isEraser ? 0xffffff : PIXI.utils.string2hex(stroke.color);
  for (const stamp of stamps) {
    const s = new PIXI.Sprite(texture);
    s.anchor.set(0.5);
    s.x = stamp.x;
    s.y = stamp.y;
    s.rotation = stamp.angle;
    s.width = stamp.size;
    s.height = stamp.size;
    s.tint = numericColor;
    s.alpha = stamp.alpha;
    if (isEraser) {
      s.blendMode = PIXI.BLEND_MODES.ERASE;
    }
    container.addChild(s);
  }
};

export const drawStrokeToGraphics = (g: PIXI.Graphics, stroke: Stroke, config: BrushConfig) => {
  if (stroke.tool === 'fill' && stroke.fillPaths) {
    g.beginFill(PIXI.utils.string2hex(stroke.color), config.flow ?? 1.0);
    for (const path of stroke.fillPaths) {
      if (path.length >= 2) {
        g.moveTo(path[0], path[1]);
        for (let i = 2; i < path.length; i += 2) {
          g.lineTo(path[i], path[i + 1]);
        }
      }
    }
    g.endFill();
    return;
  }

  const isEraser = stroke.tool === 'eraser';
  const color = isEraser ? 0xffffff : PIXI.utils.string2hex(stroke.color);
  const alpha = config.flow ?? 1.0;

  // SHAPE BYPASS: Ensure absolute bounds so PIXI never drops negative shapes
  if (['line', 'rectangle', 'ellipse'].includes(stroke.tool)) {
    if (stroke.points.length < 6) return;
    const startX = stroke.points[0];
    const startY = stroke.points[1];
    const endX = stroke.points[stroke.points.length - 3];
    const endY = stroke.points[stroke.points.length - 2];

    g.lineStyle({
      width: stroke.width,
      color: color,
      alpha: alpha,
      cap: PIXI.LINE_CAP.ROUND,
      join: PIXI.LINE_JOIN.ROUND,
    });

    if (stroke.tool === 'line') {
      g.moveTo(startX, startY);
      g.lineTo(endX, endY);
    } else if (stroke.tool === 'rectangle') {
      g.drawRect(Math.min(startX, endX), Math.min(startY, endY), Math.abs(endX - startX), Math.abs(endY - startY));
    } else if (stroke.tool === 'ellipse') {
      const radiusX = Math.abs(endX - startX) / 2;
      const radiusY = Math.abs(endY - startY) / 2;
      const centerX = startX + (endX - startX) / 2;
      const centerY = startY + (endY - startY) / 2;
      g.drawEllipse(centerX, centerY, radiusX, radiusY);
    }
    return;
  }

  const pts = [];
  for (let i = 0; i < stroke.points.length; i += 3) {
    pts.push([stroke.points[i], stroke.points[i + 1], stroke.points[i + 2]]);
  }

  if (pts.length === 0) return;

  const outline = getStroke(pts, {
    size: stroke.width,
    thinning: config.pressureSize ? 0.6 : 0,
    smoothing: 0.8,
    streamline: 0.8,
    simulatePressure: !config.pressureSize,
  });

  if (outline.length > 0) {
    if (stroke.preset === 'pencil' && !isEraser) {
      g.beginTextureFill({ texture: getNoiseTexture(stroke.color) });
    } else {
      g.beginFill(color, 1.0);
    }
    g.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      g.lineTo(outline[i][0], outline[i][1]);
    }
    g.endFill();
  } else if (pts.length === 1) {
    if (stroke.preset === 'pencil' && !isEraser) {
      g.beginTextureFill({ texture: getNoiseTexture(stroke.color) });
    } else {
      g.beginFill(color, 1.0);
    }
    g.drawCircle(pts[0][0], pts[0][1], stroke.width / 2);
    g.endFill();
  }

  if (alpha < 1.0 && !isEraser) {
    g.filters = [new PIXI.filters.AlphaFilter(alpha)];
  } else {
    g.filters = null;
  }
};

export type RenderLayersIntoOptions = {
  width: number;
  height: number;
  getBrushConfig: (presetId?: string) => BrushConfig;
  isActiveSkin?: boolean;
  activeLayerId?: string | null;
  layerTransform?: { offsetX: number; offsetY: number; scale: number; opacityMul: number } | null;
  selectedStrokeIndices?: Set<number>;
  dragOffset?: { x: number; y: number } | null;
  onAsyncLayersReady?: () => void;
};

export function renderLayersIntoContainer(
  container: PIXI.Container,
  layersData: Layer[],
  opts: RenderLayersIntoOptions,
): void {
  while (container.children.length > 0) {
    const child = container.getChildAt(0);
    container.removeChild(child).destroy({ children: true, texture: false, baseTexture: false });
  }

  const {
    width,
    height,
    getBrushConfig,
    isActiveSkin = false,
    activeLayerId = null,
    layerTransform = null,
    selectedStrokeIndices = new Set<number>(),
    dragOffset = null,
    onAsyncLayersReady,
  } = opts;

  const addRasterFromDataUrl = (layerContainer: PIXI.Container, dataBase64: string) => {
    const texture = PIXI.Texture.from(dataBase64);
    const sprite = new PIXI.Sprite(texture);
    sprite.width = width;
    sprite.height = height;
    layerContainer.addChild(sprite);
    const notify = () => onAsyncLayersReady?.();
    if (texture.baseTexture.valid) {
      queueMicrotask(notify);
    } else {
      texture.baseTexture.once('loaded', notify);
    }
  };

  layersData.forEach((layer) => {
    if (!layer.visible) return;

    const layerContainer = new PIXI.Container();
    const lt = isActiveSkin && layer.id === activeLayerId && layerTransform ? layerTransform : null;
    if (lt) {
      layerContainer.pivot.set(width / 2, height / 2);
      layerContainer.position.set(width / 2 + lt.offsetX, height / 2 + lt.offsetY);
      layerContainer.scale.set(lt.scale, lt.scale);
      layerContainer.alpha = (layer.opacity ?? 1.0) * lt.opacityMul;
    } else {
      layerContainer.alpha = layer.opacity ?? 1.0;
    }
    container.addChild(layerContainer);

    if (layer.type === 'raster' && layer.dataBase64) {
      addRasterFromDataUrl(layerContainer, layer.dataBase64);
    } else if (layer.type === 'vector' && layer.strokes && layer.strokes.length > 0) {
      layer.strokes.forEach((stroke, i) => {
        if (isActiveSkin && layer.id === activeLayerId && dragOffset && selectedStrokeIndices.has(i)) {
          return;
        }
        
        const config = stroke.brushConfig || getBrushConfig(stroke.preset);
        const isShape = ['line', 'rectangle', 'ellipse'].includes(stroke.tool);

        // FIXED: Explicitly bypass textured stamps if the stroke is a shape
        if (config.textureBase64 && !isShape) {
          const c = new PIXI.Container();
          drawStampsToContainer(c, stroke, config);
          if (stroke.tool === 'eraser') {
            c.children.forEach((s) => ((s as PIXI.Sprite).blendMode = PIXI.BLEND_MODES.ERASE));
          }
          layerContainer.addChild(c);
        } else {
          const g = new PIXI.Graphics();
          g.blendMode = stroke.tool === 'eraser' ? PIXI.BLEND_MODES.ERASE : PIXI.BLEND_MODES.NORMAL;
          drawStrokeToGraphics(g, stroke, config);
          layerContainer.addChild(g);
        }
      });
    } else if (layer.type === 'vector' && layer.dataBase64) {
      addRasterFromDataUrl(layerContainer, layer.dataBase64);
    }
  });
}