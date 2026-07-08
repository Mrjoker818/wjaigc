// 连续性模块：多镜头续写状态管理、分镜计划 AI 解析
import type { DirectorStyle } from './prompt-compiler';
import type {
  CameraControlParams as VideoCameraControlParams,
  MotionBrushParams as VideoMotionBrushParams,
  MotionTrajectory,
} from '../video-api';
import type { VideoReferenceBinding as RefBinding } from './prompt-compiler';
import type { FailureDiagnosis } from './retake-diagnosis';

// 镜头状态
export type ShotStatus = 'planned' | 'submitted' | 'generating' | 'completed' | 'ready' | 'failed' | 'accepted' | 'diagnosing';

// 参考素材绑定（图、视频、音频）—— 复用 prompt-compiler 中的 VideoReferenceBinding
export type { RefBinding as VideoReferenceBinding };

// 兼容旧字段名：前端期望 cameraMove/camera/thumbnailUrl/videoUrl
export interface VideoShotPlan {
  id: string;
  index: number;
  title: string;
  purpose: string; // 戏剧目的（交代/揭示/反转/告别）
  shotSize?: string; // 景别：特写/近景/中景/全景/远景
  /** 别名：cameraMotion */
  cameraMove?: string;
  cameraMotion?: string; // 摄像机运动
  actionBeat: string; // 可见动作节拍
  lighting?: string; // 光线
  audioCues?: string; // 声音提示
  prompt: string; // 用户原始描述
  directedPrompt?: string; // 导演编译后的专业提示词
  camera?: VideoCameraControlParams;
  motion?: VideoMotionBrushParams | null;
  firstFramePrompt?: string;
  lastFramePrompt?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  firstFrameFromPrev?: boolean; // 是否从上一镜头尾帧取首帧
  duration: number;
  aspectRatio: string;
  references: RefBinding[];
  continuityNotes: string[];
  // 运行时结果字段
  videoUrl?: string;
  thumbnailUrl?: string;
  resultVideoUrl?: string;
  resultThumbnailUrl?: string;
  status: ShotStatus;
  taskId?: string; // 当前/最近一次提交的视频任务ID，用于完成回填
  error?: string;
  diagnosis?: Array<{ label?: string; title?: string; description?: string; patch?: Record<string, unknown>; promptAppend?: string; negativeAppend?: string }> | null;
  retakeCount?: number;
  // 上一镜头结尾观察到的状态（用于续写）
  endState?: ShotContinuityState;
}

export interface ShotContinuityState {
  characterPose: string;
  characterExpression: string;
  characterCostume: string;
  sceneState: string;
  lightingState: string;
  cameraFinalPosition: string;
  objectPositions: string[];
  unresolvedActions: string;
  mood: string;
}

// 兼容前端运动笔刷轨迹类型（使用 video-api 的 MotionTrajectory）
export type BrushTrajectory = MotionTrajectory;

export interface ShotPlanInput {
  storyIdea: string;
  shotCount?: number; // 默认 3-5
  duration?: number;
  aspectRatio?: string;
  style?: DirectorStyle;
  characters?: string;
  setting?: string;
  model?: string;
}

// === 多镜头续写状态工具 ===

export function initShotFromPlan(
  plan: Partial<VideoShotPlan> & { id: string; index: number; prompt: string; duration: number; aspectRatio: string },
): VideoShotPlan {
  return {
    id: plan.id,
    index: plan.index,
    title: plan.title ?? `镜头 ${plan.index + 1}`,
    purpose: plan.purpose ?? '',
    shotSize: plan.shotSize ?? 'medium',
    cameraMotion: plan.cameraMotion ?? plan.cameraMove ?? 'static',
    cameraMove: plan.cameraMove ?? plan.cameraMotion ?? 'static',
    actionBeat: plan.actionBeat ?? '',
    lighting: plan.lighting ?? '',
    audioCues: plan.audioCues ?? '',
    prompt: plan.prompt,
    directedPrompt: plan.directedPrompt,
    camera: plan.camera,
    motion: plan.motion ?? null,
    firstFramePrompt: plan.firstFramePrompt,
    lastFramePrompt: plan.lastFramePrompt,
    firstFrameUrl: plan.firstFrameUrl,
    lastFrameUrl: plan.lastFrameUrl,
    firstFrameFromPrev: plan.firstFrameFromPrev ?? plan.index > 0,
    duration: plan.duration,
    aspectRatio: plan.aspectRatio,
    references: plan.references ?? [],
    continuityNotes: plan.continuityNotes ?? [],
    status: plan.status ?? 'planned',
    resultVideoUrl: plan.resultVideoUrl ?? plan.videoUrl,
    resultThumbnailUrl: plan.resultThumbnailUrl ?? plan.thumbnailUrl,
    videoUrl: plan.videoUrl ?? plan.resultVideoUrl,
    thumbnailUrl: plan.thumbnailUrl ?? plan.resultThumbnailUrl,
    error: plan.error,
    diagnosis: plan.diagnosis ?? null,
    retakeCount: plan.retakeCount ?? 0,
    endState: plan.endState,
  };
}

