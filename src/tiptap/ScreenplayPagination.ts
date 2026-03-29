import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { screenplayFoldingKey } from './ScreenplayFolding';

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
  
  const cs = window.getComputedStyle(el);
  const mb = parseFloat(cs.marginBottom) || 0;
  const h = el.offsetHeight + mb;
  
  return h > 0 ? h : -1;
}

/**
 * Layout Engine (Two-Pass System)
 * Pass 1: Calculates True Page numbers for ALL nodes (hidden or visible).
 * Pass 2: Generates exactly one physical page break only when visible pages jump.
 */
function calculatePagination(view: EditorView, pageBodyHeightPx: number): DecorationSet {
  const foldingState = screenplayFoldingKey.getState(view.state);
  const foldedPositions: number[] = foldingState?.foldedPositions || [];
  
  // Track metadata for all blocks
  const blocks: { pos: number; node: any; vh: number; isFolded: boolean; pageNum: number }[] = [];
  let activeFoldEnd = -1;

  // PASS 1: Build the Virtual Document
  view.state.doc.forEach((node, offset) => {
    const pos = offset; 
    let isFolded = false;

    if (node.type.name === 'sceneHeading') {
      if (foldedPositions.includes(pos)) {
        let nextHeadingPos = view.state.doc.content.size;
        view.state.doc.nodesBetween(pos + node.nodeSize, view.state.doc.content.size, (n, p) => {
          if (n.type.name === 'sceneHeading' && p > pos) {
            nextHeadingPos = p;
            return false;
          }
        });
        activeFoldEnd = nextHeadingPos;
      } else {
        activeFoldEnd = -1;
      }
    } else if (activeFoldEnd > -1 && pos < activeFoldEnd) {
      isFolded = true;
    }

    let h = 0;
    if (isFolded) {
      // Heuristic: ~60 chars/line, 24px height + 16px margins. 
      // Bypasses the DOM entirely so hidden scenes don't trigger layout thrashing.
      const lines = Math.max(1, Math.ceil((node.textContent.length || 1) / 60));
      h = lines * 24 + 16; 
    } else {
      h = domBlockHeight(view, pos);
      if (h === -1) {
        const lines = Math.max(1, Math.ceil((node.textContent.length || 1) / 60));
        h = lines * 24 + 16;
      }
    }

    blocks.push({ pos, node, vh: h, isFolded, pageNum: 1 });
  });

  // PASS 2: Calculate True Page Numbers
  let used = 0;
  let currentPage = 1;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    
    if (used + b.vh > pageBodyHeightPx && used > 0) {
      
      // Widow/Orphan protection
      let breakIdx = i;
      if (b.node.type.name === 'dialogue' || b.node.type.name === 'parenthetical') {
        let j = i - 1;
        while (j > 0 && (blocks[j].node.type.name === 'character' || blocks[j].node.type.name === 'parenthetical')) {
          breakIdx = j;
          j--;
        }
      }
      if (breakIdx === 0) breakIdx = 1;

      currentPage++;
      
      used = 0;
      for (let k = breakIdx; k <= i; k++) {
        blocks[k].pageNum = currentPage;
        used += blocks[k].vh;
      }

      // If a single block (like a folded 10-page scene) is massive, 
      // mathematically consume the true pages it spans so the count remains accurate.
      while (used > pageBodyHeightPx) {
        currentPage++;
        used -= pageBodyHeightPx;
        blocks[i].pageNum = currentPage;
      }

    } else {
      b.pageNum = currentPage;
      used += b.vh;
      
      // Safety catch for massive initial blocks
      while (used > pageBodyHeightPx) {
        currentPage++;
        used -= pageBodyHeightPx;
        b.pageNum = currentPage;
      }
    }
  }

  // PASS 3: Generate visual decorators (Only on visible boundaries)
  const decos: Decoration[] = [];
  let lastVisiblePage = 1;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    
    // We never draw visual page breaks inside a folded scene.
    if (b.isFolded) continue; 
    
    // If the True Page Number jumped, draw EXACTLY ONE break.
    if (b.pageNum > lastVisiblePage) {
      decos.push(Decoration.widget(b.pos, () => {
        const widget = document.createElement('div');
        widget.className = 'script-page-break-decorator';
        widget.contentEditable = 'false'; 
        
        // Pass the True Page Number to the DOM so the Gutter Markers can read it
        widget.setAttribute('data-page-start', b.pageNum.toString()); 
        
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
      }, { side: -1, key: `page-break-jump-${b.pageNum}-${b.pos}` }));
      
      lastVisiblePage = b.pageNum;
    }
  }

  return DecorationSet.create(view.state.doc, decos);
}

export const ScreenplayPagination = Extension.create<ScreenplayPaginationOptions>({
  name: 'screenplayPagination',

  addOptions() {
    return {
      getEnabled: () => false,
      pageBodyHeightPx: 864, 
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
                return;
              }

              // Deep compare folding state. If the user expands or collapses a scene, 
              // it dynamically alters visual layout without altering the core doc.
              const prevFoldState = screenplayFoldingKey.getState(prevState);
              const newFoldState = screenplayFoldingKey.getState(updatedView.state);
              
              const prevFolds = prevFoldState?.foldedPositions || [];
              const newFolds = newFoldState?.foldedPositions || [];
              
              if (prevFolds.length !== newFolds.length) {
                schedule();
                return;
              }
              for (let i = 0; i < prevFolds.length; i++) {
                if (prevFolds[i] !== newFolds[i]) {
                  schedule();
                  return;
                }
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