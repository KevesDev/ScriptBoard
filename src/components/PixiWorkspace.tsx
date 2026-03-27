import React, { useRef, useEffect, useLayoutEffect, useImperativeHandle, forwardRef } from 'react';
import * as PIXI from 'pixi.js';
import { UPDATE_PRIORITY } from '@pixi/ticker';
import {
  drawStampsToContainer,
  drawStrokeToGraphics,
  renderLayersIntoContainer,
} from '../engine/pixiStoryboardDraw';
import { makeOnionTintFilter } from '../lib/onionSkinPixi';
import type { Stroke, Layer, BrushConfig } from '@common/models';

interface PixiWorkspaceProps {
  width: number;
  height: number;
  zoom: number;
  isSpacePanning: boolean;
  isPanningRef: React.MutableRefObject<boolean>;
  panelLayers: Layer[];
  activeLayerId: string | null;
  getBrushConfig: (presetId?: string) => BrushConfig;
  selectedStrokeIndices: Set<number>;
  dragOffset: { x: number, y: number } | null;
  selectionBounds?: { x: number, y: number, w: number, h: number } | null;
  selectionMarquee?: { sx: number, sy: number, x: number, y: number } | null;
  resizeState?: { active: boolean, handle: 'tl'|'tr'|'bl'|'br'|null, scaleX: number, scaleY: number, originX: number, originY: number } | null;
  
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  
  /** Previous panels (same scene), back → front: farthest … immediate previous. */
  onionBeforeStacks?: Layer[][];
  /** Following panels, front → back: immediate next … farthest. */
  onionAfterStacks?: Layer[][];
  onionBeforeColor?: string;
  onionAfterColor?: string;
  onionBeforeOpacities?: number[];
  onionAfterOpacities?: number[];
  /** Back → front: each entry is one storyboard timeline slice (already filtered). Drawn below `panelLayers`. */
  underlayStacks?: Layer[][];
  onionSkinEnabled?: boolean;
  /** When set, pans/zooms/rotates all board content about the canvas center. */
  cameraTransform?: { panX: number; panY: number; zoom: number; rotationDeg: number } | null;
  /** When set, applies sampled transform to the active layer only (main panel). */
  layerTransform?: { offsetX: number; offsetY: number; scale: number; opacityMul: number } | null;
  /** Called after async layer textures (e.g. raster data URLs) load so thumbnails can refresh. */
  onLayersGpuReady?: () => void;
}

export interface PixiWorkspaceRef {
  updateActiveStroke: (stroke: Stroke | null) => void;
  getCanvasElement: () => HTMLCanvasElement | null;
  /** Flush GPU → view so 2D readback (`drawImage`, eyedropper, paint bucket) sees the latest frame. */
  syncRender: () => void;
  /** Renders the stage and returns a small JPEG data URL for panel thumbnails (reliable vs reading the WebGL canvas). */
  getStageThumbnailJpegDataUrl: () => string | null;
}

