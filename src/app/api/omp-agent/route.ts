/**
 * Oh My Prompt — Agent API
 * Handles prompt enhancement using LLM (chat providers)
 * Supports both general and ecommerce template categories
 *
 * POST /api/omp-agent
 *   Body: { inputText, imageData?, templateCategory, ecommerceConfig?, model?, providerId? }
 *   Returns: { success, data: AgentGenerateResult } or { success: false, error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature, findProviderForModel, findProviderById } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { parseAgentGenerateResult, parseEcommerceGenerateResult, type AgentTemplateCategory, type EcommerceConfig } from '@/lib/omp-agent-parsers';
import { translateApiError } from '@/lib/api-error-translate';
import { getSessionUser } from '@/lib/server-auth';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { getDesktopAuth, tokenFromHeader } from '@/lib/desktop-cloud';

const API_TIMEOUT_MS = 300000;
const DEFAULT_AGENT_MAX_TOKENS = 4096;
const ECOMMERCE_AGENT_MAX_TOKENS = 8192;

// ─── Agent Templates ──────────────────────────────────────────

interface AgentTemplate {
  id: AgentTemplateCategory;
  name: string;
  nameEn: string;
  keywords: string[];
  description: string;
  descriptionEn: string;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'general',
    name: '通用',
    nameEn: 'General',
    keywords: ['视觉冲击力', '主题鲜明', '构图创意', '艺术风格', '品牌调性', '现代界面', '三维质感', '光影渲染', '材质纹理'],
    description: '适用于海报图、插画、Logo、UI界面、3D渲染等通用图像创作',
    descriptionEn: 'For general image creation, including posters, illustrations, logos, UI interfaces, and 3D renders',
  },
  {
    id: 'ecommerce',
    name: '电商套图',
    nameEn: 'E-commerce',
    keywords: ['产品主体突出', '白底/渐变背景', '光影质感', '商业摄影', '多角度展示', '细节呈现', '高级质感'],
    description: '适用于电商产品展示，强调产品主体与商业质感',
    descriptionEn: 'For e-commerce product display, emphasizing product focus and commercial quality',
  },
];

function getAgentTemplate(category: AgentTemplateCategory): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find(t => t.id === category);
}

// ─── System Prompt Builders ───────────────────────────────────

function buildAgentSystemPrompt(category: AgentTemplateCategory, hasImage: boolean): string {
  const template = getAgentTemplate(category);
  if (!template) throw new Error(`Unknown template category: ${category}`);

  const keywordsText = template.keywords.join('、');
  const outputFormat = `## 输出格式
请严格输出 JSON，不要包含 Markdown 代码块或任何额外说明：
{
  "prompt": "可直接用于图片生成的一整段完整提示词",
  "sections": {
    "subject": "主体描述",
    "style": "风格定义",
    "lighting": "光影效果",
    "colors": "色彩方案",
    "composition": "构图布局",
    "materials": "材质纹理",
    "mood": "氛围情绪",
    "negativePrompt": "负面提示词/需要避免的内容"
  }
}

要求：
- prompt 必须整合 sections 中的关键信息，适合一键插入使用。
- sections 的每个字段都用简洁短句，便于前端解析成直观布局。
- 输出语言与输入语言一致。如果用户用中文描述，输出中文；如果用英文描述，输出英文。`;

  const imageInstr = hasImage
    ? `参考图片的视觉风格、色彩、构图，结合用户描述生成详细的提示词。提示词应包含：`
    : `将简短描述扩展为详细的提示词，包含：`;

  return `你是提示词增强专家。用户正在生成${template.name}类型的提示词。

风格要点：${keywordsText}。

${imageInstr}
- 主体描述（是什么）
- 风格定义（什么风格）
- 光影效果（如何照亮）
- 色彩方案（什么颜色）
- 构图布局（如何排列）
- 材质纹理（什么质感）
- 氛围情绪（什么感觉）

${outputFormat}`;
}

function getPlatformRules(platform: string): string {
  const rules: Record<string, string> = {
    amazon: '主图必须纯白背景（RGB 255,255,255），产品占画面85%以上面积，禁止水印、文字、Logo。副图可展示使用场景、尺寸对比、功能细节。建议7张图。',
    taobao: '白底或浅色渐变背景主图，促销文字不超过20%面积，建议5张图。副图突出卖点、细节、场景。',
    jd: '白底主图，产品居中，允许品牌Logo水印。副图展示功能、细节、场景。建议5-8张图。',
    pinduoduo: '突出产品主体，背景简洁，强调性价比。主图可加促销标签。建议5-10张图。',
    temu: '白底或场景图，英文标注为主，面向海外消费者。主图简洁突出产品。建议6-8张图。',
    shein: '时尚感强，场景图为主，模特展示优先。风格年轻化，色彩鲜明。建议6-8张图。',
  };
  return rules[platform] || rules.amazon;
}

function buildEcommerceSystemPrompt(config: EcommerceConfig, hasProductImages: boolean): string {
  const platformRules = getPlatformRules(config.platform);
  const marketNames: Record<string, string> = { china: '中国', usa: '美国', europe: '欧洲', japan: '日本', southeast_asia: '东南亚' };
  const languageNames: Record<string, string> = { zh: '中文', en: '英文', ja: '日文' };

  const imageInstruction = hasProductImages
    ? `用户提供了同一组商品参考图，请将所有图片视为同一商品的多角度/细节/包装参考。请综合分析商品外观、颜色、材质、形状、包装和细节特征，确保生成的提示词准确描述商品；除非用户文字明确说明，否则不要将不同照片误判为不同商品。`
    : '';

  const sellingPointsSection = config.sellingPoints.trim()
    ? `\n## 商品卖点\n${config.sellingPoints.trim()}\n请在提示词中自然融入以上卖点。`
    : '';

  const structureInstruction = config.setStructure === 'smart'
    ? `请根据平台规则和商品类型，智能决定最优的图片类型组合（通常5-7张），确保覆盖主图、场景图、细节图、卖点图等关键类型。`
    : config.customCounts
      ? `请按照以下数量生成各类型图片提示词：白底图 ${config.customCounts.whiteBg} 张、场景图 ${config.customCounts.scene} 张、卖点图 ${config.customCounts.sellingPoint} 张、其他类型 ${config.customCounts.other} 张（由AI智能匹配最优类型）。`
      : `请生成以下固定类型的图片提示词：主图、场景图、细节图、卖点图、对比图、氛围图、品牌图。`;

  return `你是电商套图提示词专家。根据用户提供的商品信息${hasProductImages ? '和参考图片' : ''}，生成一套完整的电商产品展示图片提示词。

## 平台要求
当前平台：${config.platform}
${platformRules}

## 目标市场
${marketNames[config.market] || config.market}市场，请遵循该市场的消费者偏好和审美习惯。

## 输出语言
所有提示词使用${languageNames[config.language] || config.language}输出。图片类型标签同时提供中文和英文。

## 图片比例
所有图片比例为 ${config.aspectRatio}。
${imageInstruction}
${sellingPointsSection}

## 套图结构
${structureInstruction}

## 输出格式
请严格以JSON格式输出，不要包含任何其他文字：
{
  "prompts": [
    { "type": "图片类型（中文）", "typeEn": "Image type (English)", "prompt": "详细的图片生成提示词", "aspectRatio": "${config.aspectRatio}" }
  ]
}`;
}

// ─── Response Parsing ─────────────────────────────────────────

function extractOpenAITextContent(data: unknown): string {
  const resp = data as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
  const content = resp.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(part => (part.type === undefined || part.type === 'text') && typeof part.text === 'string')
      .map(part => part.text!.trim())
      .join('\n');
  }
  return '';
}

// ─── SSE Stream Parsing ──────────────────────────────────────

async function parseSSEToJSON(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  return parseSSETextToJSON(text);
}

function parseSSETextToJSON(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  let fullContent = '';
  let lastFinishReason = '';
  let model = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) continue;
    const dataStr = trimmed.slice(6);
    if (dataStr === '[DONE]') break;

    try {
      const event = JSON.parse(dataStr) as Record<string, unknown>;
      model = String(event.model || model);

      const choices = event.choices as Array<Record<string, unknown>> | undefined;
      if (!choices || choices.length === 0) continue;
      const choice = choices[0];
      const delta = choice.delta as Record<string, unknown> | undefined;

      if (delta) {
        if (typeof delta.content === 'string') {
          fullContent += delta.content;
        }
      }

      if (choice.finish_reason) {
        lastFinishReason = String(choice.finish_reason);
      }
    } catch { /* skip unparseable SSE lines */ }
  }

  return {
    choices: [{
      message: { content: fullContent },
      finish_reason: lastFinishReason || 'stop',
    }],
    model,
  } as Record<string, unknown>;
}

