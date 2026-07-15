/**
 * AI PSD 生成器 Lite Pro — 类型定义
 *
 * 核心定位：AI理解需求 → 规划图层 → 逐层生成PNG → 合成PSD
 * 不做"任意图片精准拆PSD"，而是"从零生成可编辑分层PSD"
 */

// ─── 生成模式 ────────────────────────────────────────────────────────

export type GenerationMode = 'text_to_psd' | 'reference_to_psd' | 'brand_psd';

export const GENERATION_MODE_LABELS: Record<GenerationMode, string> = {
  text_to_psd: '文本生成 PSD',
  reference_to_psd: '参考图生成 PSD',
  brand_psd: '品牌物料 PSD',
};

// ─── 画幅比例 ────────────────────────────────────────────────────────

export interface RatioOption {
  label: string;
  value: string;
  width: number;
  height: number;
}

export const RATIO_OPTIONS: RatioOption[] = [
  { label: '横版 16:9', value: '16:9', width: 1920, height: 1080 },
  { label: '竖版 9:16', value: '9:16', width: 1080, height: 1920 },
  { label: '方图 1:1', value: '1:1', width: 1440, height: 1440 },
  { label: '小红书 4:5', value: '4:5', width: 1440, height: 1800 },
  { label: '公众号封面 2.35:1', value: '2.35:1', width: 2350, height: 1000 },
  { label: '自定义', value: 'custom', width: 0, height: 0 },
];

// ─── 用途类型 ────────────────────────────────────────────────────────

export type SceneType = 'brand_kv' | 'poster' | 'ecommerce' | 'xiaohongshu_cover' | 'wechat_cover' | 'ui_visual' | 'pop_up' | 'custom';

export const SCENE_TYPE_OPTIONS: { label: string; value: SceneType }[] = [
  { label: '品牌 KV', value: 'brand_kv' },
  { label: '商业海报', value: 'poster' },
  { label: '电商主图', value: 'ecommerce' },
  { label: '小红书封面', value: 'xiaohongshu_cover' },
  { label: '公众号封面', value: 'wechat_cover' },
  { label: 'UI视觉图', value: 'ui_visual' },
  { label: '快闪活动物料', value: 'pop_up' },
  { label: '自定义', value: 'custom' },
];

// ─── 风格方向 ────────────────────────────────────────────────────────

export type StyleTag = 'commercial' | 'minimal_luxury' | 'oriental_luxury' | 'trendy_illustration' | 'tech' | 'healing' | 'black_gold' | 'red_gold' | 'youthful' | 'cinematic';

export const STYLE_TAG_OPTIONS: { label: string; value: StyleTag }[] = [
  { label: '商业广告', value: 'commercial' },
  { label: '极简高级', value: 'minimal_luxury' },
  { label: '东方奢感', value: 'oriental_luxury' },
  { label: '潮流插画', value: 'trendy_illustration' },
  { label: '科技感', value: 'tech' },
  { label: '治愈轻松', value: 'healing' },
  { label: '黑金质感', value: 'black_gold' },
  { label: '红金高级', value: 'red_gold' },
  { label: '年轻活力', value: 'youthful' },
  { label: '电影级画质', value: 'cinematic' },
];

// ─── 色彩倾向 ────────────────────────────────────────────────────────

export type ColorTone = 'auto' | 'red_gold' | 'black_gold' | 'blue_white' | 'warm_orange' | 'natural_green' | 'premium_gray' | 'custom';

export const COLOR_TONE_OPTIONS: { label: string; value: ColorTone }[] = [
  { label: '自动匹配', value: 'auto' },
  { label: '红金', value: 'red_gold' },
  { label: '黑金', value: 'black_gold' },
  { label: '蓝白', value: 'blue_white' },
  { label: '暖橙', value: 'warm_orange' },
  { label: '绿色自然', value: 'natural_green' },
  { label: '高级灰', value: 'premium_gray' },
  { label: '自定义色', value: 'custom' },
];

// ─── 图层复杂度 ──────────────────────────────────────────────────────

export type LayerComplexity = 'simple' | 'standard' | 'rich';

