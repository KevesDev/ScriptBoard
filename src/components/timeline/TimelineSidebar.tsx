import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { 
  useTimelineContext, HEADER_W, RULER_H, SCENE_STRIP_H, VIDEO_ROW_H, 
  KF_TRACK_H, META_H, STORYBOARD_ROW_H, AUDIO_ROW_H 
} from './TimelineContext';
import { Video, Camera, Layers2, Plus, Trash2, Volume2, VolumeX } from 'lucide-react';
import { nativeConfirm } from '../../lib/focusAfterNativeDialog';

const trackHeaderBtn = 'p-0.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800';

export const TimelineSidebar: React.FC = () => {
  const {
    commitHistory, setTimelineVideoTrackMuted,
    addTimelineCameraKeyframe, addStoryboardTrack, removeStoryboardTrack, setStoryboardTrackMuted,
    addTimelineLayerKeyframe, setTimelineTrackMuted, setTimelineTrackSolo,
    addTimelineAudioTrack, removeTimelineAudioTrack
  } = useProjectStore();

  const {
    leftColScrollRef, playheadTotalHeight, showVideoTrack, videoTracks, showCameraTrack,
    currentTime, activeSequenceName, activeMetaSummary, storyboardTracksSorted,
    snapTime, showLayerTrack, activeLayerName, audioTracks, activePanelId, activeLayerId
  } = useTimelineContext();

  return (
    <div ref={leftColScrollRef} className="flex shrink-0 flex-col overflow-y-auto border-r border-black bg-[#222]" style={{ width: HEADER_W }}>
      <div className="flex flex-col" style={{ minHeight: playheadTotalHeight }}>
        <div className="flex items-center border-b border-black px-2 text-[10px] text-neutral-500" style={{ height: RULER_H }}>Time</div>
        <div className="flex items-center border-b border-black px-2 text-[10px] font-medium leading-tight text-neutral-400" style={{ height: SCENE_STRIP_H }}>Scenes</div>
        
        {showVideoTrack && videoTracks.map((tr, i) => (
          <div key={tr.id} className="flex items-center justify-between border-b border-black px-2 py-1 text-[10px]" style={{ height: VIDEO_ROW_H }}>
            <span className="font-medium text-neutral-300"><Video size={12} /> V{i + 1}</span>
            <button type="button" className={trackHeaderBtn} onClick={() => { commitHistory(); setTimelineVideoTrackMuted(i, !tr.muted); }}>{tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
          </div>
        ))}
        
        {showCameraTrack && (
          <div className="flex items-center justify-between border-b border-black px-2 text-[10px]" style={{ height: KF_TRACK_H }}>
            <span className="font-medium text-neutral-300"><Camera size={12} /> Camera</span>
            <button type="button" className={`${trackHeaderBtn} text-sky-400`} onClick={() => { commitHistory(); addTimelineCameraKeyframe(snapTime(currentTime)); }}><Plus size={14} /></button>
          </div>
        )}
        
        <div className="flex flex-col justify-center border-b border-black px-2 py-1 text-[10px] leading-tight text-sky-400" style={{ height: META_H }}>
           <div className="truncate text-neutral-500">Seq. <span className="text-sky-200">{activeSequenceName}</span></div>
           <div className="text-neutral-500">Sc. <span className="text-sky-200">{activeMetaSummary?.sceneIndex ?? '-'}</span> · P. <span className="text-sky-200">{activeMetaSummary?.panelIndexInScene ?? '-'}</span></div>
        </div>
        
        {/* STORYBOARD TRACKS */}
        {storyboardTracksSorted.map((tr) => (
          <div key={tr.id} className="flex items-center justify-between gap-0.5 border-b border-black px-1 py-0.5 text-[10px] font-medium text-neutral-300" style={{ height: STORYBOARD_ROW_H }}>
            <span className="flex min-w-0 flex-1 items-center gap-0.5 truncate" title={tr.name}>
              <Layers2 size={11} className="mr-0.5 shrink-0 opacity-70" />
              <span className="truncate">{tr.order === 0 ? 'Primary' : tr.name}</span>
            </span>
            <div className="flex shrink-0 gap-0.5">
              <button type="button" className={trackHeaderBtn} title={tr.muted ? 'Unmute layer' : 'Mute layer'} onClick={() => { commitHistory(); setStoryboardTrackMuted(tr.id, !tr.muted); }}>
                {tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              
              {tr.order === 0 ? (
                <button type="button" className={`${trackHeaderBtn} text-sky-400`} title="Add new visual layer" onClick={() => { commitHistory(); addStoryboardTrack(); }}>
                  <Plus size={12} />
                </button>
              ) : (
                <button type="button" className={`${trackHeaderBtn} text-red-400`} title="Remove visual layer" onClick={() => { 
                  void (async () => {
                    if (await nativeConfirm('Remove this video track and all its clips?')) {
                      commitHistory();
                      removeStoryboardTrack(tr.id);
                    }
                  })();
                }}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
        
        {showLayerTrack && (
          <div className="flex items-center justify-between border-b border-black px-2 text-[10px]" style={{ height: KF_TRACK_H }}>
            <span className="truncate text-neutral-400" title={activeLayerName}>L: {activeLayerName}</span>
            <button type="button" disabled={!activePanelId || !activeLayerId} className={`${trackHeaderBtn} text-emerald-400 disabled:opacity-30`} onClick={() => { if (!activePanelId || !activeLayerId) return; commitHistory(); addTimelineLayerKeyframe(snapTime(currentTime), activePanelId, activeLayerId); }}><Plus size={14} /></button>
          </div>
        )}
        
        {/* AUDIO TRACKS */}
        {audioTracks.map((tr, i) => (
          <div key={tr.id} className="flex items-center justify-between border-b border-black px-2 py-1 text-[10px]" style={{ height: AUDIO_ROW_H }}>
            <span className="font-medium text-neutral-300">A{i + 1}</span>
            <div className="flex gap-0.5">
              <button type="button" className={trackHeaderBtn} title={tr.muted ? 'Unmute' : 'Mute'} onClick={() => { commitHistory(); setTimelineTrackMuted(i, !tr.muted); }}>
                {tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              <button type="button" className={`${trackHeaderBtn} ${tr.solo ? 'text-amber-300' : ''}`} title="Solo Track" onClick={() => { commitHistory(); setTimelineTrackSolo(i, !tr.solo); }}>
                <span className="text-[9px] font-bold">S</span>
              </button>
              
              {i === 0 ? (
                <button type="button" className={`${trackHeaderBtn} text-sky-400`} title="Add new audio track" onClick={() => { commitHistory(); addTimelineAudioTrack(); }}>
                  <Plus size={12} />
                </button>
              ) : (
                <button type="button" className={`${trackHeaderBtn} text-red-400`} title="Remove audio track" onClick={() => { 
                  void (async () => {
                    if (await nativeConfirm('Remove this audio track and all its clips?')) {
                      commitHistory();
                      removeTimelineAudioTrack(i);
                    }
                  })();
                }}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};