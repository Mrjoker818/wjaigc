import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { getApiProviders } from '@/lib/server-api-config';
import { getChatModelCredits, getImageModelCredits, getVideoModelCreditsPerSecond } from '@/lib/credits';
import { loadCreditPricingConfig, saveCreditPricingConfig, buildPricingKey, type ModelCreditEntry } from '@/lib/credit-pricing';
import { getBillingModelCategory } from '@/lib/billing-model-category';

export const dynamic = 'force-dynamic';

function defaultCredits(modelType: string, model: string): { credits: number; unit: 'per-image' | 'per-second' | 'per-call' } {
  if (modelType === 'video') return { credits: getVideoModelCreditsPerSecond(model), unit: 'per-second' };
  if (modelType === 'chat') return { credits: getChatModelCredits(model), unit: 'per-call' };
  return { credits: getImageModelCredits(model), unit: 'per-image' };
}

function defaultQualityTiers(modelType: string, model: string): Record<string, number> | undefined {
  if (modelType !== 'image') return undefined;
  const { IMAGE_MODEL_CREDITS } = require('@/lib/credits-constants');
  const entry = IMAGE_MODEL_CREDITS[model];
  if (entry?.quality && typeof entry.quality === 'object') {
    return entry.quality as Record<string, number>;
  }
  return undefined;
}

function defaultResolutionTiers(modelType: string, model: string): Record<string, number> | undefined {
  if (modelType !== 'image') return undefined;
  const { IMAGE_MODEL_CREDITS } = require('@/lib/credits-constants');
  const entry = IMAGE_MODEL_CREDITS[model];
  if (entry?.resolution && typeof entry.resolution === 'object') {
    return entry.resolution as Record<string, number>;
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });

  const [providers, config] = await Promise.all([getApiProviders(), loadCreditPricingConfig()]);
  const models = providers
    .filter(provider => provider.isEnabled !== false)
    .flatMap(provider => (provider.selectedModels || []).map(model => {
      const modelType = provider.modelType || provider.type || 'image';
      const billingCategory = getBillingModelCategory(modelType);
      const fallback = defaultCredits(modelType, model);
      const compoundKey = buildPricingKey(provider.id, model);
      // Try provider-specific key first, then model-only key (backward compat)
      const configured = config.modelCredits[compoundKey] ?? config.modelCredits[model];
      const refQuality = defaultQualityTiers(modelType, model);
      const refResolution = defaultResolutionTiers(modelType, model);

      // Determine source and quality/resolution tiers
      let source: 'reference' | 'custom' = 'reference';
      let credits: number = fallback.credits;
      let quality: Record<string, number> | undefined = refQuality;
      let resolution: Record<string, number> | undefined = refResolution;

      if (configured !== undefined) {
        source = 'custom';
        if (typeof configured === 'number') {
          credits = configured;
        } else {
          credits = configured.credits;
          if (configured.quality) quality = configured.quality;
          if (configured.resolution) resolution = configured.resolution;
        }
      }

      return {
        providerId: provider.id,
        providerName: provider.displayName || provider.name || provider.id,
        model,
        modelType,
        billingCategory,
        credits,
        unit: fallback.unit,
        source,
        quality,
        resolution,
      };
    }));

  return NextResponse.json({ success: true, models, updatedAt: config.updatedAt || null });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });

  try {
    const body = await request.json() as { modelCredits?: Record<string, unknown> };
    if (!body.modelCredits || typeof body.modelCredits !== 'object' || Array.isArray(body.modelCredits)) {
      return NextResponse.json({ success: false, error: 'modelCredits is required' }, { status: 400 });
    }
    const config = await saveCreditPricingConfig({ modelCredits: body.modelCredits as Record<string, number | ModelCreditEntry> });
    return NextResponse.json({ success: true, config });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to save pricing' }, { status: 400 });
  }
}
