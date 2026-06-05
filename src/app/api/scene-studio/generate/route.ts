import { NextRequest, NextResponse } from 'next/server';

// POST: generate image from 3D scene
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode, prompt, negativePrompt, screenshotData, structureStrength, aspectRatio, imageCount, model, providerId } = body;

    if (!prompt && mode !== 'text_to_image') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Find the API provider — prefer specified providerId, then image type
    const { findProviderForFeature, findProviderById, getApiProviders } = await import('@/lib/server-api-config');
    let provider: Awaited<ReturnType<typeof findProviderForFeature>> | null = null;

    // 1. Try specified providerId
    if (providerId) {
      provider = await findProviderById(providerId);
    }
    // 2. Try imageEdit type (maps to 'image' model_type internally)
    if (!provider) {
      provider = await findProviderForFeature('imageEdit');
    }
    // 3. Try 3d type
    if (!provider) {
      provider = await findProviderForFeature('3d');
    }
    // 4. Last resort: any image provider
    if (!provider) {
      const allProviders = await getApiProviders();
      const imageProvider = allProviders.find(p => p.modelType === 'image' && p.selectedModels && p.selectedModels.length > 0);
      if (imageProvider) provider = imageProvider;
    }
    if (!provider) {
      return NextResponse.json({ error: 'No image generation API configured. Please add one in admin panel.' }, { status: 400 });
    }

    // Build the enhanced prompt based on mode
    let enhancedPrompt = prompt || '';
    if (mode === 'image_to_image' || mode === 'structure_strict' || mode === 'balanced' || mode === 'creative' || mode === 'commercial') {
      const modeDescriptions: Record<string, string> = {
        structure_strict: 'Strictly preserve the composition, camera angle, object positions, spatial relationships and perspective from the reference image.',
        balanced: 'Preserve the main composition and camera angle while improving texture, lighting and visual quality.',
        creative: 'Use the reference as a structural guide but allow creative freedom in style, details and mood.',
        commercial: 'Enhance to commercial advertising quality with premium lighting, materials and brand-grade visual polish.',
        image_to_image: 'Generate based on the reference image, maintaining key composition elements.',
      };
      const modeDesc = modeDescriptions[mode] || modeDescriptions.image_to_image;
      enhancedPrompt = `${modeDesc}\n\nScene description: ${prompt}\n\nOutput: Commercial-grade quality, refined lighting, premium materials, clean composition, brand-ready visual.`;
    }

    // Resolve model name
    const modelName = model || (provider.selectedModels && provider.selectedModels.length > 0 ? provider.selectedModels[0] : 'dall-e-3');

    // Check for gemini-image profile — use chat/completions endpoint
    const { resolveProfileForModel, buildGeminiChatImageRequest, parseGeminiChatImageResponse, adjustRequestForProfile, parseResponseForProfile } = await import('@/lib/api-compatibility');
    const profile = resolveProfileForModel(modelName, provider);

    // Calculate size based on aspect ratio
    let size = '1344x768'; // default 16:9 landscape
    if (aspectRatio === '1:1') size = '1024x1024';
    else if (aspectRatio === '9:16') size = '768x1344';
    else if (aspectRatio === '4:3') size = '1152x896';
    else if (aspectRatio === '3:4') size = '896x1152';
    else if (aspectRatio === '16:9') size = '1344x768';

    const n = imageCount || 1;
    const hasImage = !!(screenshotData && mode !== 'text_to_image');

    const baseUrl = provider.baseUrl;
    const apiKey = provider.apiKey;
    const { fetchWithV1Retry } = await import('@/lib/api-helpers');

    // === Gemini-image route ===
    if (profile.id === 'gemini-image') {
      console.log(`[SceneStudio] Using gemini-image route for model ${modelName}`);

      const imageUrls: string[] = hasImage ? [screenshotData] : [];
      const chatBody = buildGeminiChatImageRequest({
        model: modelName,
        prompt: enhancedPrompt,
        size,
        n,
        imageUrls,
        strength: hasImage ? (structureStrength || 60) / 100 : undefined,
      });

      if (negativePrompt) {
        (chatBody as Record<string, unknown>).negative_prompt = negativePrompt;
      }

      const response = await fetchWithV1Retry(
        baseUrl,
        '/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(chatBody),
        },
        true,
        300000
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SceneStudio] Gemini generate API error:', response.status, errorText);
        return NextResponse.json({ error: `API error: ${response.status} - ${errorText.slice(0, 200)}` }, { status: response.status });
      }

      const result = await response.json();
      const imageUrls2 = parseGeminiChatImageResponse(result);

      if (imageUrls2.length === 0) {
        return NextResponse.json({ error: 'Gemini model did not return any images' }, { status: 500 });
      }

      return NextResponse.json({ success: true, result: { data: imageUrls2.map(url => ({ url })) } });
    }

    // === Standard route (openai / apimart / pearapi / auto) ===
    const requestBody: Record<string, unknown> = {
      model: modelName,
      prompt: enhancedPrompt,
      n,
      size,
    };

    if (negativePrompt) {
      requestBody.prompt += ` [negative: ${negativePrompt}]`;
    }

    // For image-to-image, include the screenshot as reference
    if (hasImage) {
      requestBody.image = screenshotData;
      requestBody.image_urls = [screenshotData];
      requestBody.strength = (structureStrength || 60) / 100;
    }

    const { body: finalBody, endpoint } = adjustRequestForProfile(requestBody, profile, { hasImage });

    // Determine endpoint path
    const endpointPath = endpoint || '/images/generations';
    const response = await fetchWithV1Retry(
      baseUrl,
      endpointPath,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(provider.advancedParams ? Object.fromEntries(
            Object.entries(provider.advancedParams).filter(([k]) =>
              !['compatProfile', 'pollPathTemplate', 'editEndpoint', 'defaultEndpoint', 'editEncoding'].includes(k)
            )
          ) : {}),
        },
        body: JSON.stringify(finalBody),
      },
      true,
      300000
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SceneStudio] Generate API error:', response.status, errorText);
      return NextResponse.json({ error: `API error: ${response.status} - ${errorText.slice(0, 200)}` }, { status: response.status });
    }

    const result = await response.json();
    const parsed = parseResponseForProfile(result, profile);

    // If the API returned taskIds for polling
    if (parsed.mode === 'polling' && parsed.taskIds.length > 0) {
      return NextResponse.json({
        success: true,
        result: { status: 'processing', taskIds: parsed.taskIds },
        isAsync: true,
        apiBaseUrl: baseUrl,
        apiKey,
        advancedParams: provider.advancedParams,
      });
    }

    // Direct image response
    return NextResponse.json({ success: true, result: { data: parsed.directImageUrls.map(url => ({ url })) } });
  } catch (error) {
    console.error('[SceneStudio] Generate error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// GET: return available image models
export async function GET() {
  try {
    const { getPublicModels } = await import('@/lib/server-api-config');
    const models = await getPublicModels('image');
    return NextResponse.json({ models });
  } catch (error) {
    console.error('[SceneStudio] Get models error:', error);
    return NextResponse.json({ models: [] });
  }
}
