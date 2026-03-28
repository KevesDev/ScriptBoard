import type { StateCreator } from 'zustand';
import type { ProjectStoreState } from '../projectStore';
import type { Layer, Stroke } from '@common/models';

export interface CanvasSlice {
  addLayer: (panelId: string, type: 'vector' | 'raster') => void;
  removeLayer: (panelId: string, layerId: string) => void;
  updateLayerStrokes: (panelId: string, layerId: string, strokes: Stroke[]) => void;
  updateLayerDataBase64: (panelId: string, layerId: string, dataBase64: string) => void;
  updateLayerName: (panelId: string, layerId: string, name: string) => void;
  toggleLayerVisibility: (panelId: string, layerId: string) => void;
  setLayerOpacity: (panelId: string, layerId: string, opacity: number) => void;
  moveLayerUp: (panelId: string, layerId: string) => void;
  moveLayerDown: (panelId: string, layerId: string) => void;
  updatePanelThumbnail: (panelId: string, thumbnailBase64: string) => void;
}

export const createCanvasSlice: StateCreator<ProjectStoreState, [], [], CanvasSlice> = (set, get) => ({
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
});