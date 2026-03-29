import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BrushConfig } from '@common/models';

import brushPenUrl from '../assets/Brush_Pen.png';
import brushPencilUrl from '../assets/Brush_Pencil.png';
import brushMarkerUrl from '../assets/Brush_Marker.png';
import brushAirbrushUrl from '../assets/Brush_Airbrush.png';

export type ScriptEditorLayout = 'print' | 'continuous';

export interface OnionSkinPreferences {
  panelsBefore: number;
  panelsAfter: number;
  previousColor: string;
  nextColor: string;
  nearestOpacityPercent: number;
  fadePerStep: number;
  startEnabled: boolean;
}

export interface AppPreferences {
  shortcuts: {
    undo: string;
    redo: string;
    copy: string;
    cut: string;
    paste: string;
    zoomIn: string;
    zoomOut: string;
    pan: string; 
    timelineZoomIn: string;
    timelineZoomOut: string;
    scriptScene: string;
    scriptAction: string;
    scriptCharacter: string;
    scriptParenthetical: string;
    scriptDialogue: string;
    scriptTransition: string;
  };
  brushSettings: {
    pencilNoise: number;
    markerOpacity: number;
    lastTool: string;
    lastPreset: string;
    lastColor: string;
    lastSize: number;
  };
  scriptSettings: {
    fontSize: number;
    autoCapitalizeFirstLetter: boolean;
    layout: ScriptEditorLayout;
  };
  onionSkin: OnionSkinPreferences;
  files: {
    autoSaveEnabled: boolean;
    autoSaveIntervalMinutes: number;
    backupEnabled: boolean;
    backupIntervalMinutes: number;
  };
  customBrushes: BrushConfig[];
}

interface AppState {
  preferences: AppPreferences;
  isPreferencesOpen: boolean;
  setPreferences: (prefs: Partial<AppPreferences>) => void;
  setPreferencesOpen: (isOpen: boolean) => void;
  resetPreferences: () => void;
  addCustomBrush: (brush: BrushConfig) => void;
  removeCustomBrush: (id: string) => void;
  updateCustomBrush: (id: string, config: Partial<BrushConfig>) => void;
}

export const defaultBrushes: Record<string, BrushConfig> = {
  solid: { id: 'solid', name: 'Pen', spacing: 0.05, scatter: 0, rotationMode: 'path', rotationAngle: 0, flow: 1.0, pressureSize: true, pressureOpacity: false, textureBase64: brushPenUrl },
  pencil: { id: 'pencil', name: 'Pencil', spacing: 0.1, scatter: 0.2, rotationMode: 'random', rotationAngle: 0, flow: 0.3, pressureSize: true, pressureOpacity: true, textureBase64: brushPencilUrl },
  marker: { id: 'marker', name: 'Marker', spacing: 0.05, scatter: 0, rotationMode: 'path', rotationAngle: 0, flow: 0.6, pressureSize: false, pressureOpacity: true, textureBase64: brushMarkerUrl },
  airbrush: { id: 'airbrush', name: 'Airbrush', spacing: 0.05, scatter: 0, rotationMode: 'fixed', rotationAngle: 0, flow: 0.3, pressureSize: true, pressureOpacity: true, textureBase64: brushAirbrushUrl }
};

const defaultPreferences: AppPreferences = {
  shortcuts: {
    undo: 'ctrl+z',
    redo: 'ctrl+y',
    copy: 'ctrl+c',
    cut: 'ctrl+x',
    paste: 'ctrl+v',
    zoomIn: 'ctrl+=',
    zoomOut: 'ctrl+-',
    pan: 'space',
    timelineZoomIn: 'alt+=',
    timelineZoomOut: 'alt+-',
    scriptScene: 'ctrl+1',
    scriptAction: 'ctrl+2',
    scriptCharacter: 'ctrl+3',
    scriptParenthetical: 'ctrl+4',
    scriptDialogue: 'ctrl+5',
    scriptTransition: 'ctrl+6',
  },
  brushSettings: { pencilNoise: 0.15, markerOpacity: 0.6, lastTool: 'pen', lastPreset: 'solid', lastColor: '#000000', lastSize: 5 },
  scriptSettings: { fontSize: 14, autoCapitalizeFirstLetter: true, layout: 'print' },
  onionSkin: { panelsBefore: 1, panelsAfter: 1, previousColor: '#ff6b6b', nextColor: '#4dabf7', nearestOpacityPercent: 35, fadePerStep: 0.65, startEnabled: false },
  files: { autoSaveEnabled: true, autoSaveIntervalMinutes: 5, backupEnabled: true, backupIntervalMinutes: 30 },
  customBrushes: []
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      preferences: defaultPreferences,
      isPreferencesOpen: false,
      setPreferences: (prefs) => set((state) => ({ preferences: { ...state.preferences, ...prefs } })),
      setPreferencesOpen: (isOpen) => set({ isPreferencesOpen: isOpen }),
      resetPreferences: () => set({ preferences: defaultPreferences }),
      addCustomBrush: (brush) => set((state) => ({ preferences: { ...state.preferences, customBrushes: [...state.preferences.customBrushes, brush] } })),
      removeCustomBrush: (id) => set((state) => ({ preferences: { ...state.preferences, customBrushes: state.preferences.customBrushes.filter(b => b.id !== id) } })),
      updateCustomBrush: (id, config) => set((state) => {
        const existingIdx = state.preferences.customBrushes.findIndex(b => b.id === id);
        if (existingIdx >= 0) {
          const newBrushes = [...state.preferences.customBrushes];
          newBrushes[existingIdx] = { ...newBrushes[existingIdx], ...config };
          return { preferences: { ...state.preferences, customBrushes: newBrushes } };
        } else {
          // It's a default brush being overridden for the first time
          const defaultBrush = defaultBrushes[id];
          if (defaultBrush) {
            return { preferences: { ...state.preferences, customBrushes: [...state.preferences.customBrushes, { ...defaultBrush, ...config }] } };
          }
        }
        return state;
      }),
    }),
    {
      name: 'scriptboard-app-storage',
      partialize: (state) => ({ preferences: state.preferences }),
      merge: (persistedState: any, currentState: AppState) => ({
        ...currentState,
        ...persistedState,
        preferences: {
          ...currentState.preferences,
          ...(persistedState.preferences || {}),
          shortcuts: { ...currentState.preferences.shortcuts, ...(persistedState.preferences?.shortcuts || {}) },
          brushSettings: { ...currentState.preferences.brushSettings, ...(persistedState.preferences?.brushSettings || {}) },
          scriptSettings: { ...currentState.preferences.scriptSettings, ...(persistedState.preferences?.scriptSettings || {}) },
          onionSkin: { ...currentState.preferences.onionSkin, ...(persistedState.preferences?.onionSkin || {}) },
          files: { ...currentState.preferences.files, ...(persistedState.preferences?.files || {}) }
        }
      })
    }
  )
);