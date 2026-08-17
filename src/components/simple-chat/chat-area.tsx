"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Menu, Paperclip, ArrowUp, Globe, X, Settings, Bot, User as UserIcon, BookOpen, ChevronDown, Copy, RefreshCw, Trash2, Zap, Sun, Moon, FileText, Database, Sparkles, MessageSquarePlus, Minimize2, Maximize2, MoreHorizontal, Telescope, FileCode, GitBranch, Share2, Search, Eye, EyeOff, Image, Download, Send, Shield, ThumbsUp, ThumbsDown, Pencil, PenSquare, Brain, PenLine, ScanSearch, Clock } from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";
import { ImageLightbox } from "./image-lightbox";
import { QuickCommands } from "./quick-commands";
import { CanvasEditor } from "./canvas-editor";
import { MemoryPanel, type MemoryItem } from "./memory-panel";
import { GlobalSearch } from "./global-search";
import { ShareDialog } from "./share-dialog";
import { PromptOptimizer } from "./prompt-optimizer";
import { ReportExport } from "./report-export";
import { ModelCompare } from "./model-compare";
import { UsageStats } from "./usage-stats";
import {
  SimpleChatProject, SimpleChatTask, SimpleChatMessage, SimpleChatAgent, ChatAttachment, ChatArtifact,
  ProjectInstructions, ProjectKnowledgeItem,
  PRESET_SKILLS, PresetSkill, alignSimpleChatMediaSlots, canTransferSimpleChatMedia,
  mergeSimpleChatCanvasBridgeReferences, parseSimpleChatCanvasBridgePayload,
  sendSimpleChatMediaToCanvas, type WorkspaceAssetReference
} from "./simple-chat-types";
import { User } from "@/lib/user-types";
import type { ReasoningEffort, ResponseSpeed, ResolvedChatControls } from "@/lib/chat-generation-controls";
import { useTheme } from "@/app/simple-chat/providers";
import { AgentProgressTimeline } from "@/components/agent-runtime/AgentProgressTimeline";
import { useAgentRunEvents } from "@/components/agent-runtime/use-agent-run-events";

type ChatModelInfo = {
  id: string;
  name: string;
  modelId: string;
  originalName?: string;
  providerId: string;
  providerName?: string;
  tags?: string[];
};

type CanvasProjectOption = {
  id: string;
  name: string;
};

function AgentRunMessageProgress({ runId }: { runId: string }) {
  const run = useAgentRunEvents(runId);
  return (
    <AgentProgressTimeline
      projection={run.projection}
      stale={run.stale}
      onCancel={() => { void run.cancel(); }}
    />
  );
}

