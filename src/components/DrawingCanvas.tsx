import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useAppStore, defaultBrushes } from '../store/appStore';
import { 
  Pen, Eraser, Undo, Redo, Layers as LayersIcon, 
  Plus, Trash2, MousePointer2, PaintBucket, 
  Minus, Square, Circle, Settings2, Palette,
  Brush, Pencil, PenTool, ZoomIn, ZoomOut, Maximize,
  Eye, EyeOff, ChevronUp, ChevronDown, Pipette,
  Video
} from 'lucide-react';
import type { Stroke, Layer, BrushConfig } from '@common/models';
import { renderBrushStrokeToContext, BrushTextureManager } from '../engine/BrushEngine';
import { PixiWorkspace } from './PixiWorkspace';
import type { PixiWorkspaceRef } from './PixiWorkspace';
import { sampleCameraAtTime, sampleLayerAtTime } from '../lib/timelineKeyframes';
import {
  getStoryboardCompositionAtTime,
  getTopStoryboardPanelIdAtTime,
} from '../lib/timelineStoryboardComposition';
import { collectOnionNeighborStacks, computeOnionOpacities } from '../lib/onionSkinNeighbors';
import {
  STORYBOARD_CLIPBOARD_STORAGE_KEY,
  parseStoryboardClipboard,
  serializeStoryboardClipboard,
  offsetStrokesBy,
  selectionBoundsFromStrokes,
  strokeAnyPointInRect,
  strokeBounds,
} from '../lib/storyboardClipboard';
import {
  computeVectorBucketFillPaths,
  applyRasterBucketFromCompositeCanvas,
} from '../lib/vectorPaintBucket';
import { shouldSuppressStoryboardCanvasGlobalKeys } from '../lib/keyboardTargets';
import {
  panelLayersHaveDrawableContent,
  countInkPixelsInStoryboardThumbnailDataUrl,
} from '../lib/storyboardThumbnailSafety';

/** Avoid saving an all-white Pixi capture over a real thumbnail while GPU textures are still loading. */
const THUMB_MIN_INK_PIXELS = 8;
const THUMB_EXISTING_MIN_LEN = 200;

