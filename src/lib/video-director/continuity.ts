// 连续性模块：多镜头续写状态管理、分镜计划 AI 解析
import type { DirectorStyle } from './prompt-compiler';
import type {
  CameraControlParams as VideoCameraControlParams,
  MotionBrushParams as VideoMotionBrushParams,
  MotionTrajectory,
} from '../video-api';
import type { VideoReferenceBinding as RefBinding } from './prompt-compiler';
import type { FailureDiagnosis } from './retake-diagnosis';

type JsonRecord = Record<string, unknown>;

function asJsonRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asJsonRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asJsonRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function parseJsonObject(text: string): JsonRecord {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) return {};
  try {
    return asJsonRecord(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return {};
  }
}

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
  /** 该镜头的拍摄环境/场景描述（供场景图生成使用） */
  setting?: string;
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
  // 制片流水线引用（指向本镜头出现的角色和主场景）
  characterIds?: string[]; // ShotCharacter.id[]
  sceneId?: string; // ShotScene.id
  propIds?: string[]; // 镜头中出现的关键道具 id 列表
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

export interface VideoCharacter {
  id: string;
  name: string;
  role?: string; // 角色定位：主角/配角/反派...
  age?: string;
  gender?: string;
  ethnicity?: string;
  style?: string;
  /** 外观整体描述（外貌/脸型/发型/气质等关键词），别名：looks/appearance/description */
  appearance: string;
  costume?: string; // 服装，别名：outfit/clothing
  hair?: string; // 发型
  accessories?: string; // 配饰
  expression?: string; // 默认表情
  /** 正面定妆照提示词（英文逗号分隔），别名：frontPrompt/frontImagePrompt */
  frontPrompt?: string;
  /** 侧面定妆照提示词（英文逗号分隔），别名：sidePrompt/sideImagePrompt */
  sidePrompt?: string;
  /** @deprecated 兼容旧字段，使用 frontPrompt */
  visualPrompt?: string;
  /** 3-5 个外观关键词标签 */
  keywords?: string[];
  /** 正面定妆照 URL（兼容 frontUrl / imageUrlFront） */
  imageUrlFront?: string;
  /** 侧面定妆照 URL（兼容 sideUrl / imageUrlSide） */
  imageUrlSide?: string;
  /** @deprecated 使用 imageUrlFront */
  frontUrl?: string;
  /** @deprecated 使用 imageUrlSide */
  sideUrl?: string;
  /** @deprecated 使用 imageUrlFront */
  frontImageUrl?: string;
  /** @deprecated 使用 imageUrlSide */
  sideImageUrl?: string;
  /** 运行时状态 */
  status?: 'pending' | 'generating' | 'completed' | 'failed';
  generating?: boolean;
  /** @deprecated 使用 status */
  generateStatus?: 'pending' | 'generating' | 'completed' | 'failed';
  error?: string;
  /** 关联到的镜头 ID 列表 */
  forShotIds?: string[];
}

export interface VideoScene {
  id: string;
  shotId?: string; // 关联到哪个镜头（一个场景可对应一镜）
  /** @deprecated */
  forShotIds?: Array<string | number>;
  name: string; // 场景名，如"咖啡馆内景日"
  description?: string; // 场景详细描述
  location?: string;
  timeOfDay?: string;
  weather?: string;
  lighting?: string;
  mood?: string;
  colorPalette?: string;
  keyProps?: string; // 关键道具
  /** 3-5 个场景关键词标签 */
  keywords?: string[];
  /** 场景氛围图提示词（英文逗号分隔），别名：scenePrompt/sceneImagePrompt/environmentPrompt */
  scenePrompt?: string;
  /** @deprecated 兼容旧字段 */
  visualPrompt?: string;
  /** @deprecated 兼容旧字段（lightingHint） */
  lightingHint?: string;
  /** 生成后的场景图 URL */
  imageUrl?: string;
  /** 运行时状态 */
  status?: 'pending' | 'generating' | 'completed' | 'failed';
  generating?: boolean;
  /** @deprecated 使用 status */
  generateStatus?: 'pending' | 'generating' | 'completed' | 'failed';
  error?: string;
}

