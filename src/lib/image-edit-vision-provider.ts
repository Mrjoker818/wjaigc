import { createImageEditProviderCall, ImageEditProviderBoundaryError, type ImageEditProviderExecution } from '@/lib/image-edit-provider-boundary';
import type { ImageEditModelCandidate, ImageEditModelPlan } from '@/lib/task-core/image-edit-model-plan';
import { autoTrySubmitImageTask } from '@/lib/image-edit-provider';

/**
 * 从文本解析 SSE 格式的 chat/completions 响应
 * 用于处理某些 API 代理即使 stream:false 也返回 SSE 流的情况
 */
function parseSSEChatResponseFromText(text: string, strict: boolean = false): Record<string, unknown> | null {
  const lines = text.split('\n');

  let finalContent = '';
  let model = '';
  let role = 'assistant';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]') continue;
    if (!trimmed.startsWith('data:') && !trimmed.startsWith('data :')) continue;

    const dataStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.startsWith('data :') ? trimmed.slice(6) : trimmed.slice(5);
    if (dataStr.trim() === '[DONE]') continue;

    try {
      const json = JSON.parse(dataStr);
      // 非流式响应：直接取 message.content
      if (json.choices?.[0]?.message?.content) {
        finalContent = typeof json.choices[0].message.content === 'string'
          ? json.choices[0].message.content
          : JSON.stringify(json.choices[0].message.content);
      }
      // 流式响应：累加 delta.content
      const delta = json.choices?.[0]?.delta;
      if (delta?.content) {
        finalContent += delta.content;
      }
      if (delta?.role) role = delta.role;
      if (json.model) model = json.model;
    } catch (error) {
      // 边界模式不能接受部分解析结果；旧调用继续容忍坏帧。
      if (strict) throw error;
    }
  }

  if (!finalContent) return null;

  return {
    choices: [{
      message: { content: finalContent, role },
      finish_reason: 'stop',
    }],
    model,
  } as Record<string, unknown>;
}

// Helper: use chat-completions with vision model to describe an image
// Returns a text description of the image, or null if all models fail
export async function describeImageWithVision(
  imageBase64: string,
  instruction: string,
  visionCandidates: ImageEditModelCandidate[],
  boundary?: ImageEditProviderExecution,
): Promise<string | null> {
  if (visionCandidates.length === 0) {
    console.warn('[image-edit] No chat models available for vision description');
    return null;
  }

  const imageDataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;

  for (const candidate of visionCandidates) {
      const m = candidate.model;
      const call = createImageEditProviderCall(boundary ? { providerId: candidate.providerId, boundary } : undefined, m, 'vision');
      let successfulResponse = false;
      try {
        console.debug(`[image-edit] vision-describe: Trying ${m}`);
        const chatRequestBody = {
          model: m,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: imageDataUrl } },
                { type: 'text', text: instruction }
              ]
            }
          ],
          max_tokens: 2048,
          stream: false,
        };

        const chatResponse = await call.fetchWithV1Retry(
          candidate.apiBaseUrl,
          '/chat/completions',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${candidate.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(chatRequestBody),
            signal: AbortSignal.timeout(60000),
          }
        );

        if (!chatResponse.ok) continue;
        successfulResponse = true;

        const responseText = await chatResponse.text();
        let chatResult: Record<string, unknown> | null = null;
        const trimmedText = responseText.trim();

        if (trimmedText.startsWith('data:') || trimmedText.startsWith('data :')) {
          chatResult = parseSSEChatResponseFromText(trimmedText, Boolean(boundary));
        } else {
          try { chatResult = JSON.parse(trimmedText); } catch { chatResult = parseSSEChatResponseFromText(trimmedText, Boolean(boundary)); }
        }

        if (!chatResult) {
          call.stop(new Error('Missing vision response'));
          continue;
        }

        const choice = (chatResult as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
        const content = choice?.message?.content;

        // Extract text content (whether string or array)
        if (typeof content === 'string' && content.length > 20) {
          console.debug(`[image-edit] vision-describe: ${m} returned ${content.length} chars`);
          return await call.acceptVision(content);
        }
        if (Array.isArray(content)) {
          const textParts = content
            .filter((p: { type: string }) => p.type === 'text')
            .map((p: { text: string }) => p.text)
            .filter((t: string) => t.length > 10);
          if (textParts.length > 0) {
            const joined = textParts.join(' ');
            console.debug(`[image-edit] vision-describe: ${m} returned ${joined.length} chars (array)`);
            return await call.acceptVision(joined);
          }
        }
        call.stop(new Error('Missing vision text'));
      } catch (err: unknown) {
        if (err instanceof ImageEditProviderBoundaryError) throw err;
        if (successfulResponse) call.stop(err);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[image-edit] vision-describe: ${m} failed: ${errMsg}`);
        continue;
      }
  }

  return null;
}

/**
 * 自动尝试所有 LLM 模型做视觉 fallback
 * 遍历管理员配置的 chat 类型模型，用视觉理解+生成的方式替代图像编辑
 */
/**
 * 自动尝试所有 LLM 模型做视觉描述 + 图像生成 fallback
 * 用于 inpaint/erase 等操作，当 images/generations 不支持时
 */
export async function autoTryChatVisionFallback(
  imageBase64: string,
  _maskBase64: string | null,
  prompt: string,
  operation: string,
  plan: ImageEditModelPlan,
  boundary?: ImageEditProviderExecution,
): Promise<Awaited<ReturnType<typeof autoTrySubmitImageTask>> | null> {
  // Step 1: 用 chat vision 模型描述图片内容
  const description = await describeImageWithVision(
    imageBase64,
    operation === 'erase'
      ? '请详细描述这张图片的内容，包括主体、背景、风格、色彩、构图等细节。'
      : prompt || '请详细描述这张图片的内容，包括主体、背景、风格、色彩、构图等细节。',
    plan.visionCandidates,
    boundary,
  );

  if (!description) {
    console.warn(`[image-edit] ${operation} vision fallback: No description available`);
    return null;
  }

  // Step 2: 用描述 + image_urls 作为参考提交 images/generations
  const candidates = plan.candidates.filter(candidate => candidate.providerType === 'image' || candidate.providerType === 'imageEdit');
  if (!candidates.length) return null;
  const imageDataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;

  const enhancedPrompt = operation === 'erase'
    ? `${description}\n\nRemove the masked area content and fill with natural background. Seamlessly blend the repaired area with surrounding content.`
    : `${description}\n\n${prompt || ''}`;

  try {
    const result = await autoTrySubmitImageTask(candidates, (m) => ({
      model: m,
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1024',
      image_urls: [imageDataUrl],
      strength: 0.6,
    }), `${operation}(vision-fallback)`, '/images/generations', boundary);
    return { ...result, usedModel: result.usedModel };
  } catch (error) {
    if (error instanceof ImageEditProviderBoundaryError) throw error;
    return null;
  }
}
