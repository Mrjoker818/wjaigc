/**
 * P0-2: 预测性交互系统 - 统一意图分类器
 * 支持画布模式 + 节点模式双模式统一意图识别
 */

// 意图类型定义
export type IntentCategory = 
  | 'generate'      // 生成意图：生成图片/视频/3D/音频
  | 'operate'       // 操作意图：放大/去背景/擦除/扩展/裁切/图生图
  | 'analyze'       // 分析意图：分析图片/描述图片/识别元素
  | 'brand'         // 品牌意图：品牌设计/风格切换/品牌资产
  | 'workflow'      // 工作流意图：创建节点/执行节点/修改节点
  | 'chat'          // 纯聊天意图：闲聊/问答/求助
  | 'unknown';      // 无法识别

// 意图清晰度等级
export type IntentClarity = 
  | 'extremely_vague'  // 极度模糊：需要追问
  | 'moderately_vague' // 中等模糊：自动补全执行
  | 'clear';           // 清晰：直接执行

// 操作类型细分
export type OperateAction = 
  | 'upscale'       // 放大
  | 'remove_bg'     // 去背景
  | 'erase'         // 擦除
  | 'mask_edit'     // 蒙版编辑
  | 'extend'        // 扩展画面
  | 'crop'          // 裁切
  | 'img2img'       // 图生图
  | 'retouch'       // 语言修图
  | 'color_adjust'  // 调色
  | 'svg_trace'     // SVG描摹
  | 'segment';      // 元素分层

// 生成类型细分
export type GenerateAction = 
  | 'image'         // 生成图片
  | 'video'         // 生成视频
  | 'video_extend'  // 视频延长
  | '3d'            // 生成3D模型
  | 'audio';        // 生成音频

// 追问结构
export interface ClarificationNeeded {
  questions: string[];
  suggestions: string[];
}

// 完整意图结构
export interface ClassifiedIntent {
  category: IntentCategory;
  clarity: IntentClarity;
  action?: OperateAction | GenerateAction | string;
  targetImage?: {
    imageId: string;
    imageUrl: string;
  };
  params?: Record<string, unknown>;
  clarification?: ClarificationNeeded;
}

// 操作意图关键词映射
const OPERATE_KEYWORDS: Record<OperateAction, string[]> = {
  upscale: ['放大', '变大', '提高分辨率', '高清', '清晰', 'upscale', 'scale up', 'enlarge'],
  remove_bg: ['去背景', '抠图', '去掉背景', '透明背景', '移除背景', 'remove bg', 'remove background', '背景去掉'],
  erase: ['擦除', '抹掉', '去掉', '删除', '清除', 'erase', 'remove', 'delete', '擦掉'],
  mask_edit: ['蒙版', 'mask', '遮罩', '局部修改', '局部编辑'],
  extend: ['扩展', '延伸', '扩大', '扩图', 'extend', 'expand', 'outpaint'],
  crop: ['裁切', '裁剪', 'cut', 'crop', '剪裁', '切掉'],
  img2img: ['图生图', '变体', '改风格', '换成', '转换成', 'img2img', 'image to image', '变换', '改变'],
  retouch: ['修图', '修改', '调整', '改动', 'edit', 'retouch', '修改图片'],
  color_adjust: ['调色', '调整颜色', '变色', '换颜色', '调亮', '调暗', '调整亮度', 'color', 'brightness'],
  svg_trace: ['矢量化', 'svg', '描摹', '转矢量', 'vectorize', 'trace'],
  segment: ['分层', '拆分', '分离', '拆解', '元素分层', 'segment', 'layer'],
};

