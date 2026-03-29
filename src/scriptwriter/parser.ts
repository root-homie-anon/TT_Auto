import type { ProductScript, VideoFormat, TextOverlay } from '../shared/types.js';

interface RawScriptResponse {
  hook?: {
    text?: string;
    displaySeconds?: number;
  };
  voiceover?: string;
  overlays?: Array<{
    text?: string;
    startSecond?: number;
    endSecond?: number;
  }>;
  caption?: string;
  hashtags?: string[];
}

export class ScriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptParseError';
  }
}

export function parseScriptResponse(
  raw: string,
  productId: string,
  format: VideoFormat,
  durationTarget: number,
): ProductScript {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed: RawScriptResponse;
  try {
    parsed = JSON.parse(cleaned) as RawScriptResponse;
  } catch {
    throw new ScriptParseError(`Failed to parse JSON response: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed.hook?.text) {
    throw new ScriptParseError('Missing hook.text in response');
  }

  if (!parsed.caption) {
    throw new ScriptParseError('Missing caption in response');
  }

  const overlays: TextOverlay[] = (parsed.overlays ?? [])
    .filter((o): o is { text: string; startSecond: number; endSecond: number } =>
      o !== null &&
      o !== undefined &&
      typeof o === 'object' &&
      typeof o.text === 'string' &&
      typeof o.startSecond === 'number' &&
      typeof o.endSecond === 'number',
    )
    .map((o) => ({
      text: o.text,
      startSecond: o.startSecond,
      endSecond: o.endSecond,
    }));

  const hashtags = Array.isArray(parsed.hashtags)
    ? parsed.hashtags.filter((h): h is string => typeof h === 'string')
    : ['#tiktokshop', '#healthiswealth', '#healthfinds'];

  return {
    productId,
    format,
    durationTargetSeconds: durationTarget,
    hook: {
      text: parsed.hook.text,
      displaySeconds: parsed.hook.displaySeconds ?? 3,
    },
    voiceover: typeof parsed.voiceover === 'string' ? parsed.voiceover : '',
    overlays,
    caption: parsed.caption,
    hashtags,
    writtenAt: new Date().toISOString(),
  };
}
