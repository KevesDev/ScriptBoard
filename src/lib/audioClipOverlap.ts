import type { TimelineAudioClip } from '@common/models';

/** Split clips that overlap [cutStart, cutEnd) on the timeline (for overwrite mode). */
export function cutTimelineRangeFromClips(
  clips: TimelineAudioClip[],
  cutStart: number,
  cutEnd: number,
  excludeClipId: string,
): TimelineAudioClip[] {
  const out: TimelineAudioClip[] = [];
  for (const clip of clips) {
    if (clip.id === excludeClipId) {
      out.push(clip);
      continue;
    }
    const s = clip.startTimeSec;
    const e = s + clip.durationSec;
    const c0 = Math.max(cutStart, s);
    const c1 = Math.min(cutEnd, e);
    if (c1 <= c0 + 1e-6) {
      out.push(clip);
      continue;
    }
    if (c0 > s + 1e-6) {
      const leftDur = c0 - s;
      out.push({
        ...clip,
        id: crypto.randomUUID(),
        name: clip.name,
        startTimeSec: s,
        durationSec: leftDur,
        sourceTrimStartSec: clip.sourceTrimStartSec,
        sourceDurationSec: clip.sourceDurationSec,
        dataUri: clip.dataUri,
        peaks: clip.peaks,
      });
    }
    if (c1 < e - 1e-6) {
      const rightDur = e - c1;
      out.push({
        ...clip,
        id: crypto.randomUUID(),
        name: clip.name,
        startTimeSec: c1,
        durationSec: rightDur,
        sourceTrimStartSec: clip.sourceTrimStartSec + (c1 - s),
        sourceDurationSec: clip.sourceDurationSec,
        dataUri: clip.dataUri,
        peaks: clip.peaks,
      });
    }
  }
  return out;
}
