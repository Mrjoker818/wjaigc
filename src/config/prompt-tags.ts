// 提示词助手配置
// 各分类的提示词标签库

export interface PromptTag {
  label: string;        // 显示标签
  prompt: string;       // 实际提示词
  category: string[];   // 适用的分类
  hot?: boolean;        // 是否热门
}

export const PROMPT_TAGS: PromptTag[] = [
  // ===== 通用标签 =====
  { label: '写实', prompt: 'photorealistic, hyperrealistic, 8k', category: ['general', 'photo'], hot: true },
  { label: '电影感', prompt: 'cinematic, dramatic lighting, film grain', category: ['general', 'photo'] },
  { label: '4K高清', prompt: '4K, high detail, intricate details', category: ['general', 'photo'] },
  { label: '专业摄影', prompt: 'professional photography, studio lighting', category: ['general', 'photo'] },
  { label: '自然光', prompt: 'natural lighting, soft light, golden hour', category: ['general', 'photo'] },
  { label: '暖色调', prompt: 'warm colors, cozy atmosphere', category: ['general'] },
  { label: '冷色调', prompt: 'cool colors, cold tones, blue tones', category: ['general'] },
  { label: '高饱和', prompt: 'vibrant colors, highly saturated', category: ['general'] },
  { label: '低饱和', prompt: 'muted colors, desaturated, matte', category: ['general'] },

  // ===== 海报相关 =====
  { label: '大字标题', prompt: 'bold typography, large text, headline', category: ['poster'] },
  { label: '创意排版', prompt: 'creative layout, unique composition', category: ['poster'] },
  { label: '渐变背景', prompt: 'gradient background, smooth transition', category: ['poster'] },
  { label: '几何图形', prompt: 'geometric shapes, abstract patterns', category: ['poster'] },
  { label: '双重曝光', prompt: 'double exposure, overlay effect', category: ['poster', 'photo'] },
  { label: '故障艺术', prompt: 'glitch art, digital distortion', category: ['poster'] },
  { label: '赛博朋克', prompt: 'cyberpunk, neon lights, futuristic', category: ['poster', 'ui'] },
  { label: '国潮风', prompt: 'Chinese style, traditional elements, modern design', category: ['poster'] },
  { label: '孟菲斯', prompt: 'Memphis style, playful colors, bold shapes', category: ['poster'] },
  { label: '极简主义', prompt: 'minimalist, clean design, lots of whitespace', category: ['poster', 'logo'] },
  { label: '波普艺术', prompt: 'pop art, bold colors, comic style', category: ['poster'] },
  { label: '蒸汽波', prompt: 'vaporwave, retro aesthetic, neon pink blue', category: ['poster'] },

  // ===== Logo相关 =====
  { label: '简约线条', prompt: 'minimal line art, simple strokes', category: ['logo'] },
  { label: '几何图形', prompt: 'geometric logo, basic shapes', category: ['logo'] },
  { label: '渐变色彩', prompt: 'gradient colors, smooth transition', category: ['logo'] },
  { label: '单色设计', prompt: 'monochrome, single color', category: ['logo'] },
  { label: '徽章风格', prompt: 'emblem style, badge design', category: ['logo'] },
  { label: '手绘风格', prompt: 'hand-drawn, sketchy, organic', category: ['logo'] },
  { label: '负空间', prompt: 'negative space, clever design', category: ['logo'] },
  { label: '动态图标', prompt: 'dynamic logo, in motion', category: ['logo'] },

  // ===== IP形象 =====
  { label: '可爱萌系', prompt: 'cute, kawaii, adorable', category: ['ip_character'] },
  { label: '酷炫拽', prompt: 'cool, edgy, confident', category: ['ip_character'] },
  { label: '拟人化', prompt: 'anthropomorphic, character design', category: ['ip_character'] },
  { label: 'Q版', prompt: 'chibi, super deformed, cute small version', category: ['ip_character'] },
  { label: '写实角色', prompt: 'realistic character, detailed', category: ['ip_character'] },
  { label: '二次元', prompt: 'anime style, manga aesthetic', category: ['ip_character'] },
  { label: '国风', prompt: 'Chinese traditional style, hanfu', category: ['ip_character'] },
  { label: '未来感', prompt: 'futuristic, sci-fi, cyber', category: ['ip_character'] },
  { label: '复古', prompt: 'retro style, vintage cartoon', category: ['ip_character'] },
  { label: '表情包', prompt: 'emoji style, expression pack, multiple emotions', category: ['ip_character'] },

  // ===== UI界面 =====
  { label: '深色模式', prompt: 'dark mode, dark theme', category: ['ui'] },
  { label: '浅色模式', prompt: 'light mode, light theme', category: ['ui'] },
  { label: '玻璃拟态', prompt: 'glassmorphism, frosted glass', category: ['ui'] },
  { label: '毛玻璃', prompt: 'blur effect, bokeh background', category: ['ui'] },
  { label: '扁平化', prompt: 'flat design, vector graphics', category: ['ui'] },
  { label: '渐变卡片', prompt: 'gradient card, modern UI', category: ['ui'] },
  { label: '等距图标', prompt: 'isometric icon, 2.5D', category: ['ui'] },
  { label: '线性图标', prompt: 'outline icon, line style', category: ['ui'] },
  { label: '填充图标', prompt: 'filled icon, solid style', category: ['ui'] },
  { label: '深空背景', prompt: 'deep space background, stars', category: ['ui'] },
  { label: '粒子效果', prompt: 'particles, floating elements', category: ['ui'] },
  { label: '霓虹灯', prompt: 'neon glow, luminous effects', category: ['ui', 'poster'] },

  // ===== 漫画插画 =====
  { label: '厚涂', prompt: 'painterly, oil painting style', category: ['comic', 'illustration'] },
  { label: '赛璐璐', prompt: 'cel shading, flat colors, anime', category: ['comic', 'illustration'] },
  { label: '水彩', prompt: 'watercolor style, soft edges', category: ['illustration'] },
  { label: '水墨', prompt: 'Chinese ink painting, brush strokes', category: ['illustration'] },
  { label: '铅笔素描', prompt: 'pencil sketch, graphite', category: ['illustration'] },
  { label: '点彩', prompt: 'pointillism, dotted texture', category: ['illustration'] },
  { label: '扁平插画', prompt: 'flat illustration, vector art', category: ['illustration'] },
  { label: '噪点插画', prompt: 'grain texture, noise overlay', category: ['illustration', 'poster'] },
  { label: '日式厚涂', prompt: 'Japanese style painting, detailed', category: ['comic', 'illustration'] },
  { label: '美式漫画', prompt: 'American comic, bold lines', category: ['comic'] },
  { label: '韩系插画', prompt: 'Korean illustration style, soft colors', category: ['illustration'] },

  // ===== 详情页 =====
  { label: '场景图', prompt: 'scene mockup, lifestyle photo', category: ['detail_page'] },
  { label: '爆炸图', prompt: 'exploded view, disassembled parts', category: ['detail_page'] },
  { label: '信息图', prompt: 'infographic, data visualization', category: ['detail_page', 'general'] },
  { label: '对比图', prompt: 'comparison, before after', category: ['detail_page'] },
  { label: '卖点展示', prompt: 'product highlights, key features', category: ['detail_page'] },
  { label: '使用场景', prompt: 'usage scenario, in context', category: ['detail_page'] },
  { label: '材质特写', prompt: 'material close-up, texture detail', category: ['detail_page'] },
  { label: '包装设计', prompt: 'package design, packaging mockup', category: ['detail_page', 'general'] },

  // ===== 社媒配图 =====
  { label: 'Instagram', prompt: 'Instagram square format, social media', category: ['social'] },
  { label: '小红书', prompt: 'Xiaohongshu style, vertical format', category: ['social'] },
  { label: '抖音封面', prompt: 'Douyin cover, vertical video thumbnail', category: ['social'] },
  { label: '微博配图', prompt: 'Weibo post, blog image', category: ['social'] },
  { label: '公众号头图', prompt: 'WeChat article header, featured image', category: ['social'] },
  { label: '朋友圈', prompt: 'Moments post, square image', category: ['social'] },
  { label: '动态图', prompt: 'animated GIF style, motion graphics', category: ['social'] },
  { label: '九宫格', prompt: 'grid layout, 9-grid composition', category: ['social'] },

  // ===== Banner =====
  { label: '电商主图', prompt: 'e-commerce banner, product showcase', category: ['banner'] },
  { label: '节日促销', prompt: 'holiday promotion, festive', category: ['banner'] },
  { label: '倒计时', prompt: 'countdown timer, urgency design', category: ['banner'] },
  { label: '全屏横幅', prompt: 'full-width banner, hero image', category: ['banner'] },
  { label: '移动端横幅', prompt: 'mobile banner, vertical format', category: ['banner'] },
  { label: 'PC横幅', prompt: 'desktop banner, horizontal layout', category: ['banner'] },
  { label: '轮播图', prompt: 'carousel, multiple slides', category: ['banner'] },
  { label: '开屏广告', prompt: 'splash screen, app launch', category: ['banner'] },

  // ===== 照片类 =====
  { label: '人像特写', prompt: 'portrait, close-up shot', category: ['photo'] },
  { label: '全身照', prompt: 'full body shot, standing pose', category: ['photo'] },
  { label: '证件照', prompt: 'ID photo, formal portrait', category: ['photo'] },
  { label: '商业摄影', prompt: 'commercial photography, product shot', category: ['photo'] },
  { label: '街拍', prompt: 'street photography, urban', category: ['photo'] },
  { label: '风光照', prompt: 'landscape photography, nature', category: ['photo'] },
  { label: '夜景', prompt: 'night scene, city lights', category: ['photo'] },
  { label: '日出日落', prompt: 'sunrise sunset, golden hour', category: ['photo'] },
  { label: '微距', prompt: 'macro photography, close-up detail', category: ['photo'] },
  { label: '航拍', prompt: 'aerial view, drone shot', category: ['photo'] },
  { label: '黑白照', prompt: 'black and white, monochrome', category: ['photo'] },
  { label: '复古胶片', prompt: 'film grain, vintage film look', category: ['photo'] },
  { label: '宝丽来', prompt: 'Polaroid, instant camera', category: ['photo'] },
  { label: '时尚大片', prompt: 'fashion editorial, magazine style', category: ['photo'] },

  // ===== 产品品类相关标签 =====
  // 白酒
  { label: '高端白酒', prompt: 'premium baijiu, Chinese liquor, luxury', category: ['product_baijiu'], hot: true },
  { label: '年份老酒', prompt: 'aged baijiu, vintage, classic', category: ['product_baijiu'] },
  { label: '清香型', prompt: 'light aroma, fresh taste, delicate', category: ['product_baijiu'] },
  { label: '酱香型', prompt: 'sauce aroma, rich flavor, complex', category: ['product_baijiu'] },
  { label: '浓香型', prompt: 'strong aroma, bold, traditional', category: ['product_baijiu'] },

  // 啤酒
  { label: '精酿啤酒', prompt: 'craft beer, artisan, premium', category: ['product_beer'], hot: true },
  { label: '拉格', prompt: 'lager, crisp, refreshing', category: ['product_beer'] },
  { label: '艾尔', prompt: 'ale, hoppy, aromatic', category: ['product_beer'] },
  { label: '小麦啤酒', prompt: 'wheat beer, cloudy, citrus', category: ['product_beer'] },
  { label: 'IPA', prompt: 'IPA, bitter, hop-forward', category: ['product_beer'] },

  // 洋酒/红酒
  { label: '干红', prompt: 'dry red wine, grape, elegant', category: ['product_wine'], hot: true },
  { label: '白葡萄酒', prompt: 'white wine, crisp, fruity', category: ['product_wine'] },
  { label: '香槟', prompt: 'champagne, sparkling, celebration', category: ['product_wine'] },
  { label: '威士忌', prompt: 'whisky, amber, sophisticated', category: ['product_whisky'] },
  { label: '白兰地', prompt: 'brandy, smooth, refined', category: ['product_brandy'] },

  // 鸡尾酒
  { label: '创意鸡尾酒', prompt: 'creative cocktail, mixology, colorful', category: ['product_cocktail'], hot: true },
  { label: '经典鸡尾酒', prompt: 'classic cocktail, timeless, elegant', category: ['product_cocktail'] },
  { label: '莫吉托', prompt: 'mojito, fresh, minty', category: ['product_cocktail'] },
  { label: '马天尼', prompt: 'martini, sophisticated, iconic', category: ['product_cocktail'] },

  // 茶饮
  { label: '新式茶饮', prompt: 'modern tea drink, boba, trendy', category: ['product_tea'], hot: true },
  { label: '传统茶', prompt: 'traditional tea, serene, zen', category: ['product_tea'] },
  { label: '奶茶', prompt: 'milk tea, creamy, sweet', category: ['product_tea'] },
  { label: '果茶', prompt: 'fruit tea, fresh, colorful', category: ['product_tea'] },

  // 咖啡
  { label: '精品咖啡', prompt: 'specialty coffee, artisan, rich', category: ['product_coffee'], hot: true },
  { label: '拿铁艺术', prompt: 'latte art, coffee, milk foam', category: ['product_coffee'] },
  { label: '冷萃', prompt: 'cold brew, smooth, refreshing', category: ['product_coffee'] },
  { label: '浓缩', prompt: 'espresso, bold, intense', category: ['product_coffee'] },

  // 食品
  { label: '美食摄影', prompt: 'food photography, appetizing, delicious', category: ['product_food'], hot: true },
  { label: '甜点', prompt: 'dessert, sweet, indulgent', category: ['product_food'] },
  { label: '烘焙', prompt: 'baking, pastry, warm', category: ['product_food'] },
  { label: '中餐', prompt: 'Chinese cuisine, traditional, authentic', category: ['product_food'] },
  { label: '西餐', prompt: 'western cuisine, elegant, refined', category: ['product_food'] },

  // 化妆品
  { label: '美妆产品', prompt: 'cosmetics, beauty, glamorous', category: ['product_cosmetics'], hot: true },
  { label: '护肤品', prompt: 'skincare, natural, healthy glow', category: ['product_cosmetics'] },
  { label: '口红', prompt: 'lipstick, bold color, stylish', category: ['product_cosmetics'] },
  { label: '香水', prompt: 'perfume, fragrance, elegant', category: ['product_cosmetics'] },

  // 电子产品
  { label: '科技产品', prompt: 'tech product, futuristic, sleek', category: ['product_electronics'], hot: true },
  { label: '手机', prompt: 'smartphone, modern, sleek design', category: ['product_electronics'] },
  { label: '电脑', prompt: 'laptop, professional, minimalist', category: ['product_electronics'] },
  { label: '耳机', prompt: 'headphones, audio, lifestyle', category: ['product_electronics'] },
  { label: '智能手表', prompt: 'smartwatch, wearable, innovative', category: ['product_electronics'] },

  // 服装时尚
  { label: '时尚服装', prompt: 'fashion clothing, stylish, trendy', category: ['product_fashion'], hot: true },
  { label: '运动装', prompt: 'sportswear, athletic, dynamic', category: ['product_fashion'] },
  { label: '正装', prompt: 'formal wear, elegant, professional', category: ['product_fashion'] },
  { label: '休闲装', prompt: 'casual wear, relaxed, comfortable', category: ['product_fashion'] },
  { label: '配饰', prompt: 'accessories, stylish, detail', category: ['product_fashion'] },
];

