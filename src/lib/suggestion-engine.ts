/**
 * P0-2 Task 3: 完成后建议引擎
 * 根据生成内容类型智能推荐后续操作，提供可点击快捷按钮
 */

export type ContentCategory = 
  | 'image_generated'      // 新生成的图片
  | 'image_edited'         // 编辑后的图片（修图/擦除等）
  | 'image_upscaled'       // 放大后的图片
  | 'image_background_removed' // 去背景后的图片
  | 'image_extended'       // 扩展后的图片
  | 'video_generated'      // 生成的视频
  | 'video_extended'       // 延长后的视频
  | '3d_model_generated'   // 生成的3D模型
  | 'svg_traced'           // SVG描摹结果
  | 'text_content'         // 文字内容（提示词/文案等）
  | 'workflow_completed'   // 工作流完成
  | 'brand_asset_created'  // 品牌资产创建
  | 'multi_image_set'      // 多图套图（电商/分镜等）
  | 'audio_generated'      // 音频生成
  | 'unknown';             // 未知类型

export interface Suggestion {
  id: string;
  label: string;           // 显示文案
  action: string;          // 执行动作类型
  prompt?: string;         // 预填充指令
  icon?: string;           // 图标名称
  priority: number;        // 优先级（越高越靠前）
  category?: string;       // 建议类别
}

export interface SuggestionContext {
  contentCategory: ContentCategory;
  hasTransparentBackground?: boolean;  // 是否透明背景
  hasMultipleImages?: boolean;         // 是否多图
  isHighResolution?: boolean;          // 是否高分辨率
  hasVideo?: boolean;                  // 是否视频
  has3DModel?: boolean;                // 是否3D模型
  hasAudio?: boolean;                  // 是否音频
  modelName?: string;                  // 使用模型名称
  originalPrompt?: string;             // 原始提示词
  styleKeywords?: string[];            // 风格关键词
}

/**
 * 建议规则库：根据内容类别匹配合适的后续操作建议
 */
