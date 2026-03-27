import * as PIXI from 'pixi.js';
import { UPDATE_PRIORITY } from '@pixi/ticker';
import { drawStampsToContainer, drawStrokeToGraphics, renderLayersIntoContainer } from './pixiStoryboardDraw';
import { makeOnionTintFilter } from '../lib/onionSkinPixi';
import { strokeAnyPointInRect, strokeBounds } from '../lib/storyboardClipboard';
import type { Stroke, Layer, BrushConfig } from '@common/models';

export interface StoryboardEngineConfig {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  getBrushConfig: (presetId?: string) => BrushConfig;
  onStrokeComplete: (stroke: Stroke) => void;
  onSelectionChanged: (selectedIndices: Set<number>, bounds: {x: number, y: number, w: number, h: number} | null) => void;
  onSelectionTransformComplete: (dragOffset: {x: number, y: number} | null, resizeState: any) => void;
  onColorPicked: (color: string) => void;
  onBucketFillRequest: (x: number, y: number) => void;
  onPanStart: (e: PointerEvent) => void;
}

export class StoryboardEngine {
  private app: PIXI.Application;
  private scene = {
    root: new PIXI.Container(),
    cameraRoot: new PIXI.Container(),
    prevSkin: new PIXI.Container(),
    nextSkin: new PIXI.Container(),
    underlaysRoot: new PIXI.Container(),
    layers: new PIXI.Container(),
    activeStrokeLayer: new PIXI.Container(),
    selectionPreviewLayer: new PIXI.Container(),
    selectionOverlay: new PIXI.Graphics(),
    activeStrokeGraphics: new PIXI.Graphics(),
    offMainRoot: new PIXI.Container(),
    rtMain: null as PIXI.RenderTexture | null,
    mainBoardSprite: null as PIXI.Sprite | null,
    onionTickerFn: null as ((dt: number) => void) | null,
  };

  private onionIsolated = false;

  // React-synced state
  public state = {
    tool: 'pen',
    brushPreset: 'solid',
    color: '#000000',
    brushSize: 5,
    activeLayerId: null as string | null,
    activePanelId: null as string | null,
    panelLayers: [] as Layer[],
    onionBeforeStacks: [] as Layer[][],
    onionAfterStacks: [] as Layer[][],
    underlayStacks: [] as Layer[][],
    onionSkinEnabled: false,
    onionPrefs: { beforeColor: '#ff6b6b', afterColor: '#4dabf7', beforeOpacities: [] as number[], afterOpacities: [] as number[] },
    selectedStrokeIndices: new Set<number>(),
    cameraTransform: null as any,
    layerTransform: null as any,
  };

  // Internal Interaction State
  private isDrawing = false;
  private activePoints: number[] = [];
  private dragStartPoint = { x: 0, y: 0 };
  
  public internalSelection = {
    bounds: null as {x: number, y: number, w: number, h: number} | null,
    marquee: null as {sx: number, sy: number, x: number, y: number} | null,
    dragOffset: null as {x: number, y: number} | null,
    resizeState: { active: false, handle: null as 'tl'|'tr'|'bl'|'br'|null, scaleX: 1, scaleY: 1, originX: 0, originY: 0 }
  };

  constructor(private config: StoryboardEngineConfig) {
    this.app = new PIXI.Application({
      view: config.canvas,
      width: config.width,
      height: config.height,
      backgroundAlpha: 0, 
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: false, // Prevents PIXI from fighting CSS transforms
      preserveDrawingBuffer: true, 
    });

    this.app.stage.addChild(this.scene.root);
    this.scene.root.addChild(this.scene.cameraRoot);
    
    this.scene.cameraRoot.addChild(this.scene.prevSkin);
    this.scene.cameraRoot.addChild(this.scene.nextSkin);
    this.scene.cameraRoot.addChild(this.scene.underlaysRoot);
    this.scene.cameraRoot.addChild(this.scene.layers);
    this.scene.cameraRoot.addChild(this.scene.activeStrokeLayer);
    this.scene.cameraRoot.addChild(this.scene.selectionPreviewLayer);
    this.scene.cameraRoot.addChild(this.scene.selectionOverlay);
    this.scene.activeStrokeLayer.addChild(this.scene.activeStrokeGraphics);

    this.bindEvents();
  }

