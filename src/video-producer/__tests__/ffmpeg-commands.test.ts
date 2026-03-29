import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/shared/config.js', async () => ({
  loadConfig: () => ({
    video: { fontPath: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
  }),
}));

// Also mock relative path used inside ffmpeg-commands.ts itself
vi.mock('../../shared/config.js', () => ({
  loadConfig: () => ({
    video: { fontPath: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

import {
  buildFfmpegArgs,
  buildSlideshowInputArgs,
  buildZoompanFilter,
} from '../ffmpeg-commands.js';

import type { TextOverlay } from '../../shared/types.js';

const IMAGES = ['/assets/img1.jpg', '/assets/img2.jpg', '/assets/img3.jpg'];
const VOICEOVER = '/output/voice.mp3';
const OUTPUT = '/output/final.mp4';

describe('buildSlideshowInputArgs', () => {
  it('generates -loop -t -i args for each image', () => {
    const args = buildSlideshowInputArgs(IMAGES, 5);
    expect(args).toEqual([
      '-loop', '1', '-t', '5', '-i', '/assets/img1.jpg',
      '-loop', '1', '-t', '5', '-i', '/assets/img2.jpg',
      '-loop', '1', '-t', '5', '-i', '/assets/img3.jpg',
    ]);
  });

  it('returns empty array for empty image list', () => {
    expect(buildSlideshowInputArgs([], 5)).toEqual([]);
  });

  it('uses provided secondsPerImage value', () => {
    const args = buildSlideshowInputArgs(['/img.jpg'], 8);
    expect(args).toContain('8');
  });
});

describe('buildZoompanFilter', () => {
  it('contains a concat filter for all images', () => {
    const filter = buildZoompanFilter(3, 5);
    expect(filter).toContain('concat=n=3');
  });

  it('alternates zoom-in and pan effects (even index = zoom)', () => {
    const filter = buildZoompanFilter(2, 5);
    // First image (index 0): zoom — contains zoom expression
    expect(filter).toContain("zoom+0.0015");
    // Second image (index 1): pan — contains x+2 pan expression
    expect(filter).toContain("x+2");
  });

  it('outputs to [slideshow] label', () => {
    const filter = buildZoompanFilter(2, 5);
    expect(filter).toContain('[slideshow]');
  });

  it('uses correct frame count (secondsPerImage * 30fps)', () => {
    const filter = buildZoompanFilter(1, 4);
    // 4 seconds * 30fps = 120 frames
    expect(filter).toContain('d=120');
  });
});

describe('buildFfmpegArgs', () => {
  const baseParams = {
    images: IMAGES,
    secondsPerImage: 5,
    voiceoverPath: VOICEOVER,
    hookText: 'Try this today!',
    hookDisplaySeconds: 3,
    overlays: [] as TextOverlay[],
    outputPath: OUTPUT,
    totalDuration: 20,
  };

  it('includes voiceover input when voiceoverPath is provided', () => {
    const args = buildFfmpegArgs(baseParams);
    expect(args).toContain(VOICEOVER);
  });

  it('omits voiceover input and audio map when voiceoverPath is null', () => {
    const args = buildFfmpegArgs({ ...baseParams, voiceoverPath: null });
    expect(args).not.toContain(VOICEOVER);
    expect(args).not.toContain('-c:a');
    expect(args).not.toContain('aac');
  });

  it('includes -filter_complex argument', () => {
    const args = buildFfmpegArgs(baseParams);
    expect(args).toContain('-filter_complex');
  });

  it('maps the [textout] video stream', () => {
    const args = buildFfmpegArgs(baseParams);
    const mapIndex = args.indexOf('-map');
    expect(mapIndex).toBeGreaterThanOrEqual(0);
    expect(args[mapIndex + 1]).toBe('[textout]');
  });

  it('uses libx264 video codec', () => {
    const args = buildFfmpegArgs(baseParams);
    expect(args).toContain('libx264');
  });

  it('includes total duration as the last -t argument', () => {
    const args = buildFfmpegArgs(baseParams);
    // -t appears multiple times: once per image in buildSlideshowInputArgs, then once
    // at the end for total duration. lastIndexOf finds the final occurrence.
    const tIndex = args.lastIndexOf('-t');
    expect(tIndex).toBeGreaterThanOrEqual(0);
    expect(args[tIndex + 1]).toBe('20');
  });

  it('includes output path as last argument', () => {
    const args = buildFfmpegArgs(baseParams);
    expect(args[args.length - 1]).toBe(OUTPUT);
  });

  it('includes -y overwrite flag', () => {
    const args = buildFfmpegArgs(baseParams);
    expect(args).toContain('-y');
  });

  it('maps audio to correct stream index when voiceover present', () => {
    // 3 images + 1 voiceover input => audio is at index 3
    const args = buildFfmpegArgs(baseParams);
    expect(args).toContain(`${IMAGES.length}:a`);
  });

  it('includes overlays in the filter chain', () => {
    const overlays: TextOverlay[] = [
      { text: 'Key Benefit 1', startSecond: 5, endSecond: 8 },
    ];
    const args = buildFfmpegArgs({ ...baseParams, overlays });
    const filterComplex = args[args.indexOf('-filter_complex') + 1] as string;
    expect(filterComplex).toContain('Key Benefit 1');
  });
});

describe('escapeFilterText (via buildFfmpegArgs filter output)', () => {
  // escapeFilterText is private but its output is visible in the -filter_complex argument
  function getFilterComplex(hookText: string): string {
    const args = buildFfmpegArgs({
      images: ['/img.jpg'],
      secondsPerImage: 5,
      voiceoverPath: null,
      hookText,
      hookDisplaySeconds: 3,
      overlays: [],
      outputPath: '/out.mp4',
      totalDuration: 20,
    });
    return args[args.indexOf('-filter_complex') + 1] as string;
  }

  it('escapes backslashes', () => {
    const filter = getFilterComplex('Hello\\World');
    expect(filter).toContain('Hello\\\\World');
  });

  it('escapes single quotes', () => {
    const filter = getFilterComplex("It's amazing");
    expect(filter).toContain("It'\\''s amazing");
  });

  it('escapes colons', () => {
    const filter = getFilterComplex('Result: 100%');
    expect(filter).toContain('Result\\:');
  });

  it('escapes square brackets', () => {
    const filter = getFilterComplex('Feature [NEW]');
    expect(filter).toContain('Feature \\[NEW\\]');
  });

  it('leaves plain text unmodified', () => {
    const filter = getFilterComplex('Try this today');
    expect(filter).toContain('Try this today');
  });
});
