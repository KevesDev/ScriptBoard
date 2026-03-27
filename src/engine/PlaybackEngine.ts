import type { TimelineAudioTrack, TimelineVideoTrack } from '@common/models';

export class PlaybackEngine {
  private static instance: PlaybackEngine | null = null;

  private audioMap = new Map<string, HTMLAudioElement>();
  private videoMap = new Map<string, HTMLVideoElement>();
  private rafId = 0;
  private lastTime = 0;

  public currentTime = 0;
  public isPlaying = false;

  // Data State
  public duration = 0;
  public fps = 24;
  public pxPerSec = 50;
  public loop = false;
  public audioTracks: TimelineAudioTrack[] = [];
  public videoTracks: TimelineVideoTrack[] = [];

  // Direct DOM References (Bypassing React)
  public playheadEl: HTMLElement | null = null;
  public timecodeEl: HTMLElement | null = null;

  // React Sync Callback
  public onStop?: (finalTime: number) => void;

  private constructor() {}

  public static getInstance(): PlaybackEngine {
    if (!PlaybackEngine.instance) {
      PlaybackEngine.instance = new PlaybackEngine();
    }
    return PlaybackEngine.instance;
  }

  /**
   * Binds the Engine to specific HTML IDs so it can mutate them via GPU
   * transforms without ever waking up the React Virtual DOM.
   */
  public attachDOM(playheadId: string, timecodeId: string) {
    this.playheadEl = document.getElementById(playheadId);
    this.timecodeEl = document.getElementById(timecodeId);
  }

  public updateState(config: {
    duration?: number;
    fps?: number;
    pxPerSec?: number;
    loop?: boolean;
    audioTracks?: TimelineAudioTrack[];
    videoTracks?: TimelineVideoTrack[];
  }) {
    if (config.duration !== undefined) this.duration = config.duration;
    if (config.fps !== undefined) this.fps = config.fps;
    if (config.pxPerSec !== undefined) this.pxPerSec = config.pxPerSec;
    if (config.loop !== undefined) this.loop = config.loop;
    if (config.audioTracks !== undefined) this.audioTracks = config.audioTracks;
    if (config.videoTracks !== undefined) this.videoTracks = config.videoTracks;
  }

  public play() {
    if (this.isPlaying) return;
    if (this.currentTime >= this.duration && !this.loop) {
      this.currentTime = 0;
    }
    this.isPlaying = true;
    this.lastTime = performance.now();
    this.syncMedia(this.currentTime, true);
    this.tick(this.lastTime);
  }

