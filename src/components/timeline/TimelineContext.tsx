import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { IPC_CHANNELS } from '@common/ipc';
import type { IpcResponse } from '@common/ipc';
import type {
  TimelineAudioClip, TimelineAudioTrack, TimelineStoryboardTrack,
  TimelineVideoClip, TimelineVideoTrack,
} from '@common/models';
import {
  buildStoryboardTimeline, maxAudioTimelineEnd, maxVideoTimelineEnd,
  collectTimelineSnapEdges, snapTimeToEdges, snapToFrame,
  lookupPanelLayoutSummary, transitionSeconds, type FlatPanelLayout,
} from '../../lib/timelineLayout';
import {
  getTopStoryboardPanelIdAtTime,
  maxStoryboardTrackTimelineEnd,
} from '../../lib/timelineStoryboardComposition';
import { decodeAudioFromDataUri, downsamplePeaks } from '../../lib/audioClipDecode';
import { probeVideoDurationFromDataUri } from '../../lib/videoClipMetadata';
import { useTimelinePlayback } from '../../hooks/useTimelinePlayback';
import { isKeyboardEventTargetTextEntry } from '../../lib/keyboardTargets';
import { collectAnimaticExportAudioClips } from '../../lib/animaticAudioExport';
import { buildAnimaticSegmentsForProject } from '../../lib/animaticSegments';
import { getPanelIdFromDataTransfer } from '../../lib/panelTimelineDnD';
import { useAppStore, defaultBrushes } from '../../store/appStore';
import { nativeAlert } from '../../lib/focusAfterNativeDialog';

export const HEADER_W = 200;
export const RULER_H = 28;
export const SCENE_STRIP_H = 22;
export const VIDEO_ROW_H = 72;
export const KF_TRACK_H = 40;
export const META_H = 48;
export const STORYBOARD_ROW_H = 72;
export const AUDIO_ROW_H = 72;
export const DEFAULT_PX_PER_SEC = 50;
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 140;
export const SKIP_SECONDS = 1;

export function panelDefaultClipDurationSec(project: import('@common/models').Project, panelId: string): number {
  for (const s of project.scenes) {
    const p = s.panels.find((x) => x.id === panelId);
    if (p) {
      const body = Math.max(0.05, (Number.parseInt(p.duration, 10) || 2000) / 1000);
      return body + transitionSeconds(p);
    }
  }
  return 2;
}

