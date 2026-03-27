import type { Panel, Project, Scene } from '@common/models';
import { createDefaultTimeline } from '@common/projectMigrate';

export type FlatPanelLayout = Panel & {
  sceneId: string;
  sceneName: string;
  sceneIndex: number;
  panelIndexInScene: number;
  globalPanelIndex: number;
  startTime: number;
  endTime: number;
  durationSec: number;
  /** Seconds of transition strip after this panel (0 if none). */
  transitionAfterSec: number;
};

export type FlatSceneLayout = {
  scene: Scene;
  sceneIndex: number;
  startTime: number;
  endTime: number;
};

type RowInput = {
  panel: Panel;
  sceneId: string;
  sceneName: string;
  sceneIndex: number;
  panelIndexInScene: number;
  globalPanelIndex: number;
};

/** Parse duration string as milliseconds → seconds. */
export function durationMsToSeconds(raw: string | undefined, fallbackMs: string | undefined): number {
  const ms = parseFloat(raw || '') || parseFloat(fallbackMs || '') || 2000;
  return Math.max(0.05, ms / 1000);
}

export function transitionSeconds(panel: Panel): number {
  const t = panel.transitionOut;
  if (!t || t.type === 'none') return 0;
  return Math.max(0, Number(t.durationSec) || 0);
}

function collectRows(project: Project): RowInput[] {
  let g = 0;
  const rows: RowInput[] = [];
  project.scenes.forEach((scene, si) => {
    const ordered = [...scene.panels].sort((a, b) => a.order - b.order);
    ordered.forEach((panel, pi) => {
      rows.push({
        panel,
        sceneId: scene.id,
        sceneName: scene.name,
        sceneIndex: si + 1,
        panelIndexInScene: pi + 1,
        globalPanelIndex: g++,
      });
    });
  });
  return rows;
}

export function buildStoryboardTimeline(
  project: Project,
): { flatPanels: FlatPanelLayout[]; flatScenes: FlatSceneLayout[]; totalDuration: number } {
  const defMs = project.settings.defaultPanelDuration;
  const animatic = project.timeline?.animaticEditingMode ?? false;
  const rows = collectRows(project);
  const panels: FlatPanelLayout[] = [];
  let totalDuration = 0;

  if (!animatic) {
    let time = 0;
    const sceneBounds = new Map<string, { start: number; end: number; scene: Scene; sceneIndex: number }>();

    for (const row of rows) {
      const dur = durationMsToSeconds(row.panel.duration, defMs);
      const trans = transitionSeconds(row.panel);
      const startTime = time;
      time += dur;
      const endTime = time;
      panels.push({
        ...row.panel,
        sceneId: row.sceneId,
        sceneName: row.sceneName,
        sceneIndex: row.sceneIndex,
        panelIndexInScene: row.panelIndexInScene,
        globalPanelIndex: row.globalPanelIndex,
        startTime,
        endTime,
        durationSec: dur,
        transitionAfterSec: trans,
      });
      time += trans;
      totalDuration = Math.max(totalDuration, time);

      const sb = sceneBounds.get(row.sceneId);
      if (!sb) {
        sceneBounds.set(row.sceneId, {
          start: startTime,
          end: time,
          scene: project.scenes[row.sceneIndex - 1]!,
          sceneIndex: row.sceneIndex,
        });
      } else {
        sb.end = time;
      }
    }

    const flatScenes: FlatSceneLayout[] = project.scenes.map((scene) => {
      const b = sceneBounds.get(scene.id);
      return {
        scene,
        sceneIndex: project.scenes.indexOf(scene) + 1,
        startTime: b?.start ?? 0,
        endTime: b?.end ?? 0,
      };
    });

    return { flatPanels: panels, flatScenes, totalDuration };
  }

  // Animatic: optional explicit starts; missing values follow previous ribbon (fallback).
  let fallback = 0;
  const sceneBounds = new Map<string, { start: number; end: number; scene: Scene; sceneIndex: number }>();

  for (const row of rows) {
    const dur = durationMsToSeconds(row.panel.duration, defMs);
    const trans = transitionSeconds(row.panel);
    const gap = Math.max(0, row.panel.timelineGapAfterSec ?? 0);
    const ex = row.panel.timelineStartSec;
    const startTime =
      ex != null && Number.isFinite(Number(ex)) ? Math.max(0, Number(ex)) : fallback;
    const endTime = startTime + dur;
    panels.push({
      ...row.panel,
      sceneId: row.sceneId,
      sceneName: row.sceneName,
      sceneIndex: row.sceneIndex,
      panelIndexInScene: row.panelIndexInScene,
      globalPanelIndex: row.globalPanelIndex,
      startTime,
      endTime,
      durationSec: dur,
      transitionAfterSec: trans,
    });
    fallback = endTime + gap + trans;
    totalDuration = Math.max(totalDuration, endTime + trans);

    const sb = sceneBounds.get(row.sceneId);
    if (!sb) {
      sceneBounds.set(row.sceneId, {
        start: startTime,
        end: fallback,
        scene: project.scenes[row.sceneIndex - 1]!,
        sceneIndex: row.sceneIndex,
      });
    } else {
      sb.end = Math.max(sb.end, fallback);
    }
  }

  const flatScenes: FlatSceneLayout[] = project.scenes.map((scene) => {
    const b = sceneBounds.get(scene.id);
    return {
      scene,
      sceneIndex: project.scenes.indexOf(scene) + 1,
      startTime: b?.start ?? 0,
      endTime: b?.end ?? 0,
    };
  });

  return { flatPanels: panels, flatScenes, totalDuration };
}

