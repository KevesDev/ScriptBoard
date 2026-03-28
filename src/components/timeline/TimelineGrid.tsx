import React, { useEffect, useRef } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { 
  useTimelineContext, RULER_H, SCENE_STRIP_H, VIDEO_ROW_H, KF_TRACK_H, 
  META_H, STORYBOARD_ROW_H, AUDIO_ROW_H 
} from './TimelineContext';
import { Film, Trash2, Layers2 } from 'lucide-react';
import { nativeConfirm } from '../../lib/focusAfterNativeDialog';
import type { TimelineAudioClip, TimelineVideoClip } from '@common/models';
import type { FlatPanelLayout } from '../../lib/timelineLayout';

function resolveStoryboardClipVisuals(project: import('@common/models').Project, flatPanels: FlatPanelLayout[], panelId: string): { name: string; thumb?: string } {
  const fp = flatPanels.find((p) => p.id === panelId);
  if (fp) return { name: fp.name, thumb: fp.thumbnailBase64 };
  for (const s of project.scenes) {
    const p = s.panels.find((x) => x.id === panelId);
    if (p) return { name: p.name, thumb: p.thumbnailBase64 };
  }
  return { name: 'Panel' };
}

function ClipWaveform({ peaks, widthPx, heightPx }: { peaks?: number[]; widthPx: number; heightPx: number; }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const w = Math.max(4, Math.floor(widthPx)); const h = Math.max(4, Math.floor(heightPx));
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr; c.style.width = `${w}px`; c.style.height = `${h}px`;
    ctx.scale(dpr, dpr); ctx.fillStyle = '#152028'; ctx.fillRect(0, 0, w, h);
    const p = peaks?.length ? peaks : [];
    if (p.length) {
      const step = w / p.length; ctx.fillStyle = '#2dd4bf';
      for (let i = 0; i < p.length; i++) {
        const bar = Math.max(1, p[i]! * (h * 0.88));
        ctx.fillRect(i * step, (h - bar) / 2, Math.max(1, step - 0.5), bar);
      }
    }
  }, [peaks, widthPx, heightPx]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 rounded-sm opacity-90" />;
}

