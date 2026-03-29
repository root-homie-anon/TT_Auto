import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { loadConfig } from '../shared/config.js';

const TTS_TIMEOUT_MS = 30_000;

export async function generateVoiceover(
  text: string,
  outputPath: string,
): Promise<boolean> {
  if (!text || text.trim().length === 0) {
    console.log('[tts] No voiceover text — skipping TTS');
    return false;
  }

  const config = loadConfig();
  const voiceId = config.tts.voiceId;

  console.log(`[tts] Generating voiceover (${text.length} chars, voice: ${voiceId})`);

  return new Promise<boolean>((resolve) => {
    const proc = execFile(
      'edge-tts',
      ['--voice', voiceId, '--text', text, '--write-media', outputPath],
      { timeout: TTS_TIMEOUT_MS },
      (error) => {
        if (error) {
          console.error(`[tts] edge-tts failed: ${error.message}`);
          resolve(false);
          return;
        }
        if (existsSync(outputPath)) {
          console.log(`[tts] Voiceover saved: ${outputPath}`);
          resolve(true);
        } else {
          console.error('[tts] edge-tts completed but no output file');
          resolve(false);
        }
      },
    );

    proc.on('error', (err) => {
      console.error(`[tts] Failed to spawn edge-tts: ${err.message}`);
      resolve(false);
    });
  });
}
