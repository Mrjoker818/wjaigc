/**
 * 视频导演提示词编译器 (video-director/prompt-compiler)
 * 参考 Seedance 2.0 Skill OS 的导演方法论：
 * - 每个镜头一个意图（one intention per scene）
 * - 围绕意图编排镜头景别、运镜、光线、调度、表演、声音
 * - 输出紧凑、具体、可直接喂给视频模型的 production-ready prompt
 *
 * 本模块不直接调用 LLM；它提供系统提示词 + 约束 + 维度选项，
 * 由 /api/video/director-compile 端点调用 chat 模型执行编译。
 */

export type VideoDirectorMode =
  | 'text2video'
  | 'image2video-first'
  | 'image2video-firstlast'
  | 'extend';

export type ShotSize =
  | 'extreme-wide' | 'wide' | 'full' | 'medium-wide' | 'medium'
  | 'medium-close' | 'close-up' | 'extreme-close';

export type CameraSupport = 'handheld' | 'tripod' | 'steadicam' | 'dolly' | 'crane' | 'drone';

export type CameraMovement =
  | 'static' | 'push-in' | 'push-out' | 'pull-back'
  | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down'
  | 'orbit-left' | 'orbit-right' | 'tracking' | 'arc'
  | 'crane-up' | 'crane-down' | 'zoom-in' | 'zoom-out';

export type LensFeel = 'wide' | 'standard' | 'tele' | 'macro';

export type LightingStyle =
  | 'natural-day' | 'golden-hour' | 'blue-hour' | 'night-practical'
  | 'soft-overcast' | 'hard-sun' | 'high-key' | 'low-key'
  | 'neon-cyber' | 'candle-fire' | 'studio-three-point' | 'backlit-silhouette';

export type ToneStyle =
  | 'warm' | 'cool' | 'desaturated' | 'vibrant' | 'monochrome'
  | 'teal-orange' | 'film-grain' | 'pastel' | 'noir-contrast';

export type DirectorStyle = 'cinematic' | 'realistic' | 'anime' | 'commercial' | 'documentary' | 'vlog' | 'artistic';
export const DIRECTOR_STYLE_LABELS: Record<DirectorStyle, string> = {
  cinematic: '电影感',
  realistic: '写实',
  anime: '二次元',
  commercial: '广告',
  documentary: '纪录',
  vlog: 'Vlog',
  artistic: '艺术',
};

export interface VideoShotContract {
  /** 镜头核心意图（一句话），如 "女孩听见身后声音，回头" */
  intention: string;
  /** 镜头景别 */
  shotSize?: ShotSize;
  /** 机位/支撑 */
  cameraSupport?: CameraSupport;
  /** 运镜方式 */
  cameraMovement?: CameraMovement;
  /** 运动强度 0-100 */
  movementIntensity?: number;
  /** 镜头感受 */
  lens?: LensFeel;
  /** 光线风格 */
  lighting?: LightingStyle;
  /** 色调 */
  tone?: ToneStyle;
  /** 主体动作 / 表演 beat（可见动作，非情绪形容词） */
  blockingBeats?: string[];
  /** 场景氛围 */
  atmosphere?: string;
  /** 声音/环境声提示 */
  soundCue?: string;
  /** 镜头结束状态（用于续写） */
  endState?: string;
}

export interface DirectorCompileInput {
  mode: VideoDirectorMode;
  /** 用户原始输入 */
  userPrompt: string;
  /** 视频模型 ID，用于裁剪提示词长度与参数 */
  modelId?: string;
  /** 兼容旧名 model */
  model?: string;
  /** 导演风格 */
  style?: DirectorStyle;
  /** 时长（秒） */
  duration?: number;
  /** 画面比例 */
  aspectRatio?: string;
  /** 首帧描述（图生视频时自动填） */
  firstFrameNote?: string;
  /** 首帧 URL */
  imageUrl?: string;
  /** 尾帧描述（首尾帧模式） */
  lastFrameNote?: string;
  /** 尾帧 URL */
  lastFrameUrl?: string;
  /** 参考图 */
  references?: VideoReferenceBinding[];
  /** 摄像机控制类型 */
  camera?: string;
  /** 音效 */
  audio?: boolean;
  /** 语言 */
  language?: string;
  /** 是否输出反向提示词 */
  includeNegative?: boolean;
  /** 精简/完整版本 */
  verbosity?: 'compact' | 'standard' | 'full';
}

