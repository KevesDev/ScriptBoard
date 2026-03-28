export function isKeyboardEventTargetTextEntry(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;

  // Basic form inputs
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    // Allow shortcuts to trigger if focused on non-text inputs like checkboxes or sliders
    if (['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(type)) {
      return false;
    }
    return true;
  }

  // Rich text editors (TipTap / ProseMirror safety)
  if (el.isContentEditable) return true;
  if (el.closest('.ProseMirror') || el.closest('[contenteditable="true"]')) return true;

  return false;
}