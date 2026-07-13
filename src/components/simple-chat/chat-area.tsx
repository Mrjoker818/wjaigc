"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Menu, Paperclip, ArrowUp, Globe, X, Settings, Bot, User as UserIcon, BookOpen, ChevronDown, Copy, RefreshCw, Trash2, Zap, Sun, Moon, FileText, Database, Sparkles, MessageSquarePlus, Minimize2, Maximize2, MoreHorizontal, Telescope, FileCode, GitBranch, Share2, Search, Eye, Image, Download, Send, Shield } from "lucide-react";
import {
  SimpleChatProject, SimpleChatTask, SimpleChatMessage, SimpleChatAgent, ChatAttachment, ChatArtifact,
  ProjectInstructions, ProjectKnowledgeItem,
  PRESET_SKILLS, PresetSkill
} from "./simple-chat-types";
import { User } from "@/lib/user-types";
import { useTheme } from "@/app/simple-chat/providers";

type ChatModelInfo = {
  id: string;
  name: string;
  modelId: string;
  originalName?: string;
  providerId: string;
  providerName?: string;
  tags?: string[];
};
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeGenerationTaskIdsRef = useRef<Set<string>>(new Set());

  // Messages: sync from task
  const [messages, setMessages] = useState<SimpleChatMessage[]>(task?.messages || []);

  // Sync when task changes
  useEffect(() => {
    if (task) {
      setMessages(task.messages);
      setSelectedModel(task.model);
      setSelectedProviderId(task.providerId);
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

  // Sync task to parent
  useEffect(() => {
    if (!task || !project) return;
    onUpdateTask({ ...task, messages, model: selectedModel, providerId: selectedProviderId, imageModel: selectedImageModel, imageProviderId: selectedImageProviderId, updatedAt: Date.now() });
  }, [messages, selectedModel, selectedProviderId, selectedImageModel, selectedImageProviderId]);

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

  // Handle send
  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content && uploadedImages.length === 0) return;
    if (isStreaming || !project || !task) return;

    const userMsg: SimpleChatMessage = {
      id: Math.random().toString(36).slice(2, 10),
      role: 'user', content,
      images: uploadedImages.map(i => i.url).filter(Boolean) as string[],
      attachments: uploadedImages.length > 0 ? uploadedImages : undefined,
      createdAt: Date.now(),
    };

    const aiMsg: SimpleChatMessage = {
      id: Math.random().toString(36).slice(2, 10),
      role: 'assistant', content: '',
      model: selectedModel, providerId: selectedProviderId,
      createdAt: Date.now(),
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setInput("");
    setUploadedImages([]);
    setIsStreaming(true);

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

      const allMessages = [
        ...systemMessages,
        ...messages.filter(m => m.role !== 'search').map(m => ({ role: m.role, content: m.content, images: m.images })),
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

      const res = await fetch('/api/simple-chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages, model: selectedModel, providerId: selectedProviderId, imageModel: selectedImageModel, imageProviderId: selectedImageProviderId, webSearch, knowledgeItems: apiKnowledgeItems, projectId: project.id, taskId: task.id }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

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
              if (parsed.type === 'search_status') {
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
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: `*${parsed.label || '正在处理图片任务...'}*`,
                      ...(parsed.generationTask ? {
                        generationTask: parsed.generationTask,
                        isGeneratingImage: true,
                      } : {}),
                    };
                    if (parsed.generationTask) {
                      activeGenerationTaskIdsRef.current.add(parsed.generationTask.taskId);
                    }
                  }
                  return updated;
                });
              } else if (parsed.type === 'generation_task') {
                // 从 SSE 获取 taskId 后，浏览器端开始轮询
                if (parsed.taskId) {
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.role === 'assistant') {
                      updated[updated.length - 1] = {
                        ...last,
                        generationTask: { taskId: parsed.taskId, model: parsed.model, providerId: parsed.providerId, status: 'polling' },
                        isGeneratingImage: true,
                      };
                      activeGenerationTaskIdsRef.current.add(parsed.taskId);
                    }
                    return updated;
                  });
                  startImageTaskPolling(parsed.taskId);
                }
              } else if (parsed.type === 'image' && parsed.imageUrl) {
                setSearchStatus(null);
                // 如果有 generationTask，标记为完成并清理
                if (parsed.taskId) {
                  activeGenerationTaskIdsRef.current.delete(parsed.taskId);
                }
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content || '图片已生成',
                      images: [...(last.images || []), parsed.imageUrl],
                      isGeneratingImage: false,
                    };
                  }
                  return updated;
                });
              } else if (parsed.type === 'error') {
                setSearchStatus(null);
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: `请求失败：${parsed.error || '未知错误'}\n\n建议：尝试切换模型或稍后重试。`,
                    };
                  }
                  return updated;
                });
              } else if (parsed.type === 'text' && parsed.content) {
                setSearchStatus(null);
                fullContent += parsed.content;
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: fullContent };
                  }
                  return updated;
                });
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: '抱歉，请求失败，请重试。' };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, selectedModel, selectedProviderId, messages, project, task, uploadedImages, webSearch]);

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

  // Start polling a single image generation taskId (browser-side, replaces server polling)
  const startImageTaskPolling = useCallback(async (taskId: string) => {
    if (!taskId || activeGenerationTaskIdsRef.current.has(taskId)) return;
    activeGenerationTaskIdsRef.current.add(taskId);

    const MAX_ATTEMPTS = 600;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (!activeGenerationTaskIdsRef.current.has(taskId)) return; // cancelled
      try {
        const res = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status === 'completed' || data.status === 'failed') {
          activeGenerationTaskIdsRef.current.delete(taskId);
          // Import dynamically to avoid circular dependency
          const { extractTaskResultImageUrl } = await import('@/lib/task-result-url');
          const imageUrl = extractTaskResultImageUrl(data);
          setMessages(prev => prev.map(m => {
            if (m.generationTask?.taskId !== taskId) return m;
            return {
              ...m,
              isGeneratingImage: false,
              images: imageUrl ? [...(m.images || []), imageUrl] : m.images,
              generationTask: m.generationTask ? { ...m.generationTask, status: data.status as 'completed' | 'failed', imageUrl: imageUrl || undefined } : undefined,
            };
          }));
          return;
        }
      } catch {
        // ignore network errors, continue polling
      }
      const delay = Math.min(2000 + i * 100, 8000);
      await new Promise(r => setTimeout(r, delay));
    }
    activeGenerationTaskIdsRef.current.delete(taskId);
  }, []);

  // Resume pending image generation tasks on mount
  useEffect(() => {
    if (!project) return;
    const toResume: Array<{ taskId: string; messageId: string }> = [];
    for (const t of project.tasks) {
      for (const m of t.messages) {
        if (m.generationTask?.status === 'polling' && m.generationTask.taskId && m.isGeneratingImage) {
          toResume.push({ taskId: m.generationTask.taskId, messageId: m.id });
        }
      }
    }
    if (toResume.length > 0) {
      toResume.forEach(({ taskId }) => {
        startImageTaskPolling(taskId);
      });
    }
  }, [project, startImageTaskPolling]);

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

  // Share
  const handleShare = useCallback(() => {
    if (!task) return;
    const shareText = task.messages.map(m => `**${m.role === 'user' ? '用户' : 'AI'}**: ${m.content}`).join('\n\n---\n\n');
    navigator.clipboard.writeText(shareText).then(() => setShowShare(false));
  }, [task]);

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
    } catch (e: any) {
      alert(`解析失败：${e.message}`);
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

  const sendImagesToCanvas = useCallback((imageUrls: string[]) => {
    try {
      const existing = JSON.parse(localStorage.getItem('wujie_canvas_bridge') || '[]');
      const merged = [...existing, ...imageUrls];
      localStorage.setItem('wujie_canvas_bridge', JSON.stringify(merged));
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-20 right-6 z-[9999] bg-blue-600 text-white px-4 py-3 rounded-lg shadow-lg cursor-pointer hover:bg-blue-700 transition-colors text-sm flex items-center gap-2';
      toast.innerHTML = `<span>已添加 ${imageUrls.length} 张图片</span><span class="underline">前往画布查看</span>`;
      toast.onclick = () => { window.open('/', '_blank'); toast.remove(); };
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 8000);
    } catch { /* ignore */ }
  }, []);

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
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
        <button onClick={onToggleSidebar} className="p-2 rounded-lg hover:bg-muted transition-colors" title="切换侧边栏">
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>
        <button onClick={onBackToWorkspace} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="w-4 h-4 rotate-90 inline" /> 工作台
        </button>
        <div className="flex-1" />
        {/* Model Selector */}
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-xs">
            <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
            <span className="font-medium max-w-[120px] truncate">{chatModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModel)?.name || selectedModel || '选择模型'}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
          <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-xl shadow-xl z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all max-h-96 overflow-y-auto p-1">
            {chatModels.map(m => (
              <button key={m.id} onClick={() => { setSelectedModel(m.modelId); setSelectedProviderId(m.providerId); }}
                className={`w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors ${m.providerId === selectedProviderId && m.modelId === selectedModel ? 'bg-primary/10' : ''}`}>
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
        {/* Image Model Selector */}
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-xs">
            <Image className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-medium max-w-[100px] truncate">{imageModels.find(m => m.providerId === selectedImageProviderId && m.modelId === selectedImageModel)?.name || selectedImageModel || '图像模型'}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
          <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-xl shadow-xl z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all max-h-96 overflow-y-auto p-1">
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground/60 font-medium">图像生成模型</div>
            {imageModels.map(m => (
              <button key={m.id} onClick={() => { setSelectedImageModel(m.modelId); setSelectedImageProviderId(m.providerId); }}
                className={`w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors ${m.providerId === selectedImageProviderId && m.modelId === selectedImageModel ? 'bg-primary/10' : ''}`}>
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
        <button onClick={() => setShowShare(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          title="分享对话">
          <Share2 className="w-4 h-4" />
        </button>
        <button onClick={() => onCreateTask(project.id)}
          className="px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs transition-colors">
          <MessageSquarePlus className="w-3.5 h-3.5 inline mr-1" />新对话
        </button>
      </header>

      {/* Agent Bar */}
      {(project.agents.length > 0 || activeAgent) && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 shrink-0">
          <Bot className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Agent:</span>
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
      )}

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
                  ) : (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
                  )}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {msg.images.map((url, i) => (
                        <img key={i} src={url} alt="" className="w-20 h-20 object-cover rounded-lg" />
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
                      <button onClick={() => sendImagesToCanvas(msg.images || [])}
                        className="p-1 rounded hover:bg-blue-500/10 text-blue-500 transition-colors" title="添加到画布">
                        <Send className="w-3 h-3" />
                      </button>
                    )}
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

      {/* Input */}
      <div className="px-4 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
          <div className="relative bg-card border border-border rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all">
            {uploadedImages.length > 0 && (
              <div className="flex gap-2 px-4 pt-3 flex-wrap">
                {uploadedImages.map((att, i) => (
                  <div key={i} className="relative group">
                    <img src={att.url} alt="" className="w-16 h-16 object-cover rounded-lg" />
                    <button onClick={() => setUploadedImages(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeAgent ? `与 ${activeAgent.name} 对话...` : "输入消息，Enter 发送，Shift+Enter 换行"}
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
              <button onClick={() => document.getElementById('chat-file-upload')?.click()}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors" title="上传图片">
                <Paperclip className="w-4 h-4" />
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
          <p className="text-xs text-muted-foreground/50 text-center mt-2">
            <button onClick={toggleTheme} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              {theme === 'dark' ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
              {theme === 'dark' ? '亮色模式' : '暗色模式'}
            </button>
          </p>
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

      {/* Share Dialog */}
      {showShare && (
        <ModalOverlay onClose={() => setShowShare(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <ModalHeader title="分享对话" onClose={() => setShowShare(false)} />
            <p className="text-sm text-muted-foreground mb-4">将当前对话内容复制为 Markdown 格式文本</p>
            <div className="flex gap-2">
              <button onClick={handleShare}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors">
                复制到剪贴板
              </button>
              <button onClick={() => setShowShare(false)}
                className="px-4 py-2 bg-muted rounded-lg text-sm hover:bg-muted/80 transition-colors">取消</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Upload File to Knowledge */}
      <input id="knowledge-file-upload" type="file" accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx,.md" className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files || []);
          files.forEach(f => {
            const id = Math.random().toString(36).slice(2, 10);
            addKnowledgeItem({
              id, type: 'file', name: f.name, enabled: true, mimeType: f.type,
              projectId: project?.id || '', tags: [], createdAt: Date.now(), updatedAt: Date.now()
            });
          });
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
