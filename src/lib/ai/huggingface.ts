/**
 * Image generation module — NVIDIA NIM (primary) + Pollinations.ai (fallback).
 *
 * Provider priority:
 *   1. NVIDIA NIM API Catalog (free tier, 40 RPM)
 *      - black-forest-labs/flux.2-klein-4b
 *      - stabilityai/stable-diffusion-3-5-large (fallback model)
 *   2. Pollinations.ai GET endpoint (free, last resort)
 *
 * NVIDIA NIM API key: https://build.nvidia.com → Get API Key (nvapi-...)
 * Pollinations key:   https://enter.pollinations.ai
 */

// ---------------------------------------------------------------------------
// Public types (unchanged API — pipeline.ts imports these)
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

const REQUEST_TIMEOUT = 120_000;
const MAX_RETRIES = 2;

/** NVIDIA NIM models in priority order */
const NVIDIA_MODELS = [
  'black-forest-labs/flux.2-klein-4b',
  'stabilityai/stable-diffusion-3-5-large',
] as const;

/** Pollinations models (fallback only) */
const POLLINATIONS_MODELS = ['flux', 'zimage'] as const;

// ---------------------------------------------------------------------------
// NVIDIA NIM — Primary Provider
// ---------------------------------------------------------------------------

/**
 * NVIDIA NIM API Catalog — text-to-image generation.
 *
 * Endpoint: POST https://ai.api.nvidia.com/v1/genai/{model}
 * Auth:     Bearer nvapi-...
 * Response: { artifacts: [{ base64: "...", finishReason: "SUCCESS" }] }
 */
