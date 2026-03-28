export async function decodeAudioFromDataUri(dataUri: string): Promise<AudioBuffer> {
  const res = await fetch(dataUri);
  const arrayBuffer = await res.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

export function downsamplePeaks(buf: AudioBuffer, samples: number): number[] {
  const channelData = buf.getChannelData(0);
  const blockSize = Math.floor(channelData.length / samples);
  const peaks: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = i * blockSize;
    let max = 0;
    for (let j = 0; j < blockSize; j++) {
      const val = Math.abs(channelData[start + j]);
      if (val > max) max = val;
    }
    peaks.push(max);
  }
  return peaks;
}

/**
 * Spins up a Web Worker using Vite's native URL resolution to process peaks
 * on a background CPU core, prevents the UI from freezing.
 */
export function generatePeaksAsync(buf: AudioBuffer, targetSamples: number): Promise<number[]> {
  return new Promise((resolve) => {
    try {
      const channelData = buf.getChannelData(0);
      
      // Clone the channel data - transferring it directly from the AudioBuffer 
      // might detach it and break future playback.
      const dataCopy = new Float32Array(channelData);

      // Initialize the worker natively
      const worker = new Worker(new URL('./waveformWorker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = (e) => {
        const peaksArray = new Float32Array(e.data.peaks);
        // Convert Float32Array back to standard number array for our Zustand store
        resolve(Array.from(peaksArray));
        worker.terminate();
      };

      worker.onerror = (err) => {
        console.error('Waveform Worker Error:', err);
        // Safety fallback to synchronous execution if the worker fails
        resolve(downsamplePeaks(buf, targetSamples));
        worker.terminate();
      };

      // Send the data using our nice high-performance memory transfer
      worker.postMessage({ channelData: dataCopy, targetSamples }, [dataCopy.buffer]);
    } catch (error) {
      console.warn('Falling back to synchronous peak generation.', error);
      resolve(downsamplePeaks(buf, targetSamples));
    }
  });
}