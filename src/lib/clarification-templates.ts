/**
 * P0-2: 模糊追问模板库
 * 提供10种常见模糊场景的追问模板，帮助用户明确需求
 */

export type VagueScenario =
  | 'style_missing'      // 缺少风格
  | 'subject_missing'    // 缺少主体
  | 'context_missing'    // 缺少上下文
  | 'format_missing'     // 缺少格式/尺寸
  | 'color_missing'      // 缺少配色
  | 'mood_missing'       // 缺少氛围/情绪
  | 'reference_missing'  // 缺少参考图
  | 'usage_missing'      // 缺少用途/场景
  | 'brand_missing'      // 缺少品牌信息
  | 'quantity_missing';  // 缺少数量

export interface ClarificationTemplate {
  scenario: VagueScenario;
  title: string;
  question: string;
  options: string[];
  followUpHint?: string;
}

/**
 * 10种模糊场景追问模板库
 */
export const CLARIFICATION_TEMPLATES: Record<VagueScenario, ClarificationTemplate> = {
  style_missing: {
    scenario: 'style_missing',
    title: '风格偏好',
    question: '您希望采用什么风格？',
    options: [
      '现代简约 - 简洁线条、几何元素',
      '复古怀旧 - 温暖色调、怀旧质感',
      '赛博朋克 - 霓虹灯光、科技感',
      '自然手绘 - 柔和笔触、有机形态',
      '扁平插画 - 简单图形、鲜艳配色',
      '3D写实 - 真实材质、光影效果'
    ],
    followUpHint: '风格决定了整体视觉语言，包括线条、色彩、质感等'
  },

  subject_missing: {
    scenario: 'subject_missing',
    title: '创作主体',
    question: '您想创作的主要内容是什么？',
    options: [
      '人物肖像 - 人物形象、表情神态',
      '产品设计 - 商品展示、包装设计',
      '场景环境 - 空间氛围、建筑景观',
      '抽象图形 - 概念表达、艺术创作',
      '品牌标识 - Logo、VI元素',
      '插画故事 - 叙事画面、角色场景'
    ],
    followUpHint: '主体是画面核心，决定了构图和焦点'
  },

  context_missing: {
    scenario: 'context_missing',
    title: '使用场景',
    question: '这张图将在什么场景中使用？',
    options: [
      '社交媒体 - Instagram/小红书/微博',
      '电商展示 - 产品详情页/首页Banner',
      '广告宣传 - 海报/户外广告/DM单',
      '网站界面 - Landing Page/App界面',
      '印刷物料 - 名片/画册/包装',
      '视频封面 - YouTube/B站封面'
    ],
    followUpHint: '场景影响尺寸、构图和信息密度'
  },

  format_missing: {
    scenario: 'format_missing',
    title: '画面尺寸',
    question: '您需要的画面尺寸/比例是？',
    options: [
      '正方形 1:1 - 社交媒体头像/封面',
      '横版 16:9 - 视频/网站Banner',
      '竖版 9:16 - 手机壁纸/竖屏展示',
      '四开 4:3 - 传统画幅/印刷',
      '超宽 21:9 - 电影感/全景展示',
      '自定义 - 请说明具体尺寸'
    ],
    followUpHint: '尺寸影响构图布局和元素排布'
  },

  color_missing: {
    scenario: 'color_missing',
    title: '配色方案',
    question: '您偏好什么配色风格？',
    options: [
      '明亮活泼 - 高饱和度、活力感',
      '柔和温暖 - 低对比度、温馨感',
      '冷峻科技 - 蓝灰色系、未来感',
      '经典黑白 - 纯黑白、简约高级',
      '自然大地 - 绿棕色系、有机感',
      '品牌定制 - 请提供品牌色值'
    ],
    followUpHint: '配色决定画面情绪和品牌识别'
  },

  mood_missing: {
    scenario: 'mood_missing',
    title: '画面氛围',
    question: '您希望画面传达什么情绪/氛围？',
    options: [
      '轻松愉悦 - 明亮、亲切、有趣',
      '专业严肃 - 稳重、可信、权威',
      '梦幻浪漫 - 柔美、诗意、温柔',
      '神秘深沉 - 深色、层次、张力',
      '活力动感 - 运动感、速度感',
      '平静禅意 - 极简、留白、宁静'
    ],
    followUpHint: '氛围影响光影、色调和元素选择'
  },

  reference_missing: {
    scenario: 'reference_missing',
    title: '参考素材',
    question: '您有参考图或示例吗？',
    options: [
      '有参考图 - 请上传参考图片',
      '有参考链接 - 请提供设计案例链接',
      '描述参考 - 用文字描述想要的风格',
      '无参考 - 请AI自由创作',
      '多图组合 - 融合多个参考风格'
    ],
    followUpHint: '参考图能快速明确方向，减少沟通成本'
  },

  usage_missing: {
    scenario: 'usage_missing',
    title: '使用目的',
    question: '这个设计的主要目的是什么？',
    options: [
      '品牌推广 - 提升品牌认知',
      '产品销售 - 促进购买转化',
      '信息传达 - 传递具体信息',
      '情感共鸣 - 引发情感认同',
      '装饰美化 - 美化空间/界面',
      '艺术表达 - 个人创作表达'
    ],
    followUpHint: '目的决定设计重点和信息层级'
  },

  brand_missing: {
    scenario: 'brand_missing',
    title: '品牌信息',
    question: '是否需要体现品牌元素？',
    options: [
      '需品牌Logo - 请提供Logo文件',
      '需品牌色系 - 请提供品牌色值',
      '需品牌字体 - 请说明字体要求',
      '无品牌要求 - 自由设计',
      '全品牌规范 - 请提供VI手册',
      '新品牌设计 - 需要设计品牌元素'
    ],
    followUpHint: '品牌元素确保设计符合品牌调性'
  },

  quantity_missing: {
    scenario: 'quantity_missing',
    title: '数量需求',
    question: '您需要生成多少张/多少版本？',
    options: [
      '单张 - 一个最终版本',
      '3-5张 - 多方案对比',
      '系列图 - 风格统一的系列',
      '套图 - 不同尺寸/场景的套装',
      '迭代版 - 需要多次修改',
      '不确定 - 根据效果决定'
    ],
    followUpHint: '数量影响生成策略和迭代方式'
  }
};

