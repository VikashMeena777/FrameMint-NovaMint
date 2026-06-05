'use client';

import { useState } from 'react';
import {
  Sparkles,
  Wand2,
  Monitor,
  Download,
  Heart,
  Share2,
  RotateCcw,
  Loader2,
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  Zap,
  Palette,
} from 'lucide-react';
import { useCredits } from '@/hooks/useCredits';
import { useGeneration } from '@/hooks/useGeneration';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ThumbnailStyle, Platform } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';

/* ── Style definitions with premium visual previews ─────────── */
const thumbnailStyles: {
  value: ThumbnailStyle;
  label: string;
  desc: string;
  gradient: string;
  iconEmoji: string;
  accentColor: string;
}[] = [
  {
    value: 'cinematic',
    label: 'Cinematic',
    desc: 'Film-grade visuals with dramatic lighting',
    gradient: 'linear-gradient(135deg, #1a0533 0%, #2d1b69 40%, #1a0a3e 100%)',
    iconEmoji: '🎬',
    accentColor: '#8B5CF6',
  },
  {
    value: 'gaming',
    label: 'Gaming',
    desc: 'Bold neon energy & action-packed',
    gradient: 'linear-gradient(135deg, #0a2e1a 0%, #064e3b 40%, #0a1f2e 100%)',
    iconEmoji: '🎮',
    accentColor: '#10B981',
  },
  {
    value: 'vlog',
    label: 'Vlog',
    desc: 'Personal, warm & authentic feel',
    gradient: 'linear-gradient(135deg, #2d1225 0%, #4a1942 40%, #1a0a2e 100%)',
    iconEmoji: '📷',
    accentColor: '#EC4899',
  },
  {
    value: 'educational',
    label: 'Educational',
    desc: 'Clean, informative & trustworthy',
    gradient: 'linear-gradient(135deg, #0a1a33 0%, #1e3a5f 40%, #0a1a30 100%)',
    iconEmoji: '📚',
    accentColor: '#3B82F6',
  },
  {
    value: 'podcast',
    label: 'Podcast',
    desc: 'Audio-first with bold typography',
    gradient: 'linear-gradient(135deg, #2d1f0a 0%, #6b4226 40%, #1a1408 100%)',
    iconEmoji: '🎙️',
    accentColor: '#F59E0B',
  },
  {
    value: 'minimal',
    label: 'Minimal',
    desc: 'Less is more — elegant simplicity',
    gradient: 'linear-gradient(135deg, #1a1a1f 0%, #2a2a35 40%, #0f0f14 100%)',
    iconEmoji: '✨',
    accentColor: '#94A3B8',
  },
  {
    value: 'bold-text',
    label: 'Bold Text',
    desc: 'Typography-driven, high-impact text',
    gradient: 'linear-gradient(135deg, #2d0a0a 0%, #7f1d1d 40%, #1a0808 100%)',
    iconEmoji: '🔤',
    accentColor: '#EF4444',
  },
  {
    value: 'split-screen',
    label: 'Split Screen',
    desc: 'Side-by-side comparison layouts',
    gradient: 'linear-gradient(135deg, #0a2633 0%, #115e59 40%, #0a1a20 100%)',
    iconEmoji: '⚡',
    accentColor: '#14B8A6',
  },
];

