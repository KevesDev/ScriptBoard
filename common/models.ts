export interface ProjectSettings {
  resolution: { width: number; height: number };
  defaultPanelDuration: string;
  /** Frames per second for timeline timecode (HH:MM:SS:FF). Default 24. */
  framerate?: number;
  author?: string;
  notes?: string;
  audioTrackBase64?: string; // Optional audio track for the project
  audioTrackName?: string;
}

export interface BrushConfig {
  id: string;
  name: string;
  textureBase64?: string; // base64 encoded png for brush tip, undefined for basic solid circle
  spacing: number; // percentage of brush size, e.g. 0.1 for 10%
  scatter: number; // random scatter amount
  rotationMode: 'fixed' | 'path' | 'random';
  rotationAngle: number; // base rotation
  flow: number; // fractional opacity per stamp
  pressureSize: boolean;
  pressureOpacity: boolean;
}

export type Stroke = {
  tool: 'pen' | 'eraser' | 'line' | 'rectangle' | 'ellipse' | 'fill';
  preset?: string;
  brushConfig?: BrushConfig;
  points: number[]; // Flat array of [x, y, pressure, x, y, pressure...]
  fillPaths?: number[][]; // Array of closed loops (flat [x,y,x,y...]). Used by 'fill' tool.
  color: string;
  width: number;
  seed?: number; //  Seeded deterministic PRNG lock to prevent texture boiling
};

export interface Layer {
  id: string;
  name: string;
  type: 'raster' | 'vector';
  opacity: number;
  visible: boolean;
  locked: boolean;
  blendMode: string;
  strokes?: Stroke[];
  dataBase64?: string; 
}

/** Outgoing transition before the next panel. */
export type PanelTransitionType = 'none' | 'dissolve' | 'edgeWipe' | 'clockWipe' | 'slide';

export interface PanelTransition {
  type: PanelTransitionType;
  /** Duration of the transition on the timeline (seconds). */
  durationSec: number;
}

export interface Panel {
  id: string;
  name: string;
  order: number;
  layers: Layer[];
  duration: string;
  notes?: string;
  dialogue?: string;
  thumbnailBase64?: string;
  /** Gap in seconds after this panel before the next (animatic editing only). */
  timelineGapAfterSec?: number;
  /** Start time on the animatic timeline (seconds). Set when animatic is on; cleared when switching to ripple. */
  timelineStartSec?: number;
  /** Transition after this panel (consumes time before the next panel in ripple mode). */
  transitionOut?: PanelTransition;
}

/** Sequence marker (purple bar / timeline section breaks). */
export interface TimelineSequence {
  id: string;
  name: string;
  startSec: number;
  order: number;
}

/** Act marker (flags on ruler). */
export interface TimelineAct {
  id: string;
  name: string;
  startSec: number;
  order: number;
}

/** One sound clip on a timeline audio track. */
export interface TimelineAudioClip {
  id: string;
  name: string;
  /** Start on the animatic timeline (seconds). */
  startTimeSec: number;
  /** Length on the timeline (seconds). */
  durationSec: number;
  /** Skip from the beginning of the source file (seconds). */
  sourceTrimStartSec: number;
  /** If set, max length taken from source after trim (seconds). Otherwise use decoded length − trim. */
  sourceDurationSec?: number;
  dataUri: string;
  /** Downsampled waveform peaks in 0..1 for UI (optional). */
  peaks?: number[];
}

/** Timeline audio clip fields sent with animatic video export for FFmpeg mixing. */
export type AnimaticExportAudioClipPayload = Pick<
  TimelineAudioClip,
  'dataUri' | 'startTimeSec' | 'durationSec' | 'sourceTrimStartSec' | 'sourceDurationSec'
>;

export interface TimelineAudioTrack {
  id: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  clips: TimelineAudioClip[];
}

/**
 * One storyboard cell on a timeline layer.
 * References an existing panel’s artwork; duration on the timeline is independent of the panel’s edit duration.
 */
export interface TimelineStoryboardClip {
  id: string;
  /** Display label in the timeline header. */
  name: string;
  /** Panel whose layers are composited for this cell. */
  panelId: string;
  startTimeSec: number;
  durationSec: number;
  /**
   * If set, only these layer ids are drawn (in scene stack order). Otherwise all visible layers of the panel.
   */
  layerIds?: string[];
}

