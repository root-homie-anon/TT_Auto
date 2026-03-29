import { execFile } from 'child_process';
import { existsSync, statSync } from 'fs';
import { buildFfmpegArgs, buildThumbnailArgs } from './ffmpeg-commands.js';
import type { TextOverlay } from '../shared/types.js';

const FFMPEG_TIMEOUT_MS = 120_000;

export interface AssemblyInput {
  images: string[];
  voiceoverPath: string | null;
  hookText: string;
  hookDisplaySeconds: number;
  overlays: TextOverlay[];
  outputPath: string;
  thumbnailPath: string;
  totalDuration: number;
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = execFile(
      'ffmpeg',
      args,
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          console.error(`[assembler] ffmpeg error: ${error.message}`);
          if (stderr) {
            const lastLines = stderr.split('\n').slice(-5).join('\n');
            console.error(`[assembler] ffmpeg stderr (last 5 lines):\n${lastLines}`);
          }
          resolve(false);
          return;
        }
        resolve(true);
      },
    );

    proc.on('error', (err) => {
      console.error(`[assembler] Failed to spawn ffmpeg: ${err.message}`);
      resolve(false);
    });
  });
}

export async function checkFfmpeg(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 5000 }, (error) => {
      if (error) {
        console.error('[assembler] ffmpeg is not installed or not in PATH');
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export async function assembleVideo(input: AssemblyInput): Promise<boolean> {
  const {
    images,
    voiceoverPath,
    hookText,
    hookDisplaySeconds,
    overlays,
    outputPath,
    thumbnailPath,
    totalDuration,
  } = input;

  if (images.length === 0) {
    console.error('[assembler] No images provided');
    return false;
  }

  // Filter to images that actually exist
  const validImages = images.filter((img) => existsSync(img));
  if (validImages.length === 0) {
    console.error('[assembler] None of the provided images exist on disk');
    return false;
  }

  const secondsPerImage = totalDuration / validImages.length;

  console.log(`[assembler] Building video: ${validImages.length} images, ${totalDuration}s total`);

  const args = buildFfmpegArgs({
    images: validImages,
    secondsPerImage,
    voiceoverPath: voiceoverPath && existsSync(voiceoverPath) ? voiceoverPath : null,
    hookText,
    hookDisplaySeconds,
    overlays,
    outputPath,
    totalDuration,
  });

  const videoOk = await runFfmpeg(args);
  if (!videoOk) return false;

  // Verify output
  if (!existsSync(outputPath)) {
    console.error('[assembler] Video file not created');
    return false;
  }

  const stat = statSync(outputPath);
  if (stat.size === 0) {
    console.error('[assembler] Video file is empty');
    return false;
  }

  console.log(`[assembler] Video created: ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

  // Extract thumbnail
  const thumbArgs = buildThumbnailArgs(outputPath, thumbnailPath);
  const thumbOk = await runFfmpeg(thumbArgs);
  if (!thumbOk) {
    console.log('[assembler] Thumbnail extraction failed (non-critical)');
  }

  return true;
}
