export interface StickerModelLoadGroup {
  count: number;
  status?: number;
}

export interface StickerModelLoadState {
  chat: StickerModelLoadGroup;
  image: StickerModelLoadGroup;
  networkError?: boolean;
}

export function getStickerModelLoadMessage(state: StickerModelLoadState): string {
  if (state.networkError) return '模型列表加载失败。请检查网络连接后重试。';
  if (state.chat.status !== undefined && state.chat.status >= 400) {
    return `计划模型加载失败（HTTP ${state.chat.status}）。请检查当前用户的模型授权与提供商状态。`;
  }
  if (state.image.status !== undefined && state.image.status >= 400) {
    return `生图模型加载失败（HTTP ${state.image.status}）。请检查当前用户的模型授权与提供商状态。`;
  }
  if (state.chat.count === 0 && state.image.count === 0) {
    return '后台未返回可用的计划模型或生图模型。请检查当前用户的模型授权、供应商启用状态和模型类型。';
  }
  if (state.chat.count === 0) return '后台未返回可用的计划模型。请检查当前用户的模型授权、供应商启用状态和模型类型。';
  if (state.image.count === 0) return '后台未返回可用的生图模型。请检查当前用户的模型授权、供应商启用状态和模型类型。';
  return '';
}

/** 贴纸面板简化版：只关心模型是否加载成功 */
export function getStickerModelLoadDiagnosticMessage(hasModels: boolean, selectedModelId: string): string {
  if (hasModels) return '';
  return '后台未返回可用的生图模型。请检查当前用户的模型授权、供应商启用状态和模型类型。';
}
