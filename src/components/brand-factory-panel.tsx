'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Building2, X, GripVertical, Plus, Trash2, Archive, FolderOpen,
  Upload, Image as ImageIcon, Palette, Sparkles, Layout, FileText,
  CheckCircle, AlertTriangle, Clock, Download, Copy, RotateCcw,
  ChevronRight, ChevronDown, Eye, Star, MessageSquare, Send,
  Zap, RefreshCw, Save, BookOpen, Users, PenTool, Type,
  Cpu, MessageCircle, Minus
} from 'lucide-react';
import { useProgressTimer } from '@/hooks/useProgressTimer';

/* ========== TYPES ========== */
interface BrandProject {
  id: string;
  projectName: string;
  brandName: string;
  industry: string;
  projectType: string;
  keywords: string[];
  targetAudience: string;
  tone: string;
  description: string;
  logoUrl: string;
  productUrl: string;
  ipUrl: string;
  referenceUrls: string[];
  brandDna: BrandDNA | null;
  creativeDirections: CreativeDirection[];
  kvImageUrl: string;
  batchResults: { item: string; imageUrl: string }[];
  consistencyScores: { overall: number; details: Record<string, number> } | null;
  status: 'draft' | 'active' | 'completed' | 'archived';
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BrandDNA {
  brandKeywords: string[];
  mainColors: string[];
  secondaryColors: string[];
  fontStyle: string;
  visualTone: string;
  logoRules: string[];
  productRules: string[];
  ipRules: string[];
  forbiddenRules: string[];
  recommendedMaterials: string[];
}

interface CreativeDirection {
  id: string;
  name: string;
  concept: string;
  slogan: string;
  visualKeywords: string[];
  colorPlan: string[];
  fontPlan: string;
  prompt: string;
  previewImages: string[];
}

interface GeneratedMaterial {
  id: string;
  projectId: string;
  directionId: string;
  type: string;
  title: string;
  ratio: string;
  imageUrl: string;
  prompt: string;
  score: number;
  status: 'draft' | 'confirmed' | 'exported';
  createdAt: string;
}

interface VersionRecord {
  id: string;
  projectId: string;
  targetType: 'dna' | 'direction' | 'kv' | 'material' | 'proposal' | 'confirmed' | 'fix' | 'export' | 'archive';
  targetId: string;
  versionName: string;
  note: string;
  snapshot: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

interface BrandTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  materials: string[];
  ratios: string[];
  compositions: string[];
  style: string;
  colors: string[];
  defaultPrompt: string;
  forbiddenRules: string[];
}

interface CommentRecord {
  id: string;
  targetType: string;
  targetId: string;
  author: string;
  type: string;
  content: string;
  createdAt: string;
}

interface ImageModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

/* ========== CONSTANTS ========== */

const PROJECT_TYPES = [
  '品牌升级', '新品上市', '节日营销', '活动推广',
  '品牌焕新', '品牌重塑', 'IP打造', '品牌延伸'
];

const INDUSTRIES = [
  '餐饮美食', '酒水饮料', '美妆个护', '潮玩IP',
  '科技互联网', '文旅地产', '服饰鞋包', '家居生活',
  '汽车出行', '教育培训', '医疗健康', '金融理财',
  '影视娱乐', '体育健身', '宠物', '其他'
];

const TONES = [
  '高级奢华', '年轻潮流', '温暖亲和', '科技未来',
  '自然有机', '东方国潮', '极简现代', '活力运动',
  '复古经典', '少女甜美', '商务专业', '街头潮流'
];

const CONSISTENCY_DIMENSIONS = [
  { key: 'logoAccuracy', label: 'Logo准确度' },
  { key: 'logoDeform', label: 'Logo是否变形' },
  { key: 'logoOcclusion', label: 'Logo是否遮挡' },
  { key: 'brandColor', label: '品牌主色匹配度' },
  { key: 'fontConsistency', label: '字体风格一致性' },
  { key: 'chineseAccuracy', label: '中文文字准确度' },
  { key: 'productFidelity', label: '产品外观保真度' },
  { key: 'ipFidelity', label: 'IP形象保真度' },
  { key: 'styleConsistency', label: '画面风格统一度' },
  { key: 'commercialQuality', label: '商业完成度' },
  { key: 'terminalRealism', label: '终端适配度' },
  { key: 'sizeAccuracy', label: '物料尺寸准确度' },
  { key: 'extraText', label: '是否存在多余文字' },
  { key: 'forbiddenRule', label: '是否符合品牌禁区规则' },
];

const FIX_BUTTONS = [
  '修复Logo', '修复产品', '修复IP', '修复中文',
  '统一品牌色', '增强商业质感', '减少画面杂乱',
  '提升高级感', '增强终端真实感', '保持原品牌风格重新生成'
];

const KV_QUICK_FIXES = [
  '提升高级感', '增强商业广告感', '减少杂乱', '强化品牌色',
  '放大产品', '弱化背景', '强化主题文字', '改成横版 16:9',
  '改成竖版 9:16', '去除多余文字', '统一视觉风格'
];

const VERSION_TYPES = [
  { value: 'dna', label: '品牌DNA版本' },
  { value: 'direction', label: '创意方向版本' },
  { value: 'kv', label: '主KV版本' },
  { value: 'material', label: '物料生成版本' },
  { value: 'confirmed', label: '客户确认版本' },
  { value: 'fix', label: '修复版本' },
  { value: 'export', label: '导出版本' },
  { value: 'archive', label: '归档版本' },
];

const TEMPLATE_CATEGORIES = [
  '品牌升级模板', '新品上市模板', '节日营销模板', '快闪活动模板',
  '电商大促模板', '餐饮品牌模板', '酒水品牌模板', '美妆品牌模板',
  '潮玩IP模板', '科技品牌模板', '文旅品牌模板', '门店开业模板',
  '招商加盟模板', '发布会模板', '社媒矩阵模板'
];

const CHINESE_TITLE_SCENES = [
  '品牌主标题', '活动主题字', '海报标题', '封面标题',
  'Logo字体', '产品卖点字', '电商促销字', '小红书爆款标题',
  '快闪店门头字', '包装标题字'
];

const CHINESE_TITLE_STYLES = [
  '高级黑体', '现代宋体', '圆润可爱', '手写活力',
  '书法力量感', '潮流街头', '科技未来', '东方奢感',
  '电商爆款', '复古招牌', '几何切割', '线条延展',
  'IP卡通字', '品牌定制字'
];

const CHINESE_TEXT_RULES = [
  '不乱码', '不多字', '不错字', '不擅自改品牌名',
  '只保留指定文案', '标题层级清晰', '中文排版美观', '适配画面构图'
];

const PROMPT_TEMPLATE = `品牌名称：{brandName}
品牌行业：{industry}
品牌关键词：{keywords}
品牌调性：{tone}
主色：{mainColors}
辅助色：{secondaryColors}
Logo使用规则：{logoRules}
产品展示规则：{productRules}
IP使用规则：{ipRules}
字体风格：{fontStyle}
画面构图：{composition}
物料类型：{materialType}
输出比例：{ratio}
文案要求：{copyRequirement}
禁止事项：{forbiddenRules}
生成目标：{target}`;

// 8大物料包（按文档7.1-7.8完整实现）
const MATERIAL_PACKAGES: Record<string, { label: string; items: { name: string; ratio: string }[] }> = {
  'brand-basics': {
    label: '品牌基础包',
    items: [
      { name: 'Logo应用页', ratio: '1:1' },
      { name: '品牌色卡', ratio: '16:9' },
      { name: '品牌字体页', ratio: '16:9' },
      { name: '辅助图形页', ratio: '1:1' },
      { name: '品牌纹样', ratio: '1:1' },
      { name: '品牌Moodboard', ratio: '16:9' },
      { name: '品牌视觉板', ratio: '16:9' },
      { name: '品牌规范一页纸', ratio: '16:9' },
    ]
  },
  'ad-communication': {
    label: '广告传播包',
    items: [
      { name: '品牌主KV', ratio: '16:9' },
      { name: '新品上市海报', ratio: '3:4' },
      { name: '品牌升级海报', ratio: '3:4' },
      { name: '活动海报', ratio: '3:4' },
      { name: '节日海报', ratio: '3:4' },
      { name: '产品广告图', ratio: '16:9' },
      { name: '公交站广告', ratio: '16:9' },
      { name: '地铁灯箱广告', ratio: '4:3' },
      { name: '电梯广告', ratio: '16:9' },
      { name: '户外大牌', ratio: '16:9' },
      { name: '发布会背景板', ratio: '16:9' },
      { name: '展会主视觉', ratio: '16:9' },
      { name: 'LED大屏画面', ratio: '16:9' },
    ]
  },
  'social-media': {
    label: '社媒矩阵包',
    items: [
      { name: '小红书封面', ratio: '3:4' },
      { name: '小红书长图', ratio: '9:16' },
      { name: '抖音封面', ratio: '9:16' },
      { name: '视频号封面', ratio: '1:1' },
      { name: '朋友圈海报', ratio: '1:1' },
      { name: '公众号头图', ratio: '2.35:1' },
      { name: '微博长图', ratio: '9:16' },
      { name: 'B站封面', ratio: '16:9' },
      { name: '直播预告图', ratio: '3:4' },
      { name: '短视频片头视觉', ratio: '16:9' },
      { name: '品牌九宫格', ratio: '1:1' },
      { name: '社媒种草图', ratio: '3:4' },
    ]
  },
  'ecommerce': {
    label: '电商物料包',
    items: [
      { name: '商品主图', ratio: '1:1' },
      { name: '商品场景图', ratio: '1:1' },
      { name: '详情页首屏', ratio: '9:16' },
      { name: '详情页卖点图', ratio: '1:1' },
      { name: '店铺首页Banner', ratio: '16:9' },
      { name: '大促活动图', ratio: '16:9' },
      { name: '优惠券图', ratio: '3:4' },
      { name: '直播间背景', ratio: '16:9' },
      { name: '达人种草图', ratio: '3:4' },
      { name: '信息流广告图', ratio: '1:1' },
      { name: '货架展示图', ratio: '16:9' },
      { name: '产品组合图', ratio: '1:1' },
    ]
  },
  'offline-terminal': {
    label: '线下终端包',
    items: [
      { name: '门头设计', ratio: '16:9' },
      { name: '门店外立面', ratio: '16:9' },
      { name: '橱窗设计', ratio: '4:3' },
      { name: '收银台桌卡', ratio: '4:3' },
      { name: '菜单牌', ratio: '3:4' },
      { name: '价签', ratio: '1:1' },
      { name: '易拉宝', ratio: '2:5' },
      { name: '展架', ratio: '2:5' },
      { name: '地贴', ratio: '16:9' },
      { name: '墙贴', ratio: '4:3' },
      { name: '吊旗', ratio: '1:3' },
      { name: '灯箱', ratio: '16:9' },
      { name: '货架端架', ratio: '4:3' },
      { name: '商超堆头', ratio: '1:1' },
      { name: '导视牌', ratio: '9:16' },
      { name: '打卡墙', ratio: '16:9' },
      { name: '品牌陈列墙', ratio: '16:9' },
    ]
  },
  'pop-space': {
    label: '快闪空间包',
    items: [
      { name: '快闪店外立面', ratio: '16:9' },
      { name: '快闪店门头', ratio: '16:9' },
      { name: '售卖区', ratio: '16:9' },
      { name: '互动区', ratio: '16:9' },
      { name: '打卡区', ratio: '1:1' },
      { name: '收银区', ratio: '4:3' },
      { name: '产品陈列区', ratio: '4:3' },
      { name: '品牌装置', ratio: '1:1' },
      { name: '墙面装饰', ratio: '16:9' },
      { name: '地面导视', ratio: '1:1' },
      { name: '周边展示区', ratio: '4:3' },
      { name: '鸟瞰布局图', ratio: '1:1' },
      { name: '多角度空间效果图', ratio: '16:9' },
    ]
  },
  'packaging': {
    label: '包装周边包',
    items: [
      { name: '包装盒', ratio: '1:1' },
      { name: '包装袋', ratio: '3:4' },
      { name: '礼盒', ratio: '1:1' },
      { name: '瓶贴', ratio: '1:1' },
      { name: '罐身设计', ratio: '3:4' },
      { name: '手提袋', ratio: '3:4' },
      { name: '帆布袋', ratio: '3:4' },
      { name: '贴纸', ratio: '1:1' },
      { name: '徽章', ratio: '1:1' },
      { name: '钥匙扣', ratio: '1:1' },
      { name: 'T恤', ratio: '1:1' },
      { name: '帽子', ratio: '1:1' },
      { name: '杯子', ratio: '1:1' },
      { name: '工牌', ratio: '3:4' },
      { name: '员工围裙', ratio: '3:4' },
      { name: '明信片', ratio: '3:2' },
      { name: '品牌卡片', ratio: '3:2' },
    ]
  },
  'ip-extension': {
    label: 'IP延展包',
    items: [
      { name: 'IP三视图', ratio: '16:9' },
      { name: 'IP表情包', ratio: '1:1' },
      { name: 'IP动作库', ratio: '1:1' },
      { name: 'IP节日海报', ratio: '3:4' },
      { name: 'IP社媒贴纸', ratio: '1:1' },
      { name: 'IP包装应用', ratio: '1:1' },
      { name: 'IP门店装置', ratio: '4:3' },
      { name: 'IP快闪打卡点', ratio: '1:1' },
      { name: 'IP玩偶效果图', ratio: '1:1' },
      { name: 'IP周边效果图', ratio: '1:1' },
      { name: 'IP与产品互动图', ratio: '1:1' },
    ]
  },
};

const PROPOSAL_SECTIONS = [
  '封面', '项目背景', '品牌DNA', '设计目标',
  '创意方向A', '创意方向B', '创意方向C',
  '主KV展示', '核心视觉系统',
  '社媒矩阵展示', '电商物料展示',
  '线下终端展示', '快闪空间展示',
  '包装周边展示', 'IP延展展示',
  '品牌规范页', '物料清单', 'Prompt附录', '最终确认页'
];

const EXPORT_FORMATS = [
  'PDF', 'PPTX', 'Markdown', 'HTML预览页', '图片长图',
  '素材压缩包', 'Prompt包', '品牌资产包'
];

const COMMENT_TYPES = [
  '修改文字', '调整颜色', '更换产品位置', 'Logo放大',
  '画面简洁一点', '更高级一点', '更年轻一点', '更商业一点',
  '去掉某个元素', '保留这个方向'
];

const CLIENT_ACTIONS = [
  '查看创意方向', '查看主KV', '查看整套物料',
  '点赞喜欢方案', '标记不喜欢方案', '添加批注',
  '圈选修改区域', '确认最终方向', '下载预览图'
];

/* ========== TAB DEFINITION ========== */
const TABS = [
  { key: 'projects', label: '项目中心', icon: FolderOpen },
  { key: 'assets', label: '品牌资产', icon: ImageIcon },
  { key: 'logo-generator', label: 'Logo 生成', icon: PenTool },
  { key: 'dna', label: '品牌DNA', icon: Palette },
  { key: 'directions', label: '创意方向', icon: Sparkles },
  { key: 'kv', label: '主KV', icon: Layout },
  { key: 'materials', label: '物料中心', icon: FileText },
  { key: 'consistency', label: '一致性检测', icon: CheckCircle },
  { key: 'versions', label: '版本管理', icon: Clock },
  { key: 'chinese-title', label: '中文标题', icon: Type },
  { key: 'templates', label: '模板中心', icon: BookOpen },
  { key: 'comments', label: '客户批注', icon: MessageSquare },
  { key: 'export', label: '提案导出', icon: Download },
];

/* ========== HELPER ========== */
function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ========== MAIN COMPONENT ========== */
interface BrandFactoryPanelProps {
  onClose: () => void;
  onAddImages?: (urls: string[], meta?: { modelName?: string; apiProvider?: string }) => void;
  isMonochrome?: boolean;
  /** 打开 Logo Generator Skill Pro 面板，传入当前品牌项目 */
  onOpenLogoSkill?: (project: { id: string; brandName: string; mission?: string; vision?: string; tone?: string; colorPalette?: string[]; primaryColor?: string }) => void;
}

export default function BrandFactoryPanel({ onClose, onAddImages, isMonochrome = false, onOpenLogoSkill }: BrandFactoryPanelProps) {
  // === Panel drag state ===
  const [panelPos, setPanelPos] = useState({ x: 0, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // 客户端挂载后设置初始居中位置（避免 Hydration 不匹配）
  useEffect(() => {
    setPanelPos({
      x: Math.max(0, (window.innerWidth - 960) / 2),
      y: Math.max(20, (window.innerHeight - Math.min(window.innerHeight * 0.85, 700)) / 2),
    });
  }, []);

  // === Core state ===
  const [activeTab, setActiveTab] = useState('projects');
  const [projects, setProjects] = useState<BrandProject[]>([]);
  const [currentProject, setCurrentProject] = useState<BrandProject | null>(null);
  const [loading, setLoading] = useState(false);
  const { elapsed: apiElapsed, totalTime: apiTotalTime, startTimer: startApiTimer, stopTimer: stopApiTimer, resetTimer: resetApiTimer, formatTime: formatApiTime } = useProgressTimer();
  const [isMinimized, setIsMinimized] = useState(false);
  const [error, setError] = useState('');

  // === Model selection ===
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [llmModels, setLlmModels] = useState<ImageModel[]>([]);
  const [selectedImageModel, setSelectedImageModel] = useState('');
  const [selectedImageProviderId, setSelectedImageProviderId] = useState('');
  const [selectedLlmModel, setSelectedLlmModel] = useState('');
  const [selectedLlmProviderId, setSelectedLlmProviderId] = useState('');
  const [showModelPanel, setShowModelPanel] = useState(false);

  // === Project create state ===
  const [newProject, setNewProject] = useState({
    brandName: '', industry: '', projectType: '', tone: '',
    keywords: '', targetAudience: '', description: '', logoSource: 'generate' as 'generate' | 'upload' | 'skip'
  });

  // === DNA state ===
  const [dnaStep, setDnaStep] = useState(0);
  const [dnaResult, setDnaResult] = useState<BrandDNA | null>(null);

  // === Direction state ===
  const [dirCount, setDirCount] = useState(3);
  const [generatingDirs, setGeneratingDirs] = useState(false);

  // === KV state ===
  const [kvForm, setKvForm] = useState({ theme: '', slogan: '', ratio: '16:9', direction: '' });
  const [kvImageUrl, setKvImageUrl] = useState('');
  const [kvGenerating, setKvGenerating] = useState(false);

  // === Materials state ===
  const [selectedPkg, setSelectedPkg] = useState<string>('brand-basics');
  const [selectedMats, setSelectedMats] = useState<Set<string>>(new Set());
  const [generatedMats, setGeneratedMats] = useState<GeneratedMaterial[]>([]);
  const [batchGenerating, setBatchGenerating] = useState(false);

  // === Consistency state ===
  const [consistencyResult, setConsistencyResult] = useState<Record<string, number> | null>(null);

  // === Version state ===
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [versionNote, setVersionNote] = useState('');
  const [versionType, setVersionType] = useState<string>('dna');

  // === Chinese title state ===
  const [titleScene, setTitleScene] = useState('品牌主标题');
  const [titleStyle, setTitleStyle] = useState('高级黑体');
  const [titleText, setTitleText] = useState('');
  const [titleResult, setTitleResult] = useState<{ imageUrl?: string; text?: string; scene?: string; style?: string } | null>(null);

  // === Template state ===
  const [templateList, setTemplateList] = useState<BrandTemplate[]>([]);

  // === Comment state ===
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentType, setCommentType] = useState('修改文字');

  // === Export state ===
  const [exportFormat, setExportFormat] = useState('PDF');
  const [exportSections, setExportSections] = useState<Set<string>>(new Set(PROPOSAL_SECTIONS));

  const PANEL_W = 900;
  const PANEL_H = 680;

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPanelPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const handleUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => { document.removeEventListener('mousemove', handleMove); document.removeEventListener('mouseup', handleUp); };
  }, [isDragging]);

