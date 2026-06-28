import { NextRequest, NextResponse } from 'next/server';
import { findProviderForFeature } from '@/lib/server-api-config';

/**
 * Auto Multi-View to 3D API
 * 
 * Flow: User provides a text prompt → AI generates 4 view images → Submit to 3D model API
 * 
 * POST body:
 * - prompt: string (description of the 3D object)
 * - threeDType: string (3D provider type: hunyuan3d/meshy/tripo/rodin)
 * - threeDQuality: string (standard/hd/ultra)
 * - threeDTexture: string (standard/pbr/4k)
 * - enablePBR: boolean
 * - faceCount: number
 * - threeDFormat: string (glb/obj/fbx/usdz/stl)
 * - provider: { apiKey, baseUrl, advancedParams }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, threeDType, threeDQuality, threeDTexture, enablePBR, faceCount, threeDFormat, provider } = body;

    if (!prompt) {
      return NextResponse.json({ success: false, error: '请提供3D模型描述(prompt)' }, { status: 400 });
    }

    // Step 1: Find an image generation provider to create multi-view images
    let imageProvider = provider;
    if (!imageProvider?.apiKey) {
      // 'imageEdit' type covers image generation models (DALL-E, Flux, etc.)
      const resolved = await findProviderForFeature('imageEdit');
      if (resolved) {
        imageProvider = {
          apiKey: resolved.apiKey,
          baseUrl: resolved.baseUrl,
          advancedParams: resolved.advancedParams,
        };
      }
    }

    if (!imageProvider?.apiKey) {
      return NextResponse.json({ success: false, error: '请先在管理员系统配置可用的图像生成模型' }, { status: 400 });
    }

    // Step 2: Generate 4 view images using the image generation API
    const viewPrompts = [
      { view: 'front', label: '正面', suffix: ', front view, facing camera, centered composition' },
      { view: 'left', label: '左面', suffix: ', left side view, 90 degrees from front, centered composition' },
      { view: 'right', label: '右面', suffix: ', right side view, 270 degrees from front, centered composition' },
      { view: 'back', label: '背面', suffix: ', back view, 180 degrees from front, centered composition' },
    ];

    const generatedImages: Array<{ url: string; view: string; label: string }> = [];
    const errors: string[] = [];

    // Generate images sequentially to avoid rate limiting
    for (const vp of viewPrompts) {
      try {
        const imagePrompt = `${prompt}${vp.suffix}, white background, product photography, consistent style and lighting`;
        
        const baseUrl = imageProvider.baseUrl?.replace(/\/+$/, '');
        const apiUrl = `${baseUrl}/images/generations`;

        const requestBody: Record<string, unknown> = {
          model: imageProvider.advancedParams?.defaultImageModel || 'dall-e-3',
          prompt: imagePrompt,
          n: 1,
          size: '1024x1024',
          quality: 'standard',
        };

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${imageProvider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(120000), // 2 min timeout per image
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          errors.push(`${vp.label}生成失败: ${response.status}`);
          console.error(`[auto-multi-view] Image generation failed for ${vp.view}:`, response.status, errText);
          continue;
        }

        const result = await response.json();
        const imageUrl = result?.data?.[0]?.url || result?.data?.[0]?.b64_json;
        
        if (imageUrl) {
          generatedImages.push({ 
            url: imageUrl.startsWith('data:') ? imageUrl : imageUrl, 
            view: vp.view, 
            label: vp.label 
          });
        } else {
          errors.push(`${vp.label}未返回图片URL`);
        }
      } catch (err) {
        errors.push(`${vp.label}生成异常: ${err instanceof Error ? err.message : 'Unknown'}`);
        console.error(`[auto-multi-view] Image generation error for ${vp.view}:`, err);
      }
    }

    if (generatedImages.length === 0) {
      return NextResponse.json({
        success: false,
        error: '多视角图片生成全部失败，请检查图像模型配置',
        details: errors,
      }, { status: 500 });
    }

    // Step 3: Submit to 3D generation API with the generated images
    let threeDProvider = provider;
    if (!threeDProvider?.apiKey) {
      const resolved3D = await findProviderForFeature('3d');
      if (resolved3D) {
        threeDProvider = {
          apiKey: resolved3D.apiKey,
          baseUrl: resolved3D.baseUrl,
          advancedParams: resolved3D.advancedParams,
        };
      }
    }

    // Submit via the main image-to-3d route
    const submitResponse = await fetch(new URL('/api/image-to-3d', request.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'multi-image',
        images: generatedImages,
        prompt,
        threeDType,
        threeDQuality,
        threeDTexture,
        enablePBR,
        faceCount,
        threeDFormat,
        provider: threeDProvider,
      }),
    });

    const submitResult = await submitResponse.json();

    if (!submitResult.success) {
      return NextResponse.json({
        success: false,
        error: submitResult.error || '3D模型提交失败',
        generatedImages,
        details: errors,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      taskId: submitResult.taskId,
      backend: submitResult.backend,
      providerName: submitResult.providerName,
      generatedImages,
      warnings: errors.length > 0 ? errors : undefined,
      message: generatedImages.length < 4 
        ? `成功生成${generatedImages.length}/4个视角图片，已提交3D生成` 
        : '4个视角图片已生成，3D模型生成已提交',
    });

  } catch (error) {
    console.error('[auto-multi-view] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * GET: Return API capability info
 */
export async function GET() {
  return NextResponse.json({
    mode: 'auto-multi-view',
    description: '自动多视角转3D：AI先生成4个视角的图片，再合并转换为3D模型',
    views: ['front', 'left', 'right', 'back'],
    requirements: ['图像生成模型(管理员配置)', '3D模型API(管理员配置)'],
  });
}
