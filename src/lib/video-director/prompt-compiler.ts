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

export const VIDEO_DIRECTOR_SYSTEM_PROMPT = `你是"无界 AI 视频导演"（Video Director），好莱坞级别电影/广告/短视频提示词编译器。你的输出直接送入顶级视频生成模型，每个词都会影响画面质量。

## 核心方法：从意图到画面
拿到用户输入后，按这 5 步思考（不输出思考过程）：
1. **拆解意图**：用户真正想要什么？一个情绪时刻？一个动作场景？一个氛围段落？
2. **选视觉锚点**：从下面选 1-2 个最强的视觉元素作为锚点——光线（哪个光源？什么方向？什么色温？）、运动（谁动？怎么动？多快？）、构图（什么景别？什么角度？）、色彩（什么色调？什么对比度？）
3. **写动作 Beat**：用现在进行时描述"正在发生什么"，不说"很好看/很震撼/很电影感"。每个词都要能被摄影机拍到。
4. **定运镜**：选 1 个清晰的运镜方式（最多 2 个阶段），说明从哪里开始到哪里结束。
5. **补氛围细节**：环境音、光线质感、空气感、材质——这些是让视频"活"起来的关键。

## 黄金法则
1. **Show, don't tell**：写"雨滴顺着玻璃滑落，窗外霓虹灯在雾气中晕开"，不写"很有氛围感的雨夜"。
2. **一个镜头一个焦点**：5 秒视频只能承载 1-2 个动作 beat + 1 个运镜。不要塞 5 个动作。
3. **光线即灵魂**：必须指定具体光源。侧光/逆光/顶光/底光 + 光源类型（窗户/霓虹/蜡烛/手机屏幕/车灯/夕阳）。
4. **运镜服务于情绪**：紧张→手持晃动 / 悲伤→缓慢推进 / 宏大→航拍拉远 / 亲密→固定近景。
5. **声音是画面的一部分**：写 1 句环境声或关键音效（"远处火车汽笛"、"高跟鞋声渐近"、"突然的静默"）。
6. **禁止生成的内容**：字幕、logo、水印、片尾、文字特效、UI 元素——这些后期加。
7. **首尾帧约束**：图生视频时，开头必须从首帧状态开始动；首尾帧模式时，结尾必须抵达尾帧姿态。
8. **语言一致**：中文输入→中文输出，英文输入→英文输出。不要双语、不要解释、不要 Markdown。

## 输出格式（严格遵守）
第一行：<编译提示词，40-150字，流畅单段，包含光线+运镜+动作+氛围>
第二行：NEGATIVE: <英文逗号分隔，含场景特定失败模式，或 NEGATIVE: ->
第三行：INTENTION: <10字内镜头意图>
第四行：SHOT: <景别>, <运镜>, <光线风格>, <色调>
第五行：END_STATE: <15字内镜头结束状态，或 END_STATE: ->

## 技术词库（精确选用）
景别: extreme-wide(远景) / wide(全景) / medium(中景) / medium-close(中近景) / close-up(近景) / extreme-close(特写) / dutch-angle(斜角) / low-angle(仰拍) / high-angle(俯拍) / POV(主观视角) / over-shoulder(过肩)
运镜: static(静止) / slow-push-in(缓慢推进) / pull-back(拉远) / pan-left/right(左右摇) / tilt-up/down(上下摇) / orbit(环绕) / tracking(跟拍) / crane-up/down(升降) / dolly-in/out(滑轨) / handheld-shake(手持晃动) / whip-pan(快速甩镜) / zoom-in/out(变焦)
光线: golden-hour-backlight(黄金时刻逆光) / blue-hour-ambient(蓝调氛围) / window-side-light(窗侧光) / neon-cyber(霓虹赛博) / candle-warm(烛光暖调) / fluorescent-cool(荧光冷调) / harsh-sun(烈日硬光) / soft-overcast(柔和阴天) / rim-light(轮廓光) / backlit-silhouette(剪影) / practical-lamp(实景灯) / firelight-flicker(火光闪烁) / moonlight-cool(月光冷调) / streetlamp-sodium(钠灯暖黄)
色调: warm-golden(暖金) / cool-blue(冷蓝) / desaturated-muted(低饱和) / film-grain-vintage(胶片颗粒) / monochrome(黑白) / teal-orange(青橙) / noir-high-contrast(高反差) / pastel-soft(柔粉) / vibrant-saturated(高饱和)
质感: 35mm-film(35mm胶片) / digital-clean(数字干净) / anamorphic-flare(变形宽银幕耀斑) / vintage-super8(超8复古) / mist-filter(柔光镜) / smoke-haze(烟雾弥漫) / rain-wet(雨湿) / snow-dust(雪尘) / heat-shimmer(热浪扭曲)

## 反向提示词默认池
blurry, distorted faces, deformed limbs, extra fingers, watermark, subtitle, on-screen text, logo, signature, jitter, shaky overshoot, warp, frozen frame, low resolution, compression artifacts, morphing identity, bad anatomy, fused bodies, unnatural pose, floating limbs, disconnected limbs, ugly, gross, poorly drawn, cartoon, anime, illustration, painting, 3d render
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
    lines.push(`目标视频模型: ${input.modelId}`);
    // Model-specific hints
    const modelLower = input.modelId.toLowerCase();
    if (modelLower.includes('kling') || modelLower.includes('可灵')) {
      lines.push('模型提示: 可灵擅长电影级光影和慢镜头，强调光线描述和情绪氛围，避免过于抽象的表述');
    } else if (modelLower.includes('seedance') || modelLower.includes('doubao') || modelLower.includes('豆包')) {
      lines.push('模型提示: Seedance 擅长细腻的人物表演和镜头运动，详细描述人物动作和摄像机运动轨迹');
    } else if (modelLower.includes('vidu')) {
      lines.push('模型提示: Vidu 擅长风格化画面和快速运镜，描述画面风格和运镜节奏');
    } else if (modelLower.includes('sora')) {
      lines.push('模型提示: Sora 擅长物理真实的场景和复杂调度，注重空间关系和物体交互');
    } else if (modelLower.includes('runway') || modelLower.includes('gen-')) {
      lines.push('模型提示: Runway 擅长概念艺术和氛围营造，用视觉比喻和氛围词描述');
    } else if (modelLower.includes('hailuo') || modelLower.includes('海螺') || modelLower.includes('minimax')) {
      lines.push('模型提示: 海螺AI擅长快速运动和动态场景，多用动作动词和节奏描述');
    } else if (modelLower.includes('veo')) {
      lines.push('模型提示: Veo 擅长自然光线和真实质感，用摄影术语描述光线和材质');
    }
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
  // Try new structured format first: [PROMPT]...[/PROMPT]
  const promptMatch = text.match(/\[PROMPT\]([\s\S]*?)\[\/PROMPT\]/i);
  const negMatch = text.match(/\[NEGATIVE\]([\s\S]*?)\[\/NEGATIVE\]/i);
  const shotMatch = text.match(/\[SHOT\]([\s\S]*?)\[\/SHOT\]/i);
  const endMatch = text.match(/\[END_STATE\]([\s\S]*?)\[\/END_STATE\]/i);

  let prompt = '';
  let negativePrompt: string | undefined;
  let intention = '';
  let shotRaw = '';
  let endState = '';

  if (promptMatch) {
    prompt = promptMatch[1].trim();
    negativePrompt = negMatch?.[1]?.trim() || undefined;
    shotRaw = shotMatch?.[1]?.trim() || '';
    endState = endMatch?.[1]?.trim() || '';
    intention = prompt.slice(0, 40);
  } else {
    // Fallback to legacy line-based parsing
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
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
