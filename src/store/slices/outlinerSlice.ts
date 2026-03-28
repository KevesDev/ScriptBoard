import type { StateCreator } from 'zustand';
import type { ProjectStoreState } from '../projectStore';
import type { Scene, Panel, PanelTransition, PanelTransitionType } from '@common/models';

const TRANSITION_CYCLE: PanelTransitionType[] = ['none', 'dissolve', 'edgeWipe', 'clockWipe', 'slide'];

export interface OutlinerSlice {
  addScene: (scene: Scene) => void;
  removeScene: (sceneId: string) => void;
  reorderScenes: (scenes: Scene[]) => void;
  addPanel: (sceneId: string, panel: Panel) => void;
  removePanel: (sceneId: string, panelId: string) => void;
  reorderPanels: (sceneId: string, panels: Panel[]) => void;
  updatePanelDurationMs: (panelId: string, durationMs: number) => void;
  updatePanelTimelineGapSec: (panelId: string, gapSec: number) => void;
  updatePanelTimelineStartSec: (panelId: string, startSec: number) => void;
  updatePanelHeadTrimToStart: (panelId: string, newStartSec: number, fixedEndSec: number) => void;
  setPanelTransitionOut: (panelId: string, transition: PanelTransition | undefined) => void;
  cyclePanelTransitionOut: (panelId: string) => void;
}

export const createOutlinerSlice: StateCreator<ProjectStoreState, [], [], OutlinerSlice> = (set, get) => ({
  addScene: (scene) => 
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: [...state.project.scenes, scene],
        },
      };
    }),

  removeScene: (sceneId) =>
    set((state) => {
      if (!state.project) return state;
      const filteredScenes = state.project.scenes.filter(s => s.id !== sceneId);
      const renamedScenes = filteredScenes.map((s, index) => {
        return { 
          ...s, 
          order: index + 1,
          name: /^Scene \d+$/.test(s.name) ? `Scene ${index + 1}` : s.name 
        };
      });
      return {
        project: {
          ...state.project,
          scenes: renamedScenes,
        },
      };
    }),

  reorderScenes: (scenes) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes,
        },
      };
    }),

  addPanel: (sceneId, panel) => 
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => 
            s.id === sceneId ? { ...s, panels: [...s.panels, panel] } : s
          ),
        },
      };
    }),

  removePanel: (sceneId, panelId) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => {
            if (s.id === sceneId) {
              const filteredPanels = s.panels.filter(p => p.id !== panelId);
              const renamedPanels = filteredPanels.map((p, index) => {
                const newOrder = index + 1;
                return {
                  ...p, 
                  order: newOrder,
                  name: /^Panel \d+$/.test(p.name) ? `Panel ${newOrder}` : p.name
                };
              });
              return { ...s, panels: renamedPanels };
            }
            return s;
          }),
        },
      };
    }),

  reorderPanels: (sceneId, panels) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => {
            if (s.id === sceneId) {
              return { ...s, panels };
            }
            return s;
          }),
        },
      };
    }),

  updatePanelDurationMs: (panelId, durationMs) =>
    set((state) => {
      if (!state.project) return state;
      const ms = Math.round(Math.max(50, Math.min(durationMs, 3_600_000)));
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map((s) => ({
            ...s,
            panels: s.panels.map((p) => (p.id === panelId ? { ...p, duration: String(ms) } : p)),
          })),
        },
      };
    }),

  updatePanelTimelineGapSec: (panelId, gapSec) =>
    set((state) => {
      if (!state.project) return state;
      const g = Math.max(0, gapSec);
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map((s) => ({
            ...s,
            panels: s.panels.map((p) => (p.id === panelId ? { ...p, timelineGapAfterSec: g } : p)),
          })),
        },
      };
    }),

  updatePanelTimelineStartSec: (panelId, startSec) =>
    set((state) => {
      if (!state.project) return state;
      const t = Math.max(0, startSec);
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map((s) => ({
            ...s,
            panels: s.panels.map((p) => (p.id === panelId ? { ...p, timelineStartSec: t } : p)),
          })),
        },
      };
    }),

  updatePanelHeadTrimToStart: (panelId, newStartSec, fixedEndSec) =>
    set((state) => {
      if (!state.project) return state;
      const ns = Math.max(0, Math.min(newStartSec, fixedEndSec - 0.05));
      const newDurMs = Math.round(Math.max(50, (fixedEndSec - ns) * 1000));
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map((s) => ({
            ...s,
            panels: s.panels.map((p) =>
              p.id === panelId ? { ...p, timelineStartSec: ns, duration: String(newDurMs) } : p,
            ),
          })),
        },
      };
    }),

  setPanelTransitionOut: (panelId, transition) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map((s) => ({
            ...s,
            panels: s.panels.map((p) =>
              p.id === panelId ? { ...p, transitionOut: transition } : p,
            ),
          })),
        },
      };
    }),

  cyclePanelTransitionOut: (panelId) =>
    set((state) => {
      if (!state.project) return state;
      let found = false;
      const scenes = state.project.scenes.map((s) => ({
        ...s,
        panels: s.panels.map((p) => {
          if (p.id !== panelId) return p;
          found = true;
          const cur = p.transitionOut?.type ?? 'none';
          const idx = TRANSITION_CYCLE.indexOf(cur);
          const nt = TRANSITION_CYCLE[(idx < 0 ? 0 : idx + 1) % TRANSITION_CYCLE.length];
          if (nt === 'none') return { ...p, transitionOut: undefined };
          return {
            ...p,
            transitionOut: {
              type: nt,
              durationSec: p.transitionOut?.durationSec ?? 0.5,
            },
          };
        }),
      }));
      if (!found) return state;
      return { project: { ...state.project, scenes } };
    }),
});