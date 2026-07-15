/**
 * Canvas Action Executor - P0-1 ChatCanvas核心能力
 * 
 * 让AI能够直接执行画布操作，而非仅返回文字建议。
 * 支持放大、去背景、图生图、擦除、扩展、裁切等操作。
 */

import type { CanvasImage } from '@/lib/user-types';

// ============ 画布操作类型定义 ============

export interface CanvasAction {
  type: CanvasActionType;
  targetImageId?: string;  // 操作目标图片ID
  params?: Record<string, unknown>;  // 操作参数
  description?: string;  // 操作描述（用于日志）
}

export type CanvasActionType =
  | 'upscale'          // 放大
  | 'remove_bg'        // 去背景
  | 'img2img'          // 图生图
  | 'erase'            // 擦除
  | 'extend'           // 扩展画面
  | 'crop'             // 裁切
  | 'generate'         // 生成新图
  | 'move'             // 移动位置
  | 'delete'           // 删除
  | 'duplicate'        // 复制
  | 'arrange'          // 排列
  | 'filter'           // 滤镜（风格转换）
  | 'color_adjust'     // 色彩调整
  | 'add_text'         // 添加文字
  | 'composite';       // 合成

// ============ 操作执行结果 ============

export interface CanvasActionResult {
  success: boolean;
  action: CanvasAction;
  resultImages?: CanvasImage[];  // 操作产生的图片
  modifiedImage?: CanvasImage;   // 修改后的图片
  message?: string;
  error?: string;
}

// ============ 操作解析器：从用户消息解析操作意图 ============

export interface OperationIntent {
  detected: boolean;
  actionType: CanvasActionType | null;
  targetKeywords: string[];
  params: Record<string, unknown>;
  confidence: number;  // 0-1
}

/**
 * 从用户消息解析画布操作意图
 */
