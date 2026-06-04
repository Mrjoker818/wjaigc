import { NextRequest, NextResponse } from 'next/server';

// POST: generate image from 3D scene
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode, prompt, negativePrompt, screenshotData, structureStrength, aspectRatio, imageCount, model } = body;

    if (!prompt && mode !== 'text_to_image') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Find the best available API provider for image generation
    const { findProviderForFeature, getApiProviders } = await import('@/lib/server-api-config');
    let provider: Awaited<ReturnType<typeof findProviderForFeature>> = await findProviderForFeature('imageEdit');
    if (!provider) {
      provider = await findProviderForFeature('3d');
    }
    if (!provider) {
      // Try any image model provider as last resort
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

    // Prepare the API request
    const { resolveCompatProfile, adjustRequestForProfile } = await import('@/lib/api-compatibility');
    const compatProfile = resolveCompatProfile(provider);

    // Calculate size based on aspect ratio
    let size = '1344x768'; // default 16:9 landscape
    if (aspectRatio === '1:1') size = '1024x1024';
    else if (aspectRatio === '9:16') size = '768x1344';
    else if (aspectRatio === '4:3') size = '1152x896';
    else if (aspectRatio === '3:4') size = '896x1152';
    else if (aspectRatio === '16:9') size = '1344x768';

    const n = imageCount || 1;

    const requestBody: Record<string, unknown> = {
      model: model || (provider.selectedModels && provider.selectedModels.length > 0 ? provider.selectedModels[0] : 'dall-e-3'),
      prompt: enhancedPrompt,
      n,
      size,
    };

    if (negativePrompt) {
      requestBody.prompt += ` [negative: ${negativePrompt}]`;
    }

    // For image-to-image, include the screenshot as reference
    const hasImage = !!(screenshotData && mode !== 'text_to_image');
    if (hasImage) {
      requestBody.image = screenshotData;
      requestBody.strength = (structureStrength || 60) / 100;
    }

    const { body: finalBody, endpoint } = adjustRequestForProfile(requestBody, compatProfile, { hasImage });

    // Submit to the API
    const baseUrl = provider.baseUrl;
    const { fetchWithV1Retry } = await import('@/lib/api-helpers');
    const apiKey = provider.apiKey;

    // Determine endpoint path from compat profile
    const endpointPath = endpoint === '/images/edits' ? '/images/edits' : '/images/generations';
    const response = await fetchWithV1Retry(
      baseUrl,
      endpointPath,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(finalBody),
      },
      true,
      300000
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SceneStudio] Generate API error:', response.status, errorText);
      return NextResponse.json({ error: `API error: ${response.status}` }, { status: response.status });
    }

    const result = await response.json();

    // Try to handle async task responses (e.g., apimart)
    const { parseResponseForProfile } = await import('@/lib/api-compatibility');
    const parsed = parseResponseForProfile(result, compatProfile);

    // If the API returned taskIds for polling
    if (parsed.mode === 'polling' && parsed.taskIds.length > 0) {
      return NextResponse.json({
        success: true,
        result: { status: 'processing', taskIds: parsed.taskIds },
        isAsync: true,
      });
    }

    // Direct image response
    return NextResponse.json({ success: true, result: { data: parsed.directImageUrls.map(url => ({ url })) } });
  } catch (error) {
    console.error('[SceneStudio] Generate error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