// 生成意图关键词映射
const GENERATE_KEYWORDS: Record<GenerateAction, string[]> = {
  image: [
    '生成图片', '画', '创建图片', '生成图', '画一个', '设计一个', 'generate image', 'create image', '生图',
    '创意海报', '电商主图', '商品场景图', '社媒配图', '社交媒体套图', '营销主视觉',
    '包装设计', '包装方案', '礼盒设计', '瓶身设计', '标签设计', '包装效果图',
    '美陈设计', '商业美陈', '商场美陈', '展览展陈', '快闪店', '橱窗陈列', '导视系统',
    'ip形象', 'ip 形象', '吉祥物', '角色设定', '角色三视图', '表情包',
    '字体设计', '标题字', '艺术字', '品牌字标', '书籍封面', '杂志视觉', '画册设计',
    '概念插画', '贴纸设计', '3d视觉', '3d 视觉', '网页界面', 'app界面',
  ],
  video: ['生成视频', '做视频', '创建视频', '生成一段视频', 'generate video', 'create video', '文生视频'],
  video_extend: ['延长视频', '续视频', '视频延长', 'extend video', 'continue video'],
  '3d': ['生成3d', '转3d', '创建3d', '三维', '3d模型', 'generate 3d', 'create 3d'],
  audio: ['生成音频', '配音', '语音', '音乐', 'generate audio', 'tts', 'speech'],
};

// 分析意图关键词映射
const ANALYZE_KEYWORDS: Record<string, string[]> = {
  analyze: ['分析', '理解', '识别', 'analyze', 'understand', 'recognize'],
  describe: ['描述', '说明', '介绍', 'describe', 'explain', '这是什么'],
  identify: ['识别元素', '识别物体', 'identify', 'detect'],
};

// 品牌意图关键词映射
const BRAND_KEYWORDS: Record<string, string[]> = {
  brand_design: [
    '品牌设计', '品牌视觉', '品牌识别', '品牌标志', '标志设计', 'logo设计', 'logo 设计',
    'vi设计', 'vi 设计', '标准字', '图形标', '品牌系统', 'brand identity', 'brand design',
  ],
  style_switch: ['切换风格', '换风格', '改变风格', 'style switch'],
  brand_asset: ['品牌资产', 'brand dna', '品牌dna', '品牌规范', '视觉资产'],
};

// 工作流意图关键词映射
const WORKFLOW_KEYWORDS: Record<string, string[]> = {
  create_node: ['创建节点', '添加节点', '新建节点', 'create node', 'add node'],
  execute_node: ['执行节点', '运行节点', 'execute', 'run', '执行工作流'],
  modify_node: ['修改节点', '编辑节点', '调整节点', 'modify', 'edit node'],
};

// 聊天意图关键词映射
const CHAT_KEYWORDS: Record<string, string[]> = {
  greeting: ['你好', '您好', 'hello', 'hi', '嗨', '早上好', '下午好'],
  help: ['帮助', '怎么用', '如何使用', 'help', 'how to', '教程', '指南'],
  question: ['什么是', '为什么', '如何', '怎么', 'what', 'why', 'how'],
  feedback: ['建议', '反馈', '问题', '意见', 'suggestion', 'feedback'],
};

/**
 * 主分类函数：对用户输入进行意图分类
 */
export function classifyIntent(
  input: string,
  context: {
    hasImages?: boolean;
    selectedImageId?: string | null;
    selectedImageUrl?: string | null;
    isNodeMode?: boolean;
    nodeSelectedId?: string | null;
  }
): ClassifiedIntent {
  const text = input.toLowerCase().trim();
  const hasImages = context.hasImages || false;
  const hasSelectedImage = !!context.selectedImageId && !!context.selectedImageUrl;
  
  // 1. 检测操作意图（优先级最高，需要选中图片）
  if (hasSelectedImage) {
    const operateIntent = detectOperateIntent(text, hasSelectedImage);
    if (operateIntent) return operateIntent;
  }
  
  // 2. 检测生成意图
  const generateIntent = detectGenerateIntent(text, hasImages);
  if (generateIntent) return generateIntent;
  
  // 3. 检测分析意图（需要图片）
  if (hasImages) {
    const analyzeIntent = detectAnalyzeIntent(text, true);
    if (analyzeIntent) return analyzeIntent;
  }
  
  // 4. 检测品牌意图
  const brandIntent = detectBrandIntent(text);
  if (brandIntent) return brandIntent;
  
  // 5. 检测工作流意图（节点模式）
  if (context.isNodeMode) {
    const workflowIntent = detectWorkflowIntent(text);
    if (workflowIntent) return workflowIntent;
  }
  
  // 6. 检测聊天意图
  const chatIntent = detectChatIntent(text);
  if (chatIntent) return chatIntent;
  
  // 7. 默认返回未知意图
  const clarity = determineClarity(text, hasImages, hasSelectedImage);
  return {
    category: 'unknown',
    clarity,
    clarification: clarity === 'extremely_vague' ? {
      questions: ['您希望我做什么呢？是生成图片、编辑图片，还是分析图片？'],
      suggestions: ['生成一张风景图', '帮我放大这张图片', '分析这张图片的内容'],
    } : undefined,
  };
}

