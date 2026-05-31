import { NextRequest, NextResponse, after } from 'next/server';
import { findProviderForModel } from '@/lib/server-api-config';
import { resolveCompatProfile, adjustRequestForProfile, parseResponseForProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { dbListBrandKits, dbUpsertBrandKit, dbDeleteBrandKit } from '@/lib/db-storage';

// ─── Types ───────────────────────────────────────────────────────────

interface BrandDNAType {
  primaryColor: string;
  secondaryColors: string[];
  fontFamily: string;
  styleKeywords: string[];
  toneKeywords: string[];
  avoidKeywords: string[];
  layoutStyle: string;
  description: string;
}

interface DesignScenario {
  id: string;
  name: string;
  nameEn: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  description: string;
}

// ─── Helper: Get image provider ──────────────────────────────────────

async function getImageProvider(model?: string) {
  const modelId = model || '';
  if (modelId) {
    const provider = await findProviderForModel(modelId);
    if (provider) return { provider, modelId };
  }
  // Fallback: find any image provider
  const { getApiProviders } = await import('@/lib/server-api-config');
  const providers = await getApiProviders();
  const imageProvider = providers.find(p => p.modelType === 'image' && p.isEnabled !== false && p.selectedModels && p.selectedModels.length > 0);
  if (imageProvider && imageProvider.selectedModels && imageProvider.selectedModels.length > 0) {
    return { provider: imageProvider, modelId: imageProvider.selectedModels[0] };
  }
  return null;
}

// ─── Helper: Get LLM provider ───────────────────────────────────────

async function getLLMProvider(model?: string) {
  const modelId = model || '';
  if (modelId) {
    const provider = await findProviderForModel(modelId);
    if (provider) return { provider, modelId };
  }
  const { getApiProviders } = await import('@/lib/server-api-config');
  const providers = await getApiProviders();
  const chatProvider = providers.find(p => p.modelType === 'chat' && p.isEnabled !== false && p.selectedModels && p.selectedModels.length > 0);
  if (chatProvider && chatProvider.selectedModels && chatProvider.selectedModels.length > 0) {
    return { provider: chatProvider, modelId: chatProvider.selectedModels[0] };
  }
  return null;
}

// ─── GET handler: List all brand kits ─────────────────────────────────

export async function GET() {
  try {
    const rows = await dbListBrandKits();
    const kits = rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      brandDNA: safeParseJSON(row.brand_dna),
      colors: safeParseJSON(row.colors),
      fontStyle: row.font_style,
      styleKeywords: safeParseJSONArray(row.style_keywords),
      referenceImages: safeParseJSONArray(row.reference_images),
      isDefault: row.is_default,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
    return NextResponse.json({ kits });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brand-kit] GET error:', message);
    return NextResponse.json({ kits: [] });
  }
}

