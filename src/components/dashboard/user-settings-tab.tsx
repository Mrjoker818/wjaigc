'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useId, useRef } from 'react';
import type { WorkspaceThemePreference } from '@/hooks/use-workspace-theme';
import {
  User, Bell, Palette, Shield, Save, Check,
  Moon, Sun, Monitor, ChevronRight, Camera, Key, Lock, History, X
} from 'lucide-react';

interface UserSettingsTabProps {
  isDark: boolean;
  isMonochrome: boolean;
  themePreference?: WorkspaceThemePreference;
  onToggleTheme: (theme: 'dark' | 'light' | 'system') => void;
  userName: string;
  userRole: string;
  onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function UserSettingsTab({
  isDark,
  isMonochrome,
  themePreference,
  onToggleTheme,
  userName,
  userRole,
  onToast
}: UserSettingsTabProps) {
  const fieldId = useId();
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
      onToast?.('设置已保存', 'success');
    } catch {
      onToast?.('保存失败，请重试', 'error');
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
      onToast?.('密码至少6位', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      onToast?.('两次输入的密码不一致', 'error');
      return;
    }
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      if (res.ok) {
        onToast?.('密码修改成功', 'success');
        setShowPasswordDialog(false);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const d = await res.json();
        onToast?.(d.error || '密码修改失败', 'error');
      }
    } catch {
      onToast?.('请求失败', 'error');
    }
  };

  const toggleClass = (on: boolean) =>
    `relative inline-flex h-6 w-11 items-center rounded-full border border-foreground/50 transition-colors cursor-pointer ${on ? 'bg-primary' : 'bg-muted'}`;

  const toggleDot = (on: boolean) =>
    `inline-block h-4 w-4 transform rounded-full transition-transform ${on ? 'translate-x-6 bg-primary-foreground' : 'translate-x-1 bg-foreground'}`;

  const settingsRef = useRef<HTMLDivElement>(null);
  const saveBarRef = useRef<HTMLDivElement>(null);
  const keepFocusedControlVisible = useCallback((): void => {
    const focused = document.activeElement;
    const bar = saveBarRef.current;
    if (!(focused instanceof HTMLElement) || !bar || !settingsRef.current?.contains(focused) || bar.contains(focused)) return;
    // Fixed password overlays own their viewport; never scroll the page behind one.
    for (let node: HTMLElement | null = focused; node && node !== settingsRef.current; node = node.parentElement) {
      if (getComputedStyle(node).position === 'fixed') return;
    }
    const field = focused.getBoundingClientRect(), footer = bar.getBoundingClientRect();
    for (let parent = focused.parentElement; parent; parent = parent.parentElement) {
      if (!/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
      const port = parent.getBoundingClientRect();
      const top = Math.max(0, port.top + parent.clientTop) + 8;
      let bottom = Math.min(window.innerHeight, port.top + parent.clientTop + parent.clientHeight) - 8;
      if (footer.left < field.right && footer.right > field.left && footer.bottom > top && footer.top < bottom) {
        bottom = footer.top - 8;
      }
      if (bottom <= top) return;
      const delta = field.top < top ? field.top - top : field.bottom > bottom ? field.bottom - bottom : 0;
      if (delta) parent.scrollBy({ top: delta, behavior: 'instant' });
      return;
    }
  }, []);
  useLayoutEffect(() => {
    if (!hasChanges) return;
    keepFocusedControlVisible();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(keepFocusedControlVisible) : null;
    if (saveBarRef.current) observer?.observe(saveBarRef.current);
    window.addEventListener('resize', keepFocusedControlVisible);
    return () => { observer?.disconnect(); window.removeEventListener('resize', keepFocusedControlVisible); };
  }, [hasChanges, keepFocusedControlVisible]);

  return (
    <div ref={settingsRef} onFocusCapture={keepFocusedControlVisible} className="min-w-0 space-y-5 p-4 sm:p-6">
      {/* 个人资料 + 安全 - 双列布局 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 个人资料 */}
        <div className="min-w-0 bg-card border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <User className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">个人资料</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">用户名</label>
              <div className="min-w-0 break-all bg-muted rounded-md px-3 py-2 text-foreground text-sm">
                {userName || '未设置'}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">角色</label>
              <div className="min-w-0 break-all bg-muted rounded-md px-3 py-2 text-foreground text-sm">
                {userRole === 'admin' ? '管理员' : '普通用户'}
              </div>
            </div>
          </div>
        </div>

        {/* 安全与隐私 */}
        <div className="min-w-0 bg-card border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-destructive" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">安全与隐私</h3>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setShowPasswordDialog(true)}
              className="w-full min-h-11 flex items-center justify-between px-3 py-2.5 rounded-md bg-background border border-border text-foreground text-sm hover:bg-muted/80 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-muted-foreground" />
                <span>修改密码</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => {
                onToast?.('登录记录功能即将上线，敬请期待', 'info');
              }}
              className="w-full min-h-11 flex items-center justify-between px-3 py-2.5 rounded-md bg-background border border-border text-foreground text-sm hover:bg-muted/80 transition-colors"
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 外观主题 */}
        <div className="min-w-0 bg-card border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Palette className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">外观主题</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { id: 'dark' as const, label: '深色', icon: Moon },
              { id: 'light' as const, label: '浅色', icon: Sun },
              { id: 'system' as const, label: '跟随系统', icon: Monitor },
            ].map(({ id, label, icon: Icon }) => {
              const isActive = id === (themePreference ?? (isMonochrome || !isDark ? 'light' : 'dark'));
              return (
                <button
                  key={id}
                  aria-pressed={isActive}
                  onClick={() => { onToggleTheme(id); markChanged(); }}
                  className={`min-h-11 min-w-0 last:col-span-2 sm:last:col-span-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-sm ${
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
        <div className="min-w-0 bg-card border border-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Camera className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">生成偏好</h3>
          </div>
          <div className="space-y-3">
            <div className="min-w-0 flex flex-wrap items-center justify-between gap-3">
              <div>
                <label htmlFor={`${fieldId}-quality`} className="text-sm text-foreground">默认画质</label>
                <div className="text-xs text-muted-foreground">设置生成图片的默认质量</div>
              </div>
              <select
                id={`${fieldId}-quality`}
                value={imageQuality}
                onChange={(e) => { setImageQuality(e.target.value as typeof imageQuality); markChanged(); }}
                className="w-full min-w-0 sm:w-auto shrink-0 bg-background border border-border rounded-md h-11 px-3 py-1.5 text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="standard">标准</option>
                <option value="high">高清</option>
                <option value="ultra">超高清</option>
              </select>
            </div>
            <div className="min-w-0 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-foreground">自动保存</div>
                <div className="text-xs text-muted-foreground">生成完成后自动保存</div>
              </div>
              <button onClick={() => { setAutoSave(!autoSave); markChanged(); }} role="switch" aria-label="自动保存" aria-checked={autoSave} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <span aria-hidden="true" className={toggleClass(autoSave)}><span className={toggleDot(autoSave)} /></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 通知设置 - 全宽 */}
      <div className="min-w-0 bg-card border border-border/50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bell className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground text-sm">通知设置</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            { key: 'taskComplete' as const, label: '任务完成通知', desc: '生成任务完成后弹出提醒' },
            { key: 'creditsLow' as const, label: '积分不足提醒', desc: '积分余额低于阈值时提醒' },
            { key: 'systemUpdate' as const, label: '系统更新通知', desc: '平台功能更新和维护通知' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="min-w-0 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              <button
                onClick={() => { setNotifications(prev => ({ ...prev, [key]: !prev[key] })); markChanged(); }}
                role="switch" aria-label={label} aria-checked={notifications[key]}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span aria-hidden="true" className={toggleClass(notifications[key])}><span className={toggleDot(notifications[key])} /></span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 固定底部保存栏 */}
      {hasChanges && (
        <div ref={saveBarRef} className="sticky bottom-0 z-10 bg-card border border-border/50 rounded-lg p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shadow-lg">
          <span className="text-sm text-primary">有未保存的修改</span>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button onClick={handleReset} className="min-h-11 flex-1 px-3 py-1.5 rounded-md text-sm bg-background border border-border text-muted-foreground hover:text-foreground transition-colors">
              重置
            </button>
            <button onClick={handleSave} disabled={saving} className="min-h-11 flex-1 px-4 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      )}

      {/* 修改密码弹窗 */}
      {showPasswordDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPasswordDialog(false)} />
          <div className="relative w-full max-w-[380px] max-h-full overflow-y-auto overscroll-contain bg-card rounded-xl shadow-lg border border-border/50 p-4 sm:p-6">
            <h3 className="mr-12 text-base font-semibold text-foreground mb-4">修改密码</h3>
            <div className="space-y-3">
              <div>
                <label htmlFor={`${fieldId}-new-password`} className="text-sm font-medium text-foreground mb-1.5 block">新密码</label>
                <input id={`${fieldId}-new-password`} autoComplete="new-password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少6位" className="w-full h-11 px-3 rounded-lg bg-background border border-border text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label htmlFor={`${fieldId}-confirm-password`} className="text-sm font-medium text-foreground mb-1.5 block">确认密码</label>
                <input id={`${fieldId}-confirm-password`} autoComplete="new-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" className="w-full h-11 px-3 rounded-lg bg-background border border-border text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handlePasswordChange} className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">确认修改</button>
                <button aria-label="关闭修改密码" onClick={() => setShowPasswordDialog(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
