/**
 * Renderer `window.alert` / `window.confirm` block the JS thread and, in Electron on Windows,
 * often leave the webContents not accepting keyboard until the window is deactivated.
 *
 * When `ipcRenderer` exists we use `dialog.showMessageBox` in the main process instead.
 */

import { IPC_CHANNELS } from '@common/ipc';

type DialogBoxPayload = { kind: 'alert'; message: string } | { kind: 'confirm'; message: string };

/** TipTap can persist `editable: false` in options after a modal; ScriptEditor listens to re-enable. */
export const AFTER_NATIVE_DIALOG_EVENT = 'scriptboard-after-native-dialog';

function notifyAfterNativeDialog(): void {
  window.dispatchEvent(new CustomEvent(AFTER_NATIVE_DIALOG_EVENT));
}

/** Extra nudge for any remaining focus edge cases (e.g. browser fallback). */
export function restoreElectronWindowKeyboardFocus(): void {
  try {
    window.ipcRenderer?.send(IPC_CHANNELS.WINDOW_RESTORE_INPUT);
    window.setTimeout(() => {
      window.ipcRenderer?.send(IPC_CHANNELS.WINDOW_RESTORE_INPUT);
    }, 0);
  } catch {
    /* browser / tests */
  }
}

export function scheduleReturnFocusToProseMirror(): void {
  const tryFocus = () => {
    const el = document.querySelector('.screenplay-editor .ProseMirror') as HTMLElement | null;
    if (!el || !document.body.contains(el)) return;
    el.focus({ preventScroll: true });
  };

  queueMicrotask(tryFocus);
  requestAnimationFrame(() => {
    requestAnimationFrame(tryFocus);
  });
  window.setTimeout(tryFocus, 0);
}

function afterAnyDialog(): void {
  restoreElectronWindowKeyboardFocus();
  scheduleReturnFocusToProseMirror();
  notifyAfterNativeDialog();
}

export async function nativeAlert(message: string): Promise<void> {
  if (window.ipcRenderer) {
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.DIALOG_BOX, { kind: 'alert', message } as DialogBoxPayload);
    } catch {
      window.alert(message);
    }
  } else {
    window.alert(message);
  }
  afterAnyDialog();
}

export async function nativeConfirm(message: string): Promise<boolean> {
  let ok = false;
  if (window.ipcRenderer) {
    try {
      const res = (await window.ipcRenderer.invoke(IPC_CHANNELS.DIALOG_BOX, {
        kind: 'confirm',
        message,
      } as DialogBoxPayload)) as { ok?: boolean };
      ok = Boolean(res?.ok);
    } catch {
      ok = window.confirm(message);
    }
  } else {
    ok = window.confirm(message);
  }
  afterAnyDialog();
  return ok;
}
