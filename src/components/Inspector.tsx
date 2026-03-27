import { useProjectStore } from '../store/projectStore';
import { Link as LinkIcon, Trash2 } from 'lucide-react';
import type { PanelTransitionType } from '@common/models';
import { resolveProjectEntityLabel } from '../lib/projectEntityLabels';
import { nativeAlert } from '../lib/focusAfterNativeDialog';

export const Inspector = () => {
  const {
    project,
    activePanelId,
    activeLayerId,
    activeScriptPageId,
    timelinePlayheadSec,
    commitHistory,
    updatePanelDurationMs,
    updatePanelTimelineGapSec,
    setPanelTransitionOut,
    updateTimelineCameraKeyframe,
    updateTimelineLayerKeyframe,
  } = useProjectStore();

  if (!project) return <div className="p-4 text-neutral-500">No project loaded.</div>;

  const activePanel =
    activePanelId &&
    project.scenes.flatMap((s) => s.panels).find((p) => p.id === activePanelId);
  const animatic = project.timeline?.animaticEditingMode ?? false;

  const kfTol = 0.05;
  const camKfAtPlayhead = project.timeline?.cameraKeyframes.find(
    (k) => Math.abs(k.timeSec - timelinePlayheadSec) < kfTol,
  );
  const layerKfAtPlayhead =
    activePanelId && activeLayerId
      ? project.timeline?.layerKeyframes.find(
          (k) =>
            k.panelId === activePanelId &&
            k.layerId === activeLayerId &&
            Math.abs(k.timeSec - timelinePlayheadSec) < kfTol,
        )
      : undefined;

  const relevantLinks = project.links.filter(
    (link) =>
      link.sourceId === activePanelId ||
      link.targetId === activePanelId ||
      link.sourceId === activeScriptPageId ||
      link.targetId === activeScriptPageId,
  );

  const sceneForActivePanel = activePanelId
    ? project.scenes.find((s) => s.panels.some((p) => p.id === activePanelId))
    : undefined;

  return (
    <div className="flex flex-col h-full bg-neutral-900 text-neutral-200">
      {activePanel && (
        <div className="border-b border-neutral-800 p-4">
          <h3 className="mb-2 font-bold text-neutral-100">Panel timing</h3>
          <label className="mb-2 block text-xs text-neutral-400">
            Duration (ms)
            <input
              type="number"
              min={50}
              step={100}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
              value={parseFloat(activePanel.duration) || 2000}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 50) return;
                commitHistory();
                updatePanelDurationMs(activePanel.id, v);
              }}
            />
          </label>
          {animatic && (
            <label className="block text-xs text-neutral-400">
              Gap after panel (sec)
              <input
                type="number"
                min={0}
                step={0.1}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
                value={activePanel.timelineGapAfterSec ?? 0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v < 0) return;
                  commitHistory();
                  updatePanelTimelineGapSec(activePanel.id, v);
                }}
              />
            </label>
          )}
          {!animatic && (
            <p className="mt-1 text-[10px] text-neutral-500">
              Enable <span className="text-purple-300">Animatic</span> on the timeline to add gaps after this panel.
            </p>
          )}
          <div className="mt-3 border-t border-neutral-800 pt-2">
            <span className="text-xs text-neutral-400">Transition after panel</span>
            <div className="mt-1 flex flex-col gap-2">
              <select
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
                value={activePanel.transitionOut?.type ?? 'none'}
                onChange={(e) => {
                  const v = e.target.value as PanelTransitionType;
                  commitHistory();
                  if (v === 'none') {
                    setPanelTransitionOut(activePanel.id, undefined);
                  } else {
                    setPanelTransitionOut(activePanel.id, {
                      type: v,
                      durationSec: activePanel.transitionOut?.durationSec ?? 0.5,
                    });
                  }
                }}
              >
                <option value="none">None</option>
                <option value="dissolve">Dissolve</option>
                <option value="edgeWipe">Edge wipe</option>
                <option value="clockWipe">Clock wipe</option>
                <option value="slide">Slide</option>
              </select>
              {activePanel.transitionOut && activePanel.transitionOut.type !== 'none' && (
                <label className="text-xs text-neutral-400">
                  Duration (sec)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
                    value={activePanel.transitionOut.durationSec}
                    onChange={(e) => {
                      const x = Number(e.target.value);
                      if (!Number.isFinite(x) || x < 0) return;
                      commitHistory();
                      setPanelTransitionOut(activePanel.id, {
                        ...activePanel.transitionOut!,
                        durationSec: x,
                      });
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {(camKfAtPlayhead || layerKfAtPlayhead) && (
        <div className="border-b border-neutral-800 p-4">
          <h3 className="mb-1 font-bold text-neutral-100">Keyframes at playhead</h3>
          <p className="mb-3 text-[10px] text-neutral-500">
            Align the playhead with a key diamond (±0.05s). Camera and layer values interpolate between keys.
          </p>
          {camKfAtPlayhead && (
            <div className="mb-4 space-y-2 border-t border-neutral-800 pt-2">
              <span className="text-xs font-medium text-sky-400">Camera</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-neutral-400">
                  Pan X (px)
                  <input
                    type="number"
                    step={1}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs"
                    value={camKfAtPlayhead.panX}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      commitHistory();
                      updateTimelineCameraKeyframe(camKfAtPlayhead.id, { panX: v });
                    }}
                  />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Pan Y (px)
                  <input
                    type="number"
                    step={1}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs"
                    value={camKfAtPlayhead.panY}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      commitHistory();
                      updateTimelineCameraKeyframe(camKfAtPlayhead.id, { panY: v });
                    }}
                  />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Zoom
                  <input
                    type="number"
                    min={0.05}
                    step={0.05}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs"
                    value={camKfAtPlayhead.zoom}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 0.05) return;
                      commitHistory();
                      updateTimelineCameraKeyframe(camKfAtPlayhead.id, { zoom: v });
                    }}
                  />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Rotate (°)
                  <input
                    type="number"
                    step={1}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs"
                    value={camKfAtPlayhead.rotationDeg}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      commitHistory();
                      updateTimelineCameraKeyframe(camKfAtPlayhead.id, { rotationDeg: v });
                    }}
                  />
                </label>
              </div>
            </div>
          )}
          {layerKfAtPlayhead && (
            <div className="space-y-2 border-t border-neutral-800 pt-2">
              <span className="text-xs font-medium text-emerald-400">Active layer</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-neutral-400">
                  Offset X (px)
                  <input
                    type="number"
                    step={1}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs"
                    value={layerKfAtPlayhead.offsetX}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      commitHistory();
                      updateTimelineLayerKeyframe(layerKfAtPlayhead.id, { offsetX: v });
                    }}
                  />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Offset Y (px)
                  <input
                    type="number"
                    step={1}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs"
                    value={layerKfAtPlayhead.offsetY}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      commitHistory();
                      updateTimelineLayerKeyframe(layerKfAtPlayhead.id, { offsetY: v });
                    }}
                  />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Scale
                  <input
                    type="number"
                    min={0.05}
                    step={0.05}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs"
                    value={layerKfAtPlayhead.scale}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 0.05) return;
                      commitHistory();
                      updateTimelineLayerKeyframe(layerKfAtPlayhead.id, { scale: v });
                    }}
                  />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Opacity ×
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.05}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs"
                    value={layerKfAtPlayhead.opacityMul}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 0) return;
                      commitHistory();
                      updateTimelineLayerKeyframe(layerKfAtPlayhead.id, { opacityMul: v });
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="p-4 border-b border-neutral-800">
        <h3 className="font-bold mb-2 flex items-center gap-2">
          <LinkIcon size={18} />
          Connections
        </h3>
        <p className="text-sm text-neutral-400">
          Link a script document to a storyboard scene so the outliner can show dialogue and action for that scene. Script
          links in the editor use the scene heading text (or scene order) to match storyboard scenes.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {relevantLinks.length === 0 ? (
          <div className="text-sm text-neutral-500 italic text-center mt-4">
            No connections for the currently selected item.
          </div>
        ) : (
          relevantLinks.map((link) => (
            <div key={link.id} className="bg-neutral-800 border border-neutral-700 p-2 rounded flex items-center justify-between group">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-start gap-2 text-sm">
                  <LinkIcon size={14} className="mt-0.5 shrink-0 text-blue-400" />
                  <span className="min-w-0 leading-snug text-neutral-200">
                    <span className="text-neutral-100">{resolveProjectEntityLabel(project, link.sourceId)}</span>
                    <span className="mx-1.5 text-neutral-600">↔</span>
                    <span className="text-neutral-100">{resolveProjectEntityLabel(project, link.targetId)}</span>
                  </span>
                </div>
                <span className="pl-6 text-[10px] uppercase tracking-wide text-neutral-500">
                  {link.type.replace(/-/g, ' ')}
                </span>
              </div>
              <button 
                className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-red-400 rounded"
                title="Remove Link"
                // onClick={() => removeLink(link.id)} // Will implement this action in store next
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {activePanelId && activeScriptPageId && sceneForActivePanel && (
        <div className="p-4 border-t border-neutral-800">
          <button
            type="button"
            className="w-full rounded bg-blue-600 py-2 text-sm text-white shadow transition-colors hover:bg-blue-700"
            onClick={() => {
              void (async () => {
                const targetSceneId = sceneForActivePanel.id;
                const dup = project.links.some(
                  (l) =>
                    l.type === 'page-to-scene' &&
                    l.sourceId === activeScriptPageId &&
                    l.targetId === targetSceneId,
                );
                if (dup) {
                  await nativeAlert('This script page is already linked to that storyboard scene.');
                  return;
                }
                commitHistory();
                useProjectStore.getState().createLink({
                  id: crypto.randomUUID(),
                  sourceId: activeScriptPageId,
                  targetId: targetSceneId,
                  type: 'page-to-scene',
                });
              })();
            }}
          >
            Link active script page to “{sceneForActivePanel.name}”
          </button>
          <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">
            Uses the storyboard scene (all panels in it), not only the selected panel. Older links that targeted a single
            panel still work for finding script context.
          </p>
        </div>
      )}
    </div>
  );
};
