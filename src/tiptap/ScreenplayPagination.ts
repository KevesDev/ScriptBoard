import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export const screenplayPaginationKey = new PluginKey('screenplayPagination');

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

function blockMetrics(view: EditorView): { pos: number; height: number }[] {
  const out: { pos: number; height: number }[] = [];
  view.state.doc.forEach((child, offset) => {
    if (child.type.name === 'pageBreak') return;
    const pos = 1 + offset;
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    let h = 0;
    if (dom && dom.nodeType === 1) {
      const el = dom as HTMLElement;
      const cs = window.getComputedStyle(el);
      const mt = parseFloat(cs.marginTop) || 0;
      const mb = parseFloat(cs.marginBottom) || 0;
      h = el.offsetHeight + mt + mb;
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

function currentBreakBeforeBlockIndices(doc: PMNode): Set<number> {
  const set = new Set<number>();
  let nextBlockIndex = 0;
  doc.forEach((child) => {
    if (child.type.name === 'pageBreak') {
      set.add(nextBlockIndex);
    } else {
      nextBlockIndex += 1;
    }
  });
  return set;
}

function desiredBreakPositions(blocks: { pos: number; height: number }[], pageBody: number): number[] {
  const indices = desiredBreakBeforeBlockIndices(blocks, pageBody);
  return blocks.filter((_, i) => indices.has(i)).map((b) => b.pos);
}

function setsEqualNum(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
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
  let tr = view.state.tr;
  tr.setMeta(key, true);
  tr.setMeta('addToHistory', false);
  for (const p of [...positions].sort((a, b) => b - a)) {
    tr = tr.insert(p, pageBreakType.create());
  }
  if (tr.docChanged) view.dispatch(tr);
}

/** Strip all breaks, re-measure, insert desired breaks (two layout frames). */
function fullRepaginate(view: EditorView, pageBody: number, key: PluginKey) {
  const pageBreakType = view.state.schema.nodes.pageBreak;
  if (!pageBreakType) return;

  let tr = view.state.tr;
  tr.setMeta(key, true);
  tr.setMeta('addToHistory', false);
  const dels = collectPageBreakRanges(view.state.doc);
  dels.sort((a, b) => b.from - a.from);
  for (const { from, to } of dels) {
    tr = tr.delete(from, to);
  }

  const afterClean = () => {
    if (!view.dom.isConnected) return;
    const blocks = blockMetrics(view);
    const desired = desiredBreakPositions(blocks, pageBody);
    insertBreaksAt(view, desired, key);
  };

  if (tr.docChanged) {
    view.dispatch(tr);
    requestAnimationFrame(() => {
      requestAnimationFrame(afterClean);
    });
  } else {
    requestAnimationFrame(() => {
      requestAnimationFrame(afterClean);
    });
  }
}

function runPaginationPass(view: EditorView, pageBody: number, key: PluginKey) {
  if (!view.dom.isConnected) return;
  if (!view.state.schema.nodes.pageBreak) return;

  const blocks = blockMetrics(view);
  const want = desiredBreakBeforeBlockIndices(blocks, pageBody);
  const have = currentBreakBeforeBlockIndices(view.state.doc);

  if (setsEqualNum(want, have)) return;

  fullRepaginate(view, pageBody, key);
}

// Remove mistaken _opts - runPaginationPass is called with enabled checked outside

export function scheduleScreenplayRepagination(
  view: EditorView,
  pageBody: number,
  opts: { enabled: boolean; defer: boolean },
) {
  if (!opts.enabled || opts.defer) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      runPaginationPass(view, pageBody, screenplayPaginationKey);
    });
  });
}

export const ScreenplayPagination = Extension.create<ScreenplayPaginationOptions>({
  name: 'screenplayPagination',

  addOptions() {
    return {
      getEnabled: () => false,
      getDefer: () => false,
      pageBodyHeightPx: 96 * 9,
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
          let rafOuter = 0;
          let rafInner = 0;

          const run = () => {
            rafOuter = 0;
            rafInner = 0;
            if (!view.dom.isConnected) return;

            if (!opts.getEnabled()) {
              stripPageBreaks(view, key);
              return;
            }
            if (opts.getDefer()) return;

            runPaginationPass(view, pageBody, key);
          };

          return {
            update: (updatedView, prevState) => {
              if (updatedView.state.doc.eq(prevState.doc)) return;
              if (rafOuter) cancelAnimationFrame(rafOuter);
              if (rafInner) cancelAnimationFrame(rafInner);
              rafOuter = requestAnimationFrame(() => {
                rafInner = requestAnimationFrame(run);
              });
            },
            destroy: () => {
              if (rafOuter) cancelAnimationFrame(rafOuter);
              if (rafInner) cancelAnimationFrame(rafInner);
            },
          };
        },
      }),
    ];
  },
});