/** Ripple-mode start times for snapshotting onto `timelineStartSec` when enabling animatic. */
export function computeRipplePanelStartTimes(project: Project): Map<string, number> {
  const tl = project.timeline ?? createDefaultTimeline();
  const fake: Project = {
    ...project,
    timeline: { ...tl, animaticEditingMode: false },
  };
  const { flatPanels } = buildStoryboardTimeline(fake);
  return new Map(flatPanels.map((p) => [p.id, p.startTime]));
}

export function maxAudioTimelineEnd(project: Project): number {
  const tracks = project.timeline?.audioTracks ?? [];
  let max = 0;
  for (const tr of tracks) {
    for (const c of tr.clips) {
      max = Math.max(max, c.startTimeSec + c.durationSec);
    }
  }
  return max;
}

export function maxVideoTimelineEnd(project: Project): number {
  const tracks = project.timeline?.videoTracks ?? [];
  let max = 0;
  for (const tr of tracks) {
    for (const c of tr.clips) {
      max = Math.max(max, c.startTimeSec + c.durationSec);
    }
  }
  return max;
}

export function snapToFrame(t: number, fps: number): number {
  if (!Number.isFinite(t) || fps <= 0) return t;
  return Math.round(t * fps) / fps;
}

export function collectTimelineSnapEdges(
  project: Project,
  flatPanels: FlatPanelLayout[],
  audioClipEdges: number[],
): number[] {
  const edges = new Set<number>([0]);
  flatPanels.forEach((p) => {
    edges.add(p.startTime);
    edges.add(p.endTime);
    const tr = p.transitionAfterSec ?? 0;
    if (tr > 0) edges.add(p.endTime + tr);
  });
  project.timeline?.sequences?.forEach((s) => edges.add(s.startSec));
  project.timeline?.acts?.forEach((a) => edges.add(a.startSec));
  audioClipEdges.forEach((e) => edges.add(e));
  project.timeline?.videoTracks?.forEach((tr) => {
    tr.clips.forEach((c) => {
      edges.add(c.startTimeSec);
      edges.add(c.startTimeSec + c.durationSec);
    });
  });
  project.timeline?.cameraKeyframes?.forEach((k) => edges.add(k.timeSec));
  project.timeline?.layerKeyframes?.forEach((k) => edges.add(k.timeSec));
  project.timeline?.storyboardTracks?.forEach((tr) => {
    tr.clips.forEach((c) => {
      edges.add(c.startTimeSec);
      edges.add(c.startTimeSec + c.durationSec);
    });
  });
  return [...edges].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
}

/** Scene / panel indices and thumbnail for a panel id (primary ribbon row or any panel). */
export function lookupPanelLayoutSummary(
  project: Project,
  flatPanels: FlatPanelLayout[],
  panelId: string,
): {
  id: string;
  name: string;
  sceneIndex: number;
  panelIndexInScene: number;
  thumbnailBase64?: string;
} | null {
  const fp = flatPanels.find((p) => p.id === panelId);
  if (fp) {
    return {
      id: fp.id,
      name: fp.name,
      sceneIndex: fp.sceneIndex,
      panelIndexInScene: fp.panelIndexInScene,
      thumbnailBase64: fp.thumbnailBase64,
    };
  }
  for (let si = 0; si < project.scenes.length; si++) {
    const scene = project.scenes[si]!;
    const ordered = [...scene.panels].sort((a, b) => a.order - b.order);
    const pi = ordered.findIndex((p) => p.id === panelId);
    if (pi >= 0) {
      const p = ordered[pi]!;
      return {
        id: p.id,
        name: p.name,
        sceneIndex: si + 1,
        panelIndexInScene: pi + 1,
        thumbnailBase64: p.thumbnailBase64,
      };
    }
  }
  return null;
}

export function snapTimeToEdges(t: number, edges: number[], thresholdSec: number): number {
  let best = t;
  let bestD = thresholdSec;
  for (const e of edges) {
    const d = Math.abs(e - t);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
