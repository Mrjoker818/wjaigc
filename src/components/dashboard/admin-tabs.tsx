'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, RefreshCw, Activity, UserPlus, X, Pencil, KeyRound,
  Coins, Lock, Receipt, ShieldCheck, CheckCircle, XCircle,
  Plus, MoreHorizontal, ChevronRight, ChevronLeft, Eye, EyeOff,
  Users, CreditCard, FileText, Settings, BarChart3, AlertTriangle,
  TrendingUp, TrendingDown, Server, Database, ShoppingBag, Bell,
  Save, RotateCcw, ChevronDown, Trash2, Power, PowerOff,
  ArrowRight, Filter, Download, Copy, ExternalLink, Zap,
  Shield, HardDrive, Cpu, MessageSquare, ChevronUp, UserCheck, UserX,
  Globe, Clock, Info
} from 'lucide-react';

/* ─── Types ─── */
interface AdminUser {
  id: string;
  name: string;
  email?: string;
  role: string;
  status: string;
  apiPermissions?: Record<string, boolean>;
  createdAt?: number;
  lastLoginAt?: number;
  creditsBalance?: number;
  projectCount?: number;
}

type UserPermissionKey = 'image' | 'chat' | 'video' | '3d' | 'vectorize' | 'edit';

const userPermissionLabels: Record<UserPermissionKey, string> = {
  image: '图像生成', chat: 'AI对话', video: '视频生成', '3d': '3D模型', vectorize: '矢量化', edit: '修图'
};

interface CreditsInfo {
  balance: number;
  totalRecharged: number;
  totalUsed: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description?: string;
  createdAt?: number;
}

interface AdminProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelType: string;
  isEnabled: boolean;
  balance?: number;
  selectedModels?: string[];
  discoveredModels?: string[];
  advancedParams?: Record<string, string>;
}

interface DashboardStats {
  totalUsers: number;
  todayActive: number;
  weekActive: number;
  monthActive: number;
  totalCredits: number;
  todayCreditsUsed: number;
  totalProviders: number;
  activeProviders: number;
  recentUsers: Array<{ id: string; name: string; createdAt: number }>;
  userTrend?: number[];
  creditsTrend?: number[];
  apiCallRank?: Array<{ name: string; calls: number }>;
  alerts?: Array<{ level: string; message: string; time: number }>;
}

interface AuditLogEntry {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: string;
  ip_address: string;
  created_at: number;
}

interface AuditStats {
  todayCount: number;
  weekCount: number;
  totalCount: number;
}

/* ─── Action color / label maps ─── */
const actionColorMap: Record<string, string> = {
  user_create: 'bg-green-500/15 text-green-400', user_delete: 'bg-red-500/15 text-red-400',
  user_update: 'bg-blue-500/15 text-blue-400', user_disable: 'bg-orange-500/15 text-orange-400',
  user_enable: 'bg-emerald-500/15 text-emerald-400', api_create: 'bg-primary/15 text-primary',
  api_delete: 'bg-red-500/15 text-red-400', api_update: 'bg-blue-500/15 text-blue-400',
  credits_recharge: 'bg-green-500/15 text-green-400', settings_update: 'bg-purple-500/15 text-purple-400',
};
const actionLabelMap: Record<string, string> = {
  user_create: '创建用户', user_delete: '删除用户', user_update: '更新用户',
  user_disable: '禁用用户', user_enable: '启用用户', api_create: '添加API',
  api_delete: '删除API', api_update: '更新API', credits_recharge: '积分充值',
  settings_update: '系统设置',
};

