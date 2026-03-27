import type { Project, BrushConfig } from '@common/models';
import type { FlatPanelLayout } from './timelineLayout';
import { rasterizeCompositeStackToPngBase64, rasterizePanelLayersToPngBase64 } from './panelPngExport';
import {
  getStoryboardCompositionAtTime,
  hasAnyStoryboardTimelineClips,
  storyboardCompositionBoundaries,
} from './timelineStoryboardComposition';

export type AnimaticSegmentPayload = {
  dataUri: string | null;
  durationSec: number;
};

/**
 * Builds animatic still frames from full panel rasterization (not UI thumbnails).
 * Ensures MP4/MOV export matches actual board art for every panel.
 */
export async function buildAnimaticSegmentsFromPanels(
  flatPanels: FlatPanelLayout[],
  project: Project,
  getBrushConfig: (presetId?: string) => BrushConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<AnimaticSegmentPayload[]> {
  const w = project.settings.resolution?.width ?? 1920;
  const h = project.settings.resolution?.height ?? 1080;
  const total = flatPanels.length;
  const out: AnimaticSegmentPayload[] = [];

  for (let i = 0; i < flatPanels.length; i++) {
    const p = flatPanels[i]!;
    onProgress?.(i + 1, total);
    try {
      const b64 = await rasterizePanelLayersToPngBase64(p.layers, w, h, getBrushConfig);
      out.push({
        dataUri: `data:image/png;base64,${b64}`,
        durationSec: p.durationSec + (p.transitionAfterSec ?? 0),
      });
    } catch {
      out.push({
        dataUri: null,
        durationSec: p.durationSec + (p.transitionAfterSec ?? 0),
      });
    }
  }
  return out;
}

/**
 * When multiple storyboard timeline layers are in use, exports one still per composition-stable segment
 * (stacked clips), otherwise one still per primary ribbon panel.
 */
export async function buildAnimaticSegmentsForProject(
  project: Project,
  flatPanels: FlatPanelLayout[],
  getBrushConfig: (presetId?: string) => BrushConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<AnimaticSegmentPayload[]> {
  if (!hasAnyStoryboardTimelineClips(project)) {
    return buildAnimaticSegmentsFromPanels(flatPanels, project, getBrushConfig, onProgress);
  }

  const w = project.settings.resolution?.width ?? 1920;
  const h = project.settings.resolution?.height ?? 1080;
  const boundaries = storyboardCompositionBoundaries(project);
  const out: AnimaticSegmentPayload[] = [];
  const nSeg = Math.max(0, boundaries.length - 1);
  let done = 0;

  for (let i = 0; i < nSeg; i++) {
    const t0 = boundaries[i]!;
    const t1 = boundaries[i + 1]!;
    const dur = t1 - t0;
    if (dur <= 1e-6) continue;
    const tMid = t0 + dur * 0.5;
    const comp = getStoryboardCompositionAtTime(project, tMid);
    const stacks = comp.map((s) => s.layers);
    done++;
    onProgress?.(done, nSeg);
    try {
      if (stacks.length === 0) {
        out.push({ dataUri: null, durationSec: dur });
        continue;
      }
      const b64 = await rasterizeCompositeStackToPngBase64(stacks, w, h, getBrushConfig);
      out.push({
        dataUri: `data:image/png;base64,${b64}`,
        durationSec: dur,
      });
    } catch {
      out.push({ dataUri: null, durationSec: dur });
    }
  }

  if (out.length === 0) {
    return buildAnimaticSegmentsFromPanels(flatPanels, project, getBrushConfig, onProgress);
  }

  return out;
}
