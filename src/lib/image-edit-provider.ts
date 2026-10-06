import { createImageEditProviderCall, ImageEditProviderBoundaryError, type ImageEditProviderCallOptions, type ImageEditProviderExecution } from '@/lib/image-edit-provider-boundary';
import { translateApiError } from '@/lib/api-error-translate';
import { adjustRequestForProfile, parseResponseForProfile, isEditsEndpointRejected, stripEditsOnlyFields, type ImageEndpoint, buildGeminiChatImageRequest, parseGeminiChatImageResponse, resolveProfileForModel, isGeminiImageModel, isChannelUnavailableError } from '@/lib/api-compatibility';
import type { ImageEditModelCandidate } from '@/lib/task-core/image-edit-model-plan';

// Helper: submit a task to the images/generations API and return taskId or directUrl
// Custom error for model capability issues (triggers chat-vision fallback)
export class ModelCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelCapabilityError';
  }
}

export async function submitImageTask(
  apiBaseUrl: string,
  apiKey: string,
  requestBody: Record<string, unknown>,
  endpoint: '/images/generations' | '/images/edits' = '/images/generations',
  providerInfo?: { baseUrl?: string; requestStyle?: string; advancedParams?: Record<string, string>; model?: string } | null,
  options?: ImageEditProviderCallOptions,
): Promise<{ taskId?: string; directUrl?: string; apiBaseUrl?: string; apiKey?: string; advancedParams?: Record<string, string> }> {
  // 解析兼容性档案 — 优先使用 resolveProfileForModel 来正确处理 Gemini 图像模型
  const modelId = providerInfo?.model || (typeof requestBody.model === 'string' ? requestBody.model : '');
  const call = createImageEditProviderCall(options, modelId, 'image');
  const fetchWithV1Retry = call.fetchWithV1Retry;
  const tryChatCompletionsImageFallback = call.chatFallback;
  const profile = resolveProfileForModel(modelId, providerInfo);

  // ★ Gemini 图像模型专用路由：通过 /chat/completions 生图
  // 某些中转站（如4SAPI）的 Gemini 图像模型仅支持 /chat/completions 端点，
  // 不支持 /images/generations。需要将请求转换为 chat 格式。
  //
  // ⚠️ 但真正的 Gemini 图像模型通过 chat/completions 只能"参考"原图生成新图，
  // 无法做精确编辑操作。对于 outpaint/inpaint（扩展/擦除/蒙版）等需要像素级控制的操作，
  // Gemini 会变形/重绘而非精确扩展，应跳过此 provider 回退到支持 edits 的候选模型。
  // 注意：同一 provider 上的非 Gemini 模型（如 gpt-image-2-c）不应被拒绝，
  // 因为它们通过 chat/completions 也能做编辑。
  const isActualGeminiImageModel = isGeminiImageModel(modelId);
  const isEditOperation = endpoint === '/images/edits'
    || !!requestBody.mask
    || (typeof requestBody.strength === 'number' && requestBody.strength < 1)
    || (typeof requestBody.prompt === 'string' && (
      requestBody.prompt.includes('outpainting') ||
      requestBody.prompt.includes('expansion task') ||
      requestBody.prompt.includes('inpainting') ||
      requestBody.prompt.includes('erase') ||
      requestBody.prompt.includes('remove')
    ));

  if (profile.id === 'gemini-image' && isActualGeminiImageModel && isEditOperation) {
    // Gemini chat/completions 不支持精确图片编辑，跳过此 provider
    console.info(`[submitImageTask] Skipping gemini-image model "${modelId}" for edit operation, will try next candidate`);
    throw new Error('GEMINI_IMAGE_NOT_FOR_EDITS: Gemini 图像模型不支持精确编辑操作（扩展/擦除/蒙版），请使用其他图像模型');
  }

  if (profile.id === 'gemini-image' && !isEditOperation) {
    console.info(`[submitImageTask] Gemini image route detected for model="${modelId}", using /chat/completions`);
    const chatRequestBody = buildGeminiChatImageRequest(requestBody);
    const chatController = new AbortController();
    const chatTimeoutId = setTimeout(() => chatController.abort(), 600000); // 10分钟超时

    try {
      const chatResponse = await fetchWithV1Retry(
        apiBaseUrl,
        '/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chatRequestBody),
          signal: chatController.signal,
        }
      );

      clearTimeout(chatTimeoutId);

      if (!chatResponse.ok) {
        const errorText = await chatResponse.text();
        console.error('[submitImageTask] Gemini chat/completions error:', chatResponse.status, errorText);
        let errorMsg = `Gemini API 请求失败 (${chatResponse.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) errorMsg = errorJson.error.message;
        } catch { /* ignore */ }
        throw new Error(translateApiError(errorMsg));
      }

      const chatResponseText = await chatResponse.text();
      let chatResult: Record<string, unknown>;
      try {
        chatResult = call.parse(() => JSON.parse(chatResponseText));
      } catch (error) {
        call.stop(error);
        console.error('[submitImageTask] Gemini chat returned non-JSON, first 200 chars:', chatResponseText.substring(0, 200));
        throw new Error('Gemini API 返回了非 JSON 响应');
      }

      const extractedImageUrls = call.parse(() => parseGeminiChatImageResponse(chatResult));
      if (extractedImageUrls.length > 0) {
        console.info(`[submitImageTask] Gemini image route: extracted ${extractedImageUrls.length} images`);
        return await call.acceptImage({ directUrl: extractedImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams });
      }

      call.stop(new Error('Missing Gemini image result'));
      // 没有提取到图片
      const choices = chatResult.choices as Array<Record<string, unknown>> | undefined;
      if (choices && choices.length > 0) {
        const content = (choices[0].message as Record<string, unknown>)?.content;
        console.error('[submitImageTask] Gemini chat response has choices but no extractable image. Content type:', typeof content, 'Content preview:', typeof content === 'string' ? content.substring(0, 200) : JSON.stringify(content).substring(0, 200));
      }

      throw new Error('Gemini 图像模型未返回图片结果');
    } finally {
      clearTimeout(chatTimeoutId);
    }
  }

  // 使用兼容性层调整请求（size格式、端点选择、input_fidelity等）
  const hasImageField = !!requestBody.image;
  const { body: adjustedBody, endpoint: resolvedEndpoint } = adjustRequestForProfile(
    requestBody,
    profile,
    { hasImage: hasImageField, isEditEndpoint: endpoint === '/images/edits' },
  );

  // 如果兼容性层建议使用不同的端点，优先使用
  const effectiveEndpoint = resolvedEndpoint;

  const controller = new AbortController();
  const isDirectMode = profile.responseMode === 'direct';
  const timeoutMs = isDirectMode ? 600000 : 300000; // 直接模式600s(兼容token link等慢速API), 异步模式300s
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Debug: log key params for image-to-image verification
    const hasImageUrls = !!adjustedBody.image_urls;
    const urls = adjustedBody.image_urls as string[] | undefined;
    const str = adjustedBody.strength;
    const sz = adjustedBody.size;
    const pmt = String(adjustedBody.prompt || '').substring(0, 80);
    const hasImg = !!(adjustedBody.image || (Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0));
    const inputFidelity = adjustedBody.input_fidelity;
    console.info(`[submitImageTask] API call: endpoint=${effectiveEndpoint}, profile=${profile.id}, hasImageUrls=${hasImageUrls}, hasImage=${hasImg}, inputFidelity=${inputFidelity}, urlCount=${urls?.length || 0}, urlType=${urls?.[0]?.substring(0, 30) || 'N/A'}, strength=${str}, size=${sz}, prompt=${pmt}...`);

    // For /images/edits endpoint, try JSON first (most proxies accept it), then fallback to multipart form
    let submitResponse: Response;

    if (effectiveEndpoint === '/images/edits' && hasImg) {
      // Strategy: Try JSON first (most API proxies support JSON for edits)
      // If it fails with form-related error, retry with multipart form data
      const jsonBody = { ...adjustedBody };

      submitResponse = await fetchWithV1Retry(
        apiBaseUrl,
        effectiveEndpoint,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(jsonBody),
          signal: controller.signal,
        }
      );

      // If JSON request fails, try multipart form data as fallback
      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        const needsMultipart = errorText.includes('multipart') ||
          errorText.includes('form-data') ||
          errorText.includes('Content-Type') ||
          errorText.includes('expected multipart') ||
          errorText.includes('no file') ||
          errorText.includes('file required') ||
          errorText.includes('Missing image') ||
          errorText.includes('Invalid') ||
          errorText.includes('invalid');

        if (needsMultipart) {
          console.info(`[submitImageTask] JSON failed for edits endpoint, retrying with multipart form data...`);
          // Build multipart form data
          // If adjustRequestForProfile merged image → images[], extract first image back for multipart
          const multipartBody = { ...adjustedBody };
          if (!multipartBody.image && Array.isArray(multipartBody.images) && multipartBody.images.length > 0) {
            const firstImg = multipartBody.images[0] as Record<string, unknown>;
            if (firstImg?.image_url && typeof (firstImg.image_url as Record<string, unknown>)?.url === 'string') {
              multipartBody.image = (firstImg.image_url as Record<string, {url: string}>).url;
            } else if (typeof firstImg?.url === 'string') {
              multipartBody.image = firstImg.url;
            }
            // Remove first image from images[] to avoid duplication
            multipartBody.images = (multipartBody.images as unknown[]).slice(1);
            if ((multipartBody.images as unknown[]).length === 0) {
              delete multipartBody.images;
            }
          }
          const formData = new FormData();
          for (const [key, value] of Object.entries(multipartBody)) {
            if (value === undefined || value === null) continue;
            if (key === 'image') {
              // image field: could be base64 data URL or plain base64
              const imgVal = String(value);
              if (imgVal.startsWith('data:')) {
                // data:image/png;base64,xxxxx
                const match = imgVal.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  const mimeType = match[1];
                  const base64Data = match[2];
                  const binaryData = Buffer.from(base64Data, 'base64');
                  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
                  const file = new File([binaryData], `image.${ext}`, { type: mimeType });
                  formData.append('image', file);
                }
              } else {
                // Plain base64
                const binaryData = Buffer.from(imgVal, 'base64');
                const file = new File([binaryData], 'image.png', { type: 'image/png' });
                formData.append('image', file);
              }
            } else if (Array.isArray(value)) {
              // Arrays like images[] for multi-image edits
              for (let i = 0; i < value.length; i++) {
                const item = value[i];
                if (typeof item === 'object' && item !== null) {
                  // OpenAI format: {image_url: {url: "data:..."}} or {image_url: {url: "https://..."}}
                  const imgUrl = (item as Record<string, unknown>)?.image_url
                    ? ((item as Record<string, Record<string, unknown>>).image_url?.url as string)
                    : (item as Record<string, unknown>)?.url as string;
                  if (imgUrl) {
                    if (imgUrl.startsWith('data:')) {
                      const match = imgUrl.match(/^data:([^;]+);base64,(.+)$/);
                      if (match) {
                        const mimeType = match[1];
                        const base64Data = match[2];
                        const binaryData = Buffer.from(base64Data, 'base64');
                        const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
                        const file = new File([binaryData], `image_${i}.${ext}`, { type: mimeType });
                        formData.append(`${key}[${i}]`, file);
                      }
                    } else {
                      // HTTP URL - append as string
                      formData.append(`${key}[${i}][image_url][url]`, imgUrl);
                    }
                  } else {
                    formData.append(`${key}[${i}]`, JSON.stringify(item));
                  }
                } else {
                  formData.append(key, String(item));
                }
              }
            } else {
              formData.append(key, String(value));
            }
          }

          submitResponse = await fetchWithV1Retry(
            apiBaseUrl,
            effectiveEndpoint,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...(() => {
                  // Node.js 原生 fetch + 浏览器 FormData 需要手动设置 Content-Type
                  // 让 fetch 自动处理 boundary
                  return {};
                })(),
              },
              body: formData,
              signal: controller.signal,
            }
          );
        } else {
          // Not a form-related error, re-create the response for error handling below
          // We already have the error text, create a synthetic response
          submitResponse = new Response(errorText, { status: submitResponse.status, headers: submitResponse.headers });
        }
      }
    } else {
      // Standard JSON request for /images/generations
      // 当 /images/generations 携带 image_urls 时，增强 prompt 以确保 AI 使用参考图
      if (effectiveEndpoint === '/images/generations' && hasImageUrls) {
        if (!String(adjustedBody.prompt || '').includes('[IMAGE-TO-IMAGE MODE]') && !String(adjustedBody.prompt || '').includes('[REFERENCE IMAGE]')) {
          adjustedBody.prompt = `[IMAGE-TO-IMAGE MODE] You MUST use the provided reference image as the mandatory source/base for generation. Do NOT generate from scratch. ${String(adjustedBody.prompt || '')}`;
        }
      }
      submitResponse = await fetchWithV1Retry(
        apiBaseUrl,
        effectiveEndpoint,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(adjustedBody),
          signal: controller.signal,
        }
      );
    }

    clearTimeout(timeoutId);

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error('Image task submit error:', submitResponse.status, errorText);
      let errorMsg = `API 请求失败 (${submitResponse.status})`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = errorJson.error?.message || errorJson.message || errorJson.msg || errorJson.detail || errorMsg;
      } catch { /* ignore */ }
      // 原始文本兜底：如果解析后的 errorMsg 仍为默认格式，尝试从原始文本提取关键信息
      if (errorMsg === `API 请求失败 (${submitResponse.status})`) {
        const lowerText = errorText.toLowerCase();
        if (lowerText.includes('no available channel')) errorMsg = errorText.trim();
        else if (lowerText.includes('model_not_found') || lowerText.includes('model not found')) errorMsg = errorText.trim();
      }

      // 自动回退：如果 /images/edits 端点不被支持，回退到 /images/generations
      // 使用原始响应文本(errorText)进行检测，而非清理后的 errorMsg
      if (effectiveEndpoint === '/images/edits' && isEditsEndpointRejected(submitResponse.status, errorText)) {
        console.log('[submitImageTask] /images/edits rejected, auto-falling back to /images/generations');
        const fallbackBody = stripEditsOnlyFields(adjustedBody);

        // ★ If images[] nested format exists (from adjustRequestForProfile conversion),
        // convert back to image_urls flat format for maximum provider compatibility
        if (Array.isArray(fallbackBody.images) && fallbackBody.images.length > 0) {
          const flatUrls = (fallbackBody.images as Array<{ image_url: { url: string } }>)
            .map((img) => img.image_url?.url || '')
            .filter(Boolean);
          delete fallbackBody.images;
          if (flatUrls.length > 0) {
            fallbackBody.image_urls = flatUrls;
          }
        }

        const fallbackEndpoint: ImageEndpoint = '/images/generations';

        // 增强 prompt：/images/generations 仅将 image_urls 视为可选参考，
        // 必须在 prompt 中明确指示 AI 使用参考图作为基础
        if (fallbackBody.image_urls && Array.isArray(fallbackBody.image_urls) && (fallbackBody.image_urls as string[]).length > 0) {
          const refCount = (fallbackBody.image_urls as string[]).length;
          fallbackBody.prompt = `[IMAGE-TO-IMAGE MODE] You MUST use the provided ${refCount > 1 ? `${refCount} reference images` : 'reference image'} as the mandatory source/base for generation. Do NOT generate from scratch. ${String(fallbackBody.prompt || '')}`;
        }

        try {
          const fallbackResponse = await fetchWithV1Retry(
            apiBaseUrl,
            fallbackEndpoint,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(fallbackBody),
              signal: AbortSignal.timeout(isChannelUnavailableError(errorText) ? 30000 : 60000),
            }
          );
          if (fallbackResponse.ok) {
            console.log('[submitImageTask] fallback to /images/generations succeeded');
            const fallbackText = await fallbackResponse.text();
            const fallbackJson = call.parse(() => JSON.parse(fallbackText));
            const parsed = call.parse(() => parseResponseForProfile(fallbackJson, profile));
            return await call.acceptImage({
              taskId: parsed.taskIds?.[0],
              directUrl: parsed.directImageUrls?.[0],
            });
          } else {
            const fallbackErrorText = await fallbackResponse.text();
            console.error('[submitImageTask] fallback also failed:', fallbackResponse.status, fallbackErrorText);

            // ★ Third fallback: try /chat/completions (for API proxies that only support models via chat)
            if (isChannelUnavailableError(`${fallbackErrorText} ${fallbackResponse.status}`)) {
              console.info('[submitImageTask] /images/generations also failed with channel error, trying /chat/completions fallback...');
              try {
                const chatImageUrls = await tryChatCompletionsImageFallback({
                  baseUrl: apiBaseUrl,
                  apiKey,
                  model: modelId,
                  prompt: String(adjustedBody.prompt || ''),
                  imageBase64: (adjustedBody.image as string) || undefined,
                  imageUrls: (adjustedBody.image_urls as string[]) || undefined,
                  size: adjustedBody.size as string | undefined,
                  originalError: fallbackErrorText,
                  requestIdPrefix: 'image-edit',
                  skipChannelCheck: true,
                });
                if (chatImageUrls && chatImageUrls.length > 0) {
                  console.log('[submitImageTask] /chat/completions fallback succeeded, got', chatImageUrls.length, 'images');
                  return await call.acceptImage({ directUrl: chatImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams });
                }
              } catch (chatErr) {
                if (chatErr instanceof ImageEditProviderBoundaryError) throw chatErr;
                console.warn('[submitImageTask] /chat/completions fallback error:', chatErr);
              }
            }
          }
        } catch (fallbackErr) {
          if (fallbackErr instanceof ImageEditProviderBoundaryError) throw fallbackErr;
          // /images/generations timed out → try /chat/completions immediately
          const isTimeout = fallbackErr instanceof Error && (fallbackErr.name === 'AbortError' || /timeout|aborted/i.test(fallbackErr.message));
          if (isTimeout) {
            console.info('[submitImageTask] /images/generations timed out, trying /chat/completions fallback...');
            try {
              const chatImageUrls = await tryChatCompletionsImageFallback({
                baseUrl: apiBaseUrl,
                apiKey,
                model: modelId,
                prompt: String(adjustedBody.prompt || ''),
                imageBase64: (adjustedBody.image as string) || undefined,
                imageUrls: (adjustedBody.image_urls as string[]) || undefined,
                size: adjustedBody.size as string | undefined,
                originalError: 'images/generations timeout',
                requestIdPrefix: 'image-edit',
                skipChannelCheck: true,
              });
              if (chatImageUrls && chatImageUrls.length > 0) {
                console.log('[submitImageTask] /chat/completions fallback succeeded (after generations timeout), got', chatImageUrls.length, 'images');
                return await call.acceptImage({ directUrl: chatImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams });
              }
            } catch (chatErr) {
              if (chatErr instanceof ImageEditProviderBoundaryError) throw chatErr;
              console.warn('[submitImageTask] /chat/completions fallback error (after generations timeout):', chatErr);
            }
          }
          console.error('[submitImageTask] fallback request error:', fallbackErr);
        }
      }

      // ★ Fallback: if /images/generations with images[] nested format fails with
      // "请上传参考图" or "reference #" error, retry with image_urls (flat string array) format.
      // Some providers (e.g. AI Link) don't support the nested images[] format on
      // /images/generations and require the flat image_urls field instead.
      if (effectiveEndpoint === '/images/generations' && Array.isArray(adjustedBody.images) && adjustedBody.images.length > 0
          && isEditsEndpointRejected(submitResponse.status, errorText)) {
        console.info('[submitImageTask] /images/generations with images[] format rejected, retrying with image_urls flat format...');
        const flatUrls = (adjustedBody.images as Array<{ image_url: { url: string } }>)
          .map((img) => img.image_url?.url || '')
          .filter(Boolean);
        delete adjustedBody.images;
        adjustedBody.image_urls = flatUrls;

        try {
          const flatResponse = await fetchWithV1Retry(
            apiBaseUrl,
            effectiveEndpoint,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(adjustedBody),
              signal: AbortSignal.timeout(60000),
            }
          );
          if (flatResponse.ok) {
            console.log('[submitImageTask] retry with image_urls flat format succeeded');
            const flatText = await flatResponse.text();
            const flatJson = call.parse(() => JSON.parse(flatText));
            const parsed = call.parse(() => parseResponseForProfile(flatJson, profile));
            return await call.acceptImage({
              taskId: parsed.taskIds?.[0],
              directUrl: parsed.directImageUrls?.[0],
            });
          } else {
            const flatErrorText = await flatResponse.text();
            console.error('[submitImageTask] retry with image_urls also failed:', flatResponse.status, flatErrorText);
          }
        } catch (retryErr) {
          if (retryErr instanceof ImageEditProviderBoundaryError) throw retryErr;
          console.error('[submitImageTask] retry with image_urls error:', retryErr);
        }
      }

      // ★ 使用统一翻译函数翻译 API 错误信息
      const translatedMsg = translateApiError(errorMsg);

      // 模型能力错误（支持自动回退）
      if (errorMsg.includes('ratio or price') || errorMsg.includes('not configured') || errorMsg.includes('宽高比不在允许') || errorMsg.includes('aspect ratio is not in the allowed') || errorMsg.includes('Invalid aspect ratio') || errorMsg.includes('not a valid size')) {
        throw new ModelCapabilityError(translatedMsg);
      }
      if (errorMsg.includes('image_urls') || errorMsg.includes('mask_image') || errorMsg.includes('image editing')) {
        throw new ModelCapabilityError(translatedMsg);
      }
      if (errorMsg.includes('must be an URL') || errorMsg.includes('Invalid URL') || errorMsg.includes('data:')) {
        throw new ModelCapabilityError(translatedMsg);
      }
      if (errorMsg.includes('model_not_found') || errorMsg.includes('model not found') || errorMsg.includes('Model not found') || errorMsg.includes('No available channel') || errorMsg.includes('no available channel')) {
        throw new ModelCapabilityError(translatedMsg);
      }
      if (errorMsg.includes('_error') || errorMsg.includes('try again later')) {
        throw new ModelCapabilityError(translatedMsg);
      }
      // 5xx 服务器错误 / Cloudflare 524 超时 / 401 认证错误 → 先尝试 chat/completions 兜底
      if (errorMsg.includes('524') || errorMsg.includes('timeout occurred') || errorMsg.includes('bad_response_status_code') || (submitResponse.status >= 500 && submitResponse.status !== 501) || submitResponse.status === 401) {
        // ★ 尝试 /chat/completions 兜底（某些 API 代理仅通过 chat 端点支持模型）
        if (isChannelUnavailableError(`${errorMsg} ${errorText}`)) {
          console.info('[submitImageTask] 5xx channel error, trying /chat/completions fallback...');
          try {
            const chatImageUrls = await tryChatCompletionsImageFallback({
              baseUrl: apiBaseUrl,
              apiKey,
              model: modelId,
              prompt: String(adjustedBody.prompt || ''),
              imageBase64: (adjustedBody.image as string) || undefined,
              imageUrls: (adjustedBody.image_urls as string[]) || undefined,
              size: adjustedBody.size as string | undefined,
              originalError: `${errorMsg} ${errorText}`,
              requestIdPrefix: 'image-edit',
              skipChannelCheck: true,
            });
            if (chatImageUrls && chatImageUrls.length > 0) {
              console.log('[submitImageTask] /chat/completions fallback succeeded from 5xx handler');
              return await call.acceptImage({ directUrl: chatImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams });
            }
          } catch (chatErr) {
            if (chatErr instanceof ImageEditProviderBoundaryError) throw chatErr;
            console.warn('[submitImageTask] /chat/completions fallback (5xx) error:', chatErr);
          }
        }
        console.warn('[submitImageTask] retryable server error, will try fallback:', submitResponse.status, errorMsg);
        throw new ModelCapabilityError(translatedMsg);
      }

      throw new Error(translatedMsg);
    }

    // 解析响应 — 防止 API 返回 HTML 页面导致 JSON 解析失败
    const responseText = await submitResponse.text();
    let submitResult: Record<string, unknown>;
    try {
      submitResult = call.parse(() => JSON.parse(responseText) as Record<string, unknown>);
    } catch (error) {
      call.stop(error);
      console.error('[image-edit] API returned non-JSON response, first 200 chars:', responseText.substring(0, 200));
      throw new Error('API 返回了非 JSON 响应（可能是端点不存在），请检查 API 地址配置');
    }
    const parsed = call.parse(() => parseResponseForProfile(submitResult, profile));

    if (parsed.mode === 'direct' && parsed.directImageUrls.length > 0) {
      return await call.acceptImage({ directUrl: parsed.directImageUrls[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams });
    }

    if (parsed.taskIds.length > 0) {
      return await call.acceptImage({ taskId: parsed.taskIds[0], apiBaseUrl, apiKey, advancedParams: providerInfo?.advancedParams });
    }

    call.stop(new Error('Missing image result'));
    throw new Error('未获取到任务ID或图片数据');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 自动尝试提交图像任务 - 遍历候选模型直到成功
 * 遇到 ModelCapabilityError 时自动切换下一个候选模型
 */
export async function autoTrySubmitImageTask(
  candidateModels: ImageEditModelCandidate[],
  buildRequestBody: (model: string) => Record<string, unknown>,
  operation: string,
  endpoint: '/images/generations' | '/images/edits' = '/images/generations',
  boundary?: ImageEditProviderExecution,
): Promise<{ taskId?: string; directUrl?: string; usedModel: string; providerId: string; apiBaseUrl: string; apiKey: string; advancedParams?: Record<string, string> }> {
  const errors: string[] = [];
  let ratioRetryDone = false;

  for (const candidate of candidateModels) {
    try {
      console.debug(`[image-edit] ${operation}: Trying model ${candidate.model} (source: ${candidate.source}, endpoint: ${endpoint})`);
      const requestBody = buildRequestBody(candidate.model);
      const result = await submitImageTask(candidate.apiBaseUrl, candidate.apiKey, requestBody, endpoint, {
        requestStyle: candidate.provider.requestStyle,
        baseUrl: candidate.apiBaseUrl,
        advancedParams: candidate.advancedParams,
        model: candidate.model,
      }, boundary ? { providerId: candidate.providerId, boundary } : undefined);
      return { ...result, usedModel: candidate.model, providerId: candidate.providerId,
        apiBaseUrl: candidate.apiBaseUrl, apiKey: candidate.apiKey, advancedParams: candidate.advancedParams };
    } catch (err: unknown) {
      if (err instanceof ImageEditProviderBoundaryError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.model}: ${errMsg}`);
      console.warn(`[image-edit] ${operation}: Model ${candidate.model} failed: ${errMsg}`);

      // ModelCapabilityError → 检查是否是宽高比问题，可以重试
      if (err instanceof ModelCapabilityError) {
        if (!ratioRetryDone && (errMsg.includes('ratio') || errMsg.includes('宽高比') || errMsg.includes('aspect'))) {
          // 宽高比不被支持，用 1:1 重试模型（跳过已失败的模型，避免双重API调用）
          console.warn(`[image-edit] ${operation}: Aspect ratio not supported, retrying with 1:1`);
          ratioRetryDone = true;
          // 记录当前及之前已失败的模型，避免对同一模型重复提交导致双重API调用
          const failedModelIndex = candidateModels.indexOf(candidate);
          const failedModelSet = new Set(candidateModels.slice(0, failedModelIndex + 1).map(c => `${c.providerId}::${c.model}`));
          // 用 1:1 比例重试尚未失败的候选模型
          for (const retryCandidate of candidateModels) {
            if (failedModelSet.has(`${retryCandidate.providerId}::${retryCandidate.model}`)) {
              console.debug(`[image-edit] ${operation}: Skipping already-failed model ${retryCandidate.model} in 1:1 retry`);
              continue;
            }
            try {
              const retryBody = buildRequestBody(retryCandidate.model);
              // 强制设置 size 为 1:1
              if (retryBody.size) retryBody.size = '1:1';
              const retryResult = await submitImageTask(retryCandidate.apiBaseUrl, retryCandidate.apiKey, retryBody, endpoint, {
                requestStyle: retryCandidate.provider.requestStyle,
                baseUrl: retryCandidate.apiBaseUrl,
                advancedParams: retryCandidate.advancedParams,
                model: retryCandidate.model,
              }, boundary ? { providerId: retryCandidate.providerId, boundary } : undefined);
              return { ...retryResult, usedModel: retryCandidate.model, providerId: retryCandidate.providerId,
                apiBaseUrl: retryCandidate.apiBaseUrl, apiKey: retryCandidate.apiKey, advancedParams: retryCandidate.advancedParams };
            } catch (retryErr: unknown) {
              if (retryErr instanceof ImageEditProviderBoundaryError) throw retryErr;
              const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              errors.push(`${retryCandidate.model}(1:1): ${retryErrMsg}`);
              if (retryErr instanceof ModelCapabilityError) continue;
              const nr = retryErrMsg.includes('Invalid API key') || retryErrMsg.includes('invalid api_key');
              if (nr) throw retryErr;
              continue;
            }
          }
        }
        continue;
      }
      // 不可重试的致命错误（认证/配额等）→ 直接抛出
      const nonRetryable =
        errMsg.includes('Invalid API key') ||
        errMsg.includes('invalid api_key') ||
        errMsg.includes('Insufficient balance') ||
        errMsg.includes('insufficient balance');
      if (nonRetryable) {
        throw err;
      }
      // 提供商通道/配额/网络等错误 → 继续尝试下一个模型
      console.warn(`[image-edit] ${operation}: Retrying with next model...`);
      continue;
    }
  }

  // 所有候选模型都不支持此操作
  throw new ModelCapabilityError(
    `所有 ${candidateModels.length} 个可用模型均不支持${operation}操作。请添加支持图像编辑的模型（如 DALL-E、Flux 等）。\n` +
    `尝试过的模型: ${errors.map((e, i) => `${i + 1}. ${e}`).join('; ')}`
  );
}