/* ─── Helpers ─── */
function fmtDate(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDateFull(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN');
}
function getInitial(name: string) {
  return (name || '?').charAt(0).toUpperCase();
}
function getAvatarColor(id: string) {
  const colors = ['bg-primary/20 text-primary', 'bg-blue-500/20 text-blue-400', 'bg-green-500/20 text-green-400', 'bg-purple-500/20 text-purple-400', 'bg-orange-500/20 text-orange-400', 'bg-cyan-500/20 text-cyan-400'];
  let hash = 0; for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/* ═══════════════════════════════════════════════
   SVG Trend Chart (mini sparkline)
   ═══════════════════════════════════════════════ */
function TrendChart({ data, color = '#d4af37', height = 80 }: { data: number[]; color?: string; height?: number }) {
  if (!data || data.length < 2) return <div className="h-[80px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 300;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - min) / range) * (height - 10) - 5}`).join(' ');
  const areaPts = `0,${height} ${pts} ${w},${height}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((v, i) => (
        <circle key={i} cx={(i / (data.length - 1)) * w} cy={height - ((v - min) / range) * (height - 10) - 5} r="3" fill={color} opacity={i === data.length - 1 ? 1 : 0} />
      ))}
    </svg>
  );
}

/* ═══════════════════════════════════════════════
   CSS Donut Chart
   ═══════════════════════════════════════════════ */
function DonutChart({ segments, size = 120 }: { segments: { value: number; color: string; label: string }[]; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = 40;
  const c = 2 * Math.PI * r;
  // Pre-compute cumulative offsets to avoid reassigning inside render
  const cumOffsets = segments.reduce<number[]>((acc, seg, i) => {
    const prev = i === 0 ? 0 : acc[i - 1];
    const pct = (seg.value / total) * c;
    acc.push(prev + pct);
    return acc;
  }, []);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        {segments.map((seg, i) => {
          const pct = (seg.value / total) * c;
          const dashArray = `${pct} ${c - pct}`;
          const dashOffset = -(i === 0 ? 0 : cumOffsets[i - 1]);
          return <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={seg.color} strokeWidth="12" strokeDasharray={dashArray} strokeDashoffset={dashOffset} strokeLinecap="round" />;
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-bold text-foreground">{total}</p>
          <p className="text-[10px] text-muted-foreground">总计</p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════ */
interface AdminTabsProps {
  activeTab: string;
  adminUsers: AdminUser[];
  onRefreshAdmin: () => void;
  onCreateUser: (name: string, password: string, email?: string) => Promise<void>;
  onRenameUser: (userId: string, newName: string) => Promise<void>;
  onResetPassword: (userId: string, newPassword: string) => Promise<void>;
  onToggleUser: (user: AdminUser) => Promise<void>;
  onDeleteUser: (user: AdminUser) => void;
  onToggleUserPermission: (user: AdminUser, key: UserPermissionKey) => Promise<void>;
  onRechargeCredits: (userId: string, amount: number, description: string) => Promise<void>;
  providers: AdminProvider[];
}

export default function AdminTabs({
  activeTab, adminUsers, onRefreshAdmin, onCreateUser, onRenameUser,
  onResetPassword, onToggleUser, onDeleteUser, onToggleUserPermission,
  onRechargeCredits, providers,
}: AdminTabsProps) {

  /* ─── Shared state ─── */
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userFilterRole, setUserFilterRole] = useState<'all' | 'admin' | 'user'>('all');
  const [userFilterStatus, setUserFilterStatus] = useState<'all' | 'active' | 'disabled'>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [showUserDrawer, setShowUserDrawer] = useState(false);
  const [showUserAddDrawer, setShowUserAddDrawer] = useState(false);
  const [userDetailId, setUserDetailId] = useState<string | null>(null);
  const [userDetailCredits, setUserDetailCredits] = useState<CreditsInfo | null>(null);
  const [userDetailTransactions, setUserDetailTransactions] = useState<Transaction[]>([]);
  const [editName, setEditName] = useState('');
  const [resetPwdUser, setResetPwdUser] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [rechargeUserId, setRechargeUserId] = useState<string | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeDesc, setRechargeDesc] = useState('');

  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditStats, setAuditStats] = useState<AuditStats>({ todayCount: 0, weekCount: 0, totalCount: 0 });
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilterAction, setAuditFilterAction] = useState('all');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  const [creditsSubTab, setCreditsSubTab] = useState<'overview' | 'transactions' | 'stats' | 'plans'>('overview');
  const [systemSettings, setSystemSettings] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);

  /* ─── Computed ─── */
  const filteredAdminUsers = useMemo(() => {
    return adminUsers.filter(u => {
      if (userFilterRole !== 'all' && u.role !== userFilterRole) return false;
      if (userFilterStatus !== 'all') {
        if (userFilterStatus === 'active' && u.status === 'disabled') return false;
        if (userFilterStatus === 'disabled' && u.status !== 'disabled') return false;
      }
      if (userSearchQuery) {
        const q = userSearchQuery.toLowerCase();
        if (!u.name.toLowerCase().includes(q) && !u.id.toLowerCase().includes(q) && !(u.email || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [adminUsers, userFilterRole, userFilterStatus, userSearchQuery]);

  /* ─── Data loaders ─── */
  const loadUserDetail = useCallback(async (userId: string) => {
    setUserDetailId(userId);
    setShowUserDrawer(true);
    try {
      const res = await fetch(`/api/credits/user/${userId}`);
      if (res.ok) { const data = await res.json(); setUserDetailCredits(data); }
    } catch { /* ignore */ }
    try {
      const res = await fetch(`/api/credits/transactions?userId=${userId}&limit=10`);
      if (res.ok) { const data = await res.json(); setUserDetailTransactions(data.transactions || []); }
    } catch { /* ignore */ }
  }, []);

  const loadDashboardStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dashboard-stats');
      if (res.ok) { const data = await res.json(); setDashboardStats(data); }
    } catch { /* ignore */ }
  }, []);

  const loadAuditLogs = useCallback(async (page = 1) => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (auditFilterAction !== 'all') params.set('action', auditFilterAction);
      const res = await fetch(`/api/admin/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
        setAuditTotal(data.total || 0);
      }
    } catch { /* ignore */ }
    finally { setAuditLoading(false); }
  }, [auditFilterAction]);

  const loadAuditStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/audit?stats=true');
      if (res.ok) { const data = await res.json(); setAuditStats(data.stats || { todayCount: 0, weekCount: 0, totalCount: 0 }); }
    } catch { /* ignore */ }
  }, []);

  const loadSystemSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) { const data = await res.json(); setSystemSettings(data.settings || {}); setSettingsDirty(false); }
    } catch { /* ignore */ }
  }, []);

  /* ─── Tab-switch data loading ─── */
  useEffect(() => {
    if (activeTab === 'overview') void loadDashboardStats();
    if (activeTab === 'audit') { void loadAuditLogs(1); void loadAuditStats(); }
    if (activeTab === 'settings') void loadSystemSettings();
  }, [activeTab, loadDashboardStats, loadAuditLogs, loadAuditStats, loadSystemSettings]);

  /* ─── Handlers ─── */
  const handleBatchToggleUsers = async (enable: boolean) => {
    for (const id of selectedUserIds) {
      const user = adminUsers.find(u => u.id === id);
      if (user && user.role !== 'admin') {
        if ((enable && user.status === 'disabled') || (!enable && user.status !== 'disabled')) {
          await onToggleUser(user);
        }
      }
    }
    setSelectedUserIds(new Set());
    onRefreshAdmin();
  };

  const handleSaveSettings = async () => {
    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(systemSettings),
      });
      setSettingsDirty(false);
      onRefreshAdmin();
    } catch { /* ignore */ }
  };

  /* ═══════════════════════════════════════════════
     Tab: 运营总览 (Overview)
     ═══════════════════════════════════════════════ */
  if (activeTab === 'overview') {
    const stats = dashboardStats;
    const userTrend = stats?.userTrend || [12, 19, 15, 25, 22, 30, 28, 35, 40, 38, 45, 50];
    const creditsTrend = stats?.creditsTrend || [80, 120, 95, 150, 130, 180, 160, 200, 190, 220, 250, 280];
    const apiRank = stats?.apiCallRank || providers.slice(0, 5).map((p, i) => ({ name: p.name, calls: 500 - i * 80 }));
    const alerts = stats?.alerts || [
      { level: 'warn', message: 'AI Link 图像余额不足 50', time: Date.now() - 3600000 },
      { level: 'info', message: '今日新增用户 3 人', time: Date.now() - 7200000 },
    ];
    const maxCalls = Math.max(...apiRank.map(r => r.calls), 1);

    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">运营总览</h1>
            <p className="text-sm text-muted-foreground mt-0.5">平台运营数据实时概览</p>
          </div>
          <button onClick={() => void loadDashboardStats()} className="h-9 px-4 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-pointer hover:text-foreground transition-colors flex items-center gap-2"><RefreshCw className="w-4 h-4" />刷新</button>
        </div>

        {/* 4 统计卡片 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: '总用户', value: stats?.totalUsers ?? '—', sub: `今日活跃 ${stats?.todayActive ?? 0}`, icon: Users, color: 'text-primary', bg: 'bg-primary/15' },
            { label: '本周活跃', value: stats?.weekActive ?? '—', sub: `月活 ${stats?.monthActive ?? 0}`, icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/15' },
            { label: '积分总量', value: stats?.totalCredits ?? '—', sub: `今日消耗 ${stats?.todayCreditsUsed ?? 0}`, icon: Coins, color: 'text-primary', bg: 'bg-primary/15' },
            { label: 'API提供商', value: stats?.totalProviders ?? '—', sub: `活跃 ${stats?.activeProviders ?? 0}`, icon: Server, color: 'text-blue-400', bg: 'bg-blue-500/15' },
          ].map((item, i) => (
            <div key={i} className="rounded-xl bg-card border border-border/50 shadow-card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg ${item.bg} ${item.color} flex items-center justify-center`}><item.icon className="w-5 h-5" /></div>
              </div>
              <p className="text-2xl font-bold text-foreground">{item.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.sub}</p>
            </div>
          ))}
        </div>

        {/* 趋势图：用户活跃 + 积分消耗 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl bg-card border border-border/50 shadow-card">
            <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />用户活跃趋势</h3>
              <span className="text-xs text-muted-foreground">近12周</span>
            </div>
            <div className="p-5"><TrendChart data={userTrend} color="#d4af37" /></div>
          </div>
          <div className="rounded-xl bg-card border border-border/50 shadow-card">
            <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Coins className="w-4 h-4 text-primary" />积分消耗趋势</h3>
              <span className="text-xs text-muted-foreground">近12周</span>
            </div>
            <div className="p-5"><TrendChart data={creditsTrend} color="#22c55e" /></div>
          </div>
        </div>

        {/* API 调用量排行 + 异常预警 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* API 调用量排行 */}
          <div className="lg:col-span-2 rounded-xl bg-card border border-border/50 shadow-card">
            <div className="px-5 py-4 border-b border-border/50">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />API 调用量排行</h3>
            </div>
            <div className="p-5 space-y-3">
              {apiRank.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-5 text-xs font-bold text-muted-foreground text-right">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-foreground font-medium truncate">{item.name}</span>
                      <span className="text-xs text-muted-foreground ml-2 shrink-0">{item.calls} 次</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${(item.calls / maxCalls) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
              {apiRank.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>}
            </div>
          </div>

          {/* 异常预警 */}
          <div className="rounded-xl bg-card border border-border/50 shadow-card">
            <div className="px-5 py-4 border-b border-border/50">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-400" />异常预警</h3>
            </div>
            <div className="p-5 space-y-3">
              {alerts.map((alert, i) => (
                <div key={i} className={`px-3 py-2.5 rounded-lg border ${alert.level === 'warn' ? 'bg-orange-500/10 border-orange-500/20' : 'bg-blue-500/10 border-blue-500/20'}`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${alert.level === 'warn' ? 'text-orange-400' : 'text-blue-400'}`} />
                    <div>
                      <p className="text-xs font-medium text-foreground">{alert.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(alert.time)}</p>
                    </div>
                  </div>
                </div>
              ))}
              {alerts.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">暂无预警</p>}
            </div>
          </div>
        </div>

        {/* API 提供商状态 */}
        <div className="rounded-xl bg-card border border-border/50 shadow-card">
          <div className="px-5 py-4 border-b border-border/50">
            <h3 className="text-sm font-semibold text-foreground">API 提供商状态</h3>
          </div>
          <div className="p-5">
            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">暂无 API 提供商</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {providers.map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/50">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${p.isEnabled ? 'bg-green-400' : 'bg-muted-foreground/30'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.modelType} · {p.selectedModels?.length ?? 0} 模型</p>
                    </div>
                    {p.balance !== undefined && <span className="text-xs font-semibold text-primary">{p.balance.toFixed(2)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 最近注册用户 */}
        <div className="rounded-xl bg-card border border-border/50 shadow-card">
          <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">最近注册用户</h3>
            <button onClick={() => {/* switch to users tab */}} className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">查看全部<ArrowRight className="w-3 h-3" /></button>
          </div>
          <div className="p-5">
            {(stats?.recentUsers?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">暂无注册记录</p>
            ) : (
              <div className="space-y-2">
                {stats?.recentUsers?.map(u => (
                  <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${getAvatarColor(u.id)}`}>{getInitial(u.name)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                      <p className="text-[11px] text-muted-foreground">{u.id.slice(0, 8)}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{fmtDate(u.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
     Tab: 审计日志 (Audit)
     ═══════════════════════════════════════════════ */
  if (activeTab === 'audit') {
    const totalPages = Math.ceil(auditTotal / 20);
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">审计日志</h1>
            <p className="text-sm text-muted-foreground mt-0.5">管理员操作记录，受保护不可删除</p>
          </div>
          <button onClick={() => { void loadAuditLogs(auditPage); void loadAuditStats(); }} className="h-9 px-4 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-pointer hover:text-foreground transition-colors flex items-center gap-2"><RefreshCw className="w-4 h-4" />刷新</button>
        </div>

        {/* 3 摘要卡片 */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: '今日操作', value: auditStats.todayCount, icon: Activity, color: 'text-primary', bg: 'bg-primary/15' },
            { label: '本周操作', value: auditStats.weekCount, icon: BarChart3, color: 'text-blue-400', bg: 'bg-blue-500/15' },
            { label: '总记录数', value: auditStats.totalCount, icon: Database, color: 'text-green-400', bg: 'bg-green-500/15' },
          ].map((item, i) => (
            <div key={i} className="rounded-xl bg-card border border-border/50 shadow-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-9 h-9 rounded-lg ${item.bg} ${item.color} flex items-center justify-center`}><item.icon className="w-4 h-4" /></div>
                <span className="text-sm text-muted-foreground">{item.label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{item.value}</p>
            </div>
          ))}
        </div>

        {/* 筛选栏 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border/50">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <select value={auditFilterAction} onChange={e => { setAuditFilterAction(e.target.value); setAuditPage(1); }} className="bg-transparent text-sm text-foreground cursor-pointer focus:outline-none">
              <option value="all">全部操作</option>
              {Object.entries(actionLabelMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <span className="text-xs text-muted-foreground">共 {auditTotal} 条记录</span>
        </div>

        {/* 日志表格 */}
        <div className="rounded-xl bg-card border border-border/50 shadow-card overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_100px_120px_1fr_140px] gap-2 px-5 py-3 bg-muted/50 border-b border-border/50 text-xs font-semibold text-muted-foreground">
            <span>操作详情</span><span>操作人</span><span>操作类型</span><span>目标</span><span>时间</span>
          </div>
          {/* 日志行 */}
          {auditLoading ? (
            <div className="p-8 text-center"><RefreshCw className="w-5 h-5 text-muted-foreground animate-spin mx-auto" /><p className="text-sm text-muted-foreground mt-2">加载中…</p></div>
          ) : auditLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">暂无审计记录</div>
          ) : (
            <div className="divide-y divide-border/30">
              {auditLogs.map(log => {
                const isAnomaly = ['user_delete', 'api_delete'].includes(log.action);
                const isExpanded = expandedAuditId === log.id;
                return (
                  <div key={log.id} className={isAnomaly ? 'bg-red-500/5' : ''}>
                    <div
                      className="grid grid-cols-[1fr_100px_120px_1fr_140px] gap-2 px-5 py-3 items-center text-sm cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedAuditId(isExpanded ? null : log.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isAnomaly && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className="truncate text-foreground">{actionLabelMap[log.action] || log.action}</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                      <span className="text-muted-foreground truncate">{log.user_name || log.user_id.slice(0, 8)}</span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium w-fit ${actionColorMap[log.action] || 'bg-muted text-muted-foreground'}`}>{actionLabelMap[log.action] || log.action}</span>
                      <span className="text-muted-foreground truncate">{log.target_type ? `${log.target_type}/${log.target_id?.slice(0, 8)}` : '—'}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{fmtDateFull(log.created_at)}</span>
                    </div>
                    {/* 展开详情 */}
                    {isExpanded && (
                      <div className="px-5 pb-3 pt-0">
                        <div className="rounded-lg bg-muted/50 p-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
                          {(() => {
                            try { return JSON.stringify(JSON.parse(log.detail || '{}'), null, 2); } catch { return log.detail || '无详情'; }
                          })()}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
                          <span>IP: {log.ip_address || '—'}</span>
                          <span>ID: {log.id}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button disabled={auditPage <= 1} onClick={() => { setAuditPage(p => p - 1); void loadAuditLogs(auditPage - 1); }} className="h-8 w-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center cursor-pointer disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm text-muted-foreground">{auditPage} / {totalPages}</span>
            <button disabled={auditPage >= totalPages} onClick={() => { setAuditPage(p => p + 1); void loadAuditLogs(auditPage + 1); }} className="h-8 w-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center cursor-pointer disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
     Tab: 用户管理 (Users)
     ═══════════════════════════════════════════════ */
  if (activeTab === 'users') {
    const detailUser = adminUsers.find(u => u.id === userDetailId);
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">用户管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">共 {adminUsers.length} 个用户</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void onRefreshAdmin()} className="h-9 px-4 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-pointer hover:text-foreground transition-colors flex items-center gap-2"><RefreshCw className="w-4 h-4" />刷新</button>
            <button onClick={() => setShowUserAddDrawer(true)} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer hover:bg-primary/90 transition-colors flex items-center gap-2"><UserPlus className="w-4 h-4" />添加用户</button>
          </div>
        </div>

        {/* 搜索+筛选 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={userSearchQuery} onChange={e => setUserSearchQuery(e.target.value)} placeholder="搜索用户名、ID、邮箱…" className="w-full h-9 pl-9 pr-3 rounded-lg bg-card border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <select value={userFilterRole} onChange={e => setUserFilterRole(e.target.value as typeof userFilterRole)} className="h-9 px-3 rounded-lg bg-card border border-border/50 text-sm text-foreground cursor-pointer focus:outline-none">
            <option value="all">全部角色</option><option value="admin">管理员</option><option value="user">用户</option>
          </select>
          <select value={userFilterStatus} onChange={e => setUserFilterStatus(e.target.value as typeof userFilterStatus)} className="h-9 px-3 rounded-lg bg-card border border-border/50 text-sm text-foreground cursor-pointer focus:outline-none">
            <option value="all">全部状态</option><option value="active">活跃</option><option value="disabled">已禁用</option>
          </select>
          {selectedUserIds.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-muted-foreground">已选 {selectedUserIds.size} 人</span>
              <button onClick={() => void handleBatchToggleUsers(true)} className="h-8 px-3 rounded-lg bg-green-500/15 text-green-400 text-xs font-medium cursor-pointer hover:bg-green-500/25 transition-colors flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" />批量启用</button>
              <button onClick={() => void handleBatchToggleUsers(false)} className="h-8 px-3 rounded-lg bg-orange-500/15 text-orange-400 text-xs font-medium cursor-pointer hover:bg-orange-500/25 transition-colors flex items-center gap-1"><UserX className="w-3.5 h-3.5" />批量禁用</button>
              <button onClick={() => setSelectedUserIds(new Set())} className="h-8 px-3 rounded-lg bg-muted text-muted-foreground text-xs font-medium cursor-pointer hover:text-foreground transition-colors">取消选择</button>
            </div>
          )}
        </div>

        {/* 用户卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAdminUsers.map(user => {
            const isSelected = selectedUserIds.has(user.id);
            const isDisabled = user.status === 'disabled';
            return (
              <div key={user.id} onClick={() => loadUserDetail(user.id)} className={`rounded-xl bg-card border shadow-card p-5 cursor-pointer transition-all hover:shadow-lg ${isSelected ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border/50'}`}>
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${getAvatarColor(user.id)}`}>{getInitial(user.name)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">{user.name}</span>
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${user.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{user.role === 'admin' ? '管理员' : '用户'}</span>
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${isDisabled ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'}`}>{isDisabled ? '已禁用' : '活跃'}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{user.email || user.id}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-[11px] text-muted-foreground">积分</p><p className="text-sm font-semibold text-foreground">{user.creditsBalance ?? '—'}</p></div>
                  <div><p className="text-[11px] text-muted-foreground">作品</p><p className="text-sm font-semibold text-foreground">{user.projectCount ?? '—'}</p></div>
                  <div><p className="text-[11px] text-muted-foreground">注册</p><p className="text-sm font-semibold text-foreground">{fmtDate(user.createdAt)}</p></div>
                </div>
              </div>
            );
          })}
          {filteredAdminUsers.length === 0 && (
            <div className="col-span-full py-12 text-center text-sm text-muted-foreground">没有匹配的用户</div>
          )}
        </div>

        {/* ── 用户详情抽屉 ── */}
        {showUserDrawer && detailUser && (
          <div className="fixed inset-0 z-[200] flex justify-end">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowUserDrawer(false)} />
            <div className="relative w-full max-w-md bg-background border-l border-border/50 shadow-2xl overflow-y-auto">
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-background border-b border-border/50">
                <h2 className="text-base font-bold text-foreground">用户详情</h2>
                <button onClick={() => setShowUserDrawer(false)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center cursor-pointer hover:bg-muted/80"><X className="w-4 h-4 text-muted-foreground" /></button>
              </div>
              <div className="p-5 space-y-5">
                {/* 头像+名称 */}
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold ${getAvatarColor(detailUser.id)}`}>{getInitial(detailUser.name)}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-foreground">{detailUser.name}</h3>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${detailUser.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{detailUser.role === 'admin' ? '管理员' : '用户'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">ID: {detailUser.id}</p>
                    <p className="text-xs text-muted-foreground">{detailUser.email || '未设置邮箱'}</p>
                  </div>
                </div>

                {/* 统计数据 */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-muted/50 p-3 text-center"><p className="text-[11px] text-muted-foreground">积分余额</p><p className="text-base font-bold text-foreground">{userDetailCredits?.balance ?? '—'}</p></div>
                  <div className="rounded-lg bg-muted/50 p-3 text-center"><p className="text-[11px] text-muted-foreground">总充值</p><p className="text-base font-bold text-foreground">{userDetailCredits?.totalRecharged ?? '—'}</p></div>
                  <div className="rounded-lg bg-muted/50 p-3 text-center"><p className="text-[11px] text-muted-foreground">总消耗</p><p className="text-base font-bold text-foreground">{userDetailCredits?.totalUsed ?? '—'}</p></div>
                </div>

                {/* 基本信息 */}
                <div className="rounded-xl bg-card border border-border/50 p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">基本信息</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">注册时间</span><span className="text-foreground">{fmtDateFull(detailUser.createdAt)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">最后登录</span><span className="text-foreground">{fmtDateFull(detailUser.lastLoginAt)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">状态</span><span className={detailUser.status === 'disabled' ? 'text-red-400' : 'text-green-400'}>{detailUser.status === 'disabled' ? '已禁用' : '活跃'}</span></div>
                  </div>
                </div>

                {/* 权限 */}
                <div className="rounded-xl bg-card border border-border/50 p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">API 权限</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(userPermissionLabels) as [UserPermissionKey, string][]).map(([key, label]) => {
                      const enabled = detailUser.apiPermissions?.[key] !== false;
                      return (
                        <button key={key} onClick={() => void onToggleUserPermission(detailUser, key)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${enabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          {enabled ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}{label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 最近交易 */}
                <div className="rounded-xl bg-card border border-border/50 p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">最近交易</h4>
                  {userDetailTransactions.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">暂无交易记录</p>
                  ) : (
                    <div className="space-y-2">
                      {userDetailTransactions.slice(0, 5).map(t => (
                        <div key={t.id} className="flex items-center justify-between text-sm">
                          <div><span className={`font-medium ${t.amount > 0 ? 'text-green-400' : 'text-foreground'}`}>{t.amount > 0 ? '+' : ''}{t.amount}</span><span className="text-muted-foreground ml-2">{t.description || t.type}</span></div>
                          <span className="text-[11px] text-muted-foreground">{fmtDate(t.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="space-y-2 pt-2">
                  <button onClick={async () => { setEditName(detailUser.name); }} className="w-full h-10 rounded-lg bg-muted text-foreground text-sm font-medium cursor-pointer hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"><Pencil className="w-4 h-4" />重命名</button>
                  <button onClick={() => setResetPwdUser(detailUser.id)} className="w-full h-10 rounded-lg bg-muted text-foreground text-sm font-medium cursor-pointer hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"><KeyRound className="w-4 h-4" />重置密码</button>
                  <button onClick={() => setRechargeUserId(detailUser.id)} className="w-full h-10 rounded-lg bg-primary/15 text-primary text-sm font-semibold cursor-pointer hover:bg-primary/25 transition-colors flex items-center justify-center gap-2"><Coins className="w-4 h-4" />充值积分</button>
                  {detailUser.role !== 'admin' && (
                    <button onClick={() => void onToggleUser(detailUser)} className={`w-full h-10 rounded-lg text-sm font-medium cursor-pointer transition-colors flex items-center justify-center gap-2 ${detailUser.status === 'disabled' ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : 'bg-orange-500/15 text-orange-400 hover:bg-orange-500/25'}`}>
                      {detailUser.status === 'disabled' ? <><UserCheck className="w-4 h-4" />启用用户</> : <><UserX className="w-4 h-4" />禁用用户</>}
                    </button>
                  )}
                  {detailUser.role !== 'admin' && (
                    <button onClick={() => onDeleteUser(detailUser)} className="w-full h-10 rounded-lg bg-red-500/15 text-red-400 text-sm font-medium cursor-pointer hover:bg-red-500/25 transition-colors flex items-center justify-center gap-2"><Trash2 className="w-4 h-4" />删除用户</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 添加用户抽屉 ── */}
        {showUserAddDrawer && (
          <div className="fixed inset-0 z-[200] flex justify-end">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowUserAddDrawer(false)} />
            <div className="relative w-full max-w-sm bg-background border-l border-border/50 shadow-2xl overflow-y-auto">
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-background border-b border-border/50">
                <h2 className="text-base font-bold text-foreground">添加用户</h2>
                <button onClick={() => setShowUserAddDrawer(false)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center cursor-pointer"><X className="w-4 h-4 text-muted-foreground" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div><label className="text-sm font-medium text-foreground">用户名</label><input value={newUserName} onChange={e => setNewUserName(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-sm font-medium text-foreground">密码</label><input type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-sm font-medium text-foreground">邮箱 (可选)</label><input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <button onClick={async () => { if (newUserName && newUserPassword) { await onCreateUser(newUserName, newUserPassword, newUserEmail || undefined); setNewUserName(''); setNewUserPassword(''); setNewUserEmail(''); setShowUserAddDrawer(false); } }} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer hover:bg-primary/90 transition-colors">创建用户</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 重置密码弹窗 ── */}
        {resetPwdUser && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setResetPwdUser(null)} />
            <div className="relative w-full max-w-sm bg-background rounded-xl border border-border/50 shadow-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-foreground">重置密码</h3>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="输入新密码" className="w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setResetPwdUser(null)} className="h-9 px-4 rounded-lg bg-muted text-muted-foreground text-sm cursor-pointer">取消</button>
                <button onClick={async () => { if (newPassword) { await onResetPassword(resetPwdUser, newPassword); setResetPwdUser(null); setNewPassword(''); } }} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer">确认重置</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 充值弹窗 ── */}
        {rechargeUserId && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setRechargeUserId(null)} />
            <div className="relative w-full max-w-sm bg-background rounded-xl border border-border/50 shadow-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-foreground">充值积分</h3>
              <div><label className="text-sm font-medium text-foreground">充值金额</label><input type="number" value={rechargeAmount} onChange={e => setRechargeAmount(e.target.value)} placeholder="输入充值积分" className="mt-1 w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-sm font-medium text-foreground">备注</label><input value={rechargeDesc} onChange={e => setRechargeDesc(e.target.value)} placeholder="充值原因（可选）" className="mt-1 w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setRechargeUserId(null)} className="h-9 px-4 rounded-lg bg-muted text-muted-foreground text-sm cursor-pointer">取消</button>
                <button onClick={async () => { if (rechargeAmount) { await onRechargeCredits(rechargeUserId, Number(rechargeAmount), rechargeDesc || '管理员充值'); setRechargeUserId(null); setRechargeAmount(''); setRechargeDesc(''); } }} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer">确认充值</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
     Tab: 积分管理 (Credits)
     ═══════════════════════════════════════════════ */
  if (activeTab === 'credits') {
    const subTabs = [
      { key: 'overview' as const, label: '概览', icon: BarChart3 },
      { key: 'transactions' as const, label: '消耗明细', icon: Receipt },
      { key: 'stats' as const, label: '统计分析', icon: TrendingUp },
      { key: 'plans' as const, label: '套餐管理', icon: ShoppingBag },
    ];
    const totalBalance = adminUsers.reduce((s, u) => s + (u.creditsBalance ?? 0), 0);
    const totalUsers = adminUsers.length;
    const avgBalance = totalUsers > 0 ? Math.round(totalBalance / totalUsers) : 0;
    // Mock data for donut chart
    const creditsSegments = [
      { value: 45, color: '#d4af37', label: '图像生成' },
      { value: 25, color: '#3b82f6', label: '视频生成' },
      { value: 15, color: '#22c55e', label: 'AI对话' },
      { value: 10, color: '#a855f7', label: '矢量化' },
      { value: 5, color: '#f97316', label: '其他' },
    ];

    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        {/* 页面标题 */}
        <div>
          <h1 className="text-xl font-bold text-foreground">积分管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">平台积分使用与管理</p>
        </div>

        {/* 4 统计卡片 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: '积分总额', value: totalBalance, icon: Coins, color: 'text-primary', bg: 'bg-primary/15' },
            { label: '活跃用户', value: adminUsers.filter(u => u.status !== 'disabled').length, icon: Users, color: 'text-green-400', bg: 'bg-green-500/15' },
            { label: '人均余额', value: avgBalance, icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/15' },
            { label: '总用户', value: totalUsers, icon: UserPlus, color: 'text-purple-400', bg: 'bg-purple-500/15' },
          ].map((item, i) => (
            <div key={i} className="rounded-xl bg-card border border-border/50 shadow-card p-5">
              <div className={`w-10 h-10 rounded-lg ${item.bg} ${item.color} flex items-center justify-center mb-3`}><item.icon className="w-5 h-5" /></div>
              <p className="text-2xl font-bold text-foreground">{item.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
            </div>
          ))}
        </div>

        {/* Sub-tab 导航 */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 w-fit">
          {subTabs.map(st => (
            <button key={st.key} onClick={() => setCreditsSubTab(st.key)} className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${creditsSubTab === st.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              <st.icon className="w-4 h-4" />{st.label}
            </button>
          ))}
        </div>

        {/* Sub-tab 内容 */}
        {creditsSubTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 消耗分布饼图 */}
            <div className="rounded-xl bg-card border border-border/50 shadow-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">积分消耗分布</h3>
              <div className="flex items-center gap-6">
                <DonutChart segments={creditsSegments} size={140} />
                <div className="space-y-2 flex-1">
                  {creditsSegments.map((seg, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
                      <span className="text-sm text-foreground flex-1">{seg.label}</span>
                      <span className="text-sm font-semibold text-foreground">{seg.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Top 10 消耗用户 */}
            <div className="rounded-xl bg-card border border-border/50 shadow-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Top 10 消耗用户</h3>
              <div className="space-y-2">
                {adminUsers.slice(0, 10).map((u, i) => (
                  <div key={u.id} className="flex items-center gap-3">
                    <span className="w-5 text-xs font-bold text-muted-foreground text-right">{i + 1}</span>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${getAvatarColor(u.id)}`}>{getInitial(u.name)}</div>
                    <span className="text-sm text-foreground flex-1 truncate">{u.name}</span>
                    <span className="text-sm font-semibold text-foreground">{u.creditsBalance ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {creditsSubTab === 'transactions' && (
          <div className="rounded-xl bg-card border border-border/50 shadow-card overflow-hidden">
            <div className="grid grid-cols-[1fr_100px_100px_1fr_140px] gap-2 px-5 py-3 bg-muted/50 border-b border-border/50 text-xs font-semibold text-muted-foreground">
              <span>用户</span><span>类型</span><span>金额</span><span>描述</span><span>时间</span>
            </div>
            <div className="p-8 text-center text-sm text-muted-foreground">
              消耗明细从用户交易记录加载，点击"刷新"获取最新数据
            </div>
          </div>
        )}

        {creditsSubTab === 'stats' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl bg-card border border-border/50 shadow-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">积分消耗趋势</h3>
              <TrendChart data={[200, 350, 280, 420, 380, 500, 450, 520, 480, 600, 550, 700]} color="#d4af37" height={100} />
            </div>
            <div className="rounded-xl bg-card border border-border/50 shadow-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">按模型消耗占比</h3>
              <div className="space-y-3">
                {creditsSegments.map((seg, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-foreground">{seg.label}</span>
                      <span className="text-xs text-muted-foreground">{seg.value}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${seg.value}%`, backgroundColor: seg.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {creditsSubTab === 'plans' && (
          <div className="rounded-xl bg-card border border-border/50 shadow-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">差异化定价</h3>
              <span className="text-xs text-muted-foreground">按模型类型设置积分消耗比例</span>
            </div>
            {[
              { name: '图像生成', multiplier: '1.0x', desc: 'DALL-E / Flux / SD 等图像模型' },
              { name: '视频生成', multiplier: '5.0x', desc: '可灵 / Seedance / Vidu 等视频模型' },
              { name: 'AI对话', multiplier: '0.1x', desc: 'GPT / Gemini 等LLM模型' },
              { name: '矢量化', multiplier: '2.0x', desc: 'SVG矢量化转换' },
              { name: '3D模型', multiplier: '3.0x', desc: '3D模型生成' },
            ].map((plan, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted/50">
                <div><p className="text-sm font-medium text-foreground">{plan.name}</p><p className="text-xs text-muted-foreground">{plan.desc}</p></div>
                <span className="text-sm font-bold text-primary">{plan.multiplier}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
     Tab: 系统设置 (Settings)
     ═══════════════════════════════════════════════ */
  if (activeTab === 'settings') {
    const imageModels = providers.filter(p => p.modelType === 'image' && p.isEnabled);
    const chatModels = providers.filter(p => p.modelType === 'chat' && p.isEnabled);
    const settingSections = [
      { key: 'basic', icon: Settings, label: '基础设置', items: [
        { key: 'defaultImageModel', label: '默认图像模型', desc: '新用户使用的默认图像生成模型', type: 'select' as const, options: imageModels.flatMap(p => (p.selectedModels || []).map(m => ({ value: `${p.id}::${m}`, label: m }))) },
        { key: 'defaultChatModel', label: '默认聊天模型', desc: 'AI 对话使用的默认模型', type: 'select' as const, options: chatModels.flatMap(p => (p.selectedModels || []).map(m => ({ value: `${p.id}::${m}`, label: m }))) },
      ]},
      { key: 'security', icon: Shield, label: '安全设置', items: [
        { key: 'enableRegistration', label: '开放注册', desc: '是否允许新用户自行注册账号', type: 'toggle' as const },
        { key: 'enableRateLimit', label: 'API 限流', desc: '启用后每用户每分钟最多 30 次请求', type: 'toggle' as const },
      ]},
      { key: 'storage', icon: HardDrive, label: '存储设置', items: [
        { key: 'maxUploadSizeMb', label: '图片上传大小 (MB)', desc: '单张图片上传大小限制', type: 'number' as const },
        { key: 'maxConcurrentTasks', label: '最大并发任务', desc: '单个用户同时运行的最大任务数', type: 'number' as const },
      ]},
      { key: 'models', icon: Cpu, label: '模型配置', items: [
        { key: 'enableVideoGeneration', label: '视频生成', desc: '是否启用视频生成功能', type: 'toggle' as const },
        { key: 'enable3DModel', label: '3D 模型', desc: '是否启用 3D 模型生成功能', type: 'toggle' as const },
      ]},
      { key: 'announcement', icon: Bell, label: '系统公告', items: [
        { key: 'systemAnnouncement', label: '公告内容', desc: '留空则不显示公告', type: 'textarea' as const },
      ]},
    ];

    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">系统设置</h1>
            <p className="text-sm text-muted-foreground mt-0.5">配置平台默认参数和功能</p>
          </div>
          {settingsDirty && (
            <div className="flex items-center gap-2 text-xs text-orange-400"><AlertTriangle className="w-3.5 h-3.5" />有未保存的修改</div>
          )}
        </div>

        {/* 5 组设置卡片 */}
        {settingSections.map(section => (
          <div key={section.key} className="rounded-xl bg-card border border-border/50 shadow-card">
            <div className="px-5 py-4 border-b border-border/50">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><section.icon className="w-4 h-4 text-primary" />{section.label}</h3>
            </div>
            <div className="p-5 space-y-5">
              {section.items.map(item => (
                <div key={item.key} className="flex items-center justify-between gap-4">
                  <div className="flex-1"><p className="text-sm font-medium text-foreground">{item.label}</p><p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p></div>
                  {item.type === 'select' && (
                    <select value={systemSettings[item.key] || ''} onChange={e => { setSystemSettings(s => ({ ...s, [item.key]: e.target.value })); setSettingsDirty(true); }} className="h-9 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 max-w-[200px]">
                      <option value="">自动选择</option>
                      {item.options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  )}
                  {item.type === 'toggle' && (
                    <button onClick={() => { setSystemSettings(s => ({ ...s, [item.key]: s[item.key] === 'true' ? 'false' : 'true' })); setSettingsDirty(true); }} className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${systemSettings[item.key] === 'true' ? 'bg-primary' : 'bg-muted'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${systemSettings[item.key] === 'true' ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  )}
                  {item.type === 'number' && (
                    <input type="number" value={systemSettings[item.key] || ''} onChange={e => { setSystemSettings(s => ({ ...s, [item.key]: e.target.value })); setSettingsDirty(true); }} className="w-24 h-9 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  )}
                  {item.type === 'textarea' && (
                    <textarea value={systemSettings[item.key] || ''} onChange={e => { setSystemSettings(s => ({ ...s, [item.key]: e.target.value })); setSettingsDirty(true); }} placeholder="输入公告内容…" rows={3} className="w-full max-w-md px-3 py-2 rounded-lg bg-muted border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 保存按钮 */}
        <div className="flex justify-end gap-3 pt-2 pb-8">
          <button onClick={() => void loadSystemSettings()} className="h-10 px-5 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-pointer hover:text-foreground transition-colors flex items-center gap-2"><RotateCcw className="w-4 h-4" />重置</button>
          <button onClick={() => void handleSaveSettings()} className="h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer hover:bg-primary/90 transition-colors flex items-center gap-2"><Save className="w-4 h-4" />保存设置</button>
        </div>
      </div>
    );
  }

  return null;
}