// 产品品类标签映射
export const PRODUCT_CATEGORY_TAGS = {
  none: [],
  baijiu: ['product_baijiu'],
  beer: ['product_beer'],
  wine: ['product_wine'],
  whisky: ['product_whisky'],
  brandy: ['product_brandy'],
  cocktail: ['product_cocktail'],
  tea: ['product_tea'],
  coffee: ['product_coffee'],
  food: ['product_food'],
  cosmetics: ['product_cosmetics'],
  electronics: ['product_electronics'],
  fashion: ['product_fashion'],
};

// 根据分类获取标签（支持图片分类+产品品类）
export function getTagsByCategory(category: string, productCategory?: string): PromptTag[] {
  let tags = PROMPT_TAGS.filter(tag => tag.category.includes(category) || tag.category.includes('general'));
  
  // 如果有产品品类，添加产品相关的标签
  if (productCategory && productCategory !== 'none') {
    const productTags = PRODUCT_CATEGORY_TAGS[productCategory as keyof typeof PRODUCT_CATEGORY_TAGS] || [];
    const additionalTags = PROMPT_TAGS.filter(tag => 
      productTags.some(pt => tag.category.includes(pt))
    );
    tags = [...tags, ...additionalTags];
  }
  
  // 去重
  const seen = new Set();
  return tags.filter(tag => {
    const key = tag.prompt;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 获取热门标签
export function getHotTags(): PromptTag[] {
  return PROMPT_TAGS.filter(tag => tag.hot);
}

// 获取所有标签
export function getAllTags(): PromptTag[] {
  return PROMPT_TAGS;
}

// 分类配置
export const CATEGORY_TAGS_CONFIG = {
  general: {
    label: '通用',
    color: '#d4af37',
    keywords: ['通用', '综合', 'mixed'],
  },
  poster: {
    label: '海报',
    color: '#ff6b6b',
    keywords: ['海报', '宣传', 'poster', 'flyer'],
  },
  logo: {
    label: 'Logo',
    color: '#4ecdc4',
    keywords: ['logo', '标志', '图标'],
  },
  detail_page: {
    label: '详情页',
    color: '#a8e6cf',
    keywords: ['详情页', '电商', '详情'],
  },
  ip_character: {
    label: 'IP形象',
    color: '#ffb6c1',
    keywords: ['IP', '角色', '吉祥物', 'character'],
  },
  social: {
    label: '社媒配图',
    color: '#98d8c8',
    keywords: ['社交', '媒体', 'social'],
  },
  ui: {
    label: 'UI界面',
    color: '#b19cd9',
    keywords: ['UI', '界面', '界面设计'],
  },
  comic: {
    label: '漫画',
    color: '#ffd93d',
    keywords: ['漫画', 'comic', 'manga'],
  },
  photo: {
    label: '照片',
    color: '#6c5ce7',
    keywords: ['照片', '摄影', 'photo'],
  },
  banner: {
    label: 'Banner',
    color: '#fd79a8',
    keywords: ['banner', '横幅', '广告'],
  },
  illustration: {
    label: '插画',
    color: '#fdcb6e',
    keywords: ['插画', 'illustration'],
  },
};
