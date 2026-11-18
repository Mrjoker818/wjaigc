// Built-in skills for the standalone chat page. Like ChatGPT's built-in skills, each one is
// a short instruction file loaded only when the request matches it. Every skill maps to a
// generator that already exists in this project, so the model's output can be executed.

export type SimpleChatSkillId =
  | 'image' | 'pptx' | 'xlsx' | 'docx' | 'pdf' | 'mindmap' | 'flowchart' | 'vision';

export interface SimpleChatSkill {
  id: SimpleChatSkillId;
  name: string;
  description: string;
  /** Slash command that forces the skill, e.g. "/ppt". */
  command: string;
  /** Keywords that trigger automatic selection. */
  triggers: RegExp;
  /** Execution steps shown to the user. */
  steps: string[];
  /** Instructions appended to the system prompt when the skill is active. */
  instructions: string;
}

const JSON_RULE = '只输出一个 ```json 代码块，代码块前可用一句话说明，不要输出其他代码块。';

export const SIMPLE_CHAT_SKILLS: SimpleChatSkill[] = [
  {
    id: 'image',
    name: '图像生成',
    description: '根据描述或参考图生成图片，自动匹配比例、分辨率与质量',
    command: '/image',
    triggers: /(生成|画|绘制|做|出).{0,8}(图|图片|海报|插画|头像|壁纸|logo|封面|banner)|(图生图|改图|换背景|重绘)|\b(draw|generate an? image)\b/i,
    steps: ['理解画面需求', '匹配模型比例与分辨率', '提交生图任务', '等待供应商返回结果'],
    instructions: '必须调用 generate_image 工具。prompt 用详细的画面描述（主体、场景、构图、光线、风格）。若用户指定比例，在 aspect_ratio 中填写；尺寸、分辨率、质量要求保留在 prompt 原文中即可，系统会自动匹配模型规格。',
  },
  {
    id: 'pptx',
    name: '演示文稿',
    description: '生成可下载的 PPT（.pptx）',
    command: '/ppt',
    triggers: /(ppt|pptx|幻灯片|演示文稿|课件|汇报稿|路演)/i,
    steps: ['梳理大纲', '编排每页版式', '生成幻灯片数据', '导出 .pptx'],
    instructions: `${JSON_RULE} 结构：{"title":"","theme":"tech-blue|warm-orange|clean-white|elegant-dark|nature-green|vibrant-red","slides":[{"title":"","subtitle":"","bullets":[],"content":"","layout":"title|content|bullet-list|two-column|quote|chart|table|thanks","chart":{"type":"bar|line|pie|doughnut","labels":[],"series":[{"name":"","values":[]}]},"table":{"headers":[],"rows":[[]]},"speakerNotes":""}]}。第一页用 title 版式，最后一页用 thanks 版式，通常 6-12 页。`,
  },
  {
    id: 'xlsx',
    name: '电子表格',
    description: '生成可下载的 Excel（.xlsx）',
    command: '/excel',
    triggers: /(excel|xlsx|表格|电子表|工作簿|报表|台账|清单表)/i,
    steps: ['确定表结构', '填充数据行', '生成表格数据', '导出 .xlsx'],
    instructions: `${JSON_RULE} 结构：{"title":"","sheets":[{"name":"","headers":[],"rows":[[]],"colWidths":[]}]}。数字列用数字类型，不要带单位字符串。`,
  },
  {
    id: 'docx',
    name: '文档写作',
    description: '生成可下载的 Word（.docx）',
    command: '/word',
    triggers: /(word|docx|文档|报告|方案书|合同|简历|说明书|策划案)/i,
    steps: ['梳理章节结构', '撰写正文', '生成文档数据', '导出 .docx'],
    instructions: `${JSON_RULE} 结构：{"title":"","author":"","sections":[{"type":"heading|paragraph|bullet|table|divider","level":1,"text":"","bullets":[],"table":{"headers":[],"rows":[[]]}}]}。`,
  },
  {
    id: 'pdf',
    name: 'PDF 导出',
    description: '把内容排版为可下载的 PDF',
    command: '/pdf',
    triggers: /(pdf)/i,
    steps: ['整理内容', '排版为 Markdown', '导出 PDF'],
    instructions: `${JSON_RULE} 结构：{"type":"markdown","title":"","content":"Markdown 正文","theme":"tech-blue|emerald-green|warm-orange|dark-elegance|minimal-gray"}。`,
  },
  {
    id: 'mindmap',
    name: '思维导图',
    description: '生成可下载的思维导图',
    command: '/mindmap',
    triggers: /(思维导图|脑图|mind\s*map|知识图谱)/i,
    steps: ['提炼中心主题', '展开分支层级', '生成导图'],
    instructions: `${JSON_RULE} 结构：{"title":"","root":{"text":"","children":[{"text":"","children":[]}]}}，层级 2-4 层。`,
  },
  {
    id: 'flowchart',
    name: '流程图',
    description: '用 Mermaid 生成流程图',
    command: '/flow',
    triggers: /(流程图|时序图|架构图|泳道图|flow\s*chart|mermaid)/i,
    steps: ['拆解流程节点', '编写 Mermaid', '渲染流程图'],
    instructions: `${JSON_RULE} 结构：{"title":"","mermaid":"flowchart TD\\n  A[开始] --> B[...]"}。节点文字用中文，避免特殊符号。`,
  },
  {
    id: 'vision',
    name: '看图分析',
    description: '识别并分析用户上传的图片',
    command: '/vision',
    triggers: /(这张图|图片里|图中|识别|看看这|分析.{0,4}图|描述.{0,4}图|ocr|提取文字)/i,
    steps: ['读取原图', '识别画面内容', '给出分析结论'],
    instructions: '先逐项描述图片中实际可见的内容（主体、文字、颜色、构图），再回答问题。看不清或无法确认的部分要直接说明，不要猜测。',
  },
];

