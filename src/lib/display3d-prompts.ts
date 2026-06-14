/**
 * 3D 展陈系统 Pro - Prompt 模板
 */

interface Display3DInput {
  brandName: string;
  productName?: string;
  sceneType?: string;
  environment?: string;
  dimensions?: { length: number; width: number; height: number; unit: string };
  imageUsageMode?: string;
  materialStyle?: string;
  lightingStyle?: string;
  crowdStyle?: string;
  budget?: number;
  viewOptions?: string[];
  uploads?: Array<{ url: string; type: string }>;
}

export function buildDisplay3DRenderPrompt(input: Display3DInput): string {
  const dimStr = input.dimensions ? `${input.dimensions.length}×${input.dimensions.width}×${input.dimensions.height}${input.dimensions.unit}` : '未指定';

  return `为品牌「${input.brandName}」设计一个商业级3D展陈空间效果图。
产品名称：${input.productName || '品牌产品'}
展陈类型：${input.sceneType || '未指定'}
环境场景：${input.environment || '未指定'}
空间尺寸：${dimStr}
图像使用模式：${input.imageUsageMode || '未指定'}
${input.materialStyle ? `材质风格：${input.materialStyle}` : ''}
${input.lightingStyle ? `灯光氛围：${input.lightingStyle}` : ''}
${input.budget ? `预算范围：¥${input.budget.toLocaleString()}` : ''}

设计要求：
1. 生成真实商业级展陈效果图，高质量3D渲染质感。
2. 包含品牌门头、主背板、产品陈列区、打卡装置、灯箱、地贴、导视系统。
3. 空间结构合理，动线清晰，品牌识别度高。
4. 如果上传了主视觉KV，需要将其作为贴图应用到背板、门头、灯箱、地贴等位置。
5. 如果上传了空间草图或3D截图，需要保持透视关系和空间结构。
6. 真实灯光、真实材质表现。
7. 不要出现乱码文字，不要出现无关品牌。

输出视角：${input.viewOptions?.join('、') || '45度视角'}`;
}

export function buildDisplay3DDecomposePrompt(input: Display3DInput): string {
  const dimStr = input.dimensions ? `${input.dimensions.length}×${input.dimensions.width}×${input.dimensions.height}${input.dimensions.unit}` : '未指定';

  return `请对当前3D展陈效果图进行方案拆解分析。
品牌：${input.brandName}
场景类型：${input.sceneType || '未指定'}
空间尺寸：${dimStr}

请输出以下结构化内容（JSON格式）：
{
  "components": [
    { "index": 1, "name": "门头", "sizeSuggestion": "9000×1200×600mm", "material": "发光字+亚克力", "craft": "烤漆+内发光", "area": "入口区" }
  ],
  "materials": [
    { "name": "乳白色烤漆板", "description": "表面烤漆，高光细腻", "usageArea": "主体墙面" }
  ],
  "bom": [
    { "name": "门头", "count": 1, "estimatedPrice": 12800, "material": "亚克力", "craft": "内发光" }
  ],
  "floorPlanZones": [
    { "name": "展示区", "description": "核心产品展示" }
  ],
  "notes": [
    "AI建议尺寸，非施工精确尺寸",
    "推荐材质需制作方复核"
  ]
}

注意：
- 尺寸为AI建议尺寸，不是精确施工尺寸。
- 材质为推荐材质，需要制作方复核。
- 输出内容需要适合展陈设计师、活动公司、制作工厂理解。
- 必须输出有效的JSON格式。`;
}

export function buildDisplay3DFloorPlanPrompt(input: Display3DInput): string {
  const dimStr = input.dimensions ? `${input.dimensions.length}×${input.dimensions.width}mm` : '未指定';

  return `为品牌「${input.brandName}」生成展陈空间平面布局图（俯视图）。
空间尺寸：${dimStr}
场景类型：${input.sceneType || '未指定'}

要求：
1. 生成简洁的俯视平面图。
2. 标注主要区域：入口、展示区、体验区、服务区、储物区。
3. 标注人流动线。
4. 清晰的区域划分和尺寸标注。
5. 风格简洁专业，适合方案沟通。`;
}

export function buildDisplay3DMultiAnglePrompt(input: Display3DInput): string {
  const views = input.viewOptions || ['front', 'angle_45', 'side', 'top'];
  const viewNames: Record<string, string> = {
    front: '正面视角', angle_45: '45度视角', side: '侧面视角',
    top: '俯视视角', entrance: '入口视角', detail: '局部细节'
  };
  const viewList = views.map(v => viewNames[v] || v).join('、');

  return `为品牌「${input.brandName}」的展陈空间生成多角度参考图。
展陈类型：${input.sceneType}
需要生成以下视角：${viewList}

每个视角要求：
1. 保持空间结构一致，仅改变视角。
2. 材质和灯光保持统一。
3. 品牌元素在每个视角都可见。
4. 商业级渲染质量。`;
}
