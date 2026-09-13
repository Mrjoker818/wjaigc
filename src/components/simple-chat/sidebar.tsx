"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Edit3, LogOut, MessageSquare, FolderOpen, Settings, Home, User, X, PanelLeftClose, PanelLeft } from "lucide-react";
import { SimpleChatProject, SimpleChatTask } from "./simple-chat-types";
import { User as UserType } from "@/lib/user-types";

interface SidebarProps {
  user: UserType;
  projects: SimpleChatProject[];
  activeProjectId: string | null;
  activeTaskId: string | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSelectProject: (id: string) => void;
  onSelectTask: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onCreateTask: (projectId: string) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onRenameTask: (projectId: string, taskId: string, name: string) => void;
  onLogout: () => void;
}

export default function Sidebar({
  user, projects, activeProjectId, activeTaskId, sidebarOpen,
  onToggleSidebar, onSelectProject, onSelectTask,
  onCreateProject, onDeleteProject, onRenameProject,
  onCreateTask, onDeleteTask, onRenameTask, onLogout
}: SidebarProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    return new Set(projects.map(p => p.id));
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [taskRenamingId, setTaskRenamingId] = useState<string | null>(null);
  const [taskRenameValue, setTaskRenameValue] = useState("");

  const toggleProject = (id: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startRename = (id: string, name: string) => {
    setRenamingId(id); setRenameValue(name);
  };

  const submitRename = (id: string) => {
    if (renameValue.trim()) onRenameProject(id, renameValue.trim());
    setRenamingId(null); setRenameValue("");
  };

  const startTaskRename = (taskId: string, name: string) => {
    setTaskRenamingId(taskId); setTaskRenameValue(name);
  };

  const submitTaskRename = (projectId: string, taskId: string) => {
    if (taskRenameValue.trim()) onRenameTask(projectId, taskId, taskRenameValue.trim());
    setTaskRenamingId(null); setTaskRenameValue("");
  };

  if (!sidebarOpen) return null;

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-[min(280px,calc(100vw-48px))] bg-sidebar-background border-r border-sidebar-border flex flex-col h-screen shrink-0 shadow-xl md:static md:z-auto md:w-[280px] md:shadow-none">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground">智能对话</h1>
            <p className="text-[10px] text-sidebar-muted">无界AI</p>
          </div>
        </div>
        <button onClick={onToggleSidebar} className="p-1 rounded-lg hover:bg-sidebar-hover text-sidebar-muted transition-colors">
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {projects.map(project => {
          const isExpanded = expandedProjects.has(project.id);
          const isActive = activeProjectId === project.id;
          return (
            <div key={project.id}>
              {/* Project Row */}
              <div className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors ${
                isActive && !activeTaskId ? 'bg-sidebar-active' : 'hover:bg-sidebar-hover'
              }`}>
                <button onClick={() => toggleProject(project.id)}
                  className="p-0.5 rounded hover:bg-sidebar-hover text-sidebar-muted transition-colors">
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => onSelectProject(project.id)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0">
                  <span className="text-sm">{project.emoji || '💬'}</span>
                  {renamingId === project.id ? (
                    <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => submitRename(project.id)} onKeyDown={e => e.key === 'Enter' && submitRename(project.id)}
                      className="flex-1 bg-sidebar-hover text-sidebar-foreground text-sm px-1 py-0.5 rounded outline-none min-w-0" />
                  ) : (
                    <span className="text-sm text-sidebar-foreground truncate font-medium">{project.name}</span>
                  )}
                </button>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onCreateTask(project.id)}
                    className="p-0.5 rounded hover:bg-sidebar-hover text-sidebar-muted hover:text-sidebar-foreground"
                    title="新建对话">
                    <Plus className="w-3 h-3" />
                  </button>
                  <button onClick={() => startRename(project.id, project.name)}
                    className="p-0.5 rounded hover:bg-sidebar-hover text-sidebar-muted hover:text-sidebar-foreground"
                    title="重命名">
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button onClick={() => onDeleteProject(project.id)}
                    className="p-0.5 rounded hover:bg-sidebar-hover text-sidebar-muted hover:text-red-400"
                    title="删除">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Tasks */}
              {isExpanded && project.tasks.map(task => (
                <div key={task.id}
                  className={`group flex items-center gap-1 ml-6 px-2 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    activeTaskId === task.id ? 'bg-sidebar-active' : 'hover:bg-sidebar-hover'
                  }`}
                  onClick={() => { if (taskRenamingId !== task.id) { onSelectProject(project.id); onSelectTask(task.id); } }}>
                  {taskRenamingId === task.id ? (
                    <input autoFocus value={taskRenameValue} onChange={e => setTaskRenameValue(e.target.value)}
                      onBlur={() => submitTaskRename(project.id, task.id)}
                      onKeyDown={e => { if (e.key === 'Enter') submitTaskRename(project.id, task.id); if (e.key === 'Escape') setTaskRenamingId(null); }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 bg-sidebar-hover text-sidebar-foreground text-sm px-1 py-0.5 rounded outline-none min-w-0" />
                  ) : (
                    <span className="text-sm text-sidebar-foreground truncate flex-1">{task.name}</span>
                  )}
                  <button onClick={e => { e.stopPropagation(); startTaskRename(task.id, task.name); }}
                    className="p-0.5 rounded hover:bg-sidebar-hover text-sidebar-muted hover:text-sidebar-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    title="重命名">
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); onDeleteTask(project.id, task.id); }}
                    className="p-0.5 rounded hover:bg-sidebar-hover text-sidebar-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {/* New Task Button */}
              {isExpanded && (
                <button onClick={() => onCreateTask(project.id)}
                  className="ml-6 flex items-center gap-2 px-2 py-1.5 text-xs text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-hover rounded-lg transition-colors w-full">
                  <Plus className="w-3 h-3" /> 新对话
                </button>
              )}
            </div>
          );
        })}

        {/* Create Project */}
        <button onClick={onCreateProject}
          className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-hover rounded-lg transition-colors w-full">
          <FolderOpen className="w-4 h-4" /> 新建项目
        </button>
      </div>

      {/* User Info */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-hover transition-colors cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</div>
            <div className="text-[10px] text-sidebar-muted truncate">{user.role === 'admin' ? '管理员' : '用户'}</div>
          </div>
          <button onClick={onLogout}
            className="p-1 rounded-lg hover:bg-sidebar-hover text-sidebar-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
            title="退出登录">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