export interface DirectorCompileResult {
  /** 编译后的视频提示词（production-ready） */
  prompt: string;
  /** 反向提示词 */
  negativePrompt?: string;
  /** 本次识别出的镜头合同（便于UI展示） */
  contract: VideoShotContract;
  /** 首帧建议描述（如有） */
  firstFrameSuggestion?: string;
  /** 尾帧建议描述 */
  lastFrameSuggestion?: string;
}

// --------------------------- 导演系统提示词 ---------------------------

export const VIDEO_DIRECTOR_SYSTEM_PROMPT = `你是"无界 AI 视频导演"（Video Director），一个专业的电影/广告/短视频提示词编译器。

## 核心原则（Seedance 导演方法论）
1. **一个镜头一个意图**：先确定这一段视频的戏剧性意图（revelation / goodbye / chase / arrival / reveal ...），然后让景别、运镜、光线、调度、表演、声音都服务于这个意图。
2. **写具体的可见动作（blocking beats），不堆形容词**：
   - ❌ 不写：cinematic, epic, beautiful, amazing, highly detailed, photorealistic, masterpiece, 电影感, 震撼
   - ✅ 要写：她放下信，双手顿住；镜头缓慢推进；柔光从身后窗户打过来；一声椅子摩擦声。
3. **一个清晰的运镜，最多两个阶段**：如 slow push-in / pan-left to reveal / tracking behind. 不要同时写 push + pan + orbit + zoom。
4. **真实光线**：指定实际光源（窗户侧光、霓虹反射、黄金时段斜射、烛光、办公室荧光灯），不写 "beautiful lighting"。
5. **声音提示是视频提示词的一部分**：写环境声、近场声、一声关键音效（"远处雷声滚过"、"一声快门"、"雨打在伞面上"）。
6. **节奏与时长**：按实际秒数安排动作，5秒通常只能完成1-2个动作 beat。
7. **禁止交给模型的内容**：不要让模型生成字幕、字幕条、logo、水印、片尾字幕卡、文字特效；这些后期加。
8. **尊重首帧/尾帧约束**：图生视频/首尾帧模式下，第一段必须描述"从首帧如何开始动"，最后一段必须描述"如何抵达尾帧姿态"。
9. **中文输入用中文输出，英文输入用英文输出**；不要双语双行，不要带解释/前言/Markdown 格式。

## 输出格式（严格遵守，不得多输出任何其它文字）
第一行：<编译后的视频提示词，30-120字，单段流畅描述>
第二行：NEGATIVE: <英文逗号分隔的反向提示词，仅在要求时输出，否则输出 NEGATIVE: ->
第三行：INTENTION: <一句话镜头意图，10字内>
第四行：SHOT: <景别>, <运镜>, <光线风格>, <色调>
第五行：END_STATE: <镜头结束时主体/场景的状态，15字内，用于续写；若无则输出 END_STATE: ->

## 维度词参考（按需选用，不要全塞）
- 景别：远景(extreme-wide)/全景(wide)/中景(medium)/中近景(medium-close)/近景(close-up)/特写(extreme-close)
- 运镜：静止(static)/缓慢推进(slow push-in)/拉出(pull-back)/左右摇(pan)/上下摇(tilt)/环绕(orbit)/跟拍(tracking)/升降(crane)
- 光线：黄金小时(golden-hour)/蓝调时刻(blue-hour)/夜晚实景灯(night-practical)/硬日(hard-sun)/柔和阴天(soft-overcast)/霓虹反射(neon-cyber)/三点布光(three-point)/剪影(backlit-silhouette)
- 色调：暖调(warm)/冷调(cool)/低饱和(desaturated)/胶片颗粒(film-grain)/黑白(monochrome)/青橙(teal-orange)/noir高反差
- 机位：手持(handheld)/脚架(tripod)/稳定器(steadicam)/滑轨(dolly)/无人机(drone)/摇臂(crane)
- 声音：环境声、一句对白、一个关键 SFX、沉默节拍（near-silence 让重音落地）

## 反向提示词默认池（NEGATIVE 时合并到里面，再加上场景特有的失败模式）
blurry, distorted faces, deformed limbs, extra fingers, watermark, subtitle, on-screen text, logo, signature, jitter, shaky overshoot, warp, frozen frame, low resolution, compression artifacts, morphing identity
`;