type ToolType = 'pen' | 'eraser' | 'select' | 'line' | 'rectangle' | 'ellipse' | 'eyedropper' | 'paintbucket';
type BrushPreset = 'solid' | 'pencil' | 'marker' | string;

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export const DrawingCanvas = () => {
  const projectState = useProjectStore();
  const project = projectState.project;
  const activePanelId = projectState.activePanelId;
  const activeLayerId = projectState.activeLayerId;
  const updateLayerStrokes = projectState.updateLayerStrokes;
  const addLayer = projectState.addLayer;
  const removeLayer = projectState.removeLayer;
  const setActiveLayerId = projectState.setActiveLayerId;
  const undoStack = projectState.undoStack;
  const redoStack = projectState.redoStack;
  const undo = projectState.undo;
  const redo = projectState.redo;
  const commitHistory = projectState.commitHistory;
  const updateProjectSwatches = projectState.updateProjectSwatches;
  const updateLayerName = projectState.updateLayerName;
  const toggleLayerVisibility = projectState.toggleLayerVisibility;
  const setLayerOpacity = projectState.setLayerOpacity;
  const moveLayerUp = projectState.moveLayerUp;
  const moveLayerDown = projectState.moveLayerDown;
  const timelinePlayheadSec = projectState.timelinePlayheadSec;

  const cameraTransform = useMemo(() => {
    const kf = project?.timeline?.cameraKeyframes;
    if (!kf?.length) return null;
    return sampleCameraAtTime(timelinePlayheadSec, kf);
  }, [project?.timeline?.cameraKeyframes, timelinePlayheadSec]);

  const layerTransform = useMemo(() => {
    if (!project?.timeline || !activePanelId || !activeLayerId) return null;
    const list = project.timeline.layerKeyframes;
    if (!list.some((k) => k.panelId === activePanelId && k.layerId === activeLayerId)) return null;
    return sampleLayerAtTime(timelinePlayheadSec, activePanelId, activeLayerId, list);
  }, [project?.timeline, activePanelId, activeLayerId, timelinePlayheadSec]);

  const { underlayStacks, panelLayersForCanvas } = useMemo(() => {
    if (!project || !activePanelId) {
      return { underlayStacks: [] as Layer[][], panelLayersForCanvas: [] as Layer[] };
    }

    let sceneLayers: Layer[] = [];
    for (const scene of project.scenes) {
      const panelsSorted = [...scene.panels].sort((a, b) => a.order - b.order);
      const idx = panelsSorted.findIndex((p) => p.id === activePanelId);
      if (idx !== -1) {
        sceneLayers = panelsSorted[idx]!.layers;
        break;
      }
    }

    /** Timeline underlays only when the playhead’s front panel is the one you’re editing; otherwise outliner-driven edits stay isolated. */
    const topAtPlayhead = getTopStoryboardPanelIdAtTime(project, timelinePlayheadSec);
    if (topAtPlayhead !== activePanelId) {
      return { underlayStacks: [], panelLayersForCanvas: sceneLayers };
    }

    const comp = getStoryboardCompositionAtTime(project, timelinePlayheadSec);
    let topIdx = -1;
    for (let i = comp.length - 1; i >= 0; i--) {
      if (comp[i]!.panelId === activePanelId) {
        topIdx = i;
        break;
      }
    }
    if (topIdx >= 0) {
      // Underlays use timeline composition (filtered by clip.layerIds). The editable board must use
      // the panel's full layer stack — otherwise layerIds / stale ids hide strokes while thumbnails
      // (full raster) still look correct.
      return {
        underlayStacks: comp.slice(0, topIdx).map((s) => s.layers),
        panelLayersForCanvas: sceneLayers,
      };
    }

    return { underlayStacks: [], panelLayersForCanvas: sceneLayers };
  }, [project, activePanelId, timelinePlayheadSec]);

  const { preferences } = useAppStore();
  const onionSkinPrefs = preferences.onionSkin ?? {
    panelsBefore: 1,
    panelsAfter: 1,
    previousColor: '#ff6b6b',
    nextColor: '#4dabf7',
    nearestOpacityPercent: 35,
    fadePerStep: 0.65,
    startEnabled: false,
  };
  
  // UI State
  const [tool, setTool] = useState<ToolType>((preferences.brushSettings.lastTool as ToolType) || 'pen');
  const [brushPreset, setBrushPreset] = useState<BrushPreset>((preferences.brushSettings.lastPreset as BrushPreset) || 'solid');
  const [color, setColor] = useState(preferences.brushSettings.lastColor || '#000000');
  const [brushSize, setBrushSize] = useState(preferences.brushSettings.lastSize || 5);
  const [zoom, setZoom] = useState(0.5); // Initial zoom to fit in UI

  // Local active values so we don't bleed tool changes to existing strokes
  const activeToolRef = useRef(tool);
  const activeBrushPresetRef = useRef(brushPreset);
  const activeColorRef = useRef(color);
  const activeBrushSizeRef = useRef(brushSize);

  useEffect(() => { 
    activeToolRef.current = tool; 
    useAppStore.getState().setPreferences({ brushSettings: { ...useAppStore.getState().preferences.brushSettings, lastTool: tool }});
  }, [tool]);
  useEffect(() => { 
    activeBrushPresetRef.current = brushPreset; 
    useAppStore.getState().setPreferences({ brushSettings: { ...useAppStore.getState().preferences.brushSettings, lastPreset: brushPreset }});
  }, [brushPreset]);
  useEffect(() => { 
    activeColorRef.current = color; 
    useAppStore.getState().setPreferences({ brushSettings: { ...useAppStore.getState().preferences.brushSettings, lastColor: color }});
  }, [color]);
  useEffect(() => { 
    activeBrushSizeRef.current = brushSize; 
    useAppStore.getState().setPreferences({ brushSettings: { ...useAppStore.getState().preferences.brushSettings, lastSize: brushSize }});
  }, [brushSize]);

  // Select Tool State
  const [selectedStrokeIndices, setSelectedStrokeIndices] = useState<Set<number>>(new Set());
  const [selectionBounds, setSelectionBounds] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<{sx: number, sy: number, x: number, y: number} | null>(null);
  const [dragOffset, setDragOffset] = useState<{x: number, y: number} | null>(null);
  const [resizeState, setResizeState] = useState<{ active: boolean, handle: 'tl'|'tr'|'bl'|'br'|null, scaleX: number, scaleY: number, originX: number, originY: number }>({ active: false, handle: null, scaleX: 1, scaleY: 1, originX: 0, originY: 0 });
  const isDraggingSelection = useRef(false);
  const dragStartPoint = useRef({ x: 0, y: 0 });
  const selectionMarqueeStart = useRef({ x: 0, y: 0 });

  const [activeShapeTool, setActiveShapeTool] = useState<'line' | 'rectangle' | 'ellipse'>('line');
  const [showShapeMenu, setShowShapeMenu] = useState(false);

  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [onionSkinEnabled, setOnionSkinEnabled] = useState(
    () => useAppStore.getState().preferences.onionSkin?.startEnabled ?? false,
  );

  const { onionBeforeStacks, onionAfterStacks, onionBeforeOpacities, onionAfterOpacities } = useMemo(() => {
    if (!project || !activePanelId) {
      return {
        onionBeforeStacks: [] as Layer[][],
        onionAfterStacks: [] as Layer[][],
        onionBeforeOpacities: [] as number[],
        onionAfterOpacities: [] as number[],
      };
    }
    const maxB = Math.max(0, Math.min(5, Math.round(onionSkinPrefs.panelsBefore)));
    const maxA = Math.max(0, Math.min(5, Math.round(onionSkinPrefs.panelsAfter)));
    const { before, after } = collectOnionNeighborStacks(project, activePanelId, maxB, maxA);
    const nearest = Math.max(0.05, Math.min(1, (onionSkinPrefs.nearestOpacityPercent ?? 35) / 100));
    const fade = Math.max(0.2, Math.min(1, onionSkinPrefs.fadePerStep ?? 0.65));
    return {
      onionBeforeStacks: before,
      onionAfterStacks: after,
      onionBeforeOpacities: computeOnionOpacities(before.length, nearest, fade, 'before'),
      onionAfterOpacities: computeOnionOpacities(after.length, nearest, fade, 'after'),
    };
  }, [project, activePanelId, onionSkinPrefs]);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const selectionRef = useRef(selectedStrokeIndices);
  selectionRef.current = selectedStrokeIndices;
  const activePanelRef = useRef(activePanelId);
  activePanelRef.current = activePanelId;
  const activeLayerRef = useRef(activeLayerId);
  activeLayerRef.current = activeLayerId;
  const isSpacePanningRef = useRef(isSpacePanning);
  isSpacePanningRef.current = isSpacePanning;

  const swatches = project?.swatches || [
    '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
    '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#9900ff', '#ff00ff'
  ];

  // Canvas Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const thumbnailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Zoom Handlers
  const handleZoomIn = () => setZoom(z => Math.min(3, z + 0.1));
  const handleZoomOut = () => setZoom(z => Math.max(0.1, z - 0.1));
  
  const handleColorChange = (newColor: string) => {
    setColor(newColor);
    
    // If we have an active selection, override the color of selected strokes
    if (selectedStrokeIndices.size > 0 && activePanelId && activeLayerId) {
      // Save history before modifying
      commitHistory(); 
      const state = useProjectStore.getState();
      const currentLayer = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
      
      if (currentLayer && currentLayer.strokes) {
        const newStrokes = currentLayer.strokes.map((s, i) => {
          if (selectedStrokeIndices.has(i) && s.tool !== 'eraser') {
            return { ...s, color: newColor };
          }
          return s;
        });
        updateLayerStrokes(activePanelId, activeLayerId, newStrokes);
      }
    }
  };

  const handleBrushSizeChange = (newSize: number) => {
    setBrushSize(newSize);
    
    if (selectedStrokeIndices.size > 0 && activePanelId && activeLayerId) {
      // Save history before modifying
      commitHistory(); 
      const state = useProjectStore.getState();
      const currentLayer = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
      
      if (currentLayer && currentLayer.strokes) {
        const newStrokes = currentLayer.strokes.map((s, i) => {
          if (selectedStrokeIndices.has(i)) {
            return { ...s, width: newSize * 2 };
          }
          return s;
        });
        updateLayerStrokes(activePanelId, activeLayerId, newStrokes);
      }
    }
  };

  const handleBrushPresetChange = (preset: BrushPreset) => {
    setBrushPreset(preset);
    
    if (selectedStrokeIndices.size > 0 && activePanelId && activeLayerId) {
      // Save history before modifying
      commitHistory(); 
      const state = useProjectStore.getState();
      const currentLayer = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
      
      if (currentLayer && currentLayer.strokes) {
        const newStrokes = currentLayer.strokes.map((s, i) => {
          if (selectedStrokeIndices.has(i) && s.tool !== 'eraser') {
            return { ...s, preset };
          }
          return s;
        });
        updateLayerStrokes(activePanelId, activeLayerId, newStrokes);
      }
    }
  };

  const fitToScreen = () => {
    if (workspaceRef.current) {
      const { clientWidth, clientHeight } = workspaceRef.current;
      const padding = 64; // 32px padding on each side
      const scaleX = (clientWidth - padding) / CANVAS_WIDTH;
      const scaleY = (clientHeight - padding) / CANVAS_HEIGHT;
      // Set to whichever scale is smaller to ensure it fits entirely, but cap at 1.5x max
      setZoom(Math.min(Math.min(scaleX, scaleY), 1.5));
    }
  };

  // Wait for the layout system to settle before auto-fitting
  useEffect(() => {
    if (activePanelId && workspaceRef.current) {
      // If the container is too small (e.g. flexlayout is still initializing), 
      // defer fitting until it has a reasonable size.
      const tryFit = () => {
         if (workspaceRef.current && workspaceRef.current.clientWidth > 100) {
            fitToScreen();
         } else {
            setTimeout(tryFit, 50);
         }
      };
      
      const timer = setTimeout(tryFit, 200);
      return () => clearTimeout(timer);
    }
  }, [activePanelId]);

  // Stable identity: PixiWorkspace rebuilds all layers when this reference changes; a new function every render
  // aborted async Texture.from loads and left the board blank while thumbnails still updated later.
  const getBrushConfig = useCallback((presetId?: string): BrushConfig => {
    if (!presetId) return defaultBrushes['solid'];
    const custom = preferences.customBrushes?.find((b) => b.id === presetId);
    if (custom) return custom;
    return defaultBrushes[presetId] || defaultBrushes['solid'];
  }, [preferences.customBrushes]);

  // Drawing State (Not in React state to avoid lag)
  const isDrawing = useRef(false);
  const activePointsRef = useRef<number[]>([]);

  /** Focus target for storyboard-only keyboard routing (not window). ProseMirror is outside this subtree, so its key events never hit these listeners. */
  const storyboardKeyboardRootRef = useRef<HTMLDivElement | null>(null);

  const focusStoryboardKeyboardRoot = useCallback((e: React.PointerEvent) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (
      t.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [contenteditable="plaintext-only"]',
      )
    ) {
      return;
    }
    storyboardKeyboardRootRef.current?.focus({ preventScroll: true });
  }, []);

  // Modifier chords stay on window (user may expect undo while focus is ambiguous) but must not run in script/inputs.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const root = storyboardKeyboardRootRef.current;
      if (!root || !root.isConnected || root.offsetParent === null) return;
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      if (shouldSuppressStoryboardCanvasGlobalKeys(e)) return;

      const key = e.key.toLowerCase();
      const comboPieces: string[] = [];
      if (e.ctrlKey || e.metaKey) comboPieces.push('ctrl');
      if (e.shiftKey) comboPieces.push('shift');
      if (e.altKey) comboPieces.push('alt');

      let val = key;
      if (val === ' ') val = 'space';

      const combo = comboPieces.length > 0 ? `${comboPieces.join('+')}+${val}` : '';
      const sc = preferences.shortcuts;

      if (combo && combo === sc.undo) {
        e.preventDefault();
        useProjectStore.getState().undo();
        return;
      }
      if (combo && combo === sc.redo) {
        e.preventDefault();
        useProjectStore.getState().redo();
        return;
      }
      if (combo && combo === sc.zoomIn) {
        e.preventDefault();
        setZoom((z) => Math.min(3, z + 0.1));
        return;
      }
      if (combo && combo === sc.zoomOut) {
        e.preventDefault();
        setZoom((z) => Math.max(0.1, z - 0.1));
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preferences.shortcuts]);

  // Delete / Backspace / copy / cut / paste / space-pan: only when focus is inside the storyboard panel (DOM-scoped, not heuristic).
  useEffect(() => {
    const resolveActiveLayer = (panelId: string | null, layerId: string | null): Layer | undefined => {
      const st = useProjectStore.getState();
      if (!st.project || !panelId || !layerId) return undefined;
      for (const scene of st.project.scenes) {
        const panel = scene.panels.find((p) => p.id === panelId);
        if (panel) return panel.layers.find((l) => l.id === layerId);
      }
      return undefined;
    };

    const root = storyboardKeyboardRootRef.current;
    if (!root || !root.isConnected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (root.offsetParent === null) return;

      const key = e.key.toLowerCase();
      const comboPieces: string[] = [];
      if (e.ctrlKey || e.metaKey) comboPieces.push('ctrl');
      if (e.shiftKey) comboPieces.push('shift');
      if (e.altKey) comboPieces.push('alt');

      let val = key;
      if (val === ' ') val = 'space';

      const combo = comboPieces.length > 0 ? `${comboPieces.join('+')}+${val}` : '';
      const sc = preferences.shortcuts;

      if (val === sc.pan && !isSpacePanningRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setIsSpacePanning(true);
      }

      const panelId = activePanelRef.current;
      const layerId = activeLayerRef.current;
      const selected = selectionRef.current;
      const store = useProjectStore.getState();

      if ((val === 'delete' || val === 'backspace') && selected.size > 0 && panelId && layerId) {
        const currentLayer = resolveActiveLayer(panelId, layerId);
        if (currentLayer?.locked) return;
        const strokes = currentLayer?.strokes;
        if (
          strokes &&
          strokes.length > 0 &&
          [...selected].some((i) => Number.isInteger(i) && i >= 0 && i < strokes.length)
        ) {
          e.preventDefault();
          e.stopPropagation();
          store.commitHistory();
          store.updateLayerStrokes(
            panelId,
            layerId,
            strokes.filter((_, i) => !selected.has(i)),
          );
          setSelectedStrokeIndices(new Set());
          setSelectionBounds(null);
        }
        return;
      }

      if (combo && combo === (sc.copy ?? 'ctrl+c') && selected.size > 0 && panelId && layerId) {
        const currentLayer = resolveActiveLayer(panelId, layerId);
        if (currentLayer?.strokes) {
          const copiedStrokes = currentLayer.strokes.filter((_, i) => selected.has(i));
          if (copiedStrokes.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            try {
              localStorage.setItem(STORYBOARD_CLIPBOARD_STORAGE_KEY, serializeStoryboardClipboard(copiedStrokes));
            } catch {
              /* private mode / quota */
            }
          }
        }
        return;
      }

      if (combo && combo === (sc.cut ?? 'ctrl+x') && selected.size > 0 && panelId && layerId) {
        const currentLayer = resolveActiveLayer(panelId, layerId);
        if (currentLayer?.locked) return;
        if (currentLayer?.strokes) {
          const copiedStrokes = currentLayer.strokes.filter((_, i) => selected.has(i));
          if (copiedStrokes.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            try {
              localStorage.setItem(STORYBOARD_CLIPBOARD_STORAGE_KEY, serializeStoryboardClipboard(copiedStrokes));
            } catch {
              /* private mode / quota */
            }
            store.commitHistory();
            store.updateLayerStrokes(
              panelId,
              layerId,
              currentLayer.strokes.filter((_, i) => !selected.has(i)),
            );
            setSelectedStrokeIndices(new Set());
            setSelectionBounds(null);
          }
        }
        return;
      }

      if (combo && combo === (sc.paste ?? 'ctrl+v') && panelId && layerId) {
        let clipboardData: string | null = null;
        try {
          clipboardData = localStorage.getItem(STORYBOARD_CLIPBOARD_STORAGE_KEY);
        } catch {
          return;
        }
        if (!clipboardData) return;

        const pastedStrokes = parseStoryboardClipboard(clipboardData);
        if (!pastedStrokes || pastedStrokes.length === 0) return;

        const currentLayer = resolveActiveLayer(panelId, layerId);
        if (!currentLayer || currentLayer.type !== 'vector' || currentLayer.locked) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        store.commitHistory();
        const existingStrokes = currentLayer.strokes || [];
        const shifted = offsetStrokesBy(pastedStrokes, 20, 20);
        store.updateLayerStrokes(panelId, layerId, [...existingStrokes, ...shifted]);

        const newSelection = new Set<number>();
        for (let i = 0; i < shifted.length; i++) {
          newSelection.add(existingStrokes.length + i);
        }
        setSelectedStrokeIndices(newSelection);
        setTool('select');
        const b = selectionBoundsFromStrokes(shifted);
        if (b) setSelectionBounds(b);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (root.offsetParent === null) return;

      let val = e.key.toLowerCase();
      if (val === ' ') val = 'space';
      if (val === preferences.shortcuts.pan || val === ' ') {
        setIsSpacePanning(false);
        isPanningRef.current = false;
      }
    };

    root.addEventListener('keydown', handleKeyDown);
    root.addEventListener('keyup', handleKeyUp);
    return () => {
      root.removeEventListener('keydown', handleKeyDown);
      root.removeEventListener('keyup', handleKeyUp);
    };
  }, [preferences.shortcuts, project?.id, activePanelId]);

  // Derived Project State
  let currentStrokes: Stroke[] = [];
  let panelLayers: Layer[] = [];
  
  if (project && activePanelId) {
    for (const scene of project.scenes) {
      const panel = scene.panels.find(p => p.id === activePanelId);
      if (panel) {
        panelLayers = panel.layers || [];
        const layer = panel.layers.find(l => l.id === activeLayerId);
        if (layer) currentStrokes = layer.strokes || [];
        break;
      }
    }
  }

  const pixiWorkspaceRef = useRef<PixiWorkspaceRef>(null);

  // Thumbnail: render via Pixi extract (reading the WebGL view canvas alone often yields blank frames).
  const updateThumbnail = () => {
    if (!activePanelId || !pixiWorkspaceRef.current) return;
    if (thumbnailTimeoutRef.current) clearTimeout(thumbnailTimeoutRef.current);
    const panelIdSnapshot = activePanelId;
    thumbnailTimeoutRef.current = setTimeout(() => {
      void (async () => {
        const ref = pixiWorkspaceRef.current;
        if (!ref || !panelIdSnapshot) return;

        const st = useProjectStore.getState();
        const panel = st.project?.scenes.flatMap((s) => s.panels).find((p) => p.id === panelIdSnapshot);
        const layers = panel?.layers;
        const expectsArt = panelLayersHaveDrawableContent(layers);
        const existing = panel?.thumbnailBase64;

        ref.syncRender?.();
        const dataUrl = ref.getStageThumbnailJpegDataUrl?.() ?? null;
        if (!dataUrl) return;

        const ink = await countInkPixelsInStoryboardThumbnailDataUrl(dataUrl);
        if (
          expectsArt &&
          ink < THUMB_MIN_INK_PIXELS &&
          existing &&
          existing.length > THUMB_EXISTING_MIN_LEN
        ) {
          return;
        }

        const latest = useProjectStore.getState();
        if (latest.activePanelId !== panelIdSnapshot) return;
        latest.updatePanelThumbnail(panelIdSnapshot, dataUrl);
      })();
    }, 450);
  };

  const drawWetCanvas = () => {
    if (tool === 'select') return;
    
    if (activePointsRef.current.length === 0) {
      pixiWorkspaceRef.current?.updateActiveStroke(null);
      return;
    }

    const activeStroke: Stroke = {
      tool: activeToolRef.current as 'pen' | 'eraser' | 'line' | 'rectangle' | 'ellipse',
      preset: activeToolRef.current === 'eraser' ? undefined : activeBrushPresetRef.current,
      color: activeToolRef.current === 'eraser' ? '#ffffff' : activeColorRef.current,
      width: activeBrushSizeRef.current * 2,
      points: [...activePointsRef.current],
      brushConfig: getBrushConfig(activeToolRef.current === 'eraser' ? undefined : activeBrushPresetRef.current)
    };
    
    pixiWorkspaceRef.current?.updateActiveStroke(activeStroke);
  };

  // Effect to rebuild the dry canvas anytime layer strokes or visibility changes
  useEffect(() => {
    updateThumbnail();
  }, [
    panelLayers,
    preferences.brushSettings,
    selectedStrokeIndices,
    dragOffset,
    activeLayerId,
    activePanelId,
    onionSkinEnabled,
  ]);

  const getCanvasPoint = (e: React.PointerEvent<HTMLDivElement> | PointerEvent | React.MouseEvent) => {
    const canvas = pixiWorkspaceRef.current?.getCanvasElement();
    // Fallback to workspace container if canvas not ready
    const element = canvas || workspaceRef.current;
    if (!element) return { x: 0, y: 0 };
    
    const rect = element.getBoundingClientRect();
    // getBoundingClientRect() already returns the scaled screen dimensions.
    // If we multiply rect.width by zoom again, we double-scale the offset.
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activePanelId || !activeLayerId) {
      return;
    }
    
    // Middle mouse button or Spacebar for panning
    if (e.button === 1 || isSpacePanning) {
      isPanningRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Only allow left click (or touch/pen) for drawing/selecting
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    if (tool === 'eyedropper') {
      const { x, y } = getCanvasPoint(e);
      const canvas = pixiWorkspaceRef.current?.getCanvasElement();
      if (canvas) {
        const offscreen = document.createElement('canvas');
        offscreen.width = CANVAS_WIDTH;
        offscreen.height = CANVAS_HEIGHT;
        const ctx = offscreen.getContext('2d');
        if (ctx) {
          ctx.drawImage(canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          const pixel = ctx.getImageData(x, y, 1, 1).data;
          if (pixel[3] > 0) { // Not transparent
            const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, '0')).join('');
            handleColorChange(hex);
            setTool('pen'); // Auto switch back to pen
          }
        }
      }
      return;
    }

    if (tool === 'paintbucket') {
      const { x, y } = getCanvasPoint(e);
      const layer = panelLayers.find((l) => l.id === activeLayerId);
      if (!layer || layer.locked || !activePanelId || !activeLayerId) return;

      if (layer.type === 'vector') {
        const panelId = activePanelId;
        const layerId = activeLayerId;
        const fillColor = color;
        window.setTimeout(() => {
          const st = useProjectStore.getState();
          const proj = st.project;
          if (!proj) return;
          let L: Layer | undefined;
          for (const scene of proj.scenes) {
            const p = scene.panels.find((pp) => pp.id === panelId);
            if (p) {
              L = p.layers.find((l) => l.id === layerId);
              break;
            }
          }
          if (!L || L.type !== 'vector' || L.locked) return;
          const paths = computeVectorBucketFillPaths(
            L,
            x,
            y,
            fillColor,
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
            getBrushConfig,
          );
          if (!paths?.length) return;
          st.commitHistory();
          const newStroke: Stroke = {
            tool: 'fill',
            color: fillColor,
            width: 1,
            points: [],
            fillPaths: paths,
          };
          st.updateLayerStrokes(panelId, layerId, [...(L.strokes || []), newStroke]);
        }, 0);
        return;
      }

      const pixiCanvas = pixiWorkspaceRef.current?.getCanvasElement();
      if (!pixiCanvas) return;
      pixiWorkspaceRef.current?.syncRender();
      const newBase64 = applyRasterBucketFromCompositeCanvas(
        pixiCanvas,
        x,
        y,
        color,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
      );
      if (newBase64) {
        commitHistory();
        useProjectStore.getState().updateLayerDataBase64(activePanelId, activeLayerId, newBase64);
      }
      return;
    }

    if (tool === 'select') {
      const { x, y } = getCanvasPoint(e);
      
      // Check resize handles first
      if (selectionBounds) {
        const handleSize = 10;
        const b = selectionBounds;
        const handles = [
          { type: 'tl', x: b.x, y: b.y },
          { type: 'tr', x: b.x + b.w, y: b.y },
          { type: 'bl', x: b.x, y: b.y + b.h },
          { type: 'br', x: b.x + b.w, y: b.y + b.h }
        ];
        
        for (const h of handles) {
          if (x >= h.x - handleSize && x <= h.x + handleSize && y >= h.y - handleSize && y <= h.y + handleSize) {
            setResizeState({
              active: true,
              handle: h.type as any,
              scaleX: 1, scaleY: 1,
              originX: h.type.includes('l') ? b.x + b.w : b.x,
              originY: h.type.includes('t') ? b.y + b.h : b.y
            });
            dragStartPoint.current = { x, y };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
        }
      }

      // Check if clicked inside existing selection bounds (for move)
      if (selectionBounds && x >= selectionBounds.x && x <= selectionBounds.x + selectionBounds.w && y >= selectionBounds.y && y <= selectionBounds.y + selectionBounds.h) {
        isDraggingSelection.current = true;
        dragStartPoint.current = { x, y };
      } else {
        // Start a new marquee selection
        setSelectedStrokeIndices(new Set());
        setSelectionBounds(null);
        selectionMarqueeStart.current = { x, y };
        isDrawing.current = true; // reuse isDrawing flag to track mouse down state for marquee
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

  // We removed strict button checks. If the user touches the canvas and they aren't panning, they are drawing.
  e.currentTarget.setPointerCapture(e.pointerId);
  
  // Clear any existing active selection when starting a new tool path
  if (selectedStrokeIndices.size > 0) {
    setSelectedStrokeIndices(new Set());
    setSelectionBounds(null);
    setDragOffset(null);
    setSelectionMarquee(null);
    setResizeState({ active: false, handle: null, scaleX: 1, scaleY: 1, originX: 0, originY: 0 });
  }
  
  // Save history before modifying
    commitHistory(); 
    
    isDrawing.current = true;
    activePointsRef.current = [];
    
    const { x, y } = getCanvasPoint(e);
    // Since we assume intention to draw, if it's not a pen, or pressure is 0, give it a firm 0.5 default.
    // However, for pen tools, if the pressure is indeed 0 (sometimes happens on initial touch), 
    // it's better to default to a small pressure rather than 0.5 to allow build up.
    let pressure = 0.5;
    if (e.pointerType === 'pen') {
      pressure = e.pressure > 0 ? e.pressure : 0.1;
    }
    
    activePointsRef.current.push(x, y, pressure);
    
    // Force a redraw immediately so dots/stamps appear instantly on click
    drawWetCanvas();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activePanelId) return;
    if (isPanningRef.current && workspaceRef.current) {
      const dx = e.movementX;
      const dy = e.movementY;
      
      // Calculate scaled scroll amount based on zoom if needed, 
      // but native scroll coordinates are usually 1:1 with screen pixels
      workspaceRef.current.scrollLeft -= dx;
      workspaceRef.current.scrollTop -= dy;
      
      panStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (tool === 'select') {
      const { x, y } = getCanvasPoint(e);
      
      if (resizeState.active && selectionBounds) {
        // Calculate new scale based on drag distance
        const dx = x - dragStartPoint.current.x;
        const dy = y - dragStartPoint.current.y;
        
        let newScaleX = 1;
        let newScaleY = 1;

        if (resizeState.handle?.includes('r')) newScaleX = (selectionBounds.w + dx) / selectionBounds.w;
        if (resizeState.handle?.includes('l')) newScaleX = (selectionBounds.w - dx) / selectionBounds.w;
        if (resizeState.handle?.includes('b')) newScaleY = (selectionBounds.h + dy) / selectionBounds.h;
        if (resizeState.handle?.includes('t')) newScaleY = (selectionBounds.h - dy) / selectionBounds.h;

        // Prevent inverting or zero scale
        if (Math.abs(newScaleX) < 0.1) newScaleX = 0.1 * Math.sign(newScaleX) || 0.1;
        if (Math.abs(newScaleY) < 0.1) newScaleY = 0.1 * Math.sign(newScaleY) || 0.1;

        // Hold shift for proportional scaling
        if (e.shiftKey) {
          const avgScale = (Math.abs(newScaleX) + Math.abs(newScaleY)) / 2;
          newScaleX = avgScale * Math.sign(newScaleX);
          newScaleY = avgScale * Math.sign(newScaleY);
        }

        setResizeState(prev => ({ ...prev, scaleX: newScaleX, scaleY: newScaleY }));
        return;
      }

      if (isDraggingSelection.current) {
        const dx = x - dragStartPoint.current.x;
        const dy = y - dragStartPoint.current.y;
        setDragOffset({ x: dx, y: dy });
        // The dragging visuals are handled by a useEffect
      } else if (isDrawing.current) {
        // Drawing marquee
        setSelectionMarquee({
          sx: selectionMarqueeStart.current.x,
          sy: selectionMarqueeStart.current.y,
          x,
          y
        });
      }
      return;
    }

    if (!isDrawing.current) return;
    
    // Utilize Coalesced Events for high-frequency tablet input (133Hz+)
    const events = e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
    
    for (const ev of events) {
      const { x, y } = getCanvasPoint(ev as React.PointerEvent | PointerEvent);
      let pressure = 0.5;
      if (ev.pointerType === 'pen') {
        pressure = ev.pressure > 0 ? ev.pressure : 0.1;
      }
      activePointsRef.current.push(x, y, pressure);
    }

    drawWetCanvas();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}

    if (!activePanelId) return;
    if (e.button === 1 || isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }

    if (tool === 'select') {
      if (resizeState.active && selectionBounds && activeLayerId) {
        commitHistory();
        const state = useProjectStore.getState();
        const layer = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
        
        if (layer && layer.strokes) {
          const { scaleX, scaleY, originX, originY } = resizeState;
          
          const newStrokes = layer.strokes.map((s, i) => {
            if (selectedStrokeIndices.has(i)) {
              const newPoints = [];
              for (let j = 0; j < s.points.length; j += 3) {
                const px = s.points[j];
                const py = s.points[j+1];
                
                // Scale point relative to the origin
                const newX = originX + (px - originX) * scaleX;
                const newY = originY + (py - originY) * scaleY;
                
                newPoints.push(newX, newY, s.points[j+2]);
              }
              
              // Also scale stroke width based on average scaling factor
              const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
              return { ...s, points: newPoints, width: s.width * avgScale };
            }
            return s;
          });
          
          updateLayerStrokes(activePanelId, activeLayerId, newStrokes);
          
          // Recompute new selection bounds
          setSelectionBounds({
            x: Math.min(originX, originX + (selectionBounds.x - originX) * scaleX, originX + (selectionBounds.x + selectionBounds.w - originX) * scaleX),
            y: Math.min(originY, originY + (selectionBounds.y - originY) * scaleY, originY + (selectionBounds.y + selectionBounds.h - originY) * scaleY),
            w: Math.abs(selectionBounds.w * scaleX),
            h: Math.abs(selectionBounds.h * scaleY)
          });
        }
        
        setResizeState({ active: false, handle: null, scaleX: 1, scaleY: 1, originX: 0, originY: 0 });
        
      } else if (isDraggingSelection.current) {
        isDraggingSelection.current = false;
        if (dragOffset && activeLayerId) {
          commitHistory();
          const state = useProjectStore.getState();
          const layer = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
          if (layer && layer.strokes) {
            const newStrokes = layer.strokes.map((s, i) => {
              if (selectedStrokeIndices.has(i)) {
                const newPoints = [];
                for (let j = 0; j < s.points.length; j += 3) {
                  newPoints.push(s.points[j] + dragOffset.x, s.points[j+1] + dragOffset.y, s.points[j+2]);
                }
                return { ...s, points: newPoints };
              }
              return s;
            });
            updateLayerStrokes(activePanelId, activeLayerId, newStrokes);
          }
          if (selectionBounds) {
            setSelectionBounds({
              x: selectionBounds.x + dragOffset.x,
              y: selectionBounds.y + dragOffset.y,
              w: selectionBounds.w,
              h: selectionBounds.h
            });
          }
          setDragOffset(null);
        }
      } else if (isDrawing.current) {
        isDrawing.current = false;
        const { x, y } = getCanvasPoint(e);
        const sx = selectionMarqueeStart.current.x;
        const sy = selectionMarqueeStart.current.y;
        
        const minX = Math.min(sx, x);
        const maxX = Math.max(sx, x);
        const minY = Math.min(sy, y);
        const maxY = Math.max(sy, y);
        
        const state = useProjectStore.getState();
        const layer = state.project?.scenes.flatMap(s => s.panels).find(p => p.id === activePanelId)?.layers.find(l => l.id === activeLayerId);
        
        if (layer && layer.strokes && maxX - minX > 5 && maxY - minY > 5) {
          const newSelected = new Set<number>();
          let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
          
          layer.strokes.forEach((stroke, i) => {
            if (!strokeAnyPointInRect(stroke, minX, maxX, minY, maxY)) return;
            newSelected.add(i);
            const b = strokeBounds(stroke);
            if (b) {
              sMinX = Math.min(sMinX, b.minX);
              sMaxX = Math.max(sMaxX, b.maxX);
              sMinY = Math.min(sMinY, b.minY);
              sMaxY = Math.max(sMaxY, b.maxY);
            }
          });
          
        if (newSelected.size > 0) {
          setSelectedStrokeIndices(newSelected);
          setSelectionBounds({ x: sMinX - 10, y: sMinY - 10, w: sMaxX - sMinX + 20, h: sMaxY - sMinY + 20 });
        } else {
          setSelectedStrokeIndices(new Set());
          setSelectionBounds(null);
        }
      } else {
        setSelectedStrokeIndices(new Set());
        setSelectionBounds(null);
      }
      
      setSelectionMarquee(null);
    }
    return;
    }

    if (!isDrawing.current || !activeLayerId) return;
    isDrawing.current = false;
    
    if (activePointsRef.current.length > 0 && activeToolRef.current !== 'select') {
      const newStroke: Stroke = {
        tool: activeToolRef.current as 'pen' | 'eraser' | 'line' | 'rectangle' | 'ellipse',
        preset: activeToolRef.current === 'eraser' ? undefined : activeBrushPresetRef.current,
        color: activeToolRef.current === 'eraser' ? '#ffffff' : activeColorRef.current,
        width: activeBrushSizeRef.current * 2,
        points: [...activePointsRef.current],
        brushConfig: getBrushConfig(activeToolRef.current === 'eraser' ? undefined : activeBrushPresetRef.current)
      };

      const layer = panelLayers.find(l => l.id === activeLayerId);
      if (layer?.type === 'raster') {
        // Raster drawing logic: bake the stroke into a base64 image
        const offscreen = document.createElement('canvas');
        offscreen.width = CANVAS_WIDTH;
        offscreen.height = CANVAS_HEIGHT;
        const ctx = offscreen.getContext('2d');
        
        if (ctx) {
          // Draw existing raster data first
          const drawRasterAndCommit = async () => {
            if (layer.dataBase64) {
              const img = new Image();
              await new Promise((resolve) => {
                img.onload = resolve;
                img.src = layer.dataBase64!;
              });
              ctx.drawImage(img, 0, 0);
            }
            
            // Wait for texture to load if it hasn't
            if (newStroke.brushConfig?.textureBase64) {
              await BrushTextureManager.getTexture(newStroke.brushConfig.textureBase64, newStroke.brushConfig.id);
            }

            // Draw new stroke
            renderBrushStrokeToContext(ctx, newStroke, newStroke.brushConfig!);
            
            // Save to Zustand
            const newBase64 = offscreen.toDataURL('image/png');
            useProjectStore.getState().updateLayerDataBase64(activePanelId, activeLayerId, newBase64);
            updateThumbnail();
          };
          drawRasterAndCommit();
        }
      } else {
        // Vector logic: Commit stroke to Zustand global state
        updateLayerStrokes(activePanelId, activeLayerId, [...currentStrokes, newStroke]);
        updateThumbnail();
      }
    }
    
    activePointsRef.current = [];
    pixiWorkspaceRef.current?.updateActiveStroke(null);

    // If it was an eraser, force a full redraw immediately to ensure the wet canvas override 
    // is properly committed to the dry canvas
    if (tool === 'eraser') {
       updateThumbnail();
    }
  };

  // Clear selection if tool changes
  useEffect(() => {
    if (tool !== 'select') {
      setSelectedStrokeIndices(new Set());
      setSelectionBounds(null);
      setDragOffset(null);
      setSelectionMarquee(null);
    }
  }, [tool]);

  // Draw Selection & Dragging Visuals is now handled by PixiWorkspace

  if (!project) return <div className="flex h-full items-center justify-center text-neutral-500 bg-[#151515]">No project loaded.</div>;
  if (!activePanelId) return <div className="flex h-full items-center justify-center text-neutral-500 bg-[#151515]">Select a panel from the Outliner to start drawing.</div>;

  return (
    <div
      ref={storyboardKeyboardRootRef}
      tabIndex={-1}
      onPointerDownCapture={focusStoryboardKeyboardRoot}
      className="flex h-full w-full bg-[#1e1e1e] text-neutral-300 overflow-hidden select-none outline-none focus:outline-none"
    >
      
      {/* Left Toolbar (Tools) */}
      <div className="w-14 shrink-0 bg-[#323232] border-r border-black flex flex-col items-center py-2 gap-2 shadow-xl z-10">
        <ToolButton icon={<MousePointer2 size={18} />} active={tool === 'select'} onClick={() => setTool('select')} title="Select / Move" />
        <div className="w-8 h-px bg-neutral-600 my-1"></div>
        <ToolButton icon={<Pen size={18} />} active={tool === 'pen'} onClick={() => setTool('pen')} title="Brush / Pen" />
        <ToolButton icon={<Eraser size={18} />} active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser" />
        <ToolButton icon={<Pipette size={18} />} active={tool === 'eyedropper'} onClick={() => setTool('eyedropper')} title="Eyedropper" />
        <ToolButton icon={<PaintBucket size={18} />} active={tool === 'paintbucket'} onClick={() => setTool('paintbucket')} title="Fill Bucket" />
        <div className="w-8 h-px bg-neutral-600 my-1"></div>
        <div className="relative flex flex-col items-center">
          <ToolButton 
            icon={activeShapeTool === 'line' ? <Minus size={18} /> : activeShapeTool === 'rectangle' ? <Square size={18} /> : <Circle size={18} />} 
            active={['line', 'rectangle', 'ellipse'].includes(tool)} 
            onClick={() => { setTool(activeShapeTool); setShowShapeMenu(false); }} 
            onContextMenu={(e) => { e.preventDefault(); setShowShapeMenu(!showShapeMenu); }}
            title="Shapes (Right-click for options)" 
          />
          {showShapeMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowShapeMenu(false)} onContextMenu={(e) => { e.preventDefault(); setShowShapeMenu(false); }}></div>
              <div className="absolute left-full top-0 ml-2 bg-[#282828] border border-black shadow-lg rounded p-1 flex flex-col gap-1 z-50">
                <button onClick={() => { setActiveShapeTool('line'); setTool('line'); setShowShapeMenu(false); }} className={`p-2 rounded hover:bg-[#444] transition-colors ${activeShapeTool === 'line' ? 'text-blue-400 bg-[#333]' : 'text-neutral-300'}`} title="Line"><Minus size={18} /></button>
                <button onClick={() => { setActiveShapeTool('rectangle'); setTool('rectangle'); setShowShapeMenu(false); }} className={`p-2 rounded hover:bg-[#444] transition-colors ${activeShapeTool === 'rectangle' ? 'text-blue-400 bg-[#333]' : 'text-neutral-300'}`} title="Rectangle"><Square size={18} /></button>
                <button onClick={() => { setActiveShapeTool('ellipse'); setTool('ellipse'); setShowShapeMenu(false); }} className={`p-2 rounded hover:bg-[#444] transition-colors ${activeShapeTool === 'ellipse' ? 'text-blue-400 bg-[#333]' : 'text-neutral-300'}`} title="Ellipse"><Circle size={18} /></button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Center Canvas Workspace */}
      <div className="flex-1 relative flex flex-col bg-[#1e1e1e] overflow-hidden" ref={containerRef}>
        
        {/* Top Control Bar */}
        <div className="h-10 bg-[#323232] border-b border-black flex items-center px-4 gap-4 shrink-0 shadow-md z-10">
          <div className="flex items-center gap-1 border-r border-neutral-600 pr-4">
            <button onClick={undo} disabled={undoStack.length === 0} className={`p-1.5 rounded ${undoStack.length > 0 ? 'hover:bg-neutral-600' : 'opacity-30'}`} title="Undo"><Undo size={16} /></button>
            <button onClick={redo} disabled={redoStack.length === 0} className={`p-1.5 rounded ${redoStack.length > 0 ? 'hover:bg-neutral-600' : 'opacity-30'}`} title="Redo"><Redo size={16} /></button>
          </div>
          <div className="flex items-center gap-2 border-r border-neutral-600 pr-4">
            <button 
              onClick={() => setOnionSkinEnabled(!onionSkinEnabled)} 
              className={`p-1.5 rounded transition-colors ${onionSkinEnabled ? 'bg-blue-600 text-white shadow-inner' : 'hover:bg-neutral-600 text-neutral-400 hover:text-white'}`} 
              title="Onion skin (panels before/after). Configure in Preferences → Storyboard."
            >
              <Video size={16} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={handleZoomOut} className="p-1.5 rounded hover:bg-neutral-600 text-neutral-300 hover:text-white" title="Zoom Out"><ZoomOut size={16} /></button>
            <input type="range" min="0.1" max="3" step="0.05" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} className="w-24 accent-blue-500" />
            <button onClick={handleZoomIn} className="p-1.5 rounded hover:bg-neutral-600 text-neutral-300 hover:text-white" title="Zoom In"><ZoomIn size={16} /></button>
            <button onClick={fitToScreen} className="p-1.5 rounded hover:bg-neutral-600 ml-1 text-neutral-400 hover:text-white" title="Fit to Screen"><Maximize size={16} /></button>
            <span className="w-10 text-right font-mono text-neutral-300">{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        {/* The Canvas Canvas Wrapper */}
        <div className="flex-1 relative overflow-auto bg-[#151515] flex items-center justify-center p-8" ref={workspaceRef}>
          {/* Sizing wrapper to ensure scrollbars work perfectly without squishing */}
          <div 
            className="relative shrink-0 transition-all duration-75"
            style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}
          >
              <PixiWorkspace
                ref={pixiWorkspaceRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                zoom={zoom}
                isSpacePanning={isSpacePanning}
                isPanningRef={isPanningRef}
                panelLayers={panelLayersForCanvas}
                underlayStacks={underlayStacks}
                onionBeforeStacks={onionBeforeStacks}
                onionAfterStacks={onionAfterStacks}
                onionBeforeColor={onionSkinPrefs.previousColor}
                onionAfterColor={onionSkinPrefs.nextColor}
                onionBeforeOpacities={onionBeforeOpacities}
                onionAfterOpacities={onionAfterOpacities}
                onionSkinEnabled={onionSkinEnabled}
                activeLayerId={activeLayerId}
                getBrushConfig={getBrushConfig}
                selectedStrokeIndices={selectedStrokeIndices}
                dragOffset={dragOffset}
                selectionBounds={selectionBounds}
                selectionMarquee={selectionMarquee}
                resizeState={resizeState}
                cameraTransform={cameraTransform}
                layerTransform={layerTransform}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onContextMenu={e => e.preventDefault()}
                onLayersGpuReady={updateThumbnail}
              />
          </div>
        </div>
      </div>

      {/* Right Sidebar (Properties & Layers) */}
      <div className="w-72 shrink-0 bg-[#323232] border-l border-black flex flex-col z-10 text-sm overflow-hidden">
        
        {/* Tool Properties Panel */}
        <div className="flex flex-col border-b border-black shrink-0 max-h-[50%] overflow-y-auto custom-scrollbar">
          <div className="bg-[#282828] px-3 py-1.5 text-xs font-bold text-neutral-300 flex items-center gap-2 border-b border-black">
            <Settings2 size={14} /> Tool Properties
          </div>
          
          <div className="p-4 flex flex-col gap-4">
            {(tool === 'pen' || tool === 'eraser') ? (
              <>
                {tool === 'pen' && (
                  <div>
                    <div className="text-xs text-neutral-400 mb-2 uppercase tracking-wider font-semibold">Brushes</div>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      <BrushButton 
                        icon={<PenTool size={18} />} 
                        label="Pen" 
                        active={brushPreset === 'solid'} 
                        onClick={() => handleBrushPresetChange('solid')} 
                      />
                      <BrushButton 
                        icon={<Pencil size={18} />} 
                        label="Pencil" 
                        active={brushPreset === 'pencil'} 
                        onClick={() => handleBrushPresetChange('pencil')} 
                      />
                      <BrushButton 
                        icon={<Brush size={18} />} 
                        label="Marker" 
                        active={brushPreset === 'marker'} 
                        onClick={() => handleBrushPresetChange('marker')} 
                      />
                      <BrushButton 
                        icon={<Circle size={18} className="opacity-50 blur-[1px]" />} 
                        label="Airbrush" 
                        active={brushPreset === 'airbrush'} 
                        onClick={() => handleBrushPresetChange('airbrush')} 
                      />
                    </div>
                    {preferences.customBrushes && preferences.customBrushes.length > 0 && (
                      <div className="grid grid-cols-4 gap-2 border-t border-black/30 pt-2 mt-2">
                        {preferences.customBrushes.map((cb: any) => (
                           <BrushButton 
                             key={cb.id}
                             icon={cb.textureBase64 ? <img src={cb.textureBase64} className="w-5 h-5 object-contain invert mix-blend-screen opacity-70 pointer-events-none" /> : <PenTool size={18} />} 
                             label={cb.name.substring(0, 8)} 
                             active={brushPreset === cb.id} 
                             onClick={() => handleBrushPresetChange(cb.id)} 
                           />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className={tool === 'pen' ? "mt-2" : ""}>
                  <label className="flex justify-between mb-1 text-xs text-neutral-300">
                    <span>{tool === 'eraser' ? 'Eraser Size' : 'Maximum Size'}</span> 
                    <span className="bg-[#222222] px-2 py-0.5 rounded border border-black">{brushSize} px</span>
                  </label>
                  <input type="range" min="1" max="100" value={brushSize} onChange={e => handleBrushSizeChange(parseInt(e.target.value))} className="w-full accent-blue-500" />
                </div>
                
                {tool === 'pen' && (
                  <div className="mt-4 pt-4 border-t border-black/50 flex flex-col gap-3">
                    <div className="text-xs text-neutral-400 uppercase tracking-wider font-semibold flex justify-between">
                      <span>Brush Settings</span>
                    </div>
                    
                    <div>
                      <label className="flex justify-between mb-1 text-[10px] text-neutral-300">
                        <span>Spacing</span> 
                        <span className="bg-[#222] px-1 py-0.5 rounded border border-black">
                          {Math.round(getBrushConfig(brushPreset).spacing * 100)}%
                        </span>
                      </label>
                      <input type="range" min="1" max="100" value={Math.round(getBrushConfig(brushPreset).spacing * 100)} readOnly className="w-full accent-blue-500 opacity-50" title="Custom brush editing coming soon" />
                    </div>
                    
                    <div>
                      <label className="flex justify-between mb-1 text-[10px] text-neutral-300">
                        <span>Scatter</span> 
                        <span className="bg-[#222] px-1 py-0.5 rounded border border-black">
                          {Math.round(getBrushConfig(brushPreset).scatter * 100)}%
                        </span>
                      </label>
                      <input type="range" min="0" max="100" value={Math.round(getBrushConfig(brushPreset).scatter * 100)} readOnly className="w-full accent-blue-500 opacity-50" title="Custom brush editing coming soon" />
                    </div>
                    
                    <div className="flex gap-2 mt-1">
                       <button onClick={() => useAppStore.getState().setPreferencesOpen(true)} className="flex-1 text-[10px] py-1 bg-[#444] hover:bg-[#555] rounded border border-black text-neutral-300" title="Import Alpha PNG as Brush">Import PNG...</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-neutral-500 text-xs italic">
                {tool === 'select' ? 'Select Tool active.' : 
                 tool === 'eyedropper' ? 'Click on canvas to pick color.' : 'Shape tool active.'}
              </div>
            )}
          </div>
        </div>

        {/* Colour Panel */}
        <div className="flex flex-col border-b border-black shrink-0">
          <div className="bg-[#282828] px-3 py-1.5 text-xs font-bold text-neutral-300 flex items-center gap-2 border-b border-black">
            <Palette size={14} /> Colour
          </div>
          <div className="p-4 flex flex-col gap-4">
             <div className="flex gap-4 items-start">
               {/* Current Color Display */}
               <div className="w-16 h-16 rounded shadow-inner border-2 border-neutral-900 shrink-0 relative overflow-hidden">
                 <div className="absolute inset-0" style={{backgroundColor: color}}></div>
                 {/* Invisible native color picker over the box so clicking it opens OS picker */}
                 <input type="color" value={color} onChange={e => handleColorChange(e.target.value)} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" />
               </div>
               
               <div className="flex-1 flex flex-col gap-2">
                 <div className="text-xs text-neutral-400 font-mono">HEX: {color.toUpperCase()}</div>
                 <button 
                   onClick={() => !swatches.includes(color) && updateProjectSwatches([...swatches, color])}
                   className="text-xs bg-[#444444] hover:bg-[#555555] py-1 px-2 rounded border border-black transition-colors"
                 >
                   + Add to Swatches
                 </button>
               </div>
             </div>

             <div>
               <div className="mb-2 text-xs text-neutral-400 uppercase tracking-wider font-semibold">Swatches</div>
               <div className="flex flex-wrap gap-1.5">
                 {swatches.map((s, i) => (
                   <button 
                     key={i} 
                     onClick={() => handleColorChange(s)} 
                     className={`w-6 h-6 rounded-sm border shadow-sm hover:scale-110 transition-transform ${color === s ? 'border-white' : 'border-black'}`} 
                     style={{backgroundColor: s}} 
                     title={s}
                   />
                 ))}
               </div>
             </div>
          </div>
        </div>

        {/* Layers Panel */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#2a2a2a] overflow-hidden">
          <div className="bg-[#282828] px-3 py-1.5 text-xs font-bold text-neutral-300 flex justify-between items-center border-b border-black shadow-sm shrink-0">
            <div className="flex items-center gap-2"><LayersIcon size={14} /> Layers</div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => addLayer(activePanelId, 'vector')}
                className="p-1 hover:bg-[#444] rounded transition-colors text-neutral-400 hover:text-white flex items-center gap-1"
                title="Add Vector Layer"
              >
                <Plus size={14} /> V
              </button>
              <button 
                onClick={() => addLayer(activePanelId, 'raster')}
                className="p-1 hover:bg-[#444] rounded transition-colors text-neutral-400 hover:text-white flex items-center gap-1"
                title="Add Raster Layer"
              >
                <Plus size={14} /> R
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1">
            {panelLayers.length === 0 && (
               <div className="text-xs text-neutral-500 italic text-center mt-4">No layers. Click + to add.</div>
            )}
            {[...panelLayers].reverse().map((layer, index, array) => (
              <div 
                key={layer.id} 
                onClick={() => setActiveLayerId(layer.id)}
                className={`group flex flex-col gap-1 px-2 py-2 text-xs rounded cursor-pointer border transition-colors ${activeLayerId === layer.id ? 'bg-[#3b82f6] border-blue-400' : 'bg-[#333333] border-transparent hover:bg-[#404040]'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button 
                      onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(activePanelId, layer.id); }}
                      className={`hover:text-white ${layer.visible ? (activeLayerId === layer.id ? 'text-white' : 'text-neutral-300') : (activeLayerId === layer.id ? 'text-blue-300' : 'text-neutral-600')}`}
                      title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                    >
                      {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <input 
                      type="text" 
                      value={layer.name} 
                      onChange={(e) => updateLayerName(activePanelId, layer.id, e.target.value)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        (e.target as HTMLInputElement).readOnly = false;
                        (e.target as HTMLInputElement).select();
                      }}
                      onBlur={(e) => {
                        (e.target as HTMLInputElement).readOnly = true;
                      }}
                      readOnly
                      className={`bg-transparent border-none outline-none flex-1 min-w-0 font-medium cursor-pointer focus:cursor-text focus:bg-white/10 focus:px-1 rounded ${activeLayerId === layer.id ? 'text-white' : 'text-neutral-300'} ${!layer.visible && 'italic opacity-60'}`}
                      title="Double click to rename"
                    />
                  </div>
                  
                  <div className={`flex items-center gap-1 ${activeLayerId === layer.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button onClick={(e) => { e.stopPropagation(); moveLayerUp(activePanelId, layer.id); }} disabled={index === 0} className="p-0.5 hover:bg-black/20 rounded disabled:opacity-30" title="Move Layer Up"><ChevronUp size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); moveLayerDown(activePanelId, layer.id); }} disabled={index === array.length - 1} className="p-0.5 hover:bg-black/20 rounded disabled:opacity-30" title="Move Layer Down"><ChevronDown size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); removeLayer(activePanelId, layer.id); }} className={`p-0.5 rounded hover:bg-black/20 ${activeLayerId === layer.id ? 'text-blue-200 hover:text-white' : 'text-neutral-500 hover:text-red-400'}`} title="Delete Layer"><Trash2 size={12} /></button>
                  </div>
                </div>
                
                {activeLayerId === layer.id && (
                  <div className="flex items-center gap-2 mt-1 px-1 border-t border-black/20 pt-1">
                    <span className="text-[10px] text-blue-100">Opacity:</span>
                    <input 
                      type="range" 
                      min="0" max="1" step="0.05" 
                      value={layer.opacity ?? 1} 
                      onChange={(e) => setLayerOpacity(activePanelId, layer.id, parseFloat(e.target.value))} 
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 h-1 bg-black/30 rounded-lg appearance-none cursor-pointer" 
                    />
                    <span className="text-[10px] text-blue-100 w-8 text-right font-mono">{Math.round((layer.opacity ?? 1) * 100)}%</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

// UI Helpers
const ToolButton = ({ icon, active, onClick, onContextMenu, title }: { icon: React.ReactNode, active: boolean, onClick?: () => void, onContextMenu?: (e: React.MouseEvent) => void, title: string }) => (
  <button 
    onClick={onClick}
    onContextMenu={onContextMenu}
    title={title}
    className={`p-2.5 rounded-lg transition-all ${active ? 'bg-blue-600 text-white shadow-inner' : 'text-neutral-400 hover:bg-[#444] hover:text-white'}`}
  >
    {icon}
  </button>
);

const BrushButton = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex flex-col items-center justify-center py-2 px-1 rounded border transition-all ${
      active 
        ? 'bg-[#3b82f6] border-blue-400 text-white shadow-inner' 
        : 'bg-[#222] border-black text-neutral-400 hover:bg-[#333] hover:text-neutral-200'
    }`}
  >
    {icon}
    <span className="text-[10px] mt-1">{label}</span>
  </button>
);