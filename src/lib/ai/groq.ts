/**
 * Groq CTR Engine — uses Groq LLM to generate click-optimised prompts.
 *
 * For each generation request, Groq returns N distinct variant prompts,
 * each with its own text overlays, layout choice, and per-variant negative prompt.
 * Includes EXPRESSION_BOOST injection for face/subject emotional intensity.
 */

import type { ThumbnailStyle, Platform } from '@/types';
import type { LayoutType } from './layout-engine';
import type { TextColors } from './text-renderer';
import { getStylePreset } from './prompt-builder';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ---------------------------------------------------------------------------
// Expression boost — injected into every image prompt for emotional intensity
// ---------------------------------------------------------------------------

const EXPRESSION_BOOST =
  'extremely expressive face, intense emotion, dramatic expression';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VariantPrompt {
  /** Image generation prompt (SD-optimised) */
  imagePrompt: string;
  /** Variant-specific negative prompt */
  negativePrompt: string;
  /** Text to overlay on the thumbnail */
  textOverlays: {
    primary: string;
    secondary?: string;
    emoji?: string;
  };
  /** Layout template to use for text positioning */
  layout: LayoutType;
  /** Colour palette for text */
  colors: TextColors;
}

export interface CTREngineResult {
  variants: VariantPrompt[];
  /** Fallback flag — true if Groq was unavailable and we fell back */
  isFallback: boolean;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate N click-optimised variant prompts using Groq LLM.
 */
export async function generateCTRVariants(
  title: string,
  style: ThumbnailStyle,
  platform: Platform,
  count: number = 4,
): Promise<CTREngineResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[Groq] No API key — using fallback prompts');
    return { variants: buildFallbackVariants(title, style, count), isFallback: true };
  }

  const preset = getStylePreset(style);

  const systemPrompt = `You are a world-class YouTube thumbnail designer and CTR optimization expert.
Given a video title, style, and platform, generate EXACTLY ${count} DISTINCT thumbnail variant plans.

Each variant MUST have a meaningfully DIFFERENT visual concept.

ABSOLUTE RULES:

1. IMAGE PROMPT LENGTH: Image prompts MUST be under 350 characters total. Be concise and descriptive. Quality over quantity.

2. PROMPT STYLE: Write short, comma-separated visual descriptions. Example:
   "close-up of a man looking shocked at laptop screen, dramatic side lighting, dark room, cinematic, 4k photo"
   NOT long paragraphs with camera specs.

3. NO TEXT IN IMAGES: NEVER include text, words, letters, numbers, logos in the image prompt.

4. EXPRESSION: For prompts with a person: "expressive face, intense emotion"

5. TEXT LENGTH: Primary = 2-3 words MAX. Secondary = 3-5 words MAX.

6. TEXT CONTENT: Extract the most powerful words directly FROM the title.
   Examples:
   - Title "I Built a $1M App" → primary: "$1M APP", secondary: "Built From Scratch"
   - Title "This AI Tool Changed Everything" → primary: "GAME CHANGER", secondary: "The AI Tool You Need"

7. COLORS: Use HIGH CONTRAST proven combos:
   - White (#FFFFFF) on dark (#000000)
   - Yellow (#FFE500) on dark (#1a1a2e)
   - Red accent (#FF3333) with white primary

8. LAYOUT: Each variant MUST use a DIFFERENT layout.

9. NEGATIVE PROMPT: Keep short: "text, watermark, blurry, cartoon, anime, 3d render"

Respond ONLY with valid JSON:
{
  "variants": [
    {
      "imagePrompt": "short vivid scene, comma separated descriptors, max 350 chars",
      "negativePrompt": "text, watermark, blurry, cartoon",
      "textOverlays": { "primary": "2-3 WORDS", "secondary": "3-5 words" },
      "layout": "face-left-text-right" | "center-subject-top-text" | "full-text-overlay" | "split-screen",
      "colors": { "primary": "#FFFFFF", "accent": "#FFE500", "background": "#000000" }
    }
  ]
}

DO NOT include an "emoji" field.`;

  const userMessage = `Title: "${title}"
Style: ${style}
Platform: ${platform}
Variants needed: ${count}

IMPORTANT: Keep image prompts SHORT (under 350 chars). Describe the SCENE vividly but concisely.
Create ${count} DISTINCT, scroll-stopping concepts.`;

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.85,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[Groq] API error:', response.status, errText);
      return { variants: buildFallbackVariants(title, style, count), isFallback: true };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty Groq response');

    const parsed = JSON.parse(content) as { variants: VariantPrompt[] };

    // Validate and sanitise each variant
    const variants: VariantPrompt[] = (parsed.variants || []).slice(0, count).map((v): VariantPrompt => ({
      imagePrompt: injectExpressionBoost(v.imagePrompt || '', preset.promptSuffix),
      negativePrompt: `${v.negativePrompt || ''}, ${preset.negativePrompt}`.trim(),
      textOverlays: {
        primary: smartTruncate(v.textOverlays?.primary || extractKeyPhrases(title)[0], 30),
        ...(v.textOverlays?.secondary && { secondary: smartTruncate(v.textOverlays.secondary, 50) }),
        ...(v.textOverlays?.emoji && { emoji: v.textOverlays.emoji }),
      },
      layout: validateLayout(v.layout) || preset.defaultLayout,
      colors: v.colors || preset.colorPalette,
    }));

    // If we got fewer than requested, pad with fallbacks
    while (variants.length < count) {
      variants.push(buildFallbackVariants(title, style, 1)[0]);
    }

    return { variants, isFallback: false };
  } catch (error) {
    console.error('[Groq] CTR engine failed:', error);
    return { variants: buildFallbackVariants(title, style, count), isFallback: true };
  }
}

