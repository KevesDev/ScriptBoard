import { app, BrowserWindow, ipcMain, dialog, Menu, clipboard } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs/promises'
import { IPC_CHANNELS } from '../common/ipc'
import type { AnimaticExportAudioClipPayload } from '../common/models'
import { stripImageDataUrlToRawBase64 } from '../common/imagePayload'
import { ProjectArchiver } from './projectArchiver'
import { exportAnimaticVideo, type AnimaticExportSegment } from './animaticVideoExport'
import ffmpegStatic from 'ffmpeg-static'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** FFmpeg must run from disk; packaged apps unpack `ffmpeg-static` under app.asar.unpacked. */
function ffmpegExecutablePath(): string | null {
  if (!ffmpegStatic) return null
  return ffmpegStatic.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
}

// Robust global error handling for the main process
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // In a full production app, you might want to log this to a file
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Packaged layout (electron-builder + asar): app.getAppPath() → .../app.asar
// with dist/index.html and dist-electron/main.js inside it. Resolving the UI via
// getAppPath() keeps file:// loads correct on any drive and for portable builds.

let win: BrowserWindow | null = null
const preload = join(__dirname, 'preload.cjs')

function createWindow() {
  const appPath = app.getAppPath()

  win = new BrowserWindow({
    title: 'ScriptBoard',
    width: 1280,
    height: 720,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    process.env.VITE_PUBLIC = join(appPath, 'public')
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    // win.webContents.openDevTools()
  } else {
    const distDir = join(appPath, 'dist')
    process.env.DIST = distDir
    process.env.VITE_PUBLIC = distDir
    win.loadFile(join(distDir, 'index.html'))
  }

  // Electron does not show a default text context menu; without this, Cut/Copy/Paste never appear
  // for contenteditable (e.g. TipTap script editor).
  win.webContents.on('context-menu', (_event, params) => {
    const w = win
    if (!w) return

    const template: Electron.MenuItemConstructorOptions[] = []

    if (params.linkURL) {
      template.push({
        label: 'Copy link',
        click: () => clipboard.writeText(params.linkURL),
      })
      template.push({ type: 'separator' })
    }

    const ef = params.editFlags
    // Prefer isEditable; some Chromium builds under-report it for contenteditable (TipTap) while
    // cut/paste flags still reflect the real editing surface.
    const showTextEditingMenu = params.isEditable || ef.canCut || ef.canPaste

    if (showTextEditingMenu) {
      template.push(
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      )
    } else if (params.selectionText && params.selectionText.length > 0) {
      template.push({ role: 'copy' })
    }

    while (template.length > 0 && template[template.length - 1]?.type === 'separator') {
      template.pop()
    }
    if (template.length === 0) return

    Menu.buildFromTemplate(template).popup({ window: w })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  createWindow()
})

// To handle direct saves without asking for a file path every time, 
// we need to keep track of the current active project's file path on the backend.
// Since the frontend might not securely know its own file path in a standard way,
// we'll store a map of project ID to file path here.
const projectPaths = new Map<string, string>();

// IPC channels implementation
ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE, async (_event, project) => {
  if (!win) return { success: false, message: 'No window found' }
  try {
    let filePath = projectPaths.get(project.id);

    if (!filePath) {
      const result = await dialog.showSaveDialog(win, {
        title: 'Save ScriptBoard Project',
        defaultPath: project.name ? `${project.name}.sbproj` : 'Untitled.sbproj',
        filters: [{ name: 'ScriptBoard Project', extensions: ['sbproj'] }]
      });

      if (result.canceled || !result.filePath) {
        return { success: false, message: 'Save canceled' }
      }
      filePath = result.filePath;
      projectPaths.set(project.id, filePath);
    }

    await ProjectArchiver.saveProject(project, filePath)
    return { success: true, message: 'Saved successfully', data: { filePath } }
  } catch (error) {
    console.error('Save error:', error)
    return { success: false, message: (error as Error).message }
  }
})

ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE_AS, async (_event, project) => {
  if (!win) return { success: false, message: 'No window found' }
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save ScriptBoard Project As',
      defaultPath: project.name ? `${project.name}.sbproj` : 'Untitled.sbproj',
      filters: [{ name: 'ScriptBoard Project', extensions: ['sbproj'] }]
    })

    if (canceled || !filePath) {
      return { success: false, message: 'Save canceled' }
    }

    projectPaths.set(project.id, filePath);
    await ProjectArchiver.saveProject(project, filePath)
    return { success: true, message: 'Saved successfully', data: { filePath } }
  } catch (error) {
    console.error('Save As error:', error)
    return { success: false, message: (error as Error).message }
  }
})