  public pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    cancelAnimationFrame(this.rafId);
    this.syncMedia(this.currentTime, false);
    this.updateDOM(); 
    if (this.onStop) this.onStop(this.currentTime);
  }

  public seek(t: number) {
    this.currentTime = Math.max(0, Math.min(t, this.duration));
    this.updateDOM();
    this.syncMedia(this.currentTime, this.isPlaying);
    this.broadcastTime(); // Force an immediate frame update to the WebGL canvas
  }

  public togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  private tick = (now: number) => {
    if (!this.isPlaying) return;
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    let next = this.currentTime + dt;
    if (next >= this.duration) {
      if (this.loop && this.duration > 0) {
        next = next % this.duration;
      } else {
        this.currentTime = this.duration;
        this.pause();
        return;
      }
    }

    this.currentTime = next;
    this.updateDOM();
    this.syncMedia(this.currentTime, true);
    this.broadcastTime();

    this.rafId = requestAnimationFrame(this.tick);
  };

  /**
   * The core of the performance fix. Translates the playhead via GPU hardware 
   * acceleration, leaving React completely asleep.
   */
  private updateDOM() {
    if (this.playheadEl) {
      this.playheadEl.style.transform = `translateX(${this.currentTime * this.pxPerSec}px)`;
    }
    if (this.timecodeEl) {
      this.timecodeEl.textContent = this.formatTimecode(this.currentTime, this.fps);
    }
  }

  /**
   * High performance Pub/Sub. The WebGL StoryboardEngine will listen to this 
   * to update camera tracks without triggering React state changes.
   */
  private broadcastTime() {
    window.dispatchEvent(new CustomEvent('playback-time-update', { detail: { time: this.currentTime } }));
  }

  private formatTimecode(seconds: number, fps: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const wholeSeconds = Math.floor(seconds);
    const frames = Math.min(fps - 1, Math.round((seconds - wholeSeconds) * fps));
    const h = Math.floor(wholeSeconds / 3600);
    const m = Math.floor((wholeSeconds % 3600) / 60);
    const s = wholeSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }

  private getAudioEl(clipId: string, dataUri: string) {
    let el = this.audioMap.get(clipId);
    if (!el) {
      el = new Audio(dataUri);
      el.preload = 'auto';
      this.audioMap.set(clipId, el);
    } else if (el.src !== dataUri && dataUri) {
      el.src = dataUri;
      el.load();
    }
    return el;
  }

  private getVideoEl(clipId: string, dataUri: string) {
    let el = this.videoMap.get(clipId);
    if (!el) {
      el = document.createElement('video');
      el.preload = 'auto';
      el.playsInline = true;
      this.videoMap.set(clipId, el);
    } else if (el.src !== dataUri && dataUri) {
      el.src = dataUri;
      el.load();
    }
    return el;
  }

  public syncMedia(t: number, playing: boolean) {
    const anySolo = this.audioTracks.some((tr) => tr.solo);
    for (const track of this.audioTracks) {
      const audible = !track.muted && (!anySolo || track.solo);
      for (const clip of track.clips) {
        const el = this.getAudioEl(clip.id, clip.dataUri);
        const clipEnd = clip.startTimeSec + clip.durationSec;
        const inWin = t >= clip.startTimeSec && t < clipEnd;
        const local = t - clip.startTimeSec + clip.sourceTrimStartSec;
        const srcMax = clip.sourceDurationSec != null ? clip.sourceTrimStartSec + clip.sourceDurationSec : el.duration && Number.isFinite(el.duration) ? el.duration : clip.durationSec + clip.sourceTrimStartSec + 1;

        if (!audible || !inWin || local < 0 || local >= srcMax - 0.02) {
          if (!el.paused) el.pause();
          continue;
        }

        if (playing) {
          if (Math.abs(el.currentTime - local) > 0.12) el.currentTime = local;
          if (el.paused) void el.play().catch(() => {});
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - local) > 0.05) el.currentTime = local;
        }
      }
    }

    for (const track of this.videoTracks) {
      for (const clip of track.clips) {
        const el = this.getVideoEl(clip.id, clip.dataUri);
        el.muted = track.muted;
        const clipEnd = clip.startTimeSec + clip.durationSec;
        const inWin = t >= clip.startTimeSec && t < clipEnd;
        const local = t - clip.startTimeSec + clip.sourceTrimStartSec;
        const srcMax = clip.sourceDurationSec != null ? clip.sourceTrimStartSec + clip.sourceDurationSec : el.duration && Number.isFinite(el.duration) ? el.duration : clip.durationSec + clip.sourceTrimStartSec + 1;

        if (!inWin || local < 0 || local >= srcMax - 0.02) {
          if (!el.paused) el.pause();
          continue;
        }

        if (playing) {
          if (Math.abs(el.currentTime - local) > 0.12) el.currentTime = local;
          if (el.paused) void el.play().catch(() => {});
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - local) > 0.05) el.currentTime = local;
        }
      }
    }
  }

  public destroy() {
    this.pause();
    for (const el of this.audioMap.values()) { el.pause(); el.src = ''; }
    this.audioMap.clear();
    for (const el of this.videoMap.values()) { el.pause(); el.removeAttribute('src'); el.load(); }
    this.videoMap.clear();
  }
}