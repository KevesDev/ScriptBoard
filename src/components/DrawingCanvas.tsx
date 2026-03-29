import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useAppStore, defaultBrushes } from '../store/appStore';
import type { Layer, BrushConfig } from '@common/models';
import { renderBrushStrokeToContext, BrushTextureManager } from '../engine/BrushEngine';
import { StoryboardEngine } from '../engine/StoryboardEngine';
import { sampleCameraAtTime, sampleLayerAtTime } from '../lib/timelineKeyframes';
import { getStoryboardCompositionAtTime, getTopStoryboardPanelIdAtTime } from '../lib/timelineStoryboardComposition';
import { collectOnionNeighborStacks, computeOnionOpacities } from '../lib/onionSkinNeighbors';
import { buildStoryboardTimeline, type FlatPanelLayout } from '../lib/timelineLayout';
import { STORYBOARD_CLIPBOARD_STORAGE_KEY, parseStoryboardClipboard, serializeStoryboardClipboard, offsetStrokesBy, selectionBoundsFromStrokes } from '../lib/storyboardClipboard';
import { computeVectorBucketFillPaths, applyRasterBucketFromCompositeCanvas } from '../lib/vectorPaintBucket';
import { panelLayersHaveDrawableContent, countInkPixelsInStoryboardThumbnailDataUrl } from '../lib/storyboardThumbnailSafety';
import { Logger } from '../lib/logger';

import { StoryboardToolbar, StoryboardTopBar, StoryboardSidebar, type ToolType, type BrushPreset, type BucketMode } from './storyboard/StoryboardUI';