function safeParseJSON(str: string): Record<string, unknown> {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

function safeParseJSONArray(str: string): string[] {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

// ─── POST handler ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'analyze': return handleAnalyze(body);
      case 'analyze-image': return handleAnalyzeImage(body);
      case 'generate': return handleGenerate(body);
      case 'create': return handleCreateKit(body);
      case 'update': return handleUpdateKit(body);
      case 'delete': return handleDeleteKit(body);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brand-kit] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Analyze: Extract Brand DNA from images ──────────────────────────

async function handleAnalyze(body: {
  images: string[];
  brandName?: string;
  llmModel?: string;
}) {
  const { images, brandName, llmModel } = body;

  if (!images || images.length === 0) {
    return NextResponse.json({ error: '请至少提供一张品牌素材图片' }, { status: 400 });
  }

  const llmInfo = await getLLMProvider(llmModel);
  if (!llmInfo) {
    return NextResponse.json({ error: '未找到可用的 LLM 模型，请在管理员系统中配置聊天模型' }, { status: 400 });
  }

  const { provider, modelId } = llmInfo;
  const baseUrl = provider.baseUrl || provider.baseUrl || '';
  const apiKey = provider.apiKey || provider.apiKey || '';

  // Build vision prompt for brand DNA extraction
  const imageContents = images.map((url: string, i: number) => ({
    type: 'image_url',
    image_url: { url, detail: 'high' as const }
  }));

  const analyzePrompt = `You are a professional brand design expert. Analyze the provided brand material${images.length > 1 ? 's' : ''} and extract the Brand DNA.

${brandName ? `Brand name: ${brandName}` : ''}

Please extract and return a JSON object with the following structure (respond ONLY with valid JSON, no markdown):
{
  "primaryColor": "hex color code of the primary brand color",
  "secondaryColors": ["hex1", "hex2", "hex3"],
  "fontFamily": "font family description (e.g., 'sans-serif, modern, geometric')",
  "styleKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "toneKeywords": ["tone1", "tone2", "tone3"],
  "avoidKeywords": ["anti-style1", "anti-style2", "anti-style3"],
  "layoutStyle": "description of layout patterns (e.g., 'clean minimal with generous whitespace')",
  "description": "2-3 sentence brand personality summary"
}

Focus on: color palette, typography personality, visual style, emotional tone, and layout patterns.`;

  try {
    const response = await fetchWithV1Retry(
      baseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: analyzePrompt },
                ...imageContents
              ]
            }
          ],
          max_tokens: 1000,
          temperature: 0.3,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return NextResponse.json(
        { error: `LLM API 错误 (${response.status}): ${errText.slice(0, 200)}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    let brandDNA: BrandDNAType;
    try {
      // Try direct parse
      brandDNA = JSON.parse(content);
    } catch {
      // Try extracting JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        brandDNA = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try finding JSON object in content
        const objMatch = content.match(/\{[\s\S]*\}/);
        if (objMatch) {
          brandDNA = JSON.parse(objMatch[0]);
        } else {
          return NextResponse.json({ error: '无法解析品牌分析结果' }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ brandDNA });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brand-kit] Analyze error:', message);
    return NextResponse.json({ error: `品牌分析失败: ${message}` }, { status: 500 });
  }
}

// ─── Analyze-Image: Extract Brand DNA from uploaded images ──────────

async function handleAnalyzeImage(body: {
  imageUrl: string;
  brandName?: string;
  llmModel?: string;
}) {
  const { imageUrl, brandName, llmModel } = body;

  if (!imageUrl) {
    return NextResponse.json({ error: '请提供品牌素材图片' }, { status: 400 });
  }

  const llmInfo = await getLLMProvider(llmModel);
  if (!llmInfo) {
    return NextResponse.json({ error: '未找到可用的 LLM 模型，请在管理员系统中配置聊天模型' }, { status: 400 });
  }

  const { provider, modelId } = llmInfo;
  const baseUrl = provider.baseUrl || '';
  const apiKey = provider.apiKey || '';

  const analyzePrompt = `You are a professional brand design expert. Analyze the provided brand material image and extract the Brand DNA.

${brandName ? `Brand name: ${brandName}` : ''}

Please extract and return a JSON object with the following structure (respond ONLY with valid JSON, no markdown):
{
  "primaryColor": "hex color code of the primary brand color",
  "secondaryColors": ["hex1", "hex2", "hex3"],
  "fontFamily": "font family description (e.g., 'sans-serif, modern, geometric')",
  "styleKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "toneKeywords": ["tone1", "tone2", "tone3"],
  "avoidKeywords": ["anti-style1", "anti-style2", "anti-style3"],
  "layoutStyle": "description of layout patterns (e.g., 'clean minimal with generous whitespace')",
  "description": "2-3 sentence brand personality summary",
  "mood": "one of: professional, playful, luxury, minimal, warm, bold, elegant, energetic, calm, creative",
  "industry": "one of: tech, fashion, food, health, education, finance, entertainment, beauty, sports, travel, other"
}

Focus on: color palette extraction (be precise with hex codes), typography personality, visual style, emotional tone, and layout patterns. Identify the most dominant colors from the image.`;

  try {
    const response = await fetchWithV1Retry(
      baseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: analyzePrompt },
                { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
              ]
            }
          ],
          max_tokens: 1000,
          temperature: 0.3,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return NextResponse.json(
        { error: `LLM API 错误 (${response.status}): ${errText.slice(0, 200)}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    let brandDNA: BrandDNAType;
    try {
      brandDNA = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        brandDNA = JSON.parse(jsonMatch[1].trim());
      } else {
        const objMatch = content.match(/\{[\s\S]*\}/);
        if (objMatch) {
          brandDNA = JSON.parse(objMatch[0]);
        } else {
          return NextResponse.json({ error: '无法解析品牌分析结果' }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ brandDNA });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brand-kit] Analyze-image error:', message);
    return NextResponse.json({ error: `品牌图片分析失败: ${message}` }, { status: 500 });
  }
}

// ─── Generate: Batch generate brand extension designs ────────────────

