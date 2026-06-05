/**
 * NVIDIA NIM — Image Generation Module
 *
 * Uses NVIDIA API Catalog (build.nvidia.com) for text-to-image generation.
 * Free tier: 40 requests/minute, no credit card required.
 *
 * Models (tried in order):
 *   1. stabilityai/stable-diffusion-xl
 *   2. stabilityai/stable-diffusion-3-5-large
 *
 * API Key: https://build.nvidia.com → Get API Key (nvapi-...)
 * Env var: NVIDIA_NIM_API_KEY
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GenerateImageOptions {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  guidanceScale?: number;
  inferenceSteps?: number;
}

export interface GeneratedImage {
  buffer: Buffer;
  contentType: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NVIDIA_BASE_URL = 'https://ai.api.nvidia.com/v1/genai';
const REQUEST_TIMEOUT = 120_000;
const MAX_RETRIES = 3;

/** Models tried in priority order */
const MODELS = [
  'stabilityai/stable-diffusion-xl',
  'stabilityai/stable-diffusion-3-5-large',
] as const;

// ---------------------------------------------------------------------------
// NVIDIA NIM Response types
// ---------------------------------------------------------------------------

interface NvidiaArtifact {
  base64?: string;
  finishReason?: string;
  seed?: number;
}

interface NvidiaResponse {
  artifacts?: NvidiaArtifact[];
}

// ---------------------------------------------------------------------------
// Core: Generate image via NVIDIA NIM
// ---------------------------------------------------------------------------