  // Center panel on mount
  useEffect(() => {
    const maxH = Math.min(window.innerHeight * 0.85, PANEL_H);
    setPanelPos({
      x: Math.max(0, (window.innerWidth - PANEL_W) / 2),
      y: Math.max(0, (window.innerHeight - maxH) / 2),
    });
  }, []);

  // Load projects
  useEffect(() => { loadProjects(); }, []);

  // Load models from admin system
  useEffect(() => {
    fetch('/api/models?type=image')
      .then(r => r.json())
      .then(data => {
        const providers: { id: string; name: string; [k: string]: unknown }[] = data.providers || [];
        const providerMap = new Map(providers.map(p => [p.id, p]));
        const modelList: { id: string; name: string; providerId?: string }[] = data.models || [];
        if (modelList.length) {
          const mapped = modelList.map(m => {
            const prov = providerMap.get(m.providerId || '');
            return { id: m.id, name: m.name, providerId: m.providerId || '', providerName: prov?.name || '' };
          });
          setImageModels(mapped);
          const saved = localStorage.getItem('wujie_bf_image_model');
          if (saved && mapped.some(m => m.id === saved)) {
            setSelectedImageModel(saved);
            setSelectedImageProviderId(mapped.find(m => m.id === saved)?.providerId || '');
          } else if (mapped.length) {
            setSelectedImageModel(mapped[0].id);
            setSelectedImageProviderId(mapped[0].providerId || '');
          }
        }
      })
      .catch(() => {});

    fetch('/api/models?type=chat')
      .then(r => r.json())
      .then(data => {
        const providers: { id: string; name: string; [k: string]: unknown }[] = data.providers || [];
        const providerMap = new Map(providers.map(p => [p.id, p]));
        const modelList: { id: string; name: string; providerId?: string }[] = data.models || [];
        if (modelList.length) {
          const mapped = modelList.map(m => {
            const prov = providerMap.get(m.providerId || '');
            return { id: m.id, name: m.name, providerId: m.providerId || '', providerName: prov?.name || '' };
          });
          setLlmModels(mapped);
          const saved = localStorage.getItem('wujie_bf_llm_model');
          if (saved && mapped.some(m => m.id === saved)) {
            setSelectedLlmModel(saved);
            setSelectedLlmProviderId(mapped.find(m => m.id === saved)?.providerId || '');
          } else if (mapped.length) {
            setSelectedLlmModel(mapped[0].id);
            setSelectedLlmProviderId(mapped[0].providerId || '');
          }
        }
      })
      .catch(() => {});
  }, []);