/**
 * 检测操作意图
 */
function detectOperateIntent(text: string, hasSelectedImage: boolean): ClassifiedIntent | null {
  for (const [action, keywords] of Object.entries(OPERATE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        const clarity = text.length > 15 ? 'clear' : 'moderately_vague';
        return {
          category: 'operate',
          clarity,
          action: action as OperateAction,
          params: {},
          clarification: clarity !== 'clear' ? {
            questions: ['您希望对这张图片做什么具体操作？'],
            suggestions: ['放大这张图片', '去掉背景', '生成风格变体'],
          } : undefined,
        };
      }
    }
  }
  return null;
}

/**
 * 检测生成意图
 */
function detectGenerateIntent(text: string, hasImages: boolean): ClassifiedIntent | null {
  // 检测视频生成关键词
  for (const [action, keywords] of Object.entries(GENERATE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        const clarity = text.length > 20 ? 'clear' : 'moderately_vague';
        return {
          category: 'generate',
          clarity,
          action: action as GenerateAction,
          params: {},
          clarification: clarity !== 'clear' ? {
            questions: ['您希望生成什么内容？'],
            suggestions: ['生成一张风景图', '生成一段日落视频', '生成一个3D模型'],
          } : undefined,
        };
      }
    }
  }
  
  // 检测简单生成指令（如"画一个XXX"）
  const simplePatterns = [
    /画[一有个](.+)/,
    /生成[一有个](.+)/,
    /创建[一有个](.+)/,
    /设计[一有个](.+)/,
    /generate (a|an|the) (.+)/i,
  ];
  
  for (const pattern of simplePatterns) {
    const match = text.match(pattern);
    if (match) {
      const subject = match[2] || match[1];
      const clarity = subject.length > 10 ? 'clear' : 'moderately_vague';
      return {
        category: 'generate',
        clarity,
        action: 'image',
        params: { subject },
        clarification: clarity !== 'clear' ? {
          questions: ['您希望是什么风格？（如写实、卡通、极简等）'],
          suggestions: ['写实风格', '卡通风格', '极简风格'],
        } : undefined,
      };
    }
  }
  
  return null;
}

/**
 * 检测分析意图
 */
function detectAnalyzeIntent(text: string, hasImages: boolean): ClassifiedIntent | null {
  // 分析意图需要有图片
  if (!hasImages) {
    return null;
  }
  
  for (const [action, keywords] of Object.entries(ANALYZE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          category: 'analyze',
          clarity: 'clear',
          action,
          params: {},
        };
      }
    }
  }
  
  return null;
}

/**
 * 检测品牌意图
 */
function detectBrandIntent(text: string): ClassifiedIntent | null {
  for (const [action, keywords] of Object.entries(BRAND_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          category: 'brand',
          clarity: 'clear',
          action,
          params: {},
        };
      }
    }
  }
  return null;
}

/**
 * 检测工作流意图
 */
function detectWorkflowIntent(text: string): ClassifiedIntent | null {
  for (const [action, keywords] of Object.entries(WORKFLOW_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          category: 'workflow',
          clarity: 'clear',
          action,
          params: {},
        };
      }
    }
  }
  return null;
}

/**
 * 检测聊天意图
 */
function detectChatIntent(text: string): ClassifiedIntent | null {
  for (const [action, keywords] of Object.entries(CHAT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          category: 'chat',
          clarity: 'clear',
          action,
          params: {},
        };
      }
    }
  }
  return null;
}

/**
 * 判断意图清晰度
 */
