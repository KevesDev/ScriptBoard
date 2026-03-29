import React, { useEffect, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useAppStore } from '../store/appStore';
import { isKeyboardEventTargetTextEntry } from '../lib/keyboardTargets';

interface GlobalShortcutManagerProps {
  getActiveMode: () => 'script' | 'storyboard';
  onSave: () => void;
  onSaveAs: () => void;
}

export const GlobalShortcutManager: React.FC<GlobalShortcutManagerProps> = ({ getActiveMode, onSave, onSaveAs }) => {
  const { undo, redo } = useProjectStore();
  const preferences = useAppStore((s) => s.preferences);
  const pressedKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Context Check
      const isTyping = isKeyboardEventTargetTextEntry(e.target);
      const activeMode = getActiveMode();
      const prefs = preferences.shortcuts;

      // 2. Combo Normalization
      let val = e.key.toLowerCase();
      if (val === ' ') val = 'space';
      const modifiers = [];
      if (e.ctrlKey || e.metaKey) modifiers.push('ctrl');
      if (e.shiftKey) modifiers.push('shift');
      if (e.altKey) modifiers.push('alt');
      const combo = modifiers.length > 0 ? `${modifiers.join('+')}+${val}` : val;
      pressedKeys.current.add(combo);

      // 3. Global System Intents (Applies to both modes)
      if (combo === 'ctrl+s') { e.preventDefault(); onSave(); return; }
      if (combo === 'ctrl+shift+s') { e.preventDefault(); onSaveAs(); return; }

      // 4. Intent Mapping
      let intent: string | null = null;
      Object.entries(prefs).forEach(([k, v]) => {
        if (v === combo) intent = k;
      });
      
      // If typing, EXPLICITLY yield all text-editing intents to Tiptap/Browser
      // This prevents the coarse project-level Undo from intercepting character typing.
      const textIntents = ['undo', 'redo', 'copy', 'cut', 'paste', 'delete'];
      if (isTyping && (!intent || textIntents.includes(intent))) return;

      // Basic fallbacks if not in preferences
      if (!intent) {
        if (combo === 'delete' || combo === 'backspace') intent = 'delete';
        if (combo === 'space') intent = 'space';
      }
      if (!intent) return;

      // 5. Mode-Specific Execution Logic
      if (activeMode === 'script') {
        // Script Mode Intent Routing (only if not typing)
        if (!isTyping) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(`shortcut:${intent}-down`, { detail: { originalEvent: e } }));
        }
      } 
      else if (activeMode === 'storyboard') {
        // Storyboard Mode Intent Routing (Project Undo vs Canvas Intent)
        if (intent === 'undo') { e.preventDefault(); undo(); return; }
        if (intent === 'redo') { e.preventDefault(); redo(); return; }

        e.preventDefault();
        window.dispatchEvent(new CustomEvent(`shortcut:${intent}-down`, { detail: { originalEvent: e } }));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      let val = e.key.toLowerCase();
      if (val === ' ') val = 'space';
      const modifiers = [];
      if (e.ctrlKey || e.metaKey) modifiers.push('ctrl');
      if (e.shiftKey) modifiers.push('shift');
      if (e.altKey) modifiers.push('alt');
      const combo = modifiers.length > 0 ? `${modifiers.join('+')}+${val}` : val;
      pressedKeys.current.delete(combo);

      let intent: string | null = null;
      Object.entries(preferences.shortcuts).forEach(([k, v]) => {
        if (v === combo) intent = k;
      });

      if (intent) {
        window.dispatchEvent(new CustomEvent(`shortcut:${intent}-up`, { detail: { originalEvent: e } }));
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
    };
  }, [getActiveMode, onSave, onSaveAs, undo, redo, preferences]);

  return null;
};