  const loadProjects = async () => {
    try {
      const res = await fetch('/api/brand-factory');
      const data = await res.json();
      if (data.success) {
        const parsed = (data.projects || []).map(parseProject);
        setProjects(parsed);
      }
    } catch { /* ignore */ }
  };

  const parseProject = (p: Record<string, unknown>): BrandProject => ({
    id: (p.id as string) || '',
    projectName: (p.project_name as string) || (p.projectName as string) || '',
    brandName: (p.brand_name as string) || (p.brandName as string) || '',
    industry: (p.industry as string) || '',
    projectType: (p.project_type as string) || (p.projectType as string) || '',
    keywords: safeParseJSON<string[]>(p.keywords as string, []),
    targetAudience: (p.target_audience as string) || (p.targetAudience as string) || '',
    tone: (p.tone as string) || '',
    description: (p.description as string) || '',
    logoUrl: (p.logo_url as string) || (p.logoUrl as string) || '',
    productUrl: (p.product_url as string) || (p.productUrl as string) || '',
    ipUrl: (p.ip_url as string) || (p.ipUrl as string) || '',
    referenceUrls: safeParseJSON<string[]>(p.reference_urls as string || p.referenceUrls as string, []),
    brandDna: safeParseJSON<BrandDNA | null>(p.brand_dna as string || p.brandDna as string, null),
    creativeDirections: safeParseJSON<CreativeDirection[]>(p.creative_directions as string || p.creativeDirections as string, []),
    kvImageUrl: (p.kv_image_url as string) || (p.kvImageUrl as string) || '',
    batchResults: safeParseJSON<Array<{item: string; imageUrl: string}>>(p.batch_results as string || p.batchResults as string, []),
    consistencyScores: safeParseJSON<{overall: number; details: Record<string, number>} | null>(p.consistency_scores as string || p.consistencyScores as string, null),
    status: (p.status as string) === 'active' ? 'active' : (p.status as string) === 'completed' ? 'completed' : 'draft',
    isArchived: Boolean(p.is_archived ?? p.isArchived ?? false),
    createdAt: (p.created_at as string) || (p.createdAt as string) || '',
    updatedAt: (p.updated_at as string) || (p.updatedAt as string) || '',
  });

  function safeParseJSON<T>(str: string | null | undefined, fallback: T): T {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  }