export const LAYER_COMPLEXITY_OPTIONS: { label: string; value: LayerComplexity; layers: string }[] = [
  { label: '简洁', value: 'simple', layers: '5-7层' },
  { label: '标准', value: 'standard', layers: '8-12层' },
  { label: '丰富', value: 'rich', layers: '12-18层' },
];

// ─── 输出质量 ────────────────────────────────────────────────────────

export type OutputQuality = 'standard' | 'high' | 'hd';

export const OUTPUT_QUALITY_OPTIONS: { label: string; value: OutputQuality; desc: string }[] = [
  { label: '标准', value: 'standard', desc: '最大边 1600px' },
  { label: '高清', value: 'hd', desc: '最大边 2048px' },
];

// ─── 文字生成方式 ────────────────────────────────────────────────────

export type TextRenderMode = 'editable_text' | 'image_text' | 'both';

export const TEXT_RENDER_MODE_OPTIONS: { label: string; value: TextRenderMode; desc: string }[] = [
  { label: 'PSD可编辑文字', value: 'editable_text', desc: '程序生成文字层' },
  { label: '图片艺术字', value: 'image_text', desc: '图像模型生成艺术字图层' },
  { label: '双层保留', value: 'both', desc: '可编辑文字 + 艺术字参考' },
];

// ─── 任务状态 ────────────────────────────────────────────────────────

export type AiPsdTaskStatus =
  | 'idle'
  | 'uploading'
  | 'queued'
  | 'planning'
  | 'preview_generating'
  | 'layer_generating'
  | 'text_building'
  | 'psd_exporting'
  | 'packaging'
  | 'success'
  | 'failed'
  | 'cancelled';

export const TASK_STATUS_STEP: Record<AiPsdTaskStatus, number> = {
  idle: 0,
  uploading: 5,
  queued: 5,
  planning: 15,
  preview_generating: 30,
  layer_generating: 55,
  text_building: 70,
  psd_exporting: 85,
  packaging: 95,
  success: 100,
  failed: 0,
  cancelled: 0,
};

export const TASK_STATUS_LABEL: Record<AiPsdTaskStatus, string> = {
  idle: '等待中',
  uploading: '正在上传素材...',
  queued: '任务已创建，等待生成',
  planning: '正在规划PSD图层...',
  preview_generating: '正在生成整图预览...',
  layer_generating: '正在生成分层PNG...',
  text_building: '正在生成可编辑文字层...',
  psd_exporting: '正在合成PSD文件...',
  packaging: '正在打包结果文件...',
  success: '生成完成',
  failed: '生成失败',
  cancelled: '已取消',
};

// ─── 图层类型 ────────────────────────────────────────────────────────

export type LayerType = 'background' | 'light' | 'subject' | 'decoration' | 'texture' | 'atmosphere' | 'product' | 'logo' | 'text' | 'text_preview' | 'shadow';

// ─── Layer Plan JSON 结构（LLM输出）──────────────────────────────────

export interface LayerPlanCanvas {
  width: number;
  height: number;
  ratio: string;
  backgroundColor?: string;
  dpi?: number;
}

export interface LayerPlanLayer {
  id: string;
  name: string;
  group: string;
  type: LayerType;
  transparent: boolean;
  editable: boolean;
  prompt: string;
  description?: string;
  blendMode?: string;
  role?: 'main' | 'accent' | 'fill' | 'overlay' | 'shadow' | 'product_ref' | 'logo_ref' | 'product' | 'logo';
  keepOriginal?: boolean;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  visible?: boolean;
}

export interface LayerPlanTextLayer {
  id: string;
  name: string;
  text: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  align?: string;
  lineHeight?: number;
  letterSpacing?: number;
  editable: boolean;
}

export interface LayerPlan {
  canvas: LayerPlanCanvas;
  style?: string;
  composition?: string;
  layers: LayerPlanLayer[];
  textLayers: LayerPlanTextLayer[];
}

// ─── 任务数据（内存/数据库）─────────────────────────────────────────

