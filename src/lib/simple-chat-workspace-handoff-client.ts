import type { SimpleChatWorkspaceHandoffIntent } from './simple-chat-workspace-handoff';
import { stableContentSha256Hex } from './platform-compliance/rules';

export function toSimpleChatHandoffMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    UNAUTHORIZED: '登录状态已失效，请重新登录后再试',
    INVALID_HANDOFF: '智能对话发送信息不完整，请返回对话重新发送',
    FORBIDDEN: '无权读取该对话或写入当前项目',
    HANDOFF_SOURCE_NOT_FOUND: '原智能对话消息已不存在',
    NO_MANAGED_MEDIA: '该消息没有可导入的托管内容',
    SOURCE_PROJECT_FORBIDDEN: '无权读取该智能对话项目',
    TARGET_PROJECT_FORBIDDEN: '无权写入当前画布项目',
    CHAT_MESSAGE_NOT_FOUND: '原智能对话消息已不存在',
    ASSET_NOT_FOUND: '对话中的图片素材已不存在',
    ASSET_TRANSFER_FAILED: '图片素材导入失败，请稍后重试',
    ASSET_IDEMPOTENCY_CONFLICT: '导入请求与已有记录冲突，已停止且链接保留；请刷新或检查目标后重试',
  };
  return messages[code]
    || (code.includes('保存') || code.includes('已取消')
      ? code
      : '智能对话内容导入失败，请刷新页面重试');
}

export function getSimpleChatWorkspaceHandoffIdentity(
  intent: SimpleChatWorkspaceHandoffIntent,
): string {
  return JSON.stringify([
    intent.targetProjectId,
    intent.chatProjectId,
    intent.chatTaskId,
    intent.chatMessageId,
  ]);
}

function boundedSimpleChatIdentity(scope: string, readable: string, canonicalParts: string[]): string {
  if (readable.length <= 256) return readable;
  const digest = stableContentSha256Hex(JSON.stringify([scope, ...canonicalParts]));
  const boundedScope = scope.slice(0, 64);
  return boundedScope ? `${boundedScope}:${digest}` : digest;
}

export function buildBoundedSimpleChatTransferIdempotencyKey(
  scope: string,
  parts: string[],
): string {
  const readable = [scope, ...parts].join(':');
  return boundedSimpleChatIdentity(scope, readable, parts);
}

export function buildSimpleChatCanvasTransferIdentity(input: {
  targetProjectId: string;
  chatTaskId: string;
  messageId: string;
  imageIndex: number;
  sourceVersionId: string;
}): { entityId: string; idempotencyKey: string } {
  const imageIndex = String(input.imageIndex);
  return {
    entityId: buildBoundedSimpleChatTransferIdempotencyKey('simple-chat', [
      input.chatTaskId,
      input.messageId,
      imageIndex,
    ]),
    idempotencyKey: buildBoundedSimpleChatTransferIdempotencyKey('simple-chat-canvas', [
      input.targetProjectId,
      input.chatTaskId,
      input.messageId,
      imageIndex,
      input.sourceVersionId,
    ]),
  };
}
