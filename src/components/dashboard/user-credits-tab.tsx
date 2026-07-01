'use client';

import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  Coins, ArrowUpRight, ArrowDownRight, Gift, Clock,
  TrendingUp, Zap, History, RefreshCw, CreditCard,
  X, CheckCircle, AlertCircle, QrCode, Smartphone
} from 'lucide-react';
import { RECHARGE_PACKAGES, CREDITS_TO_CNY } from '@/lib/credits-constants';

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

interface PaymentStatus {
  canRecharge: boolean;
  methods: string[];
  qrUrls: { wechat: string; alipay: string };
  note: string;
  status: { wechat: boolean; alipay: boolean };
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

  // 充值相关状态
  const [showRecharge, setShowRecharge] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [isCustomAmount, setIsCustomAmount] = useState(false);
  const [customAmount, setCustomAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const [orderInfo, setOrderInfo] = useState<{
    orderId: string;
    amount: number;
    priceCny: number;
    bonusCredits: number;
    paymentMethod: string;
    note: string;
    payLink?: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [orderQuerying, setOrderQuerying] = useState(false);

  // 程序化生成的QR码data URL
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const loadCredits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/credits');
      const data = await res.json();
      if (data.success) {
        const c = data.credits || {};
        setBalance(c.balance || 0);
        setTotalEarned(c.totalRecharged || 0);
        setTotalSpent(c.totalUsed || 0);
        const txRes = await fetch('/api/credits?action=transactions');
        const txData = await txRes.json();
        if (txData.success) {
          setTransactions((txData.transactions || []).map((t: Record<string, unknown>) => ({
            id: t.id as string,
            type: t.type as CreditTransaction['type'],
            amount: t.amount as number,
            balance_after: (t.balanceAfter || t.balance_after || 0) as number,
            description: (t.description || '') as string,
            created_at: (t.createdAt || t.created_at || '') as string,
          })));
        }
      }
    } catch (err) {
      console.error('Failed to load credits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPaymentStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/credits/payment-status');
      const data = await res.json();
      if (data.success) {
        setPaymentStatus(data as PaymentStatus);
        if (data.methods?.includes('wechat')) setPaymentMethod('wechat');
        else if (data.methods?.includes('alipay')) setPaymentMethod('alipay');
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadCredits(); loadPaymentStatus(); }, [loadCredits, loadPaymentStatus]);

  // 当订单创建后，生成程序化QR码
  useEffect(() => {
    if (!orderInfo?.orderId) {
      setQrDataUrl('');
      return;
    }
    const domain = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_COZE_PROJECT_DOMAIN_DEFAULT || window.location.origin)
      : '';
    const rechargeUrl = `${domain}/recharge/${orderInfo.orderId}`;
    QRCode.toDataURL(rechargeUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then(setQrDataUrl).catch(err => {
      console.error('QR generation error:', err);
      setQrDataUrl('');
    });
  }, [orderInfo?.orderId]);

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

  // 获取当前支付链接
  const getCurrentPayLink = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/credits/payment-status');
      const data = await res.json();
      if (data.success && data.payLinks) {
        return paymentMethod === 'wechat'
          ? data.payLinks.wechat || null
          : data.payLinks.alipay || null;
      }
    } catch (err) {
      console.error('Get pay link error:', err);
    }
    return null;
  };

  // 创建充值订单并直接支付
  const handleCreateOrder = async () => {
    const rechargeAmount = isCustomAmount ? customAmount : selectedPackage;
    if (!rechargeAmount || rechargeAmount <= 0) {
      onToast?.('请选择充值套餐或输入自定义金额');
      return;
    }
    if (isCustomAmount && rechargeAmount < 10) {
      onToast?.('自定义金额最少10积分');
      return;
    }

    try {
      setConfirming(true);
      // 先获取支付链接
      const payLink = await getCurrentPayLink();

      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-order',
          amount: rechargeAmount,
          paymentMethod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOrderInfo({
          orderId: data.orderId,
          amount: data.amount,
          priceCny: data.priceCny,
          bonusCredits: data.bonusCredits,
          paymentMethod: data.paymentMethod || paymentMethod,
          note: data.note,
          payLink: payLink || undefined,
        });
        onToast?.('订单创建成功，请点击立即支付');
      } else {
        onToast?.(data.error || '创建订单失败');
      }
    } catch (err) {
      console.error('Create order error:', err);
      onToast?.('创建订单失败，请稍后重试');
    } finally {
      setConfirming(false);
    }
  };

  // 立即支付 - 直接打开微信/支付宝
  const handlePayNow = () => {
    if (!orderInfo?.payLink) {
      onToast?.('支付链接未配置，请联系管理员');
      return;
    }
    // Directly redirect to payment (mobile browser)
    // Use <a> click for better mobile protocol handling (wxp://, https://qr.alipay.com/)
    const a = document.createElement('a');
    a.href = orderInfo.payLink;
    a.click();
  };

  // 确认已付款
  const handleConfirmPaid = async () => {
    if (!orderInfo) return;
    try {
      setConfirming(true);
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm-paid',
          orderId: orderInfo.orderId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onToast?.('已提交付款确认，请等待管理员审核（通常几分钟内到账）');
        // 不关闭弹窗，让用户看到待审核状态，可点击查询状态
        loadCredits();
      } else {
        onToast?.(data.error || '提交失败');
      }
    } catch (err) {
      console.error('Confirm paid error:', err);
      onToast?.('确认付款失败，请稍后重试');
    } finally {
      setConfirming(false);
    }
  };

