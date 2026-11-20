// Work mode (ported from stable 5881d433, reworked): the model gets a fixed plan and answers
// step by step under `## 步骤 n · 标题` headings. Progress is read from those headings in the
// streamed text, so the card only shows steps the model actually reached. There is no approval
// gate: simple chat has no irreversible tools, and the prompt tells the model to ask instead.

export type WorkMode = 'chat' | 'work';

export interface WorkPlanStep {
  id: string;
  title: string;
}

export interface WorkPlan {
  goal: string;
  deliverable: string;
  steps: WorkPlanStep[];
}

export type WorkPlanStepStatus = 'done' | 'running' | 'pending' | 'skipped';

export interface WorkPlanProgress {
  statuses: WorkPlanStepStatus[];
  /** 1-based index of the step being written, 0 when none has started. */
  current: number;
  finished: boolean;
}

const MAX_GOAL_LENGTH = 500;
const MAX_TITLE_LENGTH = 40;
const MAX_STEPS = 8;
const STEP_TITLES = ['明确目标与交付物', '收集并核验资料', '分步执行', '整理可复核成果'];

export function normalizeWorkMode(value: unknown): WorkMode {
  return value === 'work' ? 'work' : 'chat';
}

export function buildWorkPlan(goal: string): WorkPlan {
  const text = goal.trim().slice(0, MAX_GOAL_LENGTH);
  return {
    goal: text,
    deliverable: inferDeliverable(text),
    steps: STEP_TITLES.map((title, index) => ({ id: `step-${index + 1}`, title })),
  };
}

export function buildWorkModeInstructions(plan: WorkPlan): string {
  return [
    '## 工作模式',
    '用户开启了工作模式：这是一项多步骤工作，需要交付完整成果，而不是简短闲聊。',
    `目标：${plan.goal || '见用户最后一条消息'}`,
    `交付物：${plan.deliverable}`,
    '按下面的步骤依次作答，每一步用二级标题开头，标题格式必须是「## 步骤 n · 步骤名」：',
    ...plan.steps.map((step, index) => `## 步骤 ${index + 1} · ${step.title}`),
    '要求：',
    '- 任务简单时每一步可以很短，但标题不要省略，也不要改名。',
    '- 信息不足以完成任务时，在第 1 步列出需要用户补充的内容，然后停下来等用户回复。',
    '- 不要声称已经执行了支付、删除、发布、发送等操作；需要这类操作时，写明步骤并请用户自己确认执行。',
    '- 最后一步给出可以直接使用的成果，并对照目标检查是否完整。',
  ].join('\n');
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

/** Validates a plan from the stream or from synced project data; null when malformed. */
export function readWorkPlan(value: unknown): WorkPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const goal = typeof record.goal === 'string' && record.goal.length <= MAX_GOAL_LENGTH ? record.goal : null;
  const deliverable = boundedText(record.deliverable, MAX_TITLE_LENGTH);
  if (goal === null || !deliverable || !Array.isArray(record.steps)) return null;
  if (record.steps.length === 0 || record.steps.length > MAX_STEPS) return null;
  const steps: WorkPlanStep[] = [];
  for (const step of record.steps) {
    if (!step || typeof step !== 'object') return null;
    const id = boundedText((step as Record<string, unknown>).id, MAX_TITLE_LENGTH);
    const title = boundedText((step as Record<string, unknown>).title, MAX_TITLE_LENGTH);
    if (!id || !title) return null;
    steps.push({ id, title });
  }
  return { goal, deliverable, steps };
}

/**
 * Which steps the reply has reached, from its `## 步骤 n` headings. While streaming, the last
 * heading seen is running and earlier ones are done. Once finished, a step jumped over before
 * the last heading is skipped, and steps after it stay pending: the model may have stopped to
 * ask the user for more information.
 */
export function deriveWorkPlanProgress(plan: WorkPlan, content: string, finished: boolean): WorkPlanProgress {
  const seen = new Set<number>();
  for (const match of content.matchAll(/^#{1,4}\s*步骤\s*(\d{1,2})\b/gm)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= plan.steps.length) seen.add(index);
  }
  const current = seen.size > 0 ? Math.max(...seen) : 0;
  const statuses = plan.steps.map((_, offset): WorkPlanStepStatus => {
    const index = offset + 1;
    if (finished) return seen.has(index) ? 'done' : index < current ? 'skipped' : 'pending';
    if (current === 0) return index === 1 ? 'running' : 'pending';
    if (index === current) return 'running';
    if (index < current) return seen.has(index) ? 'done' : 'skipped';
    return 'pending';
  });
  return { statuses, current: finished ? current : Math.max(current, 1), finished };
}

function inferDeliverable(goal: string): string {
  if (/表格|excel|csv/i.test(goal)) return '结构化表格';
  if (/演示|ppt|幻灯/i.test(goal)) return '演示文稿大纲与页面内容';
  if (/网站|网页|页面/i.test(goal)) return '可实现的网页方案';
  if (/报告|研究|分析|调研/i.test(goal)) return '带依据的结构化报告';
  if (/方案|计划|策划|规划/i.test(goal)) return '可执行的方案';
  if (/文案|脚本|剧本|文章/i.test(goal)) return '可直接使用的文稿';
  return '完整的文本成果';
}
