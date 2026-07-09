"use client";

import { useState, useEffect, useCallback } from "react";
import Sidebar from "@/components/simple-chat/sidebar";
import ChatArea from "@/components/simple-chat/chat-area";
import { LoginPanel } from "@/components/dashboard/login-panel";
import {
  SimpleChatProject, SimpleChatTask, SimpleChatMessage, SimpleChatAgent,
  loadProjects, saveProjects, SimpleChatProject as Project, SimpleChatTask as Task,
  PRESET_SKILLS, PresetSkill
} from "@/components/simple-chat/simple-chat-types";
import { User } from "@/lib/user-types";

function generateId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function createDefaultProject(): Project {
  const taskId = generateId();
  const task: Task = {
    id: taskId, projectId: '', name: '新对话',
    messages: [], model: '', providerId: '',
    createdAt: Date.now(), updatedAt: Date.now()
  };
  const project: Project = {
    id: generateId(), name: '默认项目', emoji: '💬',
    description: '', createdAt: Date.now(), updatedAt: Date.now(),
    tasks: [task], agents: [], knowledgeItems: [],
  };
  task.projectId = project.id;
  return project;
}

export default function SimpleChatPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Auth
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(data => {
      if (data.authenticated && data.user) {
        setUser(data.user);
        setShowLogin(false);
      } else { setShowLogin(true); }
    }).catch(() => setShowLogin(true)).finally(() => setAuthLoading(false));
  }, []);

  // Load projects
  useEffect(() => {
    if (!user) return;
    let loaded = loadProjects();
    if (loaded.length === 0) loaded = [createDefaultProject()];
    setProjects(loaded);
    setActiveProjectId(loaded[0].id);
    setActiveTaskId(loaded[0].tasks[0]?.id ?? null);
  }, [user]);

  // Persist
  useEffect(() => {
    if (projects.length > 0) saveProjects(projects);
  }, [projects]);

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null;
  const activeTask = activeProject?.tasks.find(t => t.id === activeTaskId) ?? null;

  // Project ops
  const handleCreateProject = useCallback(() => {
    const p = createDefaultProject();
    setProjects(prev => [...prev, p]);
    setActiveProjectId(p.id);
    setActiveTaskId(p.tasks[0].id);
  }, []);

  const handleUpdateProject = useCallback((project: Project) => {
    setProjects(prev => prev.map(p => p.id === project.id ? { ...project, updatedAt: Date.now() } : p));
  }, []);

  const handleDeleteProject = useCallback((id: string) => {
    setProjects(prev => {
      const remaining = prev.filter(p => p.id !== id);
      if (activeProjectId === id) {
        const next = remaining[0];
        setActiveProjectId(next?.id ?? null);
        setActiveTaskId(next?.tasks[0]?.id ?? null);
      }
      return remaining;
    });
  }, [activeProjectId]);

  const handleRenameProject = useCallback((id: string, name: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name, updatedAt: Date.now() } : p));
  }, []);

  // Task ops
  const handleCreateTask = useCallback((projectId: string) => {
    const task: Task = {
      id: generateId(), projectId, name: '新对话',
      messages: [], model: '', providerId: '',
      createdAt: Date.now(), updatedAt: Date.now()
    };
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, tasks: [...p.tasks, task], updatedAt: Date.now() } : p));
    setActiveTaskId(task.id);
  }, []);

  const handleDeleteTask = useCallback((projectId: string, taskId: string) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const remaining = p.tasks.filter(t => t.id !== taskId);
      if (activeTaskId === taskId) setActiveTaskId(remaining[0]?.id ?? null);
      return { ...p, tasks: remaining, updatedAt: Date.now() };
    }));
  }, [activeTaskId]);

  const handleUpdateTask = useCallback((task: Task) => {
    setProjects(prev => prev.map(p => ({
      ...p,
      tasks: p.tasks.map(t => t.id === task.id ? { ...task, updatedAt: Date.now() } : t),
      updatedAt: p.id === task.projectId ? Date.now() : p.updatedAt
    })));
  }, []);

  // Agent ops
  const handleCreateAgent = useCallback((projectId: string, agent: SimpleChatAgent) => {
    setProjects(prev => prev.map(p => p.id === projectId ? {
      ...p, agents: [...p.agents, agent], updatedAt: Date.now()
    } : p));
  }, []);

  const handleUpdateAgent = useCallback((projectId: string, agent: SimpleChatAgent) => {
    setProjects(prev => prev.map(p => p.id === projectId ? {
      ...p, agents: p.agents.map(a => a.id === agent.id ? agent : a), updatedAt: Date.now()
    } : p));
  }, []);

  const handleDeleteAgent = useCallback((projectId: string, agentId: string) => {
    setProjects(prev => prev.map(p => p.id === projectId ? {
      ...p, agents: p.agents.filter(a => a.id !== agentId), updatedAt: Date.now()
    } : p));
  }, []);

  // Skill → Agent
  const handleSkillToAgent = useCallback((projectId: string, skill: PresetSkill) => {
    const agent: SimpleChatAgent = {
      id: generateId(),
      name: skill.name,
      description: skill.description,
      systemPrompt: skill.systemPrompt,
      emoji: skill.icon,
      tools: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    handleCreateAgent(projectId, agent);
  }, [handleCreateAgent]);

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>;
  }

  if (showLogin || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoginPanel onLogin={(nextUser: User, _productType: string) => { setUser(nextUser); setShowLogin(false); }} />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        user={user}
        projects={projects}
        activeProjectId={activeProjectId}
        activeTaskId={activeTaskId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onSelectProject={id => { setActiveProjectId(id); const p = projects.find(x => x.id === id); setActiveTaskId(p?.tasks[0]?.id ?? null); }}
        onSelectTask={id => setActiveTaskId(id)}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
        onCreateTask={handleCreateTask}
        onDeleteTask={handleDeleteTask}
        onLogout={() => { setUser(null); setShowLogin(true); }}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <ChatArea
          user={user}
          project={activeProject}
          task={activeTask}
          onUpdateTask={handleUpdateTask}
          onUpdateProject={handleUpdateProject}
          onCreateTask={(projectId) => handleCreateTask(projectId)}
          onUpdateAgent={(agent) => activeProject && handleUpdateAgent(activeProject.id, agent)}
          onDeleteAgent={(agentId) => activeProject && handleDeleteAgent(activeProject.id, agentId)}
          onSkillToAgent={(skill) => activeProject && handleSkillToAgent(activeProject.id, skill)}
          onLogout={() => { setUser(null); setShowLogin(true); }}
          onBackToWorkspace={() => window.location.href = '/'}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>
    </div>
  );
}
