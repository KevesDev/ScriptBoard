let sharedAudioContext: AudioContext | null = null;

function getDecodeContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

/** Decode a data URI / URL into AudioBuffer (renderer / Electron). */
export async function decodeAudioFromDataUri(dataUri: string): Promise<AudioBuffer> {
  const res = await fetch(dataUri);
  const arr = await res.arrayBuffer();
  const ctx = getDecodeContext();
  const copy = arr.slice(0);
  return ctx.decodeAudioData(copy);
}

export function downsamplePeaks(buffer: AudioBuffer, targetBins: number): number[] {
  const ch = buffer.getChannelData(0);
  const len = ch.length;
  if (len === 0) return [];
  const block = Math.floor(len / targetBins) || 1;
  const peaks: number[] = [];
  for (let i = 0; i < targetBins; i++) {
    const start = i * block;
    let max = 0;
    for (let j = 0; j < block && start + j < len; j++) {
      max = Math.max(max, Math.abs(ch[start + j]!));
    }
    peaks.push(max);
  }
  return peaks;
}
