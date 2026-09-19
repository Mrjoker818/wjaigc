'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import AdminTabs, { type AdminGroup as AdminTabsGroup, type AdminProvider as AdminTabsProvider, type AdminUser as AdminTabsUser } from './admin-tabs';
import DataManagerTab from './data-manager-tab';
import DesktopAdminTab from './desktop-admin-tab';
import UserSettingsTab from './user-settings-tab';
import UserCreditsTab from './user-credits-tab';
import MediaGatewayAdmin from './media-gateway-admin';
import { formatPaymentTimestamp } from '@/lib/payment-order-time';
import {
  FolderOpen, Plus, Search, Star, Trash2, MoreVertical, MoreHorizontal, Image,
  Sparkles, LayoutTemplate, Layers, Clock, ChevronRight, ArrowRight,
  Box, Copy, Check, Palette, Type, BookOpen,
  LogOut, Shield, X, Eye, Mail, Calendar, KeyRound, Zap, Pencil, EyeOff, Key, Link2, Bot, Edit3, Save, Info,
  // Admin/User management icons
  UserPlus, Ban, CheckCircle2, CheckCircle, Plug, RefreshCw, Activity, Wallet,
  Loader2, Settings, ChevronDown, ShieldCheck, AlertTriangle, AlertCircle, DollarSign,
  ArrowUp, ArrowDown, ShoppingBag, Users, Server, Database,
  XCircle, BarChart3, Upload, RotateCcw, Film, CreditCard,
  // Asset library icons
  LayoutGrid, List, ArrowUpDown, CheckSquare, Download, Square,
  Grid3X3, ZoomIn,
  // Admin prototype icons
  LayoutDashboard, Flame, Coins, TrendingUp, TrendingDown,
  SlidersHorizontal, HardDrive, Megaphone,
  Brain, Link, Lock, LogIn, ChevronLeft, Globe2, ListChecks, MessageSquareMore, Share2,
} from 'lucide-react';
import { UserManager } from '@/lib/user-manager';
import { RECHARGE_PACKAGES } from '@/lib/credits-constants';
import type { Project, CanvasImage, User, UsageStats } from '@/lib/user-types';
import { ConfirmDialog } from '@/components/custom-dialogs';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import {
  getConfiguredModelsForProvider,
  resolveModelAuthorizationNamespace,
} from '@/lib/model-type-classification';
import { getModelDisplayName } from '@/lib/model-name-map';
import { loadSimpleChatDashboardProjects } from '@/lib/simple-chat-sync-client';
import { createIndexedDbSimpleChatEnvelopeStore } from '@/lib/simple-chat-sync-storage';
import { reconcileImageBatchDeletion } from '@/lib/asset-core/batch-placement-delete';
import {
  buildCapabilityEditorModels,
  ModelCapabilityEditor,
  getVisibleAdvancedParams,
  mergeAdvancedParamsWithCapabilities,
} from './model-capability-editor';
import type { ProviderCapabilityOverridesV1 } from '@/lib/task-core/model-capability-contract';
import { readProviderCapabilityOverrides } from '@/lib/task-core/model-capability-resolution';
import JSZip from 'jszip';
import { CanvasShareManagePanel } from '@/components/canvas-share/manage-panel';

type TabType = 'projects' | 'templates' | 'assets' | 'stats' | 'credits' | 'settings' | 'users' | 'apis' | 'data' | 'ecom-templates' | 'payment-config' | 'audit' | 'overview' | 'desktop-admin' | 'connector-admin' | 'groups' | 'chat' | 'media-gateway';
type ProjectFilter = 'all' | 'recent' | 'starred';
type AssetSubTab = 'images' | 'prompts' | 'brands';
type ApiKind = 'general' | 'image' | 'chat' | '3d' | 'vectorize' | 'layer' | 'video' | 'vlm' | 'upscaler' | 'removebg' | 'universal' | 'audio';
type UserPermissionKey = 'image' | 'chat' | 'threeD' | 'vectorize' | 'layer' | 'video' | 'vlm' | 'upscaler' | 'removebg' | 'audio';
type AdminProvider = ApiProvider & { apiKeyPreview?: string; displayName?: string; compatProfile?: string };
type DashboardImage = CanvasImage & {
  negativePrompt?: string;
  _projectId?: string;
  assetId?: string;
  placementId?: string;
  mediaAvailability?: 'ready' | 'pending-persist' | 'missing' | 'recovering' | 'unrecoverable';
};