async function handleGenerate(body: {
  brandDNA: BrandDNAType;
  scenarioIds: string[];
  customPrompt?: string;
  imageModel?: string;
  llmModel?: string;
  aspectRatio?: string;
  count?: number;
}) {
  const { brandDNA, scenarioIds, customPrompt, imageModel, llmModel, aspectRatio, count } = body;

  if (!brandDNA) {
    return NextResponse.json({ error: '请先提取品牌 DNA' }, { status: 400 });
  }

  if (!scenarioIds || scenarioIds.length === 0) {
    return NextResponse.json({ error: '请选择至少一个设计场景' }, { status: 400 });
  }

  // Step 1: Use LLM to generate detailed prompts for each scenario
  const llmInfo = await getLLMProvider(llmModel);
  if (!llmInfo) {
    return NextResponse.json({ error: '未找到可用的 LLM 模型' }, { status: 400 });
  }

  const imageInfo = await getImageProvider(imageModel);
  if (!imageInfo) {
    return NextResponse.json({ error: '未找到可用的图像模型，请在管理员系统中配置图像模型' }, { status: 400 });
  }

  // Step 2: Generate scenario prompts using LLM
  const scenariosPrompt = buildScenariosPrompt(brandDNA, scenarioIds, customPrompt, aspectRatio);

  let scenarios: DesignScenario[];
  try {
    const { provider: llmProvider, modelId: llmModelId } = llmInfo;
    const llmBaseUrl = llmProvider.baseUrl || llmProvider.baseUrl || '';
    const llmApiKey = llmProvider.apiKey || llmProvider.apiKey || '';

    const llmResponse = await fetchWithV1Retry(
      llmBaseUrl,
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmApiKey}`,
        },
        body: JSON.stringify({
          model: llmModelId,
          messages: [
            {
              role: 'system',
              content: 'You are a professional brand design prompt engineer. Generate detailed, production-ready image generation prompts for brand extension designs. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: scenariosPrompt
            }
          ],
          max_tokens: 3000,
          temperature: 0.7,
        }),
      }
    );

    if (!llmResponse.ok) {
      return NextResponse.json(
        { error: `LLM API 错误 (${llmResponse.status})` },
        { status: llmResponse.status }
      );
    }

    const llmData = await llmResponse.json();
    const llmContent = llmData.choices?.[0]?.message?.content || '';

    // Parse scenarios
    try {
      scenarios = JSON.parse(llmContent);
    } catch {
      const jsonMatch = llmContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        scenarios = JSON.parse(jsonMatch[1].trim());
      } else {
        const arrMatch = llmContent.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          scenarios = JSON.parse(arrMatch[0]);
        } else {
          return NextResponse.json({ error: '无法解析场景提示词' }, { status: 500 });
        }
      }
    }

    if (!Array.isArray(scenarios) || scenarios.length === 0) {
      return NextResponse.json({ error: '生成的场景提示词为空' }, { status: 500 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `生成场景提示词失败: ${message}` }, { status: 500 });
  }

  // Step 3: Batch generate images using image model
  const { provider: imgProvider, modelId: imgModelId } = imageInfo;
  const imgBaseUrl = imgProvider.baseUrl || imgProvider.baseUrl || '';
  const imgApiKey = imgProvider.apiKey || imgProvider.apiKey || '';
  const compatProfile = resolveCompatProfile(imgProvider);

  const taskId = `brand-${Date.now()}`;
  const totalScenarios = scenarios.length;
  const generateCount = count || 1; // images per scenario

  registerTask(taskId, 'brand-generate', `品牌延展设计 (${totalScenarios} 个场景)`);

  // Start async generation — 使用 after() 确保响应返回后 IIFE 仍可运行
  after(async () => {
    const results: Array<{
      scenario: DesignScenario;
      images: string[];
    }> = [];

    for (let i = 0; i < totalScenarios; i++) {
      const scenario = scenarios[i];
      if (!scenario) continue;

      updateTaskProgress(taskId, {
        progress: Math.round((i / totalScenarios) * 100),
        label: `正在生成: ${scenario.name || `场景 ${i + 1}`} (${i + 1}/${totalScenarios})`,
      });

      try {
        const prompt = scenario.prompt || '';
        const negativePrompt = scenario.negativePrompt || '';

        // Build full prompt with brand DNA context
        const fullPrompt = `${prompt}. Brand style: ${brandDNA.styleKeywords?.join(', ') || ''}. Color palette: ${brandDNA.primaryColor}, ${(brandDNA.secondaryColors || []).join(', ')}. ${brandDNA.layoutStyle ? `Layout: ${brandDNA.layoutStyle}.` : ''} ${brandDNA.toneKeywords?.length ? `Tone: ${brandDNA.toneKeywords.join(', ')}.` : ''}`;

        const size = parseAspectRatio(aspectRatio || scenario.aspectRatio || '1:1');

        const adjustedRequest = adjustRequestForProfile(
          {
            model: imgModelId,
            prompt: fullPrompt,
            negative_prompt: negativePrompt || (brandDNA.avoidKeywords?.length ? `low quality, blurry, distorted, ${brandDNA.avoidKeywords.join(', ')}` : 'low quality, blurry, distorted, watermark, text'),
            n: generateCount,
            size,
          },
          compatProfile
        );

        const endpoint = compatProfile.defaultEndpoint || '/images/generations';
        const imgResponse = await fetchWithV1Retry(
          imgBaseUrl,
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${imgApiKey}`,
            },
            body: JSON.stringify(adjustedRequest),
          }
        );

        if (imgResponse.ok) {
          const imgData = await imgResponse.json();
          const parsedResult = parseResponseForProfile(imgData, compatProfile);

          const imageUrls: string[] = [];
          // Handle direct image URLs
          if (parsedResult.directImageUrls && parsedResult.directImageUrls.length > 0) {
            imageUrls.push(...parsedResult.directImageUrls);
          }
          // Handle polling task IDs - fetch results from poll endpoint
          if (parsedResult.taskIds && parsedResult.taskIds.length > 0) {
            for (const tid of parsedResult.taskIds) {
              try {
                const pollRes = await fetchWithV1Retry(imgProvider.baseUrl, `/api/poll-task`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId: tid, model: imageModel }),
                });
                if (pollRes.ok) {
                  const pollData = await pollRes.json();
                  if (pollData.imageUrls) {
                    imageUrls.push(...(Array.isArray(pollData.imageUrls) ? pollData.imageUrls : [pollData.imageUrls]));
                  } else if (pollData.imageUrl) {
                    imageUrls.push(pollData.imageUrl);
                  }
                }
              } catch { /* poll failed, skip */ }
            }
          }

          if (imageUrls.length > 0) {
            results.push({ scenario, images: imageUrls });
          } else {
            results.push({ scenario, images: [] });
          }
        } else {
          console.error(`[brand-kit] Image generation failed for scenario ${i}: ${imgResponse.status}`);
          results.push({ scenario, images: [] });
        }
      } catch (err) {
        console.error(`[brand-kit] Error generating scenario ${i}:`, err);
        results.push({ scenario, images: [] });
      }
    }

    updateTaskProgress(taskId, {
      status: 'completed',
      progress: 100,
      label: '品牌延展设计完成',
      result: { scenarios: results },
    });
  });

  return NextResponse.json({
    taskId,
    scenarios: scenarios.map(s => ({ id: s.id, name: s.name, nameEn: s.nameEn, description: s.description })),
    total: totalScenarios,
  });
}