/* ── platform SVG logos (24×24, brand colours) ────────────── */
const YouTubeLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.9 31.9 0 0 0 0 12a31.9 31.9 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.9 31.9 0 0 0 24 12a31.9 31.9 0 0 0-.5-5.8Z" fill="#FF0000"/><path d="m9.6 15.6 6.3-3.6-6.3-3.6v7.2Z" fill="#fff"/></svg>
);
const InstagramLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none"><defs><radialGradient id="ig" cx="30%" cy="107%" r="150%"><stop offset="0%" stopColor="#fdf497"/><stop offset="5%" stopColor="#fdf497"/><stop offset="45%" stopColor="#fd5949"/><stop offset="60%" stopColor="#d6249f"/><stop offset="90%" stopColor="#285AEB"/></radialGradient></defs><rect width="24" height="24" rx="6" fill="url(#ig)"/><circle cx="12" cy="12" r="4.5" stroke="#fff" strokeWidth="1.5" fill="none"/><circle cx="17.5" cy="6.5" r="1.2" fill="#fff"/><rect x="3" y="3" width="18" height="18" rx="5" stroke="#fff" strokeWidth="1.5" fill="none"/></svg>
);
const XLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#000"/><path d="M16.8 4.5h2.5l-5.5 6.3 6.4 8.5h-5l-3.9-5.1-4.5 5.1H4.3l5.8-6.7L4 4.5h5.1l3.5 4.7 4.2-4.7Zm-.9 13.3h1.4L8.3 5.9H6.8l9.1 11.9Z" fill="#fff"/></svg>
);
const LinkedInLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#0A66C2"/><path d="M7.5 9.5v8H5v-8h2.5Zm-1.2-4a1.45 1.45 0 1 1 0 2.9 1.45 1.45 0 0 1 0-2.9ZM9.5 9.5h2.4v1.1h0a2.6 2.6 0 0 1 2.4-1.3c2.5 0 3 1.7 3 3.8v4.4H14.8v-3.9c0-.9 0-2.1-1.3-2.1s-1.5 1-1.5 2.1v3.9H9.5v-8Z" fill="#fff"/></svg>
);
const TikTokLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#010101"/><path d="M16.6 5a3.8 3.8 0 0 0 2.6 2.6v2.5a6.2 6.2 0 0 1-2.6-.7v4.8a5.1 5.1 0 1 1-4.4-5v2.6a2.6 2.6 0 1 0 1.9 2.5V5h2.5Z" fill="#fff"/><path d="M16.6 5a3.8 3.8 0 0 0 2.6 2.6v2.5a6.2 6.2 0 0 1-2.6-.7v4.8a5.1 5.1 0 1 1-4.4-5v2.6a2.6 2.6 0 1 0 1.9 2.5V5h2.5Z" fill="#25F4EE" fillOpacity=".3"/><path d="M15.8 5a3.8 3.8 0 0 0 2.6 2.6v2.5a6.2 6.2 0 0 1-2.6-.7v4.8a5.1 5.1 0 1 1-4.4-5.1v2.6a2.6 2.6 0 1 0 1.9 2.5V4.9h2.5Z" fill="#FE2C55" fillOpacity=".3"/></svg>
);

const platforms: { value: Platform; label: string; size: string; res: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'youtube',   label: 'YouTube',   size: '1280×720',  res: '16:9 Landscape',  icon: YouTubeLogo },
  { value: 'instagram', label: 'Instagram', size: '1080×1080', res: '1:1 Square',       icon: InstagramLogo },
  { value: 'twitter',   label: 'Twitter/X', size: '1200×675',  res: '16:9 Landscape',  icon: XLogo },
  { value: 'linkedin',  label: 'LinkedIn',  size: '1200×627',  res: '1.91:1 Wide',     icon: LinkedInLogo },
  { value: 'tiktok',    label: 'TikTok',    size: '1080×1920', res: '9:16 Portrait',   icon: TikTokLogo },
];

const slideVariants = {
  enter: { opacity: 0, x: 20 },
  center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.2 } },
};

