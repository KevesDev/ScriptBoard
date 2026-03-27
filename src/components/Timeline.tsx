import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import {
  Play,
  Pause,
  Import,
  Trash2,
  Magnet,
  AudioWaveform,
  Layers2,
  Video,
  Camera,
  Lock,
  Plus,
  Volume2,
  VolumeX,
  ZoomIn,
  MoreHorizontal,
  SquareStack,
  Film,
  Clapperboard,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Repeat,
  FileVideo,
  Loader2,
} from 'lucide-react';
import { IPC_CHANNELS } from '@common/ipc';
import type { IpcResponse } from '@common/ipc';
import type {
  TimelineAudioClip,
  TimelineAudioTrack,
  TimelineStoryboardTrack,
  TimelineVideoClip,
  TimelineVideoTrack,
} from '@common/models';
import {
  buildStoryboardTimeline,
  maxAudioTimelineEnd,
  maxVideoTimelineEnd,
  collectTimelineSnapEdges,
  snapTimeToEdges,
  snapToFrame,
  lookupPanelLayoutSummary,
  transitionSeconds,
  type FlatPanelLayout,
} from '../lib/timelineLayout';
import {
  getTopStoryboardPanelIdAtTime,
  hasAnyStoryboardTimelineClips,
  maxStoryboardTrackTimelineEnd,
} from '../lib/timelineStoryboardComposition';
import { decodeAudioFromDataUri, downsamplePeaks } from '../lib/audioClipDecode';
import { probeVideoDurationFromDataUri } from '../lib/videoClipMetadata';
import { useTimelinePlayback } from '../hooks/useTimelinePlayback';
import { isKeyboardEventTargetTextEntry } from '../lib/keyboardTargets';
import { collectAnimaticExportAudioClips } from '../lib/animaticAudioExport';
import { buildAnimaticSegmentsForProject } from '../lib/animaticSegments';
import { dataTransferLooksLikeScriptboardPanel, getPanelIdFromDataTransfer } from '../lib/panelTimelineDnD';
import { useAppStore, defaultBrushes } from '../store/appStore';
import { nativeAlert, nativeConfirm } from '../lib/focusAfterNativeDialog';

const HEADER_W = 200;
const RULER_H = 28;
const SCENE_STRIP_H = 22;
const VIDEO_ROW_H = 72;
const KF_TRACK_H = 40;
const META_H = 48;
const STORYBOARD_ROW_H = 72;
const AUDIO_ROW_H = 72;
const DEFAULT_PX_PER_SEC = 50;
const MIN_ZOOM = 12;
const MAX_ZOOM = 140;
const SKIP_SECONDS = 1;

function panelDefaultClipDurationSec(project: import('@common/models').Project, panelId: string): number {
  for (const s of project.scenes) {
    const p = s.panels.find((x) => x.id === panelId);
    if (p) {
      const body = Math.max(0.05, (Number.parseInt(p.duration, 10) || 2000) / 1000);
      return body + transitionSeconds(p);
    }
  }
  return 2;
}

function resolveStoryboardClipVisuals(
  project: import('@common/models').Project,
  flatPanels: FlatPanelLayout[],
  panelId: string,
): { name: string; thumb?: string } {
  const fp = flatPanels.find((p) => p.id === panelId);
  if (fp) return { name: fp.name, thumb: fp.thumbnailBase64 };
  for (const s of project.scenes) {
    const p = s.panels.find((x) => x.id === panelId);
    if (p) return { name: p.name, thumb: p.thumbnailBase64 };
  }
  return { name: 'Panel' };
}