/** 道具资产：用于生成道具设定图，作为镜头参考 */
export interface VideoProp {
  id: string;
  name: string;
  role?: string; // 在故事里的作用（信物/武器/日常物件等）
  /** 道具类别：weapon/tool/accessory/document/food/vehicle/electronic/decor/misc */
  category?: string;
  description?: string; // 外观/材质/细节描述
  material?: string;
  color?: string;
  scale?: string; // 尺寸/相对人物大小
  /** 3-5 个道具关键词标签 */
  keywords?: string[];
  /** 道具设定图提示词 */
  propPrompt?: string;
  /** 生成后的道具图 URL */
  imageUrl?: string;
  /** 所属镜头 ID 列表 */
  forShotIds?: string[];
  /** 所属场景 ID */
  sceneId?: string;
  /** 运行时状态 */
  status?: 'pending' | 'generating' | 'completed' | 'failed';
  generating?: boolean;
  error?: string;
}

export interface ShotPlanInput {
  storyIdea: string;
  shotCount?: number; // 默认 3-5
  duration?: number;
  aspectRatio?: string;
  style?: DirectorStyle;
  characters?: string;
  setting?: string;
  model?: string;
  withAssets?: boolean; // 是否额外生成 characters[] + scenes[] 设计稿
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

export function buildShotPlanSystemPrompt(
  styleOrDuration?: DirectorStyle | number,
  shotCountOrStyle?: number | DirectorStyle,
  styleOrAspect?: DirectorStyle | string,
  aspectRatioOrNothing?: string,
): string {
  // 兼容两种调用：(style) 或 (duration, shotCount, style, aspectRatio)
  let duration = 10, shotCount = 5, style: DirectorStyle = 'cinematic', aspectRatio = '16:9';
  if (typeof styleOrDuration === 'number') {
    duration = styleOrDuration;
    if (typeof shotCountOrStyle === 'number') shotCount = shotCountOrStyle;
    if (typeof styleOrAspect === 'string' && (styleOrAspect in SHOT_PLAN_STYLE_DESC)) style = styleOrAspect as DirectorStyle;
    else if (typeof styleOrAspect === 'string') aspectRatio = styleOrAspect;
    if (typeof aspectRatioOrNothing === 'string') aspectRatio = aspectRatioOrNothing;
  } else if (typeof styleOrDuration === 'string') {
    style = styleOrDuration as DirectorStyle;
  }
  const nShots = Math.max(2, Math.min(10, shotCount || Math.min(6, Math.ceil((duration || 10) / 4))));
  const styleDesc = SHOT_PLAN_STYLE_DESC[style] || SHOT_PLAN_STYLE_DESC.cinematic;
  return `你是一名资深视频导演和分镜师，将用户的故事梗概拆解成结构化的多镜头计划。

要求：
1. 基于故事梗概拆出 ${nShots} 个镜头（总时长约 ${duration} 秒，单镜头 3-8 秒），每镜头聚焦一个动作节拍，避免在一个镜头里塞满多个动作。画面比例 ${aspectRatio}。
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

7. 必须同时从故事中提取「角色资产」「场景资产」「道具资产」，用于后续 AI 自动生成角色定妆照、场景氛围图和道具设定图：
   - characters[]：故事中出现的**有名有姓或有明确外形特征**的人物/角色，每个包含：
     * id：简短英文标识（如 hero/girl/oldman），仅用英文+数字+下划线
     * name：角色名或身份（如"穿风衣的男人"/"红衣少女"）
     * age：大致年龄或年龄段
     * gender：性别（男/女/中性/不限）
     * appearance：人物外观整体描述（发型/脸型/体型/肤色/气质，50-100字）
     * costume：服装造型（款式/颜色/风格）
     * hair：发型（颜色/长度/造型）
     * accessories：配饰（如项链/帽子/眼镜/手表/武器等）
     * keywords：3-5 个外观关键词标签数组
   - scenes[]：故事涉及的**不同物理场景**（合并相似场景，比如"咖啡馆室内"出现多次只算一个），每个包含：
     * id：简短英文标识（如 street_night/cafe_interior/beach_sunset）
     * name：场景名（6字以内）
     * location：地点
     * timeOfDay：时间（清晨/白天/黄昏/夜晚等）
     * weather：天气（晴/阴/雨/雪/雾等）
     * lighting：光线描述（自然光/侧逆光/霓虹/柔光窗光等）
     * mood：整体氛围关键词（2-4字）
     * colorPalette：色调/色板
     * keyProps：该场景里出现的关键道具（逗号分隔）
     * description：场景整体氛围描述（50-100字）
   - props[]：故事中**推动剧情或反复出现**的关键道具/物品（合并重复，如信件/钥匙/戒指/武器/手机/特殊物件），每个包含：
     * id：简短英文标识（如 letter/key/ring）
     * name：道具名（4字以内）
     * role：道具在故事中的作用/意义
     * material：材质（木/金属/皮革/玻璃等）
     * color：颜色
     * scale：相对尺寸（手持/桌面/大型等）
     * description：外观细节描述（30-80字）
     * sceneId：所属场景 id（可选）
     * shotIds：出现的镜头 id 数组（可选）
   若故事没有明确人物（纯风景/空镜），characters 返回 []；若故事只有一个场景，scenes 也只返回一个；若没有特殊道具，props 返回 []。
   characters/scenes/props 中的 id 必须与镜头里出现的角色/场景/道具对应。

输出 JSON 结构：
{
  "characters": [
    {
      "id": string,
      "name": string,
      "age": string,
      "gender": string,
      "appearance": string,
      "costume": string,
      "hair": string,
      "accessories": string,
      "keywords": string[]
    }
  ],
  "scenes": [
    {
      "id": string,
      "name": string,
      "location": string,
      "timeOfDay": string,
      "weather": string,
      "lighting": string,
      "mood": string,
      "colorPalette": string,
      "keyProps": string,
      "description": string
    }
  ],
  "props": [
    {
      "id": string,
      "name": string,
      "role": string,
      "material": string,
      "color": string,
      "scale": string,
      "description": string,
      "sceneId": string,
      "shotIds": string[]
    }
  ],
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
      "continuityNotes": string[],
      "characterIds": string[],
      "sceneId": string,
      "propIds": string[]
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
  if (!cleaned.includes('{')) return [];
  try {
    const obj = parseJsonObject(cleaned);
    const shots = asJsonRecords(obj.shots);
    return shots.map((s, i) =>
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
        continuityNotes: asStrings(s.continuityNotes),
        firstFrameFromPrev: i > 0,
        status: 'planned',
      }),
    );
  } catch {
    return [];
  }
}

export interface ShotPlanResult {
  shots: VideoShotPlan[];
  characters: VideoCharacter[];
  scenes: VideoScene[];
  props: VideoProp[];
  totalDuration: number;
}

/** 从分镜 LLM 响应中一次性解析出 shots + characters + scenes + props */
export function parseShotPlanFullResponse(text: string, defaultDuration = 5, defaultAspectRatio = '16:9'): ShotPlanResult {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const obj = parseJsonObject(cleaned);
  const rawShots = asJsonRecords(obj.shots);
  const ts = Date.now();
  const shots: VideoShotPlan[] = rawShots.map((s, i) =>
    initShotFromPlan({
      id: `shot-${ts}-${i}`,
      index: i,
      title: String(s.title ?? `镜头 ${i + 1}`).slice(0, 20),
      purpose: String(s.purpose ?? ''),
      shotSize: String(s.shotSize ?? 'medium'),
      cameraMotion: String(s.cameraMotion ?? s.cameraMove ?? 'static'),
      cameraMove: String(s.cameraMove ?? s.cameraMotion ?? 'static'),
      actionBeat: String(s.actionBeat ?? ''),
      lighting: String(s.lighting ?? ''),
      audioCues: String(s.audioCues ?? ''),
      prompt: String(s.prompt ?? ''),
      duration: Number(s.duration) || defaultDuration,
      aspectRatio: String(s.aspectRatio ?? defaultAspectRatio),
      setting: String(s.setting ?? s.location ?? s.scene ?? ''),
      continuityNotes: asStrings(s.continuityNotes),
      characterIds: asStrings(s.characterIds),
      sceneId: s.sceneId != null ? String(s.sceneId) : undefined,
      firstFrameFromPrev: i > 0,
      status: 'planned',
    }),
  );
  const characters = parseShotPlanCharactersFromObj(obj, ts);
  const scenes = parseShotPlanScenesFromObj(obj, shots, ts);
  const props = parseShotPlanPropsFromObj(obj, shots, ts);
  // 回填 shots 里的 characterIds/sceneId/propIds 名称索引
  const charIds = new Set(characters.map(c => c.id));
  const sceneIds = new Set(scenes.map(s => s.id));
  shots.forEach(sh => {
    if (sh.characterIds) sh.characterIds = sh.characterIds.filter(id => charIds.has(id));
    if (sh.sceneId && !sceneIds.has(sh.sceneId)) sh.sceneId = undefined;
  });
  const totalDuration = shots.reduce((a, s) => a + (Number(s.duration) || defaultDuration), 0);
  return { shots, characters, scenes, props, totalDuration };
}

/** 从分镜 LLM 响应中解析角色列表（兼容旧版：appearancePrompt/visualPrompt 等别名） */
export function parseShotPlanCharacters(text: string): VideoCharacter[] {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) return [];
  try {
    const obj = parseJsonObject(cleaned);
    return parseShotPlanCharactersFromObj(obj, Date.now());
  } catch {
    return [];
  }
}

function parseShotPlanCharactersFromObj(obj: JsonRecord, ts: number): VideoCharacter[] {
  const arr = asJsonRecords(obj.characters);
  return arr.map((c, i) => {
    const appearance = String(
      c.appearance ?? c.looks ?? c.appearancePrompt ?? c.visualPrompt ?? c.description ?? ''
    );
    const costume = String(c.costume ?? c.outfit ?? c.clothing ?? '');
    const hair = String(c.hair ?? c.hairstyle ?? '');
    const accessories = String(c.accessories ?? c.accessory ?? '');
    const baseFront = [c.age, c.gender, appearance, costume, hair].filter(Boolean).join(', ');
    const frontPrompt = String(
      c.frontPrompt ?? c.frontImagePrompt ?? `character design reference sheet, ${baseFront}, front view, neutral pose, pure white background, studio lighting, high detail, sharp focus, no text, no watermark`,
    );
    const sidePrompt = String(
      c.sidePrompt ?? c.sideImagePrompt ?? `character design reference sheet, ${baseFront}, side view, neutral pose, pure white background, studio lighting, high detail, sharp focus, no text, no watermark`,
    );
    const keywords = asStrings(c.keywords).slice(0, 8);
    return {
      id: String(c.id ?? `char-${ts}-${i}`),
      name: String(c.name ?? `角色${i + 1}`).slice(0, 20),
      role: String(c.role ?? ''),
      age: String(c.age ?? ''),
      gender: String(c.gender ?? ''),
      ethnicity: String(c.ethnicity ?? ''),
      style: String(c.style ?? ''),
      appearance,
      costume,
      hair,
      accessories,
      expression: String(c.expression ?? ''),
      frontPrompt,
      sidePrompt,
      keywords,
      imageUrlFront: String(c.frontImageUrl ?? c.imageUrlFront ?? c.frontUrl ?? ''),
      imageUrlSide: String(c.sideImageUrl ?? c.imageUrlSide ?? c.sideUrl ?? ''),
      status: (c.imageUrlFront || c.frontImageUrl) ? 'completed' : 'pending',
      error: undefined,
    };
  });
}

/** 从分镜 LLM 响应中解析场景列表（兼容旧版） */
export function parseShotPlanScenes(text: string, shots: VideoShotPlan[]): VideoScene[] {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const obj = parseJsonObject(cleaned);
  return parseShotPlanScenesFromObj(obj, shots, Date.now());
}

function parseShotPlanScenesFromObj(obj: JsonRecord, shots: VideoShotPlan[], ts: number): VideoScene[] {
  const parsed: JsonRecord[] = asJsonRecords(obj.scenes);
  // 若 LLM 没返回 scenes，根据 shots 自动派生
  if (parsed.length === 0 && shots.length > 0) {
    const seen = new Set<string>();
    shots.forEach((s, i) => {
      const key = String(s.setting || s.lighting || s.prompt || '').slice(0, 20);
      if (seen.has(key)) return;
      seen.add(key);
      parsed.push({
        id: `scene-${ts}-${i}`,
        name: s.title || `场景${i + 1}`,
        location: s.setting || '',
        timeOfDay: s.lighting || '',
        mood: '',
        description: s.prompt,
        forShotIds: [s.id],
      });
    });
  }
  return parsed.map((s, i) => {
    const description = String(s.description ?? s.desc ?? '');
    const location = String(s.location ?? s.place ?? s.setting ?? '');
    const lighting = String(s.lighting ?? s.lightingHint ?? '');
    const mood = String(s.mood ?? '');
    const baseScene = [location, s.timeOfDay, s.weather, lighting, mood, description].filter(Boolean).join(', ');
    const scenePrompt = String(
      s.scenePrompt ?? s.environmentPrompt ?? s.sceneImagePrompt ?? s.visualPrompt ??
      (baseScene ? `cinematic establishing shot, ${baseScene}, wide angle, atmospheric, high detail, movie still, no text, no watermark, sharp focus` : ''),
    );
    let forShotIds: Array<string | number> = [];
    if (Array.isArray(s.forShotIds)) forShotIds = s.forShotIds.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
    else if (typeof s.shotIndex === 'string' || typeof s.shotIndex === 'number') forShotIds = [s.shotIndex];
    return {
      id: String(s.id ?? `scene-${ts}-${i}`),
      shotId: s.shotId != null ? String(s.shotId) : undefined,
      forShotIds,
      name: String(s.name ?? `场景${i + 1}`).slice(0, 30),
      description,
      location,
      timeOfDay: String(s.timeOfDay ?? ''),
      weather: String(s.weather ?? ''),
      lighting,
      mood,
      colorPalette: String(s.colorPalette ?? ''),
      keyProps: String(s.keyProps ?? ''),
      scenePrompt,
      imageUrl: String(s.imageUrl ?? s.sceneImageUrl ?? ''),
      status: s.imageUrl ? 'completed' : 'pending',
      error: undefined,
    };
  });
}

/** 从分镜 LLM 响应中解析道具列表 */
export function parseShotPlanProps(text: string, shots: VideoShotPlan[]): VideoProp[] {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const obj = parseJsonObject(cleaned);
  return parseShotPlanPropsFromObj(obj, shots, Date.now());
}

function parseShotPlanPropsFromObj(obj: JsonRecord, shots: VideoShotPlan[], ts: number): VideoProp[] {
  const arr: JsonRecord[] = asJsonRecords(obj.props);
  // 从 scenes[].keyProps 派生兜底 props
  if (arr.length === 0) {
    const seen = new Set<string>();
    asJsonRecords(obj.scenes).forEach((sc, sIdx) => {
      const kp = String(sc.keyProps ?? '').trim();
      if (!kp) return;
      kp.split(/[,，、;；/]/).map(x => x.trim()).filter(Boolean).forEach((name, i) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        arr.push({
          id: `prop-${ts}-${sIdx}-${i}`,
          name,
          role: `${sc.name || '场景'}中的关键道具`,
          material: '',
          color: '',
          scale: '手持',
          description: `${name}，${sc.name || '场景'}中出现的重要物件`,
          sceneId: sc.id,
        });
      });
    });
  }
  return arr.map((p, i) => {
    const description = String(p.description ?? p.desc ?? '');
    const material = String(p.material ?? '');
    const color = String(p.color ?? '');
    const scale = String(p.scale ?? '');
    const base = [p.name, material, color, description].filter(Boolean).join(', ');
    const propPrompt = String(
      p.propPrompt ?? p.imagePrompt ??
      (base ? `object design sheet, isolated prop, ${base}, clear silhouette, studio lighting, white background, high detail, no text, no watermark, sharp focus` : ''),
    );
    const forShotIds = asStrings(p.shotIds).length > 0 ? asStrings(p.shotIds) : asStrings(p.forShotIds);
    return {
      id: String(p.id ?? `prop-${ts}-${i}`),
      name: String(p.name ?? `道具${i + 1}`).slice(0, 20),
      role: String(p.role ?? ''),
      description,
      material,
      color,
      scale,
      propPrompt,
      imageUrl: String(p.imageUrl ?? ''),
      forShotIds,
      sceneId: p.sceneId != null ? String(p.sceneId) : undefined,
      status: p.imageUrl ? 'completed' : 'pending',
      error: undefined,
    };
  });
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

// === 制片资产生成 Planner（/api/story-assets/plan） ===

export interface StoryAssetsPlanRequest {
  storyIdea: string;
  shots: VideoShotPlan[];
  characters?: VideoCharacter[];
  scenes?: VideoScene[];
  props?: VideoProp[];
  style?: DirectorStyle;
  aspectRatio?: string;
}

export interface StoryAssetGenTask {
  id: string;
  type: 'character-front' | 'character-side' | 'scene' | 'prop';
  name: string;
  targetId?: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  referenceUrls?: string[];
}

export interface StoryAssetsPlanResult {
  prompts: StoryAssetGenTask[];
  totalImages: number;
}

export function buildStoryAssetsPrompt(req: StoryAssetsPlanRequest): string {
  const { storyIdea, shots, characters = [], scenes = [], props = [], style = 'cinematic' } = req;
  const styleDesc = SHOT_PLAN_STYLE_DESC[style] || SHOT_PLAN_STYLE_DESC.cinematic;
  return `你是电影美术指导与制片资产生成顾问。根据故事梗概、分镜、已有角色/场景/道具清单，输出需要用 AI 图像生成的资产任务列表（prompts[]）。

【故事梗概】
${storyIdea}

【风格要求】${styleDesc}

【已有分镜】
${JSON.stringify(shots.map(s => ({
  id: s.id, title: s.title, prompt: s.prompt, shotSize: s.shotSize,
  cameraMotion: s.cameraMotion, setting: s.setting, lighting: s.lighting, characterIds: s.characterIds, sceneId: s.sceneId, propIds: s.propIds,
})), null, 2)}

【已有角色（缺 imageUrlFront / imageUrlSide 的需要生成）】
${JSON.stringify(characters.map(c => ({
  id: c.id, name: c.name, age: c.age, gender: c.gender, appearance: c.appearance,
  costume: c.costume, hair: c.hair, accessories: c.accessories, keywords: c.keywords,
  imageUrlFront: c.imageUrlFront, imageUrlSide: c.imageUrlSide,
})), null, 2)}

【已有场景（缺 imageUrl 的需要生成）】
${JSON.stringify(scenes.map(s => ({
  id: s.id, name: s.name, location: s.location, timeOfDay: s.timeOfDay, weather: s.weather,
  lighting: s.lighting, mood: s.mood, keywords: s.keywords, imageUrl: s.imageUrl,
})), null, 2)}

【已有道具（缺 imageUrl 的需要生成）】
${JSON.stringify(props.map(p => ({
  id: p.id, name: p.name, category: p.category, description: p.description,
  material: p.material, color: p.color, keywords: p.keywords, imageUrl: p.imageUrl,
})), null, 2)}

【输出要求】
请严格输出单个 JSON（不要 markdown 包裹、不要解释）：
{
  "prompts": [
    {
      "id": "char-xxx-front",
      "type": "character-front | character-side | scene | prop",
      "name": "显示名",
      "targetId": "关联的角色/场景/道具 id（场景/道具/角色必填）",
      "prompt": "英文逗号分隔关键词，适合 text-to-image 模型，画面描述具体、风格明确。character-front 必须包含 front view, neutral pose, white studio background, character reference sheet；character-side 必须包含 side view/profile, same outfit, white background；scene 必须包含 cinematic establishing shot, wide angle, atmospheric, movie still, no people；prop 必须包含 product photography, white background, three-quarter view, studio lighting",
      "negativePrompt": "可选，英文逗号分隔",
      "aspectRatio": "1:1（角色/道具）或 16:9（场景）",
      "referenceUrls": []
    }
  ]
}

规则：
1. 只为 imageUrlFront/imageUrlSide/imageUrl 缺失的角色/场景/道具生成任务；已有 URL 的跳过。
2. 每个缺图角色出 2 条任务（front + side），每个缺图场景 1 条，每个缺图道具 1 条。
3. prompt 必须是**英文**，50-120 个关键词，风格、光线、画质、镜头构图都要明确；禁止出现文字/水印/模糊/变形。
4. negativePrompt 默认填入 "low quality, blurry, deformed, distorted, extra limbs, bad anatomy, text, watermark, logo, signature"。
5. 角色 prompt 必须包含服装+发型+年龄+性别+配饰+表情等一致性信息；场景 prompt 必须包含地点+时间+天气+光线+氛围；道具 prompt 必须包含材质+颜色+形状+风格。
6. 不要输出任何 assets 数组以外的字段，totalImages 由调用方统计。`;
}

export function parseStoryAssetsResponse(text: string): StoryAssetsPlanResult {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const obj = parseJsonObject(cleaned);
  const arr = asJsonRecords(obj.prompts);
  const prompts: StoryAssetGenTask[] = arr.map((p, i) => ({
    id: String(p.id ?? `asset-${Date.now()}-${i}`),
    type: (['character-front', 'character-side', 'scene', 'prop'].includes(String(p.type)) ? String(p.type) : 'prop') as StoryAssetGenTask['type'],
    name: String(p.name ?? `资产${i + 1}`),
    targetId: p.targetId != null ? String(p.targetId) : undefined,
    prompt: String(p.prompt ?? ''),
    negativePrompt: p.negativePrompt != null ? String(p.negativePrompt) : undefined,
    aspectRatio: p.aspectRatio != null ? String(p.aspectRatio) : undefined,
    referenceUrls: asStrings(p.referenceUrls),
  })).filter(t => t.prompt.length > 5);
  return { prompts, totalImages: prompts.length };
}