function determineClarity(
  text: string,
  hasImages: boolean,
  hasSelectedImage: boolean
): IntentClarity {
  // 极短文本 + 无图片 = 极度模糊
  if (text.length < 10 && !hasImages) {
    return 'extremely_vague';
  }
  
  // 短文本 + 有图片但无选中 = 中等模糊
  if (text.length < 15 && hasImages && !hasSelectedImage) {
    return 'moderately_vague';
  }
  
  // 有足够上下文 = 清晰
  return 'clear';
}

/**
 * 快速意图分类（轻量级版本）
 * 用于实时反馈，不需要完整上下文
 */
export function quickClassifyIntent(text: string): {
  category: IntentCategory;
  confidence: number;
} {
  const lowerText = text.toLowerCase();
  
  // 操作关键词检测
  const allOperateKeywords = Object.values(OPERATE_KEYWORDS).flat();
  const operateMatch = allOperateKeywords.some(k => lowerText.includes(k.toLowerCase()));
  if (operateMatch) {
    return { category: 'operate', confidence: 0.8 };
  }
  
  // 生成关键词检测
  const allGenerateKeywords = Object.values(GENERATE_KEYWORDS).flat();
  const generateMatch = allGenerateKeywords.some(k => lowerText.includes(k.toLowerCase()));
  if (generateMatch) {
    return { category: 'generate', confidence: 0.8 };
  }
  
  // 分析关键词检测
  const allAnalyzeKeywords = Object.values(ANALYZE_KEYWORDS).flat();
  const analyzeMatch = allAnalyzeKeywords.some(k => lowerText.includes(k.toLowerCase()));
  if (analyzeMatch) {
    return { category: 'analyze', confidence: 0.7 };
  }
  
  // 品牌关键词检测
  const allBrandKeywords = Object.values(BRAND_KEYWORDS).flat();
  const brandMatch = allBrandKeywords.some(k => lowerText.includes(k.toLowerCase()));
  if (brandMatch) {
    return { category: 'brand', confidence: 0.8 };
  }
  
  // 聊天关键词检测
  const allChatKeywords = Object.values(CHAT_KEYWORDS).flat();
  const chatMatch = allChatKeywords.some(k => lowerText.includes(k.toLowerCase()));
  if (chatMatch) {
    return { category: 'chat', confidence: 0.9 };
  }
  
  return { category: 'unknown', confidence: 0.3 };
}

/**
 * 从意图生成默认参数建议
 */
export function getDefaultParamsForIntent(intent: ClassifiedIntent): Record<string, unknown> {
  switch (intent.category) {
    case 'operate':
      switch (intent.action) {
        case 'upscale':
          return { scale: 2 };
        case 'remove_bg':
          return { model: 'birefnet-general-lite' };
        case 'extend':
          return { scale: 1.5, direction: 'all' };
        default:
          return {};
      }
    case 'generate':
      switch (intent.action) {
        case 'image':
          return { size: '1024x1024', quality: 'high' };
        case 'video':
          return { duration: 5, aspectRatio: '16:9' };
        default:
          return {};
      }
    default:
      return {};
  }
}

/**
 * 意图分类为人类可读描述
 */
export function describeIntent(intent: ClassifiedIntent): string {
  const categoryNames: Record<IntentCategory, string> = {
    generate: '生成',
    operate: '操作',
    analyze: '分析',
    brand: '品牌',
    workflow: '工作流',
    chat: '聊天',
    unknown: '未知',
  };
  
  const actionNames: Record<string, string> = {
    upscale: '放大',
    remove_bg: '去背景',
    erase: '擦除',
    mask_edit: '蒙版编辑',
    extend: '扩展',
    crop: '裁切',
    img2img: '图生图',
    retouch: '修图',
    color_adjust: '调色',
    svg_trace: 'SVG描摹',
    segment: '元素分层',
    image: '生成图片',
    video: '生成视频',
    video_extend: '视频延长',
    '3d': '生成3D',
    audio: '生成音频',
  };
  
  const category = categoryNames[intent.category] || intent.category;
  const action = intent.action ? actionNames[intent.action] || intent.action : '';
  
  return `${category}${action ? ` - ${action}` : ''}`;
}

export default classifyIntent;