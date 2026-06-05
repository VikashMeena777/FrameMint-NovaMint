/**
 * NVIDIA NIM — Image Generation Module
 *
 * Uses NVIDIA API Catalog (build.nvidia.com) for text-to-image generation.
 * Free tier: 40 requests/minute, no credit card required.
 *
 * Models (tried in order):
 *   1. black-forest-labs/flux.2-klein-4b  (FLUX — fast, high quality)
 *   2. stabilityai/stable-diffusion-xl     (SDXL — reliable fallback)
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

// ---------------------------------------------------------------------------
// Model definitions — each model has its own payload format
// ---------------------------------------------------------------------------

interface ModelConfig {
  id: string;
  buildPayload: (options: GenerateImageOptions) => Record<string, unknown>;
  parseResponse: (json: unknown) => string | null; // returns base64 or null
}

const MODELS: ModelConfig[] = [
  // ── PRIMARY: FLUX.2-klein-4b ────────────────────────────────────────
  // Uses simple { prompt, width, height, seed, steps } format
  {
    id: 'black-forest-labs/flux.2-klein-4b',
    buildPayload: (options) => {
      const payload: Record<string, unknown> = {
        prompt: options.prompt,
        width: clampFluxSize(options.width),
        height: clampFluxSize(options.height),
        seed: randomSeed(),
        steps: options.inferenceSteps ?? 4,
      };
      return payload;
    },
    parseResponse: (json) => {
      // FLUX returns { artifacts: [{ base64, finishReason, seed }] }
      // OR it may return { b64_json: "..." } or { data: [{ b64_json }] }
      const body = json as Record<string, unknown>;

      // Format 1: artifacts array
      if (body.artifacts && Array.isArray(body.artifacts)) {
        const art = body.artifacts[0] as Record<string, unknown> | undefined;
        if (art?.base64 && typeof art.base64 === 'string') return art.base64;
      }

      // Format 2: direct b64_json
      if (body.b64_json && typeof body.b64_json === 'string') {
        return body.b64_json;
      }

      // Format 3: data array (OpenAI-compatible)
      if (body.data && Array.isArray(body.data)) {
        const entry = body.data[0] as Record<string, unknown> | undefined;
        if (entry?.b64_json && typeof entry.b64_json === 'string') return entry.b64_json;
      }

      return null;
    },
  },

  // ── FALLBACK: Stable Diffusion XL ───────────────────────────────────
  // Uses { text_prompts: [{ text, weight }], cfg_scale, steps } format
  {
    id: 'stabilityai/stable-diffusion-xl',
    buildPayload: (options) => {
      const textPrompts: Array<{ text: string; weight: number }> = [
        { text: options.prompt, weight: 1 },
      ];
      if (options.negativePrompt) {
        textPrompts.push({ text: options.negativePrompt, weight: -1 });
      }
      return {
        text_prompts: textPrompts,
        cfg_scale: options.guidanceScale ?? 5,
        steps: options.inferenceSteps ?? 25,
        seed: randomSeed(),
        sampler: 'K_DPM_2_ANCESTRAL',
        samples: 1,
      };
    },
    parseResponse: (json) => {
      const body = json as Record<string, unknown>;
      if (body.artifacts && Array.isArray(body.artifacts)) {
        const art = body.artifacts[0] as Record<string, unknown> | undefined;
        if (art?.base64 && typeof art.base64 === 'string') return art.base64;
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Core: Generate image via NVIDIA NIM
// ---------------------------------------------------------------------------

async function tryModel(
  options: GenerateImageOptions,
  model: ModelConfig,
  apiKey: string,
): Promise<GeneratedImage | null> {
  const payload = model.buildPayload(options);
  const url = `${NVIDIA_BASE_URL}/${model.id}`;

  console.log(
    `[NvidiaNIM] POST model="${model.id}" payload=${JSON.stringify(payload).substring(0, 200)}`,
  );

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[NvidiaNIM] ${model.id} attempt ${attempt + 1}/${MAX_RETRIES}`,
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
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      // ── Handle HTTP errors ──────────────────────────────────────────
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(
          `[NvidiaNIM] ${model.id} HTTP ${res.status}: ${errText.substring(0, 400)}`,
        );

        // Auth errors — fatal
        if ([401, 403].includes(res.status)) {
          console.error(
            `[NvidiaNIM] Auth failed (${res.status}). Check NVIDIA_NIM_API_KEY.`,
          );
          return null;
        }

        // Rate limited
        if (res.status === 429) {
          const wait = parseInt(res.headers.get('retry-after') || '10', 10);
          console.warn(`[NvidiaNIM] Rate limited, waiting ${wait}s...`);
          await sleep(wait * 1000);
          continue;
        }

        // Server errors — retry
        if (res.status >= 500) {
          await sleep(5000);
          continue;
        }

        return null;
      }

      // ── Parse response ──────────────────────────────────────────────
      const json = await res.json();
      const base64 = model.parseResponse(json);

      if (!base64) {
        console.warn(
          `[NvidiaNIM] ${model.id}: no image data in response. Keys: ${Object.keys(json as object).join(', ')}`,
        );

        // Check for content filtering
        const body = json as Record<string, unknown>;
        if (body.artifacts && Array.isArray(body.artifacts)) {
          const art = body.artifacts[0] as Record<string, unknown> | undefined;
          if (art?.finishReason === 'CONTENT_FILTERED') {
            console.warn(`[NvidiaNIM] ${model.id}: prompt flagged by safety filter`);
            return null;
          }
        }

        continue;
      }

      // ── Decode base64 → Buffer ──────────────────────────────────────
      const buf = Buffer.from(base64, 'base64');

      if (buf.byteLength < 500) {
        console.warn(
          `[NvidiaNIM] ${model.id}: decoded image too small (${buf.byteLength} bytes)`,
        );
        continue;
      }

      console.log(
        `[NvidiaNIM] ✅ ${model.id} success — ${buf.byteLength} bytes`,
      );
      return { buffer: buf, contentType: detectType(buf) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) {
        console.warn(`[NvidiaNIM] ${model.id}: Timeout (${REQUEST_TIMEOUT / 1000}s)`);
      } else {
        console.warn(`[NvidiaNIM] ${model.id}: ${msg}`);
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
 * Tries: FLUX.2-klein-4b (primary) → SDXL (fallback)
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
        '  3. Add to .env.local: NVIDIA_NIM_API_KEY=nvapi-your-key\n' +
        '  4. Add to Vercel Environment Variables\n' +
        '  5. Restart dev server / redeploy',
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

  throw new Error(
    'Image generation failed — all NVIDIA NIM models exhausted.\n\n' +
      'Models tried:\n' +
      MODELS.map((m) => `  • ${m.id}`).join('\n') +
      '\n\n' +
      'Possible causes:\n' +
      '  • Rate limit hit (40 req/min free tier)\n' +
      '  • API key invalid or expired\n' +
      '  • NVIDIA API outage\n\n' +
      'Solutions:\n' +
      '  1. Wait 1-2 minutes and retry\n' +
      '  2. Verify key at https://build.nvidia.com\n' +
      '  3. Check NVIDIA_NIM_API_KEY in .env.local',
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

/** Clamp to FLUX-compatible dimensions (multiple of 64, min 256, max 1440) */
function clampFluxSize(size: number): number {
  return Math.min(Math.max(Math.round(size / 64) * 64, 256), 1440);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