export function buildDirectorUserMessage(input: DirectorCompileInput): string {
  const lines: string[] = [];
  lines.push(`模式: ${input.mode}`);
  if (input.duration) lines.push(`时长: ${input.duration}秒`);
  if (input.aspectRatio) lines.push(`画面比例: ${input.aspectRatio}`);
  if (input.firstFrameNote) lines.push(`首帧画面: ${input.firstFrameNote}`);
  if (input.lastFrameNote) lines.push(`尾帧画面: ${input.lastFrameNote}`);
  lines.push('');
  lines.push('用户原始描述:');
  lines.push(input.userPrompt);
  lines.push('');
  lines.push(
    input.verbosity === 'compact'
      ? '请输出「紧凑版」提示词（30-60字），保留核心动作+单一运镜+光线+一个声音提示。'
      : input.verbosity === 'full'
      ? '请输出「完整版」提示词（80-120字），包含景别/运镜/光线/调度/声音/色调的完整镜头合同。'
      : '请输出「标准版」提示词（50-90字），包含一个清晰意图+一个运镜+光线+动作beat+声音提示。'
  );
  lines.push(`反向提示词: ${input.includeNegative ? '需要（NEGATIVE行填英文短语）' : '不需要（输出 NEGATIVE: ->）'}`);
  if (input.modelId) {
    lines.push(`目标视频模型: ${input.modelId}（如果模型对长提示词敏感，自动收敛到紧凑版）`);
  }
  return lines.join('\n');
}

// --------------------------- 参考资产语义绑定 ---------------------------

export type VideoReferenceRole =
  | 'identity'       // 角色身份（人物外观锁定）
  | 'character'      // 角色参考（同 identity，兼容命名）
  | 'scene'          // 场景/环境参考
  | 'style'          // 画面风格参考
  | 'composition'    // 构图参考
  | 'motion'         // 运动节奏参考
  | 'camera'         // 机位/运镜参考
  | 'lighting'       // 光线参考
  | 'first-frame'    // 首帧
  | 'last-frame'     // 尾帧
  | 'audio'          // 音频参考
  | 'reference';     // 通用参考（兜底）

export interface VideoReferenceBinding {
  id: string;
  url: string;
  role: VideoReferenceRole;
  label?: string;
  /** 权重 0-1，用于语义说明（是否真传给模型由适配器决定） */
  weight?: number;
}

export const REFERENCE_ROLE_LABEL: Record<VideoReferenceRole, string> = {
  identity: '角色锁定',
  character: '角色参考',
  scene: '场景参考',
  style: '风格参考',
  composition: '构图参考',
  motion: '运动参考',
  camera: '运镜参考',
  lighting: '光线参考',
  'first-frame': '首帧',
  'last-frame': '尾帧',
  audio: '音频参考',
  reference: '通用参考',
};

export const REFERENCE_ROLE_COLOR: Record<VideoReferenceRole, string> = {
  identity: '#d4af37',
  character: '#d4af37',
  scene: '#60a5fa',
  style: '#c084fc',
  composition: '#f472b6',
  motion: '#34d399',
  camera: '#fb923c',
  lighting: '#fbbf24',
  'first-frame': '#3b82f6',
  'last-frame': '#8b5cf6',
  audio: '#10b981',
  reference: '#94a3b8',
};

