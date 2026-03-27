/** Native HTML5 drag payload: outliner panel → timeline overlay track. */
export const SCRIPTBOARD_PANEL_DND_MIME = 'application/x-scriptboard-panel-id';

export function setPanelIdOnDataTransfer(dt: DataTransfer, panelId: string) {
  dt.setData(SCRIPTBOARD_PANEL_DND_MIME, panelId);
  dt.setData('text/plain', `scriptboard-panel:${panelId}`);
}

export function getPanelIdFromDataTransfer(dt: DataTransfer): string | null {
  const raw = dt.getData(SCRIPTBOARD_PANEL_DND_MIME);
  if (raw) return raw;
  const plain = dt.getData('text/plain');
  if (plain.startsWith('scriptboard-panel:')) return plain.slice('scriptboard-panel:'.length);
  return null;
}

/**
 * Use during `dragenter` / `dragover` only. Browsers often return "" from getData() until `drop`
 * (privacy), so we must gate allow-drop on `types` instead.
 */
export function dataTransferLooksLikeScriptboardPanel(dt: DataTransfer): boolean {
  const types = Array.from(dt.types as unknown as string[]);
  if (types.includes(SCRIPTBOARD_PANEL_DND_MIME)) return true;
  // Chrome may list custom types; Electron/WebKit sometimes use Text vs text/plain
  return types.includes('text/plain') || types.includes('Text');
}
