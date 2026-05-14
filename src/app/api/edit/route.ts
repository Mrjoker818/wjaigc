import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Gemini 模型映射（用于图片编辑）
const GEMINI_EDIT_MODELS: Record<string, {
  name: string;
  modelId: string;
  description: string;
}> = {
  'gemini-2.5-flash-image': {
    name: 'Nano Banana',
    modelId: 'gemini-2.0-flash-preview-05-20',
    description: '快速修图，适合日常使用',
  },
  'gemini-3-pro-image-preview': {
    name: 'Nano Banana Pro',
    modelId: 'gemini-3-pro-preview',
    description: '旗舰模型，高质量图片编辑',
  },
  'gemini-3.1-flash-image-preview': {
    name: 'Nano Banana 2',
    modelId: 'gemini-2.5-flash-preview-06-06',
    description: '平衡速度与质量',
  },
};

// 支持编辑的模型列表（包含 OpenAI 和 Gemini 模型）
export const EDITABLE_MODELS = [
  'gpt-image-2',
  'dall-e-3',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
];

// API模型配置
const API_MODEL_CONFIG: Record<string, {
  name: string;
  apiKeyPlaceholder: string;
  docsUrl: string;
}> = {
  'gpt-image-2': {
    name: 'GPT Image 2',
    apiKeyPlaceholder: 'OpenAI API Key',
    docsUrl: 'https://platform.openai.com/docs/guides/images'
  },
  'dall-e-3': {
    name: 'DALL-E 3',
    apiKeyPlaceholder: 'OpenAI API Key',
    docsUrl: 'https://platform.openai.com/docs/guides/images'
  },
  'gemini-2.5-flash-image': {
    name: 'Nano Banana',
    apiKeyPlaceholder: 'Google API Key',
    docsUrl: 'https://ai.google.dev/'
  },
  'gemini-3-pro-image-preview': {
    name: 'Nano Banana Pro',
    apiKeyPlaceholder: 'Google API Key',
    docsUrl: 'https://ai.google.dev/'
  },
  'gemini-3.1-flash-image-preview': {
    name: 'Nano Banana 2',
    apiKeyPlaceholder: 'Google API Key',
    docsUrl: 'https://ai.google.dev/'
  },
};

