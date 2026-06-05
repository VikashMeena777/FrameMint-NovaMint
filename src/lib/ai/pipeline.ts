/**
 * FrameMint Thumbnail Generation Pipeline v2
 *
 * 10-step process producing DUAL outputs per variant:
 *   1. Create DB record
 *   2. Groq CTR engine → N variant prompts with layouts/text/colors
 *   3. NVIDIA NIM image generation (per-variant params, Pollinations fallback)
 *   4. Post-processing (resize, color boost, sharpen)
 *   5. Text overlay rendering (SVG composite with fonts)
 *   6. Upload RAW variant to GDrive
 *   7. Upload TEXT-ON variant to GDrive
 *   8. Save variant records to Supabase
 *   9. Credit deduction
 *  10. Mark complete + return results
 *
 * Each variant produces TWO images:
 *   – raw: the AI-generated base image (for manual text editing)
 *   – textOn: the fully composed thumbnail with text overlays
 */

import { generateCTRVariants, type VariantPrompt } from './groq';
import { generateImage, type GeneratedImage } from './huggingface';
import { postProcess } from './post-process';
import { renderTextOverlay } from './text-renderer';
import { getStylePreset, getDimensions } from './prompt-builder';
import { uploadThumbnail, cleanupTempFile, deleteFile } from '@/lib/storage/gdrive';
import { createClient } from '@/lib/supabase/server';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import type { ThumbnailStyle, Platform } from '@/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GenerationParams {
  userId: string;
  title: string;
  style: ThumbnailStyle;
  platform: Platform;
  variants?: number;
  skipCreditDeduction?: boolean;
}

export interface VariantResult {
  id: string;
  /** URL for the text-on (fully composed) thumbnail */
  imageUrl: string;
  /** URL for the raw (no text) base image */
  rawImageUrl: string;
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  /** Text used on this variant */
  textOverlays: {
    primary: string;
    secondary?: string;
    emoji?: string;
  };
  /** Layout template used */
  layout: string;
}