interface ApiBalanceEntry { providerId?: string; balance?: number | string; currency?: string; remainingQuota?: number | string; error?: string; }
interface ApiBalanceResponse { success?: boolean; error?: string; balances?: ApiBalanceEntry[]; }
interface VerifyProtocolResponse { success?: boolean; detected?: string; summary?: string; message?: string; profile?: { id?: string }; tests?: Array<{ name: string; status: string; detail: string }>; }
interface ConnectorHealth {
  success?: boolean;
  name?: string;
  version?: string;
  authRequired?: boolean;
  capabilities?: Record<string, boolean>;
  hosts?: { photoshopCep?: boolean; illustratorCep?: boolean };
}
interface ConnectorPreflight { success?: boolean; recommended?: { defaultRenderMode?: string }; checks?: Record<string, unknown>[]; renderModes?: Record<string, unknown>[]; }
interface ConnectorStatus {
  dcc: ConnectorHealth | null;
  dccPreflight: ConnectorPreflight | null;
  dccTemplates: Record<string, unknown>[];
  creative: ConnectorHealth | null;
  psTemplates: Record<string, unknown>[];
  aiTemplates: Record<string, unknown>[];
  loading: boolean;
  error?: string;
}
interface CloudTaskMonitorRow {
  id: string;
  userId: string;
  type: string;
  status: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  progress: number;
  label?: string;
  error?: string;
  updatedAt: number;
  requestId?: string;
  handlerVersion?: string;
  requestedProviderId?: string;
  requestedModelId?: string;
  actualProviderId?: string;
  actualModelId?: string;
  durationMs?: number;
  errorSource?: string;
  billing?: {
    status?: string;
    cost?: number;
    chargedTransactionId?: string | null;
    refundedTransactionId?: string | null;
  };
}
function errorMessage(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function objectValue(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function connectorHealth(value: unknown): ConnectorHealth | null {
  const data = objectValue(value);
  if (!data) return null;
  return {
    success: typeof data.success === 'boolean' ? data.success : undefined,
    name: typeof data.name === 'string' ? data.name : undefined,
    version: typeof data.version === 'string' ? data.version : undefined,
    authRequired: typeof data.authRequired === 'boolean' ? data.authRequired : undefined,
    capabilities: objectValue(data.capabilities) as Record<string, boolean> | undefined,
    hosts: (() => {
      const hosts = objectValue(data.hosts);
      return hosts ? {
        photoshopCep: typeof hosts.photoshopCep === 'boolean' ? hosts.photoshopCep : undefined,
        illustratorCep: typeof hosts.illustratorCep === 'boolean' ? hosts.illustratorCep : undefined,
      } : undefined;
    })(),
  };
}
function connectorPreflight(value: unknown): ConnectorPreflight | null {
  const data = objectValue(value);
  if (!data) return null;
  return {
    success: typeof data.success === 'boolean' ? data.success : undefined,
    recommended: objectValue(data.recommended) as ConnectorPreflight['recommended'],
    checks: Array.isArray(data.checks) ? data.checks.filter((item): item is Record<string, unknown> => objectValue(item) !== null) : [],
    renderModes: Array.isArray(data.renderModes) ? data.renderModes.filter((item): item is Record<string, unknown> => objectValue(item) !== null) : [],
  };
}
function connectorTemplates(value: unknown): Record<string, unknown>[] {
  const data = objectValue(value);
  return Array.isArray(data?.templates) ? data.templates.filter((item): item is Record<string, unknown> => objectValue(item) !== null) : [];
}
export interface DashboardModelOption {
  id: string;
  name: string;
  providerId: string;
}

function modelIdFromExactAssignment(assignment: string): string {
  const separatorIndex = assignment.indexOf('::');
  return separatorIndex >= 0 ? assignment.slice(separatorIndex + 2) : assignment;
}

export function providerModelOptions(
  models: string[] | undefined,
  providerId: string,
  providerName: string,
): DashboardModelOption[] {
  return (models ?? []).map((model) => ({
    id: `${providerId}::${model}`,
    name: `${model} · ${providerName}`,
    providerId,
  }));
}

export function buildDashboardModelAuthorizationOptions(
  providers: ApiProvider[],
): {
  chatModels: DashboardModelOption[];
  imageModels: DashboardModelOption[];
} {
  const chatModels: DashboardModelOption[] = [];
  const imageModels: DashboardModelOption[] = [];
  for (const provider of providers) {
    if (provider.isEnabled === false) continue;
    const providerName = provider.displayName || provider.name || provider.id;
    for (const model of getConfiguredModelsForProvider(provider)) {
      const option = providerModelOptions([model.id], provider.id, providerName)[0];
      const authorizationNamespace = resolveModelAuthorizationNamespace(model.type);
      if (authorizationNamespace === 'chat') chatModels.push(option);
      if (authorizationNamespace === 'image') imageModels.push(option);
    }
  }
  return { chatModels, imageModels };
}

function resolveVisibleModelAssignments(
  assignments: string[] | undefined,
  options: DashboardModelOption[],
): string[] | undefined {
  if (!assignments) return undefined;
  const optionsByModelId = new Map<string, string[]>();
  for (const option of options) {
    const modelId = modelIdFromExactAssignment(option.id);
    const candidates = optionsByModelId.get(modelId) || [];
    candidates.push(option.id);
    optionsByModelId.set(modelId, candidates);
  }

  return assignments.flatMap(assignment => {
    if (assignment.includes('::')) {
      return [assignment];
    }
    const candidates = optionsByModelId.get(assignment) || [];
    return candidates.length === 1 ? candidates : [assignment];
  });
}

export function normalizeModelAssignmentsForSave(
  assignments: string[],
  options: DashboardModelOption[],
): string[] {
  const visibleExactIds = new Set(options.map(option => option.id));
  const replacedBareIds = new Set(
    assignments
      .filter(assignment => assignment.includes('::') && visibleExactIds.has(assignment))
      .map(modelIdFromExactAssignment),
  );
  const result: string[] = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    if (!assignment.includes('::') && replacedBareIds.has(assignment)) continue;
    if (seen.has(assignment)) continue;
    seen.add(assignment);
    result.push(assignment);
  }
  return result;
}

const apiKindLabels: Record<ApiKind, string> = {
  general: '通用模型',
  image: '图像模型',
  chat: 'LLM 模型',
  '3d': '3D 模型',
  vectorize: '矢量模型',
  layer: '图片分层模型',
  video: '视频模型',
  vlm: 'VLM视觉模型',
  upscaler: '放大模型',
  removebg: '去背景模型',
  universal: '通用模型',
  audio: '音频/TTS模型',
};

const apiKindDescriptions: Record<ApiKind, string> = {
  general: '选择此类型后自动识别并显示当前API的所有模型，不按类型过滤',
  image: '支持自动识别模型，管理员选择后对接到图像生成功能',
  chat: '支持自动识别模型，管理员选择后对接到AI聊天功能',
  '3d': '支持自动识别模型，管理员选择后对接到一键转3D功能',
  vectorize: '添加API后系统自动识别 vectorize 模型，对接到矢量化工具和导出SVG',
  layer: '添加API后系统自动识别 qwen-image-layered 模型，对接到编辑元素和下载PSD',
  video: '添加API后系统自动识别视频模型（可灵/Seedance/海螺/Vidu/Runway/Pika/Sora等），对接到文生视频和图生视频功能',
  vlm: '视觉语言模型，支持图片理解和SVG生成，自动识别 qwen-vl/glm-4v/gemini-vision 等模型，对接到SVG矢量化功能',
  upscaler: '自动识别 SeedVR2/Real-ESRGAN 等放大模型，对接到无损放大Pro功能，支持 PearAPI / fal.ai 等提供商',
  removebg: '自动识别 BiRefNet/U2Net/ISNet/RMBG 等去背景模型，一键抠图输出透明PNG',
  universal: '通用模型，支持多种能力',
  audio: '添加API后系统自动识别tts/speech/audio模型，对接到AI配音、视频音效和文生语音功能',
};

const userPermissionLabels: Record<UserPermissionKey, string> = {
  image: '图像',
  chat: 'LLM',
  threeD: '3D',
  vectorize: '矢量',
  layer: '分层',
  video: '视频',
  vlm: 'VLM',
  upscaler: '放大',
  removebg: '抠图',
  audio: '音频',
};

interface DashboardViewProps {
  user: User;
  onOpenProject: (project: Project) => void;
  onNewProject: () => void;
  onLogout?: () => void;
  isMonochrome?: boolean;
  onSetIsMonochrome?: (value: boolean) => void;
  onSetFavoriteParams?: (params: { prompt: string; model?: string; aspectRatio?: string; quality?: string; negativePrompt?: string }) => void;
}

interface PromptEntry {
  text: string;
  model: string;
  projectName: string;
}

export default function DashboardView({ user, onOpenProject, onNewProject, onLogout, isMonochrome, onSetIsMonochrome, onSetFavoriteParams }: DashboardViewProps) {
  const isAdmin = user.role === 'admin';

  // ─── Navigation state ───
  // Chat-only users start on chat tab, others on projects
  const defaultTab: TabType = (user.productType?.includes('chat') && !user.productType?.includes('canvas')) ? 'chat' : 'projects';
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);
  const [desktopAdminData, setDesktopAdminData] = useState<{
    devices: Record<string, unknown>[];
    backups: Record<string, unknown>[];
    resources: Record<string, unknown>[];
    records: Record<string, unknown>[];
    updateConfig?: Record<string, unknown>;
  }>({ devices: [], backups: [], resources: [], records: [] });
  const [desktopAdminLoading, setDesktopAdminLoading] = useState(false);
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatus>({ dcc: null, dccPreflight: null, dccTemplates: [], creative: null, psTemplates: [], aiTemplates: [], loading: false });
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [assetTab, setAssetTab] = useState<AssetSubTab>('images');
  const [imageFilter, setImageFilter] = useState<'all' | 'generated' | 'uploaded'>('all');
  // Asset library enhanced state
  const [assetViewMode, setAssetViewMode] = useState<'grid' | 'list'>('grid');
  const [assetSortOrder, setAssetSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [assetManageMode, setAssetManageMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [assetCopiedId, setAssetCopiedId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [shareManagementProject, setShareManagementProject] = useState<Project | null>(null);
  const [projectManageMode, setProjectManageMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [projectDeleteLoading, setProjectDeleteLoading] = useState(false);
  const [projectRevision, setProjectRevision] = useState(0);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('wujie-starred-projects') || '[]')); } catch { return new Set(); }
  });
  const [copiedIdx, setCopiedIdx] = useState<string | number | null>(null);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ─── Admin: User management state ───
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [resetPwdUser, setResetPwdUser] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmDlg, setConfirmDlg] = useState<{ open: boolean; title: string; message: string; variant?: 'danger' | 'warning'; onConfirm: () => void; onCancel: () => void }>({ open: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {} });

  // ─── Admin: API management state ───
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [providersLoadError, setProvidersLoadError] = useState<string | null>(null);
  const [apiName, setApiName] = useState('');
  const [apiDisplayName, setApiDisplayName] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [compatProfile, setCompatProfile] = useState('auto');
  const [apiKind, setApiKind] = useState<ApiKind>('image');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [balanceUsername, setBalanceUsername] = useState('');
  const [balancePassword, setBalancePassword] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [advancedParams, setAdvancedParams] = useState<Array<{ key: string; value: string }>>([]);
  const [taskModelCapabilities, setTaskModelCapabilities] = useState<ProviderCapabilityOverridesV1>({ version: 1, models: {} });
  
  // ─── Admin: Group management state ───
  const [adminGroups, setAdminGroups] = useState<Array<{ id: string; name: string; product_types: string[]; credit_quota: number; is_active: boolean; created_at: number; updated_at: number }>>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupProductTypes, setNewGroupProductTypes] = useState<string[]>(['canvas']);

  // ─── Chat projects state ───
  const [chatProjects, setChatProjects] = useState<Array<{ id: string; name: string; emoji: string; taskCount: number; updatedAt: number }>>([]);
  const [newGroupCreditQuota, setNewGroupCreditQuota] = useState(0);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupProductTypes, setEditGroupProductTypes] = useState<string[]>([]);
  const [editGroupCreditQuota, setEditGroupCreditQuota] = useState(0);
  const [editGroupActive, setEditGroupActive] = useState(true);
  const [groupMenuOpenId, setGroupMenuOpenId] = useState<string | null>(null);
  
  // 模型搜索筛选计算
  const filteredModels = useMemo(() => {
    if (!modelSearchQuery.trim()) return discoveredModels;
    const query = modelSearchQuery.toLowerCase();
    return discoveredModels.filter(m => 
      (m.displayName || m.name || m.id).toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query)
    );
  }, [discoveredModels, modelSearchQuery]);
  
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [providerTestStatus, setProviderTestStatus] = useState<Record<string, { testing: boolean; success: boolean | null; message: string; modelCount: number }>>({});
  const [isTestingNew, setIsTestingNew] = useState(false);
  const [testNewResult, setTestNewResult] = useState<{ success: boolean; message: string; modelCount?: number; error?: string } | null>(null);
  // 抽屉内验证/余额结果
  const [drawerVerifyResult, setDrawerVerifyResult] = useState<{ success: boolean; checks?: { models: boolean; imageGen: boolean; chat: boolean }; detected?: string; message?: string; tests?: Array<{ name: string; status: string; detail: string; endpoint?: string; latencyMs?: number }> } | null>(null);
  const [drawerBalanceResult, setDrawerBalanceResult] = useState<{ success: boolean; message: string; balance?: number; currency?: string } | null>(null);
  const [isVerifyingDrawer, setIsVerifyingDrawer] = useState(false);
  const [isQueryingBalanceDrawer, setIsQueryingBalanceDrawer] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ providerId: string; success: boolean; summary: string; tests: Array<{ name: string; status: string; detail: string }> } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [apiBalances, setApiBalances] = useState<Array<{
    providerId: string; providerName: string; providerType: string; baseUrl: string;
    balance: number | null; currency: string; totalQuota: number | null;
    usedQuota: number | null; remainingQuota: number | null;
    totalUsage: number; dailyUsage: number;
    lastUpdated: string; error?: string; endpoint?: string;
  }>>([]);
  const [cloudTasks, setCloudTasks] = useState<CloudTaskMonitorRow[]>([]);
  const [cloudTasksLoading, setCloudTasksLoading] = useState(false);
  const [cloudTasksError, setCloudTasksError] = useState<string | null>(null);
  const [providerTaskSummary, setProviderTaskSummary] = useState<Record<string, { total: number; processing: number; failed: number }>>({});
  const [productionReadiness, setProductionReadiness] = useState<{
    success: boolean;
    database: { status: 'pass' | 'warn' | 'fail'; detail: string };
    summary: { total: number; enabled: number; ready: number; warnings: number; failures: number };
    providers: Array<{ id: string; name: string; modelType: string; status: 'pass' | 'warn' | 'fail'; issues: string[] }>;
  } | null>(null);
  const [productionReadinessLoading, setProductionReadinessLoading] = useState(false);
  const [productionReadinessLoadError, setProductionReadinessLoadError] = useState<string | null>(null);
  // API management UI state
  const [apiFilterType, setApiFilterType] = useState<ApiKind | 'all'>('all');
  const [apiFilterStatus, setApiFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [apiSearchQuery, setApiSearchQuery] = useState('');
  const [showApiDrawer, setShowApiDrawer] = useState(false);
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set());
  const [apiBatchLoading, setApiBatchLoading] = useState(false);
  const [refreshingProviderIds, setRefreshingProviderIds] = useState<Set<string>>(new Set());
  const [moreMenuProviderId, setMoreMenuProviderId] = useState<string | null>(null);
  // 子模型编辑弹窗
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelInfo | null>(null);
  const [modelFormName, setModelFormName] = useState('');
  const [modelFormId, setModelFormId] = useState('');
  const [modelFormContext, setModelFormContext] = useState('');

  // ─── Admin: User management enhanced state ───
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userFilterStatus, setUserFilterStatus] = useState<'all' | 'active' | 'disabled'>('all');
  const [userFilterRole, setUserFilterRole] = useState<'all' | 'admin' | 'user'>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [userDetailId, setUserDetailId] = useState<string | null>(null);
  const [userDetailCredits, setUserDetailCredits] = useState<{ balance: number; totalRecharged: number; totalUsed: number } | null>(null);
  const [userDetailTransactions, setUserDetailTransactions] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }>>([]);
  const [showUserDrawer, setShowUserDrawer] = useState(false);
  const [showUserAddDrawer, setShowUserAddDrawer] = useState(false);

  // ─── Admin: System settings state ───
  const [systemSettings, setSystemSettings] = useState<{
    defaultImageModel: string; defaultChatModel: string; maxConcurrentTasks: number; imageMaxSizeMB: number; announcement: string;
  }>({ defaultImageModel: '', defaultChatModel: '', maxConcurrentTasks: 15, imageMaxSizeMB: 20, announcement: '' });

  // ─── Admin: Credits management enhanced state ───
  const [creditsSubTab, setCreditsSubTab] = useState<'overview' | 'consumption' | 'stats' | 'packages'>('overview');
  const [creditsConsumptionData, setCreditsConsumptionData] = useState<Array<{ userId: string; userName: string; model: string; credits: number; type: string; createdAt: number }>>([]);

  // ─── Admin: Audit log state ───
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; userId: string; userName: string; action: string; targetType: string | null; targetId: string | null; detail: string | null; ipAddress: string | null; createdAt: number }>>([]);
  const [auditStats, setAuditStats] = useState<{ totalActions: number; todayActions: number; uniqueUsers: number; actionBreakdown: Record<string, number>; todayCount?: number; weekCount?: number; totalCount?: number; } | null>(null);
  const [auditFilterAction, setAuditFilterAction] = useState<string>('all');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);

  // ─── Admin: Dashboard overview state ───
  const [dashboardStats, setDashboardStats] = useState<{
    totalUsers: number; activeUsersToday: number; activeUsersWeek: number; activeUsersMonth: number;
    totalCreditsRecharged: number; totalCreditsConsumed: number;
    newUsersToday: number; newUsersWeek: number; newUsersMonth: number;
    totalProviders?: number; activeProviders?: number; todayActive?: number;
  } | null>(null);

  // ─── Admin: Data management state ───
  const [selectedDataUser, setSelectedDataUser] = useState<string | null>(null);
  const [userDataKeys, setUserDataKeys] = useState<{ dataKey: string; updatedAt: number }[]>([]);
  const [viewingDataKey, setViewingDataKey] = useState<string | null>(null);
  const [viewingDataValue, setViewingDataValue] = useState<unknown>(null);
  const [viewingDataLoading, setViewingDataLoading] = useState(false);
  const [dataSubTab, setDataSubTab] = useState<'kv' | 'images'>('images');
  const [userImages, setUserImages] = useState<Array<{ id: string; url: string; prompt: string; model: string; quality: string; aspectRatio: string; createdAt: string; duration: number | null; projectName: string; size: string | null; source: string }>>([]);
  const [userImagesLoading, setUserImagesLoading] = useState(false);
  const [imageSourceFilter, setImageSourceFilter] = useState<'all' | 'generated' | 'uploaded'>('all');
  const [imageDetailId, setImageDetailId] = useState<string | null>(null);

  // ─── Credits state ───
  const [creditsBalance, setCreditsBalance] = useState(0);
  const [creditsTotalRecharged, setCreditsTotalRecharged] = useState(0);
  const [creditsTotalUsed, setCreditsTotalUsed] = useState(0);
  const [creditsTransactions, setCreditsTransactions] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }>>([]);
  const [rechargeAmount, setRechargeAmount] = useState<number | ''>('');
  const [selectedPkgAmount, setSelectedPkgAmount] = useState<number | null>(null);
  const [isRecharging, setIsRecharging] = useState(false);
  const [rechargeError, setRechargeError] = useState('');
  // Payment flow state
  const [paymentStep, setPaymentStep] = useState<'select' | 'paying' | 'success'>('select');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'alipay' | 'wechat'>('wechat');
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingOrderAmount, setPendingOrderAmount] = useState(0);
  const [paymentPolling, setPaymentPolling] = useState(false);
  const [qrCountdown, setQrCountdown] = useState(60);
  const [qrRefreshKey, setQrRefreshKey] = useState(0);
  // Payment config state (admin) — personal QR code mode
  const [paymentConfig, setPaymentConfig] = useState<{
    wechatQrUrl: string;
    alipayQrUrl: string;
    wechatPayLink?: string;
    alipayPayLink?: string;
  }>({ wechatQrUrl: '', alipayQrUrl: '', wechatPayLink: '', alipayPayLink: '' });
  const [paymentStatus, setPaymentStatus] = useState<{ alipay: boolean; wechat: boolean; qrUrls?: { wechat: string; alipay: string }; note?: string }>({ alipay: false, wechat: false });
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaveMsg, setConfigSaveMsg] = useState<string | null>(null);
  // Admin pending orders
  const [auditOrders, setAuditOrders] = useState<Array<{ id: string; userId: string; userName: string; amount: number; priceCny: number; bonus: number; paymentMethod: string; status: string; createdAt?: unknown; paidAt?: unknown; updatedAt?: unknown }>>([]);
  const [creditsPricing, setCreditsPricing] = useState<{
    creditsToCNY: number;
    cnyToCredits: number;
    imageModels: Record<string, { credits: number; label: string; cny: string }>;
    videoModels: Record<string, { creditsPerSecond: number; label: string; cnyPerSecond: string }>;
    chatModels: Record<string, { creditsPerCall: number; label: string; cny: string }>;
    rechargePackages: { amount: number; bonus: number; label: string; price: number; popular?: boolean }[];
  } | null>(null);
  const [showPricingRef, setShowPricingRef] = useState(false);
  // Admin credits state
  const [creditsUsers, setCreditsUsers] = useState<Array<{ userId: string; userName: string; balance: number; totalRecharged: number; totalUsed: number }>>([]);
  const [selectedCreditsUser, setSelectedCreditsUser] = useState<string | null>(null);
  const [creditsUserTransactions, setCreditsUserTransactions] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }>>([]);
  const [adminRechargeAmount, setAdminRechargeAmount] = useState<number | ''>('');
  const [adminRechargeDesc, setAdminRechargeDesc] = useState('');
  const [isAdminRecharging, setIsAdminRecharging] = useState(false);
  const [creditsLoading, setCreditsLoading] = useState(false);

  // ─── Load payment config & status (admin) ───
  // Load payment config (admin) and payment status (all users)
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        // All users need payment status (for QR code display)
        const statusRes = await fetch('/api/credits/payment-status', { signal: ac.signal });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.success) setPaymentStatus(statusData.status);
        }
        // Admin also needs full config
        if (isAdmin) {
          const configRes = await fetch('/api/credits/payment-config', { signal: ac.signal });
          if (configRes.ok) {
            const configData = await configRes.json();
            if (configData.success && configData.config) {
              setPaymentConfig({
                wechatQrUrl: configData.config.wechatQrUrl || '',
                alipayQrUrl: configData.config.alipayQrUrl || '',
              });
            }
          }
        }
      } catch { /* ignore */ }
    })();
    return () => ac.abort();
  }, [isAdmin]);

  // ─── QR Code countdown & auto-refresh (60s) ───
  useEffect(() => {
    if (paymentStep !== 'paying') {
      setQrCountdown(60);
      return;
    }
    setQrCountdown(60);
    const timer = setInterval(() => {
      setQrCountdown(prev => {
        if (prev <= 1) {
          setQrRefreshKey(k => k + 1); // refresh QR
          return 60; // reset countdown
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [paymentStep, qrRefreshKey]);

  // ─── Admin: Ecom template state ───
  const [ecomTemplates, setEcomTemplates] = useState<Array<Record<string, unknown>>>([]);
  const [editingEcomTpl, setEditingEcomTpl] = useState<Record<string, unknown> | null>(null);
  const [isEcomTplSaving, setIsEcomTplSaving] = useState(false);
  const [showNewEcomTpl, setShowNewEcomTpl] = useState(false);

  // ─── Theme vars ───
  const isDark = !isMonochrome; // 单色模式用浅色主题，默认深色
  const accentHex = isMonochrome ? '#3b82f6' : '#d4af37';
  const accentColor = accentHex;
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const accentBgLight = isMonochrome ? 'bg-[#3b82f6]/10' : isDark ? 'bg-[#d4af37]/15' : 'bg-[#d4af37]/10';
  const accentClass = isMonochrome ? 'text-[#3b82f6]' : 'text-[#d4af37]';
  const accentBgClass = isMonochrome ? 'bg-[#3b82f6]' : 'bg-[#d4af37]';
  const accentHoverBgClass = isMonochrome ? 'hover:bg-[#2563eb]' : 'hover:bg-[#e0b840]';
  const accentBorderClass = isMonochrome ? 'border-[#3b82f6]' : 'border-[#d4af37]';
  const accentTextOnBgClass = isMonochrome ? 'text-white' : 'text-black';
  const accentRingClass = isMonochrome ? 'focus:ring-[#3b82f6]/30' : 'focus:ring-[#d4af37]/30';
  const accentShadowClass = isMonochrome ? 'hover:shadow-[#3b82f6]/5' : 'hover:shadow-[#d4af37]/5';
  const accentHoverBorderClass = isMonochrome ? 'hover:border-[#3b82f6]/30' : 'hover:border-[#d4af37]/30';
  // Admin styling
  const softClass = isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-gray-50 border-gray-200';
  const inputClass = isDark ? 'bg-white/5 border-white/10 text-white placeholder:text-[#555]' : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400';
  const labelClass = `block text-xs font-medium mb-1.5 ${isDark ? 'text-[#b8b8b8]' : 'text-gray-600'}`;
  // Credits-specific styling
  const cardBg = isDark ? 'bg-[#1a1a2e]/80' : 'bg-white';
  const borderColor = isDark ? 'border-primary/20' : 'border-gray-200';
  const inputBg = isDark ? 'bg-white/5' : 'bg-gray-50';

  const toggleSelectProvider = useCallback((pid: string) => {
    setSelectedProviderIds(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }, []);

  // ─── Project data ───
  const mgr = UserManager.getInstance();
  const projects = useMemo(() => mgr.getProjects(), [mgr, projectRevision]);
  const statsArr: UsageStats[] = mgr.getUsageStats();
  const stats: UsageStats | null = statsArr.length > 0 ? statsArr[statsArr.length - 1] : null;

  const allImages = useMemo(() => {
    const imgs: (CanvasImage & { projectName: string; _projectId: string })[] = [];
    projects.forEach((p: Project) => {
      (p.canvasImages || []).forEach((img: CanvasImage) => {
        imgs.push({ ...img, projectName: p.name, _projectId: p.id });
      });
    });
    return imgs;
  }, [projects]);

  const allPrompts: PromptEntry[] = useMemo(() => {
    const prompts: PromptEntry[] = [];
    const seen = new Set<string>();
    projects.forEach((p: Project) => {
      (p.canvasImages || []).forEach((img: CanvasImage) => {
        if (img.prompt && !seen.has(img.prompt)) {
          seen.add(img.prompt);
          prompts.push({ text: img.prompt, model: img.model || '', projectName: p.name });
        }
      });
    });
    return prompts;
  }, [projects]);

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => { setNowTs(Date.now()); }, []);

  const recentActivity = useMemo(() => {
    if (!nowTs) return [];
    function fmtTimeAgo(date: string | number | undefined): string {
      if (!date) return '无时间记录';
      const then = new Date(date).getTime();
      const diff = nowTs - then;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
      return `${Math.floor(diff / 86400000)} 天前`;
    }
    // 智能排序：有图片的项目优先，然后按更新时间倒序，空项目沉底
    return [...projects]
      .sort((a, b) => {
        const aImgs = (a.canvasImages || []).length;
        const bImgs = (b.canvasImages || []).length;
        if ((aImgs > 0) !== (bImgs > 0)) return aImgs > 0 ? -1 : 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      })
      .slice(0, 4)
      .map(p => ({
        id: p.id,
        name: p.name,
        time: fmtTimeAgo(p.updatedAt),
        imageCount: (p.canvasImages || []).length,
      }));
  }, [projects, nowTs]);

  const filteredProjects = useMemo(() => {
    let list = [...projects];
    if (searchQuery) list = list.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    // 智能排序：有图项目优先，空项目沉底
    list = list.sort((a, b) => {
      const aImgs = (a.canvasImages || []).length;
      const bImgs = (b.canvasImages || []).length;
      if ((aImgs > 0) !== (bImgs > 0)) return aImgs > 0 ? -1 : 1;
      if (projectFilter === 'recent') {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    if (projectFilter === 'recent') list = list.slice(0, 8);
    if (projectFilter === 'starred') list = list.filter(p => starredIds.has(p.id));
    return list;
  }, [projects, searchQuery, projectFilter, starredIds]);

  const filteredImages = useMemo(() => {
    let result = imageFilter === 'all' ? allImages : imageFilter === 'generated' ? allImages.filter(i => i.model) : allImages.filter(i => !i.model);
    // Sort by time
    result = [...result].sort((a, b) => {
      const ta = a.createdAt || 0;
      const tb = b.createdAt || 0;
      return assetSortOrder === 'newest' ? tb - ta : ta - tb;
    });
    return result;
  }, [allImages, imageFilter, assetSortOrder]);
  const unavailableAssetCount = useMemo(
    () => allImages.filter((image) => (
      image.mediaAvailability === 'missing' || image.mediaAvailability === 'recovering' || image.mediaAvailability === 'unrecoverable'
    )).length,
    [allImages],
  );

  // ─── Project handlers ───
  const toggleStar = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem('wujie-starred-projects', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确定删除此项目？此操作不可恢复。')) return;
    try {
      const deleted = await mgr.deleteProject(id);
      if (!deleted) {
        toast.error('项目不存在或已被删除');
        return;
      }
      setSelectedProjectIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setStarredIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        localStorage.setItem('wujie-starred-projects', JSON.stringify([...next]));
        return next;
      });
      setProjectRevision(revision => revision + 1);
      toast.success('项目已删除');
    } catch (error) {
      toast.error(errorMessage(error, '删除项目失败'));
    } finally {
      setMenuOpenId(null);
    }
  }, [mgr]);

  const toggleProjectSelection = useCallback((id: string) => {
    setSelectedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllProjects = useCallback(() => {
    setSelectedProjectIds(prev => {
      const next = new Set(prev);
      const visibleIds = filteredProjects.map(project => project.id);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => next.has(id));
      visibleIds.forEach(id => allVisibleSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }, [filteredProjects]);

  const exitProjectManageMode = useCallback(() => {
    setProjectManageMode(false);
    setSelectedProjectIds(new Set());
  }, []);

  const handleBatchDeleteProjects = useCallback(() => {
    if (selectedProjectIds.size === 0 || projectDeleteLoading) return;
    setConfirmDlg({
      open: true,
      title: '批量删除项目',
      message: `确定删除选中的 ${selectedProjectIds.size} 个项目吗？此操作不可恢复。`,
      variant: 'danger',
      onConfirm: async () => {
        setProjectDeleteLoading(true);
        try {
          const result = await mgr.deleteProjects(Array.from(selectedProjectIds));
          if (result.deletedIds.length === 0) {
            toast.error('所选项目不存在或已被删除');
            return;
          }
          const deletedSet = new Set(result.deletedIds);
          setStarredIds(prev => {
            const next = new Set([...prev].filter(id => !deletedSet.has(id)));
            localStorage.setItem('wujie-starred-projects', JSON.stringify([...next]));
            return next;
          });
          setSelectedProjectIds(new Set());
          setProjectManageMode(false);
          setProjectRevision(revision => revision + 1);
          if (result.skippedIds.length > 0) {
            toast.warning(`已删除 ${result.deletedIds.length} 个项目，跳过 ${result.skippedIds.length} 个无效项目`);
          } else {
            toast.success(`已删除 ${result.deletedIds.length} 个项目`);
          }
        } catch (error) {
          toast.error(errorMessage(error, '批量删除项目失败'));
        } finally {
          setProjectDeleteLoading(false);
          setConfirmDlg(dialog => ({ ...dialog, open: false }));
        }
      },
      onCancel: () => setConfirmDlg(dialog => ({ ...dialog, open: false })),
    });
  }, [mgr, projectDeleteLoading, selectedProjectIds]);

  const handleUseTemplate = useCallback((template: { name: string }) => {
    const newProject = mgr.createProject(template.name);
    onOpenProject(newProject);
  }, [mgr, onOpenProject]);

  const handleCopyPrompt = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }, []);

  // Copy full image info (prompt + params)
  const handleCopyImageInfo = useCallback((img: DashboardImage) => {
    const parts: string[] = [];
    if (img.prompt) parts.push(img.prompt);
    if (img.negativePrompt) parts.push(`反向提示词: ${img.negativePrompt}`);
    if (img.modelName || img.model) parts.push(`模型: ${img.modelName || img.model}`);
    if (img.aspectRatio) parts.push(`比例: ${img.aspectRatio}`);
    if (img.quality) parts.push(`质量: ${img.quality}`);
    if (img.apiProvider) parts.push(`提供商: ${img.apiProvider}`);
    if (img.size) parts.push(`尺寸: ${img.size}`);
    navigator.clipboard.writeText(parts.join('\n')).then(() => {
      setCopiedIdx(img.id);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  }, []);

  // Make same: open project and inject params
  const handleMakeSame = useCallback((img: DashboardImage) => {
    const projectId = img._projectId;
    if (projectId) {
      const mgr = UserManager.getInstance();
      const project = mgr.getProjects().find(p => p.id === projectId);
      if (project) onOpenProject(project);
    }
    // Set favorite params after a delay to ensure generation panel is mounted
    setTimeout(() => {
      if (onSetFavoriteParams) {
        onSetFavoriteParams({
          prompt: img.prompt || '',
          model: img.model || '',
          aspectRatio: img.aspectRatio || '',
          quality: img.quality || '',
          negativePrompt: img.negativePrompt || '',
        });
      }
    }, 500);
  }, [onOpenProject, onSetFavoriteParams]);

  // Batch download selected images as zip
  const handleBatchDownload = useCallback(async () => {
    if (selectedAssetIds.size === 0) return;
    const zip = new JSZip();
    const folder = zip.folder('assets')!;
    let count = 0;
    for (const id of selectedAssetIds) {
      const img = allImages.find(i => i.id === id);
      if (!img) continue;
      try {
        const url = img.url || '';
        if (!url) continue;
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
        const name = (img.prompt || `image_${count}`).slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
        folder.file(`${name}_${count}.${ext}`, blob);
        count++;
      } catch { /* skip failed */ }
    }
    if (count === 0) return;
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `assets_${count}_images.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setAssetManageMode(false);
    setSelectedAssetIds(new Set());
  }, [selectedAssetIds, allImages]);

  // Batch delete selected images
  const handleBatchDeleteAssets = useCallback(async () => {
    if (selectedAssetIds.size === 0) return;
    const selected = [...selectedAssetIds].flatMap((id): Array<DashboardImage & { projectId: string }> => {
      const image = allImages.find(candidate => candidate.id === id);
      if (!image?._projectId) return [];
      return [{ ...image, projectId: image._projectId }];
    });
    const result = await reconcileImageBatchDeletion(
      selected,
      async (image) => {
        const response = await fetch(`/api/assets/placements/${image.placementId}?projectId=${encodeURIComponent(image.projectId)}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error('素材 placement 删除失败');
      },
      (image) => {
        const project = mgr.getProject(image.projectId);
        if (!project) return;
        mgr.updateProject(image.projectId, {
          canvasImages: (project.canvasImages || []).filter(candidate => candidate.id !== image.id),
        });
      },
    );
    if (result.deletedIds.length > 0) {
      const deleted = new Set(result.deletedIds);
      setSelectedAssetIds(previous => new Set([...previous].filter(id => !deleted.has(id))));
      setProjectRevision(revision => revision + 1);
    }
    if ('error' in result) {
      toast.error(errorMessage(result.error, '素材删除失败'));
      return;
    }
    setAssetManageMode(false);
  }, [selectedAssetIds, allImages, mgr]);

  // Toggle asset selection
  const toggleAssetSelection = useCallback((id: string) => {
    setSelectedAssetIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Select/deselect all assets
  const toggleSelectAllAssets = useCallback(() => {
    if (selectedAssetIds.size === filteredImages.length) {
      setSelectedAssetIds(new Set());
    } else {
      setSelectedAssetIds(new Set(filteredImages.map(i => i.id)));
    }
  }, [selectedAssetIds.size, filteredImages]);

  const handleRenameProject = useCallback((projectId: string, currentName: string) => {
    setRenamingProjectId(projectId);
    setRenameValue(currentName);
    setMenuOpenId(null);
  }, []);

  const handleConfirmRename = useCallback(() => {
    if (renamingProjectId && renameValue.trim()) {
      mgr.updateProject(renamingProjectId, { name: renameValue.trim() });
    }
    setRenamingProjectId(null);
    setRenameValue('');
  }, [mgr, renamingProjectId, renameValue]);

  const handleExportProject = useCallback(async (project: Project) => {
    try {
      const content = await mgr.exportProjectToWujie(project.id);
      const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name}.wujie`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出项目失败:', err);
    }
    setMenuOpenId(null);
  }, [mgr]);

  // ─── Import project ───
  const importProjectInputRef = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wujie,application/json,text/html';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          mgr.importProjectFromWujie(String(reader.result || ''));
          // Force re-render by toggling state
          setActiveTab('projects');
        } catch {
          alert('导入失败，请选择有效的 .wujie 文件。');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [mgr]);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuOpenId && !target.closest('[data-project-menu]')) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [menuOpenId]);

  // ─── Admin: Data fetching ───
  const refreshAdmin = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store', credentials: 'include', signal });
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.users)) setAdminUsers(data.users);
        else setAdminUsers([]);
      }
    } catch { setAdminUsers([]); }
    try {
      const response = await fetch('/api/admin/apis', { cache: 'no-store', credentials: 'include', signal });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // 过滤掉无效的空记录（名称或URL为空）
          const validProviders = (data.providers || []).filter((p: AdminProvider) => p.name && p.baseUrl);
          setProviders(validProviders);
          setProvidersLoadError(null);
        }
        else {
          setProvidersLoadError(data.error || '服务未返回供应商配置');
        }
      } else {
        setProvidersLoadError(`HTTP ${response.status}`);
      }
    } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; setProvidersLoadError(errorMessage(error, '网络请求失败')); }
    try {
      const gRes = await fetch('/api/admin/groups', { cache: 'no-store', credentials: 'include', signal });
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData.success && Array.isArray(gData.groups)) setAdminGroups(gData.groups);
      }
    } catch { /* ignore */ }
  }, []);

  const refreshBalances = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/admin/api-balance', { credentials: 'include', signal });
      if (response.ok) {
        const data = await response.json();
        if (data.success) setApiBalances(data.balances || []);
      }
    } catch { setApiBalances([]); }
  }, []);

  const refreshCloudTasks = useCallback(async () => {
    setCloudTasksLoading(true);
    try {
      const response = await fetch('/api/admin/cloud-tasks?limit=20', { cache: 'no-store', credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success && Array.isArray(data.tasks)) {
        setCloudTasks(data.tasks);
        setCloudTasksError(null);
      } else {
        setCloudTasksError(data.error || `HTTP ${response.status}`);
      }
    } catch (error) { setCloudTasksError(errorMessage(error, '网络请求失败')); }
    finally { setCloudTasksLoading(false); }
  }, []);

  const refreshProviderTaskSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/cloud-tasks?view=provider-summary', { cache: 'no-store', credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.providers)) return;
      setProviderTaskSummary(Object.fromEntries(data.providers.map((item: { providerId: string; total: number; processing: number; failed: number }) => [item.providerId, item])));
    } catch { /* Keep the last known summary. */ }
  }, []);

  const refreshProductionReadiness = useCallback(async () => {
    setProductionReadinessLoading(true);
    try {
      const response = await fetch('/api/admin/production-readiness', { cache: 'no-store', credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.database && data.summary && Array.isArray(data.providers)) {
        setProductionReadiness(data);
        setProductionReadinessLoadError(null);
      } else {
        setProductionReadinessLoadError(data.error || `HTTP ${response.status}`);
      }
    } catch (error) { setProductionReadinessLoadError(errorMessage(error, '网络请求失败')); }
    finally { setProductionReadinessLoading(false); }
  }, []);

  const loadChatProjects = useCallback(async () => {
    const projects = await loadSimpleChatDashboardProjects({
      userId: user.id,
      store: createIndexedDbSimpleChatEnvelopeStore(),
    });
    return projects.map((project) => ({
        id: project.id,
        name: project.name,
        emoji: project.emoji || '💬',
        taskCount: Array.isArray(project.tasks) ? project.tasks.length : 0,
        updatedAt: project.updatedAt || 0,
      }));
  }, [user.id]);

  useEffect(() => {
    if (!user.productType?.includes('chat')) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const loaded = await loadChatProjects();
      if (!cancelled) setChatProjects(loaded);
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
    };
  }, [loadChatProjects, user.productType]);

  // ─── Filtered providers for API management ───
  const filteredProviders = useMemo(() => {
    let list = [...providers];
    if (apiFilterType !== 'all') list = list.filter(p => p.modelType === apiFilterType);
    if (apiFilterStatus === 'enabled') list = list.filter(p => p.isEnabled !== false);
    else if (apiFilterStatus === 'disabled') list = list.filter(p => p.isEnabled === false);
    if (apiSearchQuery.trim()) {
      const q = apiSearchQuery.toLowerCase();
      list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.baseUrl || '').toLowerCase().includes(q) || (p.selectedModels || []).some(m => m.toLowerCase().includes(q)));
    }
    return list;
  }, [providers, apiFilterType, apiFilterStatus, apiSearchQuery]);
  const adminModelAuthorizationOptions = useMemo(
    () => buildDashboardModelAuthorizationOptions(providers),
    [providers],
  );
  const adminChatModelOptions = adminModelAuthorizationOptions.chatModels;
  const adminImageModelOptions = adminModelAuthorizationOptions.imageModels;

  const toggleSelectAllProviders = useCallback(() => {
    if (selectedProviderIds.size === filteredProviders.length && filteredProviders.length > 0) {
      setSelectedProviderIds(new Set());
    } else {
      setSelectedProviderIds(new Set(filteredProviders.map(p => p.id)));
    }
  }, [selectedProviderIds, filteredProviders]);

  // ─── Batch operations ───
  const handleBatchToggleApi = useCallback(async (enable: boolean) => {
    setApiBatchLoading(true);
    try {
      const ids = Array.from(selectedProviderIds);
      for (const pid of ids) {
        await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', providerId: pid, updates: { isEnabled: enable } }) });
      }
      window.dispatchEvent(new Event('wujie-admin-apis-updated'));
      await refreshAdmin();
      setSelectedProviderIds(new Set());
    } finally { setApiBatchLoading(false); }
  }, [selectedProviderIds, refreshAdmin]);

  const handleBatchDeleteApi = useCallback(async () => {
    setApiBatchLoading(true);
    try {
      const ids = Array.from(selectedProviderIds);
      for (const pid of ids) await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', providerId: pid }) });
      window.dispatchEvent(new Event('wujie-admin-apis-updated'));
      await refreshAdmin();
      setSelectedProviderIds(new Set());
    } finally {
      setApiBatchLoading(false);
      setConfirmDlg(d => ({ ...d, open: false }));
    }
  }, [selectedProviderIds, refreshAdmin]);

  const handleBatchTestConnection = useCallback(async () => {
    setApiBatchLoading(true);
    const ids = Array.from(selectedProviderIds);
    let ok = 0, fail = 0;
    for (const pid of ids) {
      try {
        const p = providers.find(x => x.id === pid);
        if (!p) continue;
        const res = await fetch('/api/test-provider-connection', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: pid })
        });
        const d = await res.json();
        if (d.success) ok++; else fail++;
      } catch { fail++; }
    }
    setApiBatchLoading(false);
    alert(`批量测试完成：${ok} 个成功，${fail} 个失败`);
  }, [selectedProviderIds, providers]);

  // ─── Reset API form helper ───
  const resetApiForm = useCallback(() => {
    setApiKind('image'); setApiName(''); setApiDisplayName(''); setApiBaseUrl(''); setApiKey(''); setApiModel('');
    setCompatProfile('auto'); setDiscoveredModels([]); setSelectedModels([]);
    setAdvancedParams([]); setShowAdvancedParams(false); setShowApiKey(false);
    setTaskModelCapabilities({ version: 1, models: {} });
    setBalanceUsername(''); setBalancePassword('');
    setTestNewResult(null); setDrawerVerifyResult(null); setDrawerBalanceResult(null);
    setEditingProviderId(null);
  }, []);

  const editApiProvider = useCallback((p: AdminProvider) => {
    setEditingProviderId(p.id);
    setApiName(p.name);
    setApiDisplayName(p.displayName || '');
    setApiBaseUrl(p.baseUrl);
    setApiKey(''); // Don't pre-fill key for security; user can enter new key to update
    setApiModel('');
    setApiKind((p.modelType as ApiKind) || 'image');
    setCompatProfile(p.advancedParams?.compatProfile || 'auto');
    setSelectedModels(p.selectedModels || []);
    setDiscoveredModels(p.discoveredModels || []);
    const visibleAdvancedParams = getVisibleAdvancedParams(p.advancedParams);
    setAdvancedParams(Object.entries(visibleAdvancedParams).map(([key, value]) => ({ key, value })));
    setTaskModelCapabilities(readProviderCapabilityOverrides(p.advancedParams?.taskModelCapabilities));
    setShowAdvancedParams(Object.keys(visibleAdvancedParams).length > 0);
    setTestNewResult(null); setDrawerVerifyResult(null); setDrawerBalanceResult(null);
    setShowApiKey(false);
    setShowApiDrawer(true);
  }, []);

  // 抽屉内验证协议
  const handleDrawerVerifyProtocol = useCallback(async () => {
    if (!apiBaseUrl) return;
    // Use existing provider key when editing and no new key provided
    const effectiveKey = apiKey || (editingProviderId ? providers.find(p => p.id === editingProviderId)?.apiKey : undefined);
    setIsVerifyingDrawer(true);
    setDrawerVerifyResult(null);
    try {
      const advParams = getVisibleAdvancedParams(advancedParams);
      if (compatProfile !== 'auto') advParams.compatProfile = compatProfile;
      const res = await fetch('/api/verify-protocol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: apiBaseUrl,
          apiKey: effectiveKey,
          modelType: apiKind,
          advancedParams: Object.keys(advParams).length > 0 ? advParams : undefined,
        }),
      });
      const data = await res.json() as VerifyProtocolResponse;
      // 后端返回 tests 数组，提取各端点状态
      const tests: Array<{ name: string; status: string; detail: string }> = data.tests || [];
      const checks = {
        models: tests.find(t => t.name === '模型列表')?.status === 'pass',
        imageGen: tests.find(t => t.name === '图片生成')?.status === 'pass',
        chat: tests.find(t => t.name === '对话模型')?.status === 'pass',
      };
      setDrawerVerifyResult({
        success: data.success !== false,
        checks,
        detected: data.profile?.id || data.detected,
        message: data.summary || data.message,
        tests,
      });
    } catch (e: unknown) {
      setDrawerVerifyResult({ success: false, message: errorMessage(e, '验证失败') });
    } finally {
      setIsVerifyingDrawer(false);
    }
  }, [apiBaseUrl, apiKey, apiKind, editingProviderId, providers, advancedParams, compatProfile]);

  // 抽屉内查询余额
  const handleDrawerQueryBalance = useCallback(async () => {
    if (!apiBaseUrl) return;
    const effectiveKey = apiKey || (editingProviderId ? providers.find(p => p.id === editingProviderId)?.apiKey : undefined);
    setIsQueryingBalanceDrawer(true);
    setDrawerBalanceResult(null);
    try {
      const advParams = getVisibleAdvancedParams(advancedParams);
      // 先尝试用临时配置查询
      const tempRes = await fetch('/api/admin/api-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: apiBaseUrl,
          apiKey: effectiveKey,
          modelType: apiKind,
          advancedParams: Object.keys(advParams).length > 0 ? advParams : undefined,
        }),
      });
      const data = await tempRes.json() as ApiBalanceResponse;
      if (data.success !== false && data.balances?.[0]) {
        const bal = data.balances[0];
        setDrawerBalanceResult({
          success: true,
          message: bal.error ? `查询完成：${bal.error}` : '余额查询成功',
          balance: bal.balance === undefined ? undefined : Number(bal.balance),
          currency: bal.currency,
        });
      } else {
        setDrawerBalanceResult({ success: false, message: data.error || '当前API暂不支持余额查询或密钥无效' });
      }
    } catch (e: unknown) {
      setDrawerBalanceResult({ success: false, message: errorMessage(e, '查询失败') });
    } finally {
      setIsQueryingBalanceDrawer(false);
    }
  }, [apiBaseUrl, apiKey, apiKind, editingProviderId, providers, advancedParams]);

  const toggleApiEnabled = useCallback(async (providerId: string) => {
    const p = providers.find(x => x.id === providerId);
    if (!p) return;
    await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', providerId, updates: { isEnabled: !(p.isEnabled ?? true) } }) });
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
  }, [providers, refreshAdmin]);

  const testApiConnection = useCallback(async (p: ApiProvider) => {
    setTestingProviderId(p.id);
    setProviderTestStatus(prev => ({ ...prev, [p.id]: { testing: true, success: null, message: '正在测试连接...', modelCount: 0 } }));
    try {
      const r = await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', providerId: p.id }) });
      const d = await r.json();
      setProviderTestStatus(prev => ({
        ...prev,
        [p.id]: {
          testing: false,
          success: d.success,
          message: d.success ? `连接成功！发现 ${d.models?.length || 0} 个模型` : `连接失败: ${d.error || '未知错误'}`,
          modelCount: d.models?.length || 0,
        }
      }));
    } catch (e: unknown) {
      setProviderTestStatus(prev => ({
        ...prev,
        [p.id]: { testing: false, success: false, message: `连接失败: ${errorMessage(e, '未知错误')}`, modelCount: 0 }
      }));
    } finally {
      setTestingProviderId(null);
    }
  }, []);

  // 卡片上的验证协议按钮
  const [providerVerifyStatus, setProviderVerifyStatus] = useState<Record<string, { verifying: boolean; result?: { success: boolean; summary: string; tests?: Array<{ name: string; status: string; detail: string; endpoint?: string; latencyMs?: number }> } }>>({});
  const [expandedModelProviders, setExpandedModelProviders] = useState<Set<string>>(new Set());
  const verifyProtocolForProvider = useCallback(async (p: ApiProvider) => {
    setProviderVerifyStatus(prev => ({ ...prev, [p.id]: { verifying: true } }));
    try {
      const res = await fetch('/api/verify-protocol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: p.id }),
      });
      const data = await res.json();
      setProviderVerifyStatus(prev => ({ ...prev, [p.id]: { verifying: false, result: { success: data.success !== false, summary: data.summary || '', tests: data.tests || [] } } }));
    } catch (e: unknown) {
      setProviderVerifyStatus(prev => ({ ...prev, [p.id]: { verifying: false, result: { success: false, summary: `验证失败: ${errorMessage(e, '未知错误')}`, tests: [] } } }));
    }
  }, []);

  // 卡片上的查询余额按钮
  const [providerBalanceStatus, setProviderBalanceStatus] = useState<Record<string, { loading: boolean; message?: string }>>({});
  const queryBalanceForProvider = useCallback(async (p: ApiProvider) => {
    setProviderBalanceStatus(prev => ({ ...prev, [p.id]: { loading: true } }));
    try {
      const res = await fetch('/api/admin/api-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: p.id }),
      });
      const data = await res.json() as ApiBalanceResponse;
      const balInfo = data.balances?.find((balance) => balance.providerId === p.id);
      const msg = balInfo
        ? (balInfo.error ? balInfo.error : `余额查询成功：${balInfo.balance ?? '未知'} ${balInfo.currency || ''}${balInfo.remainingQuota != null ? `，剩余额度 ${balInfo.remainingQuota}` : ''}`)
        : (data.error || '未找到余额信息');
      setProviderBalanceStatus(prev => ({ ...prev, [p.id]: { loading: false, message: msg } }));
    } catch (e: unknown) {
      setProviderBalanceStatus(prev => ({ ...prev, [p.id]: { loading: false, message: `查询失败: ${errorMessage(e, '未知错误')}` } }));
    }
  }, []);

  const deleteApiProvider = useCallback(async (providerId: string) => {
    try {
      await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', providerId }) });
      await refreshAdmin();
      window.dispatchEvent(new Event('wujie-admin-apis-updated'));
      setSelectedProviderIds(prev => { const next = new Set(prev); next.delete(providerId); return next; });
    } finally {
      setConfirmDlg(d => ({ ...d, open: false }));
    }
  }, [refreshAdmin]);

  // ─── Admin: User management computed ───
  const filteredAdminUsers = useMemo(() => {
    let list = [...adminUsers];
    if (userFilterRole !== 'all') list = list.filter(u => u.role === userFilterRole);
    if (userFilterStatus === 'active') list = list.filter(u => u.status !== 'disabled');
    else if (userFilterStatus === 'disabled') list = list.filter(u => u.status === 'disabled');
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.toLowerCase();
      list = list.filter(u => (u.name || '').toLowerCase().includes(q) || (u.id || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
    }
    return list;
  }, [adminUsers, userFilterRole, userFilterStatus, userSearchQuery]);

  const handleBatchToggleUsers = useCallback(async (enable: boolean) => {
    const ids = Array.from(selectedUserIds);
    if (ids.length === 0) return;
    try {
      for (const uid of ids) {
        await fetch('/api/admin/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ action: enable ? 'enable' : 'disable', userId: uid })
        });
      }
      setSelectedUserIds(new Set());
      await refreshAdmin();
    } catch { /* ignore */ }
  }, [selectedUserIds, refreshAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    void refreshAdmin(controller.signal);
    void refreshBalances(controller.signal);
    return () => controller.abort();
  }, [isAdmin, refreshAdmin, refreshBalances]);

  // ─── Load dashboard stats (admin overview) ───
  const loadDashboardStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dashboard-stats', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) setDashboardStats(data.stats);
      }
    } catch { /* ignore */ }
  }, []);

  // ─── Load audit logs ───
  const loadAuditLogs = useCallback(async (page = 0) => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50', offset: String(page * 50) });
      if (auditFilterAction && auditFilterAction !== 'all') params.set('action', auditFilterAction);
      const res = await fetch(`/api/admin/audit?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAuditLogs(data.logs || []);
          setAuditTotal(data.total || 0);
          setAuditPage(page);
        }
      }
    } catch { /* ignore */ }
    setAuditLoading(false);
  }, [auditFilterAction]);

  const loadAuditStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/audit?stats=true', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) setAuditStats(data.stats);
      }
    } catch { /* ignore */ }
  }, []);

  // ─── Load user detail (drawer) ───
  const loadUserDetail = useCallback(async (userId: string) => {
    setUserDetailId(userId);
    setShowUserDrawer(true);
    try {
      // Load all users' credits via admin overview
      const allCreditsRes = await fetch('/api/credits?action=admin-overview', { credentials: 'include' });
      if (allCreditsRes.ok) {
        const data = await allCreditsRes.json();
        if (data.success && data.users) {
          const userCredit = data.users.find((u: { userId: string }) => u.userId === userId);
          if (userCredit) setUserDetailCredits({ balance: userCredit.balance, totalRecharged: userCredit.totalRecharged, totalUsed: userCredit.totalUsed });
        }
      }
      // Load user transactions
      const txRes = await fetch(`/api/credits?action=transactions&userId=${userId}`, { credentials: 'include' });
      if (txRes.ok) {
        const txData = await txRes.json();
        if (txData.success && txData.transactions) {
          setUserDetailTransactions(txData.transactions.map((t: { id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }) => ({
            id: t.id, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter, description: t.description, createdAt: t.createdAt,
          })));
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ─── Load data when switching admin tabs ───
  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'overview') void loadDashboardStats();
    if (activeTab === 'audit') { void loadAuditLogs(0); void loadAuditStats(); }
    if (activeTab === 'settings') {
      void (async () => {
        try {
          const res = await fetch('/api/admin/settings', { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.settings) setSystemSettings(prev => ({ ...prev, ...data.settings }));
          }
        } catch { /* ignore */ }
      })();
    }
  }, [isAdmin, activeTab, loadDashboardStats, loadAuditLogs, loadAuditStats]);

  // Close "more" dropdown on outside click
  useEffect(() => {
    if (!moreMenuProviderId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-more-menu]')) setMoreMenuProviderId(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [moreMenuProviderId]);

  // ─── Credits data loading ───


  // ─── Admin: User management handlers ───
  const handleCreateUser = async () => {
    if (!newUserName.trim() || !newUserPassword.trim()) return;
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'create', name: newUserName.trim(), password: newUserPassword.trim(), email: newUserEmail.trim() || undefined }),
    });
    setNewUserName(''); setNewUserPassword(''); setNewUserEmail('');
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleToggleUser = async (u: User) => {
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'update', userId: u.id, updates: { status: u.status === 'disabled' ? 'active' : 'disabled' } }),
    });
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleDeleteUser = (u: User) => {
    if (u.role === 'admin') return;
    setConfirmDlg({
      open: true, title: '删除用户', message: `确定删除用户 ${u.name} 吗？该用户的本地项目数据会一并移除。`,
      onConfirm: async () => {
        await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'delete', userId: u.id }) });
        await refreshAdmin();
        window.dispatchEvent(new Event('wujie-admin-users-updated'));
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleRenameUser = async (userId: string) => {
    if (!editName.trim()) return;
    await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId, updates: { name: editName.trim() } }) });
    setEditingUser(null); setEditName('');
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleResetPassword = (userId: string) => {
    if (!newPassword.trim() || newPassword.trim().length < 4) return;
    setConfirmDlg({
      open: true, title: '重置密码', message: `确定将密码重置为 "${newPassword.trim()}" 吗？`, variant: 'warning',
      onConfirm: async () => {
        await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId, updates: { password: newPassword.trim() } }) });
        setResetPwdUser(null); setNewPassword('');
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleToggleUserPermission = async (u: User, key: UserPermissionKey) => {
    const current: Record<UserPermissionKey, boolean> = {
      image: u.apiPermissions?.image ?? true, chat: u.apiPermissions?.chat ?? true,
      threeD: u.apiPermissions?.threeD ?? true,
      vectorize: u.apiPermissions?.vectorize ?? true, layer: u.apiPermissions?.layer ?? true,
      video: u.apiPermissions?.video ?? true,
      vlm: u.apiPermissions?.vlm ?? true,
      upscaler: u.apiPermissions?.upscaler ?? true,
      removebg: u.apiPermissions?.removebg ?? true,
      audio: u.apiPermissions?.audio ?? true,
    };
    await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ action: 'update', userId: u.id, updates: { apiPermissions: { ...current, [key]: !current[key] } } }),
    });
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  // ─── Admin: API management handlers ───
  const handleDiscoverModels = async () => {
    if (!apiBaseUrl.trim()) return;
    // For drawer: if no new key entered but editing existing provider, allow test with existing key via test action
    setIsTestingNew(true);
    setIsDiscovering(true);
    try {
      const requestBody: Record<string, unknown> = {
        baseUrl: apiBaseUrl.trim(),
        modelType: apiKind,
      };
      // Pass advanced params including compatProfile
      const advParams = getVisibleAdvancedParams(advancedParams);
      if (compatProfile !== 'auto') advParams.compatProfile = compatProfile;
      if (Object.keys(advParams).length > 0) requestBody.advancedParams = advParams;

      if (apiKey.trim()) {
        requestBody.apiKey = apiKey.trim();
        requestBody.action = 'discover';
      } else if (editingProviderId) {
        // Use existing provider's key
        requestBody.action = 'test';
        requestBody.providerId = editingProviderId;
      } else {
        setTestNewResult({ success: false, message: '请先填写 API Key' });
        setIsDiscovering(false);
        setIsTestingNew(false);
        return;
      }
      const response = await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
      if (!response.ok) throw new Error(`模型发现失败: HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success && data.error) { setTestNewResult({ success: false, message: data.error }); setDiscoveredModels([]); setIsTestingNew(false); return; }
      const models = data.models || [];
      setDiscoveredModels(models); setModelSearchQuery('');
      if (models.length === 0 && data.message) {
        // Backend has a diagnostic message (e.g. 401, 404, non-JSON) — show it instead of generic text
        setTestNewResult({ success: true, message: data.message, modelCount: 0 });
      } else {
        setTestNewResult({ success: true, message: `连接成功，发现 ${models.length} 个可用模型`, modelCount: models.length });
      }
      if (apiKind === 'vectorize') {
        const vModels = models.filter((m: ModelInfo) => { const id = m.id.toLowerCase(); return id.includes('vector') || id.includes('vectorize') || id.includes('svg') || id.includes('tracer') || id.includes('starvector'); });
        setSelectedModels(vModels.length > 0 ? vModels.map((m: ModelInfo) => m.id) : []);
      } else if (apiKind === 'layer') {
        const lModels = models.filter((m: ModelInfo) => { const id = m.id.toLowerCase(); return id.includes('layer') || id.includes('segment') || id.includes('qwen-image-layered'); });
        setSelectedModels(lModels.length > 0 ? lModels.map((m: ModelInfo) => m.id) : []);
      } else if (apiKind === 'upscaler') {
        const uModels = models.filter((m: ModelInfo) => { const id = m.id.toLowerCase(); return id.includes('upscale') || id.includes('seedvr') || id.includes('esrgan') || id.includes('realesrgan') || id.includes('swinir') || id.includes('hat'); });
        setSelectedModels(uModels.length > 0 ? uModels.map((m: ModelInfo) => m.id) : []);
      } else if (apiKind === 'removebg') {
        const rModels = models.filter((m: ModelInfo) => { const id = m.id.toLowerCase(); return id.includes('removebg') || id.includes('rmbg') || id.includes('birefnet') || id.includes('u2net') || id.includes('isnet') || id.includes('background') || id.includes('matting'); });
        setSelectedModels(rModels.length > 0 ? rModels.map((m: ModelInfo) => m.id) : []);
      } else if (apiKind === 'video') {
        // Backend already filtered to video-only models, auto-select all
        setSelectedModels(models.map((m: ModelInfo) => m.id));
      } else if (selectedModels.length === 0 && models.length > 0) {
        // Auto-select all models on first discover
        setSelectedModels(models.map((m: ModelInfo) => m.id));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '识别模型失败';
      setTestNewResult({ success: false, message: msg.includes('JSON') ? 'API 返回了非 JSON 响应，请检查 Base URL 是否正确' : msg });
      setDiscoveredModels([]);
    } finally { setIsDiscovering(false); setIsTestingNew(false); }
  };

  const handleAddApi = async () => {
    if (isSubmitting) return;
    if (!apiName.trim() || !apiBaseUrl.trim()) { alert('请填写配置名称和BASE URL'); return; }
    if (!apiKey.trim()) { alert('请填写API Key'); return; }
    setIsSubmitting(true);
    try {
      const models = selectedModels.length ? selectedModels : apiModel.trim() ? [apiModel.trim()] : [];
      const res = await fetch('/api/admin/apis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: apiName.trim(),
          displayName: apiDisplayName.trim() || undefined,
          baseUrl: apiBaseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
          modelType: apiKind,
          selectedModels: models,
          discoveredModels: discoveredModels.length > 0 ? discoveredModels : undefined,
          requestStyle: apiKind === 'general' ? 'auto' : apiKind === 'chat' ? 'chat-completions' : apiKind === 'vectorize' || apiKind === 'layer' || apiKind === 'upscaler' || apiKind === 'removebg' ? 'images-generations' : apiKind === 'video' ? 'images-generations' : 'images-generations',
          advancedParams: mergeAdvancedParamsWithCapabilities(
            [...advancedParams.filter(p => p.key.trim() && p.key !== 'compatProfile'), ...(compatProfile !== 'auto' ? [{ key: 'compatProfile', value: compatProfile }] : [])],
            taskModelCapabilities,
          ),
          balanceUsername: balanceUsername.trim(), balancePassword: balancePassword.trim(),
        }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({ error: '保存失败' })); alert(data.error || '保存失败，请重试'); return; }
      resetApiForm();
      setShowApiDrawer(false);
      window.dispatchEvent(new Event('wujie-admin-apis-updated'));
      await refreshAdmin();
    } finally { setIsSubmitting(false); }
  };

  const handleEditApi = (provider: AdminProvider) => {
    setEditingProviderId(provider.id);
    setApiName(provider.name);
    setApiDisplayName(provider.displayName || '');
    setApiBaseUrl(provider.baseUrl);
    // 编辑时保留原API Key显示，避免用户二次输入；仅新增时清空
    // 注意：apiKey在编辑时留空意味着"不修改现有密钥"，服务器端会保留原key
    setApiKey(editingProviderId ? '' : '');
    setApiKind((provider.modelType || 'image') as ApiKind);
    const savedProfile = provider.advancedParams?.compatProfile || 'auto';
    setCompatProfile(['apimart', 'openai', 'openai-async', 'gemini-image', 'pearapi', 'auto', 'custom'].includes(savedProfile) ? savedProfile : 'auto');
    const providerModels = provider.discoveredModels || [];
    if (providerModels.length > 0) { setDiscoveredModels(providerModels); setSelectedModels(provider.selectedModels || []); setModelSearchQuery(''); }
    else { setDiscoveredModels([]); setSelectedModels([]); }
    setApiModel('');
    setBalanceUsername((provider as unknown as Record<string, unknown>).balanceUsername as string || '');
    setBalancePassword((provider as unknown as Record<string, unknown>).balancePassword as string || '');
    const visibleAdvancedParams = getVisibleAdvancedParams(provider.advancedParams);
    setAdvancedParams(Object.entries(visibleAdvancedParams).map(([key, value]) => ({ key, value })));
    setTaskModelCapabilities(readProviderCapabilityOverrides(provider.advancedParams?.taskModelCapabilities));
  };

  const quickUpdateProvider = async (providerId: string, updates: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', providerId, updates }) });
      if (!res.ok) { const data = await res.json().catch(() => ({ error: '更新失败' })); alert(data.error || '更新失败'); return; }
      window.dispatchEvent(new Event('wujie-admin-apis-updated'));
      await refreshAdmin();
    } catch { alert('网络错误，请重试'); }
  };

  const handleUpdateApi = async () => {
    if (!editingProviderId || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const models = selectedModels.length ? selectedModels : apiModel.trim() ? [apiModel.trim()] : undefined;
      const updates: Record<string, unknown> = {};
      if (apiName.trim()) updates.name = apiName.trim();
      updates.displayName = apiDisplayName.trim() || undefined;
      if (apiBaseUrl.trim()) updates.baseUrl = apiBaseUrl.trim();
      // 编辑模式下，空apiKey表示不修改现有密钥（服务器端保留原key）
      if (apiKey.trim()) updates.apiKey = apiKey.trim();
      updates.modelType = apiKind;
      if (models) updates.selectedModels = models;
      // 发送discoveredModels（包含用户手动编辑的displayName）
      if (discoveredModels.length > 0) updates.discoveredModels = discoveredModels;
      const paramsWithCompat = [...advancedParams.filter(p => p.key.trim() && p.key !== 'compatProfile'), ...(compatProfile !== 'auto' ? [{ key: 'compatProfile', value: compatProfile }] : [])];
      updates.advancedParams = mergeAdvancedParamsWithCapabilities(paramsWithCompat, taskModelCapabilities);
      if (balanceUsername.trim()) updates.balanceUsername = balanceUsername.trim();
      if (balancePassword.trim()) updates.balancePassword = balancePassword.trim();
      const res = await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', providerId: editingProviderId, updates }) });
      if (!res.ok) { const data = await res.json().catch(() => ({ error: '更新失败' })); alert(data.error || '更新失败，请重试'); return; }
      resetApiForm();
      setShowApiDrawer(false);
      window.dispatchEvent(new Event('wujie-admin-apis-updated'));
      await refreshAdmin();
    } finally { setIsSubmitting(false); }
  };

  const handleTestConnection = async (provider: AdminProvider) => {
    setProviderTestStatus(prev => ({ ...prev, [provider.id]: { testing: true, success: null, message: '连接中...', modelCount: prev[provider.id]?.modelCount || 0 } }));
    try {
      const response = await fetch('/api/test-provider-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ providerId: provider.id }) });
      if (!response.ok) throw new Error(`测试连接失败: HTTP ${response.status}`);
      const data = await response.json();
      setProviderTestStatus(prev => ({ ...prev, [provider.id]: { testing: false, success: data.success, message: data.success ? (data.info || '连接成功') : (data.error || '连接失败'), modelCount: data.success ? (provider.selectedModels?.length || 0) : 0 } }));
    } catch { setProviderTestStatus(prev => ({ ...prev, [provider.id]: { testing: false, success: false, message: '网络错误，无法连接', modelCount: 0 } })); }
  };

  const handleTestNewConnection = async () => {
    if (!apiBaseUrl || !apiKey) return;
    setIsTestingNew(true); setTestNewResult(null);
    try {
      const advParams: Record<string, string> = {};
      advancedParams.forEach(p => { if (p.key.trim()) advParams[p.key.trim()] = p.value; });
      const response = await fetch('/api/test-provider-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ baseUrl: apiBaseUrl, apiKey, requestStyle: apiKind === 'chat' ? 'chat-completions' : apiKind === 'vectorize' || apiKind === 'layer' ? 'chat-completions' : 'images-generations', advancedParams: advParams }),
      });
      if (!response.ok) throw new Error(`测试连接失败: HTTP ${response.status}`);
      const data = await response.json();
      setTestNewResult({ success: data.success, message: data.success ? (data.info || '连接成功') : (data.error || '连接失败'), modelCount: data.modelCount, error: data.error });
    } catch { setTestNewResult({ success: false, message: '网络错误，无法连接' }); }
    finally { setIsTestingNew(false); }
  };

  const handleVerifyProtocol = async (provider: AdminProvider) => {
    setIsVerifying(true); setVerifyResult(null);
    try {
      const response = await fetch('/api/verify-protocol', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ providerId: provider.id }) });
      if (!response.ok) throw new Error(`协议验证失败: HTTP ${response.status}`);
      const data = await response.json();
      setVerifyResult({ providerId: provider.id, success: data.success, summary: data.summary || '', tests: data.tests || [] });
    } catch { setVerifyResult({ providerId: provider.id, success: false, summary: '验证请求失败', tests: [] }); }
    finally { setIsVerifying(false); }
  };

  const handleToggleApi = async (provider: AdminProvider) => {
    await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', providerId: provider.id, updates: { isEnabled: !provider.isEnabled } }) });
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refreshAdmin();
  };

  const handleRefreshApi = async (provider: AdminProvider) => {
    await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh', providerId: provider.id }) });
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refreshAdmin();
  };

  const handleDeleteApi = (provider: AdminProvider) => {
    setConfirmDlg({
      open: true, title: '删除 API', message: `确定删除 API「${provider.displayName || provider.name}」吗？此操作不可撤销。`, variant: 'danger',
      onConfirm: async () => {
        await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', providerId: provider.id }) });
        window.dispatchEvent(new Event('wujie-admin-apis-updated'));
        await refreshAdmin();
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleReorderApi = async (providerId: string, direction: 'up' | 'down') => {
    try {
      const res = await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder', providerId, direction }) });
      const data = await res.json();
      if (data.success) { window.dispatchEvent(new Event('wujie-admin-apis-updated')); await refreshAdmin(); }
    } catch (e) { console.error('[admin] reorder error:', e); }
  };

  // ─── Admin: Data management handlers ───
  const loadUserData = useCallback(async (userId: string) => {
    setSelectedDataUser(userId); setUserDataKeys([]); setViewingDataValue(null); setViewingDataKey(null);
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list-data', userId }), credentials: 'include' });
      const data = await response.json();
      if (data.success) setUserDataKeys(data.keys || []);
    } catch { setUserDataKeys([]); }
  }, []);

  const loadDataDetail = useCallback(async (userId: string, key: string) => {
    setViewingDataValue(null); setViewingDataKey(key); setViewingDataLoading(true);
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get-data', userId, key }), credentials: 'include' });
      const data = await response.json();
      if (data.success) setViewingDataValue(data.value);
      else setViewingDataValue({ error: data.error || '加载失败' });
    } catch { setViewingDataValue({ error: '请求失败' }); }
    finally { setViewingDataLoading(false); }
  }, []);

  const deleteUserData = useCallback(async (userId: string, key: string) => {
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-data', userId, key }), credentials: 'include' });
      const data = await response.json();
      if (data.success) { await loadUserData(userId); if (viewingDataKey === key) { setViewingDataValue(null); setViewingDataKey(null); } }
    } catch { /* ignore */ }
  }, [loadUserData, viewingDataKey]);

  // ─── Admin: User images ───
  const loadUserImages = useCallback(async (userId: string) => {
    setUserImagesLoading(true);
    setImageDetailId(null);
    try {
      const resp = await fetch(`/api/admin/user-images?userId=${encodeURIComponent(userId)}`);
      const data = await resp.json();
      if (data.images) {
        setUserImages(data.images);
      } else {
        setUserImages([]);
      }
    } catch { setUserImages([]); }
    setUserImagesLoading(false);
  }, []);

  // ─── Credits handlers ───
  const loadCreditsData = useCallback(async () => {
    try {
      const resp = await fetch('/api/credits');
      const data = await resp.json();
      if (data.success) {
        setCreditsBalance(data.credits?.balance ?? 0);
        setCreditsTotalRecharged(data.credits?.totalRecharged ?? 0);
        setCreditsTotalUsed(data.credits?.totalUsed ?? 0);
        if (data.pricing) setCreditsPricing(data.pricing);
      }
      // Load transactions
      try {
        const txResp = await fetch('/api/credits?transactions=true&limit=30');
        const txData = await txResp.json();
        if (txData.success) setCreditsTransactions(txData.transactions || []);
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }, []);

  const handleCreateOrder = useCallback(async (credits: number, method: 'alipay' | 'wechat') => {
    if (credits <= 0) {
      setRechargeError('充值数量必须大于0');
      return;
    }
    setIsRecharging(true);
    setRechargeError('');
    setSelectedPaymentMethod(method);
    try {
      const resp = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-order', amount: credits, paymentMethod: method }),
      });
      const data = await resp.json();
      if (data.success && data.orderId) {
        setPendingOrderId(data.orderId);
        setPendingOrderAmount(data.amount);
        setPaymentStep('paying');
      } else {
        setRechargeError(data.error || '创建订单失败');
      }
    } catch { setRechargeError('网络错误'); }
    setIsRecharging(false);
  }, []);

  const handleSavePaymentConfig = useCallback(async () => {
    setConfigSaving(true);
    setConfigSaveMsg(null);
    try {
      // 自动从收款码图片中解码支付链接
      let wechatPayLink = paymentConfig.wechatPayLink || '';
      let alipayPayLink = paymentConfig.alipayPayLink || '';
      try {
        const { decodeQrFromUrlClient } = await import('@/lib/qr-decode-client');
        if (paymentConfig.wechatQrUrl && !wechatPayLink) {
          wechatPayLink = await decodeQrFromUrlClient(paymentConfig.wechatQrUrl) || '';
        }
        if (paymentConfig.alipayQrUrl && !alipayPayLink) {
          alipayPayLink = await decodeQrFromUrlClient(paymentConfig.alipayQrUrl) || '';
        }
      } catch (e) {
        console.warn('[payment-config] QR decode skipped:', e);
      }
      const resp = await fetch('/api/credits/payment-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          wechatQrUrl: paymentConfig.wechatQrUrl,
          alipayQrUrl: paymentConfig.alipayQrUrl,
          wechatPayLink,
          alipayPayLink,
          // 上传收款码时自动启用对应支付方式
          wechatEnabled: !!(paymentConfig.wechatQrUrl || wechatPayLink),
          alipayEnabled: !!(paymentConfig.alipayQrUrl || alipayPayLink),
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setConfigSaveMsg('保存成功');
        // Refresh payment status
        const statusRes = await fetch('/api/credits/payment-status');
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.success) setPaymentStatus(statusData.status);
        }
        setTimeout(() => setConfigSaveMsg(null), 3000);
      } else {
        setConfigSaveMsg(data.error || '保存失败');
      }
    } catch {
      setConfigSaveMsg('网络错误');
    }
    setConfigSaving(false);
  }, [paymentConfig]);

  const loadAuditOrders = useCallback(async () => {
    try {
      const resp = await fetch('/api/credits?action=audit-orders');
      const data = await resp.json();
      if (data.success) setAuditOrders(data.orders || []);
    } catch { /* ignore */ }
  }, []);

  const loadCreditsOverview = useCallback(async () => {
    setCreditsLoading(true);
    try {
      const resp = await fetch('/api/credits?action=admin-overview');
      const data = await resp.json();
      if (data.success) setCreditsUsers(data.users || []);
    } catch { /* ignore */ }
    setCreditsLoading(false);
  }, []);

  const handleReverseOrder = useCallback(async (orderId: string) => {
    if (!confirm('确定要撤销此订单吗？积分将从用户账户中扣回。')) return;
    try {
      const resp = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse-order', orderId }),
      });
      const data = await resp.json();
      if (data.success) {
        await loadAuditOrders();
        await loadCreditsOverview();
      } else {
        alert(data.error || '撤销失败');
      }
    } catch { alert('网络错误'); }
  }, [loadAuditOrders, loadCreditsOverview]);

  const loadCreditsTransactions = useCallback(async (userId: string) => {
    try {
      const resp = await fetch(`/api/credits?action=transactions&userId=${encodeURIComponent(userId)}&limit=50`);
      const data = await resp.json();
      if (data.success) setCreditsUserTransactions(data.transactions || []);
    } catch { /* ignore */ }
  }, []);

  const handleAdminRecharge = useCallback(async () => {
    if (!selectedCreditsUser || !adminRechargeAmount || Number(adminRechargeAmount) <= 0) return;
    setIsAdminRecharging(true);
    try {
      const resp = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-recharge', userId: selectedCreditsUser, amount: Number(adminRechargeAmount), description: adminRechargeDesc || `管理员充值 ${adminRechargeAmount} 积分` }),
      });
      const data = await resp.json();
      if (data.success) {
        setAdminRechargeAmount('');
        setAdminRechargeDesc('');
        await loadCreditsOverview();
        await loadCreditsTransactions(selectedCreditsUser);
      } else {
        alert(data.error || '充值失败');
      }
    } catch { alert('网络错误'); }
    setIsAdminRecharging(false);
  }, [selectedCreditsUser, adminRechargeAmount, adminRechargeDesc, loadCreditsOverview, loadCreditsTransactions]);

  useEffect(() => {
    if (activeTab === 'credits') {
      void loadCreditsData();
      if (isAdmin) {
        void loadCreditsOverview();
        void loadAuditOrders();
      } else {
        // Non-admin users need to check payment status
        (async () => {
          try {
            const res = await fetch('/api/credits/payment-status');
            if (res.ok) {
              const data = await res.json();
              if (data.success) setPaymentStatus(data.status);
            }
          } catch { /* ignore */ }
        })();
      }
    }
    if (activeTab === 'payment-config' && isAdmin) {
      void loadAuditOrders();
    }
  }, [activeTab, isAdmin, loadCreditsData, loadCreditsOverview]);

  // ─── Admin: Ecom template handlers ───
  const loadEcomTemplates = useCallback(async () => {
    try { const resp = await fetch('/api/ecom-templates'); const data = await resp.json(); if (data.success) setEcomTemplates(data.templates || []); } catch { /* ignore */ }
  }, []);

  const loadDesktopAdminData = useCallback(async () => {
    if (!isAdmin) return;
    setDesktopAdminLoading(true);
    try {
      const [devicesRes, backupsRes, resourcesRes, recordsRes, updateRes] = await Promise.all([
        fetch('/api/admin/desktop-devices'),
        fetch('/api/admin/backups?limit=50'),
        fetch('/api/admin/resources'),
        fetch('/api/admin/local-generation-records?limit=50'),
        fetch('/api/admin/desktop-update'),
      ]);
      const [devices, backups, resources, records, update] = await Promise.all([
        devicesRes.json().catch(() => ({})),
        backupsRes.json().catch(() => ({})),
        resourcesRes.json().catch(() => ({})),
        recordsRes.json().catch(() => ({})),
        updateRes.json().catch(() => ({})),
      ]);
      setDesktopAdminData({
        devices: Array.isArray(devices.devices) ? devices.devices : [],
        backups: Array.isArray(backups.backups) ? backups.backups : [],
        resources: Array.isArray(resources.resources) ? resources.resources : [],
        records: Array.isArray(records.records) ? records.records : [],
        updateConfig: update.config || undefined,
      });
    } finally {
      setDesktopAdminLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab === 'desktop-admin' && isAdmin) void loadDesktopAdminData();
  }, [activeTab, isAdmin, loadDesktopAdminData]);

  const loadConnectorStatus = useCallback(async () => {
    if (!isAdmin) return;
    setConnectorStatus(prev => ({ ...prev, loading: true, error: undefined }));
    try {
      const [dccHealth, dccPreflight, dccTpl, creativeHealth, psTpl, aiTpl] = await Promise.all([
        fetch('/api/dcc/health').then(r => r.json()).catch(() => null),
        fetch('/api/dcc/preflight').then(r => r.json()).catch(() => null),
        fetch('/api/dcc/templates').then(r => r.json()).catch(() => ({ templates: [] })),
        fetch('/api/creative/health').then(r => r.json()).catch(() => null),
        fetch('/api/creative/templates?host=photoshop').then(r => r.json()).catch(() => ({ templates: [] })),
        fetch('/api/creative/templates?host=illustrator').then(r => r.json()).catch(() => ({ templates: [] })),
      ]);
      setConnectorStatus({
        dcc: connectorHealth(dccHealth),
        dccPreflight: connectorPreflight(dccPreflight),
        dccTemplates: connectorTemplates(dccTpl),
        creative: connectorHealth(creativeHealth),
        psTemplates: connectorTemplates(psTpl),
        aiTemplates: connectorTemplates(aiTpl),
        loading: false,
      });
    } catch (e) {
      setConnectorStatus(prev => ({ ...prev, loading: false, error: String(e) }));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab === 'connector-admin' && isAdmin) void loadConnectorStatus();
  }, [activeTab, isAdmin, loadConnectorStatus]);

  const saveEcomTemplate = useCallback(async (tpl: Record<string, unknown>) => {
    setIsEcomTplSaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: 'save', id: tpl.id, name: tpl.name, icon: tpl.icon, description: tpl.description,
        promptTemplate: tpl.prompt_template || tpl.promptTemplate, negativePrompt: tpl.negative_prompt || tpl.negativePrompt,
        aspectRatio: tpl.aspect_ratio || tpl.aspectRatio, category: tpl.category,
        fidelityAnchor: tpl.fidelity_anchor || tpl.fidelityAnchor, sortOrder: tpl.sort_order || tpl.sortOrder,
        isEnabled: tpl.is_enabled !== undefined ? tpl.is_enabled : tpl.isEnabled,
      };
      const resp = await fetch('/api/ecom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (data.success) { await loadEcomTemplates(); setEditingEcomTpl(null); setShowNewEcomTpl(false); }
      else alert(data.error || '保存失败');
    } catch { alert('保存失败'); }
    setIsEcomTplSaving(false);
  }, [loadEcomTemplates]);

  const deleteEcomTemplate = useCallback(async (id: string) => {
    if (!confirm('确定删除此模板？')) return;
    try { const resp = await fetch('/api/ecom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) }); if ((await resp.json()).success) setEcomTemplates(prev => prev.filter(t => t.id !== id)); } catch { /* ignore */ }
  }, []);

  const toggleEcomTemplateEnabled = useCallback(async (id: string, enabled: boolean) => {
    try { const resp = await fetch('/api/ecom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id, isEnabled: enabled }) }); if ((await resp.json()).success) setEcomTemplates(prev => prev.map(t => t.id === id ? { ...t, is_enabled: enabled } : t)); } catch { /* ignore */ }
  }, []);

  const moveEcomTemplateOrder = useCallback(async (id: string, direction: 'up' | 'down') => {
    try { await fetch('/api/ecom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder', id, direction }) }); await loadEcomTemplates(); } catch { /* ignore */ }
  }, [loadEcomTemplates]);

  useEffect(() => { if (isAdmin) void loadEcomTemplates(); }, [isAdmin, loadEcomTemplates]);

  // ─── Templates data ───
  const templates = [
    { id: 'brand-logo', name: '品牌Logo设计', desc: '多场景Logo生成与变体', category: '品牌设计', image: 'https://images.unsplash.com/photo-1626785774625-ddcddc3445e9?w=400&h=250&fit=crop', usage: '2.1k' },
    { id: 'ecommerce', name: '电商商品主图', desc: '白底/场景/细节三视图', category: '电商图', image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&h=250&fit=crop', usage: '1.8k' },
    { id: 'poster', name: '创意海报生成', desc: '活动推广海报设计', category: '创意海报', image: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&h=250&fit=crop', usage: '3.5k' },
    { id: 'portrait', name: '人物肖像精修', desc: 'AI人像美化与风格化', category: '人物肖像', image: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=250&fit=crop', usage: '1.2k' },
    { id: 'concept', name: '概念场景设计', desc: '科幻/奇幻场景生成', category: '概念场景', image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=250&fit=crop', usage: '980' },
    { id: 'social', name: '社交媒体套图', desc: '多平台适配图组', category: '社交媒体', image: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&h=250&fit=crop', usage: '2.4k' },
    { id: 'mockup', name: '产品样机展示', desc: 'Mockup场景化展示', category: '电商图', image: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=400&h=250&fit=crop', usage: '760' },
    { id: 'ip-char', name: 'IP角色设计', desc: '从草稿到三视图', category: '品牌设计', image: 'https://images.unsplash.com/photo-1608889825103-eb5ed706fc64?w=400&h=250&fit=crop', usage: '540' },
  ];

  const brands = [
    { id: '1', name: 'TechVision', color: '#4A90D9', keywords: ['科技', '创新', '未来感'] },
    { id: '2', name: 'GreenLeaf', color: '#4CAF50', keywords: ['自然', '有机', '环保'] },
  ];

  // =================== RENDER ===================
  return (
    <div className="dashboard-root h-screen w-screen flex overflow-hidden" style={{ '--dash-accent': accentHex, '--dash-accent-light': isMonochrome ? 'rgba(59,130,246,0.1)' : 'rgba(212,175,55,0.15)', '--dash-accent-mid': isMonochrome ? 'rgba(59,130,246,0.2)' : 'rgba(212,175,55,0.2)', '--dash-accent-ring': isMonochrome ? 'rgba(59,130,246,0.3)' : 'rgba(212,175,55,0.3)', '--dash-accent-hover': isMonochrome ? '#2563eb' : '#e0b840', '--dash-accent-text': isMonochrome ? '#fff' : '#000', } as React.CSSProperties }>
      {/* ===== Sidebar ===== */}
      <aside className={`w-[136px] shrink-0 flex flex-col sm:w-[220px] md:w-[260px] ${isDark ? 'bg-[#0e0e1a]' : 'bg-white'} border-r ${isDark ? 'border-white/5' : 'border-gray-200'} overflow-hidden`}>
        {/* User info */}
        <div className="p-4">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setShowUserProfile(!showUserProfile)}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 hover:ring-2 ${accentRingClass} transition-all`} style={{ backgroundColor: accentColor }} title="查看用户信息">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-semibold truncate ${textPrimary}`}>{user.name}</div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${isAdmin ? `${accentBgLight} ${accentClass}` : isDark ? 'bg-white/5 text-gray-500' : 'bg-gray-100 text-gray-500'}`}>
                  {isAdmin ? '管理员' : '创作者'}
                </span>
              </div>
            </div>
            <ChevronRight className={`w-4 h-4 ${textSecondary} transition-transform duration-200 ${showUserProfile ? 'rotate-90' : ''}`} />
          </div>

          {/* User profile expandable */}
          {showUserProfile && (
            <div className={`mt-3 rounded-xl p-3 space-y-2.5 ${isDark ? 'bg-[#12121e] border border-white/5' : 'bg-gray-50 border border-gray-100'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] uppercase tracking-wider font-semibold ${textSecondary}`}>账户信息</span>
                <button onClick={(e) => { e.stopPropagation(); setShowUserProfile(false); }} className={`p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-200'}`}><X className={`w-3 h-3 ${textSecondary}`} /></button>
              </div>
              <div className={`text-[11px] space-y-1.5 ${textSecondary}`}>
                <div className="flex items-center gap-2"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{user.email || '未设置邮箱'}</span></div>
                <div className="flex items-center gap-2"><Calendar className="w-3 h-3 shrink-0" /><span>加入于 {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '未知'}</span></div>
              </div>
              <div>
                <div className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${textSecondary}`}>功能权限</div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: 'image', label: '图像', icon: '🎨' }, { key: 'chat', label: '对话', icon: '💬' },
                    { key: 'threeD', label: '3D', icon: '🧊' },
                    { key: 'vectorize', label: '矢量', icon: '📐' }, { key: 'layer', label: '分层', icon: '🗂️' },
                    { key: 'upscaler', label: '放大', icon: '🔍' }, { key: 'removebg', label: '抠图', icon: '✂️' }, { key: 'video', label: '视频', icon: '🎬' }, { key: 'audio', label: '音频', icon: '🔊' },
                  ].map(perm => {
                    const enabled = user.apiPermissions?.[perm.key as keyof typeof user.apiPermissions] ?? true;
                    return (<span key={perm.key} className={`text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1 ${enabled ? `${accentBgLight} ${accentClass}` : isDark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-300'}`}><span>{perm.icon}</span><span>{perm.label}</span></span>);
                  })}
                </div>
              </div>
              <button onClick={() => { if (onLogout) onLogout(); }} className="w-full text-xs font-medium flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors cursor-pointer">
                <LogOut className="w-3.5 h-3.5" /> 退出登录
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-1 min-h-0 overflow-y-auto">
          {/* Regular tabs - filtered by productType */}
          {[
            ...(user.productType?.includes('canvas') ? [
              { key: 'projects' as TabType, label: '我的项目', icon: FolderOpen, count: projects.length },
              { key: 'templates' as TabType, label: '模板广场', icon: LayoutTemplate, count: null },
              { key: 'assets' as TabType, label: '资产库', icon: Layers, count: allImages.length },
              { key: 'stats' as TabType, label: '统计', icon: BarChart3, count: null },
            ] : []),
            ...(user.productType?.includes('chat') ? [
              { key: 'chat' as TabType, label: '智能对话', icon: MessageSquareMore, count: chatProjects.length },
            ] : []),
            { key: 'settings' as TabType, label: '设置', icon: Settings, count: null },
            { key: 'credits' as TabType, label: '积分', icon: Wallet, count: creditsBalance > 0 ? creditsBalance : null },
          ].map(item => (
            <button key={item.key} onClick={() => setActiveTab(item.key)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${activeTab === item.key ? `${accentBgLight} ${accentClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}`}>
              <item.icon className="w-4.5 h-4.5" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.count !== null && <span className={`text-xs ${activeTab === item.key ? accentClass : textSecondary}`}>{item.count}</span>}
            </button>
          ))}

          {/* Admin tabs (only visible for admins) */}
          {isAdmin && (
            <>
              <div className={`pt-3 pb-1 mt-2 border-t ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                <span className={`text-[10px] uppercase tracking-wider font-semibold ${textSecondary} px-3`}>管理</span>
              </div>
              {[
                { key: 'overview' as TabType, label: '运营总览', icon: BarChart3, count: null },
                { key: 'users' as TabType, label: '用户管理', icon: Users, count: adminUsers.length },
                { key: 'groups' as TabType, label: '分组管理', icon: Layers, count: adminGroups.length },
                { key: 'credits' as TabType, label: '积分管理', icon: Wallet, count: null },
                { key: 'audit' as TabType, label: '操作日志', icon: ShieldCheck, count: null },
                { key: 'apis' as TabType, label: 'API 管理', icon: Server, count: providers.length },
                { key: 'media-gateway' as TabType, label: '媒体网关', icon: KeyRound, count: null },
                { key: 'desktop-admin' as TabType, label: '本地无界', icon: HardDrive, count: desktopAdminData.devices.length },
                { key: 'connector-admin' as TabType, label: '插件连接器', icon: Plug, count: null },
                { key: 'data' as TabType, label: '数据管理', icon: Database, count: null },
                { key: 'payment-config' as TabType, label: '支付配置', icon: CreditCard, count: null },
                { key: 'ecom-templates' as TabType, label: '电商模板', icon: ShoppingBag, count: ecomTemplates.length },
              ].map(item => (
                <button key={item.key} onClick={() => setActiveTab(item.key)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${activeTab === item.key ? `${accentBgLight} ${accentClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}`}>
                  <item.icon className="w-4.5 h-4.5" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.count !== null && <span className={`text-xs ${activeTab === item.key ? accentClass : textSecondary}`}>{item.count}</span>}
                </button>
              ))}
            </>
          )}
        </nav>

        {/* Bottom: Recent activity */}
        <div className={`p-3 border-t ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
          <div className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${textSecondary}`}>最近动态</div>
          <div className="space-y-1.5">
            {recentActivity.slice(0, 3).map(a => (
              <div key={a.id} className={`text-[11px] flex items-center gap-2 ${textSecondary}`}>
                <Clock className="w-3 h-3 shrink-0" />
                <span className="truncate flex-1">{a.name}</span>
                <span className="shrink-0">{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      <main className="dashboard-scrollable flex-1 min-w-0 min-h-0">
        {/* ── Tab: Projects ── */}
        {activeTab === 'projects' && (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className={`px-8 pt-8 pb-4 ${isDark ? 'bg-[#0a0a0f]' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={`text-2xl font-bold ${textPrimary}`}>我的项目</h1>
                  <p className={`text-sm mt-1 ${textSecondary}`}>{projects.length} 个项目 · {allImages.length} 张图片</p>
                </div>
                 <div className="flex items-center gap-3">
                   <div className="relative">
                     <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${textSecondary}`} />
                     <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索项目..." className={`pl-9 pr-4 py-2 rounded-xl text-sm ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-gray-200'} border focus:outline-none focus:ring-1 ${accentRingClass} w-56`} />
                   </div>
                   {projectManageMode ? (
                     <>
                       <button onClick={toggleSelectAllProjects} disabled={filteredProjects.length === 0} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-white border-gray-200 hover:bg-gray-100'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                         {filteredProjects.length > 0 && filteredProjects.every(project => selectedProjectIds.has(project.id)) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                         全选
                       </button>
                       <button onClick={handleBatchDeleteProjects} disabled={selectedProjectIds.size === 0 || projectDeleteLoading} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                         {projectDeleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                         删除 {selectedProjectIds.size > 0 ? `(${selectedProjectIds.size})` : ''}
                       </button>
                       <button onClick={exitProjectManageMode} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-white border-gray-200 hover:bg-gray-100'}`}>
                         <X className="w-4 h-4" /> 完成
                       </button>
                     </>
                   ) : (
                     <button onClick={() => setProjectManageMode(true)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-white border-gray-200 hover:bg-gray-100'}`}>
                       <CheckSquare className="w-4 h-4" /> 批量管理
                     </button>
                   )}
                   {!projectManageMode && (
                     <>
                       <button onClick={importProjectInputRef} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${isDark ? `bg-white/5 border border-white/10 ${accentClass} hover:bg-white/10` : `bg-gray-100 border border-gray-200 ${isMonochrome ? 'text-[#3b82f6]' : 'text-gray-700'} hover:bg-gray-200`}`}>
                         <Upload className="w-4 h-4" /> 导入 .wujie
                       </button>
                       <button onClick={onNewProject} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${accentBgClass} ${accentTextOnBgClass} ${accentHoverBgClass} transition-colors cursor-pointer`}>
                         <Plus className="w-4 h-4" /> 新建项目
                       </button>
                     </>
                   )}
                </div>
              </div>
              {/* Filters */}
              <div className="flex gap-2 mt-4">
                {(['all', 'recent', 'starred'] as const).map(f => (
                  <button key={f} onClick={() => setProjectFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${projectFilter === f ? `${accentBgLight} ${accentClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}`}>
                    {{ all: '全部', recent: '最近', starred: '收藏' }[f]}
                  </button>
                ))}
              </div>
            </div>
            {/* Project Grid */}
            <div className="flex-1 overflow-y-auto px-8 pb-8">
              {filteredProjects.length === 0 ? (
                <div className={`flex flex-col items-center justify-center h-64 ${textSecondary}`}>
                  <FolderOpen className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">{searchQuery ? '没有找到匹配的项目' : '还没有项目，点击"新建项目"开始创作'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
                   {filteredProjects.map(project => {
                     const imgs = project.canvasImages || [];
                     const thumb = imgs.length > 0 ? imgs[imgs.length - 1]?.url : null;
                     const isRenaming = renamingProjectId === project.id;
                     const isSelected = selectedProjectIds.has(project.id);
                     return (
                       <div
                         key={project.id}
                         onClick={() => {
                           if (projectManageMode) toggleProjectSelection(project.id);
                           else if (!isRenaming) onOpenProject(project);
                         }}
                         aria-selected={projectManageMode ? isSelected : undefined}
                         className={`group rounded-xl border cursor-pointer transition-all hover:shadow-lg ${accentShadowClass} ${isSelected ? 'ring-2 ring-primary border-primary' : `${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'} ${accentHoverBorderClass}`}`}
                       >
                         {/* Thumbnail */}
                         <div className={`relative h-36 overflow-hidden rounded-t-xl ${isDark ? 'bg-gradient-to-br from-[#1a1a2e] to-[#0a0a0f]' : 'bg-gradient-to-br from-blue-50 to-gray-50'}`}>
                           {thumb ? <img src={thumb} alt={project.name} className="w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full"><Image className={`w-8 h-8 ${textSecondary} opacity-30`} /></div>}
                           {projectManageMode && (
                             <span className={`absolute top-2 left-2 w-6 h-6 rounded-md border flex items-center justify-center shadow-sm ${isSelected ? `${accentBgClass} ${accentTextOnBgClass} border-transparent` : isDark ? 'bg-black/60 border-white/30 text-white' : 'bg-white/90 border-gray-300 text-gray-500'}`}>
                               {isSelected && <Check className="w-4 h-4" />}
                             </span>
                           )}
                           {starredIds.has(project.id) && <Star className={`absolute top-2 right-2 w-4 h-4 ${accentClass} fill-current`} style={{ color: accentHex }} />}
                        </div>
                        {/* Info */}
                        <div className="p-3">
                          {isRenaming ? (
                            <div className="flex items-center gap-1">
                              <input value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(); if (e.key === 'Escape') { setRenamingProjectId(null); setRenameValue(''); } }} onClick={e => e.stopPropagation()} autoFocus className={`flex-1 h-7 px-2 rounded text-sm ${inputClass}`} />
                              <Check className="w-4 h-4 text-green-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); handleConfirmRename(); }} />
                            </div>
                          ) : (
                            <h3 className={`text-sm font-semibold truncate ${textPrimary}`}>{project.name}</h3>
                          )}
                          <div className={`flex items-center justify-between mt-1`}>
                            <span className={`text-xs ${textSecondary}`}>{imgs.length} 张图片</span>
                            {!projectManageMode && (
                              <div className="flex items-center gap-1">
                               <button onClick={(e) => toggleStar(project.id, e)} className={`p-1 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}>
                                 <Star className={`w-3 h-3 ${starredIds.has(project.id) ? accentClass : textSecondary}`} style={starredIds.has(project.id) ? { color: accentHex, fill: accentHex } : undefined} />
                               </button>
                              <div className="relative" data-project-menu>
                                <button onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === project.id ? null : project.id); }} className={`p-1 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}>
                                  <MoreVertical className={`w-3 h-3 ${textSecondary}`} />
                                </button>
                                {menuOpenId === project.id && (
                                  <div className={`absolute right-0 top-6 z-20 rounded-xl border shadow-xl py-1 min-w-[120px] ${isDark ? 'bg-[#1a1a2e] border-white/10' : 'bg-white border-gray-200'}`}>
                                    <button onClick={(e) => { e.stopPropagation(); handleRenameProject(project.id, project.name); }} className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}><Pencil className="w-3 h-3" />重命名</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleExportProject(project); }} className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}><ArrowRight className="w-3 h-3" />导出 .wujie</button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMenuOpenId(null);
                                        setShareManagementProject(project);
                                      }}
                                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}
                                    >
                                      <Share2 className="w-3 h-3" aria-hidden="true" />管理分享
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }} className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 text-red-400 hover:bg-red-500/10"><Trash2 className="w-3 h-3" />删除</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Templates ── */}
        {activeTab === 'templates' && (
          <div className="h-full overflow-y-auto px-8 py-8">
            <h1 className={`text-2xl font-bold mb-1 ${textPrimary}`}>模板广场</h1>
            <p className={`text-sm mb-6 ${textSecondary}`}>选择模板快速开始创作</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {templates.map(t => (
                <div key={t.id} className={`group rounded-xl border overflow-hidden cursor-pointer transition-all hover:shadow-lg ${accentShadowClass} ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'} ${accentHoverBorderClass}`} onClick={() => handleUseTemplate(t)}>
                  <div className="relative h-40 overflow-hidden">
                    <img src={t.image} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    <div className="absolute top-2 left-2"><span className={`text-[10px] px-2 py-0.5 rounded-full ${accentBgLight} ${accentClass} font-medium`}>{t.category}</span></div>
                    <div className="absolute top-2 right-2"><span className={`text-[10px] px-2 py-0.5 rounded-full ${isDark ? 'bg-black/50 text-white' : 'bg-white/80 text-gray-700'}`}>{t.usage} 次使用</span></div>
                  </div>
                  <div className="p-3">
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>{t.name}</h3>
                    <p className={`text-xs mt-1 ${textSecondary}`}>{t.desc}</p>
                    <button className={`mt-2 w-full py-1.5 rounded-lg text-xs font-medium ${accentBgLight} ${accentClass} ${isMonochrome ? 'hover:bg-[#3b82f6]/20' : 'hover:bg-[#d4af37]/20'} transition-colors`}>使用模板</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tab: Assets ── */}
        {activeTab === 'assets' && (
          <div className="h-full flex flex-col">
            <div className={`px-8 pt-8 pb-4 ${isDark ? 'bg-[#0a0a0f]' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h1 className={`text-2xl font-bold ${textPrimary}`}>资产库</h1>
                  {unavailableAssetCount > 0 && <span className="text-xs text-amber-500">{unavailableAssetCount} 个媒体需要恢复</span>}
                </div>
                <div className="flex items-center gap-2">
                  {/* View mode toggle */}
                  <button onClick={() => setAssetViewMode(assetViewMode === 'grid' ? 'list' : 'grid')} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-200'} cursor-pointer`} title={assetViewMode === 'grid' ? '列表模式' : '大图模式'}>
                    {assetViewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
                  </button>
                  {/* Sort menu */}
                  <button onClick={() => setAssetSortOrder(assetSortOrder === 'newest' ? 'oldest' : 'newest')} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-200'} cursor-pointer`} title={assetSortOrder === 'newest' ? '切换为最早优先' : '切换为最新优先'}>
                    <ArrowUpDown className="w-4 h-4" />
                  </button>
                  {/* Manage mode toggle */}
                  <button onClick={() => { setAssetManageMode(!assetManageMode); setSelectedAssetIds(new Set()); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${assetManageMode ? `${accentBgLight} ${accentClass}` : `${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-200'} ${textSecondary}`}`}>
                    {assetManageMode ? '退出管理' : '批量管理'}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 mt-4 items-center flex-wrap">
                {(['images', 'prompts', 'brands'] as const).map(t => (
                  <button key={t} onClick={() => setAssetTab(t)} className={`px-4 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${assetTab === t ? `${accentBgLight} ${accentClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}`}>
                    {{ images: '图片', prompts: '提示词', brands: '品牌' }[t]}
                  </button>
                ))}
                {assetTab === 'images' && (
                  <div className="flex gap-1 ml-4">
                    {(['all', 'generated', 'uploaded'] as const).map(f => (
                      <button key={f} onClick={() => setImageFilter(f)} className={`px-2 py-1 rounded text-[10px] ${imageFilter === f ? accentClass : textSecondary}`}>
                        {{ all: '全部', generated: 'AI生成', uploaded: '上传' }[f]}
                      </button>
                    ))}
                  </div>
                )}
                {assetManageMode && assetTab === 'images' && (
                  <div className="flex gap-2 ml-auto items-center">
                    <button onClick={toggleSelectAllAssets} className={`text-xs ${accentClass} hover:underline cursor-pointer`}>
                      {selectedAssetIds.size === filteredImages.length ? '取消全选' : '全选'}
                    </button>
                    {selectedAssetIds.size > 0 && (
                      <>
                        <button onClick={handleBatchDeleteAssets} className="text-xs text-red-400 hover:underline cursor-pointer">删除({selectedAssetIds.size})</button>
                        <button onClick={handleBatchDownload} className="text-xs text-blue-400 hover:underline cursor-pointer">下载({selectedAssetIds.size})</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-8 pb-8">
              {assetTab === 'images' && (
                filteredImages.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center h-64 ${textSecondary}`}><Image className="w-12 h-12 mb-3 opacity-30" /><p className="text-sm">暂无图片</p></div>
                ) : assetViewMode === 'grid' ? (
                  /* Grid mode */
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-4">
                    {filteredImages.map((img, idx) => (
                      <div key={img.id || idx} className={`group rounded-xl border overflow-hidden ${assetManageMode && selectedAssetIds.has(img.id) ? `${accentBorderClass} ring-1 ring-primary/30` : isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'} ${assetManageMode ? 'cursor-pointer' : ''}`} onClick={() => assetManageMode && toggleAssetSelection(img.id)}>
                        {assetManageMode && (
                          <div className="absolute top-2 left-2 z-10">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedAssetIds.has(img.id) ? `${accentBgLight} ${accentClass} border-primary` : 'border-gray-400 bg-black/30'}`}>
                              {selectedAssetIds.has(img.id) && <span className="text-[10px]">✓</span>}
                            </div>
                          </div>
                        )}
                        <div className="h-28 overflow-hidden relative"><img src={img.url} alt="" className="w-full h-full object-cover" />{img.mediaType === 'video' && <div className="absolute inset-0 flex items-center justify-center bg-black/30"><Film className="w-6 h-6 text-white" /></div>}</div>
                        <div className="p-2">
                          {(img.prompt || img.model) && (
                            <p className={`text-[10px] line-clamp-2 mb-1 ${textSecondary}`}>{img.prompt || '(无提示词)'}</p>
                          )}
                          <div className="flex items-center gap-1 flex-wrap">
                            {img.modelName && <span className={`text-[9px] px-1 py-0.5 rounded ${accentBgLight} ${accentClass}`}>{img.modelName.length > 12 ? img.modelName.slice(0, 12) + '…' : img.modelName}</span>}
                            {img.aspectRatio && <span className={`text-[9px] px-1 py-0.5 rounded ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'}`}>{img.aspectRatio}</span>}
                            {img.quality && <span className={`text-[9px] px-1 py-0.5 rounded ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'}`}>{img.quality}</span>}
                          </div>
                          <p className={`text-[9px] truncate mt-1 ${textSecondary}`}>{img.projectName}</p>
                          {!assetManageMode && (
                            <div className="flex gap-1 mt-1.5">
                              <button onClick={(e) => { e.stopPropagation(); handleMakeSame(img); }} className={`text-[9px] px-1.5 py-0.5 rounded ${accentBgLight} ${accentClass} hover:opacity-80 cursor-pointer`}>同款</button>
                              <button onClick={(e) => { e.stopPropagation(); handleCopyImageInfo(img); }} className={`text-[9px] px-1.5 py-0.5 rounded ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'} hover:opacity-80 cursor-pointer`}>{copiedIdx === img.id ? '已复制' : '复制'}</button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* List mode */
                  <div className="space-y-2 mt-4">
                    {filteredImages.map((img, idx) => (
                      <div key={img.id || idx} className={`group flex gap-3 rounded-xl border p-3 ${assetManageMode && selectedAssetIds.has(img.id) ? `${accentBorderClass} ring-1 ring-primary/30` : isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'} ${assetManageMode ? 'cursor-pointer' : ''}`} onClick={() => assetManageMode && toggleAssetSelection(img.id)}>
                        {assetManageMode && (
                          <div className="flex items-center">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedAssetIds.has(img.id) ? `${accentBgLight} ${accentClass} border-primary` : 'border-gray-400'}`}>
                              {selectedAssetIds.has(img.id) && <span className="text-[10px]">✓</span>}
                            </div>
                          </div>
                        )}
                        <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0"><img src={img.url} alt="" className="w-full h-full object-cover" /></div>
                        <div className="flex-1 min-w-0">
                          {(img.prompt || img.model) && (
                            <p className={`text-xs line-clamp-2 ${textPrimary}`}>{img.prompt || '(无提示词)'}</p>
                          )}
                          <div className="flex items-center gap-1 flex-wrap mt-1">
                            {img.modelName && <span className={`text-[9px] px-1 py-0.5 rounded ${accentBgLight} ${accentClass}`}>{img.modelName}</span>}
                            {img.aspectRatio && <span className={`text-[9px] px-1 py-0.5 rounded ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'}`}>{img.aspectRatio}</span>}
                            {img.quality && <span className={`text-[9px] px-1 py-0.5 rounded ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'}`}>{img.quality}</span>}
                            {img.size && <span className={`text-[9px] px-1 py-0.5 rounded ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'}`}>{img.size}</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[9px] ${textSecondary}`}>{img.projectName}</span>
                            {img.createdAt && <span className={`text-[9px] ${textSecondary}`}>{new Date(img.createdAt).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        {!assetManageMode && (
                          <div className="flex flex-col gap-1 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); handleMakeSame(img); }} className={`text-[9px] px-2 py-1 rounded ${accentBgLight} ${accentClass} hover:opacity-80 cursor-pointer whitespace-nowrap`}>制作同款</button>
                            <button onClick={(e) => { e.stopPropagation(); handleCopyImageInfo(img); }} className={`text-[9px] px-2 py-1 rounded ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'} hover:opacity-80 cursor-pointer whitespace-nowrap`}>{copiedIdx === img.id ? '已复制' : '复制关键词'}</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
              {assetTab === 'prompts' && (
                allPrompts.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center h-64 ${textSecondary}`}><Sparkles className="w-12 h-12 mb-3 opacity-30" /><p className="text-sm">暂无提示词</p></div>
                ) : (
                  <div className="space-y-2 mt-4">
                    {allPrompts.map((p, idx) => (
                      <div key={idx} className={`rounded-xl border p-3 ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
                        <p className={`text-sm ${textPrimary} line-clamp-2`}>{p.text}</p>
                        <div className={`flex items-center justify-between mt-2`}>
                          <span className={`text-[10px] ${textSecondary}`}>{p.projectName}{p.model ? ` · ${p.model}` : ''}</span>
                          <button onClick={() => handleCopyPrompt(p.text, idx)} className={`text-[10px] ${accentClass} hover:underline cursor-pointer`}>{copiedIdx === idx ? '已复制' : '复制'}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
              {assetTab === 'brands' && (
                <div className="space-y-3 mt-4">
                  {brands.map(b => (
                    <div key={b.id} className={`rounded-xl border p-4 ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg" style={{ backgroundColor: b.color }} />
                        <div><h3 className={`text-sm font-semibold ${textPrimary}`}>{b.name}</h3><div className="flex gap-1 mt-1">{b.keywords.map(k => <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded ${accentBgLight} ${accentClass}`}>{k}</span>)}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Stats ── */}
        {activeTab === 'stats' && (() => {
          const freshStats = mgr.getUsageStats();
          const totalRequests = freshStats.reduce((a: number, s: UsageStats) => a + (s.requests || 0), 0);
          const totalImages = freshStats.reduce((a: number, s: UsageStats) => a + (s.imagesGenerated || 0), 0);
          const totalVideos = freshStats.reduce((a: number, s: UsageStats) => a + (s.videosGenerated || 0), 0);
          const totalEdits = freshStats.reduce((a: number, s: UsageStats) => a + (s.editsPerformed || 0), 0);
          const total3d = freshStats.reduce((a: number, s: UsageStats) => a + (s.models3dGenerated || 0), 0);
          const totalChats = freshStats.reduce((a: number, s: UsageStats) => a + (s.chatsCount || 0), 0);
          const totalErase = freshStats.reduce((a: number, s: UsageStats) => a + (s.eraseCount || 0), 0);
          const totalRemoveBg = freshStats.reduce((a: number, s: UsageStats) => a + (s.removeBgCount || 0), 0);
          const totalUpscale = freshStats.reduce((a: number, s: UsageStats) => a + (s.upscaleCount || 0), 0);
          // Also count actual images in projects as a real data source
          const projectImageCount = allImages.length;
          const projectCount = projects.length;
          const genMax = Math.max(totalImages, totalVideos, total3d, totalChats, 1);
          const editMax = Math.max(totalEdits, totalErase, totalRemoveBg, totalUpscale, 1);
          const barColor = 'bg-primary';
          const barBg = 'bg-muted';
          return (
          <div className="h-full overflow-y-auto p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-bold text-foreground">统计</h1>
                <p className="text-sm text-muted-foreground mt-0.5">查看你的使用数据和用量统计</p>
              </div>
            </div>
            {/* 核心统计卡片 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: '项目总数', value: projectCount, icon: FolderOpen, desc: '画布项目' },
                { label: '图片总数', value: projectImageCount, icon: Image, desc: '画布中图片' },
                { label: '生成请求', value: totalRequests, icon: Zap, desc: 'API调用次数' },
                { label: '编辑操作', value: totalEdits, icon: Pencil, desc: '图片编辑次数' },
              ].map((s, i) => (
                <div key={i} className="rounded-xl border border-border/50 bg-card p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <s.icon className="w-4 h-4 text-primary" />
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                </div>
              ))}
            </div>
            {/* 详细统计 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              <div className="rounded-xl border border-border/50 bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">生成统计</h3>
                <div className="space-y-3">
                  {[
                    { label: 'AI 图片生成', value: totalImages },
                    { label: 'AI 视频生成', value: totalVideos },
                    { label: '3D 模型生成', value: total3d },
                    { label: '聊天对话', value: totalChats },
                  ].map((item, i) => (
                    <div key={i}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                        <span className="text-xs font-medium text-foreground">{item.value}</span>
                      </div>
                      <div className={`h-2 rounded-full ${barBg}`}>
                        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${Math.min((item.value / genMax) * 100, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-border/50 bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">编辑统计</h3>
                <div className="space-y-3">
                  {[
                    { label: '图片编辑', value: totalEdits },
                    { label: '擦除/修复', value: totalErase },
                    { label: '背景移除', value: totalRemoveBg },
                    { label: '图片放大', value: totalUpscale },
                  ].map((item, i) => (
                    <div key={i}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                        <span className="text-xs font-medium text-foreground">{item.value}</span>
                      </div>
                      <div className={`h-2 rounded-full ${barBg}`}>
                        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${Math.min((item.value / editMax) * 100, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {freshStats.length === 0 && projectImageCount === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">暂无统计数据，开始创作后数据将自动记录</p>
              </div>
            )}
          </div>
          );
        })()}

        {activeTab === 'settings' && !isAdmin && (
          <UserSettingsTab
            isDark={!isMonochrome}
            isMonochrome={!!isMonochrome}
            onToggleTheme={(_theme) => {
              // Theme toggle resets monochrome mode
              if (onSetIsMonochrome) onSetIsMonochrome(false);
            }}
            userName={user?.name || ''}
            userRole={user?.role || 'user'}
            onToast={(msg) => toast.success(msg)}
          />
        )}

        {activeTab === 'credits' && !isAdmin && (
          <UserCreditsTab
            userId={user.id}
            isDark={!isMonochrome}
            onToast={(msg) => toast.success(msg)}
          />
        )}

        {/* ── Admin Tabs Component ── */}
        {['overview', 'audit', 'users', 'groups', 'credits', 'settings'].includes(activeTab) && isAdmin && (
          <AdminTabs
            activeTab={activeTab}
            adminUsers={adminUsers.map((u): AdminTabsUser => ({
              id: u.id,
              name: u.name,
              role: u.role ?? 'user',
              status: u.status ?? 'active',
              email: u.email,
              createdAt: u.createdAt,
              credits: u.credits,
              project_count: u.project_count,
              last_login: u.last_login,
              apiPermissions: u.apiPermissions,
              productType: u.productType,
              chatModels: resolveVisibleModelAssignments(u.chatModels, adminChatModelOptions),
              imageModels: resolveVisibleModelAssignments(u.imageModels, adminImageModelOptions),
              dailyTokenLimit: u.dailyTokenLimit,
              monthlyTokenLimit: u.monthlyTokenLimit,
              dailyImageLimit: u.dailyImageLimit,
              groupId: u.groupId,
            }))}
            adminGroups={adminGroups.map((group): AdminTabsGroup => ({
              ...group,
              created_at: String(group.created_at),
              updated_at: String(group.updated_at),
            }))}
            onRefreshAdmin={refreshAdmin}
            onCreateUser={async (name: string, password: string, email?: string, groupId?: string) => {
              const res = await fetch('/api/admin/users', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ action: 'create', name: name.trim(), password: password.trim(), email: email?.trim() || undefined, groupId: groupId || undefined }),
              });
              const data = await res.json();
              if (data.success) {
                toast.success(`用户 ${name} 创建成功`);
                await refreshAdmin();
                window.dispatchEvent(new Event('wujie-admin-users-updated'));
              } else {
                toast.error(data.error || '创建失败');
              }
            }}
            onRenameUser={async (userId: string, newName: string) => {
              await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId, updates: { name: newName.trim() } }) });
              await refreshAdmin();
              window.dispatchEvent(new Event('wujie-admin-users-updated'));
            }}
            onResetPassword={async (userId: string, newPassword: string) => {
              await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId, updates: { password: newPassword.trim() } }) });
            }}
            onToggleUser={async (user: AdminTabsUser) => {
              await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId: user.id, updates: { status: user.status === 'disabled' ? 'active' : 'disabled' } }) });
              await refreshAdmin();
              window.dispatchEvent(new Event('wujie-admin-users-updated'));
            }}
            onDeleteUser={(user: AdminTabsUser) => {
              if (user.role === 'admin') return;
              setConfirmDlg({
                open: true, title: '删除用户', message: `确定删除用户 ${user.name} 吗？该用户的本地项目数据会一并移除。`,
                onConfirm: async () => {
                  await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'delete', userId: user.id }) });
                  await refreshAdmin();
                  window.dispatchEvent(new Event('wujie-admin-users-updated'));
                  setConfirmDlg(prev => ({ ...prev, open: false }));
                },
                onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
              });
            }}
            onBatchDeleteUsers={(users: AdminTabsUser[]) => new Promise<boolean>(resolve => {
              const protectedCount = users.filter(user => user.role === 'admin').length;
              const suffix = protectedCount > 0 ? `，其中 ${protectedCount} 个管理员账号将自动跳过` : '';
              setConfirmDlg({
                open: true,
                title: '批量删除用户',
                message: `确定删除选中的 ${users.length} 个用户吗${suffix}？此操作不可撤销。`,
                variant: 'danger',
                onConfirm: async () => {
                  try {
                    const response = await fetch('/api/admin/users', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ action: 'batch-delete', userIds: users.map(user => user.id) }),
                    });
                    const data = await response.json();
                    if (!response.ok || !data.success) {
                      throw new Error(data.error || '批量删除失败');
                    }
                    await refreshAdmin();
                    window.dispatchEvent(new Event('wujie-admin-users-updated'));
                    if (data.skippedIds?.length > 0) {
                      toast.warning(`已删除 ${data.deletedIds?.length || 0} 个用户，跳过 ${data.skippedIds.length} 个管理员或无效用户`);
                    } else {
                      toast.success(`已删除 ${data.deletedIds?.length || 0} 个用户`);
                    }
                    resolve(true);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : '批量删除失败');
                    resolve(false);
                  } finally {
                    setConfirmDlg(prev => ({ ...prev, open: false }));
                  }
                },
                onCancel: () => {
                  setConfirmDlg(prev => ({ ...prev, open: false }));
                  resolve(false);
                },
              });
            })}
            onToggleUserPermission={async (user: AdminTabsUser, key: string) => {
              const current: Record<string, boolean> = {
                image: user.apiPermissions?.image ?? true, chat: user.apiPermissions?.chat ?? true,
                threeD: user.apiPermissions?.threeD ?? true,
                vectorize: user.apiPermissions?.vectorize ?? true, layer: user.apiPermissions?.layer ?? true,
                video: user.apiPermissions?.video ?? true, vlm: user.apiPermissions?.vlm ?? true,
                upscaler: user.apiPermissions?.upscaler ?? true,
                removebg: user.apiPermissions?.removebg ?? true,
                audio: user.apiPermissions?.audio ?? true,
              };
              current[key] = !current[key];
              await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId: user.id, updates: { apiPermissions: current } }) });
              await refreshAdmin();
            }}
            onRechargeCredits={async (userId: string, amount: number, description: string) => {
              await fetch('/api/admin/credits/recharge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ userId, amount, description }) });
              await refreshAdmin();
            }}
            providers={providers.map((p): AdminTabsProvider => ({
              id: p.id,
              name: p.name,
              base_url: p.baseUrl,
              api_key: p.apiKey,
              model_type: p.modelType ?? p.type,
              selected_models: p.selectedModels ?? [],
              discovered_models: (p.discoveredModels ?? []).map((model) => model.id),
              isEnabled: p.isEnabled,
              balance: p.balance?.amount,
              balanceCurrency: p.balance?.currency,
              compatProfile: p.compatProfile,
              advancedParams: p.advancedParams,
              modelType: p.modelType,
              selectedModels: p.selectedModels,
            }))}
            onTabChange={(tab: string) => { setActiveTab(tab as TabType); }}
            onOpenApiManager={() => { setActiveTab('apis'); }}
            onUpdateUserGroup={async (userId: string, groupId: string) => {
              await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId, updates: { groupId: groupId || null } }) });
              await refreshAdmin();
            }}
            onUpdateUserModels={async (userId: string, chatModels: string[], imageModels: string[]) => {
              const normalizedChatModels = normalizeModelAssignmentsForSave(
                chatModels,
                adminChatModelOptions,
              );
              const normalizedImageModels = normalizeModelAssignmentsForSave(
                imageModels,
                adminImageModelOptions,
              );
              try {
                const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId, updates: { chatModels: normalizedChatModels, imageModels: normalizedImageModels } }) });
                const data = await response.json().catch(() => ({ success: false, error: '模型授权保存响应无效' })) as {
                  success?: boolean;
                  code?: string;
                  error?: string;
                };
                if (!response.ok || !data.success) {
                  if (data.code === 'MODEL_ASSIGNMENT_AMBIGUOUS') {
                    toast.error('存在同名模型，请重新选择具体供应商模型');
                  } else {
                    toast.error(data.error || '模型授权保存失败，请稍后重试');
                  }
                  return;
                }
              } catch {
                toast.error('模型授权保存失败，请检查网络后重试');
                return;
              }
              try {
                await refreshAdmin();
                toast.success('模型授权已保存');
              } catch {
                toast.warning('模型授权已保存，但列表刷新失败');
              }
            }}
            adminChatModels={adminChatModelOptions}
            adminImageModels={adminImageModelOptions}
          />
        )}

        {/* ── Tab: Group Management ── */}
        {activeTab === 'groups' && isAdmin && (
          <div className="h-full overflow-y-auto p-6 relative">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-foreground">分组管理</h1>
                <p className="text-sm text-muted-foreground">管理用户分组，统一设置产品权限与积分配额</p>
              </div>
              <button onClick={async () => { await refreshAdmin(); }} className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"><RefreshCw className="w-3.5 h-3.5" />刷新</button>
            </div>

            {/* Create Group */}
            <div className="bg-card rounded-xl border border-border p-4 mb-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">新建分组</h3>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">分组名称</label>
                  <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="如：品牌部、广告部" className={`px-3 py-2 rounded-lg text-sm w-40 border border-border bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30`} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">产品权限</label>
                  <div className="flex gap-1">
                    {['canvas', 'chat'].map(pt => (
                      <button key={pt} onClick={() => setNewGroupProductTypes(prev => prev.includes(pt) ? prev.filter(p => p !== pt) : [...prev, pt])} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${newGroupProductTypes.includes(pt) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                        {pt === 'canvas' ? '无限画布' : '智能对话'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">积分配额</label>
                  <input type="number" value={newGroupCreditQuota} onChange={e => setNewGroupCreditQuota(Number(e.target.value))} min={0} className={`px-3 py-2 rounded-lg text-sm w-28 border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30`} />
                </div>
                <button
                  onClick={async () => {
                    if (!newGroupName.trim()) return;
                    const res = await fetch('/api/admin/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'create', name: newGroupName.trim(), productTypes: newGroupProductTypes, creditQuota: newGroupCreditQuota, isActive: true }) });
                    if (res.ok) { setNewGroupName(''); setNewGroupProductTypes(['canvas']); setNewGroupCreditQuota(0); await refreshAdmin(); toast.success('分组已创建'); }
                  }}
                  disabled={!newGroupName.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                ><Plus className="w-3.5 h-3.5 inline mr-1" />创建</button>
              </div>
            </div>

            {/* Group List */}
            {adminGroups.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">暂无分组，请创建第一个分组</p>
              </div>
            ) : (
              <div className="space-y-2">
                {adminGroups.map(group => (
                  <div key={group.id} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
                    {editingGroupId === group.id ? (
                      <>
                        <input type="text" value={editGroupName} onChange={e => setEditGroupName(e.target.value)} className={`px-3 py-2 rounded-lg text-sm flex-1 border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30`} />
                        <div className="flex gap-1">
                          {['canvas', 'chat'].map(pt => (
                            <button key={pt} onClick={() => setEditGroupProductTypes(prev => prev.includes(pt) ? prev.filter(p => p !== pt) : [...prev, pt])} className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${editGroupProductTypes.includes(pt) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                              {pt === 'canvas' ? '画布' : '对话'}
                            </button>
                          ))}
                        </div>
                        <input type="number" value={editGroupCreditQuota} onChange={e => setEditGroupCreditQuota(Number(e.target.value))} min={0} className={`px-3 py-2 rounded-lg text-sm w-24 border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30`} />
                        <button onClick={() => setEditingGroupId(null)} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                        <button onClick={async () => {
                          await fetch('/api/admin/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', id: group.id, name: editGroupName.trim(), productTypes: editGroupProductTypes, creditQuota: editGroupCreditQuota, isActive: editGroupActive }) });
                          setEditingGroupId(null); await refreshAdmin(); toast.success('分组已更新');
                        }} className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"><Save className="w-3 h-3 inline mr-0.5" />保存</button>
                      </>
                    ) : (
                      <>
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${group.is_active ? 'bg-primary/15' : 'bg-destructive/15'}`}>
                          <Layers className={`w-5 h-5 ${group.is_active ? 'text-primary' : 'text-destructive'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">{group.name}</span>
                            {!group.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">已停用</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-muted-foreground">产品：</span>
                            {group.product_types && group.product_types.length > 0 ? group.product_types.map(pt => (
                              <span key={pt} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{pt === 'canvas' ? '无限画布' : '智能对话'}</span>
                            )) : <span className="text-[10px] text-muted-foreground">未设置</span>}
                            <span className="text-[11px] text-muted-foreground ml-2">积分配额：{group.credit_quota || '无限制'}</span>
                            <span className="text-[10px] text-muted-foreground ml-2">用户数：{adminUsers.filter(u => u.groupId === group.id).length}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setEditingGroupId(group.id); setEditGroupName(group.name); setEditGroupProductTypes([...group.product_types || []]); setEditGroupCreditQuota(group.credit_quota || 0); setEditGroupActive(group.is_active); }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => {
                            setConfirmDlg({ open: true, title: '删除分组', message: `确定删除分组「${group.name}」吗？`, onConfirm: async () => { await fetch('/api/admin/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'delete', id: group.id }) }); await refreshAdmin(); setConfirmDlg(prev => ({ ...prev, open: false })); toast.success('分组已删除'); }, onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })) });
                          }} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Chat (智能对话) ── */}
        {activeTab === 'chat' && (
          <div className="h-full overflow-y-auto p-6" onMouseEnter={loadChatProjects}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">智能对话</h1>
                <p className={`text-sm mt-1 ${textSecondary}`}>
                  {chatProjects.length} 个对话项目
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => window.location.href = '/simple-chat'}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${accentBgLight} ${accentClass} hover:opacity-90`}
                >
                  <Plus className="w-4 h-4" />
                  新建对话
                </button>
              </div>
            </div>

            {chatProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                  <MessageSquareMore className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <p className={`text-sm ${textSecondary}`}>暂无对话项目</p>
                <button
                  onClick={() => window.location.href = '/simple-chat'}
                  className={`mt-4 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${accentBgLight} ${accentClass} hover:opacity-90`}
                >
                  开始第一个对话
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {chatProjects.map(project => (
                  <div
                    key={project.id}
                    onClick={() => window.location.href = `/simple-chat?projectId=${project.id}`}
                    className="group cursor-pointer rounded-xl border border-border bg-card hover:shadow-lg transition-all duration-200 overflow-hidden"
                  >
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <span className="text-2xl">{project.emoji}</span>
                      </div>
                      <h3 className="font-semibold text-foreground mb-1 truncate">{project.name}</h3>
                      <p className={`text-xs ${textSecondary}`}>
                        {project.taskCount} 个对话 · {(() => {
                          const d = new Date(project.updatedAt);
                          const now = Date.now();
                          const diff = now - d.getTime();
                          const mins = Math.floor(diff / 60000);
                          if (mins < 60) return `${mins}分钟前`;
                          const hours = Math.floor(mins / 60);
                          if (hours < 24) return `${hours}小时前`;
                          return `${Math.floor(hours / 24)}天前`;
                        })()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: API Management ── */}
        {activeTab === 'apis' && isAdmin && (
          <div className="h-full overflow-y-auto p-6 relative" onMouseEnter={() => { if (!productionReadiness && !productionReadinessLoading) void refreshProductionReadiness(); if (!cloudTasks.length && !cloudTasksLoading) void refreshCloudTasks(); if (!Object.keys(providerTaskSummary).length) void refreshProviderTaskSummary(); }}>
            {/* ── Header with add button ── */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-foreground">API 管理</h1>
                <p className="text-sm text-muted-foreground">配置图像、对话、3D、矢量等模型接口</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => void refreshProductionReadiness()} className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"><ShieldCheck className={`w-3.5 h-3.5 ${productionReadinessLoading ? 'animate-pulse' : ''}`} />发布自检</button>
                <button onClick={() => void refreshBalances()} className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"><Activity className="w-3.5 h-3.5" />刷新余额</button>
                <button onClick={() => { void refreshAdmin(); }} className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"><RefreshCw className="w-3.5 h-3.5" />刷新列表</button>
                <button onClick={() => { resetApiForm(); setShowApiDrawer(true); }} className="text-xs px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"><Plus className="w-4 h-4" />添加 API</button>
              </div>
            </div>

            <section className="mb-4 rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /><div><h2 className="text-sm font-semibold text-foreground">发布前自检</h2><p className="text-[11px] text-muted-foreground">只检查云端数据库与已启用供应商配置，不调用供应商</p></div></div>
                <button onClick={() => void refreshProductionReadiness()} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer" title="刷新自检"><RefreshCw className={`w-3.5 h-3.5 ${productionReadinessLoading ? 'animate-spin' : ''}`} /></button>
              </div>
              {productionReadinessLoading && !productionReadiness ? <div className="px-4 py-5 text-xs text-muted-foreground">正在检查云端配置...</div> : productionReadinessLoadError ? <div role="alert" className="px-4 py-4 text-xs text-destructive flex items-center justify-between gap-3"><span>发布前自检加载失败：{productionReadinessLoadError}</span><button onClick={() => void refreshProductionReadiness()} className="shrink-0 underline underline-offset-2">重试</button></div> : !productionReadiness ? <div className="px-4 py-5 text-xs text-muted-foreground">尚未读取发布前自检结果</div> : (
                <div className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span className={`px-1.5 py-0.5 rounded ${productionReadiness.database.status === 'pass' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-destructive/15 text-destructive'}`}>任务数据库 {productionReadiness.database.status === 'pass' ? '可用' : '异常'}</span>
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">已配置 {productionReadiness.summary.total}</span>
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">已启用 {productionReadiness.summary.enabled}</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">可验收 {productionReadiness.summary.ready}</span>
                    {productionReadiness.summary.warnings > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">待补充 {productionReadiness.summary.warnings}</span>}
                    {productionReadiness.summary.failures > 0 && <span className="px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">配置异常 {productionReadiness.summary.failures}</span>}
                  </div>
                  {productionReadiness.providers.filter(provider => provider.status !== 'pass').slice(0, 5).map(provider => <div key={provider.id} className="mt-2 text-[11px] text-muted-foreground"><span className="text-foreground font-medium">{provider.name}</span><span className="mx-1">·</span>{provider.issues.join('、')}</div>)}
                  {productionReadiness.database.status !== 'pass' && <p className="mt-2 text-[11px] text-destructive">{productionReadiness.database.detail}</p>}
                </div>
              )}
            </section>

            <section className="mb-4 rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2"><ListChecks className="w-4 h-4 text-primary" /><div><h2 className="text-sm font-semibold text-foreground">云端任务监控</h2><p className="text-[11px] text-muted-foreground">最近任务状态与失败摘要</p></div></div>
                <button onClick={() => void refreshCloudTasks()} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer" title="刷新任务"><RefreshCw className={`w-3.5 h-3.5 ${cloudTasksLoading ? 'animate-spin' : ''}`} /></button>
              </div>
              {cloudTasksError ? <div role="alert" className="px-4 py-4 text-xs text-destructive flex items-center justify-between gap-3"><span>云端任务记录加载失败：{cloudTasksError}</span><button onClick={() => void refreshCloudTasks()} className="shrink-0 underline underline-offset-2">重试</button></div> : cloudTasks.length === 0 ? <div className="px-4 py-5 text-xs text-muted-foreground">{cloudTasksLoading ? '正在读取任务记录...' : '暂无云端任务记录'}</div> : (
                <div className="divide-y divide-border">
                  {cloudTasks.slice(0, 8).map(task => {
                    const isFailed = ['failed', 'timeout', 'cancelled'].includes(task.status);
                    const isCompleted = task.status === 'completed';
                    const durationLabel = typeof task.durationMs === 'number'
                      ? task.durationMs >= 60_000
                        ? `${(task.durationMs / 60_000).toFixed(1)} 分钟`
                        : `${(task.durationMs / 1_000).toFixed(1)} 秒`
                      : '未记录';
                    return <div key={task.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2.5 hover:bg-muted/40">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-foreground truncate">{task.label || task.type}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${isFailed ? 'bg-destructive/15 text-destructive' : isCompleted ? 'bg-emerald-500/15 text-emerald-500' : 'bg-primary/10 text-primary'}`}>{task.status}</span>
                          <span className="text-[10px] text-muted-foreground">{task.handlerVersion || 'legacy'}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground break-all">
                          请求：{task.requestedProviderId || '自动'} · {task.requestedModelId || '自动'}
                        </div>
                        <div className="text-[10px] text-muted-foreground break-all">
                          实际：{task.providerName || task.actualProviderId || task.providerId || '未标记供应商'} · {task.actualModelId || task.model || '未标记模型'}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                          <span>耗时 {durationLabel}</span>
                          <span>积分 {task.billing?.status || '未记录'} / {task.billing?.cost ?? 0}</span>
                          <span>错误来源 {task.errorSource || '未标记'}</span>
                          <span className="break-all">requestId {task.requestId || '未记录'}</span>
                        </div>
                        {task.error && <div className="text-[10px] text-destructive break-words">{task.error}</div>}
                      </div>
                      <div className="text-right text-[10px] text-muted-foreground"><div>{task.progress}%</div><div className="mt-1">{new Date(task.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>
                    </div>;
                  })}
                </div>
              )}
            </section>

            {/* ── Filter bar ── */}
            <div className="flex items-center gap-2 mb-3 p-2 rounded-xl bg-muted/50 border border-border">
              <select className="h-8 px-2.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer" value={apiFilterType} onChange={e => setApiFilterType(e.target.value as ApiKind | 'all')}>
                <option value="all">全部类型</option>
                {(Object.keys(apiKindLabels) as ApiKind[]).map(k => <option key={k} value={k}>{apiKindLabels[k]}</option>)}
              </select>
              <select className="h-8 px-2.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer" value={apiFilterStatus} onChange={e => setApiFilterStatus(e.target.value as 'all' | 'enabled' | 'disabled')}>
                <option value="all">全部状态</option>
                <option value="enabled">已启用</option>
                <option value="disabled">已停用</option>
              </select>
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input type="text" placeholder="搜索 API 名称或 URL..." value={apiSearchQuery} onChange={e => setApiSearchQuery(e.target.value)} className="w-full h-8 pl-8 pr-3 rounded-lg text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>

            {/* ── Batch operations bar ── */}
            {selectedProviderIds.size > 0 && (
              <div className="flex items-center gap-2 mb-3 p-2 rounded-xl bg-primary/10 border border-primary/20">
                <span className="text-xs text-primary">已选择 {selectedProviderIds.size} 个</span>
                <button onClick={() => void handleBatchToggleApi(true)} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 cursor-pointer transition-colors">批量启用</button>
                <button onClick={() => void handleBatchToggleApi(false)} className="text-xs px-2.5 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive cursor-pointer transition-colors">批量停用</button>
                <button onClick={() => setConfirmDlg({ open: true, title: '批量删除', message: `确定要删除选中的 ${selectedProviderIds.size} 个API吗？`, variant: 'danger', onConfirm: () => void handleBatchDeleteApi(), onCancel: () => setConfirmDlg(d => ({ ...d, open: false })) })} className="text-xs px-2.5 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive cursor-pointer transition-colors">批量删除</button>
                <button onClick={toggleSelectAllProviders} className="text-xs px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground cursor-pointer transition-colors">全选/取消</button>
              </div>
            )}

            {/* ── API Cards Grid ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProviders.map(p => (
                <div key={p.id} className="relative rounded-xl p-4 transition-all bg-card border border-border hover:border-primary/30 cursor-default">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selectedProviderIds.has(p.id)} onChange={() => setSelectedProviderIds(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })} className="mt-1 accent-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm truncate text-foreground">{p.displayName || p.name}</span>
                        {p.displayName && p.name !== p.displayName && <span className="text-[10px] text-muted-foreground truncate">({p.name})</span>}
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${p.isEnabled !== false ? 'bg-emerald-500/15 text-emerald-500' : 'bg-destructive/15 text-destructive'}`}>{p.isEnabled !== false ? '启用' : '停用'}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mb-1">{apiKindLabels[p.modelType as ApiKind] || p.modelType || '通用'}</div>
                      <div className="text-[10px] text-muted-foreground truncate mb-2">{p.baseUrl}</div>
                      {p.balance !== undefined && p.balance !== null && (
                        <div className="text-[10px] text-primary/80">余额: ${typeof p.balance === 'number' ? (p.balance as number).toFixed(2) : String(p.balance)}</div>
                      )}
                      {providerTaskSummary[p.id] && <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">任务 {providerTaskSummary[p.id].total}</span>
                        {providerTaskSummary[p.id].processing > 0 && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary">处理中 {providerTaskSummary[p.id].processing}</span>}
                        {providerTaskSummary[p.id].failed > 0 && <span className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">异常 {providerTaskSummary[p.id].failed}</span>}
                      </div>}
                      {(p.discoveredModels && p.discoveredModels.length > 0) && (
                        <div className="mt-2">
                          <button
                            onClick={() => setExpandedModelProviders(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
                            className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 cursor-pointer transition-colors"
                          >
                            <ChevronDown className={`w-3 h-3 transition-transform ${expandedModelProviders.has(p.id) ? 'rotate-0' : '-rotate-90'}`} />
                            已启用模型 ({p.selectedModels?.length || 0})
                          </button>
                          {expandedModelProviders.has(p.id) && (
                            <div className="mt-1.5 space-y-1 max-h-60 overflow-y-auto pr-1">
                              {(() => {
                                const selectedSet = new Set(p.selectedModels || []);
                                const selectedModelList = (p.discoveredModels || []).filter(m => selectedSet.has(m.id));
                                if (selectedModelList.length === 0) {
                                  return (
                                    <div className="px-2 py-1.5 text-[10px] text-muted-foreground italic">暂无已启用模型，请点击「编辑」管理模型</div>
                                  );
                                }
                                return selectedModelList.map(m => {
                                  const displayName = m.displayName || m.name || m.id;
                                  return (
                                    <div key={m.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/50 hover:bg-muted group">
                                      <span className="w-3.5 h-3.5 rounded bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                                        <Check className="w-2.5 h-2.5" />
                                      </span>
                                      <span className="text-[11px] text-foreground flex-1 truncate" title={displayName}>{displayName}</span>
                                      <span className="text-[9px] text-muted-foreground truncate max-w-[100px]" title={m.id}>{m.id}</span>
                                      <button
                                        onClick={() => {
                                          const newName = prompt('修改模型显示名称:', displayName);
                                          if (newName !== null && newName.trim()) {
                                            const newDiscovered = (p.discoveredModels || []).map(dm =>
                                              dm.id === m.id ? { ...dm, displayName: newName.trim() } : dm
                                            );
                                            void quickUpdateProvider(p.id, { discoveredModels: newDiscovered });
                                          }
                                        }}
                                        className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                                        title="重命名"
                                      >
                                        <Pencil className="w-2.5 h-2.5" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          const newDiscovered = (p.discoveredModels || []).filter(dm => dm.id !== m.id);
                                          const newSelected = p.selectedModels!.filter(s => s !== m.id);
                                          void quickUpdateProvider(p.id, { selectedModels: newSelected, discoveredModels: newDiscovered });
                                        }}
                                        className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all cursor-pointer"
                                        title="删除"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-border flex-wrap">
                    <button onClick={() => { toggleApiEnabled(p.id); }} className={`text-[10px] px-2 py-1 rounded-lg cursor-pointer transition-colors ${p.isEnabled !== false ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'}`}>{p.isEnabled !== false ? '停用' : '启用'}</button>
                    <button onClick={() => { editApiProvider(p); }} className={`text-[10px] px-2 py-1 rounded-lg cursor-pointer transition-colors ${editingProviderId === p.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}>编辑</button>
                    <button onClick={() => { void testApiConnection(p); }} disabled={testingProviderId === p.id} className="text-[10px] px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50 bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors">{testingProviderId === p.id ? '测试中...' : '测试'}</button>
                    <button onClick={() => { void verifyProtocolForProvider(p); }} className="text-[10px] px-2 py-1 rounded-lg cursor-pointer bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors">验证协议</button>
                    <button onClick={() => { void queryBalanceForProvider(p); }} className="text-[10px] px-2 py-1 rounded-lg cursor-pointer bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors">查询余额</button>
                    <button onClick={() => setConfirmDlg({ open: true, title: '删除API', message: `确定要删除 "${p.displayName || p.name}" 吗？`, variant: 'danger', onConfirm: () => deleteApiProvider(p.id), onCancel: () => setConfirmDlg(d => ({ ...d, open: false })) })} className="text-[10px] px-2 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive cursor-pointer ml-auto transition-colors">删除</button>
                  </div>
                  {/* 测试结果显示 */}
                  {testingProviderId === p.id && (
                    <div className="mt-2 p-2 rounded-lg text-[11px] bg-primary/10 text-primary">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        正在测试连接...
                      </div>
                    </div>
                  )}
                  {providerTestStatus[p.id] && testingProviderId !== p.id && (
                    <div className={`mt-2 p-2 rounded-lg text-[11px] ${providerTestStatus[p.id].success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-destructive/10 text-destructive'}`}>
                      <div className="flex items-center gap-1.5">
                        {providerTestStatus[p.id].success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {providerTestStatus[p.id].message}
                      </div>
                    </div>
                  )}
                  {/* 协议验证加载中 */}
                  {providerVerifyStatus[p.id]?.verifying && (
                    <div className="mt-2 p-2 rounded-lg text-[11px] bg-primary/10 text-primary">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        正在验证协议...
                      </div>
                    </div>
                  )}
                  {/* 协议验证详细结果 */}
                  {(() => { const vr = providerVerifyStatus[p.id]?.result; return vr?.tests && vr.tests.length > 0 ? (
                    <div className={`mt-2 p-2.5 rounded-lg text-[11px] border ${vr.success !== false ? 'bg-primary/5 border-primary/15' : 'bg-destructive/5 border-destructive/15'}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <ShieldCheck className="w-3 h-3 text-primary" />
                        <span className="font-medium">{vr.summary || '协议验证'}</span>
                      </div>
                      <div className="space-y-1">
                        {vr.tests.map((t, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 ${t.status === 'pass' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : t.status === 'fail' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>
                              {t.status === 'pass' ? '✓' : t.status === 'fail' ? '✗' : '!'}
                            </span>
                            <div className="min-w-0">
                              <span className="font-medium">{t.name}</span>
                              {t.endpoint && <span className="text-muted-foreground ml-1">{t.endpoint}</span>}
                              {t.detail && <p className="text-muted-foreground leading-snug">{t.detail}</p>}
                              {t.latencyMs != null && <p className="text-muted-foreground/60">{t.latencyMs}ms</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null; })()}
                  {/* 余额查询结果 */}
                  {providerBalanceStatus[p.id]?.loading && (
                    <div className="mt-2 p-2 rounded-lg text-[11px] bg-primary/10 text-primary">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        正在查询余额...
                      </div>
                    </div>
                  )}
                  {!providerBalanceStatus[p.id]?.loading && providerBalanceStatus[p.id]?.message && (
                    <div className={`mt-2 p-2 rounded-lg text-[11px] ${providerBalanceStatus[p.id].message?.includes('成功') ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                      {providerBalanceStatus[p.id].message}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {providersLoadError ? (
              <div role="alert" className="text-center py-12 text-destructive">
                <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-70" />
                <p className="text-sm">供应商配置加载失败</p>
                <p className="text-xs mt-1">{providersLoadError}</p>
                <button onClick={() => { void refreshAdmin(); }} className="mt-3 text-xs underline underline-offset-2">重试</button>
              </div>
            ) : filteredProviders.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Server className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">暂无API提供商</p>
                <p className="text-xs mt-1">点击上方“添加 API”按钮添加</p>
              </div>
            )}

            {/* ── 右侧抽屉: API编辑/添加表单 ── */}
            {showApiDrawer && (
              <>
                {/* 遮罩层 */}
                <div className="fixed inset-0 bg-black/40 z-[199] backdrop-blur-sm" onClick={() => { if (!isSubmitting) { resetApiForm(); setShowApiDrawer(false); setEditingProviderId(null); } }} />
                {/* 抽屉面板 */}
                <div className="fixed right-0 top-0 bottom-0 w-[520px] max-w-[92vw] z-[200] bg-card border-l border-border flex flex-col shadow-2xl">
                  {/* 抽屉头部 */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        {editingProviderId ? <Settings className="w-4.5 h-4.5" /> : <Plus className="w-4.5 h-4.5" />}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-foreground">{editingProviderId ? '编辑 API 配置' : '添加新 API 配置'}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{editingProviderId ? '修改 API 提供商设置' : '配置新的 AI 模型服务'}</p>
                      </div>
                    </div>
                    <button onClick={() => { if (!isSubmitting) { resetApiForm(); setShowApiDrawer(false); setEditingProviderId(null); } }} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground cursor-pointer">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {/* 抽屉内容 (可滚动) */}
                  <div className="flex-1 overflow-y-auto">
                    <div className="px-6 py-5 space-y-6">

                      {/* ===== 基础配置区域 ===== */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-1 h-5 rounded-full bg-primary" />
                          <span className="text-sm font-semibold text-foreground">基础配置</span>
                        </div>
                        <div className="space-y-4">
                          {/* 配置名称 + 显示名称 */}
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-sm font-medium text-foreground mb-1.5 block">配置名称 <span className="text-destructive">*</span></label>
                              <input type="text" placeholder="例如：我的OpenAI" value={apiName} onChange={e => setApiName(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
                            </div>
                            <div>
                              <label className="text-sm font-medium text-foreground mb-1.5 block">显示名称</label>
                              <input type="text" placeholder="前端展示别名" value={apiDisplayName} onChange={e => setApiDisplayName(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
                            </div>
                          </div>
                          {/* API 类型 */}
                          <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">API 类型 <span className="text-destructive">*</span></label>
                            <select className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors cursor-pointer" value={apiKind} onChange={e => setApiKind(e.target.value as ApiKind)}>
                              {(Object.keys(apiKindLabels) as ApiKind[]).map(k => <option key={k} value={k}>{apiKindLabels[k]}</option>)}
                            </select>
                          </div>
                          {/* API Base URL */}
                          <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">API Base URL <span className="text-destructive">*</span></label>
                            <div className="relative">
                              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <input type="text" placeholder="https://api.openai.com/v1" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} className="w-full h-10 pl-10 pr-3 rounded-lg bg-background border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
                            </div>
                          </div>
                          {/* API Key */}
                          <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">API Key {!editingProviderId && <span className="text-destructive">*</span>}</label>
                            <div className="relative">
                              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <input type={showApiKey ? 'text' : 'password'} placeholder={editingProviderId ? "留空则保留原密钥不变" : "sk-xxxxxxxxxxxxxxxxxxxxxxxx"} value={apiKey} onChange={e => setApiKey(e.target.value)} className="w-full h-10 pl-10 pr-12 rounded-lg bg-background border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
                              <button type="button" onClick={() => setShowApiKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground cursor-pointer">
                                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          {/* 请求风格 */}
                          <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">请求风格</label>
                            <select className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors cursor-pointer" value={compatProfile} onChange={e => setCompatProfile(e.target.value)}>
                              <option value="auto">自动推断（推荐）</option>
                              <option value="openai">OpenAI 标准格式</option>
                              <option value="openai-async">OpenAI 异步轮询</option>
                              <option value="apimart">APIMart 代理格式</option>
                              <option value="pearapi">PearAPI 宽高比格式</option>
                              <option value="gemini-image">Gemini 图像对话格式</option>
                              <option value="custom">自定义</option>
                            </select>
                            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                              <Info className="w-3.5 h-3.5 shrink-0" />
                              大多数情况选择「自动推断」即可，程序会自动适配API格式
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* ===== 连接测试区域 ===== */}
                      <div className="bg-muted/40 rounded-lg p-4 border border-border/50">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-1 h-5 rounded-full bg-blue-500" />
                          <span className="text-sm font-semibold text-foreground">连接测试</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => { void handleDiscoverModels(); }} disabled={isDiscovering || !apiBaseUrl || (!editingProviderId && !apiKey)} className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                            {isDiscovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            {isDiscovering ? '扫描中...' : '测试连接'}
                          </button>
                          <button onClick={() => { void handleDrawerVerifyProtocol(); }} disabled={isVerifyingDrawer || !apiBaseUrl} className="px-4 py-2 rounded-md text-sm font-medium bg-muted text-muted-foreground border border-border hover:bg-muted/80 hover:text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                            {isVerifyingDrawer ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                            {isVerifyingDrawer ? '验证中...' : '验证协议'}
                          </button>
                          <button onClick={() => { void handleDrawerQueryBalance(); }} disabled={isQueryingBalanceDrawer || !apiBaseUrl} className="px-4 py-2 rounded-md text-sm font-medium bg-muted text-muted-foreground border border-border hover:bg-muted/80 hover:text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                            {isQueryingBalanceDrawer ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                            {isQueryingBalanceDrawer ? '查询中...' : '查询余额'}
                          </button>
                        </div>

                        {/* 测试连接结果 */}
                        {testNewResult && (
                          <div className={`mt-3 p-3 rounded-lg text-sm border ${testNewResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              {testNewResult.success ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                              <span className="font-semibold">{testNewResult.success ? '连接成功' : '连接失败'}</span>
                            </div>
                            <p className="opacity-90 leading-relaxed text-xs">{testNewResult.message}</p>
                            {testNewResult.success && discoveredModels.length > 0 && (
                              <p className="mt-2 flex items-center gap-1 text-xs">
                                <Sparkles className="w-3.5 h-3.5" />
                                发现 <span className="font-bold">{discoveredModels.length}</span> 个可用模型
                              </p>
                            )}
                          </div>
                        )}

                        {/* 协议验证结果 */}
                        {drawerVerifyResult && (
                          <div className={`mt-3 p-3 rounded-lg text-sm border ${drawerVerifyResult.success ? 'bg-primary/5 border-primary/15 text-foreground' : 'bg-destructive/5 border-destructive/15 text-foreground'}`}>
                            <div className="flex items-center gap-2 mb-2">
                              <ShieldCheck className="w-4 h-4 text-primary" />
                              <span className="font-semibold">协议验证结果</span>
                              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium ${drawerVerifyResult.success ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/15 text-destructive'}`}>
                                {drawerVerifyResult.success ? '通过' : '未通过'}
                              </span>
                            </div>
                            {drawerVerifyResult.tests && drawerVerifyResult.tests.length > 0 ? (
                              <div className="space-y-1.5">
                                {drawerVerifyResult.tests.map((t, i) => (
                                  <div key={i} className="flex items-start gap-2 text-xs">
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${t.status === 'pass' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : t.status === 'fail' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>
                                      {t.status === 'pass' ? '✓' : t.status === 'fail' ? '✗' : '!'}
                                    </span>
                                    <div className="min-w-0">
                                      <span className="font-medium">{t.name}</span>
                                      <span className="text-muted-foreground ml-1">{t.endpoint}</span>
                                      {t.detail && <p className="text-muted-foreground mt-0.5">{t.detail}</p>}
                                      {t.latencyMs != null && <p className="text-muted-foreground/60 mt-0.5">耗时 {t.latencyMs}ms</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : drawerVerifyResult.checks ? (
                              <div className="space-y-2">
                                {[
                                  { key: 'models' as const, label: '模型列表接口 /models' },
                                  { key: 'imageGen' as const, label: '图像生成接口 /images/generations' },
                                  { key: 'chat' as const, label: '对话接口 /chat/completions' },
                                ].map(item => (
                                  <div key={item.key} className="flex items-center gap-2 text-xs">
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${drawerVerifyResult.checks![item.key] ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/15 text-destructive'}`}>
                                      {drawerVerifyResult.checks![item.key] ? '✓' : '✗'}
                                    </span>
                                    <span>{item.label}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {drawerVerifyResult.detected && (
                              <p className="mt-2 pt-2 border-t border-border text-xs">
                                检测协议: <span className="font-mono font-semibold">{drawerVerifyResult.detected}</span>
                              </p>
                            )}
                            {drawerVerifyResult.message && <p className="mt-1 text-muted-foreground text-xs">{drawerVerifyResult.message}</p>}
                          </div>
                        )}

                        {/* 余额查询结果 */}
                        {drawerBalanceResult && (
                          <div className={`mt-3 p-3 rounded-lg text-sm border ${drawerBalanceResult.success ? 'bg-purple-500/10 border-purple-500/20 text-purple-700 dark:text-purple-300' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <DollarSign className="w-4 h-4" />
                              <span className="font-semibold">余额信息</span>
                            </div>
                            <p className="opacity-90 text-xs">{drawerBalanceResult.message}</p>
                            {drawerBalanceResult.balance !== undefined && (
                              <p className="mt-2 text-xl font-bold">
                                {drawerBalanceResult.currency || '¥'} {typeof drawerBalanceResult.balance === 'number' ? drawerBalanceResult.balance.toFixed(2) : drawerBalanceResult.balance}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ===== 模型管理区域 ===== */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-5 rounded-full bg-emerald-500" />
                            <span className="text-sm font-semibold text-foreground">模型管理</span>
                            {discoveredModels.length > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                                {selectedModels.length}/{discoveredModels.length}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setSelectedModels(discoveredModels.map(m => m.id))} disabled={discoveredModels.length === 0} className="text-xs px-2.5 py-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer transition-colors">全选</button>
                            <button onClick={() => setSelectedModels([])} disabled={selectedModels.length === 0} className="text-xs px-2.5 py-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer transition-colors">清空</button>
                            <button onClick={() => { setEditingModel(null); setModelFormName(''); setModelFormId(''); setModelFormContext(''); setShowModelDialog(true); }} className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1 cursor-pointer transition-colors font-medium">
                              <Plus className="w-3 h-3" />手动添加
                            </button>
                          </div>
                        </div>
                        {/* 模型搜索框 */}
                        {discoveredModels.length > 0 && (
                          <div className="mb-3">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <input
                                type="text"
                                placeholder="搜索模型名称或ID..."
                                value={modelSearchQuery}
                                onChange={(e) => setModelSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                              />
                              {modelSearchQuery && (
                                <button
                                  onClick={() => setModelSearchQuery('')}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            {modelSearchQuery && (
                              <p className="text-xs text-muted-foreground mt-1.5">
                                筛选结果: {filteredModels.length} 个模型匹配 “{modelSearchQuery}”
                              </p>
                            )}
                          </div>
                        )}
                        {discoveredModels.length === 0 ? (
                          <div className="p-8 rounded-lg text-center border-2 border-dashed border-border text-muted-foreground">
                            <Bot className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <p className="text-sm font-medium">尚未发现模型</p>
                            <p className="text-xs mt-1">填写API信息后点击「测试连接」自动扫描，或点击「手动添加」</p>
                          </div>
                        ) : filteredModels.length === 0 ? (
                          <div className="p-6 rounded-lg text-center border border-border text-muted-foreground">
                            <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                            <p className="text-sm font-medium">未找到匹配的模型</p>
                            <p className="text-xs mt-1">尝试其他关键词或清空搜索</p>
                          </div>
                        ) : (
                          <div className="rounded-lg overflow-hidden border border-border">
                            <div className="max-h-64 overflow-y-auto">
                              {filteredModels.map((m, idx) => {
                                const isSelected = selectedModels.includes(m.id);
                                return (
                                  <div key={m.id} className={`flex items-center gap-3 px-4 py-2.5 ${idx % 2 === 0 ? 'bg-muted/30' : ''} hover:bg-muted/60 transition-colors group`}>
                                    <input type="checkbox" checked={isSelected} onChange={() => { setSelectedModels(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id]); }} className="w-4 h-4 rounded accent-primary cursor-pointer" />
                                    <div className="flex-1 min-w-0">
                                      <div className={`text-sm truncate ${isSelected ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{m.displayName || m.name || m.id}</div>
                                      <div className="text-xs font-mono truncate text-muted-foreground/60">{m.id}</div>
                                    </div>
                                    {m.contextWindow && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium shrink-0">
                                        {m.contextWindow >= 1000 ? `${(m.contextWindow / 1000).toFixed(0)}K` : m.contextWindow}
                                      </span>
                                    )}
                                    <button onClick={() => { setEditingModel(m); setModelFormName(m.displayName || m.name || ''); setModelFormId(m.id); setModelFormContext(m.contextWindow ? String(m.contextWindow) : ''); setShowModelDialog(true); }} className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer">
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <ModelCapabilityEditor
                    models={buildCapabilityEditorModels(
                      discoveredModels,
                      selectedModels,
                      editingProviderId || 'new-provider',
                      apiKind,
                    )}
                    value={taskModelCapabilities}
                    onChange={setTaskModelCapabilities}
                  />
                  {/* 抽屉底部按钮区 */}
                  <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {editingProviderId ? '修改后点击保存' : '添加后需要勾选启用的模型'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { if (!isSubmitting) { resetApiForm(); setShowApiDrawer(false); setEditingProviderId(null); } }} disabled={isSubmitting} className="px-5 py-2 rounded-md text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer">取消</button>
                      <button onClick={() => { if (editingProviderId) { void handleUpdateApi(); } else { void handleAddApi(); } }} disabled={!apiName || !apiBaseUrl || isSubmitting} className="px-6 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (editingProviderId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />)}
                        {isSubmitting ? '保存中...' : (editingProviderId ? '保存修改' : '添加 API')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 子模型编辑/添加弹窗 */}
                {showModelDialog && (
                  <>
                    <div className="fixed inset-0 bg-black/50 z-[210]" onClick={() => setShowModelDialog(false)} />
                    <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] z-[211] bg-card border border-border rounded-xl shadow-2xl">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <h3 className="text-sm font-semibold text-foreground">{editingModel ? '编辑模型' : '添加新模型'}</h3>
                        <button onClick={() => setShowModelDialog(false)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="px-5 py-4 space-y-4">
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1.5 block">显示名称</label>
                          <input type="text" placeholder="模型显示名称，如：GPT-4o" value={modelFormName} onChange={e => setModelFormName(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1.5 block">模型 ID</label>
                          <input type="text" placeholder="模型标识，如：gpt-4o-2024-08-06" value={modelFormId} onChange={e => setModelFormId(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1.5 block">上下文窗口 (tokens)</label>
                          <input type="number" placeholder="例如：128000" value={modelFormContext} onChange={e => setModelFormContext(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
                        </div>
                      </div>
                      <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
                        <button onClick={() => setShowModelDialog(false)} className="px-4 py-2 rounded-md text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors cursor-pointer">取消</button>
                        <button onClick={() => {
                          const displayNameValue = modelFormName.trim();
                          const originalName = editingModel?.name || modelFormId.trim();
                          // name: 保留原始API发现的名称；displayName: 用户手动设置的显示名称
                          // 如果用户修改了显示名称（与原始name不同），则存入displayName；否则清除displayName
                          const shouldSetDisplayName = displayNameValue && displayNameValue !== originalName;
                          const newModel: ModelInfo = {
                            id: modelFormId.trim(),
                            name: originalName,
                            displayName: shouldSetDisplayName ? displayNameValue : undefined,
                            contextWindow: modelFormContext ? parseInt(modelFormContext) : undefined,
                            providerId: editingProviderId || '',
                            type: apiKind
                          };
                          if (!newModel.id) return;
                          if (editingModel) {
                            setDiscoveredModels(prev => prev.map(m => m.id === editingModel.id ? newModel : m));
                            setSelectedModels(prev => prev.map(id => id === editingModel.id ? newModel.id : id));
                          } else {
                            if (!discoveredModels.find(m => m.id === newModel.id)) {
                              setDiscoveredModels(prev => [...prev, newModel]);
                              setSelectedModels(prev => [...prev, newModel.id]);
                            }
                          }
                          setShowModelDialog(false);
                        }} className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer">
                          {editingModel ? '保存' : '确认添加'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'desktop-admin' && isAdmin && (
          <DesktopAdminTab
            isDark={isDark}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            softClass={softClass}
            inputClass={inputClass}
            accentBgClass={accentBgLight}
            accentTextOnBgClass={accentClass}
            accentHoverBgClass={isMonochrome ? 'hover:bg-[#3b82f6]/20' : 'hover:bg-[#d4af37]/20'}
          />
        )}

        {activeTab === 'media-gateway' && isAdmin && (
          <MediaGatewayAdmin />
        )}

        {/* ── Tab: Connector Admin (DCC / Creative) ── */}
        {activeTab === 'connector-admin' && isAdmin && (
          <div className="h-full overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className={`text-xl font-bold ${textPrimary}`}>插件连接器管理</h1>
                <p className={`text-sm ${textSecondary}`}>SketchUp / 3ds Max / Photoshop / Illustrator / 窗口拾取脚本 等外部插件云端对接状态</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(typeof window !== 'undefined' ? window.location.origin : '');
                    toast.success('云端地址已复制');
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${softClass} ${textPrimary}`}
                >
                  <Link size={12} /> 复制云端地址
                </button>
                <button
                  onClick={() => loadConnectorStatus()}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${softClass} ${textPrimary}`}
                >
                  <RefreshCw size={12} className={connectorStatus.loading ? 'animate-spin' : ''} />
                  刷新检测
                </button>
              </div>
            </div>

            {/* 环境地址卡片 */}
            <div className={`${softClass} rounded-xl p-4 border ${isDark ? 'border-white/10' : 'border-gray-200'} mb-5`}>
              <div className="flex items-center gap-2 mb-2">
                <Globe2 size={14} className={accentClass} />
                <span className={`text-sm font-semibold ${textPrimary}`}>插件连接配置</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className={textSecondary}>公共云端地址</div>
                  <div className={`font-mono mt-1 ${textPrimary}`}>{typeof window !== 'undefined' ? window.location.origin : ''}</div>
                </div>
                <div>
                  <div className={textSecondary}>本地无界默认地址</div>
                  <div className={`font-mono mt-1 ${textPrimary}`}>http://127.0.0.1:5000</div>
                </div>
                <div>
                  <div className={textSecondary}>鉴权策略</div>
                  <div className={`mt-1 ${textPrimary}`}>公共云默认免鉴权；私有云可通过 <code className="text-[11px]">WUJIE_DCC_PLUGIN_TOKEN</code> / <code className="text-[11px]">x-api-key</code> 开启</div>
                </div>
                <div>
                  <div className={textSecondary}>支持的请求头</div>
                  <div className={`mt-1 ${textPrimary} font-mono`}>Authorization: Bearer &lt;token&gt;; x-api-key: &lt;key&gt;</div>
                </div>
              </div>
            </div>

            {/* 核心接口健康状态 */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { label: 'DCC Health', path: '/api/dcc/health', ok: !!connectorStatus.dcc?.success },
                { label: 'DCC Preflight', path: '/api/dcc/preflight', ok: !!connectorStatus.dccPreflight?.success },
                { label: 'Creative Health', path: '/api/creative/health', ok: !!connectorStatus.creative?.success },
                { label: 'PS/AI 模板', path: '/api/creative/templates', ok: connectorStatus.psTemplates.length + connectorStatus.aiTemplates.length > 0 },
              ].map(item => (
                <div key={item.label} className={`${softClass} rounded-xl p-4 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className={`text-xs ${textSecondary}`}>{item.label}</div>
                    {item.ok ? (
                      <CheckCircle2 size={14} className="text-emerald-500" />
                    ) : (
                      <XCircle size={14} className="text-red-500" />
                    )}
                  </div>
                  <div className={`text-xs font-mono mt-2 ${textSecondary}`}>{item.path}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* DCC 插件 (SketchUp / 3ds Max / 窗口拾取) */}
              <div className={`${softClass} rounded-xl p-4 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                    <Box size={16} className={accentClass} /> DCC 插件接口（SketchUp / 3ds Max）
                  </h2>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${connectorStatus.dcc?.success ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
                    {connectorStatus.dcc?.success ? '在线' : '未就绪'}
                  </span>
                </div>
                <div className="space-y-2 text-xs mb-3">
                  <div className="flex justify-between"><span className={textSecondary}>服务名</span><span className={textPrimary}>{String(connectorStatus.dcc?.name || '-')}</span></div>
                  <div className="flex justify-between"><span className={textSecondary}>版本</span><span className={textPrimary}>{String(connectorStatus.dcc?.version || '-')}</span></div>
                  <div className="flex justify-between"><span className={textSecondary}>模板数</span><span className={textPrimary}>{connectorStatus.dccTemplates.length}</span></div>
                  <div className="flex justify-between"><span className={textSecondary}>推荐渲染模式</span><span className={textPrimary}>{connectorStatus.dccPreflight?.recommended?.defaultRenderMode || '-'}</span></div>
                </div>
                <h3 className={`text-xs font-semibold ${textPrimary} mb-2 mt-3`}>DCC 提示词模板</h3>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {connectorStatus.dccTemplates.map((t: Record<string, unknown>) => (
                    <div key={String(t.id)} className={`text-xs p-2 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                      <div className={`${textPrimary} font-medium`}>{String(t.name)} <span className={`${textSecondary} font-normal`}>· {String(t.category)}</span></div>
                      <div className={`${textSecondary} mt-0.5 line-clamp-2`}>{String(t.content)}</div>
                    </div>
                  ))}
                  {connectorStatus.dccTemplates.length === 0 && <div className={`text-xs ${textSecondary}`}>暂无模板</div>}
                </div>
              </div>

              {/* CEP 插件 (Photoshop / Illustrator) */}
              <div className={`${softClass} rounded-xl p-4 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                    <Palette size={16} className={accentClass} /> Adobe CEP 创意连接器（PS / AI）
                  </h2>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${connectorStatus.creative?.success ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
                    {connectorStatus.creative?.success ? '在线' : '未就绪'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-3">
                  <div className="flex justify-between"><span className={textSecondary}>Photoshop</span><span className={connectorStatus.creative?.hosts?.photoshopCep ? 'text-emerald-500' : 'text-red-500'}>{connectorStatus.creative?.hosts?.photoshopCep ? '已启用' : '未启用'}</span></div>
                  <div className="flex justify-between"><span className={textSecondary}>Illustrator</span><span className={connectorStatus.creative?.hosts?.illustratorCep ? 'text-emerald-500' : 'text-red-500'}>{connectorStatus.creative?.hosts?.illustratorCep ? '已启用' : '未启用'}</span></div>
                  <div className="flex justify-between"><span className={textSecondary}>版本</span><span className={textPrimary}>{String(connectorStatus.creative?.version || '-')}</span></div>
                  <div className="flex justify-between"><span className={textSecondary}>鉴权</span><span className={textPrimary}>{connectorStatus.creative?.authRequired ? '开启' : '免鉴权'}</span></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <h3 className={`text-xs font-semibold ${textPrimary} mb-2`}>Photoshop 模板</h3>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {connectorStatus.psTemplates.map((t: Record<string, unknown>) => (
                        <div key={String(t.id)} className={`text-[11px] p-2 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                          <div className={`${textPrimary} font-medium`}>{String(t.name)}</div>
                          <div className={`${textSecondary} line-clamp-2`}>{String(t.prompt)}</div>
                        </div>
                      ))}
                      {connectorStatus.psTemplates.length === 0 && <div className={`text-xs ${textSecondary}`}>暂无</div>}
                    </div>
                  </div>
                  <div>
                    <h3 className={`text-xs font-semibold ${textPrimary} mb-2`}>Illustrator 模板</h3>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {connectorStatus.aiTemplates.map((t: Record<string, unknown>) => (
                        <div key={String(t.id)} className={`text-[11px] p-2 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                          <div className={`${textPrimary} font-medium`}>{String(t.name)}</div>
                          <div className={`${textSecondary} line-clamp-2`}>{String(t.prompt)}</div>
                        </div>
                      ))}
                      {connectorStatus.aiTemplates.length === 0 && <div className={`text-xs ${textSecondary}`}>暂无</div>}
                    </div>
                  </div>
                </div>
              </div>

              {/* 能力矩阵 */}
              <div className={`${softClass} rounded-xl p-4 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <h2 className={`font-semibold mb-3 ${textPrimary} flex items-center gap-2`}><Zap size={16} className={accentClass} /> Creative 能力矩阵</h2>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(connectorStatus.creative?.capabilities ? Object.entries(connectorStatus.creative.capabilities as Record<string, boolean>) : []).map(([k, v]) => (
                    <div key={k} className={`flex items-center justify-between px-2 py-1.5 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                      <span className={textPrimary}>{k}</span>
                      {v ? <CheckCircle2 size={12} className="text-emerald-500" /> : <XCircle size={12} className="text-red-500" />}
                    </div>
                  ))}
                </div>
              </div>

              {/* 预飞检查 */}
              <div className={`${softClass} rounded-xl p-4 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <h2 className={`font-semibold mb-3 ${textPrimary} flex items-center gap-2`}><Shield size={16} className={accentClass} /> DCC 预飞检查（Preflight）</h2>
                <div className="space-y-2 text-xs">
                  {(connectorStatus.dccPreflight?.checks ?? []).map((c) => (
                    <div key={String(c.id)} className="flex items-center justify-between">
                      <span className={textPrimary}>{String(c.label)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] ${String(c.status) === 'pass' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-sky-500/15 text-sky-500'}`}>{String(c.status)}</span>
                    </div>
                  ))}
                  <h3 className={`text-xs font-semibold ${textPrimary} mt-3 mb-1`}>渲染模式</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(connectorStatus.dccPreflight?.renderModes ?? []).map((m) => (
                      <div key={String(m.id)} className={`text-[11px] p-1.5 rounded ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                        <div className={`${textPrimary} font-medium`}>{String(m.name)}</div>
                        <div className={`${textSecondary} line-clamp-1`}>{String(m.description)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 端点清单 */}
            <div className={`${softClass} rounded-xl p-4 border ${isDark ? 'border-white/10' : 'border-gray-200'} mt-4`}>
              <h2 className={`font-semibold mb-3 ${textPrimary} flex items-center gap-2`}><ListChecks size={16} className={accentClass} /> 端点清单（可直接复制到插件配置）</h2>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
                {[
                  ['DCC 健康检测', 'GET /api/dcc/health'],
                  ['DCC 预飞配置', 'GET /api/dcc/preflight'],
                  ['DCC 中文模板', 'GET /api/dcc/templates'],
                  ['创意连接器健康', 'GET /api/creative/health'],
                  ['创意模板（PS/AI）', 'GET /api/creative/templates?host=photoshop|illustrator'],
                  ['Photoshop 操作入口', 'POST /api/creative/photoshop'],
                  ['Illustrator 操作入口', 'POST /api/creative/illustrator'],
                  ['提交生图任务', 'POST /api/generate'],
                  ['轮询任务结果', 'POST /api/poll-task'],
                  ['图片编辑/抠图/放大', 'POST /api/image-edit'],
                  ['位图矢量化', 'POST /api/design/vectorize'],
                  ['SVG 智能描摹', 'POST /api/svg-trace'],
                ].map(([label, path]) => (
                  <div key={path} className="flex items-center justify-between gap-3">
                    <span className={`${textSecondary} shrink-0`}>{label}</span>
                    <code className={`${textPrimary} truncate`}>{path}</code>
                  </div>
                ))}
              </div>
            </div>

            {connectorStatus.error && (
              <div className={`mt-4 p-3 rounded-xl bg-red-500/10 text-red-500 text-xs`}>检测失败：{connectorStatus.error}</div>
            )}
          </div>
        )}

        {/* ── Tab: Data Management ── */}
        {activeTab === 'data' && isAdmin && (
          <DataManagerTab
            isDark={isDark}
            isMonochrome={isMonochrome}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            softClass={softClass}
            inputClass={inputClass}
            accentBgClass={accentBgClass}
            accentTextOnBgClass={accentTextOnBgClass}
            accentHoverBgClass={accentHoverBgClass}
          />
        )}

        {/* ── Tab: Ecom Templates ── */}
        {activeTab === 'ecom-templates' && isAdmin && (
          <div className="h-full overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <div><h1 className={`text-xl font-bold ${textPrimary}`}>电商模板管理</h1><p className={`text-sm ${textSecondary}`}>管理品牌电商生成模板</p></div>
              <button onClick={() => { setEditingEcomTpl({ id: `tpl_${Date.now()}`, name: '', icon: '📄', description: '', prompt_template: '', negative_prompt: 'low quality, blurry, distorted, deformed, watermark', aspect_ratio: '1:1', category: 'product', fidelity_anchor: '', sort_order: ecomTemplates.length + 1, is_enabled: true }); setShowNewEcomTpl(true); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${accentBgClass} ${accentTextOnBgClass} ${accentHoverBgClass} transition-colors cursor-pointer`}><Plus size={12} /> 新增模板</button>
            </div>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {ecomTemplates.length === 0 ? (<div className={`text-center py-8 text-sm ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>暂无自定义模板，点击&ldquo;新增模板&rdquo;添加</div>) : ecomTemplates.map((tpl, idx) => (
                <div key={tpl.id as string} className={`flex items-center gap-3 rounded-lg px-4 py-3 ${isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50'} transition-colors`}>
                  <span className="text-lg">{tpl.icon as string || '📄'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{tpl.name as string || '未命名'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${tpl.is_enabled ? (isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-50 text-green-600') : (isDark ? 'bg-[#333] text-[#666]' : 'bg-gray-100 text-gray-400')}`}>{tpl.is_enabled ? '启用' : '禁用'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-[#3b82f6]/20 text-[#3b82f6]' : isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-blue-50 text-blue-600'}`}>{(tpl.category as string) || 'product'}</span>
                      <span className={`text-[10px] ${isDark ? 'text-[#555]' : 'text-gray-400'}`}>{tpl.aspect_ratio as string}</span>
                    </div>
                    <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>{tpl.description as string || '无描述'}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => void moveEcomTemplateOrder(tpl.id as string, 'up')} disabled={idx === 0} className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-30 ${isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="上移"><ArrowUp size={12} /></button>
                    <button onClick={() => void moveEcomTemplateOrder(tpl.id as string, 'down')} disabled={idx === ecomTemplates.length - 1} className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-30 ${isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="下移"><ArrowDown size={12} /></button>
                    <button onClick={() => void toggleEcomTemplateEnabled(tpl.id as string, !tpl.is_enabled)} className={`p-1 rounded transition-colors cursor-pointer ${isDark ? 'hover:bg-[#2a2a2a]' : 'hover:bg-gray-100'}`} title={tpl.is_enabled ? '禁用' : '启用'}>{tpl.is_enabled ? <CheckCircle2 size={12} className="text-green-400" /> : <Ban size={12} className={isDark ? 'text-[#555]' : 'text-gray-300'} />}</button>
                    <button onClick={() => { setEditingEcomTpl({ ...tpl }); setShowNewEcomTpl(false); }} className={`p-1 rounded transition-colors cursor-pointer ${isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="编辑"><Pencil size={12} /></button>
                    <button onClick={() => void deleteEcomTemplate(tpl.id as string)} className={`p-1 rounded transition-colors cursor-pointer ${isDark ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-500'}`} title="删除"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
            {(showNewEcomTpl || editingEcomTpl) && (
              <div className={`mt-4 rounded-xl border p-4 ${softClass}`}>
                <h4 className="text-sm font-semibold mb-3">{showNewEcomTpl ? '新增模板' : `编辑模板: ${editingEcomTpl?.name || ''}`}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelClass}>模板名称 *</label><input className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="如：白底主图" value={(editingEcomTpl?.name as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, name: e.target.value } : null)} /></div>
                  <div><label className={labelClass}>图标</label><input className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="如：📦" value={(editingEcomTpl?.icon as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, icon: e.target.value } : null)} /></div>
                  <div><label className={labelClass}>分类</label><select className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} value={(editingEcomTpl?.category as string) || 'product'} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, category: e.target.value } : null)}><option value="product">商品展示</option><option value="scene">场景氛围</option><option value="model">模特展示</option><option value="graphic">平面设计</option><option value="detail">细节展示</option></select></div>
                  <div><label className={labelClass}>画面比例</label><select className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} value={(editingEcomTpl?.aspect_ratio as string) || '1:1'} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, aspect_ratio: e.target.value } : null)}><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="3:2">3:2</option><option value="2:3">2:3</option></select></div>
                  <div className="col-span-2"><label className={labelClass}>描述</label><input className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="简短描述此模板的用途" value={(editingEcomTpl?.description as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, description: e.target.value } : null)} /></div>
                  <div className="col-span-2"><label className={labelClass}>提示词模板 *</label><textarea className={`w-full h-28 px-3 py-2 rounded-lg border text-sm ${inputClass} resize-y`} placeholder="使用 {SUBJECT} {brand_color_prompt} {style_extra} 等占位符" value={(editingEcomTpl?.prompt_template as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, prompt_template: e.target.value } : null)} /></div>
                  <div className="col-span-2"><label className={labelClass}>反向提示词</label><textarea className={`w-full h-16 px-3 py-2 rounded-lg border text-sm ${inputClass} resize-y`} placeholder="排除的低质量描述" value={(editingEcomTpl?.negative_prompt as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, negative_prompt: e.target.value } : null)} /></div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => editingEcomTpl && void saveEcomTemplate(editingEcomTpl)} disabled={isEcomTplSaving || !(editingEcomTpl?.name) || !(editingEcomTpl?.prompt_template)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${accentBgClass} ${accentTextOnBgClass} ${accentHoverBgClass} transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}>{isEcomTplSaving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}{isEcomTplSaving ? '保存中...' : '保存模板'}</button>
                  <button onClick={() => { setEditingEcomTpl(null); setShowNewEcomTpl(false); }} className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${isDark ? 'text-[#888] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}>取消</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Payment Config ── */}
        {activeTab === 'payment-config' && isAdmin && (
          <div className="h-full overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className={`text-xl font-bold ${textPrimary}`}>人工收款审核</h1>
                <p className={`text-sm ${textSecondary}`}>上传微信或支付宝收款码；用户付款后提交订单，管理员确认到账后发放积分</p>
              </div>
              <div className="flex items-center gap-2">
                {paymentStatus.wechat && <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-green-500/15 text-green-400"><CheckCircle2 size={12}/> 微信已配置</span>}
                {paymentStatus.alipay && <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-blue-500/15 text-blue-400"><CheckCircle2 size={12}/> 支付宝已配置</span>}
                {!paymentStatus.wechat && !paymentStatus.alipay && <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-red-500/15 text-red-400"><AlertTriangle size={12}/> 未配置收款码或支付链接</span>}
              </div>
            </div>

            <div className="space-y-6 max-w-3xl">
              {/* 微信收款码 */}
              <div className={`rounded-xl border p-5 ${softClass}`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-lg bg-green-500/15 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-5 h-5 text-green-400" fill="currentColor"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm3.97 3.258c-2.031 0-3.898.767-5.309 1.944-1.66 1.386-2.622 3.277-2.622 5.343 0 1.56.564 3.023 1.538 4.234a.466.466 0 01.168.527l-.308 1.172c-.016.055-.037.11-.037.169 0 .13.104.234.231.234.057 0 .107-.019.155-.046l1.499-.881a.679.679 0 01.567-.078 8.064 8.064 0 002.418.369c4.156 0 7.53-2.915 7.53-6.498s-3.374-6.498-7.53-6.498v-.001zm-2.573 3.492c.509 0 .923.42.923.938a.93.93 0 01-.923.938.93.93 0 01-.923-.938c0-.518.414-.938.923-.938zm5.146 0c.509 0 .923.42.923.938a.93.93 0 01-.923.938.93.93 0 01-.923-.938c0-.518.414-.938.923-.938z"/></svg>
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>微信收款码</h3>
                    <p className={`text-xs ${textSecondary}`}>上传微信个人收款码图片</p>
                  </div>
                  {paymentConfig.wechatQrUrl && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 ml-auto">已配置</span>}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className={`text-[11px] font-medium ${textSecondary} mb-1 block`}>微信支付链接（可选）</label>
                    <input
                      className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`}
                      placeholder="wxp://xxxxx 微信收款链接，用户点击后直接跳转付款"
                      value={paymentConfig.wechatPayLink || ''}
                      onChange={e => setPaymentConfig(prev => ({ ...prev, wechatPayLink: e.target.value }))}
                    />
                    <p className={`text-[10px] ${textSecondary} mt-1`}>收款码可独立使用；填写链接仅用于移动端一键跳转，系统会尝试从上传图片中自动识别。</p>
                  </div>
                  <div>
                    <label className={`text-[11px] font-medium ${textSecondary} mb-1 block`}>收款码图片URL（备用）</label>
                    <input
                      className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`}
                      placeholder="粘贴微信收款码图片URL，或上传图片后自动填入"
                      value={paymentConfig.wechatQrUrl}
                      onChange={e => setPaymentConfig(prev => ({ ...prev, wechatQrUrl: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={`text-[11px] font-medium ${textSecondary} mb-1 block`}>上传收款码图片</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('type', 'payment-qr');
                        try {
                          const res = await fetch('/api/save-image', { method: 'POST', body: formData });
                          const data = await res.json();
                          if (data.success && data.url) {
                            setPaymentConfig(prev => ({ ...prev, wechatQrUrl: data.url }));
                            // 自动解码QR码提取支付链接
                            try {
                              const { decodeQrFromUrlClient, isPaymentLink } = await import('@/lib/qr-decode-client');
                              const decoded = await decodeQrFromUrlClient(data.url);
                              if (decoded && isPaymentLink(decoded)) {
                                setPaymentConfig(prev => ({ ...prev, wechatPayLink: decoded }));
                                console.log('✅ 微信收款码解码成功:', decoded.substring(0, 30) + '...');
                              } else if (decoded) {
                                console.warn('⚠️ 解码成功但不是支付链接:', decoded.substring(0, 30));
                                alert('解码成功，但检测到的不是微信支付链接。\n已解码内容: ' + decoded.substring(0, 50));
                              } else {
                                alert('未识别到支付链接，但收款码仍可用于人工审核充值。');
                              }
                            } catch (decodeErr) {
                              console.error('解码失败:', decodeErr);
                              alert('自动识别支付链接失败，但收款码仍可用于人工审核充值。');
                            }
                          } else {
                            alert('上传失败：' + (data.error || '未知错误'));
                          }
                        } catch { alert('上传失败：网络错误'); }
                      }}
                      className={`w-full text-sm ${textSecondary} file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:cursor-pointer ${isDark ? 'file:bg-green-500/20 file:text-green-400' : 'file:bg-green-50 file:text-green-600'}`}
                    />
                  </div>
                  {paymentConfig.wechatQrUrl && (
                    <div className="flex justify-center p-3 bg-white rounded-lg">
                      <img src={paymentConfig.wechatQrUrl} alt="微信收款码预览" className="w-40 h-40 object-contain" />
                    </div>
                  )}
                </div>
              </div>

              {/* 支付宝收款码 */}
              <div className={`rounded-xl border p-5 ${softClass}`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-5 h-5 text-blue-400" fill="currentColor"><path d="M21.422 15.358c-3.32-1.326-6.092-2.786-6.092-2.786s1.439-3.667 1.853-5.927H13.01V4.78h5.06V3.273h-5.06V.5h-2.494s-.073.003-.073.077V3.273H5.385v1.508h5.058v1.865H7.755v1.508h8.206c-.326 1.695-1.078 3.513-1.078 3.513s-3.858-1.732-6.592-2.18c-3.592-.594-6.291.802-6.47 3.286-.178 2.483 2.407 4.09 5.246 4.284 2.838.195 5.59-1.113 7.55-2.856 2.696 1.456 7.484 3.373 9.982 3.94.464-.867 1.657-3.063 1.657-3.063s-2.733-.59-4.834-1.48zm-12.84 2.275c-2.296-.157-3.71-1.463-3.588-2.838.123-1.375 1.843-2.352 4.139-2.195 2.06.141 4.332 1.103 5.698 2.053-1.63 1.402-3.953 3.137-6.249 2.98z"/></svg>
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>支付宝收款码</h3>
                    <p className={`text-xs ${textSecondary}`}>上传支付宝个人收款码图片</p>
                  </div>
                  {paymentConfig.alipayQrUrl && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 ml-auto">已配置</span>}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className={`text-[11px] font-medium ${textSecondary} mb-1 block`}>支付宝支付链接（可选）</label>
                    <input
                      className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`}
                      placeholder="https://qr.alipay.com/xxxxx 支付宝收款链接，用户点击后直接跳转付款"
                      value={paymentConfig.alipayPayLink || ''}
                      onChange={e => setPaymentConfig(prev => ({ ...prev, alipayPayLink: e.target.value }))}
                    />
                    <p className={`text-[10px] ${textSecondary} mt-1`}>收款码可独立使用；填写链接仅用于移动端一键跳转，系统会尝试从上传图片中自动识别。</p>
                  </div>
                  <div>
                    <label className={`text-[11px] font-medium ${textSecondary} mb-1 block`}>收款码图片URL（备用）</label>
                    <input
                      className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`}
                      placeholder="粘贴支付宝收款码图片URL，或上传图片后自动填入"
                      value={paymentConfig.alipayQrUrl}
                      onChange={e => setPaymentConfig(prev => ({ ...prev, alipayQrUrl: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className={`text-[11px] font-medium ${textSecondary} mb-1 block`}>上传收款码图片</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('type', 'payment-qr');
                        try {
                          const res = await fetch('/api/save-image', { method: 'POST', body: formData });
                          const data = await res.json();
                          if (data.success && data.url) {
                            setPaymentConfig(prev => ({ ...prev, alipayQrUrl: data.url }));
                            // 自动解码QR码提取支付链接
                            try {
                              const { decodeQrFromUrlClient, isPaymentLink } = await import('@/lib/qr-decode-client');
                              const decoded = await decodeQrFromUrlClient(data.url);
                              if (decoded && isPaymentLink(decoded)) {
                                setPaymentConfig(prev => ({ ...prev, alipayPayLink: decoded }));
                                console.log('✅ 支付宝收款码解码成功:', decoded.substring(0, 30) + '...');
                              } else if (decoded) {
                                console.warn('⚠️ 解码成功但不是支付链接:', decoded.substring(0, 30));
                                alert('解码成功，但检测到的不是支付宝支付链接。\n已解码内容: ' + decoded.substring(0, 50));
                              } else {
                                alert('未识别到支付链接，但收款码仍可用于人工审核充值。');
                              }
                            } catch (decodeErr) {
                              console.error('解码失败:', decodeErr);
                              alert('自动识别支付链接失败，但收款码仍可用于人工审核充值。');
                            }
                          } else {
                            alert('上传失败：' + (data.error || '未知错误'));
                          }
                        } catch { alert('上传失败：网络错误'); }
                      }}
                      className={`w-full text-sm ${textSecondary} file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:cursor-pointer ${isDark ? 'file:bg-blue-500/20 file:text-blue-400' : 'file:bg-blue-50 file:text-blue-600'}`}
                    />
                  </div>
                  {paymentConfig.alipayQrUrl && (
                    <div className="flex justify-center p-3 bg-white rounded-lg">
                      <img src={paymentConfig.alipayQrUrl} alt="支付宝收款码预览" className="w-40 h-40 object-contain" />
                    </div>
                  )}
                </div>
              </div>

              {/* 保存按钮 */}
              <div className="flex items-center gap-3">
                <button onClick={handleSavePaymentConfig} disabled={configSaving} className={`flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium ${accentBgClass} ${accentTextOnBgClass} ${accentHoverBgClass} transition-colors cursor-pointer disabled:opacity-50`}>
                  {configSaving ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>}
                  {configSaving ? '保存中...' : '保存收款码配置'}
                </button>
                {configSaveMsg && (
                  <span className={`text-xs ${configSaveMsg.includes('成功') ? 'text-green-400' : 'text-red-400'}`}>{configSaveMsg}</span>
                )}
              </div>

              {/* 订单审计 */}
              {auditOrders.length > 0 && (
                <div className={`rounded-xl border p-5 ${isDark ? 'bg-orange-500/5 border-orange-500/20' : 'bg-orange-50 border-orange-200'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-orange-500" />
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>最近订单 ({auditOrders.length})</h3>
                </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {auditOrders.map((order) => (
                      <div key={order.id} className={`flex items-center justify-between px-3 py-2.5 rounded-lg ${cardBg} border ${borderColor}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${textPrimary}`}>¥{(typeof order.priceCny === 'number' ? order.priceCny : Number(order.priceCny) || 0).toFixed(2)}</span>
                            <span className={`text-xs ${textSecondary}`}>({order.amount}积分)</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${order.paymentMethod === 'wechat' ? 'bg-green-500/15 text-green-400' : 'bg-blue-500/15 text-blue-400'}`}>
                              {order.paymentMethod === 'wechat' ? '微信' : '支付宝'}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${order.status === 'paid' ? 'bg-green-500/15 text-green-400' : order.status === 'reversed' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>
                              {order.status === 'paid' ? '已到账' : order.status === 'reversed' ? '已撤销' : '待付款'}
                            </span>
                          </div>
                          <div className={`text-xs ${textSecondary} mt-0.5`}>
                              {order.userId ? `用户: ${order.userId}` : ''} {formatPaymentTimestamp(order.createdAt)}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`text-[10px] ${textSecondary}`}>#{order.id.slice(-6)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

      </main>

      {shareManagementProject && (
        <CanvasShareManagePanel
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setShareManagementProject(null);
          }}
          projectId={shareManagementProject.id}
          projectName={shareManagementProject.name}
        />
      )}

      <ConfirmDialog open={confirmDlg.open} title={confirmDlg.title} message={confirmDlg.message} variant={confirmDlg.variant} onConfirm={confirmDlg.onConfirm} onCancel={confirmDlg.onCancel} />
    </div>
  );
}
