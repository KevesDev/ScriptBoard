import { create } from 'zustand';
import type {
  Project,
  Scene,
  Panel,
  Layer,
  Link,
  ScriptPage,
  ScriptFolder,
  Stroke,
  ProjectSettings,
  PlotTreeNode,
  PlotTreeEdge,
  TimelineAudioClip,
  TimelineVideoClip,
  TimelineCameraKeyframe,
  TimelineLayerKeyframe,
  PanelTransition,
  PanelTransitionType,
  TimelineStoryboardClip,
  TimelineAudioTrack,
} from '@common/models';
import { createDefaultTimeline, normalizeProject, newStoryboardTrack } from '@common/projectMigrate';
import { cutTimelineRangeFromClips } from '../lib/audioClipOverlap';
import { cutTimelineRangeFromVideoClips } from '../lib/videoClipOverlap';
import { cutStoryboardRangeFromClips } from '../lib/storyboardClipOverlap';
import { computeRipplePanelStartTimes } from '../lib/timelineLayout';
import { computeDeltas, applyDelta } from '../lib/deltaHistory'; // <-- OUR NEW ENGINE

const TRANSITION_CYCLE: PanelTransitionType[] = ['none', 'dissolve', 'edgeWipe', 'clockWipe', 'slide'];

export { normalizeProject, createDefaultTimeline } from '@common/projectMigrate';

export const generateEmptyProject = (): Project => ({
  id: crypto.randomUUID(),
  name: 'Untitled Project',
  settings: {
    resolution: { width: 1920, height: 1080 },
    defaultPanelDuration: '2000',
    framerate: 24,
  },
  timeline: createDefaultTimeline(),
  rootScriptFolder: {
    id: crypto.randomUUID(),
    name: 'Root',
    type: 'folder',
    children: [
      { id: crypto.randomUUID(), name: 'Documents', type: 'folder', children: [
        { id: crypto.randomUUID(), name: 'Main Script', type: 'page', contentBase64: '' }
      ] }
    ]
  },
  scenes: [],
  links: [],
  plotTreeNodes: [],
  plotTreeEdges: [],
  swatches: [
    '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
    '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#9900ff', '#ff00ff'
  ]
});

function firstScriptPageIdFromRoot(root: ScriptFolder): string | null {
  const walk = (folder: ScriptFolder): string | null => {
    for (const c of folder.children) {
      if (c.type === 'page') return c.id;
      const nested = walk(c as ScriptFolder);
      if (nested) return nested;
    }
    return null;
  };
  return walk(root);
}

function firstScriptPageId(project: Project): string | null {
  return firstScriptPageIdFromRoot(project.rootScriptFolder);
}

interface ProjectState {
  project: Project | null;
  activeScriptPageId: string | null;
  activePanelId: string | null;
  activeLayerId: string | null;
  timelinePlayheadSec: number;

  // NEW: High Performance Delta Stacks
  undoStack: { fwd: any, inv: any }[];
  redoStack: { fwd: any, inv: any }[];
  lastCommitBase: Project | null; // Tracks the "before" state of the current action
  
  // Actions
  setProject: (project: Project) => void;
  setActiveScriptPageId: (pageId: string | null) => void;
  setActivePanelId: (panelId: string | null) => void;
  setActiveLayerId: (layerId: string | null) => void;
  setTimelinePlayheadSec: (sec: number) => void;
  
  commitHistory: () => void;
  undo: () => void;
  redo: () => void;

  addScene: (scene: Scene) => void;
  removeScene: (sceneId: string) => void;
  reorderScenes: (scenes: Scene[]) => void;
  addPanel: (sceneId: string, panel: Panel) => void;
  removePanel: (sceneId: string, panelId: string) => void;
  reorderPanels: (sceneId: string, panels: Panel[]) => void;
  
  addLayer: (panelId: string, type: 'vector' | 'raster') => void;
  removeLayer: (panelId: string, layerId: string) => void;
  updateLayerStrokes: (panelId: string, layerId: string, strokes: Stroke[]) => void;
  updateLayerDataBase64: (panelId: string, layerId: string, dataBase64: string) => void;
  updateLayerName: (panelId: string, layerId: string, name: string) => void;
  toggleLayerVisibility: (panelId: string, layerId: string) => void;
  setLayerOpacity: (panelId: string, layerId: string, opacity: number) => void;
  moveLayerUp: (panelId: string, layerId: string) => void;
  moveLayerDown: (panelId: string, layerId: string) => void;
  
  updateScriptPageContent: (pageId: string, contentBase64: string) => void;
  syncScenesFromContent: (contentBase64: string) => void;
  importScriptPage: (fileName: string, content: string) => void;
  addPageToFolder: (folderId: string, pageName: string) => void;
  removeNode: (nodeId: string) => void;
  updateNodeName: (nodeId: string, name: string) => void;
  createLink: (link: Link) => void;
  updateProjectSwatches: (swatches: string[]) => void;
  updateProjectSettings: (settings: Partial<ProjectSettings>) => void;
  updateProjectName: (name: string) => void;
  updatePanelThumbnail: (panelId: string, thumbnailBase64: string) => void;
  updatePlotTree: (nodes: PlotTreeNode[], edges: PlotTreeEdge[]) => void;

