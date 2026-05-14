import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// 支持编辑的模型列表（仅OpenAI模型支持编辑功能）
export const EDITABLE_MODELS = ['gpt-image-2', 'dall-e-3'];

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
};

export async function POST(request: NextRequest) {
  try {
    const { 
      image,        // base64 data URL 或 URL
      prompt,       // 编辑指令（自然语言）
      mask,         // 可选，mask图片 base64
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

    // 处理原图：如果image是URL则先fetch下载，否则提取base64
    let imageBuffer: Buffer;
    if (image.startsWith('data:')) {
      // base64 data URL，提取纯base64部分
      const base64Data = image.split(',')[1];
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
      } catch (fetchError: any) {
        return NextResponse.json({
          success: false,
          error: `无法下载图片: ${fetchError.message}`,
        }, { status: 400 });
      }
    } else if (image.startsWith('/')) {
      // 相对路径（如 /api/serve-upload/xxx），拼接域名
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
      const fullUrl = image.startsWith('/') ? `${domain}${image}` : image;
      try {
        const response = await fetch(fullUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      } catch (fetchError: any) {
        return NextResponse.json({
          success: false,
          error: `无法下载图片: ${fetchError.message}`,
        }, { status: 400 });
      }
    } else {
      // 纯base64字符串
      imageBuffer = Buffer.from(image, 'base64');
    }

    // 处理mask（可选）
    let maskBuffer: Buffer | undefined;
    if (mask) {
      if (mask.startsWith('data:')) {
        const base64Data = mask.split(',')[1];
        maskBuffer = Buffer.from(base64Data, 'base64');
      } else if (mask.startsWith('http://') || mask.startsWith('https://')) {
        try {
          const response = await fetch(mask);
          if (!response.ok) {
            throw new Error(`Failed to fetch mask: ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          maskBuffer = Buffer.from(arrayBuffer);
        } catch (fetchError: any) {
          return NextResponse.json({
            success: false,
            error: `无法下载mask: ${fetchError.message}`,
          }, { status: 400 });
        }
      } else {
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
    };

    // 处理尺寸参数
    let outputSize = size;
    if (sizeMap[size]) {
      outputSize = sizeMap[size];
    } else if (!size.includes('x')) {
      outputSize = `${size}x${size}`;
    }

    // 构建API调用参数
    const apiParams: Record<string, any> = {
      model: imageModel,
      image: imageBuffer.toString('base64'),
      prompt: prompt,
    };

    // 添加mask（可选）
    if (maskBuffer) {
      apiParams.mask = maskBuffer.toString('base64');
    }

    // DALL-E 3 使用 b64_json 格式
    if (imageModel === 'dall-e-3') {
      apiParams.size = outputSize;
      apiParams.quality = quality === 'high' ? 'hd' : 'standard';
      apiParams.response_format = 'b64_json';
    } else {
      // GPT Image 2 参数
      apiParams.size = outputSize;
      if (quality === 'low') {
        apiParams.quality = 'standard';
      } else if (quality === 'medium') {
        apiParams.quality = 'medium';
      } else {
        apiParams.quality = 'high';
      }
      apiParams.background = true;
    }

    // 调用 OpenAI API
    const response = await openai.images.edit(apiParams as any);

    // 提取结果图片
    const result = response.data?.[0];
    if (!result || !result.b64_json) {
      return NextResponse.json({
        success: false,
        error: '图片编辑失败，未返回有效结果',
      }, { status: 500 });
    }

    // 转换base64为data URL
    const imageDataUrl = `data:image/png;base64,${result.b64_json}`;

    return NextResponse.json({
      success: true,
      image: {
        url: imageDataUrl,
        revisedPrompt: result.revised_prompt || prompt,
      },
      model: imageModel,
      size: outputSize,
    });

  } catch (error: any) {
    console.error('Image edit error:', error);
    
    // 处理 OpenAI API 错误
    if (error?.status === 401) {
      return NextResponse.json({
        success: false,
        error: 'API Key 无效或已过期，请检查配置',
        requiresApiKey: true,
        apiKeyPlaceholder: 'OpenAI API Key',
      }, { status: 401 });
    }
    
    if (error?.status === 429) {
      return NextResponse.json({
        success: false,
        error: '请求频率超限，请稍后再试',
      }, { status: 429 });
    }

    return NextResponse.json({
      success: false,
      error: error.message || '图片编辑失败，请重试',
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
