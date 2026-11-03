'use client';

import { useState, useEffect, use, useRef, useCallback, type ReactElement } from 'react';
import QRCode from 'qrcode';
import Link from 'next/link';
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
  balance?: number | null;
}

interface RechargeOrderViewProps {
  orderId: string;
}

export default function RechargePage({ params }: { params: Promise<{ orderId: string }> }): ReactElement {
  const { orderId } = use(params);
  return <RechargeOrderView key={orderId} orderId={orderId} />;
}

function RechargeOrderView({ orderId }: RechargeOrderViewProps): ReactElement | null {
  const [data, setData] = useState<RechargeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [payResult, setPayResult] = useState<{ balance: number | null; amount: number } | null>(null);
  const [hasGoneToPay, setHasGoneToPay] = useState(false);
  const [payQrDataUrl, setPayQrDataUrl] = useState('');
  const [submitted, setSubmitted] = useState(false); // waiting for admin approval
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lifetimeRef = useRef(0);
  const orderRequestRef = useRef(0);
  const inFlightOrderRequestRef = useRef<number | null>(null);

  const applyOrderData = useCallback((nextData: RechargeData): void => {
    const status = nextData.order.paymentStatus;
    setData(nextData);
    setPaid(status === 'paid');
    setSubmitted(status === 'submitted');
    setPayResult(status === 'paid' ? {
      balance: typeof nextData.balance === 'number' && Number.isFinite(nextData.balance) ? nextData.balance : null,
      amount: nextData.order.amount,
    } : null);
    if (status === 'submitted') setHasGoneToPay(true);
    setError(status === 'rejected' ? `审核未通过：${nextData.order.rejectReason || '请重新支付或联系客服'}` : '');
    if ((status === 'paid' || status === 'rejected') && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    lifetimeRef.current += 1;
    void fetchOrderDetails();
    try {
      const saved = sessionStorage.getItem(`recharge_pay_${orderId}`);
      if (saved === '1') setHasGoneToPay(true);
    } catch { /* ignore */ }
    return () => { lifetimeRef.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Poll order status when submitted/waiting
  useEffect(() => {
    if (submitted && !paid && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(async () => {
        // A background tick must not supersede an unfinished current read.
        if (inFlightOrderRequestRef.current !== null) return;
        const lifetime = lifetimeRef.current;
        const request = ++orderRequestRef.current;
        inFlightOrderRequestRef.current = request;
        try {
          const res = await fetch(`/api/recharge/${orderId}`, { cache: 'no-store' });
          const json = await res.json();
          if (lifetime !== lifetimeRef.current || request !== orderRequestRef.current) return;
          if (json.success) {
            applyOrderData(json);
          }
        } catch { /* ignore poll errors */ } finally {
          if (lifetime === lifetimeRef.current && inFlightOrderRequestRef.current === request) {
            inFlightOrderRequestRef.current = null;
          }
        }
      }, 5000);
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [submitted, paid, orderId, applyOrderData]);

  useEffect(() => {
    let active = true;
    setPayQrDataUrl('');
    if (!data?.payLink) return;
    QRCode.toDataURL(data.payLink, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then((dataUrl: string) => {
      if (active) setPayQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setPayQrDataUrl('');
    });
    return () => { active = false; };
  }, [data?.payLink]);

  async function fetchOrderDetails(): Promise<void> {
    const lifetime = lifetimeRef.current;
    const request = ++orderRequestRef.current;
    inFlightOrderRequestRef.current = request;
    const isCurrent = (): boolean => lifetime === lifetimeRef.current && request === orderRequestRef.current;
    try {
      const res = await fetch(`/api/recharge/${orderId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!isCurrent()) return;
      if (!json.success) {
        setError(json.error || '获取订单信息失败');
      } else {
        applyOrderData(json);
      }
    } catch {
      if (isCurrent()) setError('网络错误，请刷新重试');
    } finally {
      if (isCurrent()) {
        if (inFlightOrderRequestRef.current === request) inFlightOrderRequestRef.current = null;
        setLoading(false);
      }
    }
  }

  function handlePayClick(): void {
    try { sessionStorage.setItem(`recharge_pay_${orderId}`, '1'); } catch { /* ignore */ }
    setHasGoneToPay(true);
  }

  // User notifies admin: they paid, now waiting for verification
  async function handleNotifyPaid(): Promise<void> {
    if (submitting || submitted || paid) return;
    const lifetime = lifetimeRef.current;
    const isCurrent = (): boolean => lifetime === lifetimeRef.current;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm-paid', orderId }),
      });
      const json = await res.json();
      if (!isCurrent()) return;
      if (json.success) {
        if (json.alreadyPaid === true) {
          await fetchOrderDetails();
        } else {
          setSubmitted(true);
          setData(prev => prev ? { ...prev, order: { ...prev.order, paymentStatus: 'submitted' } } : prev);
        }
      } else {
        setError(json.error || '提交失败，请重试');
      }
    } catch {
      if (isCurrent()) setError('网络错误，请重试');
    } finally {
      if (isCurrent()) setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="h-dvh min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#0d1117] flex items-start justify-center">
        <div className="my-auto text-center">
          <div className="w-10 h-10 border-3 border-[#d4af37]/30 border-t-[#d4af37] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="h-dvh min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#0d1117] flex items-start justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 my-auto min-w-0 shrink-0 [overflow-wrap:anywhere] max-w-md w-full text-center">
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
      <div className="h-dvh min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#0d1117] flex items-start justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 my-auto min-w-0 shrink-0 [overflow-wrap:anywhere] max-w-md w-full text-center">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-white text-xl font-bold mb-2">充值成功！</h2>
          <p className="text-[#d4af37] text-2xl font-bold mb-1">{payResult?.amount || order.amount} 积分</p>
          <p className="text-white/50 text-sm mb-6">已审核通过并到账，可在无界AI工作台查看余额</p>
          <div className="bg-white/5 rounded-xl p-4 mb-4">
            <p className="text-white/60 text-xs mb-1">当前余额</p>
            <p className="text-white text-lg font-semibold">{payResult?.balance ?? '--'} 积分</p>
          </div>
          <p className="text-white/60 text-xs">您可以关闭此页面</p>
        </div>
      </div>
    );
  }

  // Waiting for admin approval state
  if (submitted) {
    return (
      <div className="h-dvh min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#0d1117] flex items-start justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 my-auto min-w-0 shrink-0 [overflow-wrap:anywhere] max-w-md w-full text-center">
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
              <span className="text-white/60">订单金额</span>
              <span className="text-white font-semibold">¥{order.priceCny.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-white/60">到账积分</span>
              <span className="text-[#d4af37] font-semibold">{order.amount} 积分{order.bonus > 0 && ` (+${order.bonus}赠)`}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/60">支付方式</span>
              <span className="text-white/80">{methodIcon} {methodLabel}</span>
            </div>
          </div>
          <button
            onClick={fetchOrderDetails}
            className="w-full py-3 rounded-xl bg-white/10 text-white/70 text-sm hover:bg-white/15 transition-all"
          >
            刷新状态
          </button>
          <p className="text-white/60 text-xs mt-4">如有问题请联系客服处理</p>
        </div>
      </div>
    );
  }

  // Rejected state
  if (order.paymentStatus === 'rejected') {
    return (
      <div className="h-dvh min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#0d1117] flex items-start justify-center p-6">
        <div className="bg-[#1c2128] border border-red-500/30 rounded-2xl p-8 my-auto min-w-0 shrink-0 [overflow-wrap:anywhere] max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-white text-xl font-bold mb-2">审核未通过</h2>
          <p className="text-white/60 text-sm mb-6">{order.rejectReason || '未收到对应款项，请确认支付成功后重新提交'}</p>
          <Link
            href="/?view=dashboard"
            prefetch={false}
            className="block w-full py-3.5 rounded-xl text-center text-base font-bold text-black transition-all hover:opacity-90"
            style={{ backgroundColor: methodColor }}
          >
            返回工作台重新充值
          </Link>
        </div>
      </div>
    );
  }

  if (order.isExpired) {
    return (
      <div className="h-dvh min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#0d1117] flex items-start justify-center p-6">
        <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-8 my-auto min-w-0 shrink-0 [overflow-wrap:anywhere] max-w-md w-full text-center">
          <div className="text-4xl mb-4">&#9203;</div>
          <h2 className="text-white text-lg font-semibold mb-2">订单已过期</h2>
          <p className="text-white/60 text-sm">该充值订单已超时，请返回无界AI重新发起充值</p>
          {expiresDate && <p className="text-white/60 text-xs mt-2">过期时间：{expiresDate}</p>}
        </div>
      </div>
    );
  }

  const showError = error && data;

  return (
    <div className="h-dvh min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#0d1117] flex items-start justify-center p-4">
      <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl my-auto min-w-0 shrink-0 [overflow-wrap:anywhere] max-w-md w-full overflow-hidden">
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
              <p className="text-white/60 text-xs">扫码转账，审核到账</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          {/* Order info */}
          <div className="bg-white/5 rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-white/60 text-xs mb-1">充值金额</p>
                <p className="text-[#d4af37] text-3xl font-bold">
                  ¥{order.priceCny.toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-white/60 text-xs mb-1">获得积分</p>
                <p className="text-white text-2xl font-bold">
                  {order.amount}
                  {order.bonus > 0 && (
                    <span className="text-emerald-400 text-sm ml-1">+{order.bonus}赠</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-[#d4af37]/20 text-amber-200 px-2 py-0.5 rounded-full">
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
              <p className="text-white/50 text-xs">使用{methodLabel}{isWechat ? '' : '支付'}</p>
              <p className="text-white text-lg font-bold">¥{order.priceCny.toFixed(2)}</p>
            </div>
          </div>

          {!hasGoneToPay ? (
            <div className="space-y-4">
              {payLink ? (
                <a
                  href={payLink}
                  onClick={handlePayClick}
                  className="block w-full py-4 rounded-xl text-lg font-bold transition-all text-black text-center hover:opacity-90 active:scale-[0.98] shadow-lg no-underline"
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
                  <p className="text-white/60 text-xs mb-3">
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
                className="block w-full py-3.5 rounded-xl text-base font-bold transition-all text-black text-center hover:opacity-90 active:scale-[0.98] no-underline"
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
                    : 'bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.98] shadow-lg shadow-amber-500/20'
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
                  <p className="text-white/60 text-xs mb-2">
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
            <p className="text-white/60 text-xs text-center mt-3">
              点击后将打开{methodLabel}完成付款
            </p>
          )}

          {hasGoneToPay && (
            <p className="text-white/60 text-xs text-center mt-3">
              付款完成后点击“我已完成付款”，管理员审核通过后积分将到账
            </p>
          )}

          {note && (
            <div className="bg-white/5 rounded-lg py-2 px-3 text-center mt-4">
              <p className="text-white/60 text-xs">💡 {note}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#30363d] bg-white/[0.02]">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-white/60">
            <span className="min-w-0 max-w-full break-all">订单号：{orderId.slice(0, 24)}...</span>
            {expiresDate && <span>有效期至：{expiresDate}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
