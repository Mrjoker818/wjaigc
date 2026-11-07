"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useId } from "react";
import { Check, Menu, Paperclip, ArrowUp, Globe, X, Settings, Bot, User as UserIcon, BookOpen, ChevronDown, Copy, RefreshCw, Trash2, Zap, Sun, Moon, FileText, Database, Sparkles, MessageSquarePlus, Minimize2, Maximize2, MoreHorizontal, Telescope, FileCode, GitBranch, Share2, Search, Eye, EyeOff, Image, Download, Send, Shield, ThumbsUp, ThumbsDown, Pencil, PenSquare, Brain, PenLine, ScanSearch, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MarkdownRenderer } from "./markdown-renderer";
import { ImageLightbox } from "./image-lightbox";
import { QuickCommands } from "./quick-commands";
import {
  CanvasEditor,
  type CanvasAiEditRequest,
  type CanvasAiEditSnapshot,
} from "./canvas-editor";
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
  PRESET_SKILLS, PresetSkill, alignSimpleChatMediaSlots, buildSimpleChatMessageSourceTrace,
  buildSimpleChatManagedAttachmentSelection,
  canSendSimpleChatMessageToNodeMode, canTransferSimpleChatMedia,
  readSimpleChatStreamAssetReference,
  sendSimpleChatExportToCanvas, sendSimpleChatMediaToCanvas,
  type WorkspaceAssetReference
} from "./simple-chat-types";
import { User } from "@/lib/user-types";
import { enqueueCanvasBridgeReferences } from '@/lib/simple-chat-canvas-bridge';
import type { ReasoningEffort, ResponseSpeed, ResolvedChatControls } from "@/lib/chat-generation-controls";
import { useTheme } from "@/app/simple-chat/providers";
import { AgentProgressTimeline } from "@/components/agent-runtime/AgentProgressTimeline";
import { useAgentRunEvents } from "@/components/agent-runtime/use-agent-run-events";
import { isWorkspaceResultScopeCurrent } from "@/lib/asset-core/workspace-transfer";
import { completedChatImageMessageContent } from "@/lib/chat-pending-generation";
import {
  buildWorkflowChatReturnTransfer,
  createWorkflowChatReturnMessage,
  hasAmbiguousWorkflowChatReturnParameters,
  parseWorkflowChatReturnIntent,
} from "@/lib/asset-core/workflow-chat-return";
import {
  SimpleChatSseProtocolError,
  consumeSimpleChatJsonStream,
} from '@/lib/simple-chat-sse';
import {
  applySimpleChatModelSelection,
  buildSimpleChatHistoryRequestContext,
  filterSimpleChatImageInputs,
  readSimpleChatModelSelection,
  resolveSimpleChatModelSelection,
  type SimpleChatModelSelection,
} from '@/lib/simple-chat-request-context';
import {
  resolveSimpleChatModelMenuLayout,
  type SimpleChatModelMenuLayout,
} from '@/lib/simple-chat-model-menu-position';
import {
  createSimpleChatRetryContext,
  readSimpleChatRetryContext,
  recoverInterruptedSimpleChatMessages,
  type SimpleChatRetryContextV1,
} from '@/lib/simple-chat-retry';
import { buildSimpleChatWorkspaceHandoffUrl } from '@/lib/simple-chat-workspace-handoff';
import { buildSimpleChatCanvasTransferIdentity } from '@/lib/simple-chat-workspace-handoff-client';
import { MultiPlatformExportCard } from './multi-platform-export-card';
import { resolveSimpleChatExportRequestContext } from '@/lib/multi-platform-export/simple-chat-intent';
import { BriefToVideoCard } from './brief-to-video-card';
import { SIMPLE_CHAT_SKILL_REQUEST_INPUT_KEY } from '@/lib/skill-runtime/simple-chat-presets';
import {
  isSimpleChatBriefVideoClarification,
  resolveSimpleChatBriefVideoRequestContext,
} from '@/lib/brief-to-video/simple-chat-intent';

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

type SimpleChatStreamPayload = {
  type?: string;
  content?: string;
  notices?: unknown;
  appliedReasoningEffort?: unknown;
  appliedResponseSpeed?: unknown;
  degraded?: unknown;
  status?: string;
  resultCount?: number;
  searchResults?: string;
  label?: string;
  runId?: string;
  imageUrl?: string;
  imageRef?: unknown;
  prompt?: string;
  error?: string;
  projectId?: string;
};

function readSimpleChatStreamPayload(value: unknown): SimpleChatStreamPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as SimpleChatStreamPayload;
}

type SimpleChatSkill = (typeof PRESET_SKILLS)[number];

export const SIMPLE_CHAT_SKILL_RUN_PENDING_SUFFIX = ' · 后台任务进行中…';
const SIMPLE_CHAT_SKILL_RUN_UNFINISHED_SUFFIX = ' · 后台任务未完成，详情见下方进度';
const SIMPLE_CHAT_SKILL_RUN_EMPTY_RESULT = '技能任务已完成，但没有返回文本内容。';

