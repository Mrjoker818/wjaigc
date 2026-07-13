export function getStickerFailureMessage(status: string, error?: string): string {
  if (status !== 'failed') return '';
  return error?.trim() || '生成失败，点击重试';
}
