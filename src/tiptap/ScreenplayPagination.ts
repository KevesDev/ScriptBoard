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
      const { node } = view.domAtPos(pos, 1);
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
  const mt = parseFloat(cs.marginTop) || 0;
  const mb = parseFloat(cs.marginBottom) || 0;
  return el.offsetHeight + mt + mb;
}

/**
 * AAA Layout Engine: Calculates where page breaks SHOULD be visually 
 * rendered without ever modifying the underlying document data.
 */
function calculatePagination(view: EditorView, pageBodyHeightPx: number): DecorationSet {
  const blocks: { pos: number; height: number; type: string }[] = [];
  
  // 1. Map the heights of all root-level nodes
  view.state.doc.forEach((node, offset) => {
    // AAA FIX: offset + 1 ensures we target the absolute position of the node itself
    // placing the decoration safely BETWEEN blocks instead of inside them.
    const pos = offset + 1; 
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

      // Safety: Never put a page break before the very first node
      if (breakIdx === 0) breakIdx = 1;

      pageNum++;
      const breakPos = blocks[breakIdx].pos;
      
      // 3. Generate the "Ghost" Page Break Decoration using a factory function
      // This prevents ProseMirror from dropping the DOM node during fast typing
      decos.push(Decoration.widget(breakPos, () => {
        const widget = document.createElement('div');
        widget.className = 'script-page-break-decorator select-none pointer-events-none';
        widget.contentEditable = 'false'; // Prevents cursor from entering the gap
        
        // AAA FIX: Using transform to bleed into padding guarantees it won't be clipped
        widget.style.cssText = `
          height: 36px;
          background: #f3f4f6;
          width: calc(100% + 2in);
          transform: translateX(-1in);
          margin: 2rem 0;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-right: 1in;
          border-top: 2px dashed #9ca3af;
          border-bottom: 2px dashed #9ca3af;
          position: relative;
          z-index: 50;
          user-select: none;
        `;
        widget.innerHTML = `<span style="font-family: 'Courier Prime', Courier, monospace; font-size: 12px; color: #6b7280; font-weight: bold;">PAGE ${pageNum}</span>`;
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
      pageBodyHeightPx: 96 * 9 - 52,
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
            return DecorationSet.empty;
          },
          apply(tr, oldState) {
            const meta = tr.getMeta(screenplayPaginationKey);
            if (meta?.clear) {
              return DecorationSet.empty;
            }
            if (meta?.decos !== undefined) {
              return meta.decos;
            }
            // Map decorations securely through document changes so they don't break while typing
            return oldState.map(tr.mapping, tr.doc);
          }
        },
        props: {
          decorations(state) {
            return this.getState(state);
          }
        },
        view: (view: EditorView) => {
          let debounceTimer: ReturnType<typeof setTimeout> | null = null;
          let isDestroyed = false;

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
            update: (updatedView) => {
              const meta = updatedView.state.tr.getMeta(screenplayPaginationKey);
              if (meta?.forceRecalc) {
                runLayoutEngine();
                return;
              }
              
              // Only schedule the Layout Engine if the user actually typed/deleted content.
              // This guarantees zero infinite loops!
              if (!updatedView.state.tr.docChanged) return;
              schedule();
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