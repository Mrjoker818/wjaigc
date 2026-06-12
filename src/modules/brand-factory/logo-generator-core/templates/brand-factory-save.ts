/**
 * 品牌工厂保存模板
 * Logo 生成结果保存为 BrandAsset 的数据转换层
 */

export interface BrandAssetData {
  type: 'logo' | 'symbol' | 'wordmark' | 'combined';
  url: string;
  name: string;
  direction?: {
    positioning: string;
    visualMood: string;
    colorPalette: string[];
    typography: string;
    composition: string;
  };
  symbolConcept?: {
    coreMetaphor: string;
    iconForm: string;
    negativeSpaceIdea: string;
    alternativeRoutes: string[];
  };
  visualSystem?: {
    recommendedLockups: string[];
    oneColorBehavior: string;
    smallSizeBehavior: string;
    usageNotes: string;
  };
  platformPrompts?: { platform: string; prompt: string }[];
  metadata: {
    logoType: string;
    outputLayout: string;
    targetPlatform: string;
    brandName: string;
    createdAt: string;
  };
}

/**
 * 将 Logo Skill 生成结果转换为品牌资产格式
 */
export function convertToBrandAsset(params: {
  logoUrl: string;
  brandName: string;
  logoType: string;
  outputLayout: string;
  targetPlatform: string;
  direction?: Record<string, unknown>;
  symbol?: Record<string, unknown>;
  visualNotes?: Record<string, unknown>;
  platformPrompts?: { platform: string; prompt: string }[];
}): BrandAssetData {
  const { logoUrl, brandName, logoType, outputLayout, targetPlatform, direction, symbol, visualNotes, platformPrompts } = params;

  // 根据 outputLayout 决定资产类型
  let assetType: BrandAssetData['type'] = 'combined';
  if (outputLayout === 'standalone-logo' || outputLayout === 'square-avatar') {
    assetType = 'symbol';
  } else if (outputLayout === 'transparent-asset') {
    assetType = 'logo';
  }

  return {
    type: assetType,
    url: logoUrl,
    name: `${brandName} Logo`,
    direction: direction as BrandAssetData['direction'],
    symbolConcept: symbol as BrandAssetData['symbolConcept'],
    visualSystem: visualNotes as BrandAssetData['visualSystem'],
    platformPrompts,
    metadata: {
      logoType,
      outputLayout,
      targetPlatform,
      brandName,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * 构建品牌工厂更新请求体
 */
export function buildBrandFactoryUpdate(asset: BrandAssetData, projectId: string) {
  return {
    action: 'update-project',
    id: projectId,
    logoUrl: asset.url,
    logoDirection: asset.direction,
    logoSymbol: asset.symbolConcept,
    logoVisualSystem: asset.visualSystem,
    logoMetadata: asset.metadata,
  };
}
