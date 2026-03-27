import type { AnimaticExportAudioClipPayload, Project } from '@common/models';

/**
 * Audible clips in timeline order (same solo/mute rules as playback).
 */
export function collectAnimaticExportAudioClips(project: Project): AnimaticExportAudioClipPayload[] {
  const tl = project.timeline;
  if (!tl?.audioTracks?.length) return [];
  const anySolo = tl.audioTracks.some((t) => t.solo);
  const out: AnimaticExportAudioClipPayload[] = [];
  for (const track of tl.audioTracks) {
    const audible = !track.muted && (!anySolo || track.solo);
    if (!audible) continue;
    for (const clip of track.clips) {
      if (!clip.dataUri?.trim()) continue;
      out.push({
        dataUri: clip.dataUri,
        startTimeSec: clip.startTimeSec,
        durationSec: clip.durationSec,
        sourceTrimStartSec: clip.sourceTrimStartSec ?? 0,
        sourceDurationSec: clip.sourceDurationSec,
      });
    }
  }
  return out;
}
