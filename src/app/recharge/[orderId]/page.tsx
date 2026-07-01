'use client';

import { useState, useEffect, use, useRef } from 'react';
import QRCode from 'qrcode';
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
  rejectReason?: string;
}

interface RechargeData {
  success: boolean;
  order: OrderInfo;
  payLink: string;
  note: string;
}

export default function RechargePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const [data, setData] = useState<RechargeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [payResult, setPayResult] = useState<{ balance: number; amount: number } | null>(null);
  const [hasGoneToPay, setHasGoneToPay] = useState(false);
  const [payQrDataUrl, setPayQrDataUrl] = useState('');
  const [submitted, setSubmitted] = useState(false); // waiting for admin approval
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchOrderDetails();
    try {
      const saved = sessionStorage.getItem(`recharge_pay_${orderId}`);
      if (saved === '1') setHasGoneToPay(true);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Poll order status when submitted/waiting
  useEffect(() => {
    if (submitted && !paid && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/recharge/${orderId}`, { cache: 'no-store' });
          const json = await res.json();
          if (json.success) {
            setData(json);
            if (json.order?.paymentStatus === 'paid') {
              setPaid(true);
              setPayResult({ balance: json.balance || 0, amount: json.order.amount });
              if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
              }
            } else if (json.order?.paymentStatus === 'rejected') {
              setSubmitted(false);
              setError(`审核未通过：${json.order.rejectReason || '请重新支付或联系客服'}`);
              if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
              }
            }
          }
        } catch { /* ignore poll errors */ }
      }, 5000);
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [submitted, paid, orderId]);

  useEffect(() => {
    if (!data?.payLink) {
      setPayQrDataUrl('');
      return;
    }
    QRCode.toDataURL(data.payLink, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then(setPayQrDataUrl).catch(() => setPayQrDataUrl(''));
  }, [data?.payLink]);

  async function fetchOrderDetails() {
    try {
      const res = await fetch(`/api/recharge/${orderId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || '获取订单信息失败');
      } else {
        setData(json);
        if (json.order?.paymentStatus === 'paid') {
          setPaid(true);
          setPayResult({ balance: json.balance || 0, amount: json.order.amount });
        } else if (json.order?.paymentStatus === 'submitted') {
          setSubmitted(true);
          setHasGoneToPay(true);
        }
      }
    } catch {
      setError('网络错误，请刷新重试');
    } finally {
      setLoading(false);
    }
  }

  function handlePayClick() {
    try { sessionStorage.setItem(`recharge_pay_${orderId}`, '1'); } catch { /* ignore */ }
    setHasGoneToPay(true);
  }

  // User notifies admin: they paid, now waiting for verification
  async function handleNotifyPaid() {
    if (submitting || submitted || paid) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm-paid', orderId }),
      });
      const json = await res.json();
      if (json.success) {
        setSubmitted(true);
        setData(prev => prev ? { ...prev, order: { ...prev.order, paymentStatus: 'submitted' } } : prev);
      } else {
        setError(json.error || '提交失败，请重试');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  }

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

  const { order, note, payLink } = data;
  const pkg = RECHARGE_PACKAGES.find(p => p.amount + p.bonus === order.amount || p.amount === order.amount - order.bonus);
  const isCustomPkg = !pkg;
  const isWechat = order.paymentMethod === 'wechat';
  const methodLabel = isWechat ? '微信支付' : '支付宝';
  const methodIcon = isWechat ? '💚' : '💙';
  const methodColor = isWechat ? '#07C160' : '#1677FF';
  const expiresDate = order.expiresAt > 0 ? new Date(order.expiresAt).toLocaleString('zh-CN') : '';

  // Success state (admin approved)
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
          <p className="text-white/50 text-sm mb-6">已审核通过并到账，可在无界AI工作台查看余额</p>
          <div className="bg-white/5 rounded-xl p-4 mb-4">
            <p className="text-white/40 text-xs mb-1">当前余额</p>
            <p className="text-white text-lg font-semibold">{payResult?.balance || '--'} 积分</p>
          </div>
          <p className="text-white/30 text-xs">您可以关闭此页面</p>
        </div>
      </div>
    );
  }

  // Waiting for admin approval state
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-3 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          </div>
          <h2 className="text-white text-xl font-bold mb-2">等待审核</h2>
          <p className="text-white/60 text-sm mb-6">
            您的付款通知已提交，管理员将在确认收款后为您充值积分，通常1-10分钟内处理完成。
            <br />请保持此页面打开，到账后将自动提示。
          </p>
          <div className="bg-white/5 rounded-xl p-4 mb-4 text-left">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-white/40">订单金额</span>
              <span className="text-white font-semibold">¥{order.priceCny.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-white/40">到账积分</span>
              <span className="text-[#d4af37] font-semibold">{order.amount} 积分{order.bonus > 0 && ` (+${order.bonus}赠)`}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/40">支付方式</span>
              <span className="text-white/80">{methodIcon} {methodLabel}</span>
            </div>
          </div>
          <button
            onClick={fetchOrderDetails}
            className="w-full py-3 rounded-xl bg-white/10 text-white/70 text-sm hover:bg-white/15 transition-all"
          >
            刷新状态
          </button>
          <p className="text-white/25 text-xs mt-4">如有问题请联系客服处理</p>
        </div>
      </div>
    );
  }

  // Rejected state
  if (order.paymentStatus === 'rejected') {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
        <div className="bg-[#1c2128] border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-white text-xl font-bold mb-2">审核未通过</h2>
          <p className="text-white/60 text-sm mb-6">{order.rejectReason || '未收到对应款项，请确认支付成功后重新提交'}</p>
          <button
            onClick={() => { setSubmitted(false); setHasGoneToPay(false); setError(''); }}
            className="w-full py-3.5 rounded-xl text-base font-bold text-white transition-all hover:opacity-90"
            style={{ backgroundColor: methodColor }}
          >
            重新支付
          </button>
        </div>
      </div>
    );
  }

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

  const showError = error && data;

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
      <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl max-w-md w-full overflow-hidden">
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
              <p className="text-white/40 text-xs">扫码转账，审核到账</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          {/* Order info */}
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
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-[#d4af37]/20 text-[#d4af37] px-2 py-0.5 rounded-full">
                {isCustomPkg ? `自定义 ${order.amount} 积分` : pkg?.label || `${order.amount} 积分`}
              </span>
              <span className="bg-white/10 text-white/60 px-2 py-0.5 rounded-full">
                {methodIcon} {methodLabel}
              </span>
            </div>
          </div>

          {showError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4 text-center">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-center gap-3 mb-5">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: methodColor + '20' }}
            >
              <span className="text-2xl">{methodIcon}</span>
            </div>
            <div>
              <p className="text-white/50 text-xs">使用{methodLabel}支付</p>
              <p className="text-white text-lg font-bold">¥{order.priceCny.toFixed(2)}</p>
            </div>
          </div>

          {!hasGoneToPay ? (
            <div className="space-y-4">
              {payLink ? (
                <a
                  href={payLink}
                  onClick={handlePayClick}
                  className="block w-full py-4 rounded-xl text-lg font-bold transition-all text-white text-center hover:opacity-90 active:scale-[0.98] shadow-lg no-underline"
                  style={{ backgroundColor: methodColor, boxShadow: `0 8px 24px ${methodColor}30` }}
                >
                  立即支付 ¥{order.priceCny.toFixed(2)}
                </a>
              ) : (
                <div className="w-full py-4 rounded-xl text-center bg-white/5 text-white/40 text-lg">
                  支付链接未配置
                </div>
              )}

              {payQrDataUrl && (
                <div className="text-center">
                  <p className="text-white/30 text-xs mb-3">
                    {isWechat
                      ? '点击按钮未打开微信？长按下方二维码保存，打开微信扫一扫 → 相册选图'
                      : '点击按钮未打开支付宝？长按下方二维码保存，打开支付宝扫一扫 → 相册选图'
                    }
                  </p>
                  <div className="inline-block p-3 bg-white rounded-xl">
                    <img
                      src={payQrDataUrl}
                      alt="支付二维码"
                      className="w-44 h-44 object-contain"
                    />
                  </div>
                </div>
              )}

              {!payLink && (
                <p className="text-red-400/60 text-xs text-center">支付链接未配置，请联系管理员</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <a
                href={payLink || '#'}
                onClick={(e) => {
                  if (!payLink) { e.preventDefault(); return; }
                  handlePayClick();
                }}
                className="block w-full py-3.5 rounded-xl text-base font-bold transition-all text-white text-center hover:opacity-90 active:scale-[0.98] no-underline"
                style={{ backgroundColor: methodColor }}
              >
                重新支付 ¥{order.priceCny.toFixed(2)}
              </a>
              <button
                onClick={handleNotifyPaid}
                disabled={submitting}
                className={`w-full py-3.5 rounded-xl text-base font-bold transition-all ${
                  submitting
                    ? 'bg-white/10 text-white/30 cursor-not-allowed'
                    : 'bg-amber-500 text-white hover:bg-amber-400 active:scale-[0.98] shadow-lg shadow-amber-500/20'
                }`}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    提交中...
                  </span>
                ) : (
                  '我已完成付款'
                )}
              </button>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
                <p className="text-amber-300/80 text-xs">
                  ⚠️ 点击后将通知管理员审核，确认收款后积分会自动到账。
                  <br />请勿重复提交，恶意刷单将被封禁账号。
                </p>
              </div>

              {payQrDataUrl && (
                <div className="text-center pt-2">
                  <p className="text-white/25 text-xs mb-2">
                    {isWechat
                      ? '如未完成支付，长按二维码保存，微信扫一扫 → 相册'
                      : '如未完成支付，长按二维码保存，支付宝扫一扫 → 相册'
                    }
                  </p>
                  <div className="inline-block p-2 bg-white rounded-lg">
                    <img
                      src={payQrDataUrl}
                      alt="支付二维码"
                      className="w-32 h-32 object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {!hasGoneToPay && payLink && (
            <p className="text-white/25 text-xs text-center mt-3">
              点击后将打开{methodLabel}完成付款
            </p>
          )}

          {hasGoneToPay && (
            <p className="text-white/25 text-xs text-center mt-3">
              付款完成后点击"我已完成付款"，管理员审核通过后积分将到账
            </p>
          )}

          {note && (
            <div className="bg-white/5 rounded-lg py-2 px-3 text-center mt-4">
              <p className="text-white/40 text-xs">💡 {note}</p>
            </div>
          )}
        </div>

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
