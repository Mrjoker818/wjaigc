import { NextRequest, NextResponse } from 'next/server';
import {
  dbListBrandProjects, dbGetBrandProject, dbUpsertBrandProject, dbDeleteBrandProject,
  dbListBrandMaterials, dbUpsertBrandMaterial, dbDeleteBrandMaterial,
} from '@/lib/db-storage';
import { findProviderForFeature, findProviderForModel } from '@/lib/server-api-config';

// ═══ GET: List projects ═══
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const materialsOnly = searchParams.get('materials') === 'true';
    const versionsOnly = searchParams.get('versions') === 'true';

    if (projectId && versionsOnly) {
      const allMaterials = await dbListBrandMaterials(projectId);
      const versions = allMaterials.filter(m => m.material_type === 'version' || m.status === 'version');
      const parsedVersions = versions.map(v => {
        let snapshot: Record<string, unknown> = {};
        let note = '';
        let targetType = 'full';
        try {
          const parsed = JSON.parse(v.prompt || '{}');
          snapshot = parsed.snapshot || {};
          note = parsed.note || '';
          targetType = parsed.targetType || 'full';
        } catch { /* ignore */ }
        return { ...v, snapshot, note, targetType, id: v.id, versionName: v.title, createdAt: v.created_at };
      });
      return NextResponse.json({ success: true, versions: parsedVersions });
    }

    if (projectId && materialsOnly) {
      const materials = await dbListBrandMaterials(projectId);
      return NextResponse.json({ success: true, materials });
    }

    if (projectId) {
      const project = await dbGetBrandProject(projectId);
      if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
      const materials = await dbListBrandMaterials(projectId);
      return NextResponse.json({ success: true, project, materials });
    }

    const projects = await dbListBrandProjects();
    return NextResponse.json({ success: true, projects });
  } catch (e) {
    console.error('[brand-factory] GET error:', e);
    return NextResponse.json({ error: '获取项目列表失败' }, { status: 500 });
  }
}

// ═══ POST: Actions ═══
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'create-project': return await handleCreateProject(body);
      case 'update-project': return await handleUpdateProject(body);
      case 'delete-project': return await handleDeleteProject(body);
      case 'archive-project': return await handleArchiveProject(body);
      case 'analyze-dna': return await handleAnalyzeDNA(body);
      case 'generate-directions': return await handleGenerateDirections(body);
      case 'generate-kv': return await handleGenerateKV(body);
      case 'batch-generate': return await handleBatchGenerate(body);
      case 'save-material': return await handleSaveMaterial(body);
      case 'delete-material': return await handleDeleteMaterial(body);
      case 'consistency-check': return await handleConsistencyCheck(body);
      case 'save-version': return await handleSaveVersion(body);
      case 'generate-chinese-title': return await handleGenerateChineseTitle(body);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    console.error('[brand-factory] POST error:', e);
    return NextResponse.json({ error: '请求处理失败' }, { status: 500 });
  }
}

// ═══ Project CRUD ═══

