export const IPC_CHANNELS = {
  PROJECT_SAVE: 'project:save',
  PROJECT_SAVE_AS: 'project:saveAs',
  PROJECT_LOAD: 'project:load',
  PROJECT_AUTOSAVE: 'project:autoSave',
  /** Returns whether the project id has a registered on-disk .sbproj path (save/load). */
  PROJECT_QUERY_SAVE_PATH: 'project:querySavePath',
  PROJECT_EXPORT: 'project:export', // HTML export
  SCRIPT_IMPORT: 'script:import', // Import raw text
  SCRIPT_EXPORT: 'script:export', // Export raw text
  AUDIO_IMPORT: 'audio:import', // Import audio file as base64
  VIDEO_IMPORT: 'video:import', // Import video file as base64 data URI
  /** Panel stills + timeline durations -> MP4/MOV via FFmpeg (main process). */
  ANIMATIC_EXPORT_VIDEO: 'animatic:exportVideo',
  /** Backend sends progress updates (0.0 to 1.0) during video export. */
  ANIMATIC_EXPORT_PROGRESS: 'animatic:exportProgress',
  /** Pick a directory for batch exports (storyboard PNGs). */
  EXPORT_SELECT_FOLDER: 'export:selectFolder',
  /** Write one binary file (base64, no data: prefix) under folderPath + relativePath. */
  EXPORT_WRITE_BASE64_FILE: 'export:writeBase64File',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  /** After sync `alert`/`confirm`, refocus window + webContents so the renderer receives keyboard again (Windows/Electron). */
  WINDOW_RESTORE_INPUT: 'window:restoreInput',
  /** Use `dialog.showMessageBox` in main - avoids renderer `window.confirm` breaking keyboard focus (Windows). */
  DIALOG_BOX: 'dialog:box',
} as const;

export type IpcResponse<T = any> = {
  success: boolean;
  message?: string;
  /** Machine-readable reason (e.g. NO_SAVE_PATH for autosave). */
  code?: string;
  data?: T;
};