function readWorkspaceAssetReference(value: unknown): WorkspaceAssetReference | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.url !== 'string' || !candidate.url) return null;
  return {
    url: candidate.url,
    ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
    ...(typeof candidate.assetId === 'string' ? { assetId: candidate.assetId } : {}),
    ...(typeof candidate.assetVersionId === 'string' ? { assetVersionId: candidate.assetVersionId } : {}),
    ...(typeof candidate.placementId === 'string' ? { placementId: candidate.placementId } : {}),
    ...(typeof candidate.entityId === 'string' ? { entityId: candidate.entityId } : {}),
  };
}
interface ChatAreaProps {
  user: User;
  project: SimpleChatProject | null;
  task: SimpleChatTask | null;
  onUpdateTask: (task: SimpleChatTask) => void;
  onUpdateProject: (project: SimpleChatProject) => void;
  onCreateTask: (projectId: string, initialData?: { name?: string; messages?: SimpleChatMessage[]; model?: string; providerId?: string }) => void;
  onSelectTask: (task: SimpleChatTask) => void;
  onUpdateAgent: (agent: SimpleChatAgent) => void;
  onDeleteAgent: (agentId: string) => void;
  onSkillToAgent: (skill: PresetSkill) => void;
  onLogout: () => void;
  onBackToWorkspace: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const MODEL_TAGS: Record<string, string[]> = {
  'gpt-4o': ['多模态', '128K'],
  'gpt-4o-mini': ['快速', '128K'],
  'gpt-4-turbo': ['128K', '推理'],
  'gpt-5.5': ['多模态', '256K', '推理'],
  'gpt-5.5-xhigh': ['多模态', '256K', '深度推理'],
  'gemini-2.5-flash': ['多模态', '1M'],
  'gemini-2.5-pro': ['多模态', '1M', '推理'],
  'gemini-3.1-flash-lite': ['多模态', '1M', '快速'],
  'claude-3.5-sonnet': ['200K', '推理'],
  'deepseek-chat': ['128K', '推理'],
  'deepseek-v4-flash': ['128K', '推理', '快速'],
  'deepseek-r1': ['推理', '深度思考'],
  'doubao-1.5-pro': ['128K', '中文'],
  'qwen-max': ['中文', '推理'],
};

// 联网搜索结果卡片
function SearchResultsCard({ content }: { content: string }) {
  const parsed = useMemo(() => {
    const items: Array<{ idx: number; title: string; url: string; snippet: string; summary?: string }> = [];
    const keywordMatch = content.match(/搜索关键词[：:]\s*"?(.+?)"?\n/);
    const keyword = keywordMatch?.[1] || '';

    const regex = /\[(\d+)\]\s+(.+?)\nURL:\s*(.+?)\n摘要:\s*(.+?)(?:\nAI摘要:\s*(.+?))?(?=\n\n\[|$)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      items.push({
        idx: parseInt(match[1]),
        title: match[2].trim(),
        url: match[3].trim(),
        snippet: match[4].trim(),
        summary: match[5]?.trim(),
      });
    }
    return { keyword, items };
  }, [content]);

  return (
    <div className="w-full">
      <div className="bg-gradient-to-r from-blue-500/5 to-cyan-500/5 border border-blue-500/20 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Globe className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            联网搜索{parsed.keyword ? ` · "${parsed.keyword}"` : ''} · {parsed.items.length} 条结果
          </span>
        </div>
        {parsed.items.length > 0 && (
          <div className="space-y-2">
            {parsed.items.map((item) => (
              <a
                key={item.idx}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 rounded-xl bg-background/50 hover:bg-background/80 border border-border/50 hover:border-border transition-all"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0 w-5">[{item.idx}]</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground line-clamp-1">{item.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.snippet}</div>
                    {item.summary && (
                      <div className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-1 line-clamp-2 italic">AI: {item.summary}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground/50 mt-1 truncate">{item.url}</div>
                  </div>
                </div>
              </a>
            )) }
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatArea({
  user, project, task, onUpdateTask, onUpdateProject, onCreateTask, onSelectTask,
  onUpdateAgent, onDeleteAgent, onSkillToAgent,
  onLogout, onBackToWorkspace, sidebarOpen, onToggleSidebar
}: ChatAreaProps) {
  const { theme, toggleTheme } = useTheme();

  // Local state
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<ChatAttachment[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [showSkillPanel, setShowSkillPanel] = useState(false);
  const [showInstructionsPanel, setShowInstructionsPanel] = useState(false);
  const [showKnowledgePanel, setShowKnowledgePanel] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifacts, setArtifacts] = useState<Array<{ id: string; type: 'document' | 'code' | 'table'; title: string; content: string }>>([]);
  const [showShare, setShowShare] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ taskId: string; taskName: string; messageIndex: number; snippet: string }>>([]);
  const [branchBaseMessageId, setBranchBaseMessageId] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  // Brand DNA injection
  const [brandActive, setBrandActive] = useState(false);

  // Image model
  const [imageModels, setImageModels] = useState<Array<ChatModelInfo>>([]);
  const [selectedImageModel, setSelectedImageModel] = useState('');
  const [selectedImageProviderId, setSelectedImageProviderId] = useState('');
  const [canvasProjects, setCanvasProjects] = useState<CanvasProjectOption[]>([]);
  const [selectedCanvasProjectId, setSelectedCanvasProjectId] = useState('');
  const [canvasTransferMessageId, setCanvasTransferMessageId] = useState<string | null>(null);

  // Instructions draft
  const [instructionsDraft, setInstructionsDraft] = useState<ProjectInstructions>(
    project?.instructions || { projectBackground: '', userPreference: '', outputFormat: '', styleRules: '', forbiddenRules: '', language: 'zh-CN' }
  );

  // Knowledge
  const [knowledgeItems, setKnowledgeItems] = useState<ProjectKnowledgeItem[]>(project?.knowledgeItems || []);
  const [knowledgePreview, setKnowledgePreview] = useState<ProjectKnowledgeItem | null>(null);
  const [addingKnowledge, setAddingKnowledge] = useState<'file' | 'url' | 'note' | null>(null);
  const [knowledgeUrl, setKnowledgeUrl] = useState('');
  const [knowledgeNote, setKnowledgeNote] = useState('');
  const [knowledgeNoteName, setKnowledgeNoteName] = useState('');

  // Models
  const [chatModels, setChatModels] = useState<ChatModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState(task?.model || "");
  const [selectedProviderId, setSelectedProviderId] = useState(task?.providerId || "");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(task?.reasoningEffort || 'medium');
  const [responseSpeed, setResponseSpeed] = useState<ResponseSpeed>(task?.responseSpeed || 'balanced');
  const [appliedChatControls, setAppliedChatControls] = useState<SimpleChatTask['appliedChatControls']>(task?.appliedChatControls);
  const [controlNotice, setControlNotice] = useState<string | null>(null);
  const [openModelMenu, setOpenModelMenu] = useState<'chat' | 'image' | null>(null);

  // ===== 新增升级功能状态 =====
  // 图片灯箱预览
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  // Canvas 写作画布
  const [showCanvas, setShowCanvas] = useState(false);
  const [canvasContent, setCanvasContent] = useState('');
  // 记忆系统
  const [showMemory, setShowMemory] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  // 全局对话搜索
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showQuickCommands, setShowQuickCommands] = useState(false);
  // 临时聊天（无痕模式）
  const [tempChat, setTempChat] = useState(false);
  // 回复评分
  const [messageRatings, setMessageRatings] = useState<Record<string, 'up' | 'down'>>({});
  // 消息编辑
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  // 拖拽上传
  const [dragOver, setDragOver] = useState(false);
  // 提示词优化器
  const [showPromptOptimizer, setShowPromptOptimizer] = useState(false);
  // 报告导出
  const [showReportExport, setShowReportExport] = useState(false);
  // 多模型对比
  const [showModelCompare, setShowModelCompare] = useState(false);
  // API 用量统计
  const [showUsageStats, setShowUsageStats] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<{ promptTokens: number; completionTokens: number; totalTokens: number } | null>(null);
  // 多轮图片上下文
  const [historyImages, setHistoryImages] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatModelMenuRef = useRef<HTMLDivElement>(null);
  const imageModelMenuRef = useRef<HTMLDivElement>(null);

  // Messages: sync from task
  const [messages, setMessages] = useState<SimpleChatMessage[]>((task?.messages || []).filter(Boolean));

  // Sync when task changes
  useEffect(() => {
    if (task) {
      setMessages((task.messages || []).filter(Boolean));
      setSelectedModel(task.model);
      setSelectedProviderId(task.providerId);
      setReasoningEffort(task.reasoningEffort || 'medium');
      setResponseSpeed(task.responseSpeed || 'balanced');
      setAppliedChatControls(task.appliedChatControls);
      setControlNotice(task.appliedChatControls?.notices[0] || null);
      setInput("");
    }
  }, [task?.id]);

  // Sync when project changes
  useEffect(() => {
    if (project) {
      setInstructionsDraft(project.instructions || { projectBackground: '', userPreference: '', outputFormat: '', styleRules: '', forbiddenRules: '', language: 'zh-CN' });
      setKnowledgeItems(project.knowledgeItems || []);
    }
  }, [project?.id]);

  // Load models with tags
  useEffect(() => {
    fetch('/api/models?type=chat').then(r => r.json()).then(data => {
      if (data.models) {
        // Build provider name map from providers array
        const providerMap = new Map<string, string>();
        if (data.providers) {
          data.providers.forEach((p: { id: string; name: string; displayName?: string }) => {
            providerMap.set(p.id, p.displayName || p.name || p.id);
          });
        }
        // Count duplicate model names
        const nameCount = new Map<string, number>();
        data.models.forEach((m: { name: string; id: string }) => {
          const nm = m.name || m.id;
          nameCount.set(nm, (nameCount.get(nm) || 0) + 1);
        });
        const list = data.models.map((m: { id: string; name: string; providerId?: string }) => {
          const baseName = m.name || m.id;
          const dupCount = nameCount.get(baseName) || 1;
          const provName = providerMap.get(m.providerId || '') || '';
          // Use composite key to avoid React key collision for same model from different providers
          const uniqueKey = m.providerId ? `${m.providerId}::${m.id}` : m.id;
          return {
            id: uniqueKey,
            modelId: m.id,
            name: dupCount > 1 && provName ? `${baseName} · ${provName}` : baseName,
            originalName: baseName,
            providerId: m.providerId || '',
            providerName: provName,
            tags: getModelTags(m.id, m.name)
          };
        });
        setChatModels(list);
        if (!selectedModel && list.length > 0) {
          setSelectedModel(list[0].modelId);
          setSelectedProviderId(list[0].providerId);
        }
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!openModelMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!chatModelMenuRef.current?.contains(target) && !imageModelMenuRef.current?.contains(target)) {
        setOpenModelMenu(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openModelMenu]);

  // Fetch image models
  const fetchImageModels = useCallback(async () => {
    fetch('/api/models?type=image').then(r => r.json()).then(data => {
      const models: ChatModelInfo[] = [];
      const rawModels = data.models || [];
      const providers = data.providers || [];
      const providerMap = new Map<string, string>();
      for (const p of providers) {
        providerMap.set(p.id, p.name || p.displayName || '');
      }
      for (const m of rawModels) {
        const providerName = providerMap.get(m.providerId) || '';
        models.push({ id: m.providerId ? `${m.providerId}::${m.id}` : m.id, modelId: m.id, name: m.name || m.id, providerId: m.providerId, providerName });
      }
      setImageModels(models);
      if (models.length > 0 && !selectedImageModel) {
        setSelectedImageModel(models[0].modelId);
        setSelectedImageProviderId(models[0].providerId);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => { fetchImageModels(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/user-data/sync?key=projects', { credentials: 'include' })
      .then(response => response.ok ? response.json() : null)
      .then((payload: { success?: boolean; value?: unknown } | null) => {
        if (cancelled || !payload?.success || !Array.isArray(payload.value)) return;
        const options = payload.value.flatMap((value): CanvasProjectOption[] => {
          if (!value || typeof value !== 'object') return [];
          const projectValue = value as Record<string, unknown>;
          if (typeof projectValue.id !== 'string' || !projectValue.id) return [];
          return [{
            id: projectValue.id,
            name: typeof projectValue.name === 'string' && projectValue.name
              ? projectValue.name
              : '未命名画布',
          }];
        });
        setCanvasProjects(options);
        setSelectedCanvasProjectId(current => current || options[0]?.id || '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 加载用户记忆
  useEffect(() => {
    fetch('/api/simple-chat/memory').then(r => r.json()).then(data => {
      if (Array.isArray(data.memories)) setMemories(data.memories);
    }).catch(() => {});
  }, []);

  // 加载评分记录（localStorage）
  useEffect(() => {
    try {
      const saved = localStorage.getItem('simple_chat_ratings');
      if (saved) setMessageRatings(JSON.parse(saved));
    } catch {}
  }, []);

  // 键盘快捷键：Ctrl+K 全局搜索，Ctrl+N 新对话，Ctrl+Shift+P 提示词优化器，Ctrl+M 多模型对比
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowGlobalSearch(true);
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (project) onCreateTask(project.id);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPromptOptimizer(true);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setShowModelCompare(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // 评分持久化
  function rateMessage(msgId: string, rating: 'up' | 'down') {
    setMessageRatings(prev => {
      const next = { ...prev };
      if (next[msgId] === rating) delete next[msgId];
      else next[msgId] = rating;
      try { localStorage.setItem('simple_chat_ratings', JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // 记忆操作
  async function addMemory(content: string, category: MemoryItem['category']) {
    setMemoriesLoading(true);
    try {
      const res = await fetch('/api/simple-chat/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, category }),
      });
      const data = await res.json();
      if (data.memory) setMemories(prev => [data.memory, ...prev]);
    } catch {} finally { setMemoriesLoading(false); }
  }

  async function deleteMemory(id: string) {
    setMemoriesLoading(true);
    try {
      await fetch(`/api/simple-chat/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch {} finally { setMemoriesLoading(false); }
  }

  // Sync task to parent（临时聊天模式下跳过保存）
  useEffect(() => {
    if (!task || !project || tempChat) return;
    onUpdateTask({ ...task, messages, model: selectedModel, providerId: selectedProviderId, imageModel: selectedImageModel, imageProviderId: selectedImageProviderId, reasoningEffort, responseSpeed, appliedChatControls, updatedAt: Date.now() });
  }, [messages, selectedModel, selectedProviderId, selectedImageModel, selectedImageProviderId, reasoningEffort, responseSpeed, appliedChatControls, tempChat]);

  // Sync knowledge
  useEffect(() => {
    if (!project) return;
    onUpdateProject({ ...project, knowledgeItems, updatedAt: Date.now() });
  }, [knowledgeItems]);

  function getModelTags(id: string, name: string): string[] {
    const lower = (id + ' ' + name).toLowerCase();
    const tags: string[] = [];
    for (const [key, t] of Object.entries(MODEL_TAGS)) {
      if (lower.includes(key)) { tags.push(...t); break; }
    }
    return tags;
  }

  // ===== 图片上传统一入口（按钮/粘贴/拖拽共用） =====
  const handleImageFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setUploadedImages(prev => [...prev, {
          id: Math.random().toString(36).slice(2, 10),
          type: 'image' as const,
          name: file.name || `粘贴图片-${Date.now()}.png`,
          url: dataUrl,
          mimeType: file.type || 'image/png',
        }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // Ctrl+V 粘贴图片
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleImageFiles(files);
    }
  }, [handleImageFiles]);

  // 拖拽上传
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleImageFiles(Array.from(e.dataTransfer.files || []));
  }, [handleImageFiles]);

  // 消息编辑：提交后将该消息之后的对话截断并重新生成
  function handleEditSubmit(msgId: string) {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1 || !editingContent.trim()) return;
    const updated = messages.slice(0, idx);
    const editedMsg: SimpleChatMessage = { ...messages[idx], content: editingContent.trim() };
    setMessages([...updated, editedMsg]);
    setEditingMessageId(null);
    setEditingContent('');
    // 用编辑后的内容触发重新生成
    setInput(editingContent.trim());
    setTimeout(() => {
      setMessages(updated);
      setInput(editingContent.trim());
      handleSendRef.current?.();
    }, 0);
  }

  // 消息删除
  function handleDeleteMessage(msgId: string) {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msgId);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      // 若删除的是用户消息，同时删除紧随的助手回复
      if (prev[idx].role === 'user' && next[idx]?.role === 'assistant') next.splice(idx, 1);
      return next;
    });
  }

  function handleRateMessage(msgId: string, rating: 'up' | 'down') {
    setMessageRatings(prev => {
      const next = { ...prev };
      if (next[msgId] === rating) delete next[msgId];
      else next[msgId] = rating;
      return next;
    });
  }

  // Canvas AI 协同编辑
  async function canvasAiEdit(instruction: string, currentContent: string, selectedText: string): Promise<string> {
    const target = selectedText || currentContent;
    const res = await fetch('/api/simple-chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '你是一名专业文案编辑。根据用户的修改指令，输出修改后的完整文本。只输出修改后的文本本身，不要输出解释、不要添加引号或标记。' },
          { role: 'user', content: `【待修改文本】\n${target}\n\n【修改指令】\n${instruction}` },
        ],
        model: selectedModel, providerId: selectedProviderId,
        reasoningEffort, responseSpeed,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]' || data === '') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content') result += parsed.content || '';
          } catch {}
        }
      }
    }
    if (!result.trim()) throw new Error('AI 未返回内容');
    return selectedText ? currentContent.replace(selectedText, result.trim()) : result.trim();
  }

  // 图片深度分析（文案策划专用）
  function handleDeepAnalyze(imageUrl: string) {
    const prompt = `请对这张图片进行专业的文案策划深度分析，按以下框架输出结构化报告：

## 一、视觉元素拆解
- 主体/构图/色彩/氛围/风格定位

## 二、文案策略分析
- 核心卖点提炼与表达方式
- 文案调性（正式/活泼/走心/促销）
- 目标受众画像推断

## 三、营销策略推断
- 投放场景与渠道适配（小红书/微博/公众号/抖音/朋友圈）
- 转化路径设计分析

## 四、可借鉴点与风险点
- 值得学习的创意手法
- 潜在的合规或审美风险

## 五、行动清单
- 给出 3 条可直接复用到我方文案策划的建议`;
    setInput(prompt);
  }

  const handleSendRef = useRef<(() => void) | null>(null);

  const registerChatAttachment = useCallback(async (
    attachment: ChatAttachment,
    messageId: string,
    index: number,
    chatProjectId: string,
    chatTaskId: string,
  ): Promise<WorkspaceAssetReference | null> => {
    if (!selectedCanvasProjectId || !attachment.url) return null;
    try {
      const response = await fetch('/api/simple-chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetAction: 'register',
          projectId: selectedCanvasProjectId,
          workspaceId: `standalone-chat:${chatProjectId}`,
          entityType: 'chat-attachment',
          entityId: `${messageId}:${index}`,
          idempotencyKey: `simple-chat-attachment:${chatTaskId}:${messageId}:${index}`,
          image: {
            url: attachment.url,
            name: attachment.name,
            mimeType: attachment.mimeType,
          },
        }),
      });
      if (!response.ok) return null;
      const reference = readWorkspaceAssetReference(await response.json());
      return reference?.assetVersionId && reference.placementId ? reference : null;
    } catch {
      return null;
    }
  }, [selectedCanvasProjectId]);

  // Handle send
  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content && uploadedImages.length === 0) return;
    if (isStreaming || !project || !task) return;

    setIsStreaming(true);
    const userMessageId = Math.random().toString(36).slice(2, 10);
    const assistantMessageId = Math.random().toString(36).slice(2, 10);
    const attachmentRefs = await Promise.all(uploadedImages.map((attachment, index) => (
      registerChatAttachment(attachment, userMessageId, index, project.id, task.id)
    )));
    const mediaSlots = alignSimpleChatMediaSlots(uploadedImages, attachmentRefs);

    const userMsg: SimpleChatMessage = {
      id: userMessageId,
      role: 'user', content,
      images: mediaSlots.images,
      imageRefs: mediaSlots.imageRefs,
      attachments: mediaSlots.attachments,
      createdAt: Date.now(),
    };

    const aiMsg: SimpleChatMessage = {
      id: assistantMessageId,
      role: 'assistant', content: '',
      model: selectedModel, providerId: selectedProviderId,
      createdAt: Date.now(),
    };
    const requestSourceVersionIds = [...new Set(
      (userMsg.imageRefs || []).flatMap(reference => (
        reference.assetVersionId ? [reference.assetVersionId] : []
      )),
    )];
    const requestSelectedEntityIds = [...new Set(
      (userMsg.imageRefs || []).flatMap(reference => (
        reference.assetVersionId && reference.placementId && reference.entityId
          ? [reference.entityId]
          : []
      )),
    )];

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setInput("");
    setUploadedImages([]);

    // 提升作用域供 finally 中统计 token 用量
    let allMessages: Array<{ role: string; content: string; images?: string[] }> = [];
    let fullContent = "";

    try {
      const systemMessages: Array<{ role: string; content: string }> = [];
      const instructions = project.instructions;
      if (instructions) {
        const parts = [];
        if (instructions.projectBackground) parts.push(`项目背景：${instructions.projectBackground}`);
        if (instructions.userPreference) parts.push(`用户偏好：${instructions.userPreference}`);
        if (instructions.outputFormat) parts.push(`输出格式：${instructions.outputFormat}`);
        if (instructions.styleRules) parts.push(`风格规则：${instructions.styleRules}`);
        if (instructions.forbiddenRules) parts.push(`禁止规则：${instructions.forbiddenRules}`);
        if (parts.length > 0) systemMessages.push({ role: 'system', content: parts.join('\n') });
      }
      if (task.activeAgentId) {
        const agent = project.agents.find(a => a.id === task.activeAgentId);
        if (agent) systemMessages.push({ role: 'system', content: agent.systemPrompt });
      }
      if (webSearch) {
        systemMessages.push({ role: 'system', content: '当前开启了联网搜索模式。请基于联网搜索结果回答用户问题，并在回答末尾列出引用来源。' });
      }
      // Brand DNA injection
      if (brandActive) {
        try {
          const { loadBrandDNARegistry, generateBrandSystemPrompt } = await import('@/lib/brand-dna');
          const registry = loadBrandDNARegistry();
          const latest = registry.at(-1);
          if (latest) {
            const systemPrompt = generateBrandSystemPrompt(latest);
            if (systemPrompt) {
              systemMessages.push({ role: 'system', content: systemPrompt });
            }
          }
        } catch {}
      }

      // 多轮图片上下文：仅保留最近 3 轮用户消息的图片（更早的图片会消耗大量 token）
      const historyMsgs = messages.filter(m => m.role !== 'search');
      const recentUserImageIds = new Set(
        historyMsgs.filter(m => m.role === 'user' && m.images && m.images.length > 0).slice(-3).map(m => m.id)
      );
      const collectedHistoryImages = historyMsgs
        .filter(m => recentUserImageIds.has(m.id))
        .flatMap(m => m.images || []);
      setHistoryImages(collectedHistoryImages);

      allMessages = [
        ...systemMessages,
        ...historyMsgs.map(m => ({
          role: m.role,
          content: m.content,
          images: m.role === 'user' && recentUserImageIds.has(m.id) ? m.images : undefined,
        })),
        { role: 'user', content: userMsg.content, images: userMsg.images },
      ];

      const apiKnowledgeItems = knowledgeItems
        .filter(item => item.enabled && item.type !== 'image')
        .map(item => ({
          id: item.id,
          type: item.type,
          title: item.name,
          content: item.textContent || item.url || '',
        }))
        .filter(item => item.content);

      // 深度分析检测：消息包含分析框架标记且带图片时启用专业分析系统提示词
      const isDeepAnalysis = content.includes('文案策划深度分析') && (userMsg.images?.length || 0) > 0;

      const res = await fetch('/api/simple-chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages, model: selectedModel, providerId: selectedProviderId,
          imageModel: selectedImageModel, imageProviderId: selectedImageProviderId,
          webSearch, knowledgeItems: apiKnowledgeItems, projectId: project.id, taskId: task.id,
          assetProjectId: selectedCanvasProjectId || undefined,
          responseMessageId: assistantMessageId,
          sourceVersionIds: requestSourceVersionIds,
          selectedEntityIds: requestSelectedEntityIds,
          memories: memories.map(m => ({ category: m.category, content: m.content })),
          deepAnalysis: isDeepAnalysis,
          reasoningEffort,
          responseSpeed,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]' || data === '') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'generation_controls') {
                const notices = Array.isArray(parsed.notices) ? parsed.notices.filter((notice: unknown): notice is string => typeof notice === 'string') : [];
                const appliedControls: SimpleChatTask['appliedChatControls'] = {
                  appliedReasoningEffort: parsed.appliedReasoningEffort as ResolvedChatControls['appliedReasoningEffort'],
                  appliedResponseSpeed: parsed.appliedResponseSpeed as ResolvedChatControls['appliedResponseSpeed'],
                  degraded: Boolean(parsed.degraded),
                  notices,
                };
                setControlNotice(notices[0] || `已应用：推理 ${parsed.appliedReasoningEffort || '默认'}，速度 ${parsed.appliedResponseSpeed || '均衡'}`);
                setAppliedChatControls(appliedControls);
              } else if (parsed.type === 'search_status') {
                setSearchStatus(parsed.status === 'completed' ? `搜索完成，找到 ${parsed.resultCount || 0} 条结果` : parsed.status === 'error' ? '搜索出错' : '正在搜索...');
                // 搜索完成后，添加一条系统消息展示搜索结果
                if (parsed.status === 'completed' && parsed.resultCount > 0) {
                  const searchMsg = {
                    id: 'search-' + Math.random().toString(36).slice(2, 8),
                    role: 'search' as const,
                    content: parsed.searchResults || '',
                    createdAt: Date.now(),
                  };
                  setMessages(prev => [...prev, searchMsg]);
                } else if (parsed.status === 'completed' && parsed.resultCount === 0) {
                  // 搜索无结果 — 显式失败
                  setMessages(prev => {
                    const updated = [...prev];
                    updated.splice(updated.length - 1, 0, {
                      id: 'search-' + Math.random().toString(36).slice(2, 8),
                      role: 'system',
                      content: `🌐 联网搜索未找到相关结果`,
                      createdAt: Date.now(),
                    });
                    return updated;
                  });
                }
              } else if (parsed.type === 'tool_status') {
                setSearchStatus(null);
                setMessages(prev => prev.map(message => (
                  message.id === assistantMessageId
                    ? {
                      ...message,
                      content: `*${parsed.label || '正在处理图片任务...'}*`,
                      ...(typeof parsed.runId === 'string' ? { agentRunId: parsed.runId } : {}),
                    }
                    : message
                )));
              } else if (parsed.type === 'image' && parsed.imageUrl) {
                setSearchStatus(null);
                const imageRef = readWorkspaceAssetReference(parsed.imageRef);
                setMessages(prev => prev.map(message => {
                  if (message.id === assistantMessageId) {
                    const imageUrl = imageRef?.url || parsed.imageUrl;
                    const imageIndex = message.images?.length || 0;
                    return {
                      ...message,
                      content: message.content || '图片已生成',
                      images: [...(message.images || []), imageUrl],
                      imageRefs: [...(message.imageRefs || []), imageRef?.assetVersionId && imageRef.placementId
                        ? imageRef
                        : { url: imageUrl }],
                      attachments: [...(message.attachments || []), {
                        id: `${message.id}-image-${imageIndex}`,
                        type: 'image',
                        name: typeof parsed.prompt === 'string' && parsed.prompt
                          ? parsed.prompt.slice(0, 120)
                          : `generated-${imageIndex + 1}.png`,
                        mimeType: 'image/png',
                        url: imageUrl,
                        ...(imageRef?.assetId ? { assetId: imageRef.assetId } : {}),
                        ...(imageRef?.assetVersionId ? { assetVersionId: imageRef.assetVersionId } : {}),
                        ...(imageRef?.placementId ? { placementId: imageRef.placementId } : {}),
                      }],
                    };
                  }
                  return message;
                }));
              } else if (parsed.type === 'error') {
                setSearchStatus(null);
                setMessages(prev => prev.map(message => (
                  message.id === assistantMessageId
                    ? {
                      ...message,
                      content: `请求失败：${parsed.error || '未知错误'}\n\n建议：尝试切换模型或稍后重试。`,
                    }
                    : message
                )));
              } else if (parsed.type === 'text' && parsed.content) {
                setSearchStatus(null);
                fullContent += parsed.content;
                setMessages(prev => prev.map(message => (
                  message.id === assistantMessageId
                    ? { ...message, content: fullContent }
                    : message
                )));
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setMessages(prev => prev.map(message => (
        message.id === assistantMessageId
          ? { ...message, content: '抱歉，请求失败，请重试。' }
          : message
      )));
    } finally {
      setIsStreaming(false);
      // 估算 token 用量（中文≈1.5字/token，英文≈4字符/token，取近似值）
      const estimateTokens = (text: string) => {
        const cn = (text.match(/[一-鿿]/g) || []).length;
        const en = text.length - cn;
        return Math.ceil(cn / 1.5 + en / 4);
      };
      const promptEst = allMessages.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0);
      const completionEst = estimateTokens(fullContent);
      setTokenUsage(prev => ({
        promptTokens: (prev?.promptTokens || 0) + promptEst,
        completionTokens: (prev?.completionTokens || 0) + completionEst,
        totalTokens: (prev?.totalTokens || 0) + promptEst + completionEst,
      }));
    }
  }, [input, isStreaming, selectedModel, selectedProviderId, messages, project, task, uploadedImages, webSearch, memories, selectedImageModel, selectedImageProviderId, brandActive, selectedCanvasProjectId, registerChatAttachment]);

  // 供消息编辑后重新生成调用
  handleSendRef.current = handleSend;

  // Deep Research
  const handleDeepResearch = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    setIsStreaming(true);
    const query = input;
    setInput("");

    const userMsg: SimpleChatMessage = { id: `msg_${Date.now()}`, role: 'user', content: `🔬 Deep Research: ${query}`, createdAt: Date.now() };
    const aiMsg: SimpleChatMessage = { id: `msg_${Date.now() + 1}`, role: 'assistant', content: '', createdAt: Date.now() + 1 };
    setMessages(prev => [...prev, userMsg, aiMsg]);

    try {
      const res = await fetch('/api/simple-chat/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, model: selectedModel, providerId: selectedProviderId, depth: 'standard' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No body');
      const decoder = new TextDecoder();
      let buffer = "", fullContent = "", phaseLabel = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'phase') {
              phaseLabel = parsed.label || '';
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: `*${phaseLabel}*` };
                return updated;
              });
            } else if (parsed.type === 'text') {
              fullContent += parsed.content;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: fullContent };
                return updated;
              });
            } else if (parsed.type === 'citations') {
              // Save as artifact
              const artId = `art_${Date.now()}`;
              setArtifacts(prev => [...prev, { id: artId, type: 'document', title: `研究: ${query.slice(0, 30)}`, content: fullContent }]);
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: 'Deep Research 失败，请重试。' }; return u; });
    } finally { setIsStreaming(false); }
  }, [input, isStreaming, selectedModel, selectedProviderId]);

  // Branch from message
  const branchFromMessage = useCallback((msgId: string) => {
    setBranchBaseMessageId(msgId);
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx >= 0) {
      const branched = messages.slice(0, idx + 1);
      setMessages(branched);
      if (task && project) {
        onCreateTask(project.id, {
          name: `${task.name || '对话'} (分支)`,
          messages: branched,
          model: selectedModel,
          providerId: selectedProviderId,
        });
      }
    }
  }, [messages, task, project, onCreateTask, selectedModel, selectedProviderId]);

  // Save as artifact — writes to the source message, not local state
  const saveAsArtifact = useCallback((msg: SimpleChatMessage) => {
    const artId = `art_${Date.now()}`;
    const isCode = msg.content.includes('```');
    const artifact: ChatArtifact = { id: artId, projectId: project?.id ?? '', taskId: '', type: (isCode ? 'code' : 'document') as ChatArtifact['type'], title: msg.content.slice(0, 40).replace(/\n/g, ' ') + '...', content: msg.content, version: 1, createdAt: Date.now(), updatedAt: Date.now() };
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, artifacts: [...(m.artifacts || []), artifact] } : m));
  }, []);

  // Project search
  const handleProjectSearch = useCallback(() => {
    if (!searchQuery.trim() || !project) return;
    const results: typeof searchResults = [];
    project.tasks.forEach(t => {
      t.messages.forEach((m, i) => {
        if (m.content.toLowerCase().includes(searchQuery.toLowerCase())) {
          results.push({ taskId: t.id, taskName: t.name, messageIndex: i, snippet: m.content.slice(0, 100) });
        }
      });
    });
    setSearchResults(results);
  }, [searchQuery, project]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  // Office file download handlers
  const [downloadingPptx, setDownloadingPptx] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [downloadingWord, setDownloadingWord] = useState(false);
  const [downloadingMindmap, setDownloadingMindmap] = useState(false);
  const [downloadingFlowchart, setDownloadingFlowchart] = useState(false);
  const downloadPptx = useCallback(async (content: string) => {
    // 提取 JSON 代码块
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      alert('未找到幻灯片 JSON 数据。请先用 PPT大师 Skill 生成 PPT 内容。');
      return;
    }
    try {
      setDownloadingPptx(true);
      const data = JSON.parse(jsonMatch[1]);
      if (!data.slides || !Array.isArray(data.slides)) {
        alert('JSON 格式无效：缺少 slides 数组');
        return;
      }
      const res = await fetch('/api/ppt/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '生成失败' }));
        alert(`PPTX 生成失败：${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.title || '演示文稿'}.pptx`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e: unknown) {
      alert(`解析失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setDownloadingPptx(false);
    }
  }, []);

  // Check if message contains PPT JSON
  const hasPptJson = useCallback((content: string) => {
    return /```json\s*[\s\S]*?"slides"\s*:\s*\[/.test(content);
  }, []);

  const hasExcelJson = useCallback((content: string) => {
    return /```json\s*[\s\S]*?"sheets"\s*:\s*\[/.test(content);
  }, []);

  const hasWordJson = useCallback((content: string) => {
    return /```json\s*[\s\S]*?"sections"\s*:\s*\[/.test(content);
  }, []);

  const hasMindmapJson = useCallback((content: string) => {
    return /```json\s*[\s\S]*?"root"\s*:\s*\{/.test(content) && /```json\s*[\s\S]*?"text"\s*:/.test(content);
  }, []);

  const hasFlowchartJson = useCallback((content: string) => {
    return /```json\s*[\s\S]*?"mermaid"\s*:/.test(content);
  }, []);

  const hasPdfJson = useCallback((content: string) => {
    return /```json\s*[\s\S]*?"type"\s*:\s*"(?:markdown|merge|split|form|watermark|extract)"/.test(content);
  }, []);

  const extractJsonFromContent = useCallback((content: string): object | null => {
    const match = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch { return null; }
  }, []);

  const downloadFile = useCallback(async (url: string, filename: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Download failed:', e);
    }
  }, []);

  const downloadExcel = useCallback(async (data: object) => {
    const resp = await fetch('/api/excel/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${(data as Record<string,unknown>).title || 'workbook'}.xlsx`; a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const downloadWord = useCallback(async (data: object) => {
    const resp = await fetch('/api/word/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${(data as Record<string,unknown>).title || 'document'}.docx`; a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const downloadMindmap = useCallback(async (data: object) => {
    const resp = await fetch('/api/mindmap/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${(data as Record<string,unknown>).title || 'mindmap'}.html`; a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const downloadFlowchart = useCallback(async (data: object) => {
    const resp = await fetch('/api/flowchart/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${(data as Record<string,unknown>).title || 'flowchart'}.html`; a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const downloadPdf = useCallback(async (data: object) => {
    const resp = await fetch('/api/pdf/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${(data as Record<string,unknown>).title || 'document'}.pdf`; a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const sendImagesToCanvas = useCallback(async (message: SimpleChatMessage) => {
    const targetProjectId = selectedCanvasProjectId;
    if (!targetProjectId || !task) {
      setControlNotice('请先选择目标画布项目');
      return;
    }
    if (canvasTransferMessageId === message.id) return;
    setCanvasTransferMessageId(message.id);
    try {
      const transferResult = await sendSimpleChatMediaToCanvas({
        images: message.images || [],
        imageRefs: message.imageRefs || [],
        targetProjectId,
        transfer: async ({ sourceVersionId, targetProjectId: transferProjectId, index }) => {
          const transferResponse = await fetch('/api/assets/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceVersion: sourceVersionId,
              targetProject: transferProjectId,
              targetWorkspace: transferProjectId,
              entityType: 'canvas-image',
              entityId: `simple-chat:${task.id}:${message.id}:${index}`,
              idempotencyKey: `simple-chat-canvas:${transferProjectId}:${task.id}:${message.id}:${index}:${sourceVersionId}`,
              metadata: { source: 'standalone-chat', messageId: message.id, imageIndex: index },
            }),
          });
          if (!transferResponse.ok) throw new Error('Asset transfer failed');
          const transferred = readWorkspaceAssetReference(await transferResponse.json());
          if (!transferred?.assetVersionId || !transferred.placementId) {
            throw new Error('Asset transfer returned an incomplete reference');
          }
          return transferred;
        },
        writeBridge: transferredImages => {
          const rawExisting = localStorage.getItem('wujie_canvas_bridge');
          let existingPayload: unknown = [];
          try { existingPayload = rawExisting ? JSON.parse(rawExisting) : []; } catch {}
          const existingProjectId = existingPayload && typeof existingPayload === 'object' && !Array.isArray(existingPayload)
            && typeof (existingPayload as Record<string, unknown>).projectId === 'string'
            ? (existingPayload as Record<string, unknown>).projectId as string
            : null;
          const existingImages = !existingProjectId || existingProjectId === targetProjectId
            ? parseSimpleChatCanvasBridgePayload(existingPayload)
            : [];
          localStorage.setItem('wujie_canvas_bridge', JSON.stringify({
            projectId: targetProjectId,
            images: mergeSimpleChatCanvasBridgeReferences(existingImages, transferredImages),
          }));
        },
      });
      if (!transferResult.ok) {
        setControlNotice('历史图片或登记失败的图片仅可查看，无法发送到画布');
        return;
      }
      const transferredImages = transferResult.references;
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-20 right-6 z-[9999] bg-blue-600 text-white px-4 py-3 rounded-lg shadow-lg cursor-pointer hover:bg-blue-700 transition-colors text-sm flex items-center gap-2';
      // P3 fix: 用 DOM API 构建子节点，避免 innerHTML 拼接（低风险但非最佳实践）
      const span1 = document.createElement('span');
      span1.textContent = `已添加 ${transferredImages.length} 张图片`;
      const span2 = document.createElement('span');
      span2.className = 'underline';
      span2.textContent = '前往画布查看';
      toast.appendChild(span1);
      toast.appendChild(span2);
      toast.onclick = () => {
        window.open(`/?projectId=${encodeURIComponent(targetProjectId)}`, '_blank');
        toast.remove();
      };
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 8000);
    } catch {
      setControlNotice('图片无法发送到所选画布');
    } finally {
      setCanvasTransferMessageId((current) => current === message.id ? null : current);
    }
  }, [canvasTransferMessageId, selectedCanvasProjectId, task]);

  // Message operations
  const copyMessage = (content: string) => { navigator.clipboard.writeText(content); };
  const regenerateLast = () => { if (messages.length < 2) return; const lastUser = [...messages].reverse().find(m => m.role === 'user'); if (lastUser) { setMessages(prev => prev.slice(0, -2)); setInput(lastUser.content); setTimeout(() => { const btn = document.getElementById('send-btn') as HTMLButtonElement; btn?.click(); }, 50); } };
  const continueConversation = (msg: SimpleChatMessage) => { setInput('继续'); };
  const makeShorter = (msg: SimpleChatMessage) => {
    if (msg?.role === 'assistant') setInput(`请将上面的回答缩短，保留核心要点。`);
  };
  const makeLonger = (msg: SimpleChatMessage) => {
    if (msg?.role === 'assistant') setInput(`请将上面的回答扩展得更详细。`);
  };
  const toImagePrompt = (msg: SimpleChatMessage) => {
    if (msg?.role === 'assistant' && msg.content) {
      setInput(`根据以下内容生成图像提示词：${msg.content.slice(0, 200)}`);
    }
  };

  // Instructions
  const saveInstructions = () => {
    if (!project) return;
    onUpdateProject({ ...project, instructions: instructionsDraft, updatedAt: Date.now() });
    setShowInstructionsPanel(false);
  };

  // Knowledge
  const addKnowledgeItem = (item: ProjectKnowledgeItem) => {
    setKnowledgeItems(prev => [...prev, item]);
    setAddingKnowledge(null);
    setKnowledgeUrl('');
    setKnowledgeNote('');
    setKnowledgeNoteName('');
  };
  const removeKnowledgeItem = (id: string) => {
    setKnowledgeItems(prev => prev.filter(k => k.id !== id));
  };
  const toggleKnowledgeItem = (id: string) => {
    setKnowledgeItems(prev => prev.map(k => k.id === id ? { ...k, enabled: !k.enabled } : k));
  };

  if (!project || !task) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/30" />
          <p className="text-muted-foreground text-lg">选择或创建一个对话</p>
          <button onClick={() => onCreateTask(project?.id || '')} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">
            新对话
          </button>
        </div>
      </div>
    );
  }

  const activeAgent = task.activeAgentId ? project.agents.find(a => a.id === task.activeAgentId) : null;

  return (
    <div className="flex-1 flex flex-col h-screen bg-background">
      {/* Top Bar */}
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
        <button onClick={onToggleSidebar} className="p-2 rounded-lg hover:bg-muted transition-colors" title="切换侧边栏">
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>
        <button onClick={onBackToWorkspace} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="w-4 h-4 rotate-90 inline" /> 工作台
        </button>
        <div className="flex-1" />
        {/* Model Selector */}
        <div ref={chatModelMenuRef} className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openModelMenu === 'chat'}
            onClick={() => setOpenModelMenu(openModelMenu === 'chat' ? null : 'chat')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-xs cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
            <span className="font-medium max-w-[120px] truncate">{chatModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModel)?.name || selectedModel || '选择模型'}</span>
            <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${openModelMenu === 'chat' ? 'rotate-180' : ''}`} />
          </button>
          <div className={`absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-xl shadow-xl z-[100] max-h-96 overflow-y-auto p-1 transition-opacity ${openModelMenu === 'chat' ? 'opacity-100 visible pointer-events-auto' : 'opacity-0 invisible pointer-events-none'}`} role="listbox">
            {chatModels.map(m => (
              <button key={m.id} type="button" role="option" aria-selected={m.providerId === selectedProviderId && m.modelId === selectedModel} onClick={() => { setSelectedModel(m.modelId); setSelectedProviderId(m.providerId); setOpenModelMenu(null); }}
                className={`w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors cursor-pointer ${m.providerId === selectedProviderId && m.modelId === selectedModel ? 'bg-primary/10' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${m.providerId === selectedProviderId && m.modelId === selectedModel ? 'text-primary' : ''}`}>{m.name}</span>
                  {m.tags && m.tags.map((t: string) => (
                    <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{t}</span>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground/60 mt-0.5">
                  {m.originalName || m.modelId}
                  {m.providerName && <span className="ml-1">· {m.providerName}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-0.5" aria-label="推理强度">
          {(['low', 'medium', 'high', 'maximum'] as ReasoningEffort[]).map((effort) => (
            <button key={effort} type="button" onClick={() => setReasoningEffort(effort)} className={`px-2 py-1 rounded-md text-[11px] transition-colors ${reasoningEffort === effort ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`} title="推理强度">
              {effort === 'low' ? '轻量' : effort === 'medium' ? '均衡' : effort === 'high' ? '深度' : '极强'}
            </button>
          ))}
        </div>
        <select value={responseSpeed} onChange={(event) => setResponseSpeed(event.target.value as ResponseSpeed)} className="h-8 rounded-lg border border-border bg-muted px-2 text-xs text-foreground" aria-label="响应速度">
          <option value="fast">快速响应</option>
          <option value="balanced">均衡响应</option>
          <option value="quality">质量优先</option>
        </select>
        {/* Image Model Selector */}
        <div ref={imageModelMenuRef} className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openModelMenu === 'image'}
            onClick={() => setOpenModelMenu(openModelMenu === 'image' ? null : 'image')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-xs cursor-pointer"
          >
            <Image className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-medium max-w-[100px] truncate">{imageModels.find(m => m.providerId === selectedImageProviderId && m.modelId === selectedImageModel)?.name || selectedImageModel || '图像模型'}</span>
            <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${openModelMenu === 'image' ? 'rotate-180' : ''}`} />
          </button>
          <div className={`absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-xl shadow-xl z-[100] max-h-96 overflow-y-auto p-1 transition-opacity ${openModelMenu === 'image' ? 'opacity-100 visible pointer-events-auto' : 'opacity-0 invisible pointer-events-none'}`} role="listbox">
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground/60 font-medium">图像生成模型</div>
            {imageModels.map(m => (
              <button key={m.id} type="button" role="option" aria-selected={m.providerId === selectedImageProviderId && m.modelId === selectedImageModel} onClick={() => { setSelectedImageModel(m.modelId); setSelectedImageProviderId(m.providerId); setOpenModelMenu(null); }}
                className={`w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors cursor-pointer ${m.providerId === selectedImageProviderId && m.modelId === selectedImageModel ? 'bg-primary/10' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${m.providerId === selectedImageProviderId && m.modelId === selectedImageModel ? 'text-primary' : ''}`}>{m.name}</span>
                  {m.tags && m.tags.map(t => (
                    <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{t}</span>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground/60 mt-0.5">
                  {m.originalName || m.modelId}
                  {m.providerName && <span className="ml-1">· {m.providerName}</span>}
                </div>
              </button>
            ))}
            {imageModels.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground/50">暂无可用图像模型</div>
            )}
          </div>
        </div>
        {/* Project tools */}
        <button onClick={() => setShowInstructionsPanel(true)}
          className={`p-1.5 rounded-lg transition-colors ${project.instructions ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          title="项目指令">
          <FileText className="w-4 h-4" />
        </button>
        <button onClick={() => setShowKnowledgePanel(true)}
          className={`p-1.5 rounded-lg transition-colors ${knowledgeItems.length > 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          title="知识库">
          <Database className="w-4 h-4" />
        </button>
        <button onClick={() => setShowArtifacts(!showArtifacts)}
          className={`p-1.5 rounded-lg transition-colors ${showArtifacts ? 'bg-primary/10 text-primary' : artifacts.length > 0 ? 'text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          title="Artifacts 文档">
          <FileCode className="w-4 h-4" />
        </button>
        <button onClick={() => setShowSearch(!showSearch)}
          className={`p-1.5 rounded-lg transition-colors ${showSearch ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          title="项目内搜索">
          <Search className="w-4 h-4" />
        </button>
        <button onClick={() => setShowMemory(true)}
          className={`p-1.5 rounded-lg transition-colors ${memories.length > 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          title="用户记忆">
          <Brain className="w-4 h-4" />
        </button>
        <button onClick={() => setShowCanvas(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          title="写作画布">
          <PenSquare className="w-4 h-4" />
        </button>
        <button onClick={() => setShowGlobalSearch(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          title="全局搜索 (Ctrl+K)">
          <Globe className="w-4 h-4" />
        </button>
        <button onClick={() => { setTempChat(!tempChat); if (!tempChat) { messages.forEach(() => {}); } }}
          className={`p-1.5 rounded-lg transition-colors ${tempChat ? 'bg-amber-500/20 text-amber-500' : 'text-muted-foreground hover:bg-muted'}`}
          title={tempChat ? "临时聊天中（不保存）" : "开启临时聊天"}>
          <Shield className="w-4 h-4" />
        </button>
        <button onClick={() => setShowShare(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          title="分享对话">
          <Share2 className="w-4 h-4" />
        </button>
        <button onClick={() => setShowUsageStats(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          title="用量统计">
          <Clock className="w-4 h-4" />
        </button>
        <button onClick={() => setShowReportExport(true)} disabled={!messages.some(m => m.role === 'assistant' && m.content)}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
          title="导出分析报告">
          <Download className="w-4 h-4" />
        </button>
        <button onClick={() => onCreateTask(project.id)}
          className="px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs transition-colors">
          <MessageSquarePlus className="w-3.5 h-3.5 inline mr-1" />新对话
        </button>
      </header>

      {/* Agent Bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 shrink-0">
          <Bot className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Agent:</span>
          {controlNotice && <span className="max-w-[360px] truncate text-[11px] text-muted-foreground" title={controlNotice}>· {controlNotice}</span>}
          {activeAgent ? (
            <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
              {activeAgent.emoji || '🤖'} {activeAgent.name}
              <button onClick={() => onUpdateTask({ ...task, activeAgentId: undefined })} className="ml-1 hover:text-red-500"><X className="w-3 h-3" /></button>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">未选择</span>
          )}
          <div className="flex-1" />
          <button onClick={() => setShowAgentPanel(!showAgentPanel)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <Settings className="w-3 h-3" /> 管理
          </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-20 space-y-4">
              <h1 className="text-3xl font-bold text-foreground">{activeAgent ? `${activeAgent.emoji || '🤖'} ${activeAgent.name}` : project.name}</h1>
              <p className="text-muted-foreground">开始一段新的对话吧</p>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {PRESET_SKILLS.slice(0, 6).map(skill => (
                  <button key={skill.id} onClick={() => onSkillToAgent(skill)}
                    className="px-3 py-1.5 rounded-full border border-border hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                    <span>{skill.icon}</span> {skill.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.length > 100 && (
            <div className="flex justify-center py-2">
              <span className="text-xs text-muted-foreground/60">
                共 {messages.length} 条消息
              </span>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 120px' }}>
              {/* Search results card */}
              {msg.role === 'search' && (
                <SearchResultsCard content={msg.content} />
              )}
              {msg.role !== 'search' && (<>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  {activeAgent?.emoji ? <span className="text-sm">{activeAgent.emoji}</span> : <Bot className="w-3.5 h-3.5 text-primary" />}
                </div>
              )}
              <div className={`max-w-[82%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                <div className={`rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-md'
                    : 'bg-card border border-border rounded-bl-md'
                }`}>
                  {msg.role === 'assistant' && !msg.content && isStreaming && idx === messages.length - 1 ? (
                    <div className="flex items-center gap-1 py-1">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  ) : msg.role === 'assistant' ? (
                    <MarkdownRenderer content={msg.content} />
                  ) : editingMessageId === msg.id ? (
                    <div className="space-y-2 min-w-[280px]">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="w-full bg-primary-foreground/10 text-primary-foreground rounded-lg px-3 py-2 text-sm outline-none resize-y min-h-[60px]"
                        autoFocus
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setEditingMessageId(null); setEditingContent(''); }} className="px-2.5 py-1 rounded text-xs bg-primary-foreground/20 hover:bg-primary-foreground/30">取消</button>
                        <button onClick={() => handleEditSubmit(msg.id)} className="px-2.5 py-1 rounded text-xs bg-primary-foreground text-primary font-medium">保存并重新生成</button>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
                  )}
                  {msg.agentRunId && (
                    <div className="mt-3">
                      <AgentRunMessageProgress runId={msg.agentRunId} />
                    </div>
                  )}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {msg.images.map((url, i) => (
                        <img key={i} src={url} alt="" className="w-20 h-20 object-cover rounded-lg cursor-zoom-in hover:opacity-80 transition-opacity"
                          onClick={() => setLightbox({ images: msg.images!, index: i })} />
                      ))}
                    </div>
                  )}
                </div>
                {/* Message Operations */}
                {msg.role === 'assistant' && msg.content && !isStreaming && (
                  <div className="flex gap-0.5 mt-1 px-1 opacity-0 hover:opacity-100 transition-opacity flex-wrap">
                    <button onClick={() => copyMessage(msg.content)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="复制"><Copy className="w-3 h-3" /></button>
                    <button onClick={regenerateLast} className="p-1 rounded hover:bg-muted text-muted-foreground" title="重新生成"><RefreshCw className="w-3 h-3" /></button>
                    <button onClick={() => makeShorter(msg)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="更短"><Minimize2 className="w-3 h-3" /></button>
                    <button onClick={() => makeLonger(msg)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="更长"><Maximize2 className="w-3 h-3" /></button>
                    <button onClick={() => continueConversation(msg)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="继续"><MoreHorizontal className="w-3 h-3" /></button>
                    <button onClick={() => toImagePrompt(msg)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="转生图提示词"><Sparkles className="w-3 h-3" /></button>
                    <button onClick={() => branchFromMessage(msg.id)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="从此分支"><GitBranch className="w-3 h-3" /></button>
                    <button onClick={() => saveAsArtifact(msg)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="保存为 Artifact"><FileCode className="w-3 h-3" /></button>
                    {hasPptJson(msg.content) && (
                      <button onClick={() => downloadPptx(msg.content)} disabled={downloadingPptx}
                        className="p-1 rounded hover:bg-primary/10 text-primary transition-colors" title="下载 PPTX">
                        {downloadingPptx ? <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> : <Download className="w-3 h-3" />}
                      </button>
                    )}
                    {hasExcelJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadExcel(d); }}
                        className="p-1 rounded hover:bg-green-500/10 text-green-500 transition-colors" title="下载 Excel">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {hasWordJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadWord(d); }}
                        className="p-1 rounded hover:bg-blue-500/10 text-blue-500 transition-colors" title="下载 Word">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {hasMindmapJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadMindmap(d); }}
                        className="p-1 rounded hover:bg-amber-500/10 text-amber-500 transition-colors" title="下载思维导图">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {hasFlowchartJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadFlowchart(d); }}
                        className="p-1 rounded hover:bg-purple-500/10 text-purple-500 transition-colors" title="下载流程图">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {hasPdfJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadPdf(d); }}
                        className="p-1 rounded hover:bg-red-500/10 text-red-500 transition-colors" title="下载 PDF">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {msg.images && msg.images.length > 0 && (
                      <button
                        onClick={() => { void sendImagesToCanvas(msg); }}
                        disabled={canvasTransferMessageId === msg.id || !canTransferSimpleChatMedia(msg.images, msg.imageRefs || [])}
                        className="p-1 rounded hover:bg-blue-500/10 text-blue-500 transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        title={canTransferSimpleChatMedia(msg.images, msg.imageRefs || [])
                          ? '添加到画布'
                          : '历史图片或登记失败的图片不可转移'}
                      >
                        <Send className="w-3 h-3" />
                      </button>
                    )}
                    {/* 回复评分 */}
                    <span className="w-px h-4 bg-border mx-0.5 self-center" />
                    <button onClick={() => handleRateMessage(msg.id, 'up')}
                      className={`p-1 rounded transition-colors ${messageRatings[msg.id] === 'up' ? 'text-green-500 bg-green-500/10' : 'hover:bg-muted text-muted-foreground'}`} title="有帮助">
                      <ThumbsUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => handleRateMessage(msg.id, 'down')}
                      className={`p-1 rounded transition-colors ${messageRatings[msg.id] === 'down' ? 'text-red-500 bg-red-500/10' : 'hover:bg-muted text-muted-foreground'}`} title="无帮助">
                      <ThumbsDown className="w-3 h-3" />
                    </button>
                    {/* 保存到 Canvas */}
                    <button onClick={() => { setCanvasContent(msg.content); setShowCanvas(true); }}
                      className="p-1 rounded hover:bg-primary/10 text-primary transition-colors" title="在 Canvas 中编辑">
                      <PenSquare className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {/* User Message Operations */}
                {msg.role === 'user' && !isStreaming && editingMessageId !== msg.id && (
                  <div className="flex gap-0.5 mt-1 px-1 opacity-0 hover:opacity-100 transition-opacity">
                    <button onClick={() => copyMessage(msg.content)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="复制"><Copy className="w-3 h-3" /></button>
                    <button onClick={() => { setEditingMessageId(msg.id); setEditingContent(msg.content); }} className="p-1 rounded hover:bg-muted text-muted-foreground" title="编辑"><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => handleDeleteMessage(msg.id)} className="p-1 rounded hover:bg-red-500/10 text-red-500" title="删除"><Trash2 className="w-3 h-3" /></button>
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                  <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
              </>)}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick Commands 快捷工作流 */}
      {showQuickCommands && (
        <div className="px-4 pb-1">
          <div className="max-w-3xl mx-auto">
            <QuickCommands
              isMonochrome={false}
              hasImages={uploadedImages.length > 0}
              onSelect={prompt => { setInput(prompt); setShowQuickCommands(false); textareaRef.current?.focus(); }}
              onClose={() => setShowQuickCommands(false)}
            />
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
          <div
            className={`relative bg-card border rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all ${dragOver ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {dragOver && (
              <div className="absolute inset-0 z-10 bg-primary/5 rounded-2xl flex items-center justify-center pointer-events-none">
                <span className="text-sm text-primary font-medium">松开以上传图片</span>
              </div>
            )}
            {/* 多轮图片上下文提示：历史最近 3 轮的图片将随本次消息一起发送 */}
            {historyImages.length > 0 && uploadedImages.length === 0 && messages.length > 0 && (
              <div className="flex items-center gap-2 px-4 pt-3 text-[11px] text-muted-foreground">
                <Image className="w-3.5 h-3.5 text-primary" />
                <span>将携带最近对话中的 {historyImages.length} 张图片作为上下文</span>
                <div className="flex -space-x-2">
                  {historyImages.slice(0, 4).map((img, i) => (
                    <img key={i} src={img} alt="" className="w-6 h-6 rounded-full border border-border object-cover" />
                  ))}
                </div>
              </div>
            )}
            {uploadedImages.length > 0 && (
              <div className="flex gap-2 px-4 pt-3 flex-wrap">
                {uploadedImages.map((att, i) => (
                  <div key={i} className="relative group">
                    <img src={att.url} alt="" className="w-16 h-16 object-cover rounded-lg" />
                    <button onClick={() => setUploadedImages(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3" />
                    </button>
                    <button onClick={() => {
                      setInput(`请对这张图片进行深度分析报告，从视觉风格、文案策略、目标受众、可复用技巧四个维度拆解，并给出可执行的创作建议：`);
                      textareaRef.current?.focus();
                    }}
                      className="absolute -bottom-1 -left-1 px-1.5 py-0.5 rounded bg-primary text-primary-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      深度分析
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={activeAgent ? `与 ${activeAgent.name} 对话...` : "输入消息，Enter 发送，支持 Ctrl+V 粘贴图片"}
              rows={1}
              className="w-full bg-transparent px-4 py-3 pr-28 text-sm resize-none outline-none placeholder:text-muted-foreground/50 min-h-[48px] max-h-[200px]"
              style={{ scrollbarWidth: 'thin' }}
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              <button onClick={() => setBrandActive(!brandActive)}
                className={`p-1.5 rounded-lg transition-colors ${brandActive ? 'bg-amber-500/10 text-amber-500' : 'text-muted-foreground hover:bg-muted'}`}
                title="品牌DNA注入 - 将品牌规范注入对话上下文">
                <Shield className="w-4 h-4" />
              </button>
              <button onClick={() => setWebSearch(!webSearch)}
                className={`p-1.5 rounded-lg transition-colors ${webSearch ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                title="联网搜索">
                <Globe className="w-4 h-4" />
              </button>
              <button onClick={handleDeepResearch} disabled={!input.trim() || isStreaming}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                title="Deep Research - 深度研究">
                <Telescope className="w-4 h-4" />
              </button>
              <button onClick={() => setShowSkillPanel(!showSkillPanel)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors" title="Skill">
                <BookOpen className="w-4 h-4" />
              </button>
              <button onClick={() => setShowAgentPanel(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors" title="Agent 模式">
                <Bot className="w-4 h-4" />
              </button>
              <button onClick={() => document.getElementById('chat-file-upload')?.click()}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors" title="上传图片">
                <Paperclip className="w-4 h-4" />
              </button>
              {/* 快捷工作流 */}
              <button onClick={() => setShowQuickCommands(v => !v)}
                className={`p-1.5 rounded-lg transition-colors ${showQuickCommands ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                title="快捷工作流">
                <Zap className="w-4 h-4" />
              </button>
              {/* 提示词优化器 */}
              <button onClick={() => setShowPromptOptimizer(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                title="提示词优化器 (Ctrl+Shift+P)">
                <PenLine className="w-4 h-4" />
              </button>
              {/* 多模型对比 */}
              <button onClick={() => setShowModelCompare(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                title="多模型对比 (Ctrl+M)">
                <GitBranch className="w-4 h-4" />
              </button>
              <button onClick={handleSend} disabled={!input.trim() && uploadedImages.length === 0}
                className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 transition-all hover:bg-primary/90">
                {isStreaming ? <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
            <input id="chat-file-upload" type="file" accept="image/*" multiple className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files || []);
                files.forEach(f => {
                  const reader = new FileReader();
                  reader.onload = ev => {
                    setUploadedImages(prev => [...prev, {
                      id: Math.random().toString(36).slice(2, 10),
                      type: 'image', name: f.name, mimeType: f.type,
                      url: ev.target?.result as string
                    }]);
                  };
                  reader.readAsDataURL(f);
                });
              }} />
          </div>
          <div className="text-xs text-muted-foreground/50 text-center mt-2 flex flex-wrap items-center justify-center gap-3">
            <label className="inline-flex items-center gap-1">
              <span>目标画布</span>
              <select
                aria-label="目标画布项目"
                value={selectedCanvasProjectId}
                onChange={event => setSelectedCanvasProjectId(event.target.value)}
                className="max-w-36 bg-transparent text-foreground border border-border rounded px-1.5 py-0.5 outline-none"
              >
                <option value="">未选择</option>
                {canvasProjects.map(canvasProject => (
                  <option key={canvasProject.id} value={canvasProject.id}>{canvasProject.name}</option>
                ))}
              </select>
            </label>
            <button onClick={toggleTheme} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              {theme === 'dark' ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
              {theme === 'dark' ? '亮色模式' : '暗色模式'}
            </button>
            <button onClick={() => setTempChat(v => !v)} className={`inline-flex items-center gap-1 transition-colors ${tempChat ? 'text-amber-500' : 'hover:text-foreground'}`}>
              <EyeOff className="w-3 h-3" />{tempChat ? '临时聊天中' : '临时聊天'}
            </button>
            <button onClick={() => setShowGlobalSearch(true)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              <Search className="w-3 h-3" />全局搜索
            </button>
          </div>
        </div>
      </div>

      {/* Skill Panel */}
      {showSkillPanel && <SkillPanel skills={PRESET_SKILLS} onSelect={skill => { onSkillToAgent(skill); setShowSkillPanel(false); }} onClose={() => setShowSkillPanel(false)} />}

      {/* Agent Panel */}
      {showAgentPanel && (
        <ModalOverlay onClose={() => setShowAgentPanel(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <ModalHeader title="Agent 管理" onClose={() => setShowAgentPanel(false)} />
            {project.agents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无 Agent，从 Skill 书创建</p>
            ) : (
              <div className="space-y-2">
                {project.agents.map(agent => (
                  <div key={agent.id} className="p-3 rounded-xl border border-border flex items-center gap-3">
                    <span className="text-xl">{agent.emoji || '🤖'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{agent.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{agent.description}</div>
                    </div>
                    <button onClick={() => onUpdateTask({ ...task, activeAgentId: agent.id })} className="text-xs px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20">使用</button>
                    <button onClick={() => onDeleteAgent(agent.id)} className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* Instructions Panel */}
      {showInstructionsPanel && (
        <ModalOverlay onClose={() => setShowInstructionsPanel(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <ModalHeader title="项目指令" onClose={() => setShowInstructionsPanel(false)} />
            <p className="text-xs text-muted-foreground mb-4">
              项目指令会自动注入到每次对话的 System Prompt 中，控制 AI 的行为、风格和约束。所有对话均生效，无需每次重复说明。
            </p>
            <div className="space-y-4">
              <Field label="项目背景" value={instructionsDraft.projectBackground} onChange={v => setInstructionsDraft(d => ({ ...d, projectBackground: v }))} placeholder="例如：这是一个电商客服系统..." />
              <Field label="用户偏好" value={instructionsDraft.userPreference} onChange={v => setInstructionsDraft(d => ({ ...d, userPreference: v }))} placeholder="例如：用简洁的语言，不要过于技术化..." />
              <Field label="输出格式" value={instructionsDraft.outputFormat} onChange={v => setInstructionsDraft(d => ({ ...d, outputFormat: v }))} placeholder="例如：使用 Markdown 格式，代码用代码块..." />
              <Field label="风格规则" value={instructionsDraft.styleRules} onChange={v => setInstructionsDraft(d => ({ ...d, styleRules: v }))} placeholder="例如：正式商务风格，避免俚语..." />
              <Field label="禁止规则" value={instructionsDraft.forbiddenRules} onChange={v => setInstructionsDraft(d => ({ ...d, forbiddenRules: v }))} placeholder="例如：不要提及竞争对手，不要给出法律建议..." />
              <button onClick={saveInstructions} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">保存指令</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Knowledge Panel */}
      {showKnowledgePanel && (
        <ModalOverlay onClose={() => setShowKnowledgePanel(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <ModalHeader title="知识库" onClose={() => setShowKnowledgePanel(false)} />
            <p className="text-xs text-muted-foreground mb-4">
              上传文件、添加链接或笔记作为 AI 对话的知识来源。知识内容会自动注入到每次对话的上下文中，让 AI 基于你的资料回答。
            </p>
            {/* Add buttons */}
            <div className="flex gap-2 mb-4">
              <button onClick={() => setAddingKnowledge('file')} className="flex-1 py-2 rounded-lg border border-border hover:bg-muted text-xs transition-colors">📁 上传文件</button>
              <button onClick={() => setAddingKnowledge('url')} className="flex-1 py-2 rounded-lg border border-border hover:bg-muted text-xs transition-colors">🔗 添加链接</button>
              <button onClick={() => setAddingKnowledge('note')} className="flex-1 py-2 rounded-lg border border-border hover:bg-muted text-xs transition-colors">📝 添加笔记</button>
            </div>
            {/* URL input */}
            {addingKnowledge === 'url' && (
              <div className="mb-4 p-3 rounded-xl border border-border space-y-2">
                <input value={knowledgeUrl} onChange={e => setKnowledgeUrl(e.target.value)}
                  placeholder="输入网址 https://..." className="w-full bg-transparent text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary/50" />
                <div className="flex gap-2">
                  <button onClick={() => addKnowledgeItem({
                    id: Math.random().toString(36).slice(2, 10), projectId: project.id,
                    type: 'url', name: knowledgeUrl, url: knowledgeUrl, tags: [], enabled: true, createdAt: Date.now(), updatedAt: Date.now()
                  })} disabled={!knowledgeUrl} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-40">添加</button>
                  <button onClick={() => setAddingKnowledge(null)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted">取消</button>
                </div>
              </div>
            )}
            {/* Note input */}
            {addingKnowledge === 'note' && (
              <div className="mb-4 p-3 rounded-xl border border-border space-y-2">
                <input value={knowledgeNoteName} onChange={e => setKnowledgeNoteName(e.target.value)}
                  placeholder="笔记标题" className="w-full bg-transparent text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary/50" />
                <textarea value={knowledgeNote} onChange={e => setKnowledgeNote(e.target.value)}
                  placeholder="笔记内容..." rows={4} className="w-full bg-transparent text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary/50 resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => addKnowledgeItem({
                    id: Math.random().toString(36).slice(2, 10), projectId: project.id,
                    type: 'note', name: knowledgeNoteName || '未命名笔记', textContent: knowledgeNote, tags: [], enabled: true, createdAt: Date.now(), updatedAt: Date.now()
                  })} disabled={!knowledgeNote} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-40">添加</button>
                  <button onClick={() => setAddingKnowledge(null)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted">取消</button>
                </div>
              </div>
            )}
            {/* File upload */}
            {addingKnowledge === 'file' && (
              <div className="mb-4 p-3 rounded-xl border border-border text-center">
                <input type="file" onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => {
                    addKnowledgeItem({
                      id: Math.random().toString(36).slice(2, 10), projectId: project.id,
                      type: file.type.startsWith('image/') ? 'image' : 'file',
                      name: file.name, mimeType: file.type,
                      url: ev.target?.result as string, tags: [], enabled: true,
                      createdAt: Date.now(), updatedAt: Date.now()
                    });
                  };
                  reader.readAsDataURL(file);
                }} className="text-xs" />
                <button onClick={() => setAddingKnowledge(null)} className="mt-2 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted">取消</button>
              </div>
            )}
            {/* Usage explanation */}
            {knowledgeItems.length > 0 && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-[11px] text-muted-foreground leading-relaxed">
                💡 启用中的知识条目将作为上下文自动注入 AI 对话中，帮助 AI 基于你的资料给出更准确的回答。
              </div>
            )}
            {/* Items list */}
            {knowledgeItems.length === 0 ? (
              <div className="text-center py-8 space-y-3">
                <p className="text-4xl">📚</p>
                <p className="text-sm text-muted-foreground">还没有知识条目</p>
                <p className="text-xs text-muted-foreground/60">上传文件、添加链接或创建笔记，AI 将基于这些内容回答你的问题</p>
              </div>
            ) : (
              <div className="space-y-2">
                {knowledgeItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-border group hover:bg-muted/30 transition-colors">
                    <button onClick={() => toggleKnowledgeItem(item.id)}
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${item.enabled ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>
                      {item.enabled && <div className="w-2 h-2 rounded-sm bg-primary-foreground" />}
                    </button>
                    <span className="text-lg shrink-0">{item.type === 'file' ? '📄' : item.type === 'image' ? '🖼️' : item.type === 'url' ? '🔗' : '📝'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{item.name}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <span>{item.type === 'file' ? '文件' : item.type === 'image' ? '图片' : item.type === 'url' ? '链接' : '笔记'}</span>
                        {item.type === 'url' && item.url && <span>· {item.url.length > 40 ? item.url.slice(0, 40) + '...' : item.url}</span>}
                        {item.type === 'file' && <span>· {item.mimeType?.split('/')[1] || '未知'} 格式</span>}
                        {item.type === 'image' && <span>· 图片</span>}
                        {item.enabled ? <span className="text-primary">· 将注入上下文</span> : <span className="text-muted-foreground/60">· 已禁用</span>}
                      </div>
                    </div>
                    <button onClick={() => setKnowledgePreview(item)}
                      className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeKnowledgeItem(item.id)}
                      className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* Artifacts Panel */}
      {showArtifacts && (
        <div className="absolute right-0 top-0 bottom-0 w-80 bg-card border-l border-border z-40 flex flex-col shadow-xl" data-modal="true">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-sm">Artifacts</h3>
            <button onClick={() => setShowArtifacts(false)} className="p-1 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {(() => { const allArtifacts = messages.flatMap(m => m.artifacts || []); return allArtifacts.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">暂无 Artifacts<br />生成代码或文档后自动出现</div>
            ) : allArtifacts.map(a => (
              <div key={a.id} className="bg-muted rounded-xl p-3 border border-border hover:border-primary/30 transition-colors cursor-pointer">
                <div className="flex items-center gap-2 mb-2">
                  {a.type === 'code' ? <FileCode className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-primary" />}
                  <span className="text-xs font-medium truncate flex-1">{a.title}</span>
                </div>
                <pre className="text-[11px] text-muted-foreground line-clamp-4 whitespace-pre-wrap">{a.content}</pre>
              </div>
            ))})()}
          </div>
        </div>
      )}

      {/* Knowledge Preview Modal */}
      {knowledgePreview && (
        <ModalOverlay onClose={() => setKnowledgePreview(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col p-6" onClick={e => e.stopPropagation()}>
            <ModalHeader title={knowledgePreview.name} onClose={() => setKnowledgePreview(null)} />
            <p className="text-xs text-muted-foreground mb-2">{knowledgePreview.type === 'file' ? '📄 文件内容预览' : knowledgePreview.type === 'url' ? '🔗 URL 链接' : '📝 笔记内容'}</p>
            <div className="flex-1 overflow-auto bg-muted/50 rounded-xl p-4 text-sm">
              {knowledgePreview.type === 'url' ? (
                <a href={knowledgePreview.url || knowledgePreview.textContent || ''} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{knowledgePreview.url || knowledgePreview.textContent || ''}</a>
              ) : knowledgePreview.type === 'image' || (knowledgePreview.url && (knowledgePreview.url.startsWith('data:image/') || knowledgePreview.url.startsWith('blob:'))) ? (
                <div className="space-y-3">
                  {knowledgePreview.url && (knowledgePreview.url.startsWith('data:image/') || knowledgePreview.url.startsWith('blob:')) ? (
                    <img src={knowledgePreview.url} alt={knowledgePreview.name} className="max-w-full max-h-[50vh] rounded-lg object-contain bg-transparent" />
                  ) : (
                    <p className="text-muted-foreground text-center py-8">暂不支持预览此图片格式</p>
                  )}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>文件名：{knowledgePreview.name}</p>
                    {knowledgePreview.mimeType && <p>类型：{knowledgePreview.mimeType}</p>}
                  </div>
                </div>
              ) : knowledgePreview.type === 'note' ? (
                (knowledgePreview.textContent || '').length > 5000 ? (
                  <div className="font-mono whitespace-pre-wrap break-all">
                    {(knowledgePreview.textContent || '').slice(0, 5000)}
                    <p className="text-muted-foreground mt-2">... 内容过长，已截断前 5000 字符</p>
                  </div>
                ) : (
                  <div className="font-mono whitespace-pre-wrap break-all">{knowledgePreview.textContent || '(空笔记)'}</div>
                )
              ) : (
                <div className="text-xs text-muted-foreground space-y-2 text-center py-4">
                  <p className="text-4xl">📄</p>
                  <p className="font-medium text-foreground">{knowledgePreview.name}</p>
                  {knowledgePreview.mimeType && <p>类型：{knowledgePreview.mimeType}</p>}
                  <p className="text-muted-foreground/60">文件已上传，可在对话中作为知识上下文引用</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-3">💡 知识库内容会自动注入到 AI 对话上下文中，帮助 AI 更准确地理解你的需求。</p>
          </div>
        </ModalOverlay>
      )}

      {/* Search Panel */}
      {showSearch && (
        <ModalOverlay onClose={() => setShowSearch(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <ModalHeader title="项目内搜索" onClose={() => setShowSearch(false)} />
            <div className="flex gap-2 mb-4">
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleProjectSearch()}
                placeholder="搜索消息内容..."
                className="flex-1 bg-muted px-3 py-2 rounded-lg border border-border text-sm outline-none focus:border-primary/50" />
              <button onClick={handleProjectSearch} className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm">搜索</button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => {
                  if (task && task.id !== r.taskId) onSelectTask(project.tasks.find(t => t.id === r.taskId) || task);
                  setShowSearch(false);
                }}
                  className="w-full text-left p-3 rounded-xl border border-border hover:bg-muted transition-colors">
                  <div className="text-xs font-medium">{r.taskName}</div>
                  <div className="text-[11px] text-muted-foreground line-clamp-2 mt-1">{r.snippet}</div>
                </button>
              ))}
              {searchResults.length === 0 && searchQuery && (
                <div className="text-center text-muted-foreground text-sm py-4">未找到匹配结果</div>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Share Dialog — 公开链接分享 */}
      {showShare && (
        <ShareDialog
          conversationId={task?.id || project?.id || 'unknown'}
          conversationTitle={task?.name || project?.name || '对话'}
          messages={messages.map(m => ({ id: m.id, role: m.role, content: m.content, images: m.images, timestamp: m.createdAt }))}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Canvas 写作画布 */}
      {showCanvas && (
        <CanvasEditor
          content={canvasContent}
          onClose={() => setShowCanvas(false)}
          onSave={(c) => setCanvasContent(c)}
          onAiEdit={async (selected, instruction) => {
            const res = await fetch('/api/simple-chat/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                providerId: selectedProviderId, model: selectedModel,
                reasoningEffort, responseSpeed,
                systemPrompt: '你是专业文案编辑助手。根据用户指令改写选中文本，只返回改写后的文本，不要解释。',
                messages: [{ role: 'user', content: `原文：\n${selected}\n\n改写指令：${instruction}` }],
                stream: false,
              }),
            });
            const data = await res.json();
            return data.content || data.choices?.[0]?.message?.content || selected;
          }}
        />
      )}

      {/* 记忆管理面板 */}
      {showMemory && (
        <MemoryPanel
          memories={memories}
          onClose={() => setShowMemory(false)}
          onAdd={async (content, category) => {
            const res = await fetch('/api/simple-chat/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, category }) });
            if (res.ok) { const m = await res.json(); setMemories(prev => [...prev, m]); }
          }}
          onDelete={async (id) => {
            await fetch(`/api/simple-chat/memory?id=${id}`, { method: 'DELETE' });
            setMemories(prev => prev.filter(m => m.id !== id));
          }}
        />
      )}

      {/* 图片灯箱 */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* 全局搜索 */}
      {showGlobalSearch && (
        <GlobalSearch
          conversations={project?.tasks?.map(t => ({
            id: t.id, title: t.name,
            messages: (t.messages || []).map(m => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content })),
          })) || []}
          onClose={() => setShowGlobalSearch(false)}
          onNavigate={(taskId) => {
            setShowGlobalSearch(false);
            const selectedTask = project?.tasks.find(candidate => candidate.id === taskId);
            if (selectedTask) onSelectTask(selectedTask);
          }}
        />
      )}

      {/* 提示词优化器 */}
      {showPromptOptimizer && (
        <PromptOptimizer
          isMonochrome={theme !== 'dark'}
          currentPrompt={input}
          onApply={(optimized) => { setInput(optimized); setShowPromptOptimizer(false); textareaRef.current?.focus(); }}
          onClose={() => setShowPromptOptimizer(false)}
        />
      )}

      {/* 报告导出 */}
      {showReportExport && (
        <ReportExport
          isMonochrome={theme !== 'dark'}
          content={[...messages].reverse().find(m => m.role === 'assistant' && m.content)?.content || ''}
          title={task?.name || '分析报告'}
          onClose={() => setShowReportExport(false)}
        />
      )}

      {/* 多模型对比 */}
      {showModelCompare && (
        <ModelCompare
          isMonochrome={theme !== 'dark'}
          prompt={input}
          models={chatModels.map(m => ({ id: m.modelId, providerId: m.providerId, name: m.name, displayName: m.name }))}
          onClose={() => setShowModelCompare(false)}
        />
      )}

      {/* 用量统计 */}
      {showUsageStats && (
        <UsageStats
          usage={{
            prompt: tokenUsage?.promptTokens || 0,
            completion: tokenUsage?.completionTokens || 0,
            total: tokenUsage?.totalTokens || 0,
          }}
          messageCount={messages.filter(m => m.role === 'user' || m.role === 'assistant').length}
          imageCount={messages.reduce((sum, m) => sum + (m.images?.length || 0), 0)}
          isMonochrome={theme !== 'dark'}
          onClose={() => setShowUsageStats(false)}
        />
      )}

      {/* Upload File to Knowledge — 自动提取文本内容，支持文件直接分析 */}
      <input id="knowledge-file-upload" type="file" accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx,.md" className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files || []);
          files.forEach(f => {
            const id = Math.random().toString(36).slice(2, 10);
            const reader = new FileReader();
            reader.onload = async ev => {
              const dataUrl = ev.target?.result as string;
              let textContent = '';
              // 调用文本提取 API（PDF/Word/TXT/MD），使文件内容可直接注入 AI 上下文分析
              try {
                const ext = f.name.split('.').pop()?.toLowerCase() || '';
                const fileType = ext === 'docx' || ext === 'doc' ? 'docx' : ext === 'pdf' ? 'pdf' : ext === 'md' ? 'md' : 'txt';
                const resp = await fetch('/api/knowledge/extract-text', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fileUrl: dataUrl, fileType }),
                });
                if (resp.ok) {
                  const data = await resp.json();
                  textContent = (data.text || '').slice(0, 20000);
                }
              } catch { /* 提取失败时仅保存文件元数据 */ }
              addKnowledgeItem({
                id, type: 'file', name: f.name, enabled: true, mimeType: f.type,
                textContent: textContent || undefined,
                projectId: project?.id || '', tags: [], createdAt: Date.now(), updatedAt: Date.now()
              });
              if (textContent) {
                setInput(prev => prev || `请分析我上传的文件「${f.name}」的内容，总结核心要点，并从文案策划角度给出可复用的建议：`);
              }
            };
            reader.readAsDataURL(f);
          });
          e.target.value = '';
        }}
      />

      {/* Search results info bar */}
      {searchStatus && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-primary/10 text-xs text-muted-foreground shrink-0">
          <Globe className="w-3.5 h-3.5 text-primary animate-pulse" />
          <span>{searchStatus}</span>
        </div>
      )}
    </div>
  );
}

// ===== Sub-components =====

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      {children}
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2}
        className="w-full bg-muted text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary/50 resize-none placeholder:text-muted-foreground/40" />
    </div>
  );
}

function SkillPanel({ skills, onSelect, onClose }: { skills: PresetSkill[]; onSelect: (skill: PresetSkill) => void; onClose: () => void }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <ModalHeader title="Skill 书" onClose={onClose} />
        <div className="space-y-2">
          {skills.map(skill => (
            <button key={skill.id} onClick={() => onSelect(skill)}
              className="w-full text-left p-3 rounded-xl border border-border hover:bg-muted transition-colors flex items-start gap-3">
              <span className="text-2xl">{skill.icon}</span>
              <div>
                <div className="font-medium text-sm">{skill.name}</div>
                <div className="text-xs text-muted-foreground">{skill.description}</div>
                <div className="flex gap-1 mt-1">
                  {skill.tags.map(t => <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{t}</span>)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </ModalOverlay>
  );
}
