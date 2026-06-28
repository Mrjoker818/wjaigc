'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  User, Bell, Palette, Shield, CreditCard, Save, Check,
  Moon, Sun, Monitor, ChevronRight, Camera, Key
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

  // Load saved settings from localStorage
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

  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const cardBg = isDark ? 'bg-[#1a1a2e]/60' : 'bg-white';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';
  const accentClass = isDark ? 'text-[#d4af37]' : 'text-amber-600';
  const inputBg = isDark ? 'bg-[#0d0d1a]/60' : 'bg-gray-50';

  const toggleClass = (on: boolean) =>
    `relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? (isDark ? 'bg-[#d4af37]' : 'bg-amber-500') : (isDark ? 'bg-gray-600' : 'bg-gray-300')}`;

  const toggleDot = (on: boolean) =>
    `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`;

  return (
    <div className="space-y-4">
      {/* 页面头部 */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className={`text-xl font-bold ${textPrimary}`}>个人设置</h1>
          <p className={`text-sm ${textSecondary} mt-0.5`}>管理你的偏好和账户设置</p>
        </div>
      </div>

      {/* 个人资料 */}
      <div className={`${cardBg} border ${borderColor} rounded-lg p-4`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-full ${isDark ? 'bg-[#d4af37]/20' : 'bg-amber-100'} flex items-center justify-center`}>
            <User className={`w-4 h-4 ${accentClass}`} />
          </div>
          <h3 className={`font-semibold ${textPrimary}`}>个人资料</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`text-xs ${textSecondary}`}>用户名</label>
            <div className={`${inputBg} border ${borderColor} rounded-md px-3 py-2 mt-1 ${textPrimary} text-sm`}>
              {userName || '未设置'}
            </div>
          </div>
          <div>
            <label className={`text-xs ${textSecondary}`}>角色</label>
            <div className={`${inputBg} border ${borderColor} rounded-md px-3 py-2 mt-1 ${textPrimary} text-sm capitalize`}>
              {userRole === 'admin' ? '管理员' : '普通用户'}
            </div>
          </div>
        </div>
      </div>

      {/* 外观主题 */}
      <div className={`${cardBg} border ${borderColor} rounded-lg p-4`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-full ${isDark ? 'bg-purple-500/20' : 'bg-purple-100'} flex items-center justify-center`}>
            <Palette className={`w-4 h-4 ${isDark ? 'text-purple-400' : 'text-purple-600'}`} />
          </div>
          <h3 className={`font-semibold ${textPrimary}`}>外观主题</h3>
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
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-all text-sm ${
                  isActive
                    ? `${isDark ? 'bg-[#d4af37]/20 border-[#d4af37]/50 text-[#d4af37]' : 'bg-amber-50 border-amber-300 text-amber-700'}`
                    : `${inputBg} ${borderColor} ${textSecondary} hover:${textPrimary}`
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
      <div className={`${cardBg} border ${borderColor} rounded-lg p-4`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-full ${isDark ? 'bg-blue-500/20' : 'bg-blue-100'} flex items-center justify-center`}>
            <Camera className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
          </div>
          <h3 className={`font-semibold ${textPrimary}`}>生成偏好</h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-sm ${textPrimary}`}>默认画质</div>
              <div className={`text-xs ${textSecondary}`}>设置生成图片的默认质量等级</div>
            </div>
            <select
              value={imageQuality}
              onChange={(e) => { setImageQuality(e.target.value as any); markChanged(); }}
              className={`${inputBg} border ${borderColor} rounded-md px-3 py-1.5 ${textPrimary} text-sm`}
            >
              <option value="standard">标准</option>
              <option value="high">高清</option>
              <option value="ultra">超高清</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-sm ${textPrimary}`}>自动保存</div>
              <div className={`text-xs ${textSecondary}`}>生成完成后自动保存到项目</div>
            </div>
            <button
              onClick={() => { setAutoSave(!autoSave); markChanged(); }}
              className={toggleClass(autoSave)}
            >
              <span className={toggleDot(autoSave)} />
            </button>
          </div>
        </div>
      </div>

      {/* 通知设置 */}
      <div className={`${cardBg} border ${borderColor} rounded-lg p-4`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-full ${isDark ? 'bg-green-500/20' : 'bg-green-100'} flex items-center justify-center`}>
            <Bell className={`w-4 h-4 ${isDark ? 'text-green-400' : 'text-green-600'}`} />
          </div>
          <h3 className={`font-semibold ${textPrimary}`}>通知设置</h3>
        </div>
        <div className="space-y-3">
          {[
            { key: 'taskComplete' as const, label: '任务完成通知', desc: '生成任务完成后弹出提醒' },
            { key: 'creditsLow' as const, label: '积分不足提醒', desc: '积分余额低于阈值时提醒' },
            { key: 'systemUpdate' as const, label: '系统更新通知', desc: '平台功能更新和维护通知' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <div className={`text-sm ${textPrimary}`}>{label}</div>
                <div className={`text-xs ${textSecondary}`}>{desc}</div>
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

      {/* 安全 */}
      <div className={`${cardBg} border ${borderColor} rounded-lg p-4`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-full ${isDark ? 'bg-red-500/20' : 'bg-red-100'} flex items-center justify-center`}>
            <Shield className={`w-4 h-4 ${isDark ? 'text-red-400' : 'text-red-600'}`} />
          </div>
          <h3 className={`font-semibold ${textPrimary}`}>安全与隐私</h3>
        </div>
        <div className="space-y-2">
          <button className={`w-full flex items-center justify-between px-3 py-2 rounded-md ${inputBg} border ${borderColor} ${textPrimary} text-sm hover:opacity-80 transition-opacity`}>
            <span>修改密码</span>
            <ChevronRight className={`w-4 h-4 ${textSecondary}`} />
          </button>
          <button className={`w-full flex items-center justify-between px-3 py-2 rounded-md ${inputBg} border ${borderColor} ${textPrimary} text-sm hover:opacity-80 transition-opacity`}>
            <span>登录记录</span>
            <ChevronRight className={`w-4 h-4 ${textSecondary}`} />
          </button>
        </div>
      </div>

      {/* 固定底部保存栏 */}
      {hasChanges && (
        <div className={`sticky bottom-0 ${cardBg} border ${borderColor} rounded-lg p-3 flex items-center justify-between shadow-lg`}>
          <span className={`text-sm ${isDark ? 'text-[#d4af37]' : 'text-amber-600'}`}>
            有未保存的修改
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className={`px-3 py-1.5 rounded-md text-sm ${inputBg} border ${borderColor} ${textSecondary} hover:${textPrimary} transition-colors`}
            >
              重置
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-4 py-1.5 rounded-md text-sm font-medium ${
                isDark ? 'bg-[#d4af37] text-black hover:bg-[#c9a430]' : 'bg-amber-500 text-white hover:bg-amber-600'
              } transition-colors disabled:opacity-50`}
            >
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
