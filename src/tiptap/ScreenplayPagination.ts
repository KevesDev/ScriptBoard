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
      return 0;
    }
  }
  if (!el || el.nodeType !== 1) return 0;
  
  const cs = window.getComputedStyle(el);
  const mb = parseFloat(cs.marginBottom) || 0;
  return el.offsetHeight + mb;
}

/**
 * Layout Engine: Calculates where page breaks SHOULD be visually 
 * rendered without ever modifying the underlying document data.
 */
function calculatePagination(view: EditorView, pageBodyHeightPx: number): DecorationSet {
  const blocks: { pos: number; height: number; type: string }[] = [];
  
  // 1. Map the heights of all root-level nodes
  view.state.doc.forEach((node, offset) => {
    const pos = offset; 
    let h = domBlockHeight(view, pos);
    if (h <= 0) h = 24; // Fallback height if not fully rendered yet
    blocks.push({ pos, height: h, type: node.type.name });
  });

  const decos: Decoration[] = [];
  let used = 0;
  let pageNum = 1;

  // 2. Iterate and apply Widow/Orphan formatting rules
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    
    if (used + b.height > pageBodyHeightPx && used > 0) {
      
      // Widow/Orphan Protection: Don't strand Character without their Dialogue!
      let breakIdx = i;
      if (b.type === 'dialogue' || b.type === 'parenthetical') {
        let j = i - 1;
        while (j > 0 && (blocks[j].type === 'character' || blocks[j].type === 'parenthetical')) {
          breakIdx = j;
          j--;
        }
      }

      // Safety: Never put a page break before the very first node!
      if (breakIdx === 0) breakIdx = 1;

      pageNum++;
      const breakPos = blocks[breakIdx].pos;
      
      // 3. Generate the "Ghost" Page Break Decoration
      decos.push(Decoration.widget(breakPos, () => {
        const widget = document.createElement('div');
        widget.className = 'script-page-break-decorator';
        widget.contentEditable = 'false'; // Prevents cursor from entering the gap
        
        // Sleek, thin <hr> style break. Negative margins slice it cleanly across the padding.
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

      // 4. Reset 'used' vertical space to the height of the blocks we just shifted to the new page
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
            // Map decorations securely through document changes so they don't break while typing
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

            // Wait for DOM to finish rendering the user's latest keystroke
            requestAnimationFrame(() => {
              if (isDestroyed) return;
              const newDecos = calculatePagination(view, opts.pageBodyHeightPx);
              view.dispatch(view.state.tr.setMeta(screenplayPaginationKey, { decos: newDecos }));
            });
          };

          const schedule = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            // 300ms debounce ensures buttery smooth typing even on massive scripts
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
              
              // Check if the document data changed during this exact transaction.
              // If true, the user typed/pasted text, so we schedule the Layout Engine.
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