// 「自动技能」 for the standalone chat composer: picks one of the preset skills per request, from a
// leading slash command, the skill chosen in the composer, or keywords in the request.

/** How the skill of a reply was chosen; shown on the reply. */
export type SimpleChatSkillSource = 'command' | 'explicit' | 'auto' | 'follow-up';

export interface SimpleChatReplySkill {
  id: string;
  name: string;
  source: SimpleChatSkillSource;
}

interface AutoSkillRule {
  id: string;
  /** Slash command that forces the skill, e.g. "/ppt". */
  command: string;
  /**
   * Keywords that select the skill without a command. Kept strict: a skill that answers with a
   * file's JSON turns a stray match ("这个文档讲了什么") into a JSON reply.
   */
  triggers?: RegExp;
  /** The reply carries a ```json block the page turns into a download. */
  file?: boolean;
}

const MAKE = '(?:做|生成|写|出|制作|整理成|导出|转成|转换成|输出|设计|画|来)';
/** A make-verb shortly before the noun: "帮我做一份季度汇报PPT", but not "这个 excel 公式怎么写". */
const made = (nouns: string) => new RegExp(`${MAKE}.{0,12}(?:${nouns})`, 'i');

/** Order matters: the first matching rule wins. */
export const SIMPLE_CHAT_AUTO_SKILL_RULES: readonly AutoSkillRule[] = [
  { id: 'ppt-master', command: '/ppt', file: true, triggers: made('ppt|pptx|幻灯片|演示文稿|课件|路演稿') },
  { id: 'excel-master', command: '/excel', file: true, triggers: made('excel|xlsx|表格|报表|台账|工作簿') },
  { id: 'mindmap-master', command: '/mindmap', file: true, triggers: /(?:思维导图|脑图|mind\s*map)/i },
  { id: 'flowchart-master', command: '/flow', file: true, triggers: /(?:流程图|时序图|泳道图|flow\s*chart|mermaid)/i },
  { id: 'pdf-master', command: '/pdf', file: true, triggers: made('pdf') },
  { id: 'word-master', command: '/word', file: true, triggers: made('word|docx|合同|简历|说明书|策划案|方案书') },
  { id: 'poster-design', command: '/poster', triggers: made('海报') },
  { id: 'meeting-notes', command: '/meeting', triggers: /(?:整理|写|出).{0,8}(?:会议纪要|会议记录)/ },
  { id: 'email-master', command: '/email', triggers: /(?:写|起草|回复|拟).{0,10}(?:邮件|email)/i },
  { id: 'report-master', command: '/report', triggers: made('报告|白皮书|商业计划书') },
];

/** Commands listed in the composer's hint, in rule order. */
export const SIMPLE_CHAT_SKILL_COMMANDS = SIMPLE_CHAT_AUTO_SKILL_RULES.map(rule => rule.command);

/** A short request that edits the previous skill's result, e.g. "第 3 页标题改短一点". */
const FOLLOW_UP = /(?:改|调整|修改|换成|换一|加一|再加|删掉|删除|去掉|增加|减少|补充|第\s*[0-9一二三四五六七八九十]{1,3}\s*(?:页|张|行|列|节|章|项|步))/;
const FOLLOW_UP_MAX_CHARS = 120;

export interface AutoSkillSelection {
  skillId: string | null;
  /** The request with a leading slash command removed. */
  text: string;
  source: SimpleChatSkillSource | null;
}

/**
 * Picks the skill for one request. A leading slash command wins, then the skill chosen in the
 * composer, then keywords. A short edit request keeps the skill of the previous reply, so
 * "第 3 页改一下" after a PPT still answers with slide data.
 */
export function selectSimpleChatAutoSkill(
  text: string,
  options: { explicitSkillId?: string | null; previousSkillId?: string | null; knownSkillIds: readonly string[] },
): AutoSkillSelection {
  const raw = (text || '').trim();
  const known = new Set(options.knownSkillIds);
  const command = raw.match(/^\/([a-z]+)(?=\s|$)\s*/i);
  if (command) {
    const rule = SIMPLE_CHAT_AUTO_SKILL_RULES.find(item => item.command === `/${command[1].toLowerCase()}`);
    if (rule && known.has(rule.id)) return { skillId: rule.id, text: raw.slice(command[0].length).trim(), source: 'command' };
  }
  if (options.explicitSkillId && known.has(options.explicitSkillId)) {
    return { skillId: options.explicitSkillId, text: raw, source: 'explicit' };
  }
  const auto = SIMPLE_CHAT_AUTO_SKILL_RULES.find(rule => known.has(rule.id) && rule.triggers?.test(raw));
  if (auto) return { skillId: auto.id, text: raw, source: 'auto' };
  if (options.previousSkillId && known.has(options.previousSkillId) && raw.length <= FOLLOW_UP_MAX_CHARS && FOLLOW_UP.test(raw)) {
    return { skillId: options.previousSkillId, text: raw, source: 'follow-up' };
  }
  return { skillId: null, text: raw, source: null };
}

export const SIMPLE_CHAT_SKILL_SOURCE_TEXT: Record<SimpleChatSkillSource, string> = {
  command: '指令',
  explicit: '手动选择',
  auto: '自动匹配',
  'follow-up': '沿用上一轮',
};

export type SkillFileStepStatus = 'done' | 'running' | 'pending' | 'failed';

export const SKILL_FILE_STEPS = ['理解需求', '编写内容', '生成文件数据', '可以下载'] as const;

/** Whether the skill answers with a ```json block that becomes a download. */
export function isSimpleChatFileSkill(skillId: string | undefined): boolean {
  return SIMPLE_CHAT_AUTO_SKILL_RULES.some(rule => rule.id === skillId && rule.file);
}

/**
 * Steps of a file skill, read from the reply so far: nothing yet, prose, an open ```json block,
 * a closed block. A finished reply whose block does not parse fails the third step.
 */
export function deriveSkillFileSteps(content: string, finished: boolean): SkillFileStepStatus[] {
  const open = content.search(/```json\s/i);
  const block = content.match(/```json\s*([\s\S]*?)\s*```/i);
  let reached: number;
  if (block) {
    let parsed = false;
    try { JSON.parse(block[1]); parsed = true; } catch { parsed = false; }
    if (!parsed) {
      return finished ? ['done', 'done', 'failed', 'pending'] : ['done', 'done', 'running', 'pending'];
    }
    reached = 4;
  } else if (open >= 0) {
    reached = 2;
  } else if (content.trim()) {
    reached = 1;
  } else {
    reached = 0;
  }
  if (finished && reached < 4) {
    // The reply ended without file data: the model answered in prose, e.g. to ask a question.
    return SKILL_FILE_STEPS.map((_, index) => (index < Math.max(reached, 1) ? 'done' : 'pending'));
  }
  return SKILL_FILE_STEPS.map((_, index) => (index < reached ? 'done' : index === reached ? 'running' : 'pending'));
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const SOURCES = new Set<string>(['command', 'explicit', 'auto', 'follow-up']);

export function readSimpleChatReplySkill(value: unknown): SimpleChatReplySkill | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, name, source } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > 40) return null;
  if (typeof source !== 'string' || !SOURCES.has(source)) return null;
  return { id, name, source: source as SimpleChatSkillSource };
}
