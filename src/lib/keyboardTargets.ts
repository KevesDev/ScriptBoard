/**
 * True when the user is typing in a field where global shortcuts (e.g. Space for timeline)
 * must not run and must not call preventDefault.
 */
export function isKeyboardEventTargetTextEntry(target: EventTarget | null): boolean {
  // Key events can target a Text node inside contenteditable / ProseMirror; those are not `Element`
  // and would incorrectly fall through to global storyboard shortcuts (Delete → preventDefault).
  if (target instanceof Text || target instanceof CDATASection) {
    const root = target.parentElement;
    if (root?.closest?.('.ProseMirror')) return true;
    if (root?.closest?.('.screenplay-editor')) return true;
    if (root?.isContentEditable) return true;
    return false;
  }

  if (!(target instanceof Element)) return false;
  const el = target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [contenteditable="plaintext-only"]',
  );
  if (el) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.closest('.ProseMirror')) return true;
  const role = target.closest('[role="textbox"]');
  if (role && role instanceof HTMLElement && role.isContentEditable) return true;
  return false;
}

/**
 * Used only for **window-level** storyboard shortcuts that must stay global (Ctrl/Cmd/Alt chords
 * such as undo/redo/zoom). Stroke editing keys (Delete, Backspace, copy/cut/paste) are **not**
 * registered on `window`; they fire only on the storyboard keyboard root so script/ProseMirror
 * never shares that listener chain.
 */
export function shouldSuppressStoryboardCanvasGlobalKeys(e: KeyboardEvent): boolean {
  if (isKeyboardEventTargetTextEntry(e.target)) return true;

  const ae = document.activeElement;
  if (ae && isKeyboardEventTargetTextEntry(ae)) return true;

  if (ae instanceof Element) {
    if (ae.closest('.ProseMirror')) return true;
    if (ae.closest('.screenplay-editor')) return true;
  }

  if (e.target instanceof Element) {
    if (e.target.closest('.ProseMirror')) return true;
    if (e.target.closest('.screenplay-editor')) return true;
  }

  const sel = typeof getSelection === 'function' ? getSelection() : null;
  if (sel?.anchorNode) {
    const n = sel.anchorNode;
    const el =
      n.nodeType === Node.TEXT_NODE ? (n.parentElement as Element | null) : (n as Element);
    if (el?.closest?.('.ProseMirror')) return true;
    if (el?.closest?.('.screenplay-editor')) return true;
  }

  return false;
}