// ─── CRUD: Create / Update / Delete Brand Kits ──────────────────────

async function handleCreateKit(body: Record<string, unknown>) {
  const id = `kit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const kit = await dbUpsertBrandKit({
    id,
    name: (body.name as string) || '',
    description: (body.description as string) || '',
    brand_dna: JSON.stringify(body.brandDNA || body.brandDna || {}),
    colors: JSON.stringify(body.colors || {}),
    font_style: (body.fontStyle as string) || 'sans-serif',
    style_keywords: JSON.stringify(body.styleKeywords || []),
    reference_images: JSON.stringify(body.referenceImages || []),
    is_default: false,
  });
  if (!kit) {
    return NextResponse.json({ error: '保存品牌套件失败' }, { status: 500 });
  }
  return NextResponse.json({
    kit: {
      id: kit.id,
      name: kit.name,
      description: kit.description,
      brandDNA: safeParseJSON(kit.brand_dna),
      colors: safeParseJSON(kit.colors),
      fontStyle: kit.font_style,
      styleKeywords: safeParseJSONArray(kit.style_keywords),
      referenceImages: safeParseJSONArray(kit.reference_images),
      isDefault: kit.is_default,
      createdAt: Number(kit.created_at),
      updatedAt: Number(kit.updated_at),
    }
  });
}

async function handleUpdateKit(body: Record<string, unknown>) {
  const id = body.id as string;
  if (!id) {
    return NextResponse.json({ error: '缺少品牌套件 ID' }, { status: 400 });
  }
  const kit = await dbUpsertBrandKit({
    id,
    name: body.name as string | undefined,
    description: body.description as string | undefined,
    brand_dna: (body.brandDNA || body.brandDna) ? JSON.stringify(body.brandDNA || body.brandDna) : undefined,
    colors: body.colors ? JSON.stringify(body.colors) : undefined,
    font_style: body.fontStyle as string | undefined,
    style_keywords: body.styleKeywords ? JSON.stringify(body.styleKeywords) : undefined,
    reference_images: body.referenceImages ? JSON.stringify(body.referenceImages) : undefined,
    is_default: body.isDefault as boolean | undefined,
  });
  if (!kit) {
    return NextResponse.json({ error: '更新品牌套件失败' }, { status: 500 });
  }
  return NextResponse.json({
    kit: {
      id: kit.id,
      name: kit.name,
      description: kit.description,
      brandDNA: safeParseJSON(kit.brand_dna),
      colors: safeParseJSON(kit.colors),
      fontStyle: kit.font_style,
      styleKeywords: safeParseJSONArray(kit.style_keywords),
      referenceImages: safeParseJSONArray(kit.reference_images),
      isDefault: kit.is_default,
      createdAt: Number(kit.created_at),
      updatedAt: Number(kit.updated_at),
    }
  });
}

async function handleDeleteKit(body: Record<string, unknown>) {
  const id = body.id as string;
  if (!id) {
    return NextResponse.json({ error: '缺少品牌套件 ID' }, { status: 400 });
  }
  const ok = await dbDeleteBrandKit(id);
  if (!ok) {
    return NextResponse.json({ error: '删除品牌套件失败' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildScenariosPrompt(
  brandDNA: BrandDNAType,
  scenarioIds: string[],
  customPrompt?: string,
  aspectRatio?: string
): string {
  const scenarioNames: Record<string, string> = {
    'social-post': '社交媒体帖子',
    'business-card': '名片设计',
    'poster': '海报设计',
    'banner': '横幅/Banner',
    'logo-variation': 'Logo 变体',
    'packaging': '包装设计',
    'stationery': '文具/信纸设计',
    'presentation': '演示文稿封面',
    'app-screenshot': 'App 界面截图',
    'email-header': '邮件头图',
    'merchandise': '周边商品设计',
    'signage': '标识/导视设计',
  };

  const selectedScenarios = scenarioIds
    .map(id => scenarioNames[id] || id)
    .join('、');

  return `Based on the following Brand DNA, generate detailed image generation prompts for brand extension designs.

Brand DNA:
- Primary Color: ${brandDNA.primaryColor}
- Secondary Colors: ${brandDNA.secondaryColors?.join(', ') || 'N/A'}
- Font Style: ${brandDNA.fontFamily || 'N/A'}
- Style Keywords: ${brandDNA.styleKeywords?.join(', ') || 'N/A'}
- Tone: ${brandDNA.toneKeywords?.join(', ') || 'N/A'}
- Layout Style: ${brandDNA.layoutStyle || 'N/A'}
- Avoid: ${brandDNA.avoidKeywords?.join(', ') || 'N/A'}
- Description: ${brandDNA.description || 'N/A'}

Design Scenarios to generate: ${selectedScenarios}
${customPrompt ? `Additional requirements: ${customPrompt}` : ''}
${aspectRatio ? `Preferred aspect ratio: ${aspectRatio}` : ''}

Generate a JSON array of design scenario objects. Each object must have:
{
  "id": "scenario-id from the list above",
  "name": "中文名称",
  "nameEn": "English name",
  "prompt": "Detailed, specific image generation prompt in English that incorporates the brand colors, style, and tone. Be very specific about layout, composition, and visual elements.",
  "negativePrompt": "What to avoid in this specific design",
  "aspectRatio": "recommended aspect ratio like 1:1, 16:9, 4:3, 3:4, 9:16",
  "description": "Brief description of this design in Chinese"
}

Return ONLY the JSON array, no markdown or explanation.`;
}

function parseAspectRatio(ratio: string): string {
  const map: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '4:3': '1365x1024',
    '3:4': '1024x1365',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
  };
  return map[ratio] || '1024x1024';
}
