'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FolderOpen,
  LayoutTemplate,
  Package,
  Plus,
  ImagePlus,
  Pencil,
  LayoutDashboard,
  Download,
} from 'lucide-react';
import { UserManager } from '@/lib/user-manager';

const navItems = [
  { href: '/projects', label: '我的项目', icon: FolderOpen },
  { href: '/templates', label: '模板广场', icon: LayoutTemplate },
  { href: '/assets', label: '资产库', icon: Package },
];

const recentActivities = [
  { icon: ImagePlus, color: 'text-primary', text: '生成了赛博城市概念图', time: '5 分钟前' },
  { icon: Pencil, color: 'text-[#16A37B]', text: '编辑了品牌Logo项目', time: '1 小时前' },
  { icon: LayoutTemplate, color: 'text-[#F59E0B]', text: '使用了电商主图模板', time: '3 小时前' },
  { icon: Download, color: 'text-muted-foreground', text: '保存了3张图片到资产库', time: '昨天' },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const [userName, setUserName] = useState('用户');
  const [userInitial, setUserInitial] = useState('U');

  useEffect(() => {
    const um = UserManager.getInstance();
    const currentUser = um.getUser();
    if (currentUser) {
      setUserName(currentUser.name || '用户');
      setUserInitial((currentUser.name || 'U').charAt(0).toUpperCase());
    }
  }, []);

  return (
    <aside className="w-60 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0 h-screen">
      {/* 顶部 Logo + 品牌 */}
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-sidebar-border">
        <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-sm">W</span>
        </div>
        <span className="text-sidebar-foreground font-semibold text-base tracking-tight">无界AI</span>
      </div>

      {/* 快速创建按钮 */}
      <div className="px-4 pt-4 pb-2">
        <Link
          href="/?action=new-project"
          className="flex items-center justify-center gap-2 w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          新建项目
        </Link>
      </div>

      {/* 主导航 */}
      <nav className="flex-1 px-3 py-2">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 h-9 px-3 rounded-md text-sm transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <item.icon className={`w-4 h-4 ${isActive ? 'text-sidebar-primary' : ''}`} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 创作动态 */}
      <div className="px-4 pb-3 border-t border-sidebar-border pt-3">
        <h3 className="text-xs font-medium text-sidebar-foreground/50 mb-2.5 tracking-wide">创作动态</h3>
        <ul className="space-y-2">
          {recentActivities.map((activity, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-xs cursor-pointer hover:bg-sidebar-accent/30 rounded px-1.5 py-1 -mx-1.5 transition-colors"
            >
              <activity.icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${activity.color}`} />
              <div className="min-w-0">
                <div className="text-sidebar-foreground/80 truncate">{activity.text}</div>
                <div className="text-sidebar-foreground/40 mt-0.5">{activity.time}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* 用户信息 */}
      <div className="h-12 flex items-center gap-2.5 px-4 border-t border-sidebar-border">
        <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
          <span className="text-primary text-xs font-semibold">{userInitial}</span>
        </div>
        <span className="text-sidebar-foreground/80 text-sm truncate">{userName}</span>
        <Link
          href="/"
          className="ml-auto text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors cursor-pointer"
          title="进入画布"
        >
          <LayoutDashboard className="w-4 h-4" />
        </Link>
      </div>
    </aside>
  );
}