  private bindEvents() {
    const canvas = this.app.view as HTMLCanvasElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private getCanvasPoint(e: PointerEvent) {
    const rect = (this.app.view as HTMLCanvasElement).getBoundingClientRect();
    const scaleX = this.config.width / rect.width;
    const scaleY = this.config.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.state.activePanelId || !this.state.activeLayerId) return;

    if (e.button === 1) { // Middle click pan
      this.config.onPanStart(e);
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const { x, y } = this.getCanvasPoint(e);

    if (this.state.tool === 'eyedropper') {
      const pixels = this.app.renderer.extract.pixels(this.scene.root);
      const idx = (Math.round(y) * this.config.width + Math.round(x)) * 4;
      if (pixels[idx + 3] > 0) {
        const hex = '#' + [pixels[idx], pixels[idx+1], pixels[idx+2]].map(c => c.toString(16).padStart(2, '0')).join('');
        this.config.onColorPicked(hex);
      }
      return;
    }

    if (this.state.tool === 'paintbucket') {
      this.config.onBucketFillRequest(x, y);
      return;
    }

    if (this.state.tool === 'select') {
      if (this.internalSelection.bounds) {
        const handleSize = 10;
        const b = this.internalSelection.bounds;
        const handles = [
          { type: 'tl', x: b.x, y: b.y },
          { type: 'tr', x: b.x + b.w, y: b.y },
          { type: 'bl', x: b.x, y: b.y + b.h },
          { type: 'br', x: b.x + b.w, y: b.y + b.h }
        ];
        
        for (const h of handles) {
          if (x >= h.x - handleSize && x <= h.x + handleSize && y >= h.y - handleSize && y <= h.y + handleSize) {
            this.internalSelection.resizeState = {
              active: true, handle: h.type as any, scaleX: 1, scaleY: 1,
              originX: h.type.includes('l') ? b.x + b.w : b.x,
              originY: h.type.includes('t') ? b.y + b.h : b.y
            };
            this.dragStartPoint = { x, y };
            return;
          }
        }
      }

      if (this.internalSelection.bounds && x >= this.internalSelection.bounds.x && x <= this.internalSelection.bounds.x + this.internalSelection.bounds.w && y >= this.internalSelection.bounds.y && y <= this.internalSelection.bounds.y + this.internalSelection.bounds.h) {
        this.internalSelection.dragOffset = { x: 0, y: 0 };
        this.dragStartPoint = { x, y };
      } else {
        this.config.onSelectionChanged(new Set(), null);
        this.internalSelection.marquee = { sx: x, sy: y, x, y };
        this.isDrawing = true;
      }
      return;
    }

    // Default Draw
    this.config.onSelectionChanged(new Set(), null);
    this.isDrawing = true;
    let pressure = e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.1) : 0.5;
    this.activePoints = [x, y, pressure];
    this.updateWetCanvas();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.state.activePanelId || !this.state.activeLayerId) return;

    if (this.state.tool === 'select') {
      const { x, y } = this.getCanvasPoint(e);
      if (this.internalSelection.resizeState.active && this.internalSelection.bounds) {
        const dx = x - this.dragStartPoint.x;
        const dy = y - this.dragStartPoint.y;
        let newScaleX = 1, newScaleY = 1;

        if (this.internalSelection.resizeState.handle?.includes('r')) newScaleX = (this.internalSelection.bounds.w + dx) / this.internalSelection.bounds.w;
        if (this.internalSelection.resizeState.handle?.includes('l')) newScaleX = (this.internalSelection.bounds.w - dx) / this.internalSelection.bounds.w;
        if (this.internalSelection.resizeState.handle?.includes('b')) newScaleY = (this.internalSelection.bounds.h + dy) / this.internalSelection.bounds.h;
        if (this.internalSelection.resizeState.handle?.includes('t')) newScaleY = (this.internalSelection.bounds.h - dy) / this.internalSelection.bounds.h;

        if (Math.abs(newScaleX) < 0.1) newScaleX = 0.1 * Math.sign(newScaleX) || 0.1;
        if (Math.abs(newScaleY) < 0.1) newScaleY = 0.1 * Math.sign(newScaleY) || 0.1;

        if (e.shiftKey) {
          const avgScale = (Math.abs(newScaleX) + Math.abs(newScaleY)) / 2;
          newScaleX = avgScale * Math.sign(newScaleX);
          newScaleY = avgScale * Math.sign(newScaleY);
        }

        this.internalSelection.resizeState.scaleX = newScaleX;
        this.internalSelection.resizeState.scaleY = newScaleY;
        this.renderScene();
        return;
      }

      if (this.internalSelection.dragOffset) {
        this.internalSelection.dragOffset = { x: x - this.dragStartPoint.x, y: y - this.dragStartPoint.y };
        this.renderScene();
      } else if (this.isDrawing && this.internalSelection.marquee) {
        this.internalSelection.marquee.x = x;
        this.internalSelection.marquee.y = y;
        this.renderScene();
      }
      return;
    }