export function formatTimecode(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const wholeSeconds = Math.floor(seconds);
  const frames = Math.min(fps - 1, Math.round((seconds - wholeSeconds) * fps));
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor((wholeSeconds % 3600) / 60);
  const s = wholeSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

export interface TimelineContextValue {
  scrollRef: React.RefObject<HTMLDivElement>;
  leftColScrollRef: React.RefObject<HTMLDivElement>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  pxPerSec: number;
  setPxPerSec: React.Dispatch<React.SetStateAction<number>>;
  snapping: boolean;
  setSnapping: React.Dispatch<React.SetStateAction<boolean>>;
  audioScrubbing: boolean;
  setAudioScrubbing: React.Dispatch<React.SetStateAction<boolean>>;
  showCameraTrack: boolean;
  setShowCameraTrack: React.Dispatch<React.SetStateAction<boolean>>;
  showLayerTrack: boolean;
  setShowLayerTrack: React.Dispatch<React.SetStateAction<boolean>>;
  showVideoTrack: boolean;
  setShowVideoTrack: React.Dispatch<React.SetStateAction<boolean>>;
  menuOpen: boolean;
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  importTrackIndex: number;
  setImportTrackIndex: React.Dispatch<React.SetStateAction<number>>;
  loopPlayback: boolean;
  setLoopPlayback: React.Dispatch<React.SetStateAction<boolean>>;
  exportingVideo: boolean;
  exportProgress: number | null;
  sbDnDHighlightTrackId: string | null;
  setSbDnDHighlightTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  dragRef: React.MutableRefObject<any>;

  fps: number;
  animaticMode: boolean;
  overwriteClips: boolean;
  audioTracks: TimelineAudioTrack[];
  videoTracks: TimelineVideoTrack[];
  storyboardTracksSorted: TimelineStoryboardTrack[];
  flatPanels: FlatPanelLayout[];
  flatScenes: any[];
  timelineDuration: number;
  timelineWidthPx: number;
  playheadPx: number;
  playheadTotalHeight: number;

  activeSequenceName: string;
  activeMetaSummary: any;
  activeLayerName: string;
  rulerTicks: { x: number; label: string; major: boolean }[];

  snapTime: (t: number) => number;
  seekTo: (t: number) => void;
  handlePlayPause: () => void;
  handleImportAudio: () => Promise<void>;
  handleImportVideo: () => Promise<void>;
  handleExportAnimatic: (format: 'mp4' | 'mov') => Promise<void>;
  onTimelinePointerDown: (e: React.PointerEvent, scrollEl: HTMLDivElement) => void;
  handleStoryboardRowPanelDrop: (e: React.DragEvent, tr: TimelineStoryboardTrack) => void;
  handleStoryboardRowPanelDragOver: (e: React.DragEvent, tr: TimelineStoryboardTrack) => void;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

export const TimelineProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    project, setActivePanelId, activePanelId, activeLayerId, commitHistory,
    addTimelineAudioClip, moveTimelineAudioClip, resizeTimelineAudioClip, slipTimelineAudioClipToTrim,
    addTimelineVideoClip, moveTimelineVideoClip, resizeTimelineVideoClip, slipTimelineVideoClipToTrim,
    setTimelinePlayheadSec, moveTimelineCameraKeyframe, moveTimelineLayerKeyframe,
    addStoryboardClip, moveStoryboardClip, resizeStoryboardClip,
  } = useProjectStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const leftColScrollRef = useRef<HTMLDivElement>(null);
  const scrollSyncLock = useRef(false);
  const flatPanelsRef = useRef<FlatPanelLayout[]>([]);
  const decodedClipIdsRef = useRef<Set<string>>(new Set());
  const decodedVideoClipIdsRef = useRef<Set<string>>(new Set());
  const syncAudioRef = useRef<(t: number, playing: boolean) => void>(() => {});

  useEffect(() => {
    decodedClipIdsRef.current.clear();
    decodedVideoClipIdsRef.current.clear();
  }, [project?.id]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;

  useEffect(() => { setTimelinePlayheadSec(currentTime); }, [currentTime, setTimelinePlayheadSec]);

  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [snapping, setSnapping] = useState(true);
  const [audioScrubbing, setAudioScrubbing] = useState(false);
  const [showCameraTrack, setShowCameraTrack] = useState(false);
  const [showLayerTrack, setShowLayerTrack] = useState(false);
  const [showVideoTrack, setShowVideoTrack] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importTrackIndex, setImportTrackIndex] = useState(0);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [sbDnDHighlightTrackId, setSbDnDHighlightTrackId] = useState<string | null>(null);

  const draggingPlayhead = useRef(false);
  const dragRef = useRef<any>(null);

  const fps = project?.settings.framerate && project.settings.framerate > 0 ? project.settings.framerate : 24;
  const animaticMode = project?.timeline?.animaticEditingMode ?? false;
  const overwriteClips = project?.timeline?.overwriteClips ?? false;
  const audioTracks = project?.timeline?.audioTracks ?? [];
  const videoTracks = project?.timeline?.videoTracks ?? [];
  const storyboardTracksSorted = useMemo(() => {
    const tr = project?.timeline?.storyboardTracks ?? [];
    return [...tr].sort((a, b) => a.order - b.order);
  }, [project?.timeline?.storyboardTracks]);

  const { flatPanels, flatScenes } = useMemo(() => (project ? buildStoryboardTimeline(project) : { flatPanels: [] as FlatPanelLayout[], flatScenes: [], totalDuration: 0 }), [project]);
  flatPanelsRef.current = flatPanels;

  const maxAudioEnd = useMemo(() => (project ? maxAudioTimelineEnd(project) : 0), [project]);
  const maxVideoEnd = useMemo(() => (project ? maxVideoTimelineEnd(project) : 0), [project]);
  const maxStoryboardEnd = useMemo(() => (project ? maxStoryboardTrackTimelineEnd(project) : 0), [project]);
  const timelineDuration = Math.max(maxAudioEnd, maxVideoEnd, maxStoryboardEnd, 8);
  const timelineWidthPx = Math.max(timelineDuration * pxPerSec, 400);
  const playheadPx = currentTime * pxPerSec;

  const playheadTotalHeight = RULER_H + SCENE_STRIP_H + (showVideoTrack ? Math.max(1, videoTracks.length) * VIDEO_ROW_H : 0) + (showCameraTrack ? KF_TRACK_H : 0) + META_H + (Math.max(1, storyboardTracksSorted.length) * STORYBOARD_ROW_H) + (showLayerTrack ? KF_TRACK_H : 0) + (Math.max(1, audioTracks.length) * AUDIO_ROW_H);

  const { syncAudioToTime } = useTimelinePlayback({
    isPlaying, setIsPlaying, currentTime, setCurrentTime, timelineDuration,
    tracks: audioTracks, videoTracks, loop: loopPlayback, enabled: !!project?.timeline,
  });

  syncAudioRef.current = syncAudioToTime;

  const playheadFocusPanelId = useMemo(() => {
    if (!project) return null;
    const t = currentTime;
    const top = getTopStoryboardPanelIdAtTime(project, t);
    if (top) return top;
    return flatPanels.find((x) => t >= x.startTime && t < x.endTime)?.id ?? null;
  }, [project, currentTime, flatPanels]);

  const activeMetaSummary = useMemo(() => {
    if (!project || !playheadFocusPanelId) return null;
    return lookupPanelLayoutSummary(project, flatPanels, playheadFocusPanelId);
  }, [project, flatPanels, playheadFocusPanelId]);

  useEffect(() => {
    if (!isPlaying || !playheadFocusPanelId) return;
    if (playheadFocusPanelId !== activePanelId) setActivePanelId(playheadFocusPanelId);
  }, [isPlaying, playheadFocusPanelId, activePanelId, setActivePanelId]);

  useEffect(() => {
    const r = scrollRef.current;
    const l = leftColScrollRef.current;
    if (!r || !l) return;
    const syncFromRight = () => {
      if (scrollSyncLock.current) return;
      if (l.scrollTop === r.scrollTop) return;
      scrollSyncLock.current = true; l.scrollTop = r.scrollTop; scrollSyncLock.current = false;
    };
    const syncFromLeft = () => {
      if (scrollSyncLock.current) return;
      if (r.scrollTop === l.scrollTop) return;
      scrollSyncLock.current = true; r.scrollTop = l.scrollTop; scrollSyncLock.current = false;
    };
    r.addEventListener('scroll', syncFromRight, { passive: true });
    l.addEventListener('scroll', syncFromLeft, { passive: true });
    return () => {
      r.removeEventListener('scroll', syncFromRight);
      l.removeEventListener('scroll', syncFromLeft);
    };
  }, [project?.id, playheadTotalHeight]);

  const activeSequenceName = useMemo(() => {
    const seqs = project?.timeline?.sequences;
    if (!seqs?.length) return '-';
    const sorted = [...seqs].sort((a, b) => a.startSec - b.startSec || a.order - b.order);
    let hit: (typeof seqs)[0] | undefined;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i]!.startSec <= currentTime) { hit = sorted[i]; break; }
    }
    return hit?.name ?? sorted[0]?.name ?? '-';
  }, [project, currentTime]);

  const snapEdges = useMemo(() => {
    const audioEdges: number[] = [];
    audioTracks.forEach((tr) => {
      tr.clips.forEach((c) => { audioEdges.push(c.startTimeSec, c.startTimeSec + c.durationSec); });
    });
    if (!project) return [0, timelineDuration];
    return collectTimelineSnapEdges(project, flatPanels, audioEdges);
  }, [project, flatPanels, audioTracks, videoTracks, timelineDuration]);

  const snapTime = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, timelineDuration));
      if (!snapping) return clamped;
      const toEdge = snapTimeToEdges(clamped, snapEdges, 0.4); 
      return Math.max(0, Math.min(snapToFrame(toEdge, fps), timelineDuration));
    },
    [snapping, snapEdges, timelineDuration, fps],
  );

  const seekTo = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, timelineDuration));
      const snapped = snapTime(clamped);
      setCurrentTime(snapped);
      syncAudioRef.current(snapped, false);
      const p = useProjectStore.getState().project;
      const top = p ? getTopStoryboardPanelIdAtTime(p, snapped) : null;
      const fp = flatPanelsRef.current.find((x) => snapped >= x.startTime && snapped < x.endTime);
      const id = top ?? fp?.id;
      if (id) setActivePanelId(id);
    },
    [timelineDuration, snapTime, setActivePanelId],
  );

  const handleStoryboardRowPanelDragOver = useCallback((e: React.DragEvent, tr: TimelineStoryboardTrack) => {
    e.preventDefault(); 
    if (tr.locked) { e.dataTransfer.dropEffect = 'none'; setSbDnDHighlightTrackId(null); return; }
    e.dataTransfer.dropEffect = 'copy'; setSbDnDHighlightTrackId(tr.id);
  }, []);

  const handleStoryboardRowPanelDrop = useCallback(
    (e: React.DragEvent, tr: TimelineStoryboardTrack) => {
      const panelId = getPanelIdFromDataTransfer(e.dataTransfer);
      if (!panelId) return;
      e.preventDefault();
      
      setSbDnDHighlightTrackId(null);
      if (tr.locked || !project) return;
      
      const sc = scrollRef.current;
      if (!sc) return;
      
      const cr = sc.getBoundingClientRect();
      const xInContent = e.clientX - cr.left + sc.scrollLeft;
      const rawT = Math.max(0, Math.min(xInContent / pxPerSec, timelineDuration));
      const t = snapTime(rawT);
      const dur = panelDefaultClipDurationSec(project, panelId);
      const fp = flatPanels.find((p) => p.id === panelId);

      setTimeout(() => {
        commitHistory();
        addStoryboardClip(tr.id, {
          name: fp?.name ?? 'Clip',
          panelId,
          startTimeSec: t,
          durationSec: dur,
        });
      }, 0);
    },
    [project, pxPerSec, timelineDuration, snapTime, flatPanels, commitHistory, addStoryboardClip],
  );

  const latestRef = useRef({
    pxPerSec, timelineDuration, snapTime, setActivePanelId, audioScrubbing, moveTimelineAudioClip, moveTimelineVideoClip,
    resizeTimelineAudioClip, resizeTimelineVideoClip, slipTimelineAudioClipToTrim, slipTimelineVideoClipToTrim, moveTimelineCameraKeyframe,
    moveTimelineLayerKeyframe, moveStoryboardClip, resizeStoryboardClip, isPlaying, syncAudioToTime: syncAudioRef.current
  });

  useEffect(() => {
    latestRef.current = {
      pxPerSec, timelineDuration, snapTime, setActivePanelId, audioScrubbing, moveTimelineAudioClip, moveTimelineVideoClip,
      resizeTimelineAudioClip, resizeTimelineVideoClip, slipTimelineAudioClipToTrim, slipTimelineVideoClipToTrim, moveTimelineCameraKeyframe,
      moveTimelineLayerKeyframe, moveStoryboardClip, resizeStoryboardClip, isPlaying, syncAudioToTime: syncAudioRef.current
    };
  });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const lr = latestRef.current;

      if (!d) {
        if (!draggingPlayhead.current || !scrollRef.current) return;
        const el = scrollRef.current;
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left + el.scrollLeft;
        let t = x / lr.pxPerSec;
        t = lr.snapTime(Math.max(0, Math.min(t, lr.timelineDuration)));
        setCurrentTime(t);
        lr.syncAudioToTime(t, lr.audioScrubbing);
        const pSt = useProjectStore.getState().project;
        const top = pSt ? getTopStoryboardPanelIdAtTime(pSt, t) : null;
        const fp = flatPanelsRef.current.find((x) => t >= x.startTime && t < x.endTime);
        const id = top ?? fp?.id;
        if (id) lr.setActivePanelId(id);
        return;
      }

      const dx = (e.clientX - d.startX) / lr.pxPerSec;
      if (d.kind === 'clip-slip') {
        const trim = d.origTrim + dx;
        if (d.trackKind === 'video') lr.slipTimelineVideoClipToTrim(d.trackIndex, d.clipId, trim);
        else lr.slipTimelineAudioClipToTrim(d.trackIndex, d.clipId, trim);
        return;
      }
      if (d.kind === 'clip-move') {
        const t = lr.snapTime(Math.max(0, d.origStart + dx));
        if (d.trackKind === 'video') lr.moveTimelineVideoClip(d.trackIndex, d.clipId, t);
        else lr.moveTimelineAudioClip(d.trackIndex, d.clipId, t);
        return;
      }
      if (d.kind === 'clip-resize') {
        const tLine = d.edge === 'right' ? d.origStart + d.origDur + dx : d.origStart + dx;
        if (d.trackKind === 'video') lr.resizeTimelineVideoClip(d.trackIndex, d.clipId, d.edge, tLine);
        else lr.resizeTimelineAudioClip(d.trackIndex, d.clipId, d.edge, tLine);
        return;
      }
      if (d.kind === 'cam-kf-move') { lr.moveTimelineCameraKeyframe(d.id, lr.snapTime(Math.max(0, d.origT + dx))); return; }
      if (d.kind === 'layer-kf-move') { lr.moveTimelineLayerKeyframe(d.id, lr.snapTime(Math.max(0, d.origT + dx))); return; }
      if (d.kind === 'sb-clip-move') { lr.moveStoryboardClip(d.trackId, d.clipId, lr.snapTime(Math.max(0, d.origStart + dx))); return; }
      if (d.kind === 'sb-clip-resize') {
        const tLine = d.edge === 'right' ? d.origStart + d.origDur + dx : d.origStart + dx;
        lr.resizeStoryboardClip(d.trackId, d.clipId, d.edge, tLine);
        return;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.target instanceof Element) {
        try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      draggingPlayhead.current = false;
      dragRef.current = null;
      if (!latestRef.current.isPlaying) latestRef.current.syncAudioToTime(currentTimeRef.current, false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onUp, { capture: true });
    };
  }, []);

  const rulerTicks = useMemo(() => {
    const ticks: { x: number; label: string; major: boolean }[] = [];
    const step = pxPerSec < 20 ? 10 : pxPerSec < 45 ? 5 : pxPerSec < 90 ? 2 : 1;
    for (let t = 0; t <= timelineDuration + step; t += step) {
      ticks.push({
        x: t * pxPerSec,
        label: t % 60 === 0 || step >= 10 ? `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}` : '',
        major: t % (step * 2) === 0 || step >= 10,
      });
    }
    return ticks;
  }, [timelineDuration, pxPerSec]);

  const activeLayerName = useMemo(() => {
    if (!project || !activePanelId || !activeLayerId) return '-';
    for (const sc of project.scenes) {
      const pan = sc.panels.find((p) => p.id === activePanelId);
      const ly = pan?.layers.find((l) => l.id === activeLayerId);
      if (ly) return ly.name;
    }
    return '-';
  }, [project, activePanelId, activeLayerId]);

  const handlePlayPause = useCallback(() => setIsPlaying((p) => !p), []);

  const handleImportAudio = async () => {
    if (!window.ipcRenderer || !project?.timeline) return;
    try {
      const res: IpcResponse<{ dataUri: string; fileName: string }> = await window.ipcRenderer.invoke(IPC_CHANNELS.AUDIO_IMPORT);
      if (!res.success || !res.data) return;
      const buf = await decodeAudioFromDataUri(res.data.dataUri);
      const full = buf.duration;
      const peaks = downsamplePeaks(buf, 600);
      const clip: TimelineAudioClip = {
        id: crypto.randomUUID(), name: res.data.fileName, startTimeSec: snapTime(currentTime), durationSec: full,
        sourceTrimStartSec: 0, sourceDurationSec: full, dataUri: res.data.dataUri, peaks,
      };
      commitHistory(); addTimelineAudioClip(importTrackIndex, clip);
    } catch (err) { console.error('Failed to import audio:', err); }
  };

  const handleImportVideo = async () => {
    if (!window.ipcRenderer || !project?.timeline || !showVideoTrack) return;
    try {
      const res: IpcResponse<{ dataUri: string; fileName: string }> = await window.ipcRenderer.invoke(IPC_CHANNELS.VIDEO_IMPORT);
      if (!res.success || !res.data) return;
      const full = await probeVideoDurationFromDataUri(res.data.dataUri);
      const playable = Math.max(0.05, full || 5);
      const clip: TimelineVideoClip = {
        id: crypto.randomUUID(), name: res.data.fileName, startTimeSec: snapTime(currentTime), durationSec: playable,
        sourceTrimStartSec: 0, sourceDurationSec: playable, dataUri: res.data.dataUri,
      };
      commitHistory(); addTimelineVideoClip(0, clip);
    } catch (err) { console.error('Failed to import video:', err); }
  };

  const handleExportAnimatic = async (format: 'mp4' | 'mov') => {
    if (!project) { await nativeAlert('No project loaded.'); return; }
    if (!window.ipcRenderer) { await nativeAlert('Video export is not available in this environment.'); return; }
    
    setExportingVideo(true);
    setExportProgress(0); // Start at 0%

    // Setup IPC Listener for Progress
    const progressListener = (_event: any, progress: number) => {
      setExportProgress(progress);
    };

    try {
      window.ipcRenderer.on(IPC_CHANNELS.ANIMATIC_EXPORT_PROGRESS, progressListener);

      const w = project.settings.resolution?.width ?? 1920;
      const h = project.settings.resolution?.height ?? 1080;
      const safeName = (project.name || 'ScriptBoard').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120);
      const prefs = useAppStore.getState().preferences;
      const getBrushConfig = (presetId?: string) => {
        if (!presetId) return defaultBrushes['solid'];
        return prefs.customBrushes?.find((b) => b.id === presetId) || defaultBrushes[presetId] || defaultBrushes['solid'];
      };
      const segments = await buildAnimaticSegmentsForProject(project, flatPanels, getBrushConfig);
      const audioClips = collectAnimaticExportAudioClips(project);
      
      const res: IpcResponse<{ filePath: string }> = await window.ipcRenderer.invoke(IPC_CHANNELS.ANIMATIC_EXPORT_VIDEO, {
        format, fps, width: w, height: h, segments, audioClips, defaultFileName: `${safeName}-animatic.${format}`,
      });
      
      if (res.success && res.data?.filePath) await nativeAlert(`Video saved:\n${res.data.filePath}`);
    } catch (err) { 
      console.error(err); 
      await nativeAlert('An error occurred during export.');
    } finally { 
      window.ipcRenderer.off(IPC_CHANNELS.ANIMATIC_EXPORT_PROGRESS, progressListener);
      setExportingVideo(false); 
      setExportProgress(null); 
    }
  };

  const onTimelinePointerDown = useCallback((e: React.PointerEvent, scrollEl: HTMLDivElement) => {
    if ((e.target as HTMLElement).closest('[data-no-scrub]')) return;
    const rect = scrollEl.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollEl.scrollLeft;
    let t = x / pxPerSec;
    t = snapTime(Math.max(0, Math.min(t, timelineDuration)));
    draggingPlayhead.current = true;
    seekTo(t);
  }, [pxPerSec, snapTime, timelineDuration, seekTo]);

  const value = {
    scrollRef, leftColScrollRef, isPlaying, setIsPlaying, currentTime, setCurrentTime,
    pxPerSec, setPxPerSec, snapping, setSnapping, audioScrubbing, setAudioScrubbing,
    showCameraTrack, setShowCameraTrack, showLayerTrack, setShowLayerTrack, showVideoTrack, setShowVideoTrack,
    menuOpen, setMenuOpen, importTrackIndex, setImportTrackIndex, loopPlayback, setLoopPlayback,
    exportingVideo, exportProgress, sbDnDHighlightTrackId, setSbDnDHighlightTrackId, dragRef,
    fps, animaticMode, overwriteClips, audioTracks, videoTracks, storyboardTracksSorted,
    flatPanels, flatScenes, timelineDuration, timelineWidthPx, playheadPx, playheadTotalHeight,
    activeSequenceName, activeMetaSummary, activeLayerName, rulerTicks,
    snapTime, seekTo, handlePlayPause, handleImportAudio, handleImportVideo, handleExportAnimatic,
    onTimelinePointerDown, handleStoryboardRowPanelDrop, handleStoryboardRowPanelDragOver
  };

  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
};

export const useTimelineContext = () => {
  const ctx = useContext(TimelineContext);
  if (!ctx) throw new Error('useTimelineContext must be used within a TimelineProvider');
  return ctx;
};