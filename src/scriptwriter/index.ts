import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getProjectRoot } from '../shared/config.js';
import { readProductQueue, writeProductQueue, appendError, readAnalystSignals } from '../shared/state.js';
import { selectFormat } from './format-selector.js';
import { buildScriptPrompt } from './prompt-builder.js';
import { parseScriptResponse, ScriptParseError } from './parser.js';
import type { AnalystSignals, QueuedProduct, AssetManifest, ProductScript, FailRecord } from '../shared/types.js';

const MAX_RETRIES = 1;
const MIN_IMAGES = 3;

function loadManifest(productId: string): AssetManifest | null {
  const path = resolve(getProjectRoot(), 'output', 'assets', productId, 'meta.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as AssetManifest;
}

function validateManifestAssets(manifest: AssetManifest): string | null {
  const existingImages = manifest.images.filter((img) => existsSync(img));
  if (existingImages.length < MIN_IMAGES) {
    return `Only ${existingImages.length}/${manifest.images.length} images exist on disk (need ${MIN_IMAGES})`;
  }
  if (manifest.hasVideo && manifest.videoPath && !existsSync(manifest.videoPath)) {
    console.log(`[scriptwriter] Product video missing at ${manifest.videoPath} — continuing without it`);
  }
  return null;
}

function saveScript(productId: string, script: ProductScript): void {
  const dir = resolve(getProjectRoot(), 'output', 'assets', productId);
  writeFileSync(resolve(dir, 'script.json'), JSON.stringify(script, null, 2), 'utf-8');
}

export async function writeScript(
  product: QueuedProduct,
  manifest: AssetManifest,
  signals?: AnalystSignals | null,
): Promise<ProductScript | null> {
  const client = new Anthropic();
  const { format, durationTarget } = selectFormat(product.category);
  const prompt = buildScriptPrompt(manifest, format, product.category, durationTarget, signals);

  console.log(`[scriptwriter] Generating script for: ${product.productName.slice(0, 60)}`);
  console.log(`[scriptwriter] Format: ${format}, Duration: ${durationTarget}s`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = message.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new ScriptParseError('No text content in API response');
      }

      const script = parseScriptResponse(
        textBlock.text,
        product.tiktokShopId,
        format,
        durationTarget,
      );

      saveScript(product.tiktokShopId, script);
      console.log(`[scriptwriter] Script saved for ${product.productName.slice(0, 50)}`);
      return script;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_RETRIES) {
        console.log(`[scriptwriter] Retry ${attempt + 1}: ${message}`);
        continue;
      }
      console.error(`[scriptwriter] Failed after ${MAX_RETRIES + 1} attempts: ${message}`);
      appendError({
        timestamp: new Date().toISOString(),
        agent: 'scriptwriter',
        message: `Script generation failed: ${message}`,
        productId: product.tiktokShopId,
      });
      return null;
    }
  }

  return null;
}

export async function writeAllScripts(): Promise<void> {
  const queue = readProductQueue();
  const pending = queue.filter((p) => p.status === 'assets_ready');

  if (pending.length === 0) {
    console.log('[scriptwriter] No products with assets ready');
    return;
  }

  // Load analyst signals once for the full run — same lazy-load pattern as researcher.
  // Freshness check happens inside buildScriptPrompt / buildHookPatternInjection.
  const signals = readAnalystSignals();

  console.log(`[scriptwriter] Processing ${pending.length} products`);

  for (const product of pending) {
    const manifest = loadManifest(product.tiktokShopId);
    if (!manifest) {
      const errorMessage = 'Asset manifest not found';
      console.error(`[scriptwriter] No manifest found for ${product.tiktokShopId} — marking as failed`);
      appendError({
        timestamp: new Date().toISOString(),
        agent: 'scriptwriter',
        message: errorMessage,
        productId: product.tiktokShopId,
      });

      const currentQueue = readProductQueue();
      const idx = currentQueue.findIndex((p) => p.id === product.id);
      if (idx !== -1) {
        const updated = currentQueue[idx]!;
        updated.status = 'script_failed';
        const failRecord: FailRecord = {
          status: 'script_failed',
          error: errorMessage,
          timestamp: new Date().toISOString(),
          attempt: (updated.failHistory?.filter((r) => r.status === 'script_failed').length ?? 0) + 1,
        };
        updated.failHistory = [...(updated.failHistory ?? []), failRecord];
        writeProductQueue(currentQueue);
      }
      continue;
    }

    const assetError = validateManifestAssets(manifest);
    if (assetError) {
      const errorMessage = `Asset validation failed: ${assetError}`;
      console.error(`[scriptwriter] Asset validation failed for ${product.tiktokShopId}: ${assetError}`);
      appendError({
        timestamp: new Date().toISOString(),
        agent: 'scriptwriter',
        message: errorMessage,
        productId: product.tiktokShopId,
      });

      const currentQueue = readProductQueue();
      const idx = currentQueue.findIndex((p) => p.id === product.id);
      if (idx !== -1) {
        const updated = currentQueue[idx]!;
        updated.status = 'script_failed';
        const failRecord: FailRecord = {
          status: 'script_failed',
          error: errorMessage,
          timestamp: new Date().toISOString(),
          attempt: (updated.failHistory?.filter((r) => r.status === 'script_failed').length ?? 0) + 1,
        };
        updated.failHistory = [...(updated.failHistory ?? []), failRecord];
        writeProductQueue(currentQueue);
      }
      continue;
    }

    const script = await writeScript(product, manifest, signals);

    const currentQueue = readProductQueue();
    const idx = currentQueue.findIndex((p) => p.id === product.id);
    if (idx !== -1) {
      const updated = currentQueue[idx]!;
      if (script) {
        updated.status = 'script_ready';
      } else {
        updated.status = 'script_failed';
        const failRecord: FailRecord = {
          status: 'script_failed',
          error: 'Script generation failed (see errors.json for details)',
          timestamp: new Date().toISOString(),
          attempt: (updated.failHistory?.filter((r) => r.status === 'script_failed').length ?? 0) + 1,
        };
        updated.failHistory = [...(updated.failHistory ?? []), failRecord];
      }
      writeProductQueue(currentQueue);
    }
  }

  console.log('[scriptwriter] Script generation complete');
}
