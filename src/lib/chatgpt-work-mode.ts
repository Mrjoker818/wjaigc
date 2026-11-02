export type WorkMode = 'chat' | 'work';

export interface WorkPlanStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'needs_approval' | 'failed';
  approvalRequired: boolean;
}

export interface WorkPlan {
  goal: string;
  deliverable: string;
  constraints: string[];
  steps: WorkPlanStep[];
}

const SENSITIVE_ACTION = /支付|转账|删除|覆盖|提交|发送|发布|购买|下单/i;

export function normalizeWorkMode(value: unknown): WorkMode {
  return value === 'work' ? 'work' : 'chat';
}

export function buildWorkPlan(goal: string): WorkPlan {
  const text = goal.trim();
  const approvalRequired = SENSITIVE_ACTION.test(text);
  const steps = ['明确目标与交付物', '收集并核验资料', '分步执行', '整理可复核成果'];
  if (approvalRequired) steps.splice(3, 0, '等待用户批准关键操作');
  return {
    goal: text,
    deliverable: inferDeliverable(text),
    constraints: ['不访问未授权的本地文件', '关键或不可逆操作必须先获得批准'],
    steps: steps.map((title, index) => ({
      id: `step-${index + 1}`,
      title,
      status: index === 0 ? 'running' : title.includes('批准') ? 'needs_approval' : 'pending',
      approvalRequired: title.includes('批准'),
    })),
  };
}

export function buildWorkModeInstructions(plan: WorkPlan): string {
  const steps = plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join('\n');
  return [
    '## ChatGPT 工作模式',
    '你正在执行多步骤工作，而不是一次性闲聊。先按计划推进，再交付完整成果。',
    `目标：${plan.goal}`,
    `交付物：${plan.deliverable}`,
    '执行步骤：',
    steps,
    '约束：',
    ...plan.constraints.map(item => `- ${item}`),
    '进展中说明当前步骤；信息不足时先提问。完成前检查成果是否满足目标和审核标准。',
  ].join('\n');
}

function inferDeliverable(goal: string): string {
  if (/表格|excel|csv/i.test(goal)) return '结构化表格';
  if (/演示|ppt|幻灯/i.test(goal)) return '演示文稿大纲与页面内容';
  if (/网站|网页|页面/i.test(goal)) return '可实现的网页方案';
  if (/报告|研究|分析/i.test(goal)) return '带来源或依据的结构化报告';
  return '完整的文本交付成果';
}