export function readSkillRunOutputText(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const outputs = (result as { outputs?: unknown }).outputs;
  if (!Array.isArray(outputs)) return '';
  return outputs
    .filter((output): output is { kind: 'text'; content: string } => (
      Boolean(output) && typeof output === 'object'
      && (output as { kind?: unknown }).kind === 'text'
      && typeof (output as { content?: unknown }).content === 'string'
    ))
    .map(output => output.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

function isPendingSkillRunMessage(message: SimpleChatMessage): boolean {
  return message.role === 'assistant'
    && Boolean(message.agentRunId)
    && message.content.endsWith(SIMPLE_CHAT_SKILL_RUN_PENDING_SUFFIX);
}

function AgentRunMessageProgress({ runId, onSettled }: {
  runId: string;
  onSettled?: (outcome: { completed: boolean; text: string }) => void;
}) {
  const run = useAgentRunEvents(runId);
  const status = run.projection?.status;
  const result = run.projection?.result;
  useEffect(() => {
    if (!onSettled || !status) return;
    if (status === 'completed') onSettled({ completed: true, text: readSkillRunOutputText(result) });
    else if (status === 'failed' || status === 'cancelled' || status === 'timeout') {
      onSettled({ completed: false, text: '' });
    }
  }, [onSettled, result, status]);
  return (
    <AgentProgressTimeline
      projection={run.projection}
      stale={run.stale}
      onCancel={() => run.cancel()}
    />
  );
}

function readWorkspaceAssetReference(value: unknown): WorkspaceAssetReference | null {
  return readSimpleChatStreamAssetReference(value);
}
export type KnowledgeItemsMutation = (items: ProjectKnowledgeItem[]) => ProjectKnowledgeItem[] | null;
export type KnowledgeMutationResult = 'updated' | 'conflict' | 'scope';
interface ChatAreaProps {
  user: User;
  project: SimpleChatProject | null;
  task: SimpleChatTask | null;
  onUpdateTask: (task: SimpleChatTask) => void;
  onPersistTask: (task: SimpleChatTask) => Promise<void>;
  onUpdateProject: (project: SimpleChatProject) => void;
  onUpdateKnowledge?: (actorId: string, projectId: string, createdAt: number, mutation: KnowledgeItemsMutation) => KnowledgeMutationResult;
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

interface SimpleChatWorkspaceActionsProps {
  message: SimpleChatMessage;
  project: SimpleChatProject | null;
  task: SimpleChatTask | null;
  selectedCanvasProjectId: string;
  canvasTransferPending: boolean;
  onSendToCanvas: (message: SimpleChatMessage) => void;
  onNotice: (notice: string) => void;
  navigate?: (url: string) => void;
}

export function simpleChatMessagesMatch(
  left: readonly SimpleChatMessage[] | null | undefined,
  right: readonly SimpleChatMessage[] | null | undefined,
): boolean {
  if (left === undefined || left === null || right === undefined || right === null) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  if (left === right) return true;
  if (left.length !== right.length) return false;
  let allEntriesShared = true;
  for (let index = left.length - 1; index >= 0; index--) {
    const previous = left[index];
    const current = right[index];
    if (previous === current) continue;
    allEntriesShared = false;
    // Required JSON string fields prove a difference without reading attachments.
    if (previous && current && typeof previous.id === 'string' && typeof current.id === 'string'
      && typeof previous.role === 'string' && typeof current.role === 'string'
      && typeof previous.content === 'string' && typeof current.content === 'string'
      && (previous.id !== current.id || previous.role !== current.role || previous.content !== current.content)) return false;
  }
  // Deep copies and every unexamined/nested field retain the original full comparison.
  return allEntriesShared || JSON.stringify(left) === JSON.stringify(right);
}

export function hasSimpleChatAssistantOperationPayload(message: SimpleChatMessage): boolean {
  return Boolean(message.content || message.images?.length);
}

export function shouldRenderSimpleChatWorkspaceActions(
  message: SimpleChatMessage,
  isStreaming: boolean,
): boolean {
  return message.role === 'assistant' && !isStreaming && message.status !== 'failed';
}

export function SimpleChatWorkspaceActions({
  message,
  project,
  task,
  selectedCanvasProjectId,
  canvasTransferPending,
  onSendToCanvas,
  onNotice,
  navigate = url => window.location.assign(url),
}: SimpleChatWorkspaceActionsProps) {
  const canSendToNodeMode = canSendSimpleChatMessageToNodeMode(message);
  const canSendToCanvas = canTransferSimpleChatMedia(message.images || [], message.imageRefs || []);
  const sendToNodeMode = () => {
    if (!selectedCanvasProjectId || !project || !task) {
      onNotice('请先选择目标画布项目');
      return;
    }
    if (!canSendToNodeMode) {
      onNotice('仅非空文本或已登记图片可发送到节点模式');
      return;
    }
    navigate(buildSimpleChatWorkspaceHandoffUrl({
      targetProjectId: selectedCanvasProjectId,
      chatProjectId: project.id,
      chatTaskId: task.id,
      chatMessageId: message.id,
    }));
  };

  return (
    <div data-testid="simple-chat-workspace-actions" className={canSendToCanvas || !message.images?.length
      ? 'inline-flex gap-0.5'
      : 'inline-flex max-w-full shrink-0 flex-wrap gap-0.5'}>
      {Boolean(message.images?.length) && !canSendToCanvas && (
        <span className="min-w-0 basis-full whitespace-normal text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          历史图片或登记失败的图片不可转移
        </span>
      )}
      {Boolean(message.images?.length) && (
        <button
          onClick={() => onSendToCanvas(message)}
          disabled={canvasTransferPending || !canSendToCanvas}
          className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-blue-500/10 text-blue-500 transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={canSendToCanvas ? '添加到画布' : '历史图片或登记失败的图片不可转移'}
        >
          <Send className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={sendToNodeMode}
        disabled={!canSendToNodeMode}
        className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-amber-500/10 text-amber-500 transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent"
        title={!selectedCanvasProjectId || !project || !task
          ? '请先选择目标画布项目'
          : canSendToNodeMode
            ? '发送到节点模式'
            : '仅非空文本或已登记图片可发送到节点模式'}
        aria-label="发送到节点模式"
      >
        <GitBranch className="w-3 h-3" />
      </button>
    </div>
  );
}

interface SimpleChatWorkspaceActionEntryProps extends SimpleChatWorkspaceActionsProps {
  isStreaming: boolean;
}

export function SimpleChatWorkspaceActionEntry({
  isStreaming,
  ...props
}: SimpleChatWorkspaceActionEntryProps) {
  if (!shouldRenderSimpleChatWorkspaceActions(props.message, isStreaming)) return null;
  if (!hasSimpleChatAssistantOperationPayload(props.message)) {
    return (
      <div
        data-testid="simple-chat-empty-workspace-actions"
        className="flex items-center gap-1.5 mt-1 px-1 flex-wrap"
      >
        <SimpleChatWorkspaceActions {...props} />
        <span className="text-[11px] text-muted-foreground">没有可发送内容</span>
      </div>
    );
  }
  return <SimpleChatWorkspaceActions {...props} />;
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

const WEB_SEARCH_UNAVAILABLE = '联网搜索未返回结果，可能无结果或搜索失败，请核实信息来源。';

// 联网搜索结果卡片
function SearchResultsCard({ content }: { content: string }) {
  const parsed = useMemo(() => {
    const items: Array<{ idx: number; title: string; url: string; snippet: string; summary?: string }> = [];
    const keywordMatch = content.match(/搜索关键词[：:]\s*"?(.+?)"?\n/);
    const keyword = keywordMatch?.[1] || '';

    const regex = /\[(\d+)\][^\S\r\n]+([^\n]+)\nURL:[^\S\r\n]*([^\n]*)\n摘要:[^\S\r\n]*([\s\S]*?)(?:\nAI摘要:[^\S\r\n]*([\s\S]*?))?(?=\n\n\[\d+\][^\S\r\n]+[^\n]+\nURL:|\n\n## AI 搜索摘要(?:\n|$)|$)/g;
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
        <div className="flex min-w-0 items-center gap-2 mb-3">
          <div className="w-6 h-6 shrink-0 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Globe className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <span className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-blue-600 dark:text-blue-400">
            联网搜索{parsed.keyword ? ` · "${parsed.keyword}"` : ''} · {parsed.items.length} 条结果
          </span>
        </div>
        {parsed.items.length > 0 && (
          <div className="space-y-2">
            {parsed.items.map((item) => (
              <a
                key={item.idx}
                href={item.url && item.url !== '无' ? item.url : undefined}
                target={item.url && item.url !== '无' ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="block p-3 rounded-xl bg-background/50 hover:bg-background/80 border border-border/50 hover:border-border transition-all"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0 w-5">[{item.idx}]</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{item.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 [overflow-wrap:anywhere]">{item.snippet}</div>
                    {item.summary && (
                      <div className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-1 [overflow-wrap:anywhere] italic">AI: {item.summary}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground/50 mt-1 [overflow-wrap:anywhere]">{item.url}</div>
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
  user, project, task, onUpdateTask, onPersistTask, onUpdateProject, onUpdateKnowledge, onCreateTask, onSelectTask,
  onUpdateAgent, onDeleteAgent, onSkillToAgent,
  onLogout, onBackToWorkspace, sidebarOpen, onToggleSidebar
}: ChatAreaProps) {
  const { theme, toggleTheme } = useTheme();

  // Local state
  const [input, setInput] = useState("");
  const inputEditEpochRef = useRef(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<ChatAttachment[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [showSkillPanel, setShowSkillPanel] = useState(false);
  const [showInstructionsPanel, setShowInstructionsPanel] = useState(false);
  const [showKnowledgePanel, setShowKnowledgePanel] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ taskId: string; taskName: string; messageIndex: number; snippet: string }>>([]);
  const [branchBaseMessageId, setBranchBaseMessageId] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [workflowReturnConflict, setWorkflowReturnConflict] = useState(false);
  // Brand DNA injection
  const [brandActive, setBrandActive] = useState(false);

  // Image model
  const [imageModels, setImageModels] = useState<Array<ChatModelInfo>>([]);
  const [tempChat, setTempChat] = useState(false);
  const messageScope = JSON.stringify([user.id, project?.id ?? null, task?.id ?? null]);
  const draftScope = JSON.stringify([user.id, project?.id ?? null, task?.id ?? null, tempChat]);
  const requestScopeEpochRef = useRef({ scope: draftScope, epoch: 0 });
  const ordinaryRequestEpochRef = useRef<number | null>(null);
  const activeSendRef = useRef<{ epoch: number } | null>(null);
  if (requestScopeEpochRef.current.scope !== draftScope) {
    requestScopeEpochRef.current = { scope: draftScope, epoch: requestScopeEpochRef.current.epoch + 1 };
  }
  useEffect(() => () => { requestScopeEpochRef.current.epoch += 1; }, []);
  const [temporaryImageSelection, setTemporaryImageSelection] = useState<(SimpleChatModelSelection & { taskId: string }) | null>(null);
  // Only a new, unconfigured task may adopt the catalog default.
  const defaultImageModel = !task?.imageModel && !task?.imageProviderId ? imageModels[0] : undefined;
  const temporaryImageModel = tempChat && temporaryImageSelection?.taskId === task?.id ? temporaryImageSelection : null;
  const selectedImageModel = temporaryImageModel?.modelId || task?.imageModel || defaultImageModel?.modelId || '';
  const selectedImageProviderId = temporaryImageModel?.providerId || task?.imageProviderId || defaultImageModel?.providerId || '';
  const [canvasProjects, setCanvasProjects] = useState<CanvasProjectOption[]>([]);
  const [selectedCanvasProjectId, setSelectedCanvasProjectId] = useState('');
  const [canvasTransferMessageId, setCanvasTransferMessageId] = useState<string | null>(null);
  const canvasTransferScope = useMemo(() => ({ actorId: user.id, projectId: project?.id,
    taskId: task?.id, targetProjectId: selectedCanvasProjectId }),
  [user.id, project?.id, task?.id, selectedCanvasProjectId]);
  const canvasTransferScopeRef = useRef(canvasTransferScope);
  canvasTransferScopeRef.current = canvasTransferScope;
  const canvasTransferMountedRef = useRef(false);
  const canvasTransferToastRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    canvasTransferMountedRef.current = true;
    return () => { canvasTransferMountedRef.current = false; };
  }, []);
  useEffect(() => {
    setCanvasTransferMessageId(null);
    return () => { canvasTransferToastRef.current?.remove(); canvasTransferToastRef.current = null; };
  }, [canvasTransferScope]);

  // Instructions draft
  const [instructionsDraft, setInstructionsDraft] = useState<ProjectInstructions>(
    project?.instructions || { projectBackground: '', userPreference: '', outputFormat: '', styleRules: '', forbiddenRules: '', language: 'zh-CN' }
  );

  // Knowledge: a mounted editor may receive a different actor or project instance.
  const knowledgeDraftScope = JSON.stringify([user.id, project?.id ?? null, project?.createdAt ?? null]);
  const knowledgeViewScopeRef = useRef({ scope: knowledgeDraftScope });
  if (knowledgeViewScopeRef.current.scope !== knowledgeDraftScope) {
    knowledgeViewScopeRef.current = { scope: knowledgeDraftScope };
  }
  const knowledgeViewScope = knowledgeViewScopeRef.current;
  const knowledgeViewMountedRef = useRef(true);
  // The parent project is authoritative; all edits are applied to its latest snapshot.
  const knowledgeItems = project?.knowledgeItems || [];
  const [knowledgeErrorState, setKnowledgeErrorState] = useState<{ scope: typeof knowledgeViewScope; message: string } | null>(null);
  const knowledgeError = knowledgeErrorState?.scope === knowledgeViewScope ? knowledgeErrorState.message : null;
  const updateKnowledge = (mutation: KnowledgeItemsMutation): boolean => {
    if (!knowledgeViewMountedRef.current || knowledgeViewScopeRef.current !== knowledgeViewScope || !project) return false;
    const result = onUpdateKnowledge?.(user.id, project.id, project.createdAt, mutation) ?? 'scope';
    setKnowledgeErrorState(result === 'updated' ? null : {
      scope: knowledgeViewScope,
      message: result === 'conflict' ? '知识条目已发生变化，请检查当前内容后重试。' : '知识库当前不可更新，请返回项目后重试。',
    });
    return result === 'updated';
  };
  const [knowledgePreviewState, setKnowledgePreviewState] = useState<{ scope: typeof knowledgeViewScope; item: ProjectKnowledgeItem } | null>(null);
  const knowledgePreview = knowledgePreviewState?.scope === knowledgeViewScope ? knowledgeItems.find(item => item.id === knowledgePreviewState.item.id) ?? null : null;
  const setKnowledgePreview = (item: ProjectKnowledgeItem | null) => {
    if (knowledgeViewMountedRef.current && knowledgeViewScopeRef.current === knowledgeViewScope) setKnowledgePreviewState(item ? { scope: knowledgeViewScope, item } : null);
  };
  const [addingKnowledge, setAddingKnowledge] = useState<'file' | 'url' | 'note' | null>(null);
  // Keep unsaved link/note drafts with the actor and project that created them.
  // Like the original component state, drafts stay in memory only.
  // Invalidate pending file reads on every actor/project transition, including A → B → A.
  const knowledgeFileScopeRef = useRef({ scope: knowledgeDraftScope });
  if (knowledgeFileScopeRef.current.scope !== knowledgeDraftScope) {
    knowledgeFileScopeRef.current = { scope: knowledgeDraftScope };
  }
  useEffect(() => {
    knowledgeViewMountedRef.current = true;
    return () => {
      knowledgeViewMountedRef.current = false;
      knowledgeFileScopeRef.current = { scope: knowledgeFileScopeRef.current.scope };
    };
  }, []);
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Record<string, { url: string; note: string; noteName: string }>>({});
  const { url: knowledgeUrl = '', note: knowledgeNote = '', noteName: knowledgeNoteName = '' } = knowledgeDrafts[knowledgeDraftScope] ?? {};
  const updateKnowledgeDraft = (patch: Partial<{ url: string; note: string; noteName: string }>) => {
    setKnowledgeDrafts(previous => ({
      ...previous,
      [knowledgeDraftScope]: { ...(previous[knowledgeDraftScope] ?? { url: '', note: '', noteName: '' }), ...patch },
    }));
  };

  // Models
  const [chatModels, setChatModels] = useState<ChatModelInfo[]>([]);
  const [chatCatalogState, setChatCatalogState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [imageCatalogState, setImageCatalogState] = useState<'loading' | 'ready' | 'error'>('loading');
  const chatCatalogInFlight = useRef(false);
  const imageCatalogInFlight = useRef(false);
  const catalogMountedRef = useRef(true);
  useEffect(() => {
    catalogMountedRef.current = true;
    return () => { catalogMountedRef.current = false; };
  }, []);
  const chatModelSelection = readSimpleChatModelSelection(task);
  const selectedModel = chatModelSelection.modelId;
  const selectedProviderId = chatModelSelection.providerId;
  const [skillRunPending, setSkillRunPending] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SimpleChatSkill | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(task?.reasoningEffort || 'medium');
  const [responseSpeed, setResponseSpeed] = useState<ResponseSpeed>(task?.responseSpeed || 'balanced');
  const [appliedChatControls, setAppliedChatControls] = useState<SimpleChatTask['appliedChatControls']>(task?.appliedChatControls);
  const [controlNotice, setControlNotice] = useState<string | null>(null);
  const [historyImageNotice, setHistoryImageNotice] = useState<string | null>(null);
  const [openModelMenu, setOpenModelMenu] = useState<'chat' | 'image' | null>(null);
  const [modelMenuLayout, setModelMenuLayout] = useState<SimpleChatModelMenuLayout | null>(null);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [chatViewport, setChatViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1024 : (window.visualViewport?.width ?? window.innerWidth),
    height: typeof window === 'undefined' ? 768 : (window.visualViewport?.height ?? window.innerHeight),
    left: 0,
    top: 0,
    naturalTop: 0,
    headerBottom: 0,
    agentBottom: 0,
  }));
  const compactHeader = chatViewport.width < 768 || chatViewport.height <= 430;
  const shortChatViewport = chatViewport.height <= 430;

  const handleChatModelSelect = useCallback((selection: SimpleChatModelSelection) => {
    if (!task) return;
    onUpdateTask(applySimpleChatModelSelection(task, selection));
    setOpenModelMenu(null);
  }, [onUpdateTask, task]);

  const handleImageModelSelect = useCallback((selection: SimpleChatModelSelection) => {
    if (!task) return;
    if (tempChat) {
      setTemporaryImageSelection({ ...selection, taskId: task.id });
    } else {
      onUpdateTask({ ...task, imageModel: selection.modelId, imageProviderId: selection.providerId });
    }
    setOpenModelMenu(null);
  }, [onUpdateTask, task, tempChat]);

  useEffect(() => { setTemporaryImageSelection(null); }, [task?.id, tempChat]);

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
  const memoryMutationInFlight = useRef(false);
  // 全局对话搜索
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showQuickCommands, setShowQuickCommands] = useState(false);
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
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const followMessagesRef = useRef(true);
  const userScrollVersionRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatModelMenuRef = useRef<HTMLDivElement>(null);
  const imageModelMenuRef = useRef<HTMLDivElement>(null);
  const chatModelButtonRef = useRef<HTMLButtonElement>(null);
  const imageModelButtonRef = useRef<HTMLButtonElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const chatHeaderRef = useRef<HTMLElement>(null);
  const chatAgentBarRef = useRef<HTMLDivElement>(null);
  const chatSettingsRef = useRef<HTMLDivElement>(null);
  const chatSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // Geometry only: keep the live conversation above the keyboard without
  // resizing its Page parent or remounting any of its business controls.
  const updateChatViewport = useCallback(() => {
    const viewport = window.visualViewport;
    const root = chatAreaRef.current;
    const naturalTop = root
      ? root.getBoundingClientRect().top - (parseFloat(root.style.marginTop) || 0)
      : 0;
    const next = {
      width: viewport?.width ?? window.innerWidth,
      height: viewport?.height ?? window.innerHeight,
      left: viewport?.offsetLeft ?? 0,
      top: viewport?.offsetTop ?? 0,
      naturalTop,
      headerBottom: chatHeaderRef.current?.getBoundingClientRect().bottom ?? naturalTop,
      agentBottom: chatAgentBarRef.current?.getBoundingClientRect().bottom ?? naturalTop,
    };
    setChatViewport(previous => (
      previous.width === next.width && previous.height === next.height
      && previous.left === next.left && previous.top === next.top
      && previous.naturalTop === next.naturalTop && previous.headerBottom === next.headerBottom
      && previous.agentBottom === next.agentBottom
    ) ? previous : next);
  }, []);

  useLayoutEffect(() => {
    updateChatViewport();
  }, [updateChatViewport, compactHeader, chatViewport.width, chatViewport.height,
    chatViewport.left, chatViewport.top, project?.id, task?.id, task?.activeAgentId, controlNotice]);

  useLayoutEffect(() => {
    // When a keyboard leaves less room, scroll the existing composer rather
    // than removing its attachment, textarea, tools or footer controls.
    if (compactHeader && chatViewport.height < window.innerHeight && composerRef.current) {
      composerRef.current.scrollTop = composerRef.current.scrollHeight;
    }
  }, [compactHeader, chatViewport.width, chatViewport.height, chatViewport.top, chatViewport.headerBottom, chatViewport.agentBottom]);

  useEffect(() => {
    const viewport = window.visualViewport;
    window.addEventListener('resize', updateChatViewport);
    window.addEventListener('scroll', updateChatViewport, true);
    viewport?.addEventListener('resize', updateChatViewport);
    viewport?.addEventListener('scroll', updateChatViewport);
    return () => {
      window.removeEventListener('resize', updateChatViewport);
      window.removeEventListener('scroll', updateChatViewport, true);
      viewport?.removeEventListener('resize', updateChatViewport);
      viewport?.removeEventListener('scroll', updateChatViewport);
    };
  }, [updateChatViewport]);

  useEffect(() => {
    if (!compactHeader || !showChatSettings) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!chatSettingsRef.current?.contains(target) && !chatSettingsButtonRef.current?.contains(target)) {
        setShowChatSettings(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [compactHeader, showChatSettings]);

  useEffect(() => {
    if (!openModelMenu && !showChatSettings) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openModelMenu) {
        setOpenModelMenu(null);
      } else {
        setShowChatSettings(false);
        chatSettingsButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [openModelMenu, showChatSettings]);

  // Messages: sync from task
  const [messages, setMessages] = useState<SimpleChatMessage[]>(
    recoverInterruptedSimpleChatMessages((task?.messages || []).filter(Boolean)),
  );
  const artifacts = useMemo(() => messages.flatMap(message => message.artifacts || []), [messages]);
  const [messagesScope, setMessagesScope] = useState<string | null>(messageScope);
  const [draftReadyScope, setDraftReadyScope] = useState(draftScope);
  const draftInputRef = useRef(input);
  const draftImagesRef = useRef(uploadedImages);
  const draftScopeRef = useRef(draftScope);
  const draftByScopeRef = useRef(new Map<string, string>());
  const draftImagesByScopeRef = useRef(new Map<string, ChatAttachment[]>());
  const pendingImageReadsByScopeRef = useRef(new Map<string, ChatAttachment[]>());
  const activeDraftScopeRef = useRef(draftScope);
  draftInputRef.current = input;
  draftImagesRef.current = uploadedImages;
  activeDraftScopeRef.current = draftScope;
  const messagesRef = useRef(messages);
  const messageScopeRef = useRef(messageScope);
  const projectIdRef = useRef(project?.id);
  const taskIdRef = useRef(task?.id);
  const latestTaskRef = useRef(task);
  const workflowReturnHandledRef = useRef<string | null>(null);
  const workflowReturnPersistenceGuardRef = useRef<{ scope: string; messageId: string } | null>(null);
  messageScopeRef.current = messageScope;
  projectIdRef.current = project?.id;
  taskIdRef.current = task?.id;
  latestTaskRef.current = task;
  messagesRef.current = messages;

  useEffect(() => {
    if (project?.id) localStorage.setItem('wujie_last_simple_chat_project', project.id);
  }, [project?.id]);

  useEffect(() => {
    const ambiguous = hasAmbiguousWorkflowChatReturnParameters(window.location.search);
    setWorkflowReturnConflict(ambiguous);
    if (ambiguous || !project?.id || !task?.id) return;
    const intent = parseWorkflowChatReturnIntent(window.location.search);
    if (!intent) return;
    const initialParams = new URLSearchParams(window.location.search);
    if ((initialParams.has('projectId') && initialParams.get('projectId') !== project.id)
      || (initialParams.has('taskId') && initialParams.get('taskId') !== task.id)) return;
    const intentPath = window.location.pathname;
    const intentKey = `${project.id}:${intent.executionId}:${intent.outputNodeId}:${intent.sourceVersionId}`;
    if (workflowReturnHandledRef.current === intentKey) return;
    workflowReturnHandledRef.current = intentKey;
    let cancelled = false;
    let guardedMessageId: string | null = null;
    void (async () => {
      try {
        const response = await fetch('/api/assets/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': user.id },
          body: JSON.stringify(buildWorkflowChatReturnTransfer(intent, project.id)),
        });
        if (!response.ok) throw new Error(`Asset transfer failed (${response.status})`);
        const reference = readWorkspaceAssetReference(await response.json());
        if (!reference?.assetVersionId || !reference.placementId || !reference.entityId) {
          throw new Error('Asset transfer returned an incomplete reference');
        }
        if (cancelled || messageScopeRef.current !== messageScope || projectIdRef.current !== project.id || taskIdRef.current !== task.id) return;
        const returned = createWorkflowChatReturnMessage(intent, reference);
        const latestTask = latestTaskRef.current;
        if (!latestTask || latestTask.id !== task.id) return;
        const persistedMessages = (latestTask.messages || []).some(message => message.id === returned.id)
          ? latestTask.messages
          : [...(latestTask.messages || []), returned];
        guardedMessageId = returned.id;
        workflowReturnPersistenceGuardRef.current = {
          scope: messageScope,
          messageId: returned.id,
        };
        await onPersistTask({ ...latestTask, messages: persistedMessages, updatedAt: Date.now() });
        if (cancelled || messageScopeRef.current !== messageScope || projectIdRef.current !== project.id || taskIdRef.current !== task.id) return;
        const currentMessages = messagesRef.current;
        const mergedMessages = currentMessages.some(message => message.id === returned.id)
          ? [...currentMessages]
          : [...currentMessages, returned];
        if (workflowReturnPersistenceGuardRef.current?.scope === messageScope
          && workflowReturnPersistenceGuardRef.current.messageId === returned.id) {
          workflowReturnPersistenceGuardRef.current = null;
        }
        setMessages(mergedMessages);
        const current = new URL(window.location.href);
        const currentIntent = parseWorkflowChatReturnIntent(current.search);
        if (current.pathname !== intentPath || !currentIntent
          || JSON.stringify(currentIntent) !== JSON.stringify(intent)
          || (current.searchParams.has('projectId') && current.searchParams.get('projectId') !== project.id)
          || (current.searchParams.has('taskId') && current.searchParams.get('taskId') !== task.id)) return;
        for (const key of [
          'assetProjectId', 'workflowVersionId', 'sourceVersionId', 'workflowId', 'workflowExecutionId',
          'workflowOutputNodeId', 'workflowOutputLabel',
        ]) current.searchParams.delete(key);
        window.history.replaceState(null, '', `${current.pathname}${current.search}${current.hash}`);
      } catch {
        if (!cancelled) setSearchStatus('工作流结果返回失败，请重试');
      }
    })();
    return () => {
      cancelled = true;
      if (workflowReturnPersistenceGuardRef.current?.scope === messageScope
        && workflowReturnPersistenceGuardRef.current.messageId === guardedMessageId) {
        workflowReturnPersistenceGuardRef.current = null;
      }
    };
  }, [onPersistTask, project?.id, task?.id, user.id]);

  // Keep unsent text and images attached to their account, task and chat mode.
  useEffect(() => {
    if (draftScopeRef.current !== draftScope) {
      if (ordinaryRequestEpochRef.current !== null && ordinaryRequestEpochRef.current !== requestScopeEpochRef.current.epoch) {
        ordinaryRequestEpochRef.current = null;
        setIsStreaming(false);
      }
      draftByScopeRef.current.set(draftScopeRef.current, draftInputRef.current);
      draftImagesByScopeRef.current.set(draftScopeRef.current, draftImagesRef.current);
      draftScopeRef.current = draftScope;
      setInput(draftByScopeRef.current.get(draftScope) ?? '');
      const pendingImages = pendingImageReadsByScopeRef.current.get(draftScope) ?? [];
      pendingImageReadsByScopeRef.current.delete(draftScope);
      setUploadedImages([...(draftImagesByScopeRef.current.get(draftScope) ?? []), ...pendingImages]);
      setDraftReadyScope(draftScope);
    }
  }, [draftScope]);

  // Sync when task changes
  useEffect(() => {
    if (task) {
      setIsStreaming(false);
      followMessagesRef.current = true;
      userScrollVersionRef.current += 1;
      setMessages(recoverInterruptedSimpleChatMessages((task.messages || []).filter(Boolean)));
      setMessagesScope(messageScope);
      setReasoningEffort(task.reasoningEffort || 'medium');
      setResponseSpeed(task.responseSpeed || 'balanced');
      setAppliedChatControls(task.appliedChatControls);
      setControlNotice(task.appliedChatControls?.notices[0] || null);
      setHistoryImages([]);
      setHistoryImageNotice(null);
    } else setMessagesScope(null);
  }, [messageScope]);

  // Sync when project changes
  useEffect(() => {
    if (project) {
      setInstructionsDraft(project.instructions || { projectBackground: '', userPreference: '', outputFormat: '', styleRules: '', forbiddenRules: '', language: 'zh-CN' });
    }
  }, [project?.id]);

  // Keep catalogue read failures distinct from a genuinely empty catalogue.
  const fetchChatModels = useCallback(async (): Promise<void> => {
    if (chatCatalogInFlight.current) return;
    chatCatalogInFlight.current = true;
    setChatCatalogState('loading');
    try {
      const response = await fetch('/api/models?type=chat');
      if (!response.ok) throw new Error('聊天模型目录加载失败');
      const data = await response.json();
      if (!data || data.success === false || !Array.isArray(data.models)
        || (data.providers !== undefined && !Array.isArray(data.providers))) {
        throw new Error('聊天模型目录响应无效');
      }
      if (!catalogMountedRef.current) return;
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
      }
      setChatCatalogState('ready');
    } catch {
      if (catalogMountedRef.current) setChatCatalogState('error');
    } finally {
      chatCatalogInFlight.current = false;
    }
  }, []);

  useEffect(() => { void fetchChatModels(); }, [fetchChatModels]);

  useEffect(() => {
    if (!task || chatModels.length === 0) return;
    const currentSelection = readSimpleChatModelSelection(task);
    const resolvedSelection = resolveSimpleChatModelSelection(task, chatModels);
    if (
      currentSelection.modelId === resolvedSelection.modelId
      && currentSelection.providerId === resolvedSelection.providerId
    ) return;
    onUpdateTask(applySimpleChatModelSelection(task, resolvedSelection));
  }, [chatModels, onUpdateTask, task]);

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

  const updateModelMenuLayout = useCallback((menu: 'chat' | 'image') => {
    const trigger = menu === 'chat' ? chatModelButtonRef.current : imageModelButtonRef.current;
    if (!trigger) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const rect = trigger.getBoundingClientRect();
    const layout = resolveSimpleChatModelMenuLayout({
      left: rect.left - left, right: rect.right - left,
      top: rect.top - top, bottom: rect.bottom - top,
      width: rect.width, height: rect.height,
    }, { width, height });
    const maxHeight = Math.min(layout.maxHeight, Math.max(0, height - 24));
    setModelMenuLayout({
      ...layout,
      left: rect.left + layout.left,
      top: Math.max(top + 12, Math.min(rect.top + layout.top, top + height - maxHeight - 12)),
      maxHeight,
    });
  }, []);

  const toggleModelMenu = useCallback((menu: 'chat' | 'image') => {
    if (openModelMenu === menu) {
      setOpenModelMenu(null);
      return;
    }
    updateModelMenuLayout(menu);
    setOpenModelMenu(menu);
  }, [openModelMenu, updateModelMenuLayout]);

  useEffect(() => {
    if (!openModelMenu) return;
    const update = () => updateModelMenuLayout(openModelMenu);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [openModelMenu, updateModelMenuLayout, chatViewport.width, chatViewport.height,
    chatViewport.left, chatViewport.top, chatViewport.headerBottom]);

  // Fetch image models without confusing transport failure with an empty list.
  const fetchImageModels = useCallback(async (): Promise<void> => {
    if (imageCatalogInFlight.current) return;
    imageCatalogInFlight.current = true;
    setImageCatalogState('loading');
    try {
      const response = await fetch('/api/models?type=image');
      if (!response.ok) throw new Error('图像模型目录加载失败');
      const data = await response.json();
      if (!data || data.success === false || !Array.isArray(data.models)
        || (data.providers !== undefined && !Array.isArray(data.providers))) {
        throw new Error('图像模型目录响应无效');
      }
      if (!catalogMountedRef.current) return;
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
      setImageCatalogState('ready');
    } catch {
      if (catalogMountedRef.current) setImageCatalogState('error');
    } finally {
      imageCatalogInFlight.current = false;
    }
  }, []);

  useEffect(() => { void fetchImageModels(); }, [fetchImageModels]);
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    let frame = 0;
    let touchTimer: ReturnType<typeof setTimeout> | undefined;
    let settlingTouch = false;
    let touch: { id: number; x: number; y: number; moved: boolean; wasSettling: boolean } | null = null;
    let pointer: { id: number; x: number; y: number; moved: boolean } | null = null;
    const userStartsScroll = () => {
      cancelAnimationFrame(frame);
      userScrollVersionRef.current += 1;
      followMessagesRef.current = false;
    };
    const updateFollowAfterScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          followMessagesRef.current = container.scrollHeight - container.clientHeight - container.scrollTop <= 4;
        });
      });
    };
    const finishTouchScroll = () => {
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => {
        settlingTouch = false;
        followMessagesRef.current = container.scrollHeight - container.clientHeight - container.scrollTop <= 4;
      }, 250);
    };
    const onTouchStart = (event: TouchEvent) => {
      const first = event.changedTouches[0];
      if (!first || touch) return;
      const wasSettling = settlingTouch;
      clearTimeout(touchTimer);
      settlingTouch = false;
      touch = { id: first.identifier, x: first.clientX, y: first.clientY, moved: false, wasSettling };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touch || touch.moved) return;
      const current = Array.from(event.changedTouches).find(item => item.identifier === touch?.id);
      if (current && Math.hypot(current.clientX - touch.x, current.clientY - touch.y) > 3) {
        touch.moved = true;
        userStartsScroll();
      }
    };
    const onTouchFinish = (event: TouchEvent) => {
      if (!touch || !Array.from(event.changedTouches).some(item => item.identifier === touch?.id)) return;
      const last = Array.from(event.changedTouches).find(item => item.identifier === touch?.id);
      if (last && !touch.moved && Math.hypot(last.clientX - touch.x, last.clientY - touch.y) > 3) {
        touch.moved = true;
        userStartsScroll();
      }
      if (touch.moved || touch.wasSettling) {
        settlingTouch = true;
        finishTouchScroll();
      }
      touch = null;
    };
    const onScroll = () => { if (settlingTouch) finishTouchScroll(); };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && touch && !touch.moved
        && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 3) {
        touch.moved = true;
        userStartsScroll();
      }
      if (!pointer || pointer.id !== event.pointerId || pointer.moved) return;
      if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) {
        pointer.moved = true;
        userStartsScroll();
      }
    };
    const onPointerFinish = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (pointer.moved) updateFollowAfterScroll();
      pointer = null;
    };
    const onWheel = () => { clearTimeout(touchTimer); settlingTouch = false; userStartsScroll(); updateFollowAfterScroll(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((container.contains(event.target as Node) || event.target === document.body)
        && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        userStartsScroll(); updateFollowAfterScroll();
      }
    };
    container.addEventListener('wheel', onWheel, { passive: true });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchFinish, { passive: true });
    container.addEventListener('touchcancel', onTouchFinish, { passive: true });
    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerFinish, { passive: true });
    window.addEventListener('pointercancel', onPointerFinish, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(touchTimer);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchFinish);
      container.removeEventListener('touchcancel', onTouchFinish);
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerFinish);
      window.removeEventListener('pointercancel', onPointerFinish);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [messageScope, messagesScope, draftScope, draftReadyScope]);
  useEffect(() => {
    if (messages.length === 0 || messagesScope !== messageScope || !followMessagesRef.current) return;
    const container = messagesScrollRef.current;
    if (!container) return;
    const scrollVersion = userScrollVersionRef.current;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    messagesEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth' });
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (followMessagesRef.current && userScrollVersionRef.current === scrollVersion) {
          container.scrollTop = container.scrollHeight;
        }
      });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [messages, messagesScope, messageScope]);

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
  async function addMemory(content: string, category: MemoryItem['category']): Promise<void> {
    if (memoryMutationInFlight.current) throw new Error('记忆操作尚未完成');
    memoryMutationInFlight.current = true;
    setMemoriesLoading(true);
    try {
      const res = await fetch('/api/simple-chat/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, category }),
      });
      if (!res.ok) throw new Error('添加记忆失败');
      const payload: unknown = await res.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('记忆响应无效');
      const data = payload as Record<string, unknown>;
      if (typeof data.id !== 'string' || !data.id.trim() || typeof data.content !== 'string' || !data.content.trim()
        || (data.category !== 'style' && data.category !== 'preference' && data.category !== 'background' && data.category !== 'other')) throw new Error('记忆响应无效');
      const memory: MemoryItem = { id: data.id, content: data.content, category: data.category,
        createdAt: typeof data.createdAt === 'number' && Number.isFinite(data.createdAt) ? data.createdAt : Date.now() };
      setMemories(prev => [...prev, memory]);
    } finally {
      memoryMutationInFlight.current = false;
      setMemoriesLoading(false);
    }
  }

  async function deleteMemory(id: string): Promise<void> {
    if (memoryMutationInFlight.current) throw new Error('记忆操作尚未完成');
    memoryMutationInFlight.current = true;
    setMemoriesLoading(true);
    try {
      const response = await fetch(`/api/simple-chat/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('删除记忆失败');
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true) throw new Error('记忆响应无效');
      setMemories(prev => prev.filter(m => m.id !== id));
    } finally {
      memoryMutationInFlight.current = false;
      setMemoriesLoading(false);
    }
  }

  useLayoutEffect(() => {
    // Font scaling can resize the bars without a viewport resize event.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateChatViewport);
    for (const element of [chatAreaRef.current, chatHeaderRef.current, chatAgentBarRef.current]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [updateChatViewport, project?.id, task?.id, messagesScope, draftReadyScope]);

  // Sync task to parent（临时聊天模式下跳过保存）
  useEffect(() => {
    if (!task || !project || tempChat || messagesScope !== messageScope) return;
    const workflowReturnGuard = workflowReturnPersistenceGuardRef.current;
    if (workflowReturnGuard?.scope === messageScope) {
      return;
    }
    // Switching chat modes must not create a timestamp-only local mutation.
    // Real message/model/control changes still use the original sync path.
    if (task.model === selectedModel && task.providerId === selectedProviderId
      && (task.reasoningEffort || 'medium') === reasoningEffort && (task.responseSpeed || 'balanced') === responseSpeed
      && simpleChatMessagesMatch(task.messages, messages)
      && JSON.stringify(task.appliedChatControls) === JSON.stringify(appliedChatControls)) return;
    onUpdateTask({ ...task, messages, model: selectedModel, providerId: selectedProviderId, reasoningEffort, responseSpeed, appliedChatControls, updatedAt: Date.now() });
  }, [messages, messagesScope, messageScope, selectedModel, selectedProviderId, reasoningEffort, responseSpeed, appliedChatControls, tempChat]);

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
    const sourceScope = activeDraftScopeRef.current;
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const attachment: ChatAttachment = {
          id: Math.random().toString(36).slice(2, 10),
          type: 'image' as const,
          name: file.name || `粘贴图片-${Date.now()}.png`,
          url: dataUrl,
          mimeType: file.type || 'image/png',
        };
        if (activeDraftScopeRef.current === sourceScope && draftScopeRef.current === sourceScope) {
          setUploadedImages(prev => [...prev, attachment]);
        } else {
          const pending = pendingImageReadsByScopeRef.current.get(sourceScope) ?? [];
          pendingImageReadsByScopeRef.current.set(sourceScope, [...pending, attachment]);
        }
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
  function prepareCanvasAiEdit(snapshot: CanvasAiEditSnapshot): CanvasAiEditRequest | null {
    const requestModelSelection = readSimpleChatModelSelection(task);
    if (!task || !requestModelSelection.modelId || !requestModelSelection.providerId) {
      return null;
    }
    const requestProjectId = task.projectId || project?.id;
    if (!requestProjectId) return null;
    return {
      ...snapshot,
      idempotencyKey: `simple-chat-canvas-edit:${task.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
      modelId: requestModelSelection.modelId,
      providerId: requestModelSelection.providerId,
      projectId: requestProjectId,
      taskId: task.id,
    };
  }

  async function canvasAiEdit(request: CanvasAiEditRequest): Promise<string> {
    const requestScopeIsCurrent = () => (
      isWorkspaceResultScopeCurrent(request.projectId, projectIdRef.current)
      && request.taskId === taskIdRef.current
    );
    const isSelectionEdit = Boolean(request.selectedText);
    const target = request.selectedText || request.currentContent;
    const systemPrompt = isSelectionEdit
      ? '你是一名专业文案编辑。根据用户的修改指令修改给定的选中文本。只输出修改后的选中文本片段，不要重复原片段、不要输出全文、不要输出解释、不要添加引号或标记。'
      : '你是一名专业文案编辑。根据用户的修改指令，输出修改后的完整文本。只输出修改后的文本本身，不要输出解释、不要添加引号或标记。';
    const targetLabel = isSelectionEdit ? '待修改的选中文本' : '待修改文本';
    const res = await fetch('/api/simple-chat/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': request.idempotencyKey,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `【${targetLabel}】\n${target}\n\n【修改指令】\n${request.instruction}` },
        ],
        model: request.modelId,
        providerId: request.providerId,
        reasoningEffort, responseSpeed,
        idempotencyKey: request.idempotencyKey,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('No response body');
    let result = '';
    let streamError: string | null = null;
    await consumeSimpleChatJsonStream(res.body, {
      isActive: requestScopeIsCurrent,
      onEvent(value) {
        if (!requestScopeIsCurrent()) return;
        const parsed = readSimpleChatStreamPayload(value);
        if (!parsed) return;
        if (
          (parsed.type === 'text' || parsed.type === 'content')
          && typeof parsed.content === 'string'
        ) {
          result += parsed.content;
        } else if (parsed.type === 'error') {
          streamError = typeof parsed.error === 'string' && parsed.error.trim()
            ? parsed.error.trim()
            : 'AI 编辑失败';
        }
      },
    });
    if (!requestScopeIsCurrent()) {
      throw new Error('会话已切换，本次 AI 编辑结果已忽略。');
    }
    if (streamError) throw new Error(streamError);
    if (!result.trim()) throw new Error('AI 未返回内容');
    if (!request.selectedText) return result.trim();
    return [
      request.currentContent.slice(0, request.selectionStart),
      result.trim(),
      request.currentContent.slice(request.selectionEnd),
    ].join('');
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

  const startSelectedSkillRun = useCallback(async (): Promise<void> => {
    const skill = selectedSkill;
    const request = input.trim();
    if (!project || !task || !skill || !request || skillRunPending || isStreaming) return;
    const selection = readSimpleChatModelSelection(task);
    if (!selection.modelId || !selection.providerId) {
      setSearchStatus('请先选择可用的对话模型。');
      return;
    }
    const requestProjectId = project.id;
    const requestTaskId = task.id;
    const idempotencyKey = `simple-chat-skill:${requestTaskId}:${skill.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    setSkillRunPending(true);
    setSearchStatus(null);
    try {
      const response = await fetch('/api/skill-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: skill.id,
          skillVersion: skill.version,
          surface: 'simple-chat',
          projectId: requestProjectId,
          workspaceId: `standalone-chat:${requestProjectId}`,
          inputValues: { [SIMPLE_CHAT_SKILL_REQUEST_INPUT_KEY]: request },
          sourceVersionIds: [],
          modelBindings: {
            orchestrator: { providerId: selection.providerId, modelId: selection.modelId },
          },
          idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => null) as { runId?: unknown } | null;
      if (!response.ok || typeof payload?.runId !== 'string' || !payload.runId) {
        throw new Error('后台任务没有启动，请检查对话模型和积分后重试。');
      }
      if (projectIdRef.current !== requestProjectId || taskIdRef.current !== requestTaskId) return;
      const currentTask = latestTaskRef.current;
      if (!currentTask || currentTask.id !== requestTaskId) return;
      const now = Date.now();
      const nextMessages: SimpleChatMessage[] = [
        ...messagesRef.current,
        { id: Math.random().toString(36).slice(2, 10), role: 'user', content: request, createdAt: now },
        {
          id: Math.random().toString(36).slice(2, 10),
          role: 'assistant',
          content: `${skill.icon} ${skill.name}${SIMPLE_CHAT_SKILL_RUN_PENDING_SUFFIX}`,
          agentRunId: payload.runId,
          createdAt: now,
        },
      ];
      setMessages(nextMessages);
      setInput(previous => (previous.trim() === request ? '' : previous));
      void onPersistTask({ ...currentTask, messages: nextMessages, updatedAt: now });
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : '后台任务没有启动，请重试。');
    } finally {
      setSkillRunPending(false);
    }
  }, [input, isStreaming, onPersistTask, project, selectedSkill, skillRunPending, task]);

  const settleSkillRunMessage = useCallback((messageId: string, outcome: { completed: boolean; text: string }) => {
    setMessages(previous => previous.map(message => {
      if (message.id !== messageId || !isPendingSkillRunMessage(message)) return message;
      const title = message.content.slice(0, -SIMPLE_CHAT_SKILL_RUN_PENDING_SUFFIX.length);
      return {
        ...message,
        content: outcome.completed
          ? (outcome.text || SIMPLE_CHAT_SKILL_RUN_EMPTY_RESULT)
          : `${title}${SIMPLE_CHAT_SKILL_RUN_UNFINISHED_SUFFIX}`,
      };
    }));
  }, []);

  const selectSkill = useCallback((skill: SimpleChatSkill) => {
    setSelectedSkill(skill);
    setShowSkillPanel(false);
    textareaRef.current?.focus();
  }, []);

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
          entityId: `${chatTaskId}:${messageId}:${index}`,
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

  const executeChatRequest = useCallback(async (
    context: SimpleChatRetryContextV1,
    userMessage: SimpleChatMessage,
  ): Promise<void> => {
    const requestEpoch = requestScopeEpochRef.current.epoch;
    const requestScopeIsCurrent = () => (
      requestEpoch === requestScopeEpochRef.current.epoch
      && isWorkspaceResultScopeCurrent(context.projectId, projectIdRef.current)
      && context.taskId === taskIdRef.current
    );
    const updateRequestMessages = (updater: (previous: SimpleChatMessage[]) => SimpleChatMessage[]): void => {
      setMessages(previous => requestScopeIsCurrent() ? updater(previous) : previous);
    };
    if (!requestScopeIsCurrent()) return;

    ordinaryRequestEpochRef.current = requestEpoch;
    setIsStreaming(true);
    updateRequestMessages(previous => previous.map(message => (
      message.id === context.assistantMessageId
        ? {
          ...message,
          content: '',
          images: [],
          imageRefs: [],
          attachments: [],
          status: 'streaming',
          error: undefined,
          retryContext: context,
          model: context.modelId,
          providerId: context.providerId,
        }
        : message
    )));

    const historyById = new Map(messagesRef.current.map(message => [message.id, message]));
    const frozenHistory = context.historyMessageIds.flatMap(messageId => {
      const message = historyById.get(messageId);
      return message ? [message] : [];
    });
    const historyContext = buildSimpleChatHistoryRequestContext(frozenHistory);
    setHistoryImages(historyContext.images);
    setHistoryImageNotice(historyContext.rejectedCount > 0
      ? `已忽略 ${historyContext.rejectedCount} 张失效历史图片，本次请求继续发送。`
      : null);

    const allMessages: Array<{ id?: string; role: string; content: string; images?: string[] }> = [
      ...context.systemMessages,
      ...historyContext.messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        ...(message.images?.length ? { images: message.images } : {}),
      })),
      {
        id: userMessage.id,
        role: 'user',
        content: userMessage.content,
        ...(userMessage.images?.length ? { images: userMessage.images } : {}),
      },
    ];
    let fullContent = '';
    let streamError: string | null = null;

    const failMessage = (errorMessage: string, content?: string) => {
      updateRequestMessages(previous => previous.map(message => (
        message.id === context.assistantMessageId
          ? {
            ...message,
            content: content || message.content || errorMessage,
            status: 'failed',
            error: { message: errorMessage, retryable: true },
            retryContext: context,
          }
          : message
      )));
    };

    try {
      const response = await fetch('/api/simple-chat/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': context.idempotencyKey,
        },
        body: JSON.stringify({
          messages: allMessages,
          model: context.modelId,
          providerId: context.providerId,
          imageModel: context.imageModelId,
          imageProviderId: context.imageProviderId,
          webSearch: context.webSearch,
          knowledgeItems: context.knowledgeItems,
          projectId: context.projectId,
          taskId: context.taskId,
          assetProjectId: context.canvasProjectId,
          responseMessageId: context.assistantMessageId,
          idempotencyKey: context.idempotencyKey,
          sourceVersionIds: context.sourceVersionIds,
          sourceMessageId: context.exportSourceMessageId || context.userMessageId,
          selectedEntityIds: context.selectedEntityIds,
          memories: context.memories,
          deepAnalysis: context.deepAnalysis,
          reasoningEffort: context.reasoningEffort,
          responseSpeed: context.responseSpeed,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const streamResult = await consumeSimpleChatJsonStream(response.body, {
        isActive: requestScopeIsCurrent,
        onEvent(value) {
          if (streamError || !requestScopeIsCurrent()) return;
          const parsed = readSimpleChatStreamPayload(value);
          if (!parsed) return;
          if (parsed.type === 'generation_controls') {
            const notices = Array.isArray(parsed.notices)
              ? parsed.notices.filter((notice: unknown): notice is string => typeof notice === 'string')
              : [];
            const appliedControls: SimpleChatTask['appliedChatControls'] = {
              appliedReasoningEffort: parsed.appliedReasoningEffort as ResolvedChatControls['appliedReasoningEffort'],
              appliedResponseSpeed: parsed.appliedResponseSpeed as ResolvedChatControls['appliedResponseSpeed'],
              degraded: Boolean(parsed.degraded),
              notices,
            };
            setControlNotice(notices[0] || `已应用：推理 ${parsed.appliedReasoningEffort || '默认'}，速度 ${parsed.appliedResponseSpeed || '均衡'}`);
            setAppliedChatControls(appliedControls);
          } else if (parsed.type === 'search_status') {
            const resultCount = typeof parsed.resultCount === 'number' ? parsed.resultCount : 0;
            const searchUnavailable = parsed.status === 'failed' || parsed.status === 'error';
            setSearchStatus(parsed.status === 'completed'
              ? `搜索完成，找到 ${resultCount} 条结果`
              : searchUnavailable ? '搜索未返回结果' : '正在搜索...');
            if (parsed.status === 'completed' || searchUnavailable) {
              const searchMessage: SimpleChatMessage = {
                id: `${context.assistantMessageId}-search`,
                role: searchUnavailable || resultCount > 0 ? 'search' : 'system',
                content: searchUnavailable
                  ? WEB_SEARCH_UNAVAILABLE
                  : resultCount > 0 ? parsed.searchResults || '' : '🌐 联网搜索未找到相关结果',
                createdAt: Date.now(),
              };
              updateRequestMessages(previous => {
                const existingIndex = previous.findIndex(message => message.id === searchMessage.id);
                if (existingIndex < 0) {
                  const assistantIndex = previous.findIndex(message => message.id === context.assistantMessageId);
                  const insertAt = assistantIndex < 0 ? previous.length : assistantIndex + (searchUnavailable ? 1 : 0);
                  return [...previous.slice(0, insertAt), searchMessage, ...previous.slice(insertAt)];
                }
                return previous.map(message => message.id === searchMessage.id ? searchMessage : message);
              });
            }
          } else if (parsed.type === 'tool_status') {
            setSearchStatus(null);
            updateRequestMessages(previous => previous.map(message => (
              message.id === context.assistantMessageId
                ? {
                  ...message,
                  content: `*${parsed.label || '正在处理图片任务...'}*`,
                  ...(typeof parsed.runId === 'string' ? { agentRunId: parsed.runId } : {}),
                }
                : message
            )));
          } else if (
            parsed.type === 'multi_platform_export'
            && typeof parsed.runId === 'string'
            && typeof parsed.projectId === 'string'
          ) {
            setSearchStatus(null);
            fullContent = '批量导出任务已提交。';
            updateRequestMessages(previous => previous.map(message => (
              message.id === context.assistantMessageId
                ? {
                    ...message,
                    content: fullContent,
                    multiPlatformExportRunId: parsed.runId,
                    multiPlatformExportProjectId: parsed.projectId,
                  }
                : message
            )));
          } else if (
            parsed.type === 'brief_to_video'
            && typeof parsed.runId === 'string'
            && typeof parsed.projectId === 'string'
          ) {
            setSearchStatus(null);
            fullContent = '视频成片任务已提交。';
            updateRequestMessages(previous => previous.map(message => (
              message.id === context.assistantMessageId
                ? { ...message, content: fullContent, agentRunId: parsed.runId }
                : message
            )));
          } else if (parsed.type === 'image' && typeof parsed.imageUrl === 'string') {
            setSearchStatus(null);
            const parsedImageUrl = parsed.imageUrl;
            const imageRef = readWorkspaceAssetReference(parsed.imageRef);
            updateRequestMessages(previous => previous.map(message => {
              if (message.id !== context.assistantMessageId) return message;
              const imageUrl = imageRef?.url || parsedImageUrl;
              const imageIndex = message.images?.length || 0;
              return {
                ...message,
                content: completedChatImageMessageContent(message.content),
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
            }));
          } else if (parsed.type === 'error') {
            streamError = typeof parsed.error === 'string' && parsed.error.trim()
              ? parsed.error.trim()
              : '未知错误';
            setSearchStatus(null);
            failMessage(streamError, `请求失败：${streamError}\n\n建议：尝试切换模型或稍后重试。`);
          } else if (parsed.type === 'text' && parsed.content) {
            setSearchStatus(null);
            fullContent += parsed.content;
            updateRequestMessages(previous => previous.map(message => (
              message.id === context.assistantMessageId
                ? { ...message, content: fullContent }
                : message
            )));
          }
        },
      });
      if (streamResult === 'cancelled' || !requestScopeIsCurrent()) return;
      if (!streamError) {
        updateRequestMessages(previous => previous.map(message => (
          message.id === context.assistantMessageId
            ? { ...message, status: 'completed', error: undefined, retryContext: context }
            : message
        )));
      }
    } catch (error) {
      if (!requestScopeIsCurrent()) return;
      const errorMessage = error instanceof SimpleChatSseProtocolError
        ? error.message
        : error instanceof Error && /^HTTP \d+$/u.test(error.message)
          ? `请求失败：${error.message}`
          : '抱歉，请求失败，请重试。';
      failMessage(errorMessage);
    } finally {
      if (!requestScopeIsCurrent()) return;
      if (ordinaryRequestEpochRef.current === requestEpoch) ordinaryRequestEpochRef.current = null;
      setIsStreaming(false);
      const estimateTokens = (text: string) => {
        const cn = (text.match(/[一-鿿]/g) || []).length;
        const en = text.length - cn;
        return Math.ceil(cn / 1.5 + en / 4);
      };
      const promptEst = allMessages.reduce((sum, message) => sum + estimateTokens(message.content || ''), 0);
      const completionEst = estimateTokens(fullContent);
      setTokenUsage(previous => ({
        promptTokens: (previous?.promptTokens || 0) + promptEst,
        completionTokens: (previous?.completionTokens || 0) + completionEst,
        totalTokens: (previous?.totalTokens || 0) + promptEst + completionEst,
      }));
    }
  }, []);

  // Handle send
  const handleSend = useCallback(async () => {
    const requestModelSelection = readSimpleChatModelSelection(task);
    const content = input.trim();
    if (!content && uploadedImages.length === 0) return;
    if (isStreaming || !project || !task) return;
    if (!requestModelSelection.modelId || !requestModelSelection.providerId) {
      setSearchStatus('请先选择可用的对话模型。');
      return;
    }

    const currentImages = filterSimpleChatImageInputs(
      uploadedImages.map(attachment => attachment.url || ''),
    );
    if (currentImages.rejectedCount > 0) {
      setSearchStatus('当前上传图片无效，请重新选择图片后发送。');
      return;
    }

    const requestProjectId = project.id;
    const requestTaskId = task.id;
    const requestActiveAgentId = task.activeAgentId;
    const requestEpoch = requestScopeEpochRef.current.epoch;
    if (activeSendRef.current?.epoch === requestEpoch) return;
    const sendToken = { epoch: requestEpoch };
    activeSendRef.current = sendToken;
    try {
    setIsStreaming(true);
    const requestInputEditEpoch = inputEditEpochRef.current;
    ordinaryRequestEpochRef.current = requestEpoch;
    const requestScopeIsCurrent = () => (
      requestEpoch === requestScopeEpochRef.current.epoch
      && isWorkspaceResultScopeCurrent(requestProjectId, projectIdRef.current)
      && requestTaskId === taskIdRef.current
    );
    const userMessageId = Math.random().toString(36).slice(2, 10);
    const assistantMessageId = Math.random().toString(36).slice(2, 10);
    const sentAttachmentIds = new Set(uploadedImages.map(attachment => attachment.id));
    const attachmentRefs = await Promise.all(uploadedImages.map((attachment, index) => (
      registerChatAttachment(attachment, userMessageId, index, project.id, task.id)
    )));
    if (!requestScopeIsCurrent()) return;
    const mediaSlots = alignSimpleChatMediaSlots(uploadedImages, attachmentRefs);

    const userMsg: SimpleChatMessage = {
      id: userMessageId,
      role: 'user', content,
      images: mediaSlots.images,
      imageRefs: mediaSlots.imageRefs,
      attachments: mediaSlots.attachments,
      createdAt: Date.now(),
    };

    const { sourceVersionIds: currentSourceVersionIds, selectedEntityIds: currentSelectedEntityIds } =
      buildSimpleChatManagedAttachmentSelection(userMsg.imageRefs || []);
    const exportRequestContext = resolveSimpleChatExportRequestContext({
      messages,
      currentSourceVersionIds,
      currentSelectedEntityIds,
      currentSourceMessageId: userMessageId,
      currentAssetProjectId: selectedCanvasProjectId,
    });
    const briefVideoRequestContext = resolveSimpleChatBriefVideoRequestContext({
      messages,
      currentSourceVersionIds,
      currentSelectedEntityIds,
      currentSourceMessageId: userMessageId,
      currentAssetProjectId: selectedCanvasProjectId,
    });
    const previousAssistantContent = messages.at(-1)?.role === 'assistant'
      ? messages.at(-1)?.content || ''
      : '';
    const requestContext = isSimpleChatBriefVideoClarification(previousAssistantContent)
      ? briefVideoRequestContext
      : exportRequestContext;
    const requestSourceVersionIds = requestContext.sourceVersionIds;
    const requestSelectedEntityIds = requestContext.selectedEntityIds;

    const systemMessages: Array<{ role: 'system'; content: string }> = [];
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
    if (requestActiveAgentId) {
      const agent = project.agents.find(candidate => candidate.id === requestActiveAgentId);
      if (agent) systemMessages.push({ role: 'system', content: agent.systemPrompt });
    }
    if (selectedSkill) systemMessages.push({ role: 'system', content: selectedSkill.systemPrompt });
    if (webSearch) {
      systemMessages.push({
        role: 'system',
        content: '当前开启了联网搜索模式。请基于联网搜索结果回答用户问题，并在回答末尾列出引用来源。',
      });
    }
    if (brandActive) {
      try {
        const { loadBrandDNARegistry, generateBrandSystemPrompt } = await import('@/lib/brand-dna');
        const latest = loadBrandDNARegistry().at(-1);
        const systemPrompt = latest ? generateBrandSystemPrompt(latest) : '';
        if (systemPrompt) systemMessages.push({ role: 'system', content: systemPrompt });
      } catch {}
    }
    if (!requestScopeIsCurrent()) return;

    const apiKnowledgeItems = knowledgeItems
      .filter(item => item.enabled && item.type !== 'image')
      .map(item => ({
        id: item.id,
        type: item.type,
        title: item.name,
        content: item.textContent || item.url || '',
      }))
      .filter(item => item.content);
    const isDeepAnalysis = content.includes('文案策划深度分析') && (userMsg.images?.length || 0) > 0;
    const retryContext = createSimpleChatRetryContext({
      kind: 'chat',
      projectId: requestProjectId,
      taskId: requestTaskId,
      userMessageId,
      assistantMessageId,
      idempotencyKey: `simple-chat-retry:${requestTaskId}:${assistantMessageId}`,
      modelId: requestModelSelection.modelId,
      providerId: requestModelSelection.providerId,
      imageModelId: selectedImageModel || undefined,
      imageProviderId: selectedImageProviderId || undefined,
      webSearch,
      reasoningEffort,
      responseSpeed,
      canvasProjectId: requestContext.assetProjectId || undefined,
      exportSourceMessageId: requestContext.sourceMessageId,
      sourceVersionIds: requestSourceVersionIds,
      selectedEntityIds: requestSelectedEntityIds,
      historyMessageIds: messages.map(message => message.id),
      systemMessages,
      knowledgeItems: apiKnowledgeItems,
      memories: memories.map(memory => ({ category: memory.category, content: memory.content })),
      deepAnalysis: isDeepAnalysis,
    });
    const aiMsg: SimpleChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      model: retryContext.modelId,
      providerId: retryContext.providerId,
      status: 'streaming',
      retryContext,
      createdAt: Date.now(),
    };

    followMessagesRef.current = true;
    setMessages(previous => requestScopeIsCurrent() ? [...previous, userMsg, aiMsg] : previous);
    setInput(previous => requestScopeIsCurrent() && requestInputEditEpoch === inputEditEpochRef.current && previous === input ? '' : previous);
    setUploadedImages(previous => requestScopeIsCurrent()
      ? previous.filter(attachment => !sentAttachmentIds.has(attachment.id)) : previous);
    await executeChatRequest(retryContext, userMsg);
    } finally {
      if (activeSendRef.current === sendToken) {
        activeSendRef.current = null;
        if (requestScopeEpochRef.current.epoch === requestEpoch) setIsStreaming(false);
      }
    }
  }, [input, isStreaming, messages, project, task, uploadedImages, webSearch, memories, selectedImageModel, selectedImageProviderId, brandActive, selectedCanvasProjectId, registerChatAttachment, executeChatRequest, knowledgeItems, reasoningEffort, responseSpeed, selectedSkill]);

  // 供消息编辑后重新生成调用
  handleSendRef.current = handleSend;

  const executeDeepResearchRequest = useCallback(async (
    context: SimpleChatRetryContextV1,
  ): Promise<void> => {
    const requestScopeIsCurrent = () => (
      isWorkspaceResultScopeCurrent(context.projectId, projectIdRef.current)
      && context.taskId === taskIdRef.current
    );
    if (!requestScopeIsCurrent() || context.kind !== 'deep-research' || !context.query) return;

    setIsStreaming(true);
    setMessages(previous => previous.map(message => message.id === context.assistantMessageId
      ? {
        ...message,
        content: '',
        status: 'streaming',
        error: undefined,
        retryContext: context,
        model: context.modelId,
        providerId: context.providerId,
      }
      : message));

    try {
      const response = await fetch('/api/simple-chat/deep-research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': context.idempotencyKey,
        },
        body: JSON.stringify({
          query: context.query,
          model: context.modelId,
          providerId: context.providerId,
          depth: context.depth || 'standard',
          idempotencyKey: context.idempotencyKey,
        }),
      });
      if (!requestScopeIsCurrent()) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No body');
      let fullContent = '';
      let streamError: string | null = null;

      const streamResult = await consumeSimpleChatJsonStream(response.body, {
        isActive: requestScopeIsCurrent,
        onEvent(value) {
          if (!requestScopeIsCurrent() || streamError) return;
          const parsed = readSimpleChatStreamPayload(value);
          if (!parsed) return;
          if (parsed.type === 'phase') {
            const phaseLabel = parsed.label || '';
            setMessages(previous => previous.map(message => (
              message.id === context.assistantMessageId
                ? { ...message, content: `*${phaseLabel}*` }
                : message
            )));
          } else if (parsed.type === 'text' && typeof parsed.content === 'string') {
            fullContent += parsed.content;
            setMessages(previous => previous.map(message => (
              message.id === context.assistantMessageId
                ? { ...message, content: fullContent }
                : message
            )));
          } else if (parsed.type === 'citations') {
            setMessages(previous => previous.map(message => {
              if (message.id !== context.assistantMessageId) return message;
              const artifactId = `${context.assistantMessageId}-research`;
              const existing = message.artifacts?.find(item => item.id === artifactId);
              const now = Date.now();
              const artifact: ChatArtifact = {
                id: artifactId,
                projectId: context.projectId,
                taskId: context.taskId,
                type: 'document',
                title: `研究: ${context.query!.slice(0, 30)}`,
                content: fullContent,
                version: existing && existing.content !== fullContent ? existing.version + 1 : existing?.version || 1,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
              };
              const messageArtifacts = message.artifacts || [];
              return {
                ...message,
                artifacts: existing
                  ? messageArtifacts.map(item => item.id === artifactId ? artifact : item)
                  : [...messageArtifacts, artifact],
              };
            }));
          } else if (parsed.type === 'error') {
            streamError = typeof parsed.error === 'string' && parsed.error.trim()
              ? parsed.error.trim()
              : '未知错误';
            setMessages(previous => previous.map(message => (
              message.id === context.assistantMessageId
                ? {
                  ...message,
                  content: `Deep Research 失败：${streamError}`,
                  status: 'failed',
                  error: { message: streamError!, retryable: true },
                  retryContext: context,
                }
                : message
            )));
          }
        },
      });
      if (streamResult === 'cancelled' || !requestScopeIsCurrent()) return;
      if (!streamError) {
        setMessages(previous => previous.map(message => (
          message.id === context.assistantMessageId
            ? { ...message, status: 'completed', error: undefined, retryContext: context }
            : message
        )));
      }
    } catch (error) {
      if (!requestScopeIsCurrent()) return;
      const errorMessage = error instanceof SimpleChatSseProtocolError
        ? error.message
        : 'Deep Research 失败，请重试。';
      setMessages(previous => previous.map(message => (
        message.id === context.assistantMessageId
          ? {
            ...message,
            content: errorMessage,
            status: 'failed',
            error: { message: errorMessage, retryable: true },
            retryContext: context,
          }
          : message
      )));
    } finally {
      if (requestScopeIsCurrent()) setIsStreaming(false);
    }
  }, []);

  // Deep Research
  const handleDeepResearch = useCallback(async () => {
    const requestModelSelection = readSimpleChatModelSelection(task);
    const query = input.trim();
    if (!query || isStreaming || !project || !task) return;
    if (!requestModelSelection.modelId || !requestModelSelection.providerId) {
      setSearchStatus('请先选择可用的对话模型。');
      return;
    }
    const userMessageId = `msg_${Date.now()}`;
    const assistantMessageId = `msg_${Date.now() + 1}`;
    const retryContext = createSimpleChatRetryContext({
      kind: 'deep-research',
      projectId: project.id,
      taskId: task.id,
      userMessageId,
      assistantMessageId,
      idempotencyKey: `simple-chat-research:${task.id}:${assistantMessageId}`,
      modelId: requestModelSelection.modelId,
      providerId: requestModelSelection.providerId,
      webSearch: true,
      sourceVersionIds: [],
      selectedEntityIds: [],
      historyMessageIds: messages.map(message => message.id),
      systemMessages: [],
      knowledgeItems: [],
      memories: [],
      query,
      depth: 'standard',
    });
    const userMessage: SimpleChatMessage = {
      id: userMessageId,
      role: 'user',
      content: `🔬 Deep Research: ${query}`,
      createdAt: Date.now(),
    };
    const assistantMessage: SimpleChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      model: retryContext.modelId,
      providerId: retryContext.providerId,
      status: 'streaming',
      retryContext,
      createdAt: Date.now() + 1,
    };
    setMessages(previous => [...previous, userMessage, assistantMessage]);
    setInput('');
    await executeDeepResearchRequest(retryContext);
  }, [executeDeepResearchRequest, input, isStreaming, messages, project, task]);

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
    if (!searchQuery.trim() || !project) { setSearchResults([]); setSearchSubmitted(false); return; }
    const results: typeof searchResults = [];
    project.tasks.forEach(t => {
      t.messages.forEach((m, i) => {
        if (m.content.toLowerCase().includes(searchQuery.toLowerCase())) {
          results.push({ taskId: t.id, taskName: t.name, messageIndex: i, snippet: m.content.slice(0, 100) });
        }
      });
    });
    setSearchResults(results);
    setSearchSubmitted(true);
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

  const sendImagesToCanvas = useCallback(async (
    message: SimpleChatMessage,
    options?: { runProjectId?: string; navigateAfterTransfer?: boolean },
  ) => {
    const targetProjectId = options?.runProjectId || selectedCanvasProjectId;
    if (!targetProjectId || !project || !task) {
      setControlNotice('请先选择目标画布项目');
      return;
    }
    const sourceTrace = buildSimpleChatMessageSourceTrace({ project, task, message });
    if (!sourceTrace) {
      setControlNotice('当前消息缺少有效来源信息，无法发送到画布');
      return;
    }
    if (canvasTransferMessageId === message.id) return;
    const isCurrent = (): boolean => canvasTransferMountedRef.current
      && canvasTransferScopeRef.current === canvasTransferScope;
    const assertCurrent = (): void => {
      if (!isCurrent()) throw new Error('CANVAS_BRIDGE_SCOPE_CHANGED');
    };
    setCanvasTransferMessageId(message.id);
    try {
      assertCurrent();
      const latestTask = latestTaskRef.current;
      if (!latestTask || latestTask.id !== task.id) {
        throw new Error('Chat task changed before Canvas transfer');
      }
      await onPersistTask({
        ...latestTask,
        messages: messagesRef.current,
        updatedAt: Date.now(),
      });
      assertCurrent();
      const transfer = async ({ sourceVersionId, targetProjectId: transferProjectId, index, sourceTrace, kind }: {
        sourceVersionId: string;
        targetProjectId: string;
        index: number;
        sourceTrace?: WorkspaceAssetReference['sourceTrace'];
        kind?: WorkspaceAssetReference['kind'];
      }): Promise<WorkspaceAssetReference> => {
        assertCurrent();
        const entityType = kind === 'video' ? 'canvas-video' : 'canvas-image';
        const transferIdentity = buildSimpleChatCanvasTransferIdentity({
          targetProjectId: transferProjectId,
          chatTaskId: task.id,
          messageId: message.id,
          imageIndex: index,
          sourceVersionId,
        });
        const transferResponse = await fetch('/api/assets/batch-transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transfers: [{
            sourceVersion: sourceVersionId,
            targetProject: transferProjectId,
            targetWorkspace: `canvas:${transferProjectId}`,
            entityType,
            entityId: transferIdentity.entityId,
            idempotencyKey: transferIdentity.idempotencyKey,
            metadata: {
              source: 'standalone-chat',
              messageId: message.id,
              imageIndex: index,
              ...(sourceTrace ? { sourceTrace } : {}),
            },
          }], restoreDeletedPlacements: true }),
        });
        assertCurrent();
        if (!transferResponse.ok) throw new Error('Asset transfer failed');
        const payload = await transferResponse.json() as { transfers?: unknown[] };
        assertCurrent();
        const transferred = readWorkspaceAssetReference(payload.transfers?.[0]);
        if (!transferred?.assetVersionId || !transferred.placementId) {
          throw new Error('Asset transfer returned an incomplete reference');
        }
        return { ...transferred, ...(kind ? { kind } : {}) };
      };
      const onTransferred = async (reference: WorkspaceAssetReference): Promise<void> => {
        assertCurrent();
        await enqueueCanvasBridgeReferences({ actorId: canvasTransferScope.actorId,
          projectId: targetProjectId, storage: localStorage, locks: navigator.locks, isCurrent,
          references: [reference] });
        assertCurrent();
      };
      const transferResult = options?.runProjectId
        ? await sendSimpleChatExportToCanvas({
          runProjectId: options.runProjectId,
          imageRefs: message.imageRefs || [],
          sourceTrace,
          transfer,
          onTransferred,
        })
        : await sendSimpleChatMediaToCanvas({
        images: message.images || [],
        imageRefs: message.imageRefs || [],
        targetProjectId,
        sourceTrace,
        transfer,
        onTransferred,
      });
      assertCurrent();
      if (!transferResult.ok) {
        setControlNotice('历史图片或登记失败的图片仅可查看，无法发送到画布');
        return;
      }
      const transferredImages = transferResult.references;
      if (options?.navigateAfterTransfer) {
        window.location.assign(`/?projectId=${encodeURIComponent(targetProjectId)}`);
        return;
      }
      const toast = document.createElement('div');
      canvasTransferToastRef.current?.remove();
      canvasTransferToastRef.current = toast;
      toast.dataset.canvasBridgeNotice = 'waiting';
      toast.setAttribute('role', 'status');
      toast.className = 'fixed bottom-20 right-6 z-[9999] bg-blue-600 text-white px-4 py-3 rounded-lg shadow-lg cursor-pointer hover:bg-blue-700 transition-colors text-sm flex items-center gap-2';
      // P3 fix: 用 DOM API 构建子节点，避免 innerHTML 拼接（低风险但非最佳实践）
      const span1 = document.createElement('span');
      span1.textContent = `已发送 ${transferredImages.length} 张图片，等待画布接收`;
      const span2 = document.createElement('button');
      span2.type = 'button';
      span2.className = 'inline-flex min-h-11 min-w-11 shrink-0 items-center whitespace-nowrap rounded-sm px-1 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';
      span2.textContent = '前往画布查看';
      toast.appendChild(span1);
      toast.appendChild(span2);
      toast.onclick = () => {
        if (isCurrent()) window.location.assign(`/?projectId=${encodeURIComponent(targetProjectId)}`);
        toast.remove();
      };
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 8000);
    } catch (error) {
      if (!isCurrent()) return;
      setControlNotice(error instanceof Error && error.message === 'EXPORT_ASSET_VERSION_MISMATCH'
        ? '导出结果必须返回任务所属画布，未创建跨项目副本'
        : '图片无法发送到所选画布');
    } finally {
      if (isCurrent()) setCanvasTransferMessageId((current) => current === message.id ? null : current);
    }
  }, [canvasTransferMessageId, canvasTransferScope, onPersistTask, project, selectedCanvasProjectId, task]);

  // Message operations
  const copyMessage = (content: string) => { navigator.clipboard.writeText(content); };
  const retryFailedMessage = useCallback(async (messageId: string) => {
    if (isStreaming) return;
    const assistantMessage = messagesRef.current.find(message => message.id === messageId);
    const context = readSimpleChatRetryContext(assistantMessage?.retryContext, {
      assistantMessageId: messageId,
      projectId: projectIdRef.current,
      taskId: taskIdRef.current,
    });
    if (!assistantMessage || !context) {
      setMessages(previous => previous.map(message => message.id === messageId
        ? {
          ...message,
          status: 'failed',
          error: { message: '该请求缺少可恢复信息，无法重试。', retryable: false },
        }
        : message));
      return;
    }
    const userMessage = messagesRef.current.find(message => message.id === context.userMessageId);
    if (!userMessage || userMessage.role !== 'user') {
      setMessages(previous => previous.map(message => message.id === messageId
        ? {
          ...message,
          status: 'failed',
          error: { message: '原始用户消息不存在，无法重试。', retryable: false },
        }
        : message));
      return;
    }
    if (context.kind === 'deep-research') {
      await executeDeepResearchRequest(context);
      return;
    }
    await executeChatRequest(context, userMessage);
  }, [executeChatRequest, executeDeepResearchRequest, isStreaming]);
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
    if (!knowledgeViewMountedRef.current || knowledgeViewScopeRef.current !== knowledgeViewScope) return;
    if (!updateKnowledge(items => items.some(current => current.id === item.id) ? null : [...items, item])) return;
    if (item.type === 'file' || item.type === 'image') {
      // File completion must not discard or close an unrelated draft.
      setAddingKnowledge(current => current === 'file' ? null : current);
    } else {
      setAddingKnowledge(null);
      updateKnowledgeDraft({ url: '', note: '', noteName: '' });
    }
  };
  const removeKnowledgeItem = (id: string) => {
    const expected = knowledgeItems.find(item => item.id === id);
    if (!expected) return;
    updateKnowledge(items => {
      const current = items.find(item => item.id === id);
      return !current || JSON.stringify(current) !== JSON.stringify(expected) ? null : items.filter(item => item.id !== id);
    });
  };
  const toggleKnowledgeItem = (id: string) => {
    const expected = knowledgeItems.find(item => item.id === id);
    if (!expected) return;
    updateKnowledge(items => {
      const current = items.find(item => item.id === id);
      return !current || JSON.stringify(current) !== JSON.stringify(expected) ? null : items.map(item => item.id === id ? { ...item, enabled: !item.enabled } : item);
    });
  };

  if (project && task && (messagesScope !== messageScope || draftReadyScope !== draftScope)) {
    return <div role="status" className="flex-1 flex items-center justify-center text-sm text-muted-foreground">正在切换对话…</div>;
  }

  if (!project || !task) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          {workflowReturnConflict && <p role="alert" className="text-sm text-muted-foreground">工作流返回参数存在冲突，未处理。请返回工作流重新发送。</p>}
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
  const modelMenuStyle = modelMenuLayout ? {
    left: `${modelMenuLayout.left}px`,
    top: `${modelMenuLayout.top}px`,
    width: `${modelMenuLayout.width}px`,
    maxHeight: `${modelMenuLayout.maxHeight}px`,
  } : undefined;
  const settingsTop = Math.max(chatViewport.top + 8,
    Math.min(chatViewport.headerBottom + 4, chatViewport.top + chatViewport.height - 64));
  const settingsWidth = Math.min(384, Math.max(0, chatViewport.width - 16));
  const settingsStyle = compactHeader ? {
    display: showChatSettings ? undefined : 'none',
    left: chatViewport.left + chatViewport.width - settingsWidth - 8,
    top: settingsTop,
    width: settingsWidth,
    maxHeight: Math.max(0, chatViewport.top + chatViewport.height - settingsTop - 8),
  } : undefined;
  const chatVisibleTop = Math.max(chatViewport.top, chatViewport.naturalTop);
  const chatAvailableHeight = Math.max(0, chatViewport.top + chatViewport.height - chatVisibleTop);
  // The Page sync bar also consumes height. Compact message actions follow
  // the actual chat budget, not the full window or a narrow-width heuristic.
  const compactMessageActions = chatAvailableHeight <= 430;
  // Preserve readable conversation space even in extra-short landscape;
  // the existing composer scroll keeps every original control reachable.
  const composerMaxHeight = Math.max(44,
    chatAvailableHeight - Math.max(0, chatViewport.agentBottom - chatVisibleTop)
      - (chatAvailableHeight <= 320 ? Math.max(80, chatAvailableHeight / 3) : 80));

  return (
    <div className="flex-1 min-w-0 flex flex-col h-screen supports-[height:100dvh]:h-dvh min-h-0 bg-background isolate"
      ref={chatAreaRef}
      style={compactHeader ? {
        marginTop: Math.max(0, chatViewport.top - chatViewport.naturalTop),
        maxHeight: chatAvailableHeight,
      } : undefined}>
      {/* Top Bar */}
      <header className="relative z-50 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-background/80 shrink-0 data-[compact=true]:flex-nowrap data-[compact=true]:gap-1 data-[compact=true]:px-2 data-[compact=true]:py-1"
        ref={chatHeaderRef} data-compact={compactHeader}>
        <button onClick={onToggleSidebar} className={`p-2 rounded-lg hover:bg-muted transition-colors ${compactHeader ? 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center' : ''}`} title="切换侧边栏">
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1" style={compactHeader ? { display: 'none' } : undefined} />
        {/* Model Selector */}
        <div ref={chatModelMenuRef} className={`relative ${compactHeader ? 'min-w-0 flex-1' : ''}`}>
          <button
            ref={chatModelButtonRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openModelMenu === 'chat'}
            onClick={() => toggleModelMenu('chat')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-xs cursor-pointer ${compactHeader ? 'min-h-11 min-w-11 w-full [&>svg]:shrink-0' : ''}`}
          >
            <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
            <span className="font-medium min-w-0 max-w-[120px] truncate">{chatModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModel)?.name || selectedModel || '选择模型'}</span>
            <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${openModelMenu === 'chat' ? 'rotate-180' : ''}`} />
          </button>
          <div className={`fixed bg-card border border-border rounded-xl shadow-xl z-[100] overflow-y-auto p-1 transition-opacity ${openModelMenu === 'chat' ? 'opacity-100 visible pointer-events-auto' : 'hidden'}`} style={modelMenuStyle} role="listbox">
            {chatCatalogState === 'loading' && (
              <div role="status" className="px-3 py-4 text-sm text-muted-foreground">正在加载模型目录…</div>
            )}
            {chatCatalogState === 'error' && (
              <div className="space-y-2 p-2">
                <p role="status" className="text-sm text-muted-foreground">聊天模型目录加载失败，请重试。</p>
                <button type="button" onClick={() => { void fetchChatModels(); }}
                  className="min-h-11 min-w-11 w-full whitespace-nowrap rounded-lg bg-muted px-3 text-sm font-medium text-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  重新加载
                </button>
              </div>
            )}
            {chatCatalogState === 'ready' && chatModels.length === 0 && (
              <div role="status" className="px-3 py-4 text-center text-sm text-muted-foreground">暂无可用聊天模型</div>
            )}
            {chatModels.map(m => (
              <button key={m.id} type="button" role="option" aria-selected={m.providerId === selectedProviderId && m.modelId === selectedModel} onClick={() => handleChatModelSelect({ modelId: m.modelId, providerId: m.providerId })}
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
        <button onClick={() => onCreateTask(project.id)}
          className={`px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs transition-colors whitespace-nowrap ${compactHeader ? 'min-h-11 min-w-11 shrink-0' : 'order-last'}`}>
          <MessageSquarePlus className="w-3.5 h-3.5 inline mr-1" />新对话
        </button>
        {compactHeader && <button ref={chatSettingsButtonRef} type="button" aria-label="更多设置"
          aria-expanded={showChatSettings}
          onClick={() => { setShowChatSettings(!showChatSettings); setOpenModelMenu(null); }}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <MoreHorizontal className="w-5 h-5" />
        </button>}
        {/* One live set of secondary controls: inline on desktop, scrollable on mobile. */}
        <div ref={chatSettingsRef} role={compactHeader ? 'region' : undefined}
          aria-label={compactHeader ? '聊天设置' : undefined}
          className={compactHeader ? 'fixed z-[90] flex flex-wrap items-center gap-2 overflow-y-auto overscroll-contain scroll-pt-16 rounded-xl bg-card p-2 shadow-xl [&>button]:inline-flex [&>button]:min-h-11 [&>button]:min-w-11 [&>button]:items-center [&>button]:justify-center [&>button]:scroll-mt-16 [&>button]:whitespace-nowrap' : 'contents'}
          style={settingsStyle}>
        {compactHeader && <div className="sticky top-0 z-10 flex w-full items-center justify-between bg-card text-sm font-medium">
          <span>聊天设置</span>
          <button type="button" aria-label="关闭设置"
            onClick={() => { setShowChatSettings(false); setOpenModelMenu(null); chatSettingsButtonRef.current?.focus(); }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>}
        <button onClick={onBackToWorkspace} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="w-4 h-4 rotate-90 inline" /> 工作台
        </button>
        <div className={`flex flex-wrap items-center gap-1 rounded-lg bg-muted p-0.5 ${compactHeader ? 'w-full [&>button]:min-h-11 [&>button]:min-w-11 [&>button]:scroll-mt-16' : ''}`} aria-label="推理强度">
          {(['low', 'medium', 'high', 'maximum'] as ReasoningEffort[]).map((effort) => (
            <button key={effort} type="button" onClick={() => setReasoningEffort(effort)} className={`px-2 py-1 rounded-md text-[11px] transition-colors ${reasoningEffort === effort ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`} title="推理强度">
              {effort === 'low' ? '轻量' : effort === 'medium' ? '均衡' : effort === 'high' ? '深度' : '极强'}
            </button>
          ))}
        </div>
        <select value={responseSpeed} onChange={(event) => setResponseSpeed(event.target.value as ResponseSpeed)} className={`rounded-lg border border-border bg-muted px-2 text-xs text-foreground ${compactHeader ? 'h-11 w-full scroll-mt-16' : 'h-8'}`} aria-label="响应速度">
          <option value="fast">快速响应</option>
          <option value="balanced">均衡响应</option>
          <option value="quality">质量优先</option>
        </select>
        {/* Image Model Selector */}
        <div ref={imageModelMenuRef} className={`relative ${compactHeader ? 'w-full scroll-mt-16' : ''}`}>
          <button
            ref={imageModelButtonRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={openModelMenu === 'image'}
            onClick={() => toggleModelMenu('image')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-xs cursor-pointer ${compactHeader ? 'min-h-11 min-w-11 w-full scroll-mt-16 [&>svg]:shrink-0' : ''}`}
          >
            <Image className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-medium max-w-[100px] truncate">{imageModels.find(m => m.providerId === selectedImageProviderId && m.modelId === selectedImageModel)?.name || selectedImageModel || '图像模型'}</span>
            <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${openModelMenu === 'image' ? 'rotate-180' : ''}`} />
          </button>
          <div className={`fixed bg-card border border-border rounded-xl shadow-xl z-[100] overflow-y-auto p-1 transition-opacity ${openModelMenu === 'image' ? 'opacity-100 visible pointer-events-auto' : 'hidden'}`} style={modelMenuStyle} role="listbox">
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground/60 font-medium">图像生成模型</div>
            {imageCatalogState === 'loading' && (
              <div role="status" className="px-3 py-4 text-sm text-muted-foreground">正在加载模型目录…</div>
            )}
            {imageCatalogState === 'error' && (
              <div className="space-y-2 p-2">
                <p role="status" className="text-sm text-muted-foreground">图像模型目录加载失败，请重试。</p>
                <button type="button" onClick={() => { void fetchImageModels(); }}
                  className="min-h-11 min-w-11 w-full whitespace-nowrap rounded-lg bg-muted px-3 text-sm font-medium text-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  重新加载
                </button>
              </div>
            )}
            {imageModels.map(m => (
              <button key={m.id} type="button" role="option" aria-selected={m.providerId === selectedImageProviderId && m.modelId === selectedImageModel} onClick={() => handleImageModelSelect({ modelId: m.modelId, providerId: m.providerId })}
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
            {imageCatalogState === 'ready' && imageModels.length === 0 && (
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
        </div>
      </header>

      {/* Agent Bar */}
      <div ref={chatAgentBarRef} className={`flex min-w-0 flex-col px-4 border-b border-border bg-muted/30 shrink-0 ${compactHeader ? 'min-h-11 py-0' : 'py-1.5'}`}>
        <div className={`flex min-w-0 w-full items-center gap-2 ${compactHeader ? 'min-h-11' : ''}`}>
          <Bot className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-xs text-muted-foreground">Agent:</span>
          {historyImageNotice && <span className="min-w-0 max-w-[360px] truncate text-[11px] text-muted-foreground" title={historyImageNotice}>· {historyImageNotice}</span>}
          {activeAgent ? (
            <span className="min-w-0 text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate" title={activeAgent.name}>{activeAgent.emoji || '🤖'} {activeAgent.name}</span>
              <button type="button" aria-label="移除当前 Agent" onClick={() => onUpdateTask({ ...task, activeAgentId: undefined })}
                className={`ml-1 inline-flex shrink-0 items-center justify-center hover:text-red-500 ${compactHeader ? 'min-h-11 min-w-11' : ''}`}><X className="w-3 h-3" /></button>
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">未选择</span>
          )}
          <div className="flex-1" />
          <button onClick={() => setShowAgentPanel(!showAgentPanel)} className={`text-xs text-muted-foreground hover:text-foreground transition-colors flex shrink-0 items-center justify-center gap-1 ${compactHeader ? 'min-h-11 min-w-11' : ''}`}>
            <Settings className="w-3 h-3" /> 管理
          </button>
        </div>
        {controlNotice && <span role="status" className="block min-w-0 max-w-full whitespace-normal pb-2 text-[11px] text-muted-foreground [overflow-wrap:anywhere]" title={controlNotice}>· {controlNotice}</span>}
      </div>

      {/* Messages */}
      <div ref={messagesScrollRef} className={`flex-1 min-h-0 overflow-y-auto px-4 ${compactHeader ? 'py-2' : 'py-6'}`}>
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className={chatAvailableHeight <= 320 ? 'flex flex-wrap items-center gap-x-2 gap-y-1 text-left' : `text-center ${compactMessageActions ? 'py-2 space-y-2' : 'py-20 space-y-4'}`}>
              <h1 className={`${chatAvailableHeight <= 320 ? 'min-w-0 max-w-full [overflow-wrap:anywhere] text-sm leading-5' : compactMessageActions ? 'text-xl leading-7 truncate' : 'text-3xl'} font-bold text-foreground`} title={activeAgent ? `${activeAgent.emoji || '🤖'} ${activeAgent.name}` : project.name}>{activeAgent ? `${activeAgent.emoji || '🤖'} ${activeAgent.name}` : project.name}</h1>
              <p className="text-muted-foreground">开始一段新的对话吧</p>
              <div className={`flex flex-wrap justify-center gap-2 mt-4 ${chatAvailableHeight <= 320 ? 'w-full' : ''}`}>
                {PRESET_SKILLS.slice(0, 6).map(skill => (
                  <button key={skill.id} onClick={() => selectSkill(skill)}
                    className="min-h-11 min-w-11 px-3 py-1.5 rounded-full border border-border hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
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
            <div
              key={msg.id}
              data-chat-message-id={msg.id}
              data-chat-asset-placement-ids={(msg.imageRefs || []).map(reference => reference.placementId).filter(Boolean).join(' ')}
              className={`min-w-0 flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 120px',
                marginBlockEnd: compactMessageActions && idx === messages.length - 1 ? 0 : undefined }}
            >
              {/* Search results card */}
              {msg.role === 'search' && (msg.content === WEB_SEARCH_UNAVAILABLE
                ? <div role="status" className="max-w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground [overflow-wrap:anywhere]">{msg.content}</div>
                : <SearchResultsCard content={msg.content} />
              )}
              {msg.role !== 'search' && (<>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  {activeAgent?.emoji ? <span className="text-sm">{activeAgent.emoji}</span> : <Bot className="w-3.5 h-3.5 text-primary" />}
                </div>
              )}
              <div className={`min-w-0 max-w-[82%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                <div className={`rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-md'
                    : 'bg-card border border-border rounded-bl-md'
                }`}>
                  {msg.role === 'assistant' && !msg.content && msg.status === 'streaming' ? (
                    <div className="flex items-center gap-1 py-1">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  ) : msg.role === 'assistant' ? (
                    <MarkdownRenderer content={msg.content} />
                  ) : editingMessageId === msg.id ? (
                    <div className="min-w-0 space-y-2">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="w-full bg-primary-foreground/10 text-primary-foreground rounded-lg px-3 py-2 text-base outline-none resize-y min-h-[60px]"
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-2 justify-end">
                        <button onClick={() => { setEditingMessageId(null); setEditingContent(''); }} className="min-h-11 min-w-11 px-2.5 py-1 rounded text-xs bg-primary-foreground/20 hover:bg-primary-foreground/30">取消</button>
                        <button onClick={() => handleEditSubmit(msg.id)} className="min-h-11 min-w-11 px-2.5 py-1 rounded text-xs bg-primary-foreground text-primary font-medium">保存并重新生成</button>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed">{msg.content}</div>
                  )}
                  {msg.agentRunId && msg.content !== '视频成片任务已提交。' && (
                    <div className="mt-3">
                      <AgentRunMessageProgress
                        runId={msg.agentRunId}
                        onSettled={isPendingSkillRunMessage(msg) ? outcome => settleSkillRunMessage(msg.id, outcome) : undefined}
                      />
                    </div>
                  )}
                  {msg.agentRunId
                    && msg.content === '视频成片任务已提交。'
                    && msg.retryContext?.canvasProjectId && (
                      <BriefToVideoCard
                        runId={msg.agentRunId}
                        projectId={msg.retryContext.canvasProjectId}
                        onReturnToCanvas={references => sendImagesToCanvas({
                          ...msg,
                          images: references.map(reference => reference.url),
                          imageRefs: references,
                        }, {
                          runProjectId: msg.retryContext!.canvasProjectId,
                          navigateAfterTransfer: true,
                        })}
                      />
                    )}
                  {msg.multiPlatformExportRunId && msg.multiPlatformExportProjectId && (
                    <MultiPlatformExportCard
                      runId={msg.multiPlatformExportRunId}
                      projectId={msg.multiPlatformExportProjectId}
                      onReturnToCanvas={references => sendImagesToCanvas({
                        ...msg,
                        images: references.map(reference => reference.url),
                        imageRefs: references,
                      }, { runProjectId: msg.multiPlatformExportProjectId })}
                    />
                  )}
                  {msg.role === 'assistant' && msg.status === 'failed' && (
                    <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-destructive/20 pt-2">
                      <span className="min-w-0 [overflow-wrap:anywhere] text-xs text-destructive">
                        {msg.error?.message || '请求失败'}
                      </span>
                      {msg.error?.retryable && msg.retryContext && (
                        <button
                          type="button"
                          onClick={() => void retryFailedMessage(msg.id)}
                          disabled={isStreaming}
                          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                          title="重试失败请求"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          重试
                        </button>
                      )}
                    </div>
                  )}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {msg.images.map((url, i) => (
                        <button key={i} type="button" aria-label={`预览图片 ${i + 1}`}
                          className="h-20 w-20 shrink-0 overflow-hidden rounded-lg cursor-zoom-in hover:opacity-80 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          onClick={() => setLightbox({ images: msg.images!, index: i })}>
                          <img src={url} alt={`图片 ${i + 1}`} className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* Message Operations */}
                {shouldRenderSimpleChatWorkspaceActions(msg, isStreaming) && hasSimpleChatAssistantOperationPayload(msg) && (
                  <div role={compactMessageActions ? 'group' : undefined}
                    onFocusCapture={compactMessageActions ? event => {
                      if (event.target instanceof HTMLElement && event.currentTarget.contains(event.target)) {
                        event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                      }
                    } : undefined}
                    aria-label={compactMessageActions ? '回复操作' : undefined}
                    className={compactMessageActions
                      ? "flex max-w-full flex-nowrap gap-0.5 mt-1 px-1 overflow-x-auto overscroll-x-contain"
                      : "flex flex-wrap gap-0.5 mt-1 px-1 opacity-100 sm:opacity-0 sm:hover:opacity-100 sm:focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity flex-wrap"}>
                    <button onClick={() => copyMessage(msg.content)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="复制"><Copy className="w-3 h-3" /></button>
                    <button onClick={regenerateLast} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="重新生成"><RefreshCw className="w-3 h-3" /></button>
                    <button onClick={() => makeShorter(msg)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="更短"><Minimize2 className="w-3 h-3" /></button>
                    <button onClick={() => makeLonger(msg)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="更长"><Maximize2 className="w-3 h-3" /></button>
                    <button onClick={() => continueConversation(msg)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="继续"><MoreHorizontal className="w-3 h-3" /></button>
                    <button onClick={() => toImagePrompt(msg)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="转生图提示词"><Sparkles className="w-3 h-3" /></button>
                    <button onClick={() => branchFromMessage(msg.id)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="从此分支"><GitBranch className="w-3 h-3" /></button>
                    <button onClick={() => saveAsArtifact(msg)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="保存为 Artifact"><FileCode className="w-3 h-3" /></button>
                    {hasPptJson(msg.content) && (
                      <button onClick={() => downloadPptx(msg.content)} disabled={downloadingPptx}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-primary/10 text-primary transition-colors" title="下载 PPTX">
                        {downloadingPptx ? <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> : <Download className="w-3 h-3" />}
                      </button>
                    )}
                    {hasExcelJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadExcel(d); }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-green-500/10 text-green-500 transition-colors" title="下载 Excel">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {hasWordJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadWord(d); }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-blue-500/10 text-blue-500 transition-colors" title="下载 Word">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {hasMindmapJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadMindmap(d); }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-amber-500/10 text-amber-500 transition-colors" title="下载思维导图">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {hasFlowchartJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadFlowchart(d); }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-purple-500/10 text-purple-500 transition-colors" title="下载流程图">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {hasPdfJson(msg.content) && (
                      <button onClick={() => { const d = extractJsonFromContent(msg.content); if (d) downloadPdf(d); }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-red-500/10 text-red-500 transition-colors" title="下载 PDF">
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    <SimpleChatWorkspaceActionEntry
                      message={msg}
                      project={project}
                      task={task}
                      isStreaming={isStreaming}
                      selectedCanvasProjectId={selectedCanvasProjectId}
                      canvasTransferPending={canvasTransferMessageId === msg.id}
                      onSendToCanvas={(message) => { void sendImagesToCanvas(message); }}
                      onNotice={setControlNotice}
                    />
                    {/* 回复评分 */}
                    <span className="w-px h-4 bg-border mx-0.5 self-center" />
                    <button onClick={() => handleRateMessage(msg.id, 'up')}
                      className={`inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded transition-colors ${messageRatings[msg.id] === 'up' ? 'text-green-500 bg-green-500/10' : 'hover:bg-muted text-muted-foreground'}`} title="有帮助">
                      <ThumbsUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => handleRateMessage(msg.id, 'down')}
                      className={`inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded transition-colors ${messageRatings[msg.id] === 'down' ? 'text-red-500 bg-red-500/10' : 'hover:bg-muted text-muted-foreground'}`} title="无帮助">
                      <ThumbsDown className="w-3 h-3" />
                    </button>
                    {/* 保存到 Canvas */}
                    <button onClick={() => { setCanvasContent(msg.content); setShowCanvas(true); }}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-primary/10 text-primary transition-colors" title="在 Canvas 中编辑">
                      <PenSquare className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {shouldRenderSimpleChatWorkspaceActions(msg, isStreaming) && !hasSimpleChatAssistantOperationPayload(msg) && (
                  <SimpleChatWorkspaceActionEntry
                    message={msg}
                    project={project}
                    task={task}
                    isStreaming={isStreaming}
                    selectedCanvasProjectId={selectedCanvasProjectId}
                    canvasTransferPending={canvasTransferMessageId === msg.id}
                    onSendToCanvas={(message) => { void sendImagesToCanvas(message); }}
                    onNotice={setControlNotice}
                  />
                )}
                {/* User Message Operations */}
                {msg.role === 'user' && !isStreaming && editingMessageId !== msg.id && (
                  <div role={compactMessageActions ? 'group' : undefined}
                    onFocusCapture={compactMessageActions ? event => {
                      if (event.target instanceof HTMLElement && event.currentTarget.contains(event.target)) {
                        event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                      }
                    } : undefined}
                    aria-label={compactMessageActions ? '消息操作' : undefined}
                    className={compactMessageActions
                      ? "flex max-w-full flex-nowrap gap-0.5 mt-1 px-1 overflow-x-auto overscroll-x-contain"
                      : "flex flex-wrap gap-0.5 mt-1 px-1 opacity-100 sm:opacity-0 sm:hover:opacity-100 sm:focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"}>
                    <button onClick={() => copyMessage(msg.content)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="复制"><Copy className="w-3 h-3" /></button>
                    <button onClick={() => { setEditingMessageId(msg.id); setEditingContent(msg.content); }} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground" title="编辑"><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => handleDeleteMessage(msg.id)} className="inline-flex min-h-11 min-w-11 items-center justify-center p-1 rounded hover:bg-red-500/10 text-red-500" title="删除"><Trash2 className="w-3 h-3" /></button>
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
      <div className={`shrink-0 min-w-0 px-3 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${compactHeader ? 'pt-1 overflow-y-auto overscroll-contain' : 'pt-2'}`}
        ref={composerRef} style={compactHeader ? { maxHeight: composerMaxHeight,
          ...(shortChatViewport ? { paddingBottom: 'max(4px, env(safe-area-inset-bottom))' } : {}),
        } : undefined}>
        <div className="min-w-0 max-w-3xl mx-auto">
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
                  <div key={i} className="relative flex w-24 shrink-0 flex-col gap-1">
                    <img src={att.url} alt={att.name || "已上传图片"} className="w-24 h-20 object-cover rounded-lg" />
                    <button type="button" onClick={() => setUploadedImages(prev => prev.filter((_, j) => j !== i))}
                      aria-label={"移除图片：" + (att.name || "未命名图片")}
                      title={"移除图片：" + (att.name || "未命名图片")}
                      className="absolute top-0 right-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                      <X className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => {
                      setInput(`请对这张图片进行深度分析报告，从视觉风格、文案策略、目标受众、可复用技巧四个维度拆解，并给出可执行的创作建议：`);
                      textareaRef.current?.focus();
                    }}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-muted px-2 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                      深度分析
                    </button>
                  </div>
                ))}
              </div>
            )}
            {selectedSkill && (
              <div data-simple-chat-selected-skill={selectedSkill.id} className="flex min-w-0 flex-wrap items-center gap-2 px-4 pt-3">
                <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-primary/10 pl-2 text-xs font-medium text-primary">
                  <span aria-hidden="true">{selectedSkill.icon}</span>
                  <span className="min-w-0 truncate" title={selectedSkill.name}>{selectedSkill.name}</span>
                  <button type="button" aria-label={`移除技能：${selectedSkill.name}`} onClick={() => setSelectedSkill(null)}
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full hover:text-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    <X className="h-3 w-3" />
                  </button>
                </span>
                <button type="button" aria-label="转为后台任务" onClick={() => { void startSelectedSkillRun(); }}
                  disabled={!input.trim() || skillRunPending || isStreaming}
                  title="作为后台任务运行；刷新或离开页面后，结果仍会写回这段对话"
                  className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none">
                  {skillRunPending ? '正在提交…' : '转为后台任务'}
                </button>
                <button type="button" onClick={() => onSkillToAgent(selectedSkill)}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none">
                  存为 Agent
                </button>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => { inputEditEpochRef.current += 1; setInput(e.target.value); }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={selectedSkill ? `使用 ${selectedSkill.name}：描述你的任务需求，Enter 发送` : activeAgent ? `与 ${activeAgent.name} 对话...` : "输入消息，Enter 发送，支持 Ctrl+V 粘贴图片"}
              rows={1}
              className="block w-full min-w-0 bg-transparent px-4 py-3 text-base sm:text-sm leading-relaxed resize-none outline-none placeholder:text-muted-foreground min-h-[80px] sm:min-h-[60px] max-h-[min(200px,30dvh)]"
              style={{ scrollbarWidth: 'thin', ...(compactHeader ? {
                minHeight: 44, maxHeight: shortChatViewport ? 44 : Math.max(44, Math.min(160, chatViewport.height * 0.2)),
                fontSize: 16,
                paddingTop: 8, paddingBottom: 8,
              } : {}) }}
            />
            <div className={`flex min-w-0 flex-wrap items-center gap-1 px-2 [&>button]:inline-flex [&>button]:min-h-11 [&>button]:min-w-11 [&>button]:shrink-0 [&>button]:items-center [&>button]:justify-center ${compactHeader ? 'pb-1' : 'pb-2'}`}>
              <button onClick={() => setBrandActive(!brandActive)}
                className={`p-1.5 rounded-lg transition-colors ${brandActive ? 'bg-amber-500/10 text-amber-500' : 'text-muted-foreground hover:bg-muted'}`}
                title="品牌DNA注入 - 将品牌规范注入对话上下文">
                <Shield className="w-4 h-4" />
              </button>
              <button onClick={() => setWebSearch(!webSearch)}
                aria-label="联网搜索"
                aria-pressed={webSearch}
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
              <QuickCommands
                open={showQuickCommands}
                onOpenChange={setShowQuickCommands}
                hasImages={uploadedImages.length > 0}
                onSelect={prompt => { setInput(prompt); setShowQuickCommands(false); textareaRef.current?.focus(); }}
                trigger={
                  <button type="button"
                    className={`p-1.5 rounded-lg transition-colors ${showQuickCommands ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                    title="快捷工作流">
                    <Zap className="w-4 h-4" />
                  </button>
                }
              />
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
                className="ml-auto p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 transition-all hover:bg-primary/90"
                aria-label="发送消息">
                {isStreaming ? <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
            <input id="chat-file-upload" type="file" accept="image/*" multiple className="hidden"
              onChange={e => {
                handleImageFiles(Array.from(e.currentTarget.files || []));
                e.currentTarget.value = "";
              }} />
          </div>
          <div className={`text-xs text-muted-foreground/50 flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 ${compactHeader ? 'mt-1' : 'mt-2'}`}>
            <label className={`inline-flex min-w-0 items-center gap-2 ${compactHeader ? 'min-w-[calc(4em+0.5rem+44px)] flex-1' : 'w-full sm:w-auto'}`}>
              <span className="shrink-0">目标画布</span>
              <select
                aria-label="目标画布项目"
                value={selectedCanvasProjectId}
                onChange={event => setSelectedCanvasProjectId(event.target.value)}
                className="min-h-11 min-w-0 flex-1 sm:flex-none sm:max-w-36 bg-transparent text-foreground border border-border rounded px-1.5 py-0.5 outline-none"
              >
                <option value="">未选择</option>
                {canvasProjects.map(canvasProject => (
                  <option key={canvasProject.id} value={canvasProject.id}>{canvasProject.name}</option>
                ))}
              </select>
            </label>
            <button onClick={toggleTheme} className="inline-flex min-h-11 items-center gap-1 hover:text-foreground transition-colors">
              {theme === 'dark' ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
              {theme === 'dark' ? '亮色模式' : '暗色模式'}
            </button>
            <button onClick={() => setTempChat(v => !v)} className={`inline-flex min-h-11 items-center gap-1 transition-colors ${tempChat ? 'text-amber-500' : 'hover:text-foreground'}`}>
              <EyeOff className="w-3 h-3" />{tempChat ? '临时聊天中' : '临时聊天'}
            </button>
            <button onClick={() => setShowGlobalSearch(true)} className="inline-flex min-h-11 items-center gap-1 hover:text-foreground transition-colors">
              <Search className="w-3 h-3" />全局搜索
            </button>
          </div>
        </div>
      </div>

      {/* Skill Panel */}
      {showSkillPanel && <SkillPanel skills={PRESET_SKILLS} onSelect={selectSkill} onClose={() => setShowSkillPanel(false)} />}

      {/* Agent Panel */}
      {showAgentPanel && (
        <ProjectToolDialog title="Agent 管理" onClose={() => setShowAgentPanel(false)} className="max-w-lg sm:max-w-lg">
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-3 sm:p-4">
            {project.agents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无 Agent，从 Skill 书创建</p>
            ) : (
              <div className="space-y-2">
                {project.agents.map(agent => (
                  <div key={agent.id} className="min-w-0 p-3 rounded-xl border border-border flex items-center gap-3">
                    <span className="shrink-0 text-xl">{agent.emoji || '🤖'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate" title={agent.name}>{agent.name}</div>
                      <div className="text-xs text-muted-foreground truncate" title={agent.description}>{agent.description}</div>
                    </div>
                    <button type="button" onClick={() => onUpdateTask({ ...task, activeAgentId: agent.id })}
                      aria-pressed={task.activeAgentId === agent.id}
                      className={"inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " + (task.activeAgentId === agent.id ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary hover:bg-primary/20')}>
                      使用{task.activeAgentId === agent.id && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" onClick={() => onDeleteAgent(agent.id)} aria-label={"删除 " + agent.name}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ProjectToolDialog>
      )}

      {/* Instructions Panel */}
      {showInstructionsPanel && (
        <ModalOverlay onClose={() => setShowInstructionsPanel(false)}>
          <div role="dialog" aria-label="项目指令" aria-modal="true" className="bg-card border border-border rounded-2xl shadow-2xl w-[calc(100%-2rem)] max-w-xl max-h-[85dvh] min-w-0 overflow-y-auto overscroll-contain p-4 sm:p-6" onClick={e => e.stopPropagation()}>
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
              <button onClick={saveInstructions} className="min-h-11 w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors [.theme-monochrome_&]:bg-[color-mix(in_srgb,var(--primary)_80%,black)]">保存指令</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Knowledge Panel */}
      {showKnowledgePanel && (
        <ProjectToolDialog title="知识库" fallbackFocusRef={chatSettingsButtonRef} onClose={() => setShowKnowledgePanel(false)} className="max-w-xl sm:max-w-xl">
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-3 sm:p-4">
            <p className="text-xs text-muted-foreground mb-4">
              上传文件、添加链接或笔记作为 AI 对话的知识来源。知识内容会自动注入到每次对话的上下文中，让 AI 基于你的资料回答。
            </p>
            {knowledgeError && <p role="alert" className="mb-3 text-xs text-destructive">{knowledgeError}</p>}
            {/* Add buttons */}
            <div className="flex gap-2 mb-4">
              <button onClick={() => setAddingKnowledge('file')} className="min-h-11 min-w-0 flex-1 py-2 rounded-lg border border-border hover:bg-muted text-xs transition-colors">📁 上传文件</button>
              <button onClick={() => setAddingKnowledge('url')} className="min-h-11 min-w-0 flex-1 py-2 rounded-lg border border-border hover:bg-muted text-xs transition-colors">🔗 添加链接</button>
              <button onClick={() => setAddingKnowledge('note')} className="min-h-11 min-w-0 flex-1 py-2 rounded-lg border border-border hover:bg-muted text-xs transition-colors">📝 添加笔记</button>
            </div>
            {/* URL input */}
            {addingKnowledge === 'url' && (
              <div className="mb-4 p-3 rounded-xl border border-border space-y-2">
                <input value={knowledgeUrl} onChange={e => updateKnowledgeDraft({ url: e.target.value })}
                  placeholder="输入网址 https://..." className="min-h-11 w-full bg-transparent text-base px-3 py-2 rounded-lg border border-border outline-none focus:border-primary/50" />
                <div className="flex gap-2">
                  <button onClick={() => addKnowledgeItem({
                    id: Math.random().toString(36).slice(2, 10), projectId: project.id,
                    type: 'url', name: knowledgeUrl, url: knowledgeUrl, tags: [], enabled: true, createdAt: Date.now(), updatedAt: Date.now()
                  })} disabled={!knowledgeUrl} className="min-h-11 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-40">添加</button>
                  <button onClick={() => setAddingKnowledge(null)} className="min-h-11 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted">取消</button>
                </div>
              </div>
            )}
            {/* Note input */}
            {addingKnowledge === 'note' && (
              <div className="mb-4 p-3 rounded-xl border border-border space-y-2">
                <input value={knowledgeNoteName} onChange={e => updateKnowledgeDraft({ noteName: e.target.value })}
                  placeholder="笔记标题" className="min-h-11 w-full bg-transparent text-base px-3 py-2 rounded-lg border border-border outline-none focus:border-primary/50" />
                <textarea value={knowledgeNote} onChange={e => updateKnowledgeDraft({ note: e.target.value })}
                  placeholder="笔记内容..." rows={4} className="w-full bg-transparent text-base px-3 py-2 rounded-lg border border-border outline-none focus:border-primary/50 resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => addKnowledgeItem({
                    id: Math.random().toString(36).slice(2, 10), projectId: project.id,
                    type: 'note', name: knowledgeNoteName || '未命名笔记', textContent: knowledgeNote, tags: [], enabled: true, createdAt: Date.now(), updatedAt: Date.now()
                  })} disabled={!knowledgeNote} className="min-h-11 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-40">添加</button>
                  <button onClick={() => setAddingKnowledge(null)} className="min-h-11 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted">取消</button>
                </div>
              </div>
            )}
            {/* File upload */}
            {addingKnowledge === 'file' && (
              <div className="mb-4 p-3 rounded-xl border border-border text-center">
                <input type="file" onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fileScope = knowledgeFileScopeRef.current;
                  const reader = new FileReader();
                  reader.onload = ev => {
                    if (knowledgeFileScopeRef.current !== fileScope) return;
                    addKnowledgeItem({
                      id: Math.random().toString(36).slice(2, 10), projectId: project.id,
                      type: file.type.startsWith('image/') ? 'image' : 'file',
                      name: file.name, mimeType: file.type,
                      url: ev.target?.result as string, tags: [], enabled: true,
                      createdAt: Date.now(), updatedAt: Date.now()
                    });
                  };
                  reader.readAsDataURL(file);
                }} className="block min-h-11 w-full min-w-0 text-xs file:min-h-11" />
                <button onClick={() => {
                  knowledgeFileScopeRef.current = { scope: knowledgeFileScopeRef.current.scope };
                  setAddingKnowledge(null);
                }} className="mt-2 min-h-11 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted">取消</button>
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
                  <div key={item.id} className="flex min-w-0 items-center gap-2 p-2 rounded-xl border border-border hover:bg-muted/30 transition-colors">
                    <button type="button" onClick={() => toggleKnowledgeItem(item.id)} aria-label={(item.enabled ? '禁用' : '启用') + item.name} aria-pressed={item.enabled}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted">
                      <span className={`flex h-4 w-4 items-center justify-center rounded border-2 ${item.enabled ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>
                        {item.enabled && <span className="h-2 w-2 rounded-sm bg-primary-foreground" />}
                      </span>
                    </button>
                    <span className="text-lg shrink-0">{item.type === 'file' ? '📄' : item.type === 'image' ? '🖼️' : item.type === 'url' ? '🔗' : '📝'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{item.name}</div>
                      <div className="text-[10px] text-muted-foreground flex min-w-0 flex-wrap items-center gap-1 break-all">
                        <span>{item.type === 'file' ? '文件' : item.type === 'image' ? '图片' : item.type === 'url' ? '链接' : '笔记'}</span>
                        {item.type === 'url' && item.url && <span>· {item.url.length > 40 ? item.url.slice(0, 40) + '...' : item.url}</span>}
                        {item.type === 'file' && <span>· {item.mimeType?.split('/')[1] || '未知'} 格式</span>}
                        {item.type === 'image' && <span>· 图片</span>}
                        {item.enabled ? <span className="text-primary">· 将注入上下文</span> : <span className="text-muted-foreground/60">· 已禁用</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => setKnowledgePreview(item)} aria-label={"预览" + item.name}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => removeKnowledgeItem(item.id)} aria-label={"删除" + item.name}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {knowledgePreview && (
            <ProjectToolDialog title={knowledgePreview.name} onClose={() => setKnowledgePreview(null)} className="max-w-lg sm:max-w-lg [&_[data-slot=dialog-title]]:line-clamp-2 [&_[data-slot=dialog-title]]:break-all">
                <p className="shrink-0 px-3 py-2 text-xs text-muted-foreground sm:px-4">{knowledgePreview.type === 'image' ? '🖼️ 图片内容预览' : knowledgePreview.type === 'file' ? '📄 文件内容预览' : knowledgePreview.type === 'url' ? '🔗 URL 链接' : '📝 笔记内容'}</p>
                <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-muted/50 rounded-xl mx-3 p-3 text-sm sm:mx-4">
                  {knowledgePreview.type === 'url' ? (
                    <a href={knowledgePreview.url || knowledgePreview.textContent || ''} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{knowledgePreview.url || knowledgePreview.textContent || ''}</a>
                  ) : knowledgePreview.type === 'image' || (knowledgePreview.url && (knowledgePreview.url.startsWith('data:image/') || knowledgePreview.url.startsWith('blob:'))) ? (
                    <div className="space-y-3">
                      {knowledgePreview.url && (knowledgePreview.url.startsWith('data:image/') || knowledgePreview.url.startsWith('blob:')) ? (
                        <img src={knowledgePreview.url} alt={knowledgePreview.name} className="max-w-full max-h-[50vh] rounded-lg object-contain bg-transparent" />
                      ) : (
                        <p className="text-muted-foreground text-center py-8">暂不支持预览此图片格式</p>
                      )}
                      <div className="text-xs text-muted-foreground space-y-1 break-all">
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
                    <div className="text-xs text-muted-foreground space-y-2 break-all text-center py-4">
                      <p className="text-4xl">📄</p>
                      <p className="font-medium text-foreground">{knowledgePreview.name}</p>
                      {knowledgePreview.mimeType && <p>类型：{knowledgePreview.mimeType}</p>}
                      <p className="text-muted-foreground/60">文件已上传，可在对话中作为知识上下文引用</p>
                    </div>
                  )}
                </div>
                <p className="shrink-0 px-3 py-3 text-xs text-muted-foreground sm:px-4">💡 知识库内容会自动注入到 AI 对话上下文中，帮助 AI 更准确地理解你的需求。</p>
            </ProjectToolDialog>
          )}
        </ProjectToolDialog>
      )}

      {/* Artifacts Panel */}
      {showArtifacts && (
        <div className="absolute right-0 top-0 bottom-0 z-[200] flex min-h-0 min-w-0 w-80 max-w-full flex-col border-l border-border bg-card shadow-xl" data-modal="true">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-sm">Artifacts</h3>
            <button onClick={() => setShowArtifacts(false)} aria-label="关闭 Artifacts 文档" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg p-1 hover:bg-muted"><X className="w-4 h-4" /></button>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2">
            {(() => { const allArtifacts = messages.flatMap(m => m.artifacts || []); return allArtifacts.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">暂无 Artifacts<br />生成代码或文档后自动出现</div>
            ) : allArtifacts.map(a => (
              <div key={a.id} className="bg-muted rounded-xl p-3 border border-border hover:border-primary/30 transition-colors cursor-pointer">
                <div className="flex items-center gap-2 mb-2">
                  {a.type === 'code' ? <FileCode className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-primary" />}
                  <span className="text-xs font-medium truncate flex-1">{a.title}</span>
                </div>
                <pre className="text-[11px] text-muted-foreground line-clamp-4 whitespace-pre-wrap break-all">{a.content}</pre>
              </div>
            ))})()}
          </div>
        </div>
      )}

      {/* Knowledge Preview Modal */}
      {/* Rendered inside its Knowledge Panel so touch dismissal stays nested. */}

      {/* Project Search */}
      {showSearch && (
        <ProjectToolDialog title="项目内搜索" fallbackFocusRef={chatSettingsButtonRef} onClose={() => setShowSearch(false)} className="max-w-md sm:max-w-md">
          <div className="flex min-w-0 shrink-0 gap-2 p-3 sm:p-4">
            <input aria-label="搜索项目消息" value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchResults([]); setSearchSubmitted(false); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleProjectSearch(); } }}
              placeholder="搜索消息内容..."
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-muted px-3 text-base text-foreground outline-none placeholder:text-foreground/80 focus:border-primary/50" />
            <button type="button" onClick={handleProjectSearch} className={"min-h-11 min-w-11 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm " + (theme === "dark" ? "bg-primary text-primary-foreground" : "bg-foreground text-background")}>搜索</button>
          </div>
          <div className="max-h-[60dvh] min-h-0 min-w-0 space-y-2 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-4 sm:pb-4">
            {searchResults.map((r, i) => (
              <button key={i} onClick={() => { if (task && task.id !== r.taskId) onSelectTask(project.tasks.find(t => t.id === r.taskId) || task); setShowSearch(false); }}
                className="min-h-11 w-full min-w-0 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted">
                <div className="break-words text-sm font-medium">{r.taskName}</div>
                <div className="mt-1 line-clamp-2 break-all text-sm text-muted-foreground">{r.snippet}</div>
              </button>
            ))}
            {searchSubmitted && searchResults.length === 0 && <div role="status" className="py-6 text-center text-sm text-muted-foreground">未找到匹配结果</div>}
            {!searchSubmitted && <div className="py-6 text-center text-sm text-muted-foreground">输入关键词后点击搜索或按回车</div>}
          </div>
        </ProjectToolDialog>
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
          onPrepareAiEdit={prepareCanvasAiEdit}
          onAiEdit={canvasAiEdit}
        />
      )}

      {/* 记忆管理面板 */}
      {showMemory && (
        <MemoryPanel
          memories={memories}
          onClose={() => setShowMemory(false)}
          isPending={memoriesLoading}
          onAdd={addMemory}
          onDelete={deleteMemory}
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
          models={chatModels.map(m => ({ id: m.modelId, providerId: m.providerId, providerName: m.providerName, name: m.originalName || m.name, displayName: m.originalName || m.name }))}
          onClose={() => setShowModelCompare(false)}
        />
      )}

      {/* 用量统计 */}
      {showUsageStats && (
        <UsageStats
          fallbackFocusRef={chatSettingsButtonRef}
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
      {workflowReturnConflict && (
        <div role="alert" className="px-4 py-2 bg-primary/5 border-b border-primary/10 text-xs text-muted-foreground shrink-0">
          工作流返回参数存在冲突，未处理。请返回工作流重新发送。
        </div>
      )}
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
    <div className="flex min-w-0 items-center justify-between gap-2 mb-4">
      <h2 className="min-w-0 break-words text-lg font-semibold">{title}</h2>
      <button onClick={onClose} aria-label={`关闭${title}`} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <textarea id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2}
        className="min-h-11 w-full bg-muted text-base px-3 py-2 rounded-lg border border-border outline-none focus:border-primary/50 resize-none placeholder:text-foreground/75" />
    </div>
  );
}


function ProjectToolDialog({ title, onClose, children, className = "", fallbackFocusRef }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  fallbackFocusRef?: React.RefObject<HTMLButtonElement | null>;
}): React.ReactElement {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { const prior = returnFocus.current; const target = prior?.isConnected && prior.getClientRects().length > 0 ? prior : fallbackFocusRef?.current; if (target?.isConnected && target.getClientRects().length > 0) { event.preventDefault(); target.focus(); } }}
        style={{ animation: "none" }}
        className={"flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 flex-col gap-0 overflow-hidden p-0 text-foreground " + className}>
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
          <DialogTitle className="min-w-0 break-words text-base font-semibold">{title}</DialogTitle>
          <button type="button" onClick={onClose} aria-label={"关闭" + title}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function SkillPanel({ skills, onSelect, onClose }: {
  skills: SimpleChatSkill[];
  onSelect: (skill: SimpleChatSkill) => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <ProjectToolDialog title="Skill 书" onClose={onClose} className="max-w-lg sm:max-w-lg">
      <div className="min-h-0 min-w-0 space-y-2 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {skills.map(skill => (
          <button key={skill.id} data-simple-chat-skill-id={skill.id} onClick={() => onSelect(skill)}
            className="flex min-h-11 w-full min-w-0 items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted">
            <span className="shrink-0 text-2xl">{skill.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-medium">{skill.name}</div>
              <div className="break-words text-sm text-muted-foreground">{skill.description}</div>
              <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                {skill.tags.map(t => <span key={t} className="break-all rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t}</span>)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </ProjectToolDialog>
  );
}
