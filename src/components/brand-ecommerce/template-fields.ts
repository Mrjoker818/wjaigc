/**
 * Template-specific field definitions for brand e-commerce.
 * Each template can have unique input fields that map to prompt template placeholders.
 */

export type FieldType = 'text' | 'textarea' | 'select';

export interface TemplateFieldDef {
  /** Unique field key matching prompt placeholder name */
  key: string;
  /** Display label */
  label: string;
  /** Placeholder text */
  placeholder: string;
  /** Field type */
  type: FieldType;
  /** For select type: available options */
  options?: { value: string; label: string }[];
  /** Whether this field is required */
  required?: boolean;
  /** Help hint text */
  hint?: string;
  /** Default value */
  defaultValue?: string;
  /** Number of rows for textarea */
  rows?: number;
}

export interface TemplateFieldGroup {
  /** Group title */
  title: string;
  /** Icon name */
  icon: string;
  /** Fields in this group */
  fields: TemplateFieldDef[];
}

/**
 * Maps template IDs to their specific field groups.
 * Templates not listed here will use the default fields only.
 */
export const TEMPLATE_FIELD_GROUPS: Record<string, TemplateFieldGroup[]> = {
  // ──── 白底主图 ────
  'white-bg': [
    {
      title: '产品展示',
      icon: '📦',
      fields: [
        {
          key: 'SUBJECT_ACTION',
          label: '产品姿态',
          type: 'select',
          placeholder: '选择产品展示姿态',
          options: [
            { value: 'placed flat on surface, front-facing, symmetrical composition', label: '正面平放' },
            { value: 'placed at slight 30-degree angle, natural perspective', label: '30度斜放' },
            { value: 'standing upright on surface, hero composition', label: '竖立展示' },
            { value: 'floating in air with dramatic shadow below, levitation effect', label: '悬浮效果' },
            { value: 'slightly tilted with dynamic shadow, casual elegance', label: '倾斜摆放' },
          ],
          defaultValue: 'placed flat on surface, front-facing, symmetrical composition',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '背景元素',
          type: 'text',
          placeholder: '如：微妙渐变白、极简几何装饰...',
          defaultValue: 'minimal subtle gradient white background',
          hint: '白底主图建议保持简洁',
        },
      ],
    },
  ],

  // ──── 横版Banner图 ────
  'banner-horizontal': [
    {
      title: '广告文案',
      icon: '📝',
      fields: [
        {
          key: 'MAIN_TEXT',
          label: '主标题文案',
          type: 'text',
          placeholder: '如：年度爆款 / 限时特惠 / 新品首发',
          required: true,
        },
        {
          key: 'SECONDARY_TEXT',
          label: '副标题文案',
          type: 'text',
          placeholder: '如：全网最低价 / 买一送一',
        },
        {
          key: 'ACCENT_SYMBOL',
          label: '装饰符号',
          type: 'select',
          placeholder: '选择装饰符号',
          options: [
            { value: '✦', label: '✦ 四角星' },
            { value: '★', label: '★ 实心星' },
            { value: '◆', label: '◆ 菱形' },
            { value: '→', label: '→ 箭头' },
            { value: '│', label: '│ 竖线' },
            { value: '〖〗', label: '〖〗 方括号' },
          ],
          defaultValue: '✦',
        },
      ],
    },
    {
      title: '布局与氛围',
      icon: '🎨',
      fields: [
        {
          key: 'SUBJECT_ACTION',
          label: '产品动态',
          type: 'select',
          placeholder: '选择产品展示方式',
          options: [
            { value: 'hero product centered with dramatic perspective', label: '居中冲击' },
            { value: 'product at left with text area on right', label: '左图右文' },
            { value: 'product at right with text area on left', label: '左文右图' },
            { value: 'product floating with particles and light effects', label: '漂浮光效' },
          ],
          defaultValue: 'hero product centered with dramatic perspective',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '背景氛围',
          type: 'text',
          placeholder: '如：渐变光效、粒子飘散、几何线条...',
          defaultValue: 'dynamic gradient background with subtle light rays',
        },
      ],
    },
  ],

  // ──── 竖版详情页 ────
  'detail-vertical': [
    {
      title: '详情内容',
      icon: '📋',
      fields: [
        {
          key: 'MAIN_TEXT',
          label: '主标题',
          type: 'text',
          placeholder: '如：匠心之作 / 极致体验',
          required: true,
        },
        {
          key: 'SECONDARY_TEXT',
          label: '卖点文案',
          type: 'text',
          placeholder: '如：30小时续航 / 主动降噪',
        },
        {
          key: 'PRODUCT_OR_PROP',
          label: '核心卖点/特性',
          type: 'textarea',
          placeholder: '描述产品的核心卖点，如：\n· 30小时超长续航\n· 主动降噪技术\n· Hi-Res音质认证',
          rows: 3,
          hint: '将作为详情页卖点区块的内容',
        },
      ],
    },
    {
      title: '页面结构',
      icon: '📐',
      fields: [
        {
          key: 'SUBJECT_ACTION',
          label: '产品展示',
          type: 'select',
          placeholder: '选择产品在详情页中的展示方式',
          options: [
            { value: 'hero product at top with multi-section below', label: '顶部英雄区+多区段' },
            { value: 'product repeated in each section', label: '每段重复展示' },
            { value: 'close-up details section by section', label: '逐段细节放大' },
          ],
          defaultValue: 'hero product at top with multi-section below',
        },
        {
          key: 'ACCENT_SYMBOL',
          label: '分隔装饰',
          type: 'text',
          placeholder: '如：✦ │ ◇ ─',
          defaultValue: '✦',
        },
      ],
    },
  ],

  // ──── 小红书封面 ────
  'xiaohongshu': [
    {
      title: '种草文案',
      icon: '📕',
      fields: [
        {
          key: 'MAIN_TEXT',
          label: '标题文案',
          type: 'text',
          placeholder: '如：绝美神仙好物！/ 入手不后悔系列',
          required: true,
          hint: '小红书标题要够吸睛',
        },
        {
          key: 'SECONDARY_TEXT',
          label: '副标题/标签',
          type: 'text',
          placeholder: '如：#好物推荐 #年度爱用',
        },
        {
          key: 'ACCENT_SYMBOL',
          label: '装饰元素',
          type: 'select',
          placeholder: '选择装饰风格',
          options: [
            { value: '✨', label: '✨ 闪闪' },
            { value: '💖', label: '💖 爱心' },
            { value: '🌸', label: '🌸 花朵' },
            { value: '🎀', label: '🎀 蝴蝶结' },
            { value: '🍃', label: '🍃 叶子' },
          ],
          defaultValue: '✨',
        },
      ],
    },
    {
      title: '拍摄风格',
      icon: '📸',
      fields: [
        {
          key: 'SUBJECT_ACTION',
          label: '展示方式',
          type: 'select',
          placeholder: '选择展示方式',
          options: [
            { value: 'held in hand, lifestyle flat lay composition', label: '手持/平铺' },
            { value: 'placed on aesthetic surface, top-down view', label: '俯拍摆拍' },
            { value: 'close-up with bokeh background, dreamy feel', label: '近景虚化' },
            { value: 'unboxing moment, surprise expression', label: '开箱瞬间' },
          ],
          defaultValue: 'held in hand, lifestyle flat lay composition',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '氛围元素',
          type: 'text',
          placeholder: '如：干花、杂志、咖啡杯、丝绸...',
          defaultValue: 'aesthetic lifestyle props, warm natural light',
        },
      ],
    },
  ],

  // ──── 抖音橱窗图 ────
  'douyin': [
    {
      title: '橱窗文案',
      icon: '🎵',
      fields: [
        {
          key: 'MAIN_TEXT',
          label: '主标题',
          type: 'text',
          placeholder: '如：爆款秒杀 / 直播间专属价',
          required: true,
        },
        {
          key: 'SECONDARY_TEXT',
          label: '副标题',
          type: 'text',
          placeholder: '如：限时3折 / 仅剩99件',
        },
        {
          key: 'ACCENT_SYMBOL',
          label: '行动号召符号',
          type: 'select',
          placeholder: '选择CTA符号',
          options: [
            { value: '→', label: '→ 箭头' },
            { value: '▶', label: '▶ 播放按钮' },
            { value: '🛒', label: '🛒 购物车' },
            { value: 'BUY NOW', label: 'BUY NOW' },
          ],
          defaultValue: '→',
        },
      ],
    },
    {
      title: '视觉风格',
      icon: '🎬',
      fields: [
        {
          key: 'SUBJECT_ACTION',
          label: '产品动态',
          type: 'select',
          placeholder: '选择产品展示方式',
          options: [
            { value: 'product flying towards camera with motion blur', label: '冲向镜头' },
            { value: 'product rotating with spotlight, dramatic reveal', label: '旋转聚光' },
            { value: 'product with price tag and deal overlay', label: '价格标签' },
            { value: 'product comparison before/after split', label: '对比展示' },
          ],
          defaultValue: 'product flying towards camera with motion blur',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '背景效果',
          type: 'text',
          placeholder: '如：动态速度线、霓虹光效、弹幕背景...',
          defaultValue: 'dynamic speed lines, energetic vibe',
        },
      ],
    },
  ],

  // ──── 场景氛围图 ────
  'scene-lifestyle': [
    {
      title: '场景设定',
      icon: '🏞️',
      fields: [
        {
          key: 'LOCATION',
          label: '使用场景',
          type: 'select',
          placeholder: '选择产品使用场景',
          options: [
            { value: 'modern minimalist living room with natural light', label: '现代简约客厅' },
            { value: 'cozy bedroom with warm lighting', label: '温馨卧室' },
            { value: 'bright kitchen counter with fresh ingredients', label: '明亮厨房' },
            { value: 'elegant office desk with city view', label: '高级办公室' },
            { value: 'outdoor garden with natural greenery', label: '户外花园' },
            { value: 'cafe interior with warm ambient lighting', label: '咖啡厅' },
            { value: 'bathroom with marble and plants', label: '精品浴室' },
            { value: 'rooftop terrace at golden hour', label: '天台夕阳' },
          ],
          required: true,
          defaultValue: 'modern minimalist living room with natural light',
        },
        {
          key: 'SUBJECT_ACTION',
          label: '产品状态',
          type: 'select',
          placeholder: '选择产品在场景中的状态',
          options: [
            { value: 'naturally placed on surface as if in daily use', label: '自然使用中' },
            { value: 'displayed on shelf as decorative piece', label: '展示摆放' },
            { value: 'being used by person, lifestyle moment', label: '人物使用' },
            { value: 'spotlit on table as focal point', label: '焦点突出' },
          ],
          defaultValue: 'naturally placed on surface as if in daily use',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '场景道具',
          type: 'text',
          placeholder: '如：绿植、书籍、咖啡杯、蜡烛...',
          defaultValue: 'carefully curated lifestyle props, plants and books',
        },
      ],
    },
  ],

  // ──── 模特展示图 ────
  'model-wear': [
    {
      title: '模特与造型',
      icon: '👗',
      fields: [
        {
          key: 'SUBJECT_ACTION',
          label: '模特姿态',
          type: 'select',
          placeholder: '选择模特展示姿态',
          options: [
            { value: 'standing confidently, hand on hip, full body shot', label: '站姿全身' },
            { value: 'walking pose, dynamic movement, three-quarter view', label: '行走动态' },
            { value: 'seated elegantly, half body shot, eye contact', label: '坐姿半身' },
            { value: 'casual lean against wall, street style', label: '靠墙街拍' },
            { value: 'close-up portrait, wearing/holding product', label: '特写肖像' },
          ],
          defaultValue: 'standing confidently, hand on hip, full body shot',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '拍摄背景',
          type: 'select',
          placeholder: '选择拍摄背景',
          options: [
            { value: 'clean white studio background', label: '纯白影棚' },
            { value: 'subtle gradient background', label: '渐变背景' },
            { value: 'urban street scene', label: '街头场景' },
            { value: 'nature outdoor setting', label: '自然外景' },
            { value: 'luxury interior setting', label: '奢华室内' },
          ],
          defaultValue: 'clean white studio background',
        },
      ],
    },
  ],

  // ──── 细节特写 ────
  'detail-closeup': [
    {
      title: '细节展示',
      icon: '🔍',
      fields: [
        {
          key: 'PRODUCT_OR_PROP',
          label: '重点展示部位',
          type: 'textarea',
          placeholder: '描述需要特写展示的产品细节，如：\n· 皮革缝线工艺\n· 金属拉链质感\n· 品牌Logo刻印',
          rows: 3,
          required: true,
          hint: '越具体，AI越能准确呈现细节',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '背景虚化',
          type: 'select',
          placeholder: '选择背景虚化风格',
          options: [
            { value: 'soft warm bokeh background', label: '暖色虚化' },
            { value: 'cool neutral bokeh background', label: '冷色虚化' },
            { value: 'dark dramatic bokeh background', label: '暗色虚化' },
            { value: 'product body as natural bokeh', label: '产品本体虚化' },
          ],
          defaultValue: 'soft warm bokeh background',
        },
      ],
    },
  ],

  // ──── 品牌海报 ────
  'brand-poster': [
    {
      title: '品牌文案',
      icon: '🎨',
      fields: [
        {
          key: 'MAIN_TEXT',
          label: '品牌主标语',
          type: 'text',
          placeholder: '如：定义卓越 / 创享未来',
          required: true,
        },
        {
          key: 'SECONDARY_TEXT',
          label: '品牌副标语',
          type: 'text',
          placeholder: '如：Since 2024 / Crafted with Passion',
        },
        {
          key: 'ACCENT_SYMBOL',
          label: '品牌标识',
          type: 'text',
          placeholder: '如：品牌Logo标志、注册商标®...',
          defaultValue: '®',
        },
      ],
    },
    {
      title: '视觉风格',
      icon: '✨',
      fields: [
        {
          key: 'SUBJECT_ACTION',
          label: '产品构图',
          type: 'select',
          placeholder: '选择产品构图方式',
          options: [
            { value: 'centered hero composition with radial gradient', label: '居中辐射' },
            { value: 'product at golden ratio point, artistic layout', label: '黄金比例' },
            { value: 'dramatic low-angle shot, monumental feel', label: '仰角宏伟' },
            { value: 'symmetrical composition with mirror reflection', label: '对称镜像' },
          ],
          defaultValue: 'centered hero composition with radial gradient',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '背景风格',
          type: 'select',
          placeholder: '选择背景风格',
          options: [
            { value: 'premium gradient background with brand colors', label: '品牌色渐变' },
            { value: 'abstract geometric patterns', label: '抽象几何' },
            { value: 'silk fabric flowing background', label: '丝绸流动' },
            { value: 'marble texture background', label: '大理石纹理' },
          ],
          defaultValue: 'premium gradient background with brand colors',
        },
      ],
    },
  ],

  // ──── 创意合成图 ────
  'creative-composite': [
    {
      title: '创意设定',
      icon: '✨',
      fields: [
        {
          key: 'MAIN_TEXT',
          label: '创意标题',
          type: 'text',
          placeholder: '如：超越想象 / 无限可能',
        },
        {
          key: 'ACCENT_SYMBOL',
          label: '梦幻元素',
          type: 'select',
          placeholder: '选择梦幻装饰',
          options: [
            { value: '✨', label: '✨ 星光' },
            { value: '🌌', label: '🌌 星空' },
            { value: '🦋', label: '🦋 蝴蝶' },
            { value: '🌊', label: '🌊 水波' },
            { value: '🔥', label: '🔥 火焰' },
            { value: '❄️', label: '❄️ 冰晶' },
          ],
          defaultValue: '✨',
        },
        {
          key: 'SUBJECT_ACTION',
          label: '创意效果',
          type: 'select',
          placeholder: '选择创意合成效果',
          options: [
            { value: 'floating among clouds with golden light rays', label: '云端悬浮' },
            { value: 'emerging from water splash, liquid art', label: '水花绽放' },
            { value: 'surrounded by floating particles and light trails', label: '粒子光轨' },
            { value: 'in a dreamlike forest with magical atmosphere', label: '魔法森林' },
            { value: 'breaking through glass with shards and light', label: '破镜而出' },
          ],
          defaultValue: 'floating among clouds with golden light rays',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '超现实背景',
          type: 'text',
          placeholder: '如：星空宇宙、深海世界、极光天际...',
          defaultValue: 'ethereal dreamy atmosphere with floating particles',
        },
      ],
    },
  ],

  // ──── 包装展示图 ────
  'packaging': [
    {
      title: '包装内容',
      icon: '📦',
      fields: [
        {
          key: 'MAIN_TEXT',
          label: '包装文字',
          type: 'text',
          placeholder: '如：品牌名+产品名（印在包装上）',
        },
        {
          key: 'SUBJECT_ACTION',
          label: '包装展示角度',
          type: 'select',
          placeholder: '选择包装展示角度',
          options: [
            { value: 'packaging box front-facing, closed, pristine condition', label: '正面完整' },
            { value: 'packaging box at 45-degree angle showing depth', label: '45度立体' },
            { value: 'packaging partially open revealing product inside', label: '半开展示' },
            { value: 'multiple packaging views arranged together', label: '多角度组合' },
          ],
          defaultValue: 'packaging box front-facing, closed, pristine condition',
        },
        {
          key: 'BACKGROUND_ELEMENTS',
          label: '展示环境',
          type: 'select',
          placeholder: '选择展示环境',
          options: [
            { value: 'clean white surface with soft shadow', label: '白底简约' },
            { value: 'marble surface with luxury feel', label: '大理石高级' },
            { value: 'unboxing scene with ribbons and tissue paper', label: '开箱场景' },
            { value: 'gift wrapping with decorative elements', label: '礼品包装' },
          ],
          defaultValue: 'clean white surface with soft shadow',
        },
      ],
    },
  ],

  // ──── 多尺寸批量图 ────
  'multi-size-batch': [
    {
      title: '批量设置',
      icon: '📐',
      fields: [
        {
          key: 'MAIN_TEXT',
          label: '通用标题',
          type: 'text',
          placeholder: '各尺寸通用的标题文案',
        },
        {
          key: 'SUBJECT_ACTION',
          label: '通用展示',
          type: 'select',
          placeholder: '选择兼容多尺寸的构图方式',
          options: [
            { value: 'centered product with ample breathing room for cropping', label: '居中留白' },
            { value: 'product at center-top, suitable for all ratios', label: '中上构图' },
            { value: 'full product visible with safe margins on all sides', label: '安全边距' },
          ],
          defaultValue: 'centered product with ample breathing room for cropping',
        },
      ],
    },
  ],
};

/**
 * Get field groups for a template. Returns empty array if no specific fields defined.
 */
export function getTemplateFieldGroups(templateId: string): TemplateFieldGroup[] {
  return TEMPLATE_FIELD_GROUPS[templateId] || [];
}

/**
 * Get all unique field keys across all template groups for a given template.
 */
export function getTemplateFieldKeys(templateId: string): string[] {
  const groups = TEMPLATE_FIELD_GROUPS[templateId] || [];
  return groups.flatMap(g => g.fields.map(f => f.key));
}

/**
 * Type for template-specific field values: { templateId: { fieldKey: value } }
 */
export type TemplateFieldValues = Record<string, Record<string, string>>;
