'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AdminRechargeOrders } from './admin-recharge-orders';
import {
  Users, TrendingUp, Wallet, ShieldCheck, Activity, BarChart3, CreditCard,
  Settings2, Search, RefreshCw, Plus, ChevronRight, ChevronDown,
  ChevronLeft, AlertTriangle, Eye, EyeOff, RotateCcw, Save,
  X, Check, Ban, MoreHorizontal, UserPlus, ArrowUpDown, Filter,
  CircleDot, Server, Database, Bell, Lock, HardDrive, Cpu,
  SlidersHorizontal, Shield, Brain, Megaphone, Bold, Italic,
  Underline, Link2, List, AlertCircle, Download,
  CheckCircle, CheckCircle2, Trash2, Info, Pencil, Wrench
} from 'lucide-react';

/* ── Types ── */
export interface AdminGroup {
  id: string; name: string; product_types: string[]; credit_quota: number;
  is_active: boolean; created_at: string; updated_at: string;
}

export interface AdminUser {
  id: string; name: string; role: string; status: string;
  email?: string; credits?: number; createdAt?: number; created_at?: string;
  last_login?: string; project_count?: number; api_permissions?: string[];
  apiPermissions?: Record<string, boolean>;
  productType?: string;
  chatModels?: string[];
  imageModels?: string[];
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
  dailyImageLimit?: number;
  groupId?: string;
  userId?: string;
  consumed?: number;
  totalConsumed?: number;
}

export interface AdminProvider {
  id: string; name: string; base_url: string; api_key: string;
  model_type: string; selected_models: string[]; discovered_models: string[];
  isEnabled: boolean; balance?: number; balanceCurrency?: string;
  compatProfile?: string; advancedParams?: Record<string, unknown>;
  modelType?: string;
  displayName?: string;
  selectedModels?: string[];
}

interface DashboardStats {
  totalUsers: number; dau: number; wau: number; mau: number;
  totalCredits: number; creditsUsedToday: number; creditsUsedWeek: number;
  totalProviders: number; activeProviders: number;
  recentUsers?: Array<{ name: string; date: string; email?: string }>;
  providerHealth?: Array<{ name: string; status: 'healthy' | 'degraded' | 'down'; latency?: number }>;
  alerts?: Array<{ type: 'warning' | 'error'; message: string; time: string }>;
}

interface AuditLogEntry {
  id: string; userId: string; userName: string; action: string;
  targetType?: string; targetId?: string; detail?: string;
  ipAddress?: string; createdAt: number;
  created_at?: string | number;
  errorMessage?: string;
  resolutionStatus?: string;
  model?: string;
  providerId?: string;
  duration?: number;
  stackTrace?: string;
  requestData?: unknown;
}

interface AuditStats {
  todayCount: number; weekCount: number; totalCount: number;
  byAction?: Record<string, number>;
  errorCount?: number;
  warnCount?: number;
  unresolvedCount?: number;
}

interface AuditLogView extends AuditLogEntry {
  user_id?: string;
  user_name?: string;
  target_type?: string;
  target_id?: string;
  level?: string;
}

interface SystemSettings {
  defaultImageModel?: string; defaultChatModel?: string; defaultVideoModel?: string;
  maxConcurrentTasks?: number; imageMaxSizeMB?: number; imageMaxEdge?: number;
  maxUploadMB?: number; maxVideoDuration?: number; storageQuotaMB?: number;
  sessionTimeout?: number; passwordExpiryDays?: number;
  openRegistration?: boolean; apiRateLimiting?: boolean;
  videoGenerationEnabled?: boolean; threeDModelEnabled?: boolean;
  announcementEnabled?: boolean; announcementType?: string;
  announcementExpiry?: string; announcement?: string;
}

interface AdminTabsProps {
  activeTab: string;
  adminUsers: AdminUser[];
  adminGroups: AdminGroup[];
  onRefreshAdmin: () => void;
  onCreateUser: (name: string, password: string, email: string, groupId?: string) => Promise<void>;
  onRenameUser: (userId: string, newName: string) => Promise<void>;
  onResetPassword: (userId: string, newPassword: string) => Promise<void>;
  onToggleUser: (user: AdminUser) => Promise<void>;
  onDeleteUser: (user: AdminUser) => void;
  onToggleUserPermission: (user: AdminUser, key: string) => Promise<void>;
  onRechargeCredits: (userId: string, amount: number, description: string) => Promise<void>;
  onUpdateUserGroup?: (userId: string, groupId: string) => Promise<void>;
  onUpdateUserModels?: (userId: string, chatModels: string[], imageModels: string[]) => Promise<void>;
  adminChatModels?: { id: string; name: string; providerId: string }[];
  adminImageModels?: { id: string; name: string; providerId: string }[];
  providers: AdminProvider[];
  onTabChange?: (tab: string) => void;
  onOpenApiManager?: () => void;
}

/* ── Mapping: prototype M3 class → shadcn class ── */
// bg-surface → bg-card, bg-surface-container → bg-muted rounded-t-md, text-on-surface → text-foreground
// text-on-surface-variant → text-muted-foreground, bg-primary/15 → bg-primary/15
// border-outline-variant → border-border, shadow-card → shadow-card
// bg-error/15 → bg-destructive/15, text-error → text-destructive
// bg-success → bg-green-500, text-success → text-green-500
// bg-warning → bg-yellow-500, text-warning → text-yellow-500
// bg-info → bg-blue-500, text-info → text-blue-500

/* ── Helpers ── */
function formatNumber(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  if (n >= 1000) return n.toLocaleString();
  return String(n);
}

