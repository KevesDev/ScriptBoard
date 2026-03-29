import type { BrushConfig, Stroke } from '@common/models';
import { getStroke } from 'perfect-freehand';

// Mulberry32 PRNG for deterministic brush scattering/rotation
export function createPRNG(seed: number) {
  let a = seed;
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

class TextureCache {
  private textures: Map<string, HTMLImageElement> = new Map();
  private tintedCache: Map<string, HTMLCanvasElement> = new Map(); // Key: `${brushId}_${color}`
  private noisePattern: CanvasPattern | null = null;
  private noisePatternColor: string = '';

  public getNoisePattern(color: string): CanvasPattern | null {
    if (this.noisePattern && this.noisePatternColor === color) {
      return this.noisePattern;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = color;
    
    // Seeded Noise Pattern so background texture never shifts
    const rng = createPRNG(4815162342); 
    
    for (let i = 0; i < 2000; i++) {
      const x = rng() * 64;
      const y = rng() * 64;
      ctx.globalAlpha = rng() * 0.5 + 0.1;
      ctx.fillRect(x, y, 1, 1);
      if (rng() > 0.8) {
         ctx.fillRect(x, y, 2, 2);
      }
    }
    
    const pattern = ctx.createPattern(canvas, 'repeat');
    if (pattern) {
      this.noisePattern = pattern;
      this.noisePatternColor = color;
    }
    return pattern;
  }

  public async getTexture(base64: string, id: string): Promise<HTMLImageElement> {
    if (this.textures.has(id)) {
      return this.textures.get(id)!;
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.textures.set(id, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = base64;
    });
  }

  public getTextureSync(base64: string, id: string): HTMLImageElement | null {
    if (this.textures.has(id)) {
      return this.textures.get(id)!;
    }
    this.getTexture(base64, id).catch(console.error);
    return null;
  }

  private hasAlphaCache = new Map<string, boolean>();

  public getTintedTexture(img: HTMLImageElement, color: string, id: string): HTMLCanvasElement {
    const key = `${id}_${color}`;
    if (this.tintedCache.has(key)) {
      return this.tintedCache.get(key)!;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return canvas;

    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    
    let hasAlpha = this.hasAlphaCache.get(id);
    if (hasAlpha === undefined) {
      hasAlpha = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
          hasAlpha = true;
          break;
        }
      }
      this.hasAlphaCache.set(id, hasAlpha);
    }
    
    let targetR = 255, targetG = 255, targetB = 255;
    if (color.startsWith('#')) {
      const hex = color.substring(1);
      if (hex.length === 6) {
        targetR = parseInt(hex.substring(0, 2), 16);
        targetG = parseInt(hex.substring(2, 4), 16);
        targetB = parseInt(hex.substring(4, 6), 16);
      } else if (hex.length === 3) {
        targetR = parseInt(hex[0]+hex[0], 16);
        targetG = parseInt(hex[1]+hex[1], 16);
        targetB = parseInt(hex[2]+hex[2], 16);
      }
    }

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const a = data[i+3];
      
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      let finalAlpha = a;
      
      if (!hasAlpha) {
        finalAlpha = 255 - brightness;
      }
      
      data[i] = targetR;
      data[i+1] = targetG;
      data[i+2] = targetB;
      data[i+3] = finalAlpha;
    }
    
    ctx.putImageData(imgData, 0, 0);

    this.tintedCache.set(key, canvas);
    return canvas;
  }
}

export const BrushTextureManager = new TextureCache();

export interface StampData {
  x: number;
  y: number;
  p: number;
  angle: number;
  size: number;
  alpha: number;
}

export const computeBrushStamps = (stroke: Stroke, config: BrushConfig): StampData[] => {
  const pts = stroke.points;
  const stamps: StampData[] = [];
  if (pts.length < 3) return stamps;
  
  const numPts = pts.length / 3;
  const getPt = (i: number) => ({ x: pts[i*3], y: pts[i*3+1], p: pts[i*3+2] });
  const baseSize = stroke.width;
  const actualMinSizeMultiplier = stroke.tool === 'eraser' ? 1.0 : (config.pressureSize ? 0.1 : 1.0);

  // Extract seed from stroke or fallback, feed into deterministic PRNG
  const strokeSeed = stroke.seed ?? 123456789;
  const rng = createPRNG(strokeSeed);

  const addStamp = (x: number, y: number, p: number, angle: number) => {
    let size = baseSize;
    if (config.pressureSize) {
      size = baseSize * (actualMinSizeMultiplier + (1 - actualMinSizeMultiplier) * p);
    }
    let alpha = config.flow;
    if (config.pressureOpacity) {
      alpha = config.flow * p;
    }
    
    // Use RNG to lock the mathematical scatter and rotation pattern
    if (config.scatter > 0) {
      const scatterAmount = size * config.scatter;
      x += (rng() - 0.5) * scatterAmount * 2;
      y += (rng() - 0.5) * scatterAmount * 2;
    }

    let rot = config.rotationAngle;
    if (config.rotationMode === 'path') rot += angle;
    else if (config.rotationMode === 'random') rot += rng() * Math.PI * 2;

    stamps.push({ x, y, p, angle: rot, size, alpha });
  };

  if (numPts === 1) {
    addStamp(pts[0], pts[1], pts[2], 0);
    return stamps;
  }

  let p0 = getPt(0);
  let p1 = getPt(0);
  let p2 = getPt(1);
  let distanceSinceLastStamp = 0;

  for (let i = 1; i < numPts; i++) {
    p0 = p1;
    p1 = p2;
    p2 = getPt(i);

    const mid1 = { x: p0.x + (p1.x - p0.x) / 2, y: p0.y + (p1.y - p0.y) / 2, p: p0.p + (p1.p - p0.p) / 2 };
    const mid2 = { x: p1.x + (p2.x - p1.x) / 2, y: p1.y + (p2.y - p1.y) / 2, p: p1.p + (p2.p - p1.p) / 2 };

    const dist = Math.hypot(mid2.x - mid1.x, mid2.y - mid1.y);
    const steps = Math.max(1, Math.ceil(dist));

    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;

      const x = uu * mid1.x + 2 * u * t * p1.x + tt * mid2.x;
      const y = uu * mid1.y + 2 * u * t * p1.y + tt * mid2.y;
      const p = uu * mid1.p + 2 * u * t * p1.p + tt * mid2.p;

      let currentSize = baseSize;
      if (config.pressureSize) {
        currentSize = baseSize * (actualMinSizeMultiplier + (1 - actualMinSizeMultiplier) * p);
      }
      
      const stampSpacing = Math.max(1, currentSize * config.spacing);
      distanceSinceLastStamp += (dist / steps);

      if (distanceSinceLastStamp >= stampSpacing) {
        const nextT = Math.min(1, t + 0.01);
        const nextU = 1 - nextT;
        const nx = nextU * nextU * mid1.x + 2 * nextU * nextT * p1.x + nextT * nextT * mid2.x;
        const ny = nextU * nextU * mid1.y + 2 * nextU * nextT * p1.y + nextT * nextT * mid2.y;
        const angle = Math.atan2(ny - y, nx - x);

        addStamp(x, y, p, angle);
        distanceSinceLastStamp = 0;
      }
    }
  }
  return stamps;
};

