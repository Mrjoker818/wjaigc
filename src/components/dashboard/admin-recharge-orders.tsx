'use client';

import { useState, useCallback, useEffect, useRef, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Check, X, RefreshCw, Clock, Ban, CheckCircle2 } from 'lucide-react';
import { formatPaymentTimestamp } from '@/lib/payment-order-time';

interface RechargeOrder {
  orderId: string;
  userId: string;
  username: string;
  amount: number;
  credits: number;
  paymentMethod: string;
  status: 'pending' | 'submitted' | 'paid' | 'cancelled' | 'rejected';
  createdAt?: unknown;
  paidAt?: unknown;
  remark?: string;
  screenshotUrl?: string;
}

export function AdminRechargeOrders(): JSX.Element {
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'submitted' | 'paid' | 'all' | 'rejected'>('submitted');
  const readVersionRef = useRef(0);

  const loadOrders = useCallback(async (): Promise<void> => {
    const version = ++readVersionRef.current;
    setLoading(true);
    setLoadError('');
    let failure = '获取订单列表失败，请重新读取。';
    try {
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-all-orders' }),
      });
      if (!res.ok) { failure = `获取订单列表失败（HTTP ${res.status}），请重新读取。`; throw new Error('ORDER_READ_HTTP'); }
      failure = '订单数据格式异常，请重新读取。';
      const data = await res.json();
      if (version !== readVersionRef.current) return;
      if (!data?.success) { failure = typeof data?.error === 'string' ? data.error : failure; throw new Error('ORDER_READ_FAILED'); }
      if (!Array.isArray(data.orders)) throw new Error('ORDER_READ_FORMAT');
      setLoadError('');
      setOrders(data.orders);
    } catch {
      if (version === readVersionRef.current) setLoadError(failure);
    } finally {
      if (version === readVersionRef.current) setLoading(false);
    }
  }, []);

  useEffect((): (() => void) => {
    void loadOrders();
    return (): void => { readVersionRef.current += 1; };
  }, [loadOrders]);

  const handleConfirm = async (orderId: string) => {
    if (!confirm('确认已收到这笔付款？确认后将立即为用户充值积分，此操作不可撤销。')) return;
    setProcessingId(orderId);
    try {
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-confirm-paid', orderId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`已确认收款，积分已到账`);
        loadOrders();
      } else {
        toast.error(data.error || '确认失败');
      }
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (orderId: string, presetReason = '') => {
    const reason = presetReason || prompt('请输入驳回原因（例如：未收到款项、金额不符等）') || '';
    if (!reason) return;
    setProcessingId(orderId);
    try {
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-reject', orderId, reason }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('订单已驳回');
        loadOrders();
      } else {
        toast.error(data.error || '驳回失败');
      }
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setProcessingId(null);
    }
  };

  const filteredOrders = orders.filter(o => filter === 'all' || o.status === filter);
  const pendingCount = orders.filter(o => o.status === 'submitted').length;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="outline" className="text-gray-400"><Clock className="w-3 h-3 mr-1" />待支付</Badge>;
      case 'submitted': return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" />待审核 ({pendingCount})</Badge>;
      case 'paid': return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />已到账</Badge>;
      case 'rejected': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><Ban className="w-3 h-3 mr-1" />已驳回</Badge>;
      case 'cancelled': return <Badge variant="outline" className="text-gray-500"><X className="w-3 h-3 mr-1" />已取消</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getMethodLabel = (m: string) => {
    switch (m) {
      case 'wechat': return '微信支付';
      case 'alipay': return '支付宝';
      default: return m;
    }
  };

  return (
    <div className="min-w-0 space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-52">
          <h3 className="text-lg font-semibold text-foreground">充值订单审核</h3>
          <p className="text-sm text-muted-foreground mt-1">用户提交付款后需管理员确认到账，积分才会真正充值</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadOrders} disabled={loading} className="min-h-11 min-w-11 shrink-0">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />刷新
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['submitted', 'pending', 'paid', 'rejected', 'all'] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            aria-pressed={filter === f}
            size="sm"
            className="min-h-11 min-w-11"
            onClick={() => setFilter(f)}
          >
            {f === 'submitted' ? `待审核 (${pendingCount})` :
              f === 'pending' ? '待支付' :
                f === 'paid' ? '已到账' :
                  f === 'rejected' ? '已驳回' : '全部'}
          </Button>
        ))}
      </div>

      {loading ? (
        <div role="status" aria-label="订单加载状态" className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />加载订单中...
        </div>
      ) : loadError ? (
        <div role="alert" aria-label="订单读取失败" className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 p-4 text-sm">
          <p className="min-w-0 flex-1 basis-48 [overflow-wrap:anywhere]">{loadError}</p>
          <Button variant="outline" onClick={loadOrders} className="min-h-11 min-w-11">重新读取订单</Button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {filter === 'submitted' ? '暂无待审核订单' : '暂无订单记录'}
        </div>
      ) : (
        <div className="min-w-0 max-w-full md:overflow-x-auto">
          <table className="block w-full text-sm md:table">
            <thead className="hidden bg-muted/50 md:table-header-group">
              <tr>
                <th className="text-left p-3 font-medium">订单信息</th>
                <th className="text-left p-3 font-medium">用户</th>
                <th className="text-left p-3 font-medium">金额/积分</th>
                <th className="text-left p-3 font-medium">方式</th>
                <th className="text-left p-3 font-medium">状态</th>
                <th className="text-left p-3 font-medium">时间</th>
                <th className="text-right p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="grid min-w-0 gap-3 md:table-row-group">
              {filteredOrders.map(order => (
                <tr key={order.orderId} className="grid min-w-0 grid-cols-2 gap-3 rounded-lg border p-3 hover:bg-muted/30 md:table-row md:border-x-0 md:border-b-0 md:p-0">
                  <td className="col-span-2 min-w-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere] md:p-3">
                    <span className="mb-1 block font-sans text-muted-foreground md:hidden">订单信息</span>
                    {order.orderId}
                  </td>
                  <td className="col-span-2 min-w-0 [overflow-wrap:anywhere] md:p-3">
                    <span className="mb-1 block text-xs text-muted-foreground md:hidden">用户</span>
                    <div>{order.username}</div>
                  </td>
                  <td className="min-w-0 md:p-3">
                    <span className="mb-1 block text-xs text-muted-foreground md:hidden">金额 / 积分</span>
                    <div className="whitespace-nowrap font-semibold tabular-nums text-foreground">¥{order.amount}</div>
                    <div className="text-xs text-muted-foreground">{order.credits} 积分</div>
                  </td>
                  <td className="min-w-0 [overflow-wrap:anywhere] md:p-3">
                    <span className="mb-1 block text-xs text-muted-foreground md:hidden">方式</span>
                    {getMethodLabel(order.paymentMethod)}
                  </td>
                  <td className="col-span-2 min-w-0 md:p-3">
                    <span className="mb-1 block text-xs text-muted-foreground md:hidden">状态</span>
                    {getStatusBadge(order.status)}
                  </td>
                  <td className="col-span-2 min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere] md:p-3">
                    <span className="mb-1 block md:hidden">时间</span>
                    {formatPaymentTimestamp(order.createdAt)}
                  </td>
                  <td className="col-span-2 min-w-0 [overflow-wrap:anywhere] md:p-3 md:text-right">
                    {order.status === 'submitted' && (
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <Button
                          size="sm"
                          onClick={() => handleConfirm(order.orderId)}
                          disabled={processingId === order.orderId}
                          className="min-h-11 min-w-11 flex-1 bg-green-600 hover:bg-green-700 md:flex-none"
                        >
                          {processingId === order.orderId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                          确认到账
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="min-h-11 min-w-11 flex-1 md:flex-none"
                          onClick={() => handleReject(order.orderId, '')}
                          disabled={processingId === order.orderId}
                        >
                          <X className="w-4 h-4 mr-1" />驳回
                        </Button>
                      </div>
                    )}
                    {order.status === 'rejected' && order.remark && (
                      <span className="text-xs text-red-400">{order.remark}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
