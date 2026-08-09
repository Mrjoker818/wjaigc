import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { getPublicModelCatalogSnapshot } from '@/lib/server-api-config';
import { getChatModelCredits, getImageModelCredits, getVideoModelCreditsPerSecond } from '@/lib/credits';
import { loadCreditPricingConfig, saveCreditPricingConfig, buildPricingKey, type ModelCreditEntry } from '@/lib/credit-pricing';
import { getBillingModelCategory } from '@/lib/billing-model-category';
import { IMAGE_MODEL_CREDITS } from '@/lib/credits-constants';
import { resolveTaskModelCatalogResultFromSnapshot, taskModelKey } from '@/lib/task-core/model-catalog';

export const dynamic = 'force-dynamic';

function defaultCredits(modelType: string, model: string): { credits: number; unit: 'per-image' | 'per-second' | 'per-call' } {
  if (modelType === 'video') return { credits: getVideoModelCreditsPerSecond(model), unit: 'per-second' };
  if (modelType === 'chat') return { credits: getChatModelCredits(model), unit: 'per-call' };
  return { credits: getImageModelCredits(model), unit: 'per-image' };
}

function defaultQualityTiers(modelType: string, model: string): Record<string, number> | undefined {
  if (modelType !== 'image') return undefined;
  const entry = IMAGE_MODEL_CREDITS[model];
  if (entry?.quality && typeof entry.quality === 'object') {
    return entry.quality as Record<string, number>;
  }
  return undefined;
}

function defaultResolutionTiers(modelType: string, model: string): Record<string, number> | undefined {
  if (modelType !== 'image') return undefined;
  const entry = IMAGE_MODEL_CREDITS[model];
  if (entry?.resolution && typeof entry.resolution === 'object') {
    return entry.resolution as Record<string, number>;
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });

  const [snapshot, config] = await Promise.all([
    getPublicModelCatalogSnapshot(),
    loadCreditPricingConfig(),
  ]);
  const catalog = resolveTaskModelCatalogResultFromSnapshot(
    snapshot.models,
    admin,
    snapshot.configuredProviders,
  );
  const providerNames = new Map(snapshot.configuredProviders.map(provider => [
    provider.id,
    provider.displayName || provider.name || provider.id,
  ]));
  const models = snapshot.models
    .filter(model => catalog.authorizedModelKeys.has(taskModelKey(model.providerId, model.id)))
    .map(modelInfo => {
      const model = modelInfo.id;
      const providerId = modelInfo.providerId;
      const modelType = catalog.effectiveModelTypes.get(taskModelKey(providerId, model)) || modelInfo.type;
      const billingCategory = getBillingModelCategory(modelType);
      const fallback = defaultCredits(modelType, model);
      const compoundKey = buildPricingKey(providerId, model);
      // Try provider-specific key first, then model-only key (backward compat)
      const configured = config.modelCredits[compoundKey] ?? config.modelCredits[model];
      const refQuality = defaultQualityTiers(modelType, model);
      const refResolution = defaultResolutionTiers(modelType, model);

      // Determine source and quality/resolution tiers
      let source: 'reference' | 'custom' = 'reference';
      let credits: number = fallback.credits;
      let quality: Record<string, number> | undefined = refQuality;
      let resolution: Record<string, number> | undefined = refResolution;
      let tokenPricing: { input: number; output: number } | undefined;

      if (configured !== undefined) {
        source = 'custom';
        if (typeof configured === 'number') {
          credits = configured;
        } else {
          credits = configured.credits;
          if (configured.quality) quality = configured.quality;
          if (configured.resolution) resolution = configured.resolution;
          if (configured.tokenPricing) tokenPricing = configured.tokenPricing;
        }
      }

      return {
        providerId,
        providerName: providerNames.get(providerId) || providerId,
        model,
        modelType,
        billingCategory,
        credits,
        unit: fallback.unit,
        source,
        quality,
        resolution,
        // LLM Token 计费（积分/1M tokens）；配置后按实际 usage 结算，credits 作为预估预扣
        tokenPricing,
      };
    });

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