const THUMB_MIN_INK_PIXELS = 8;
const THUMB_EXISTING_MIN_LEN = 200;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export const DrawingCanvas = () => {
  const projectState = useProjectStore();
  const { project, activePanelId, activeLayerId, timelinePlayheadSec, updateLayerStrokes, commitHistory } = projectState;
  const { preferences } = useAppStore();

  const [tool, setTool] = useState<ToolType>((preferences.brushSettings?.lastTool as ToolType) || 'pen');
  const [brushPreset, setBrushPreset] = useState<BrushPreset>((preferences.brushSettings?.lastPreset as BrushPreset) || 'solid');
  const [color, setColor] = useState(preferences.brushSettings?.lastColor || '#000000');
  const [brushSize, setBrushSize] = useState(preferences.brushSettings?.lastSize || 5);
  const [zoom, setZoom] = useState(0.5);

  const [selectedStrokeIndices, setSelectedStrokeIndices] = useState<Set<number>>(new Set());
  const [activeShapeTool, setActiveShapeTool] = useState<'line' | 'rectangle' | 'ellipse'>('line');
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [onionSkinEnabled, setOnionSkinEnabled] = useState(() => preferences.onionSkin?.startEnabled ?? false);
  
  const [bucketMode, setBucketMode] = useState<BucketMode>('all');
  const [showBucketMenu, setShowBucketMenu] = useState(false);
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(288); 

  const workspaceRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StoryboardEngine | null>(null);
  const thumbnailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPanningRef = useRef(false);
  const selectionRef = useRef(selectedStrokeIndices); selectionRef.current = selectedStrokeIndices;
  const activePanelRef = useRef(activePanelId); activePanelRef.current = activePanelId;
  const activeLayerRef = useRef(activeLayerId); activeLayerRef.current = activeLayerId;
  const isSpacePanningRef = useRef(isSpacePanning); isSpacePanningRef.current = isSpacePanning;

  const swatches = project?.swatches || ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'];

  const cameraTransform = useMemo(() => project?.timeline?.cameraKeyframes?.length ? sampleCameraAtTime(timelinePlayheadSec, project.timeline.cameraKeyframes) : null, [project?.timeline?.cameraKeyframes, timelinePlayheadSec]);
  const layerTransform = useMemo(() => {
    if (!project?.timeline || !activePanelId || !activeLayerId) return null;
    const list = project.timeline.layerKeyframes;
    if (!list.some((k) => k.panelId === activePanelId && k.layerId === activeLayerId)) return null;
    return sampleLayerAtTime(timelinePlayheadSec, activePanelId, activeLayerId, list);
  }, [project?.timeline, activePanelId, activeLayerId, timelinePlayheadSec]);

  const { underlayStacks, panelLayersForCanvas, activePanelExists } = useMemo(() => {
    if (!project || !activePanelId) return { underlayStacks: [], panelLayersForCanvas: [], activePanelExists: false };
    let sceneLayers: Layer[] = [];
    let exists = false;
    for (const scene of project.scenes) {
      const panel = scene.panels.find((p) => p.id === activePanelId);
      if (panel) { sceneLayers = panel.layers; exists = true; break; }
    }
    const topAtPlayhead = getTopStoryboardPanelIdAtTime(project, timelinePlayheadSec);
    if (topAtPlayhead !== activePanelId) return { underlayStacks: [], panelLayersForCanvas: sceneLayers, activePanelExists: exists };
    const comp = getStoryboardCompositionAtTime(project, timelinePlayheadSec);
    const topIdx = comp.findIndex(s => s.panelId === activePanelId);
    if (topIdx >= 0) return { underlayStacks: comp.slice(0, topIdx).map((s) => s.layers), panelLayersForCanvas: sceneLayers, activePanelExists: exists };
    return { underlayStacks: [], panelLayersForCanvas: sceneLayers, activePanelExists: exists };
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

  const handleZoomIn = useCallback(() => setZoom(z => Math.min(3, z + 0.1)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(0.1, z - 0.1)), []);
  const fitToScreen = useCallback(() => {
    if (workspaceRef.current) {
      setZoom(Math.min(Math.min((workspaceRef.current.clientWidth - 64) / CANVAS_WIDTH, (workspaceRef.current.clientHeight - 64) / CANVAS_HEIGHT), 1.5));
    }
  }, []);

  useEffect(() => {
    if (activePanelExists && activePanelId && !activeLayerId && panelLayersForCanvas.length === 0) {
      Logger.warn('DrawingCanvas', 'Active panel contains 0 layers. Auto-generating default Vector layer.');
      useProjectStore.getState().addLayer(activePanelId, 'vector');
    }
  }, [activePanelExists, activePanelId, activeLayerId, panelLayersForCanvas.length]);

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

  const flatPanelsRef = useRef<FlatPanelLayout[]>([]);
  useEffect(() => {
     if (project) flatPanelsRef.current = buildStoryboardTimeline(project).flatPanels;
  }, [project]);

  const latestRef = useRef({ 
    activePanelId, activeLayerId, panelLayersForCanvas, color, selectedStrokeIndices, 
    commitHistory, updateLayerStrokes, getBrushConfig, updateThumbnail, bucketMode,
    tool, brushPreset, brushSize, zoom, onionSkinPrefs
  });

  useEffect(() => {
    latestRef.current = { 
      activePanelId, activeLayerId, panelLayersForCanvas, color, selectedStrokeIndices, 
      commitHistory, updateLayerStrokes, getBrushConfig, updateThumbnail, bucketMode,
      tool, brushPreset, brushSize, zoom, onionSkinPrefs
    };
  });

  const mountEngine = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      if (!engineRef.current) {
        engineRef.current = new StoryboardEngine({
          container: node,
          width: CANVAS_WIDTH, height: CANVAS_HEIGHT, 
          getBrushConfig: (id) => latestRef.current.getBrushConfig(id),
          onPanStart: () => { setIsSpacePanning(true); isPanningRef.current = true; },
          onColorPicked: (hex) => { setColor(hex); setTool('pen'); },
          
          onBucketFillRequest: (x, y) => {
            const { activePanelId, activeLayerId, panelLayersForCanvas, color, commitHistory, updateLayerStrokes, getBrushConfig, bucketMode } = latestRef.current;
            const layer = panelLayersForCanvas.find((l) => l.id === activeLayerId);
            if (!layer || layer.locked || !activePanelId || !activeLayerId) return;

            if (layer.type === 'vector') {
              setTimeout(() => {
                const L = useProjectStore.getState().project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
                try {
                  const paths = computeVectorBucketFillPaths(L!, x, y, color, CANVAS_WIDTH, CANVAS_HEIGHT, getBrushConfig);
                  if (paths && paths.length > 0) { 
                    commitHistory(); 
                    updateLayerStrokes(activePanelId, activeLayerId, [...(L!.strokes || []), { tool: 'fill', color, width: 1, points: [], fillPaths: paths, seed: Math.floor(Math.random() * 0xffffffff) }]); 
                  } else {
                    Logger.warn('DrawingCanvas', 'Vector fill failed to generate boundaries.');
                  }
                } catch(e) { Logger.error('DrawingCanvas', `Vector Bucket fail: ${e}`); }
              }, 0);
            } else {
              if (bucketMode === 'all') {
                const rawCanvas = node.querySelector('canvas');
                if (!rawCanvas) return;
                const newBase64 = applyRasterBucketFromCompositeCanvas(rawCanvas, x, y, color, CANVAS_WIDTH, CANVAS_HEIGHT);
                if (newBase64) { commitHistory(); useProjectStore.getState().updateLayerDataBase64(activePanelId, activeLayerId, newBase64); }
              } else {
                const off = document.createElement('canvas'); off.width = CANVAS_WIDTH; off.height = CANVAS_HEIGHT;
                const ctx = off.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  if (layer.dataBase64) {
                    const img = new Image();
                    img.onload = () => {
                      ctx.drawImage(img, 0, 0);
                      const newBase64 = applyRasterBucketFromCompositeCanvas(off, x, y, color, CANVAS_WIDTH, CANVAS_HEIGHT);
                      if (newBase64) { commitHistory(); useProjectStore.getState().updateLayerDataBase64(activePanelId, activeLayerId, newBase64); }
                    };
                    img.src = layer.dataBase64;
                  } else {
                    ctx.fillStyle = color; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                    commitHistory(); useProjectStore.getState().updateLayerDataBase64(activePanelId, activeLayerId, off.toDataURL('image/png'));
                  }
                }
              }
            }
          },

          onSelectionChanged: (indices, bounds) => { setSelectedStrokeIndices(indices); engineRef.current?.setSelectionBounds(bounds); },
          onSelectionTransformComplete: (offset, rs) => {
            const { activePanelId, activeLayerId, selectedStrokeIndices, commitHistory, updateLayerStrokes } = latestRef.current;
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
            const { activePanelId, activeLayerId, panelLayersForCanvas, commitHistory, updateLayerStrokes, updateThumbnail } = latestRef.current;
            const layer = panelLayersForCanvas.find(l => l.id === activeLayerId);
            if (!layer || !activePanelId || !activeLayerId) return;
            commitHistory();

            if (layer.type === 'raster') {
              const off = document.createElement('canvas'); off.width = CANVAS_WIDTH; off.height = CANVAS_HEIGHT;
              const ctx = off.getContext('2d');
              if (ctx) {
                const drawRaster = async () => {
                  if (layer.dataBase64) { 
                      const img = new Image(); 
                      await new Promise((r) => { img.onload = r; img.src = layer.dataBase64!; }); 
                      ctx.drawImage(img, 0, 0); 
                  }
                  
                  if (['line', 'rectangle', 'ellipse'].includes(stroke.tool)) {
                    if (stroke.points.length >= 6) {
                        ctx.save();
                        ctx.strokeStyle = stroke.color;
                        ctx.lineWidth = stroke.width;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
                        
                        const x1 = stroke.points[0], y1 = stroke.points[1];
                        const x2 = stroke.points[3], y2 = stroke.points[4];
                        
                        ctx.beginPath();
                        if (stroke.tool === 'line') {
                            ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
                        } else if (stroke.tool === 'rectangle') {
                            ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
                        } else if (stroke.tool === 'ellipse') {
                            const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                            const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
                            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                        }
                        ctx.stroke();
                        ctx.restore();
                    }
                  } else {
                    if (stroke.brushConfig?.textureBase64) await BrushTextureManager.getTexture(stroke.brushConfig.textureBase64, stroke.brushConfig.id);
                    renderBrushStrokeToContext(ctx, stroke, stroke.brushConfig!);
                  }

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
      }
    } else {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    }
  }, []); 

  useEffect(() => {
    engineRef.current?.updateState({
      tool, brushPreset, color, brushSize, activeLayerId, activePanelId, panelLayers: panelLayersForCanvas,
      onionBeforeStacks, onionAfterStacks, underlayStacks, onionSkinEnabled, onionPrefs: onionSkinPrefs,
      onionBeforeOpacities, onionAfterOpacities,
      selectedStrokeIndices, cameraTransform, layerTransform, zoom
    });
  }, [tool, brushPreset, color, brushSize, activeLayerId, activePanelId, panelLayersForCanvas, onionBeforeStacks, onionAfterStacks, onionBeforeOpacities, onionAfterOpacities, underlayStacks, onionSkinEnabled, onionSkinPrefs, selectedStrokeIndices, cameraTransform, layerTransform, zoom]);

  useEffect(() => {
    const handlePlaybackFrame = (e: Event) => {
       const t = (e as CustomEvent).detail.time;
       const proj = useProjectStore.getState().project;
       if (!proj || !engineRef.current) return;

       const { activeLayerId, tool, brushPreset, color, brushSize, onionSkinPrefs, selectedStrokeIndices, zoom } = latestRef.current;

       let newActiveId = getTopStoryboardPanelIdAtTime(proj, t);
       if (!newActiveId) {
           const hasClips = proj.timeline?.storyboardTracks?.some(tr => tr.clips.length > 0);
           if (!hasClips) {
               newActiveId = flatPanelsRef.current.find(x => t >= x.startTime && t < x.endTime)?.id ?? null;
           }
       }

       let sceneLayers: Layer[] = [];
       let underlays: Layer[][] = [];
       
       if (newActiveId) {
          for (const scene of proj.scenes) {
            const panel = scene.panels.find((p) => p.id === newActiveId);
            if (panel) { sceneLayers = panel.layers; break; }
          }
          const comp = getStoryboardCompositionAtTime(proj, t);
          const topIdx = comp.findIndex(s => s.panelId === newActiveId);
          if (topIdx >= 0) {
              underlays = comp.slice(0, topIdx).map(s => s.layers);
          }
       }

       const cam = proj.timeline?.cameraKeyframes?.length ? sampleCameraAtTime(t, proj.timeline.cameraKeyframes) : null;
       const lTrans = (newActiveId && activeLayerId && proj.timeline?.layerKeyframes?.length) ? sampleLayerAtTime(t, newActiveId, activeLayerId, proj.timeline.layerKeyframes) : null;

       engineRef.current.updateState({
          tool, brushPreset, color, brushSize, activeLayerId, 
          activePanelId: newActiveId, 
          panelLayers: sceneLayers,
          onionBeforeStacks: [], onionAfterStacks: [], underlayStacks: underlays, 
          onionSkinEnabled: false, 
          onionPrefs: onionSkinPrefs,
          onionBeforeOpacities: [], onionAfterOpacities: [],
          selectedStrokeIndices, cameraTransform: cam, layerTransform: lTrans, zoom
       });
    };

    window.addEventListener('playback-time-update', handlePlaybackFrame);
    return () => window.removeEventListener('playback-time-update', handlePlaybackFrame);
  }, []);

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

  useEffect(() => {
    const onPanStart = () => { setIsSpacePanning(true); isPanningRef.current = true; };
    const onPanStop = () => { setIsSpacePanning(false); isPanningRef.current = false; };

    const onZoomIn = () => handleZoomIn();
    const onZoomOut = () => handleZoomOut();

    const onDelete = () => {
      const state = useProjectStore.getState();
      const L = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelRef.current)?.layers.find(l => l.id === activeLayerRef.current);
      if (selectionRef.current.size > 0 && L && !L.locked && L.strokes) {
        state.commitHistory();
        state.updateLayerStrokes(activePanelRef.current!, activeLayerRef.current!, L.strokes.filter((_, i) => !selectionRef.current.has(i)));
        setSelectedStrokeIndices(new Set()); 
        engineRef.current?.setSelectionBounds(null);
      }
    };

    const onCopy = () => {
      const state = useProjectStore.getState();
      const L = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelRef.current)?.layers.find(l => l.id === activeLayerRef.current);
      if (selectionRef.current.size > 0 && L?.strokes) {
        const copied = L.strokes.filter((_, i) => selectionRef.current.has(i));
        if (copied.length > 0) { 
          try { localStorage.setItem(STORYBOARD_CLIPBOARD_STORAGE_KEY, serializeStoryboardClipboard(copied)); } catch {} 
        }
      }
    };

    const onCut = () => {
      const state = useProjectStore.getState();
      const L = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelRef.current)?.layers.find(l => l.id === activeLayerRef.current);
      if (selectionRef.current.size > 0 && L?.strokes && !L.locked) {
        const copied = L.strokes.filter((_, i) => selectionRef.current.has(i));
        if (copied.length > 0) {
          try { localStorage.setItem(STORYBOARD_CLIPBOARD_STORAGE_KEY, serializeStoryboardClipboard(copied)); } catch {}
          state.commitHistory(); 
          state.updateLayerStrokes(activePanelRef.current!, activeLayerRef.current!, L.strokes.filter((_, i) => !selectionRef.current.has(i)));
          setSelectedStrokeIndices(new Set()); 
          engineRef.current?.setSelectionBounds(null);
        }
      }
    };

    const onPaste = () => {
      const state = useProjectStore.getState();
      const L = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelRef.current)?.layers.find(l => l.id === activeLayerRef.current);
      let data: string | null = null; 
      try { data = localStorage.getItem(STORYBOARD_CLIPBOARD_STORAGE_KEY); } catch { return; }
      if (!data) return;
      const pasted = parseStoryboardClipboard(data); 
      if (!pasted || pasted.length === 0) return;
      if (!L || L.type !== 'vector' || L.locked) return;
      
      state.commitHistory();
      const existing = L.strokes || []; 
      const shifted = offsetStrokesBy(pasted, 20, 20);
      state.updateLayerStrokes(activePanelRef.current!, activeLayerRef.current!, [...existing, ...shifted]);
      
      const newSel = new Set<number>(); 
      for (let i = 0; i < shifted.length; i++) newSel.add(existing.length + i);
      setSelectedStrokeIndices(newSel); 
      setTool('select');
      const b = selectionBoundsFromStrokes(shifted); 
      if (b) engineRef.current?.setSelectionBounds(b);
    };

    window.addEventListener('shortcut:zoomIn-down', onZoomIn);
    window.addEventListener('shortcut:zoomOut-down', onZoomOut);
    window.addEventListener('shortcut:pan-down', onPanStart);
    window.addEventListener('shortcut:pan-up', onPanStop);
    window.addEventListener('shortcut:space-down', onPanStart);
    window.addEventListener('shortcut:space-up', onPanStop);
    window.addEventListener('shortcut:delete-down', onDelete);
    window.addEventListener('shortcut:copy-down', onCopy);
    window.addEventListener('shortcut:cut-down', onCut);
    window.addEventListener('shortcut:paste-down', onPaste);

    return () => {
      window.removeEventListener('shortcut:zoomIn-down', onZoomIn);
      window.removeEventListener('shortcut:zoomOut-down', onZoomOut);
      window.removeEventListener('shortcut:pan-down', onPanStart);
      window.removeEventListener('shortcut:pan-up', onPanStop);
      window.removeEventListener('shortcut:space-down', onPanStart);
      window.removeEventListener('shortcut:space-up', onPanStop);
      window.removeEventListener('shortcut:delete-down', onDelete);
      window.removeEventListener('shortcut:copy-down', onCopy);
      window.removeEventListener('shortcut:cut-down', onCut);
      window.removeEventListener('shortcut:paste-down', onPaste);
    };
  }, [handleZoomIn, handleZoomOut]);

  if (!project) return <div className="flex h-full items-center justify-center text-neutral-500 bg-[#151515]">No project loaded.</div>;
  if (!activePanelId) return <div className="flex h-full items-center justify-center text-neutral-500 bg-[#151515]">Select a panel from the Outliner to start drawing.</div>;

  return (
    <div className="flex h-full w-full bg-[#1e1e1e] text-neutral-300 overflow-hidden select-none outline-none focus:outline-none">
      
      <StoryboardToolbar 
         tool={tool} setTool={setTool} 
         activeShapeTool={activeShapeTool} setActiveShapeTool={setActiveShapeTool} 
         showShapeMenu={showShapeMenu} setShowShapeMenu={setShowShapeMenu} 
         bucketMode={bucketMode} setBucketMode={setBucketMode}
         showBucketMenu={showBucketMenu} setShowBucketMenu={setShowBucketMenu}
      />

      <div className="flex-1 relative flex flex-col bg-[#1e1e1e] overflow-hidden">
        
        <StoryboardTopBar 
          onionSkinEnabled={onionSkinEnabled} setOnionSkinEnabled={setOnionSkinEnabled} 
          zoom={zoom} setZoom={setZoom} handleZoomIn={handleZoomIn} handleZoomOut={handleZoomOut} fitToScreen={fitToScreen} 
          isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}
        />

        <div 
           className="flex-1 relative overflow-auto bg-[#151515] flex items-center justify-center p-8" 
           ref={workspaceRef}
           onPointerMove={(e) => { if (isPanningRef.current && workspaceRef.current) { workspaceRef.current.scrollLeft -= e.movementX; workspaceRef.current.scrollTop -= e.movementY; } }}
           onPointerUp={() => { if (isSpacePanning) { isPanningRef.current = false; setIsSpacePanning(false); } }}
           onPointerLeave={() => { if (isSpacePanning) { isPanningRef.current = false; setIsSpacePanning(false); } }}
        >
          <div 
             ref={mountEngine}
             className="relative shrink-0 transition-all duration-75 shadow-2xl border border-neutral-600 sb-canvas-transparency-grid" 
             style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom, cursor: isSpacePanning ? (isPanningRef.current ? 'grabbing' : 'grab') : 'crosshair' }} 
          />
        </div>
      </div>

      {isSidebarOpen && (
        <>
          <div 
            className="w-1 cursor-col-resize bg-black hover:bg-blue-500 z-20 shrink-0 transition-colors"
            title="Drag to resize panel"
            onPointerDown={(e) => {
              const startX = e.clientX;
              const startWidth = sidebarWidth;
              const onMove = (moveEvent: PointerEvent) => {
                const newWidth = Math.max(200, Math.min(600, startWidth - (moveEvent.clientX - startX)));
                setSidebarWidth(newWidth);
              };
              const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
            }}
          />
          <div style={{ width: sidebarWidth }} className="shrink-0 flex flex-col z-10 border-l border-black overflow-hidden bg-[#323232]">
            <StoryboardSidebar tool={tool} brushPreset={brushPreset} handleBrushPresetChange={handleBrushPresetChange} brushSize={brushSize} handleBrushSizeChange={handleBrushSizeChange} color={color} handleColorChange={handleColorChange} swatches={swatches} panelLayersForCanvas={panelLayersForCanvas} activeLayerId={activeLayerId} activePanelId={activePanelId} getBrushConfig={getBrushConfig} />
          </div>
        </>
      )}
    </div>
  );
};