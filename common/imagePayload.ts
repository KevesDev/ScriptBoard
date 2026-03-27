/**
 * Canvas / Pixi `extract.base64` and `toDataURL` return a full
 * `data:image/...;base64,<payload>`. Renderer code may also re-wrap that string.
 * This peels nested wrappers so callers can use `Buffer.from(..., 'base64')`.
 */
export function stripImageDataUrlToRawBase64(input: string): string {
  let t = input.trim();
  while (t.startsWith('data:')) {
    const lower = t.toLowerCase();
    const key = ';base64,';
    const i = lower.indexOf(key);
    if (i < 0) break;
    t = t.slice(i + key.length);
  }
  return t.replace(/\s/g, '');
}

/** Uint8Array only — safe when this module is bundled for the browser (renderer imports `stripImageDataUrlToRawBase64`). */
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const WEBP = new Uint8Array([0x57, 0x45, 0x42, 0x50]);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function isPngBuffer(buf: Buffer): boolean {
  return (
    buf.length >= PNG_SIG.length &&
    bytesEqual(buf.subarray(0, PNG_SIG.length), PNG_SIG)
  );
}

export function isJpegBuffer(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export function isWebpBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    bytesEqual(buf.subarray(0, 4), RIFF) &&
    bytesEqual(buf.subarray(8, 12), WEBP)
  );
}

/** Ensures decoded bytes match the file extension we will feed to FFmpeg. */
export function assertImageBufferMatchesExt(ext: string, buf: Buffer, context: string): void {
  const ok =
    (ext === 'png' && isPngBuffer(buf)) ||
    (ext === 'jpg' && isJpegBuffer(buf)) ||
    (ext === 'webp' && isWebpBuffer(buf));
  if (!ok) {
    throw new Error(
      `${context}: image payload is corrupt or not a valid ${ext.toUpperCase()} file (bad signature).`,
    );
  }
}