async function handleCreateProject(body: Record<string, unknown>) {
  const id = `bp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const project = await dbUpsertBrandProject({
    id,
    project_name: (body.projectName as string) || (body.brandName as string) || '未命名项目',
    brand_name: (body.brandName as string) || '',
    industry: (body.industry as string) || '',
    project_type: (body.projectType as string) || '',
    keywords: JSON.stringify(body.keywords || []),
    target_audience: (body.targetAudience as string) || '',
    tone: (body.tone as string) || '',
    description: (body.description as string) || '',
    logo_url: (body.logoUrl as string) || '',
    product_url: (body.productUrl as string) || '',
    ip_url: (body.ipUrl as string) || '',
    reference_urls: JSON.stringify(body.referenceUrls || []),
    brand_dna: JSON.stringify(body.brandDna || {}),
    creative_directions: JSON.stringify(body.creativeDirections || []),
    status: 'draft',
    is_archived: false,
  });
  return NextResponse.json({ success: true, project });
}

async function handleUpdateProject(body: Record<string, unknown>) {
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

  // Map camelCase to snake_case
  const mapped: Record<string, unknown> = {};
  const fieldMap: Record<string, string> = {
    projectName: 'project_name', brandName: 'brand_name',
    projectType: 'project_type', targetAudience: 'target_audience',
    logoUrl: 'logo_url', productUrl: 'product_url', ipUrl: 'ip_url',
    referenceUrls: 'reference_urls', brandDna: 'brand_dna',
    creativeDirections: 'creative_directions',
  };
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'action' || k === 'id') continue;
    const dbKey = fieldMap[k] || k;
    mapped[dbKey] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
  }

  const project = await dbUpsertBrandProject({ id: id as string, ...mapped });
  return NextResponse.json({ success: true, project });
}

async function handleDeleteProject(body: Record<string, unknown>) {
  const { id } = body;
  if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
  const ok = await dbDeleteBrandProject(id as string);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: '删除项目失败' }, { status: 500 });
}

async function handleArchiveProject(body: Record<string, unknown>) {
  const { id, archive } = body;
  if (!id) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
  const project = await dbUpsertBrandProject({ id: id as string, is_archived: !!archive, status: archive ? 'archived' : 'draft' });
  return NextResponse.json({ success: true, project });
}

// ═══ AI Analysis ═══

async function getLLM(modelOverride?: string) {
  const provider = await findProviderForFeature('chat');
  if (!provider) return null;
  const modelName = modelOverride || provider.selectedModels?.[0] || '';
  return { provider, modelName };
}

async function getImageProvider(modelOverride?: string) {
  if (modelOverride) {
    const provider = await findProviderForModel(modelOverride, 'image');
    if (provider) return { provider, modelName: modelOverride };
  }
  // Fallback: find any image provider
  const provider = await findProviderForModel('', 'image');
  if (!provider) return null;
  const modelName = modelOverride || provider.selectedModels?.[0] || '';
  return { provider, modelName };
}

async function callLLM(prompt: string, modelOverride?: string): Promise<string> {
  const llm = await getLLM(modelOverride);
  if (!llm) throw new Error('请先在管理后台配置LLM模型');

  const { provider, modelName } = llm;
  const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '');
  const apiKey = provider.apiKey || '';

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 4096,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`LLM API 错误 (${resp.status}): ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

async function handleAnalyzeDNA(body: Record<string, unknown>) {
  const { brandName, industry, keywords, tone, description, logoUrl, productUrl, ipUrl, llmModel } = body;
  if (!brandName && !logoUrl && !productUrl && !ipUrl) {
    return NextResponse.json({ error: '请提供品牌名称或上传品牌素材' }, { status: 400 });
  }

  const prompt = `你是一个专业的品牌策略分析师。请根据以下信息分析品牌DNA，输出JSON格式：

品牌名称：${brandName || '未知'}
行业：${industry || '未知'}
关键词：${keywords ? JSON.stringify(keywords) : '无'}
品牌调性：${tone || '未知'}
描述：${description || '无'}
${logoUrl ? `Logo图片：${logoUrl}` : ''}
${productUrl ? `产品图片：${productUrl}` : ''}
${ipUrl ? `IP形象图片：${ipUrl}` : ''}

请输出以下JSON结构（不要包含markdown代码块标记）：
{
  "brandKeywords": ["关键词1", "关键词2", "关键词3"],
  "mainColors": ["#色值1", "#色值2"],
  "secondaryColors": ["#色值1", "#色值2"],
  "fontStyle": "字体方向描述",
  "visualTone": "视觉调性描述",
  "logoRules": ["规则1", "规则2"],
  "productRules": ["规则1", "规则2"],
  "ipRules": ["规则1", "规则2"],
  "forbiddenRules": ["禁区1", "禁区2"],
  "recommendedMaterials": ["物料类型1", "物料类型2"],
  "promptSummary": "品牌Prompt摘要"
}`;

  try {
    const content = await callLLM(prompt, llmModel as string | undefined);
    // Try to parse JSON from response
    let dna: Record<string, unknown>;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      dna = jsonMatch ? JSON.parse(jsonMatch[0]) : { promptSummary: content };
    } catch {
      dna = { promptSummary: content };
    }
    return NextResponse.json({ success: true, dna });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '品牌DNA分析失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handleGenerateDirections(body: Record<string, unknown>) {
  const { brandName, brandDna, count = 3, llmModel } = body;
  if (!brandName) return NextResponse.json({ error: '请先填写品牌名称' }, { status: 400 });

  const dnaStr = typeof brandDna === 'string' ? brandDna : JSON.stringify(brandDna || {});

  const prompt = `你是一个创意总监。请根据以下品牌信息生成${count}套品牌创意方向，输出JSON数组格式：

品牌名称：${brandName}
品牌DNA：${dnaStr}

请输出以下JSON结构（不要包含markdown代码块标记）：
[{
  "name": "方向名称",
  "concept": "核心概念描述",
  "slogan": "一句话传播语",
  "visualKeywords": ["视觉关键词1", "关键词2"],
  "colorPlan": ["#色值1", "#色值2"],
  "fontPlan": "字体方案描述",
  "compositionStyle": "构图方式",
  "prompt": "该方向的图像生成Prompt",
  "recommendedMaterials": ["推荐物料类型1", "类型2"]
}]`;

  try {
    const content = await callLLM(prompt, llmModel as string | undefined);
    let directions: unknown[];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      directions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      directions = [];
    }
    if (!Array.isArray(directions) || directions.length === 0) {
      directions = [{ name: '方向1', concept: content, prompt: content }];
    }
    return NextResponse.json({ success: true, directions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创意方向生成失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handleGenerateKV(body: Record<string, unknown>) {
  const { brandName, brandDna, directionId, directionPrompt, theme, slogan, ratio, llmModel } = body;
  if (!brandName) return NextResponse.json({ error: '请先填写品牌名称' }, { status: 400 });

  const dnaStr = typeof brandDna === 'string' ? brandDna : JSON.stringify(brandDna || {});
  const kvRatio = (ratio as string) || '16:9';

  const prompt = `你是一个品牌视觉设计专家。请根据以下品牌信息生成主KV（Key Visual）的图像生成Prompt：

品牌名称：${brandName}
品牌DNA：${dnaStr}
${directionPrompt ? `创意方向Prompt：${directionPrompt}` : ''}
${theme ? `主题文案：${theme}` : ''}
${slogan ? `传播语/标语：${slogan}` : ''}
画面比例：${kvRatio}

请直接输出一段详细的图像生成Prompt，必须包含：
1. 画面主体和构图
2. 色彩方案（基于品牌DNA的主色和辅助色）
3. 字体和文字排版规则（中文标题保护：所有中文文字必须完整呈现，不得变形模糊）
4. Logo/品牌元素应用方式
5. 画面氛围和质感
6. 禁止事项（如禁止模糊变形、禁止水印）

输出格式为纯文本Prompt，不要包含任何前缀或说明文字。`;

  try {
    const content = await callLLM(prompt, llmModel as string | undefined);
    const kvPrompt = content.trim();
    // Return as materials array for compatibility
    return NextResponse.json({
      success: true,
      materials: [{
        materialType: 'kv-main',
        title: `主KV${theme ? ' - ' + theme : ''}`,
        ratio: kvRatio,
        prompt: kvPrompt,
      }],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'KV生成失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handleBatchGenerate(body: Record<string, unknown>) {
  const { brandName, brandDna, materialTypes, llmModel } = body;
  if (!brandName) return NextResponse.json({ error: '请先填写品牌名称' }, { status: 400 });
  if (!materialTypes || !Array.isArray(materialTypes) || materialTypes.length === 0) {
    return NextResponse.json({ error: '请选择物料类型' }, { status: 400 });
  }

  const dnaStr = typeof brandDna === 'string' ? brandDna : JSON.stringify(brandDna || {});

  const prompt = `你是一个品牌物料批量生成专家。请根据品牌信息为以下物料类型分别生成图像Prompt：

品牌名称：${brandName}
品牌DNA：${dnaStr}
物料类型：${(materialTypes as string[]).join('、')}

请输出JSON数组（不要包含markdown代码块标记）：
[{
  "materialType": "物料类型",
  "title": "物料名称",
  "ratio": "推荐比例(如16:9)",
  "prompt": "图像生成Prompt",
  "notes": "设计要点"
}]`;

  try {
    const content = await callLLM(prompt, llmModel as string | undefined);
    let materials: unknown[];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      materials = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      materials = [];
    }
    return NextResponse.json({ success: true, materials });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '批量生成失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handleSaveMaterial(body: Record<string, unknown>) {
  const { id, projectId, directionId, materialType, title, ratio, imageUrl, prompt, score, status } = body;
  if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

  const materialId = (id as string) || `mat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const material = await dbUpsertBrandMaterial({
    id: materialId,
    project_id: projectId as string,
    direction_id: (directionId as string) || '',
    material_type: (materialType as string) || 'kv',
    title: (title as string) || '',
    ratio: (ratio as string) || '1:1',
    image_url: (imageUrl as string) || '',
    prompt: (prompt as string) || '',
    score: (score as number) || 0,
    status: (status as string) || 'draft',
  });
  return NextResponse.json({ success: true, material });
}

async function handleDeleteMaterial(body: Record<string, unknown>) {
  const { id } = body;
  if (!id) return NextResponse.json({ error: '缺少物料ID' }, { status: 400 });
  const ok = await dbDeleteBrandMaterial(id as string);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: '删除物料失败' }, { status: 500 });
}

// ═══ Consistency Check ═══

async function handleConsistencyCheck(body: Record<string, unknown>) {
  const { brandName, brandDna, materials, llmModel } = body;
  if (!brandName) return NextResponse.json({ error: '请先填写品牌名称' }, { status: 400 });

  const dnaStr = typeof brandDna === 'string' ? brandDna : JSON.stringify(brandDna || {});
  const materialsStr = JSON.stringify((materials as Record<string, unknown>[])?.map(m => ({
    type: m.materialType, title: m.title, prompt: (m.prompt as string || '').slice(0, 200),
  })) || []);

  const prompt = `你是一个品牌一致性检测专家。请根据品牌DNA和已生成的物料Prompt，对14个维度进行一致性评分（0-100分），输出JSON格式：

品牌名称：${brandName}
品牌DNA：${dnaStr}
物料列表：${materialsStr}

请输出以下JSON结构（不要包含markdown代码块标记）：
{
  "logoAccuracy": 分数(0-100, Logo准确度),
  "logoDeform": 分数(0-100, Logo是否变形，100=无变形),
  "logoOcclusion": 分数(0-100, Logo是否被遮挡，100=无遮挡),
  "brandColor": 分数(0-100, 品牌主色匹配度),
  "fontConsistency": 分数(0-100, 字体风格一致性),
  "chineseAccuracy": 分数(0-100, 中文文字准确度),
  "productFidelity": 分数(0-100, 产品外观保真度),
  "ipFidelity": 分数(0-100, IP形象保真度),
  "styleConsistency": 分数(0-100, 画面风格统一度),
  "commercialQuality": 分数(0-100, 商业完成度),
  "terminalRealism": 分数(0-100, 终端适配度),
  "sizeAccuracy": 分数(0-100, 物料尺寸准确度),
  "extraText": 分数(0-100, 是否存在多余文字，100=无多余文字),
  "forbiddenRule": 分数(0-100, 是否符合品牌禁区规则，100=完全合规),
  "issues": ["问题1描述", "问题2描述"],
  "suggestions": ["修复建议1", "修复建议2"]
}`;

  try {
    const content = await callLLM(prompt, llmModel as string | undefined);
    let scores: Record<string, unknown>;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      scores = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      scores = {};
    }
    // Extract numeric scores for all 14 dimensions
    const result: Record<string, number> = {};
    for (const key of [
      'logoAccuracy', 'logoDeform', 'logoOcclusion', 'brandColor',
      'fontConsistency', 'chineseAccuracy', 'productFidelity', 'ipFidelity',
      'styleConsistency', 'commercialQuality', 'terminalRealism', 'sizeAccuracy',
      'extraText', 'forbiddenRule'
    ]) {
      const val = scores[key];
      result[key] = typeof val === 'number' ? Math.min(100, Math.max(0, Math.round(val))) : 50;
    }
    return NextResponse.json({ success: true, scores: result, issues: scores.issues, suggestions: scores.suggestions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '一致性检测失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ═══ Version Management ═══

async function handleSaveVersion(body: Record<string, unknown>) {
  const { projectId, targetType, versionName, note, snapshot } = body;
  if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

  // Store version as a material with type 'version' for simplicity
  const id = `ver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const version = await dbUpsertBrandMaterial({
    id,
    project_id: projectId as string,
    direction_id: (targetType as string) || 'full',
    material_type: 'version',
    title: (versionName as string) || 'V1',
    ratio: '',
    image_url: '',
    prompt: JSON.stringify({
      note: note || '',
      snapshot: snapshot || {},
      targetType: targetType || 'full',
    }),
    score: 0,
    status: 'version',
  });
  return NextResponse.json({ success: true, version });
}

// ═══ Chinese Title Generation ═══

async function handleGenerateChineseTitle(body: Record<string, unknown>) {
  const { brandName, brandDna, scene, style, text, llmModel } = body;
  if (!text) return NextResponse.json({ error: '请输入标题文字' }, { status: 400 });

  const dnaStr = typeof brandDna === 'string' ? brandDna : JSON.stringify(brandDna || {});

  const prompt = `你是一个中文字体设计专家和品牌标题字设计师。请根据以下信息生成品牌标题字设计方案：

品牌名称：${brandName || '未指定'}
品牌DNA：${dnaStr}
应用场景：${scene || '品牌主标题'}
字体风格：${style || '高级黑体'}
标题文字：${text}

请输出设计方案，包含以下内容：
1. 字体设计方向：描述字体应该呈现的风格特征
2. 排版建议：字间距、行间距、对齐方式
3. 色彩方案：基于品牌DNA的主色和辅助色
4. 装饰元素：建议添加的装饰效果（如描边、阴影、光效等）
5. 中文文字保护规则：确保不乱码、不多字、不错字、不擅自改品牌名
6. 完整Prompt：可用于图像生成的完整Prompt，确保标题文字"${text}"在画面中完整清晰呈现

请以结构化文本格式输出。`;

  try {
    const content = await callLLM(prompt, llmModel as string | undefined);
    return NextResponse.json({ success: true, result: content.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '标题字生成失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