async function tryNvidiaNim(
  options: GenerateImageOptions,
  model: string,
): Promise<GeneratedImage | null> {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!apiKey) {
    console.warn('[NvidiaNIM] NVIDIA_NIM_API_KEY not set — skipping');
    return null;
  }

  const { prompt, negativePrompt, guidanceScale, inferenceSteps } = options;

  // Build text_prompts array (positive + optional negative)
  const textPrompts: Array<{ text: string; weight: number }> = [
    { text: prompt, weight: 1 },
  ];
  if (negativePrompt) {
    textPrompts.push({ text: negativePrompt, weight: -1 });
  }

  const cfgScale = guidanceScale ?? 5;
  const steps = inferenceSteps ?? 25;
  const seed = randomSeed();

  const url = `https://ai.api.nvidia.com/v1/genai/${model}`;

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
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
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

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(
          `[NvidiaNIM] ${model} HTTP ${res.status}: ${errText.substring(0, 400)}`,
        );

        // Fatal auth errors — stop trying this model
        if ([401, 403].includes(res.status)) return null;

        // Rate limited — wait and retry
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);
          console.warn(`[NvidiaNIM] Rate limited, waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000);
          continue;
        }

        // Server error — retry after brief wait
        if (res.status >= 500) {
          await sleep(5000);
          continue;
        }

        return null;
      }

      // Parse response: { artifacts: [{ base64: "...", finishReason: "SUCCESS" }] }
      const json = (await res.json()) as {
        artifacts?: Array<{
          base64?: string;
          finishReason?: string;
          seed?: number;
        }>;
      };

      const artifact = json?.artifacts?.[0];
      if (!artifact?.base64) {
        console.warn(
          `[NvidiaNIM] ${model}: no base64 in response (finishReason=${artifact?.finishReason || 'unknown'})`,
        );

        // CONTENT_FILTERED means the prompt was flagged — don't retry
        if (artifact?.finishReason === 'CONTENT_FILTERED') {
          console.warn(`[NvidiaNIM] ${model}: content filtered by safety`);
          return null;
        }

        continue;
      }

      // Decode base64 → Buffer
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
      logError('NvidiaNIM', model, err);
      if (attempt < MAX_RETRIES - 1) await sleep(3000);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pollinations.ai — Fallback Provider
// ---------------------------------------------------------------------------

/**
 * Pollinations GET endpoint — direct binary image response.
 * Works with or without API key.
 */
async function tryPollinationsGet(
  options: GenerateImageOptions,
  model: string,
): Promise<GeneratedImage | null> {
  const { prompt, negativePrompt, width, height } = options;
  const w = clampSize(width);
  const h = clampSize(height);
  const seed = randomSeed();
  const apiKey = process.env.POLLINATIONS_API_KEY;

  const safePrompt =
    prompt.length > 1500 ? prompt.substring(0, 1500) : prompt;
  const encoded = encodeURIComponent(safePrompt);

  let url = `https://gen.pollinations.ai/image/${encoded}?model=${model}&width=${w}&height=${h}&seed=${seed}&nologo=true`;
  if (negativePrompt)
    url += `&negative_prompt=${encodeURIComponent(negativePrompt)}`;
  if (apiKey) url += `&key=${apiKey}`;

  console.log(`[Pollinations] GET model="${model}" ${w}x${h} seed=${seed}`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[Pollinations] GET ${model} attempt ${attempt + 1}/${MAX_RETRIES}`,
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(
          `[Pollinations] GET ${model} HTTP ${res.status}: ${errText.substring(0, 300)}`,
        );
        if ([401, 402, 403].includes(res.status)) return null;
        if (res.status === 429) {
          await sleep(10000);
          continue;
        }
        if (res.status >= 500) {
          await sleep(5000);
          continue;
        }
        return null;
      }

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json') || ct.includes('text/')) {
        const text = await res.text();
        console.warn(
          `[Pollinations] GET ${model}: got ${ct} instead of image: ${text.substring(0, 300)}`,
        );
        continue;
      }

      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength < 500) {
        console.warn(
          `[Pollinations] GET ${model}: image too small (${arrayBuf.byteLength} bytes)`,
        );
        continue;
      }

      const buf = Buffer.from(arrayBuf);
      const contentType = ct.includes('image/') ? ct : detectType(buf);

      console.log(
        `[Pollinations] ✅ GET ${model} success — ${buf.byteLength} bytes, ${contentType}`,
      );
      return { buffer: buf, contentType };
    } catch (err) {
      logError('Pollinations-GET', model, err);
      if (attempt < MAX_RETRIES - 1) await sleep(3000);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a single image.
 *
 * Strategy:
 *   1. NVIDIA NIM: SDXL → SD 3.5 Large
 *   2. Pollinations GET: flux → zimage (fallback)
 */
export async function generateImage(
  options: GenerateImageOptions,
): Promise<GeneratedImage> {
  console.log(
    `[ImageGen] "${options.prompt.substring(0, 60)}..." (${options.width}×${options.height})`,
  );

  // ── Provider 1: NVIDIA NIM (primary) ────────────────────────────────
  if (process.env.NVIDIA_NIM_API_KEY) {
    for (const model of NVIDIA_MODELS) {
      const result = await tryNvidiaNim(options, model);
      if (result) return result;
    }
    console.warn('[ImageGen] All NVIDIA NIM models failed, trying Pollinations fallback...');
  } else {
    console.warn('[ImageGen] NVIDIA_NIM_API_KEY not set, trying Pollinations...');
  }

  // ── Provider 2: Pollinations GET (fallback) ─────────────────────────
  for (const model of POLLINATIONS_MODELS) {
    const result = await tryPollinationsGet(options, model);
    if (result) return result;
  }

  throw new Error(
    'Image generation failed — all providers exhausted.\n\n' +
    'Tried:\n' +
    '  1. NVIDIA NIM (SDXL, SD 3.5 Large)\n' +
    '  2. Pollinations.ai (flux, zimage)\n\n' +
    'Solutions:\n' +
    '  • Set NVIDIA_NIM_API_KEY from https://build.nvidia.com\n' +
    '  • Set POLLINATIONS_API_KEY from https://enter.pollinations.ai\n' +
    '  • Wait a few minutes and retry (rate limits refill)',
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

function clampSize(size: number): number {
  return Math.min(Math.max(Math.round(size / 8) * 8, 256), 1024);
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

function detectType(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  return 'image/png';
}

function logError(provider: string, model: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('abort')) {
    console.warn(`[${provider}] ${model}: Timeout`);
  } else {
    console.warn(`[${provider}] ${model}: ${msg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
