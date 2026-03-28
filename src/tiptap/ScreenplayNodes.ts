import { Node, Mark, mergeAttributes, Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import ListItem from '@tiptap/extension-list-item';

export interface ScreenplayNodeOptions {
  HTMLAttributes: Record<string, any>;
}

// Global Shortcuts Extension
export const ScreenplayShortcuts = Extension.create({
  name: 'screenplayShortcuts',

  addKeyboardShortcuts() {
    return {
      'Space': () => {
        // Return false to allow default space behavior, 
        // preventing capture if something else was intercepting it
        return false; 
      }
    };
  }
});

// Allow any block (Action, Dialogue, etc) to be wrapped in a List Item
export const CustomListItem = ListItem.extend({
  content: 'block+',
});

// Scene Heading
export const SceneHeading = Node.create<ScreenplayNodeOptions>({
  name: 'sceneHeading',
  priority: 1000,
  group: 'block',
  content: 'inline*',
  
  addOptions() {
    return { 
      HTMLAttributes: { 
        class: 'scene-heading',
        'data-type': 'sceneHeading'
      } 
    };
  },

  parseHTML() {
    return [
      { tag: 'p.scene-heading' },
      { tag: 'p[data-type="sceneHeading"]' }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  
  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        if (editor.isActive('bulletList') || editor.isActive('orderedList')) return false;
        if (!editor.isActive('sceneHeading')) return false;
        editor.commands.splitBlock();
        editor.commands.setNode('action');
        return true;
      },
    };
  }
});

// Action
export const Action = Node.create<ScreenplayNodeOptions>({
  name: 'action',
  priority: 1000,
  group: 'block',
  content: 'inline*',

  addOptions() {
    return { 
      HTMLAttributes: { 
        class: 'action',
        'data-type': 'action'
      } 
    };
  },

  parseHTML() {
    return [
      { tag: 'p.action' },
      { tag: 'p[data-type="action"]' }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        if (editor.isActive('bulletList') || editor.isActive('orderedList')) return false;
        if (!editor.isActive('action')) return false;
        editor.commands.splitBlock();
        editor.commands.setNode('action');
        return true;
      },
    };
  }
});

// Character
export const Character = Node.create<ScreenplayNodeOptions>({
  name: 'character',
  priority: 1000,
  group: 'block',
  content: 'inline*',

  addOptions() {
    return { 
      HTMLAttributes: { 
        class: 'character',
        'data-type': 'character'
      } 
    };
  },

  parseHTML() {
    return [
      { tag: 'p.character' },
      { tag: 'p[data-type="character"]' }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        if (editor.isActive('bulletList') || editor.isActive('orderedList')) return false;
        if (!editor.isActive('character')) return false;
        editor.commands.splitBlock();
        editor.commands.setNode('dialogue');
        return true;
      },
    };
  }
});

// Dialogue
export const Dialogue = Node.create<ScreenplayNodeOptions>({
  name: 'dialogue',
  priority: 1000,
  group: 'block',
  content: 'inline*',

  addOptions() {
    return { 
      HTMLAttributes: { 
        class: 'dialogue',
        'data-type': 'dialogue'
      } 
    };
  },

  parseHTML() {
    return [
      { tag: 'p.dialogue' },
      { tag: 'p[data-type="dialogue"]' }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        if (editor.isActive('bulletList') || editor.isActive('orderedList')) return false;
        if (!editor.isActive('dialogue')) return false;
        editor.commands.splitBlock();
        editor.commands.setNode('action');
        return true;
      },
    };
  }
});

// Parenthetical
export const Parenthetical = Node.create<ScreenplayNodeOptions>({
  name: 'parenthetical',
  priority: 1000,
  group: 'block',
  content: 'inline*',

  addOptions() {
    return { 
      HTMLAttributes: { 
        class: 'parenthetical',
        'data-type': 'parenthetical'
      } 
    };
  },

  parseHTML() {
    return [
      { tag: 'p.parenthetical' },
      { tag: 'p[data-type="parenthetical"]' }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const strips: { from: number; to: number }[] = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'parenthetical' || !node.isTextblock) return;
            const text = node.textContent;
            const m = /^[\s\u00a0]+/.exec(text);
            if (m) strips.push({ from: pos + 1, to: pos + 1 + m[0].length });
          });
          if (strips.length === 0) return null;
          strips.sort((a, b) => b.from - a.from);
          let tr = newState.tr;
          for (const { from, to } of strips) tr = tr.delete(from, to);
          return tr;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        if (editor.isActive('bulletList') || editor.isActive('orderedList')) return false;
        if (!editor.isActive('parenthetical')) return false;
        editor.commands.splitBlock();
        editor.commands.setNode('dialogue');
        return true;
      },
    };
  }
});

// Transition
export const Transition = Node.create<ScreenplayNodeOptions>({
  name: 'transition',
  priority: 1000,
  group: 'block',
  content: 'inline*',

  addOptions() {
    return { 
      HTMLAttributes: { 
        class: 'transition',
        'data-type': 'transition'
      } 
    };
  },

  parseHTML() {
    return [
      { tag: 'p.transition' },
      { tag: 'p[data-type="transition"]' }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        if (editor.isActive('bulletList') || editor.isActive('orderedList')) return false;
        if (!editor.isActive('transition')) return false;
        editor.commands.splitBlock();
        editor.commands.setNode('action');
        return true;
      },
    };
  }
});

/** Enter in plain StarterKit blocks > next line is Action (default screenplay line). */
export const ScreenplayDefaultEnter = Extension.create({
  name: 'screenplayDefaultEnter',
  priority: 950,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (editor.isActive('bulletList') || editor.isActive('orderedList')) return false;
        if (editor.isActive('codeBlock')) return false;
        const parent = editor.state.selection.$from.parent.type.name;
        if (parent !== 'paragraph' && parent !== 'heading') return false;
        editor.commands.splitBlock();
        editor.commands.setNode('action');
        return true;
      },
    };
  },
});

// Inline Comment Mark
export const CommentMark = Mark.create({
  name: 'comment',
  
  addAttributes() {
    return {
      commentId: {
        default: null,
      },
      text: {
        default: '',
      },
      author: {
        default: 'Unknown',
      },
      timestamp: {
        default: 0,
      }
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-comment-id]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'script-comment-highlight', style: 'background-color: rgba(250, 204, 21, 0.4); border-bottom: 2px solid #eab308; cursor: pointer;' }), 0];
  }
});