export const TimelineGrid: React.FC = () => {
  const { 
    project, activePanelId, activeLayerId, setActivePanelId,
    commitHistory, removeTimelineAudioClip, removeTimelineVideoClip, 
    removeTimelineCameraKeyframe, removeTimelineLayerKeyframe, removeStoryboardClip 
  } = useProjectStore();
  
  const {
    scrollRef, timelineWidthPx, playheadTotalHeight, playheadPx, pxPerSec, rulerTicks,
    flatScenes, showVideoTrack, videoTracks, showCameraTrack,
    storyboardTracksSorted, sbDnDHighlightTrackId, handleStoryboardRowPanelDragOver, handleStoryboardRowPanelDrop,
    showLayerTrack, audioTracks, onTimelinePointerDown, dragRef, flatPanels, seekTo
  } = useTimelineContext();

  const renderAudioClip = (clip: TimelineAudioClip, trackIndex: number, locked: boolean) => (
    <div key={clip.id} className="absolute top-1 flex overflow-hidden rounded border border-teal-900/80 bg-[#0d1a1f] shadow-sm" style={{ left: clip.startTimeSec * pxPerSec, width: Math.max(8, clip.durationSec * pxPerSec), height: AUDIO_ROW_H - 8 }} data-no-scrub
      onContextMenu={(e) => { e.preventDefault(); if (!locked) void (async () => { if (await nativeConfirm('Remove clip?')) { commitHistory(); removeTimelineAudioClip(trackIndex, clip.id); } })(); }}>
      {!locked && <button type="button" data-no-scrub className="absolute -left-0.5 top-0 z-20 w-2 h-full cursor-ew-resize bg-teal-900/90 hover:bg-teal-600" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); dragRef.current = { kind: 'clip-resize', trackIndex, clipId: clip.id, edge: 'left', startX: e.clientX, origStart: clip.startTimeSec, origDur: clip.durationSec }; }} />}
      <div className="relative flex-1 cursor-grab" data-no-scrub onPointerDown={(e) => { if (locked) return; e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); if (e.shiftKey) dragRef.current = { kind: 'clip-slip', trackIndex, clipId: clip.id, startX: e.clientX, origTrim: clip.sourceTrimStartSec }; else dragRef.current = { kind: 'clip-move', trackIndex, clipId: clip.id, startX: e.clientX, origStart: clip.startTimeSec }; }}>
        <ClipWaveform peaks={clip.peaks} widthPx={(clip.durationSec * pxPerSec) - 4} heightPx={AUDIO_ROW_H - 12} />
        <div className="pointer-events-none absolute bottom-0 left-1 right-6 truncate text-[9px] text-teal-100/90">{clip.name}</div>
      </div>
      {!locked && <button type="button" data-no-scrub className="absolute -right-0.5 top-0 z-20 w-2 h-full cursor-ew-resize bg-teal-900/90 hover:bg-teal-600" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); dragRef.current = { kind: 'clip-resize', trackIndex, clipId: clip.id, edge: 'right', startX: e.clientX, origStart: clip.startTimeSec, origDur: clip.durationSec }; }} />}
      {!locked && <button type="button" data-no-scrub className="absolute right-0.5 top-0.5 z-30 rounded bg-black/50 p-1 text-neutral-300 hover:text-white" onClick={(e) => { e.stopPropagation(); void (async () => { if (await nativeConfirm('Remove clip?')) { commitHistory(); removeTimelineAudioClip(trackIndex, clip.id); } })(); }}><Trash2 size={12} /></button>}
    </div>
  );

  const renderVideoClip = (clip: TimelineVideoClip, trackIndex: number, locked: boolean) => (
    <div key={clip.id} className="absolute top-1 flex overflow-hidden rounded border border-rose-900/80 bg-[#1a0f14] shadow-sm" style={{ left: clip.startTimeSec * pxPerSec, width: Math.max(8, clip.durationSec * pxPerSec), height: VIDEO_ROW_H - 8 }} data-no-scrub
      onContextMenu={(e) => { e.preventDefault(); if (!locked) void (async () => { if (await nativeConfirm('Remove clip?')) { commitHistory(); removeTimelineVideoClip(trackIndex, clip.id); } })(); }}>
      {!locked && <button type="button" data-no-scrub className="absolute -left-0.5 top-0 z-20 w-2 h-full cursor-ew-resize bg-rose-900/90 hover:bg-rose-600" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); dragRef.current = { kind: 'clip-resize', trackKind: 'video', trackIndex, clipId: clip.id, edge: 'left', startX: e.clientX, origStart: clip.startTimeSec, origDur: clip.durationSec }; }} />}
      <div className="relative flex-1 cursor-grab" data-no-scrub onPointerDown={(e) => { if (locked) return; e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); if (e.shiftKey) dragRef.current = { kind: 'clip-slip', trackKind: 'video', trackIndex, clipId: clip.id, startX: e.clientX, origTrim: clip.sourceTrimStartSec }; else dragRef.current = { kind: 'clip-move', trackKind: 'video', trackIndex, clipId: clip.id, startX: e.clientX, origStart: clip.startTimeSec }; }}>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-br from-rose-950/90 to-neutral-950"><Film size={22} className="text-rose-400/40" /></div>
        <div className="pointer-events-none absolute bottom-0.5 left-1 right-6 truncate text-[9px] text-rose-100/85">{clip.name}</div>
      </div>
      {!locked && <button type="button" data-no-scrub className="absolute -right-0.5 top-0 z-20 w-2 h-full cursor-ew-resize bg-rose-900/90 hover:bg-rose-600" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); dragRef.current = { kind: 'clip-resize', trackKind: 'video', trackIndex, clipId: clip.id, edge: 'right', startX: e.clientX, origStart: clip.startTimeSec, origDur: clip.durationSec }; }} />}
      {!locked && <button type="button" data-no-scrub className="absolute right-0.5 top-0.5 z-30 rounded bg-black/50 p-1 text-neutral-300 hover:text-white" onClick={(e) => { e.stopPropagation(); void (async () => { if (await nativeConfirm('Remove clip?')) { commitHistory(); removeTimelineVideoClip(trackIndex, clip.id); } })(); }}><Trash2 size={12} /></button>}
    </div>
  );

  if (!project) return null;

  return (
    <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-[#1e1e1e]" onPointerDown={(e) => { if (scrollRef.current && (e.target as HTMLElement).closest('[data-timeline-surface]')) onTimelinePointerDown(e, scrollRef.current); }}>
      <div className="relative" style={{ width: timelineWidthPx, minHeight: playheadTotalHeight }}>
        
        <div id="timeline-playhead" className="pointer-events-none absolute top-0 z-30 w-px bg-red-500 will-change-transform" style={{ left: 0, transform: `translateX(${playheadPx}px)`, height: playheadTotalHeight }}><div className="absolute -top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent border-t-red-500" /></div>
        
        <div data-timeline-surface className="relative cursor-crosshair border-b border-neutral-800 bg-[#2a2a2a]" style={{ height: RULER_H }}>
          {rulerTicks.map((tk, i) => ( <div key={i} className={`absolute bottom-0 border-l ${tk.major ? 'h-3 border-neutral-500' : 'h-1.5 border-neutral-600'}`} style={{ left: tk.x }} /> ))}
          {rulerTicks.filter((t) => t.label).map((tk, i) => ( <span key={`l-${i}`} className="absolute top-1 text-[9px] text-neutral-500" style={{ left: tk.x + 2 }}>{tk.label}</span> ))}
        </div>

        <div data-timeline-surface className="relative border-b border-neutral-800 bg-[#1e1e1e]" style={{ height: SCENE_STRIP_H }}>
          {flatScenes.map((fs) => ( <div key={fs.scene.id} className="absolute top-1 bottom-1 rounded border border-violet-500/40 bg-violet-950/50" style={{ left: fs.startTime * pxPerSec, width: Math.max((fs.endTime - fs.startTime) * pxPerSec, 4) }} title={fs.scene.name} /> ))}
        </div>

        {showVideoTrack && videoTracks.map((tr, vi) => ( <div key={tr.id} data-timeline-surface className="relative border-b border-neutral-900 bg-[#1a1520]" style={{ width: timelineWidthPx, height: VIDEO_ROW_H }}>{tr.clips.map((c) => renderVideoClip(c, vi, tr.locked))}</div> ))}
        
        {showCameraTrack && (
          <div data-timeline-surface className="relative border-b border-neutral-800 bg-[#1e2428]" style={{ width: timelineWidthPx, height: KF_TRACK_H }}>
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-neutral-700/80" />
            {project.timeline.cameraKeyframes.map((k) => (
              <button key={k.id} type="button" data-no-scrub className="absolute top-1/2 z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-sky-500 bg-sky-600 shadow hover:bg-sky-400" style={{ left: k.timeSec * pxPerSec }} onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); if (e.altKey) { void (async () => { if (await nativeConfirm('Remove keyframe?')) { commitHistory(); removeTimelineCameraKeyframe(k.id); } })(); return; } commitHistory(); dragRef.current = { kind: 'cam-kf-move', id: k.id, startX: e.clientX, origT: k.timeSec }; }} />
            ))}
          </div>
        )}

        <div style={{ height: META_H }} className="border-b border-neutral-800 bg-[#222]" />

        {storyboardTracksSorted.map((tr) => (
          <div key={tr.id} data-timeline-surface className={`relative border-b border-neutral-800 bg-[#222] ${sbDnDHighlightTrackId === tr.id ? 'ring-2 ring-inset ring-cyan-400/80 bg-cyan-950/30' : ''}`} style={{ width: timelineWidthPx, height: STORYBOARD_ROW_H }} onDragOver={(e) => handleStoryboardRowPanelDragOver(e, tr)} onDrop={(e) => handleStoryboardRowPanelDrop(e, tr)}>
            {tr.clips.map((clip) => {
              const vis = resolveStoryboardClipVisuals(project, flatPanels, clip.panelId);
              const isActive = activePanelId === clip.panelId;
              const left = clip.startTimeSec * pxPerSec;
              const w = Math.max(8, clip.durationSec * pxPerSec);
              return (
                <div key={clip.id} className="absolute top-1 flex overflow-hidden rounded border border-cyan-900/70 bg-[#102428] shadow-sm" style={{ left, width: w, height: STORYBOARD_ROW_H - 8 }} data-no-scrub
                  onContextMenu={(e) => { e.preventDefault(); if (!tr.locked) { void (async () => { if (await nativeConfirm('Remove clip?')) { commitHistory(); removeStoryboardClip(tr.id, clip.id); } })(); } }}>
                  {!tr.locked && <button type="button" data-no-scrub className="absolute -left-0.5 top-0 z-20 w-2 h-full cursor-ew-resize bg-cyan-950/90 hover:bg-cyan-600" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); dragRef.current = { kind: 'sb-clip-resize', trackId: tr.id, clipId: clip.id, edge: 'left', startX: e.clientX, origStart: clip.startTimeSec, origDur: clip.durationSec }; }} />}
                  <button type="button" className={`relative h-full min-w-0 flex-1 cursor-grab overflow-hidden text-left ${isActive ? 'ring-2 ring-inset ring-red-500/70' : ''}`} data-no-scrub onPointerDown={(e) => { if (tr.locked) return; e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); dragRef.current = { kind: 'sb-clip-move', trackId: tr.id, clipId: clip.id, startX: e.clientX, origStart: clip.startTimeSec }; }} onClick={() => { seekTo(clip.startTimeSec); setActivePanelId(clip.panelId); }}>
                    <div className="pointer-events-none absolute left-0.5 top-0.5 z-10 max-w-[80%] truncate rounded bg-black/60 px-1 text-[9px]">{vis.name}</div>
                    {vis.thumb ? <img src={vis.thumb} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover opacity-75" /> : <div className="pointer-events-none flex h-full w-full items-center justify-center bg-neutral-800 text-neutral-600"><Layers2 size={16} /></div>}
                  </button>
                  {!tr.locked && <button type="button" data-no-scrub className="absolute -right-0.5 top-0 z-20 w-2 h-full cursor-ew-resize bg-cyan-950/90 hover:bg-cyan-600" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); commitHistory(); dragRef.current = { kind: 'sb-clip-resize', trackId: tr.id, clipId: clip.id, edge: 'right', startX: e.clientX, origStart: clip.startTimeSec, origDur: clip.durationSec }; }} />}
                  {!tr.locked && <button type="button" data-no-scrub className="absolute right-0.5 top-0.5 z-30 rounded bg-black/50 p-1 text-neutral-300 hover:text-white" onClick={(e) => { e.stopPropagation(); void (async () => { if (await nativeConfirm('Remove clip?')) { commitHistory(); removeStoryboardClip(tr.id, clip.id); } })(); }}><Trash2 size={12} /></button>}
                </div>
              );
            })}
          </div>
        ))}

        {showLayerTrack && (
          <div data-timeline-surface className="relative border-b border-neutral-800 bg-[#151c18]" style={{ width: timelineWidthPx, height: KF_TRACK_H }}>
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-700/80" />
            {project.timeline.layerKeyframes.filter((k) => k.panelId === activePanelId && k.layerId === activeLayerId).map((k) => (
              <button key={k.id} type="button" data-no-scrub className="absolute top-1/2 z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-emerald-500 bg-emerald-700 shadow hover:border-emerald-300 hover:bg-emerald-600" style={{ left: k.timeSec * pxPerSec }} onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); if (e.altKey) { void (async () => { if (await nativeConfirm('Remove keyframe?')) { commitHistory(); removeTimelineLayerKeyframe(k.id); } })(); return; } commitHistory(); dragRef.current = { kind: 'layer-kf-move', id: k.id, startX: e.clientX, origT: k.timeSec }; }} />
            ))}
          </div>
        )}

        {audioTracks.map((tr, ti) => ( <div key={tr.id} className="relative border-b border-neutral-900 bg-[#161c20]" style={{ width: timelineWidthPx, height: AUDIO_ROW_H }}>{tr.clips.map((c) => renderAudioClip(c, ti, tr.locked))}</div> ))}
      </div>
    </div>
  );
};