/**
 * One horizontal storyboard layer on the timeline (under / over other layers).
 * Lower `order` draws behind higher `order` (back → front).
 */
export interface TimelineStoryboardTrack {
  id: string;
  name: string;
  order: number;
  muted: boolean;
  locked: boolean;
  clips: TimelineStoryboardClip[];
}

/** One video clip on the timeline (V1 / reference movie track). */
export interface TimelineVideoClip {
  id: string;
  name: string;
  startTimeSec: number;
  durationSec: number;
  sourceTrimStartSec: number;
  sourceDurationSec?: number;
  dataUri: string;
}

export interface TimelineVideoTrack {
  id: string;
  muted: boolean;
  locked: boolean;
  clips: TimelineVideoClip[];
}

/** Camera keyframe on the animatic timeline (pan / zoom / rotate about panel center). */
export interface TimelineCameraKeyframe {
  id: string;
  timeSec: number;
  panX: number;
  panY: number;
  /** Uniform scale; 1 = 100%. */
  zoom: number;
  rotationDeg: number;
}

/** Layer transform keyframe (active layer only in UI; stored per panel + layer). */
export interface TimelineLayerKeyframe {
  id: string;
  timeSec: number;
  panelId: string;
  layerId: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  /** Multiplies the layer’s base opacity. */
  opacityMul: number;
}

export interface ProjectTimeline {
  /** When true, `timelineGapAfterSec` and `timelineStartSec` apply; ripple uses sequential layout without stored starts. */
  animaticEditingMode: boolean;
  /** When true, moving a sound or video clip trims overlapping clips on the same track. */
  overwriteClips: boolean;
  /**
   * Storyboard image layers (independent timing per row). Track at order 0 is kept in sync with scene panel order / animatic timing.
   */
  storyboardTracks: TimelineStoryboardTrack[];
  audioTracks: TimelineAudioTrack[];
  /** Reference / imported video (e.g. live-action under boards). */
  videoTracks: TimelineVideoTrack[];
  /** Sequence markers along the timeline (ordered). */
  sequences: TimelineSequence[];
  /** Act markers on the ruler (optional). */
  acts: TimelineAct[];
  /** Camera motion keyframes (global timeline time). */
  cameraKeyframes: TimelineCameraKeyframe[];
  /** Per-layer transform keyframes. */
  layerKeyframes: TimelineLayerKeyframe[];
}

export interface Scene {
  id: string;
  name: string;
  order: number;
  panels: Panel[];
  /** Binds this storyboard scene directly to a specific AST Node ID in the ScriptEditor */
  linkedScriptNodeId?: string;
}

export interface ScriptItem {
  id: string;
  name: string;
  type: 'folder' | 'page';
}

export interface ScriptPage extends ScriptItem {
  type: 'page';
  contentBase64: string; // Storing rich text as base64 encoded JSON/HTML
}

export interface ScriptFolder extends ScriptItem {
  type: 'folder';
  children: (ScriptFolder | ScriptPage)[];
}

export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'text-to-panel' | 'page-to-scene' | 'character-to-scene';
}

/** Nodes for the Script Mode “Plot Tree” canvas (persisted per project). */
export interface PlotTreeNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    text: string;
  };
}

export interface PlotTreeEdge {
  id: string;
  source: string;
  target: string;
}

export interface Project {
  id: string;
  name: string;
  /** Set on load/save by migration; optional for hand-authored JSON. */
  projectFileFormatVersion?: number;
  settings: ProjectSettings;
  rootScriptFolder: ScriptFolder;
  scenes: Scene[];
  links: Link[];
  swatches?: string[];
  plotTreeNodes?: PlotTreeNode[];
  plotTreeEdges?: PlotTreeEdge[];
  /** @deprecated Loaded from older projects only; normalized to plotTree* on load */
  mindMapNodes?: PlotTreeNode[];
  mindMapEdges?: PlotTreeEdge[];
  /** Multi-track audio, animatic flags, etc. Migrated from legacy `settings.audioTrack*` on load. */
  timeline?: ProjectTimeline;
}