import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useAppStore, defaultBrushes } from '../store/appStore';
import type { Stroke, Layer, BrushConfig } from '@common/models';
import { renderBrushStrokeToContext, BrushTextureManager } from '../engine/BrushEngine';
import { StoryboardEngine } from '../engine/StoryboardEngine';
import { sampleCameraAtTime, sampleLayerAtTime } from '../lib/timelineKeyframes';
import { getStoryboardCompositionAtTime, getTopStoryboardPanelIdAtTime } from '../lib/timelineStoryboardComposition';
import { collectOnionNeighborStacks, computeOnionOpacities } from '../lib/onionSkinNeighbors';
import { STORYBOARD_CLIPBOARD_STORAGE_KEY, parseStoryboardClipboard, serializeStoryboardClipboard, offsetStrokesBy, selectionBoundsFromStrokes } from '../lib/storyboardClipboard';
import { computeVectorBucketFillPaths, applyRasterBucketFromCompositeCanvas } from '../lib/vectorPaintBucket';
import { panelLayersHaveDrawableContent, countInkPixelsInStoryboardThumbnailDataUrl } from '../lib/storyboardThumbnailSafety';
import { shouldSuppressStoryboardCanvasGlobalKeys } from '../lib/keyboardTargets';

import { StoryboardToolbar, StoryboardTopBar, StoryboardSidebar, type ToolType, type BrushPreset } from './storyboard/StoryboardUI';

