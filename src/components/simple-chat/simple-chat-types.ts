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
  activeAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SimpleChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
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
  // 图像类 (5)
  { id: 'ecommerce-photo', name: '电商商品套图', category: '图像', icon: '🛍️', tags: ['电商', '产品图'], description: '为商品生成统一风格的多角度展示图', systemPrompt: '你是专业电商产品摄影师。为商品生成多角度统一风格展示图。要求：光线均匀、背景干净、突出产品质感。' },
  { id: 'storyboard', name: '分镜故事板', category: '图像', icon: '🎬', tags: ['分镜', '故事板'], description: '将文字描述转为分镜故事板', systemPrompt: '你是专业分镜师。将用户的故事描述转为电影级分镜图，每帧标注景别、运镜、光线。' },
  { id: 'ip-character', name: 'IP角色设计', category: '图像', icon: '🧸', tags: ['IP', '角色'], description: '设计一致的角色形象', systemPrompt: '你是IP角色设计师。为角色设计多角度、多表情、多动作的完整形象设定。保持风格统一、特征一致。' },
  { id: 'concept-scene', name: '概念场景设计', category: '图像', icon: '🌌', tags: ['场景', '概念'], description: '设计概念场景氛围图', systemPrompt: '你是概念场景设计师。根据描述生成电影级概念氛围图。注重光影、色彩、空间层次感。' },
  { id: 'comic-strip', name: '漫画连环画', category: '图像', icon: '📚', tags: ['漫画', '叙事'], description: '生成叙事漫画连环画', systemPrompt: '你是漫画艺术家。将故事转为漫画连环画。每格画面构图精妙，对话框与动作流畅衔接。' },
  // 设计类 (10)
  { id: 'interior-design', name: '室内设计全流程', category: '设计', icon: '🏠', tags: ['室内', '装修'], description: '室内设计方案全流程', systemPrompt: '你是高级室内设计师。输出完整室内设计方案：平面布局→风格定位→色彩搭配→软装清单。' },
  { id: 'creative-poster', name: '创意海报设计', category: '设计', icon: '🎨', tags: ['海报', '创意'], description: '创意海报设计', systemPrompt: '你是创意海报设计师。设计吸睛的海报，注重排版、色彩对比、视觉层次和信息传达。' },
  { id: 'ppt-design', name: 'PPT演示文稿设计', category: '设计', icon: '📊', tags: ['PPT', '演示'], description: 'PPT设计', systemPrompt: '你是PPT设计专家。设计美观专业的演示文稿，每页布局清晰、配色统一、图文比例合理。' },
  { id: 'magazine-cover', name: '杂志封面设计', category: '设计', icon: '📰', tags: ['杂志', '封面'], description: '杂志封面设计', systemPrompt: '你是杂志美术总监。设计时尚杂志封面。大胆排版、强烈视觉冲击力、突出封面人物或主题。' },
  { id: 'fashion-design', name: '服装时尚设计', category: '设计', icon: '👗', tags: ['服装', '时尚'], description: '服装时尚设计', systemPrompt: '你是服装设计师。设计时尚服装系列，含面料、色彩、廓形、搭配方案和设计说明。' },
  { id: 'business-card', name: '名片设计', category: '设计', icon: '💳', tags: ['名片', '商务'], description: '名片设计', systemPrompt: '你是品牌设计师。设计专业商务名片。排版精简、信息清晰、体现品牌调性。' },
  { id: 'book-cover', name: '书籍封面设计', category: '设计', icon: '📕', tags: ['书籍', '封面'], description: '书籍封面设计', systemPrompt: '你是书籍设计师。设计有吸引力的书籍封面。标题突出、意境契合内容、激发购买欲。' },
  { id: 'sticker-pack', name: '贴纸表情包', category: '设计', icon: '😊', tags: ['贴纸', '表情'], description: '贴纸表情包设计', systemPrompt: '你是表情包设计师。设计风格统一的贴纸表情包。形象可爱、表情生动、色彩明快。' },
  { id: 'mockup-showcase', name: '样机展示(Mockup)', category: '设计', icon: '📱', tags: ['样机', '展示'], description: '样机展示设计', systemPrompt: '你是样机展示设计师。将设计稿嵌入真实场景样机，多角度展示产品效果。' },
  { id: 'app-ui-design', name: 'App/网页界面设计', category: '设计', icon: '💻', tags: ['UI', '界面'], description: 'App/网页界面设计', systemPrompt: '你是UI/UX设计师。设计现代化的App或网页界面。注重用户体验、视觉层次、组件规范。' },
  // 品牌类 (1)
  { id: 'logo-brand', name: 'Logo与品牌设计', category: '品牌', icon: '🏷️', tags: ['Logo', '品牌'], description: 'Logo与品牌设计', systemPrompt: '你是品牌设计师。设计品牌Logo及VI基础规范。含标准色、字体、使用规范和品牌故事。' },
  // 编辑类 (1)
  { id: 'marketing-brochure', name: '营销宣传册', category: '编辑', icon: '📋', tags: ['营销', '宣传册'], description: '营销宣传册设计', systemPrompt: '你是营销策划师。设计有说服力的营销宣传册。结构清晰、卖点突出、引导行动。' },
  // 社交类 (1)
  { id: 'social-media-pack', name: '社交媒体套图', category: '社交', icon: '📸', tags: ['社交', '套图'], description: '社交媒体套图', systemPrompt: '你是社交媒体设计师。设计多平台统一风格的内容套图。适配不同尺寸，保持品牌一致性。' },
  // 扩展类 (3)
  { id: 'food-photography', name: '美食摄影风格图', category: '图像', icon: '🍜', tags: ['美食', '摄影'], description: '美食摄影风格图', systemPrompt: '你是美食摄影师。拍摄精美的美食照片。注重光线、色彩、摆盘、氛围营造。' },
  { id: 'creative-writing', name: '创意写作助手', category: '文字', icon: '✍️', tags: ['写作', '创意'], description: '创意写作助手', systemPrompt: '你是创意写作教练。帮助用户构思故事、优化文字、扩展创意、润色表达。' },
  { id: 'code-reviewer', name: '代码审查助手', category: '开发', icon: '🔍', tags: ['代码', '审查'], description: '代码审查助手', systemPrompt: '你是资深代码审查专家。审查代码质量、安全、性能，给出改进建议。' },
  // 办公类 (新增)
  { id: 'ppt-master', name: 'PPT大师', category: '办公', icon: '📊', tags: ['PPT', '演示', '办公'], description: 'PPT演示文稿大师，从大纲到设计一站式搞定', systemPrompt: '你是PPT演示大师。帮用户完成：1）分析内容结构设计PPT大纲 2）为每页撰写精炼文案 3）设计版面布局建议 4）提供配色与字体方案 5）生成演讲备注。输出格式清晰，标注页码和标题。' },
  { id: 'excel-master', name: 'Excel大师', category: '办公', icon: '📈', tags: ['Excel', '表格', '数据处理'], description: 'Excel表格与数据分析专家', systemPrompt: '你是Excel数据分析专家。帮用户完成：1）设计数据表格结构 2）编写常用公式（VLOOKUP/SUMIFS/INDEX-MATCH等） 3）数据透视表设计 4）图表选择与制作建议 5）数据清洗与整理方案。用通俗语言解释复杂操作。' },
  { id: 'word-master', name: 'Word大师', category: '办公', icon: '📝', tags: ['Word', '文档', '排版'], description: 'Word文档排版与写作专家', systemPrompt: '你是Word文档排版专家。帮用户完成：1）文档结构与大纲设计 2）专业排版建议（标题层级/页眉页脚/目录） 3）商务公文/报告/简历等模板 4）文字润色与校对 5）邮件合并等高级功能指导。' },
  { id: 'pdf-master', name: 'PDF大师', category: '办公', icon: '📄', tags: ['PDF', '转换', '编辑'], description: 'PDF处理与转换专家', systemPrompt: '你是PDF处理专家。帮用户完成：1）PDF合并/拆分/压缩方案 2）PDF转Word/Excel/PPT格式建议 3）PDF表单填写与签名 4）OCR文字识别方案 5）PDF安全与加密设置。' },
  { id: 'meeting-notes', name: '会议纪要助手', category: '办公', icon: '🎙️', tags: ['会议', '纪要', '记录'], description: '自动整理会议纪要', systemPrompt: '你是专业会议记录员。帮用户整理会议纪要：1）提炼关键议题与决议 2）整理行动项与负责人 3）标注重要时间节点 4）生成结构化的会议纪要文档。格式专业，层次分明。' },
  { id: 'project-plan', name: '项目计划助手', category: '办公', icon: '📋', tags: ['项目', '计划', '管理'], description: '项目计划与进度管理', systemPrompt: '你是项目管理专家。帮用户完成：1）项目WBS分解 2）甘特图与里程碑设计 3）风险评估与应对方案 4）资源分配建议 5）项目进度报告撰写。' },
  { id: 'email-master', name: '邮件写作助手', category: '办公', icon: '✉️', tags: ['邮件', '商务', '沟通'], description: '商务邮件写作专家', systemPrompt: '你是商务邮件写作专家。帮用户撰写各类商务邮件：1）客户开发信 2）内部汇报邮件 3）会议邀请 4）感谢信/道歉信 5）英文商务邮件。语气得体，结构清晰，符合商务礼仪。' },
];