export interface GenerationResult {
  id: string;
  title: string;
  status: 'completed' | 'failed';
  enhancedPrompt: string;
  suggestedText: string[];
  suggestedColors: string[];
  variants: VariantResult[];
  creditsUsed: number;
  creditsRemaining: number;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function generateThumbnail(
  params: GenerationParams,
): Promise<GenerationResult> {
  const { userId, title, style, platform, variants: variantCount = 4 } = params;
  const supabase = await createClient();
  const { width, height } = getDimensions(platform);
  const preset = getStylePreset(style);

  // ── STEP 1: Create thumbnail record ─────────────────────────────────
  console.log('[Pipeline] Step 1: Creating thumbnail record...');
  const { data: thumbnail, error: insertError } = await supabase
    .from('thumbnails')
    .insert({
      user_id: userId,
      title,
      prompt: title,
      style_preset: style,
      platform_preset: platform,
      status: 'generating',
    })
    .select('id')
    .single();

  if (insertError || !thumbnail) {
    throw new Error(`Failed to create thumbnail record: ${insertError?.message}`);
  }

  const uploadedGDrivePaths: string[] = [];

  try {
    // ── STEP 2: Groq CTR engine → N variant prompts ───────────────────
    console.log('[Pipeline] Step 2: Generating CTR-optimised variants via Groq...');
    const ctrResult = await generateCTRVariants(
      title,
      style,
      platform,
      Math.min(variantCount, 4),
    );

    // Save enhanced prompt (from first variant) to DB
    const firstPrompt = ctrResult.variants[0]?.imagePrompt || '';
    await supabase
      .from('thumbnails')
      .update({ enhanced_prompt: firstPrompt })
      .eq('id', thumbnail.id);

    // ── STEPS 3–7: Per-variant processing ─────────────────────────────
    const uploadedVariants: Array<{
      storageKey: string;
      rawStorageKey: string;
      imageUrl: string;
      rawImageUrl: string;
      width: number;
      height: number;
      format: string;
      sizeBytes: number;
      variant: VariantPrompt;
    }> = [];

    const tempDir = path.join(os.tmpdir(), 'framemint', thumbnail.id);
    mkdirSync(tempDir, { recursive: true });

    for (let i = 0; i < ctrResult.variants.length; i++) {
      const variant = ctrResult.variants[i];
      const variantNum = i + 1;

      try {
        // ── STEP 3: Generate raw image via NVIDIA NIM ──────────
        console.log(`[Pipeline] Step 3: Generating variant ${variantNum}/${ctrResult.variants.length}...`);
        const rawImage: GeneratedImage = await generateImage({
          prompt: variant.imagePrompt,
          negativePrompt: variant.negativePrompt,
          width,
          height,
          guidanceScale: preset.guidanceScale,
          inferenceSteps: preset.inferenceSteps,
        });

        // ── STEP 4: Post-processing ─────────────────────────────────
        console.log(`[Pipeline] Step 4: Post-processing variant ${variantNum}...`);
        const processed = await postProcess({
          imageBuffer: rawImage.buffer,
          targetWidth: width,
          targetHeight: height,
          outputFormat: 'png',
        });

        // ── STEP 5: Text overlay rendering ──────────────────────────
        console.log(`[Pipeline] Step 5: Rendering text overlay for variant ${variantNum}...`);
        const textOnBuffer = await renderTextOverlay({
          imageBuffer: processed.buffer,
          width,
          height,
          textOverlays: variant.textOverlays,
          layout: variant.layout,
          colors: variant.colors,
          style,
        });

        // ── STEPS 6 & 7: Upload BOTH variants to GDrive in parallel ──
        const rawFilename = `variant_${variantNum}_raw.png`;
        const rawTempPath = path.join(tempDir, rawFilename);
        const rawGdrivePath = `${userId}/thumbnails/${thumbnail.id}/${rawFilename}`;

        const textOnFilename = `variant_${variantNum}.png`;
        const textOnTempPath = path.join(tempDir, textOnFilename);
        const textOnGdrivePath = `${userId}/thumbnails/${thumbnail.id}/${textOnFilename}`;

        writeFileSync(rawTempPath, processed.buffer);
        writeFileSync(textOnTempPath, textOnBuffer);

        console.log(`[Pipeline] Steps 6-7: Uploading variant ${variantNum} (raw + text-on) in parallel...`);
        await Promise.all([
          uploadThumbnail(userId, thumbnail.id, rawTempPath, rawFilename),
          uploadThumbnail(userId, thumbnail.id, textOnTempPath, textOnFilename),
        ]);
        uploadedGDrivePaths.push(rawGdrivePath, textOnGdrivePath);
        cleanupTempFile(rawTempPath);
        cleanupTempFile(textOnTempPath);

        uploadedVariants.push({
          storageKey: textOnGdrivePath,
          rawStorageKey: rawGdrivePath,
          imageUrl: `/api/storage/image/${textOnGdrivePath}`,
          rawImageUrl: `/api/storage/image/${rawGdrivePath}`,
          width,
          height,
          format: 'png',
          sizeBytes: textOnBuffer.byteLength,
          variant,
        });

        console.log(`[Pipeline] Variant ${variantNum} complete (raw + text-on)`);
      } catch (variantError) {
        console.error(`[Pipeline] Variant ${variantNum} failed:`, variantError);
        // Continue with other variants
      }

      // Brief pause between variants (rate-limit courtesy)
      if (i < ctrResult.variants.length - 1) {
        await sleep(500);
      }
    }

    if (uploadedVariants.length === 0) {
      throw new Error('Failed to generate any thumbnail variants');
    }

    // ── STEP 8: Save variant records to Supabase ──────────────────────
    console.log('[Pipeline] Step 8: Saving variant records...');
    const { data: savedVariants, error: variantError } = await supabase
      .from('thumbnail_variants')
      .insert(
        uploadedVariants.map((v) => ({
          thumbnail_id: thumbnail.id,
          image_url: v.imageUrl,
          storage_key: v.storageKey,
          gdrive_path: v.storageKey,
          width: v.width,
          height: v.height,
          format: v.format,
          file_size_bytes: v.sizeBytes,
          metadata: {
            rawImageUrl: v.rawImageUrl,
            rawStorageKey: v.rawStorageKey,
            textOverlays: v.variant.textOverlays,
            layout: v.variant.layout,
            colors: v.variant.colors,
          },
        })),
      )
      .select('id, image_url, width, height, format, file_size_bytes, metadata');

    if (variantError) {
      console.error('[Pipeline] Failed to save variants:', variantError);
    }

    // ── STEP 9: Credit deduction ──────────────────────────────────────
    if (!params.skipCreditDeduction) {
      console.log('[Pipeline] Step 9: Deducting credits...');
      const { data: creditResult } = await supabase.rpc('deduct_credits', {
        p_user_id: userId,
        p_amount: 1,
        p_ref: thumbnail.id,
      });

      if (creditResult === false) {
        console.warn('[Pipeline] Insufficient credits — rolling back...');
        await supabase.from('thumbnails').delete().eq('id', thumbnail.id);
        for (const gdrivePath of uploadedGDrivePaths) {
          try { await deleteFile(gdrivePath); } catch { /* best-effort */ }
        }
        throw new Error('Insufficient credits');
      }
    } else {
      console.log('[Pipeline] Step 9: Skipping credit deduction (pre-deducted).');
    }

    // ── STEP 10: Mark completed ───────────────────────────────────────
    await supabase
      .from('thumbnails')
      .update({ status: 'completed' })
      .eq('id', thumbnail.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('credits_remaining')
      .eq('user_id', userId)
      .single();

    console.log(`[Pipeline] ✅ Done! ${uploadedVariants.length} variants generated (dual outputs each).`);

    // Collect suggested text/colors from first variant
    const firstVariant = ctrResult.variants[0];
    const suggestedText = [
      firstVariant?.textOverlays.primary || '',
      firstVariant?.textOverlays.secondary || '',
    ].filter(Boolean);
    const suggestedColors = firstVariant?.colors
      ? [firstVariant.colors.primary, firstVariant.colors.accent, firstVariant.colors.background]
      : ['#6C5CE7', '#00D2FF', '#1a1a2e'];

    return {
      id: thumbnail.id,
      title,
      status: 'completed',
      enhancedPrompt: firstPrompt,
      suggestedText,
      suggestedColors,
      variants: (savedVariants || []).map((v) => {
        const meta = (v.metadata || {}) as Record<string, unknown>;
        return {
          id: v.id,
          imageUrl: v.image_url,
          rawImageUrl: (meta.rawImageUrl as string) || v.image_url,
          width: v.width,
          height: v.height,
          format: v.format,
          sizeBytes: v.file_size_bytes || 0,
          textOverlays: (meta.textOverlays as VariantResult['textOverlays']) || { primary: '' },
          layout: (meta.layout as string) || 'full-text-overlay',
        };
      }),
      creditsUsed: 1,
      creditsRemaining: profile?.credits_remaining ?? 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Pipeline] Generation failed:', errorMessage);
    await supabase
      .from('thumbnails')
      .update({ status: 'failed', metadata: { error: errorMessage } })
      .eq('id', thumbnail.id);
    throw new Error(`Generation failed\n\n${errorMessage}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