ipcMain.handle(IPC_CHANNELS.PROJECT_LOAD, async (_event) => {
  if (!win) return { success: false, message: 'No window found' }
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open ScriptBoard Project',
      properties: ['openFile'],
      filters: [{ name: 'ScriptBoard Project', extensions: ['sbproj'] }]
    })

    if (canceled || filePaths.length === 0) {
      return { success: false, message: 'Load canceled' }
    }

    const project = await ProjectArchiver.loadProject(filePaths[0])
    
    // Remember where we loaded it from so we can save back to it
    if (project && project.id) {
      projectPaths.set(project.id, filePaths[0]);
    }
    
    return { success: true, message: 'Loaded successfully', data: { project, filePath: filePaths[0] } }
  } catch (error) {
    console.error('Load error:', error)
    return { success: false, message: (error as Error).message }
  }
})

ipcMain.handle(IPC_CHANNELS.PROJECT_QUERY_SAVE_PATH, async (_event, projectId: string) => {
  if (!projectId) {
    return { success: true, data: { hasPath: false as const, path: undefined as string | undefined } }
  }
  const filePath = projectPaths.get(projectId)
  return {
    success: true,
    data: { hasPath: !!filePath, path: filePath },
  }
})

ipcMain.handle(IPC_CHANNELS.PROJECT_AUTOSAVE, async (_event, project) => {
  try {
    const id = project?.id as string | undefined
    if (!id) {
      return { success: false, code: 'NO_SAVE_PATH', message: 'No project id.' }
    }
    const mainPath = projectPaths.get(id)
    if (!mainPath) {
      return {
        success: false,
        code: 'NO_SAVE_PATH',
        message: 'Project has not been saved to a file yet. Use File → Save or Save As once.',
      }
    }
    const backupPath = await ProjectArchiver.autoSaveProject(project, mainPath)
    return { success: true, message: 'Backup written', data: { backupPath, mainPath } }
  } catch (error) {
    console.error('Autosave error:', error)
    return { success: false, message: (error as Error).message }
  }
})

ipcMain.handle(IPC_CHANNELS.PROJECT_EXPORT, async (_event, data: { html: string, projectName: string }) => {
  if (!win) return { success: false, message: 'No window found' }
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Script as HTML',
      defaultPath: data.projectName ? `${data.projectName}-script.html` : 'Script.html',
      filters: [{ name: 'HTML Document', extensions: ['html'] }]
    })

    if (canceled || !filePath) {
      return { success: false, message: 'Export canceled' }
    }

    await fs.writeFile(filePath, data.html, 'utf8')
    return { success: true, message: 'Exported successfully', data: { filePath } }
  } catch (error) {
    console.error('Export error:', error)
    return { success: false, message: (error as Error).message }
  }
})

ipcMain.handle(IPC_CHANNELS.SCRIPT_IMPORT, async (_event) => {
  if (!win) return { success: false, message: 'No window found' }
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import Script',
      properties: ['openFile'],
      filters: [
        { name: 'Text/Fountain Files', extensions: ['txt', 'fountain'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (canceled || filePaths.length === 0) {
      return { success: false, message: 'Import canceled' }
    }

    const content = await fs.readFile(filePaths[0], 'utf8')
    const fileName = filePaths[0].split('\\').pop()?.split('/').pop()?.split('.')[0] || 'Imported Script'
    
    return { success: true, message: 'Script imported', data: { content, fileName } }
  } catch (error) {
    console.error('Import error:', error)
    return { success: false, message: (error as Error).message }
  }
})

ipcMain.handle(IPC_CHANNELS.SCRIPT_EXPORT, async (_event, data: { content: string, fileName: string }) => {
  if (!win) return { success: false, message: 'No window found' }
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Script',
      defaultPath: `${data.fileName}.txt`,
      filters: [{ name: 'Text Document', extensions: ['txt', 'fountain'] }]
    })

    if (canceled || !filePath) {
      return { success: false, message: 'Export canceled' }
    }

    await fs.writeFile(filePath, data.content, 'utf8')
    return { success: true, message: 'Exported successfully', data: { filePath } }
  } catch (error) {
    console.error('Export error:', error)
    return { success: false, message: (error as Error).message }
  }
})

ipcMain.handle(IPC_CHANNELS.EXPORT_SELECT_FOLDER, async () => {
  if (!win) return { success: false, message: 'No window found' }
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select export folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (canceled || !filePaths[0]) {
      return { success: false, message: 'Export canceled' }
    }
    return { success: true, data: { folderPath: filePaths[0] } }
  } catch (error) {
    console.error('Export folder dialog error:', error)
    return { success: false, message: (error as Error).message }
  }
})

ipcMain.handle(
  IPC_CHANNELS.EXPORT_WRITE_BASE64_FILE,
  async (_event, payload: { folderPath: string; relativePath: string; base64: string }) => {
    try {
      const parts = payload.relativePath.split('/').filter(Boolean)
      const fullPath = join(payload.folderPath, ...parts)
      await fs.mkdir(dirname(fullPath), { recursive: true })
      const raw = stripImageDataUrlToRawBase64(payload.base64)
      await fs.writeFile(fullPath, Buffer.from(raw, 'base64'))
      return { success: true }
    } catch (error) {
      console.error('Export write error:', error)
      return { success: false, message: (error as Error).message }
    }
  },
)

ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
  if (win) win.minimize();
});

ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
  if (win) win.close();
});