export async function POST(request: NextRequest) {
  try {
    const { 
      image,        // base64 data URL 或 URL
      prompt,       // 编辑指令（自然语言）
      mask,         // 可选，mask图片 base64（仅 OpenAI 模型使用）
      size = '1024x1024',
      quality = 'high',
      apiKey,
      model = 'gpt-image-2',
    } = await request.json();

    if (!image) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 });
    }

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // 检查模型是否支持编辑功能
    if (!EDITABLE_MODELS.includes(model)) {
      return NextResponse.json({
        success: false,
        error: `当前选择的模型 "${model}" 不支持编辑功能`,
        supportedModels: EDITABLE_MODELS,
        modelConfig: API_MODEL_CONFIG,
      }, { status: 400 });
    }

    // 检查是否需要 API Key
    const modelConfig = API_MODEL_CONFIG[model];
    if (modelConfig && !apiKey) {
      return NextResponse.json({
        success: false,
        error: `选择 ${modelConfig.name} 模型需要配置 API Key`,
        requiresApiKey: true,
        modelName: modelConfig.name,
        apiKeyPlaceholder: modelConfig.apiKeyPlaceholder,
        docsUrl: modelConfig.docsUrl,
      }, { status: 400 });
    }

    // 判断是否为 Gemini 模型
    const isGeminiModel = model.startsWith('gemini-');
    
    // 处理原图：如果image是URL则先fetch下载，否则提取base64
    let imageBuffer: Buffer;
    let mimeType = 'image/png';
    
    if (image.startsWith('data:')) {
      // base64 data URL，提取纯base64部分和mimeType
      const commaIndex = image.indexOf(',');
      const header = image.substring(0, commaIndex);
      const base64Data = image.substring(commaIndex + 1);
      
      // 提取 mimeType
      const mimeMatch = header.match(/data:([^;]+)/);
      if (mimeMatch) {
        mimeType = mimeMatch[1];
      }
      
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (image.startsWith('http://') || image.startsWith('https://')) {
      // URL，fetch下载
      try {
        const response = await fetch(image);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
        
        // 尝试从 Content-Type 获取 mimeType
        const contentType = response.headers.get('content-type');
        if (contentType) {
          mimeType = contentType;
        }
      } catch (fetchError: unknown) {
        const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        return NextResponse.json({
          success: false,
          error: `无法下载图片: ${errMsg}`,
        }, { status: 400 });
      }
    } else if (image.startsWith('/')) {
      // 相对路径（如 /api/serve-upload/xxx），拼接域名
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
      const fullUrl = domain ? `https://${domain}${image}` : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${image}`;
      try {
        const response = await fetch(fullUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
        
        const contentType = response.headers.get('content-type');
        if (contentType) {
          mimeType = contentType;
        }
      } catch (fetchError: unknown) {
        const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        return NextResponse.json({
          success: false,
          error: `无法下载图片: ${errMsg}`,
        }, { status: 400 });
      }
    } else {
      // 纯base64字符串
      imageBuffer = Buffer.from(image, 'base64');
    }

    // ========== Gemini 模型处理 ==========
    if (isGeminiModel) {
      const geminiConfig = GEMINI_EDIT_MODELS[model];
      
      if (!geminiConfig || !apiKey) {
        return NextResponse.json({
          success: false,
          error: `${modelConfig?.name || model} 模型需要配置 Google API Key`,
          requiresApiKey: true,
          modelName: modelConfig?.name || model,
          apiKeyPlaceholder: 'Google API Key',
          docsUrl: 'https://ai.google.dev/',
        }, { status: 400 });
      }

      try {
        // 初始化 Google Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        const geminiModel = genAI.getGenerativeModel({
          model: geminiConfig.modelId,
        });

        // 构建编辑提示词
        const editPrompt = `Edit this image according to the following instruction: ${prompt}. Maintain the overall composition and style while making the requested changes.`;

        // 调用 Gemini API 进行图片编辑
        // 注意：Gemini 不支持 mask 涂抹，仅根据文本指令编辑
        const result = await geminiModel.generateContent({
          contents: [{
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: imageBuffer.toString('base64'),
                  mimeType: mimeType,
                },
              },
              { text: editPrompt },
            ],
          }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'] as unknown as string[],
          } as any,
        });

        const response = result.response;

        // 提取生成的图片
        let resultImageBase64: string = '';
        let resultMimeType = 'image/png';
        
        for (const candidate of response.candidates || []) {
          for (const part of candidate.content.parts || []) {
            if (part.inlineData) {
              resultImageBase64 = part.inlineData.data || '';
              resultMimeType = part.inlineData.mimeType || 'image/png';
              break;
            }
          }
          if (resultImageBase64) break;
        }

        if (!resultImageBase64) {
          return NextResponse.json({
            success: false,
            error: 'Gemini 模型编辑失败，未返回有效结果',
          }, { status: 500 });
        }

        // 转换base64为data URL
        const imageDataUrl = `data:${resultMimeType};base64,${resultImageBase64}`;

        return NextResponse.json({
          success: true,
          image: {
            url: imageDataUrl,
            revisedPrompt: prompt,
          },
          model: model,
          provider: 'google',
        });

      } catch (geminiError: unknown) {
        const errMsg = geminiError instanceof Error ? geminiError.message : 'Unknown error';
        console.error('Gemini API error:', geminiError);
        
        // 处理网络错误
        if (errMsg.includes('fetch failed') || 
            errMsg.includes('ECONNREFUSED') ||
            errMsg.includes('ENOTFOUND') ||
            errMsg.includes('network')) {
          return NextResponse.json({
            success: false,
            error: `网络连接失败：无法访问 Google Gemini API。请检查：\n1. 当前网络环境是否可以访问 Google 服务\n2. API Key 是否正确配置`,
            modelName: modelConfig?.name || model,
            networkError: true,
          }, { status: 503 });
        }
        
        // 处理常见错误
        if (errMsg.includes('API_KEY') || errMsg.includes('invalid API key')) {
          return NextResponse.json({
            success: false,
            error: 'Google API Key 无效或已过期',
            modelName: modelConfig?.name || model,
          }, { status: 401 });
        }
        
        if (errMsg.includes('quota') || errMsg.includes('limit') || errMsg.includes('429')) {
          return NextResponse.json({
            success: false,
            error: 'API 调用次数已达上限，请稍后再试',
            modelName: modelConfig?.name || model,
          }, { status: 429 });
        }

        if (errMsg.includes('PERMISSION_DENIED') || errMsg.includes('permission') || errMsg.includes('403')) {
          return NextResponse.json({
            success: false,
            error: 'API Key 权限不足：请确保已开启 Gemini API 服务并启用 Image Generation 功能',
            modelName: modelConfig?.name || model,
          }, { status: 403 });
        }

        return NextResponse.json({
          success: false,
          error: errMsg || 'Gemini API 调用失败',
          modelName: modelConfig?.name || model,
        }, { status: 500 });
      }
    }

    // ========== OpenAI 模型处理 ==========
    
    // 处理mask（可选，仅 OpenAI 模型使用）
    let maskBuffer: Buffer | undefined;
    if (mask) {
      if (mask.startsWith('data:')) {
        // base64 data URL，提取纯base64部分
        const base64Data = mask.split(',')[1];
        maskBuffer = Buffer.from(base64Data, 'base64');
      } else if (mask.startsWith('http://') || mask.startsWith('https://')) {
        // URL，fetch下载
        try {
          const response = await fetch(mask);
          if (!response.ok) {
            throw new Error(`Failed to fetch mask: ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          maskBuffer = Buffer.from(arrayBuffer);
        } catch (fetchError: unknown) {
          const errMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
          return NextResponse.json({
            success: false,
            error: `无法下载mask: ${errMsg}`,
          }, { status: 400 });
        }
      } else {
        // 纯base64字符串
        maskBuffer = Buffer.from(mask, 'base64');
      }
    }

    // 创建OpenAI客户端
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    // 确定使用的模型
    const imageModel = model === 'gpt-image-2' ? 'gpt-image-2' : 'dall-e-3';

    // OpenAI图片尺寸映射
    const sizeMap: Record<string, string> = {
      '1:1': '1024x1024',
      '16:9': '1792x1024',
      '9:16': '1024x1792',
      '4:3': '1024x768',
      '3:4': '768x1024',
      '1024': '1024x1024',
      '1536': '1536x1536',
      '2048': '2048x2048',
    };

    // 处理尺寸参数
    let outputSize = size;
    if (sizeMap[size]) {
      outputSize = sizeMap[size];
    } else if (!size.includes('x')) {
      // 如果只传了数字，转为标准格式
      outputSize = `${size}x${size}`;
    }

    // 构建API调用参数 - 使用 OpenAI SDK v6 类型
    const editParams: Record<string, unknown> = {
      model: imageModel,
      image: imageBuffer,
      prompt: prompt,
    };

    // 添加mask（可选）
    if (maskBuffer) {
      editParams.mask = maskBuffer;
    }

    // GPT Image 2 参数
    if (imageModel === 'gpt-image-2') {
      editParams.size = outputSize;
      editParams.quality = quality;
      editParams.background = 'opaque';
      editParams.output_format = 'png';
      editParams.n = 1;
    } else {
      // DALL-E 3 参数
      editParams.size = outputSize;
      editParams.quality = quality === 'high' ? 'hd' : 'standard';
      editParams.n = 1;
    }

    // 调用 OpenAI API
    const response = await openai.images.edit(editParams as any);

    // 提取结果图片 - SDK v6 返回 ImagesResponse
    const resp = response as any;
    let resultUrl: string | null = null;
    let revisedPrompt: string | null = null;

    if (resp.data && Array.isArray(resp.data) && resp.data.length > 0) {
      const img = resp.data[0];
      resultUrl = img.b64_json ? `data:image/png;base64,${img.b64_json}` : (img.url || null);
      revisedPrompt = img.revised_prompt || null;
    }

    if (!resultUrl) {
      return NextResponse.json({
        success: false,
        error: '图片编辑失败，未返回有效结果',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      image: {
        url: resultUrl,
        revisedPrompt: revisedPrompt || prompt,
      },
      model: imageModel,
      provider: 'openai',
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as { status?: number })?.status;
    console.error('Image edit error:', error);
    
    // 处理 OpenAI API 错误
    if (statusCode === 401) {
      return NextResponse.json({
        success: false,
        error: 'API Key 无效或已过期，请检查配置',
        requiresApiKey: true,
        apiKeyPlaceholder: 'OpenAI API Key',
      }, { status: 401 });
    }
    
    if (statusCode === 429) {
      return NextResponse.json({
        success: false,
        error: '请求频率超限，请稍后再试',
      }, { status: 429 });
    }

    return NextResponse.json({
      success: false,
      error: errMsg || '图片编辑失败，请重试',
    }, { status: 500 });
  }
}

// 获取支持的编辑模型列表
export async function GET() {
  return NextResponse.json({
    supportedModels: EDITABLE_MODELS,
    models: EDITABLE_MODELS.map(model => ({
      value: model,
      ...API_MODEL_CONFIG[model],
    })),
  });
}
