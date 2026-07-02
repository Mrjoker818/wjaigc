import { NextRequest } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { findProviderForFeature } from '@/lib/server-api-config';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { resolveCompatProfile } from '@/lib/api-compatibility';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ToolCall {
  name: string;
  args: Record<string, any>;
}

interface ToolResult {
  name: string;
  success: boolean;
  result?: any;
  error?: string;
  imageUrls?: string[];
  videoUrl?: string;
  audioUrl?: string;
}

const SYSTEM_PROMPT = `你是无界AI的智能创作Agent，用户会用自然语言描述创作需求，你需要自动选择工具完成任务。

# 可用工具
1. generate_image - 生成图片
   参数: { prompt: string, aspectRatio?: "1:1"|"16:9"|"9:16"|"4:3"|"3:4"|"21:9", negativePrompt?: string }
   适用: "生成一张图片"、"画一张..."、"做一张海报"

2. generate_video - 生成视频
   参数: { prompt: string, imageUrl?: string, mode: "text"|"image", duration?: 5|10 }
   适用: "生成一个视频"、"把这张图做成视频"

3. adjust_color - 调色
   参数: { imageUrl: string, brightness?: number(-100~100), contrast?: number(-100~100), saturation?: number(-100~100), temperature?: number(-100~100) }
   适用: "调亮一点"、"增加对比度"、"调成暖色调"、"去饱和"

4. upscale_image - 放大图片
   参数: { imageUrl: string, scale?: 2|4 }
   适用: "放大"、"变清晰"、"高清化"

5. remove_background - 移除背景
   参数: { imageUrl: string }
   适用: "抠图"、"去背景"、"透明背景"

6. erase_object - 擦除内容
   参数: { imageUrl: string, prompt: string }
   适用: "去掉图中的XX"、"擦除多余的东西"

7. extend_image - 扩展画面
   参数: { imageUrl: string, prompt?: string, scale?: 1.5|2 }
   适用: "扩大画面"、"往外延伸"

8. generate_audio - 生成配音
   参数: { text: string, voice?: "male"|"female"|"robot", speed?: number(0.5~2) }
   适用: "生成配音"、"加旁白"、"语音朗读"

# 响应格式
你必须严格返回JSON格式，不要有其他解释文字：
\`\`\`json
{
  "thinking": "你的思考过程，说明你选择什么工具为什么",
  "tool_calls": [
    { "name": "工具名", "args": { 参数对象 } }
  ],
  "message": "给用户的简短回复，说明正在做什么"
}
\`\`\`

# 规则
- 如果只是闲聊/提问不需要调用工具，tool_calls返回空数组即可
- 如果需要多个工具按顺序执行，按顺序放在tool_calls数组中
- 用户提到的图片引用会以[图片]形式附带在消息中
- 生成结果会自动添加到画布，你不需要处理文件保存
- 完成后给用户简洁的结果说明，不要啰嗦`;

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { messages, currentImage } = body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 1. 获取LLM提供商
        const llmProvider = await findProviderForFeature('chat');
        if (!llmProvider) {
          send({ type: 'error', message: '未配置LLM模型，请先在管理员面板添加对话模型' });
          controller.close();
          return;
        }

        send({ type: 'step', status: 'thinking', message: '理解需求中...' });

        // 2. 构建消息
        const apiMessages = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages.map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: currentImage && m.role === 'user'
              ? `${m.content}\n\n[当前选中图片: ${currentImage}]`
              : m.content
          }))
        ];

        // 3. 调用LLM解析需求
        const compat = resolveCompatProfile(llmProvider);

        const chatResp = await fetchWithV1Retry(
          llmProvider.baseUrl,
          '/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${llmProvider.apiKey}`
            },
            body: JSON.stringify({
              model: llmProvider.selectedModels?.[0] || 'gpt-4o-mini',
              messages: apiMessages,
              temperature: 0.3,
              response_format: { type: 'json_object' }
            })
          }
        );

        if (!chatResp.ok) {
          const errText = await chatResp.text();
          send({ type: 'error', message: `LLM调用失败: ${chatResp.status} ${errText.slice(0, 200)}` });
          controller.close();
          return;
        }

        const chatData = await chatResp.json();
        let llmContent = chatData.choices?.[0]?.message?.content || '{}';
        
        // 提取JSON
        const jsonMatch = llmContent.match(/```json\n?([\s\S]*?)\n?```/) || [null, llmContent];
        let parsed;
        try {
          parsed = JSON.parse(jsonMatch[1] || llmContent);
        } catch (e) {
          parsed = { thinking: '', tool_calls: [], message: llmContent };
        }

        send({ type: 'thinking', content: parsed.thinking || '' });
        send({ type: 'message', content: parsed.message || '好的，我来处理' });

        const toolCalls: ToolCall[] = parsed.tool_calls || [];
        
        if (toolCalls.length === 0) {
          // 不需要工具，直接返回消息
          send({ type: 'done', message: parsed.message || '完成' });
          controller.close();
          return;
        }

        // 4. 执行工具
        const results: ToolResult[] = [];
        // 获取图像模型提供商
        let imageModel: any = null;
        try {
          const imageProvider = await findProviderForFeature('imageEdit');
          if (imageProvider) {
            imageModel = {
              model: imageProvider.selectedModels?.[0],
              providerId: imageProvider.id,
              apiKey: imageProvider.apiKey,
              baseUrl: imageProvider.baseUrl
            };
          }
        } catch (e) {
          // 无图像模型时留空，工具执行时会返回错误
        }

        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i];
          send({ 
            type: 'tool_start', 
            index: i, 
            tool: call.name,
            args: call.args,
            message: `执行: ${getToolLabel(call.name)}...` 
          });

          try {
            const result = await executeTool(call, imageModel, send);
            results.push(result);
            send({ 
              type: 'tool_done', 
              index: i, 
              tool: call.name, 
              success: result.success,
              imageUrls: result.imageUrls,
              videoUrl: result.videoUrl,
              audioUrl: result.audioUrl,
              error: result.error
            });
          } catch (err: any) {
            results.push({ name: call.name, success: false, error: err.message });
            send({ type: 'tool_error', index: i, tool: call.name, error: err.message });
          }
        }

        // 5. 汇总结果
        const allImageUrls = results.flatMap(r => r.imageUrls || []);
        const allVideoUrls = results.map(r => r.videoUrl).filter(Boolean);
        const allAudioUrls = results.map(r => r.audioUrl).filter(Boolean);

        send({
          type: 'done',
          message: buildSummary(results),
          imageUrls: allImageUrls,
          videoUrls: allVideoUrls,
          audioUrls: allAudioUrls
        });

      } catch (err: any) {
        send({ type: 'error', message: err.message || 'Agent执行失败' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    generate_image: '生成图片',
    generate_video: '生成视频',
    adjust_color: '调整色彩',
    upscale_image: '放大图片',
    remove_background: '移除背景',
    erase_object: '擦除内容',
    extend_image: '扩展画面',
    generate_audio: '生成配音'
  };
  return labels[name] || name;
}

function buildSummary(results: ToolResult[]): string {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const images = results.flatMap(r => r.imageUrls || []).length;
  const videos = results.filter(r => r.videoUrl).length;
  const audios = results.filter(r => r.audioUrl).length;
  
  let msg = `完成！成功执行 ${success} 个任务`;
  if (failed > 0) msg += `，${failed} 个失败`;
  const outputs = [];
  if (images > 0) outputs.push(`${images}张图片`);
  if (videos > 0) outputs.push(`${videos}个视频`);
  if (audios > 0) outputs.push(`${audios}个音频`);
  if (outputs.length > 0) msg += `，生成了 ${outputs.join('、')}，已添加到画布`;
  return msg;
}

async function executeTool(
  call: ToolCall, 
  imageModel: { model: string; providerId?: string; apiKey?: string; baseUrl?: string },
  send: (data: any) => void
): Promise<ToolResult> {
  const baseUrl = process.env.COZE_PROJECT_DOMAIN_DEFAULT 
    ? `https://${process.env.COZE_PROJECT_DOMAIN_DEFAULT}` 
    : 'http://localhost:5000';

  switch (call.name) {
    case 'generate_image': {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: call.args.prompt,
          aspectRatio: call.args.aspectRatio || '1:1',
          negativePrompt: call.args.negativePrompt,
          model: imageModel.model,
          providerId: imageModel.providerId,
          isAgentCall: true
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        // 提交成功，等待轮询（简化：直接返回任务ID让前端处理）
        if (data.taskId) {
          // 简化处理：等待5秒轮询
          await new Promise(r => setTimeout(r, 5000));
          for (let i = 0; i < 30; i++) {
            const pollRes = await fetch(`${baseUrl}/api/poll-task`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskIds: [data.taskId], model: imageModel.model })
            });
            const pollData = await pollRes.json();
            if (pollData.results?.[0]?.status === 'completed') {
              return {
                name: call.name,
                success: true,
                imageUrls: pollData.results[0].imageUrls || [pollData.results[0].imageUrl].filter(Boolean)
              };
            }
            if (pollData.results?.[0]?.status === 'failed') {
              return { name: call.name, success: false, error: pollData.results[0].error };
            }
            send({ type: 'tool_progress', tool: call.name, progress: Math.min(90, (i+1)*3) });
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        return { name: call.name, success: false, error: data.error || '生成失败' };
      }
      return { name: call.name, success: true, imageUrls: data.imageUrls || [data.imageUrl].filter(Boolean) };
    }

    case 'adjust_color': {
      const res = await fetch(`${baseUrl}/api/image/color-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: call.args.imageUrl,
          params: {
            brightness: call.args.brightness || 0,
            contrast: call.args.contrast || 0,
            saturation: call.args.saturation || 0,
            temperature: call.args.temperature || 0,
            hue: call.args.hue || 0
          }
        })
      });
      const data = await res.json();
      if (data.success && data.url) {
        return { name: call.name, success: true, imageUrls: [data.url] };
      }
      return { name: call.name, success: false, error: data.error || '调色失败' };
    }

    case 'upscale_image': {
      const res = await fetch(`${baseUrl}/api/image/upscale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: call.args.imageUrl,
          scale: call.args.scale || 2
        })
      });
      const data = await res.json();
      if (data.taskId) {
        await new Promise(r => setTimeout(r, 3000));
        for (let i = 0; i < 30; i++) {
          const pollRes = await fetch(`${baseUrl}/api/poll-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskIds: [data.taskId] })
          });
          const pollData = await pollRes.json();
          if (pollData.results?.[0]?.status === 'completed') {
            return { name: call.name, success: true, imageUrls: pollData.results[0].imageUrls || [] };
          }
          if (pollData.results?.[0]?.status === 'failed') {
            return { name: call.name, success: false, error: pollData.results[0].error };
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      return { name: call.name, success: false, error: data.error || '放大失败' };
    }

    case 'remove_background': {
      const res = await fetch(`${baseUrl}/api/image-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'removebg',
          imageUrl: call.args.imageUrl
        })
      });
      const data = await res.json();
      if (data.taskId) {
        await new Promise(r => setTimeout(r, 3000));
        for (let i = 0; i < 30; i++) {
          const pollRes = await fetch(`${baseUrl}/api/poll-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskIds: [data.taskId] })
          });
          const pollData = await pollRes.json();
          if (pollData.results?.[0]?.status === 'completed') {
            return { name: call.name, success: true, imageUrls: pollData.results[0].imageUrls || [] };
          }
          if (pollData.results?.[0]?.status === 'failed') {
            return { name: call.name, success: false, error: pollData.results[0].error };
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      return { name: call.name, success: false, error: data.error || '去背景失败' };
    }

    case 'generate_audio': {
      const res = await fetch(`${baseUrl}/api/audio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: call.args.text,
          voice: call.args.voice || 'female',
          speed: call.args.speed || 1.0
        })
      });
      const data = await res.json();
      if (data.success && data.audioUrl) {
        return { name: call.name, success: true, audioUrl: data.audioUrl };
      }
      return { name: call.name, success: false, error: data.error || '配音生成失败' };
    }

    case 'generate_video': {
      const res = await fetch(`${baseUrl}/api/video/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: call.args.prompt,
          imageUrl: call.args.imageUrl,
          mode: call.args.mode || 'text',
          duration: call.args.duration || 5
        })
      });
      const data = await res.json();
      if (data.taskId) {
        await new Promise(r => setTimeout(r, 8000));
        for (let i = 0; i < 60; i++) {
          const pollRes = await fetch(`${baseUrl}/api/poll-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskIds: [data.taskId] })
          });
          const pollData = await pollRes.json();
          if (pollData.results?.[0]?.status === 'completed') {
            return { name: call.name, success: true, videoUrl: pollData.results[0].videoUrl };
          }
          if (pollData.results?.[0]?.status === 'failed') {
            return { name: call.name, success: false, error: pollData.results[0].error };
          }
          send({ type: 'tool_progress', tool: call.name, progress: Math.min(90, (i+1)*1.5) });
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      return { name: call.name, success: false, error: data.error || '视频生成失败' };
    }

    default:
      return { name: call.name, success: false, error: `未知工具: ${call.name}` };
  }
}