  updatePanelDurationMs: (panelId: string, durationMs: number) => void;
  updatePanelTimelineGapSec: (panelId: string, gapSec: number) => void;
  setAnimaticEditingMode: (enabled: boolean) => void;
  setTimelineOverwriteClips: (enabled: boolean) => void;

  addTimelineAudioTrack: () => void;
  removeTimelineAudioTrack: (trackIndex: number) => void;

  addTimelineAudioClip: (trackIndex: number, clip: TimelineAudioClip) => void;
  updateTimelineAudioClip: (trackIndex: number, clipId: string, patch: Partial<TimelineAudioClip>) => void;
  removeTimelineAudioClip: (trackIndex: number, clipId: string) => void;
  setTimelineTrackMuted: (trackIndex: number, muted: boolean) => void;
  setTimelineTrackSolo: (trackIndex: number, solo: boolean) => void;
  moveTimelineAudioClip: (trackIndex: number, clipId: string, newStartTimeSec: number) => void;
  resizeTimelineAudioClip: (
    trackIndex: number,
    clipId: string,
    edge: 'left' | 'right',
    timelineTimeSec: number,
  ) => void;

  updatePanelTimelineStartSec: (panelId: string, startSec: number) => void;
  updatePanelHeadTrimToStart: (panelId: string, newStartSec: number, fixedEndSec: number) => void;
  setPanelTransitionOut: (panelId: string, transition: PanelTransition | undefined) => void;
  cyclePanelTransitionOut: (panelId: string) => void;
  slipTimelineAudioClipToTrim: (trackIndex: number, clipId: string, sourceTrimStartSec: number) => void;
  addTimelineActAt: (startSec: number) => void;
  addTimelineSequenceAt: (startSec: number) => void;

  addTimelineVideoClip: (trackIndex: number, clip: TimelineVideoClip) => void;
  updateTimelineVideoClip: (trackIndex: number, clipId: string, patch: Partial<TimelineVideoClip>) => void;
  removeTimelineVideoClip: (trackIndex: number, clipId: string) => void;
  setTimelineVideoTrackMuted: (trackIndex: number, muted: boolean) => void;
  moveTimelineVideoClip: (trackIndex: number, clipId: string, newStartTimeSec: number) => void;
  resizeTimelineVideoClip: (
    trackIndex: number,
    clipId: string,
    edge: 'left' | 'right',
    timelineTimeSec: number,
  ) => void;
  slipTimelineVideoClipToTrim: (trackIndex: number, clipId: string, sourceTrimStartSec: number) => void;

  addTimelineCameraKeyframe: (timeSec: number, values?: Partial<Omit<TimelineCameraKeyframe, 'id' | 'timeSec'>>) => void;
  removeTimelineCameraKeyframe: (id: string) => void;
  moveTimelineCameraKeyframe: (id: string, timeSec: number) => void;
  updateTimelineCameraKeyframe: (id: string, patch: Partial<Omit<TimelineCameraKeyframe, 'id'>>) => void;

  addTimelineLayerKeyframe: (
    timeSec: number,
    panelId: string,
    layerId: string,
    values?: Partial<Omit<TimelineLayerKeyframe, 'id' | 'timeSec' | 'panelId' | 'layerId'>>,
  ) => void;
  removeTimelineLayerKeyframe: (id: string) => void;
  moveTimelineLayerKeyframe: (id: string, timeSec: number) => void;
  updateTimelineLayerKeyframe: (id: string, patch: Partial<Omit<TimelineLayerKeyframe, 'id'>>) => void;