/**
 * 检测模糊场景 - 从用户输入中识别缺失的关键信息
 */
export function detectVagueScenarios(userInput: string): VagueScenario[] {
  const input = userInput.toLowerCase();
  const missing: VagueScenario[] = [];

  // 风格检测
  const styleKeywords = ['风格', 'style', '简约', '复古', '赛博', '手绘', '扁平', '写实', '3d', '卡通', '插画', '极简', '现代', '传统'];
  if (!styleKeywords.some(k => input.includes(k))) {
    missing.push('style_missing');
  }

  // 主体检测
  const subjectKeywords = ['人', '人物', '产品', '商品', '场景', '风景', 'logo', '标识', '图标', '插画', '角色', '动物', '植物', '建筑'];
  if (!subjectKeywords.some(k => input.includes(k))) {
    missing.push('subject_missing');
  }

  // 尺寸/格式检测
  const formatKeywords = ['尺寸', '比例', '正方形', '横版', '竖版', '方形', '宽', '高', '1:1', '16:9', '9:16', '4:3', '海报', 'banner', '封面', '头像'];
  if (!formatKeywords.some(k => input.includes(k))) {
    missing.push('format_missing');
  }

  // 配色检测
  const colorKeywords = ['色', '颜色', '配色', '色调', '暖色', '冷色', '黑白', '彩色', '明亮', '暗', '彩色', '单色', '渐变'];
  if (!colorKeywords.some(k => input.includes(k))) {
    missing.push('color_missing');
  }

  // 参考图检测
  const refKeywords = ['参考', '参考图', '类似', '像', '风格像', '照着', '模仿', '示例', '范例'];
  if (!refKeywords.some(k => input.includes(k))) {
    missing.push('reference_missing');
  }

  // 用途/场景检测
  const usageKeywords = ['用途', '用于', '使用', '场景', '社交', '电商', '广告', '网站', 'app', '印刷', '视频', '封面', 'banner', '海报'];
  if (!usageKeywords.some(k => input.includes(k))) {
    missing.push('usage_missing');
  }

  // 数量检测
  const quantityKeywords = ['张', '个', '组', '套', '系列', '多少', '几张', '版本', '方案'];
  if (!quantityKeywords.some(k => input.includes(k))) {
    missing.push('quantity_missing');
  }

  return missing;
}

/**
 * 生成追问消息 - 根据缺失信息生成友好的追问文本
 */
export function generateClarificationMessage(
  missingScenarios: VagueScenario[],
  maxQuestions: number = 3
): string {
  if (missingScenarios.length === 0) {
    return '';
  }

  // 优先级排序：主体 > 风格 > 尺寸 > 配色 > 用途 > 参考 > 数量
  const priority: VagueScenario[] = [
    'subject_missing',
    'style_missing',
    'format_missing',
    'color_missing',
    'usage_missing',
    'reference_missing',
    'quantity_missing',
    'mood_missing',
    'brand_missing',
    'context_missing'
  ];

  // 按优先级排序并取前N个
  const sortedMissing = missingScenarios
    .sort((a, b) => priority.indexOf(a) - priority.indexOf(b))
    .slice(0, maxQuestions);

  // 构建追问消息
  let message = '我很乐意帮您创作！为了让结果更符合您的期望，请补充以下信息：\n\n';

  sortedMissing.forEach((scenario, index) => {
    const template = CLARIFICATION_TEMPLATES[scenario];
    message += `**${index + 1}. ${template.title}**\n`;
    message += `${template.question}\n`;
    message += template.options.slice(0, 4).map(opt => `  - ${opt}`).join('\n');
    message += '\n\n';
  });

  message += '您可以选择上述选项，或直接用文字描述您的想法。';

  return message;
}

/**
 * 快速追问模板 - 用于极短输入的快速引导
 */
export const QUICK_CLARIFICATION_MESSAGES: Record<string, string> = {
  '生成': '您想生成什么内容？比如：产品图、人物插画、风景海报、Logo设计...',
  '画': '您想画什么？请描述主体内容，比如：一只猫、城市街景、人物肖像...',
  '设计': '您想设计什么类型的作品？比如：Logo、海报、包装、网页界面...',
  '改': '您想修改哪张图片？请先选中画布上的图片，然后描述您想怎么改',
  '帮我': '我可以帮您：\n1. 生成图片（描述您想要的画面）\n2. 修改图片（选中图片后描述修改方向）\n3. 优化提示词（提供原始描述，我来优化）\n4. 设计方案（说明设计目标和风格）',
  '创作': '您想创作什么类型的作品？请描述内容、风格和用途'
};