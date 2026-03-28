import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useTimelineContext, formatTimecode, SKIP_SECONDS, MIN_ZOOM, MAX_ZOOM, DEFAULT_PX_PER_SEC } from './TimelineContext';
import {
  Play, Pause, Import, ZoomIn, MoreHorizontal, SquareStack, Film,
  Clapperboard, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Repeat,
  FileVideo, Loader2, Magnet, AudioWaveform, Camera, Layers2, Video
} from 'lucide-react';
import { hasAnyStoryboardTimelineClips } from '../../lib/timelineStoryboardComposition';

const transportBtn = 'rounded p-1.5 text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-40';

export const TimelineTopBar: React.FC = () => {
  const { project } = useProjectStore();
  const {
    isPlaying, currentTime, timelineDuration, fps, loopPlayback, setLoopPlayback,
    importTrackIndex, setImportTrackIndex, audioTracks, showVideoTrack,
    exportingVideo, seekTo, snapTime, handlePlayPause, handleImportAudio, handleImportVideo, handleExportAnimatic
  } = useTimelineContext();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-black bg-[#252525] px-3 py-2">
      <div className="flex items-center gap-0.5 rounded-md border border-neutral-600 bg-[#1e1e1e] p-0.5">
        <button type="button" className={transportBtn} title="Go to start" onClick={() => { seekTo(0); }}><ChevronsLeft size={18} /></button>
        <button type="button" className={transportBtn} title={`Back ${SKIP_SECONDS}s`} onClick={() => { seekTo(snapTime(Math.max(0, currentTime - SKIP_SECONDS))); }}><ChevronLeft size={18} /></button>
        <button type="button" onClick={handlePlayPause} className="rounded bg-blue-600 p-1.5 text-white transition-colors hover:bg-blue-500" title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>{isPlaying ? <Pause size={18} /> : <Play size={18} />}</button>
        <button type="button" className={transportBtn} title={`Forward ${SKIP_SECONDS}s`} onClick={() => { seekTo(snapTime(Math.min(timelineDuration, currentTime + SKIP_SECONDS))); }}><ChevronRight size={18} /></button>
        <button type="button" className={transportBtn} title="Go to end" onClick={() => { seekTo(timelineDuration); }}><ChevronsRight size={18} /></button>
        <div className="mx-0.5 w-px self-stretch bg-neutral-600" />
        <button type="button" className={`${transportBtn} ${loopPlayback ? 'bg-amber-900/70 text-amber-100' : ''}`} title={loopPlayback ? 'Loop playback (on)' : 'Loop playback (off)'} onClick={() => setLoopPlayback((v) => !v)}><Repeat size={18} /></button>
      </div>

      <div className="flex flex-col leading-tight">
        <span className="font-mono text-lg font-semibold tracking-tight text-sky-300">{formatTimecode(currentTime, fps)}</span>
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
          <select value={importTrackIndex} onChange={(e) => setImportTrackIndex(Number(e.target.value))} className="rounded border border-neutral-700 bg-[#333] px-1 py-0.5 text-neutral-200">
            {audioTracks.map((_, i) => ( <option key={i} value={i}>A{i + 1}</option> ))}
          </select>
        </label>
        <button type="button" onClick={handleImportAudio} className="flex items-center gap-1.5 rounded bg-[#333] px-3 py-1 text-sm transition-colors hover:bg-[#444]"><Import size={14} /> Import audio</button>
        {showVideoTrack && (
          <button type="button" onClick={handleImportVideo} className="flex items-center gap-1.5 rounded bg-[#333] px-3 py-1 text-sm transition-colors hover:bg-[#444]" title="Import onto video track V1"><Video size={14} /> Import video</button>
        )}
        <div className="hidden h-6 w-px bg-neutral-600 sm:block" />
        <span className="hidden text-[10px] text-neutral-500 sm:inline">Export animatic</span>
        <button type="button" disabled={exportingVideo || !project || !hasAnyStoryboardTimelineClips(project)} onClick={() => void handleExportAnimatic('mp4')} className="flex items-center gap-1.5 rounded bg-[#333] px-2 py-1 text-xs transition-colors hover:bg-[#444] disabled:opacity-40" title="Export timeline as MP4 (panels at project framerate + timeline audio).">{exportingVideo ? <Loader2 size={14} className="animate-spin" /> : <FileVideo size={14} />} MP4</button>
        <button type="button" disabled={exportingVideo || !project || !hasAnyStoryboardTimelineClips(project)} onClick={() => void handleExportAnimatic('mov')} className="flex items-center gap-1.5 rounded bg-[#333] px-2 py-1 text-xs transition-colors hover:bg-[#444] disabled:opacity-40" title="Export timeline as MOV (panels at project framerate + timeline audio).">{exportingVideo ? <Loader2 size={14} className="animate-spin" /> : <FileVideo size={14} />} MOV</button>
      </div>
    </div>
  );
};

