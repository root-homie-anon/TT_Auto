import { existsSync } from 'fs';
import { loadConfig } from '../shared/config.js';
import type { TextOverlay } from '../shared/types.js';

const RESOLUTION = '1080x1920';
const FPS = 30;

function getFontDirective(): string {
  const config = loadConfig();
  const fontPath = config.video.fontPath;
  if (!existsSync(fontPath)) {
    console.error(`[ffmpeg-commands] Font not found at: ${fontPath} — text overlays may fail`);
  }
  return `fontfile=${fontPath}`;
}

function escapeFilterText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export function buildSlideshowInputArgs(images: string[], secondsPerImage: number): string[] {
  const args: string[] = [];
  for (const img of images) {
    args.push('-loop', '1', '-t', String(secondsPerImage), '-i', img);
  }
  return args;
}

export function buildZoompanFilter(imageCount: number, secondsPerImage: number): string {
  const frames = secondsPerImage * FPS;
  const filters: string[] = [];

  for (let i = 0; i < imageCount; i++) {
    // Alternate between zoom-in and pan effects
    const isZoom = i % 2 === 0;
    if (isZoom) {
      filters.push(
        `[${i}:v]scale=1920x3413,zoompan=z='min(zoom+0.0015,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${RESOLUTION}:fps=${FPS}[v${i}]`,
      );
    } else {
      filters.push(
        `[${i}:v]scale=1920x3413,zoompan=z='1.2':x='if(eq(on,1),0,x+2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${RESOLUTION}:fps=${FPS}[v${i}]`,
      );
    }
  }

  // Concat all video streams
  const concatInputs = Array.from({ length: imageCount }, (_, i) => `[v${i}]`).join('');
  filters.push(`${concatInputs}concat=n=${imageCount}:v=1:a=0[slideshow]`);

  return filters.join(';');
}

export function buildTextOverlayFilter(
  hookText: string,
  hookDisplaySeconds: number,
  overlays: TextOverlay[],
): string {
  const filters: string[] = [];
  const font = getFontDirective();

  // Hook text — large, centered, with dark background box
  const escapedHook = escapeFilterText(hookText);
  filters.push(
    `[slideshow]drawtext=${font}:text='${escapedHook}':fontsize=64:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,${hookDisplaySeconds})'[hooked]`,
  );

  let prevLabel = 'hooked';
  for (let i = 0; i < overlays.length; i++) {
    const overlay = overlays[i]!;
    const label = `ov${i}`;
    const escapedText = escapeFilterText(overlay.text);
    filters.push(
      `[${prevLabel}]drawtext=${font}:text='${escapedText}':fontsize=48:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h*0.75:enable='between(t,${overlay.startSecond},${overlay.endSecond})'[${label}]`,
    );
    prevLabel = label;
  }

  // Rename the output label of the last filter to [textout]
  // The output label is always the last [...] in the filter string
  const lastFilter = filters[filters.length - 1]!;
  const outputLabelRegex = /\[[^\]]+\]$/;
  if (outputLabelRegex.test(lastFilter)) {
    filters[filters.length - 1] = lastFilter.replace(outputLabelRegex, '[textout]');
  } else {
    // Shouldn't happen, but safe fallback
    filters.push(`[${prevLabel}]copy[textout]`);
  }

  return filters.join(';');
}

export function buildFfmpegArgs(params: {
  images: string[];
  secondsPerImage: number;
  voiceoverPath: string | null;
  hookText: string;
  hookDisplaySeconds: number;
  overlays: TextOverlay[];
  outputPath: string;
  totalDuration: number;
}): string[] {
  const {
    images,
    secondsPerImage,
    voiceoverPath,
    hookText,
    hookDisplaySeconds,
    overlays,
    outputPath,
    totalDuration,
  } = params;

  const inputArgs = buildSlideshowInputArgs(images, secondsPerImage);

  // Add voiceover input if present
  if (voiceoverPath) {
    inputArgs.push('-i', voiceoverPath);
  }

  const zoompanFilter = buildZoompanFilter(images.length, secondsPerImage);
  const textFilter = buildTextOverlayFilter(hookText, hookDisplaySeconds, overlays);
  const filterComplex = `${zoompanFilter};${textFilter}`;

  const args = [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[textout]',
  ];

  if (voiceoverPath) {
    args.push('-map', `${images.length}:a`);
    args.push('-c:a', 'aac', '-b:a', '128k');
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-t', String(totalDuration),
    '-y',
    outputPath,
  );

  return args;
}

export function buildThumbnailArgs(videoPath: string, outputPath: string): string[] {
  return [
    '-i', videoPath,
    '-ss', '0',
    '-vframes', '1',
    '-q:v', '2',
    '-y',
    outputPath,
  ];
}
