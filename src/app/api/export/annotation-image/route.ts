import { NextRequest, NextResponse } from 'next/server';
import { findProviderForModel } from '@/lib/server-api-config';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { getSessionUser } from '@/lib/server-auth';
import { validateApiInputs } from '@/lib/api-validator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        imageUrl: 'imageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const {
      imageUrl = '',
      annotations = [],
      brandName = '',
      title = '',
    } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: '请提供图片URL' }, { status: 400 });
    }

    // Use LLM to generate annotation content
    const provider = await findProviderForModel('', 'chat');
    const annotationPrompt = `请为以下品牌展陈效果图生成标注信息：品牌：${brandName}，标题：${title}。
请以JSON格式输出标注列表，每个标注包含：{ "label": "标注名称", "description": "说明", "material": "材质", "craft": "工艺" }`;

    const sessionUser = await getSessionUser(request).catch(() => null);
    const taskId = `anno_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    registerTask(taskId, 'packaging', `标注图: ${brandName}`, sessionUser?.id);

    // For now, return a simplified response - the client can handle annotation rendering
    return NextResponse.json({
      success: true,
      taskId,
      annotations: annotations.length > 0 ? annotations : [],
      prompt: annotationPrompt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}
