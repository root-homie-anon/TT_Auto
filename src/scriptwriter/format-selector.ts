import type { ProductCategory, VideoFormat } from '../shared/types.js';

interface FormatConfig {
  format: VideoFormat;
  durationTarget: number;
}

const FORMAT_MAP: Record<ProductCategory, FormatConfig> = {
  'supplements': { format: 'voiceover', durationTarget: 20 },
  'fitness-tools': { format: 'demo', durationTarget: 30 },
  'recovery': { format: 'demo', durationTarget: 30 },
  'sleep-wellness': { format: 'hook-text', durationTarget: 20 },
  'weight-management': { format: 'voiceover-before-after', durationTarget: 25 },
  'general-health': { format: 'voiceover', durationTarget: 20 },
};

export function selectFormat(category: ProductCategory): FormatConfig {
  return FORMAT_MAP[category];
}