// 基于上一镜头结尾状态，构建下一镜头的首帧描述提示词
export function buildNextShotFirstFramePrompt(prev: VideoShotPlan): string {
  const st = prev.endState;
  if (!st) return '';
  const parts: string[] = [];
  if (st.characterPose) parts.push(`人物姿态：${st.characterPose}`);
  if (st.characterExpression) parts.push(`表情：${st.characterExpression}`);
  if (st.characterCostume) parts.push(`服装：${st.characterCostume}`);
  if (st.sceneState) parts.push(`场景状态：${st.sceneState}`);
  if (st.lightingState) parts.push(`光线：${st.lightingState}`);
  if (st.cameraFinalPosition) parts.push(`机位：${st.cameraFinalPosition}`);
  if (st.objectPositions?.length) parts.push(`道具：${st.objectPositions.join('；')}`);
  if (st.unresolvedActions) parts.push(`未完成动作：${st.unresolvedActions}`);
  if (st.mood) parts.push(`情绪延续：${st.mood}`);
  return parts.join('；');
}

// === 分镜规划 AI 交互消息构建 ===

const SHOT_PLAN_STYLE_DESC: Record<DirectorStyle, string> = {
  cinematic: '电影感叙事，景别清晰、运镜克制、光影写实、声音层次分明。',
  realistic: '写实风格，真实光线、自然表演、贴近生活场景。',
  anime: '二次元/动漫感，色彩饱和、线条清晰、动作略带夸张、表情富有张力。',
  commercial: '广告/产品感，主体为视觉中心、镜头平稳环绕或推进、打光精致、背景简洁。',
  documentary: '纪录片风格，手持真实感、自然光、环境声主导、节奏沉稳。',
  vlog: 'vlog 日常记录感，镜头贴近人物、手持自然、光线明亮、节奏轻快。',
  artistic: '艺术/实验风格，构图大胆、色彩风格化、节奏自由。',
};

export function buildShotPlanSystemPrompt(style: DirectorStyle = 'cinematic'): string {
  const styleDesc = SHOT_PLAN_STYLE_DESC[style] || SHOT_PLAN_STYLE_DESC.cinematic;
  return `你是一名资深视频导演和分镜师，将用户的故事梗概拆解成结构化的多镜头计划。

要求：
1. 基于故事梗概拆出 3~6 个镜头，每镜头聚焦一个动作节拍，避免在一个镜头里塞满多个动作。
2. 每个镜头必须包含：
   - title：镜头标题（8字以内）
   - purpose：戏剧目的（如：建立场景、角色登场、情绪转折、揭示细节、高潮、收尾）
   - shotSize：景别（特写/近景/中景/中近景/全景/远景）
   - cameraMotion：摄像机运动（静止/缓慢推进/拉出/左摇/右摇/上仰/下俯/左环绕/右环绕/跟拍/手持/升降）
   - actionBeat：镜头里观众**能看见**的单一关键动作（不要写心理活动）
   - lighting：光线（自然光/侧逆光/霓虹反射/柔光窗光/顶光硬阴影等）
   - audioCues：声音提示（环境声/对白/音乐/音效方向）
   - prompt：精简的画面描述（中文，20-60字，描述可见动作+环境+光线，不要堆砌形容词）
   - duration：秒数（3/5/8/10）
   - aspectRatio：画面比例（16:9/9:16/1:1/4:3/3:4/21:9）
   - continuityNotes：连续性注意事项数组（角色外观/道具位置/光线方向/运动方向等）
3. 第一个镜头负责建立场景和人物，最后一个镜头做收束。
4. 镜头之间运动方向要连续：比如镜头 1 向右摇，镜头 2 不要突然反向；上一镜头人物朝右走，下一镜头保持方向。
5. 整体风格：${styleDesc}
6. **严格输出 JSON**，不要任何解释文字，不要 markdown 代码块包裹，只输出 JSON 对象。

输出 JSON 结构：
{
  "shots": [
    {
      "title": string,
      "purpose": string,
      "shotSize": string,
      "cameraMotion": string,
      "actionBeat": string,
      "lighting": string,
      "audioCues": string,
      "prompt": string,
      "duration": number,
      "aspectRatio": string,
      "continuityNotes": string[]
    }
  ]
}`;
}

