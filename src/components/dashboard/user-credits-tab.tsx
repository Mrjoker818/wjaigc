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

  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const cardBg = isDark ? 'bg-[#1a1a2e]/60' : 'bg-white';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';
  const accentClass = isDark ? 'text-[#d4af37]' : 'text-amber-600';
  const inputBg = isDark ? 'bg-[#0d0d1a]/60' : 'bg-gray-50';

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
    if (amount > 0) return <ArrowUpRight className="w-4 h-4 text-green-400" />;
    if (type === 'daily_bonus') return <Gift className="w-4 h-4 text-blue-400" />;
    return <ArrowDownRight className="w-4 h-4 text-red-400" />;
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
    <div className="space-y-4">
      {/* 页面头部 */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className={`text-xl font-bold ${textPrimary}`}>我的积分</h1>
          <p className={`text-sm ${textSecondary} mt-0.5`}>查看积分余额和使用记录</p>
        </div>
        <button
          onClick={loadCredits}
          disabled={loading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${inputBg} border ${borderColor} ${textSecondary} hover:${textPrimary} transition-colors`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 余额卡片 */}
      <div className={`${isDark ? 'bg-gradient-to-br from-[#d4af37]/20 to-[#1a1a2e]/80' : 'bg-gradient-to-br from-amber-50 to-white'} border ${isDark ? 'border-[#d4af37]/30' : 'border-amber-200'} rounded-lg p-5`}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-sm ${textSecondary} flex items-center gap-1.5`}>
              <Coins className={`w-4 h-4 ${accentClass}`} />
              当前余额
            </div>
            <div className={`text-4xl font-bold ${accentClass} mt-1`}>
              {balance.toLocaleString()}
            </div>
          </div>
          <div className={`w-16 h-16 rounded-full ${isDark ? 'bg-[#d4af37]/10' : 'bg-amber-100'} flex items-center justify-center`}>
            <Coins className={`w-8 h-8 ${accentClass}`} />
          </div>
        </div>
        <div className="flex gap-4 mt-4 pt-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}" style={{ borderTopColor: isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb' }}>
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            <span className={`text-xs ${textSecondary}`}>累计获得</span>
            <span className={`text-sm font-medium text-green-400`}>{totalEarned.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-red-400" />
            <span className={`text-xs ${textSecondary}`}>累计消费</span>
            <span className={`text-sm font-medium text-red-400`}>{totalSpent.toLocaleString()}</span>
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
                ? `${isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-amber-100 text-amber-700'}`
                : `${inputBg} border ${borderColor} ${textSecondary}`
            }`}
          >
            {label}
          </button>
        ))}
        <span className={`ml-auto text-xs ${textSecondary}`}>
          共 {filteredTransactions.length} 条记录
        </span>
      </div>

      {/* 交易列表 */}
      <div className={`${cardBg} border ${borderColor} rounded-lg overflow-hidden`}>
        {filteredTransactions.length === 0 ? (
          <div className="p-8 text-center">
            <History className={`w-10 h-10 ${textSecondary} mx-auto mb-2 opacity-50`} />
            <div className={`text-sm ${textSecondary}`}>暂无{filter === 'earn' ? '收入' : filter === 'spend' ? '支出' : ''}记录</div>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredTransactions.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 hover:opacity-90 transition-opacity">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  t.amount > 0
                    ? (isDark ? 'bg-green-500/20' : 'bg-green-100')
                    : (isDark ? 'bg-red-500/20' : 'bg-red-100')
                }`}>
                  {getTypeIcon(t.type, t.amount)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${textPrimary} truncate`}>{t.description || getTypeLabel(t.type)}</div>
                  <div className={`text-xs ${textSecondary} flex items-center gap-1`}>
                    <Clock className="w-3 h-3" />
                    {formatDate(t.created_at)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium ${t.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {t.amount > 0 ? '+' : ''}{t.amount}
                  </div>
                  <div className={`text-xs ${textSecondary}`}>余额 {t.balance_after}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
