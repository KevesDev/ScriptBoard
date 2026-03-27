import type { Project, Layer } from '@common/models';
import { buildStoryboardTimeline } from './timelineLayout';

/** Safe path token: trim, replace spaces with underscores, strip illegal filename characters. */
export function sanitizeExportToken(raw: string, maxLen = 80): string {
  const s = raw
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!s) return 'unnamed';
  return s.slice(0, maxLen);
}

function actNumberForPanelStart(project: Project, startTimeSec: number): number {
  const acts = [...(project.timeline?.acts ?? [])].sort((a, b) => a.startSec - b.startSec);
  let n = 1;
  for (let i = 0; i < acts.length; i++) {
    if (acts[i]!.startSec <= startTimeSec) n = i + 1;
  }
  return n;
}

export type StoryboardExportPreset =
  | 'mergedPerPanel'
  | 'pngPerLayer'
  | 'foldersByScene'
  | 'imageSequenceNle';

export type ExportPathEntry =
  | { kind: 'file'; relativePath: string; layers: Layer[] }
  | { kind: 'skip'; reason: string };

/**
 * Build relative POSIX paths + layer sets for each output file.
 * `mergedPerPanel` uses the common `…P{n}-LMerged.png` merged-panel convention.
 * `pngPerLayer` emits one PNG per visible layer as `…P{n}-L{layer}.png` for multi-layer import.
 */
export function buildStoryboardExportPlan(
  project: Project,
  preset: StoryboardExportPreset,
): ExportPathEntry[] {
  const projToken = sanitizeExportToken(project.name || 'ScriptBoard', 60);

  const scenesOrdered = [...project.scenes].sort((a, b) => a.order - b.order);
  const { flatPanels } = buildStoryboardTimeline(project);
  const startByPanelId = new Map(flatPanels.map((p) => [p.id, p.startTime]));

  const entries: ExportPathEntry[] = [];

  if (preset === 'imageSequenceNle') {
    let n = 0;
    for (const fp of flatPanels) {
      n += 1;
      const name = `${projToken}_${String(n).padStart(4, '0')}.png`;
      entries.push({ kind: 'file', relativePath: name, layers: fp.layers });
    }
    return entries;
  }

  scenesOrdered.forEach((scene, sceneIdx) => {
    const sceneNum = sceneIdx + 1;
    const sceneFolderToken = sanitizeExportToken(scene.name || `Scene_${sceneNum}`, 60);
    const panelsOrdered = [...scene.panels].sort((a, b) => a.order - b.order);

    panelsOrdered.forEach((panel, pi) => {
      const panelNum = pi + 1;
      const startT = startByPanelId.get(panel.id) ?? 0;
      const actNum = actNumberForPanelStart(project, startT);

      if (preset === 'foldersByScene') {
        const file = `${sceneFolderToken}/Panel_${String(panelNum).padStart(2, '0')}.png`;
        entries.push({ kind: 'file', relativePath: file, layers: panel.layers });
        return;
      }

      if (preset === 'mergedPerPanel') {
        const file = `${projToken}-A${actNum}-S${sceneNum}-P${panelNum}-LMerged.png`;
        entries.push({ kind: 'file', relativePath: file, layers: panel.layers });
        return;
      }

      if (preset === 'pngPerLayer') {
        const visibleLayers = panel.layers.filter((l) => l.visible);
        if (visibleLayers.length === 0) {
          entries.push({ kind: 'skip', reason: `${panel.name || panel.id}: no visible layers` });
          return;
        }
        visibleLayers.forEach((layer) => {
          const layerToken = sanitizeExportToken(layer.name || 'Layer', 40);
          const file = `${projToken}-A${actNum}-S${sceneNum}-P${panelNum}-L${layerToken}.png`;
          entries.push({ kind: 'file', relativePath: file, layers: [layer] });
        });
      }
    });
  });

  return entries;
}