export function parseCanvasOperationIntent(userMessage: string, canvasImages: CanvasImage[]): OperationIntent {
  void canvasImages;
  const lowerMsg = userMessage.toLowerCase();
  
  // 操作关键词映射
  const operationPatterns: Array<{
    patterns: string[];
    actionType: CanvasActionType;
    paramExtractors?: Array<{
      name: string;
      pattern: RegExp;
      transform?: (match: string) => unknown;
    }>;
  }> = [
    {
      patterns: ['放大', 'upscale', '变大', '高清', '提升分辨率', 'upscale to', 'scale up', 'enlarge'],
      actionType: 'upscale',
      paramExtractors: [
        { name: 'scale', pattern: /(\d)[x倍]/i, transform: (m) => parseInt(m) },
        { name: 'scale', pattern: /放大到(\d)倍/i, transform: (m) => parseInt(m) },
      ]
    },
    {
      patterns: ['去背景', 'remove background', 'removebg', '抠图', '去底', '透明背景', 'remove the background', 'transparent'],
      actionType: 'remove_bg',
    },
    {
      patterns: ['图生图', 'img2img', '转换', '换成', '变成', '改成', 'transform', 'convert to', 'change to', 'turn into'],
      actionType: 'img2img',
      paramExtractors: [
        { name: 'style', pattern: /换成(.+)风格/i, transform: (m) => m },
        { name: 'style', pattern: /convert to (.+) style/i, transform: (m) => m },
        { name: 'prompt', pattern: /改成(.+)/i, transform: (m) => m },
      ]
    },
    {
      patterns: ['擦除', 'erase', '删除元素', '去掉', '抹掉', 'remove .* from', 'erase .* from', '消除'],
      actionType: 'erase',
      paramExtractors: [
        { name: 'target', pattern: /擦除(.+)/i, transform: (m) => m },
        { name: 'target', pattern: /去掉(.+)/i, transform: (m) => m },
        { name: 'target', pattern: /remove (.+) from/i, transform: (m) => m },
      ]
    },
    {
      patterns: ['扩展', 'extend', '扩图', '延伸', '扩大画面', 'extend the canvas', 'expand', 'outpaint'],
      actionType: 'extend',
      paramExtractors: [
        { name: 'direction', pattern: /向(左|右|上|下)扩展/i, transform: (m) => m },
        { name: 'scale', pattern: /扩展(\d)倍/i, transform: (m) => parseInt(m) },
      ]
    },
    {
      patterns: ['裁切', 'crop', '裁剪', '剪裁', 'cut', 'trim'],
      actionType: 'crop',
      paramExtractors: [
        { name: 'ratio', pattern: /(16:9|9:16|4:3|3:4|1:1|正方形|横版|竖版)/i, transform: (m) => m },
      ]
    },
    {
      patterns: ['生成', 'generate', '创建', '制作', 'create', 'make', '画', '绘'],
      actionType: 'generate',
      paramExtractors: [
        { name: 'prompt', pattern: /生成(.+)/i, transform: (m) => m },
        { name: 'prompt', pattern: /画(.+)/i, transform: (m) => m },
        { name: 'prompt', pattern: /create (.+)/i, transform: (m) => m },
        { name: 'count', pattern: /生成(\d)张/i, transform: (m) => parseInt(m) },
      ]
    },
    {
      patterns: ['删除', 'delete', '移除', '去掉这张', 'remove this', '删掉'],
      actionType: 'delete',
    },
    {
      patterns: ['复制', 'duplicate', '拷贝', 'copy', '克隆', 'clone'],
      actionType: 'duplicate',
    },
    {
      patterns: ['移动', 'move', '调整位置', 'position', '放到'],
      actionType: 'move',
      paramExtractors: [
        { name: 'direction', pattern: /向(左|右|上|下)移动/i, transform: (m) => m },
        { name: 'position', pattern: /放到(左边|右边|中间|上方|下方)/i, transform: (m) => m },
      ]
    },
    {
      patterns: ['风格', 'style', '滤镜', 'filter', '水彩', '油画', '素描', '动漫', '写实'],
      actionType: 'filter',
      paramExtractors: [
        { name: 'style', pattern: /(水彩|油画|素描|动漫|写实|赛博朋克|复古|简约)风格/i, transform: (m) => m },
      ]
    },
    {
      patterns: ['调整颜色', 'adjust color', '调色', '改色', '亮度', '对比度', '饱和度', 'hue', 'brightness', 'contrast', 'saturation'],
      actionType: 'color_adjust',
      paramExtractors: [
        { name: 'brightness', pattern: /亮度[+-](\d+)/i, transform: (m) => parseInt(m) },
        { name: 'contrast', pattern: /对比度[+-](\d+)/i, transform: (m) => parseInt(m) },
        { name: 'saturation', pattern: /饱和度[+-](\d+)/i, transform: (m) => parseInt(m) },
      ]
    },
  ];
  
  // 检测操作意图
  for (const op of operationPatterns) {
    for (const pattern of op.patterns) {
      if (lowerMsg.includes(pattern)) {
        // 提取参数
        const params: Record<string, unknown> = {};
        if (op.paramExtractors) {
          for (const extractor of op.paramExtractors) {
            const match = userMessage.match(extractor.pattern);
            if (match && match[1]) {
              params[extractor.name] = extractor.transform ? extractor.transform(match[1]) : match[1];
            }
          }
        }
        
        // 检测目标图片关键词
        const targetKeywords: string[] = [];
        const imageRefPatterns = [
          /这张图/i, /这张/i, /这个/i, /当前/i, /选中/i,
          /this image/i, /this one/i, /the selected/i, /current/i,
          /第(\d)张/i, /图片(\d)/i, /image (\d)/i,
        ];
        for (const p of imageRefPatterns) {
          if (userMessage.match(p)) {
            targetKeywords.push(p.source);
          }
        }
        
        // 计算置信度
        let confidence = 0.7;
        if (params.prompt || params.style || params.target) confidence = 0.85;
        if (targetKeywords.length > 0) confidence = 0.95;
        
        return {
          detected: true,
          actionType: op.actionType,
          targetKeywords,
          params,
          confidence,
        };
      }
    }
  }
  
  return {
    detected: false,
    actionType: null,
    targetKeywords: [],
    params: {},
    confidence: 0,
  };
}

// ============ 执行器类型定义 ============

export type CanvasActionExecutorFn = (
  action: CanvasAction,
  images: CanvasImage[],
  context: {
    apiBaseUrl?: string;
    apiKey?: string;
    model?: string;
    providerId?: string;
    onProgress?: (progress: number, message: string) => void;
    onAddImages?: (images: CanvasImage[]) => void;
    onUpdateImage?: (image: CanvasImage) => void;
    onDeleteImage?: (imageId: string) => void;
  }
) => Promise<CanvasActionResult>;

// ============ 操作执行器映射 ============

