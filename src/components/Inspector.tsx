import { useState, useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { Link as LinkIcon, ExternalLink, X } from 'lucide-react';
import type { PanelTransitionType } from '@common/models';
import { base64ToUtf8Text } from '../lib/scriptContentBase64';
import { getSceneScriptContext, trimBlocksForDisplay, type ScriptSceneBlock } from '../lib/scriptSceneExcerpt';

function blockStyle(b: ScriptSceneBlock): string {
  switch (b.type) {
    case 'character':
      return 'text-[11px] font-semibold uppercase tracking-wide text-amber-200/95';
    case 'dialogue':
      return 'text-xs leading-snug text-neutral-200 pl-2 border-l-2 border-neutral-600';
    case 'parenthetical':
      return 'text-[11px] italic text-neutral-500 pl-3';
    case 'transition':
      return 'text-[10px] uppercase tracking-wider text-violet-300/90';
    case 'action':
    default:
      return 'text-xs leading-snug text-neutral-400';
  }
}

export const Inspector = () => {
  const {
    project,
    activePanelId,
    activeLayerId,
    setActiveScriptPageId,
    timelinePlayheadSec,
    commitHistory,
    updatePanelDurationMs,
    updatePanelTimelineGapSec,
    setPanelTransitionOut,
    updateTimelineCameraKeyframe,
    updateTimelineLayerKeyframe,
    linkSceneToScript,
    updatePanelCaptions
  } = useProjectStore();

  const [selectedHeadingToLink, setSelectedHeadingToLink] = useState('');

  // --- Derived state must be null-safe if we move them above early returns ---
  const activePanel = project?.scenes.flatMap((s) => s.panels).find((p) => p.id === activePanelId);
  const activeScene = activeSceneId 
    ? project?.scenes.find(s => s.id === activeSceneId) 
    : project?.scenes.find((s) => s.panels.some((p) => p.id === activePanelId));
  const animatic = project?.timeline?.animaticEditingMode ?? false;

  const kfTol = 0.05;
  const camKfAtPlayhead = project?.timeline?.cameraKeyframes.find(
    (k) => Math.abs(k.timeSec - timelinePlayheadSec) < kfTol,
  );
  
  const layerKfAtPlayhead =
    activePanelId && activeLayerId
      ? project?.timeline?.layerKeyframes.find(
          (k) =>
            k.panelId === activePanelId &&
            k.layerId === activeLayerId &&
            Math.abs(k.timeSec - timelinePlayheadSec) < kfTol,
        )
      : undefined;

  // --- Context Engine: ALL Hooks must be called unconditionally ---
  const allAvailableHeadings = useMemo(() => {
    if (!project) return [];
    const headings: string[] = [];
    const walk = (folder: any) => {
      for (const child of folder.children) {
        if (child.type === 'page') {
          try {
            const decoded = base64ToUtf8Text(child.contentBase64 || '');
            const parser = new DOMParser();
            const doc = parser.parseFromString(decoded, 'text/html');
            doc.querySelectorAll('.scene-heading').forEach(el => {
              if (el.textContent) headings.push(el.textContent.trim());
            });
          } catch {}
        } else if (child.type === 'folder') {
          walk(child);
        }
      }
    };
    walk(project.rootScriptFolder);
    return Array.from(new Set(headings)); 
  }, [project]);

  const panelScriptContext = useMemo(() => {
    if (!project || !activeScene || !activeScene.linkedScriptNodeId) return null;
    
    // If explicitly linked, search for that exact heading.
    const scIdx = project.scenes.findIndex(s => s.id === activeScene.id);
    
    return getSceneScriptContext(
      project,
      activeScene.linkedScriptNodeId,
      scIdx,
      activeScene.id,
      activeScene.panels.map((p) => p.id),
    );
  }, [project, activeScene]);

  const displayBlocks = useMemo(
    () => (panelScriptContext ? trimBlocksForDisplay(panelScriptContext.blocks, 28) : []),
    [panelScriptContext],
  );

  // --- EARLY RETURNS GO HERE, AFTER ALL HOOKS HAVE BEEN CALLED ---
  if (!project) return <div className="p-4 text-neutral-500">No project loaded.</div>;
  if (!activePanelId && !activeSceneId) return <div className="flex h-full items-center justify-center p-4 text-neutral-500 text-sm italic">Select a scene or panel to inspect.</div>;

  return (
    <div className="flex flex-col h-full bg-neutral-900 text-neutral-200 overflow-y-auto custom-scrollbar">
      
      {/* ==========================================
          TOP HALF: PANEL TIMING & KEYFRAMES (ONLY IF PANEL SELECTED)
      ========================================== */}
      {activePanelId && activePanel && (
        <div className="border-b border-neutral-800 p-4 shrink-0">
          <h3 className="mb-2 font-bold text-neutral-100">Panel timing</h3>
          <label className="mb-2 block text-xs text-neutral-400">
            Duration (ms)
            <input
              type="number"
              min={50}
              step={100}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
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
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
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
              Enable <span className="text-purple-300">Animatic</span> on the timeline to add gaps.
            </p>
          )}
          <div className="mt-3 border-t border-neutral-800 pt-2">
            <span className="text-xs text-neutral-400">Transition after panel</span>
            <div className="mt-1 flex flex-col gap-2">
              <select
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
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
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-blue-500"
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

      {/* ==========================================
          KEYFRAMES (ONLY IF PANEL SELECTED)
      ========================================== */}
      {activePanelId && (camKfAtPlayhead || layerKfAtPlayhead) && (
        <div className="border-b border-neutral-800 p-4 shrink-0">
          <h3 className="mb-1 font-bold text-neutral-100">Keyframes at playhead</h3>
          {camKfAtPlayhead && (
            <div className="mb-4 space-y-2 border-t border-neutral-800 pt-2">
              <span className="text-xs font-medium text-sky-400">Camera</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-neutral-400">
                  Pan X
                  <input type="number" step={1} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={camKfAtPlayhead.panX} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; commitHistory(); updateTimelineCameraKeyframe(camKfAtPlayhead.id, { panX: v }); }} />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Pan Y
                  <input type="number" step={1} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={camKfAtPlayhead.panY} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; commitHistory(); updateTimelineCameraKeyframe(camKfAtPlayhead.id, { panY: v }); }} />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Zoom
                  <input type="number" min={0.05} step={0.05} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={camKfAtPlayhead.zoom} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < 0.05) return; commitHistory(); updateTimelineCameraKeyframe(camKfAtPlayhead.id, { zoom: v }); }} />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Rotate (°)
                  <input type="number" step={1} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={camKfAtPlayhead.rotationDeg} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; commitHistory(); updateTimelineCameraKeyframe(camKfAtPlayhead.id, { rotationDeg: v }); }} />
                </label>
              </div>
            </div>
          )}
          {layerKfAtPlayhead && (
            <div className="space-y-2 border-t border-neutral-800 pt-2">
              <span className="text-xs font-medium text-emerald-400">Active layer</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-neutral-400">
                  Offset X
                  <input type="number" step={1} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={layerKfAtPlayhead.offsetX} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; commitHistory(); updateTimelineLayerKeyframe(layerKfAtPlayhead.id, { offsetX: v }); }} />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Offset Y
                  <input type="number" step={1} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={layerKfAtPlayhead.offsetY} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; commitHistory(); updateTimelineLayerKeyframe(layerKfAtPlayhead.id, { offsetY: v }); }} />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Scale
                  <input type="number" min={0.05} step={0.05} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={layerKfAtPlayhead.scale} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < 0.05) return; commitHistory(); updateTimelineLayerKeyframe(layerKfAtPlayhead.id, { scale: v }); }} />
                </label>
                <label className="text-[10px] text-neutral-400">
                  Opacity ×
                  <input type="number" min={0} max={10} step={0.05} className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={layerKfAtPlayhead.opacityMul} onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < 0) return; commitHistory(); updateTimelineLayerKeyframe(layerKfAtPlayhead.id, { opacityMul: v }); }} />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==========================================
          BOTTOM HALF: SCRIPT CONTEXT & CAPTIONS
      ========================================== */}
      {activeScene && (
        <div className="flex-1 flex flex-col p-4 bg-neutral-950 min-h-0">
          
          {/* --- STATE A: SCENE SELECTED --- */}
          {activeSceneId && !activePanelId && (
            <div className="flex flex-col h-full gap-4">
              <div className="shrink-0">
                <h3 className="font-bold text-sm uppercase tracking-wide text-sky-400 mb-3">
                  Scene Context: {activeScene.name}
                </h3>
                
                {!activeScene.linkedScriptNodeId ? (
                  <div className="flex gap-2">
                    <select 
                      className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 focus:outline-none focus:border-sky-500"
                      value={selectedHeadingToLink}
                      onChange={(e) => setSelectedHeadingToLink(e.target.value)}
                    >
                      <option value="" disabled>Select a script scene...</option>
                      {allAvailableHeadings.map(heading => (
                        <option key={heading} value={heading}>{heading}</option>
                      ))}
                    </select>
                    <button 
                      onClick={() => {
                        if (!selectedHeadingToLink) return;
                        commitHistory();
                        linkSceneToScript(activeScene.id, selectedHeadingToLink);
                      }}
                      disabled={!selectedHeadingToLink}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs disabled:opacity-50 transition-colors"
                    >
                      Link Script Scene
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/30 border border-emerald-900/50 rounded flex-1">
                      <LinkIcon size={14} className="text-emerald-500" />
                      <span className="text-xs font-mono text-emerald-400 truncate">{activeScene.linkedScriptNodeId}</span>
                    </div>
                    <button 
                      onClick={() => { commitHistory(); linkSceneToScript(activeScene.id, undefined); }}
                      className="p-1.5 hover:bg-red-950/50 rounded border border-transparent hover:border-red-900/50 text-neutral-500 hover:text-red-400 transition-colors"
                      title="Unlink Script Scene"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>

              {activeScene.linkedScriptNodeId && (
                <>
                  <div className="flex-1 min-h-0 bg-neutral-900 border border-neutral-800 rounded p-4 overflow-y-auto custom-scrollbar shadow-inner">
                    {panelScriptContext ? (
                      displayBlocks.length === 0 ? (
                        <p className="text-xs italic text-neutral-500">No content under this heading.</p>
                      ) : (
                        displayBlocks.map((b, idx) => (
                          <div key={`${idx}-${b.type}`} className={blockStyle(b)}>
                            {b.text}
                          </div>
                        ))
                      )
                    ) : (
                      <div className="p-3 text-sm text-red-400 italic bg-red-950/20 rounded border border-red-900/30">
                        Linked scene heading could not be found in the script. It may have been renamed or deleted.
                      </div>
                    )}
                  </div>
                  
                  {panelScriptContext && (
                    <button
                      type="button"
                      className="w-full shrink-0 flex items-center justify-center gap-2 rounded bg-sky-600 hover:bg-sky-500 py-2.5 text-sm font-medium text-white transition-colors shadow-lg"
                      onClick={() => setActiveScriptPageId(panelScriptContext.sourcePageId)}
                    >
                      <ExternalLink size={16} />
                      Go to Script
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* --- STATE B: PANEL SELECTED --- */}
          {activePanelId && activePanel && (
            <div className="flex flex-col h-full gap-4">
              
              {activeScene.linkedScriptNodeId && panelScriptContext && (
                <div className="shrink-0 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5">
                      <LinkIcon size={10} className="text-emerald-500" />
                      <span className="text-[10px] font-mono text-emerald-400 truncate tracking-wide">{activeScene.linkedScriptNodeId}</span>
                    </div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-800 rounded p-2 max-h-[120px] overflow-y-auto custom-scrollbar shadow-inner">
                     {displayBlocks.length === 0 ? (
                        <p className="text-[10px] italic text-neutral-500">Empty scene.</p>
                      ) : (
                        displayBlocks.map((b, idx) => (
                          <div key={`${idx}-${b.type}`} className={blockStyle(b)}>
                            {b.text}
                          </div>
                        ))
                      )}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5 flex-1 min-h-[80px]">
                <label className="text-[11px] font-bold text-neutral-300 uppercase tracking-wide">
                  Dialogue
                </label>
                <textarea 
                  className="flex-1 w-full bg-neutral-900 border border-neutral-700 rounded p-2 text-xs text-neutral-200 resize-none focus:outline-none focus:border-amber-500 custom-scrollbar shadow-inner"
                  placeholder="Enter dialogue for this panel..."
                  value={activePanel.dialogue || ''}
                  onChange={(e) => {
                    updatePanelCaptions(activePanel.id, e.target.value, activePanel.notes || '');
                  }}
                />
              </div>
              
              <div className="flex flex-col gap-1.5 flex-1 min-h-[80px]">
                <label className="text-[11px] font-bold text-neutral-300 uppercase tracking-wide">
                  Action / Notes
                </label>
                <textarea 
                  className="flex-1 w-full bg-neutral-900 border border-neutral-700 rounded p-2 text-xs text-neutral-200 resize-none focus:outline-none focus:border-purple-500 custom-scrollbar shadow-inner"
                  placeholder="Action descriptions, staging notes..."
                  value={activePanel.notes || ''}
                  onChange={(e) => {
                    updatePanelCaptions(activePanel.id, activePanel.dialogue || '', e.target.value);
                  }}
                />
              </div>

            </div>
          )}
          
        </div>
      )}
    </div>
  );
};