/* ── ThumbnailResult — handles loading, retry, and display ── */
function ThumbnailResult({
  variant,
  index,
  style,
  platform,
  onDownload,
}: {
  variant: { id: string; imageUrl: string };
  index: number;
  style: string;
  platform: string;
  onDownload: (url: string, idx: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 5;

  // Build URL with cache-buster on retries so browser re-fetches
  const imgSrc = retryCount > 0
    ? `${variant.imageUrl}?t=${Date.now()}`
    : variant.imageUrl;

  const handleError = () => {
    if (retryCount < maxRetries) {
      // Auto-retry after 3s — GDrive needs a moment to propagate
      setTimeout(() => {
        setRetryCount((c) => c + 1);
      }, 3000);
    } else {
      setErrored(true);
    }
  };

  const handleManualRetry = () => {
    setErrored(false);
    setLoaded(false);
    setRetryCount(0);
  };

  return (
    <div className="group relative rounded-2xl overflow-hidden border border-white/8 bg-[var(--fm-surface)] cursor-pointer">
      {/* Skeleton loader — shown until image loads */}
      {!loaded && !errored && (
        <div className="aspect-video w-full flex flex-col items-center justify-center gap-3 bg-white/[0.03]">
          <div className="relative h-10 w-10">
            <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
            <div className="absolute inset-0 rounded-full border-2 border-t-[var(--fm-primary)] animate-spin" />
          </div>
          <p className="text-xs text-[var(--fm-text-muted)]">
            {retryCount > 0 ? `Loading image... (attempt ${retryCount + 1})` : 'Loading image...'}
          </p>
        </div>
      )}

      {/* Error state */}
      {errored && (
        <div className="aspect-video w-full flex flex-col items-center justify-center gap-3 bg-white/[0.03]">
          <AlertCircle className="h-8 w-8 text-[var(--fm-text-muted)]" />
          <p className="text-xs text-[var(--fm-text-muted)]">Image failed to load</p>
          <button
            onClick={handleManualRetry}
            className="flex items-center gap-1.5 text-xs text-[var(--fm-primary-light)] hover:underline"
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Image — hidden until loaded */}
      {!errored && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={retryCount} // Force re-mount on retry
          src={imgSrc}
          alt={`Thumbnail variant ${index + 1}`}
          className={cn(
            'w-full h-auto object-cover transition-opacity duration-500',
            loaded ? 'opacity-100' : 'opacity-0 absolute inset-0'
          )}
          onLoad={() => setLoaded(true)}
          onError={handleError}
        />
      )}

      {/* Overlay — only when loaded */}
      {loaded && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-300 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100">
          <button
            onClick={() => onDownload(variant.imageUrl, index)}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors shadow-lg"
            title="Download"
          >
            <Download className="h-5 w-5 text-white" />
          </button>
          <button
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors shadow-lg"
            title="Favourite"
          >
            <Heart className="h-5 w-5 text-white" />
          </button>
          <button
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors shadow-lg"
            title="Share"
          >
            <Share2 className="h-5 w-5 text-white" />
          </button>
        </div>
      )}

      {/* Variant label */}
      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-xs text-white/90 font-bold z-10">
        V{index + 1}
      </div>
    </div>
  );
}

export default function CreatePage() {
  const [step, setStep] = useState(1);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<ThumbnailStyle>('cinematic');
  const [platform, setPlatform] = useState<Platform>('youtube');
  const { credits, refetch: refetchCredits } = useCredits();
  const { generate, isGenerating, error: genError, result, reset } = useGeneration();

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt or video title');
      return;
    }
    if (credits && credits.remaining <= 0) {
      toast.error('No credits remaining. Upgrade your plan!');
      return;
    }

    const res = await generate({ title: prompt, style, platform });
    if (res) {
      setStep(3);
      toast.success('Thumbnails generated!');
      refetchCredits();
    } else if (genError) {
      toast.error(genError);
    }
  };

  const handleDownload = async (imageUrl: string, index: number) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `framemint-${style}-${platform}-v${index + 1}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Downloaded!');
    } catch {
      toast.error('Download failed');
    }
  };

  const handleNewGeneration = () => {
    setStep(1);
    setPrompt('');
    reset();
  };

  const steps = [
    { n: 1, label: 'Describe' },
    { n: 2, label: 'Platform' },
    { n: 3, label: 'Results' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fm-text)]" style={{ fontFamily: "'Outfit', sans-serif" }}>
            Create Thumbnail
          </h1>
          <p className="text-sm text-[var(--fm-text-secondary)] mt-1">
            Generate AI-powered thumbnails for any platform
          </p>
        </div>
        {credits && (
          <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-[var(--fm-border-purple)] bg-violet-600/8 px-4 py-2">
            <Zap className="h-4 w-4 text-[var(--fm-primary-light)]" />
            <span className="text-sm font-bold text-[var(--fm-text)]">{credits.remaining}</span>
            <span className="text-xs text-[var(--fm-text-secondary)]">credits left</span>
          </div>
        )}
      </div>

      {/* Progress stepper */}
      <div className="flex items-center">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300',
                  step > s.n
                    ? 'gradient-primary text-white'
                    : step === s.n
                      ? 'bg-violet-600/20 border-2 border-violet-500/50 text-[var(--fm-primary-light)]'
                      : 'bg-white/5 border border-white/10 text-[var(--fm-text-muted)]'
                )}
              >
                {step > s.n ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : s.n}
              </div>
              <span className={cn(
                'hidden sm:block text-sm font-semibold',
                step >= s.n ? 'text-[var(--fm-text)]' : 'text-[var(--fm-text-muted)]'
              )}>
                {s.label}
              </span>
            </div>
            {i < 2 && (
              <div className={cn('mx-4 h-px flex-1 w-14 transition-colors duration-300', step > s.n ? 'bg-violet-500/50' : 'bg-white/8')} />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ═══════════════════ Step 1: Prompt & Style ═══════════════════ */}
        {step === 1 && (
          <motion.div key="step1" variants={slideVariants} initial="enter" animate="center" exit="exit" className="space-y-6">
            {/* Prompt */}
            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/15 border border-violet-500/25">
                  <Wand2 className="h-5 w-5 text-[var(--fm-primary-light)]" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--fm-text)]" style={{ fontFamily: "'Outfit', sans-serif" }}>
                    What&apos;s your video about?
                  </h2>
                  <p className="text-sm text-[var(--fm-text-secondary)]">Describe it clearly for best results</p>
                </div>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. 'I Built a $1M App in 30 Days' — be descriptive about emotions, style, key elements..."
                className="glass-input w-full h-32 resize-none p-4 text-sm leading-relaxed"
              />
              <p className="mt-3 text-xs text-[var(--fm-text-secondary)]">
                💡 Include key emotions, visual elements, or text you want on the thumbnail
              </p>
            </div>

            {/* Style picker — PREMIUM CARDS */}
            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/15 border border-blue-500/25">
                  <Palette className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--fm-text)]" style={{ fontFamily: "'Outfit', sans-serif" }}>
                    Choose a Style
                  </h2>
                  <p className="text-sm text-[var(--fm-text-secondary)]">Pick the visual direction for your thumbnail</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {thumbnailStyles.map((s) => {
                  const isSelected = style === s.value;
                  return (
                    <button
                      key={s.value}
                      onClick={() => setStyle(s.value)}
                      className={cn(
                        'relative rounded-2xl text-left transition-all duration-250 border cursor-pointer overflow-hidden group',
                        isSelected
                          ? 'border-violet-500/50 shadow-lg shadow-violet-500/15 ring-1 ring-violet-500/20'
                          : 'border-white/6 hover:border-white/15'
                      )}
                      style={{
                        background: s.gradient,
                      }}
                    >
                      {/* Top accent bar when selected */}
                      {isSelected && (
                        <div
                          className="absolute top-0 left-0 right-0 h-[2px]"
                          style={{ background: `linear-gradient(90deg, transparent, ${s.accentColor}, transparent)` }}
                        />
                      )}

                      {/* Content */}
                      <div className="relative p-4">
                        {/* Icon & Label */}
                        <div className="flex items-center gap-2.5 mb-2">
                          <span className="text-2xl leading-none select-none">{s.iconEmoji}</span>
                          <span className="text-sm font-bold text-[var(--fm-text)] tracking-tight">{s.label}</span>
                        </div>
                        <p className="text-[11px] text-[var(--fm-text-secondary)] leading-snug">{s.desc}</p>

                        {/* Selected check */}
                        {isSelected && (
                          <div
                            className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full"
                            style={{ background: s.accentColor }}
                          >
                            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 12">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        )}
                      </div>

                      {/* Decorative glow on hover */}
                      <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                        style={{
                          background: `radial-gradient(circle at 50% 100%, ${s.accentColor}15, transparent 70%)`,
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                disabled={!prompt.trim()}
                className="btn-primary flex items-center gap-2 disabled:opacity-40"
              >
                Next: Choose Platform
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══════════════════ Step 2: Platform ═══════════════════ */}
        {step === 2 && (
          <motion.div key="step2" variants={slideVariants} initial="enter" animate="center" exit="exit" className="space-y-6">
            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600/15 border border-emerald-500/25">
                  <Monitor className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--fm-text)]" style={{ fontFamily: "'Outfit', sans-serif" }}>
                    Select Platform
                  </h2>
                  <p className="text-sm text-[var(--fm-text-secondary)]">We&apos;ll optimize dimensions and layout for your platform</p>
                </div>
              </div>

              {/* Platform cards — larger with visible resolution */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {platforms.map((p) => {
                  const isSelected = platform === p.value;
                  return (
                    <button
                      key={p.value}
                      onClick={() => setPlatform(p.value)}
                      className={cn(
                        'rounded-2xl p-5 text-center transition-all duration-250 border cursor-pointer group',
                        isSelected
                          ? 'border-violet-500/50 bg-violet-600/12 shadow-lg shadow-violet-500/10'
                          : 'border-white/6 bg-white/[0.02] hover:bg-white/5 hover:border-white/15'
                      )}
                    >
                      <div className="flex justify-center mb-3">
                        <p.icon className="h-8 w-8 transition-transform duration-200 group-hover:scale-110" />
                      </div>
                      <p className="text-sm font-bold text-[var(--fm-text)] mb-1">{p.label}</p>
                      {/* Resolution — FIXED: larger, brighter text */}
                      <p className="text-xs font-semibold text-[var(--fm-text-secondary)] font-mono tracking-wide">
                        {p.size}
                      </p>
                      <p className="text-[11px] text-[var(--fm-text-secondary)] mt-0.5">
                        {p.res}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="glass rounded-2xl p-7">
              <h2
                className="text-sm font-bold text-[var(--fm-text-secondary)] mb-5 uppercase tracking-widest"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                Generation Summary
              </h2>
              <div className="space-y-3.5">
                {[
                  { label: 'Prompt', value: prompt },
                  { label: 'Style', value: style.replace('-', ' ') },
                  { label: 'Platform', value: platforms.find(p => p.value === platform)?.label || platform },
                  { label: 'Variants', value: '4 thumbnails' },
                  { label: 'Credits cost', value: '1 credit', highlight: true },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-[var(--fm-text-secondary)] font-medium">{label}</span>
                    <span className={cn(
                      'text-right max-w-[220px] truncate capitalize font-semibold',
                      highlight ? 'text-[var(--fm-primary-light)]' : 'text-[var(--fm-text)]'
                    )}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Generating progress */}
            {isGenerating && (
              <div className="glass rounded-2xl p-6 border border-violet-500/25">
                <div className="flex items-center gap-4">
                  <div className="relative h-12 w-12 shrink-0">
                    <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-t-[var(--fm-primary)] animate-spin" />
                    <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-[var(--fm-primary)]" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[var(--fm-text)]">Crafting your thumbnails...</p>
                    <p className="text-sm text-[var(--fm-text-secondary)] mt-0.5">
                      Generating 4 unique variants — this takes about 60–90 seconds
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {genError && !isGenerating && (
              <div className="glass rounded-2xl p-5 border border-red-500/25">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-400">Generation failed</p>
                    <p className="text-xs text-red-400/70 mt-1">{genError}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => setStep(1)} className="btn-glass flex items-center gap-2">
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Thumbnails
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══════════════════ Step 3: Results ═══════════════════ */}
        {step === 3 && result && (
          <motion.div key="step3" variants={slideVariants} initial="enter" animate="center" exit="exit" className="space-y-6">
            <div className="glass rounded-2xl p-7">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--fm-text)]" style={{ fontFamily: "'Outfit', sans-serif" }}>
                    Your Thumbnails
                  </h2>
                  <p className="text-sm text-[var(--fm-text-secondary)] mt-1">
                    {result.variants.length} variants generated · {result.creditsUsed} credit used
                  </p>
                </div>
                <button onClick={handleNewGeneration} className="btn-glass text-sm flex items-center gap-2 py-2.5 px-4">
                  <RotateCcw className="h-3.5 w-3.5" />
                  New
                </button>
              </div>

              {/* Enhanced prompt */}
              {result.enhancedPrompt && (
                <div className="mb-6 rounded-xl bg-white/3 border border-white/6 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--fm-text-muted)] mb-2 font-bold">AI-Enhanced Prompt</p>
                  <p className="text-xs text-[var(--fm-text-secondary)] leading-relaxed line-clamp-2">{result.enhancedPrompt}</p>
                </div>
              )}

              {/* Suggested text overlays */}
              {result.suggestedText.length > 0 && (
                <div className="mb-6 flex flex-wrap gap-2">
                  {result.suggestedText.map((text, i) => (
                    <span key={i} className="px-3 py-1.5 rounded-full bg-violet-600/10 text-xs text-[var(--fm-primary-light)] border border-violet-500/20 font-semibold">
                      {text}
                    </span>
                  ))}
                </div>
              )}

              {/* Thumbnails grid — 2 columns for 4 variants */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {result.variants.map((variant, i) => (
                  <ThumbnailResult
                    key={variant.id}
                    variant={variant}
                    index={i}
                    style={style}
                    platform={platform}
                    onDownload={handleDownload}
                  />
                ))}
              </div>

              {/* Bottom info */}
              <div className="mt-6 flex items-center justify-between text-sm text-[var(--fm-text-secondary)] pt-5 border-t border-white/5">
                <span className="font-medium">{result.creditsRemaining} credits remaining</span>
                <div className="flex gap-2">
                  <button onClick={handleNewGeneration} className="btn-secondary text-sm py-2 px-4 flex items-center gap-2">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Generate More
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
