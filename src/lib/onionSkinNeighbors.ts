import type { Layer, Panel, Project } from '@common/models';

/**
 * Collect layer stacks for panels before/after the active panel within the same scene (outliner order).
 * `before[0]` is farthest back, `before[before.length-1]` is the immediate previous panel.
 * `after[0]` is the immediate next panel, `after[after.length-1]` is farthest forward.
 */
export function collectOnionNeighborStacks(
  project: Project,
  activePanelId: string,
  maxBefore: number,
  maxAfter: number,
): { before: Layer[][]; after: Layer[][] } {
  const before: Layer[][] = [];
  const after: Layer[][] = [];
  if (!activePanelId || (maxBefore <= 0 && maxAfter <= 0)) {
    return { before, after };
  }

  for (const scene of project.scenes) {
    const panelsSorted = [...scene.panels].sort((a, b) => a.order - b.order);
    const idx = panelsSorted.findIndex((p) => p.id === activePanelId);
    if (idx === -1) continue;

    const prevPanels: Panel[] = [];
    for (let i = 1; i <= maxBefore && idx - i >= 0; i++) {
      prevPanels.push(panelsSorted[idx - i]!);
    }
    prevPanels.reverse();
    for (const p of prevPanels) {
      before.push(p.layers);
    }

    for (let i = 1; i <= maxAfter && idx + i < panelsSorted.length; i++) {
      after.push(panelsSorted[idx + i]!.layers);
    }
    break;
  }

  return { before, after };
}

/**
 * `before`: stack[0] is farthest previous, stack[count-1] is immediate previous — higher opacity near current.
 * `after`: stack[0] is immediate next — highest opacity first, then fadePerStep per step forward.
 */
export function computeOnionOpacities(
  count: number,
  nearestOpacity: number,
  fadePerStep: number,
  mode: 'before' | 'after',
): number[] {
  if (count <= 0) return [];
  const o = Math.max(0.02, Math.min(1, nearestOpacity));
  const f = Math.max(0.15, Math.min(1, fadePerStep));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (mode === 'before') {
      const stepsFromNearest = count - 1 - i;
      out.push(o * Math.pow(f, stepsFromNearest));
    } else {
      out.push(o * Math.pow(f, i));
    }
  }
  return out;
}
