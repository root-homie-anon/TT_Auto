import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getProjectRoot } from '../shared/config.js';
import { readProductQueue, writeProductQueue, appendError } from '../shared/state.js';
import { generateVoiceover } from './tts.js';
import { assembleVideo, checkFfmpeg } from './assembler.js';
import type { QueuedProduct, AssetManifest, ProductScript, VideoResult } from '../shared/types.js';

const MIN_IMAGES = 2;

function validateInputs(manifest: AssetManifest, script: ProductScript): string | null {
  const existingImages = manifest.images.filter((img) => existsSync(img));
  if (existingImages.length < MIN_IMAGES) {
    return `Only ${existingImages.length} images exist on disk (need ${MIN_IMAGES})`;
  }
  if (!script.hook?.text) {
    return 'Script has no hook text';
  }
  if (!script.overlays || !Array.isArray(script.overlays)) {
    return 'Script has no overlays array';
  }
  return null;
}

function todayDir(): string {
  const date = new Date().toISOString().split('T')[0]!;
  const dir = resolve(getProjectRoot(), 'output', date);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadManifest(productId: string): AssetManifest | null {
  const path = resolve(getProjectRoot(), 'output', 'assets', productId, 'meta.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as AssetManifest;
}

function loadScript(productId: string): ProductScript | null {
  const path = resolve(getProjectRoot(), 'output', 'assets', productId, 'script.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as ProductScript;
}

export async function produceVideo(
  product: QueuedProduct,
  script: ProductScript,
  manifest: AssetManifest,
): Promise<VideoResult | null> {
  console.log(`[video-producer] Producing video for: ${product.productName.slice(0, 60)}`);

  const outDir = todayDir();
  const outputPath = resolve(outDir, `${product.tiktokShopId}-final.mp4`);
  const thumbnailPath = resolve(outDir, `${product.tiktokShopId}-thumb.jpg`);

  // Generate voiceover if script has VO text
  const voiceoverRequired = script.format === 'voiceover' || script.format === 'voiceover-before-after';
  let voiceoverPath: string | null = null;
  if (script.voiceover.length > 0) {
    voiceoverPath = resolve(getProjectRoot(), 'output', 'assets', product.tiktokShopId, 'vo.mp3');
    const ttsOk = await generateVoiceover(script.voiceover, voiceoverPath);
    if (!ttsOk) {
      if (voiceoverRequired) {
        console.error(`[video-producer] TTS failed for voiceover-required format "${script.format}" — cannot produce video`);
        appendError({
          timestamp: new Date().toISOString(),
          agent: 'video-producer',
          message: `TTS failed for voiceover-required format: ${script.format}`,
          productId: product.tiktokShopId,
        });
        return null;
      }
      console.log('[video-producer] TTS failed — proceeding without voiceover (format allows it)');
      voiceoverPath = null;
    }
  }

  // Assemble video from images + script overlays
  const assembleOk = await assembleVideo({
    images: manifest.images,
    voiceoverPath,
    hookText: script.hook.text,
    hookDisplaySeconds: script.hook.displaySeconds,
    overlays: script.overlays,
    outputPath,
    thumbnailPath,
    totalDuration: script.durationTargetSeconds,
  });

  if (!assembleOk) {
    console.error(`[video-producer] Assembly failed for ${product.tiktokShopId}`);
    appendError({
      timestamp: new Date().toISOString(),
      agent: 'video-producer',
      message: 'Video assembly failed',
      productId: product.tiktokShopId,
    });
    return null;
  }

  const result: VideoResult = {
    productId: product.tiktokShopId,
    videoPath: outputPath,
    thumbnailPath,
    durationSeconds: script.durationTargetSeconds,
    format: script.format,
    generationMethod: 'ffmpeg-slideshow',
    producedAt: new Date().toISOString(),
  };

  console.log(`[video-producer] Video ready: ${outputPath}`);
  return result;
}

export async function produceAllVideos(): Promise<number> {
  // Check ffmpeg availability
  const ffmpegOk = await checkFfmpeg();
  if (!ffmpegOk) {
    console.error('[video-producer] ffmpeg not found — cannot produce videos');
    appendError({
      timestamp: new Date().toISOString(),
      agent: 'video-producer',
      message: 'ffmpeg not installed or not in PATH',
    });
    return 0;
  }

  const queue = readProductQueue();
  const pending = queue.filter((p) => p.status === 'script_ready');

  if (pending.length === 0) {
    console.log('[video-producer] No products with scripts ready');
    return 0;
  }

  console.log(`[video-producer] Processing ${pending.length} products`);
  let produced = 0;

  for (const product of pending) {
    const manifest = loadManifest(product.tiktokShopId);
    const script = loadScript(product.tiktokShopId);

    if (!manifest || !script) {
      const missing = !manifest ? 'manifest' : 'script';
      console.error(`[video-producer] Missing ${missing} for ${product.tiktokShopId} — marking as failed`);
      appendError({
        timestamp: new Date().toISOString(),
        agent: 'video-producer',
        message: `Missing ${missing} file on disk for script_ready product`,
        productId: product.tiktokShopId,
      });

      const currentQueue = readProductQueue();
      const idx = currentQueue.findIndex((p) => p.id === product.id);
      if (idx !== -1) {
        currentQueue[idx]!.status = 'video_failed';
        writeProductQueue(currentQueue);
      }
      continue;
    }

    const inputError = validateInputs(manifest, script);
    if (inputError) {
      console.error(`[video-producer] Input validation failed for ${product.tiktokShopId}: ${inputError}`);
      appendError({
        timestamp: new Date().toISOString(),
        agent: 'video-producer',
        message: `Input validation failed: ${inputError}`,
        productId: product.tiktokShopId,
      });

      const currentQueue = readProductQueue();
      const idx = currentQueue.findIndex((p) => p.id === product.id);
      if (idx !== -1) {
        currentQueue[idx]!.status = 'video_failed';
        writeProductQueue(currentQueue);
      }
      continue;
    }

    const result = await produceVideo(product, script, manifest);

    const currentQueue = readProductQueue();
    const idx = currentQueue.findIndex((p) => p.id === product.id);
    if (idx !== -1) {
      currentQueue[idx]!.status = result ? 'video_ready' : 'video_failed';
      writeProductQueue(currentQueue);
    }

    if (result) produced++;
  }

  console.log(`[video-producer] Produced ${produced} videos`);
  return produced;
}