const THUMB_MIN_INK_PIXELS = 8;
const THUMB_EXISTING_MIN_LEN = 200;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export const DrawingCanvas = () => {
  const projectState = useProjectStore();
  const { project, activePanelId, activeLayerId, timelinePlayheadSec, updateLayerStrokes, commitHistory } = projectState;
  const { preferences } = useAppStore();

  const [tool, setTool] = useState<ToolType>((preferences.brushSettings.lastTool as ToolType) || 'pen');
  const [brushPreset, setBrushPreset] = useState<BrushPreset>((preferences.brushSettings.lastPreset as BrushPreset) || 'solid');
  const [color, setColor] = useState(preferences.brushSettings.lastColor || '#000000');
  const [brushSize, setBrushSize] = useState(preferences.brushSettings.lastSize || 5);
  const [zoom, setZoom] = useState(0.5);

  const [selectedStrokeIndices, setSelectedStrokeIndices] = useState<Set<number>>(new Set());
  const [activeShapeTool, setActiveShapeTool] = useState<'line' | 'rectangle' | 'ellipse'>('line');
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [onionSkinEnabled, setOnionSkinEnabled] = useState(() => preferences.onionSkin?.startEnabled ?? false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StoryboardEngine | null>(null);
  const thumbnailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPanningRef = useRef(false);
  const selectionRef = useRef(selectedStrokeIndices); selectionRef.current = selectedStrokeIndices;
  const activePanelRef = useRef(activePanelId); activePanelRef.current = activePanelId;
  const activeLayerRef = useRef(activeLayerId); activeLayerRef.current = activeLayerId;
  const isSpacePanningRef = useRef(isSpacePanning); isSpacePanningRef.current = isSpacePanning;

  const swatches = project?.swatches || ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'];

  // --- DERIVED TIMELINE DATA ---
  const cameraTransform = useMemo(() => project?.timeline?.cameraKeyframes?.length ? sampleCameraAtTime(timelinePlayheadSec, project.timeline.cameraKeyframes) : null, [project?.timeline?.cameraKeyframes, timelinePlayheadSec]);
  const layerTransform = useMemo(() => {
    if (!project?.timeline || !activePanelId || !activeLayerId) return null;
    const list = project.timeline.layerKeyframes;
    if (!list.some((k) => k.panelId === activePanelId && k.layerId === activeLayerId)) return null;
    return sampleLayerAtTime(timelinePlayheadSec, activePanelId, activeLayerId, list);
  }, [project?.timeline, activePanelId, activeLayerId, timelinePlayheadSec]);

  const { underlayStacks, panelLayersForCanvas } = useMemo(() => {
    if (!project || !activePanelId) return { underlayStacks: [], panelLayersForCanvas: [] };
    let sceneLayers: Layer[] = [];
    for (const scene of project.scenes) {
      const panel = scene.panels.find((p) => p.id === activePanelId);
      if (panel) { sceneLayers = panel.layers; break; }
    }
    const topAtPlayhead = getTopStoryboardPanelIdAtTime(project, timelinePlayheadSec);
    if (topAtPlayhead !== activePanelId) return { underlayStacks: [], panelLayersForCanvas: sceneLayers };
    const comp = getStoryboardCompositionAtTime(project, timelinePlayheadSec);
    const topIdx = comp.findIndex(s => s.panelId === activePanelId);
    if (topIdx >= 0) return { underlayStacks: comp.slice(0, topIdx).map((s) => s.layers), panelLayersForCanvas: sceneLayers };
    return { underlayStacks: [], panelLayersForCanvas: sceneLayers };
  }, [project, activePanelId, timelinePlayheadSec]);

  const onionSkinPrefs = preferences.onionSkin ?? { panelsBefore: 1, panelsAfter: 1, previousColor: '#ff6b6b', nextColor: '#4dabf7', nearestOpacityPercent: 35, fadePerStep: 0.65, startEnabled: false };
  const { onionBeforeStacks, onionAfterStacks, onionBeforeOpacities, onionAfterOpacities } = useMemo(() => {
    if (!project || !activePanelId) return { onionBeforeStacks: [], onionAfterStacks: [], onionBeforeOpacities: [], onionAfterOpacities: [] };
    const { before, after } = collectOnionNeighborStacks(project, activePanelId, Math.max(0, Math.min(5, Math.round(onionSkinPrefs.panelsBefore))), Math.max(0, Math.min(5, Math.round(onionSkinPrefs.panelsAfter))));
    const nearest = Math.max(0.05, Math.min(1, (onionSkinPrefs.nearestOpacityPercent ?? 35) / 100));
    const fade = Math.max(0.2, Math.min(1, onionSkinPrefs.fadePerStep ?? 0.65));
    return {
      onionBeforeStacks: before, onionAfterStacks: after,
      onionBeforeOpacities: computeOnionOpacities(before.length, nearest, fade, 'before'),
      onionAfterOpacities: computeOnionOpacities(after.length, nearest, fade, 'after'),
    };
  }, [project, activePanelId, onionSkinPrefs]);

  const getBrushConfig = useCallback((presetId?: string): BrushConfig => {
    if (!presetId) return defaultBrushes['solid'];
    return preferences.customBrushes?.find((b) => b.id === presetId) || defaultBrushes[presetId] || defaultBrushes['solid'];
  }, [preferences.customBrushes]);

  const handleZoomIn = () => setZoom(z => Math.min(3, z + 0.1));
  const handleZoomOut = () => setZoom(z => Math.max(0.1, z - 0.1));
  const fitToScreen = useCallback(() => {
    if (workspaceRef.current) {
      setZoom(Math.min(Math.min((workspaceRef.current.clientWidth - 64) / CANVAS_WIDTH, (workspaceRef.current.clientHeight - 64) / CANVAS_HEIGHT), 1.5));
    }
  }, []);

  useEffect(() => {
    if (activePanelId) {
      const tryFit = () => workspaceRef.current && workspaceRef.current.clientWidth > 100 ? fitToScreen() : setTimeout(tryFit, 50);
      const timer = setTimeout(tryFit, 200); return () => clearTimeout(timer);
    }
  }, [activePanelId, fitToScreen]);

  const updateThumbnail = useCallback(() => {
    if (!activePanelId || !engineRef.current) return;
    if (thumbnailTimeoutRef.current) clearTimeout(thumbnailTimeoutRef.current);
    const panelIdSnapshot = activePanelId;
    
    thumbnailTimeoutRef.current = setTimeout(() => {
      void (async () => {
        const dataUrl = engineRef.current?.getStageThumbnailJpegDataUrl();
        if (!dataUrl) return;
        const st = useProjectStore.getState();
        const panel = st.project?.scenes.flatMap((s) => s.panels).find((p) => p.id === panelIdSnapshot);
        const ink = await countInkPixelsInStoryboardThumbnailDataUrl(dataUrl);
        if (panelLayersHaveDrawableContent(panel?.layers) && ink < THUMB_MIN_INK_PIXELS && panel?.thumbnailBase64 && panel.thumbnailBase64.length > THUMB_EXISTING_MIN_LEN) return;
        if (useProjectStore.getState().activePanelId === panelIdSnapshot) useProjectStore.getState().updatePanelThumbnail(panelIdSnapshot, dataUrl);
      })();
    }, 450);
  }, [activePanelId]);

  // --- ENGINE INITIALIZATION ---
  useEffect(() => {
    if (!canvasRef.current) return;
    engineRef.current = new StoryboardEngine({
      canvas: canvasRef.current, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, getBrushConfig,
      onPanStart: () => { setIsSpacePanning(true); isPanningRef.current = true; },
      onColorPicked: (hex) => { setColor(hex); setTool('pen'); },
      onBucketFillRequest: (x, y) => {
        const layer = panelLayersForCanvas.find((l) => l.id === activeLayerId);
        if (!layer || layer.locked || !activePanelId || !activeLayerId) return;
        if (layer.type === 'vector') {
          setTimeout(() => {
            const L = useProjectStore.getState().project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
            const paths = computeVectorBucketFillPaths(L!, x, y, color, CANVAS_WIDTH, CANVAS_HEIGHT, getBrushConfig);
            if (paths?.length) { commitHistory(); updateLayerStrokes(activePanelId, activeLayerId, [...(L!.strokes || []), { tool: 'fill', color, width: 1, points: [], fillPaths: paths }]); }
          }, 0);
        } else {
          const newBase64 = applyRasterBucketFromCompositeCanvas(canvasRef.current!, x, y, color, CANVAS_WIDTH, CANVAS_HEIGHT);
          if (newBase64) { commitHistory(); useProjectStore.getState().updateLayerDataBase64(activePanelId, activeLayerId, newBase64); }
        }
      },
      onSelectionChanged: (indices, bounds) => { setSelectedStrokeIndices(indices); engineRef.current?.setSelectionBounds(bounds); },
      onSelectionTransformComplete: (offset, rs) => {
        const layer = useProjectStore.getState().project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
        if (!layer || !layer.strokes) return;
        commitHistory();
        const newStrokes = layer.strokes.map((s, i) => {
          if (!selectedStrokeIndices.has(i)) return s;
          const newPoints = [];
          if (rs.active) {
            for (let j = 0; j < s.points.length; j += 3) newPoints.push(rs.originX + (s.points[j] - rs.originX) * rs.scaleX, rs.originY + (s.points[j+1] - rs.originY) * rs.scaleY, s.points[j+2]);
            return { ...s, points: newPoints, width: s.width * ((Math.abs(rs.scaleX) + Math.abs(rs.scaleY)) / 2) };
          } else if (offset) {
            for (let j = 0; j < s.points.length; j += 3) newPoints.push(s.points[j] + offset.x, s.points[j+1] + offset.y, s.points[j+2]);
            return { ...s, points: newPoints };
          }
          return s;
        });
        updateLayerStrokes(activePanelId!, activeLayerId!, newStrokes);
        if (engineRef.current?.internalSelection.bounds) {
          const b = engineRef.current.internalSelection.bounds;
          if (offset) engineRef.current.setSelectionBounds({x: b.x + offset.x, y: b.y + offset.y, w: b.w, h: b.h});
          else if (rs.active) engineRef.current.setSelectionBounds({ x: Math.min(rs.originX, rs.originX + (b.x - rs.originX) * rs.scaleX, rs.originX + (b.x + b.w - rs.originX) * rs.scaleX), y: Math.min(rs.originY, rs.originY + (b.y - rs.originY) * rs.scaleY, rs.originY + (b.y + b.h - rs.originY) * rs.scaleY), w: Math.abs(b.w * rs.scaleX), h: Math.abs(b.h * rs.scaleY) });
        }
      },
      onStrokeComplete: (stroke) => {
        const layer = panelLayersForCanvas.find(l => l.id === activeLayerId);
        if (!layer || !activePanelId || !activeLayerId) return;
        commitHistory();
        if (layer.type === 'raster') {
          const off = document.createElement('canvas'); off.width = CANVAS_WIDTH; off.height = CANVAS_HEIGHT;
          const ctx = off.getContext('2d');
          if (ctx) {
            const drawRaster = async () => {
              if (layer.dataBase64) { const img = new Image(); await new Promise((r) => { img.onload = r; img.src = layer.dataBase64!; }); ctx.drawImage(img, 0, 0); }
              if (stroke.brushConfig?.textureBase64) await BrushTextureManager.getTexture(stroke.brushConfig.textureBase64, stroke.brushConfig.id);
              renderBrushStrokeToContext(ctx, stroke, stroke.brushConfig!);
              useProjectStore.getState().updateLayerDataBase64(activePanelId, activeLayerId, off.toDataURL('image/png'));
              updateThumbnail();
            }; drawRaster();
          }
        } else {
          updateLayerStrokes(activePanelId, activeLayerId, [...(layer.strokes || []), stroke]);
          updateThumbnail();
        }
      }
    });
    return () => { engineRef.current?.destroy(); engineRef.current = null; };
  }, [activePanelId, activeLayerId, panelLayersForCanvas, getBrushConfig, updateLayerStrokes, commitHistory, updateThumbnail, color, selectedStrokeIndices]);

  useEffect(() => {
    engineRef.current?.updateState({
      tool, brushPreset, color, brushSize, activeLayerId, activePanelId, panelLayers: panelLayersForCanvas,
      onionBeforeStacks, onionAfterStacks, underlayStacks, onionSkinEnabled, onionPrefs: onionSkinPrefs,
      selectedStrokeIndices, cameraTransform, layerTransform, zoom
    });
  }, [tool, brushPreset, color, brushSize, activeLayerId, activePanelId, panelLayersForCanvas, onionBeforeStacks, onionAfterStacks, underlayStacks, onionSkinEnabled, onionSkinPrefs, selectedStrokeIndices, cameraTransform, layerTransform, zoom]);

  // --- STATE HANDLERS ---
  const handleColorChange = (c: string) => {
    setColor(c);
    if (selectedStrokeIndices.size > 0 && activePanelId && activeLayerId) {
      commitHistory(); 
      const L = useProjectStore.getState().project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
      if (L?.strokes) updateLayerStrokes(activePanelId, activeLayerId, L.strokes.map((s, i) => (selectedStrokeIndices.has(i) && s.tool !== 'eraser') ? { ...s, color: c } : s));
    }
  };

  const handleBrushSizeChange = (s: number) => {
    setBrushSize(s);
    if (selectedStrokeIndices.size > 0 && activePanelId && activeLayerId) {
      commitHistory(); 
      const L = useProjectStore.getState().project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
      if (L?.strokes) updateLayerStrokes(activePanelId, activeLayerId, L.strokes.map((str, i) => selectedStrokeIndices.has(i) ? { ...str, width: s * 2 } : str));
    }
  };

  const handleBrushPresetChange = (p: BrushPreset) => {
    setBrushPreset(p);
    if (selectedStrokeIndices.size > 0 && activePanelId && activeLayerId) {
      commitHistory(); 
      const L = useProjectStore.getState().project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
      if (L?.strokes) updateLayerStrokes(activePanelId, activeLayerId, L.strokes.map((s, i) => (selectedStrokeIndices.has(i) && s.tool !== 'eraser') ? { ...s, preset: p } : s));
    }
  };

  // --- KEYBOARD SANDBOX ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldSuppressStoryboardCanvasGlobalKeys(e)) return;

      const key = e.key.toLowerCase();
      const comboPieces: string[] = [];
      if (e.ctrlKey || e.metaKey) comboPieces.push('ctrl');
      if (e.shiftKey) comboPieces.push('shift');
      if (e.altKey) comboPieces.push('alt');

      let val = key; if (val === ' ') val = 'space';
      const combo = comboPieces.length > 0 ? `${comboPieces.join('+')}+${val}` : '';
      const sc = preferences.shortcuts;

      if (combo === sc.undo) { e.preventDefault(); useProjectStore.getState().undo(); return; }
      if (combo === sc.redo) { e.preventDefault(); useProjectStore.getState().redo(); return; }
      if (combo === sc.zoomIn) { e.preventDefault(); handleZoomIn(); return; }
      if (combo === sc.zoomOut) { e.preventDefault(); handleZoomOut(); return; }

      if (val === sc.pan || val === 'space') {
        if (!isSpacePanningRef.current) { setIsSpacePanning(true); isPanningRef.current = true; }
        e.preventDefault(); return;
      }

      const state = useProjectStore.getState();
      const resolveL = () => state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelRef.current)?.layers.find(l => l.id === activeLayerRef.current);

      if ((val === 'delete' || val === 'backspace') && selectionRef.current.size > 0) {
        const L = resolveL();
        if (L && !L.locked && L.strokes) {
          e.preventDefault(); state.commitHistory();
          updateLayerStrokes(activePanelRef.current!, activeLayerRef.current!, L.strokes.filter((_, i) => !selectionRef.current.has(i)));
          setSelectedStrokeIndices(new Set()); engineRef.current?.setSelectionBounds(null);
        }
        return;
      }

      if (combo === (sc.copy ?? 'ctrl+c') && selectionRef.current.size > 0) {
        const L = resolveL();
        if (L?.strokes) {
          const copied = L.strokes.filter((_, i) => selectionRef.current.has(i));
          if (copied.length > 0) { e.preventDefault(); try { localStorage.setItem(STORYBOARD_CLIPBOARD_STORAGE_KEY, serializeStoryboardClipboard(copied)); } catch {} }
        }
        return;
      }

      if (combo === (sc.cut ?? 'ctrl+x') && selectionRef.current.size > 0) {
        const L = resolveL();
        if (L?.strokes && !L.locked) {
          const copied = L.strokes.filter((_, i) => selectionRef.current.has(i));
          if (copied.length > 0) {
            e.preventDefault(); try { localStorage.setItem(STORYBOARD_CLIPBOARD_STORAGE_KEY, serializeStoryboardClipboard(copied)); } catch {}
            state.commitHistory(); updateLayerStrokes(activePanelRef.current!, activeLayerRef.current!, L.strokes.filter((_, i) => !selectionRef.current.has(i)));
            setSelectedStrokeIndices(new Set()); engineRef.current?.setSelectionBounds(null);
          }
        }
        return;
      }

      if (combo === (sc.paste ?? 'ctrl+v')) {
        let data: string | null = null; try { data = localStorage.getItem(STORYBOARD_CLIPBOARD_STORAGE_KEY); } catch { return; }
        if (!data) return;
        const pasted = parseStoryboardClipboard(data); if (!pasted || pasted.length === 0) return;
        const L = resolveL(); if (!L || L.type !== 'vector' || L.locked) return;
        e.preventDefault(); state.commitHistory();
        const existing = L.strokes || []; const shifted = offsetStrokesBy(pasted, 20, 20);
        updateLayerStrokes(activePanelRef.current!, activeLayerRef.current!, [...existing, ...shifted]);
        const newSel = new Set<number>(); for (let i = 0; i < shifted.length; i++) newSel.add(existing.length + i);
        setSelectedStrokeIndices(newSel); setTool('select');
        const b = selectionBoundsFromStrokes(shifted); if (b) engineRef.current?.setSelectionBounds(b);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      let val = e.key.toLowerCase(); if (val === ' ') val = 'space';
      if (val === preferences.shortcuts.pan || val === 'space') { setIsSpacePanning(false); isPanningRef.current = false; }
    };

    window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [preferences.shortcuts, updateLayerStrokes]);

  if (!project) return <div className="flex h-full items-center justify-center text-neutral-500 bg-[#151515]">No project loaded.</div>;
  if (!activePanelId) return <div className="flex h-full items-center justify-center text-neutral-500 bg-[#151515]">Select a panel from the Outliner to start drawing.</div>;

  return (
    <div className="flex h-full w-full bg-[#1e1e1e] text-neutral-300 overflow-hidden select-none outline-none focus:outline-none">
      
      <StoryboardToolbar tool={tool} setTool={setTool} activeShapeTool={activeShapeTool} setActiveShapeTool={setActiveShapeTool} showShapeMenu={showShapeMenu} setShowShapeMenu={setShowShapeMenu} />

      <div className="flex-1 relative flex flex-col bg-[#1e1e1e] overflow-hidden">
        
        <StoryboardTopBar onionSkinEnabled={onionSkinEnabled} setOnionSkinEnabled={setOnionSkinEnabled} zoom={zoom} setZoom={setZoom} handleZoomIn={handleZoomIn} handleZoomOut={handleZoomOut} fitToScreen={fitToScreen} />

        <div 
           className="flex-1 relative overflow-auto bg-[#151515] flex items-center justify-center p-8" 
           ref={workspaceRef}
           onPointerMove={(e) => { if (isPanningRef.current && workspaceRef.current) { workspaceRef.current.scrollLeft -= e.movementX; workspaceRef.current.scrollTop -= e.movementY; } }}
           onPointerUp={() => { if (isSpacePanning) { isPanningRef.current = false; setIsSpacePanning(false); } }}
           onPointerLeave={() => { if (isSpacePanning) { isPanningRef.current = false; setIsSpacePanning(false); } }}
        >
          {/* REMOVED bg-white to allow transparency grid to show, rely strictly on CSS scaling so PIXI buffer stays 1920x1080 */}
          <div className="relative shrink-0 transition-all duration-75 shadow-2xl border border-neutral-600 sb-canvas-transparency-grid" style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}>
             <canvas ref={canvasRef} className="absolute inset-0 touch-none w-full h-full" style={{ cursor: isSpacePanning ? (isPanningRef.current ? 'grabbing' : 'grab') : 'crosshair' }} />
          </div>
        </div>
      </div>

      <StoryboardSidebar tool={tool} brushPreset={brushPreset} handleBrushPresetChange={handleBrushPresetChange} brushSize={brushSize} handleBrushSizeChange={handleBrushSizeChange} color={color} handleColorChange={handleColorChange} swatches={swatches} panelLayersForCanvas={panelLayersForCanvas} activeLayerId={activeLayerId} activePanelId={activePanelId} getBrushConfig={getBrushConfig} />
    </div>
  );
};