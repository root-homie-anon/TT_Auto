import { describe, it, expect } from 'vitest';
import { parseScriptResponse, ScriptParseError } from '../parser.js';
import type { VideoFormat } from '../../shared/types.js';

const FORMAT: VideoFormat = 'voiceover';
const PRODUCT_ID = 'product-abc-123';
const DURATION = 20;

function makeValidJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook: { text: 'You NEED to try this vitamin!', displaySeconds: 3 },
    voiceover: 'This supplement supports your immune system and energy levels.',
    overlays: [
      { text: '500mg Vitamin C', startSecond: 5, endSecond: 8 },
      { text: 'Only $9.99!', startSecond: 9, endSecond: 12 },
    ],
    caption: 'Check out this amazing health supplement! #tiktokshop',
    hashtags: ['#tiktokshop', '#health', '#wellness'],
    ...overrides,
  });
}

describe('parseScriptResponse', () => {
  describe('valid input', () => {
    it('parses a fully-formed JSON response correctly', () => {
      const result = parseScriptResponse(makeValidJson(), PRODUCT_ID, FORMAT, DURATION);
      expect(result.productId).toBe(PRODUCT_ID);
      expect(result.format).toBe(FORMAT);
      expect(result.durationTargetSeconds).toBe(DURATION);
      expect(result.hook.text).toBe('You NEED to try this vitamin!');
      expect(result.hook.displaySeconds).toBe(3);
      expect(result.voiceover).toBe('This supplement supports your immune system and energy levels.');
      expect(result.overlays).toHaveLength(2);
      expect(result.overlays[0]).toEqual({ text: '500mg Vitamin C', startSecond: 5, endSecond: 8 });
      expect(result.caption).toBe('Check out this amazing health supplement! #tiktokshop');
      expect(result.hashtags).toEqual(['#tiktokshop', '#health', '#wellness']);
    });

    it('strips markdown code fences before parsing', () => {
      const wrapped = '```json\n' + makeValidJson() + '\n```';
      const result = parseScriptResponse(wrapped, PRODUCT_ID, FORMAT, DURATION);
      expect(result.hook.text).toBe('You NEED to try this vitamin!');
    });

    it('strips code fences without language specifier', () => {
      const wrapped = '```\n' + makeValidJson() + '\n```';
      const result = parseScriptResponse(wrapped, PRODUCT_ID, FORMAT, DURATION);
      expect(result.hook.text).toBe('You NEED to try this vitamin!');
    });

    it('uses default displaySeconds of 3 when not provided', () => {
      const json = makeValidJson({ hook: { text: 'Test hook' } });
      const result = parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION);
      expect(result.hook.displaySeconds).toBe(3);
    });

    it('uses default hashtags when hashtags field is missing', () => {
      const json = makeValidJson({ hashtags: undefined });
      const result = parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION);
      expect(result.hashtags).toEqual(['#tiktokshop', '#healthiswealth', '#healthfinds']);
    });

    it('uses empty string for voiceover when field is missing', () => {
      const json = makeValidJson({ voiceover: undefined });
      const result = parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION);
      expect(result.voiceover).toBe('');
    });

    it('filters out malformed overlay objects missing required fields', () => {
      const json = makeValidJson({
        overlays: [
          { text: 'Valid Overlay', startSecond: 2, endSecond: 5 },
          { text: 'Missing end' },               // missing endSecond
          { startSecond: 3, endSecond: 6 },       // missing text
          { text: 'No start', endSecond: 8 },     // missing startSecond
          null,                                   // null entry
        ],
      });
      const result = parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION);
      expect(result.overlays).toHaveLength(1);
      expect(result.overlays[0]!.text).toBe('Valid Overlay');
    });

    it('returns empty overlays when overlays field is missing', () => {
      const json = makeValidJson({ overlays: undefined });
      const result = parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION);
      expect(result.overlays).toEqual([]);
    });

    it('sets writtenAt to a valid ISO date string', () => {
      const result = parseScriptResponse(makeValidJson(), PRODUCT_ID, FORMAT, DURATION);
      expect(() => new Date(result.writtenAt)).not.toThrow();
      expect(new Date(result.writtenAt).getTime()).not.toBeNaN();
    });
  });

  describe('error cases', () => {
    it('throws ScriptParseError on completely malformed JSON', () => {
      expect(() => parseScriptResponse('not valid json at all', PRODUCT_ID, FORMAT, DURATION))
        .toThrow(ScriptParseError);
    });

    it('throws ScriptParseError with descriptive message on malformed JSON', () => {
      expect(() => parseScriptResponse('{broken json', PRODUCT_ID, FORMAT, DURATION))
        .toThrow('Failed to parse JSON response');
    });

    it('throws ScriptParseError when hook.text is missing', () => {
      const json = makeValidJson({ hook: { displaySeconds: 3 } });
      expect(() => parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION))
        .toThrow(ScriptParseError);
      expect(() => parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION))
        .toThrow('Missing hook.text in response');
    });

    it('throws ScriptParseError when hook field is entirely absent', () => {
      const json = makeValidJson({ hook: undefined });
      expect(() => parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION))
        .toThrow(ScriptParseError);
    });

    it('throws ScriptParseError when caption is missing', () => {
      const json = makeValidJson({ caption: undefined });
      expect(() => parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION))
        .toThrow(ScriptParseError);
      expect(() => parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION))
        .toThrow('Missing caption in response');
    });

    it('throws ScriptParseError when caption is an empty string', () => {
      // caption is falsy when empty, same as missing
      const json = makeValidJson({ caption: '' });
      expect(() => parseScriptResponse(json, PRODUCT_ID, FORMAT, DURATION))
        .toThrow(ScriptParseError);
    });

    it('truncates the malformed JSON in the error message to 200 chars', () => {
      const longGarbage = 'x'.repeat(300);
      let caughtMessage = '';
      try {
        parseScriptResponse(longGarbage, PRODUCT_ID, FORMAT, DURATION);
      } catch (e) {
        caughtMessage = (e as Error).message;
      }
      // The error message contains "Failed to parse JSON response: " + up to 200 chars of input
      expect(caughtMessage).toContain('Failed to parse JSON response');
      // The truncated portion should not exceed 200 chars
      const afterColon = caughtMessage.split(': ').slice(1).join(': ');
      expect(afterColon.length).toBeLessThanOrEqual(200);
    });
  });
});
