import React, { useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { isKeyboardEventTargetTextEntry } from '../lib/keyboardTargets';

interface GlobalShortcutManagerProps {
  getActiveMode: () => 'script' | 'storyboard';
  onSave: () => void;
  onSaveAs: () => void;
}

export const GlobalShortcutManager: React.FC<GlobalShortcutManagerProps> = ({ getActiveMode, onSave, onSaveAs }) => {
  const { undo, redo } = useProjectStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const shift = e.shiftKey;
      const key = e.key.toLowerCase();

      const isTyping = isKeyboardEventTargetTextEntry(e.target);
      const activeMode = getActiveMode();

      if (mod && key === 's') {
        e.preventDefault();
        if (shift) onSaveAs();
        else onSave();
        return;
      }

      if (activeMode === 'storyboard') {
        if (mod && key === 'z' && !isTyping) {
          e.preventDefault();
          if (shift) redo();
          else undo();
          return;
        }
        if (mod && key === 'y' && !isTyping) {
          e.preventDefault();
          redo();
          return;
        }

        if (key === ' ' && !isTyping) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:play-pause'));
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [getActiveMode, onSave, onSaveAs, undo, redo]);

  return null; 
};