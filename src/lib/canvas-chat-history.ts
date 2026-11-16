// 画布 AI 聊天：发送历史的裁剪与“重新生成”所需的轮次定位。

export interface CanvasChatHistoryImageAnchor {
  imageId: string;
  imageUrl: string;
  imageName: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
}

export interface CanvasChatHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  imageAnchors?: CanvasChatHistoryImageAnchor[];
}

export interface CanvasChatRestoredImage {
  id: string;
  url: string;
  name: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
}

/**
 * 只发送最近 `limit` 条消息；更早的消息会被丢弃。
 * 最近 `imageLimit` 条之外的消息去掉图片，只保留文字，避免每轮重复上传全部历史图片。
 * 截断后从第一条用户消息开始，避免以孤立的助手回复开头。
 */
export function buildChatRequestHistory<T extends CanvasChatHistoryMessage>(
  messages: readonly T[],
  limit: number,
  imageLimit: number,
): T[] {
  let recent = messages.filter(message => message.content || message.imageUrl || message.imageAnchors?.length)
    .slice(-Math.max(0, limit));
  const firstUser = recent.findIndex(message => message.role === 'user');
  recent = firstUser < 0 ? [] : recent.slice(firstUser);
  const imageStart = recent.length - Math.max(0, imageLimit);
  return recent.map((message, index) => {
    if (index >= imageStart || (!message.imageUrl && !message.imageAnchors?.length)) return message;
    const { imageUrl: _imageUrl, imageAnchors: _imageAnchors, ...textOnly } = message;
    return textOnly as T;
  });
}

/** 从一条用户消息恢复它当时携带的图片，供重新生成时原样再次发送。 */
export function restoreChatMessageImages(message: CanvasChatHistoryMessage): CanvasChatRestoredImage[] {
  const images: CanvasChatRestoredImage[] = (message.imageAnchors || [])
    .filter(anchor => anchor.imageUrl)
    .map(anchor => ({
      id: anchor.imageId,
      url: anchor.imageUrl,
      name: anchor.imageName,
      ...(anchor.assetId ? { assetId: anchor.assetId } : {}),
      ...(anchor.assetVersionId ? { assetVersionId: anchor.assetVersionId } : {}),
      ...(anchor.placementId ? { placementId: anchor.placementId } : {}),
    }));
  if (message.imageUrl && !images.some(image => image.url === message.imageUrl)) {
    images.push({ id: `${message.id}-image`, url: message.imageUrl, name: '图片' });
  }
  return images;
}

/** 消息是否属于最后一轮（最后一条用户消息及其之后的回复）。 */
export function isLatestChatTurnMessage(messages: readonly CanvasChatHistoryMessage[], messageId: string): boolean {
  const lastUserIndex = messages.findLastIndex(message => message.role === 'user');
  if (lastUserIndex < 0) return false;
  const index = messages.findIndex(message => message.id === messageId);
  return index >= lastUserIndex;
}

/** 找到某条消息所属轮次的用户消息：用户消息返回自身，助手消息返回其前最近的用户消息。 */
export function findChatTurnUserMessage<T extends CanvasChatHistoryMessage>(
  messages: readonly T[],
  messageId: string,
): T | undefined {
  const index = messages.findIndex(message => message.id === messageId);
  if (index < 0) return undefined;
  for (let cursor = index; cursor >= 0; cursor--) {
    if (messages[cursor].role === 'user') return messages[cursor];
  }
  return undefined;
}