  // === API calls (pass model info) ===
  const apiCall = async (action: string, body: Record<string, unknown> = {}) => {
    setLoading(true);
    startApiTimer();
    setError('');
    try {
      const res = await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body, imageModel: selectedImageModel, imageProviderId: selectedImageProviderId, llmModel: selectedLlmModel, llmProviderId: selectedLlmProviderId,
          quality: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).quality : undefined; } catch { return undefined; } })(),
          aspectRatio: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).aspectRatio : undefined; } catch { return undefined; } })(),
        }),      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '操作失败');
      return data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '操作失败';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
      stopApiTimer();
    }
  };

  const handleCreateProject = async () => {
    if (!newProject.brandName) return;
    const data = await apiCall('create-project', {
      brandName: newProject.brandName,
      industry: newProject.industry,
      projectType: newProject.projectType,
      tone: newProject.tone,
      keywords: newProject.keywords,
      targetAudience: newProject.targetAudience,
      description: newProject.description,
    });
    if (data?.project) {
      const proj = parseProject(data.project);
      setProjects(prev => [...prev, proj]);
      setCurrentProject(proj);
      const logoSrc = newProject.logoSource;
      setNewProject({ brandName: '', industry: '', projectType: '', tone: '', keywords: '', targetAudience: '', description: '', logoSource: 'generate' });
      // 如果选择了 AI 生成 Logo，创建项目后自动打开 Logo Generator
      if (logoSrc === 'generate') {
        onOpenLogoSkill?.(data.project);
      }
    }
  };

  const handleDeleteProject = async (id: string) => {
    await apiCall('delete-project', { id });
    setProjects(prev => prev.filter(p => p.id !== id));
    if (currentProject?.id === id) setCurrentProject(null);
  };

  const handleArchiveProject = async (id: string) => {
    await apiCall('archive-project', { id });
    setProjects(prev => prev.map(p => p.id === id ? { ...p, isArchived: true } : p));
  };

  const handleAnalyzeDNA = async () => {
    if (!currentProject) return;
    setDnaStep(1);
    const data = await apiCall('analyze-dna', {
      projectId: currentProject.id,
      brandName: currentProject.brandName,
      industry: currentProject.industry,
      tone: currentProject.tone,
      logoUrl: currentProject.logoUrl,
      productUrl: currentProject.productUrl,
      ipUrl: currentProject.ipUrl,
      referenceUrls: currentProject.referenceUrls,
      keywords: currentProject.keywords,
    });
    if (data?.brandDna) {
      setDnaResult(data.brandDna);
      setDnaStep(2);
      setCurrentProject(prev => prev ? { ...prev, brandDna: data.brandDna } : prev);
    } else {
      setDnaStep(0);
    }
  };

  const handleGenerateDirections = async () => {
    if (!currentProject?.brandDna) return;
    setGeneratingDirs(true);
    const data = await apiCall('generate-directions', {
      projectId: currentProject.id,
      brandDna: currentProject.brandDna,
      count: dirCount,
    });
    if (data?.directions) {
      setCurrentProject(prev => prev ? { ...prev, creativeDirections: data.directions } : prev);
    }
    setGeneratingDirs(false);
  };

  const handleGenerateKV = async () => {
    if (!currentProject) return;
    setKvGenerating(true);
    setKvImageUrl('');
    try {
      const data = await apiCall('generate-kv', {
        projectId: currentProject.id,
        theme: kvForm.theme,
        slogan: kvForm.slogan,
        ratio: kvForm.ratio,
        direction: kvForm.direction,
        brandDna: currentProject.brandDna,
      });
      if (data?.imageUrl) {
        setKvImageUrl(data.imageUrl);
      } else if (data?.taskId) {
        // 异步任务 - 轮询结果
        const maxPolls = 120;
        for (let i = 0; i < maxPolls; i++) {
          const delay = i < 10 ? 1000 : i < 25 ? 1500 : 2000;
          await new Promise(r => setTimeout(r, delay));
          try {
            const pollRes = await fetch(`/api/poll-task`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: data.taskId, model: selectedImageModel, providerId: selectedImageProviderId }),
            });
            const pollData = await pollRes.json();
            if (pollData.status === 'success' || pollData.status === 'completed') {
              const url = pollData.imageUrl || pollData.result?.url || pollData.result?.imageUrl || (pollData.result?.image as Record<string, unknown>)?.url || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url;
              if (url && typeof url === 'string') { setKvImageUrl(url); break; }
            } else if (pollData.status === 'failed') {
              break;
            }
          } catch { /* continue polling */ }
        }
      }
    } finally {
      setKvGenerating(false);
    }
  };

  const handleBatchGenerate = async () => {
    if (!currentProject || selectedMats.size === 0) return;
    setBatchGenerating(true);
    const items = Array.from(selectedMats);
    try {
      const data = await apiCall('batch-generate', {
        projectId: currentProject.id,
        materialType: selectedPkg,
        items,
        brandDna: currentProject.brandDna,
      });
      if (data?.results && Array.isArray(data.results)) {
        const newMats: GeneratedMaterial[] = data.results
          .filter((r: { imageUrl?: string }) => r.imageUrl)
          .map((r: { item: string; imageUrl: string }) => ({
            type: r.item,
            imageUrl: r.imageUrl,
            createdAt: new Date().toISOString(),
          }));
        setGeneratedMats(prev => [...prev, ...newMats]);
      }
    } finally {
      setBatchGenerating(false);
    }
  };

  const handleConsistencyCheck = async () => {
    if (!currentProject) return;
    const data = await apiCall('consistency-check', {
      projectId: currentProject.id,
      brandName: currentProject.brandName,
      brandDna: currentProject.brandDna,
      materials: generatedMats,
    });
    if (data?.scores) setConsistencyResult(data.scores);
  };

  const handleSaveVersion = async () => {
    if (!currentProject) return;
    await apiCall('save-version', {
      projectId: currentProject.id,
      targetType: versionType,
      targetId: currentProject.id,
      versionName: `V${versions.length + 1}`,
      note: versionNote,
      snapshot: { ...currentProject } as Record<string, unknown>,
    });
    setVersions(prev => [...prev, {
      id: genId('ver'), projectId: currentProject.id, targetType: versionType as VersionRecord['targetType'],
      targetId: currentProject.id, versionName: `V${prev.length + 1}`, note: versionNote,
      snapshot: { ...currentProject } as Record<string, unknown>, createdBy: 'user', createdAt: new Date().toISOString()
    }]);
    setVersionNote('');
  };

  const handleGenerateChineseTitle = async () => {
    if (!currentProject || !titleText) return;
    const data = await apiCall('generate-chinese-title', {
      projectId: currentProject.id,
      scene: titleScene,
      style: titleStyle,
      text: titleText,
      brandDna: currentProject.brandDna,
    });
    if (data?.result) setTitleResult(data.result);
  };

  // Theme variables
  const th = isMonochrome ? {
    panel: 'bg-white border border-gray-200 rounded-2xl shadow-2xl',
    header: 'bg-gray-50 border-b border-gray-200 rounded-t-2xl px-4 py-2.5',
    title: 'text-gray-900 font-semibold',
    text: 'text-gray-900',
    textSec: 'text-gray-500',
    textMuted: 'text-gray-400',
    border: 'border-gray-200',
    borderLight: 'border-gray-100',
    input: 'bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-blue-400',
    btn: 'bg-blue-600 text-white font-semibold rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors disabled:opacity-50',
    btnGhost: 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1.5 transition-colors',
    card: 'bg-gray-50 border border-gray-100 rounded-lg',
    select: 'bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-blue-400 appearance-none cursor-pointer',
    sidebar: 'bg-gray-50 border-r border-gray-200',
    sidebarItem: 'flex items-center gap-2 px-3 py-2 text-[11px] rounded-lg cursor-pointer transition-colors',
    sidebarItemActive: 'bg-blue-50 text-blue-700 font-medium',
    sidebarItemInactive: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
    optionBg: 'bg-white',
  } : {
    panel: 'bg-[#1a1a1a] border border-white/[0.08] rounded-2xl shadow-2xl',
    header: 'bg-gradient-to-r from-[#1a1a1a] to-[#141414] border-b border-white/[0.08] rounded-t-2xl px-4 py-2.5',
    title: 'text-gray-100 font-semibold',
    text: 'text-gray-100',
    textSec: 'text-gray-400',
    textMuted: 'text-gray-500',
    border: 'border-white/[0.08]',
    borderLight: 'border-white/[0.06]',
    input: 'bg-[#111] border border-white/[0.08] rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-[#d4af37]/50',
    btn: 'bg-[#d4af37] text-black font-semibold rounded-lg px-4 py-2 hover:bg-[#e5c44a] transition-colors disabled:opacity-50',
    btnGhost: 'text-gray-400 hover:text-gray-100 hover:bg-white/[0.06] rounded-lg px-3 py-1.5 transition-colors',
    card: 'bg-[#111] border border-white/[0.06] rounded-lg',
    select: 'bg-[#111] border border-white/[0.08] rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-[#d4af37]/50 appearance-none cursor-pointer',
    sidebar: 'bg-[#141414] border-r border-white/[0.06]',
    sidebarItem: 'flex items-center gap-2 px-3 py-2 text-[11px] rounded-lg cursor-pointer transition-colors',
    sidebarItemActive: 'bg-[#d4af37]/15 text-[#d4af37] font-medium',
    sidebarItemInactive: 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]',
    optionBg: 'bg-[#1a1a1a]',
  };

  // Accent color class tokens (fully static for Tailwind JIT)
  const ac = isMonochrome ? {
    textAccent: 'text-blue-600',
    textAccentHover: 'hover:text-blue-700',
    bgAccent: 'bg-blue-600',
    bgAccentHover: 'hover:bg-blue-700',
    bgAccent10: 'bg-blue-50',
    bgAccent15: 'bg-blue-100',
    bgAccent20: 'bg-blue-100',
    borderAccent30: 'border-blue-300',
    borderAccent50: 'border-blue-400',
    ringAccent30: 'ring-blue-300',
    accentColor: '#059669',
    accentColorLight: '#d1fae5',
  } : {
    textAccent: 'text-[#d4af37]',
    textAccentHover: 'hover:text-[#e5c44a]',
    bgAccent: 'bg-[#d4af37]',
    bgAccentHover: 'hover:bg-[#e5c44a]',
    bgAccent10: 'bg-[#d4af37]/10',
    bgAccent15: 'bg-[#d4af37]/15',
    bgAccent20: 'bg-[#d4af37]/20',
    borderAccent30: 'border-[#d4af37]/30',
    borderAccent50: 'border-[#d4af37]/50',
    ringAccent30: 'ring-[#d4af37]/30',
    accentColor: '#d4af37',
    accentColorLight: 'rgba(212,175,55,0.15)',
  };

  const noProject = !currentProject;

  // ========== RENDER TAB CONTENT ==========
  const renderTabContent = () => {
    switch (activeTab) {
      case 'projects': return renderProjects();
      case 'assets': return renderAssets();
      case 'logo-generator': return renderLogoGenerator();
      case 'dna': return renderDNA();
      case 'directions': return renderDirections();
      case 'kv': return renderKV();
      case 'materials': return renderMaterials();
      case 'consistency': return renderConsistency();
      case 'versions': return renderVersions();
      case 'chinese-title': return renderChineseTitle();
      case 'templates': return renderTemplates();
      case 'comments': return renderComments();
      case 'export': return renderExport();
      default: return null;
    }
  };

  // ========== PROJECT CENTER ==========
  const renderProjects = () => (
    <div className="space-y-4">
      <div className={`${th.card} p-4 space-y-3`}>
        <h3 className={th.title + ' text-sm'}>新建品牌项目</h3>
        <input className={`${th.input} w-full`} placeholder="品牌名称 *" value={newProject.brandName}
          onChange={e => setNewProject(p => ({ ...p, brandName: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <select className={th.select} value={newProject.industry}
            onChange={e => setNewProject(p => ({ ...p, industry: e.target.value }))}>
            <option value="" className={th.optionBg}>选择行业</option>
            {INDUSTRIES.map(i => <option key={i} value={i} className={th.optionBg}>{i}</option>)}
          </select>
          <select className={th.select} value={newProject.projectType}
            onChange={e => setNewProject(p => ({ ...p, projectType: e.target.value }))}>
            <option value="" className={th.optionBg}>项目类型</option>
            {PROJECT_TYPES.map(t => <option key={t} value={t} className={th.optionBg}>{t}</option>)}
          </select>
        </div>
        <select className={`${th.select} w-full`} value={newProject.tone}
          onChange={e => setNewProject(p => ({ ...p, tone: e.target.value }))}>
          <option value="" className={th.optionBg}>品牌调性</option>
          {TONES.map(t => <option key={t} value={t} className={th.optionBg}>{t}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input className={`${th.input} w-full`} placeholder="关键词（逗号分隔）" value={newProject.keywords}
            onChange={e => setNewProject(p => ({ ...p, keywords: e.target.value }))} />
          <input className={`${th.input} w-full`} placeholder="目标用户" value={newProject.targetAudience}
            onChange={e => setNewProject(p => ({ ...p, targetAudience: e.target.value }))} />
        </div>
        <textarea className={`${th.input} w-full resize-none`} rows={2} placeholder="项目描述" value={newProject.description}
          onChange={e => setNewProject(p => ({ ...p, description: e.target.value }))} />
        {/* Logo 来源选择器 */}
        <div className="space-y-2">
          <h4 className={`${th.textSec} text-xs font-medium`}>Logo 来源</h4>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: 'generate' as const, label: 'AI 生成 Logo', icon: '✨', desc: '使用 Logo Pro 生成' },
              { value: 'upload' as const, label: '上传已有', icon: '📤', desc: '上传现有 Logo' },
              { value: 'skip' as const, label: '暂不设置', icon: '⏭️', desc: '稍后再添加' },
            ]).map(opt => (
              <button key={opt.value}
                className={`p-2 rounded-lg text-center transition-all text-xs ${
                  newProject.logoSource === opt.value
                    ? 'bg-[var(--color-primary,#d4af37)]/15 border border-[var(--color-primary,#d4af37)]/40'
                    : `${th.card} border border-transparent hover:border-[var(--color-primary,#d4af37)]/20`
                }`}
                onClick={() => setNewProject(p => ({ ...p, logoSource: opt.value }))}>
                <span className="block text-base mb-0.5">{opt.icon}</span>
                <span className="block font-medium">{opt.label}</span>
                <span className={`block mt-0.5 ${th.textSec} text-[10px]`}>{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <button className={`${th.btn} w-full`} onClick={handleCreateProject} disabled={loading || !newProject.brandName}>
          <Plus className="w-4 h-4 inline mr-1" />创建项目
        </button>
      </div>

      <div className="space-y-2">
        <h3 className={`${th.textSec} text-xs font-medium`}>已有项目（{projects.length}）</h3>
        {projects.filter(p => !p.isArchived).map(p => (
          <div key={p.id} className={`${th.card} p-3 flex items-center justify-between cursor-pointer ${ac.borderAccent30} transition-colors ${currentProject?.id === p.id ? ac.borderAccent50 : ''}`}
            onClick={() => setCurrentProject(p)}>
            <div className="flex-1 min-w-0">
              <div className={`${th.text} text-sm font-medium truncate`}>{p.brandName}</div>
              <div className={`${th.textMuted} text-xs`}>{p.industry} · {p.projectType || '未设类型'} · {p.tone || '未设调性'}</div>
            </div>
            <div className="flex items-center gap-1 ml-2">
              <button className={`${th.btnGhost} p-1`} onClick={e => { e.stopPropagation(); handleArchiveProject(p.id); }} title="归档"><Archive className="w-3.5 h-3.5" /></button>
              <button className={`${th.btnGhost} p-1 text-red-400 hover:text-red-300`} onClick={e => { e.stopPropagation(); handleDeleteProject(p.id); }} title="删除"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {projects.length === 0 && <div className={`${th.textMuted} text-xs text-center py-4`}>暂无项目，请创建</div>}
      </div>
    </div>
  );

  // ========== LOGO GENERATOR ==========
  const renderLogoGenerator = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择或创建项目</div>}
      {currentProject && (
        <div className={`${th.card} p-4 space-y-3`}>
          <div className="flex items-center gap-2 mb-2">
            <PenTool className={`w-4 h-4 ${ac.textAccent}`} />
            <span className={`${th.title} text-sm`}>Logo 生成器 Pro</span>
          </div>
          <p className={`${th.textSec} text-xs`}>基于 SanbaoAI 专业设计师经验生成品牌 Logo 与品牌系统方向</p>
          {currentProject.logoUrl ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <img src={currentProject.logoUrl} alt="当前Logo" className="w-16 h-16 object-contain rounded bg-black/30" />
                <div>
                  <div className={`${th.text} text-sm font-medium`}>当前已有 Logo</div>
                  <div className={`${th.textMuted} text-xs`}>可重新生成替换</div>
                </div>
              </div>
              <button className={`${th.btn} w-full flex items-center justify-center gap-2`}
                onClick={() => onOpenLogoSkill?.(currentProject)}>
                <PenTool className="w-4 h-4" /> 重新生成 Logo
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className={`${th.textMuted} text-xs text-center py-3`}>当前项目尚无 Logo，使用 AI 专业生成</div>
              <button className={`${th.btn} w-full flex items-center justify-center gap-2`}
                onClick={() => onOpenLogoSkill?.(currentProject)}>
                <PenTool className="w-4 h-4" /> 生成专业 Logo
              </button>
            </div>
          )}
          <div className={`border-t ${th.borderLight} pt-3 mt-3`}>
            <div className={`${th.textSec} text-xs font-medium mb-2`}>快捷入口</div>
            <div className="grid grid-cols-3 gap-2">
              <button className={`${th.btnGhost} text-xs py-2 flex items-center justify-center gap-1`}
                onClick={() => setActiveTab('dna')}><Palette className="w-3 h-3" />品牌DNA</button>
              <button className={`${th.btnGhost} text-xs py-2 flex items-center justify-center gap-1`}
                onClick={() => setActiveTab('kv')}><Layout className="w-3 h-3" />主KV</button>
              <button className={`${th.btnGhost} text-xs py-2 flex items-center justify-center gap-1`}
                onClick={() => setActiveTab('materials')}><FileText className="w-3 h-3" />物料</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ========== BRAND ASSETS ==========
  const renderAssets = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择或创建项目</div>}
      {currentProject && (
        <div className="grid grid-cols-2 gap-4">
          {(['logoUrl', 'productUrl', 'ipUrl'] as const).map(field => {
            const labels: Record<string, string> = { logoUrl: '品牌Logo', productUrl: '产品图片', ipUrl: 'IP形象' };
            const icons: Record<string, React.ReactNode> = { logoUrl: <Star className="w-4 h-4" />, productUrl: <ImageIcon className="w-4 h-4" />, ipUrl: <Users className="w-4 h-4" /> };
            return (
              <div key={field} className={`${th.card} p-4`}>
                <div className="flex items-center gap-2 mb-2">
                  {icons[field]}
                  <span className={`${th.text} text-sm font-medium`}>{labels[field]}</span>
                </div>
                {currentProject[field] ? (
                  <div className="relative group">
                    <img src={currentProject[field]} alt={labels[field]} className="w-full h-32 object-contain rounded bg-black/30" />
                    <button className="absolute top-1 right-1 bg-red-500/80 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setCurrentProject(p => p ? { ...p, [field]: '' } : p)}><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center h-32 border-2 border-dashed ${th.borderLight} rounded-lg cursor-pointer hover:border-blue-300 transition-colors`}>
                    <Upload className="w-5 h-5 text-gray-500 mb-1" />
                    <span className="text-xs text-gray-500">点击上传</span>
                    <input type="file" className="hidden" accept="image/*" onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fd = new FormData();
                      fd.append('file', file);
                      const res = await fetch('/api/save-image', { method: 'POST', body: fd });
                      const data = await res.json();
                      if (data.url) {
                        setCurrentProject(p => p ? { ...p, [field]: data.url } : p);
                        // 同步到后端
                        fetch('/api/brand-factory', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'update-project', id: currentProject?.id, [field]: data.url }),
                        }).catch(() => {});
                      }
                    }} />
                  </label>
                )}
              </div>
            );
          })}

          {/* Reference images */}
          <div className={`${th.card} p-4 col-span-2`}>
            <div className="flex items-center gap-2 mb-2">
              <ImageIcon className="w-4 h-4" />
              <span className={`${th.text} text-sm font-medium`}>参考图</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {currentProject.referenceUrls.map((url, i) => (
                <div key={i} className="relative group">
                  <img src={url} alt="" className="w-full h-20 object-cover rounded" />
                  <button className="absolute top-0.5 right-0.5 bg-red-500/80 text-white rounded p-0.5 opacity-0 group-hover:opacity-100"
                    onClick={() => {
                      setCurrentProject(p => p ? { ...p, referenceUrls: p.referenceUrls.filter((_, j) => j !== i) } : p);
                      // 同步到后端
                      const updatedRefs = currentProject?.referenceUrls.filter((_, j) => j !== i) || [];
                      fetch('/api/brand-factory', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'update-project', id: currentProject?.id, reference_urls: JSON.stringify(updatedRefs) }),
                      }).catch(() => {});
                    }}><X className="w-2.5 h-2.5" /></button>
                </div>
              ))}
              <label className={`flex items-center justify-center h-20 border-2 border-dashed ${th.borderLight} rounded cursor-pointer hover:border-blue-300`}>
                <Plus className="w-4 h-4 text-gray-500" />
                <input type="file" className="hidden" accept="image/*" onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append('file', file);
                  const res = await fetch('/api/save-image', { method: 'POST', body: fd });
                  const data = await res.json();
                  if (data.url) {
                    setCurrentProject(p => p ? { ...p, referenceUrls: [...p.referenceUrls, data.url] } : p);
                    // 同步到后端
                    fetch('/api/brand-factory', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'update-project', id: currentProject?.id, reference_urls: JSON.stringify([...(currentProject?.referenceUrls || []), data.url]) }),
                    }).catch(() => {});
                  }
                }} />
              </label>
            </div>
          </div>

          {/* Brand manual */}
          <div className={`${th.card} p-4 col-span-2`}>
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4" />
              <span className={`${th.text} text-sm font-medium`}>品牌手册</span>
            </div>
            <label className={`flex items-center justify-center h-16 border-2 border-dashed ${th.borderLight} rounded cursor-pointer hover:border-blue-300`}>
              <Upload className="w-4 h-4 text-gray-500 mr-2" />
              <span className="text-xs text-gray-500">上传品牌手册（PDF/图片）</span>
              <input type="file" className="hidden" accept="image/*,.pdf" onChange={() => {}} />
            </label>
          </div>
        </div>
      )}
    </div>
  );

  // ========== BRAND DNA ==========
  const renderDNA = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && (
        <>
          <div className="flex items-center gap-2 text-xs">
            {['上传资料', 'AI分析', '提取DNA', '确认完成'].map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-1 ${dnaStep >= i ? ac.textAccent : th.textMuted}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${dnaStep >= i ? `${ac.bgAccent} text-white` : 'bg-white/[0.06] text-gray-500'}`}>{i + 1}</div>
                  <span>{s}</span>
                </div>
                {i < 3 && <ChevronRight className={`w-3 h-3 ${dnaStep > i ? ac.textAccent : 'text-gray-600'}`} />}
              </React.Fragment>
            ))}
          </div>

          {dnaStep === 0 && (
            <div className={`${th.card} p-6 text-center`}>
              <p className={`${th.textSec} text-sm mb-3`}>请先在「品牌资产」Tab上传Logo、产品图、IP形象等资料</p>
              <button className={th.btn} onClick={handleAnalyzeDNA} disabled={loading}>
                <Zap className="w-4 h-4 inline mr-1" />开始AI分析
                {loading && apiElapsed > 0 && <span className="ml-1 text-xs opacity-70">({formatApiTime(apiElapsed)})</span>}
              </button>
            </div>
          )}

          {dnaStep === 1 && (
            <div className={`${th.card} p-8 text-center`}>
              <RefreshCw className={`w-8 h-8 ${ac.textAccent} animate-spin mx-auto mb-3`} />
              <p className={th.text}>AI正在分析品牌资料...</p>
              <p className={`${th.textMuted} text-xs mt-1`}>提取品牌关键词、色彩、字体方向、视觉调性</p>
            </div>
          )}

          {(dnaStep === 2 || dnaStep === 3) && dnaResult && (
            <div className="grid grid-cols-2 gap-3">
              <div className={`${th.card} p-3`}>
                <div className={`${th.textSec} text-xs mb-1`}>品牌关键词</div>
                <div className="flex flex-wrap gap-1">{dnaResult.brandKeywords.map((k, i) => (
                  <span key={i} className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">{k}</span>
                ))}</div>
              </div>
              <div className={`${th.card} p-3`}>
                <div className={`${th.textSec} text-xs mb-1`}>视觉调性</div>
                <p className={`${th.text} text-sm`}>{dnaResult.visualTone}</p>
              </div>
              <div className={`${th.card} p-3`}>
                <div className={`${th.textSec} text-xs mb-1`}>主色</div>
                <div className="flex gap-2">{dnaResult.mainColors.map((c, i) => (
                  <div key={i} className="flex items-center gap-1"><div className="w-6 h-6 rounded" style={{ background: c }} /><span className="text-xs text-gray-400">{c}</span></div>
                ))}</div>
              </div>
              <div className={`${th.card} p-3`}>
                <div className={`${th.textSec} text-xs mb-1`}>辅助色</div>
                <div className="flex gap-2">{dnaResult.secondaryColors.map((c, i) => (
                  <div key={i} className="flex items-center gap-1"><div className="w-6 h-6 rounded" style={{ background: c }} /><span className="text-xs text-gray-400">{c}</span></div>
                ))}</div>
              </div>
              <div className={`${th.card} p-3`}>
                <div className={`${th.textSec} text-xs mb-1`}>字体方向</div>
                <p className={`${th.text} text-sm`}>{dnaResult.fontStyle}</p>
              </div>
              <div className={`${th.card} p-3`}>
                <div className={`${th.textSec} text-xs mb-1`}>禁区规则</div>
                <ul className="text-xs text-red-400 list-disc ml-4">{dnaResult.forbiddenRules.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              <div className={`${th.card} p-3 col-span-2`}>
                <div className={`${th.textSec} text-xs mb-1`}>Logo使用规则</div>
                <ul className="text-xs text-gray-300 list-disc ml-4">{dnaResult.logoRules.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              <div className={`${th.card} p-3 col-span-2`}>
                <div className={`${th.textSec} text-xs mb-1`}>产品展示规则</div>
                <ul className="text-xs text-gray-300 list-disc ml-4">{dnaResult.productRules.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              <div className={`${th.card} p-3 col-span-2`}>
                <div className={`${th.textSec} text-xs mb-1`}>IP使用规则</div>
                <ul className="text-xs text-gray-300 list-disc ml-4">{dnaResult.ipRules.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              <div className={`${th.card} p-3 col-span-2`}>
                <div className={`${th.textSec} text-xs mb-1`}>推荐物料</div>
                <div className="flex flex-wrap gap-1">{dnaResult.recommendedMaterials.map((m, i) => (
                  <span key={i} className="bg-white/[0.06] text-gray-300 text-xs px-2 py-0.5 rounded">{m}</span>
                ))}</div>
              </div>
              {dnaStep === 2 && (
                <div className="col-span-2 flex gap-2">
                  <button className={`${th.btn} flex-1`} onClick={() => setDnaStep(3)}><CheckCircle className="w-4 h-4 inline mr-1" />确认DNA</button>
                  <button className={`${th.btnGhost} flex-1 border ${th.border}`} onClick={handleAnalyzeDNA}><RefreshCw className="w-4 h-4 inline mr-1" />重新分析</button>
                </div>
              )}
              {dnaStep === 3 && <div className={`col-span-2 text-center ${ac.textAccent} text-xs font-medium`}><CheckCircle className="w-4 h-4 inline mr-1" />品牌DNA已确认</div>}
            </div>
          )}
        </>
      )}
    </div>
  );

  // ========== CREATIVE DIRECTIONS ==========
  const renderDirections = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && !currentProject.brandDna && <div className={`${th.textMuted} text-sm text-center py-8`}>请先完成品牌DNA分析</div>}
      {currentProject?.brandDna && (
        <>
          <div className={`${th.card} p-3 flex items-center gap-3`}>
            <span className={`${th.textSec} text-xs`}>生成数量</span>
            {[3, 6, 9, 12].map(n => (
              <button key={n} className={`px-3 py-1 rounded text-xs ${dirCount === n ? `${ac.bgAccent} text-white font-semibold` : `${th.btnGhost}`}`}
                onClick={() => setDirCount(n)}>{n}套</button>
            ))}
            <button className={`${th.btn} ml-auto text-xs`} onClick={handleGenerateDirections} disabled={generatingDirs}>
              {generatingDirs ? <RefreshCw className="w-3.5 h-3.5 inline mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 inline mr-1" />}
              生成方向
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {currentProject.creativeDirections.map((dir, i) => (
              <div key={dir.id || i} className={`${th.card} p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className={`${th.text} font-medium text-sm`}>{dir.name || `方向 ${String.fromCharCode(65 + i)}`}</h4>
                  <span className={`text-xs ${ac.textAccent}`}>{dir.colorPlan?.length || 0} 色</span>
                </div>
                {dir.concept && <p className={`${th.textSec} text-xs mb-2`}>{dir.concept}</p>}
                {dir.slogan && <p className={`${th.text} text-sm italic mb-2`}>「{dir.slogan}」</p>}
                {dir.visualKeywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">{dir.visualKeywords.map((k, j) => (
                    <span key={j} className="bg-white/[0.06] text-gray-300 text-[10px] px-1.5 py-0.5 rounded">{k}</span>
                  ))}</div>
                )}
                {dir.colorPlan?.length > 0 && (
                  <div className="flex gap-1 mb-2">{dir.colorPlan.map((c, j) => (
                    <div key={j} className="w-6 h-6 rounded" style={{ background: c }} title={c} />
                  ))}</div>
                )}
                {dir.fontPlan && <p className={`${th.textMuted} text-[10px]`}>字体：{dir.fontPlan}</p>}
                {dir.prompt && (
                  <details className="mt-2">
                    <summary className={`${th.textMuted} text-[10px] cursor-pointer hover:text-gray-300`}>查看Prompt</summary>
                    <pre className="text-[10px] text-gray-400 mt-1 whitespace-pre-wrap bg-black/30 p-2 rounded">{dir.prompt}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>

          {currentProject.creativeDirections.length === 0 && !generatingDirs && (
            <div className={`${th.textMuted} text-sm text-center py-4`}>点击上方按钮生成创意方向</div>
          )}
        </>
      )}
    </div>
  );

  // ========== MAIN KV ==========
  const renderKV = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && (
        <div className="grid grid-cols-2 gap-4">
          <div className={`${th.card} p-4 space-y-3`}>
            <h3 className={th.title + ' text-sm'}>主KV生成</h3>
            <input className={`${th.input} w-full`} placeholder="主题文案" value={kvForm.theme}
              onChange={e => setKvForm(f => ({ ...f, theme: e.target.value }))} />
            <input className={`${th.input} w-full`} placeholder="传播语 / Slogan" value={kvForm.slogan}
              onChange={e => setKvForm(f => ({ ...f, slogan: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <select className={th.select} value={kvForm.ratio}
                onChange={e => setKvForm(f => ({ ...f, ratio: e.target.value }))}>
                {['16:9', '4:3', '3:4', '1:1', '9:16', '2.35:1'].map(r => <option key={r} value={r} className={th.optionBg}>{r}</option>)}
              </select>
              <select className={th.select} value={kvForm.direction}
                onChange={e => setKvForm(f => ({ ...f, direction: e.target.value }))}>
                <option value="" className={th.optionBg}>选择创意方向</option>
                {currentProject.creativeDirections.map((d, i) => <option key={d.id || i} value={d.id || i} className={th.optionBg}>{d.name || `方向${String.fromCharCode(65 + i)}`}</option>)}
              </select>
            </div>
            <button className={`${th.btn} w-full`} onClick={handleGenerateKV} disabled={loading}>
              <Layout className="w-4 h-4 inline mr-1" />生成主KV
              {loading && apiElapsed > 0 && <span className="ml-2 text-xs opacity-70">({formatApiTime(apiElapsed)})</span>}
            </button>
            {kvImageUrl && (
              <div className="mt-2 rounded-lg overflow-hidden border border-white/[0.06]">
                <img src={kvImageUrl} alt="KV主视觉" className="w-full h-auto" crossOrigin="anonymous" />
                <div className="flex gap-1.5 p-1.5">
                  <button className={`${th.btnGhost} text-[10px] px-2 py-1 border ${th.borderLight}`}
                    onClick={() => {
                      if (onAddImages) {
                        const meta: { modelName?: string; apiProvider?: string } = {};
                        if (selectedImageModel) {
                          const pureModelId = selectedImageModel.includes('::') ? selectedImageModel.split('::').pop()! : selectedImageModel;
                          meta.modelName = pureModelId;
                          if (selectedImageProviderId) meta.apiProvider = selectedImageProviderId;
                        }
                        onAddImages([kvImageUrl], meta);
                      }
                    }}>添加到画布</button>
                  <button className={`${th.btnGhost} text-[10px] px-2 py-1 border ${th.borderLight}`}
                    onClick={() => setKvImageUrl('')}>清除</button>
                </div>
              </div>
            )}
          </div>

          <div className={`${th.card} p-4`}>
            <h4 className={`${th.textSec} text-xs font-medium mb-2`}>快捷优化</h4>
            <div className="flex flex-wrap gap-1.5">
              {KV_QUICK_FIXES.map(fix => (
                <button key={fix} className={`${th.btnGhost} text-[11px] border ${th.borderLight}`}
                  onClick={() => setKvForm(f => ({ ...f, theme: f.theme ? `${f.theme}, ${fix}` : fix }))}>{fix}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ========== MATERIALS CENTER ==========
  const renderMaterials = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && (
        <>
          <div className={`${th.card} p-3`}>
            <h4 className={`${th.textSec} text-xs font-medium mb-2`}>物料包</h4>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(MATERIAL_PACKAGES).map(([key, pkg]) => (
                <button key={key} className={`px-2 py-1.5 rounded text-[11px] text-center transition-colors ${selectedPkg === key ? `${ac.bgAccent} text-white font-semibold` : `${th.btnGhost} border ${th.borderLight}`}`}
                  onClick={() => { setSelectedPkg(key); setSelectedMats(new Set()); }}>
                  {pkg.label}
                </button>
              ))}
            </div>
          </div>

          <div className={`${th.card} p-3`}>
            <div className="flex items-center justify-between mb-2">
              <h4 className={`${th.textSec} text-xs font-medium`}>{MATERIAL_PACKAGES[selectedPkg]?.label} ({MATERIAL_PACKAGES[selectedPkg]?.items.length})</h4>
              <button className={`${th.btnGhost} text-[10px]`} onClick={() => {
                const all = MATERIAL_PACKAGES[selectedPkg]?.items.map(i => i.name) || [];
                setSelectedMats(new Set(selectedMats.size === all.length ? [] : all));
              }}>{selectedMats.size === (MATERIAL_PACKAGES[selectedPkg]?.items.length || 0) ? '取消全选' : '全选'}</button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
              {MATERIAL_PACKAGES[selectedPkg]?.items.map(item => (
                <label key={item.name} className={`flex items-center gap-1.5 p-1.5 rounded cursor-pointer transition-colors ${selectedMats.has(item.name) ? `${ac.bgAccent10} border ${ac.borderAccent30}` : `hover:bg-white/[0.03] border border-transparent`}`}>
                  <input type="checkbox" className="accent-blue-600 w-3 h-3" checked={selectedMats.has(item.name)}
                    onChange={() => {
                      setSelectedMats(prev => {
                        const next = new Set(prev);
                        next.has(item.name) ? next.delete(item.name) : next.add(item.name);
                        return next;
                      });
                    }} />
                  <span className={`text-[11px] truncate ${selectedMats.has(item.name) ? th.text : th.textSec}`}>{item.name}</span>
                  <span className="text-[9px] text-gray-600 ml-auto">{item.ratio}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button className={`${th.btn} text-xs py-2`} onClick={handleBatchGenerate} disabled={batchGenerating || selectedMats.size === 0}>
              {batchGenerating ? <RefreshCw className="w-3 h-3 inline mr-1 animate-spin" /> : <Zap className="w-3 h-3 inline mr-1" />}批量生成
              {batchGenerating && apiElapsed > 0 && <span className="ml-1 opacity-70">({formatApiTime(apiElapsed)})</span>}
            </button>
            <button className={`${th.btnGhost} text-xs border ${th.borderLight} py-2`}><PenTool className="w-3 h-3 inline mr-1" />单张优化</button>
            <button className={`${th.btnGhost} text-xs border ${th.borderLight} py-2`}><Palette className="w-3 h-3 inline mr-1" />统一风格</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button className={`${th.btnGhost} text-xs border ${th.borderLight} py-2`} onClick={handleConsistencyCheck}><CheckCircle className="w-3 h-3 inline mr-1" />检测一致性</button>
            <button className={`${th.btnGhost} text-xs border ${th.borderLight} py-2`}><Save className="w-3 h-3 inline mr-1" />保存到资产库</button>
            <button className={`${th.btnGhost} text-xs border ${th.borderLight} py-2`}><Download className="w-3 h-3 inline mr-1" />导出选中物料</button>
          </div>
          {currentProject?.batchResults && currentProject.batchResults.length > 0 && (
            <div className="space-y-2">
              <h4 className={`${th.textSec} text-xs font-medium`}>生成结果</h4>
              <div className="grid grid-cols-2 gap-2">
                {currentProject.batchResults.map((r: {item: string; imageUrl: string}, i: number) => (
                  <div key={i} className="rounded-lg overflow-hidden border border-white/[0.06]">
                    <img src={r.imageUrl} alt={r.item} className="w-full h-auto" crossOrigin="anonymous" />
                    <div className="flex items-center justify-between p-1">
                      <span className="text-[10px] text-white/60">{r.item}</span>
                      <button className={`${th.btnGhost} text-[10px] px-1 py-0.5`}
                        onClick={() => {
                          if (onAddImages) {
                            const meta: { modelName?: string; apiProvider?: string } = {};
                            if (selectedImageModel) {
                              const pureModelId = selectedImageModel.includes('::') ? selectedImageModel.split('::').pop()! : selectedImageModel;
                              meta.modelName = pureModelId;
                              if (selectedImageProviderId) meta.apiProvider = selectedImageProviderId;
                            }
                            onAddImages([r.imageUrl], meta);
                          }
                        }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
              <button className={`${th.btnGhost} text-xs border ${th.borderLight} w-full py-1.5`}
                onClick={() => {
                  if (onAddImages) {
                    const meta: { modelName?: string; apiProvider?: string } = {};
                    if (selectedImageModel) {
                      const pureModelId = selectedImageModel.includes('::') ? selectedImageModel.split('::').pop()! : selectedImageModel;
                      meta.modelName = pureModelId;
                      if (selectedImageProviderId) meta.apiProvider = selectedImageProviderId;
                    }
                    onAddImages(currentProject.batchResults.map((r: {item: string; imageUrl: string}) => r.imageUrl), meta);
                  }
                }}>全部添加到画布</button>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ========== CONSISTENCY CHECK ==========
  const renderConsistency = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && (
        <>
          <button className={`${th.btn} w-full`} onClick={handleConsistencyCheck} disabled={loading}>
            <CheckCircle className="w-4 h-4 inline mr-1" />开始一致性检测
          </button>

          {consistencyResult && (
            <div className="grid grid-cols-2 gap-2">
              {CONSISTENCY_DIMENSIONS.map(dim => {
                const score = consistencyResult[dim.key] || 0;
                const color = score >= 90 ? 'text-green-400' : score >= 70 ? 'text-yellow-400' : 'text-red-400';
                return (
                  <div key={dim.key} className={`${th.card} p-2.5`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`${th.textSec} text-[11px]`}>{dim.label}</span>
                      <span className={`${color} text-xs font-semibold`}>{score}/100</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${score >= 90 ? 'bg-green-400' : score >= 70 ? 'bg-yellow-400' : 'bg-red-400'}`}
                        style={{ width: `${score}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className={`${th.card} p-4`}>
            <h4 className={`${th.textSec} text-xs font-medium mb-2`}>一键修复</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {FIX_BUTTONS.map(fix => (
                <button key={fix} className={`${th.btnGhost} text-[11px] border ${th.borderLight} py-1.5`}>{fix}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );

  // ========== VERSION MANAGEMENT ==========
  const renderVersions = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && (
        <>
          <div className={`${th.card} p-4 space-y-3`}>
            <h3 className={th.title + ' text-sm'}>保存版本</h3>
            <select className={`${th.select} w-full`} value={versionType} onChange={e => setVersionType(e.target.value)}>
              {VERSION_TYPES.map(vt => <option key={vt.value} value={vt.value} className={th.optionBg}>{vt.label}</option>)}
            </select>
            <input className={`${th.input} w-full`} placeholder="版本备注" value={versionNote}
              onChange={e => setVersionNote(e.target.value)} />
            <button className={`${th.btn} w-full`} onClick={handleSaveVersion}><Save className="w-4 h-4 inline mr-1" />保存当前版本</button>
          </div>

          <div className="space-y-2">
            <h4 className={`${th.textSec} text-xs font-medium`}>版本历史</h4>
            {versions.length === 0 && <div className={`${th.textMuted} text-xs text-center py-4`}>暂无版本记录</div>}
            {versions.map((v, i) => (
              <div key={v.id} className={`${th.card} p-3 flex items-start gap-3`}>
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-blue-100 text-blue-700`}>{i + 1}</div>
                  {i < versions.length - 1 && <div className="w-px h-4 bg-white/[0.06]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`${th.text} text-sm font-medium`}>{v.versionName}</span>
                    <span className={`text-[10px] ${ac.textAccent} ${ac.bgAccent10} px-1.5 py-0.5 rounded`}>{VERSION_TYPES.find(vt => vt.value === v.targetType)?.label}</span>
                  </div>
                  {v.note && <p className={`${th.textMuted} text-xs mt-0.5`}>{v.note}</p>}
                  <p className={`${th.textMuted} text-[10px] mt-0.5`}>{new Date(v.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-1">
                  <button className={`${th.btnGhost} p-1`} title="恢复"><RotateCcw className="w-3 h-3" /></button>
                  <button className={`${th.btnGhost} p-1`} title="复制为新版本"><Copy className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>

          {versions.length >= 2 && (
            <div className={`${th.card} p-3`}>
              <div className="flex gap-2">
                <button className={`${th.btnGhost} flex-1 text-xs border ${th.borderLight}`}><Eye className="w-3 h-3 inline mr-1" />对比两个版本</button>
                <button className={`${th.btnGhost} flex-1 text-xs border ${th.borderLight}`}><Download className="w-3 h-3 inline mr-1" />导出版本记录</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ========== CHINESE TITLE DESIGN ==========
  const renderChineseTitle = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && (
        <div className="grid grid-cols-2 gap-4">
          <div className={`${th.card} p-4 space-y-3`}>
            <h3 className={th.title + ' text-sm'}>中文标题字设计</h3>
            <div>
              <label className={`${th.textSec} text-xs block mb-1`}>应用场景</label>
              <select className={`${th.select} w-full`} value={titleScene} onChange={e => setTitleScene(e.target.value)}>
                {CHINESE_TITLE_SCENES.map(s => <option key={s} value={s} className={th.optionBg}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={`${th.textSec} text-xs block mb-1`}>字体风格</label>
              <select className={`${th.select} w-full`} value={titleStyle} onChange={e => setTitleStyle(e.target.value)}>
                {CHINESE_TITLE_STYLES.map(s => <option key={s} value={s} className={th.optionBg}>{s}</option>)}
              </select>
            </div>
            <input className={`${th.input} w-full`} placeholder="输入标题文字" value={titleText}
              onChange={e => setTitleText(e.target.value)} />
            <button className={`${th.btn} w-full`} onClick={handleGenerateChineseTitle} disabled={loading || !titleText}>
              <Type className="w-4 h-4 inline mr-1" />生成标题字
              {loading && apiElapsed > 0 && <span className="ml-2 text-xs opacity-70">({formatApiTime(apiElapsed)})</span>}
            </button>
          </div>

          <div className="space-y-4">
            {titleResult && (
              <div className={`${th.card} p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className={`${th.textSec} text-xs`}>生成结果</h4>
                  {apiTotalTime !== null && apiTotalTime > 0 && <span className={`${th.textMuted} text-[11px]`}>总耗时 {formatApiTime(apiTotalTime)}</span>}
                </div>
                {titleResult.imageUrl && (
                  <img src={titleResult.imageUrl} alt="中文标题" className="w-full rounded mb-2" />
                )}
                {titleResult.text && (
                  <pre className={`${th.text} text-sm whitespace-pre-wrap bg-black/30 p-3 rounded`}>{titleResult.text}</pre>
                )}
                {!titleResult.imageUrl && !titleResult.text && (
                  <pre className={`${th.text} text-sm whitespace-pre-wrap bg-black/30 p-3 rounded`}>{JSON.stringify(titleResult, null, 2)}</pre>
                )}
              </div>
            )}

            <div className={`${th.card} p-4`}>
              <h4 className={`${th.textSec} text-xs font-medium mb-2`}>中文文字保护规则</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {CHINESE_TEXT_RULES.map(rule => (
                  <div key={rule} className="flex items-center gap-1.5 text-[11px]">
                    <CheckCircle className={`w-3 h-3 ${ac.textAccent} flex-shrink-0`} />
                    <span className="text-gray-300">{rule}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ========== TEMPLATE CENTER ==========
  const renderTemplates = () => (
    <div className="space-y-4">
      <div className={`${th.card} p-4`}>
        <h3 className={th.title + ' text-sm mb-3'}>模板中心</h3>
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATE_CATEGORIES.map(cat => (
            <button key={cat} className={`${th.btnGhost} text-xs border ${th.borderLight} py-2 text-left hover:border-blue-300`}>
              <BookOpen className="w-3 h-3 inline mr-1" />{cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={`${th.card} p-4 space-y-3`}>
          <h4 className={`${th.textSec} text-xs font-medium`}>模板包含内容</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {['推荐物料', '推荐比例', '推荐构图', '推荐文案结构', '推荐风格', '推荐色彩', '推荐Mockup', '推荐导出格式', '默认Prompt', '禁用规则'].map(item => (
              <div key={item} className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <ChevronRight className={`w-3 h-3 ${ac.textAccent}`} />{item}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <button className={`${th.btn} w-full text-xs`}><BookOpen className="w-3 h-3 inline mr-1" />套用模板</button>
          <button className={`${th.btnGhost} w-full text-xs border ${th.borderLight}`}><Save className="w-3 h-3 inline mr-1" />保存为模板</button>
          <button className={`${th.btnGhost} w-full text-xs border ${th.borderLight}`}><Copy className="w-3 h-3 inline mr-1" />复制模板</button>
          <button className={`${th.btnGhost} w-full text-xs border ${th.borderLight}`}><PenTool className="w-3 h-3 inline mr-1" />编辑模板</button>
        </div>
      </div>
    </div>
  );

  // ========== CLIENT COMMENTS ==========
  const renderComments = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className={`${th.card} p-4`}>
              <h3 className={th.title + ' text-sm mb-2'}>客户可操作</h3>
              <div className="flex flex-wrap gap-1.5">
                {CLIENT_ACTIONS.map(action => (
                  <span key={action} className="bg-white/[0.06] text-gray-300 text-[10px] px-2 py-0.5 rounded">{action}</span>
                ))}
              </div>
            </div>

            <div className={`${th.card} p-4`}>
              <h4 className={`${th.textSec} text-xs font-medium mb-2`}>批注类型</h4>
              <div className="flex flex-wrap gap-1.5">
                {COMMENT_TYPES.map(type => (
                  <button key={type} className={`text-[10px] px-2 py-0.5 rounded ${commentType === type ? 'bg-blue-100 text-blue-700' : 'bg-white/[0.06] text-gray-400'}`}
                    onClick={() => setCommentType(type)}>{type}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className={`${th.card} p-4 space-y-2`}>
              <textarea className={`${th.input} w-full resize-none`} rows={3} placeholder="添加批注..."
                value={newComment} onChange={e => setNewComment(e.target.value)} />
              <button className={`${th.btn} w-full text-xs`} onClick={() => {
                if (!newComment) return;
                setComments(prev => [...prev, {
                  id: genId('cmt'), targetType: 'project', targetId: currentProject.id,
                  author: 'user', type: commentType, content: newComment, createdAt: new Date().toISOString()
                }]);
                setNewComment('');
              }}><MessageSquare className="w-3 h-3 inline mr-1" />添加批注</button>
            </div>

            {comments.map(c => (
              <div key={c.id} className={`${th.card} p-3`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{c.type}</span>
                  <span className="text-[10px] text-gray-600">{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <p className={`${th.text} text-xs`}>{c.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ========== PROPOSAL EXPORT ==========
  const renderExport = () => (
    <div className="space-y-4">
      {noProject && <div className={`${th.textMuted} text-sm text-center py-8`}>请先选择项目</div>}
      {currentProject && (
        <div className="grid grid-cols-2 gap-4">
          <div className={`${th.card} p-4`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className={th.title + ' text-sm'}>提案结构</h3>
              <button className={`${th.btnGhost} text-[10px]`}
                onClick={() => setExportSections(exportSections.size === PROPOSAL_SECTIONS.length ? new Set() : new Set(PROPOSAL_SECTIONS))}>
                {exportSections.size === PROPOSAL_SECTIONS.length ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {PROPOSAL_SECTIONS.map(section => (
                <label key={section} className="flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-white/[0.03]">
                  <input type="checkbox" className="accent-blue-600 w-3 h-3"
                    checked={exportSections.has(section)}
                    onChange={() => {
                      setExportSections(prev => {
                        const next = new Set(prev);
                        next.has(section) ? next.delete(section) : next.add(section);
                        return next;
                      });
                    }} />
                  <span className={`${th.textSec} text-xs`}>{section}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className={`${th.card} p-4`}>
              <h4 className={`${th.textSec} text-xs font-medium mb-2`}>导出格式</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {EXPORT_FORMATS.map(fmt => (
                  <button key={fmt} className={`px-2 py-1.5 rounded text-[11px] transition-colors ${exportFormat === fmt ? `${ac.bgAccent} text-white font-semibold` : `${th.btnGhost} border ${th.borderLight}`}`}
                    onClick={() => setExportFormat(fmt)}>{fmt}</button>
                ))}
              </div>
            </div>

            <div className={`${th.card} p-4`}>
              <h4 className={`${th.textSec} text-xs font-medium mb-2`}>品牌Prompt预览</h4>
              <pre className="text-[10px] text-gray-400 whitespace-pre-wrap bg-black/30 p-2 rounded max-h-48 overflow-y-auto">
                {currentProject.brandDna ? PROMPT_TEMPLATE
                  .replace('{brandName}', currentProject.brandName)
                  .replace('{industry}', currentProject.industry)
                  .replace('{keywords}', currentProject.keywords.join('、'))
                  .replace('{tone}', currentProject.tone)
                  .replace('{mainColors}', currentProject.brandDna.mainColors.join('、'))
                  .replace('{secondaryColors}', currentProject.brandDna.secondaryColors.join('、'))
                  .replace('{logoRules}', currentProject.brandDna.logoRules.join('；'))
                  .replace('{productRules}', currentProject.brandDna.productRules.join('；'))
                  .replace('{ipRules}', currentProject.brandDna.ipRules.join('；'))
                  .replace('{fontStyle}', currentProject.brandDna.fontStyle)
                  .replace('{forbiddenRules}', currentProject.brandDna.forbiddenRules.join('；'))
                  : '请先完成品牌DNA分析'}
              </pre>
            </div>

            <button className={`${th.btn} w-full`} disabled={loading}>
              <Download className="w-4 h-4 inline mr-1" />导出提案
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ========== MODEL SELECTION PANEL ==========
  const renderModelPanel = () => (
    <div className={`absolute top-full left-0 right-0 ${th.card} border-t-0 rounded-b-xl p-4 z-10 ${showModelPanel ? '' : 'hidden'}`}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Cpu className={`w-3.5 h-3.5 ${ac.textAccent}`} />
            <span className={`${th.textSec} text-xs font-medium`}>图像生成模型</span>
          </div>
          <select className={`${th.select} w-full text-xs`} value={selectedImageModel}
            onChange={e => {
              setSelectedImageModel(e.target.value);
              setSelectedImageProviderId(imageModels.find(m => m.id === e.target.value)?.providerId || '');
              localStorage.setItem('wujie_bf_image_model', e.target.value);
            }}>
            {imageModels.map(m => (
              <option key={m.id} value={m.id} className={th.optionBg}>{m.name}{m.providerName ? ` (${m.providerName})` : ''}</option>
            ))}
          </select>
          {imageModels.length === 0 && <p className={`${th.textMuted} text-[10px] mt-1`}>请在管理员系统配置图像模型</p>}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className={`w-3.5 h-3.5 ${ac.textAccent}`} />
            <span className={`${th.textSec} text-xs font-medium`}>LLM分析模型</span>
          </div>
          <select className={`${th.select} w-full text-xs`} value={selectedLlmModel}
            onChange={e => {
              setSelectedLlmModel(e.target.value);
              setSelectedLlmProviderId(llmModels.find(m => m.id === e.target.value)?.providerId || '');
              localStorage.setItem('wujie_bf_llm_model', e.target.value);
            }}>
            {llmModels.map(m => (
              <option key={m.id} value={m.id} className={th.optionBg}>{m.name}{m.providerName ? ` (${m.providerName})` : ''}</option>
            ))}
          </select>
          {llmModels.length === 0 && <p className={`${th.textMuted} text-[10px] mt-1`}>请在管理员系统配置LLM模型</p>}
        </div>
      </div>
    </div>
  );

  // ========== MAIN RENDER ==========
  return (
    <div
      ref={panelRef}
      className={`fixed z-[90] ${isDragging ? 'cursor-grabbing' : ''}`}
      style={{ left: panelPos.x, top: panelPos.y, width: PANEL_W }}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      <div
        data-floating-panel="true"
        className={`${th.panel} flex flex-col overflow-hidden ${isDragging ? `ring-2 ${ac.ringAccent30} shadow-[0_0_30px_${ac.accentColorLight}]` : ''}`}
        style={{ maxHeight: isMinimized ? undefined : '85vh' }}
      >
        {/* Header with drag handle */}
        <div className={`${th.header} flex items-center gap-2 cursor-grab active:cursor-grabbing select-none relative ${isMinimized ? 'rounded-2xl border-b-0' : ''}`}
          onMouseDown={handleDragStart}>
          <GripVertical className="w-4 h-4 text-gray-500" />
          <img src="/logo.png" alt="" className="w-4 h-4 object-contain rounded" />
          <Building2 className={`w-4 h-4 ${ac.textAccent}`} />
          <span className={th.title + ' text-sm flex-1'}>品牌工厂</span>
          {currentProject && <span className={`text-[10px] ${ac.textAccent} ${ac.bgAccent10} px-2 py-0.5 rounded`}>{currentProject.brandName}</span>}
          {/* Model toggle button */}
          <button className={`${th.btnGhost} flex items-center gap-1 text-[10px] ${showModelPanel ? ac.textAccent : ''}`}
            onClick={e => { e.stopPropagation(); setShowModelPanel(!showModelPanel); }}>
            <Cpu className="w-3 h-3" />
            <span>模型</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showModelPanel ? 'rotate-180' : ''}`} />
          </button>
          <button className={`${th.btnGhost} p-1`} onClick={() => setIsMinimized(!isMinimized)}><Minus className="w-4 h-4" /></button>
          <button className={`${th.btnGhost} p-1`} onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {/* Model selection dropdown */}
        {renderModelPanel()}

        {/* Body: Left sidebar + Right content */}
        {!isMinimized && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left sidebar tabs */}
          <div className={`${th.sidebar} w-[120px] shrink-0 overflow-y-auto py-2 px-1.5 space-y-0.5`} style={{ scrollbarWidth: 'none' }}>
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key}
                  className={`${th.sidebarItem} ${activeTab === tab.key ? th.sidebarItemActive : th.sidebarItemInactive}`}
                  onClick={() => setActiveTab(tab.key)}>
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
          {/* Right content area */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin' }}>
            {error && <div className="bg-red-500/10 text-red-400 text-xs p-2 rounded mb-3">{error}</div>}
            {renderTabContent()}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
