'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Coins, ArrowUpRight, ArrowDownRight, Gift, Clock,
  TrendingUp, Calendar, Zap, History, RefreshCw
} from 'lucide-react';

interface UserCreditsTabProps {
  isDark: boolean;
  userId: string;
  onToast?: (msg: string) => void;
}

interface CreditTransaction {
  id: string;
  type: 'earn' | 'spend' | 'admin_adjust' | 'daily_bonus';
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
}

export default function UserCreditsTab({
  isDark,
  userId,
  onToast
}: UserCreditsTabProps) {
  const [balance, setBalance] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'earn' | 'spend'>('all');

  const loadCredits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/credits');
      const data = await res.json();
      if (data.success) {
        setBalance(data.balance || 0);
        setTotalEarned(data.totalEarned || 0);
        setTotalSpent(data.totalSpent || 0);
        setTransactions(data.transactions || []);
      }
    } catch (err) {
      console.error('Failed to load credits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCredits(); }, [loadCredits]);

  const filteredTransactions = filter === 'all'
    ? transactions
    : transactions.filter(t => filter === 'earn' ? t.amount > 0 : t.amount < 0);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return dateStr; }
  };

  const getTypeIcon = (type: string, amount: number) => {
    if (amount > 0) return <ArrowUpRight className="w-4 h-4 text-green-500" />;
    if (type === 'daily_bonus') return <Gift className="w-4 h-4 text-primary" />;
    return <ArrowDownRight className="w-4 h-4 text-destructive" />;
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'earn': return '获得';
      case 'spend': return '消费';
      case 'admin_adjust': return '管理员调整';
      case 'daily_bonus': return '每日奖励';
      default: return type;
    }
  };

  return (
    <div className="space-y-5 px-1">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">我的积分</h1>
          <p className="text-sm text-muted-foreground mt-0.5">查看积分余额和使用记录</p>
        </div>
        <button
          onClick={loadCredits}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-muted border border-border/30 text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 余额卡片 */}
      <div className="bg-gradient-to-br from-primary/10 to-card border border-primary/20 rounded-lg p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-primary" />
              当前余额
            </div>
            <div className="text-4xl font-bold text-primary mt-1">
              {balance.toLocaleString()}
            </div>
          </div>
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Coins className="w-8 h-8 text-primary" />
          </div>
        </div>
        <div className="flex gap-4 mt-4 pt-3 border-t border-border/30">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-green-500" />
            <span className="text-xs text-muted-foreground">累计获得</span>
            <span className="text-sm font-medium text-green-500">{totalEarned.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-destructive" />
            <span className="text-xs text-muted-foreground">累计消费</span>
            <span className="text-sm font-medium text-destructive">{totalSpent.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-2">
        {[
          { id: 'all' as const, label: '全部' },
          { id: 'earn' as const, label: '收入' },
          { id: 'spend' as const, label: '支出' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              filter === id
                ? 'bg-primary/10 text-primary border border-primary/30'
                : 'bg-muted border border-border/30 text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          共 {filteredTransactions.length} 条记录
        </span>
      </div>

      {/* 交易列表 */}
      <div className="bg-card border border-border/50 rounded-lg overflow-hidden">
        {filteredTransactions.length === 0 ? (
          <div className="p-8 text-center">
            <History className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" />
            <div className="text-sm text-muted-foreground">暂无{filter === 'earn' ? '收入' : filter === 'spend' ? '支出' : ''}记录</div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filteredTransactions.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  t.amount > 0 ? 'bg-green-500/10' : 'bg-destructive/10'
                }`}>
                  {getTypeIcon(t.type, t.amount)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{t.description || getTypeLabel(t.type)}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(t.created_at)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium ${t.amount > 0 ? 'text-green-500' : 'text-destructive'}`}>
                    {t.amount > 0 ? '+' : ''}{t.amount}
                  </div>
                  <div className="text-xs text-muted-foreground">余额 {t.balance_after}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