export function getSimpleChatSkill(id: string | undefined | null): SimpleChatSkill | undefined {
  return SIMPLE_CHAT_SKILLS.find(skill => skill.id === id);
}

export interface SkillSelection {
  skill: SimpleChatSkill | null;
  /** User text with a leading slash command removed. */
  text: string;
  source: 'command' | 'explicit' | 'auto' | 'none';
}

/**
 * Picks the skill for a request: an explicit choice wins, then a leading slash command,
 * then keyword triggers. Uploaded images with no other match select the vision skill.
 */
export function selectSimpleChatSkill(
  text: string,
  options: { explicitSkillId?: string | null; hasImages?: boolean } = {},
): SkillSelection {
  const raw = (text || '').trim();
  const commandMatch = raw.match(/^\/([a-z]+)\b\s*/i);
  if (commandMatch) {
    const skill = SIMPLE_CHAT_SKILLS.find(s => s.command === `/${commandMatch[1].toLowerCase()}`);
    if (skill) return { skill, text: raw.slice(commandMatch[0].length).trim(), source: 'command' };
  }
  const explicit = getSimpleChatSkill(options.explicitSkillId);
  if (explicit) return { skill: explicit, text: raw, source: 'explicit' };

  const auto = SIMPLE_CHAT_SKILLS.find(s => s.id !== 'vision' && s.triggers.test(raw));
  if (auto) return { skill: auto, text: raw, source: 'auto' };
  const vision = SIMPLE_CHAT_SKILLS.find(s => s.id === 'vision');
  if (vision && (options.hasImages || vision.triggers.test(raw))) {
    return { skill: vision, text: raw, source: 'auto' };
  }
  return { skill: null, text: raw, source: 'none' };
}

export function buildSkillInstructions(skill: SimpleChatSkill): string {
  return `\n\n[已加载技能：${skill.name}]\n${skill.instructions}`;
}