export function classifyReferenceByHint(hint?: string): VideoReferenceRole {
  if (!hint) return 'reference';
  const h = hint.toLowerCase();
  if (h.includes('人') || h.includes('脸') || h.includes('角色') || h.includes('character') || h.includes('identity') || h.includes('person')) return 'identity';
  if (h.includes('场') || h.includes('景') || h.includes('scene') || h.includes('location') || h.includes('room')) return 'scene';
  if (h.includes('风') || h.includes('style') || h.includes('画风') || h.includes('aesthetic')) return 'style';
  if (h.includes('构') || h.includes('composition') || h.includes('frame')) return 'composition';
  if (h.includes('运') || h.includes('动') || h.includes('motion') || h.includes('movement')) return 'motion';
  if (h.includes('镜') || h.includes('camera')) return 'camera';
  if (h.includes('光') || h.includes('light') || h.includes('lighting')) return 'lighting';
  if (h.includes('首') || h.includes('first')) return 'first-frame';
  if (h.includes('尾') || h.includes('last') || h.includes('end')) return 'last-frame';
  if (h.includes('音') || h.includes('audio') || h.includes('sound')) return 'audio';
  return 'reference';
}

// Aliases for route imports
export type DirectorInput = DirectorCompileInput;
export type DirectorResult = DirectorCompileResult;
// Compatibility alias: buildDirectorPrompt returns system/user messages
// The actual LLM call is performed in the API route; see /api/video/director/prompt
export function compileDirectorPrompt(input: DirectorCompileInput) {
  return {
    system: VIDEO_DIRECTOR_SYSTEM_PROMPT,
    user: buildDirectorUserMessage(input),
    input,
  };
}

/** Alias for older code */
export const buildDirectorPrompt = compileDirectorPrompt;
/** Back-compat type alias */
export type VideoDirectorModeAlias = VideoDirectorMode;
/** Field alias so routes can read .prompt/.negative/.mode after LLM call */
export interface CompiledDirectorPromptBundle {
  prompt: string;
  negative?: string;
  mode: VideoDirectorMode;
  contract?: VideoShotContract;
  endState?: string;
  firstFrameSuggestion?: string;
  lastFrameSuggestion?: string;
}
export function bundleCompiledPrompt(input: DirectorCompileInput, parsed: DirectorCompileResult): CompiledDirectorPromptBundle {
  return {
    prompt: parsed.prompt,
    negative: parsed.negativePrompt,
    mode: input.mode,
    contract: parsed.contract,
    endState: parsed.contract?.endState,
    firstFrameSuggestion: parsed.firstFrameSuggestion,
    lastFrameSuggestion: parsed.lastFrameSuggestion,
  };
}

/** 解析导演返回的多行文本为 DirectorCompileResult */
export function parseDirectorResponse(text: string): DirectorCompileResult {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let prompt = '';
  let negativePrompt: string | undefined;
  let intention = '';
  let shotRaw = '';
  let endState = '';
  for (const line of lines) {
    if (line.startsWith('NEGATIVE:')) {
      negativePrompt = line.slice('NEGATIVE:'.length).trim();
      if (negativePrompt === '->' || negativePrompt === '-') negativePrompt = undefined;
    } else if (line.startsWith('INTENTION:')) {
      intention = line.slice('INTENTION:'.length).trim();
    } else if (line.startsWith('SHOT:')) {
      shotRaw = line.slice('SHOT:'.length).trim();
    } else if (line.startsWith('END_STATE:')) {
      endState = line.slice('END_STATE:'.length).trim();
      if (endState === '->' || endState === '-') endState = '';
    } else if (!prompt) {
      prompt = line;
    } else {
      prompt += ' ' + line;
    }
  }
  const parts = shotRaw.split(',').map(s => s.trim()).filter(Boolean);
  const contract: VideoShotContract = { intention: intention || prompt.slice(0, 20) };
  if (parts[0]) contract.shotSize = parts[0] as ShotSize;
  if (parts[1]) contract.cameraMovement = parts[1] as CameraMovement;
  if (parts[2]) contract.lighting = parts[2] as LightingStyle;
  if (parts[3]) contract.tone = parts[3] as ToneStyle;
  if (endState) contract.endState = endState;
  return { prompt, negativePrompt, contract, lastFrameSuggestion: endState || undefined };
}
