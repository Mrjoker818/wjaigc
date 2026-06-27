'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users, TrendingUp, Wallet, ShieldCheck, Activity, BarChart3,
  Settings2, Search, RefreshCw, Plus, ChevronRight, ChevronDown,
  ChevronLeft, AlertTriangle, Eye, EyeOff, RotateCcw, Save,
  X, Check, Ban, MoreHorizontal, UserPlus, ArrowUpDown, Filter,
  CircleDot, Server, Database, Bell, Lock, HardDrive, Cpu
} from 'lucide-react';

/* ── Types ── */
interface AdminUser {
  id: string; name: string; role: string; status: string;
  email?: string; credits: number; created_at: string;
  last_login?: string; project_count?: number; api_permissions?: string[];
}

interface AdminProvider {
  id: string; name: string; base_url: string; api_key: string;
  model_type: string; selected_models: string[]; discovered_models: string[];
  isEnabled: boolean; balance?: number; balanceCurrency?: string;
  compatProfile?: string; advancedParams?: Record<string, unknown>;
}

interface AdminTabsProps {
  activeTab: string;
  adminUsers: AdminUser[];
  onRefreshAdmin: () => void;
  onCreateUser: (name: string, password: string, email: string) => Promise<void>;
  onRenameUser: (userId: string, newName: string) => Promise<void>;
  onResetPassword: (userId: string, newPassword: string) => Promise<void>;
  onToggleUser: (user: AdminUser) => Promise<void>;
  onDeleteUser: (user: AdminUser) => void;
  onToggleUserPermission: (user: AdminUser, key: string) => Promise<void>;
  onRechargeCredits: (userId: string, amount: number, description: string) => Promise<void>;
  providers: AdminProvider[];
}

/* ── Mapping: prototype M3 class → shadcn class ── */
// bg-surface → bg-card, bg-surface-container → bg-muted, text-on-surface → text-foreground
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

function formatDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
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
    userTrend: { date: string; count: number }[];
    creditTrend: { date: string; income: number; expense: number }[];
    modelRank: { name: string; calls: number; successRate: number }[];
    providerStatus: { name: string; calls24h: number; failRate: number; status: string }[];
    alerts: { type: string; severity: string; items: { name: string; value: string }[] }[];
    recentUsers: { name: string; date: string; email: string }[];
  } | null>(null);

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

  /* ── Credits state ── */
  const [creditsSubTab, setCreditsSubTab] = useState('overview');
  const [creditsOverview, setCreditsOverview] = useState<{
    totalBalance: number; totalRecharged: number; totalConsumed: number; avgPerUser: number;
    distribution: { label: string; value: number; color: string; pct: string }[];
    topUsers: { name: string; consumed: number; pct: string }[];
    recentTransactions: { id: string; user: string; type: string; amount: number; desc: string; time: string }[];
  } | null>(null);

  /* ── Audit state ── */
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [auditStats, setAuditStats] = useState<{ todayCount: number; weekCount: number; totalCount: number } | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilterAction, setAuditFilterAction] = useState('all');
  const [auditExpandedId, setAuditExpandedId] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);

  /* ── Settings state ── */
  const [systemSettings, setSystemSettings] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);

  /* ── Data loading ── */
  const loadDashboardStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dashboard-stats');
      if (res.ok) { const data = await res.json(); setOverviewData(data); }
    } catch {}
  }, []);

  const loadAuditLogs = useCallback(async (page = 1, action = 'all') => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (action !== 'all') params.set('action', action);
      const res = await fetch(`/api/admin/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
        setAuditTotal(data.total || 0);
        setAuditStats(data.stats || { todayCount: 0, weekCount: 0, totalCount: 0 });
      }
    } catch {} finally { setAuditLoading(false); }
  }, []);

  const loadCreditsOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/credits/overview');
      if (res.ok) { const data = await res.json(); setCreditsOverview(data); }
    } catch {}
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
    if (activeTab === 'credits') loadCreditsOverview();
    if (activeTab === 'settings') loadSystemSettings();
  }, [activeTab, loadDashboardStats, loadAuditLogs, loadCreditsOverview, loadSystemSettings]);

  /* ── Filtered users ── */
  const filteredUsers = useMemo(() => {
    let list = adminUsers;
    if (userSearch) {
      const q = userSearch.toLowerCase();
      list = list.filter(u => u.name.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
    }
    if (userFilterRole !== 'all') list = list.filter(u => u.role === userFilterRole);
    if (userFilterStatus !== 'all') list = list.filter(u => u.status === userFilterStatus);
    return list;
  }, [adminUsers, userSearch, userFilterRole, userFilterStatus]);

  /* ── Handlers ── */
  const handleRefresh = async () => { setLoading(true); await onRefreshAdmin(); setLoading(false); };

  const handleSaveSettings = async () => {
    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(systemSettings)
      });
      setSettingsDirty(false);
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
    return (
      <div className="space-y-4 pb-8">
        {/* 1. 统计卡片 */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Users} label="总用户" value={s ? formatNumber(s.totalUsers) : '-'} sub={s ? `周活 ${formatNumber(s.weekActive)}` : ''} colorClass="text-primary" iconBg="bg-primary/15" />
          <StatCard icon={TrendingUp} label="用户活跃趋势" value={s ? formatNumber(s.weekActive) : '-'} sub="近7日" colorClass="text-green-500" iconBg="bg-green-500/15" />
          <StatCard icon={Wallet} label="积分总余额" value={s ? formatNumber(s.totalCredits) : '-'} sub="全平台" colorClass="text-yellow-500" iconBg="bg-yellow-500/15" />
          <StatCard icon={Activity} label="API 调用量" value={s ? formatNumber(s.totalApiCalls) : '-'} sub="近24h" colorClass="text-blue-500" iconBg="bg-blue-500/15" />
        </div>

        {/* 2. 趋势图区 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 用户活跃趋势 */}
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">用户活跃趋势</h2>
                <p className="text-xs text-muted-foreground mt-0.5">DAU / WAU</p>
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                <button className="px-2.5 py-1 rounded text-xs font-medium bg-primary/15 text-primary transition-colors">7天</button>
                <button className="px-2.5 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">30天</button>
              </div>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-primary/60 rounded-sm" /><span className="text-xs text-muted-foreground">DAU</span></div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-green-500/60 rounded-sm" /><span className="text-xs text-muted-foreground">新增</span></div>
            </div>
            <div className="relative">
              <svg viewBox="0 0 500 200" className="w-full" style={{ overflow: 'visible' }}>
                <line x1="40" y1="10" x2="40" y2="170" stroke="#252529" strokeWidth="0.5" />
                <line x1="40" y1="170" x2="490" y2="170" stroke="#252529" strokeWidth="0.5" />
                {[130, 90, 50, 10].map((y, i) => <line key={i} x1="40" y1={y} x2="490" y2={y} stroke="#1f1f24" strokeWidth="0.5" strokeDasharray="4,4" />)}
                {['0', '50k', '100k', '150k', '200k'].map((label, i) => <text key={i} x="35" y={173 - i * 40} fill="#a1a1aa" fontSize="9" textAnchor="end">{label}</text>)}
                {/* Polyline: DAU */}
                <polyline fill="none" stroke="#d4af37" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                  points="75,100 140,85 205,90 270,75 335,80 400,65 465,55" />
                {/* Area fill under DAU */}
                <polygon fill="url(#dauGrad)" opacity="0.3" points="75,100 140,85 205,90 270,75 335,80 400,65 465,55 465,170 75,170" />
                {/* Polyline: 新增 */}
                <polyline fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                  points="75,145 140,138 205,142 270,130 335,135 400,125 465,120" />
                {/* Dots */}
                {[75,140,205,270,335,400,465].map((x, i) => {
                  const dauY = [100,85,90,75,80,65,55][i];
                  const newY = [145,138,142,130,135,125,120][i];
                  return <React.Fragment key={i}><circle cx={x} cy={dauY} r="3" fill="#d4af37" /><circle cx={x} cy={newY} r="3" fill="#22c55e" /></React.Fragment>;
                })}
                {/* Gradient defs */}
                <defs><linearGradient id="dauGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d4af37" /><stop offset="100%" stopColor="#d4af37" stopOpacity="0" /></linearGradient></defs>
                {/* Labels */}
                {['12/14','12/15','12/16','12/17','12/18','12/19','12/20'].map((d, i) => {
                  const x = 75 + i * 65;
                  return <text key={i} x={x} y="188" fill="#a1a1aa" fontSize="9" textAnchor="middle">{d}</text>;
                })}
                <text x="465" y="48" fill="#d4af37" fontSize="9" fontWeight="600" textAnchor="middle">5,842</text>
                <text x="465" y="113" fill="#22c55e" fontSize="9" fontWeight="600" textAnchor="middle">327</text>
              </svg>
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
                <button className="px-2.5 py-1 rounded text-xs font-medium bg-primary/15 text-primary transition-colors">7天</button>
                <button className="px-2.5 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">30天</button>
              </div>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-green-500/60 rounded-sm" /><span className="text-xs text-muted-foreground">充值</span></div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-yellow-500/60 rounded-sm" /><span className="text-xs text-muted-foreground">消耗</span></div>
            </div>
            <div className="relative">
              <svg viewBox="0 0 500 200" className="w-full" style={{ overflow: 'visible' }}>
                <line x1="40" y1="10" x2="40" y2="170" stroke="#252529" strokeWidth="0.5" />
                <line x1="40" y1="170" x2="490" y2="170" stroke="#252529" strokeWidth="0.5" />
                {[130, 90, 50, 10].map((y, i) => <line key={i} x1="40" y1={y} x2="490" y2={y} stroke="#1f1f24" strokeWidth="0.5" strokeDasharray="4,4" />)}
                {['0', '50k', '100k', '150k', '200k'].map((label, i) => <text key={i} x="35" y={173 - i * 40} fill="#a1a1aa" fontSize="9" textAnchor="end">{label}</text>)}
                {/* Bar pairs - 7 days */}
                {[
                  { x: 58, h1: 100, h2: 80 },
                  { x: 123, h1: 115, h2: 95 },
                  { x: 188, h1: 90, h2: 110 },
                  { x: 253, h1: 120, h2: 100 },
                  { x: 318, h1: 105, h2: 115 },
                  { x: 383, h1: 125, h2: 110 },
                  { x: 448, h1: 135, h2: 120 },
                ].map((bar, i) => (
                  <React.Fragment key={i}>
                    <rect x={bar.x} y={170 - bar.h1} width="16" height={bar.h1} rx="2" fill="rgba(34,197,94,0.6)" />
                    <rect x={bar.x + 18} y={170 - bar.h2} width="16" height={bar.h2} rx="2" fill="rgba(245,158,11,0.6)" />
                  </React.Fragment>
                ))}
                {['12/14','12/15','12/16','12/17','12/18','12/19','12/20'].map((d, i) => {
                  const x = 75 + i * 65;
                  return <text key={i} x={x} y="188" fill="#a1a1aa" fontSize="9" textAnchor="middle">{d}</text>;
                })}
                <text x="456" y="28" fill="#22c55e" fontSize="9" fontWeight="600" textAnchor="middle">168k</text>
                <text x="474" y="43" fill="#f59e0b" fontSize="9" fontWeight="600" textAnchor="middle">150k</text>
              </svg>
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
                <p className="text-xs text-muted-foreground mt-0.5">Top 10 模型近24h调用统计</p>
              </div>
              <button onClick={() => {}} className="text-xs text-primary hover:underline inline-flex items-center gap-1">查看全部 <ChevronRight className="w-3 h-3" /></button>
            </div>
            <div className="space-y-2.5">
              {(s?.modelRank || [
                { name: 'GPT-4o', calls: 42831, successRate: 98.7 },
                { name: 'Claude-3.5-Sonnet', calls: 38412, successRate: 99.1 },
                { name: 'DALL-E 3', calls: 24567, successRate: 97.2 },
                { name: 'Stable Diffusion XL', calls: 19843, successRate: 88.4 },
                { name: 'Midjourney v6', calls: 15234, successRate: 96.8 },
                { name: 'Gemini Pro', calls: 12876, successRate: 95.1 },
                { name: 'Runway Gen-3', calls: 8432, successRate: 89.2 },
                { name: 'Whisper v3', calls: 6215, successRate: 99.4 },
                { name: 'Llama 3.1 70B', calls: 4567, successRate: 84.3 },
                { name: 'Qwen-VL-Max', calls: 3128, successRate: 96.5 },
              ]).map((m, i) => {
                const maxCalls = 42831;
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
              })}
            </div>
          </div>

          {/* API 提供商状态 */}
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">API 提供商状态</h2>
                <p className="text-xs text-muted-foreground mt-0.5">近24h健康监控</p>
              </div>
              <button onClick={() => {}} className="text-xs text-primary hover:underline inline-flex items-center gap-1">管理配置 <ChevronRight className="w-3 h-3" /></button>
            </div>
            <div className="space-y-3">
              {(s?.providerStatus || [
                { name: 'OpenAI', calls24h: 68412, failRate: 1.2, status: '正常' },
                { name: 'Anthropic', calls24h: 38412, failRate: 0.9, status: '正常' },
                { name: 'Stability AI', calls24h: 19843, failRate: 11.6, status: '告警' },
                { name: 'Midjourney', calls24h: 15234, failRate: 3.2, status: '正常' },
                { name: 'Google AI', calls24h: 12876, failRate: 4.9, status: '正常' },
                { name: 'Replicate', calls24h: 4567, failRate: 15.7, status: '异常' },
              ]).map((p, i) => {
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
              })}
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
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-destructive/15 text-destructive">{(s?.alerts || []).length || 4} 条预警</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {/* 余额不足 */}
            <div className="bg-muted/50 rounded-lg p-4 border-l-2 border-yellow-500">
              <div className="flex items-center gap-2 mb-2"><Wallet className="w-3.5 h-3.5 text-yellow-500" /><span className="text-xs font-semibold text-yellow-500">余额不足</span></div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><span className="text-xs text-foreground">Stability AI</span><span className="text-xs font-mono text-yellow-500">$12.40</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-foreground">Replicate</span><span className="text-xs font-mono text-destructive">$3.20</span></div>
              </div>
            </div>
            {/* 高失败率 */}
            <div className="bg-muted/50 rounded-lg p-4 border-l-2 border-destructive">
              <div className="flex items-center gap-2 mb-2"><Activity className="w-3.5 h-3.5 text-destructive" /><span className="text-xs font-semibold text-destructive">高失败率</span></div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><span className="text-xs text-foreground">Replicate</span><span className="text-xs font-mono text-destructive">15.7%</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-foreground">Llama 3.1 70B</span><span className="text-xs font-mono text-yellow-500">84.3%</span></div>
              </div>
            </div>
            {/* 系统警告 */}
            <div className="bg-muted/50 rounded-lg p-4 border-l-2 border-blue-500">
              <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-3.5 h-3.5 text-blue-500" /><span className="text-xs font-semibold text-blue-500">系统警告</span></div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><span className="text-xs text-foreground">数据库连接</span><span className="text-xs font-mono text-yellow-500">延迟高</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-foreground">缓存命中率</span><span className="text-xs font-mono text-yellow-500">68%</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* 5. 最近注册 */}
        <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">最近注册用户</h2>
            <button onClick={() => {}} className="text-xs text-primary hover:underline inline-flex items-center gap-1">查看全部 <ChevronRight className="w-3 h-3" /></button>
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
                {(s?.recentUsers || adminUsers.slice(0, 5).map(u => ({ name: u.name, date: u.created_at || '', email: u.email || '' }))).map((u, i) => (
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
      </div>
    );
  }

  /* ── Render: Users Tab ── */
  if (activeTab === 'users') {
    const detailUser = userDetailId ? adminUsers.find(u => u.id === userDetailId) : null;
    return (
      <div className="space-y-4 pb-8">
        {/* 筛选栏 */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="搜索用户名 / 邮箱…" className="w-full h-9 pl-9 pr-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <select value={userFilterRole} onChange={e => setUserFilterRole(e.target.value)} className="h-9 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="all">全部角色</option><option value="admin">管理员</option><option value="user">用户</option>
          </select>
          <select value={userFilterStatus} onChange={e => setUserFilterStatus(e.target.value)} className="h-9 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="all">全部状态</option><option value="active">活跃</option><option value="disabled">停用</option>
          </select>
          <div className="flex-1" />
          {selectedUserIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">已选 {selectedUserIds.size} 人</span>
              <button onClick={() => handleBatchToggleUsers(true)} className="h-8 px-3 rounded-lg bg-green-500/15 text-green-500 text-xs font-medium hover:bg-green-500/25 transition-colors">批量启用</button>
              <button onClick={() => handleBatchToggleUsers(false)} className="h-8 px-3 rounded-lg bg-destructive/15 text-destructive text-xs font-medium hover:bg-destructive/25 transition-colors">批量停用</button>
            </div>
          )}
          <button onClick={() => setShowUserAddDrawer(true)} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5"><Plus className="w-4 h-4" />新建用户</button>
          <button onClick={handleRefresh} className="h-9 px-3 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        {/* 用户卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map(u => {
            const isActive = u.status === 'active';
            const isSelected = selectedUserIds.has(u.id);
            return (
              <div key={u.id} onClick={() => setUserDetailId(u.id)} className={`bg-card rounded-lg shadow-card p-5 border cursor-pointer hover:border-primary/50 transition-colors ${isSelected ? 'border-primary/50' : 'border-border/50'}`}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">{u.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">{u.name}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${u.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-blue-500/15 text-blue-500'}`}>{u.role === 'admin' ? '管理员' : '用户'}</span>
                    </div>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium mt-1 ${isActive ? 'bg-green-500/15 text-green-500' : 'bg-muted text-muted-foreground'}`}>{isActive ? '活跃' : '停用'}</span>
                  </div>
                  <input type="checkbox" checked={isSelected} onClick={e => { e.stopPropagation(); setSelectedUserIds(prev => { const n = new Set(prev); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; }); }} className="w-4 h-4 rounded border-border accent-primary" />
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">邮箱</span><span className="text-foreground truncate ml-2">{u.email || '-'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">积分</span><span className="text-foreground font-mono">{u.credits.toLocaleString()}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">作品</span><span className="text-foreground font-mono">{u.project_count ?? '-'}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">注册</span><span className="text-foreground font-mono">{formatDate(u.created_at)}</span></div>
                </div>
              </div>
            );
          })}
        </div>
        {filteredUsers.length === 0 && <div className="text-center py-16 text-muted-foreground">暂无用户数据</div>}

        {/* 用户详情抽屉 */}
        {detailUser && (
          <div className="fixed inset-0 z-[200] flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setUserDetailId(null)} />
            <div className="ml-auto w-[420px] h-full bg-card border-l border-border overflow-y-auto relative">
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
                  <div className="bg-muted/50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-foreground">{detailUser.credits.toLocaleString()}</p><p className="text-[10px] text-muted-foreground mt-0.5">积分余额</p></div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-foreground">{detailUser.project_count ?? '-'}</p><p className="text-[10px] text-muted-foreground mt-0.5">作品数</p></div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center"><p className="text-xs font-bold text-foreground">{formatDate(detailUser.created_at)}</p><p className="text-[10px] text-muted-foreground mt-0.5">注册时间</p></div>
                </div>
                {/* 权限 */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">权限设置</h4>
                  <div className="space-y-2">
                    {['image', 'chat', 'video', '3d'].map(key => {
                      const labels: Record<string, string> = { image: '图像生成', chat: 'AI 对话', video: '视频生成', '3d': '3D 模型' };
                      const has = detailUser.api_permissions?.includes(key);
                      return (
                        <div key={key} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg">
                          <span className="text-sm text-foreground">{labels[key]}</span>
                          <button onClick={() => props.onToggleUserPermission(detailUser, key)} className={`w-10 h-5 rounded-full relative transition-colors ${has ? 'bg-primary' : 'bg-muted'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${has ? 'left-5.5 translate-x-0' : 'left-0.5'}`} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* 操作 */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">操作</h4>
                  <div className="space-y-2">
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

        {/* 新建用户抽屉 */}
        {showUserAddDrawer && (
          <div className="fixed inset-0 z-[200] flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowUserAddDrawer(false)} />
            <div className="ml-auto w-[380px] h-full bg-card border-l border-border overflow-y-auto">
              <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">新建用户</h3>
                <button onClick={() => setShowUserAddDrawer(false)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">用户名</label><input value={newUserName} onChange={e => setNewUserName(e.target.value)} placeholder="输入用户名" className="w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">密码</label><input type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} placeholder="输入密码" className="w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-sm font-medium text-foreground mb-1.5 block">邮箱 (可选)</label><input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="输入邮箱" className="w-full h-10 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <button onClick={async () => { if (newUserName && newUserPassword) { await props.onCreateUser(newUserName, newUserPassword, newUserEmail); setShowUserAddDrawer(false); setNewUserName(''); setNewUserPassword(''); setNewUserEmail(''); } }} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">创建用户</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Render: Credits Tab ── */
  if (activeTab === 'credits') {
    const co = creditsOverview;
    const creditTabs = ['overview', 'consumption', 'statistics', 'packages'];
    const creditTabLabels: Record<string, string> = { overview: '概览', consumption: '消耗明细', statistics: '统计分析', packages: '套餐管理' };
    return (
      <div className="space-y-4 pb-8">
        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Wallet} label="积分总余额" value={co ? formatNumber(co.totalBalance) : '-'} colorClass="text-primary" iconBg="bg-primary/15" />
          <StatCard icon={TrendingUp} label="总充值" value={co ? formatNumber(co.totalRecharged) : '-'} sub="累计" colorClass="text-green-500" iconBg="bg-green-500/15" />
          <StatCard icon={BarChart3} label="总消耗" value={co ? formatNumber(co.totalConsumed) : '-'} sub="累计" colorClass="text-yellow-500" iconBg="bg-yellow-500/15" />
          <StatCard icon={Users} label="人均积分" value={co ? formatNumber(co.avgPerUser) : '-'} colorClass="text-blue-500" iconBg="bg-blue-500/15" />
        </div>

        {/* 子Tab */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
          {creditTabs.map(t => (
            <button key={t} onClick={() => setCreditsSubTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${creditsSubTab === t ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{creditTabLabels[t]}</button>
          ))}
        </div>

        {/* 概览 */}
        {creditsSubTab === 'overview' && (
          <div className="grid grid-cols-2 gap-4">
            {/* 积分分布 */}
            <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
              <h2 className="text-base font-semibold text-foreground mb-4">积分消耗分布</h2>
              <DonutChart segments={co?.distribution || [
                { label: '图像生成', value: 45, color: '#d4af37', pct: '45%' },
                { label: 'AI 对话', value: 25, color: '#22c55e', pct: '25%' },
                { label: '视频生成', value: 18, color: '#3b82f6', pct: '18%' },
                { label: '其他', value: 12, color: '#a1a1aa', pct: '12%' },
              ]} />
            </div>
            {/* Top 10 用户消耗排行 */}
            <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
              <h2 className="text-base font-semibold text-foreground mb-4">消耗排行 Top 10</h2>
              <div className="space-y-2.5">
                {(co?.topUsers || [
                  { name: 'user_001', consumed: 42831, pct: '28.3%' },
                  { name: 'user_002', consumed: 38412, pct: '25.4%' },
                  { name: 'user_003', consumed: 24567, pct: '16.2%' },
                  { name: 'user_004', consumed: 19843, pct: '13.1%' },
                  { name: 'user_005', consumed: 15234, pct: '10.1%' },
                ]).map((u, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-5 text-xs font-bold text-right ${i < 3 ? 'text-primary' : 'text-muted-foreground'}`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{u.pct}</span>
                          <span className="text-xs font-mono text-muted-foreground">{u.consumed.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary/60 rounded-full" style={{ width: u.pct.replace('%', '') }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 消耗明细 */}
        {creditsSubTab === 'consumption' && (
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <h2 className="text-base font-semibold text-foreground mb-4">消耗明细</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground border-b border-border/50"><th className="text-left py-2.5 px-3 font-medium">用户</th><th className="text-left py-2.5 px-3 font-medium">类型</th><th className="text-left py-2.5 px-3 font-medium">数量</th><th className="text-left py-2.5 px-3 font-medium">描述</th><th className="text-left py-2.5 px-3 font-medium">时间</th></tr></thead>
                <tbody>
                  {(co?.recentTransactions || []).map((t, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-3 text-foreground font-medium">{t.user}</td>
                      <td className="py-2.5 px-3"><span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${t.type === 'recharge' ? 'bg-green-500/15 text-green-500' : 'bg-yellow-500/15 text-yellow-500'}`}>{t.type === 'recharge' ? '充值' : '消耗'}</span></td>
                      <td className="py-2.5 px-3 font-mono">{t.amount}</td>
                      <td className="py-2.5 px-3 text-muted-foreground">{t.desc}</td>
                      <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs">{t.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 统计分析 */}
        {creditsSubTab === 'statistics' && (
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <h2 className="text-base font-semibold text-foreground mb-4">积分趋势</h2>
            <div className="h-48 flex items-center justify-center text-muted-foreground">趋势图加载中…</div>
          </div>
        )}

        {/* 套餐管理 */}
        {creditsSubTab === 'packages' && (
          <div className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <h2 className="text-base font-semibold text-foreground mb-4">积分定价配置</h2>
            <div className="space-y-4">
              {(providers || []).filter(p => p.model_type === 'image').slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                  <span className="text-sm font-medium text-foreground min-w-[120px] truncate">{p.name}</span>
                  <div className="flex-1 text-xs text-muted-foreground">图像模型</div>
                  <input type="number" placeholder="积分/次" className="w-24 h-8 px-2 rounded-lg bg-muted border border-border/50 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Render: Audit Tab ── */
  if (activeTab === 'audit') {
    const as = auditStats;
    return (
      <div className="space-y-4 pb-8">
        {/* 摘要卡片 */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={ShieldCheck} label="今日操作" value={as ? formatNumber(as.todayCount) : '-'} colorClass="text-primary" iconBg="bg-primary/15" />
          <StatCard icon={Activity} label="本周操作" value={as ? formatNumber(as.weekCount) : '-'} colorClass="text-blue-500" iconBg="bg-blue-500/15" />
          <StatCard icon={Database} label="总记录" value={as ? formatNumber(as.totalCount) : '-'} colorClass="text-green-500" iconBg="bg-green-500/15" />
        </div>

        {/* 筛选栏 */}
        <div className="flex items-center gap-3">
          <select value={auditFilterAction} onChange={e => { setAuditFilterAction(e.target.value); setAuditPage(1); loadAuditLogs(1, e.target.value); }} className="h-9 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="all">全部操作</option>
            <option value="user_create">用户创建</option>
            <option value="user_delete">用户删除</option>
            <option value="user_update">用户更新</option>
            <option value="api_create">API 配置</option>
            <option value="api_delete">API 删除</option>
            <option value="system_update">系统设置</option>
          </select>
          <div className="flex-1" />
          <button onClick={() => loadAuditLogs(auditPage, auditFilterAction)} className="h-9 px-3 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className={`w-4 h-4 ${auditLoading ? 'animate-spin' : ''}`} /></button>
        </div>

        {/* 日志表格 */}
        <div className="bg-card rounded-lg shadow-card border border-border/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground bg-muted/30">
                <th className="text-left py-3 px-4 font-medium">时间</th>
                <th className="text-left py-3 px-4 font-medium">操作者</th>
                <th className="text-left py-3 px-4 font-medium">操作类型</th>
                <th className="text-left py-3 px-4 font-medium">目标</th>
                <th className="text-left py-3 px-4 font-medium">详情</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log: Record<string, unknown>, i) => {
                const action = String(log.action || '');
                const isDanger = action.includes('delete');
                const actionLabels: Record<string, string> = { user_create: '用户创建', user_delete: '用户删除', user_update: '用户更新', api_create: 'API 配置', api_delete: 'API 删除', system_update: '系统设置' };
                const actionColors: Record<string, string> = { user_create: 'bg-green-500/15 text-green-500', user_delete: 'bg-destructive/15 text-destructive', user_update: 'bg-blue-500/15 text-blue-500', api_create: 'bg-primary/15 text-primary', api_delete: 'bg-destructive/15 text-destructive', system_update: 'bg-yellow-500/15 text-yellow-500' };
                const logId = String(log.id || i);
                const isExpanded = auditExpandedId === logId;
                return (
                  <React.Fragment key={logId}>
                    <tr className={`border-b border-border/30 hover:bg-muted/30 transition-colors ${isDanger ? 'bg-destructive/5' : ''}`}>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{formatDateTime(String(log.created_at || ''))}</td>
                      <td className="py-3 px-4 text-foreground font-medium">{String(log.user_name || log.user_id || '-')}</td>
                      <td className="py-3 px-4"><span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${actionColors[action] || 'bg-muted text-muted-foreground'}`}>{actionLabels[action] || action}</span></td>
                      <td className="py-3 px-4 text-muted-foreground">{String(log.target_type || '')}{log.target_id ? ` #${log.target_id}` : ''}</td>
                      <td className="py-3 px-4">
                        {log.detail != null && <button onClick={() => setAuditExpandedId(isExpanded ? null : logId)} className="text-xs text-primary hover:underline inline-flex items-center gap-1">{isExpanded ? '收起' : '展开'} <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></button>}
                      </td>
                    </tr>
                    {isExpanded && log.detail != null && (
                      <tr className="bg-muted/20">
                        <td colSpan={5} className="py-3 px-4"><pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-40 overflow-auto">{typeof log.detail === 'string' ? log.detail : JSON.stringify(log.detail, null, 2)}</pre></td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {auditLogs.length === 0 && <div className="text-center py-12 text-muted-foreground">暂无审计日志</div>}
        </div>

        {/* 分页 */}
        {auditTotal > 20 && (
          <div className="flex items-center justify-center gap-2">
            <button disabled={auditPage <= 1} onClick={() => { setAuditPage(p => p - 1); loadAuditLogs(auditPage - 1, auditFilterAction); }} className="h-8 px-3 rounded-lg bg-muted text-sm text-muted-foreground disabled:opacity-50 hover:text-foreground"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm text-muted-foreground">第 {auditPage} 页</span>
            <button disabled={auditPage * 20 >= auditTotal} onClick={() => { setAuditPage(p => p + 1); loadAuditLogs(auditPage + 1, auditFilterAction); }} className="h-8 px-3 rounded-lg bg-muted text-sm text-muted-foreground disabled:opacity-50 hover:text-foreground"><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}
      </div>
    );
  }

  /* ── Render: Settings Tab ── */
  if (activeTab === 'settings') {
    const settingGroups = [
      { title: '基础设置', icon: Settings2, items: [
        { key: 'defaultImageModel', label: '默认图像模型', type: 'select', options: (providers || []).filter(p => p.model_type === 'image').flatMap(p => (p.selected_models || []).map(m => ({ value: `${p.id}::${m}`, label: m }))) },
        { key: 'defaultChatModel', label: '默认聊天模型', type: 'select', options: (providers || []).filter(p => p.model_type === 'chat').flatMap(p => (p.selected_models || []).map(m => ({ value: `${p.id}::${m}`, label: m }))) },
      ]},
      { title: '安全设置', icon: Lock, items: [
        { key: 'openRegistration', label: '开放注册', type: 'toggle' },
        { key: 'apiRateLimit', label: 'API 限流', type: 'toggle' },
      ]},
      { title: '存储设置', icon: HardDrive, items: [
        { key: 'maxUploadMB', label: '图片上传限制 (MB)', type: 'number' },
        { key: 'maxConcurrentTasks', label: '最大并发任务', type: 'number' },
      ]},
      { title: '模型配置', icon: Cpu, items: [
        { key: 'videoGenerationEnabled', label: '视频生成', type: 'toggle' },
        { key: '3dModelEnabled', label: '3D 模型', type: 'toggle' },
      ]},
      { title: '系统公告', icon: Bell, items: [
        { key: 'announcement', label: '公告内容', type: 'textarea' },
      ]},
    ];

    return (
      <div className="space-y-4 pb-8">
        {settingGroups.map((group, gi) => (
          <div key={gi} className="bg-card rounded-lg shadow-card p-5 border border-border/50">
            <div className="flex items-center gap-2 mb-4">
              <group.icon className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">{group.title}</h2>
            </div>
            <div className="space-y-4">
              {group.items.map((item, ii) => (
                <div key={ii} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{item.label}</span>
                  {item.type === 'select' && (
                    <select value={systemSettings[item.key] || ''} onChange={e => { setSystemSettings(s => ({ ...s, [item.key]: e.target.value })); setSettingsDirty(true); }} className="w-56 h-9 px-3 rounded-lg bg-muted border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                      <option value="">未选择</option>
                      {'options' in item && item.options?.map((o: { value: string; label: string }) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                  {item.type === 'toggle' && (
                    <button onClick={() => { setSystemSettings(s => ({ ...s, [item.key]: s[item.key] === 'true' ? 'false' : 'true' })); setSettingsDirty(true); }} className={`w-10 h-5 rounded-full relative transition-colors ${systemSettings[item.key] === 'true' ? 'bg-primary' : 'bg-muted'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${systemSettings[item.key] === 'true' ? 'left-5.5' : 'left-0.5'}`} />
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
          <button onClick={() => loadSystemSettings()} className="h-10 px-5 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-pointer hover:text-foreground transition-colors flex items-center gap-2"><RotateCcw className="w-4 h-4" />重置</button>
          <button onClick={() => handleSaveSettings()} className="h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer hover:bg-primary/90 transition-colors flex items-center gap-2"><Save className="w-4 h-4" />保存设置</button>
        </div>
      </div>
    );
  }

  return null;
}
