import type { TimelineStoryboardClip } from '@common/models';

/** Split storyboard clips that overlap [cutStart, cutEnd) on the timeline (overwrite mode). */
export function cutStoryboardRangeFromClips(
  clips: TimelineStoryboardClip[],
  cutStart: number,
  cutEnd: number,
  excludeClipId: string,
): TimelineStoryboardClip[] {
  const out: TimelineStoryboardClip[] = [];
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
      out.push({
        ...clip,
        id: crypto.randomUUID(),
        startTimeSec: s,
        durationSec: c0 - s,
      });
    }
    if (c1 < e - 1e-6) {
      out.push({
        ...clip,
        id: crypto.randomUUID(),
        startTimeSec: c1,
        durationSec: e - c1,
      });
    }
  }
  return out;
}
