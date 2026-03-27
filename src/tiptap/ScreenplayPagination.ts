import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export const screenplayPaginationKey = new PluginKey('screenplayPagination');

/** Matches `padding-top: 1in` on blocks after a page break (index.css). */
const PRINT_BLOCK_TOP_PAD_PX = 96;

export interface ScreenplayPaginationOptions {
  getEnabled: () => boolean;
  getDefer: () => boolean;
  pageBodyHeightPx: number;
}

function collectPageBreakRanges(doc: PMNode): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'pageBreak') {
      ranges.push({ from: pos, to: pos + node.nodeSize });
    }
  });
  return ranges;
}

/** Outer height for a top-level block at document position `pos` (before the node). */
function domBlockHeight(view: EditorView, pos: number): number {
  let el = view.nodeDOM(pos) as HTMLElement | null;
  if (!el || el.nodeType !== 1) {
    el = view.nodeDOM(pos + 1) as HTMLElement | null;
  }
  if (!el || el.nodeType !== 1) {
    try {
      const { node } = view.domAtPos(pos, 1);
      let n: Node | null = node;
      if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
      el = n as HTMLElement | null;
      while (el && el.parentElement && el.parentElement !== view.dom) {
        el = el.parentElement;
      }
    } catch {
      return 6;
    }
  }
  if (!el || el.nodeType !== 1) return 6;
  const cs = window.getComputedStyle(el);
  const mt = parseFloat(cs.marginTop) || 0;
  const mb = parseFloat(cs.marginBottom) || 0;
  return el.offsetHeight + mt + mb;
}

function splitOneOversizedTopLevelBlock(view: EditorView, pageBody: number, key: PluginKey): boolean {
  let target: { a: number; b: number } | null = null;
  view.state.doc.forEach((child, offset) => {
    if (target) return;
    if (child.type.name === 'pageBreak' || !child.isTextblock) return;
    const pos = 1 + offset;
    const h = domBlockHeight(view, pos);
    if (h <= pageBody + 8) return;
    const a = pos + 1;
    const b = pos + child.nodeSize - 1;
    if (b <= a) return;
    target = { a, b };
  });
  if (!target) return false;
  const mid = Math.floor((target.a + target.b) / 2);
  const tr = view.state.tr.split(mid);
  tr.setMeta(key, true);
  tr.setMeta('addToHistory', false);
  view.dispatch(tr);
  return true;
}

function blockMetrics(view: EditorView): { pos: number; height: number }[] {
  const doc = view.state.doc;
  const out: { pos: number; height: number }[] = [];
  doc.forEach((child, offset, index) => {
    if (child.type.name === 'pageBreak') return;
    const pos = 1 + offset;
    let h = domBlockHeight(view, pos);
    if (index > 0 && doc.child(index - 1).type.name === 'pageBreak') {
      h -= PRINT_BLOCK_TOP_PAD_PX;
      h = Math.max(h, 6);
    }
    out.push({ pos, height: Math.max(h, 6) });
  });
  return out;
}

function desiredBreakBeforeBlockIndices(blocks: { height: number }[], pageBody: number): Set<number> {
  const set = new Set<number>();
  let used = 0;
  const limit = pageBody + 0.5;

  for (let i = 0; i < blocks.length; i++) {
    const h = blocks[i].height;
    if (h > pageBody) {
      if (used > 0) {
        set.add(i);
        used = 0;
      }
      used = 0;
      continue;
    }
    if (used > 0 && used + h > limit) {
      set.add(i);
      used = h;
    } else {
      used += h;
    }
  }
  return set;
}

function desiredBreakPositions(blocks: { pos: number; height: number }[], pageBody: number): number[] {
  const indices = desiredBreakBeforeBlockIndices(blocks, pageBody);
  return blocks.filter((_, i) => indices.has(i)).map((b) => b.pos);
}

function stripPageBreaks(view: EditorView, key: PluginKey) {
  const dels = collectPageBreakRanges(view.state.doc);
  if (dels.length === 0) return;
  let tr = view.state.tr;
  tr.setMeta(key, true);
  tr.setMeta('addToHistory', false);
  dels.sort((a, b) => b.from - a.from);
  for (const { from, to } of dels) {
    tr = tr.delete(from, to);
  }
  view.dispatch(tr);
}

