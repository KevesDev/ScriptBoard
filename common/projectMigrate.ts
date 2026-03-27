import type {
  Project,
  ProjectTimeline,
  PlotTreeNode,
  PlotTreeEdge,
  TimelineAudioTrack,
  TimelineVideoTrack,
  TimelineSequence,
  TimelineStoryboardTrack,
} from './models';

/** Bump when project.json shape changes in a breaking way (for future tooling). */
export const PROJECT_FILE_FORMAT_VERSION = 2 as const;

/**
 * Load pipeline order (dependencies):
 * 1. migratePlotTreeFields - plot tree only; independent of timeline.
 * 2. migrateTimeline - may ingest legacy settings.audioTrackBase64; needs settings + scenes structure present.
 * 3. validateAndSortTimeline - deterministic clip order; safe after timeline exists.
 *
 * Save pipeline: deep clone → normalizeProject (same steps) so disk always matches in-memory rules.
 */

export function migratePlotTreeFields(project: Project): Project {
  const legacy = project as Project & { mindMapNodes?: PlotTreeNode[]; mindMapEdges?: PlotTreeEdge[] };
  const nodes = project.plotTreeNodes ?? legacy.mindMapNodes ?? [];
  const edges = project.plotTreeEdges ?? legacy.mindMapEdges ?? [];
  const { mindMapNodes: _m, mindMapEdges: _e, ...rest } = project as Project & {
    mindMapNodes?: PlotTreeNode[];
    mindMapEdges?: PlotTreeEdge[];
  };
  return {
    ...rest,
    plotTreeNodes: nodes,
    plotTreeEdges: edges,
  };
}

function newTrack(): TimelineAudioTrack {
  return {
    id: crypto.randomUUID(),
    muted: false,
    solo: false,
    locked: false,
    clips: [],
  };
}

function newVideoTrack(): TimelineVideoTrack {
  return {
    id: crypto.randomUUID(),
    muted: true,
    locked: false,
    clips: [],
  };
}

export function newStoryboardTrack(order: number, name: string): TimelineStoryboardTrack {
  return {
    id: crypto.randomUUID(),
    name,
    order,
    muted: false,
    locked: false,
    clips: [],
  };
}

function defaultSequences(): TimelineSequence[] {
  return [{ id: crypto.randomUUID(), name: 'Sequence 1', startSec: 0, order: 1 }];
}