  addStoryboardTrack: () => void;
  removeStoryboardTrack: (trackId: string) => void;
  setStoryboardTrackMuted: (trackId: string, muted: boolean) => void;
  addStoryboardClip: (trackId: string, clip: Omit<TimelineStoryboardClip, 'id'> & { id?: string }) => void;
  removeStoryboardClip: (trackId: string, clipId: string) => void;
  moveStoryboardClip: (trackId: string, clipId: string, newStartTimeSec: number) => void;
  resizeStoryboardClip: (
    trackId: string,
    clipId: string,
    edge: 'left' | 'right',
    timelineTimeSec: number,
  ) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  activeScriptPageId: null,
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
      activePanelId: null,
      activeLayerId: null,
      timelinePlayheadSec: 0,
      undoStack: [],
      redoStack: [],
      lastCommitBase: null,
    });
  },

  setActiveScriptPageId: (pageId) => set({ activeScriptPageId: pageId }),
  
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
    set({ activePanelId: panelId, activeLayerId: firstLayerId });
  },

  setActiveLayerId: (layerId) => set({ activeLayerId: layerId }),

  setTimelinePlayheadSec: (sec) =>
    set({ timelinePlayheadSec: Math.max(0, Number.isFinite(sec) ? sec : 0) }),

  commitHistory: () => set((state) => {
    if (!state.project) return state;
    const base = state.lastCommitBase;
    
    // Calculate exact bytes changed since the last action
    if (base && base !== state.project) {
        const deltas = computeDeltas(base, state.project);
        if (deltas) {
            const newUndo = [...state.undoStack, deltas].slice(-50); // Keep last 50 actions
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
        // We have uncommitted strokes. Undo reverts them first safely.
        const revertedProject = state.lastCommitBase;
        const newRedoStack = [...state.redoStack, activeDelta];
        return {
            project: revertedProject,
            redoStack: newRedoStack,
            lastCommitBase: revertedProject
        };
    } else {
        // Standard Undo
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

    // If user has uncommitted changes, clear redo stack to prevent branching paradox
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

  addLayer: (panelId, type) =>
    set((state) => {
      if (!state.project) return state;
      const newLayer: Layer = {
        id: crypto.randomUUID(),
        name: type === 'vector' ? 'Vector Layer' : 'Raster Layer',
        type,
        opacity: 1,
        visible: true,
        locked: false,
        blendMode: 'source-over',
        strokes: [],
      };

      let newActiveLayerId = state.activeLayerId;
      const newScenes = state.project.scenes.map((s) => ({
        ...s,
        panels: s.panels.map((p) => {
          if (p.id === panelId) {
            newActiveLayerId = newLayer.id;
            return { ...p, layers: [...(p.layers || []), newLayer] };
          }
          return p;
        }),
      }));

      const tl = state.project.timeline;
      const nextProject: typeof state.project = {
        ...state.project,
        scenes: newScenes,
      };
      if (tl?.storyboardTracks?.length) {
        nextProject.timeline = {
          ...tl,
          storyboardTracks: tl.storyboardTracks.map((tr) => ({
            ...tr,
            clips: tr.clips.map((c) => {
              if (c.panelId !== panelId || !c.layerIds?.length) return c;
              if (c.layerIds.includes(newLayer.id)) return c;
              return { ...c, layerIds: [...c.layerIds, newLayer.id] };
            }),
          })),
        };
      }

      return {
        project: nextProject,
        activeLayerId: newActiveLayerId,
      };
    }),

  removeLayer: (panelId, layerId) =>
    set((state) => {
      if (!state.project) return state;
      let newActiveLayerId = state.activeLayerId;

      const newScenes = state.project.scenes.map((s) => ({
        ...s,
        panels: s.panels.map((p) => {
          if (p.id === panelId) {
            const newLayers = p.layers.filter((l) => l.id !== layerId);
            if (newActiveLayerId === layerId) {
              newActiveLayerId =
                newLayers.length > 0 ? newLayers[newLayers.length - 1]!.id : null;
            }
            return { ...p, layers: newLayers };
          }
          return p;
        }),
      }));

      const tl = state.project.timeline;
      const nextProject: typeof state.project = {
        ...state.project,
        scenes: newScenes,
      };
      if (tl?.storyboardTracks?.length) {
        nextProject.timeline = {
          ...tl,
          storyboardTracks: tl.storyboardTracks.map((tr) => ({
            ...tr,
            clips: tr.clips.map((c) => {
              if (!c.layerIds?.length) return c;
              return { ...c, layerIds: c.layerIds.filter((id) => id !== layerId) };
            }),
          })),
        };
      }

      return {
        project: nextProject,
        activeLayerId: newActiveLayerId,
      };
    }),

  updateLayerStrokes: (panelId, layerId, strokes) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => ({
            ...s,
            panels: s.panels.map(p => {
              if (p.id === panelId) {
                return {
                  ...p,
                  layers: p.layers.map(l => l.id === layerId ? { ...l, strokes } : l)
                };
              }
              return p;
            })
          }))
        }
      };
    }),

  updateLayerDataBase64: (panelId, layerId, dataBase64) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => ({
            ...s,
            panels: s.panels.map(p => {
              if (p.id === panelId) {
                return {
                  ...p,
                  layers: p.layers.map(l => l.id === layerId ? { ...l, dataBase64 } : l)
                };
              }
              return p;
            })
          }))
        }
      };
    }),

  updateLayerName: (panelId, layerId, name) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => ({
            ...s,
            panels: s.panels.map(p => {
              if (p.id === panelId) {
                return {
                  ...p,
                  layers: p.layers.map(l => l.id === layerId ? { ...l, name } : l)
                };
              }
              return p;
            })
          }))
        }
      };
    }),

  toggleLayerVisibility: (panelId, layerId) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => ({
            ...s,
            panels: s.panels.map(p => {
              if (p.id === panelId) {
                return {
                  ...p,
                  layers: p.layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l)
                };
              }
              return p;
            })
          }))
        }
      };
    }),

  setLayerOpacity: (panelId, layerId, opacity) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => ({
            ...s,
            panels: s.panels.map(p => {
              if (p.id === panelId) {
                return {
                  ...p,
                  layers: p.layers.map(l => l.id === layerId ? { ...l, opacity } : l)
                };
              }
              return p;
            })
          }))
        }
      };
    }),

  moveLayerUp: (panelId, layerId) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => ({
            ...s,
            panels: s.panels.map(p => {
              if (p.id === panelId) {
                const layerIndex = p.layers.findIndex(l => l.id === layerId);
                if (layerIndex < p.layers.length - 1) {
                  const newLayers = [...p.layers];
                  const temp = newLayers[layerIndex];
                  newLayers[layerIndex] = newLayers[layerIndex + 1];
                  newLayers[layerIndex + 1] = temp;
                  return { ...p, layers: newLayers };
                }
              }
              return p;
            })
          }))
        }
      };
    }),

  moveLayerDown: (panelId, layerId) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => ({
            ...s,
            panels: s.panels.map(p => {
              if (p.id === panelId) {
                const layerIndex = p.layers.findIndex(l => l.id === layerId);
                if (layerIndex > 0) {
                  const newLayers = [...p.layers];
                  const temp = newLayers[layerIndex];
                  newLayers[layerIndex] = newLayers[layerIndex - 1];
                  newLayers[layerIndex - 1] = temp;
                  return { ...p, layers: newLayers };
                }
              }
              return p;
            })
          }))
        }
      };
    }),

  updateScriptPageContent: (pageId, contentBase64) =>
    set((state) => {
      if (!state.project) return state;

      if (!contentBase64 || contentBase64.trim() === '') {
         contentBase64 = '<p></p>';
      }

      const updatePageInFolder = (folder: any): any => {
        return {
          ...folder,
          children: folder.children.map((child: any) => {
            if (child.type === 'page' && child.id === pageId) {
              return { ...child, contentBase64 };
            } else if (child.type === 'folder') {
              return updatePageInFolder(child);
            }
            return child;
          })
        };
      };

      return {
        project: {
          ...state.project,
          rootScriptFolder: updatePageInFolder(state.project.rootScriptFolder)
        }
      };
    }),

  syncScenesFromContent: (contentBase64) =>
    set((state) => {
      if (!state.project) return state;

      const parser = new DOMParser();
      const doc = parser.parseFromString(contentBase64, 'text/html');
      
      const sceneHeadingNodes = Array.from(doc.querySelectorAll('.scene-heading')).map(el => el.textContent?.trim()).filter(Boolean) as string[];

      let updatedScenes = [...state.project.scenes];
      let maxOrder = updatedScenes.length > 0 ? Math.max(...updatedScenes.map(s => s.order)) : 0;

      const currentValidHeadings = new Set<string>();

      sceneHeadingNodes.forEach(headingName => {
        if (!headingName || headingName.length < 3) return; 
        
        currentValidHeadings.add(headingName);
        
        if (!updatedScenes.some(s => s.name === headingName)) {
          updatedScenes.push({
            id: crypto.randomUUID(),
            name: headingName,
            order: ++maxOrder,
            panels: []
          });
        }
      });
      
      updatedScenes = updatedScenes.filter(scene => {
         return currentValidHeadings.has(scene.name) || scene.panels.length > 0;
      });

      return {
        project: {
          ...state.project,
          scenes: updatedScenes,
        }
      };
    }),

  importScriptPage: (fileName, content) =>
    set((state) => {
      if (!state.project) return state;

      let targetPageId: string | null = null;
      let targetFolderId: string | null = null;

      const findPage = (folder: any) => {
        for (const child of folder.children) {
          if (child.type === 'page' && child.name === fileName) {
            targetPageId = child.id;
            return true;
          } else if (child.type === 'folder') {
            if (findPage(child)) return true;
          }
        }
        return false;
      };
      findPage(state.project.rootScriptFolder);

      const lines = content.split(/\r?\n/);
      let htmlContent = '';
      for (let line of lines) {
        line = line.trim();
        if (!line) {
          htmlContent += '<p></p>';
          continue;
        }
        if (line.match(/^(INT\.|EXT\.|I\/E\.)\s/i)) {
          htmlContent += `<p class="scene-heading">${line}</p>`;
          
          if (!state.project.scenes.some(s => s.name === line)) {
            const maxOrder = state.project.scenes.length > 0 ? Math.max(...state.project.scenes.map(s => s.order)) : 0;
            state.project.scenes.push({
              id: crypto.randomUUID(),
              name: line,
              order: maxOrder + 1,
              panels: []
            });
          }
        } else if (line === line.toUpperCase() && line.length < 40 && !line.match(/^(INT\.|EXT\.|I\/E\.)\s/i) && !line.includes('  ')) {
          htmlContent += `<p class="character">${line}</p>`;
        } else if (line.startsWith('(') && line.endsWith(')')) {
          htmlContent += `<p class="parenthetical">${line}</p>`;
        } else if (line.match(/^(CUT TO:|FADE IN:|FADE OUT:|DISSOLVE TO:)$/i)) {
          htmlContent += `<p class="transition">${line}</p>`;
        } else {
          htmlContent += `<p class="action">${line}</p>`;
        }
      }

      if (targetPageId) {
        const updatePageInFolder = (folder: any): any => ({
          ...folder,
          children: folder.children.map((child: any) => {
            if (child.type === 'page' && child.id === targetPageId) {
              return { ...child, contentBase64: htmlContent };
            } else if (child.type === 'folder') {
              return updatePageInFolder(child);
            }
            return child;
          })
        });
        
        return {
          project: { ...state.project, rootScriptFolder: updatePageInFolder(state.project.rootScriptFolder) },
          activeScriptPageId: targetPageId
        };
      } else {
        const draftsFolder = state.project.rootScriptFolder.children.find(c => c.type === 'folder' && c.name === 'Drafts');
        targetFolderId = draftsFolder ? draftsFolder.id : state.project.rootScriptFolder.id;
        
        const newPage: ScriptPage = {
          id: crypto.randomUUID(),
          name: fileName,
          type: 'page',
          contentBase64: htmlContent
        };

        const addPage = (folder: any): any => {
          if (folder.id === targetFolderId) {
            return { ...folder, children: [...folder.children, newPage] };
          }
          return {
            ...folder,
            children: folder.children.map((child: any) => 
              child.type === 'folder' ? addPage(child) : child
            )
          };
        };

        return {
          project: { ...state.project, rootScriptFolder: addPage(state.project.rootScriptFolder) },
          activeScriptPageId: newPage.id
        };
      }
    }),

  addPageToFolder: (folderId, pageName) =>
    set((state) => {
      if (!state.project) return state;

      const newPage: ScriptPage = {
        id: crypto.randomUUID(),
        name: pageName,
        type: 'page',
        contentBase64: '' 
      };

      const addPage = (folder: any): any => {
        if (folder.id === folderId) {
          return { ...folder, children: [...folder.children, newPage] };
        }
        return {
          ...folder,
          children: folder.children.map((child: any) => 
            child.type === 'folder' ? addPage(child) : child
          )
        };
      };

      return {
        project: {
          ...state.project,
          rootScriptFolder: addPage(state.project.rootScriptFolder)
        },
        activeScriptPageId: newPage.id
      };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      if (!state.project) return state;

      const remove = (folder: any): any => {
        return {
          ...folder,
          children: folder.children
            .filter((child: any) => child.id !== nodeId)
            .map((child: any) => (child.type === 'folder' ? remove(child) : child)),
        };
      };

      const newRoot = remove(state.project.rootScriptFolder);
      let nextActive = state.activeScriptPageId;
      if (nextActive === nodeId) {
        nextActive = firstScriptPageIdFromRoot(newRoot);
      }

      return {
        project: {
          ...state.project,
          rootScriptFolder: newRoot,
        },
        activeScriptPageId: nextActive,
      };
    }),

  updateNodeName: (nodeId, name) =>
    set((state) => {
      if (!state.project) return state;

      const update = (folder: any): any => {
        return {
          ...folder,
          children: folder.children.map((child: any) => {
            if (child.id === nodeId) {
              return { ...child, name };
            } else if (child.type === 'folder') {
              return update(child);
            }
            return child;
          })
        };
      };

      return {
        project: {
          ...state.project,
          rootScriptFolder: update(state.project.rootScriptFolder)
        }
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
    
  updatePanelThumbnail: (panelId, thumbnailBase64) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => ({
            ...s,
            panels: s.panels.map(p => p.id === panelId ? { ...p, thumbnailBase64 } : p)
          }))
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

  setAnimaticEditingMode: (enabled) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const p = state.project;
      const tl = p.timeline!;
      const timelineBase = {
        overwriteClips: !!tl.overwriteClips,
        storyboardTracks: tl.storyboardTracks,
        audioTracks: tl.audioTracks,
        videoTracks: tl.videoTracks,
        sequences: tl.sequences,
        acts: tl.acts,
        cameraKeyframes: tl.cameraKeyframes,
        layerKeyframes: tl.layerKeyframes,
      };
      if (enabled) {
        const starts = computeRipplePanelStartTimes(p);
        const scenes = p.scenes.map((s) => ({
          ...s,
          panels: s.panels.map((panel) => ({
            ...panel,
            timelineStartSec: starts.get(panel.id) ?? 0,
          })),
        }));
        return {
          project: {
            ...p,
            scenes,
            timeline: { ...timelineBase, animaticEditingMode: true },
          },
        };
      }
      const scenes = p.scenes.map((s) => ({
        ...s,
        panels: s.panels.map(({ timelineStartSec: _ts, ...rest }) => rest),
      }));
      return {
        project: {
          ...p,
          scenes,
          timeline: { ...timelineBase, animaticEditingMode: false },
        },
      };
    }),

  setTimelineOverwriteClips: (enabled) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, overwriteClips: enabled },
        },
      };
    }),

  addTimelineAudioTrack: () =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const newTrack: TimelineAudioTrack = {
        id: crypto.randomUUID(),
        name: `A${tl.audioTracks.length + 1}`,
        muted: false,
        solo: false,
        locked: false,
        clips: [],
      };
      return {
        project: {
          ...state.project,
          timeline: { ...tl, audioTracks: [...tl.audioTracks, newTrack] },
        },
      };
    }),

  removeTimelineAudioTrack: (trackIndex: number) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      if (tl.audioTracks.length <= 1) return state; 
      const audioTracks = tl.audioTracks.filter((_, i) => i !== trackIndex);
      return {
        project: {
          ...state.project,
          timeline: { ...tl, audioTracks },
        },
      };
    }),

  addTimelineAudioClip: (trackIndex, clip) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const next = { ...tr, clips: [...tr.clips, { ...clip, id: clip.id || crypto.randomUUID() }] };
      tracks[trackIndex] = next;
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  updateTimelineAudioClip: (trackIndex, clipId, patch) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = {
        ...tr,
        clips: tr.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  removeTimelineAudioClip: (trackIndex, clipId) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = { ...tr, clips: tr.clips.filter((c) => c.id !== clipId) };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  setTimelineTrackMuted: (trackIndex, muted) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = state.project.timeline.audioTracks.map((t, i) =>
        i === trackIndex ? { ...t, muted } : t,
      );
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  setTimelineTrackSolo: (trackIndex, solo) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = state.project.timeline.audioTracks.map((t, i) => ({
        ...t,
        solo: solo ? i === trackIndex : false,
      }));
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  moveTimelineAudioClip: (trackIndex, clipId, newStartTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const dur = clip.durationSec;
      const ns = Math.max(0, newStartTimeSec);
      const ne = ns + dur;
      const others = tr.clips.filter((c) => c.id !== clipId);
      let newOthers = others;
      if (state.project.timeline.overwriteClips) {
        newOthers = cutTimelineRangeFromClips(others, ns, ne, '__none__');
      }
      const moved: TimelineAudioClip = { ...clip, startTimeSec: ns };
      tracks[trackIndex] = { ...tr, clips: [...newOthers, moved] };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  resizeTimelineAudioClip: (trackIndex, clipId, edge, timelineTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const s = clip.startTimeSec;
      const e = s + clip.durationSec;
      const t = timelineTimeSec;
      const minDur = 0.08;
      if (edge === 'right') {
        const newEnd = Math.max(s + minDur, t);
        const newDur = newEnd - s;
        tracks[trackIndex] = {
          ...tr,
          clips: tr.clips.map((c) => (c.id === clipId ? { ...c, durationSec: newDur } : c)),
        };
      } else {
        const newStart = Math.min(t, e - minDur);
        const delta = newStart - s;
        const newDur = e - newStart;
        const newTrim = clip.sourceTrimStartSec + delta;
        if (newTrim < 0) return state;
        tracks[trackIndex] = {
          ...tr,
          clips: tr.clips.map((c) =>
            c.id === clipId
              ? { ...c, startTimeSec: newStart, durationSec: newDur, sourceTrimStartSec: newTrim }
              : c,
          ),
        };
      }
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
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

  slipTimelineAudioClipToTrim: (trackIndex, clipId, sourceTrimStartSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const sourceLen =
        clip.sourceDurationSec != null && clip.sourceDurationSec > 0
          ? clip.sourceDurationSec
          : clip.durationSec + clip.sourceTrimStartSec;
      const minDur = 0.08;
      let newTrim = Math.max(0, Math.min(sourceTrimStartSec, sourceLen - minDur));
      let newDur = clip.durationSec;
      if (newTrim + newDur > sourceLen) {
        newDur = Math.max(minDur, sourceLen - newTrim);
      }
      tracks[trackIndex] = {
        ...tr,
        clips: tr.clips.map((c) =>
          c.id === clipId
            ? { ...c, sourceTrimStartSec: newTrim, durationSec: newDur }
            : c,
        ),
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  addTimelineActAt: (startSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const acts = [...state.project.timeline.acts];
      const order = acts.length ? Math.max(...acts.map((a) => a.order)) + 1 : 1;
      acts.push({
        id: crypto.randomUUID(),
        name: `Act ${order}`,
        startSec: Math.max(0, startSec),
        order,
      });
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, acts },
        },
      };
    }),

  addTimelineSequenceAt: (startSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const sequences = [...state.project.timeline.sequences];
      const order = sequences.length ? Math.max(...sequences.map((s) => s.order)) + 1 : 1;
      sequences.push({
        id: crypto.randomUUID(),
        name: `Sequence ${order}`,
        startSec: Math.max(0, startSec),
        order,
      });
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, sequences },
        },
      };
    }),

  addTimelineVideoClip: (trackIndex, clip) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = {
        ...tr,
        clips: [...tr.clips, { ...clip, id: clip.id || crypto.randomUUID() }],
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  updateTimelineVideoClip: (trackIndex, clipId, patch) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = {
        ...tr,
        clips: tr.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  removeTimelineVideoClip: (trackIndex, clipId) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = { ...tr, clips: tr.clips.filter((c) => c.id !== clipId) };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  setTimelineVideoTrackMuted: (trackIndex, muted) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = state.project.timeline.videoTracks.map((t, i) =>
        i === trackIndex ? { ...t, muted } : t,
      );
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  moveTimelineVideoClip: (trackIndex, clipId, newStartTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const dur = clip.durationSec;
      const ns = Math.max(0, newStartTimeSec);
      const ne = ns + dur;
      const others = tr.clips.filter((c) => c.id !== clipId);
      let newOthers = others;
      if (state.project.timeline.overwriteClips) {
        newOthers = cutTimelineRangeFromVideoClips(others, ns, ne, '__none__');
      }
      const moved: TimelineVideoClip = { ...clip, startTimeSec: ns };
      tracks[trackIndex] = { ...tr, clips: [...newOthers, moved] };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  resizeTimelineVideoClip: (trackIndex, clipId, edge, timelineTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const s = clip.startTimeSec;
      const e = s + clip.durationSec;
      const t = timelineTimeSec;
      const minDur = 0.08;
      if (edge === 'right') {
        const newEnd = Math.max(s + minDur, t);
        const newDur = newEnd - s;
        tracks[trackIndex] = {
          ...tr,
          clips: tr.clips.map((c) => (c.id === clipId ? { ...c, durationSec: newDur } : c)),
        };
      } else {
        const newStart = Math.min(t, e - minDur);
        const delta = newStart - s;
        const newDur = e - newStart;
        const newTrim = clip.sourceTrimStartSec + delta;
        if (newTrim < 0) return state;
        tracks[trackIndex] = {
          ...tr,
          clips: tr.clips.map((c) =>
            c.id === clipId
              ? { ...c, startTimeSec: newStart, durationSec: newDur, sourceTrimStartSec: newTrim }
              : c,
          ),
        };
      }
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  slipTimelineVideoClipToTrim: (trackIndex, clipId, sourceTrimStartSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const sourceLen =
        clip.sourceDurationSec != null && clip.sourceDurationSec > 0
          ? clip.sourceDurationSec
          : clip.durationSec + clip.sourceTrimStartSec;
      const minDur = 0.08;
      let newTrim = Math.max(0, Math.min(sourceTrimStartSec, sourceLen - minDur));
      let newDur = clip.durationSec;
      if (newTrim + newDur > sourceLen) {
        newDur = Math.max(minDur, sourceLen - newTrim);
      }
      tracks[trackIndex] = {
        ...tr,
        clips: tr.clips.map((c) =>
          c.id === clipId
            ? { ...c, sourceTrimStartSec: newTrim, durationSec: newDur }
            : c,
        ),
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  addTimelineCameraKeyframe: (timeSec, values) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const t = Math.max(0, timeSec);
      const k: TimelineCameraKeyframe = {
        id: crypto.randomUUID(),
        timeSec: t,
        panX: values?.panX ?? 0,
        panY: values?.panY ?? 0,
        zoom: values?.zoom ?? 1,
        rotationDeg: values?.rotationDeg ?? 0,
      };
      const cameraKeyframes = [...state.project.timeline.cameraKeyframes, k].sort((a, b) => a.timeSec - b.timeSec);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, cameraKeyframes },
        },
      };
    }),

  removeTimelineCameraKeyframe: (id) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            cameraKeyframes: state.project.timeline.cameraKeyframes.filter((k) => k.id !== id),
          },
        },
      };
    }),

  moveTimelineCameraKeyframe: (id, timeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const t = Math.max(0, timeSec);
      const cameraKeyframes = state.project.timeline.cameraKeyframes
        .map((k) => (k.id === id ? { ...k, timeSec: t } : k))
        .sort((a, b) => a.timeSec - b.timeSec);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, cameraKeyframes },
        },
      };
    }),

  updateTimelineCameraKeyframe: (id, patch) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const cameraKeyframes = state.project.timeline.cameraKeyframes.map((k) =>
        k.id === id ? { ...k, ...patch } : k,
      );
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, cameraKeyframes },
        },
      };
    }),

  addTimelineLayerKeyframe: (timeSec, panelId, layerId, values) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const t = Math.max(0, timeSec);
      const k: TimelineLayerKeyframe = {
        id: crypto.randomUUID(),
        timeSec: t,
        panelId,
        layerId,
        offsetX: values?.offsetX ?? 0,
        offsetY: values?.offsetY ?? 0,
        scale: values?.scale ?? 1,
        opacityMul: values?.opacityMul ?? 1,
      };
      const layerKeyframes = [...state.project.timeline.layerKeyframes, k].sort((a, b) => a.timeSec - b.timeSec);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, layerKeyframes },
        },
      };
    }),

  removeTimelineLayerKeyframe: (id) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            layerKeyframes: state.project.timeline.layerKeyframes.filter((k) => k.id !== id),
          },
        },
      };
    }),

  moveTimelineLayerKeyframe: (id, timeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const t = Math.max(0, timeSec);
      const layerKeyframes = state.project.timeline.layerKeyframes
        .map((k) => (k.id === id ? { ...k, timeSec: t } : k))
        .sort((a, b) => a.timeSec - b.timeSec);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, layerKeyframes },
        },
      };
    }),

  updateTimelineLayerKeyframe: (id, patch) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const layerKeyframes = state.project.timeline.layerKeyframes.map((k) =>
        k.id === id ? { ...k, ...patch } : k,
      );
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, layerKeyframes },
        },
      };
    }),

  addStoryboardTrack: () =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const sorted = [...tl.storyboardTracks].sort((a, b) => a.order - b.order);
      const maxOrder = sorted.length ? Math.max(...sorted.map((t) => t.order)) : -1;
      const next = [...tl.storyboardTracks, newStoryboardTrack(maxOrder + 1, `Layer ${sorted.length + 1}`)];
      return {
        project: {
          ...state.project,
          timeline: { ...tl, storyboardTracks: next },
        },
      };
    }),

  removeStoryboardTrack: (trackId) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const sorted = [...tl.storyboardTracks].sort((a, b) => a.order - b.order);
      if (sorted.length <= 1) return state;
      const victim = sorted.find((t) => t.id === trackId);
      if (!victim || victim.order === 0) return state;
      const reindexed = sorted
        .filter((t) => t.id !== trackId)
        .sort((a, b) => a.order - b.order)
        .map((t, i) => ({ ...t, order: i }));
      return {
        project: {
          ...state.project,
          timeline: { ...tl, storyboardTracks: reindexed },
        },
      };
    }),

  setStoryboardTrackMuted: (trackId, muted) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
          },
        },
      };
    }),

  addStoryboardClip: (trackId, clipIn) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const ti = tl.storyboardTracks.findIndex((t) => t.id === trackId);
      if (ti < 0) return state;
      const tr = tl.storyboardTracks[ti]!;
      if (tr.locked) return state;
      const id = clipIn.id || crypto.randomUUID();
      const nextClip: TimelineStoryboardClip = {
        id,
        name: clipIn.name,
        panelId: clipIn.panelId,
        startTimeSec: Math.max(0, clipIn.startTimeSec),
        durationSec: Math.max(0.05, clipIn.durationSec),
        layerIds: clipIn.layerIds,
      };
      let clips = [...tr.clips];
      if (tl.overwriteClips) {
        clips = cutStoryboardRangeFromClips(
          clips,
          nextClip.startTimeSec,
          nextClip.startTimeSec + nextClip.durationSec,
          '__none__',
        );
      }
      clips.push(nextClip);
      clips.sort((a, b) => a.startTimeSec - b.startTimeSec);
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t, i) => (i === ti ? { ...t, clips } : t)),
          },
        },
      };
    }),

  removeStoryboardClip: (trackId, clipId) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const tr = tl.storyboardTracks.find((t) => t.id === trackId);
      if (!tr || tr.locked) return state;
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t) =>
              t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
            ),
          },
        },
      };
    }),

  moveStoryboardClip: (trackId, clipId, newStartTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const ti = tl.storyboardTracks.findIndex((t) => t.id === trackId);
      if (ti < 0) return state;
      const tr = tl.storyboardTracks[ti]!;
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const dur = clip.durationSec;
      const ns = Math.max(0, newStartTimeSec);
      const ne = ns + dur;
      let others = tr.clips.filter((c) => c.id !== clipId);
      if (tl.overwriteClips) {
        others = cutStoryboardRangeFromClips(others, ns, ne, '__none__');
      }
      const moved = { ...clip, startTimeSec: ns };
      const clips = [...others, moved].sort((a, b) => a.startTimeSec - b.startTimeSec);
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t, i) => (i === ti ? { ...t, clips } : t)),
          },
        },
      };
    }),

  resizeStoryboardClip: (trackId, clipId, edge, timelineTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const ti = tl.storyboardTracks.findIndex((t) => t.id === trackId);
      if (ti < 0) return state;
      const tr = tl.storyboardTracks[ti]!;
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const s = clip.startTimeSec;
      const e = s + clip.durationSec;
      const t = timelineTimeSec;
      const minDur = 0.08;
      let nextClip: TimelineStoryboardClip;
      if (edge === 'right') {
        const newEnd = Math.max(s + minDur, t);
        nextClip = { ...clip, durationSec: newEnd - s };
      } else {
        const newStart = Math.min(Math.max(0, t), e - minDur);
        nextClip = { ...clip, startTimeSec: newStart, durationSec: e - newStart };
      }
      let others = tr.clips.filter((c) => c.id !== clipId);
      if (tl.overwriteClips) {
        others = cutStoryboardRangeFromClips(
          others,
          nextClip.startTimeSec,
          nextClip.startTimeSec + nextClip.durationSec,
          '__none__',
        );
      }
      const clips = [...others, nextClip].sort((a, b) => a.startTimeSec - b.startTimeSec);
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t, i) => (i === ti ? { ...t, clips } : t)),
          },
        },
      };
    }),
}));