export const PixiWorkspace = forwardRef<PixiWorkspaceRef, PixiWorkspaceProps>((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  
  // Scene graph references
  const sceneRef = useRef<{
    root: PIXI.Container;
    cameraRoot: PIXI.Container;
    prevSkin: PIXI.Container;
    nextSkin: PIXI.Container;
    underlaysRoot: PIXI.Container;
    layers: PIXI.Container;
    activeStrokeLayer: PIXI.Container;
    selectionPreviewLayer: PIXI.Container;
    selectionOverlay: PIXI.Graphics;
    activeStrokeGraphics: PIXI.Graphics;
    layerMap: Map<string, { container: PIXI.Container, strokes: PIXI.Graphics[], sprite: PIXI.Sprite | null }>;
    /** When onion skin isolates the main board, vector ERASE blends only inside this pass. */
    offMainRoot?: PIXI.Container;
    rtMain?: PIXI.RenderTexture;
    mainBoardSprite?: PIXI.Sprite;
    onionTickerFn?: (dt: number) => void;
  } | null>(null);

  const onionIsolatedRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  const syncOnionMainBoardIsolation = (enabled: boolean) => {
    const s = sceneRef.current;
    const app = appRef.current;
    if (!s || !app) return;

    const w = propsRef.current.width;
    const h = propsRef.current.height;
    const res = app.renderer.resolution;

    const syncRtDimensions = () => {
      if (!s.rtMain) return;
      if (s.rtMain.width !== w || s.rtMain.height !== h) {
        s.rtMain.resize(w, h);
      }
    };

    if (onionIsolatedRef.current === enabled) return;

    if (enabled) {
      if (!s.offMainRoot) {
        s.offMainRoot = new PIXI.Container();
        s.rtMain = PIXI.RenderTexture.create({ width: w, height: h, resolution: res });
        s.mainBoardSprite = new PIXI.Sprite(s.rtMain);
      } else if (s.rtMain) {
        s.rtMain.setResolution(res);
        if (s.rtMain.width !== w || s.rtMain.height !== h) {
          s.rtMain.resize(w, h);
        }
      }

      const insertAt = s.cameraRoot.getChildIndex(s.layers);
      const moveChain = [s.layers, s.activeStrokeLayer, s.selectionPreviewLayer];
      for (const c of moveChain) {
        c.parent?.removeChild(c);
      }
      s.offMainRoot!.removeChildren();
      syncRtDimensions();
      for (const c of moveChain) {
        s.offMainRoot!.addChild(c);
      }
      s.cameraRoot.addChildAt(s.mainBoardSprite!, insertAt);

      const tickerFn = () => {
        const sc = sceneRef.current;
        const ap = appRef.current;
        if (!onionIsolatedRef.current || !sc?.offMainRoot || !sc.rtMain || !ap) return;
        ap.renderer.render(sc.offMainRoot, { renderTexture: sc.rtMain, clear: true });
      };
      if (s.onionTickerFn) {
        app.ticker.remove(s.onionTickerFn);
      }
      s.onionTickerFn = tickerFn;
      app.ticker.add(tickerFn, undefined, UPDATE_PRIORITY.HIGH);
      onionIsolatedRef.current = true;
    } else {
      if (s.onionTickerFn) {
        app.ticker.remove(s.onionTickerFn);
        s.onionTickerFn = undefined;
      }
      if (s.mainBoardSprite?.parent) {
        const insertAt = s.cameraRoot.getChildIndex(s.mainBoardSprite);
        s.cameraRoot.removeChild(s.mainBoardSprite);
        const back = [s.layers, s.activeStrokeLayer, s.selectionPreviewLayer];
        for (const c of back) {
          s.offMainRoot?.removeChild(c);
        }
        let i = insertAt;
        for (const c of back) {
          s.cameraRoot.addChildAt(c, i);
          i++;
        }
      }
      onionIsolatedRef.current = false;
    }
  };

  useLayoutEffect(() => {
    syncOnionMainBoardIsolation(!!props.onionSkinEnabled);
  }, [props.onionSkinEnabled]);

  // Render function that can be called manually or by the effect
  const renderScene = () => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    const beforeStacks = props.onionBeforeStacks ?? [];
    const afterStacks = props.onionAfterStacks ?? [];
    const beforeOp = props.onionBeforeOpacities ?? [];
    const afterOp = props.onionAfterOpacities ?? [];
    const beforeTint = props.onionBeforeColor ?? '#ff6b6b';
    const afterTint = props.onionAfterColor ?? '#4dabf7';

    const showPrev = !!props.onionSkinEnabled && beforeStacks.some((s) => s.length > 0);
    const showNext = !!props.onionSkinEnabled && afterStacks.some((s) => s.length > 0);
    scene.prevSkin.visible = showPrev;
    scene.nextSkin.visible = showNext;

    const clearOnionRoot = (root: PIXI.Container) => {
      while (root.children.length > 0) {
        root.removeChildAt(0).destroy({ children: true, texture: false, baseTexture: false });
      }
    };

    clearOnionRoot(scene.prevSkin);
    if (showPrev) {
      for (let i = 0; i < beforeStacks.length; i++) {
        const layersData = beforeStacks[i]!;
        if (!layersData.length) continue;
        const sub = new PIXI.Container();
        const op = beforeOp[i] ?? 0.25;
        sub.filters = [makeOnionTintFilter(beforeTint, op)];
        renderLayers(sub, layersData, false);
        scene.prevSkin.addChild(sub);
      }
    }

    clearOnionRoot(scene.nextSkin);
    if (showNext) {
      for (let i = 0; i < afterStacks.length; i++) {
        const layersData = afterStacks[i]!;
        if (!layersData.length) continue;
        const sub = new PIXI.Container();
        const op = afterOp[i] ?? 0.25;
        sub.filters = [makeOnionTintFilter(afterTint, op)];
        renderLayers(sub, layersData, false);
        scene.nextSkin.addChild(sub);
      }
    }

    const underlays = props.underlayStacks ?? [];
    while (scene.underlaysRoot.children.length > 0) {
      scene.underlaysRoot.removeChildAt(0).destroy({ children: true, texture: false, baseTexture: false });
    }
    for (const stack of underlays) {
      const sub = new PIXI.Container();
      scene.underlaysRoot.addChild(sub);
      renderLayers(sub, stack, false);
    }
    scene.underlaysRoot.visible = underlays.length > 0;
    
    // Render main layers
    renderLayers(scene.layers, props.panelLayers, true);

    // Render Selection Overlay
    const overlay = scene.selectionOverlay;
    overlay.clear();
    
    const previewLayer = scene.selectionPreviewLayer;
    while(previewLayer.children.length > 0) {
      previewLayer.removeChildAt(0).destroy({ children: true, texture: false, baseTexture: false });
    }

    if (props.selectionMarquee) {
      overlay.lineStyle(2, 0x3b82f6, 1);
      overlay.beginFill(0x3b82f6, 0.1);
      overlay.drawRect(
        props.selectionMarquee.sx, 
        props.selectionMarquee.sy, 
        props.selectionMarquee.x - props.selectionMarquee.sx, 
        props.selectionMarquee.y - props.selectionMarquee.sy
      );
      overlay.endFill();
    }

    if (props.selectionBounds) {
      const offsetX = props.dragOffset ? props.dragOffset.x : 0;
      const offsetY = props.dragOffset ? props.dragOffset.y : 0;
      const isResizing = props.resizeState?.active;

      let bX = props.selectionBounds.x + offsetX;
      let bY = props.selectionBounds.y + offsetY;
      let bW = props.selectionBounds.w;
      let bH = props.selectionBounds.h;

      if (isResizing && props.resizeState) {
        const rs = props.resizeState;
        bX = Math.min(rs.originX, rs.originX + (props.selectionBounds.x - rs.originX) * rs.scaleX, rs.originX + (props.selectionBounds.x + props.selectionBounds.w - rs.originX) * rs.scaleX);
        bY = Math.min(rs.originY, rs.originY + (props.selectionBounds.y - rs.originY) * rs.scaleY, rs.originY + (props.selectionBounds.y + props.selectionBounds.h - rs.originY) * rs.scaleY);
        bW = Math.abs(props.selectionBounds.w * rs.scaleX);
        bH = Math.abs(props.selectionBounds.h * rs.scaleY);
      }

      overlay.lineStyle(2, 0x3b82f6, 1);
      overlay.drawRect(bX, bY, bW, bH);

      const handleSize = 10;
      overlay.beginFill(0xffffff);
      overlay.lineStyle(2, 0x3b82f6, 1);
      const handles = [
        { x: bX, y: bY },
        { x: bX + bW, y: bY },
        { x: bX, y: bY + bH },
        { x: bX + bW, y: bY + bH }
      ];
      for (const h of handles) {
        overlay.drawRect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize);
      }
      overlay.endFill();

      // Draw the selected strokes preview if dragging or resizing
      if ((props.dragOffset || isResizing) && props.activeLayerId) {
        const layer = props.panelLayers.find(l => l.id === props.activeLayerId);
        if (layer && layer.strokes) {
          layer.strokes.forEach((stroke, i) => {
            if (props.selectedStrokeIndices.has(i)) {
              if (isResizing && props.resizeState) {
                const rs = props.resizeState;
                const tempPts = [];
                for (let j = 0; j < stroke.points.length; j += 3) {
                  const px = stroke.points[j];
                  const py = stroke.points[j+1];
                  tempPts.push(
                    rs.originX + (px - rs.originX) * rs.scaleX,
                    rs.originY + (py - rs.originY) * rs.scaleY,
                    stroke.points[j+2]
                  );
                }
                const avgScale = (Math.abs(rs.scaleX) + Math.abs(rs.scaleY)) / 2;
                const config = stroke.brushConfig || props.getBrushConfig(stroke.preset);
                const tempStroke = { ...stroke, points: tempPts, width: stroke.width * avgScale };
                
                if (config.textureBase64) {
                   const c = new PIXI.Container();
                   drawStampsToContainer(c, tempStroke, config);
                   if (stroke.tool === 'eraser') c.children.forEach(s => (s as PIXI.Sprite).blendMode = PIXI.BLEND_MODES.ERASE);
                   previewLayer.addChild(c);
                } else {
                   const g = new PIXI.Graphics();
                   g.blendMode = stroke.tool === 'eraser' ? PIXI.BLEND_MODES.ERASE : PIXI.BLEND_MODES.NORMAL;
                   drawStrokeToGraphics(g, tempStroke, config);
                   previewLayer.addChild(g);
                }
                
              } else if (props.dragOffset) {
                const tempPts = [];
                for (let j = 0; j < stroke.points.length; j += 3) {
                  tempPts.push(
                    stroke.points[j] + props.dragOffset.x,
                    stroke.points[j+1] + props.dragOffset.y,
                    stroke.points[j+2]
                  );
                }
                const config = stroke.brushConfig || props.getBrushConfig(stroke.preset);
                const tempStroke = { ...stroke, points: tempPts };
                
                if (config.textureBase64) {
                   const c = new PIXI.Container();
                   drawStampsToContainer(c, tempStroke, config);
                   if (stroke.tool === 'eraser') c.children.forEach(s => (s as PIXI.Sprite).blendMode = PIXI.BLEND_MODES.ERASE);
                   previewLayer.addChild(c);
                } else {
                   const g = new PIXI.Graphics();
                   g.blendMode = stroke.tool === 'eraser' ? PIXI.BLEND_MODES.ERASE : PIXI.BLEND_MODES.NORMAL;
                   drawStrokeToGraphics(g, tempStroke, config);
                   previewLayer.addChild(g);
                }
              }
            }
          });
        }
      }
    }
  };

  const renderSceneRef = useRef(renderScene);
  
  useEffect(() => {
    renderSceneRef.current = renderScene;
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    let app: PIXI.Application | null = null;
    let isActive = true;

    // Small delay to ensure the canvas is fully in the DOM and layout is settled.
    // This helps prevent WebGL context creation errors in Electron/Chromium when 
    // the element might be temporarily hidden or 0x0 during layout thrashing.
    const initTimer = setTimeout(() => {
      if (!isActive || !canvasRef.current) return;
      
      try {
        app = new PIXI.Application({
          view: canvasRef.current,
          width: props.width,
          height: props.height,
          backgroundAlpha: 0,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          hello: false,
          // So 2D readback of the view canvas works; thumbnails also use extract below.
          preserveDrawingBuffer: true,
        });

        appRef.current = app as any;

        const root = new PIXI.Container();
        app.stage.addChild(root);

        const cameraRoot = new PIXI.Container();
        root.addChild(cameraRoot);

        const prevSkin = new PIXI.Container();
        const nextSkin = new PIXI.Container();
        const underlaysRoot = new PIXI.Container();
        const layers = new PIXI.Container();
        const activeStrokeLayer = new PIXI.Container();
        const selectionPreviewLayer = new PIXI.Container();
        const selectionOverlay = new PIXI.Graphics();
        const activeStrokeGraphics = new PIXI.Graphics();

        cameraRoot.addChild(prevSkin);
        cameraRoot.addChild(nextSkin);
        cameraRoot.addChild(underlaysRoot);
        cameraRoot.addChild(layers);
        cameraRoot.addChild(activeStrokeLayer);
        cameraRoot.addChild(selectionPreviewLayer);
        cameraRoot.addChild(selectionOverlay);

        activeStrokeLayer.addChild(activeStrokeGraphics);

        sceneRef.current = {
          root,
          cameraRoot,
          prevSkin,
          nextSkin,
          underlaysRoot,
          layers,
          activeStrokeLayer,
          selectionPreviewLayer,
          selectionOverlay,
          activeStrokeGraphics,
          layerMap: new Map()
        };

        syncOnionMainBoardIsolation(!!propsRef.current.onionSkinEnabled);

      // Force an initial render of the current props
      renderSceneRef.current();
      } catch (err) {
        console.error("Failed to initialize PixiJS WebGL context:", err);
      }
    }, 50);

    return () => {
      isActive = false;
      clearTimeout(initTimer);
      if (app) {
        try {
          const sc = sceneRef.current;
          if (sc?.onionTickerFn) {
            app.ticker.remove(sc.onionTickerFn);
          }
          onionIsolatedRef.current = false;
          app.destroy(false, { children: true, texture: false, baseTexture: false });
        } catch(e) {
          console.error("Error destroying PixiJS app:", e);
        }
      }
      sceneRef.current = null;
      appRef.current = null;
    };
  }, [props.width, props.height]); // Recreate app if dimensions change

  const renderLayers = (container: PIXI.Container, layersData: Layer[], isActiveSkin: boolean) => {
    if (!sceneRef.current) return;
    renderLayersIntoContainer(container, layersData, {
      width: props.width,
      height: props.height,
      getBrushConfig: props.getBrushConfig,
      isActiveSkin,
      activeLayerId: props.activeLayerId,
      layerTransform: props.layerTransform ?? null,
      selectedStrokeIndices: props.selectedStrokeIndices,
      dragOffset: props.dragOffset,
      onAsyncLayersReady: () => {
        const app = appRef.current;
        if (app) app.render();
        propsRef.current.onLayersGpuReady?.();
      },
    });
  };

  useEffect(() => {
    if (!sceneRef.current) return;
    const cr = sceneRef.current.cameraRoot;
    const w = props.width;
    const h = props.height;
    const cam = props.cameraTransform;
    if (!cam) {
      cr.pivot.set(0, 0);
      cr.position.set(0, 0);
      cr.scale.set(1, 1);
      cr.rotation = 0;
      return;
    }
    cr.pivot.set(w / 2, h / 2);
    cr.position.set(w / 2 + cam.panX, h / 2 + cam.panY);
    cr.scale.set(cam.zoom, cam.zoom);
    cr.rotation = (cam.rotationDeg * Math.PI) / 180;
  }, [props.cameraTransform, props.width, props.height]);

  // Main sync effect
  useEffect(() => {
    renderSceneRef.current();
  }, [
    props.panelLayers,
    props.onionBeforeStacks,
    props.onionAfterStacks,
    props.onionBeforeColor,
    props.onionAfterColor,
    props.onionBeforeOpacities,
    props.onionAfterOpacities,
    props.underlayStacks,
    props.activeLayerId,
    props.selectedStrokeIndices,
    props.dragOffset,
    props.selectionBounds,
    props.selectionMarquee,
    props.resizeState,
    props.getBrushConfig,
    props.onionSkinEnabled,
    props.layerTransform,
  ]);

  useImperativeHandle(ref, () => ({
    updateActiveStroke: (stroke: Stroke | null) => {
      if (!sceneRef.current) return;
      const layer = sceneRef.current.activeStrokeLayer;
      
      // Clear previous active stroke graphics
      sceneRef.current.activeStrokeGraphics.clear();
      // Clear previous active stroke container (if any)
      while(layer.children.length > 1) {
        const child = layer.getChildAt(1);
        layer.removeChild(child).destroy({ children: true, texture: false, baseTexture: false });
      }
      
      if (stroke) {
        const config = stroke.brushConfig || props.getBrushConfig(stroke.preset);
        if (config.textureBase64) {
           const c = new PIXI.Container();
           drawStampsToContainer(c, stroke, config);
           if (stroke.tool === 'eraser') {
             c.children.forEach(s => (s as PIXI.Sprite).blendMode = PIXI.BLEND_MODES.ERASE);
           }
           layer.addChild(c);
        } else {
           const g = sceneRef.current.activeStrokeGraphics;
           g.blendMode = stroke.tool === 'eraser' ? PIXI.BLEND_MODES.ERASE : PIXI.BLEND_MODES.NORMAL;
           drawStrokeToGraphics(g, stroke, config);
        }
      }
    },
    getCanvasElement: () => {
      return canvasRef.current;
    },
    syncRender: () => {
      const app = appRef.current;
      if (app) app.render();
    },
    getStageThumbnailJpegDataUrl: () => {
      const app = appRef.current;
      const scene = sceneRef.current;
      if (!app || !scene) return null;
      try {
        app.render();
        const src = app.renderer.extract.canvas(scene.root);
        const thumb = document.createElement('canvas');
        thumb.width = 160;
        thumb.height = 90;
        const ctx = thumb.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 160, 90);
        ctx.drawImage(src as unknown as CanvasImageSource, 0, 0, 160, 90);
        return thumb.toDataURL('image/jpeg', 0.55);
      } catch {
        return null;
      }
    },
  }));

  return (
    <div 
      className="absolute top-0 left-0 bg-neutral-900 shadow-2xl border border-neutral-600 origin-top-left touch-none select-none"
      style={{ 
        width: props.width, 
        height: props.height, 
        transform: `scale(${props.zoom})`,
        cursor: props.isSpacePanning ? (props.isPanningRef.current ? 'grabbing' : 'grab') : 'crosshair'
      }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerOut={props.onPointerUp}
      onPointerCancel={props.onPointerUp}
      onContextMenu={props.onContextMenu}
    >
      <div className="absolute inset-0 sb-canvas-transparency-grid pointer-events-none" aria-hidden />
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 pointer-events-none" 
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
});
