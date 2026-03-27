import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BrushConfig } from '@common/models';

import brushPenUrl from '../assets/Brush_Pen.png';
import brushPencilUrl from '../assets/Brush_Pencil.png';
import brushMarkerUrl from '../assets/Brush_Marker.png';
import brushAirbrushUrl from '../assets/Brush_Airbrush.png';

export interface OnionSkinPreferences {
  /** Panels to show before the current (same scene), 0–5 */
  panelsBefore: number;
  /** Panels to show after the current (same scene), 0–5 */
  panelsAfter: number;
  /** Tint for previous panels (#RRGGBB) */
  previousColor: string;
  /** Tint for following panels (#RRGGBB) */
  nextColor: string;
  /** Opacity of the closest neighbor panel, 5–100% */
  nearestOpacityPercent: number;
  /** Each step away from the current panel multiplies opacity by this amount (falloff). */
  fadePerStep: number;
  /** When true, new sessions start with onion skin on (toggle still in toolbar) */
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
    pan: string; // usually spacebar
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
    /** When true, first typed letter at the start of Action / Dialogue lines is uppercased. */
    autoCapitalizeFirstLetter: boolean;
  };
  onionSkin: OnionSkinPreferences;
  /** Project file backups & autosave (renderer + Electron main). */
  files: {
    /** Write `Name.autosave.sbproj` next to the main file on an interval. */
    autoSaveEnabled: boolean;
    autoSaveIntervalMinutes: number;
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
}

export const defaultBrushes: Record<string, BrushConfig> = {
  solid: {
    id: 'solid',
    name: 'Pen',
    spacing: 0.05,
    scatter: 0,
    rotationMode: 'path',
    rotationAngle: 0,
    flow: 1.0,
    pressureSize: true,
    pressureOpacity: false,
    textureBase64: brushPenUrl
  },
  pencil: {
    id: 'pencil',
    name: 'Pencil',
    spacing: 0.1,
    scatter: 0.2, // Simulate noise
    rotationMode: 'random',
    rotationAngle: 0,
    flow: 0.3, // Builds up opacity
    pressureSize: true,
    pressureOpacity: true,
    textureBase64: brushPencilUrl
  },
  marker: {
    id: 'marker',
    name: 'Marker',
    spacing: 0.05,
    scatter: 0,
    rotationMode: 'path', // Follow path for flat marker edge
    rotationAngle: 0,
    flow: 0.6,
    pressureSize: false,
    pressureOpacity: true,
    textureBase64: brushMarkerUrl
  },
  airbrush: {
    id: 'airbrush',
    name: 'Airbrush',
    spacing: 0.05,
    scatter: 0,
    rotationMode: 'fixed',
    rotationAngle: 0,
    flow: 0.3,
    pressureSize: true,
    pressureOpacity: true,
    textureBase64: brushAirbrushUrl
  }
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
    scriptScene: 'ctrl+1',
    scriptAction: 'ctrl+2',
    scriptCharacter: 'ctrl+3',
    scriptParenthetical: 'ctrl+4',
    scriptDialogue: 'ctrl+5',
    scriptTransition: 'ctrl+6',
  },
  brushSettings: {
    pencilNoise: 0.15,
    markerOpacity: 0.6,
    lastTool: 'pen',
    lastPreset: 'solid',
    lastColor: '#000000',
    lastSize: 5,
  },
  scriptSettings: {
    fontSize: 14,
    autoCapitalizeFirstLetter: true,
  },
  onionSkin: {
    panelsBefore: 1,
    panelsAfter: 1,
    previousColor: '#ff6b6b',
    nextColor: '#4dabf7',
    nearestOpacityPercent: 35,
    fadePerStep: 0.65,
    startEnabled: false,
  },
  files: {
    autoSaveEnabled: true,
    autoSaveIntervalMinutes: 5,
  },
  customBrushes: []
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      preferences: defaultPreferences,
      isPreferencesOpen: false,
      setPreferences: (prefs) => 
        set((state) => ({ 
          preferences: { ...state.preferences, ...prefs } 
        })),
      setPreferencesOpen: (isOpen) => set({ isPreferencesOpen: isOpen }),
      resetPreferences: () => set({ preferences: defaultPreferences }),
      addCustomBrush: (brush) => set((state) => ({
        preferences: { ...state.preferences, customBrushes: [...state.preferences.customBrushes, brush] }
      })),
      removeCustomBrush: (id) => set((state) => ({
        preferences: { ...state.preferences, customBrushes: state.preferences.customBrushes.filter(b => b.id !== id) }
      })),
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
          shortcuts: {
            ...currentState.preferences.shortcuts,
            ...(persistedState.preferences?.shortcuts || {})
          },
          brushSettings: {
            ...currentState.preferences.brushSettings,
            ...(persistedState.preferences?.brushSettings || {})
          },
          scriptSettings: {
            ...currentState.preferences.scriptSettings,
            ...(persistedState.preferences?.scriptSettings || {})
          },
          onionSkin: {
            ...currentState.preferences.onionSkin,
            ...(persistedState.preferences?.onionSkin || {})
          },
          files: {
            ...currentState.preferences.files,
            ...(persistedState.preferences?.files || {})
          }
        }
      })
    }
  )
);