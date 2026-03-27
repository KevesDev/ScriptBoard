/** Read duration from a video data URI (metadata only; element is not attached to DOM). */
export function probeVideoDurationFromDataUri(dataUri: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (d: number) => {
      v.removeAttribute('src');
      v.load();
      resolve(d);
    };
    v.onloadedmetadata = () => {
      const d = v.duration;
      done(Number.isFinite(d) && d > 0 ? d : 0);
    };
    v.onerror = () => {
      v.removeAttribute('src');
      reject(new Error('Failed to read video metadata'));
    };
    v.src = dataUri;
  });
}
