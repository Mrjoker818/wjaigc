'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  User, Bell, Palette, Shield, Save, Check,
  Moon, Sun, Monitor, ChevronRight, Camera, Key, Lock, History, X
} from 'lucide-react';

interface UserSettingsTabProps {
  isDark: boolean;
  isMonochrome: boolean;
  onToggleTheme: (theme: 'dark' | 'light' | 'system') => void;
  userName: string;
  userRole: string;
  onToast?: (msg: string) => void;
}

export default function UserSettingsTab({
  isDark,
  isMonochrome,
  onToggleTheme,
  userName,
  userRole,
  onToast
}: UserSettingsTabProps) {
  const [notifications, setNotifications] = useState({
    taskComplete: true,
    creditsLow: true,
    systemUpdate: false,
  });
  const [autoSave, setAutoSave] = useState(true);
  const [imageQuality, setImageQuality] = useState<'standard' | 'high' | 'ultra'>('high');
  const [defaultModel, setDefaultModel] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('wujie_user_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.notifications) setNotifications(parsed.notifications);
        if (parsed.autoSave !== undefined) setAutoSave(parsed.autoSave);
        if (parsed.imageQuality) setImageQuality(parsed.imageQuality);
        if (parsed.defaultModel) setDefaultModel(parsed.defaultModel);
      }
    } catch {}
  }, []);

  const markChanged = useCallback(() => {
    if (!hasChanges) setHasChanges(true);
  }, [hasChanges]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const settings = { notifications, autoSave, imageQuality, defaultModel };
      localStorage.setItem('wujie_user_settings', JSON.stringify(settings));
      setHasChanges(false);
      onToast?.('设置已保存');
    } catch {
      onToast?.('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setNotifications({ taskComplete: true, creditsLow: true, systemUpdate: false });
    setAutoSave(true);
    setImageQuality('high');
    setDefaultModel('');
    setHasChanges(true);
  };

  const handlePasswordChange = async () => {
    if (!newPassword || newPassword.length < 6) {
      onToast?.('密码至少6位');
      return;
    }
    if (newPassword !== confirmPassword) {
      onToast?.('两次输入的密码不一致');
      return;
    }
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      if (res.ok) {
        onToast?.('密码修改成功');
        setShowPasswordDialog(false);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const d = await res.json();
        onToast?.(d.error || '密码修改失败');
      }
    } catch {
      onToast?.('请求失败');
    }
  };

  const toggleClass = (on: boolean) =>
    `relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${on ? 'bg-primary' : 'bg-muted'}`;

  const toggleDot = (on: boolean) =>
    `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`;

  return (
    <div className="space-y-5 p-6">
      {/* 个人资料 + 安全 - 双列布局 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 个人资料 */}
        <div className="bg-card border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <User className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">个人资料</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">用户名</label>
              <div className="bg-muted rounded-md px-3 py-2 text-foreground text-sm">
                {userName || '未设置'}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">角色</label>
              <div className="bg-muted rounded-md px-3 py-2 text-foreground text-sm">
                {userRole === 'admin' ? '管理员' : '普通用户'}
              </div>
            </div>
          </div>
        </div>

        {/* 安全与隐私 */}
        <div className="bg-card border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-destructive" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">安全与隐私</h3>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setShowPasswordDialog(true)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-md bg-background border border-border text-foreground text-sm hover:bg-muted/80 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-muted-foreground" />
                <span>修改密码</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => {
                onToast?.('登录记录功能即将上线，敬请期待');
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-md bg-background border border-border text-foreground text-sm hover:bg-muted/80 transition-colors"
            >
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" />
                <span>登录记录</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      {/* 外观主题 + 生成偏好 - 双列布局 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 外观主题 */}
        <div className="bg-card border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Palette className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">外观主题</h3>
          </div>
          <div className="flex gap-2">
            {[
              { id: 'dark' as const, label: '深色', icon: Moon },
              { id: 'light' as const, label: '浅色', icon: Sun },
              { id: 'system' as const, label: '跟随系统', icon: Monitor },
            ].map(({ id, label, icon: Icon }) => {
              const isActive = (id === 'dark' && isDark && !isMonochrome) ||
                (id === 'light' && !isDark && !isMonochrome) ||
                (id === 'system' && isMonochrome);
              return (
                <button
                  key={id}
                  onClick={() => { onToggleTheme(id); markChanged(); }}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-sm ${
                    isActive
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-muted border-border/30 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 生成偏好 */}
        <div className="bg-card border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Camera className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">生成偏好</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-foreground">默认画质</div>
                <div className="text-xs text-muted-foreground">设置生成图片的默认质量</div>
              </div>
              <select
                value={imageQuality}
                onChange={(e) => { setImageQuality(e.target.value as typeof imageQuality); markChanged(); }}
                className="bg-background border border-border rounded-md px-3 py-1.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="standard">标准</option>
                <option value="high">高清</option>
                <option value="ultra">超高清</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-foreground">自动保存</div>
                <div className="text-xs text-muted-foreground">生成完成后自动保存</div>
              </div>
              <button onClick={() => { setAutoSave(!autoSave); markChanged(); }} className={toggleClass(autoSave)}>
                <span className={toggleDot(autoSave)} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 通知设置 - 全宽 */}
      <div className="bg-card border border-border/50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bell className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground text-sm">通知设置</h3>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { key: 'taskComplete' as const, label: '任务完成通知', desc: '生成任务完成后弹出提醒' },
            { key: 'creditsLow' as const, label: '积分不足提醒', desc: '积分余额低于阈值时提醒' },
            { key: 'systemUpdate' as const, label: '系统更新通知', desc: '平台功能更新和维护通知' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="mr-3">
                <div className="text-sm text-foreground">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              <button
                onClick={() => { setNotifications(prev => ({ ...prev, [key]: !prev[key] })); markChanged(); }}
                className={toggleClass(notifications[key])}
              >
                <span className={toggleDot(notifications[key])} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 固定底部保存栏 */}
      {hasChanges && (
        <div className="sticky bottom-0 bg-card border border-border/50 rounded-lg p-3 flex items-center justify-between shadow-lg">
          <span className="text-sm text-primary">有未保存的修改</span>
          <div className="flex items-center gap-2">
            <button onClick={handleReset} className="px-3 py-1.5 rounded-md text-sm bg-background border border-border text-muted-foreground hover:text-foreground transition-colors">
              重置
            </button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      )}

      {/* 修改密码弹窗 */}
      {showPasswordDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPasswordDialog(false)} />
          <div className="relative bg-card rounded-xl shadow-lg border border-border/50 p-6 w-[380px]">
            <h3 className="text-base font-semibold text-foreground mb-4">修改密码</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">新密码</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少6位" className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">确认密码</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <button onClick={handlePasswordChange} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">确认修改</button>
            </div>
            <button onClick={() => setShowPasswordDialog(false)} className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