const SUGGESTION_RULES: Record<ContentCategory, Suggestion[]> = {
  image_generated: [
    { id: 'img2img', label: '图生图：换个风格', action: 'img2img', prompt: '请将这张图转换为水彩画风格', icon: 'ImagePlus', priority: 100, category: 'transform' },
    { id: 'refine', label: '语言修图：调整细节', action: 'refine', prompt: '请帮我调整这张图片的', icon: 'Edit3', priority: 90, category: 'edit' },
    { id: 'upscale', label: '放大高清', action: 'upscale', prompt: '', icon: 'Expand', priority: 80, category: 'enhance' },
    { id: 'remove_bg', label: '移除背景', action: 'remove_bg', prompt: '', icon: 'Eraser', priority: 75, category: 'edit' },
    { id: 'extend', label: '扩展画面', action: 'extend', prompt: '', icon: 'ArrowsOut', priority: 70, category: 'transform' },
    { id: 'outpaint', label: '向外延伸', action: 'outpaint', prompt: '请向四周延伸画面，保持风格一致', icon: 'Frame', priority: 65, category: 'transform' },
    { id: 'variations', label: '生成变体', action: 'variations', prompt: '请基于这张图生成3个不同角度的变体', icon: 'Copy', priority: 60, category: 'generate' },
    { id: 'video_i2v', label: '图生视频', action: 'video_i2v', prompt: '请将这张图片生成一段动态视频', icon: 'Film', priority: 55, category: 'video' },
    { id: '3d_model', label: '转3D模型', action: '3d_model', prompt: '', icon: 'Cube', priority: 50, category: '3d' },
    { id: 'svg_trace', label: 'SVG描摹', action: 'svg_trace', prompt: '', icon: 'Vector', priority: 45, category: 'export' },
    { id: 'download_png', label: '下载PNG', action: 'download', prompt: '', icon: 'Download', priority: 40, category: 'export' },
    { id: 'download_psd', label: '下载PSD分层', action: 'download_psd', prompt: '', icon: 'FileImage', priority: 35, category: 'export' },
  ],
  
  image_edited: [
    { id: 'compare', label: '对比原图', action: 'compare', prompt: '', icon: 'Columns', priority: 100, category: 'view' },
    { id: 'refine_more', label: '继续修改', action: 'refine', prompt: '请继续调整', icon: 'Edit3', priority: 90, category: 'edit' },
    { id: 'upscale', label: '放大高清', action: 'upscale', prompt: '', icon: 'Expand', priority: 80, category: 'enhance' },
    { id: 'img2img', label: '换个风格', action: 'img2img', prompt: '', icon: 'ImagePlus', priority: 70, category: 'transform' },
    { id: 'download', label: '下载结果', action: 'download', prompt: '', icon: 'Download', priority: 60, category: 'export' },
  ],
  
  image_upscaled: [
    { id: 'refine_detail', label: '补充细节', action: 'refine', prompt: '请为这张放大后的图片补充更多细节', icon: 'Sparkles', priority: 100, category: 'enhance' },
    { id: 'img2img', label: '换个风格', action: 'img2img', prompt: '', icon: 'ImagePlus', priority: 80, category: 'transform' },
    { id: 'download', label: '下载高清图', action: 'download', prompt: '', icon: 'Download', priority: 70, category: 'export' },
  ],
  
  image_background_removed: [
    { id: 'new_background', label: '换新背景', action: 'img2img', prompt: '请为这张图片添加一个自然风景背景', icon: 'ImagePlus', priority: 100, category: 'transform' },
    { id: 'composite', label: '合成场景', action: 'refine', prompt: '请将这张透明图片合成到', icon: 'Layers', priority: 90, category: 'edit' },
    { id: 'upscale', label: '放大高清', action: 'upscale', prompt: '', icon: 'Expand', priority: 80, category: 'enhance' },
    { id: 'download_png', label: '下载透明PNG', action: 'download', prompt: '', icon: 'Download', priority: 70, category: 'export' },
    { id: 'download_psd', label: '下载PSD分层', action: 'download_psd', prompt: '', icon: 'FileImage', priority: 60, category: 'export' },
  ],
  
  image_extended: [
    { id: 'refine_edge', label: '优化边缘', action: 'refine', prompt: '请优化扩展区域的边缘过渡', icon: 'Blend', priority: 100, category: 'edit' },
    { id: 'upscale', label: '放大高清', action: 'upscale', prompt: '', icon: 'Expand', priority: 80, category: 'enhance' },
    { id: 'img2img', label: '调整风格', action: 'img2img', prompt: '', icon: 'ImagePlus', priority: 70, category: 'transform' },
    { id: 'download', label: '下载扩展图', action: 'download', prompt: '', icon: 'Download', priority: 60, category: 'export' },
  ],
  
  video_generated: [
    { id: 'extend_video', label: '延长视频', action: 'video_extend', prompt: '请继续延长这段视频', icon: 'Timer', priority: 100, category: 'video' },
    { id: 'add_audio', label: '添加音效', action: 'audio', prompt: '请为这段视频生成配套音效', icon: 'Music', priority: 90, category: 'audio' },
    { id: 'video_edit', label: '语言编辑', action: 'video_edit', prompt: '请修改这段视频', icon: 'Film', priority: 80, category: 'edit' },
    { id: 'new_video', label: '生成新版本', action: 'video_generate', prompt: '', icon: 'Refresh', priority: 70, category: 'generate' },
    { id: 'download_video', label: '下载视频', action: 'download', prompt: '', icon: 'Download', priority: 60, category: 'export' },
  ],
  
  video_extended: [
    { id: 'extend_more', label: '继续延长', action: 'video_extend', prompt: '', icon: 'Timer', priority: 100, category: 'video' },
    { id: 'add_audio', label: '添加音效', action: 'audio', prompt: '', icon: 'Music', priority: 90, category: 'audio' },
    { id: 'download', label: '下载完整视频', action: 'download', prompt: '', icon: 'Download', priority: 80, category: 'export' },
  ],
  
  '3d_model_generated': [
    { id: 'retexture', label: '重贴纹理', action: '3d_retexture', prompt: '', icon: 'Paintbrush', priority: 100, category: '3d' },
    { id: 'remesh', label: '优化面数', action: '3d_remesh', prompt: '', icon: 'Geometry', priority: 90, category: '3d' },
    { id: 'new_angle', label: '新角度渲染', action: '3d_render', prompt: '请生成正面视角的渲染图', icon: 'Camera', priority: 80, category: '3d' },
    { id: 'download_glb', label: '下载GLB', action: 'download_3d', prompt: '', icon: 'Download', priority: 70, category: 'export' },
    { id: 'download_obj', label: '下载OBJ', action: 'download_3d', prompt: '', icon: 'FileArchive', priority: 60, category: 'export' },
  ],
  
  svg_traced: [
    { id: 'edit_svg', label: '编辑矢量', action: 'svg_edit', prompt: '', icon: 'Edit3', priority: 100, category: 'edit' },
    { id: 'svg_download', label: '下载SVG', action: 'download_svg', prompt: '', icon: 'Download', priority: 90, category: 'export' },
    { id: 'img2img', label: '重新生成', action: 'img2img', prompt: '', icon: 'ImagePlus', priority: 70, category: 'generate' },
  ],
  
  text_content: [
    { id: 'generate_image', label: '生成图片', action: 'generate', prompt: '', icon: 'ImagePlus', priority: 100, category: 'generate' },
    { id: 'generate_video', label: '生成视频', action: 'video_generate', prompt: '', icon: 'Film', priority: 80, category: 'video' },
    { id: 'optimize_prompt', label: '优化提示词', action: 'optimize_prompt', prompt: '', icon: 'Wand2', priority: 70, category: 'text' },
    { id: 'save_prompt', label: '保存到提示词库', action: 'save_prompt', prompt: '', icon: 'Bookmark', priority: 60, category: 'save' },
  ],
  
  workflow_completed: [
    { id: 'review_results', label: '查看所有结果', action: 'view_all', prompt: '', icon: 'Grid', priority: 100, category: 'view' },
    { id: 'export_all', label: '批量导出', action: 'export_all', prompt: '', icon: 'Download', priority: 80, category: 'export' },
    { id: 'rerun', label: '重新执行', action: 'workflow_rerun', prompt: '', icon: 'Refresh', priority: 70, category: 'workflow' },
    { id: 'modify_node', label: '修改节点参数', action: 'edit_workflow', prompt: '', icon: 'Edit3', priority: 60, category: 'workflow' },
  ],
  
  brand_asset_created: [
    { id: 'apply_brand', label: '应用到新设计', action: 'brand_apply', prompt: '请使用这个品牌风格生成', icon: 'Paintbrush', priority: 100, category: 'brand' },
    { id: 'generate_pack', label: '生成品牌套件', action: 'brand_pack', prompt: '', icon: 'Package', priority: 90, category: 'brand' },
    { id: 'share_brand', label: '分享品牌资产', action: 'share', prompt: '', icon: 'Share2', priority: 70, category: 'share' },
  ],
  
  multi_image_set: [
    { id: 'review_all', label: '查看全部', action: 'view_all', prompt: '', icon: 'Grid', priority: 100, category: 'view' },
    { id: 'edit_batch', label: '批量编辑', action: 'batch_edit', prompt: '', icon: 'Layers', priority: 90, category: 'edit' },
    { id: 'download_all', label: '打包下载', action: 'download_all', prompt: '', icon: 'FileArchive', priority: 80, category: 'export' },
    { id: 'regenerate_single', label: '重新生成某张', action: 'regenerate', prompt: '请重新生成第', icon: 'Refresh', priority: 70, category: 'generate' },
  ],
  
  audio_generated: [
    { id: 'adjust_audio', label: '调整音频', action: 'audio_edit', prompt: '', icon: 'Music', priority: 100, category: 'audio' },
    { id: 'add_to_video', label: '添加到视频', action: 'audio_video', prompt: '', icon: 'Film', priority: 90, category: 'video' },
    { id: 'download_audio', label: '下载音频', action: 'download_audio', prompt: '', icon: 'Download', priority: 80, category: 'export' },
  ],
  
  unknown: [
    { id: 'generate', label: '继续创作', action: 'generate', prompt: '', icon: 'ImagePlus', priority: 100, category: 'generate' },
    { id: 'ask_help', label: '询问帮助', action: 'help', prompt: '请问你能帮我做什么？', icon: 'HelpCircle', priority: 80, category: 'help' },
  ],
};