export const renderBrushStrokeToContext = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  brushConfig: BrushConfig
) => {
  const pts = stroke.points;
  if (pts.length < 3) return;

  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  
  if (stroke.tool === 'fill' && stroke.fillPaths) {
    ctx.beginPath();
    for (const path of stroke.fillPaths) {
      if (path.length >= 2) {
        ctx.moveTo(path[0], path[1]);
        for (let i = 2; i < path.length; i += 2) {
          ctx.lineTo(path[i], path[i+1]);
        }
        ctx.closePath();
      }
    }
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = brushConfig?.flow ?? 1.0;
    ctx.fill('evenodd');
    return;
  }
  
  if (['line', 'rectangle', 'ellipse'].includes(stroke.tool)) {
    if (pts.length < 6) return;
    const startX = pts[0];
    const startY = pts[1];
    const endX = pts[pts.length - 3];
    const endY = pts[pts.length - 2];
    
    ctx.beginPath();
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (stroke.tool === 'line') {
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    } else if (stroke.tool === 'rectangle') {
      ctx.rect(startX, startY, endX - startX, endY - startY);
      ctx.stroke();
    } else if (stroke.tool === 'ellipse') {
      const radiusX = Math.abs(endX - startX) / 2;
      const radiusY = Math.abs(endY - startY) / 2;
      const centerX = startX + (endX - startX) / 2;
      const centerY = startY + (endY - startY) / 2;
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }
    return;
  }

  const actualConfig = stroke.brushConfig || brushConfig;

  if (!actualConfig.textureBase64) {
    const pfPts = [];
    for (let i = 0; i < stroke.points.length; i += 3) {
      pfPts.push([stroke.points[i], stroke.points[i+1], stroke.points[i+2]]);
    }
    
    if (pfPts.length === 0) return;

    const outline = getStroke(pfPts, {
      size: stroke.width,
      thinning: actualConfig.pressureSize ? 0.6 : 0,
      smoothing: 0.8,
      streamline: 0.8,
      simulatePressure: !actualConfig.pressureSize
    });

    if (outline.length > 0) {
      if (stroke.preset === 'pencil') {
        const pattern = BrushTextureManager.getNoisePattern(stroke.color);
        ctx.fillStyle = pattern || stroke.color;
      } else {
        ctx.fillStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
      }
      ctx.globalAlpha = actualConfig.flow ?? 1.0;
      ctx.beginPath();
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (let i = 1; i < outline.length; i++) {
        ctx.lineTo(outline[i][0], outline[i][1]);
      }
      ctx.fill();
    } else if (pfPts.length === 1) {
      if (stroke.preset === 'pencil') {
        const pattern = BrushTextureManager.getNoisePattern(stroke.color);
        ctx.fillStyle = pattern || stroke.color;
      } else {
        ctx.fillStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
      }
      ctx.globalAlpha = actualConfig.flow ?? 1.0;
      ctx.beginPath();
      ctx.arc(pfPts[0][0], pfPts[0][1], stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  let brushImg: HTMLCanvasElement | null = null;
  if (actualConfig.textureBase64) {
    const img = BrushTextureManager.getTextureSync(actualConfig.textureBase64, actualConfig.id);
    if (img) {
      brushImg = BrushTextureManager.getTintedTexture(img, stroke.tool === 'eraser' ? '#ffffff' : stroke.color, actualConfig.id);
    } else {
      return;
    }
  }

  const stamps = computeBrushStamps(stroke, actualConfig);
  
  for (const stamp of stamps) {
    ctx.globalAlpha = stamp.alpha;
    if (brushImg) {
      ctx.save();
      ctx.translate(stamp.x, stamp.y);
      ctx.rotate(stamp.angle);
      ctx.drawImage(brushImg, -stamp.size / 2, -stamp.size / 2, stamp.size, stamp.size);
      ctx.restore();
    } else {
      const radius = Math.max(0.5, stamp.size / 2);
      ctx.fillStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
      ctx.beginPath();
      ctx.arc(stamp.x, stamp.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};