import React, { useState, useCallback } from 'react';
import { X, FolderOutput } from 'lucide-react';
import { IPC_CHANNELS } from '@common/ipc';
import type { IpcResponse } from '@common/ipc';
import type { Project } from '@common/models';
import { useAppStore, defaultBrushes } from '../store/appStore';
import { rasterizePanelLayersToPngBase64 } from '../lib/panelPngExport';
import {
  buildStoryboardExportPlan,
  type StoryboardExportPreset,
} from '../lib/storyboardExportPaths';
import { buildMergedScriptPlainText, buildScriptHtmlDocument } from '../lib/scriptExportGather';
import { buildStoryboardTimeline } from '../lib/timelineLayout';
import { collectAnimaticExportAudioClips } from '../lib/animaticAudioExport';
import { buildAnimaticSegmentsForProject } from '../lib/animaticSegments';
import { hasAnyStoryboardTimelineClips } from '../lib/timelineStoryboardComposition';
import { nativeAlert } from '../lib/focusAfterNativeDialog';

type Props = {
  open: boolean;
  onClose: () => void;
  project: Project | null;
};

function makeBrushResolver() {
  const prefs = useAppStore.getState().preferences;
  return (presetId?: string) => {
    if (!presetId) return defaultBrushes['solid'];
    const custom = prefs.customBrushes?.find((b) => b.id === presetId);
    if (custom) return custom;
    return defaultBrushes[presetId] || defaultBrushes['solid'];
  };
}