function formatTimecode(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const wholeSeconds = Math.floor(seconds);
  const frames = Math.min(fps - 1, Math.round((seconds - wholeSeconds) * fps));
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor((wholeSeconds % 3600) / 60);
  const s = wholeSeconds % 60;
  const ff = Math.min(fps - 1, frames);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${ff.toString().padStart(2, '0')}`;
}

function ClipWaveform({
  peaks,
  widthPx,
  heightPx,
}: {
  peaks?: number[];
  widthPx: number;
  heightPx: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = Math.max(4, Math.floor(widthPx));
    const h = Math.max(4, Math.floor(heightPx));
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#152028';
    ctx.fillRect(0, 0, w, h);
    const p = peaks?.length ? peaks : [];
    if (p.length) {
      const step = w / p.length;
      ctx.fillStyle = '#2dd4bf';
      for (let i = 0; i < p.length; i++) {
        const bar = Math.max(1, p[i]! * (h * 0.88));
        ctx.fillRect(i * step, (h - bar) / 2, Math.max(1, step - 0.5), bar);
      }
    }
  }, [peaks, widthPx, heightPx]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 rounded-sm opacity-90" />;
}

export const Timeline: React.FC = () => {
  const {
    project,
    setActivePanelId,
    activePanelId,
    activeLayerId,
    commitHistory,
    setAnimaticEditingMode,
    setTimelineOverwriteClips,
    addTimelineAudioClip,
    removeTimelineAudioClip,
    moveTimelineAudioClip,
    resizeTimelineAudioClip,
    slipTimelineAudioClipToTrim,
    addTimelineActAt,
    addTimelineSequenceAt,
    setTimelineTrackMuted,
    setTimelineTrackSolo,
    addTimelineVideoClip,
    removeTimelineVideoClip,
    moveTimelineVideoClip,
    resizeTimelineVideoClip,
    slipTimelineVideoClipToTrim,
    setTimelineVideoTrackMuted,
    setTimelinePlayheadSec,
    addTimelineCameraKeyframe,
    removeTimelineCameraKeyframe,
    moveTimelineCameraKeyframe,
    addTimelineLayerKeyframe,
    removeTimelineLayerKeyframe,
    moveTimelineLayerKeyframe,
    addStoryboardTrack,
    removeStoryboardTrack,
    setStoryboardTrackMuted,
    addStoryboardClip,
    removeStoryboardClip,
    moveStoryboardClip,
    resizeStoryboardClip,
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

  useEffect(() => {
    setTimelinePlayheadSec(currentTime);
  }, [currentTime, setTimelinePlayheadSec]);

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
  const [sbDnDHighlightTrackId, setSbDnDHighlightTrackId] = useState<string | null>(null);

  const draggingPlayhead = useRef(false);
  const dragRef = useRef<
    | null
    | {
        kind: 'clip-slip';
        trackKind?: 'audio' | 'video';
        trackIndex: number;
        clipId: string;
        startX: number;
        origTrim: number;
      }
    | {
        kind: 'clip-move';
        trackKind?: 'audio' | 'video';
        trackIndex: number;
        clipId: string;
        startX: number;
        origStart: number;
      }
    | {
        kind: 'clip-resize';
        trackKind?: 'audio' | 'video';
        trackIndex: number;
        clipId: string;
        edge: 'left' | 'right';
        startX: number;
        origStart: number;
        origDur: number;
      }
    | {
        kind: 'cam-kf-move';
        id: string;
        startX: number;
        origT: number;
      }
    | {
        kind: 'layer-kf-move';
        id: string;
        startX: number;
        origT: number;
      }
    | {
        kind: 'sb-clip-move';
        trackId: string;
        clipId: string;
        startX: number;
        origStart: number;
      }
    | {
        kind: 'sb-clip-resize';
        trackId: string;
        clipId: string;
        edge: 'left' | 'right';
        startX: number;
        origStart: number;
        origDur: number;
      }
  >(null);

  const fps = project?.settings.framerate && project.settings.framerate > 0 ? project.settings.framerate : 24;
  const animaticMode = project?.timeline?.animaticEditingMode ?? false;
  const overwriteClips = project?.timeline?.overwriteClips ?? false;
  const audioTracks: TimelineAudioTrack[] = project?.timeline?.audioTracks ?? [];
  const videoTracks: TimelineVideoTrack[] = project?.timeline?.videoTracks ?? [];
  const storyboardTracksSorted: TimelineStoryboardTrack[] = useMemo(() => {
    const tr = project?.timeline?.storyboardTracks ?? [];
    return [...tr].sort((a, b) => a.order - b.order);
  }, [project?.timeline?.storyboardTracks]);

  const { flatPanels, flatScenes } = useMemo(
    () => (project ? buildStoryboardTimeline(project) : { flatPanels: [] as FlatPanelLayout[], flatScenes: [], totalDuration: 0 }),
    [project],
  );

  flatPanelsRef.current = flatPanels;

  const maxAudioEnd = useMemo(() => (project ? maxAudioTimelineEnd(project) : 0), [project]);
  const maxVideoEnd = useMemo(() => (project ? maxVideoTimelineEnd(project) : 0), [project]);
  const maxStoryboardEnd = useMemo(() => (project ? maxStoryboardTrackTimelineEnd(project) : 0), [project]);
  const timelineDuration = Math.max(maxAudioEnd, maxVideoEnd, maxStoryboardEnd, 8);
  const timelineWidthPx = Math.max(timelineDuration * pxPerSec, 400);
  const playheadPx = currentTime * pxPerSec;

  const audioBlockHeight = Math.max(1, audioTracks.length) * AUDIO_ROW_H;
  const videoBlockHeight = showVideoTrack ? Math.max(1, videoTracks.length) * VIDEO_ROW_H : 0;
  const storyboardBlockHeight = Math.max(1, storyboardTracksSorted.length) * STORYBOARD_ROW_H;

  const playheadTotalHeight =
    RULER_H +
    SCENE_STRIP_H +
    videoBlockHeight +
    (showCameraTrack ? KF_TRACK_H : 0) +
    META_H +
    storyboardBlockHeight +
    (showLayerTrack ? KF_TRACK_H : 0) +
    audioBlockHeight;

  const { syncAudioToTime } = useTimelinePlayback({
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    timelineDuration,
    tracks: audioTracks,
    videoTracks,
    loop: loopPlayback,
    enabled: !!project?.timeline,
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
    if (playheadFocusPanelId !== activePanelId) {
      setActivePanelId(playheadFocusPanelId);
    }
  }, [isPlaying, playheadFocusPanelId, activePanelId, setActivePanelId]);

  useEffect(() => {
    const r = scrollRef.current;
    const l = leftColScrollRef.current;
    if (!r || !l) return;
    const syncFromRight = () => {
      if (scrollSyncLock.current) return;
      if (l.scrollTop === r.scrollTop) return;
      scrollSyncLock.current = true;
      l.scrollTop = r.scrollTop;
      scrollSyncLock.current = false;
    };
    const syncFromLeft = () => {
      if (scrollSyncLock.current) return;
      if (r.scrollTop === l.scrollTop) return;
      scrollSyncLock.current = true;
      r.scrollTop = l.scrollTop;
      scrollSyncLock.current = false;
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
      if (sorted[i]!.startSec <= currentTime) {
        hit = sorted[i];
        break;
      }
    }
    return hit?.name ?? sorted[0]?.name ?? '-';
  }, [project, currentTime]);

  const snapEdges = useMemo(() => {
    const audioEdges: number[] = [];
    audioTracks.forEach((tr) => {
      tr.clips.forEach((c) => {
        audioEdges.push(c.startTimeSec, c.startTimeSec + c.durationSec);
      });
    });
    if (!project) return [0, timelineDuration];
    return collectTimelineSnapEdges(project, flatPanels, audioEdges);
  }, [project, flatPanels, audioTracks, videoTracks, timelineDuration]);

  // INCREASED SNAP THRESHOLD FOR BETTER UX
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

  useEffect(() => {
    const clear = () => setSbDnDHighlightTrackId(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  const handleStoryboardRowPanelDragOver = useCallback((e: React.DragEvent, tr: TimelineStoryboardTrack) => {
    if (!dataTransferLooksLikeScriptboardPanel(e.dataTransfer)) return;
    if (tr.locked) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      setSbDnDHighlightTrackId(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setSbDnDHighlightTrackId(tr.id);
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

      // DEFER STATE MUTATION: Solves the React/HTML5 "sticky drop" bug
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

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d?.kind === 'clip-slip') {
        const dx = (e.clientX - d.startX) / pxPerSec;
        const trim = d.origTrim + dx;
        if (d.trackKind === 'video') {
          slipTimelineVideoClipToTrim(d.trackIndex, d.clipId, trim);
        } else {
          slipTimelineAudioClipToTrim(d.trackIndex, d.clipId, trim);
        }
        return;
      }
      if (d?.kind === 'clip-move') {
        const dx = (e.clientX - d.startX) / pxPerSec;
        const t = snapTime(Math.max(0, d.origStart + dx));
        if (d.trackKind === 'video') {
          moveTimelineVideoClip(d.trackIndex, d.clipId, t);
        } else {
          moveTimelineAudioClip(d.trackIndex, d.clipId, t);
        }
        return;
      }
      if (d?.kind === 'clip-resize') {
        const dx = (e.clientX - d.startX) / pxPerSec;
        const tLine = d.edge === 'right' ? d.origStart + d.origDur + dx : d.origStart + dx;
        if (d.trackKind === 'video') {
          resizeTimelineVideoClip(d.trackIndex, d.clipId, d.edge, tLine);
        } else {
          resizeTimelineAudioClip(d.trackIndex, d.clipId, d.edge, tLine);
        }
        return;
      }
      if (d?.kind === 'cam-kf-move') {
        const dx = (e.clientX - d.startX) / pxPerSec;
        moveTimelineCameraKeyframe(d.id, snapTime(Math.max(0, d.origT + dx)));
        return;
      }
      if (d?.kind === 'layer-kf-move') {
        const dx = (e.clientX - d.startX) / pxPerSec;
        moveTimelineLayerKeyframe(d.id, snapTime(Math.max(0, d.origT + dx)));
        return;
      }
      if (d?.kind === 'sb-clip-move') {
        const dx = (e.clientX - d.startX) / pxPerSec;
        moveStoryboardClip(d.trackId, d.clipId, snapTime(Math.max(0, d.origStart + dx)));
        return;
      }
      if (d?.kind === 'sb-clip-resize') {
        const dx = (e.clientX - d.startX) / pxPerSec;
        const tLine = d.edge === 'right' ? d.origStart + d.origDur + dx : d.origStart + dx;
        resizeStoryboardClip(d.trackId, d.clipId, d.edge, tLine);
        return;
      }

      if (!draggingPlayhead.current || !scrollRef.current) return;
      const el = scrollRef.current;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft;
      let t = x / pxPerSec;
      t = snapTime(Math.max(0, Math.min(t, timelineDuration)));
      setCurrentTime(t);
      syncAudioRef.current(t, audioScrubbing);
      const pSt = useProjectStore.getState().project;
      const top = pSt ? getTopStoryboardPanelIdAtTime(pSt, t) : null;
      const fp = flatPanelsRef.current.find((x) => t >= x.startTime && t < x.endTime);
      const id = top ?? fp?.id;
      if (id) setActivePanelId(id);
    };

    const onUp = (e: PointerEvent) => {
      // AAA FIX: Explicitly release capture before cleaning up state
      if (e.target instanceof Element) {
        try {
          e.target.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }

      draggingPlayhead.current = false;
      dragRef.current = null;
      if (!isPlaying) syncAudioRef.current(currentTimeRef.current, false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { capture: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp, { capture: true });
    };
  }, [
    pxPerSec,
    timelineDuration,
    snapTime,
    setActivePanelId,
    audioScrubbing,
    moveTimelineAudioClip,
    moveTimelineVideoClip,
    resizeTimelineAudioClip,
    resizeTimelineVideoClip,
    slipTimelineAudioClipToTrim,
    slipTimelineVideoClipToTrim,
    moveTimelineCameraKeyframe,
    moveTimelineLayerKeyframe,
    moveStoryboardClip,
    resizeStoryboardClip,
    isPlaying,
  ]);

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

  const trackHeaderBtn = 'p-0.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800';
  const transportBtn =
    'rounded p-1.5 text-neutral-300 transition-colors hover:bg-neutral-700 disabled:pointer-events-none disabled:opacity-40';

  const handlePlayPause = () => setIsPlaying((p) => !p);

  const handleImportAudio = async () => {
    if (!window.ipcRenderer || !project?.timeline) return;
    try {
      const res: IpcResponse<{ dataUri: string; fileName: string }> = await window.ipcRenderer.invoke(
        IPC_CHANNELS.AUDIO_IMPORT,
      );
      if (!res.success || !res.data) return;
      const buf = await decodeAudioFromDataUri(res.data.dataUri);
      const full = buf.duration;
      const peaks = downsamplePeaks(buf, 600);
      const clip: TimelineAudioClip = {
        id: crypto.randomUUID(),
        name: res.data.fileName,
        startTimeSec: snapTime(currentTime),
        durationSec: full,
        sourceTrimStartSec: 0,
        sourceDurationSec: full,
        dataUri: res.data.dataUri,
        peaks,
      };
      commitHistory();
      addTimelineAudioClip(importTrackIndex, clip);
    } catch (err) {
      console.error('Failed to import audio:', err);
    }
  };

  const handleImportVideo = async () => {
    if (!window.ipcRenderer || !project?.timeline || !showVideoTrack) return;
    try {
      const res: IpcResponse<{ dataUri: string; fileName: string }> = await window.ipcRenderer.invoke(
        IPC_CHANNELS.VIDEO_IMPORT,
      );
      if (!res.success || !res.data) return;
      const full = await probeVideoDurationFromDataUri(res.data.dataUri);
      const playable = Math.max(0.05, full || 5);
      const clip: TimelineVideoClip = {
        id: crypto.randomUUID(),
        name: res.data.fileName,
        startTimeSec: snapTime(currentTime),
        durationSec: playable,
        sourceTrimStartSec: 0,
        sourceDurationSec: playable,
        dataUri: res.data.dataUri,
      };
      commitHistory();
      addTimelineVideoClip(0, clip);
    } catch (err) {
      console.error('Failed to import video:', err);
    }
  };

  const handleExportAnimatic = async (format: 'mp4' | 'mov') => {
    if (!project) {
      await nativeAlert('No project loaded.');
      return;
    }
    if (!window.ipcRenderer) {
      await nativeAlert('Video export is not available in this environment. Use the installed ScriptBoard application.');
      return;
    }
    if (!hasAnyStoryboardTimelineClips(project)) {
      await nativeAlert('Place at least one panel on a storyboard timeline layer (drag from the outliner or use +) before exporting video.');
      return;
    }
    setExportingVideo(true);
    try {
      const w = project.settings.resolution?.width ?? 1920;
      const h = project.settings.resolution?.height ?? 1080;
      const safeName = (project.name || 'ScriptBoard').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120);
      const prefs = useAppStore.getState().preferences;
      const getBrushConfig = (presetId?: string) => {
        if (!presetId) return defaultBrushes['solid'];
        const custom = prefs.customBrushes?.find((b) => b.id === presetId);
        if (custom) return custom;
        return defaultBrushes[presetId] || defaultBrushes['solid'];
      };
      const segments = await buildAnimaticSegmentsForProject(project, flatPanels, getBrushConfig);
      const audioClips = collectAnimaticExportAudioClips(project);
      const res: IpcResponse<{ filePath: string }> = await window.ipcRenderer.invoke(IPC_CHANNELS.ANIMATIC_EXPORT_VIDEO, {
        format,
        fps,
        width: w,
        height: h,
        segments,
        audioClips,
        defaultFileName: `${safeName}-animatic.${format}`,
      });
      if (res.success && res.data?.filePath) {
        await nativeAlert(`Video saved:\n${res.data.filePath}`);
      } else if (res.message && res.message !== 'Export canceled') {
        await nativeAlert(`Export failed: ${res.message}`);
      }
    } catch (err) {
      console.error(err);
      await nativeAlert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportingVideo(false);
    }
  };

  const onTimelinePointerDown = (e: React.PointerEvent, scrollEl: HTMLDivElement) => {
    if ((e.target as HTMLElement).closest('[data-no-scrub]')) return;
    const rect = scrollEl.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollEl.scrollLeft;
    let t = x / pxPerSec;
    t = snapTime(Math.max(0, Math.min(t, timelineDuration)));
    draggingPlayhead.current = true;
    seekTo(t);
  };

  if (!project?.timeline) {
    return <div className="flex h-full items-center justify-center bg-[#151515] text-neutral-500">No project loaded.</div>;
  }

  const renderAudioClip = (clip: TimelineAudioClip, trackIndex: number, locked: boolean) => {
    const w = Math.max(8, clip.durationSec * pxPerSec);
    const left = clip.startTimeSec * pxPerSec;
    const tryRemoveAudio = () => {
      if (locked) return;
      void (async () => {
        if (await nativeConfirm('Remove this sound clip from the timeline?')) {
          commitHistory();
          removeTimelineAudioClip(trackIndex, clip.id);
        }
      })();
    };
    return (
      <div
        key={clip.id}
        className="absolute top-1 flex overflow-hidden rounded border border-teal-900/80 bg-[#0d1a1f] shadow-sm"
        style={{ left, width: w, height: AUDIO_ROW_H - 8 }}
        data-no-scrub
        onContextMenu={(e) => {
          if (locked) return;
          e.preventDefault();
          e.stopPropagation();
          tryRemoveAudio();
        }}
      >
        {!locked && (
          <button
            type="button"
            data-no-scrub
            className="absolute -left-0.5 top-0 z-20 flex h-full w-2 cursor-ew-resize items-center justify-center bg-teal-900/90 hover:bg-teal-700"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              commitHistory();
              dragRef.current = {
                kind: 'clip-resize',
                trackIndex,
                clipId: clip.id,
                edge: 'left',
                startX: e.clientX,
                origStart: clip.startTimeSec,
                origDur: clip.durationSec,
              };
            }}
          />
        )}
        <div
          className="relative min-w-0 flex-1 cursor-grab active:cursor-grabbing"
          data-no-scrub
          title="Drag to move · Shift+drag: slip · Trash or right-click: remove (unlock track if needed)"
          onPointerDown={(e) => {
            if (locked) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            commitHistory();
            if (e.shiftKey) {
              dragRef.current = {
                kind: 'clip-slip',
                trackIndex,
                clipId: clip.id,
                startX: e.clientX,
                origTrim: clip.sourceTrimStartSec,
              };
            } else {
              dragRef.current = {
                kind: 'clip-move',
                trackIndex,
                clipId: clip.id,
                startX: e.clientX,
                origStart: clip.startTimeSec,
              };
            }
          }}
        >
          <ClipWaveform peaks={clip.peaks} widthPx={w - 4} heightPx={AUDIO_ROW_H - 12} />
          <div className="pointer-events-none absolute bottom-0 left-1 right-6 truncate text-[9px] text-teal-100/90">
            {clip.name}
          </div>
        </div>
        {!locked && (
          <button
            type="button"
            data-no-scrub
            className="absolute -right-0.5 top-0 z-20 flex h-full w-2 cursor-ew-resize items-center justify-center bg-teal-900/90 hover:bg-teal-700"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              commitHistory();
              dragRef.current = {
                kind: 'clip-resize',
                trackIndex,
                clipId: clip.id,
                edge: 'right',
                startX: e.clientX,
                origStart: clip.startTimeSec,
                origDur: clip.durationSec,
              };
            }}
          />
        )}
        {!locked && (
          <button
            type="button"
            data-no-scrub
            className="absolute right-0.5 top-0.5 z-30 rounded bg-black/50 p-1 text-neutral-300 shadow-sm hover:bg-red-900/90 hover:text-white"
            title="Remove clip from timeline"
            onClick={(e) => {
              e.stopPropagation();
              tryRemoveAudio();
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    );
  };

  const renderVideoClip = (clip: TimelineVideoClip, trackIndex: number, locked: boolean) => {
    const w = Math.max(8, clip.durationSec * pxPerSec);
    const left = clip.startTimeSec * pxPerSec;
    const tryRemoveVideo = () => {
      if (locked) return;
      void (async () => {
        if (await nativeConfirm('Remove this video clip from the timeline?')) {
          commitHistory();
          removeTimelineVideoClip(trackIndex, clip.id);
        }
      })();
    };
    return (
      <div
        key={clip.id}
        className="absolute top-1 flex overflow-hidden rounded border border-rose-900/80 bg-[#1a0f14] shadow-sm"
        style={{ left, width: w, height: VIDEO_ROW_H - 8 }}
        data-no-scrub
        onContextMenu={(e) => {
          if (locked) return;
          e.preventDefault();
          e.stopPropagation();
          tryRemoveVideo();
        }}
      >
        {!locked && (
          <button
            type="button"
            data-no-scrub
            className="absolute -left-0.5 top-0 z-20 flex h-full w-2 cursor-ew-resize items-center justify-center bg-rose-900/90 hover:bg-rose-700"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              commitHistory();
              dragRef.current = {
                kind: 'clip-resize',
                trackKind: 'video',
                trackIndex,
                clipId: clip.id,
                edge: 'left',
                startX: e.clientX,
                origStart: clip.startTimeSec,
                origDur: clip.durationSec,
              };
            }}
          />
        )}
        <div
          className="relative min-w-0 flex-1 cursor-grab active:cursor-grabbing"
          data-no-scrub
          title="Drag to move · Shift+drag: slip · Trash or right-click: remove (unlock track if needed)"
          onPointerDown={(e) => {
            if (locked) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            commitHistory();
            if (e.shiftKey) {
              dragRef.current = {
                kind: 'clip-slip',
                trackKind: 'video',
                trackIndex,
                clipId: clip.id,
                startX: e.clientX,
                origTrim: clip.sourceTrimStartSec,
              };
            } else {
              dragRef.current = {
                kind: 'clip-move',
                trackKind: 'video',
                trackIndex,
                clipId: clip.id,
                startX: e.clientX,
                origStart: clip.startTimeSec,
              };
            }
          }}
        >
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-br from-rose-950/90 to-neutral-950">
            <Film size={22} className="text-rose-400/40" />
          </div>
          <div className="pointer-events-none absolute bottom-0.5 left-1 right-6 truncate text-[9px] text-rose-100/85">
            {clip.name}
          </div>
        </div>
        {!locked && (
          <button
            type="button"
            data-no-scrub
            className="absolute -right-0.5 top-0 z-20 flex h-full w-2 cursor-ew-resize items-center justify-center bg-rose-900/90 hover:bg-rose-700"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              commitHistory();
              dragRef.current = {
                kind: 'clip-resize',
                trackKind: 'video',
                trackIndex,
                clipId: clip.id,
                edge: 'right',
                startX: e.clientX,
                origStart: clip.startTimeSec,
                origDur: clip.durationSec,
              };
            }}
          />
        )}
        {!locked && (
          <button
            type="button"
            data-no-scrub
            className="absolute right-0.5 top-0.5 z-30 rounded bg-black/50 p-1 text-neutral-300 shadow-sm hover:bg-red-900/90 hover:text-white"
            title="Remove clip from timeline"
            onClick={(e) => {
              e.stopPropagation();
              tryRemoveVideo();
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col border-t border-black bg-[#1a1a1a] text-neutral-300 select-none">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-black bg-[#252525] px-3 py-2">
        <div className="flex items-center gap-0.5 rounded-md border border-neutral-600 bg-[#1e1e1e] p-0.5">
          <button
            type="button"
            className={transportBtn}
            title="Go to start"
            onClick={() => {
              setIsPlaying(false);
              seekTo(0);
            }}
          >
            <ChevronsLeft size={18} />
          </button>
          <button
            type="button"
            className={transportBtn}
            title={`Back ${SKIP_SECONDS}s`}
            onClick={() => {
              setIsPlaying(false);
              seekTo(snapTime(Math.max(0, currentTime - SKIP_SECONDS)));
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={handlePlayPause}
            className="rounded bg-blue-600 p-1.5 text-white transition-colors hover:bg-blue-500"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            className={transportBtn}
            title={`Forward ${SKIP_SECONDS}s`}
            onClick={() => {
              setIsPlaying(false);
              seekTo(snapTime(Math.min(timelineDuration, currentTime + SKIP_SECONDS)));
            }}
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            className={transportBtn}
            title="Go to end"
            onClick={() => {
              setIsPlaying(false);
              seekTo(timelineDuration);
            }}
          >
            <ChevronsRight size={18} />
          </button>
          <div className="mx-0.5 w-px self-stretch bg-neutral-600" />
          <button
            type="button"
            className={`${transportBtn} ${loopPlayback ? 'bg-amber-900/70 text-amber-100' : ''}`}
            title={loopPlayback ? 'Loop playback (on)' : 'Loop playback (off)'}
            onClick={() => setLoopPlayback((v) => !v)}
          >
            <Repeat size={18} />
          </button>
        </div>

        <div className="flex flex-col leading-tight">
          <span className="font-mono text-lg font-semibold tracking-tight text-sky-300">
            {formatTimecode(currentTime, fps)}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">Current timecode</span>
        </div>

        <div className="h-8 w-px bg-neutral-600" />

        <div className="flex flex-col leading-tight">
          <span className="font-mono text-sm text-neutral-400">{formatTimecode(timelineDuration, fps)}</span>
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">Project length</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-neutral-500">
            Track
            <select
              value={importTrackIndex}
              onChange={(e) => setImportTrackIndex(Number(e.target.value))}
              className="rounded border border-neutral-700 bg-[#333] px-1 py-0.5 text-neutral-200"
            >
              {audioTracks.map((_, i) => (
                <option key={i} value={i}>
                  A{i + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleImportAudio}
            className="flex items-center gap-1.5 rounded bg-[#333] px-3 py-1 text-sm transition-colors hover:bg-[#444]"
          >
            <Import size={14} /> Import audio
          </button>
          {showVideoTrack && (
            <button
              type="button"
              onClick={handleImportVideo}
              className="flex items-center gap-1.5 rounded bg-[#333] px-3 py-1 text-sm transition-colors hover:bg-[#444]"
              title="Import onto video track V1"
            >
              <Video size={14} /> Import video
            </button>
          )}
          <div className="hidden h-6 w-px bg-neutral-600 sm:block" />
          <span className="hidden text-[10px] text-neutral-500 sm:inline">Export animatic</span>
          <button
            type="button"
            disabled={exportingVideo || !hasAnyStoryboardTimelineClips(project)}
            onClick={() => void handleExportAnimatic('mp4')}
            className="flex items-center gap-1.5 rounded bg-[#333] px-2 py-1 text-xs transition-colors hover:bg-[#444] disabled:opacity-40"
            title="Export timeline as MP4 (panels at project framerate + timeline audio)."
          >
            {exportingVideo ? <Loader2 size={14} className="animate-spin" /> : <FileVideo size={14} />}
            MP4
          </button>
          <button
            type="button"
            disabled={exportingVideo || !hasAnyStoryboardTimelineClips(project)}
            onClick={() => void handleExportAnimatic('mov')}
            className="flex items-center gap-1.5 rounded bg-[#333] px-2 py-1 text-xs transition-colors hover:bg-[#444] disabled:opacity-40"
            title="Export timeline as MOV (panels at project framerate + timeline audio)."
          >
            {exportingVideo ? <Loader2 size={14} className="animate-spin" /> : <FileVideo size={14} />}
            MOV
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={leftColScrollRef}
          className="flex min-h-0 shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-black bg-[#222]"
          style={{ width: HEADER_W }}
        >
          <div className="flex flex-col" style={{ minHeight: playheadTotalHeight }}>
          <div className="flex items-center border-b border-black px-2 text-[10px] text-neutral-500" style={{ height: RULER_H }}>
            Time
          </div>
          <div
            className="flex items-center border-b border-black px-2 text-[10px] font-medium leading-tight text-neutral-400"
            style={{ height: SCENE_STRIP_H }}
          >
            <span className="line-clamp-2">Sequences / scenes</span>
          </div>

          {showVideoTrack &&
            videoTracks.map((tr, i) => (
              <div
                key={tr.id}
                className="flex items-center justify-between border-b border-black px-2 py-1 text-[10px]"
                style={{ height: VIDEO_ROW_H }}
              >
                <span className="flex items-center gap-1 font-medium text-neutral-300">
                  <Video size={12} /> V{i + 1}
                </span>
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    className={trackHeaderBtn}
                    title={tr.muted ? 'Unmute video audio' : 'Mute video audio'}
                    onClick={() => {
                      commitHistory();
                      setTimelineVideoTrackMuted(i, !tr.muted);
                    }}
                  >
                    {tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  </button>
                  <span className="flex w-4 items-center justify-center opacity-40" title={tr.locked ? 'Locked' : ''}>
                    <Lock size={12} />
                  </span>
                </div>
              </div>
            ))}

          {showCameraTrack && (
            <div className="flex items-center justify-between border-b border-black px-2 text-[10px]" style={{ height: KF_TRACK_H }}>
              <span className="flex items-center gap-1 font-medium text-neutral-300">
                <Camera size={12} /> Camera
              </span>
              <button
                type="button"
                className={`${trackHeaderBtn} text-sky-400`}
                title="Add camera keyframe at playhead"
                onClick={() => {
                  commitHistory();
                  addTimelineCameraKeyframe(snapTime(currentTime));
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          )}

          <div
            className="flex flex-col justify-center gap-0.5 border-b border-black px-2 py-1 text-[10px] leading-tight text-sky-400"
            style={{ height: META_H, minHeight: META_H }}
          >
            <div className="truncate text-neutral-500" title={activeSequenceName}>
              Seq. <span className="text-sky-200">{activeSequenceName}</span>
            </div>
            <div className="text-neutral-500">
              Scene <span className="text-sky-200">{activeMetaSummary?.sceneIndex ?? '-'}</span>
              <span className="mx-1 text-neutral-600">·</span>
              Panel <span className="text-sky-200">{activeMetaSummary?.panelIndexInScene ?? '-'}</span>
            </div>
          </div>

          {storyboardTracksSorted.map((tr) => (
            <div
              key={tr.id}
              className="flex items-center justify-between gap-0.5 border-b border-black px-1 py-0.5 text-[10px] font-medium text-neutral-300"
              style={{ height: STORYBOARD_ROW_H }}
            >
              <span className="flex min-w-0 flex-1 items-center gap-0.5 truncate" title={tr.name}>
                <Layers2 size={11} className="mr-0.5 shrink-0 opacity-70" />
                <span className="truncate">{tr.order === 0 ? 'Primary' : tr.name}</span>
              </span>
              <div className="flex shrink-0 gap-0.5">
                {tr.order === 0 ? (
                  <button
                    type="button"
                    className={trackHeaderBtn}
                    title="Add storyboard layer"
                    onClick={() => {
                      commitHistory();
                      addStoryboardTrack();
                    }}
                  >
                    <Plus size={12} />
                  </button>
                ) : null}
                {tr.order !== 0 && storyboardTracksSorted.length > 1 ? (
                  <button
                    type="button"
                    className={trackHeaderBtn}
                    title="Remove this layer"
                    onClick={() => {
                      void (async () => {
                        if (await nativeConfirm('Remove this storyboard layer and its clips?')) {
                          commitHistory();
                          removeStoryboardTrack(tr.id);
                        }
                      })();
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={trackHeaderBtn}
                  title={tr.muted ? 'Unmute layer' : 'Mute layer'}
                  onClick={() => {
                    commitHistory();
                    setStoryboardTrackMuted(tr.id, !tr.muted);
                  }}
                >
                  {tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
                <button
                  type="button"
                  className={`${trackHeaderBtn} text-sky-400`}
                  disabled={!activePanelId || tr.locked}
                  title={
                    activePanelId
                      ? 'Place active panel at playhead — or drag a panel from the outliner onto this row'
                      : 'Select a panel first, or drag from the outliner onto this row'
                  }
                  onClick={() => {
                    if (!activePanelId || !project) return;
                    commitHistory();
                    const dur = panelDefaultClipDurationSec(project, activePanelId);
                    const fpanel = flatPanels.find((p) => p.id === activePanelId);
                    addStoryboardClip(tr.id, {
                      name: fpanel?.name ?? 'Clip',
                      panelId: activePanelId,
                      startTimeSec: snapTime(currentTime),
                      durationSec: dur,
                    });
                  }}
                >
                  <Plus size={12} />
                </button>
                <span className="flex w-4 items-center justify-center opacity-40" title={tr.locked ? 'Locked' : ''}>
                  <Lock size={11} />
                </span>
              </div>
            </div>
          ))}

          {showLayerTrack && (
            <div className="flex items-center justify-between border-b border-black px-2 text-[10px]" style={{ height: KF_TRACK_H }}>
              <span className="truncate text-neutral-400" title={activeLayerName}>
                L: {activeLayerName}
              </span>
              <button
                type="button"
                disabled={!activePanelId || !activeLayerId}
                className={`${trackHeaderBtn} text-emerald-400 disabled:opacity-30`}
                title={
                  activePanelId && activeLayerId
                    ? 'Add layer keyframe at playhead (active layer)'
                    : 'Select a panel and layer in the canvas'
                }
                onClick={() => {
                  if (!activePanelId || !activeLayerId) return;
                  commitHistory();
                  addTimelineLayerKeyframe(snapTime(currentTime), activePanelId, activeLayerId);
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          )}

          {audioTracks.map((tr, i) => (
            <div
              key={tr.id}
              className="flex items-center justify-between border-b border-black px-2 py-1 text-[10px]"
              style={{ height: AUDIO_ROW_H }}
            >
              <span className="font-medium text-neutral-300">A{i + 1}</span>
              <div className="flex gap-0.5">
                <button
                  type="button"
                  className={trackHeaderBtn}
                  title={tr.muted ? 'Unmute' : 'Mute'}
                  onClick={() => {
                    commitHistory();
                    setTimelineTrackMuted(i, !tr.muted);
                  }}
                >
                  {tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
                <button
                  type="button"
                  className={`${trackHeaderBtn} ${tr.solo ? 'text-amber-300' : ''}`}
                  title="Solo"
                  onClick={() => {
                    commitHistory();
                    setTimelineTrackSolo(i, !tr.solo);
                  }}
                >
                  <span className="text-[9px] font-bold">S</span>
                </button>
                <span className="flex w-4 items-center justify-center opacity-40" title={tr.locked ? 'Locked' : ''}>
                  <Lock size={12} />
                </span>
              </div>
            </div>
          ))}
          </div>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-[#1e1e1e]"
          onPointerDown={(e) => {
            if (scrollRef.current && (e.target as HTMLElement).closest('[data-timeline-surface]')) {
              onTimelinePointerDown(e, scrollRef.current);
            }
          }}
        >
          <div className="relative" style={{ width: timelineWidthPx, minHeight: playheadTotalHeight }}>
            <div
              className="pointer-events-none absolute top-0 z-30 w-px bg-red-500"
              style={{ left: playheadPx, height: playheadTotalHeight }}
            >
              <div className="absolute -top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent border-t-red-500" />
            </div>

            <div
              data-timeline-surface
              className="relative cursor-crosshair border-b border-neutral-800 bg-[#2a2a2a]"
              style={{ height: RULER_H }}
            >
              {rulerTicks.map((tk, i) => (
                <div
                  key={i}
                  className={`absolute bottom-0 border-l ${tk.major ? 'h-3 border-neutral-500' : 'h-1.5 border-neutral-600'}`}
                  style={{ left: tk.x }}
                />
              ))}
              {rulerTicks
                .filter((t) => t.label)
                .map((tk, i) => (
                  <span key={`l-${i}`} className="absolute top-1 text-[9px] text-neutral-500" style={{ left: tk.x + 2 }}>
                    {tk.label}
                  </span>
                ))}
              {project.timeline.sequences.map((s) => (
                <div
                  key={s.id}
                  className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-purple-400/95 shadow-[0_0_6px_rgba(192,132,252,0.5)]"
                  style={{ left: s.startSec * pxPerSec }}
                  title={s.name}
                />
              ))}
              {project.timeline.acts.map((a) => (
                <div
                  key={a.id}
                  className="pointer-events-none absolute top-0.5 z-10 h-2.5 w-2.5 rotate-45 border border-amber-700 bg-amber-500 shadow-sm"
                  style={{ left: a.startSec * pxPerSec - 5 }}
                  title={a.name}
                />
              ))}
            </div>

            <div
              data-timeline-surface
              className="relative border-b border-neutral-800 bg-[#1e1e1e]"
              style={{ height: SCENE_STRIP_H }}
            >
              <div
                className="absolute top-1 bottom-1 rounded-sm bg-violet-900/80"
                style={{ left: 0, width: Math.max(timelineWidthPx, 8) }}
              />
              {flatScenes.map((fs) => (
                <div
                  key={fs.scene.id}
                  className="absolute top-1 bottom-1 rounded border border-violet-500/40 bg-violet-950/50"
                  style={{
                    left: fs.startTime * pxPerSec,
                    width: Math.max((fs.endTime - fs.startTime) * pxPerSec, 4),
                  }}
                  title={fs.scene.name}
                />
              ))}
            </div>

            {showVideoTrack &&
              videoTracks.map((tr, vi) => (
                <div
                  key={tr.id}
                  data-timeline-surface
                  className="relative border-b border-neutral-900 bg-[#1a1520]"
                  style={{ width: timelineWidthPx, height: VIDEO_ROW_H }}
                >
                  {tr.clips.map((c) => renderVideoClip(c, vi, tr.locked))}
                </div>
              ))}

            {showCameraTrack && (
              <div
                data-timeline-surface
                className="relative border-b border-neutral-800 bg-[#1e2428]"
                style={{ width: timelineWidthPx, height: KF_TRACK_H }}
              >
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-700/80" />
                {project.timeline.cameraKeyframes.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    data-no-scrub
                    className="absolute top-1/2 z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-sky-500 bg-sky-600 shadow hover:border-sky-300 hover:bg-sky-500"
                    style={{ left: k.timeSec * pxPerSec }}
                    title="Camera - drag to move · Alt+click to delete"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      if (e.altKey) {
                        void (async () => {
                          if (await nativeConfirm('Remove this camera keyframe?')) {
                            commitHistory();
                            removeTimelineCameraKeyframe(k.id);
                          }
                        })();
                        return;
                      }
                      commitHistory();
                      dragRef.current = {
                        kind: 'cam-kf-move',
                        id: k.id,
                        startX: e.clientX,
                        origT: k.timeSec,
                      };
                    }}
                  />
                ))}
              </div>
            )}

            <div style={{ height: META_H }} className="border-b border-neutral-800 bg-[#222]" />

            {storyboardTracksSorted.map((tr) => (
              <div
                key={tr.id}
                data-timeline-surface
                className={`relative border-b border-neutral-800 bg-[#222] ${
                  sbDnDHighlightTrackId === tr.id && !tr.locked ? 'ring-2 ring-inset ring-cyan-400/80 bg-cyan-950/30' : ''
                }`}
                style={{ width: timelineWidthPx, height: STORYBOARD_ROW_H }}
                onDragEnter={(e) => {
                  if (!dataTransferLooksLikeScriptboardPanel(e.dataTransfer)) return;
                  if (tr.locked) return;
                  e.preventDefault();
                }}
                onDragOver={(e) => handleStoryboardRowPanelDragOver(e, tr)}
                onDrop={(e) => handleStoryboardRowPanelDrop(e, tr)}
              >
                {tr.clips.map((clip) => {
                  const w = Math.max(8, clip.durationSec * pxPerSec);
                  const left = clip.startTimeSec * pxPerSec;
                  const vis = resolveStoryboardClipVisuals(project, flatPanels, clip.panelId);
                  const isActive = activePanelId === clip.panelId;
                  const tryRemoveStoryboardClip = () => {
                    if (tr.locked) return;
                    void (async () => {
                      if (
                        await nativeConfirm(
                          'Remove panel from timeline? (Does not remove from Scene)',
                        )
                      ) {
                        commitHistory();
                        removeStoryboardClip(tr.id, clip.id);
                      }
                    })();
                  };
                  return (
                    <div
                      key={clip.id}
                      className="absolute top-1 flex overflow-hidden rounded border border-cyan-900/70 bg-[#102428] shadow-sm"
                      style={{ left, width: w, height: STORYBOARD_ROW_H - 8 }}
                      data-no-scrub
                      onContextMenu={(e) => {
                        if (tr.locked) return;
                        e.preventDefault();
                        e.stopPropagation();
                        tryRemoveStoryboardClip();
                      }}
                    >
                      {!tr.locked && (
                        <button
                          type="button"
                          data-no-scrub
                          className="absolute -left-0.5 top-0 z-20 flex h-full w-2 cursor-ew-resize items-center justify-center bg-cyan-950/90 hover:bg-cyan-800"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            commitHistory();
                            dragRef.current = {
                              kind: 'sb-clip-resize',
                              trackId: tr.id,
                              clipId: clip.id,
                              edge: 'left',
                              startX: e.clientX,
                              origStart: clip.startTimeSec,
                              origDur: clip.durationSec,
                            };
                          }}
                        />
                      )}
                      <button
                        type="button"
                        className={`relative h-full min-w-0 min-h-0 flex-1 cursor-grab overflow-hidden text-left active:cursor-grabbing ${
                          isActive ? 'ring-2 ring-inset ring-red-500/70' : ''
                        }`}
                        data-no-scrub
                        title="Drag to move - Click to select panel & seek"
                        onPointerDown={(e) => {
                          if (tr.locked) return;
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          commitHistory();
                          dragRef.current = {
                            kind: 'sb-clip-move',
                            trackId: tr.id,
                            clipId: clip.id,
                            startX: e.clientX,
                            origStart: clip.startTimeSec,
                          };
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          seekTo(clip.startTimeSec);
                          setActivePanelId(clip.panelId);
                        }}
                      >
                        <div className="pointer-events-none absolute left-0.5 top-0.5 z-10 max-w-[80%] truncate rounded bg-black/60 px-1 text-[9px]">
                          {vis.name}
                        </div>
                        {vis.thumb ? (
                          <img src={vis.thumb} alt="" className="h-full w-full object-cover opacity-75" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-neutral-800 text-neutral-600">
                            <Layers2 size={16} />
                          </div>
                        )}
                      </button>
                      {!tr.locked && (
                        <button
                          type="button"
                          data-no-scrub
                          className="absolute -right-0.5 top-0 z-20 flex h-full w-2 cursor-ew-resize items-center justify-center bg-cyan-950/90 hover:bg-cyan-800"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            commitHistory();
                            dragRef.current = {
                              kind: 'sb-clip-resize',
                              trackId: tr.id,
                              clipId: clip.id,
                              edge: 'right',
                              startX: e.clientX,
                              origStart: clip.startTimeSec,
                              origDur: clip.durationSec,
                            };
                          }}
                        />
                      )}
                      {!tr.locked && (
                        <button
                          type="button"
                          data-no-scrub
                          className="absolute right-0.5 top-0.5 z-30 rounded bg-black/50 p-1 text-neutral-300 shadow-sm hover:bg-red-900/90 hover:text-white"
                          title="Remove panel clip from timeline (panel remains in outliner)"
                          onClick={(e) => {
                            e.stopPropagation();
                            tryRemoveStoryboardClip();
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {showLayerTrack && (
              <div
                data-timeline-surface
                className="relative border-b border-neutral-800 bg-[#151c18]"
                style={{ width: timelineWidthPx, height: KF_TRACK_H }}
              >
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-700/80" />
                {project.timeline.layerKeyframes
                  .filter((k) => k.panelId === activePanelId && k.layerId === activeLayerId)
                  .map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      data-no-scrub
                      className="absolute top-1/2 z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-emerald-500 bg-emerald-700 shadow hover:border-emerald-300 hover:bg-emerald-600"
                      style={{ left: k.timeSec * pxPerSec }}
                      title="Layer - drag to move · Alt+click to delete"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        if (e.altKey) {
                          void (async () => {
                            if (await nativeConfirm('Remove this layer keyframe?')) {
                              commitHistory();
                              removeTimelineLayerKeyframe(k.id);
                            }
                          })();
                          return;
                        }
                        commitHistory();
                        dragRef.current = {
                          kind: 'layer-kf-move',
                          id: k.id,
                          startX: e.clientX,
                          origT: k.timeSec,
                        };
                      }}
                    />
                  ))}
              </div>
            )}

            {audioTracks.map((tr, ti) => (
              <div
                key={tr.id}
                className="relative border-b border-neutral-900 bg-[#161c20]"
                style={{ width: timelineWidthPx, height: AUDIO_ROW_H }}
              >
                {tr.clips.map((c) => renderAudioClip(c, ti, tr.locked))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-black bg-[#252525] px-2 py-1.5">
        <button
          type="button"
          onClick={() => setAudioScrubbing((v) => !v)}
          className={`rounded p-1.5 ${audioScrubbing ? 'bg-teal-900 text-teal-200' : 'text-neutral-500 hover:bg-neutral-800'}`}
          title="Audio scrubbing while dragging playhead"
        >
          <AudioWaveform size={16} />
        </button>
        <button
          type="button"
          onClick={() => setSnapping((v) => !v)}
          className={`rounded p-1.5 ${snapping ? 'bg-amber-900/80 text-amber-200' : 'text-neutral-500 hover:bg-neutral-800'}`}
          title="Snap to panel / clip edges"
        >
          <Magnet size={16} />
        </button>
        <button
          type="button"
          onClick={() => {
            commitHistory();
            setTimelineOverwriteClips(!overwriteClips);
          }}
          className={`rounded p-1.5 ${overwriteClips ? 'bg-orange-900/80 text-orange-200' : 'text-neutral-500 hover:bg-neutral-800'}`}
          title="Overwrite: moving a clip cuts overlapping audio on the same track"
        >
          <SquareStack size={16} />
        </button>
        <button
          type="button"
          onClick={() => {
            commitHistory();
            setAnimaticEditingMode(!animaticMode);
          }}
          className={`rounded p-1.5 ${animaticMode ? 'bg-purple-900/80 text-purple-200' : 'text-neutral-500 hover:bg-neutral-800'}`}
          title="Animatic: gaps, panel move/head trim, and stored start times. Off = ripple (sequential) layout."
        >
          <Clapperboard size={16} />
        </button>
        <button
          type="button"
          onClick={() => {
            commitHistory();
            addTimelineActAt(currentTime);
          }}
          className="rounded px-2 py-1 text-[10px] font-medium text-amber-200/90 hover:bg-amber-950/80"
          title="Add act marker at playhead (ruler)"
        >
          Act+
        </button>
        <button
          type="button"
          onClick={() => {
            commitHistory();
            addTimelineSequenceAt(currentTime);
          }}
          className="rounded px-2 py-1 text-[10px] font-medium text-purple-200/90 hover:bg-purple-950/80"
          title="Add sequence marker at playhead (ruler)"
        >
          Seq+
        </button>

        <div className="relative ml-2">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <>
              <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close" onClick={() => setMenuOpen(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] rounded border border-neutral-700 bg-[#2d2d2d] py-1 text-xs shadow-lg">
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
                  <input type="checkbox" checked={showCameraTrack} onChange={(e) => setShowCameraTrack(e.target.checked)} />
                  Camera keyframes
                </label>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
                  <input type="checkbox" checked={showLayerTrack} onChange={(e) => setShowLayerTrack(e.target.checked)} />
                  Layer keyframes (active layer)
                </label>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
                  <input type="checkbox" checked={showVideoTrack} onChange={(e) => setShowVideoTrack(e.target.checked)} />
                  Show video track (V1)
                </label>
                <div className="border-t border-neutral-700 px-3 py-2 text-[10px] leading-relaxed text-neutral-400">
                  <span className="font-semibold text-neutral-300">Removing clips</span>
                  <p className="mt-1">
                    Use the trash button on a clip, or <span className="text-neutral-300">right-click</span> the clip. If
                    you do not see trash, unlock the track in the left column. Storyboard clips only remove the timeline
                    instance; panels remain in the outliner.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPxPerSec(DEFAULT_PX_PER_SEC)}
            className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800"
            title="Reset zoom"
          >
            <ZoomIn size={16} />
          </button>
          <Film size={14} className="text-neutral-600" />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            value={pxPerSec}
            onChange={(e) => setPxPerSec(Number(e.target.value))}
            className="h-1 w-28 accent-sky-600"
          />
          <span className="w-8 text-[10px] text-neutral-500">{pxPerSec}px/s</span>
        </div>
      </div>
    </div>
  );
};