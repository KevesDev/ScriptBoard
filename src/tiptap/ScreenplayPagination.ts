import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

export const screenplayPaginationKey = new PluginKey('screenplayPagination');

export interface ScreenplayPaginationOptions {
  getEnabled: () => boolean;
  pageBodyHeightPx: number;
}

/**
 * Safely measures the actual rendered height of a top-level block.
 */
function domBlockHeight(view: EditorView, pos: number): number {
  let el = view.nodeDOM(pos) as HTMLElement | null;
  if (!el || el.nodeType !== 1) {
    try {
      const { node } = view.domAtPos(pos);
      let n: Node | null = node;
      if (n?.nodeType === Node.TEXT_NODE) n = n.parentElement;
      el = n as HTMLElement | null;
      while (el && el.parentElement && el.parentElement !== view.dom) {
        el = el.parentElement;
      }
    } catch {
      return -1; // -1 specifically flags "not rendered yet"
    }
  }
  if (!el || el.nodeType !== 1) return -1;
  
  // AAA BUG FIX: Check if the element was explicitly hidden by the Folding Plugin
  // This is lightning fast and prevents the 24px fallback loop on invisible scenes.
  if (el.classList.contains('script-folded-node')) {
    return 0; 
  }
  
  const cs = window.getComputedStyle(el);
  const mb = parseFloat(cs.marginBottom) || 0;
  const h = el.offsetHeight + mb;
  
  return h > 0 ? h : -1;
}

/**
 * AAA Layout Engine: Calculates where page breaks SHOULD be visually 
 * rendered without ever modifying the underlying document data.
 */
function calculatePagination(view: EditorView, pageBodyHeightPx: number): DecorationSet {
  const blocks: { pos: number; height: number; type: string }[] = [];
  
  view.state.doc.forEach((node, offset) => {
    const pos = offset; 
    let h = domBlockHeight(view, pos);
    if (h === -1) h = 24; // Fallback height ONLY if the node is unrendered, not folded
    blocks.push({ pos, height: h, type: node.type.name });
  });

  const decos: Decoration[] = [];
  let used = 0;
  let pageNum = 1;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    
    if (used + b.height > pageBodyHeightPx && used > 0) {
      
      let breakIdx = i;
      if (b.type === 'dialogue' || b.type === 'parenthetical') {
        let j = i - 1;
        while (j > 0 && (blocks[j].type === 'character' || blocks[j].type === 'parenthetical')) {
          breakIdx = j;
          j--;
        }
      }

      if (breakIdx === 0) breakIdx = 1;

      pageNum++;
      const breakPos = blocks[breakIdx].pos;
      
      decos.push(Decoration.widget(breakPos, () => {
        const widget = document.createElement('div');
        widget.className = 'script-page-break-decorator';
        widget.contentEditable = 'false'; 
        
        widget.style.cssText = `
          height: 2px;
          background-color: #d4d4d8; 
          margin-top: 1.5rem;
          margin-bottom: 1.5rem;
          margin-left: -1in;
          margin-right: -1in;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          position: relative;
          z-index: 50;
          user-select: none;
          pointer-events: none;
        `;
        
        return widget;
      }, { side: -1, key: `page-break-${pageNum}` }));

      used = 0;
      for (let k = breakIdx; k <= i; k++) {
        used += blocks[k].height;
      }
    } else {
      used += b.height;
    }
  }

  return DecorationSet.create(view.state.doc, decos);
}

export const ScreenplayPagination = Extension.create<ScreenplayPaginationOptions>({
  name: 'screenplayPagination',

  addOptions() {
    return {
      getEnabled: () => false,
      pageBodyHeightPx: 864, // 11 inches minus 1-inch top/bottom margins
    };
  },

  addCommands() {
    return {
      repaginateScript: () => ({ editor }) => {
        const tr = editor.state.tr.setMeta(screenplayPaginationKey, { forceRecalc: true });
        editor.view.dispatch(tr);
        return true;
      },
      stripScriptPageBreaks: () => ({ editor }) => {
        const tr = editor.state.tr.setMeta(screenplayPaginationKey, { clear: true });
        editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;

    return [
      new Plugin({
        key: screenplayPaginationKey,
        state: {
          init() {
            return { decos: DecorationSet.empty, recalcId: 0 };
          },
          apply(tr, value) {
            const meta = tr.getMeta(screenplayPaginationKey);
            if (meta?.clear) {
              return { decos: DecorationSet.empty, recalcId: value.recalcId };
            }
            if (meta?.forceRecalc) {
              return { decos: value.decos.map(tr.mapping, tr.doc), recalcId: value.recalcId + 1 };
            }
            if (meta?.decos !== undefined) {
              return { decos: meta.decos, recalcId: value.recalcId };
            }
            return { decos: value.decos.map(tr.mapping, tr.doc), recalcId: value.recalcId };
          }
        },
        props: {
          decorations(state) {
            return this.getState(state).decos;
          }
        },
        view: (view: EditorView) => {
          let debounceTimer: ReturnType<typeof setTimeout> | null = null;
          let isDestroyed = false;
          let lastRecalcId = screenplayPaginationKey.getState(view.state).recalcId;

          const runLayoutEngine = () => {
            if (isDestroyed || !view.dom.isConnected) return;
            
            if (!opts.getEnabled()) {
              view.dispatch(view.state.tr.setMeta(screenplayPaginationKey, { clear: true }));
              return;
            }

            requestAnimationFrame(() => {
              if (isDestroyed) return;
              const newDecos = calculatePagination(view, opts.pageBodyHeightPx);
              view.dispatch(view.state.tr.setMeta(screenplayPaginationKey, { decos: newDecos }));
            });
          };

          const schedule = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(runLayoutEngine, 300); 
          };

          schedule();

          return {
            update: (updatedView, prevState) => {
              const state = screenplayPaginationKey.getState(updatedView.state);
              if (state.recalcId !== lastRecalcId) {
                lastRecalcId = state.recalcId;
                schedule();
                return;
              }
              
              if (prevState.doc !== updatedView.state.doc) {
                schedule();
              }
            },
            destroy: () => {
              isDestroyed = true;
              if (debounceTimer) clearTimeout(debounceTimer);
            },
          };
        },
      }),
    ];
  },
});