async function tryModel(
  options: GenerateImageOptions,
  model: string,
  apiKey: string,
): Promise<GeneratedImage | null> {
  const { prompt, negativePrompt, guidanceScale, inferenceSteps } = options;

  // Build text_prompts array
  const textPrompts: Array<{ text: string; weight: number }> = [
    { text: prompt, weight: 1 },
  ];
  if (negativePrompt) {
    textPrompts.push({ text: negativePrompt, weight: -1 });
  }

  const cfgScale = guidanceScale ?? 5;
  const steps = inferenceSteps ?? 25;
  const seed = randomSeed();
  const url = `${NVIDIA_BASE_URL}/${model}`;

  console.log(
    `[NvidiaNIM] POST model="${model}" cfg=${cfgScale} steps=${steps} seed=${seed}`,
  );

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[NvidiaNIM] ${model} attempt ${attempt + 1}/${MAX_RETRIES}`,
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text_prompts: textPrompts,
          cfg_scale: cfgScale,
          steps,
          seed,
          sampler: 'K_DPM_2_ANCESTRAL',
          samples: 1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      // ── Handle HTTP errors ──────────────────────────────────────────
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(
          `[NvidiaNIM] ${model} HTTP ${res.status}: ${errText.substring(0, 400)}`,
        );

        // Auth errors — fatal, stop trying this model
        if ([401, 403].includes(res.status)) {
          console.error(
            `[NvidiaNIM] Auth failed (${res.status}). Check NVIDIA_NIM_API_KEY.`,
          );
          return null;
        }

        // Rate limited — respect Retry-After header
        if (res.status === 429) {
          const wait = parseInt(res.headers.get('retry-after') || '10', 10);
          console.warn(`[NvidiaNIM] Rate limited, waiting ${wait}s...`);
          await sleep(wait * 1000);
          continue;
        }

        // Server errors — retry after wait
        if (res.status >= 500) {
          await sleep(5000);
          continue;
        }

        // Other errors — skip to next model
        return null;
      }

      // ── Parse JSON response ─────────────────────────────────────────
      const json = (await res.json()) as NvidiaResponse;
      const artifact = json?.artifacts?.[0];

      if (!artifact?.base64) {
        const reason = artifact?.finishReason || 'unknown';
        console.warn(
          `[NvidiaNIM] ${model}: no base64 in response (finishReason=${reason})`,
        );

        // Content filtered — don't waste retries
        if (reason === 'CONTENT_FILTERED') {
          console.warn(`[NvidiaNIM] ${model}: prompt was flagged by safety filter`);
          return null;
        }

        continue;
      }

      // ── Decode base64 → Buffer ──────────────────────────────────────
      const buf = Buffer.from(artifact.base64, 'base64');

      if (buf.byteLength < 500) {
        console.warn(
          `[NvidiaNIM] ${model}: decoded image too small (${buf.byteLength} bytes)`,
        );
        continue;
      }

      console.log(
        `[NvidiaNIM] ✅ ${model} success — ${buf.byteLength} bytes (seed=${artifact.seed || seed})`,
      );
      return { buffer: buf, contentType: detectType(buf) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) {
        console.warn(`[NvidiaNIM] ${model}: Request timed out (${REQUEST_TIMEOUT / 1000}s)`);
      } else {
        console.warn(`[NvidiaNIM] ${model}: ${msg}`);
      }
      if (attempt < MAX_RETRIES - 1) await sleep(3000);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a single image using NVIDIA NIM.
 *
 * Tries each model in order: SDXL → SD 3.5 Large
 */
export async function generateImage(
  options: GenerateImageOptions,
): Promise<GeneratedImage> {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;

  if (!apiKey) {
    throw new Error(
      'NVIDIA_NIM_API_KEY is not set.\n\n' +
        'To fix this:\n' +
        '  1. Go to https://build.nvidia.com\n' +
        '  2. Sign in and get your API key (starts with nvapi-)\n' +
        '  3. Add it to .env.local:\n' +
        '     NVIDIA_NIM_API_KEY=nvapi-your-key-here\n' +
        '  4. Add it to Vercel Environment Variables\n' +
        '  5. Restart your dev server / redeploy',
    );
  }

  console.log(
    `[ImageGen] "${options.prompt.substring(0, 60)}..." (${options.width}×${options.height})`,
  );

  // Try each model in order
  for (const model of MODELS) {
    const result = await tryModel(options, model, apiKey);
    if (result) return result;
  }

  // All models failed
  throw new Error(
    'Image generation failed — all NVIDIA NIM models exhausted.\n\n' +
      'Models tried:\n' +
      MODELS.map((m) => `  • ${m}`).join('\n') +
      '\n\n' +
      'Possible causes:\n' +
      '  • NVIDIA API rate limit (40 req/min free tier)\n' +
      '  • API key may be invalid or expired\n' +
      '  • NVIDIA API may be experiencing issues\n\n' +
      'Solutions:\n' +
      '  1. Wait 1-2 minutes and try again\n' +
      '  2. Verify key at https://build.nvidia.com\n' +
      '  3. Check NVIDIA_NIM_API_KEY in your .env.local',
  );
}

/**
 * Generate multiple image variants.
 */
export async function generateMultipleImages(
  baseOptions: GenerateImageOptions,
  count: number,
  variantPrompts?: string[],
  variantNegatives?: string[],
): Promise<GeneratedImage[]> {
  const results: GeneratedImage[] = [];
  const errors: string[] = [];

  for (let i = 0; i < count; i++) {
    const prompt = variantPrompts?.[i] || baseOptions.prompt;
    const negativePrompt =
      variantNegatives?.[i] || baseOptions.negativePrompt;

    try {
      console.log(`[Pipeline] Generating variant ${i + 1}/${count}...`);
      const image = await generateImage({
        ...baseOptions,
        prompt,
        negativePrompt,
      });
      results.push(image);
      // Brief pause between requests (rate-limit courtesy)
      if (i < count - 1) await sleep(2000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Variant ${i + 1}: ${msg}`);
      console.error(`[Pipeline] Variant ${i + 1} failed:`, msg);
    }
  }

  if (results.length === 0) {
    throw new Error(`Failed to generate any variants.\n${errors.join('\n')}`);
  }

  console.log(`[Pipeline] Generated ${results.length}/${count} variants`);
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

function detectType(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  return 'image/png';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