export const TimelineBottomBar: React.FC = () => {
  const { commitHistory, setAnimaticEditingMode, setTimelineOverwriteClips, addTimelineActAt, addTimelineSequenceAt } = useProjectStore();
  const {
    audioScrubbing, setAudioScrubbing, snapping, setSnapping, overwriteClips, animaticMode,
    currentTime, menuOpen, setMenuOpen, showCameraTrack, setShowCameraTrack,
    showLayerTrack, setShowLayerTrack, showVideoTrack, setShowVideoTrack, pxPerSec, setPxPerSec
  } = useTimelineContext();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-black bg-[#252525] px-2 py-1.5">
      <button type="button" onClick={() => setAudioScrubbing((v) => !v)} className={`rounded p-1.5 ${audioScrubbing ? 'bg-teal-900 text-teal-200' : 'text-neutral-500 hover:bg-neutral-800'}`} title="Audio scrubbing while dragging playhead"><AudioWaveform size={16} /></button>
      <button type="button" onClick={() => setSnapping((v) => !v)} className={`rounded p-1.5 ${snapping ? 'bg-amber-900/80 text-amber-200' : 'text-neutral-500 hover:bg-neutral-800'}`} title="Snap to panel / clip edges"><Magnet size={16} /></button>
      <button type="button" onClick={() => { commitHistory(); setTimelineOverwriteClips(!overwriteClips); }} className={`rounded p-1.5 ${overwriteClips ? 'bg-orange-900/80 text-orange-200' : 'text-neutral-500 hover:bg-neutral-800'}`} title="Overwrite: moving a clip cuts overlapping audio on the same track"><SquareStack size={16} /></button>
      <button type="button" onClick={() => { commitHistory(); setAnimaticEditingMode(!animaticMode); }} className={`rounded p-1.5 ${animaticMode ? 'bg-purple-900/80 text-purple-200' : 'text-neutral-500 hover:bg-neutral-800'}`} title="Animatic: gaps, panel move/head trim, and stored start times. Off = ripple (sequential) layout."><Clapperboard size={16} /></button>
      <button type="button" onClick={() => { commitHistory(); addTimelineActAt(currentTime); }} className="rounded px-2 py-1 text-[10px] font-medium text-amber-200/90 hover:bg-amber-950/80" title="Add act marker at playhead (ruler)">Act+</button>
      <button type="button" onClick={() => { commitHistory(); addTimelineSequenceAt(currentTime); }} className="rounded px-2 py-1 text-[10px] font-medium text-purple-200/90 hover:bg-purple-950/80" title="Add sequence marker at playhead (ruler)">Seq+</button>

      <div className="relative ml-2">
        <button type="button" onClick={() => setMenuOpen((o) => !o)} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800"><MoreHorizontal size={16} /></button>
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
                  Use trash button to remove the timeline instance - does not remove from outliner.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => setPxPerSec(DEFAULT_PX_PER_SEC)} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800" title="Reset zoom"><ZoomIn size={16} /></button>
        <Film size={14} className="text-neutral-600" />
        <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} value={pxPerSec} onChange={(e) => setPxPerSec(Number(e.target.value))} className="h-1 w-28 accent-sky-600" />
        <span className="w-8 text-[10px] text-neutral-500">{pxPerSec}px/s</span>
      </div>
    </div>
  );
};