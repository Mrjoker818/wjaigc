'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Check, X, RefreshCw, Clock, Ban, CheckCircle2 } from 'lucide-react';

interface RechargeOrder {
  orderId: string;
  userId: string;
  username: string;
  amount: number;
  credits: number;
  paymentMethod: string;
  status: 'pending' | 'submitted' | 'paid' | 'cancelled' | 'rejected';
  createdAt: number;
  paidAt?: number;
  remark?: string;
  screenshotUrl?: string;
}

export function AdminRechargeOrders() {
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'submitted' | 'paid' | 'all' | 'rejected'>('submitted');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-all-orders' }),
      });
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
      }
    } catch {
      toast.error('获取订单列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">充值订单审核</h3>
          <p className="text-sm text-muted-foreground mt-1">用户提交付款后需管理员确认到账，积分才会真正充值</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadOrders} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />刷新
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['submitted', 'pending', 'paid', 'rejected', 'all'] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === 'submitted' ? `待审核 (${pendingCount})` :
              f === 'pending' ? '待支付' :
                f === 'paid' ? '已到账' :
                  f === 'rejected' ? '已驳回' : '全部'}
          </Button>
        ))}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {filter === 'submitted' ? '暂无待审核订单' : '暂无订单记录'}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
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
            <tbody>
              {filteredOrders.map(order => (
                <tr key={order.orderId} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs text-muted-foreground">{order.orderId.slice(0, 16)}...</td>
                  <td className="p-3">{order.username}</td>
                  <td className="p-3">
                    <div className="font-semibold text-foreground">¥{order.amount}</div>
                    <div className="text-xs text-muted-foreground">{order.credits} 积分</div>
                  </td>
                  <td className="p-3">{getMethodLabel(order.paymentMethod)}</td>
                  <td className="p-3">{getStatusBadge(order.status)}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(order.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="p-3 text-right">
                    {order.status === 'submitted' && (
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          onClick={() => handleConfirm(order.orderId)}
                          disabled={processingId === order.orderId}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {processingId === order.orderId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                          确认到账
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
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