// ---------------------------------------------------------------------------
// Legacy API — kept for backward compatibility
// ---------------------------------------------------------------------------

interface EnhancePromptResult {
  enhancedPrompt: string;
  suggestedText: string[];
  suggestedColors: string[];
}

export async function enhancePrompt(
  title: string,
  style: ThumbnailStyle,
  platform: Platform,
): Promise<EnhancePromptResult> {
  const result = await generateCTRVariants(title, style, platform, 1);
  const v = result.variants[0];
  return {
    enhancedPrompt: v.imagePrompt,
    suggestedText: [v.textOverlays.primary, v.textOverlays.secondary || ''].filter(Boolean),
    suggestedColors: [v.colors.primary, v.colors.accent, v.colors.background],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_LAYOUTS: LayoutType[] = [
  'face-left-text-right',
  'center-subject-top-text',
  'full-text-overlay',
  'split-screen',
];

/**
 * Truncate text at word boundaries so we never cut a word mid-way.
 * "1M Dollar Project" with maxLen=15 → "1M Dollar" (not "1M Dollar Proje")
 */
function smartTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const words = text.split(/\s+/);
  let result = '';
  for (const word of words) {
    const test = result ? `${result} ${word}` : word;
    if (test.length > maxLen) break;
    result = test;
  }
  return result || text.slice(0, maxLen); // fallback if single word exceeds limit
}

function validateLayout(layout: string): LayoutType | null {
  return VALID_LAYOUTS.includes(layout as LayoutType) ? (layout as LayoutType) : null;
}

function injectExpressionBoost(prompt: string, _styleSuffix: string): string {
  // Keep prompts concise for FLUX models (max ~700 chars before truncation)
  const boost = `${prompt}, ${EXPRESSION_BOOST}, cinematic lighting, 4k photograph, no text, no watermark`;
  return boost.length > 700 ? boost.substring(0, 700) : boost;
}

function extractKeyPhrases(title: string): string[] {
  const phrases: string[] = [];
  const numbers = title.match(/\$?[\d,]+[kKmMbB]?\s*\w*/g);
  if (numbers) phrases.push(...numbers.map((n) => n.trim().toUpperCase()));
  const words = title.split(/\s+/);
  if (words.length <= 5) phrases.push(title.toUpperCase());
  else phrases.push(words.slice(0, 4).join(' ').toUpperCase());
  return [...new Set(phrases)].slice(0, 3);
}

function buildFallbackVariants(
  title: string,
  style: ThumbnailStyle,
  count: number,
): VariantPrompt[] {
  const preset = getStylePreset(style);
  const phrases = extractKeyPhrases(title);

  const layouts: LayoutType[] = [
    'face-left-text-right',
    'center-subject-top-text',
    'full-text-overlay',
    'split-screen',
  ];

  return Array.from({ length: count }, (_, i) => ({
    imagePrompt: injectExpressionBoost(
      `A dramatic, eye-catching thumbnail scene that visually represents "${title}". Show relevant objects, people, or scenes that connect to the topic. Cinematic lighting, vivid colors, emotional composition`,
      preset.promptSuffix,
    ),
    negativePrompt: preset.negativePrompt,
    textOverlays: {
      primary: phrases[0] || title.slice(0, 25).toUpperCase(),
      secondary: phrases[1],
    },
    layout: layouts[i % layouts.length],
    colors: preset.colorPalette,
  }));
}

export { EXPRESSION_BOOST };
