import type { CanvasAction } from './canvas-action-executor';

/** 对话里模型给出的画布操作，点击后由画布打开对应工具（不直接扣费执行）。 */
export interface ChatCanvasActionRequest {
  type: ChatCanvasToolType;
  imageId: string;
  imageName?: string;
}

export type ChatCanvasToolType = 'upscale' | 'remove_bg' | 'erase' | 'extend' | 'crop' | 'color_adjust' | 'img2img';

export const CHAT_CANVAS_ACTION_EVENT = 'wujie:chat-canvas-action';

const TOOL_LABELS: Record<ChatCanvasToolType, string> = {
  upscale: '放大',
  remove_bg: '移除背景',
  erase: '擦除',
  extend: '扩展画面',
  crop: '裁切',
  color_adjust: '调色',
  img2img: '语言修图',
};

// filter 是风格转换，画布上由语言修图承接。
const ACTION_TO_TOOL: Partial<Record<CanvasAction['type'], ChatCanvasToolType>> = {
  upscale: 'upscale',
  remove_bg: 'remove_bg',
  erase: 'erase',
  extend: 'extend',
  crop: 'crop',
  color_adjust: 'color_adjust',
  img2img: 'img2img',
  filter: 'img2img',
};

export function chatCanvasToolLabel(type: ChatCanvasToolType): string {
  return TOOL_LABELS[type];
}

/** 把模型的操作指令解析到画布上一张具体图片；目标不明确或工具不支持时返回 null。 */
export function resolveChatCanvasAction(
  action: CanvasAction,
  images: ReadonlyArray<{ id: string; name?: string; mediaType?: string }>,
  selectedImageId: string | null | undefined,
): ChatCanvasActionRequest | null {
  const type = ACTION_TO_TOOL[action.type];
  if (!type) return null;
  const targetId = action.targetImageId || selectedImageId;
  if (!targetId) return null;
  const image = images.find(item => item.id === targetId);
  if (!image || (image.mediaType && image.mediaType !== 'image')) return null;
  return { type, imageId: image.id, imageName: image.name };
}

export function requestChatCanvasAction(request: ChatCanvasActionRequest): void {
  window.dispatchEvent(new CustomEvent<ChatCanvasActionRequest>(CHAT_CANVAS_ACTION_EVENT, { detail: request }));
}

export function isChatCanvasActionRequest(value: unknown): value is ChatCanvasActionRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChatCanvasActionRequest>;
  return typeof candidate.imageId === 'string' && !!candidate.imageId
    && typeof candidate.type === 'string' && candidate.type in TOOL_LABELS;
}
