/**
 * Sexy Industry-level Thread Architecture: Background Waveform Processing
 * This worker calculates the audio peaks on a separate CPU core to prevent UI freezing.
 */

self.onmessage = (e: MessageEvent<{ channelData: Float32Array; targetSamples: number }>) => {
    const { channelData, targetSamples } = e.data;
    
    const blockSize = Math.floor(channelData.length / targetSamples);
    const peaks = new Float32Array(targetSamples);
  
    // This should be able to process millions of samples without blocking the React UI thread
    for (let i = 0; i < targetSamples; i++) {
      const start = i * blockSize;
      let max = 0;
      for (let j = 0; j < blockSize; j++) {
        const val = Math.abs(channelData[start + j]);
        if (val > max) max = val;
      }
      peaks[i] = max;
    }
  
    // Transfer the buffer back to the main thread (Zero-copy for maximum performance!)
    self.postMessage({ peaks }, { transfer: [peaks.buffer] });
  };