    if (!this.isDrawing) return;

    const events = (e as any).getCoalescedEvents ? (e as any).getCoalescedEvents() : [e];
    for (const ev of events) {
      const { x, y } = this.getCanvasPoint(ev);
      let pressure = ev.pointerType === 'pen' ? (ev.pressure > 0 ? ev.pressure : 0.1) : 0.5;
      
      if (['line', 'rectangle', 'ellipse'].includes(this.state.tool)) {
         this.activePoints = [this.activePoints[0], this.activePoints[1], this.activePoints[2], x, y, pressure];
      } else {
         this.activePoints.push(x, y, pressure);
      }
    }
    this.updateWetCanvas();
  };

  private onPointerUp = (e: PointerEvent) => {
    try { (e.target as HTMLElement)?.releasePointerCapture(e.pointerId); } catch {}
    
    if (this.state.tool === 'select') {
      if (this.internalSelection.resizeState.active || this.internalSelection.dragOffset) {
         this.config.onSelectionTransformComplete(this.internalSelection.dragOffset, this.internalSelection.resizeState);
         this.internalSelection.dragOffset = null;
         this.internalSelection.resizeState = { active: false, handle: null, scaleX: 1, scaleY: 1, originX: 0, originY: 0 };
      } else if (this.isDrawing && this.internalSelection.marquee) {
         const minX = Math.min(this.internalSelection.marquee.sx, this.internalSelection.marquee.x);
         const maxX = Math.max(this.internalSelection.marquee.sx, this.internalSelection.marquee.x);
         const minY = Math.min(this.internalSelection.marquee.sy, this.internalSelection.marquee.y);
         const maxY = Math.max(this.internalSelection.marquee.sy, this.internalSelection.marquee.y);
         
         const layer = this.state.panelLayers.find(l => l.id === this.state.activeLayerId);
         if (layer && layer.strokes && maxX - minX > 5 && maxY - minY > 5) {
            const newSelected = new Set<number>();
            let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
            
            layer.strokes.forEach((stroke, i) => {
              if (!strokeAnyPointInRect(stroke, minX, maxX, minY, maxY)) return;
              newSelected.add(i);
              const b = strokeBounds(stroke);
              if (b) {
                sMinX = Math.min(sMinX, b.minX); sMaxX = Math.max(sMaxX, b.maxX);
                sMinY = Math.min(sMinY, b.minY); sMaxY = Math.max(sMaxY, b.maxY);
              }
            });
            
            if (newSelected.size > 0) {
               this.config.onSelectionChanged(newSelected, { x: sMinX - 10, y: sMinY - 10, w: sMaxX - sMinX + 20, h: sMaxY - sMinY + 20 });
            } else {
               this.config.onSelectionChanged(new Set(), null);
            }
         }
         this.internalSelection.marquee = null;
      }
      this.isDrawing = false;
      this.renderScene();
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.activePoints.length >= 3) {
      const finalStroke: Stroke = {
        tool: this.state.tool as any,
        preset: this.state.tool === 'eraser' ? undefined : this.state.brushPreset,
        color: this.state.tool === 'eraser' ? '#ffffff' : this.state.color,
        width: this.state.brushSize * 2,
        points: [...this.activePoints],
        brushConfig: this.config.getBrushConfig(this.state.tool === 'eraser' ? undefined : this.state.brushPreset)
      };
      this.config.onStrokeComplete(finalStroke);
    }
    
    this.activePoints = [];
    this.scene.activeStrokeGraphics.clear();
    while(this.scene.activeStrokeLayer.children.length > 1) {
      this.scene.activeStrokeLayer.removeChildAt(1).destroy({ children: true, texture: false, baseTexture: false });
    }
  };

  private updateWetCanvas() {
    const layer = this.scene.activeStrokeLayer;
    this.scene.activeStrokeGraphics.clear();
    while(layer.children.length > 1) {
      layer.removeChildAt(1).destroy({ children: true, texture: false, baseTexture: false });
    }

    if (this.activePoints.length < 3) return;

    // PREVENTS WEBGL CORRUPTION: Safely draw a single dot if only one point is registered
    if (this.activePoints.length < 6 && !['line', 'rectangle', 'ellipse'].includes(this.state.tool)) {
      const g = this.scene.activeStrokeGraphics;
      g.beginFill(parseInt(this.state.color.replace('#', ''), 16));
      g.drawCircle(this.activePoints[0], this.activePoints[1], this.state.brushSize);
      g.endFill();
      return;
    }

    const stroke: Stroke = {
      tool: this.state.tool as any,
      preset: this.state.tool === 'eraser' ? undefined : this.state.brushPreset,
      color: this.state.tool === 'eraser' ? '#ffffff' : this.state.color,
      width: this.state.brushSize * 2,
      points: this.activePoints,
      brushConfig: this.config.getBrushConfig(this.state.tool === 'eraser' ? undefined : this.state.brushPreset)
    };

    if (stroke.brushConfig?.textureBase64 && !['line', 'rectangle', 'ellipse'].includes(stroke.tool)) {
        const c = new PIXI.Container();
        drawStampsToContainer(c, stroke, stroke.brushConfig);
        if (stroke.tool === 'eraser') c.children.forEach(s => (s as PIXI.Sprite).blendMode = PIXI.BLEND_MODES.ERASE);
        layer.addChild(c);
    } else {
        const g = this.scene.activeStrokeGraphics;
        g.blendMode = stroke.tool === 'eraser' ? PIXI.BLEND_MODES.ERASE : PIXI.BLEND_MODES.NORMAL;
        drawStrokeToGraphics(g, stroke, stroke.brushConfig!);
    }
  }

  public updateState(newState: Partial<typeof this.state>) {
    Object.assign(this.state, newState);
    
    const cr = this.scene.cameraRoot;
    if (this.state.cameraTransform) {
      cr.pivot.set(this.config.width / 2, this.config.height / 2);
      cr.position.set(this.config.width / 2 + this.state.cameraTransform.panX, this.config.height / 2 + this.state.cameraTransform.panY);
      cr.scale.set(this.state.cameraTransform.zoom, this.state.cameraTransform.zoom);
      cr.rotation = (this.state.cameraTransform.rotationDeg * Math.PI) / 180;
    } else {
      cr.pivot.set(0, 0); cr.position.set(0, 0); cr.scale.set(1, 1); cr.rotation = 0;
    }

    this.syncOnionIsolation();
    this.renderScene();
  }

  public setSelectionBounds(bounds: {x: number, y: number, w: number, h: number} | null) {
    this.internalSelection.bounds = bounds;
    this.renderScene();
  }

  private syncOnionIsolation() {
    const enabled = this.state.onionSkinEnabled;
    if (this.onionIsolated === enabled) return;

    if (enabled) {
      if (!this.scene.rtMain) {
        this.scene.rtMain = PIXI.RenderTexture.create({ width: this.config.width, height: this.config.height, resolution: this.app.renderer.resolution });
        this.scene.mainBoardSprite = new PIXI.Sprite(this.scene.rtMain);
      }
      const insertAt = this.scene.cameraRoot.getChildIndex(this.scene.layers);
      const moveChain = [this.scene.layers, this.scene.activeStrokeLayer, this.scene.selectionPreviewLayer];
      for (const c of moveChain) c.parent?.removeChild(c);
      this.scene.offMainRoot.removeChildren();
      for (const c of moveChain) this.scene.offMainRoot.addChild(c);
      this.scene.cameraRoot.addChildAt(this.scene.mainBoardSprite!, insertAt);

      const tickerFn = () => {
        if (!this.onionIsolated || !this.scene.rtMain) return;
        this.app.renderer.render(this.scene.offMainRoot, { renderTexture: this.scene.rtMain, clear: true });
      };
      this.scene.onionTickerFn = tickerFn;
      this.app.ticker.add(tickerFn, undefined, UPDATE_PRIORITY.HIGH);
      this.onionIsolated = true;
    } else {
      if (this.scene.onionTickerFn) this.app.ticker.remove(this.scene.onionTickerFn);
      if (this.scene.mainBoardSprite?.parent) {
        const insertAt = this.scene.cameraRoot.getChildIndex(this.scene.mainBoardSprite);
        this.scene.cameraRoot.removeChild(this.scene.mainBoardSprite);
        const back = [this.scene.layers, this.scene.activeStrokeLayer, this.scene.selectionPreviewLayer];
        for (const c of back) this.scene.offMainRoot.removeChild(c);
        let i = insertAt;
        for (const c of back) { this.scene.cameraRoot.addChildAt(c, i); i++; }
      }
      this.onionIsolated = false;
    }
  }

  private renderScene() {
    try {
      const clearRoot = (r: PIXI.Container) => { while(r.children.length > 0) r.removeChildAt(0).destroy({ children: true, texture: false, baseTexture: false }); };
      clearRoot(this.scene.prevSkin); clearRoot(this.scene.nextSkin);
      
      if (this.state.onionSkinEnabled) {
        this.state.onionBeforeStacks.forEach((stack, i) => {
          if (!stack.length) return;
          const sub = new PIXI.Container();
          sub.filters = [makeOnionTintFilter(this.state.onionPrefs.beforeColor, this.state.onionPrefs.beforeOpacities[i] ?? 0.25)];
          renderLayersIntoContainer(sub, stack, { width: this.config.width, height: this.config.height, getBrushConfig: this.config.getBrushConfig, isActiveSkin: false, activeLayerId: null, layerTransform: null, selectedStrokeIndices: new Set(), dragOffset: null });
          this.scene.prevSkin.addChild(sub);
        });
        this.state.onionAfterStacks.forEach((stack, i) => {
          if (!stack.length) return;
          const sub = new PIXI.Container();
          sub.filters = [makeOnionTintFilter(this.state.onionPrefs.afterColor, this.state.onionPrefs.afterOpacities[i] ?? 0.25)];
          renderLayersIntoContainer(sub, stack, { width: this.config.width, height: this.config.height, getBrushConfig: this.config.getBrushConfig, isActiveSkin: false, activeLayerId: null, layerTransform: null, selectedStrokeIndices: new Set(), dragOffset: null });
          this.scene.nextSkin.addChild(sub);
        });
      }

      clearRoot(this.scene.underlaysRoot);
      if (this.state.underlayStacks.length > 0) {
        for (const stack of this.state.underlayStacks) {
          const sub = new PIXI.Container();
          this.scene.underlaysRoot.addChild(sub);
          renderLayersIntoContainer(sub, stack, { width: this.config.width, height: this.config.height, getBrushConfig: this.config.getBrushConfig, isActiveSkin: false, activeLayerId: null, layerTransform: null, selectedStrokeIndices: new Set(), dragOffset: null });
        }
        this.scene.underlaysRoot.visible = true;
      } else {
        this.scene.underlaysRoot.visible = false;
      }

      renderLayersIntoContainer(this.scene.layers, this.state.panelLayers, {
        width: this.config.width, height: this.config.height, getBrushConfig: this.config.getBrushConfig, 
        isActiveSkin: true, activeLayerId: this.state.activeLayerId, layerTransform: this.state.layerTransform, 
        selectedStrokeIndices: this.state.selectedStrokeIndices, dragOffset: this.internalSelection.dragOffset
      });

      const overlay = this.scene.selectionOverlay;
      overlay.clear();
      clearRoot(this.scene.selectionPreviewLayer);

      if (this.internalSelection.marquee) {
        overlay.lineStyle(2, 0x3b82f6, 1); overlay.beginFill(0x3b82f6, 0.1);
        overlay.drawRect(this.internalSelection.marquee.sx, this.internalSelection.marquee.sy, this.internalSelection.marquee.x - this.internalSelection.marquee.sx, this.internalSelection.marquee.y - this.internalSelection.marquee.sy);
        overlay.endFill();
      }

      if (this.internalSelection.bounds) {
        let { x: bX, y: bY, w: bW, h: bH } = this.internalSelection.bounds;
        if (this.internalSelection.dragOffset) {
          bX += this.internalSelection.dragOffset.x; bY += this.internalSelection.dragOffset.y;
        } else if (this.internalSelection.resizeState.active) {
          const rs = this.internalSelection.resizeState;
          bX = Math.min(rs.originX, rs.originX + (this.internalSelection.bounds.x - rs.originX) * rs.scaleX, rs.originX + (this.internalSelection.bounds.x + this.internalSelection.bounds.w - rs.originX) * rs.scaleX);
          bY = Math.min(rs.originY, rs.originY + (this.internalSelection.bounds.y - rs.originY) * rs.scaleY, rs.originY + (this.internalSelection.bounds.y + this.internalSelection.bounds.h - rs.originY) * rs.scaleY);
          bW = Math.abs(this.internalSelection.bounds.w * rs.scaleX);
          bH = Math.abs(this.internalSelection.bounds.h * rs.scaleY);
        }

        overlay.lineStyle(2, 0x3b82f6, 1); overlay.drawRect(bX, bY, bW, bH);
        const hs = 10; overlay.beginFill(0xffffff); overlay.lineStyle(2, 0x3b82f6, 1);
        [{x: bX, y: bY}, {x: bX+bW, y: bY}, {x: bX, y: bY+bH}, {x: bX+bW, y: bY+bH}].forEach(h => overlay.drawRect(h.x - hs/2, h.y - hs/2, hs, hs));
        overlay.endFill();

        if ((this.internalSelection.dragOffset || this.internalSelection.resizeState.active) && this.state.activeLayerId) {
          const layer = this.state.panelLayers.find(l => l.id === this.state.activeLayerId);
          layer?.strokes?.forEach((stroke, i) => {
            if (this.state.selectedStrokeIndices.has(i)) {
              let newPts = [];
              let newWidth = stroke.width;
              if (this.internalSelection.resizeState.active) {
                const rs = this.internalSelection.resizeState;
                for(let j=0; j<stroke.points.length; j+=3) newPts.push(rs.originX + (stroke.points[j]-rs.originX)*rs.scaleX, rs.originY + (stroke.points[j+1]-rs.originY)*rs.scaleY, stroke.points[j+2]);
                newWidth *= (Math.abs(rs.scaleX) + Math.abs(rs.scaleY)) / 2;
              } else if (this.internalSelection.dragOffset) {
                for(let j=0; j<stroke.points.length; j+=3) newPts.push(stroke.points[j] + this.internalSelection.dragOffset.x, stroke.points[j+1] + this.internalSelection.dragOffset.y, stroke.points[j+2]);
              }
              
              const config = stroke.brushConfig || this.config.getBrushConfig(stroke.preset);
              const tempStroke = { ...stroke, points: newPts, width: newWidth };
              if (config.textureBase64) {
                const c = new PIXI.Container(); drawStampsToContainer(c, tempStroke, config);
                if (stroke.tool === 'eraser') c.children.forEach(s => (s as PIXI.Sprite).blendMode = PIXI.BLEND_MODES.ERASE);
                this.scene.selectionPreviewLayer.addChild(c);
              } else {
                const g = new PIXI.Graphics(); g.blendMode = stroke.tool === 'eraser' ? PIXI.BLEND_MODES.ERASE : PIXI.BLEND_MODES.NORMAL;
                drawStrokeToGraphics(g, tempStroke, config); this.scene.selectionPreviewLayer.addChild(g);
              }
            }
          });
        }
      }
    } catch (e) {
      console.error("Render Scene Error:", e);
    }
  }

  public getStageThumbnailJpegDataUrl() {
    try {
      this.app.render();
      const src = this.app.renderer.extract.canvas(this.scene.root);
      const thumb = document.createElement('canvas'); thumb.width = 160; thumb.height = 90;
      const ctx = thumb.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 160, 90);
      ctx.drawImage(src as unknown as CanvasImageSource, 0, 0, 160, 90);
      return thumb.toDataURL('image/jpeg', 0.55);
    } catch { return null; }
  }

  public destroy() {
    const canvas = this.app.view as HTMLCanvasElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    if (this.scene.onionTickerFn) this.app.ticker.remove(this.scene.onionTickerFn);
    this.app.destroy(false, { children: true, texture: false, baseTexture: false });
  }
}