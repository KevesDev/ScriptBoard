import { useCallback, useEffect, useRef } from 'react';
import type { TimelineAudioTrack, TimelineVideoTrack } from '@common/models';

type Options = {
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  currentTime: number;
  setCurrentTime: (t: number | ((p: number) => number)) => void;
  timelineDuration: number;
  tracks: TimelineAudioTrack[];
  videoTracks?: TimelineVideoTrack[];
  /** When true, playback wraps to 0 at the end of the timeline. */
  loop?: boolean;
  /** When false, skip loading/playing (e.g. no project). */
  enabled: boolean;
};

/**
 * Drives animatic time with rAF when playing, and syncs multi-track HTMLAudioElement clips
 * plus optional HTMLVideoElement clips (mute / trim / timeline window).
 */
export function useTimelinePlayback({
  isPlaying,
  setIsPlaying,
  currentTime,
  setCurrentTime,
  timelineDuration,
  tracks,
  videoTracks = [],
  loop = false,
  enabled,
}: Options) {
  const audioMap = useRef<Map<string, HTMLAudioElement>>(new Map());
  const videoMap = useRef<Map<string, HTMLVideoElement>>(new Map());
  const lastFrameRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  const getAudioEl = useCallback((clipId: string, dataUri: string) => {
    const m = audioMap.current;
    let el = m.get(clipId);
    if (!el) {
      el = new Audio(dataUri);
      el.preload = 'auto';
      m.set(clipId, el);
    } else if (el.src !== dataUri && dataUri) {
      el.src = dataUri;
      el.load();
    }
    return el;
  }, []);

  const getVideoEl = useCallback((clipId: string, dataUri: string) => {
    const m = videoMap.current;
    let el = m.get(clipId);
    if (!el) {
      el = document.createElement('video');
      el.preload = 'auto';
      el.playsInline = true;
      m.set(clipId, el);
    } else if (el.src !== dataUri && dataUri) {
      el.src = dataUri;
      el.load();
    }
    return el;
  }, []);

  const syncAudioToTime = useCallback(
    (t: number, playing: boolean) => {
      const anySolo = tracks.some((tr) => tr.solo);
      for (const track of tracks) {
        const audible = !track.muted && (!anySolo || track.solo);
        for (const clip of track.clips) {
          const el = getAudioEl(clip.id, clip.dataUri);
          const clipEnd = clip.startTimeSec + clip.durationSec;
          const inWin = t >= clip.startTimeSec && t < clipEnd;
          const local = t - clip.startTimeSec + clip.sourceTrimStartSec;
          const srcMax =
            clip.sourceDurationSec != null
              ? clip.sourceTrimStartSec + clip.sourceDurationSec
              : el.duration && Number.isFinite(el.duration)
                ? el.duration
                : clip.durationSec + clip.sourceTrimStartSec + 1;

          if (!audible || !inWin || local < 0 || local >= srcMax - 0.02) {
            el.pause();
            continue;
          }

          if (playing) {
            if (Math.abs(el.currentTime - local) > 0.12) el.currentTime = local;
            void el.play().catch(() => {});
          } else {
            el.pause();
            el.currentTime = local;
          }
        }
      }

      for (const track of videoTracks) {
        for (const clip of track.clips) {
          const el = getVideoEl(clip.id, clip.dataUri);
          el.muted = track.muted;
          const clipEnd = clip.startTimeSec + clip.durationSec;
          const inWin = t >= clip.startTimeSec && t < clipEnd;
          const local = t - clip.startTimeSec + clip.sourceTrimStartSec;
          const srcMax =
            clip.sourceDurationSec != null
              ? clip.sourceTrimStartSec + clip.sourceDurationSec
              : el.duration && Number.isFinite(el.duration)
                ? el.duration
                : clip.durationSec + clip.sourceTrimStartSec + 1;

          if (!inWin || local < 0 || local >= srcMax - 0.02) {
            el.pause();
            continue;
          }

          if (playing) {
            if (Math.abs(el.currentTime - local) > 0.12) el.currentTime = local;
            void el.play().catch(() => {});
          } else {
            el.pause();
            el.currentTime = local;
          }
        }
      }
    },
    [getAudioEl, getVideoEl, tracks, videoTracks],
  );

  useEffect(() => {
    if (!enabled) return;
    syncAudioToTime(currentTime, isPlaying);
  }, [enabled, currentTime, isPlaying, tracks, videoTracks, syncAudioToTime]);

  useEffect(() => {
    if (!enabled || !isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    lastFrameRef.current = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      setCurrentTime((prev) => {
        const next = prev + dt;
        if (next >= timelineDuration) {
          if (loopRef.current && timelineDuration > 0) {
            return Math.max(0, next - timelineDuration);
          }
          setIsPlaying(false);
          return timelineDuration;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, isPlaying, timelineDuration, setCurrentTime, setIsPlaying]);

  useEffect(() => {
    return () => {
      for (const el of audioMap.current.values()) {
        el.pause();
        el.src = '';
      }
      audioMap.current.clear();
      for (const el of videoMap.current.values()) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      videoMap.current.clear();
    };
  }, []);

  return { syncAudioToTime };
}
