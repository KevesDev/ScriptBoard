import type { StateCreator } from 'zustand';
import type { ProjectStoreState } from '../projectStore';
import type { TimelineAudioClip, TimelineVideoClip, TimelineCameraKeyframe, TimelineLayerKeyframe, TimelineStoryboardClip, TimelineAudioTrack } from '@common/models';
import { cutTimelineRangeFromClips } from '../../lib/audioClipOverlap';
import { cutTimelineRangeFromVideoClips } from '../../lib/videoClipOverlap';
import { cutStoryboardRangeFromClips } from '../../lib/storyboardClipOverlap';
import { computeRipplePanelStartTimes } from '../../lib/timelineLayout';
import { newStoryboardTrack } from '@common/projectMigrate';

const MIN_CLIP_DUR = 0.01;

export interface TimelineSlice {
  setAnimaticEditingMode: (enabled: boolean) => void;
  setTimelineOverwriteClips: (enabled: boolean) => void;
  addTimelineAudioTrack: () => void;
  removeTimelineAudioTrack: (trackIndex: number) => void;
  addTimelineAudioClip: (trackIndex: number, clip: TimelineAudioClip) => void;
  updateTimelineAudioClip: (trackIndex: number, clipId: string, patch: Partial<TimelineAudioClip>) => void;
  removeTimelineAudioClip: (trackIndex: number, clipId: string) => void;
  setTimelineTrackMuted: (trackIndex: number, muted: boolean) => void;
  setTimelineTrackSolo: (trackIndex: number, solo: boolean) => void;
  moveTimelineAudioClip: (trackIndex: number, clipId: string, newStartTimeSec: number) => void;
  resizeTimelineAudioClip: (trackIndex: number, clipId: string, edge: 'left' | 'right', timelineTimeSec: number) => void;
  slipTimelineAudioClipToTrim: (trackIndex: number, clipId: string, sourceTrimStartSec: number) => void;
  addTimelineActAt: (startSec: number) => void;
  addTimelineSequenceAt: (startSec: number) => void;
  addTimelineVideoClip: (trackIndex: number, clip: TimelineVideoClip) => void;
  updateTimelineVideoClip: (trackIndex: number, clipId: string, patch: Partial<TimelineVideoClip>) => void;
  removeTimelineVideoClip: (trackIndex: number, clipId: string) => void;
  setTimelineVideoTrackMuted: (trackIndex: number, muted: boolean) => void;
  moveTimelineVideoClip: (trackIndex: number, clipId: string, newStartTimeSec: number) => void;
  resizeTimelineVideoClip: (trackIndex: number, clipId: string, edge: 'left' | 'right', timelineTimeSec: number) => void;
  slipTimelineVideoClipToTrim: (trackIndex: number, clipId: string, sourceTrimStartSec: number) => void;
  addTimelineCameraKeyframe: (timeSec: number, values?: Partial<Omit<TimelineCameraKeyframe, 'id' | 'timeSec'>>) => void;
  removeTimelineCameraKeyframe: (id: string) => void;
  moveTimelineCameraKeyframe: (id: string, timeSec: number) => void;
  updateTimelineCameraKeyframe: (id: string, patch: Partial<Omit<TimelineCameraKeyframe, 'id'>>) => void;
  addTimelineLayerKeyframe: (timeSec: number, panelId: string, layerId: string, values?: Partial<Omit<TimelineLayerKeyframe, 'id' | 'timeSec' | 'panelId' | 'layerId'>>) => void;
  removeTimelineLayerKeyframe: (id: string) => void;
  moveTimelineLayerKeyframe: (id: string, timeSec: number) => void;
  updateTimelineLayerKeyframe: (id: string, patch: Partial<Omit<TimelineLayerKeyframe, 'id'>>) => void;
  addStoryboardTrack: () => void;
  removeStoryboardTrack: (trackId: string) => void;
  setStoryboardTrackMuted: (trackId: string, muted: boolean) => void;
  addStoryboardClip: (trackId: string, clip: Omit<TimelineStoryboardClip, 'id'> & { id?: string }) => void;
  removeStoryboardClip: (trackId: string, clipId: string) => void;
  moveStoryboardClip: (trackId: string, clipId: string, newStartTimeSec: number) => void;
  resizeStoryboardClip: (trackId: string, clipId: string, edge: 'left' | 'right', timelineTimeSec: number) => void;
}

