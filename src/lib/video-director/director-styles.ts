/** Single source of director styles shared by the video panel, director prompt and shot planner. */
export const DIRECTOR_STYLE_IDS = [
  'cinematic', 'documentary', 'commercial', 'music-video', 'anime',
  'minimal', 'realistic', 'vlog', 'artistic',
] as const;

export type DirectorStyle = typeof DIRECTOR_STYLE_IDS[number];

export interface DirectorStyleDefinition {
  id: DirectorStyle;
  /** Short UI label. */
  label: string;
  icon: string;
  /** One-line UI hint. */
  hint: string;
  /** Shot-plan / story-asset style requirement. */
  planDescription: string;
  /** LLM temperature for the director prompt. */
  temperature: number;
  /** Rule-based fallback phrases when no LLM is configured. */
  rule: { opening: string; quality: string; mood: string };
}

export const DIRECTOR_STYLES: Record<DirectorStyle, DirectorStyleDefinition> = {
  cinematic: {
    id: 'cinematic', label: '电影感', icon: '🎬', hint: '景别/运镜/光影',
    planDescription: '电影感叙事，景别清晰、运镜克制、光影写实、声音层次分明。',
    temperature: 0.85,
    rule: { opening: '史诗级电影镜头', quality: '电影级画质，35mm胶片质感，浅景深，电影级调色', mood: '宏大叙事感，强烈的视觉冲击力' },
  },
  documentary: {
    id: 'documentary', label: '纪录片', icon: '📹', hint: '纪实/手持/自然光',
    planDescription: '纪录片风格，手持真实感、自然光、环境声主导、节奏沉稳。',
    temperature: 0.55,
    rule: { opening: '纪实风格镜头', quality: '自然光线，手持摄影质感，真实色彩还原', mood: '真实记录感，自然不做作' },
  },
  commercial: {
    id: 'commercial', label: '广告片', icon: '📺', hint: '高光/特写/节奏',
    planDescription: '广告/产品感，主体为视觉中心、镜头平稳环绕或推进、打光精致、背景简洁。',
    temperature: 0.6,
    rule: { opening: '商业广告级镜头', quality: '专业影棚光效，产品级画质，高饱和度色彩', mood: '精致高级感，吸引眼球的视觉呈现' },
  },
  'music-video': {
    id: 'music-video', label: 'MV', icon: '🎵', hint: '节奏/光影/色彩',
    planDescription: 'MV 风格，镜头切换跟随音乐节拍、动态光效、高对比色彩、情绪张力强。',
    temperature: 0.9,
    rule: { opening: 'MV风格镜头', quality: '节奏感画面，动态光效，高对比度色彩', mood: '充满节奏感和情绪张力' },
  },
  anime: {
    id: 'anime', label: '动漫', icon: '🎨', hint: '风格化/夸张/张力',
    planDescription: '二次元/动漫感，色彩饱和、线条清晰、动作略带夸张、表情富有张力。',
    temperature: 0.8,
    rule: { opening: '动画风格镜头', quality: '流畅动作，细腻线条，鲜艳色彩', mood: '二次元美感，生动的角色表现' },
  },
  minimal: {
    id: 'minimal', label: '极简', icon: '◻️', hint: '留白/克制/长镜头',
    planDescription: '极简风格，大量留白、构图干净、长镜头为主、运镜克制、低饱和色调。',
    temperature: 0.5,
    rule: { opening: '极简风格镜头', quality: '干净构图，柔和自然光，低饱和度调色', mood: '宁静致远的极简美学' },
  },
  realistic: {
    id: 'realistic', label: '写实', icon: '📷', hint: '真实光线/自然表演',
    planDescription: '写实风格，真实光线、自然表演、贴近生活场景。',
    temperature: 0.6,
    rule: { opening: '写实风格镜头', quality: '真实光线，自然肤色与材质，细节清晰', mood: '贴近生活的真实感' },
  },
  vlog: {
    id: 'vlog', label: 'Vlog', icon: '🤳', hint: '贴近/手持/轻快',
    planDescription: 'vlog 日常记录感，镜头贴近人物、手持自然、光线明亮、节奏轻快。',
    temperature: 0.7,
    rule: { opening: 'Vlog 记录镜头', quality: '明亮自然光，手持跟拍质感，色彩清新', mood: '轻松亲切的日常氛围' },
  },
  artistic: {
    id: 'artistic', label: '艺术', icon: '🖼️', hint: '大胆构图/风格化',
    planDescription: '艺术/实验风格，构图大胆、色彩风格化、节奏自由。',
    temperature: 0.9,
    rule: { opening: '艺术实验镜头', quality: '大胆构图，风格化色彩，独特光影', mood: '自由而富有想象力的表达' },
  },
};

export const DIRECTOR_STYLE_LIST: DirectorStyleDefinition[] = DIRECTOR_STYLE_IDS.map(id => DIRECTOR_STYLES[id]);

export const DIRECTOR_STYLE_LABELS: Record<DirectorStyle, string> = Object.fromEntries(
  DIRECTOR_STYLE_LIST.map(style => [style.id, style.label]),
) as Record<DirectorStyle, string>;

export function isDirectorStyle(value: unknown): value is DirectorStyle {
  return typeof value === 'string' && (DIRECTOR_STYLE_IDS as readonly string[]).includes(value);
}

/** Unknown or missing values fall back to cinematic. */
export function normalizeDirectorStyle(value: unknown): DirectorStyle {
  return isDirectorStyle(value) ? value : 'cinematic';
}
