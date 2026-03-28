import { spawn } from 'child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import type { AnimaticExportAudioClipPayload } from '../common/models';
import {
  assertImageBufferMatchesExt,
  stripImageDataUrlToRawBase64,
} from '../common/imagePayload';

const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const AUDIO_SAMPLE_RATE = 48000;

export type AnimaticExportSegment = {
  /** image/jpeg, image/png, etc., or null for placeholder */
  dataUri: string | null;
  durationSec: number;
};

// Extract the raw file path natively
function resolveAssetPath(dataUri: string): string | null {
  if (!dataUri.startsWith('asset://')) return null;
  
  try {
    let cleanUri = dataUri;
    
    // Dev fallback: Clean up any mangled URIs from our previous tests saved in the project file
    if (cleanUri.startsWith('asset://local/')) {
      cleanUri = cleanUri.replace('asset://local/', 'asset:///');
    }
    
    // Native OS-aware conversion from URL back to physical path for FFmpeg
    return fileURLToPath(cleanUri.replace('asset://', 'file://'));
  } catch (err) {
    console.error('Failed to resolve physical path from URI:', dataUri, err);
    return null;
  }
}

function decodeDataUriBase(dataUri: string, defaultMime: string): { mime: string; buffer: Buffer } {
  if (!dataUri.startsWith('data:')) throw new Error('Invalid data URI');
  const key = ';base64,';
  const i = dataUri.toLowerCase().indexOf(key);
  if (i < 0) throw new Error('Expected base64 data URI');
  const meta = dataUri
    .slice(5, i)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const mime = (meta[0] || defaultMime).toLowerCase();
  const payload = dataUri.slice(i + key.length);
  const rawB64 = stripImageDataUrlToRawBase64(payload);
  return { mime, buffer: Buffer.from(rawB64, 'base64') };
}

function decodeImageDataUri(dataUri: string): { ext: string; buffer: Buffer } {
  const { mime, buffer } = decodeDataUriBase(dataUri, 'image/png');
  let ext = 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
  else if (mime.includes('png')) ext = 'png';
  else if (mime.includes('webp')) ext = 'webp';
  return { ext, buffer };
}

