import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const maxDuration = 60;

/**
 * POST /api/generate/remove-bg
 * Remove background from an uploaded image using HuggingFace free inference API.
 *
 * Note: Background removal uses HuggingFace's free REST API (no API key required
 * for the RMBG model). This is separate from the main image generation which
 * uses NVIDIA NIM.
 *
 * Accepts: multipart/form-data with field "image" (file)
 * Returns: { imageUrl, format, sizeBytes }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Rate limit: 10 per minute
    const rl = checkRateLimit(`gen:${user.id}`, RATE_LIMITS.generation);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait.', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      );
    }

    // Check pro-tier access
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, credits_remaining')
      .eq('user_id', user.id)
      .single();

    if (!profile || profile.tier === 'free') {
      return NextResponse.json(
        {
          error: 'Background removal requires a Pro or Enterprise plan',
          code: 'UPGRADE_REQUIRED',
        },
        { status: 403 }
      );
    }

    if (profile.credits_remaining < 1) {
      return NextResponse.json(
        { error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' },
        { status: 403 }
      );
    }

    // Parse the uploaded file
    const formData = await request.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No image file provided', code: 'INVALID_INPUT' },
        { status: 400 }
      );
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File too large (max 10MB)', code: 'INVALID_INPUT' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Call HuggingFace free inference REST API for background removal
    // This uses the free public inference endpoint (no API key needed for basic usage)
    const response = await fetch(
      'https://router.huggingface.co/hf-inference/models/briaai/RMBG-1.4',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: imageBuffer,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`Remove-bg error (${response.status}):`, errorText);

      if (response.status === 503) {
        return NextResponse.json(
          {
            error: 'Background removal model is loading. Please try again in ~30s.',
            code: 'MODEL_LOADING',
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: 'Background removal failed', code: 'GENERATION_FAILED' },
        { status: 500 }
      );
    }

    const resultBuffer = Buffer.from(await response.arrayBuffer());

    // Upload to Google Drive
    const { uploadToGDrive, cleanupTempFile } = await import('@/lib/storage/gdrive');
    const { writeFileSync, mkdirSync } = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tempDir = path.default.join(os.default.tmpdir(), 'framemint', 'remove-bg');
    mkdirSync(tempDir, { recursive: true });
    const tempFile = path.default.join(tempDir, `${Date.now()}.png`);
    writeFileSync(tempFile, resultBuffer);

    const remotePath = `${user.id}/remove-bg/${Date.now()}.png`;

    try {
      const shareUrl = await uploadToGDrive(tempFile, remotePath);

      // Convert share link to direct image URL
      let imageUrl = shareUrl;
      const idMatch = shareUrl.match(/[?&]id=([^&]+)/);
      if (idMatch) {
        imageUrl = `https://drive.google.com/uc?export=view&id=${idMatch[1]}`;
      }

      // Deduct 1 credit
      await supabase.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: 1,
        p_ref: null,
      });

      return NextResponse.json({
        imageUrl,
        format: 'png',
        sizeBytes: resultBuffer.length,
      });
    } finally {
      cleanupTempFile(tempFile);
    }
  } catch (error) {
    console.error('Remove-bg error:', error);
    return NextResponse.json(
      { error: 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