/**
 * 生成后续操作建议
 * @param context 内容上下文信息
 * @returns 建议列表（最多返回6条，按优先级排序）
 */
export function generateSuggestions(context: SuggestionContext): Suggestion[] {
  const suggestions = SUGGESTION_RULES[context.contentCategory] || SUGGESTION_RULES.unknown;
  
  // 根据上下文特征动态调整建议
  if (context.hasTransparentBackground) {
    // 透明背景图优先推荐换背景
    const bgSuggestion = suggestions.find(s => s.id === 'new_background');
    if (bgSuggestion) bgSuggestion.priority += 20;
  }
  
  if (context.hasMultipleImages) {
    // 多图优先推荐批量操作
    const batchSuggestion = suggestions.find(s => s.id === 'download_all' || s.id === 'batch_edit');
    if (batchSuggestion) batchSuggestion.priority += 20;
  }
  
  if (!context.isHighResolution && context.contentCategory.includes('image')) {
    // 低分辨率图优先推荐放大
    const upscaleSuggestion = suggestions.find(s => s.id === 'upscale');
    if (upscaleSuggestion) upscaleSuggestion.priority += 30;
  }
  
  // 按优先级排序，返回前6条
  const sortedSuggestions = [...suggestions]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 6);
  
  return sortedSuggestions;
}