/**
 * 获取操作执行器
 * 返回执行该操作所需的API端点和参数
 */
export function getActionExecutorConfig(actionType: CanvasActionType): {
  apiEndpoint: string;
  method: 'GET' | 'POST';
  requiresPolling: boolean;
  estimatedDuration: number;  // 秒
} {
  const configs: Record<CanvasActionType, {
    apiEndpoint: string;
    method: 'GET' | 'POST';
    requiresPolling: boolean;
    estimatedDuration: number;
  }> = {
    upscale: {
      apiEndpoint: '/api/image-edit',
      method: 'POST',
      requiresPolling: true,
      estimatedDuration: 30,
    },
    remove_bg: {
      apiEndpoint: '/api/image-edit',
      method: 'POST',
      requiresPolling: true,
      estimatedDuration: 20,
    },
    img2img: {
      apiEndpoint: '/api/generate',
      method: 'POST',
      requiresPolling: true,
      estimatedDuration: 45,
    },
    erase: {
      apiEndpoint: '/api/image-edit',
      method: 'POST',
      requiresPolling: true,
      estimatedDuration: 25,
    },
    extend: {
      apiEndpoint: '/api/image-edit',
      method: 'POST',
      requiresPolling: true,
      estimatedDuration: 35,
    },
    crop: {
      apiEndpoint: '/api/image-edit',  // 本地裁切，无需API
      method: 'POST',
      requiresPolling: false,
      estimatedDuration: 2,
    },
    generate: {
      apiEndpoint: '/api/generate',
      method: 'POST',
      requiresPolling: true,
      estimatedDuration: 60,
    },
    move: {
      apiEndpoint: '',  // 本地操作
      method: 'POST',
      requiresPolling: false,
      estimatedDuration: 1,
    },
    delete: {
      apiEndpoint: '',  // 本地操作
      method: 'POST',
      requiresPolling: false,
      estimatedDuration: 1,
    },
    duplicate: {
      apiEndpoint: '',  // 本地操作
      method: 'POST',
      requiresPolling: false,
      estimatedDuration: 1,
    },
    arrange: {
      apiEndpoint: '',  // 本地操作
      method: 'POST',
      requiresPolling: false,
      estimatedDuration: 1,
    },
    filter: {
      apiEndpoint: '/api/generate',  // 通过图生图实现
      method: 'POST',
      requiresPolling: true,
      estimatedDuration: 45,
    },
    color_adjust: {
      apiEndpoint: '/api/image-edit',  // 本地色彩调整或API
      method: 'POST',
      requiresPolling: false,
      estimatedDuration: 5,
    },
    add_text: {
      apiEndpoint: '/api/image-edit',  // 本地添加文字
      method: 'POST',
      requiresPolling: false,
      estimatedDuration: 3,
    },
    composite: {
      apiEndpoint: '/api/image-edit',
      method: 'POST',
      requiresPolling: false,
      estimatedDuration: 5,
    },
  };
  
  return configs[actionType] || configs.generate;
}

// ============ AI系统提示词注入 ============

/**
 * ChatCanvas系统提示词片段
 * 让AI知道它可以执行画布操作
 */
export const CHATCANVAS_SYSTEM_PROMPT = `
## ChatCanvas画布操作能力

你是无界AI的画布协作助手，不仅能提供设计建议，还能**直接执行画布操作**。

当用户请求画布操作时，你应该：
1. 确认理解用户的操作意图
2. 调用对应的画布操作工具
3. 向用户展示操作结果

### 可执行的操作

| 操作 | 说明 | 示例用户请求 |
|------|------|-------------|
| upscale | 放大图片 | "把这张图放大2倍"、"提升分辨率" |
| remove_bg | 去除背景 | "去掉背景"、"抠图"、"透明底" |
| img2img | 图生图转换 | "换成水彩风格"、"改成动漫效果" |
| erase | 擦除元素 | "去掉这张图里的人"、"擦除背景里的树" |
| extend | 扩展画面 | "向左扩展画面"、"扩大画布" |
| crop | 裁切图片 | "裁成16:9"、"裁剪成正方形" |
| generate | 生成新图 | "画一张日落风景"、"生成产品海报" |
| delete | 删除图片 | "删除这张图"、"去掉这张" |
| duplicate | 复制图片 | "复制这张图"、"克隆一份" |
| filter | 滤镜风格 | "加个水彩滤镜"、"改成油画风格" |

### 操作格式

当需要执行操作时，在你的回复末尾添加操作指令：

[CANVAS_ACTION]
type: upscale
target: selected
params: scale=2
[/CANVAS_ACTION]

或者使用JSON格式：
\`\`\`canvas-action
{
  "type": "img2img",
  "target": "selected",
  "params": {
    "style": "watercolor",
    "strength": 0.8
  }
}
\`\`\`

### 注意事项

- 执行操作前先确认目标图片（用户说"这张"通常指选中的图片）
- 多步操作应该分步执行，等待每步完成后再继续
- 操作失败时向用户说明原因并提供替代方案
- 复杂操作（如精细蒙版编辑）建议用户使用专业编辑模式
`;

