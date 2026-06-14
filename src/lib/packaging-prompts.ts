/**
 * 品牌包装系统 Pro - Prompt 模板
 */

interface PackagingInput {
  brandName: string;
  productName: string;
  category: string;
  structure: {
    type: string;
    length?: number;
    width?: number;
    height?: number;
    capacity?: string;
    netContent?: string;
  };
  materialCraft: {
    materials: string[];
    crafts: string[];
    costLevel?: string;
  };
  outputModes: string[];
  brandAssets?: {
    logoUrl?: string;
    brandColors?: string[];
    fontStyle?: string;
    patterns?: string[];
  };
  skuMatrix?: Array<{ name: string; spec: string; isHero: boolean }>;
  uploads?: Array<{ url: string; type: string }>;
}

export function buildPackagingRenderPrompt(input: PackagingInput): string {
  const dimParts: string[] = [];
  if (input.structure.length) dimParts.push(`长${input.structure.length}`);
  if (input.structure.width) dimParts.push(`宽${input.structure.width}`);
  if (input.structure.height) dimParts.push(`高${input.structure.height}`);
  const dimStr = dimParts.length > 0 ? dimParts.join('×') + 'mm' : '';

  const skuInfo = input.skuMatrix?.length
    ? `系列SKU: ${input.skuMatrix.map(s => `${s.name}(${s.spec})`).join('、')}`
    : '';

  const colorInfo = input.brandAssets?.brandColors?.length
    ? `品牌色: ${input.brandAssets.brandColors.join('、')}`
    : '';

  return `为品牌「${input.brandName}」设计一套商业级包装效果图。
产品名称：${input.productName}
品类：${input.category}
包装结构：${input.structure.type}${dimStr ? '，规格：' + dimStr : ''}
材质：${input.materialCraft?.materials?.join('、') || '未指定'}
工艺：${input.materialCraft?.crafts?.join('、') || '未指定'}
${skuInfo ? skuInfo + '\n' : ''}${colorInfo ? colorInfo + '\n' : ''}
设计要求：
1. 包装需要具有真实商业落地感，专业摄影级效果图。
2. 保持品牌名「${input.brandName}」清晰可见。
3. 视觉风格高级、干净、专业。
4. 材质表现真实，包括纸张质感、哑膜、烫金、压纹、局部UV等细节。
5. 输出适合品牌提案、电商展示和线下货架展示。
6. 不要生成乱码文字，不要出现错误品牌名，不要出现无关品牌。
输出方向：${input.outputModes.join('、')}`;
}

export function buildPackagingFlatPrompt(input: PackagingInput): string {
  return `为品牌「${input.brandName}」的「${input.productName}」生成包装展开图。
包装结构：${input.structure.type}
材质工艺：${input.materialCraft?.materials?.join('、') || '未指定'} / ${input.materialCraft?.crafts?.join('、') || '未指定'}
画面要求：
1. 以包装平面展开图形式呈现。
2. 包含正面、背面、侧面、顶部、底部。
3. 需要有品牌Logo区、产品名称区、卖点区、成分区、条码区、信息区。
4. 展开图需要具备真实包装设计逻辑。
5. 这是视觉展开图/结构参考展开图，不是最终印刷刀版。
6. 尽量减少复杂小字，避免乱码。`;
}

export function buildPackagingCopywritingPrompt(input: PackagingInput): string {
  return `为品牌「${input.brandName}」的「${input.productName}」生成包装文案。
品类：${input.category}
包装结构：${input.structure.type}

请生成以下内容：
1. 产品卖点文案（3-5个，每句8字以内）
2. 成分说明文案
3. 使用方法文案
4. 品牌Slogan
5. 注意事项文案

要求：
- 文案需要符合${input.category}品类调性
- 语言简洁有力，适合包装排版
- 不要过于夸张，保持商业落地感`;
}

export function buildPackagingScenePrompt(input: PackagingInput): string {
  return `为品牌「${input.brandName}」的「${input.productName}」生成包装场景展示图。
包装结构：${input.structure.type}
材质：${input.materialCraft?.materials?.join('、') || '未指定'}

场景要求：
1. 产品在高端零售环境中的场景展示。
2. 光线柔和高级，产品质感清晰。
3. 可包含货架陈列、橱窗展示、电商主图风格。
4. 保持品牌名清晰可见。
5. 不要出现乱码文字。`;
}

export function buildPackagingShelfPrompt(input: PackagingInput): string {
  return `为品牌「${input.brandName}」的「${input.productName}」生成货架陈列效果图。
品类：${input.category}
包装结构：${input.structure.type}

陈列要求：
1. 多款产品整齐排列在超市/美妆店货架上。
2. 货架环境真实，有同类竞品对比效果更佳。
3. 主推产品位于视线最佳位置。
4. 品牌识别度高，系列感强。
5. 不要出现乱码文字。`;
}

export function buildPackagingSeriesPrompt(input: PackagingInput): string {
  const skuInfo = input.skuMatrix?.length
    ? `系列包含: ${input.skuMatrix.map(s => s.name).join('、')}`
    : '系列包含多个SKU';

  return `为品牌「${input.brandName}」生成系列包装全家福图。
${skuInfo}
包装结构：${input.structure.type}
材质：${input.materialCraft.materials.join('、')}

画面要求：
1. 全系列产品统一排列展示。
2. 系列感强，视觉统一但有区分。
3. 摆放美观，适合品牌画册和电商Banner。
4. 品牌名清晰可见，不要出现乱码文字。`;
}