// ─── API Route Handler ────────────────────────────────────────

export async function POST(request: NextRequest) {
  let deductedCredits = 0;
  let sessionUser: Awaited<ReturnType<typeof getSessionUser>> = null;
  try {
    // 鉴权：要求 Web 登录态 或 桌面端 Token 二选一（P0 修复：防止未授权盗刷）
    sessionUser = await getSessionUser(request).catch(() => null);
    const desktopAuth = await getDesktopAuth(tokenFromHeader(
      request.headers.get('authorization'),
      request.headers.get('x-desktop-token') || ''
    )).catch(() => null);
    if (!sessionUser && !desktopAuth) {
      return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    }

    const body = await request.json();
    const { inputText, imageData, templateCategory, ecommerceConfig, model, providerId } = body as {
      inputText: string;
      imageData?: string;
      templateCategory?: AgentTemplateCategory;
      ecommerceConfig?: EcommerceConfig;
      model?: string;
      providerId?: string;
    };

    if (!inputText?.trim()) {
      return NextResponse.json({ success: false, error: '请输入描述文字' }, { status: 400 });
    }

    // 积分检查与扣除（桌面端无 sessionUser 时跳过积分，走桌面端配额）
    deductedCredits = 0;
    if (sessionUser) {
      const creditResult = await consumeCredits(sessionUser.id, 'chat', undefined, undefined, model);
      if (!creditResult.success) {
        return NextResponse.json({ success: false, error: creditResult.message || '积分不足' }, { status: 402 });
      }
      deductedCredits = creditResult.cost;
    }

    const category: AgentTemplateCategory = templateCategory || 'general';
    const isEcommerce = category === 'ecommerce' && !!ecommerceConfig;

    // Find chat provider
    let provider;
    if (providerId) {
      provider = await findProviderById(providerId);
    } else if (model) {
      provider = await findProviderForModel(model, 'chat');
    }
    if (!provider) {
      provider = await findProviderForFeature('chat');
    }
    if (!provider) {
      return NextResponse.json({ success: false, error: '未配置聊天模型，请先在管理面板添加 LLM 模型提供商' }, { status: 400 });
    }

    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const apiKey = provider.apiKey;
    const rawSelectedModel = model || provider.selectedModels?.[0] || provider.selectedModel || '';
    const { apiModelName: selectedModel } = normalizeModelForApi(rawSelectedModel);

    if (!selectedModel) {
      return NextResponse.json({ success: false, error: '未选择聊天模型' }, { status: 400 });
    }

    // Build system prompt
    const systemPrompt = isEcommerce
      ? buildEcommerceSystemPrompt(ecommerceConfig!, !!imageData)
      : buildAgentSystemPrompt(category, !!imageData);

    const maxTokens = isEcommerce ? ECOMMERCE_AGENT_MAX_TOKENS : DEFAULT_AGENT_MAX_TOKENS;

    // Build request body — OpenAI Chat Completions format
    const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];

    // For ecommerce, prepend system prompt to user text (same pattern as Chrome extension)
    if (isEcommerce) {
      userContent.push({ type: 'text', text: `${systemPrompt}\n\n用户描述：${inputText}` });
    } else {
      userContent.push({ type: 'text', text: `${systemPrompt}\n\n用户描述：${inputText}` });
    }

    // Add image if provided
    if (imageData) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageData },
      });
    }

    const requestBody = {
      model: selectedModel,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: userContent,
      }],
    };

    // Execute API call
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetchWithV1Retry(baseUrl, '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody?.error?.message) errorDetail = errorBody.error.message;
          else if (errorBody?.message) errorDetail = errorBody.message;
        } catch { /* ignore */ }
        return NextResponse.json({ success: false, error: translateApiError(errorDetail) }, { status: response.status });
      }

      // Handle both SSE stream and JSON responses
      const contentType = response.headers.get('content-type') || '';
      let data: Record<string, unknown>;

      if (contentType.includes('text/event-stream') || contentType.includes('text/stream')) {
        // API returned SSE stream — parse stream events to extract complete message
        data = await parseSSEToJSON(response);
      } else {
        const responseText = await response.text();
        // Fallback: text starting with "data: " is also SSE
        if (responseText.trimStart().startsWith('data: ')) {
          data = parseSSETextToJSON(responseText);
        } else {
          try {
            data = JSON.parse(responseText) as Record<string, unknown>;
          } catch {
            throw new Error(`LLM 响应解析失败: ${responseText.slice(0, 200)}`);
          }
        }
      }

      const promptText = extractOpenAITextContent(data);

      if (!promptText) {
        return NextResponse.json({ success: false, error: 'API 返回空内容' }, { status: 500 });
      }

      // Parse result based on category
      const parsedAgentResult = !isEcommerce ? parseAgentGenerateResult({ prompt: promptText }) : null;
      const agentResult = parsedAgentResult?.ok ? parsedAgentResult.result : undefined;

      const parsedEcommerceResult = isEcommerce
        ? parseEcommerceGenerateResult({ prompt: promptText }, ecommerceConfig?.aspectRatio || '1:1')
        : null;
      const ecommercePrompts = parsedEcommerceResult?.ok ? parsedEcommerceResult.result : undefined;

      return NextResponse.json({
        success: true,
        data: {
          prompt: agentResult?.prompt || promptText,
          templateCategory: category,
          agentResult,
          ecommercePrompts,
        },
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return NextResponse.json({ success: false, error: '请求超时，请重试' }, { status: 408 });
      }
      throw error;
    }
  } catch (error) {
    console.error('[omp-agent API] Error:', error);
    // 退款：Agent生成失败时退还积分
    if (deductedCredits > 0 && sessionUser) {
      try {
        await refundCredits(sessionUser.id, deductedCredits, `Agent生成失败退款: ${(error instanceof Error ? error.message : 'Unknown').substring(0, 100)}`);
      } catch (refundErr) { console.error('[omp-agent] Refund failed:', refundErr); }
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Agent 生成失败' },
      { status: 500 }
    );
  }
}

// GET: return available templates
export async function GET() {
  return NextResponse.json({
    templates: AGENT_TEMPLATES,
  });
}
