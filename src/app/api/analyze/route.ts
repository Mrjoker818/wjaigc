import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { requireApiAuthOrReject } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult) return authResult;
  try {
    const { image, category } = await request.json();
    
    if (!image) {
      return NextResponse.json(
        { success: false, error: "缺少图片数据" },
        { status: 400 }
      );
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // 根据分类设置不同的提示词
    const categoryPrompts: Record<string, string> = {
      general: "请详细描述这张图片的内容，包括主体、背景、风格、色调、光线等细节。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      poster: "请分析这张海报设计，包括：1)整体风格和氛围 2)主视觉和核心元素 3)色彩搭配和排版特点 4)文字内容（如有）5)创意亮点。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      logo: "请分析这个Logo设计，包括：1)图形元素和符号含义 2)色彩搭配 3)整体风格（简约/复杂/扁平/立体等）4)适用场景。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      ip_character: "请分析这个IP形象，包括：1)角色外貌特征（发型、服装、表情等）2)性格特点 3)设计风格（可爱/酷炫/写实/卡通等）4)整体氛围。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      ui: "请分析这个UI界面，包括：1)整体布局和结构 2)色彩方案和视觉效果 3)图标和元素风格 4)交互设计特点。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      comic: "请分析这张漫画/插画，包括：1)画风和技法（赛璐璐/厚涂/水墨等）2)角色设计 3)场景氛围 4)构图特点。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      photo: "请分析这张照片，包括：1)拍摄主题和主体 2)光线和色调 3)构图方式 4)风格特点（人像/风光/纪实等）5)后期处理风格。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      detail_page: "请分析这个详情页设计，包括：1)页面布局和结构 2)产品展示方式 3)视觉风格 4)信息层次。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      social: "请分析这张社媒配图，包括：1)内容主题 2)视觉风格 3)色彩搭配 4)信息传达方式。请用简洁的英文描述，适合作为AI图片生成的提示词。",
      banner: "请分析这个Banner设计，包括：1)主题和卖点 2)视觉风格 3)色彩方案 4)排版布局。请用简洁的英文描述，适合作为AI图片生成的提示词。",
    };

    const prompt = categoryPrompts[category] || categoryPrompts.general;

    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          {
            type: "image_url" as const,
            image_url: {
              url: image,
              detail: "high" as const,
            },
          },
        ],
      },
    ];

    const response = await client.invoke(messages, {
      model: "doubao-seed-1-6-vision-250815",
      temperature: 0.7,
    });

    return NextResponse.json({
      success: true,
      prompt: response.content,
      model: "doubao-seed-1-6-vision-250815",
    });
  } catch (error) {
    console.error("Image analysis error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "图片分析失败" 
      },
      { status: 500 }
    );
  }
}
