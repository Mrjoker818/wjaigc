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
  createdAt: number;
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
  const [paid, setPaid] = useState(false);
  const [payResult, setPayResult] = useState<{ balance: number; amount: number } | null>(null);
  const [step, setStep] = useState<'info' | 'paying' | 'success'>('info');

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
          setStep('success');
        }
      }
    } catch {
      setError('网络错误，请刷新重试');
    } finally {
      setLoading(false);
    }
  }

  // Step 2: User clicks "确认支付" → show admin QR code for scanning
  function handleShowPayment() {
    setStep('paying');
  }

  // Step 3: User has paid by scanning admin QR → confirm and credit points
  async function handleConfirmPaid() {
    if (confirming || paid) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/recharge/${orderId}`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setPaid(true);
        setPayResult({ balance: json.balance, amount: json.amount });
        setStep('success');
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

  // Error state (no data)
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

  const { order, note, adminQrUrl } = data;
  const pkg = RECHARGE_PACKAGES.find(p => p.amount + p.bonus === order.amount || p.amount === order.amount - order.bonus);
  const methodLabel = order.paymentMethod === 'alipay' ? '支付宝' : '微信支付';
  const methodIcon = order.paymentMethod === 'alipay' ? '💙' : '💚';
  const expiresDate = order.expiresAt > 0 ? new Date(order.expiresAt).toLocaleString('zh-CN') : '';

  // Success state
  if (step === 'success' || paid) {
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
              <p className="text-white/40 text-xs">扫码付款，即时到账</p>
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-4 flex items-center gap-2 text-xs">
          <div className={`flex items-center gap-1.5 ${step === 'info' ? 'text-[#d4af37]' : 'text-emerald-400'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 'info' ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-emerald-500/20 text-emerald-400'}`}>
              {step === 'paying' ? '✓' : '1'}
            </div>
            <span>确认订单</span>
          </div>
          <div className={`flex-1 h-px ${step === 'paying' ? 'bg-[#d4af37]/40' : 'bg-white/10'}`} />
          <div className={`flex items-center gap-1.5 ${step === 'paying' ? 'text-[#d4af37]' : 'text-white/30'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 'paying' ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-white/10 text-white/30'}`}>
              2
            </div>
            <span>扫码付款</span>
          </div>
          <div className="flex-1 h-px bg-white/10" />
          <div className="flex items-center gap-1.5 text-white/30">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/10 text-white/30">
              3
            </div>
            <span>到账完成</span>
          </div>
        </div>

        <div className="px-6 py-5">
          {/* Order info card */}
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

          {/* Step 1: Confirm order → show payment */}
          {step === 'info' && (
            <>
              <button
                onClick={handleShowPayment}
                className="w-full py-4 rounded-xl text-lg font-bold transition-all bg-[#d4af37] text-black hover:bg-[#e5c047] active:scale-[0.98] shadow-lg shadow-[#d4af37]/20"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  确认支付 ¥{order.priceCny.toFixed(2)}
                </span>
              </button>
              <p className="text-white/20 text-xs text-center mt-3">
                点击后将显示收款码，扫码完成付款
              </p>
            </>
          )}

          {/* Step 2: Show admin QR code for payment */}
          {step === 'paying' && (
            <div className="space-y-4">
              {/* Admin QR code */}
              <div className="bg-white/5 rounded-xl p-5 text-center">
                <p className="text-white/60 text-sm mb-4">
                  请使用{methodLabel}扫描下方收款码完成付款
                </p>
                {adminQrUrl ? (
                  <div className="bg-white rounded-xl p-3 inline-block mb-3">
                    <img
                      src={adminQrUrl}
                      alt="收款码"
                      className="w-48 h-48 object-contain"
                    />
                  </div>
                ) : (
                  <div className="bg-white/10 rounded-xl p-8 mb-3 inline-block">
                    <div className="w-48 h-48 flex items-center justify-center">
                      <div className="text-center">
                        <svg className="w-12 h-12 text-white/20 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                        </svg>
                        <p className="text-white/30 text-xs">管理员未配置收款码</p>
                        <p className="text-white/20 text-xs mt-1">请联系管理员设置{methodLabel}收款码</p>
                      </div>
                    </div>
                  </div>
                )}
                <p className="text-[#d4af37] text-lg font-bold">
                  ¥{order.priceCny.toFixed(2)}
                </p>
                <p className="text-white/40 text-xs mt-1">
                  {methodIcon} {methodLabel} · {order.amount}积分
                </p>
                {note && (
                  <p className="text-white/30 text-xs mt-2 bg-white/5 rounded-lg py-1.5 px-3 inline-block">
                    💡 {note}
                  </p>
                )}
              </div>

              {/* Confirm paid button */}
              <button
                onClick={handleConfirmPaid}
                disabled={confirming}
                className={`w-full py-4 rounded-xl text-lg font-bold transition-all ${
                  confirming
                    ? 'bg-white/10 text-white/30 cursor-not-allowed'
                    : 'bg-emerald-500 text-white hover:bg-emerald-400 active:scale-[0.98] shadow-lg shadow-emerald-500/20'
                }`}
              >
                {confirming ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    确认中...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    我已完成付款
                  </span>
                )}
              </button>
              <p className="text-white/30 text-xs text-center">
                付款后请点击此按钮，积分将自动到账
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#30363d] bg-white/[0.02]">
          <div className="flex items-center justify-between text-xs text-white/20">
            <span className="truncate max-w-[60%]">订单号：{orderId.slice(0, 24)}...</span>
            {expiresDate && <span>有效期至：{expiresDate}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