export function createDefaultTimeline(): ProjectTimeline {
  return {
    animaticEditingMode: false,
    overwriteClips: false,
    storyboardTracks: [newStoryboardTrack(0, 'Layer 1')],
    audioTracks: [newTrack(), newTrack()],
    videoTracks: [newVideoTrack()],
    sequences: defaultSequences(),
    acts: [],
    cameraKeyframes: [],
    layerKeyframes: [],
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Normalize timeline shape; sort clips by start time (stable I/O). */
/** Accepts partial timeline from disk; always returns a full normalized `ProjectTimeline`. */
export function validateAndSortTimeline(
  timeline: Partial<ProjectTimeline> & { audioTracks: TimelineAudioTrack[] },
): ProjectTimeline {
  let tracks = [...timeline.audioTracks];
  if (tracks.length === 0) {
    tracks = [newTrack(), newTrack()];
  }

  const soloCount = tracks.filter((t) => t.solo).length;
  const soloFixed =
    soloCount > 1
      ? (() => {
          let kept = false;
          return tracks.map((t) => {
            if (!t.solo) return t;
            if (kept) return { ...t, solo: false };
            kept = true;
            return t;
          });
        })()
      : tracks;

  const normalized = soloFixed.map((tr) => ({
    ...tr,
    muted: !!tr.muted,
    solo: !!tr.solo,
    locked: !!tr.locked,
    clips: [...tr.clips]
      .map((c) => ({
        ...c,
        startTimeSec: clamp(Number(c.startTimeSec) || 0, 0, 1e9),
        durationSec: clamp(Number(c.durationSec) || 0.1, 0.05, 1e9),
        sourceTrimStartSec: Math.max(0, Number(c.sourceTrimStartSec) || 0),
        sourceDurationSec:
          c.sourceDurationSec != null ? Math.max(0.05, Number(c.sourceDurationSec)) : undefined,
      }))
      .sort((a, b) => a.startTimeSec - b.startTimeSec),
  }));

  const sequences = (timeline.sequences?.length ? timeline.sequences : defaultSequences())
    .map((s, i) => ({
      id: typeof s.id === 'string' && s.id.length > 0 ? s.id : crypto.randomUUID(),
      name: typeof s.name === 'string' && s.name.length > 0 ? s.name : `Sequence ${i + 1}`,
      startSec: clamp(Number(s.startSec) || 0, 0, 1e9),
      order: Number(s.order) || i + 1,
    }))
    .sort((a, b) => a.order - b.order);

  const acts = [...(timeline.acts ?? [])]
    .map((a, i) => ({
      id: typeof a.id === 'string' && a.id.length > 0 ? a.id : crypto.randomUUID(),
      name: typeof a.name === 'string' && a.name.length > 0 ? a.name : `Act ${i + 1}`,
      startSec: clamp(Number(a.startSec) || 0, 0, 1e9),
      order: Number(a.order) || i + 1,
    }))
    .sort((a, b) => a.order - b.order);

  let videoTracks = [...(timeline.videoTracks ?? [])];
  if (videoTracks.length === 0) {
    videoTracks = [newVideoTrack()];
  }
  const normalizedVideo = videoTracks.map((tr) => ({
    ...tr,
    muted: !!tr.muted,
    locked: !!tr.locked,
    clips: [...tr.clips]
      .map((c) => ({
        ...c,
        startTimeSec: clamp(Number(c.startTimeSec) || 0, 0, 1e9),
        durationSec: clamp(Number(c.durationSec) || 0.1, 0.05, 1e9),
        sourceTrimStartSec: Math.max(0, Number(c.sourceTrimStartSec) || 0),
        sourceDurationSec:
          c.sourceDurationSec != null ? Math.max(0.05, Number(c.sourceDurationSec)) : undefined,
      }))
      .sort((a, b) => a.startTimeSec - b.startTimeSec),
  }));

  const cameraKeyframes = [...(timeline.cameraKeyframes ?? [])]
    .map((k) => ({
      id: typeof k.id === 'string' && k.id.length > 0 ? k.id : crypto.randomUUID(),
      timeSec: clamp(Number(k.timeSec) || 0, 0, 1e9),
      panX: Number(k.panX) || 0,
      panY: Number(k.panY) || 0,
      zoom: clamp(Number(k.zoom) || 1, 0.05, 100),
      rotationDeg: Number(k.rotationDeg) || 0,
    }))
    .sort((a, b) => a.timeSec - b.timeSec);

  const layerKeyframes = [...(timeline.layerKeyframes ?? [])]
    .map((k) => ({
      id: typeof k.id === 'string' && k.id.length > 0 ? k.id : crypto.randomUUID(),
      timeSec: clamp(Number(k.timeSec) || 0, 0, 1e9),
      panelId: String(k.panelId || ''),
      layerId: String(k.layerId || ''),
      offsetX: Number(k.offsetX) || 0,
      offsetY: Number(k.offsetY) || 0,
      scale: clamp(Number(k.scale) || 1, 0.05, 100),
      opacityMul: clamp(Number(k.opacityMul) ?? 1, 0, 10),
    }))
    .filter((k) => k.panelId.length > 0 && k.layerId.length > 0)
    .sort((a, b) => a.timeSec - b.timeSec);

  let storyboardTracks = [...(timeline.storyboardTracks ?? [])];
  if (storyboardTracks.length === 0) {
    storyboardTracks = [newStoryboardTrack(0, 'Layer 1')];
  }
  const normalizedStoryboard = storyboardTracks
    .map((tr, i) => ({
      id: typeof tr.id === 'string' && tr.id.length > 0 ? tr.id : crypto.randomUUID(),
      name: typeof tr.name === 'string' && tr.name.length > 0 ? tr.name : `Layer ${i + 1}`,
      order: Number.isFinite(Number(tr.order)) ? Number(tr.order) : i,
      muted: !!tr.muted,
      locked: !!tr.locked,
      clips: [...(tr.clips ?? [])]
        .map((c) => ({
          id: typeof c.id === 'string' && c.id.length > 0 ? c.id : crypto.randomUUID(),
          name: typeof c.name === 'string' && c.name.length > 0 ? c.name : 'Clip',
          panelId: String(c.panelId || ''),
          startTimeSec: clamp(Number(c.startTimeSec) || 0, 0, 1e9),
          durationSec: clamp(Number(c.durationSec) || 0.1, 0.05, 1e9),
          layerIds:
            Array.isArray(c.layerIds) && c.layerIds.length > 0
              ? c.layerIds.map((x) => String(x)).filter(Boolean)
              : undefined,
        }))
        .filter((c) => c.panelId.length > 0)
        .sort((a, b) => a.startTimeSec - b.startTimeSec),
    }))
    .sort((a, b) => a.order - b.order);

  return {
    animaticEditingMode: !!timeline.animaticEditingMode,
    overwriteClips: !!timeline.overwriteClips,
    storyboardTracks: normalizedStoryboard,
    audioTracks: normalized,
    videoTracks: normalizedVideo,
    sequences,
    acts,
    cameraKeyframes,
    layerKeyframes,
  };
}

export function migrateTimeline(project: Project): Project {
  const raw = project.timeline;
  const hasTracks = Array.isArray(raw?.audioTracks) && raw!.audioTracks.length > 0;

  if (hasTracks && raw) {
    const timeline = validateAndSortTimeline({
      animaticEditingMode: raw.animaticEditingMode ?? false,
      overwriteClips: raw.overwriteClips ?? false,
      storyboardTracks: raw.storyboardTracks,
      audioTracks: raw.audioTracks,
      videoTracks: raw.videoTracks,
      sequences: raw.sequences,
      acts: raw.acts,
      cameraKeyframes: raw.cameraKeyframes,
      layerKeyframes: raw.layerKeyframes,
    });
    return { ...project, timeline };
  }

  const timeline = createDefaultTimeline();
  if (project.settings.audioTrackBase64) {
    timeline.audioTracks[0].clips.push({
      id: crypto.randomUUID(),
      name: project.settings.audioTrackName || 'Imported audio',
      startTimeSec: 0,
      durationSec: 600,
      sourceTrimStartSec: 0,
      dataUri: project.settings.audioTrackBase64,
    });
  }
  return { ...project, timeline: validateAndSortTimeline(timeline) };
}

/** After JSON.parse (file load or IPC). Idempotent. */
export function normalizeProject(project: Project): Project {
  const p = migrateTimeline(migratePlotTreeFields(project));
  return {
    ...p,
    projectFileFormatVersion: PROJECT_FILE_FORMAT_VERSION,
  };
}

/** Before JSON.stringify (save). Deep clone so in-memory state is not mutated. */
export function prepareProjectForPersistence(project: Project): Project {
  return normalizeProject(JSON.parse(JSON.stringify(project)) as Project);
}