export function buildShotPlanUserMessage(input: ShotPlanInput): string {
  const lines: string[] = [];
  lines.push(`故事梗概：${input.storyIdea}`);
  if (input.characters) lines.push(`角色：${input.characters}`);
  if (input.setting) lines.push(`场景设定：${input.setting}`);
  if (input.duration) lines.push(`单镜头默认时长：${input.duration}秒`);
  if (input.aspectRatio) lines.push(`画面比例：${input.aspectRatio}`);
  if (input.shotCount) lines.push(`期望镜头数：${input.shotCount}`);
  lines.push('请按 system 要求拆分为结构化分镜并输出 JSON。');
  return lines.join('\n');
}

export function parseShotPlanResponse(text: string, defaultDuration = 5, defaultAspectRatio = '16:9'): VideoShotPlan[] {
  // 去除 markdown 代码块
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  // 找到第一个 { 和最后一个 }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) return [];
  const jsonStr = cleaned.slice(start, end + 1);
  try {
    const obj = JSON.parse(jsonStr);
    const shots = Array.isArray(obj) ? obj : obj.shots;
    if (!Array.isArray(shots)) return [];
    return shots.map((s: any, i: number) =>
      initShotFromPlan({
        id: `shot-${Date.now()}-${i}`,
        index: i,
        title: String(s.title ?? `镜头 ${i + 1}`).slice(0, 20),
        purpose: String(s.purpose ?? ''),
        shotSize: String(s.shotSize ?? 'medium'),
        cameraMotion: String(s.cameraMotion ?? 'static'),
        actionBeat: String(s.actionBeat ?? ''),
        lighting: String(s.lighting ?? ''),
        audioCues: String(s.audioCues ?? ''),
        prompt: String(s.prompt ?? ''),
        duration: Number(s.duration) || defaultDuration,
        aspectRatio: String(s.aspectRatio ?? defaultAspectRatio),
        continuityNotes: Array.isArray(s.continuityNotes) ? s.continuityNotes.map((n: any) => String(n)) : [],
        firstFrameFromPrev: i > 0,
        status: 'planned',
      }),
    );
  } catch {
    return [];
  }
}

// === 连续性账本与尾帧续写（保留骨架，供后续扩展） ===

export interface ContinuityLedger {
  projectId?: string;
  shots: VideoShotPlan[];
  globalRefs: RefBinding[];
}

export function createContinuityLedger(): ContinuityLedger {
  return { shots: [], globalRefs: [] };
}

export function recordShotEndState(_shot: VideoShotPlan, _state: ShotContinuityState): VideoShotPlan {
  // 简单占位：未来接入多模态模型自动分析尾帧状态
  return { ..._shot, endState: _state };
}

export function buildContinuationPrompt(prev: VideoShotPlan, nextUserIdea: string): string {
  const parts: string[] = [];
  parts.push('【上一镜头结尾状态】');
  parts.push(buildNextShotFirstFramePrompt(prev) || '（无记录）');
  parts.push('');
  parts.push('【下一镜头需求】');
  parts.push(nextUserIdea);
  parts.push('');
  parts.push('请从首帧衔接上一镜头结尾，保持角色服装/光线/运动方向一致。');
  return parts.join('\n');
}