/**
 * 从AI响应中推断内容类别
 * @param response AI响应内容
 * @param toolCalls 工具调用记录
 * @returns 推断的内容类别
 */
export function inferContentCategory(
  response: string,
  toolCalls?: Array<{ name: string; result?: unknown }>
): ContentCategory {
  // 检查工具调用
  if (toolCalls && toolCalls.length > 0) {
    const lastTool = toolCalls[toolCalls.length - 1];
    
    switch (lastTool.name) {
      case 'generate_image':
        return 'image_generated';
      case 'edit_image':
      case 'erase':
      case 'mask_edit':
        return 'image_edited';
      case 'upscale':
        return 'image_upscaled';
      case 'remove_background':
        return 'image_background_removed';
      case 'extend_image':
      case 'outpaint':
        return 'image_extended';
      case 'generate_video':
        return 'video_generated';
      case 'extend_video':
        return 'video_extended';
      case 'generate_3d':
        return '3d_model_generated';
      case 'svg_trace':
        return 'svg_traced';
      case 'generate_audio':
        return 'audio_generated';
      case 'execute_workflow':
        return 'workflow_completed';
      case 'brand_generate':
        return 'brand_asset_created';
      default:
        break;
    }
  }
  
  // 检查响应关键词
  const responseLower = response.toLowerCase();
  
  if (responseLower.includes('已生成图片') || responseLower.includes('图片生成完成')) {
    return 'image_generated';
  }
  if (responseLower.includes('视频') && responseLower.includes('生成')) {
    return 'video_generated';
  }
  if (responseLower.includes('3d模型') || responseLower.includes('三维模型')) {
    return '3d_model_generated';
  }
  if (responseLower.includes('背景已移除') || responseLower.includes('透明背景')) {
    return 'image_background_removed';
  }
  if (responseLower.includes('放大完成') || responseLower.includes('高清')) {
    return 'image_upscaled';
  }
  if (responseLower.includes('svg') || responseLower.includes('矢量')) {
    return 'svg_traced';
  }
  if (responseLower.includes('音频') || responseLower.includes('音乐')) {
    return 'audio_generated';
  }
  if (responseLower.includes('套图') || responseLower.includes('多张')) {
    return 'multi_image_set';
  }
  if (responseLower.includes('品牌') || responseLower.includes('brand')) {
    return 'brand_asset_created';
  }
  
  // 默认为未知
  return 'unknown';
}

/**
 * 格式化建议为显示文本
 * @param suggestions 建议列表
 * @returns 格式化的建议文本块
 */
export function formatSuggestionsForDisplay(suggestions: Suggestion[]): string {
  if (suggestions.length === 0) return '';
  
  const suggestionLines = suggestions.map(s => {
    const promptText = s.prompt ? `（如："${s.prompt.slice(0, 20)}..."）` : '';
    return `- **${s.label}** ${promptText}`;
  });
  
  return `💡 **建议下一步操作：**
${suggestionLines.join('\n')}
> 点击上方按钮可直接执行对应操作`;
}

/**
 * 生成可点击的建议按钮数据
 * @param suggestions 建议列表
 * @returns 按钮配置数组（用于渲染快捷操作按钮）
 */
export function generateSuggestionButtons(suggestions: Suggestion[]): Array<{
  label: string;
  action: string;
  prompt?: string;
  icon?: string;
}> {
  return suggestions.map(s => ({
    label: s.label,
    action: s.action,
    prompt: s.prompt,
    icon: s.icon,
  }));
}
