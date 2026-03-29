import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getProjectRoot } from '../shared/config.js';
import type { AssetManifest, ProductCategory, VideoFormat } from '../shared/types.js';

function loadSharedFile(filename: string): string {
  const path = resolve(getProjectRoot(), 'shared', filename);
  return readFileSync(path, 'utf-8');
}

export function buildScriptPrompt(
  manifest: AssetManifest,
  format: VideoFormat,
  category: ProductCategory,
  durationTarget: number,
): string {
  const brandGuidelines = loadSharedFile('brand-guidelines.md');
  const hookFormulas = loadSharedFile('hook-formulas.md');

  const reviewQuotes = manifest.topReviews
    .slice(0, 3)
    .map((r) => `"${r.text}" — ${r.reviewerName} (${r.rating}/5)`)
    .join('\n');

  return `You are a TikTok content scriptwriter for the "Health is Wealth" channel. Generate a video script for the following product.

## Product Info
- Name: ${manifest.productName}
- Price: ${manifest.price}
- Category: ${category}
- Key Benefits: ${manifest.keyBenefits.join(', ') || 'general health improvement'}
- Ingredients/Specs: ${manifest.ingredientsOrSpecs.length > 0 ? manifest.ingredientsOrSpecs.join(', ') : 'not specified'}
- Description: ${manifest.description}
- Top Reviews:
${reviewQuotes || 'No reviews available'}
- Images available: ${manifest.images.length}
- Has product video: ${manifest.hasVideo}

## Video Format: ${format}
- Target duration: ${durationTarget} seconds
- Aspect ratio: 9:16 (vertical TikTok)

## Format-Specific Instructions
${getFormatInstructions(format)}

## Brand Guidelines
${brandGuidelines}

## Hook Formulas (use one of these patterns)
${hookFormulas}

## CRITICAL RULES
- NEVER use medical claims like "cures", "treats", or "prevents"
- ONLY use "supports", "helps", "promotes", "may improve"
- No fake urgency ("limited time!!!", "buy now before it's gone")
- Hook must be readable on screen within 2 seconds
- Lead with the problem, not the product

## Output Format
Return ONLY valid JSON with this exact structure (no markdown, no code fences):
{
  "hook": {
    "text": "the hook text shown on screen (under 15 words)",
    "displaySeconds": 3
  },
  "voiceover": "full voiceover script text read aloud (empty string if format has no voiceover)",
  "overlays": [
    { "text": "on-screen text callout", "startSecond": 3, "endSecond": 6 },
    { "text": "another callout", "startSecond": 7, "endSecond": 10 }
  ],
  "caption": "TikTok post caption with product name and value prop",
  "hashtags": ["#tiktokshop", "#healthiswealth", "#category", "#healthfinds", "#tiktokmademebuyit", "#wellness"]
}`;
}

function getFormatInstructions(format: VideoFormat): string {
  switch (format) {
    case 'voiceover':
      return `- Write a voiceover script that narrates the full video
- Include 3-4 text overlays highlighting key points
- Voiceover should sound natural and conversational
- Structure: hook → problem → product intro → benefits → social proof → CTA`;

    case 'demo':
      return `- This is a visual demo format — voiceover is optional but recommended
- Focus overlays on showing the product in action
- Include text callouts for key features as they're shown
- Structure: hook → show the problem → demo the product → show results → CTA`;

    case 'hook-text':
      return `- NO voiceover — text-only with ambient/calm visuals
- Use 4-5 text overlays that tell the story
- Each overlay should be impactful and standalone readable
- Structure: hook → emotional pain point → product as solution → key benefit → CTA`;

    case 'voiceover-before-after':
      return `- Write a voiceover narrating a transformation story
- Include overlays for "before" and "after" states
- Focus on measurable or visible results
- Structure: hook → before state → product intro → after state → social proof → CTA`;
  }
}