ipcMain.on(IPC_CHANNELS.WINDOW_RESTORE_INPUT, (event) => {
  const w = BrowserWindow.fromWebContents(event.sender) ?? win
  if (!w || w.isDestroyed()) return
  if (process.platform === 'darwin') {
    app.focus({ steal: true })
  }
  w.focus()
  if (!w.webContents.isDestroyed()) {
    w.webContents.focus()
  }
})

type DialogBoxPayload = { kind: 'alert'; message: string } | { kind: 'confirm'; message: string }

ipcMain.handle(IPC_CHANNELS.DIALOG_BOX, async (event, payload: DialogBoxPayload) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? win
  if (!parent || parent.isDestroyed()) {
    return payload.kind === 'confirm' ? { ok: false } : { ok: true }
  }
  const title = 'ScriptBoard'
  if (payload.kind === 'alert') {
    await dialog.showMessageBox(parent, {
      type: 'info',
      title,
      message: payload.message,
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    })
    return { ok: true }
  }
  const r = await dialog.showMessageBox(parent, {
    type: 'question',
    title,
    message: payload.message,
    buttons: ['OK', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  return { ok: r.response === 0 }
})

ipcMain.handle(IPC_CHANNELS.AUDIO_IMPORT, async (_event) => {
  if (!win) return { success: false, message: 'No window found' };
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import Audio',
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg'] }
      ]
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, message: 'Import canceled' };
    }

    const buffer = await fs.readFile(filePaths[0]);
    const base64 = buffer.toString('base64');
    const fileName = filePaths[0].split('\\').pop()?.split('/').pop() || 'Imported Audio';
    // Determine mime type
    let mimeType = 'audio/mpeg';
    if (fileName.toLowerCase().endsWith('.wav')) mimeType = 'audio/wav';
    else if (fileName.toLowerCase().endsWith('.ogg')) mimeType = 'audio/ogg';

    const dataUri = `data:${mimeType};base64,${base64}`;

    return { success: true, message: 'Audio imported', data: { dataUri, fileName } };
  } catch (error) {
    console.error('Audio import error:', error);
    return { success: false, message: (error as Error).message };
  }
});

ipcMain.handle(
  IPC_CHANNELS.ANIMATIC_EXPORT_VIDEO,
  async (
    _event,
    payload: {
      format: 'mp4' | 'mov'
      fps: number
      width: number
      height: number
      segments: AnimaticExportSegment[]
      audioClips?: AnimaticExportAudioClipPayload[]
      defaultFileName?: string
    },
  ) => {
    if (!win) return { success: false, message: 'No window found' }
    try {
      const ext = payload.format === 'mov' ? 'mov' : 'mp4'
      const suggested = payload.defaultFileName?.replace(/[<>:"/\\|?*]+/g, '_') || `Animatic.${ext}`
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Export animatic video',
        defaultPath: suggested.endsWith(`.${ext}`) ? suggested : `${suggested}.${ext}`,
        filters: [
          { name: 'MP4 (H.264)', extensions: ['mp4'] },
          { name: 'QuickTime (H.264)', extensions: ['mov'] },
        ],
      })

      if (canceled || !filePath) {
        return { success: false, message: 'Export canceled' }
      }

      const ffmpegPath = ffmpegExecutablePath()
      if (!ffmpegPath) {
        return { success: false, message: 'FFmpeg binary is missing from this build.' }
      }

      const outFmt = filePath.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4'

      await exportAnimaticVideo({
        ffmpegPath,
        outputPath: filePath,
        format: outFmt,
        fps: payload.fps,
        width: payload.width,
        height: payload.height,
        segments: payload.segments,
        audioClips: payload.audioClips,
      })

      return { success: true, message: 'Exported', data: { filePath } }
    } catch (error) {
      console.error('Animatic export error:', error)
      return { success: false, message: (error as Error).message }
    }
  },
)

ipcMain.handle(IPC_CHANNELS.VIDEO_IMPORT, async (_event) => {
  if (!win) return { success: false, message: 'No window found' };
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import Video',
      properties: ['openFile'],
      filters: [
        {
          name: 'Video',
          extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv'],
        },
      ],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, message: 'Import canceled' };
    }

    const buffer = await fs.readFile(filePaths[0]);
    const base64 = buffer.toString('base64');
    const fileName = filePaths[0].split('\\').pop()?.split('/').pop() || 'Imported Video';
    const lower = fileName.toLowerCase();
    let mimeType = 'video/mp4';
    if (lower.endsWith('.webm')) mimeType = 'video/webm';
    else if (lower.endsWith('.mov')) mimeType = 'video/quicktime';
    else if (lower.endsWith('.m4v')) mimeType = 'video/x-m4v';
    else if (lower.endsWith('.mkv')) mimeType = 'video/x-matroska';

    const dataUri = `data:${mimeType};base64,${base64}`;

    return { success: true, message: 'Video imported', data: { dataUri, fileName } };
  } catch (error) {
    console.error('Video import error:', error);
    return { success: false, message: (error as Error).message };
  }
});