function formatDate(iso: string | number | undefined): string {
  if (!iso) return '-';
  const d = new Date(typeof iso === 'number' ? iso : iso);
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getUserCredits(u: AdminUser): number { return u.credits ?? 0; }
function getUserProjects(u: AdminUser): number { return u.project_count ?? 0; }
function getUserCreated(u: AdminUser): string { return formatDate(u.createdAt ?? u.created_at); }
function getUserLastLogin(u: AdminUser): string { return u.last_login ? formatDate(u.last_login) : '从未'; }
function getUserEmail(u: AdminUser): string { return u.email ?? '-'; }
function getUserPermissions(u: AdminUser): Record<string, boolean> { return u.apiPermissions ?? {}; }

function formatDateTime(ts: string | number): string {
  if (!ts) return '-';
  // created_at 存储为毫秒时间戳，需要正确处理
  const numTs = typeof ts === 'string' ? (isNaN(Number(ts)) ? ts : Number(ts)) : ts;
  const d = typeof numTs === 'number' ? new Date(numTs) : new Date(numTs);
  if (isNaN(d.getTime())) return '-';
  // 使用本地时区显示
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

/* ── Sub-components matching prototype exactly ── */

function StatCard({ icon: Icon, label, value, sub, colorClass, iconBg }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string;
  colorClass: string; iconBg: string;
}) {
  return (
    <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${colorClass}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground mb-1">{label}</p>
          <p className="text-2xl font-bold text-foreground tracking-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function DonutChart({ segments }: { segments: { label: string; value: number; color: string; pct: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = 40, c = 2 * Math.PI * r;
  const circleData = segments.reduce<Array<{ seg: typeof segments[0]; dashArr: string; dashOff: number }>>((acc, seg, idx) => {
    const cumPct = segments.slice(0, idx).reduce((sum, s) => sum + (s.value / total) * 100, 0);
    const pct = (seg.value / total) * 100;
    const dashLen = (pct / 100) * c;
    const dashArr = `${dashLen} ${c - dashLen}`;
    const dashOff = -(cumPct / 100) * c;
    acc.push({ seg, dashArr, dashOff });
    return acc;
  }, []);
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="12" />
        {circleData.map((d, i) => (
          <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={d.seg.color} strokeWidth="12" strokeDasharray={d.dashArr} strokeDashoffset={d.dashOff} strokeLinecap="round" />
        ))}
      </svg>
      <div className="space-y-2 min-w-0">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-muted-foreground truncate">{seg.label}</span>
            <span className="text-foreground font-mono font-medium ml-auto">{seg.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main Component ── */
export default function AdminTabs(props: AdminTabsProps) {
  const { activeTab, adminUsers, onRefreshAdmin, providers } = props;
  const [loading, setLoading] = useState(false);

  /* ── Overview state ── */
  const [overviewData, setOverviewData] = useState<{
    totalUsers: number; weekActive: number; totalCredits: number; totalApiCalls: number;
    creditsRecharged: number; creditsConsumed: number; todayGenerations: number;
    userTrend: { date: string; count: number }[];
    creditTrend: { date: string; income: number; expense: number }[];
    modelRank: { name: string; calls: number; successRate: number }[];
    providerStatus: { name: string; calls24h: number; failRate: number; status: string }[];
    alerts: { type: string; severity: string; items: { name: string; value: string }[] }[];
    recentUsers: { name: string; date: string; email: string }[];
  } | null>(null);
  const [overviewPeriod, setOverviewPeriod] = useState<'7' | '30'>('7');

  /* ── Users state ── */
  const [userSearch, setUserSearch] = useState('');
  const [userFilterRole, setUserFilterRole] = useState('all');
  const [userFilterStatus, setUserFilterStatus] = useState('all');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [userDetailId, setUserDetailId] = useState<string | null>(null);
  const [showUserAddDrawer, setShowUserAddDrawer] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserGroupId, setNewUserGroupId] = useState('');
  const [userFilterGroup, setUserFilterGroup] = useState('all');
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [showResetPasswordValue, setShowResetPasswordValue] = useState(false);
  const [showResetPasswordConfirm, setShowResetPasswordConfirm] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState('');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

  /* ── Credits state ── */
  const [creditsOverview, setCreditsOverview] = useState<{
    totalBalance: number; totalRecharged: number; totalConsumed: number; totalUsers: number; avgPerUser: number;
    distribution: { label: string; value: number; color: string; pct: string }[];
    topUsers: { userId?: string; name: string; consumed: number; totalConsumed: number; balance: number; totalRecharged: number; pct?: string }[];
    recentTransactions: { id: string; user: string; type: string; amount: number; desc: string; time: string }[];
  } | null>(null);
  const [rechargeUserId, setRechargeUserId] = useState<string | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState(100);
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [creditSubTab, setCreditSubTab] = useState('user-credits');
  const [creditSearch, setCreditSearch] = useState('');
  const [creditSort, setCreditSort] = useState('balance');
  const [modelCreditRules, setModelCreditRules] = useState<Record<string, number | { credits: number; quality?: Record<string, number>; resolution?: Record<string, number> }>>({});
  const [modelCreditCatalog, setModelCreditCatalog] = useState<Array<{ providerId: string; providerName: string; model: string; modelType: string; credits: number; unit: string; source: string; quality?: Record<string, number>; resolution?: Record<string, number> }>>([]);
  const [pricingSaving, setPricingSaving] = useState(false);

  /* ── Audit state ── */
  const [auditLogs, setAuditLogs] = useState<AuditLogView[]>([]);
  const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilterAction, setAuditFilterAction] = useState('all');
  const [auditFilterLevel, setAuditFilterLevel] = useState('all');
  const [auditFilterUserId, setAuditFilterUserId] = useState('');
  const [auditExpandedId, setAuditExpandedId] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditAiAnalysis, setAuditAiAnalysis] = useState<Record<string, string>>({});
  const [auditAiLoading, setAuditAiLoading] = useState<string | null>(null);

  /* ── Settings state ── */
  const [systemSettings, setSystemSettings] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);

  /* ── Data loading ── */
  const loadDashboardStats = useCallback(async (period: '7' | '30' = '7') => {
    try {
      const res = await fetch(`/api/admin/dashboard-stats?period=${period}`);
      if (res.ok) { const data = await res.json(); setOverviewData(data); }
    } catch {}
  }, []);

  const loadAuditLogs = useCallback(async (page = 1, action = 'all', level = 'all', userId = '') => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (action !== 'all') params.set('action', action);
      if (level !== 'all') params.set('level', level);
      if (userId) params.set('userId', userId);
      const res = await fetch(`/api/admin/op-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
        setAuditTotal(data.total || 0);
        setAuditStats(data.stats || { todayCount: 0, weekCount: 0, totalCount: 0, errorCount: 0, warnCount: 0, unresolvedCount: 0 });
      }
    } catch {} finally { setAuditLoading(false); }
  }, []);

  const loadCreditsOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/credits/overview');
      if (res.ok) { const data = await res.json(); setCreditsOverview(data); }
    } catch {}
  }, []);

  const loadModelCreditPricing = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/credits/pricing');
      if (!res.ok) return;
      const data = await res.json();
      const catalog = data.models || [];
      setModelCreditCatalog(catalog);
      // Build rules: support both flat number and {credits, quality, resolution} objects
      const rules: Record<string, number | { credits: number; quality?: Record<string, number>; resolution?: Record<string, number> }> = {};
      for (const item of catalog) {
        const hasQuality = item.quality && Object.keys(item.quality).length > 0;
        const hasResolution = item.resolution && Object.keys(item.resolution).length > 0;
        if (hasQuality || hasResolution) {
          rules[item.model] = { credits: item.credits, ...(hasQuality ? { quality: item.quality } : {}), ...(hasResolution ? { resolution: item.resolution } : {}) };
        } else {
          rules[item.model] = item.credits;
        }
      }
      setModelCreditRules(rules);
    } catch { /* retain the current editable values */ }
  }, []);

  const loadSystemSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const data = await res.json();
        setSystemSettings(data.settings || {});
        setSettingsDirty(false);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (activeTab === 'overview') loadDashboardStats();
    if (activeTab === 'audit') loadAuditLogs();
    if (activeTab === 'credits') { loadCreditsOverview(); loadModelCreditPricing(); }
    if (activeTab === 'settings') loadSystemSettings();
  }, [activeTab, loadDashboardStats, loadAuditLogs, loadCreditsOverview, loadModelCreditPricing, loadSystemSettings]);

  /* ── Filtered users ── */
  const filteredUsers = useMemo(() => {
    let list = adminUsers;
    if (userSearch) {
      const q = userSearch.toLowerCase();
      list = list.filter(u => u.name.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
    }
    if (userFilterRole !== 'all') list = list.filter(u => u.role === userFilterRole);
    if (userFilterStatus !== 'all') list = list.filter(u => u.status === userFilterStatus);
    if (userFilterGroup !== 'all') list = list.filter(u => (u.groupId || '') === userFilterGroup);
    return list;
  }, [adminUsers, userSearch, userFilterRole, userFilterStatus, userFilterGroup]);

  /* ── Handlers ── */
  const handleRefresh = async () => { setLoading(true); await onRefreshAdmin(); setLoading(false); };

  const [settingsSaved, setSettingsSaved] = useState(false);

  const handleSaveSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(systemSettings)
      });
      if (res.ok) {
        setSettingsDirty(false);
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 2500);
      }
    } catch {}
  };

  const handleBatchToggleUsers = async (enable: boolean) => {
    for (const uid of selectedUserIds) {
      const u = adminUsers.find(u => u.id === uid);
      if (u && ((enable && u.status === 'disabled') || (!enable && u.status === 'active'))) {
        await props.onToggleUser(u);
      }
    }
    setSelectedUserIds(new Set());
  };

  /* ── Render: Overview Tab ── */
  if (activeTab === 'overview') {
    const s = overviewData;
    const handleRefresh = () => loadDashboardStats(overviewPeriod);
    const handleTogglePeriod = (p: '7' | '30') => { setOverviewPeriod(p); loadDashboardStats(p); };
    const viewAllAlerts = () => { if (props.onTabChange) props.onTabChange('audit'); };
    const viewAllUsers = () => { if (props.onTabChange) props.onTabChange('users'); };
    const viewProviders = () => { if (props.onOpenApiManager) props.onOpenApiManager(); };

    // Compute chart data from API or defaults
    const trendDates = s?.userTrend?.map(t => t.date) || [];
    const trendCounts = s?.userTrend?.map(t => t.count) || [];
    const creditIncome = s?.creditTrend?.map(t => t.income) || [];
    const creditExpense = s?.creditTrend?.map(t => t.expense) || [];

    // SVG chart helper
    const svgW = 500, svgH = 200, padL = 40, padB = 30, padR = 10, padT = 10;
    const chartW = svgW - padL - padR;
    const chartH = svgH - padT - padB;
    const maxVal = (arr: number[]) => Math.max(...arr, 1);

    return (
      <div className="space-y-4 px-6 pt-6 pb-8">
        {/* 页面头部 */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold text-foreground">运营总览</h1>
            <p className="text-sm text-muted-foreground mt-0.5">平台运营数据与趋势分析</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setOverviewPeriod('7')} className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${overviewPeriod === '7' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'}`}>7天</button>
            <button onClick={() => setOverviewPeriod('30')} className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${overviewPeriod === '30' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'}`}>30天</button>
            <button onClick={() => loadDashboardStats(overviewPeriod)} className="px-3 py-1.5 text-xs rounded-md bg-muted text-muted-foreground border border-border hover:bg-muted/80 transition-colors flex items-center gap-1"><RefreshCw className="w-3 h-3" />刷新</button>
          </div>
        </div>
        {/* 1. 统计卡片 — 匹配原型: 总用户/总积分充值/总积分消耗/今日生成 */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Users} label="总用户" value={s ? formatNumber(s.totalUsers) : '-'} sub={s ? `周活 ${formatNumber(s.weekActive)}` : ''} colorClass="text-primary" iconBg="bg-primary/15" />
          <StatCard icon={Wallet} label="总积分充值" value={s ? formatNumber(s.creditsRecharged ?? s.totalCredits) : '-'} sub="全平台累计" colorClass="text-yellow-500" iconBg="bg-yellow-500/15" />
          <StatCard icon={CreditCard} label="总积分消耗" value={s ? formatNumber(s.creditsConsumed ?? 0) : '-'} sub="全平台累计" colorClass="text-red-400" iconBg="bg-red-400/15" />
          <StatCard icon={Activity} label="今日生成" value={s ? formatNumber(s.todayGenerations ?? 0) : '-'} sub="图片+视频+3D" colorClass="text-green-500" iconBg="bg-green-500/15" />
        </div>

        {/* 2. 趋势图区 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 用户活跃趋势 */}
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">用户活跃趋势</h2>
                <p className="text-xs text-muted-foreground mt-0.5">DAU / 新增</p>
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                <button onClick={() => handleTogglePeriod('7')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${overviewPeriod === '7' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>7天</button>
                <button onClick={() => handleTogglePeriod('30')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${overviewPeriod === '30' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>30天</button>
              </div>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-primary/60 rounded-sm" /><span className="text-xs text-muted-foreground">活跃</span></div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-green-500/60 rounded-sm" /><span className="text-xs text-muted-foreground">新增</span></div>
            </div>
            <div className="relative">
              {trendCounts.length > 0 ? (
                <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ overflow: 'visible' }}>
                  <line x1={padL} y1={padT} x2={padL} y2={svgH - padB} stroke="currentColor" className="text-border" strokeWidth="0.5" />
                  <line x1={padL} y1={svgH - padB} x2={svgW - padR} y2={svgH - padB} stroke="currentColor" className="text-border" strokeWidth="0.5" />
                  {[0.25, 0.5, 0.75].map((pct, i) => <line key={i} x1={padL} y1={padT + chartH * (1 - pct)} x2={svgW - padR} y2={padT + chartH * (1 - pct)} stroke="currentColor" className="text-border" strokeWidth="0.5" strokeDasharray="4,4" />)}
                  {/* DAU line */}
                  {(() => {
                    const max = maxVal(trendCounts);
                    const pts = trendCounts.map((v, i) => {
                      const x = padL + (chartW / Math.max(trendCounts.length - 1, 1)) * i;
                      const y = padT + chartH * (1 - v / max);
                      return `${x},${y}`;
                    }).join(' ');
                    return <>
                      <polyline fill="none" stroke="#d4af37" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts} />
                      <polygon fill="url(#dauGrad)" opacity="0.3" points={`${pts} ${padL + chartW},${svgH - padB} ${padL},${svgH - padB}`} />
                    </>;
                  })()}
                  <defs><linearGradient id="dauGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d4af37" /><stop offset="100%" stopColor="#d4af37" stopOpacity="0" /></linearGradient></defs>
                  {/* Date labels */}
                  {trendDates.map((d, i) => {
                    const x = padL + (chartW / Math.max(trendDates.length - 1, 1)) * i;
                    const short = d.slice(5);
                    return <text key={i} x={x} y={svgH - 8} fill="#a1a1aa" fontSize="9" textAnchor="middle">{short}</text>;
                  })}
                </svg>
              ) : (
                <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">暂无趋势数据</div>
              )}
            </div>
          </div>

          {/* 积分收支趋势 */}
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">积分收支趋势</h2>
                <p className="text-xs text-muted-foreground mt-0.5">充值 / 消耗对比</p>
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                <button onClick={() => handleTogglePeriod('7')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${overviewPeriod === '7' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>7天</button>
                <button onClick={() => handleTogglePeriod('30')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${overviewPeriod === '30' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>30天</button>
              </div>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-green-500/60 rounded-sm" /><span className="text-xs text-muted-foreground">充值</span></div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-yellow-500/60 rounded-sm" /><span className="text-xs text-muted-foreground">消耗</span></div>
            </div>
            <div className="relative">
              {creditIncome.length > 0 || creditExpense.length > 0 ? (
                <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ overflow: 'visible' }}>
                  <line x1={padL} y1={padT} x2={padL} y2={svgH - padB} stroke="currentColor" className="text-border" strokeWidth="0.5" />
                  <line x1={padL} y1={svgH - padB} x2={svgW - padR} y2={svgH - padB} stroke="currentColor" className="text-border" strokeWidth="0.5" />
                  {[0.25, 0.5, 0.75].map((pct, i) => <line key={i} x1={padL} y1={padT + chartH * (1 - pct)} x2={svgW - padR} y2={padT + chartH * (1 - pct)} stroke="currentColor" className="text-border" strokeWidth="0.5" strokeDasharray="4,4" />)}
                  {/* Bar pairs */}
                  {(() => {
                    const max = Math.max(maxVal(creditIncome), maxVal(creditExpense));
                    const n = Math.max(creditIncome.length, creditExpense.length, 1);
                    const barW = Math.min(16, (chartW / n) * 0.35);
                    const gap = 2;
                    return Array.from({ length: n }, (_, i) => {
                      const cx = padL + (chartW / n) * (i + 0.5);
                      const h1 = Math.max((creditIncome[i] || 0) / max * chartH, 1);
                      const h2 = Math.max((creditExpense[i] || 0) / max * chartH, 1);
                      return <React.Fragment key={i}>
                        <rect x={cx - barW - gap/2} y={padT + chartH - h1} width={barW} height={h1} rx="2" fill="rgba(34,197,94,0.6)" />
                        <rect x={cx + gap/2} y={padT + chartH - h2} width={barW} height={h2} rx="2" fill="rgba(245,158,11,0.6)" />
                      </React.Fragment>;
                    });
                  })()}
                  {/* Date labels */}
                  {(s?.creditTrend || []).map((t, i) => {
                    const n = Math.max(s?.creditTrend?.length || 1, 1);
                    const cx = padL + (chartW / n) * (i + 0.5);
                    return <text key={i} x={cx} y={svgH - 8} fill="#a1a1aa" fontSize="9" textAnchor="middle">{t.date.slice(5)}</text>;
                  })}
                </svg>
              ) : (
                <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">暂无收支数据</div>
              )}
            </div>
          </div>
        </div>

        {/* 3. API调用量排行 + 提供商健康 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 模型调用量排行 Top10 */}
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">模型调用量排行</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Top 10 模型近{overviewPeriod}日调用统计</p>
              </div>
              <button onClick={viewAllAlerts} className="text-xs text-primary hover:underline inline-flex items-center gap-1 cursor-pointer">查看全部 <ChevronRight className="w-3 h-3" /></button>
            </div>
            <div className="space-y-2.5">
              {(s?.modelRank || []).length > 0 ? (
                (s!.modelRank || []).map((m, i) => {
                  const maxCalls = s!.modelRank![0]?.calls || 1;
                  const pct = (m.calls / maxCalls * 100).toFixed(1);
                  const barColors = ['bg-primary', 'bg-primary/80', 'bg-primary/60', 'bg-blue-500/60', 'bg-blue-500/50', 'bg-blue-500/40', 'bg-blue-500/30', 'bg-blue-500/25', 'bg-blue-500/20', 'bg-blue-500/15'];
                  const rateColor = m.successRate >= 95 ? 'text-green-500' : m.successRate >= 90 ? 'text-yellow-500' : 'text-destructive';
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`w-5 text-xs font-bold text-right ${i < 3 ? 'text-primary' : 'text-muted-foreground'}`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-foreground truncate">{m.name}</span>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs ${rateColor}`}>{m.successRate}%</span>
                            <span className="text-xs font-mono text-muted-foreground">{m.calls.toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${barColors[i] || 'bg-blue-500/15'} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无模型调用数据</div>
              )}
            </div>
          </div>

          {/* API 提供商状态 */}
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">API 提供商状态</h2>
                <p className="text-xs text-muted-foreground mt-0.5">近24h健康监控</p>
              </div>
              <button onClick={viewProviders} className="text-xs text-primary hover:underline inline-flex items-center gap-1 cursor-pointer">管理配置 <ChevronRight className="w-3 h-3" /></button>
            </div>
            <div className="space-y-3">
              {(s?.providerStatus || []).length > 0 ? (
                (s!.providerStatus || []).map((p, i) => {
                  const dotColor = p.status === '正常' ? 'bg-green-500' : p.status === '告警' ? 'bg-yellow-500' : 'bg-destructive';
                  const badgeBg = p.status === '正常' ? 'bg-green-500/15 text-green-500' : p.status === '告警' ? 'bg-yellow-500/15 text-yellow-500' : 'bg-destructive/15 text-destructive';
                  const rateColor = p.failRate < 5 ? 'text-green-500' : p.failRate < 10 ? 'text-yellow-500' : 'text-destructive';
                  return (
                    <div key={i} className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                        <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-6 text-xs">
                        <div className="text-muted-foreground">24h <span className="text-foreground font-mono font-medium">{p.calls24h.toLocaleString()}</span></div>
                        <div className="text-muted-foreground">失败率 <span className={`${rateColor} font-mono font-medium`}>{p.failRate}%</span></div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${badgeBg}`}>{p.status}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无提供商数据</div>
              )}
            </div>
          </div>
        </div>

        {/* 4. 异常预警 */}
        <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-destructive/15 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-destructive" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">异常预警</h2>
                <p className="text-xs text-muted-foreground mt-0.5">需要关注的系统异常</p>
              </div>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-destructive/15 text-destructive">{(s?.alerts || []).length} 条预警</span>
          </div>
          {(s?.alerts || []).length > 0 ? (
            <div className="grid grid-cols-3 gap-4">
              {(s?.alerts || []).map((alert, ai) => {
                const borderColor = alert.severity === 'error' ? 'border-destructive' : alert.severity === 'warning' ? 'border-yellow-500' : 'border-blue-500';
                const iconColor = alert.severity === 'error' ? 'text-destructive' : alert.severity === 'warning' ? 'text-yellow-500' : 'text-blue-500';
                const Icon = alert.type === 'balance' ? Wallet : alert.type === 'failRate' ? Activity : AlertTriangle;
                const label = alert.type === 'balance' ? '余额不足' : alert.type === 'failRate' ? '高失败率' : '系统警告';
                return (
                  <div key={ai} className={`bg-muted/50 rounded-lg p-4 border-l-2 ${borderColor}`}>
                    <div className="flex items-center gap-2 mb-2"><Icon className={`w-3.5 h-3.5 ${iconColor}`} /><span className={`text-xs font-semibold ${iconColor}`}>{label}</span></div>
                    <div className="space-y-1.5">
                      {(alert.items || []).map((item, ii) => (
                        <div key={ii} className="flex items-center justify-between"><span className="text-xs text-foreground">{item.name}</span><span className={`text-xs font-mono ${item.value.includes('异常') || item.value.includes('高') ? 'text-yellow-500' : 'text-foreground'}`}>{item.value}</span></div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无预警信息，系统运行正常</div>
          )}
        </div>

        {/* 5. 最近注册 */}
        <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">最近注册用户</h2>
            <button onClick={viewAllUsers} className="text-xs text-primary hover:underline inline-flex items-center gap-1 cursor-pointer">查看全部 <ChevronRight className="w-3 h-3" /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/50">
                  <th className="text-left py-2.5 px-3 font-medium">用户名</th>
                  <th className="text-left py-2.5 px-3 font-medium">邮箱</th>
                  <th className="text-left py-2.5 px-3 font-medium">注册时间</th>
                </tr>
              </thead>
              <tbody>
                {(s?.recentUsers || adminUsers.slice(0, 5).map(u => ({ name: u.name, date: getUserCreated(u), email: getUserEmail(u) }))).map((u, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 px-3 text-foreground font-medium">{u.name}</td>
                    <td className="py-2.5 px-3 text-muted-foreground">{u.email || '-'}</td>
                    <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs">{formatDate(u.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 6. 操作栏 */}
        <div className="flex items-center justify-end gap-3">
          <button onClick={handleRefresh} className="h-9 px-4 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:text-foreground transition-colors flex items-center gap-2 cursor-pointer"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />刷新数据</button>
        </div>
      </div>
    );
  }

  /* ── Render: Users Tab ── */
  if (activeTab === 'users') {
    const detailUser = userDetailId ? adminUsers.find(u => u.id === userDetailId) : null;
    const getGroupName = (gid?: string) => {
      if (!gid) return null;
      const g = props.adminGroups.find(grp => grp.id === gid);
      return g ? g.name : null;
    };
    return (
      <div className="space-y-4 px-6 pt-6 pb-8">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">用户管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">查看和管理平台所有用户</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleRefresh} className="h-9 px-4 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:text-foreground transition-colors flex items-center gap-2 cursor-pointer"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />刷新</button>
          </div>
        </div>
        {/* 操作栏：搜索 + 筛选 + 批量操作 + 添加 */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="搜索用户名 / 邮箱" className="bg-background border border-border rounded-md pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 w-64 transition-colors" />
            </div>
            <div className="relative inline-flex items-center">
              <select value={userFilterRole} onChange={e => setUserFilterRole(e.target.value)} className="bg-background border border-border rounded-md pl-3 pr-8 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer appearance-none">
                <option value="all">全部角色</option><option value="admin">Admin</option><option value="user">User</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 pointer-events-none" />
            </div>
            <div className="relative inline-flex items-center">
              <select value={userFilterStatus} onChange={e => setUserFilterStatus(e.target.value)} className="bg-background border border-border rounded-md pl-3 pr-8 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer appearance-none">
                <option value="all">全部状态</option><option value="active">活跃</option><option value="disabled">禁用</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 pointer-events-none" />
            </div>
            <div className="relative inline-flex items-center">
              <select value={userFilterGroup} onChange={e => setUserFilterGroup(e.target.value)} className="bg-background border border-border rounded-md pl-3 pr-8 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer appearance-none">
                <option value="all">全部分组</option>
                {props.adminGroups.filter(g => g.is_active).map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
                <option value="">未分组</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 pointer-events-none" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleBatchToggleUsers(true)} disabled={selectedUserIds.size === 0} className={`bg-muted text-muted-foreground px-3 py-2 rounded-md text-sm font-medium transition-all inline-flex items-center gap-1.5 ${selectedUserIds.size === 0 ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground cursor-pointer'}`}><CheckCircle className="w-3.5 h-3.5" />批量启用</button>
            <button onClick={() => handleBatchToggleUsers(false)} disabled={selectedUserIds.size === 0} className={`bg-muted text-muted-foreground px-3 py-2 rounded-md text-sm font-medium transition-all inline-flex items-center gap-1.5 ${selectedUserIds.size === 0 ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground cursor-pointer'}`}><Ban className="w-3.5 h-3.5" />批量禁用</button>
            <button onClick={() => { if (selectedUserIds.size > 0) selectedUserIds.forEach(id => props.onDeleteUser(adminUsers.find(u => u.id === id)!)); }} disabled={selectedUserIds.size === 0} className={`bg-muted text-muted-foreground px-3 py-2 rounded-md text-sm font-medium transition-all inline-flex items-center gap-1.5 ${selectedUserIds.size === 0 ? 'cursor-not-allowed opacity-50' : 'hover:text-destructive cursor-pointer'}`}><Trash2 className="w-3.5 h-3.5" />批量删除</button>
            <div className="w-px h-6 bg-border/30 mx-1" />
            <button onClick={() => setShowUserAddDrawer(true)} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all inline-flex items-center gap-2"><UserPlus className="w-4 h-4" />添加用户</button>
          </div>
        </div>
        {/* 选中提示 */}
        {selectedUserIds.size > 0 && (
          <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 rounded-md px-3 py-2">
            <Info className="w-4 h-4" />
            <span>已选择 {selectedUserIds.size} 位用户</span>
            <button onClick={() => setSelectedUserIds(new Set())} className="text-muted-foreground hover:text-foreground ml-auto text-xs">取消选择</button>
          </div>
        )}

        {/* 用户列表表格 */}
        <div className="bg-card rounded-lg shadow-card overflow-hidden border border-border/50">
          {/* 表头 */}
          <div className="grid grid-cols-[40px_1fr_1.2fr_90px_80px_90px_90px_70px_100px_110px_100px] items-center px-4 py-3 bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/20">
            <div className="flex items-center justify-center">
              <input type="checkbox" checked={selectedUserIds.size > 0 && selectedUserIds.size === filteredUsers.length} onChange={() => { if (selectedUserIds.size === filteredUsers.length) setSelectedUserIds(new Set()); else setSelectedUserIds(new Set(filteredUsers.map(u => u.id))); }} className="w-4 h-4 rounded border-border accent-primary" />
            </div>
            <span>用户名</span><span>邮箱</span><span>分组</span><span>角色</span><span>状态</span><span>积分余额</span><span>作品数</span><span>注册时间</span><span>最后登录</span><span className="text-right">操作</span>
          </div>
          {/* 表体 */}
          <div className="divide-y divide-border/20">
            {filteredUsers.map(u => {
              const isActive = u.status === 'active';
              const isSelected = selectedUserIds.has(u.id);
              return (
                <div key={u.id} className={`grid grid-cols-[40px_1fr_1.2fr_90px_80px_90px_90px_70px_100px_110px_100px] items-center px-4 py-3 hover:bg-muted/30 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
                  <div className="flex items-center justify-center">
                    <input type="checkbox" checked={isSelected} onChange={() => setSelectedUserIds(prev => { const n = new Set(prev); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; })} className="w-4 h-4 rounded border-border accent-primary" />
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">{u.name.charAt(0).toUpperCase()}</div>
                    <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground truncate">{getUserEmail(u) || '-'}</span>
                  <span className="text-xs text-muted-foreground">{getGroupName(u.groupId) || '-'}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium w-fit ${u.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-blue-500/15 text-blue-500'}`}>{u.role === 'admin' ? 'admin' : 'user'}</span>
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                    <span className={`text-xs ${isActive ? 'text-green-500' : 'text-muted-foreground'}`}>{isActive ? '活跃' : '禁用'}</span>
                  </span>
                  <span className="text-sm font-medium text-foreground">{getUserCredits(u).toLocaleString()}</span>
                  <span className="text-sm text-muted-foreground">{getUserProjects(u) || '-'}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(getUserCreated(u))}</span>
                  <span className="text-xs text-muted-foreground">-</span>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => setUserDetailId(u.id)} className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="详情"><Eye className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setUserDetailId(u.id)} className="p-1.5 rounded-md hover:bg-muted transition-colors text-primary" title="编辑"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => props.onToggleUser(u)} className="p-1.5 rounded-md hover:bg-muted transition-colors text-yellow-500" title={isActive ? '禁用' : '启用'}><Ban className="w-3.5 h-3.5" /></button>
                    <button onClick={() => props.onDeleteUser(u)} className="p-1.5 rounded-md hover:bg-muted transition-colors text-destructive" title="删除"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
            {filteredUsers.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">暂无用户数据</div>}
          </div>
        </div>

        {/* 用户详情抽屉 */}
        {detailUser && (
          <div className="fixed inset-0 z-[200] flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setUserDetailId(null)} />
            <div className="ml-auto w-[420px] h-full bg-card border-l border-border overflow-y-auto relative z-10">
              <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/50 px-6 py-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">用户详情</h3>
                <button onClick={() => setUserDetailId(null)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-6 space-y-6">
                {/* 基础信息 */}
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center"><span className="text-xl font-bold text-primary">{detailUser.name.charAt(0).toUpperCase()}</span></div>
                  <div>
                    <div className="flex items-center gap-2"><span className="text-lg font-semibold text-foreground">{detailUser.name}</span><span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${detailUser.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-blue-500/15 text-blue-500'}`}>{detailUser.role === 'admin' ? '管理员' : '用户'}</span></div>
                    <p className="text-xs text-muted-foreground mt-0.5">{detailUser.email || '未设置邮箱'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-foreground">{(detailUser.credits ?? 0).toLocaleString()}</p><p className="text-[10px] text-muted-foreground mt-0.5">积分余额</p></div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-foreground">{detailUser.project_count ?? '-'}</p><p className="text-[10px] text-muted-foreground mt-0.5">作品数</p></div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center"><p className="text-xs font-bold text-foreground">{getUserCreated(detailUser)}</p><p className="text-[10px] text-muted-foreground mt-0.5">注册时间</p></div>
                </div>
                {/* 所属分组 */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">所属分组</h4>
                  <select
                    value={detailUser.groupId || ''}
                    onChange={async (e) => {
                      const gid = e.target.value;
                      if (props.onUpdateUserGroup) await props.onUpdateUserGroup(detailUser.id, gid);
                    }}
                    className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">无分组</option>
                    {props.adminGroups.filter(g => g.is_active).map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">分组的产品权限和积分配额会自动应用</p>
                </div>
                {/* 模型权限 */}
                <div className="space-y-3">
                  {(() => {
                    const modelSections: { key: string; title: string; models: { id: string; name: string }[]; current: string[]; onChange: (ids: string[]) => void }[] = [];
                    if (props.adminChatModels && props.adminChatModels.length > 0) {
                      modelSections.push({
                        key: 'chat', title: '聊天模型',
                        models: props.adminChatModels,
                        current: detailUser.chatModels || [],
                        onChange: (ids) => props.onUpdateUserModels?.(detailUser.id, ids, detailUser.imageModels || []),
                      });
                    }
                    if (props.adminImageModels && props.adminImageModels.length > 0) {
                      modelSections.push({
                        key: 'image', title: '图像模型',
                        models: props.adminImageModels,
                        current: detailUser.imageModels || [],
                        onChange: (ids) => props.onUpdateUserModels?.(detailUser.id, detailUser.chatModels || [], ids),
                      });
                    }
                    if (modelSections.length === 0) return null;
                    return modelSections.map(section => {
                      const allIds = section.models.map(m => m.id);
                      const isAll = section.current.length === 0 || allIds.every(id => section.current.includes(id));
                      const isNone = section.current.length > 0 && !allIds.some(id => section.current.includes(id));
                      return (
                        <div key={section.key}>
                          <div className="flex items-center justify-between mb-1.5">
                            <h4 className="text-xs font-semibold text-foreground">{section.title}</h4>
                            <div className="flex gap-2 text-[10px]">
                              <button
                                onClick={() => section.onChange(allIds)}
                                className={`${isAll && section.current.length > 0 ? 'text-primary' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
                              >全选</button>
                              <button
                                onClick={() => section.onChange([])}
                                className={`${isNone ? 'text-primary' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
                              >不限</button>
                            </div>
                          </div>
                          <div className="max-h-[140px] overflow-y-auto bg-muted/20 rounded-lg p-2 grid grid-cols-2 gap-0.5">
                            {section.models.map(m => {
                              const isCustom = section.current.length > 0;
                              const checked = !isCustom || section.current.includes(m.id);
                              return (
                                <label key={m.id} className={`flex items-center gap-1.5 px-1.5 py-1 rounded cursor-pointer ${isCustom && !section.current.includes(m.id) ? 'opacity-30 hover:opacity-60' : 'hover:bg-muted/40'}`}>
                                  <input
                                    type="checkbox" checked={checked}
                                    onChange={() => {
                                      if (section.current.length === 0) section.onChange(allIds.filter(x => x !== m.id));
                                      else if (section.current.includes(m.id)) section.onChange(section.current.filter(x => x !== m.id));
                                      else section.onChange([...section.current, m.id]);
                                    }}
                                    className="w-3 h-3 rounded accent-primary shrink-0"
                                  />
                                  <span className="text-[11px] text-foreground truncate">{m.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
                {/* 产品类型 */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">产品授权</h4>
                  <div className="space-y-2">
                    {[
                      { key: 'canvas', label: '无限画布', desc: 'AI图像生成与协作平台' },
                      { key: 'chat', label: '智能对话', desc: 'AI对话与图像生成助手' },
                    ].map(({ key, label, desc }) => {
                      const productType = detailUser.productType || '';
                      const has = productType.includes(key);
                      const handleToggle = async () => {
                        const current = productType.split(',').filter(Boolean);
                        const next = has ? current.filter(k => k !== key) : [...current, key];
                        const newProductType = next.join(',') || '';
                        try {
                          const res = await fetch('/api/admin/users', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'update', userId: detailUser.id, updates: { productType: newProductType } }),
                          });
                          if (res.ok) {
                            props.onRefreshAdmin();
                          }
                        } catch {}
                      };
                      return (
                        <div key={key} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg">
                          <div><span className="text-sm text-foreground">{label}</span><p className="text-[10px] text-muted-foreground">{desc}</p></div>
                          <button onClick={handleToggle} className={`w-10 h-5 rounded-full relative transition-colors ${has ? 'bg-primary' : 'bg-muted'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${has ? 'left-5.5 translate-x-0' : 'left-0.5'}`} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* 配额 */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">使用配额</h4>
                  <div className="space-y-2">
                    {[
                      { key: 'dailyTokenLimit', label: '日Token上限', val: detailUser.dailyTokenLimit ?? 0 },
                      { key: 'monthlyTokenLimit', label: '月Token上限', val: detailUser.monthlyTokenLimit ?? 0 },
                      { key: 'dailyImageLimit', label: '日生图上限', val: detailUser.dailyImageLimit ?? 0 },
                    ].map(({ key, label, val }) => (
                      <div key={key} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg">
                        <span className="text-sm text-foreground">{label}</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            defaultValue={val || 0}
                            min={0}
                            className="w-20 h-7 px-2 rounded bg-background border border-border text-xs text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
                            placeholder="0=不限"
                            onBlur={async (e) => {
                              const v = Number(e.target.value) || 0;
                              try {
                                const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', userId: detailUser.id, updates: { [key]: v } }) });
                                if (res.ok) props.onRefreshAdmin();
                              } catch {}
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          />
                          <span className="text-[10px] text-muted-foreground">0=不限</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* 操作 */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">操作</h4>
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        setResetPasswordUserId(detailUser.id);
                        setResetPasswordValue('');
                        setResetPasswordConfirm('');
                        setShowResetPasswordValue(false);
                        setShowResetPasswordConfirm(false);
                        setResetPasswordError('');
                        setShowResetPasswordDialog(true);
                      }}
                      className="w-full h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"
                    >
                      <Lock className="w-4 h-4" />重置密码
                    </button>
                    <button onClick={() => props.onToggleUser(detailUser)} className={`w-full h-9 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${detailUser.status === 'active' ? 'bg-destructive/15 text-destructive' : 'bg-green-500/15 text-green-500'}`}>
                      {detailUser.status === 'active' ? <><Ban className="w-4 h-4" />停用用户</> : <><Check className="w-4 h-4" />启用用户</>}
                    </button>
                    <button onClick={() => props.onDeleteUser(detailUser)} className="w-full h-9 rounded-lg bg-destructive/15 text-destructive text-sm font-medium hover:bg-destructive/25 transition-colors flex items-center justify-center gap-2"><X className="w-4 h-4" />删除用户</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 重置密码弹窗 */}
        {showResetPasswordDialog && resetPasswordUserId && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => { if (!resetPasswordLoading) setShowResetPasswordDialog(false); }} />
            <div className="relative z-10 w-[400px] bg-card border border-border rounded-xl shadow-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" />重置用户密码
                </h3>
                <button
                  onClick={() => { if (!resetPasswordLoading) setShowResetPasswordDialog(false); }}
                  className="w-7 h-7 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                正在为用户 <span className="font-medium text-foreground">{adminUsers.find(u => u.id === resetPasswordUserId)?.name || resetPasswordUserId}</span> 重置密码
              </p>
              <div className="space-y-3">
                <div>
                  <label htmlFor="reset-new-password" className="text-xs font-medium text-foreground mb-1 block">新密码</label>
                  <div className="relative">
                    <input
                      id="reset-new-password"
                      type={showResetPasswordValue ? 'text' : 'password'}
                      value={resetPasswordValue}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setResetPasswordValue(e.target.value); setResetPasswordError(''); }}
                      placeholder="至少6个字符"
                      disabled={resetPasswordLoading}
                      className="w-full h-10 pl-3 pr-11 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPasswordValue(value => !value)}
                      disabled={resetPasswordLoading}
                      aria-label={showResetPasswordValue ? '隐藏新密码' : '显示新密码'}
                      aria-pressed={showResetPasswordValue}
                      className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {showResetPasswordValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="reset-confirm-password" className="text-xs font-medium text-foreground mb-1 block">确认密码</label>
                  <div className="relative">
                    <input
                      id="reset-confirm-password"
                      type={showResetPasswordConfirm ? 'text' : 'password'}
                      value={resetPasswordConfirm}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setResetPasswordConfirm(e.target.value); setResetPasswordError(''); }}
                      placeholder="再次输入新密码"
                      disabled={resetPasswordLoading}
                      className="w-full h-10 pl-3 pr-11 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPasswordConfirm(value => !value)}
                      disabled={resetPasswordLoading}
                      aria-label={showResetPasswordConfirm ? '隐藏确认密码' : '显示确认密码'}
                      aria-pressed={showResetPasswordConfirm}
                      className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {showResetPasswordConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {resetPasswordError && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{resetPasswordError}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 mt-5">
                <button
                  onClick={() => setShowResetPasswordDialog(false)}
                  disabled={resetPasswordLoading}
                  className="flex-1 h-10 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:text-foreground transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    setResetPasswordError('');
                    if (!resetPasswordValue || resetPasswordValue.length < 6) {
                      setResetPasswordError('密码至少需要6个字符');
                      return;
                    }
                    if (resetPasswordValue !== resetPasswordConfirm) {
                      setResetPasswordError('两次输入的密码不一致');
                      return;
                    }
                    setResetPasswordLoading(true);
                    try {
                      const res = await fetch('/api/admin/users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'resetPassword', userId: resetPasswordUserId, newPassword: resetPasswordValue }),
                      });
                      const data = await res.json();
                      if (data.success) {
                        setShowResetPasswordDialog(false);
                        props.onRefreshAdmin();
                      } else {
                        setResetPasswordError(data.error || '重置密码失败');
                      }
                    } catch {
                      setResetPasswordError('网络错误，请重试');
                    } finally {
                      setResetPasswordLoading(false);
                    }
                  }}
                  disabled={resetPasswordLoading}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {resetPasswordLoading ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />处理中...</>
                  ) : (
                    <><Check className="w-4 h-4" />确认重置</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 新建用户抽屉 */}
        {showUserAddDrawer && (
          <div className="fixed inset-0 z-[200] flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowUserAddDrawer(false)} />
            <div className="ml-auto relative z-10 w-[380px] h-full bg-card border-l border-border overflow-y-auto">
              <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">新建用户</h3>
                <button onClick={() => setShowUserAddDrawer(false)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">用户名</label><input value={newUserName} onChange={e => setNewUserName(e.target.value)} placeholder="输入用户名" className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">密码</label><input type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} placeholder="输入密码" className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">邮箱 (可选)</label><input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="输入邮箱" className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">分组 (可选)</label>
                  <select value={newUserGroupId} onChange={e => setNewUserGroupId(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="">无分组</option>
                    {props.adminGroups.filter(g => g.is_active).map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <button onClick={async () => { if (newUserName && newUserPassword) { await props.onCreateUser(newUserName, newUserPassword, newUserEmail, newUserGroupId || undefined); setShowUserAddDrawer(false); setNewUserName(''); setNewUserPassword(''); setNewUserEmail(''); setNewUserGroupId(''); } }} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">创建用户</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Render: Credits Tab ── */
  if (activeTab === 'credits') {
    // Get users with real credit data from the credits overview API
    const co = creditsOverview;
    const creditTabs = ['pending-orders', 'user-credits', 'consumption', 'statistics', 'packages'];
    const creditTabLabels: Record<string, string> = { 'pending-orders': '充值订单', 'user-credits': '用户积分', consumption: '消耗明细', statistics: '统计分析', packages: '模型计费' };

    // Use credit overview topUsers (real data from DB) filtered by search
    const creditUsers = (() => {
      let users = co?.topUsers ? [...co.topUsers] : [];
      if (creditSearch) { const q = creditSearch.toLowerCase(); users = users.filter(u => u.name.toLowerCase().includes(q)); }
      if (creditSort === 'balance') users.sort((a, b) => b.balance - a.balance);
      else if (creditSort === 'recharge') users.sort((a, b) => b.totalRecharged - a.totalRecharged);
      else if (creditSort === 'consume') users.sort((a, b) => b.consumed - a.consumed);
      else users.sort((a, b) => b.consumed - a.consumed); // default by consumed desc
      return users;
    })();

    return (
      <div className="space-y-4 px-6 pt-6 pb-8">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">积分管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">管理用户积分、消耗明细与套餐配置</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>数据更新于 {new Date().toLocaleDateString()}</span>
          </div>
        </div>
        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Users} label="总用户数" value={co ? formatNumber(co.totalUsers || adminUsers.length) : formatNumber(adminUsers.length)} colorClass="text-blue-500" iconBg="bg-blue-500/15" />
          <StatCard icon={Wallet} label="总充值积分" value={co ? formatNumber(co.totalRecharged) : '-'} colorClass="text-primary" iconBg="bg-primary/15" />
          <StatCard icon={TrendingUp} label="总消耗积分" value={co ? formatNumber(co.totalConsumed) : '-'} colorClass="text-destructive" iconBg="bg-destructive/15" />
          <StatCard icon={BarChart3} label="系统结余" value={co ? formatNumber(co.totalBalance) : '-'} sub="充值 − 消耗" colorClass="text-green-500" iconBg="bg-green-500/15" />
        </div>

        {/* Tab 切换 */}
        <div className="flex items-center gap-6 border-b border-border/20">
          {creditTabs.map(t => (
            <button key={t} onClick={() => setCreditSubTab(t)} className={`text-sm font-medium pb-3 cursor-pointer bg-transparent border-none transition-colors ${creditSubTab === t ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}>{creditTabLabels[t]}</button>
          ))}
        </div>

        {/* Tab 0: 充值订单审核 */}
        {creditSubTab === 'pending-orders' && <AdminRechargeOrders />}

        {/* Tab 1: 用户积分 */}
        {creditSubTab === 'user-credits' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input value={creditSearch} onChange={e => setCreditSearch(e.target.value)} placeholder="搜索用户名或邮箱..." className="bg-background border border-border rounded-md pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 w-64 transition-colors" />
                </div>
                <div className="relative inline-flex items-center">
                  <select value={creditSort} onChange={e => setCreditSort(e.target.value)} className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer appearance-none pr-8">
                    <option value="balance">按余额排序</option>
                    <option value="recharge">按充值排序</option>
                    <option value="consume">按消耗排序</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 pointer-events-none" />
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                共 <span className="text-foreground font-medium font-mono">{creditUsers.length}</span> 用户
              </div>
            </div>
            <div className="bg-card rounded-lg shadow-card overflow-hidden border border-border/50">
              <div className="grid grid-cols-5 px-5 py-3 bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <span>用户名</span><span>当前余额</span><span>累计充值</span><span>累计消耗</span><span className="text-right">操作</span>
              </div>
              <div className="divide-y divide-border/30">
                {creditUsers.slice(0, 20).map((u, i) => (
                  <div key={i} className="grid grid-cols-5 px-5 py-3.5 hover:bg-muted/30 transition-colors items-center">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">{u.name.charAt(0).toUpperCase()}</div>
                      <div>
                        <div className="text-sm font-medium text-foreground">{u.name}</div>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-primary font-mono">{u.balance.toLocaleString()}</span>
                    <span className="text-sm text-foreground font-mono">{u.totalRecharged.toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground font-mono">{u.consumed.toLocaleString()}</span>
                    <div className="flex justify-end">
                      <button onClick={() => { setRechargeUserId(u.userId || u.name); setRechargeAmount(100); setShowRechargeModal(true); }} className="bg-primary/10 text-primary px-3 py-1.5 rounded-md text-xs font-medium hover:bg-primary/20 active:scale-[0.98] transition-all">充值</button>
                    </div>
                  </div>
                ))}
                {creditUsers.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">暂无用户积分数据</div>}
              </div>
              {/* 分页 */}
              {creditUsers.length > 20 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-border/20">
                  <span className="text-xs text-muted-foreground">显示 1-{Math.min(20, creditUsers.length)} / 共 {creditUsers.length} 条</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: 消耗明细 */}
        {creditSubTab === 'consumption' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <select className="bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer">
                  <option value="">全部用户</option>
                  {adminUsers.slice(0, 20).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select className="bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer">
                  <option value="">全部类型</option>
                  <option value="image">生图</option>
                  <option value="video">视频</option>
                  <option value="edit">编辑</option>
                  <option value="3d">3D</option>
                  <option value="vectorize">矢量化</option>
                </select>
              </div>
              <button onClick={() => { /* CSV export placeholder */ }} className="bg-muted text-foreground px-3 py-1.5 rounded-md text-xs font-medium hover:bg-muted/80 active:scale-[0.98] transition-all inline-flex items-center gap-1.5 border-none cursor-pointer">
                <Download className="w-3.5 h-3.5" />导出 CSV
              </button>
            </div>
            <div className="bg-card rounded-lg shadow-card overflow-hidden border border-border/50">
              <div className="grid grid-cols-6 px-5 py-3 bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <span>时间</span><span>用户</span><span>类型</span><span>模型</span><span>消耗积分</span><span>状态</span>
              </div>
              <div className="divide-y divide-border/30">
                {(co?.recentTransactions || []).map((t, i) => (
                  <div key={i} className="grid grid-cols-6 px-5 py-3 hover:bg-muted/30 transition-colors items-center">
                    <span className="text-sm text-muted-foreground font-mono">{t.time}</span>
                    <span className="text-sm font-medium text-foreground">{t.user}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium w-fit ${t.type === 'recharge' ? 'bg-primary/15 text-primary' : t.type === 'image' ? 'bg-primary/15 text-primary' : t.type === 'video' ? 'bg-blue-500/15 text-blue-500' : 'bg-green-500/15 text-green-500'}`}>{t.type === 'recharge' ? '充值' : t.type === 'image' ? '生图' : t.type === 'video' ? '视频' : t.type === 'edit' ? '编辑' : t.desc || t.type}</span>
                    <span className="text-sm text-muted-foreground">{t.desc || '-'}</span>
                    <span className={`text-sm font-bold font-mono ${t.type === 'recharge' ? 'text-green-500' : 'text-foreground'}`}>{t.type === 'recharge' ? '+' : '-'}{Math.abs(t.amount).toLocaleString()}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-green-500/15 text-green-500 w-fit">已完成</span>
                  </div>
                ))}
                {(!co?.recentTransactions || co.recentTransactions.length === 0) && <div className="py-8 text-center text-sm text-muted-foreground">暂无消耗明细</div>}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: 统计分析 */}
        {creditSubTab === 'statistics' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
              <h2 className="text-base font-semibold text-foreground mb-4">积分消耗分布</h2>
              <DonutChart segments={co?.distribution || [
                { label: '图像生成', value: 45, color: '#d4af37', pct: '45%' },
                { label: 'AI 对话', value: 25, color: '#22c55e', pct: '25%' },
                { label: '视频生成', value: 18, color: '#3b82f6', pct: '18%' },
                { label: '其他', value: 12, color: '#a1a1aa', pct: '12%' },
              ]} />
            </div>
            <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
              <h2 className="text-base font-semibold text-foreground mb-4">消耗排行 Top 10</h2>
              <div className="space-y-2.5">
                {(co?.topUsers || []).map((u, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-5 text-xs font-bold text-right ${i < 3 ? 'text-primary' : 'text-muted-foreground'}`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                        <span className="text-xs font-mono text-muted-foreground">{(u.consumed || u.totalConsumed || 0).toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary/60 rounded-full" style={{ width: `${Math.min(100, (u.consumed || u.totalConsumed || 0) / Math.max((co?.topUsers?.[0]?.consumed || co?.topUsers?.[0]?.totalConsumed || 1), 1) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: 套餐管理 */}
        {creditSubTab === 'packages' && (
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">模型积分规则</h2>
                <p className="mt-1 text-xs text-muted-foreground">按已启用模型计费。视频规则为每秒，其余规则为每次调用或每张图片。</p>
              </div>
              <button
                disabled={pricingSaving}
                onClick={async () => {
                  setPricingSaving(true);
                  try {
                    const res = await fetch('/api/admin/credits/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelCredits: modelCreditRules }) });
                    if (!res.ok) throw new Error();
                    await loadModelCreditPricing();
                  } catch { alert('保存模型积分规则失败'); } finally { setPricingSaving(false); }
                }}
                className="bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >{pricingSaving ? '保存中...' : '保存规则'}</button>
            </div>
            <div className="overflow-x-auto border border-border/60 rounded-md">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">供应商</th>
                    <th className="px-3 py-2 text-left font-medium">模型</th>
                    <th className="px-3 py-2 text-left font-medium">计费单位</th>
                    <th className="px-3 py-2 text-right font-medium">默认积分</th>
                    {(() => {
                      const allTiers = new Set<string>();
                      modelCreditCatalog.forEach(item => {
                        if (item.quality) Object.keys(item.quality).forEach(k => allTiers.add(k));
                      });
                      return Array.from(allTiers).sort().map(tier => (
                        <th key={tier} className="px-3 py-2 text-right font-medium">{tier === 'standard' ? '标准' : tier === 'hd' ? '高清' : tier === 'low' ? '低质量' : tier === 'medium' ? '中等' : tier === 'high' ? '高质量' : tier === 'ultra' ? '超高质量' : tier}</th>
                      ));
                    })()}
                    <th className="px-3 py-2 text-right font-medium">1K</th>
                    <th className="px-3 py-2 text-right font-medium">2K</th>
                    <th className="px-3 py-2 text-right font-medium">4K</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {modelCreditCatalog.map(item => {
                    const tiers = item.quality ? Object.keys(item.quality).sort() : [];
                    const currentRule = modelCreditRules[item.model];
                    const baseCredits = typeof currentRule === 'number' ? currentRule : (currentRule?.credits ?? item.credits);
                    const qualityOverrides = (typeof currentRule === 'object' && currentRule?.quality) ? currentRule.quality : {};
                    const resolutionOverrides = (typeof currentRule === 'object' && currentRule?.resolution) ? currentRule.resolution : {};
                    const resTiers = ['1K', '2K', '4K'];
                    return (
                      <tr key={`${item.providerId}:${item.model}`}>
                        <td className="px-3 py-2 text-muted-foreground">{item.providerName}</td>
                        <td className="px-3 py-2 font-mono text-xs text-foreground">{item.model}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{item.unit === 'per-second' ? '每秒' : item.unit === 'per-image' ? '每张' : '每次'}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            aria-label={`${item.model} 默认积分`}
                            type="number" min="0" max="100000"
                            value={baseCredits}
                            onChange={event => {
                              const v = Math.max(0, Math.floor(Number(event.target.value) || 0));
                              setModelCreditRules(prev => {
                                const existing = prev[item.model];
                                if (typeof existing === 'object') {
                                  return { ...prev, [item.model]: { credits: v, ...(existing.quality ? { quality: existing.quality } : {}), ...(existing.resolution ? { resolution: existing.resolution } : {}) } };
                                }
                                return { ...prev, [item.model]: v };
                              });
                            }}
                            className="h-8 w-24 rounded-md border border-border bg-background px-2 text-right text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </td>
                        {tiers.map(tier => {
                          const refVal = item.quality?.[tier] ?? baseCredits;
                          const overrideVal = qualityOverrides[tier];
                          const displayVal = overrideVal !== undefined ? overrideVal : refVal;
                          const isOverridden = overrideVal !== undefined;
                          return (
                            <td key={tier} className="px-3 py-2 text-right">
                              <input
                                aria-label={`${item.model} ${tier} 积分`}
                                type="number" min="0" max="100000"
                                value={displayVal}
                                placeholder={String(refVal)}
                                onChange={event => {
                                  const v = Math.max(0, Math.floor(Number(event.target.value) || 0));
                                  setModelCreditRules(prev => {
                                    const existing = prev[item.model];
                                    const base = typeof existing === 'number' ? existing : (existing?.credits ?? item.credits);
                                    const prevQuality = (typeof existing === 'object' && existing?.quality) ? existing.quality : {};
                                    const prevResolution = (typeof existing === 'object' && existing?.resolution) ? existing.resolution : {};
                                    const newQuality = { ...prevQuality, [tier]: v };
                                    return { ...prev, [item.model]: { credits: base, quality: newQuality, ...(Object.keys(prevResolution).length > 0 ? { resolution: prevResolution } : {}) } };
                                  });
                                }}
                                className={`h-8 w-24 rounded-md border bg-background px-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${isOverridden ? 'border-primary/50 text-primary' : 'border-border text-muted-foreground'}`}
                              />
                            </td>
                          );
                        })}
                        {item.modelType === 'image' ? resTiers.map(rt => {
                          const refVal = item.resolution?.[rt] ?? baseCredits;
                          const overrideVal = resolutionOverrides[rt];
                          const displayVal = overrideVal !== undefined ? overrideVal : refVal;
                          const isOverridden = overrideVal !== undefined;
                          return (
                            <td key={rt} className="px-3 py-2 text-right">
                              <input
                                aria-label={`${item.model} ${rt} 积分`}
                                type="number" min="0" max="100000"
                                value={displayVal}
                                placeholder={String(refVal)}
                                onChange={event => {
                                  const v = Math.max(0, Math.floor(Number(event.target.value) || 0));
                                  setModelCreditRules(prev => {
                                    const existing = prev[item.model];
                                    const base = typeof existing === 'number' ? existing : (existing?.credits ?? item.credits);
                                    const prevQuality = (typeof existing === 'object' && existing?.quality) ? existing.quality : {};
                                    const prevResolution = (typeof existing === 'object' && existing?.resolution) ? existing.resolution : {};
                                    const newResolution = { ...prevResolution, [rt]: v };
                                    return { ...prev, [item.model]: { credits: base, ...(Object.keys(prevQuality).length > 0 ? { quality: prevQuality } : {}), resolution: newResolution } };
                                  });
                                }}
                                className={`h-8 w-24 rounded-md border bg-background px-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${isOverridden ? 'border-primary/50 text-primary' : 'border-border text-muted-foreground'}`}
                              />
                            </td>
                          );
                        }) : resTiers.map(rt => <td key={rt} className="px-3 py-2 text-right text-xs text-muted-foreground">-</td>)}
                      </tr>
                    );
                  })}
                  {modelCreditCatalog.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">暂无已启用模型，请先在 API 管理中配置模型。</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* 充值弹窗 */}
        {showRechargeModal && rechargeUserId && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowRechargeModal(false)} />
            <div className="relative bg-card rounded-xl shadow-lg border border-border/50 p-6 w-[360px]">
              <h3 className="text-base font-semibold text-foreground mb-4">积分充值</h3>
              <div className="space-y-4">
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">充值用户</label><div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-lg">{adminUsers.find(u => u.id === rechargeUserId)?.name || rechargeUserId}</div></div>
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">充值数量</label><input type="number" value={rechargeAmount} onChange={e => setRechargeAmount(Number(e.target.value))} min={1} className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div className="flex gap-2">
                  {[50, 100, 200, 500, 1000].map(v => <button key={v} onClick={() => setRechargeAmount(v)} className={`flex-1 h-8 rounded-md text-xs font-medium transition-colors ${rechargeAmount === v ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{v}</button>)}
                </div>
                <button onClick={async () => { try { const res = await fetch('/api/admin/credits/recharge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: rechargeUserId, amount: rechargeAmount }) }); if (res.ok) { setShowRechargeModal(false); loadCreditsOverview(); onRefreshAdmin(); } else { const d = await res.json(); alert(d.error || '充值失败'); } } catch { alert('充值请求失败'); } }} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">确认充值</button>
              </div>
              <button onClick={() => setShowRechargeModal(false)} className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Render: Audit Tab ── */
  if (activeTab === 'audit') {
    const as = auditStats;
    const actionLabels: Record<string, string> = {
      user_create: '用户创建', user_delete: '用户删除', user_update: '用户更新',
      api_create: 'API 配置', api_delete: 'API 删除', system_update: '系统设置',
      image_generate: '图像生成', image_edit: '图片编辑', image_upscale: '图片放大',
      image_remove_bg: '移除背景', image_erase: '擦除', image_mask: '蒙版修图',
      image_outpaint: '扩展画面', lang_edit: '语言修图', video_generate: '视频生成',
      video_extend: '视频延长', chat: 'AI 聊天', workflow_execute: '工作流执行',
      image_to_3d: '图片转3D', svg_trace: 'SVG描摹', agent_edit: 'Agent编排',
      segment_elements: '元素分层', font_design: '字境大师', vectorize: '矢量化',
      optimize_prompt: '提示词优化', vision_prompt: '图片识词', refine_engine: '人物精修',
      file_upload: '文件上传', credit_operation: '积分操作', post_api_request: '接口请求',
    };
    const actionColors: Record<string, string> = {
      user_create: 'bg-green-500/15 text-green-500', user_delete: 'bg-destructive/15 text-destructive',
      user_update: 'bg-blue-500/15 text-blue-500', api_create: 'bg-primary/15 text-primary',
      api_delete: 'bg-destructive/15 text-destructive', system_update: 'bg-yellow-500/15 text-yellow-500',
      image_generate: 'bg-primary/15 text-primary', image_edit: 'bg-blue-500/15 text-blue-500',
      image_upscale: 'bg-cyan-500/15 text-cyan-500', image_remove_bg: 'bg-teal-500/15 text-teal-500',
      lang_edit: 'bg-violet-500/15 text-violet-500', video_generate: 'bg-orange-500/15 text-orange-500',
      chat: 'bg-indigo-500/15 text-indigo-500', workflow_execute: 'bg-pink-500/15 text-pink-500',
      file_upload: 'bg-slate-500/15 text-slate-500', credit_operation: 'bg-amber-500/15 text-amber-600',
    };
    const levelIcons: Record<string, { icon: typeof AlertTriangle; color: string; label: string }> = {
      error: { icon: AlertTriangle, color: 'text-destructive', label: '错误' },
      warn: { icon: AlertTriangle, color: 'text-yellow-500', label: '警告' },
      info: { icon: CheckCircle2, color: 'text-blue-500', label: '信息' },
    };
    const resolutionLabels: Record<string, { label: string; color: string }> = {
      unresolved: { label: '未处理', color: 'bg-destructive/15 text-destructive' },
      investigating: { label: '调查中', color: 'bg-yellow-500/15 text-yellow-500' },
      resolved: { label: '已解决', color: 'bg-green-500/15 text-green-500' },
      ignored: { label: '已忽略', color: 'bg-muted text-muted-foreground' },
    };

    const handleAiAnalyze = async (logId: string) => {
      setAuditAiLoading(logId);
      try {
        const res = await fetch('/api/admin/op-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ai-analyze', logId }),
        });
        if (res.ok) {
          const data = await res.json();
          setAuditAiAnalysis(prev => ({ ...prev, [logId]: data.analysis || '分析失败' }));
        }
      } catch { setAuditAiAnalysis(prev => ({ ...prev, [logId]: '分析请求失败' })); }
      finally { setAuditAiLoading(null); }
    };

    const handleAiFix = async (logId: string) => {
      setAuditAiLoading('fix-' + logId);
      try {
        const res = await fetch('/api/admin/op-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ai-fix', logId }),
        });
        if (res.ok) {
          const data = await res.json();
          setAuditAiAnalysis(prev => ({ ...prev, [logId]: (prev[logId] || '') + '\n\n🔧 修复结果:\n' + (data.result || '修复完成') }));
          loadAuditLogs(auditPage, auditFilterAction, auditFilterLevel, auditFilterUserId);
        }
      } catch { setAuditAiAnalysis(prev => ({ ...prev, [logId]: (prev[logId] || '') + '\n\n修复请求失败' })); }
      finally { setAuditAiLoading(null); }
    };

    const handleResolution = async (logId: string, status: string) => {
      try {
        await fetch('/api/admin/op-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resolve', logId, resolutionStatus: status, resolutionDetail: `管理员标记为${resolutionLabels[status]?.label || status}` }),
        });
        loadAuditLogs(auditPage, auditFilterAction, auditFilterLevel, auditFilterUserId);
      } catch {}
    };

    return (
      <div className="space-y-4 px-6 pt-6 pb-8">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">操作日志</h1>
            <p className="text-sm text-muted-foreground mt-0.5">追踪用户操作、错误记录与系统事件</p>
          </div>
          <button onClick={() => loadAuditLogs(auditPage, auditFilterAction, auditFilterLevel, auditFilterUserId)} className="h-9 px-4 rounded-lg bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 transition-colors flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${auditLoading ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </div>

        {/* 摘要卡片 */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={ShieldCheck} label="今日操作" value={as ? formatNumber(as.todayCount) : '-'} colorClass="text-primary" iconBg="bg-primary/15" />
          <StatCard icon={Activity} label="本周操作" value={as ? formatNumber(as.weekCount) : '-'} colorClass="text-blue-500" iconBg="bg-blue-500/15" />
          <StatCard icon={Database} label="总记录" value={as ? formatNumber(as.totalCount) : '-'} colorClass="text-green-500" iconBg="bg-green-500/15" />
          <StatCard icon={AlertTriangle} label="今日错误" value={as ? formatNumber(as.errorCount || 0) : '-'} colorClass="text-destructive" iconBg="bg-destructive/15" />
          <StatCard icon={AlertTriangle} label="今日警告" value={as ? formatNumber(as.warnCount || 0) : '-'} colorClass="text-yellow-500" iconBg="bg-yellow-500/15" />
          <StatCard icon={Wrench} label="未处理" value={as ? formatNumber(as.unresolvedCount || 0) : '-'} colorClass="text-orange-500" iconBg="bg-orange-500/15" />
        </div>

        {/* 筛选栏 */}
        <div className="flex items-center gap-3 flex-wrap">
          <select value={auditFilterAction} onChange={e => { setAuditFilterAction(e.target.value); setAuditPage(1); loadAuditLogs(1, e.target.value, auditFilterLevel, auditFilterUserId); }} className="h-9 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="all">全部操作</option>
            <optgroup label="管理员操作">
              <option value="user_create">用户创建</option>
              <option value="user_delete">用户删除</option>
              <option value="user_update">用户更新</option>
              <option value="api_create">API 配置</option>
              <option value="api_delete">API 删除</option>
              <option value="system_update">系统设置</option>
            </optgroup>
            <optgroup label="用户操作">
              <option value="image_generate">图像生成</option>
              <option value="image_edit">图片编辑</option>
              <option value="image_upscale">图片放大</option>
              <option value="image_remove_bg">移除背景</option>
              <option value="lang_edit">语言修图</option>
              <option value="video_generate">视频生成</option>
              <option value="chat">AI 聊天</option>
              <option value="workflow_execute">工作流执行</option>
            </optgroup>
          </select>
          <select value={auditFilterLevel} onChange={e => { setAuditFilterLevel(e.target.value); setAuditPage(1); loadAuditLogs(1, auditFilterAction, e.target.value, auditFilterUserId); }} className="h-9 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="all">全部级别</option>
            <option value="error">错误</option>
            <option value="warn">警告</option>
            <option value="info">信息</option>
          </select>
          <input
            type="text" placeholder="用户ID筛选" value={auditFilterUserId}
            onChange={e => setAuditFilterUserId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setAuditPage(1); loadAuditLogs(1, auditFilterAction, auditFilterLevel, auditFilterUserId); } }}
            className="h-9 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 w-36"
          />
          <div className="flex-1" />
          <button onClick={() => { setAuditFilterAction('all'); setAuditFilterLevel('all'); setAuditFilterUserId(''); setAuditPage(1); loadAuditLogs(1, 'all', 'all', ''); }} className="h-9 px-3 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors text-sm">重置筛选</button>
        </div>

        {/* 日志表格 */}
        <div className="bg-card rounded-lg shadow-card border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground bg-muted/30">
                  <th className="text-left py-3 px-3 font-medium w-32">时间</th>
                  <th className="text-left py-3 px-3 font-medium w-16">级别</th>
                  <th className="text-left py-3 px-3 font-medium w-20">操作者</th>
                  <th className="text-left py-3 px-3 font-medium w-24">操作类型</th>
                  <th className="text-left py-3 px-3 font-medium">详情</th>
                  <th className="text-left py-3 px-3 font-medium w-20">状态</th>
                  <th className="text-left py-3 px-3 font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log, i) => {
                  const action = String(log.action || '');
                  const level = String(log.level || 'info');
                  const logId = String(log.id || i);
                  const isExpanded = auditExpandedId === logId;
                  const isDanger = level === 'error';
                  const li = levelIcons[level] || levelIcons.info;
                  const LevelIcon = li.icon;
                  const resStatus = String(log.resolutionStatus || 'unresolved');
                  const resInfo = resolutionLabels[resStatus] || resolutionLabels.unresolved;
                  return (
                    <React.Fragment key={logId}>
                      <tr className={`border-b border-border/30 hover:bg-muted/30 transition-colors ${isDanger ? 'bg-destructive/5' : ''}`}>
                        <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs">{formatDateTime(String(log.createdAt || log.created_at || ''))}</td>
                        <td className="py-2.5 px-3"><span className={`inline-flex items-center gap-1 text-xs font-medium ${li.color}`}><LevelIcon className="w-3 h-3" />{li.label}</span></td>
                        <td className="py-2.5 px-3 text-foreground font-medium text-xs truncate max-w-20" title={String(log.user_name || log.user_id || '-')}>{String(log.user_name || log.user_id || '-')}</td>
                        <td className="py-2.5 px-3"><span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${actionColors[action] || 'bg-muted text-muted-foreground'}`}>{actionLabels[action] || action}</span></td>
                        <td className="py-2.5 px-3 text-muted-foreground text-xs truncate max-w-64" title={String(log.errorMessage || log.detail || '')}>{String(log.errorMessage || log.detail || '-')}</td>
                        <td className="py-2.5 px-3"><span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${resInfo.color}`}>{resInfo.label}</span></td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => setAuditExpandedId(isExpanded ? null : logId)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="展开详情"><ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></button>
                            {isDanger && <button onClick={() => handleAiAnalyze(logId)} disabled={auditAiLoading === logId} className="p-1 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary" title="AI分析"><Brain className="w-3.5 h-3.5" /></button>}
                            {isDanger && resStatus !== 'resolved' && <button onClick={() => handleAiFix(logId)} disabled={auditAiLoading === 'fix-' + logId} className="p-1 rounded hover:bg-green-500/15 text-muted-foreground hover:text-green-500" title="AI修复"><Wrench className="w-3.5 h-3.5" /></button>}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/20">
                          <td colSpan={7} className="py-3 px-4">
                            <div className="space-y-2">
                              {/* 基础信息 */}
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div><span className="text-muted-foreground">用户ID:</span> <span className="text-foreground font-mono">{String(log.user_id || '-')}</span></div>
                                <div><span className="text-muted-foreground">目标:</span> <span className="text-foreground">{String(log.target_type || '')}{log.target_id ? ` #${log.target_id}` : ''}</span></div>
                                {log.errorMessage && <div className="col-span-2"><span className="text-muted-foreground">错误信息:</span> <span className="text-destructive font-mono">{String(log.errorMessage)}</span></div>}
                                {log.model && <div><span className="text-muted-foreground">模型:</span> <span className="text-foreground">{String(log.model)}</span></div>}
                                {log.providerId && <div><span className="text-muted-foreground">提供商:</span> <span className="text-foreground">{String(log.providerId)}</span></div>}
                                {log.duration && <div><span className="text-muted-foreground">耗时:</span> <span className="text-foreground">{Number(log.duration).toFixed(0)}ms</span></div>}
                              </div>
                              {/* 堆栈 */}
                              {Boolean(log.stackTrace) && (
                                <details className="text-xs">
                                  <summary className="text-muted-foreground cursor-pointer hover:text-foreground">堆栈跟踪</summary>
                                  <pre className="text-destructive/80 whitespace-pre-wrap font-mono max-h-32 overflow-auto mt-1 p-2 bg-background rounded">{String(log.stackTrace)}</pre>
                                </details>
                              )}
                              {/* 请求数据 */}
                              {Boolean(log.requestData) && (
                                <details className="text-xs">
                                  <summary className="text-muted-foreground cursor-pointer hover:text-foreground">请求数据</summary>
                                  <pre className="text-muted-foreground whitespace-pre-wrap font-mono max-h-32 overflow-auto mt-1 p-2 bg-background rounded">{typeof log.requestData === 'string' ? log.requestData : JSON.stringify(log.requestData, null, 2)}</pre>
                                </details>
                              )}
                              {/* 详情 */}
                              {log.detail != null && (
                                <details open className="text-xs">
                                  <summary className="text-muted-foreground cursor-pointer hover:text-foreground">详情</summary>
                                  <pre className="text-muted-foreground whitespace-pre-wrap font-mono max-h-32 overflow-auto mt-1 p-2 bg-background rounded">{typeof log.detail === 'string' ? log.detail : JSON.stringify(log.detail, null, 2)}</pre>
                                </details>
                              )}
                              {/* AI分析结果 */}
                              {auditAiAnalysis[logId] && (
                                <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                                  <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-1"><Brain className="w-3.5 h-3.5" /> AI 分析</div>
                                  <pre className="text-xs text-foreground whitespace-pre-wrap font-mono max-h-48 overflow-auto">{auditAiAnalysis[logId]}</pre>
                                </div>
                              )}
                              {/* AI加载中 */}
                              {auditAiLoading && (auditAiLoading === logId || auditAiLoading === 'fix-' + logId) && (
                                <div className="flex items-center gap-2 text-xs text-primary"><RefreshCw className="w-3 h-3 animate-spin" /> {auditAiLoading.startsWith('fix-') ? 'AI修复中...' : 'AI分析中...'}</div>
                              )}
                              {/* 解决状态操作 */}
                              {isDanger && (
                                <div className="flex items-center gap-2 pt-1">
                                  <span className="text-xs text-muted-foreground">处理状态:</span>
                                  {Object.entries(resolutionLabels).map(([key, info]) => (
                                    <button key={key} onClick={() => handleResolution(logId, key)} className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${resStatus === key ? info.color : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{info.label}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {auditLogs.length === 0 && <div className="text-center py-12 text-muted-foreground">暂无操作日志</div>}
        </div>

        {/* 分页 */}
        {auditTotal > 20 && (
          <div className="flex items-center justify-center gap-2">
            <button disabled={auditPage <= 1} onClick={() => { const p = auditPage - 1; setAuditPage(p); loadAuditLogs(p, auditFilterAction, auditFilterLevel, auditFilterUserId); }} className="h-8 px-3 rounded-lg bg-muted text-sm text-muted-foreground disabled:opacity-50 hover:text-foreground"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm text-muted-foreground">第 {auditPage} 页 (共 {Math.ceil(auditTotal / 20)} 页, {auditTotal} 条)</span>
            <button disabled={auditPage * 20 >= auditTotal} onClick={() => { const p = auditPage + 1; setAuditPage(p); loadAuditLogs(p, auditFilterAction, auditFilterLevel, auditFilterUserId); }} className="h-8 px-3 rounded-lg bg-muted text-sm text-muted-foreground disabled:opacity-50 hover:text-foreground"><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'settings') {
    const imageModelOpts = (providers || []).filter(p => (p.model_type || p.modelType) === 'image').flatMap(p => (p.selected_models || p.selectedModels || []).map(m => ({ value: `${p.id}::${m}`, label: m })));
    const chatModelOpts = (providers || []).filter(p => (p.model_type || p.modelType) === 'chat').flatMap(p => (p.selected_models || p.selectedModels || []).map(m => ({ value: `${p.id}::${m}`, label: m })));
    const videoModelOpts = (providers || []).filter(p => (p.model_type || p.modelType) === 'video').flatMap(p => (p.selected_models || p.selectedModels || []).filter(m => /kling|seedance|vidu|runway|sora|veo|pika|luma|minimax/i.test(m)).map(m => ({ value: `${p.id}::${m}`, label: m })));

    const s = (key: string) => systemSettings[key] ?? '';

    const toggleBtn = (key: string) => {
      const on = s(key) === 'true';
      return (
        <button onClick={() => { setSystemSettings(prev => ({ ...prev, [key]: on ? 'false' : 'true' })); setSettingsDirty(true); }}
          className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-[2px]'}`} />
        </button>
      );
    };

    const numInput = (key: string, w = 'w-32', unit?: string) => (
      <div className="flex items-center gap-2">
        <input type="number" value={s(key)} onChange={e => { setSystemSettings(prev => ({ ... prev, [key]: e.target.value })); setSettingsDirty(true); }}
          className={`${w} bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors`} />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    );

    return (
      <div className="space-y-0 pb-4 flex flex-col h-full">
        {/* 页面标题 */}
        <div className="px-6 pt-6 pb-2">
          <h1 className="text-2xl font-bold text-foreground">系统设置</h1>
          <p className="text-sm text-muted-foreground mt-1">管理平台全局配置，修改后请点击底部保存按钮生效</p>
        </div>

        {/* 可滚动内容区域 */}
        <div className="flex-1 overflow-y-auto px-2">

        {/* 基础设置 */}
        <div className="px-8 mt-6">
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <SlidersHorizontal className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">基础设置</h2>
            </div>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">允许用户注册</div>
                  <div className="text-xs text-muted-foreground mt-0.5">关闭后新用户将无法自行注册账号</div>
                </div>
                {toggleBtn('openRegistration')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">新用户默认积分</div>
                  <div className="text-xs text-muted-foreground mt-0.5">新注册用户获得的初始积分数量</div>
                </div>
                {numInput('initialCredits', 'w-32')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">新用户默认角色</div>
                  <div className="text-xs text-muted-foreground mt-0.5">新注册用户自动分配的角色</div>
                </div>
                <select value={s('defaultUserRole')} onChange={e => { setSystemSettings(prev => ({ ...prev, defaultUserRole: e.target.value })); setSettingsDirty(true); }}
                  className="w-32 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors appearance-none cursor-pointer">
                  <option value="user">user</option>
                  <option value="vip">vip</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">平台名称</div>
                  <div className="text-xs text-muted-foreground mt-0.5">显示在浏览器标题栏和登录页面</div>
                </div>
                <input type="text" value={s('platformName')} onChange={e => { setSystemSettings(prev => ({ ...prev, platformName: e.target.value })); setSettingsDirty(true); }}
                  className="w-48 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
              </div>
            </div>
          </div>
        </div>

        {/* 安全设置 */}
        <div className="px-8 mt-6">
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <Shield className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">安全设置</h2>
            </div>
            <div className="space-y-5">
              <div>
                <div className="text-sm font-medium text-foreground">管理端IP白名单</div>
                <div className="text-xs text-muted-foreground mt-0.5 mb-2">每行一个IP地址，留空则不限制</div>
                <textarea value={s('ipWhitelist')} onChange={e => { setSystemSettings(prev => ({ ...prev, ipWhitelist: e.target.value })); setSettingsDirty(true); }}
                  rows={4} className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors resize-none" placeholder="192.168.1.0/24&#10;10.0.0.1" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">会话超时时间</div>
                  <div className="text-xs text-muted-foreground mt-0.5">用户无操作后自动登出的时间</div>
                </div>
                {numInput('sessionTimeout', 'w-24', '分钟')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">强制密码修改周期</div>
                  <div className="text-xs text-muted-foreground mt-0.5">设为 0 则不强制修改密码</div>
                </div>
                {numInput('passwordExpiryDays', 'w-24', '天')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">用户可执行任务数量</div>
                  <div className="text-xs text-muted-foreground mt-0.5">单个用户同时执行的异步任务上限</div>
                </div>
                {numInput('maxConcurrentTasks', 'w-24', '个')}
              </div>
            </div>
          </div>
        </div>

        {/* 存储设置 */}
        <div className="px-8 mt-6">
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <HardDrive className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">存储设置</h2>
            </div>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">单用户存储配额</div>
                  <div className="text-xs text-muted-foreground mt-0.5">每个用户可使用的最大存储空间</div>
                </div>
                {numInput('storageQuotaMB', 'w-24', 'MB')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">图片最大分辨率</div>
                  <div className="text-xs text-muted-foreground mt-0.5">上传图片允许的最大边长度（像素）</div>
                </div>
                {numInput('imageMaxEdge', 'w-24', 'px')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">图片最大大小</div>
                  <div className="text-xs text-muted-foreground mt-0.5">单张图片文件的最大体积</div>
                </div>
                {numInput('imageMaxSizeMB', 'w-24', 'MB')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">单文件上传限制</div>
                  <div className="text-xs text-muted-foreground mt-0.5">单个文件的最大上传大小</div>
                </div>
                {numInput('maxUploadMB', 'w-24', 'MB')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">视频最大时长</div>
                  <div className="text-xs text-muted-foreground mt-0.5">用户可生成的视频最大时长</div>
                </div>
                {numInput('maxVideoDuration', 'w-24', '秒')}
              </div>
            </div>
          </div>
        </div>

        {/* 默认模型配置 */}
        <div className="px-8 mt-6">
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <Brain className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">默认模型配置</h2>
            </div>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">默认图像模型</div>
                  <div className="text-xs text-muted-foreground mt-0.5">用户生成图像时的默认模型</div>
                </div>
                <select value={s('defaultImageModel')} onChange={e => { setSystemSettings(prev => ({ ...prev, defaultImageModel: e.target.value })); setSettingsDirty(true); }}
                  className="w-56 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors appearance-none cursor-pointer">
                  <option value="">未选择</option>
                  {imageModelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">默认 LLM 模型</div>
                  <div className="text-xs text-muted-foreground mt-0.5">对话和文本生成的默认语言模型</div>
                </div>
                <select value={s('defaultChatModel')} onChange={e => { setSystemSettings(prev => ({ ...prev, defaultChatModel: e.target.value })); setSettingsDirty(true); }}
                  className="w-56 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors appearance-none cursor-pointer">
                  <option value="">未选择</option>
                  {chatModelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">默认视频模型</div>
                  <div className="text-xs text-muted-foreground mt-0.5">视频生成任务的默认模型</div>
                </div>
                <select value={s('defaultVideoModel') || ''} onChange={e => { setSystemSettings(prev => ({ ...prev, defaultVideoModel: e.target.value })); setSettingsDirty(true); }}
                  className="w-56 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors appearance-none cursor-pointer">
                  <option value="">未选择</option>
                  {videoModelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">视频生成功能</div>
                  <div className="text-xs text-muted-foreground mt-0.5">启用后用户可以使用文生视频和图生视频功能</div>
                </div>
                {toggleBtn('videoGenerationEnabled')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">3D 模型预览</div>
                  <div className="text-xs text-muted-foreground mt-0.5">启用后用户可以生成和预览3D模型</div>
                </div>
                {toggleBtn('3dModelEnabled')}
              </div>
            </div>
          </div>
        </div>

        {/* 公告管理 */}
        <div className="px-8 mt-6">
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <Megaphone className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">公告管理</h2>
            </div>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">启用公告</div>
                  <div className="text-xs text-muted-foreground mt-0.5">开启后公告将对所有用户展示</div>
                </div>
                {toggleBtn('announcementEnabled')}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">公告类型</div>
                  <div className="text-xs text-muted-foreground mt-0.5">选择公告的展示形式</div>
                </div>
                <select value={s('announcementType')} onChange={e => { setSystemSettings(prev => ({ ...prev, announcementType: e.target.value })); setSettingsDirty(true); }}
                  className="w-44 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors appearance-none cursor-pointer">
                  <option value="banner">顶部横幅</option>
                  <option value="popup">弹窗模式</option>
                  <option value="sidebar">侧边通知</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">公告到期时间</div>
                  <div className="text-xs text-muted-foreground mt-0.5">到期后公告自动隐藏</div>
                </div>
                <input type="datetime-local" value={s('announcementExpiry')} onChange={e => { setSystemSettings(prev => ({ ...prev, announcementExpiry: e.target.value })); setSettingsDirty(true); }}
                  className="w-52 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground mb-2">公告内容</div>
                {/* 富文本编辑工具栏 */}
                <div className="flex items-center gap-1 bg-muted px-2 py-1.5 border-b border-border/30">
                  <button onClick={() => document.execCommand('bold')} className="p-1 rounded hover:bg-muted/80 transition-colors" aria-label="加粗">
                    <Bold className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => document.execCommand('italic')} className="p-1 rounded hover:bg-muted/80 transition-colors" aria-label="斜体">
                    <Italic className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => document.execCommand('underline')} className="p-1 rounded hover:bg-muted/80 transition-colors" aria-label="下划线">
                    <Underline className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <div className="w-px h-4 bg-border/30 mx-1" />
                  <button onClick={() => { const url = prompt('输入链接地址:'); if (url) document.execCommand('createLink', false, url); }} className="p-1 rounded hover:bg-muted/80 transition-colors" aria-label="插入链接">
                    <Link2 className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => document.execCommand('insertUnorderedList')} className="p-1 rounded hover:bg-muted/80 transition-colors" aria-label="列表">
                    <List className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
                <textarea value={s('announcement')} onChange={e => { setSystemSettings(prev => ({ ...prev, announcement: e.target.value })); setSettingsDirty(true); }}
                  placeholder="输入公告内容…" rows={5}
                  className="w-full bg-background border border-border rounded-b-md px-3 py-3 text-sm text-foreground min-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors resize-none" />
              </div>
            </div>
          </div>
        </div>

        </div>

        {/* 底部保存栏（sticky在内容区底部，不遮挡整个页面） */}
        <div className="sticky bottom-0 bg-card border-t border-border/50 px-6 py-3 z-10 flex items-center justify-between mt-2">
          <div className={`flex items-center gap-2 transition-opacity ${settingsDirty ? 'opacity-100' : 'opacity-0'}`}>
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-amber-400 font-medium">有未保存的更改</span>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <button onClick={() => loadSystemSettings()} className="bg-muted text-foreground border border-border/50 px-5 py-2 rounded-md text-sm font-medium hover:bg-muted/80 active:scale-[0.98] transition-all cursor-pointer">重置</button>
            <button onClick={() => handleSaveSettings()} className={`bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all inline-flex items-center gap-2 cursor-pointer ${settingsDirty ? 'shadow-glow' : ''}`}>
              <Save className="w-4 h-4" />保存设置
            </button>
          </div>
        </div>

        {/* 保存成功提示 */}
        <div className={`fixed top-6 right-6 bg-success/15 text-success border border-success/20 rounded-lg px-4 py-3 text-sm font-medium flex items-center gap-2 z-[60] transition-all pointer-events-none ${settingsSaved ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2.5'}`}>
          <Check className="w-4 h-4" />
          <span>设置已保存成功</span>
        </div>
      </div>
    );
  }

  return null;
}
