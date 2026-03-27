import type { EditorView } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Extension } from '@tiptap/core';

const SCREENPLAY_CAP_BLOCKS = new Set(['action', 'dialogue']);

export const screenplaySentenceCapKey = new PluginKey<{ suppressed: Set<number> }>('screenplaySentenceCap');

function remapSuppressed(set: Set<number>, tr: Transaction): Set<number> {
  const next = new Set<number>();
  for (const p of set) {
    const r = tr.mapping.mapResult(p);
    if (!r.deleted) next.add(r.pos);
  }
  return next;
}

/** Map a character index inside `parent.textContent` to an absolute document position. */
function textOffsetToAbsInBlock(blockPos: number, parent: PMNode, textOffset: number): number | null {
  if (!parent.isTextblock || textOffset < 0) return null;
  let acc = 0;
  let found: number | null = null;
  parent.forEach((child, _offset, index) => {
    if (found != null) return false;
    if (child.isText) {
      const t = child.text ?? '';
      const len = t.length;
      if (acc + len > textOffset) {
        let p = blockPos + 1;
        for (let i = 0; i < index; i++) {
          p += parent.child(i).nodeSize;
        }
        found = p + (textOffset - acc);
        return false;
      }
      acc += len;
    }
    return;
  });
  return found;
}

function letterAbsPositionsAfterPeriod(blockPos: number, node: PMNode): number[] {
  const out: number[] = [];
  const t = node.textContent;
  for (let i = 0; i <= t.length - 3; i++) {
    if (t[i] === '.' && t[i + 1] === ' ' && /[a-zA-Z]/.test(t[i + 2])) {
      const abs = textOffsetToAbsInBlock(blockPos, node, i + 2);
      if (abs != null) out.push(abs);
    }
  }
  return out;
}

function addSuppressionsWhenUserLowercased(
  oldState: EditorState,
  newState: EditorState,
  tr: Transaction,
  suppressed: Set<number>,
): Set<number> {
  const next = new Set(suppressed);
  const inv = tr.mapping.invert();
  newState.doc.descendants((node, pos) => {
    if (!SCREENPLAY_CAP_BLOCKS.has(node.type.name) || !node.isTextblock) return;
    for (const absNew of letterAbsPositionsAfterPeriod(pos, node)) {
      let absOld: number;
      try {
        absOld = inv.map(absNew);
      } catch {
        continue;
      }
      if (absOld < 0 || absOld >= oldState.doc.content.size) continue;
      const nCh = newState.doc.textBetween(absNew, absNew + 1);
      const oCh = oldState.doc.textBetween(absOld, absOld + 1);
      if (oCh.length === 1 && nCh.length === 1 && /[A-Z]/.test(oCh) && /[a-z]/.test(nCh)) {
        next.add(absNew);
      }
    }
  });
  return next;
}

/** After removing an uppercase letter right after ". ", remember the gap so the next typed letter is not forced uppercase. */
function addSuppressionsWhenCapitalRemovedAfterPeriod(
  oldState: EditorState,
  tr: Transaction,
  suppressed: Set<number>,
): Set<number> {
  const next = new Set(suppressed);
  oldState.doc.descendants((oldNode, pos) => {
    if (!SCREENPLAY_CAP_BLOCKS.has(oldNode.type.name) || !oldNode.isTextblock) return;

    // `pos` is from the pre-transaction doc. After setContent / project swap, `tr.doc` is unrelated;
    // `tr.doc.nodeAt(pos)` throws RangeError. Map through the step mapping and skip deleted ranges.
    let mappedPos: number;
    try {
      const res = tr.mapping.mapResult(pos);
      if (res.deleted) return;
      mappedPos = res.pos;
    } catch {
      return;
    }

    let newNode: PMNode | null = null;
    try {
      newNode = tr.doc.nodeAt(mappedPos);
    } catch {
      return;
    }
    if (!newNode || newNode.type !== oldNode.type || !newNode.isTextblock) return;

    const ot = oldNode.textContent;
    const nt = newNode.textContent;
    if (nt.length !== ot.length - 1) return;
    let diff = -1;
    for (let i = 0; i < ot.length; i++) {
      if (i >= nt.length || ot[i] !== nt[i]) {
        diff = i;
        break;
      }
    }
    if (diff < 2) return;
    if (ot[diff - 2] === '.' && ot[diff - 1] === ' ' && /[A-Z]/.test(ot[diff]!)) {
      const abs = textOffsetToAbsInBlock(mappedPos, newNode, diff);
      if (abs != null) next.add(abs);
    }
  });
  return next;
}

function createSentenceCapPlugin() {
  return new Plugin<{ suppressed: Set<number> }>({
    key: screenplaySentenceCapKey,
    state: {
      init() {
        return { suppressed: new Set<number>() };
      },
      apply(tr, value, oldState, newState) {
        let suppressed = remapSuppressed(value.suppressed, tr);
        if (tr.docChanged) {
          suppressed = addSuppressionsWhenUserLowercased(oldState, newState, tr, suppressed);
          suppressed = addSuppressionsWhenCapitalRemovedAfterPeriod(oldState, tr, suppressed);
        }
        return { suppressed };
      },
    },
  });
}

/**
 * Tracks sentence-boundary positions where the user chose lowercase after a period
 * (e.g. replaced auto-capitalized text). Must be included in the editor extensions.
 */
export const ScreenplaySentenceCapState = Extension.create({
  name: 'screenplaySentenceCapState',
  addProseMirrorPlugins() {
    return [createSentenceCapPlugin()];
  },
});

function trySentenceAfterPeriod(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (from !== to) return false;
  if (from < 2) return false;
  const { state } = view;
  const $from = state.doc.resolve(from);
  const parent = $from.parent;
  if (!SCREENPLAY_CAP_BLOCKS.has(parent.type.name)) return false;
  const depth = $from.depth;
  const blockStart = $from.start(depth);
  if (from - 2 < blockStart) return false;
  const before = state.doc.textBetween(from - 2, from);
  if (before !== '. ') return false;

  const suppressed = screenplaySentenceCapKey.getState(state)?.suppressed;
  if (suppressed?.has(from)) return false;

  const ch0 = text[0];
  if (!ch0 || !/[a-z]/.test(ch0)) return false;

  const inserted = ch0.toUpperCase() + text.slice(1);
  const tr = state.tr.insertText(inserted, from, to);
  view.dispatch(tr);
  return true;
}

function tryBlockStart(view: EditorView, from: number, to: number, text: string): boolean {
  const { state } = view;
  const $from = state.doc.resolve(from);
  const parent = $from.parent;
  if (!SCREENPLAY_CAP_BLOCKS.has(parent.type.name)) return false;

  const depth = $from.depth;
  const blockStart = $from.start(depth);
  if (from !== blockStart || to !== blockStart) return false;

  const ch = text[0]!;
  if (!/[a-z]/.test(ch)) return false;

  const inserted = ch.toUpperCase() + text.slice(1);
  const tr = state.tr.insertText(inserted, from, to);
  view.dispatch(tr);
  return true;
}

/**
 * Capitalize the first typed character at the start of an action/dialogue block,
 * and the first character after ". " when the user types at that gap (unless they
 * previously forced lowercase at that sentence boundary).
 */
export function handleScreenplayAutoCapitalize(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (!text) return false;
  if (trySentenceAfterPeriod(view, from, to, text)) return true;
  if (tryBlockStart(view, from, to, text)) return true;
  return false;
}