;

  // 查询订单状态
  const handleQueryOrder = async () => {
    if (!orderInfo) return;
    try {
      setOrderQuerying(true);
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query-order',
          orderId: orderInfo.orderId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const order = data.order;
        if (order?.paymentStatus === 'paid' || order?.status === 'paid') {
          onToast?.('订单已确认，积分已到账');
          setOrderInfo(null);
          setShowRecharge(false);
          setSelectedPackage(null);
          loadCredits();
        } else if (order?.paymentStatus === 'submitted' || order?.status === 'submitted') {
          onToast?.('订单正在等待管理员审核，请耐心等待');
        } else if (order?.paymentStatus === 'rejected' || order?.status === 'rejected') {
          const reason = order?.rejectReason || order?.admin_note || '支付未确认';
          onToast?.(`订单已被驳回：${reason}`);
        } else {
          onToast?.('订单尚未提交，请在手机页面点击"我已完成付款"');
        }
      }
    } catch {
      onToast?.('查询订单失败');
    } finally {
      setOrderQuerying(false);
    }
  };

  const cardBg = 'bg-card border border-border/50 rounded-lg';
  const inputBg = 'bg-background border border-border rounded-md';

  return (
    <div className="space-y-5 p-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">我的积分</h1>
          <p className="text-sm text-muted-foreground mt-0.5">查看积分余额、充值和使用记录</p>
        </div>
        <div className="flex items-center gap-2">
          {paymentStatus?.canRecharge && (
            <button
              onClick={() => setShowRecharge(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              充值
            </button>
          )}
          <button
            onClick={loadCredits}
            disabled={loading}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${inputBg} text-muted-foreground hover:text-foreground transition-colors`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
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

      {/* ===== 充值弹窗 ===== */}
      {showRecharge && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-lg mx-4 ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'} rounded-xl shadow-2xl border border-border/50 overflow-hidden`}>
            {/* 弹窗头 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                积分充值
              </h2>
              <button
                onClick={() => { setShowRecharge(false); setOrderInfo(null); setSelectedPackage(null); setIsCustomAmount(false); setCustomAmount(0); setQrDataUrl(''); }}
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* 订单已创建 - 扫码支付 */}
              {orderInfo ? (
                <div className="space-y-4">
                  <div className="text-center">
                    <CheckCircle className="w-12 h-12 text-primary mx-auto mb-2" />
                    <h3 className="text-base font-semibold text-foreground">扫码完成支付</h3>
                    <p className="text-xs text-muted-foreground mt-1">请用手机扫描下方二维码，在充值页面完成付款</p>
                  </div>

                  <div className={`${cardBg} p-4 space-y-3`}>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">充值积分</span>
                      <span className="text-foreground font-medium">{orderInfo.amount.toLocaleString()} 积分</span>
                    </div>
                    {orderInfo.bonusCredits > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">赠送积分</span>
                        <span className="text-green-500 font-medium">+{orderInfo.bonusCredits.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">支付方式</span>
                      <span className="text-foreground font-medium">{orderInfo.paymentMethod === 'wechat' ? '微信支付' : '支付宝'}</span>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t border-border/30">
                      <span className="text-muted-foreground">需付款</span>
                      <span className="text-primary font-bold text-lg">¥{orderInfo.priceCny.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* QR码 - 主展示区 */}
                  {qrDataUrl && (
                    <div className="text-center">
                      <div className="inline-block p-3 bg-white rounded-xl">
                        <img
                          src={qrDataUrl}
                          alt="充值二维码"
                          className="w-48 h-48 object-contain"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        打开{orderInfo.paymentMethod === 'wechat' ? '微信' : '支付宝'}扫一扫，扫描此二维码
                      </p>
                    </div>
                  )}

                  {/* 没有QR码时的提示 */}
                  {!qrDataUrl && (
                    <div className={`${cardBg} p-3 rounded-lg text-center`}>
                      <p className="text-sm text-muted-foreground">二维码生成中，请稍候...</p>
                    </div>
                  )}

                  {/* 备选：直接打开支付链接（手机端场景） */}
                  {orderInfo.payLink && (
                    <div className="text-center">
                      <a
                        href={orderInfo.payLink}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors underline underline-offset-2 inline-flex items-center gap-1"
                      >
                        <Smartphone className="w-3 h-3" />
                        在手机上？直接打开{orderInfo.paymentMethod === 'wechat' ? '微信' : '支付宝'}支付
                      </a>
                    </div>
                  )}

                  {/* 我已完成付款 */}
                  <div className="pt-2 space-y-2">
                    <button
                      onClick={handleConfirmPaid}
                      disabled={confirming}
                      className="w-full py-2.5 rounded-lg text-sm font-medium bg-muted border border-border/30 text-foreground hover:bg-muted/80 transition-colors"
                    >
                      {confirming ? '确认中...' : '我已完成付款'}
                    </button>
                    <button
                      onClick={handleQueryOrder}
                      disabled={orderQuerying}
                      className="w-full py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {orderQuerying ? '查询中...' : '查询订单状态'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* 选择套餐 */}
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-3">选择充值套餐</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {RECHARGE_PACKAGES.map((pkg) => (
                        <button
                          key={pkg.amount}
                          onClick={() => { setSelectedPackage(pkg.amount); setIsCustomAmount(false); }}
                          className={`relative text-left p-3.5 rounded-lg border transition-all ${
                            selectedPackage === pkg.amount && !isCustomAmount
                              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                              : `${inputBg} hover:border-primary/40`
                          }`}
                        >
                          {pkg.popular && (
                            <span className="absolute -top-2 right-2 px-2 py-0.5 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
                              热门
                            </span>
                          )}
                          <div className="text-base font-bold text-foreground">{pkg.amount.toLocaleString()}</div>
                          {pkg.bonus > 0 && (
                            <div className="text-xs text-green-500 mt-0.5">+赠送 {pkg.bonus.toLocaleString()}</div>
                          )}
                          <div className="text-sm text-primary font-semibold mt-1">¥{pkg.price}</div>
                          <div className="text-[10px] text-muted-foreground">
                            约{(pkg.amount * CREDITS_TO_CNY / pkg.price * 100).toFixed(0)}积分/元
                          </div>
                        </button>
                      ))}
                      {/* 自定义金额选项 */}
                      <button
                        onClick={() => { setIsCustomAmount(true); setSelectedPackage(null); }}
                        className={`relative text-left p-3.5 rounded-lg border transition-all ${
                          isCustomAmount
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                            : `${inputBg} hover:border-primary/40`
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-base font-bold text-foreground">
                          <Coins className="w-4 h-4 text-primary" />
                          自定义
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">输入任意金额</div>
                        <div className="text-sm text-primary font-semibold mt-1">自定义</div>
                        <div className="text-[10px] text-muted-foreground">
                          最低10积分起
                        </div>
                      </button>
                    </div>

                    {/* 自定义金额输入框 */}
                    {isCustomAmount && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={10}
                            step={10}
                            value={customAmount || ''}
                            onChange={(e) => setCustomAmount(Math.max(0, parseInt(e.target.value) || 0))}
                            placeholder="输入积分数量"
                            className={`flex-1 px-3 py-2.5 rounded-lg text-sm ${inputBg} text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          />
                          <span className="text-sm text-muted-foreground whitespace-nowrap">积分</span>
                        </div>
                        {customAmount > 0 && (
                          <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
                            <span>需付款</span>
                            <span className="text-primary font-semibold">¥{(customAmount * CREDITS_TO_CNY).toFixed(2)}</span>
                          </div>
                        )}
                        {/* 快捷金额 */}
                        <div className="flex gap-2">
                          {[100, 200, 500, 1000, 2000, 5000].map(val => (
                            <button
                              key={val}
                              onClick={() => setCustomAmount(val)}
                              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                                customAmount === val
                                  ? 'bg-primary/10 text-primary border border-primary/30'
                                  : `${inputBg} text-muted-foreground hover:text-foreground`
                              }`}
                            >
                              {val}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 支付方式 */}
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-3">支付方式</h3>
                    <div className="flex gap-3">
                      {paymentStatus?.status?.wechat && (
                        <button
                          onClick={() => setPaymentMethod('wechat')}
                          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border transition-all ${
                            paymentMethod === 'wechat'
                              ? 'border-green-500 bg-green-500/5 ring-1 ring-green-500/30'
                              : `${inputBg} hover:border-green-500/40`
                          }`}
                        >
                          <Smartphone className="w-4 h-4 text-green-500" />
                          <span className="text-sm font-medium text-foreground">微信支付</span>
                        </button>
                      )}
                      {paymentStatus?.status?.alipay && (
                        <button
                          onClick={() => setPaymentMethod('alipay')}
                          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border transition-all ${
                            paymentMethod === 'alipay'
                              ? 'border-blue-500 bg-blue-500/5 ring-1 ring-blue-500/30'
                              : `${inputBg} hover:border-blue-500/40`
                          }`}
                        >
                          <QrCode className="w-4 h-4 text-blue-500" />
                          <span className="text-sm font-medium text-foreground">支付宝</span>
                        </button>
                      )}
                    </div>
                    {!paymentStatus?.canRecharge && (
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <AlertCircle className="w-3.5 h-3.5" />
                        收款码暂未配置，请联系管理员
                      </div>
                    )}
                  </div>

                  {/* 充值流程说明 */}
                  <div className={`${cardBg} p-3`}>
                    <p className="text-xs text-muted-foreground mb-2 font-medium">充值流程</p>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                      <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">1</span>
                      <span>选择套餐</span>
                      <span className="mx-1">→</span>
                      <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">2</span>
                      <span>扫码进入充值页</span>
                      <span className="mx-1">→</span>
                      <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">3</span>
                      <span>点击付款</span>
                      <span className="mx-1">→</span>
                      <span className="bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded">✓</span>
                      <span>积分到账</span>
                    </div>
                  </div>

                  {/* 订单预览 */}
                  {(selectedPackage || (isCustomAmount && customAmount >= 10)) && (
                    <div className={`${cardBg} p-4`}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">充值套餐</span>
                        <span className="text-foreground">
                          {isCustomAmount
                            ? `自定义 ${customAmount.toLocaleString()} 积分`
                            : RECHARGE_PACKAGES.find(p => p.amount === selectedPackage)?.label}
                        </span>
                      </div>
                      {(() => {
                        if (isCustomAmount) return null;
                        const pkg = RECHARGE_PACKAGES.find(p => p.amount === selectedPackage);
                        return pkg?.bonus ? (
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-muted-foreground">赠送积分</span>
                            <span className="text-green-500">+{pkg.bonus.toLocaleString()}</span>
                          </div>
                        ) : null;
                      })()}
                      <div className="flex justify-between text-sm pt-2 border-t border-border/30 mt-2">
                        <span className="text-muted-foreground">需付款</span>
                        <span className="text-primary font-bold">
                          ¥{isCustomAmount
                            ? (customAmount * CREDITS_TO_CNY).toFixed(2)
                            : RECHARGE_PACKAGES.find(p => p.amount === selectedPackage)?.price.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* 提交按钮 */}
                  <button
                    onClick={handleCreateOrder}
                    disabled={(!selectedPackage && !(isCustomAmount && customAmount >= 10)) || !paymentStatus?.canRecharge || confirming}
                    className="w-full py-3 rounded-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {confirming ? '创建订单中...' : (selectedPackage || (isCustomAmount && customAmount >= 10))
                      ? `立即充值 ¥${isCustomAmount
                          ? (customAmount * CREDITS_TO_CNY).toFixed(2)
                          : RECHARGE_PACKAGES.find(p => p.amount === selectedPackage)?.price.toFixed(2)}`
                      : '请选择充值套餐'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
                : `${inputBg} text-muted-foreground hover:text-foreground`
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
      <div className={`${cardBg} overflow-hidden`}>
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