export const createTimelineSlice: StateCreator<ProjectStoreState, [], [], TimelineSlice> = (set, get) => ({
  setAnimaticEditingMode: (enabled) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const p = state.project;
      const tl = p.timeline!;
      const timelineBase = {
        overwriteClips: !!tl.overwriteClips,
        storyboardTracks: tl.storyboardTracks,
        audioTracks: tl.audioTracks,
        videoTracks: tl.videoTracks,
        sequences: tl.sequences,
        acts: tl.acts,
        cameraKeyframes: tl.cameraKeyframes,
        layerKeyframes: tl.layerKeyframes,
      };
      if (enabled) {
        const starts = computeRipplePanelStartTimes(p);
        const scenes = p.scenes.map((s) => ({
          ...s,
          panels: s.panels.map((panel) => ({
            ...panel,
            timelineStartSec: starts.get(panel.id) ?? 0,
          })),
        }));
        return {
          project: {
            ...p,
            scenes,
            timeline: { ...timelineBase, animaticEditingMode: true },
          },
        };
      }
      const scenes = p.scenes.map((s) => ({
        ...s,
        panels: s.panels.map(({ timelineStartSec: _ts, ...rest }) => rest),
      }));
      return {
        project: {
          ...p,
          scenes,
          timeline: { ...timelineBase, animaticEditingMode: false },
        },
      };
    }),

  setTimelineOverwriteClips: (enabled) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, overwriteClips: enabled },
        },
      };
    }),

  addTimelineAudioTrack: () =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const newTrack: TimelineAudioTrack = {
        id: crypto.randomUUID(),
        name: `A${tl.audioTracks.length + 1}`,
        muted: false,
        solo: false,
        locked: false,
        clips: [],
      };
      return {
        project: {
          ...state.project,
          timeline: { ...tl, audioTracks: [...tl.audioTracks, newTrack] },
        },
      };
    }),

  removeTimelineAudioTrack: (trackIndex: number) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      if (tl.audioTracks.length <= 1) return state; 
      const audioTracks = tl.audioTracks.filter((_, i) => i !== trackIndex);
      return {
        project: {
          ...state.project,
          timeline: { ...tl, audioTracks },
        },
      };
    }),

  addTimelineAudioClip: (trackIndex, clip) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const next = { ...tr, clips: [...tr.clips, { ...clip, id: clip.id || crypto.randomUUID() }] };
      tracks[trackIndex] = next;
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  updateTimelineAudioClip: (trackIndex, clipId, patch) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = {
        ...tr,
        clips: tr.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  removeTimelineAudioClip: (trackIndex, clipId) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = { ...tr, clips: tr.clips.filter((c) => c.id !== clipId) };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  setTimelineTrackMuted: (trackIndex, muted) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = state.project.timeline.audioTracks.map((t, i) =>
        i === trackIndex ? { ...t, muted } : t,
      );
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  setTimelineTrackSolo: (trackIndex, solo) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = state.project.timeline.audioTracks.map((t, i) => ({
        ...t,
        solo: solo ? i === trackIndex : false,
      }));
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  moveTimelineAudioClip: (trackIndex, clipId, newStartTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const dur = clip.durationSec;
      const ns = Math.max(0, newStartTimeSec);
      const ne = ns + dur;
      const others = tr.clips.filter((c) => c.id !== clipId);
      let newOthers = others;
      if (state.project.timeline.overwriteClips) {
        newOthers = cutTimelineRangeFromClips(others, ns, ne, '__none__');
      }
      const moved: TimelineAudioClip = { ...clip, startTimeSec: ns };
      tracks[trackIndex] = { ...tr, clips: [...newOthers, moved] };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  resizeTimelineAudioClip: (trackIndex, clipId, edge, timelineTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const s = clip.startTimeSec;
      const e = s + clip.durationSec;
      const t = timelineTimeSec;
      if (edge === 'right') {
        const newEnd = Math.max(s + MIN_CLIP_DUR, t);
        const newDur = newEnd - s;
        tracks[trackIndex] = {
          ...tr,
          clips: tr.clips.map((c) => (c.id === clipId ? { ...c, durationSec: newDur } : c)),
        };
      } else {
        const newStart = Math.min(t, e - MIN_CLIP_DUR);
        const delta = newStart - s;
        const newDur = e - newStart;
        const newTrim = clip.sourceTrimStartSec + delta;
        if (newTrim < 0) return state;
        tracks[trackIndex] = {
          ...tr,
          clips: tr.clips.map((c) =>
            c.id === clipId
              ? { ...c, startTimeSec: newStart, durationSec: newDur, sourceTrimStartSec: newTrim }
              : c,
          ),
        };
      }
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  slipTimelineAudioClipToTrim: (trackIndex, clipId, sourceTrimStartSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.audioTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const sourceLen =
        clip.sourceDurationSec != null && clip.sourceDurationSec > 0
          ? clip.sourceDurationSec
          : clip.durationSec + clip.sourceTrimStartSec;
      let newTrim = Math.max(0, Math.min(sourceTrimStartSec, sourceLen - MIN_CLIP_DUR));
      let newDur = clip.durationSec;
      if (newTrim + newDur > sourceLen) {
        newDur = Math.max(MIN_CLIP_DUR, sourceLen - newTrim);
      }
      tracks[trackIndex] = {
        ...tr,
        clips: tr.clips.map((c) =>
          c.id === clipId
            ? { ...c, sourceTrimStartSec: newTrim, durationSec: newDur }
            : c,
        ),
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, audioTracks: tracks },
        },
      };
    }),

  addTimelineActAt: (startSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const acts = [...state.project.timeline.acts];
      const order = acts.length ? Math.max(...acts.map((a) => a.order)) + 1 : 1;
      acts.push({
        id: crypto.randomUUID(),
        name: `Act ${order}`,
        startSec: Math.max(0, startSec),
        order,
      });
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, acts },
        },
      };
    }),

  addTimelineSequenceAt: (startSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const sequences = [...state.project.timeline.sequences];
      const order = sequences.length ? Math.max(...sequences.map((s) => s.order)) + 1 : 1;
      sequences.push({
        id: crypto.randomUUID(),
        name: `Sequence ${order}`,
        startSec: Math.max(0, startSec),
        order,
      });
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, sequences },
        },
      };
    }),

  addTimelineVideoClip: (trackIndex, clip) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = {
        ...tr,
        clips: [...tr.clips, { ...clip, id: clip.id || crypto.randomUUID() }],
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  updateTimelineVideoClip: (trackIndex, clipId, patch) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = {
        ...tr,
        clips: tr.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  removeTimelineVideoClip: (trackIndex, clipId) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      tracks[trackIndex] = { ...tr, clips: tr.clips.filter((c) => c.id !== clipId) };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  setTimelineVideoTrackMuted: (trackIndex, muted) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = state.project.timeline.videoTracks.map((t, i) =>
        i === trackIndex ? { ...t, muted } : t,
      );
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  moveTimelineVideoClip: (trackIndex, clipId, newStartTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const dur = clip.durationSec;
      const ns = Math.max(0, newStartTimeSec);
      const ne = ns + dur;
      const others = tr.clips.filter((c) => c.id !== clipId);
      let newOthers = others;
      if (state.project.timeline.overwriteClips) {
        newOthers = cutTimelineRangeFromVideoClips(others, ns, ne, '__none__');
      }
      const moved: TimelineVideoClip = { ...clip, startTimeSec: ns };
      tracks[trackIndex] = { ...tr, clips: [...newOthers, moved] };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  resizeTimelineVideoClip: (trackIndex, clipId, edge, timelineTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const s = clip.startTimeSec;
      const e = s + clip.durationSec;
      const t = timelineTimeSec;
      if (edge === 'right') {
        const newEnd = Math.max(s + MIN_CLIP_DUR, t);
        const newDur = newEnd - s;
        tracks[trackIndex] = {
          ...tr,
          clips: tr.clips.map((c) => (c.id === clipId ? { ...c, durationSec: newDur } : c)),
        };
      } else {
        const newStart = Math.min(t, e - MIN_CLIP_DUR);
        const delta = newStart - s;
        const newDur = e - newStart;
        const newTrim = clip.sourceTrimStartSec + delta;
        if (newTrim < 0) return state;
        tracks[trackIndex] = {
          ...tr,
          clips: tr.clips.map((c) =>
            c.id === clipId
              ? { ...c, startTimeSec: newStart, durationSec: newDur, sourceTrimStartSec: newTrim }
              : c,
          ),
        };
      }
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  slipTimelineVideoClipToTrim: (trackIndex, clipId, sourceTrimStartSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tracks = [...state.project.timeline.videoTracks];
      if (trackIndex < 0 || trackIndex >= tracks.length) return state;
      const tr = tracks[trackIndex];
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const sourceLen =
        clip.sourceDurationSec != null && clip.sourceDurationSec > 0
          ? clip.sourceDurationSec
          : clip.durationSec + clip.sourceTrimStartSec;
      let newTrim = Math.max(0, Math.min(sourceTrimStartSec, sourceLen - MIN_CLIP_DUR));
      let newDur = clip.durationSec;
      if (newTrim + newDur > sourceLen) {
        newDur = Math.max(MIN_CLIP_DUR, sourceLen - newTrim);
      }
      tracks[trackIndex] = {
        ...tr,
        clips: tr.clips.map((c) =>
          c.id === clipId
            ? { ...c, sourceTrimStartSec: newTrim, durationSec: newDur }
            : c,
        ),
      };
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, videoTracks: tracks },
        },
      };
    }),

  addTimelineCameraKeyframe: (timeSec, values) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const t = Math.max(0, timeSec);
      const k: TimelineCameraKeyframe = {
        id: crypto.randomUUID(),
        timeSec: t,
        panX: values?.panX ?? 0,
        panY: values?.panY ?? 0,
        zoom: values?.zoom ?? 1,
        rotationDeg: values?.rotationDeg ?? 0,
      };
      const cameraKeyframes = [...state.project.timeline.cameraKeyframes, k].sort((a, b) => a.timeSec - b.timeSec);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, cameraKeyframes },
        },
      };
    }),

  removeTimelineCameraKeyframe: (id) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            cameraKeyframes: state.project.timeline.cameraKeyframes.filter((k) => k.id !== id),
          },
        },
      };
    }),

  moveTimelineCameraKeyframe: (id, timeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const t = Math.max(0, timeSec);
      const cameraKeyframes = state.project.timeline.cameraKeyframes
        .map((k) => (k.id === id ? { ...k, timeSec: t } : k))
        .sort((a, b) => a.timeSec - b.timeSec);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, cameraKeyframes },
        },
      };
    }),

  updateTimelineCameraKeyframe: (id, patch) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const cameraKeyframes = state.project.timeline.cameraKeyframes.map((k) =>
        k.id === id ? { ...k, ...patch } : k,
      );
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, cameraKeyframes },
        },
      };
    }),

  addTimelineLayerKeyframe: (timeSec, panelId, layerId, values) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const t = Math.max(0, timeSec);
      const k: TimelineLayerKeyframe = {
        id: crypto.randomUUID(),
        timeSec: t,
        panelId,
        layerId,
        offsetX: values?.offsetX ?? 0,
        offsetY: values?.offsetY ?? 0,
        scale: values?.scale ?? 1,
        opacityMul: values?.opacityMul ?? 1,
      };
      const layerKeyframes = [...state.project.timeline.layerKeyframes, k].sort((a, b) => a.timeSec - b.timeSec);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, layerKeyframes },
        },
      };
    }),

  removeTimelineLayerKeyframe: (id) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            layerKeyframes: state.project.timeline.layerKeyframes.filter((k) => k.id !== id),
          },
        },
      };
    }),

  moveTimelineLayerKeyframe: (id, timeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const t = Math.max(0, timeSec);
      const layerKeyframes = state.project.timeline.layerKeyframes
        .map((k) => (k.id === id ? { ...k, timeSec: t } : k))
        .sort((a, b) => a.timeSec - b.timeSec);
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, layerKeyframes },
        },
      };
    }),

  updateTimelineLayerKeyframe: (id, patch) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const layerKeyframes = state.project.timeline.layerKeyframes.map((k) =>
        k.id === id ? { ...k, ...patch } : k,
      );
      return {
        project: {
          ...state.project,
          timeline: { ...state.project.timeline, layerKeyframes },
        },
      };
    }),

  addStoryboardTrack: () =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const sorted = [...tl.storyboardTracks].sort((a, b) => a.order - b.order);
      const maxOrder = sorted.length ? Math.max(...sorted.map((t) => t.order)) : -1;
      const next = [...tl.storyboardTracks, newStoryboardTrack(maxOrder + 1, `Layer ${sorted.length + 1}`)];
      return {
        project: {
          ...state.project,
          timeline: { ...tl, storyboardTracks: next },
        },
      };
    }),

  removeStoryboardTrack: (trackId) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const sorted = [...tl.storyboardTracks].sort((a, b) => a.order - b.order);
      if (sorted.length <= 1) return state;
      const victim = sorted.find((t) => t.id === trackId);
      if (!victim || victim.order === 0) return state;
      const reindexed = sorted
        .filter((t) => t.id !== trackId)
        .sort((a, b) => a.order - b.order)
        .map((t, i) => ({ ...t, order: i }));
      return {
        project: {
          ...state.project,
          timeline: { ...tl, storyboardTracks: reindexed },
        },
      };
    }),

  setStoryboardTrackMuted: (trackId, muted) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
          },
        },
      };
    }),

  addStoryboardClip: (trackId, clipIn) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const ti = tl.storyboardTracks.findIndex((t) => t.id === trackId);
      if (ti < 0) return state;
      const tr = tl.storyboardTracks[ti]!;
      if (tr.locked) return state;
      const id = clipIn.id || crypto.randomUUID();
      const nextClip: TimelineStoryboardClip = {
        id,
        name: clipIn.name,
        panelId: clipIn.panelId,
        startTimeSec: Math.max(0, clipIn.startTimeSec),
        durationSec: Math.max(0.05, clipIn.durationSec),
        layerIds: clipIn.layerIds,
      };
      let clips = [...tr.clips];
      if (tl.overwriteClips) {
        clips = cutStoryboardRangeFromClips(
          clips,
          nextClip.startTimeSec,
          nextClip.startTimeSec + nextClip.durationSec,
          '__none__',
        );
      }
      clips.push(nextClip);
      clips.sort((a, b) => a.startTimeSec - b.startTimeSec);
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t, i) => (i === ti ? { ...t, clips } : t)),
          },
        },
      };
    }),

  removeStoryboardClip: (trackId, clipId) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const tr = tl.storyboardTracks.find((t) => t.id === trackId);
      if (!tr || tr.locked) return state;
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t) =>
              t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
            ),
          },
        },
      };
    }),

  moveStoryboardClip: (trackId, clipId, newStartTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const ti = tl.storyboardTracks.findIndex((t) => t.id === trackId);
      if (ti < 0) return state;
      const tr = tl.storyboardTracks[ti]!;
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const dur = clip.durationSec;
      const ns = Math.max(0, newStartTimeSec);
      const ne = ns + dur;
      let others = tr.clips.filter((c) => c.id !== clipId);
      if (tl.overwriteClips) {
        others = cutStoryboardRangeFromClips(others, ns, ne, '__none__');
      }
      const moved = { ...clip, startTimeSec: ns };
      const clips = [...others, moved].sort((a, b) => a.startTimeSec - b.startTimeSec);
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t, i) => (i === ti ? { ...t, clips } : t)),
          },
        },
      };
    }),

  resizeStoryboardClip: (trackId, clipId, edge, timelineTimeSec) =>
    set((state) => {
      if (!state.project?.timeline) return state;
      const tl = state.project.timeline;
      const ti = tl.storyboardTracks.findIndex((t) => t.id === trackId);
      if (ti < 0) return state;
      const tr = tl.storyboardTracks[ti]!;
      if (tr.locked) return state;
      const clip = tr.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const s = clip.startTimeSec;
      const e = s + clip.durationSec;
      const t = timelineTimeSec;
      let nextClip: TimelineStoryboardClip;
      if (edge === 'right') {
        const newEnd = Math.max(s + MIN_CLIP_DUR, t);
        nextClip = { ...clip, durationSec: newEnd - s };
      } else {
        const newStart = Math.min(Math.max(0, t), e - MIN_CLIP_DUR);
        nextClip = { ...clip, startTimeSec: newStart, durationSec: e - newStart };
      }
      let others = tr.clips.filter((c) => c.id !== clipId);
      if (tl.overwriteClips) {
        others = cutStoryboardRangeFromClips(
          others,
          nextClip.startTimeSec,
          nextClip.startTimeSec + nextClip.durationSec,
          '__none__',
        );
      }
      const clips = [...others, nextClip].sort((a, b) => a.startTimeSec - b.startTimeSec);
      return {
        project: {
          ...state.project,
          timeline: {
            ...tl,
            storyboardTracks: tl.storyboardTracks.map((t, i) => (i === ti ? { ...t, clips } : t)),
          },
        },
      };
    }),
});