export const ExportHub: React.FC<Props> = ({ open, onClose, project }) => {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sbPreset, setSbPreset] = useState<StoryboardExportPreset>('mergedPerPanel');

  const runStoryboardExport = useCallback(async () => {
    if (!project) {
      await nativeAlert('No project loaded.');
      return;
    }
    if (!window.ipcRenderer) {
      await nativeAlert('File export is not available in this environment. Use the installed ScriptBoard application.');
      return;
    }
    const plan = buildStoryboardExportPlan(project, sbPreset);
    const files = plan.filter((e): e is Extract<typeof e, { kind: 'file' }> => e.kind === 'file');
    if (files.length === 0) {
      await nativeAlert('Nothing to export. Add scenes and panels, or pick a different preset.');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const pick: IpcResponse<{ folderPath: string }> = await window.ipcRenderer.invoke(
        IPC_CHANNELS.EXPORT_SELECT_FOLDER,
      );
      if (!pick.success || !pick.data?.folderPath) {
        if (pick.message !== 'Export canceled') setStatus(pick.message || 'Canceled');
        return;
      }
      const folderPath = pick.data.folderPath;
      const w = project.settings.resolution?.width ?? 1920;
      const h = project.settings.resolution?.height ?? 1080;
      const getBrushConfig = makeBrushResolver();
      let i = 0;
      for (const f of files) {
        i += 1;
        setStatus(`Writing ${i} / ${files.length}: ${f.relativePath}`);
        const b64 = await rasterizePanelLayersToPngBase64(f.layers, w, h, getBrushConfig);
        const wr: IpcResponse = await window.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_WRITE_BASE64_FILE, {
          folderPath,
          relativePath: f.relativePath,
          base64: b64,
        });
        if (!wr.success) {
          await nativeAlert(`Failed on ${f.relativePath}: ${wr.message || 'Unknown error'}`);
          return;
        }
      }
      setStatus(`Done. ${files.length} file(s) in:\n${folderPath}`);
    } catch (e) {
      await nativeAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [project, sbPreset]);

  const exportScriptHtml = useCallback(async () => {
    if (!project || !window.ipcRenderer) return;
    const html = buildScriptHtmlDocument(project);
    const res: IpcResponse = await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_EXPORT, {
      html,
      projectName: project.name || 'Script',
    });
    if (res.success) await nativeAlert('HTML export finished.');
    else if (res.message !== 'Export canceled') await nativeAlert(res.message || 'Export failed');
  }, [project]);

  const exportScriptPlain = useCallback(async () => {
    if (!project || !window.ipcRenderer) return;
    const text = buildMergedScriptPlainText(project);
    const safe = (project.name || 'Script').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120);
    const res: IpcResponse = await window.ipcRenderer.invoke(IPC_CHANNELS.SCRIPT_EXPORT, {
      content: text || '\n',
      fileName: `${safe}-script`,
    });
    if (res.success) await nativeAlert('Plain text export finished.');
    else if (res.message !== 'Export canceled') await nativeAlert(res.message || 'Export failed');
  }, [project]);

  const exportAnimatic = useCallback(
    async (format: 'mp4' | 'mov') => {
      if (!project) {
        await nativeAlert('No project loaded.');
        return;
      }
      if (!window.ipcRenderer) {
        await nativeAlert('Video export is not available in this environment. Use the installed ScriptBoard application.');
        return;
      }
      if (!hasAnyStoryboardTimelineClips(project)) {
        await nativeAlert('Place at least one panel on a storyboard timeline layer before exporting video.');
        return;
      }
      const { flatPanels } = buildStoryboardTimeline(project);
      const w = project.settings.resolution?.width ?? 1920;
      const h = project.settings.resolution?.height ?? 1080;
      const fps = project.settings.framerate ?? 24;
      const safeName = (project.name || 'ScriptBoard').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120);
      const getBrushConfig = makeBrushResolver();
      const segments = await buildAnimaticSegmentsForProject(project, flatPanels, getBrushConfig);
      const audioClips = collectAnimaticExportAudioClips(project);
      const res: IpcResponse<{ filePath: string }> = await window.ipcRenderer.invoke(
        IPC_CHANNELS.ANIMATIC_EXPORT_VIDEO,
        {
          format,
          fps,
          width: w,
          height: h,
          segments,
          audioClips,
          defaultFileName: `${safeName}-animatic.${format}`,
        },
      );
      if (res.success && res.data?.filePath) await nativeAlert(`Video saved:\n${res.data.filePath}`);
      else if (res.message && res.message !== 'Export canceled') await nativeAlert(res.message);
    },
    [project],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Export hub"
      onClick={onClose}
    >
      <div
        className="bg-[#1e1e1e] border border-neutral-700 rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
          <h2 className="text-sm font-semibold text-neutral-100">Export</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-700 text-neutral-400"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-6 text-xs text-neutral-300">
          <section>
            <div className="text-neutral-200 font-medium mb-2">Storyboard (PNG)</div>
            <p className="mb-3 text-[11px] leading-relaxed text-neutral-500">
              Two presets use the usual batch-import naming pattern: merged panels end with{' '}
              <span className="font-mono text-neutral-400">LMerged.png</span>; separate layers use{' '}
              <span className="font-mono text-neutral-400">-L{'{layer}'}.png</span> with the same{' '}
              <span className="font-mono text-neutral-400">Project-A#-S#-P#</span> prefix.
            </p>
            <div className="space-y-2 mb-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="sb-preset"
                  checked={sbPreset === 'mergedPerPanel'}
                  onChange={() => setSbPreset('mergedPerPanel')}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-neutral-200">Batch import · merged panel</span>
                  <span className="block text-neutral-500">
                    One flattened PNG per panel: <span className="font-mono text-neutral-400">…-LMerged.png</span>.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="sb-preset"
                  checked={sbPreset === 'pngPerLayer'}
                  onChange={() => setSbPreset('pngPerLayer')}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-neutral-200">Batch import · one PNG per layer</span>
                  <span className="block text-neutral-500">
                    Each visible layer: <span className="font-mono text-neutral-400">…-LLayerName.png</span> (multi-layer
                    import).
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="sb-preset"
                  checked={sbPreset === 'foldersByScene'}
                  onChange={() => setSbPreset('foldersByScene')}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-neutral-200">Folders by scene</span>
                  <span className="block text-neutral-500">SceneName/Panel_01.png (good for dailies or review).</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="sb-preset"
                  checked={sbPreset === 'imageSequenceNle'}
                  onChange={() => setSbPreset('imageSequenceNle')}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-neutral-200">Image sequence (editors)</span>
                  <span className="block text-neutral-500">
                    Project_0001.png in timeline order (Premiere, Resolve, After Effects).
                  </span>
                </span>
              </label>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runStoryboardExport()}
              className="flex items-center gap-2 px-3 py-2 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white w-full justify-center"
            >
              <FolderOutput size={16} />
              Export storyboard PNGs to folder…
            </button>
          </section>

          <section>
            <div className="text-neutral-200 font-medium mb-2">Script</div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void exportScriptHtml()}
                className="px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-left"
              >
                Export script as HTML…
              </button>
              <button
                type="button"
                onClick={() => void exportScriptPlain()}
                className="px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-left"
              >
                Export merged plain text…
              </button>
            </div>
          </section>

          <section>
            <div className="text-neutral-200 font-medium mb-2">Animatic video</div>
            <p className="text-neutral-500 mb-2 leading-relaxed">
              Long timelines can take a while to render.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !project || !hasAnyStoryboardTimelineClips(project)}
                onClick={() => void exportAnimatic('mp4')}
                className="flex-1 px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600 disabled:pointer-events-none disabled:opacity-40"
              >
                MP4…
              </button>
              <button
                type="button"
                disabled={busy || !project || !hasAnyStoryboardTimelineClips(project)}
                onClick={() => void exportAnimatic('mov')}
                className="flex-1 px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600 disabled:pointer-events-none disabled:opacity-40"
              >
                MOV…
              </button>
            </div>
          </section>

          {status && (
            <pre className="text-[10px] text-neutral-400 whitespace-pre-wrap bg-black/30 rounded p-2 border border-neutral-800">
              {status}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
