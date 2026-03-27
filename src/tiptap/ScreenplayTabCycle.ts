import { Extension } from '@tiptap/core';

/**
 * Screenplay line types in toolbar / typical Fountain order.
 * Tab advances, Shift+Tab goes back (wraps).
 */
export const SCREENPLAY_TAB_ORDER = [
  'sceneHeading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
] as const;

export type ScreenplayTabBlock = (typeof SCREENPLAY_TAB_ORDER)[number];

const ORDER_SET = new Set<string>(SCREENPLAY_TAB_ORDER);

function cycleIndexForParentType(name: string): number {
  if (ORDER_SET.has(name)) {
    return SCREENPLAY_TAB_ORDER.indexOf(name as ScreenplayTabBlock);
  }
  if (name === 'paragraph' || name === 'heading') {
    return SCREENPLAY_TAB_ORDER.indexOf('action');
  }
  return -1;
}

/**
 * Single handler for Tab / Shift+Tab so line types cycle predictably (YouMe-style).
 * Defers to default behavior inside lists and code blocks.
 */
export const ScreenplayTabCycle = Extension.create({
  name: 'screenplayTabCycle',
  priority: 1200,

  addKeyboardShortcuts() {
    const run = (editor: import('@tiptap/core').Editor, delta: 1 | -1) => {
      if (
        editor.isActive('bulletList') ||
        editor.isActive('orderedList') ||
        editor.isActive('listItem') ||
        editor.isActive('codeBlock')
      ) {
        return false;
      }

      const name = editor.state.selection.$from.parent.type.name;
      let idx = cycleIndexForParentType(name);
      if (idx < 0) return false;

      const len = SCREENPLAY_TAB_ORDER.length;
      const nextIdx = (idx + delta + len) % len;
      const nextType = SCREENPLAY_TAB_ORDER[nextIdx];
      return editor.commands.setNode(nextType);
    };

    return {
      Tab: ({ editor }) => run(editor, 1),
      'Shift-Tab': ({ editor }) => run(editor, -1),
    };
  },
});