function runFfmpeg(
  ffmpegPath: string, 
  args: string[], 
  cwd: string, 
  totalDurationSec?: number,
  onProgress?: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { cwd, windowsHide: true });
    let stderr = '';
    
    child.stderr?.on('data', (c) => {
      const chunk = c.toString();
      stderr += chunk;
      
      if (onProgress && totalDurationSec && totalDurationSec > 0) {
        // Parse time=00:00:05.23 from FFmpeg stderr stream
        const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseFloat(timeMatch[3]);
          const currentSec = (hours * 3600) + (minutes * 60) + seconds;
          
          let progress = currentSec / totalDurationSec;
          if (progress > 0.99) progress = 0.99; 
          if (progress < 0) progress = 0;
          
          onProgress(progress);
        }
      }
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        if (onProgress) onProgress(1.0);
        resolve();
      }
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-4000)}`));
    });
  });
}

function effectiveClipSourceDurationSec(c: AnimaticExportAudioClipPayload): number {
  const trim = Math.max(0, c.sourceTrimStartSec);
  let dur = Math.max(0, c.durationSec);
  if (c.sourceDurationSec != null) {
    const avail = Math.max(0, c.sourceDurationSec - trim);
    dur = Math.min(dur, avail);
  }
  return Math.max(1 / AUDIO_SAMPLE_RATE, dur);
}

export async function exportAnimaticVideo(params: {
  ffmpegPath: string;
  outputPath: string;
  format: 'mp4' | 'mov';
  fps: number;
  width: number;
  height: number;
  segments: AnimaticExportSegment[];
  audioClips?: AnimaticExportAudioClipPayload[];
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const { ffmpegPath, outputPath, format, fps, width, height, segments, audioClips = [], onProgress } = params;
  if (!segments.length) {
    throw new Error('No timeline segments to export.');
  }

  const tmp = await mkdtemp(join(tmpdir(), 'sb-anim-'));
  try {
    const minDur = 1 / Math.max(1, fps);
    const fr = String(Math.max(0.001, fps));
    let totalDur = 0;
    const args: string[] = ['-y'];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const dur = Math.max(minDur, Number.isFinite(seg.durationSec) ? seg.durationSec : minDur);
      totalDur += dur;
      let ext = 'png';
      let buffer: Buffer = PLACEHOLDER_PNG;
      if (seg.dataUri) {
        const dec = decodeImageDataUri(seg.dataUri);
        assertImageBufferMatchesExt(dec.ext, dec.buffer, `Animatic segment ${i + 1}`);
        ext = dec.ext;
        buffer = dec.buffer;
      }
      const name = `seg_${i}.${ext}`;
      await writeFile(join(tmp, name), buffer);
      args.push('-loop', '1', '-framerate', fr, '-t', dur.toFixed(6), '-i', name);
    }

    const n = segments.length;
    const scalePad = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      'format=yuv420p',
      'setsar=1',
      'setpts=PTS-STARTPTS',
    ].join(',');
    const branches = segments.map((_, i) => `[${i}:v]${scalePad}[v${i}]`).join(';');
    const concatIn = segments.map((_, i) => `[v${i}]`).join('');
    let filterComplex = `${branches};${concatIn}concat=n=${n}:v=1:a=0[outv]`;

    let audioMapArg: string;

    if (audioClips.length === 0) {
      args.push(
        '-f',
        'lavfi',
        '-t',
        totalDur.toFixed(6),
        '-i',
        `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`,
      );
      audioMapArg = `${n}:a`;
    } else {
      const audioMeta: { trimStart: number; playDur: number; delayMs: number }[] = [];
      
      for (let k = 0; k < audioClips.length; k++) {
        const c = audioClips[k]!;
        
        const assetPath = resolveAssetPath(c.dataUri);
        if (!assetPath) {
          throw new Error(`Strict Asset Pipeline Violation: Audio clip [${c.id}] is missing a valid asset:// path. Data URI received: ${c.dataUri.substring(0, 30)}...`);
        }
        
        args.push('-i', assetPath);

        const trimStart = Math.max(0, c.sourceTrimStartSec);
        const playDur = effectiveClipSourceDurationSec(c);
        const delayMs = Math.round(Math.max(0, c.startTimeSec) * 1000);
        audioMeta.push({ trimStart, playDur, delayMs });
      }

      const audioParts: string[] = [];
      const labels: string[] = [];
      for (let k = 0; k < audioClips.length; k++) {
        const { trimStart, playDur, delayMs } = audioMeta[k]!;
        const inp = n + k;
        const lab = `sbac${k}`;
        audioParts.push(
          `[${inp}:a]atrim=start=${trimStart.toFixed(6)}:duration=${playDur.toFixed(6)},aresample=${AUDIO_SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[${lab}]`,
        );
        labels.push(`[${lab}]`);
      }

      const mixOut = 'sbamixout';
      if (audioClips.length === 1) {
        audioParts.push(`[sbac0]apad=whole_dur=${totalDur.toFixed(6)}[${mixOut}]`);
      } else {
        audioParts.push(
          `${labels.join('')}amix=inputs=${audioClips.length}:duration=longest:dropout_transition=0:normalize=1[sbamixpre]`,
        );
        audioParts.push(`[sbamixpre]apad=whole_dur=${totalDur.toFixed(6)}[${mixOut}]`);
      }

      filterComplex += `;${audioParts.join(';')}`;
      audioMapArg = `[${mixOut}]`;
    }

    const outName = 'out.' + (format === 'mov' ? 'mov' : 'mp4');
    args.push(
      '-filter_complex',
      filterComplex,
      '-map',
      '[outv]',
      '-map',
      audioMapArg,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      fr,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
    );
    if (format === 'mp4') {
      args.push('-movflags', '+faststart');
    } else {
      args.push('-f', 'mov');
    }
    args.push(outName);

    await runFfmpeg(ffmpegPath, args, tmp, totalDur, onProgress);

    await copyFile(join(tmp, outName), outputPath);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}