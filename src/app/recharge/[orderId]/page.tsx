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
  adminQrUrl: string;
  note: string;
}

export default function RechargePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const [data, setData] = useState<RechargeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{ balance: number; amount: number } | null>(null);
  const [qrLoaded, setQrLoaded] = useState(false);

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
          setConfirmed(true);
        }
      }
    } catch {
      setError('网络错误，请刷新重试');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmPaid() {
    if (confirming || confirmed) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/recharge/${orderId}`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setConfirmed(true);
        setConfirmResult({ balance: json.balance, amount: json.amount });
      } else {
        setError(json.error || '确认失败');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setConfirming(false);
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

  const { order, adminQrUrl, note } = data;
  const pkg = RECHARGE_PACKAGES.find(p => p.amount + p.bonus === order.amount || p.amount === order.amount - order.bonus);
  const methodLabel = order.paymentMethod === 'alipay' ? '支付宝' : '微信支付';
  const methodIcon = order.paymentMethod === 'alipay' ? '💙' : '💚';
  const expiresDate = order.expiresAt > 0 ? new Date(order.expiresAt).toLocaleString('zh-CN') : '';

  // Success state
  if (confirmed) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-white text-xl font-bold mb-2">充值成功！</h2>
          <p className="text-[#d4af37] text-2xl font-bold mb-1">{confirmResult?.amount || order.amount} 积分</p>
          <p className="text-white/50 text-sm mb-6">已到账，可在无界AI工作台查看余额</p>
          <div className="bg-white/5 rounded-xl p-4 mb-4">
            <p className="text-white/40 text-xs mb-1">当前余额</p>
            <p className="text-white text-lg font-semibold">{confirmResult?.balance || '--'} 积分</p>
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
              <p className="text-white/40 text-xs">扫码支付，即时到账</p>
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

          {/* Admin QR code */}
          <div className="text-center mb-5">
            <p className="text-white/60 text-sm mb-3">
              请使用 <span className="text-white font-medium">{methodLabel}</span> 扫描下方收款码完成付款
            </p>
            <div className="bg-white rounded-2xl p-4 inline-block mx-auto relative">
              {adminQrUrl ? (
                <>
                  {!qrLoaded && (
                    <div className="w-48 h-48 flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                    </div>
                  )}
                  <img
                    src={adminQrUrl}
                    alt="收款码"
                    className={`w-48 h-48 object-contain ${qrLoaded ? '' : 'hidden'}`}
                    onLoad={() => setQrLoaded(true)}
                    onError={() => setQrLoaded(false)}
                  />
                </>
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-gray-400 text-sm">
                  收款码未配置
                </div>
              )}
            </div>
            {note && (
              <p className="text-white/30 text-xs mt-2 px-4">{note}</p>
            )}
          </div>

          {/* Confirm button */}
          <button
            onClick={handleConfirmPaid}
            disabled={confirming}
            className={`w-full py-3.5 rounded-xl text-base font-semibold transition-all ${
              confirming
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'bg-[#d4af37] text-black hover:bg-[#e5c047] active:scale-[0.98]'
            }`}
          >
            {confirming ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                处理中...
              </span>
            ) : (
              '我已完成付款'
            )}
          </button>

          <p className="text-white/20 text-xs text-center mt-3">
            付款后点击上方按钮，积分将自动到账
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
