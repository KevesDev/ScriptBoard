import type { Layer, Panel, Project, TimelineStoryboardClip } from '@common/models';

export type StoryboardCompositeSlice = {
  panelId: string;
  /** Layers to draw for this slice (already filtered by visibility / layerIds). */
  layers: Layer[];
};

function findPanelInProject(project: Project, panelId: string): Panel | null {
  for (const scene of project.scenes) {
    const p = scene.panels.find((x) => x.id === panelId);
    if (p) return p;
  }
  return null;
}

function filterLayersForClip(panel: Panel, clip: TimelineStoryboardClip): Layer[] {
  const src = panel.layers;
  if (!clip.layerIds?.length) {
    return src.filter((l) => l.visible);
  }
  const set = new Set(clip.layerIds);
  return src.filter((l) => set.has(l.id) && l.visible);
}

/**
 * Ordered back → front (lower storyboard track order first; within a track, clips are not overlapping in SP — we use clip start order).
 */
export function getStoryboardCompositionAtTime(project: Project, timeSec: number): StoryboardCompositeSlice[] {
  const tracks = project.timeline?.storyboardTracks ?? [];
  if (!tracks.length) return [];

  const ordered = [...tracks].sort((a, b) => a.order - b.order);
  const slices: StoryboardCompositeSlice[] = [];

  for (const tr of ordered) {
    if (tr.muted) continue;
    for (const clip of tr.clips) {
      const end = clip.startTimeSec + clip.durationSec;
      if (timeSec < clip.startTimeSec || timeSec >= end) continue;
      const panel = findPanelInProject(project, clip.panelId);
      if (!panel) continue;
      const layers = filterLayersForClip(panel, clip);
      if (layers.length === 0) continue;
      slices.push({ panelId: clip.panelId, layers });
    }
  }

  return slices;
}

/** Topmost visible clip’s panel at time (for edit targeting when scrubbing). */
export function getTopStoryboardPanelIdAtTime(project: Project, timeSec: number): string | null {
  const comp = getStoryboardCompositionAtTime(project, timeSec);
  if (!comp.length) return null;
  return comp[comp.length - 1]!.panelId;
}

export function maxStoryboardTrackTimelineEnd(project: Project): number {
  const tracks = project.timeline?.storyboardTracks ?? [];
  let max = 0;
  for (const tr of tracks) {
    for (const c of tr.clips) {
      max = Math.max(max, c.startTimeSec + c.durationSec);
    }
  }
  return max;
}

export function hasAnyStoryboardTimelineClips(project: Project): boolean {
  return (project.timeline?.storyboardTracks ?? []).some((t) => t.clips.length > 0);
}

export function collectStoryboardClipEdges(project: Project): number[] {
  const edges: number[] = [];
  for (const tr of project.timeline?.storyboardTracks ?? []) {
    for (const c of tr.clips) {
      edges.push(c.startTimeSec, c.startTimeSec + c.durationSec);
    }
  }
  return edges;
}

/**
 * Build contiguous time ranges where the set of visible storyboard clips (per track) is stable.
 */
export function storyboardCompositionBoundaries(project: Project): number[] {
  const edges = new Set<number>([0]);
  for (const tr of project.timeline?.storyboardTracks ?? []) {
    if (tr.muted) continue;
    for (const c of tr.clips) {
      edges.add(c.startTimeSec);
      edges.add(c.startTimeSec + c.durationSec);
    }
  }
  const trackEnd = maxStoryboardTrackTimelineEnd(project);
  edges.add(Math.max(trackEnd, 1e-3));
  return [...edges].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
}