export interface AiPsdTask {
  id: string;
  userId?: string;
  generationMode: GenerationMode;
  prompt: string;
  title?: string;
  subtitle?: string;
  bodyText?: string;
  slogan?: string;
  ratio: string;
  customWidth?: number;
  customHeight?: number;
  sceneType: SceneType;
  style: StyleTag[];
  colorTone: ColorTone;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  layerComplexity: LayerComplexity;
  outputQuality: OutputQuality;
  textRenderMode: TextRenderMode;
  status: AiPsdTaskStatus;
  progress: number;
  currentStep?: string;
  currentLayerName?: string;
  previewUrl?: string;
  psdUrl?: string;
  zipUrl?: string;
  jsonUrl?: string;
  reportUrl?: string;
  errorMessage?: string;
  layerPlan?: LayerPlan;
  // 上传素材URL
  referenceImageUrls?: string[];
  productImageUrls?: string[];
  logoImageUrls?: string[];
  // 品牌物料模式字段
  brandName?: string;
  brandSlogan?: string;
  brandColors?: string[];
  materialType?: string;
  // 模型选择
  imageModel?: string;
  llmModel?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── 图层定义（psd-builder / export-packager 使用） ──────────────

export interface TextLayerDef {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  x: number;
  y: number;
  bold?: boolean;
  italic?: boolean;
  opacity?: number;
}

/** 可编辑文本层配置 — 在 TextLayerDef 基础上增加编辑器所需字段 */
export interface TextLayerEditableConfig extends TextLayerDef {
  /** 在画布中的层级索引 */
  layerIndex: number;
  /** V4 规范图层名 */
  v4Name: string;
}

export interface LayerDef {
  type: LayerType;
  name: string;
  v4Name: string;
  transparent: boolean;
  editable: boolean;
  blendMode?: string;
  opacity?: number;
  imageUrl?: string;
  imageBuffer?: Buffer;
  textConfig?: TextLayerDef;
  keepOriginal?: boolean;
  visible?: boolean;
}

// ─── 前端表单数据 ────────────────────────────────────────────────────

export interface AiPsdFormData {
  generationMode: GenerationMode;
  prompt: string;
  title: string;
  subtitle: string;
  bodyText: string;
  ratio: string;
  customWidth: number;
  customHeight: number;
  sceneType: SceneType;
  style: StyleTag[];
  colorTone: ColorTone;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  layerComplexity: LayerComplexity;
  outputQuality: OutputQuality;
  textRenderMode: TextRenderMode;
  imageModel: string;
  llmModel: string;
}

export const DEFAULT_FORM_DATA: AiPsdFormData = {
  generationMode: 'text_to_psd',
  prompt: '',
  title: '',
  subtitle: '',
  bodyText: '',
  ratio: '16:9',
  customWidth: 1920,
  customHeight: 1080,
  sceneType: 'poster',
  style: ['commercial', 'minimal_luxury'],
  colorTone: 'auto',
  primaryColor: '',
  secondaryColor: '',
  accentColor: '',
  layerComplexity: 'standard',
  outputQuality: 'standard',
  textRenderMode: 'editable_text',
  imageModel: '',
  llmModel: '',
};

// ─── 上传素材 ────────────────────────────────────────────────────────

export interface UploadedAsset {
  file: File;
  previewUrl: string;
  serverUrl?: string; // 上传到服务器后的URL
}

// ─── 图层树显示 ──────────────────────────────────────────────────────

export interface LayerDisplayItem {
  id: string;
  name: string;
  type: LayerType;
  group: string;
  transparent: boolean;
  editable: boolean;
  visible: boolean;
  thumbnailUrl?: string;
  downloadUrl?: string;
  prompt?: string;
}

// ─── 任务结果 ────────────────────────────────────────────────────────

export interface AiPsdTaskResult {
  taskId: string;
  status: AiPsdTaskStatus;
  progress: number;
  currentStep?: string;
  currentLayerName?: string;
  previewUrl?: string;
  psdUrl?: string;
  zipUrl?: string;
  jsonUrl?: string;
  reportUrl?: string;
  layers?: LayerDisplayItem[];
  errorMessage?: string;
}
