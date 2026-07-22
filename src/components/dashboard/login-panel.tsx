'use client';

import React, { useState, useMemo } from 'react';
import { User } from '@/lib/user-types';
import { UserManager as UserManagerCore } from '@/lib/user-manager';
import { APP_VERSION_LABEL } from '@/config/app-meta';
import { Label } from '@/components/ui/label';
import {
  User as UserIcon,
  Settings,
  Zap,
  Eye,
  EyeOff,
  Sparkles,
  Film,
  Workflow,
  Shapes,
  MessageSquareMore,
  Eraser,
  ArrowLeft,
  PanelLeft,
  MessageCircle,
} from 'lucide-react';

interface LoginPanelProps {
  onLogin: (user: User, productType: string) => void;
}

type LoginMode = 'canvas' | 'chat';
type ViewState = 'select-mode' | 'login-form';

export function LoginPanel({ onLogin }: LoginPanelProps) {
  const userManager = useMemo(() => {
    try { return UserManagerCore.getInstance(); }
    catch (e) { console.error('[LoginPanel] UserManager init error:', e); return null as any; }
  }, []);
  const [viewState, setViewState] = useState<ViewState>('select-mode');
  const [selectedMode, setSelectedMode] = useState<LoginMode>('canvas');
  const [loginName, setLoginName] = useState('Mr.joker');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const submitLogin = async (name: string, password: string, productType: string) => {
    setLoggingIn(true);
    setLoginError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, password, productType }),
      });

      if (!response.ok) {
        setLoginError('登录失败，请检查用户名、密码或授权');
        return;
      }

      const data = await response.json() as { success?: boolean; user?: User; error?: string };
      if (!data.user) {
        setLoginError(data.error || '该用户未授权使用此功能，请联系管理员');
        return;
      }

      const loggedIn = await userManager.upsertUserFromServer(data.user);
      onLogin(loggedIn, productType);
    } catch {
      setLoginError('登录失败，网络异常');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogin = async () => {
    await submitLogin(loginName.trim(), loginPassword, selectedMode);
  };

  const selectMode = (mode: LoginMode) => {
    console.log('[LoginPanel] selectMode called with:', mode);
    setSelectedMode(mode);
    setLoginError('');
    setViewState('login-form');
    console.log('[LoginPanel] viewState set to login-form, selectedMode:', mode);
  };

  const backToModeSelection = () => {
    setViewState('select-mode');
    setLoginError('');
  };

  return (
    <div className="fixed inset-0 z-[100] flex min-h-screen" style={{ background: '#0A0A0F' }}>
      <div className="w-full min-h-screen flex flex-col lg:flex-row">

        {/* 左侧品牌展示区 */}
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 xl:p-16"
             style={{ background: 'linear-gradient(135deg, #0E0E16 0%, #151520 40%, #1A1A28 70%, #0E0E16 100%)' }}>

          {/* 渐变光效背景装饰 */}
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none" aria-hidden="true">
            <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full opacity-20"
                 style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.3) 0%, transparent 70%)' }} />
            <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full opacity-10"
                 style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.25) 0%, transparent 70%)' }} />
            <div className="absolute top-1/2 left-1/3 w-64 h-64 rounded-full opacity-10"
                 style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.2) 0%, transparent 60%)' }} />
          </div>

          {/* 品牌头部 */}
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <img src="/logo.png" alt="无界AI" className="w-10 h-10 object-contain rounded-lg" />
              <h1 className="text-3xl xl:text-4xl font-bold text-foreground tracking-tight">无界AI</h1>
            </div>
            <p className="text-muted-foreground text-base xl:text-lg">AI 图像 · 视频 · 3D 一站式创作平台</p>
          </div>

          {/* 特性卡片 */}
          <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-3 my-8">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
              <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                <Sparkles className="w-[18px] h-[18px] text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground mb-0.5">AI 图像生成</h3>
                <p className="text-[11px] text-muted-foreground leading-snug">多模型自由切换，文生图 / 图生图 / 参考图，任意画面比例与质量档位</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
              <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                <Film className="w-[18px] h-[18px] text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground mb-0.5">AI 视频导演</h3>
                <p className="text-[11px] text-muted-foreground leading-snug">文生视频 / 图生视频 / 首尾帧 / 多镜头分镜 / 尾帧接力续写，6种导演风格</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
              <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                <Zap className="w-[18px] h-[18px] text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground mb-0.5">无限画布</h3>
                <p className="text-[11px] text-muted-foreground leading-snug">自由缩放 / 拖拽 / 多选 / Ctrl+Z 无限撤回，一张画布容纳所有创作</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
              <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                <Eraser className="w-[18px] h-[18px] text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground mb-0.5">AI 修图全家桶</h3>
                <p className="text-[11px] text-muted-foreground leading-snug">语言修图 / 擦除 / 蒙版 / 无损放大 / 去背景 / 扩展画面 / SVG描摹 / 元素分层</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
              <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                <Shapes className="w-[18px] h-[18px] text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground mb-0.5">3D · PSD · SVG</h3>
                <p className="text-[11px] text-muted-foreground leading-snug">单/多图转3D模型预览、PSD三档分层导出、SVG智能描摹、字境大师字体设计</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
              <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                <Workflow className="w-[18px] h-[18px] text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground mb-0.5">工作流 & Agent</h3>
                <p className="text-[11px] text-muted-foreground leading-snug">可视化节点编排、AI自然语言建图、Agent智能多轮编辑、30+节点类型</p>
              </div>
            </div>
          </div>

          {/* AI 助手提示 */}
          <div className="relative z-10 flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 mb-6">
            <MessageSquareMore className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              右侧 <span className="text-primary font-medium">AI 聊天助手</span> 支持模糊意图追问、提示词优化、@引用图片/品牌/模型、21个内置 Skill 一键生成电商套图 / 分镜 / IP角色 / 海报
            </p>
          </div>

          {/* 版本号 */}
          <div className="relative z-10">
            <p className="text-xs text-muted-foreground/50 font-mono">{APP_VERSION_LABEL}</p>
          </div>
        </div>

        {/* 右侧登录区 */}
        <div className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-12" style={{ backgroundColor: '#0F1117' }}>
          <div className="w-full max-w-sm">

            {/* 移动端品牌标识 */}
            <div className="lg:hidden flex items-center gap-2 mb-10 justify-center">
              <img src="/logo.png" alt="无界AI" className="w-8 h-8 object-contain rounded" />
              <span className="text-2xl font-bold text-foreground tracking-tight">无界AI</span>
            </div>

            {viewState === 'select-mode' ? (
              /* ───── 模式选择界面 ───── */
              <>
                <h2 className="text-2xl font-bold text-foreground mb-2">选择入口</h2>
                <p className="text-sm text-muted-foreground mb-8">请选择你要使用的功能模式</p>

                <div className="space-y-4">
                  {/* 无限画布卡片 */}
                  <button
                    type="button"
                    onClick={() => selectMode('canvas')}
                    className="w-full text-left p-5 rounded-xl border border-border/40 bg-muted/30 hover:border-primary/50 hover:bg-muted/50 transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.2)] transition-shadow">
                        <PanelLeft className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-foreground mb-1">无限画布</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          AI 图像生成 · 视频导演 · 3D模型 · 工作流编排 · 无限画布创作
                        </p>
                      </div>
                      <div className="text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                      </div>
                    </div>
                  </button>

                  {/* 智能对话卡片 */}
                  <button
                    type="button"
                    onClick={() => selectMode('chat')}
                    className="w-full text-left p-5 rounded-xl border border-border/40 bg-muted/30 hover:border-primary/50 hover:bg-muted/50 transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.2)] transition-shadow">
                        <MessageCircle className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-foreground mb-1">智能对话</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          AI 智能对话 · 图片理解 · 文生图 · 会话管理 · 模型切换
                        </p>
                      </div>
                      <div className="text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                      </div>
                    </div>
                  </button>
                </div>

                <p className="mt-8 text-xs text-muted-foreground/50 text-center">请联系管理员创建新账户并授权对应功能。</p>
              </>
            ) : (
              /* ───── 登录表单界面 ───── */
              <>
                {/* 返回按钮 + 模式标签 */}
                <div className="flex items-center gap-3 mb-6">
                  <button
                    type="button"
                    onClick={backToModeSelection}
                    className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-muted/50 transition-colors"
                    title="返回选择模式"
                  >
                    <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <div className="flex items-center gap-2">
                    {selectedMode === 'canvas' ? (
                      <>
                        <PanelLeft className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">无限画布</span>
                      </>
                    ) : (
                      <>
                        <MessageCircle className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">智能对话</span>
                      </>
                    )}
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-foreground mb-8">登录</h2>

                {/* 登录表单 */}
                <form onSubmit={(e) => { e.preventDefault(); void handleLogin(); }} autoComplete="off">
                  {/* 用户名输入框 */}
                  <div className="mb-5">
                    <Label className="block text-xs font-medium text-muted-foreground mb-1.5">用户名</Label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <UserIcon className="w-4 h-4 text-muted-foreground/60" />
                      </div>
                      <input
                        type="text"
                        value={loginName}
                        onChange={(e) => setLoginName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}
                        placeholder="请输入用户名"
                        disabled={loggingIn}
                        className="w-full bg-muted border-none rounded-md pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* 密码输入框 */}
                  <div className="mb-6">
                    <Label className="block text-xs font-medium text-muted-foreground mb-1.5">密码</Label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <Settings className="w-4 h-4 text-muted-foreground/60" />
                      </div>
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}
                        placeholder="请输入密码"
                        disabled={loggingIn}
                        className="w-full bg-muted border-none rounded-md pl-10 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((value) => !value)}
                        aria-label={showLoginPassword ? '隐藏密码' : '显示密码'}
                        title={showLoginPassword ? '隐藏密码' : '显示密码'}
                        disabled={loggingIn}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                      >
                        {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* 登录按钮 */}
                  <button
                    type="submit"
                    disabled={loggingIn}
                    className="w-full bg-primary text-primary-foreground font-semibold py-2.5 rounded-md text-sm hover:brightness-110 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loggingIn ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        登录中...
                      </>
                    ) : '登录'}
                  </button>
                </form>

                {/* 错误提示 */}
                {loginError && (
                  <div className="mt-4 px-4 py-3 rounded-md text-sm font-medium" style={{ backgroundColor: '#3D1518' }}>
                    <span className="text-destructive">{loginError}</span>
                  </div>
                )}

                <p className="mt-6 text-xs text-muted-foreground/50 text-center">请联系管理员创建新账户并授权对应功能。</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
