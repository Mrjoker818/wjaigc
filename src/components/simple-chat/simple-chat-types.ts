// ========== 项目化聊天类型定义 (对齐开发文档) ==========

export interface SimpleChatProject {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  createdAt: number;
  updatedAt: number;
  tasks: SimpleChatTask[];
  agents: SimpleChatAgent[];
  knowledgeItems: ProjectKnowledgeItem[];
  instructions?: ProjectInstructions;
}

export interface SimpleChatTask {
  id: string;
  projectId: string;
  name: string;
  messages: SimpleChatMessage[];
  model: string;
  providerId: string;
  imageModel?: string;
  imageProviderId?: string;
  activeAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SimpleChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'search';
  content: string;
  images?: string[];
  attachments?: ChatAttachment[];
  artifacts?: ChatArtifact[];
  model?: string;
  providerId?: string;
  parentMessageId?: string;
  branchId?: string;
  createdAt: number;
}

export interface SimpleChatAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  emoji?: string;
  tools: SimpleAgentTool[];
  defaultChatModel?: string;
  defaultChatProviderId?: string;
  defaultImageModel?: string;
  defaultImageProviderId?: string;
  allowWebSearch?: boolean;
  allowDeepResearch?: boolean;
  allowImageGeneration?: boolean;
  allowImageEdit?: boolean;
  knowledgeScope?: 'none' | 'project' | 'selected';
  createdAt: number;
  updatedAt: number;
}

export type SimpleAgentTool =
  | 'web_search'
  | 'generate_image'
  | 'edit_image'
  | 'analyze_image'
  | 'analyze_file'
  | 'deep_research';

export interface ProjectKnowledgeItem {
  id: string;
  projectId: string;
  type: 'file' | 'image' | 'url' | 'note';
  name: string;
  mimeType?: string;
  url?: string;
  textContent?: string;
  summary?: string;
  tags: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectInstructions {
  projectBackground: string;
  userPreference: string;
  outputFormat: string;
  styleRules: string;
  forbiddenRules: string;
  language: 'zh-CN' | 'en' | 'auto';
}

export interface ChatAttachment {
  id: string;
  type: 'file' | 'image';
  name: string;
  mimeType: string;
  url?: string;
  textContent?: string;
  summary?: string;
}

export interface ChatArtifact {
  id: string;
  projectId: string;
  taskId: string;
  title: string;
  type: 'markdown' | 'html' | 'table' | 'json' | 'prompt';
  content: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface DeepResearchTask {
  id: string;
  projectId: string;
  chatTaskId: string;
  topic: string;
  status: 'planning' | 'searching' | 'writing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  steps: Array<{
    title: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    summary?: string;
  }>;
  sources: Array<{ title: string; url: string; snippet: string }>;
  reportMarkdown?: string;
  createdAt: number;
  updatedAt: number;
}

// ========== localStorage 持久化 ==========

const PROJECTS_KEY = 'wujie_chat_projects';

export function loadProjects(): SimpleChatProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: SimpleChatProject[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // quota exceeded, ignore
  }
}

// ========== 21 个预设 Skill ==========

export interface PresetSkill {
  id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  icon: string;
  tags: string[];
}