function insertBreaksAt(view: EditorView, positions: number[], key: PluginKey) {
  const pageBreakType = view.state.schema.nodes.pageBreak;
  if (!pageBreakType || positions.length === 0) return;
  const unique = [...new Set(positions)].sort((a, b) => b - a);
  let tr = view.state.tr;
  tr.setMeta(key, true);
  tr.setMeta('addToHistory', false);
  for (const p of unique) {
    tr = tr.insert(p, pageBreakType.create());
  }
  if (tr.docChanged) view.dispatch(tr);
}

function collapseAdjacentPageBreaks(view: EditorView, key: PluginKey) {
  const doc = view.state.doc;
  const toDelete: { from: number; to: number }[] = [];
  let prevWasBreak = false;
  doc.forEach((child, offset) => {
    const pos = 1 + offset;
    if (child.type.name === 'pageBreak') {
      if (prevWasBreak) {
        toDelete.push({ from: pos, to: pos + child.nodeSize });
      }
      prevWasBreak = true;
    } else {
      prevWasBreak = false;
    }
  });
  if (toDelete.length === 0) return;
  let tr = view.state.tr;
  tr.setMeta(key, true);
  tr.setMeta('addToHistory', false);
  toDelete.sort((a, b) => b.from - a.from);
  for (const d of toDelete) {
    tr = tr.delete(d.from, d.to);
  }
  view.dispatch(tr);
}

/**
 * One full pass: remove all auto breaks, wait for layout, split tall paragraphs, insert breaks from measurements.
 * No “want === have” shortcut — that skipped work when DOM heights were still wrong (~6px), so no breaks ever appeared.
 */
export function repaginatePrintView(view: EditorView, pageBody: number, key: PluginKey) {
  if (!view.dom.isConnected || !view.state.schema.nodes.pageBreak) return;

  let tr = view.state.tr;
  tr.setMeta(key, true);
  tr.setMeta('addToHistory', false);
  const dels = collectPageBreakRanges(view.state.doc);
  dels.sort((a, b) => b.from - a.from);
  for (const { from, to } of dels) {
    tr = tr.delete(from, to);
  }

  const afterStrip = () => {
    if (!view.dom.isConnected) return;
    let guard = 0;
    while (guard++ < 120 && splitOneOversizedTopLevelBlock(view, pageBody, key)) {
      /* one split per loop; layout updates before next */
    }
    const blocks = blockMetrics(view);
    const desired = desiredBreakPositions(blocks, pageBody);
    insertBreaksAt(view, desired, key);
    collapseAdjacentPageBreaks(view, key);
  };

  if (tr.docChanged) {
    view.dispatch(tr);
    requestAnimationFrame(() => requestAnimationFrame(afterStrip));
  } else {
    requestAnimationFrame(() => requestAnimationFrame(afterStrip));
  }
}

export function scheduleScreenplayRepagination(
  view: EditorView,
  pageBody: number,
  opts: { enabled: boolean; defer: boolean },
) {
  if (!opts.enabled || opts.defer) return;
  queueMicrotask(() => {
    repaginatePrintView(view, pageBody, screenplayPaginationKey);
  });
}

export const ScreenplayPagination = Extension.create<ScreenplayPaginationOptions>({
  name: 'screenplayPagination',

  addOptions() {
    return {
      getEnabled: () => false,
      getDefer: () => false,
      pageBodyHeightPx: 96 * 9 - 52,
    };
  },

  addCommands() {
    const opts = this.options;
    return {
      repaginateScript:
        () =>
        ({ editor }) => {
          scheduleScreenplayRepagination(editor.view, opts.pageBodyHeightPx, {
            enabled: opts.getEnabled(),
            defer: opts.getDefer(),
          });
          return true;
        },
      stripScriptPageBreaks:
        () =>
        ({ editor }) => {
          stripPageBreaks(editor.view, screenplayPaginationKey);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    const key = screenplayPaginationKey;
    const pageBody = opts.pageBodyHeightPx;

    return [
      new Plugin({
        key,
        view: (view: EditorView) => {
          let debounceTimer: ReturnType<typeof setTimeout> | null = null;

          const run = () => {
            debounceTimer = null;
            if (!view.dom.isConnected) return;
            if (!opts.getEnabled()) {
              stripPageBreaks(view, key);
              return;
            }
            if (opts.getDefer()) return;
            repaginatePrintView(view, pageBody, key);
          };

          const schedule = () => {
            if (debounceTimer !== null) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(run, 100);
          };

          schedule();

          return {
            update: (updatedView, prevState) => {
              if (updatedView.state.doc.eq(prevState.doc)) return;
              schedule();
            },
            destroy: () => {
              if (debounceTimer !== null) clearTimeout(debounceTimer);
            },
          };
        },
      }),
    ];
  },
});
