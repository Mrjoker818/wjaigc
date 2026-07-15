/**
 * 视频失败诊断与单变量重试 (video-director/retake-diagnosis)
 * 提供失败类型枚举、诊断建议、单变量重试策略
 */

export type VideoFailureType =
  | 'character-distortion'   // 人物变形
  | 'identity-inconsistent' // 角色不一致
  | 'motion-mismatch'       // 动作不符合
  | 'camera-wrong'          // 运镜错误
  | 'flf-discontinuity'     // 首尾帧不连贯
  | 'reference-pollution'   // 参考图污染
  | 'style-drift'           // 风格跑偏
  | 'duration-too-short'    // 时长不足/动作提前结束
  | 'shot-too-busy'         // 镜头过乱/元素过多
  | 'text-watermark'        // 文字/水印异常
  | 'other';

export interface FailureDiagnosis {
  type: VideoFailureType;
  title: string;
  description: string;
  /** 单变量重试建议 */
  retakeSuggestions: Array<{
    label: string;
    /** 要修改的字段和新值 */
    patch: Record<string, unknown>;
    /** 提示词补丁（在原 prompt 前后追加） */
    promptPrepend?: string;
    promptAppend?: string;
    negativeAppend?: string;
  }>;
}

const DIAGNOSIS_MAP: Record<VideoFailureType, FailureDiagnosis> = {
  'character-distortion': {
    type: 'character-distortion',
    title: '人物变形',
    description: '检测到五官/肢体变形，通常是参考图过多或动作跨度过大导致。',
    retakeSuggestions: [
      { label: '缩短动作跨度', patch: { duration: 3 }, promptAppend: '', negativeAppend: 'deformed face, extra limbs, distorted hands' },
      { label: '减少参考图至1张', patch: { maxReferences: 1 } },
      { label: '改为静止+微表情', patch: { motionIntensity: 20 }, promptAppend: '主体保持姿态静止，仅面部微表情变化，缓慢眨眼', negativeAppend: 'fast motion, large gesture' },
    ],
  },
  'identity-inconsistent': {
    type: 'identity-inconsistent',
    title: '角色不一致',
    description: '角色外观在镜头中变化或与参考图差异大。',
    retakeSuggestions: [
      { label: '锁定角色参考图', patch: { lockIdentity: true }, promptPrepend: '锁定人物外观，保持发型/服装/五官与参考图一致。' },
      { label: '缩短时长到5s', patch: { duration: 5 } },
      { label: '改为中近景/近景', patch: { shotSize: 'medium-close' }, promptAppend: '人物居中，中近景' },
    ],
  },
  'motion-mismatch': {
    type: 'motion-mismatch',
    title: '动作不符合',
    description: '生成动作与描述不符，通常是动作 beat 太多或描述不具体。',
    retakeSuggestions: [
      { label: '减少为单个动作 beat', patch: { singleBeat: true }, promptAppend: '动作简化为单一核心动作，无次要动作' },
      { label: '降低运动强度', patch: { motionIntensity: 30 }, promptAppend: '运动幅度减小，动作缓和' },
      { label: '强化动作动词', patch: {}, promptAppend: '' },
    ],
  },
  'camera-wrong': {
    type: 'camera-wrong',
    title: '运镜错误',
    description: '运镜方式或速度与预期不符。',
    retakeSuggestions: [
      { label: '改为静止镜头', patch: { cameraMovement: 'static' }, promptPrepend: '静止镜头，无运镜。' },
      { label: '降低运镜速度', patch: { movementIntensity: 30 }, promptAppend: '运镜非常缓慢、平稳' },
      { label: '使用三脚架稳定性提示', patch: { cameraSupport: 'tripod' }, promptAppend: '三脚架稳定拍摄，无抖动' },
    ],
  },
  'flf-discontinuity': {
    type: 'flf-discontinuity',
    title: '首尾帧不连贯',
    description: '首帧到尾帧的过渡出现跳变、形变或瞬移。',
    retakeSuggestions: [
      { label: '缩短首尾帧差异', patch: {}, promptAppend: '首帧到尾帧过渡自然，动作连贯，无跳变' },
      { label: '减少中间动作', patch: { singleBeat: true }, promptAppend: '首尾之间只有一个核心动作' },
      { label: '关闭尾帧约束', patch: { disableLastFrame: true } },
    ],
  },
  'reference-pollution': {
    type: 'reference-pollution',
    title: '参考图污染',
    description: '参考图内容（背景、人物、物体）污染了生成结果。',
    retakeSuggestions: [
      { label: '明确参考角色', patch: { referenceRoleHint: '仅参考人物外观，忽略背景' }, promptPrepend: '仅参考参考图中人物的外观，忽略背景、服装外的场景元素。' },
      { label: '降低参考权重', patch: { referenceWeight: 0.5 } },
      { label: '使用单张参考图', patch: { maxReferences: 1 } },
    ],
  },
  'style-drift': {
    type: 'style-drift',
    title: '风格跑偏',
    description: '画面风格与预期不符（写实/动漫/色调等）。',
    retakeSuggestions: [
      { label: '强化风格词前置', patch: {}, promptPrepend: '【风格锁定】画面风格为' },
      { label: '添加反向风格词', patch: {}, negativeAppend: 'anime, cartoon, 3d render, painting, illustration' },
    ],
  },
  'duration-too-short': {
    type: 'duration-too-short',
    title: '动作提前结束',
    description: '镜头在设定时长前就静止或结束动作。',
    retakeSuggestions: [
      { label: '缩短到模型支持时长', patch: { duration: 5 } },
      { label: '动作贯穿全段', patch: {}, promptAppend: '动作贯穿整个视频，不在中途停止' },
    ],
  },
  'shot-too-busy': {
    type: 'shot-too-busy',
    title: '镜头元素过多',
    description: '画面元素混乱，主体不突出。',
    retakeSuggestions: [
      { label: '简化到单主体', patch: {}, promptPrepend: '画面只有一个主体，背景简洁。' },
      { label: '改为近景/特写', patch: { shotSize: 'close-up' } },
      { label: '减少视觉刺激', patch: {}, negativeAppend: 'crowded, busy background, multiple subjects, extra objects' },
    ],
  },
  'text-watermark': {
    type: 'text-watermark',
    title: '文字/水印异常',
    description: '画面出现不应有的文字、水印、字幕条。',
    retakeSuggestions: [
      { label: '反向词强化', patch: {}, negativeAppend: 'text, subtitle, watermark, logo, caption, on-screen text, UI overlay' },
      { label: '移除描述中含文字的部分', patch: {}, promptAppend: '画面中没有任何文字、字幕、水印' },
    ],
  },
  'other': {
    type: 'other',
    title: '其他问题',
    description: '未归类问题，建议调整提示词后重试。',
    retakeSuggestions: [
      { label: '降低运动强度重试', patch: { movementIntensity: 40 } },
      { label: '切换到高清质量', patch: { quality: 'pro' } },
    ],
  },
};

export function diagnoseFailure(type: VideoFailureType): FailureDiagnosis {
  return DIAGNOSIS_MAP[type] || DIAGNOSIS_MAP.other;
}

export function listFailureTypes(): Array<{ type: VideoFailureType; title: string; description: string }> {
  return (Object.keys(DIAGNOSIS_MAP) as VideoFailureType[])
    .filter(t => t !== 'other')
    .map(t => ({
      type: t,
      title: DIAGNOSIS_MAP[t].title,
      description: DIAGNOSIS_MAP[t].description,
    }));
}