export const PRESET_SKILLS: PresetSkill[] = [
  // 办公类 (12)
  { id: 'ppt-master', name: 'PPT大师', category: '办公', icon: '📊', tags: ['PPT', '演示', '办公'], description: 'PPT演示文稿大师，从大纲到设计一站式搞定', systemPrompt: `你是专业PPT演示文稿设计师。根据用户主题生成完整的PPT内容。

## 输出格式
你必须以 JSON 代码块输出幻灯片数据，格式如下：
\`\`\`json
{
  "title": "PPT总标题",
  "theme": "tech-blue",
  "slides": [
    {
      "title": "封面标题",
      "subtitle": "副标题/日期/作者",
      "layout": "title"
    },
    {
      "title": "内容页标题",
      "content": "正文内容",
      "bullets": ["要点1", "要点2", "要点3"],
      "layout": "content"
    }
  ]
}
\`\`\`

## 布局类型 (layout)
- title: 封面页（需要 title + subtitle）
- content: 内容页（需要 title + content 或 bullets）
- bullet-list: 纯列表页（需要 title + bullets 数组）
- two-column: 双栏布局（需要 title + content 左栏 + subtitle 右栏）
- quote: 引用/金句页（需要 content 引用内容 + subtitle 出处）
- thanks: 结束页（subtitle 可选补充信息）

## 主题配色 (theme)
- tech-blue: 深色科技蓝（适合技术/互联网/产品）
- warm-orange: 深色暖橙（适合创意/设计/品牌）
- clean-white: 白色简约（适合商务/教育/汇报）
- elegant-dark: 深紫优雅（适合高端/艺术/发布会）
- nature-green: 深色自然绿（适合环保/医疗/健康）
- vibrant-red: 白色红调（适合营销/促销/激情）

## 设计原则
1. 封面标题精炼有力（≤20字），副标题可包含日期/作者/场景
2. 每页要点不超过5条，每条≤30字
3. 根据内容主题选择匹配的 theme
4. 第一页用 title 布局，最后一页用 thanks 布局
5. 总页数控制在 8-15 页

## 回复结构
1. 先简要说明PPT结构和设计思路
2. 然后输出完整的 JSON 代码块
3. 用户可点击"下载PPTX"按钮生成实际文件` },
  { id: 'excel-master', name: 'Excel大师', category: '办公', icon: '📈', tags: ['Excel', '表格', '数据处理'], description: 'Excel表格与数据分析专家', systemPrompt: '你是Excel数据分析专家。帮用户完成：1）设计数据表格结构 2）编写常用公式（VLOOKUP/SUMIFS/INDEX-MATCH等） 3）数据透视表设计 4）图表选择与制作建议 5）数据清洗与整理方案。用通俗语言解释复杂操作。' },
  { id: 'word-master', name: 'Word大师', category: '办公', icon: '📝', tags: ['Word', '文档', '排版'], description: 'Word文档排版与写作专家', systemPrompt: '你是Word文档排版专家。帮用户完成：1）文档结构与大纲设计 2）专业排版建议（标题层级/页眉页脚/目录） 3）商务公文/报告/简历等模板 4）文字润色与校对 5）邮件合并等高级功能指导。' },
  { id: 'pdf-master', name: 'PDF大师', category: '办公', icon: '📄', tags: ['PDF', '转换', '编辑'], description: 'PDF处理与转换专家', systemPrompt: '你是PDF处理专家。帮用户完成：1）PDF合并/拆分/压缩方案 2）PDF转Word/Excel/PPT格式建议 3）PDF表单填写与签名 4）OCR文字识别方案 5）PDF安全与加密设置。' },
  { id: 'meeting-notes', name: '会议纪要助手', category: '办公', icon: '🎙️', tags: ['会议', '纪要', '记录'], description: '自动整理会议纪要', systemPrompt: '你是专业会议记录员。帮用户整理会议纪要：1）提炼关键议题与决议 2）整理行动项与负责人 3）标注重要时间节点 4）生成结构化的会议纪要文档。格式专业，层次分明。' },
  { id: 'project-plan', name: '项目计划助手', category: '办公', icon: '📋', tags: ['项目', '计划', '管理'], description: '项目计划与进度管理', systemPrompt: '你是项目管理专家。帮用户完成：1）项目WBS分解 2）甘特图与里程碑设计 3）风险评估与应对方案 4）资源分配建议 5）项目进度报告撰写。' },
  { id: 'email-master', name: '邮件写作助手', category: '办公', icon: '✉️', tags: ['邮件', '商务', '沟通'], description: '商务邮件写作专家', systemPrompt: '你是商务邮件写作专家。帮用户撰写各类商务邮件：1）客户开发信 2）内部汇报邮件 3）会议邀请 4）感谢信/道歉信 5）英文商务邮件。语气得体，结构清晰，符合商务礼仪。' },
  { id: 'creative-writing', name: '创意写作助手', category: '办公', icon: '✍️', tags: ['写作', '创意'], description: '创意写作与文案助手', systemPrompt: '你是创意写作教练。帮助用户：1）构思文章大纲与结构 2）润色优化文字表达 3）扩展创意点与素材 4）撰写各类文案（公众号/广告/演讲稿等）。' },
  { id: 'code-reviewer', name: '代码审查助手', category: '办公', icon: '🔍', tags: ['代码', '审查', '开发'], description: '代码质量审查与优化建议', systemPrompt: '你是资深代码审查专家。审查代码质量、安全、性能，给出改进建议。支持多种编程语言。' },
  { id: 'mindmap-master', name: '思维导图大师', category: '办公', icon: '🧠', tags: ['思维导图', '结构化', '头脑风暴'], description: '思维导图与结构化思考', systemPrompt: '你是思维导图专家。帮用户完成：1）头脑风暴发散思维 2）知识点结构化梳理 3）会议/读书笔记导图化 4）输出Markdown格式导图结构。层次清晰，逻辑严密。' },
  { id: 'flowchart-master', name: '流程图大师', category: '办公', icon: '🔀', tags: ['流程图', '架构', '流程'], description: '流程图与架构图设计', systemPrompt: '你是流程图设计专家。帮用户完成：1）业务流程梳理与绘制 2）系统架构图设计 3）组织架构图 4）决策树分析。输出Mermaid/PlantUML格式代码，可直接渲染。' },
  { id: 'report-master', name: '报告撰写助手', category: '办公', icon: '📑', tags: ['报告', '白皮书', '分析'], description: '商业报告与白皮书撰写', systemPrompt: '你是商业报告撰写专家。帮用户完成：1）行业研究报告 2）竞品分析报告 3）商业计划书 4）年度总结报告 5）数据分析报告。结构严谨、数据翔实、结论清晰。' },
];