/**
 * 从AI回复中提取画布操作指令
 */
export function extractCanvasActionFromAIResponse(aiResponse: string): CanvasAction | null {
  // 匹配 [CANVAS_ACTION]...[/CANVAS_ACTION] 格式
  const actionBlockMatch = aiResponse.match(/\[CANVAS_ACTION\]([\s\S]*?)\[\/CANVAS_ACTION\]/);
  if (actionBlockMatch) {
    const content = actionBlockMatch[1].trim();
    const lines = content.split('\n').filter(l => l.trim());
    const action: Partial<CanvasAction> = {};
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key === 'type') action.type = value as CanvasActionType;
      if (key === 'target') action.targetImageId = value === 'selected' ? undefined : value;
      if (key === 'params') {
        action.params = {};
        const paramPairs = value.split(',');
        for (const pair of paramPairs) {
          const [pk, pv] = pair.split('=').map(s => s.trim());
          if (pk && pv) action.params[pk] = pv;
        }
      }
    }
    
    if (action.type) {
      return action as CanvasAction;
    }
  }
  
  // 匹配 JSON 格式
  const jsonMatch = aiResponse.match(/```canvas-action\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        type: parsed.type as CanvasActionType,
        targetImageId: parsed.target === 'selected' ? undefined : parsed.target,
        params: parsed.params || {},
        description: parsed.description,
      };
    } catch {
      return null;
    }
  }
  
  return null;
}

/**
 * 构建画布操作请求体
 */
export function buildCanvasActionRequest(
  action: CanvasAction,
  targetImage: CanvasImage | null,
  context: {
    model?: string;
    providerId?: string;
  }
): Record<string, unknown> {
  const baseParams: Record<string, unknown> = {
    model: context.model || 'gpt-image-1',
    providerId: context.providerId,
  };
  
  switch (action.type) {
    case 'upscale':
      return {
        ...baseParams,
        action: 'upscale',
        imageUrl: targetImage?.url,
        scale: action.params?.scale || 2,
      };
      
    case 'remove_bg':
      return {
        ...baseParams,
        action: 'removebg',
        imageUrl: targetImage?.url,
      };
      
    case 'img2img':
      return {
        ...baseParams,
        imageUrl: targetImage?.url,
        prompt: action.params?.prompt || action.params?.style || '',
        strength: action.params?.strength || 0.75,
        aspectRatio: targetImage?.aspectRatio || '1:1',
      };
      
    case 'erase':
      return {
        ...baseParams,
        action: 'erase',
        imageUrl: targetImage?.url,
        prompt: action.params?.target || '',
      };
      
    case 'extend':
      return {
        ...baseParams,
        action: 'extend',
        imageUrl: targetImage?.url,
        scale: action.params?.scale || 2,
        direction: action.params?.direction || 'all',
      };
      
    case 'crop':
      return {
        ...baseParams,
        action: 'crop',
        imageUrl: targetImage?.url,
        ratio: action.params?.ratio || '1:1',
      };
      
    case 'generate':
      return {
        ...baseParams,
        prompt: action.params?.prompt || '',
        count: action.params?.count || 1,
        aspectRatio: action.params?.aspectRatio || '1:1',
      };
      
    case 'filter':
      return {
        ...baseParams,
        imageUrl: targetImage?.url,
        prompt: `${action.params?.style || ''} style transformation`,
        strength: 0.8,
      };
      
    default:
      return baseParams;
  }
}

const canvasActionExecutor = {
  parseCanvasOperationIntent,
  extractCanvasActionFromAIResponse,
  getActionExecutorConfig,
  buildCanvasActionRequest,
  CHATCANVAS_SYSTEM_PROMPT,
};

export default canvasActionExecutor;
