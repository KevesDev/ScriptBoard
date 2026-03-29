import type { StateCreator } from 'zustand';
import type { ProjectStoreState } from '../projectStore';
import type { Project, Link, PlotTreeNode, PlotTreeEdge, ProjectSettings } from '@common/models';
import { normalizeProject } from '@common/projectMigrate';
import { computeDeltas, applyDelta } from '../../lib/DeltaHistory';
import { firstScriptPageId } from './scriptSlice';

export interface CoreSlice {
  project: Project | null;
  activeScriptPageId: string | null;
  activeSceneId: string | null;
  activePanelId: string | null;
  activeLayerId: string | null;
  timelinePlayheadSec: number;

  undoStack: { fwd: any, inv: any }[];
  redoStack: { fwd: any, inv: any }[];
  lastCommitBase: Project | null; 
  
  setProject: (project: Project) => void;
  setActiveScriptPageId: (pageId: string | null) => void;
  setActiveSceneId: (sceneId: string | null) => void;
  setActivePanelId: (panelId: string | null) => void;
  setActiveLayerId: (layerId: string | null) => void;
  setTimelinePlayheadSec: (sec: number) => void;
  
  commitHistory: () => void;
  undo: () => void;
  redo: () => void;

  createLink: (link: Link) => void;
  updateProjectSwatches: (swatches: string[]) => void;
  updateProjectSettings: (settings: Partial<ProjectSettings>) => void;
  updateProjectName: (name: string) => void;
  updatePlotTree: (nodes: PlotTreeNode[], edges: PlotTreeEdge[]) => void;
}

export const createCoreSlice: StateCreator<ProjectStoreState, [], [], CoreSlice> = (set, get) => ({
  project: null,
  activeScriptPageId: null,
  activeSceneId: null,
  activePanelId: null,
  activeLayerId: null,
  timelinePlayheadSec: 0,
  
  undoStack: [],
  redoStack: [],
  lastCommitBase: null,

  setProject: (project) => {
    const normalized = normalizeProject(project);
    set({
      project: normalized,
      activeScriptPageId: firstScriptPageId(normalized),
      activeSceneId: null,
      activePanelId: null,
      activeLayerId: null,
      timelinePlayheadSec: 0,
      undoStack: [],
      redoStack: [],
      lastCommitBase: null,
    });
  },

  setActiveScriptPageId: (pageId) => set({ activeScriptPageId: pageId }),
  
  setActiveSceneId: (sceneId) => set({ activeSceneId: sceneId, activePanelId: null, activeLayerId: null }),
  
  setActivePanelId: (panelId) => {
    const project = get().project;
    let firstLayerId = null;
    if (project && panelId) {
      for (const scene of project.scenes) {
        const panel = scene.panels.find(p => p.id === panelId);
        if (panel && panel.layers.length > 0) {
          firstLayerId = panel.layers[panel.layers.length - 1]!.id;
          break;
        }
      }
    }
    set({ activePanelId: panelId, activeLayerId: firstLayerId, activeSceneId: null });
  },

  setActiveLayerId: (layerId) => set({ activeLayerId: layerId }),

  setTimelinePlayheadSec: (sec) =>
    set({ timelinePlayheadSec: Math.max(0, Number.isFinite(sec) ? sec : 0) }),

  commitHistory: () => set((state) => {
    if (!state.project) return state;
    const base = state.lastCommitBase;
    
    if (base && base !== state.project) {
        const deltas = computeDeltas(base, state.project);
        if (deltas) {
            const newUndo = [...state.undoStack, deltas].slice(-50); 
            return { 
                undoStack: newUndo, 
                redoStack: [], 
                lastCommitBase: state.project 
            };
        }
    }
    return { lastCommitBase: state.project, redoStack: [] };
  }),

  undo: () => set((state) => {
    if (!state.project) return state;

    let activeDelta = null;
    if (state.lastCommitBase && state.lastCommitBase !== state.project) {
        activeDelta = computeDeltas(state.lastCommitBase, state.project);
    }

    if (activeDelta) {
        const revertedProject = state.lastCommitBase;
        const newRedoStack = [...state.redoStack, activeDelta];
        return {
            project: revertedProject,
            redoStack: newRedoStack,
            lastCommitBase: revertedProject
        };
    } else {
        if (state.undoStack.length === 0) return state;
        const newUndoStack = [...state.undoStack];
        const lastDelta = newUndoStack.pop()!;
        
        const prevProject = applyDelta(state.lastCommitBase, lastDelta.inv);
        const newRedoStack = [...state.redoStack, lastDelta];
        
        return {
            project: prevProject,
            undoStack: newUndoStack,
            redoStack: newRedoStack,
            lastCommitBase: prevProject
        };
    }
  }),

  redo: () => set((state) => {
    if (!state.project || state.redoStack.length === 0) return state;

    if (state.lastCommitBase && state.lastCommitBase !== state.project) {
        return { redoStack: [] };
    }

    const newRedoStack = [...state.redoStack];
    const nextDelta = newRedoStack.pop()!;
    
    const nextProject = applyDelta(state.project, nextDelta.fwd);
    const newUndoStack = [...state.undoStack, nextDelta];
    
    return {
        project: nextProject,
        undoStack: newUndoStack,
        redoStack: newRedoStack,
        lastCommitBase: nextProject
    };
  }),

  createLink: (link) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          links: [...state.project.links, link]
        }
      };
    }),

  updateProjectSwatches: (swatches) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          swatches
        }
      };
    }),
    
  updateProjectSettings: (settings) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          settings: { ...state.project.settings, ...settings }
        }
      };
    }),
    
  updateProjectName: (name) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          name
        }
      };
    }),

  updatePlotTree: (nodes, edges) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          plotTreeNodes: nodes,
          plotTreeEdges: edges
        }
      };
    }),
});