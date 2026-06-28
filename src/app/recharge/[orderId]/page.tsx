'use client';

import { useState, useEffect, use } from 'react';
import { RECHARGE_PACKAGES } from '@/lib/credits-constants';

interface OrderInfo {
  id: string;
  amount: number;
  priceCny: number;
  bonus: number;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  expiresAt: number;
  isExpired: boolean;
}

interface RechargeData {
  success: boolean;
  order: OrderInfo;
  note: string;
}

export default function RechargePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const [data, setData] = useState<RechargeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [payResult, setPayResult] = useState<{ balance: number; amount: number } | null>(null);

  useEffect(() => {
    fetchOrderDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function fetchOrderDetails() {
    try {
      const res = await fetch(`/api/recharge/${orderId}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error || '获取订单信息失败');
      } else {
        setData(json);
        if (json.order?.paymentStatus === 'paid') {
          setPaid(true);
        }
      }
    } catch {
      setError('网络错误，请刷新重试');
    } finally {
      setLoading(false);
    }
  }

  async function handlePay() {
    if (paying || paid) return;
    setPaying(true);
    try {
      const res = await fetch(`/api/recharge/${orderId}`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setPaid(true);
        setPayResult({ balance: json.balance, amount: json.amount });
      } else {
        setError(json.error || '支付失败');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setPaying(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-[#d4af37]/30 border-t-[#d4af37] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">&#9888;&#65039;</div>
          <h2 className="text-white text-lg font-semibold mb-2">加载失败</h2>
          <p className="text-white/60 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { order, note } = data;
  const pkg = RECHARGE_PACKAGES.find(p => p.amount + p.bonus === order.amount || p.amount === order.amount - order.bonus);
  const methodLabel = order.paymentMethod === 'alipay' ? '支付宝' : '微信支付';
  const methodIcon = order.paymentMethod === 'alipay' ? '💙' : '💚';
  const expiresDate = order.expiresAt > 0 ? new Date(order.expiresAt).toLocaleString('zh-CN') : '';

  // Success state
  if (paid) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-white text-xl font-bold mb-2">充值成功！</h2>
          <p className="text-[#d4af37] text-2xl font-bold mb-1">{payResult?.amount || order.amount} 积分</p>
          <p className="text-white/50 text-sm mb-6">已到账，可在无界AI工作台查看余额</p>
          <div className="bg-white/5 rounded-xl p-4 mb-4">
            <p className="text-white/40 text-xs mb-1">当前余额</p>
            <p className="text-white text-lg font-semibold">{payResult?.balance || '--'} 积分</p>
          </div>
          <p className="text-white/30 text-xs">您可以关闭此页面</p>
        </div>
      </div>
    );
  }

  // Expired state
  if (order.isExpired) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">&#9203;</div>
          <h2 className="text-white text-lg font-semibold mb-2">订单已过期</h2>
          <p className="text-white/60 text-sm">该充值订单已超时，请返回无界AI重新发起充值</p>
          {expiresDate && <p className="text-white/30 text-xs mt-2">过期时间：{expiresDate}</p>}
        </div>
      </div>
    );
  }

  // Error with data loaded
  const showError = error && data;

  // Main recharge page
  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
      <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#d4af37]/20 to-[#d4af37]/5 px-6 py-5 border-b border-[#30363d]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#d4af37] rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-white text-lg font-bold">无界AI 积分充值</h1>
              <p className="text-white/40 text-xs">一键付款，即时到账</p>
            </div>
          </div>
        </div>

        {/* Order info */}
        <div className="px-6 py-5">
          <div className="bg-white/5 rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-white/40 text-xs mb-1">充值金额</p>
                <p className="text-[#d4af37] text-3xl font-bold">
                  ¥{order.priceCny.toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-white/40 text-xs mb-1">获得积分</p>
                <p className="text-white text-2xl font-bold">
                  {order.amount}
                  {order.bonus > 0 && (
                    <span className="text-emerald-400 text-sm ml-1">+{order.bonus}赠</span>
                  )}
                </p>
              </div>
            </div>
            {pkg && (
              <div className="flex items-center gap-2 text-xs">
                <span className="bg-[#d4af37]/20 text-[#d4af37] px-2 py-0.5 rounded-full">
                  {pkg.label}
                </span>
                <span className="bg-white/10 text-white/60 px-2 py-0.5 rounded-full">
                  {methodIcon} {methodLabel}
                </span>
              </div>
            )}
          </div>

          {/* Error message */}
          {showError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4 text-center">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Pay button */}
          <button
            onClick={handlePay}
            disabled={paying}
            className={`w-full py-4 rounded-xl text-lg font-bold transition-all ${
              paying
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'bg-[#d4af37] text-black hover:bg-[#e5c047] active:scale-[0.98] shadow-lg shadow-[#d4af37]/20'
            }`}
          >
            {paying ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                支付处理中...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                确认支付 ¥{order.priceCny.toFixed(2)}
              </span>
            )}
          </button>

          {note && (
            <p className="text-white/30 text-xs text-center mt-3">{note}</p>
          )}

          <p className="text-white/20 text-xs text-center mt-3">
            点击付款后积分将自动到账
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#30363d] bg-white/[0.02]">
          <div className="flex items-center justify-between text-xs text-white/20">
            <span>订单号：{orderId.slice(0, 20)}...</span>
            {expiresDate && <span>有效期至：{expiresDate}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
