"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/simple-chat/sidebar";
import ChatArea from "@/components/simple-chat/chat-area";
import { SimpleChatSyncStatusView } from "@/components/simple-chat/simple-chat-sync-status";
import { LoginPanel } from "@/components/dashboard/login-panel";
import {
  SimpleChatAgent,
  saveProjects, SimpleChatProject as Project, SimpleChatTask as Task,
  PresetSkill,
} from "@/components/simple-chat/simple-chat-types";
import { selectInitialSimpleChatProject } from "@/components/simple-chat/simple-chat-types";
import { User } from "@/lib/user-types";
import { fetchSessionPayload } from "@/lib/auth-session";
import { logoutSimpleChatSession } from "@/lib/simple-chat-logout";
import {
  createSimpleChatSyncCoordinator,
  type SimpleChatSyncCoordinator,
  type SimpleChatSyncSnapshot,
} from "@/lib/simple-chat-sync-client";
import { createIndexedDbSimpleChatEnvelopeStore } from "@/lib/simple-chat-sync-storage";

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
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const logoutInFlight = useRef(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const projectsRef = useRef<Project[]>([]);
  const coordinatorRef = useRef<SimpleChatSyncCoordinator | null>(null);
  const coordinatorReadyRef = useRef(false);
  const applyingSyncSnapshotRef = useRef(false);
  const [syncSnapshot, setSyncSnapshot] = useState<SimpleChatSyncSnapshot>({
    status: 'loading',
    projects: [],
    pendingOperations: [],
    error: null,
  });
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    projectsRef.current = projects;
    if (!coordinatorReadyRef.current) return;
    if (applyingSyncSnapshotRef.current) {
      applyingSyncSnapshotRef.current = false;
      return;
    }
    coordinatorRef.current?.update(projects);
  }, [projects]);

  // Auth
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const applyProjects = (nextProjects: Project[]) => {
      projectsRef.current = nextProjects;
      applyingSyncSnapshotRef.current = true;
      setProjects(nextProjects);
    };

    const initialize = async () => {
      try {
        const data = await fetchSessionPayload();
        if (cancelled) return;
        if (!data.success || !data.user) {
          setShowLogin(true);
          return;
        }

        setUser(data.user);
        setShowLogin(false);

        const coordinator = coordinatorRef.current ?? createSimpleChatSyncCoordinator({
          store: createIndexedDbSimpleChatEnvelopeStore(),
        });
        coordinatorRef.current = coordinator;
        unsubscribe = coordinator.subscribe(nextSnapshot => {
          if (cancelled) return;
          setSyncSnapshot(nextSnapshot);
          if (coordinatorReadyRef.current) applyProjects(nextSnapshot.projects);
        });

        const initialized = await coordinator.initialize(data.user.id);
        if (cancelled) return;
        coordinatorReadyRef.current = true;
        setSyncSnapshot(initialized);

        let loaded = initialized.projects;
        if (
          loaded.length === 0
          && (initialized.status === 'synced' || initialized.status === 'syncing')
        ) {
          loaded = [createDefaultProject()];
          coordinator.update(loaded);
        }
        applyProjects(loaded);
        const requestedProjectId = new URLSearchParams(window.location.search).get('projectId');
        const requestedTaskId = new URLSearchParams(window.location.search).get('taskId');
        const initial = selectInitialSimpleChatProject(loaded, requestedProjectId, requestedTaskId);
        setActiveProjectId(initial?.projectId ?? null);
        setActiveTaskId(initial?.taskId ?? null);
      } catch {
        if (!cancelled) setShowLogin(true);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };

    void initialize();
    return () => {
      cancelled = true;
      coordinatorReadyRef.current = false;
      unsubscribe?.();
    };
  }, []);

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null;
  const activeTask = activeProject?.tasks.find(t => t.id === activeTaskId) ?? null;

  useEffect(() => {
    if (!activeProjectId || !activeTaskId || !activeTask) return;
    const current = new URL(window.location.href);
    current.searchParams.set('projectId', activeProjectId);
    current.searchParams.set('taskId', activeTaskId);
    window.history.replaceState(null, '', `${current.pathname}${current.search}${current.hash}`);
  }, [activeProject, activeProjectId, activeTask, activeTaskId]);

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
  const handleCreateTask = useCallback((projectId: string, initialTask?: Partial<Task>) => {
    const task: Task = {
      id: generateId(), projectId, name: initialTask?.name || '新对话',
      messages: initialTask?.messages || [], model: initialTask?.model || '', providerId: initialTask?.providerId || '',
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

  const handleRenameTask = useCallback((projectId: string, taskId: string, name: string) => {
    setProjects(prev => prev.map(p => p.id === projectId ? {
      ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, name, updatedAt: Date.now() } : t),
      updatedAt: Date.now()
    } : p));
  }, []);

  const handleUpdateTask = useCallback((task: Task) => {
    setProjects(prev => prev.map(p => ({
      ...p,
      tasks: p.tasks.map(t => t.id === task.id ? { ...task, updatedAt: Date.now() } : t),
      updatedAt: p.id === task.projectId ? Date.now() : p.updatedAt
    })));
  }, []);

  const handlePersistTask = useCallback(async (task: Task) => {
    const next = projectsRef.current.map(project => ({
      ...project,
      tasks: project.tasks.map(current => current.id === task.id
        ? { ...task, updatedAt: Date.now() }
        : current),
      updatedAt: project.id === task.projectId ? Date.now() : project.updatedAt,
    }));
    projectsRef.current = next;
    setProjects(next);
    coordinatorRef.current?.update(next);
    await coordinatorRef.current?.flush('manual');
  }, []);

  const handleLogout = useCallback(async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLogoutError(null);

    const snapshot = projectsRef.current;
    saveProjects(snapshot);
    try {
      const result = await logoutSimpleChatSession({ projects: snapshot });
      if (result.loggedOut) {
        setUser(null);
        setShowLogin(true);
      } else {
        setLogoutError('退出登录失败，请检查网络后重试');
      }
    } finally {
      logoutInFlight.current = false;
    }
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
        <LoginPanel onLogin={async (u: User) => { setUser(u); setShowLogin(false); }} />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {logoutError && (
        <div
          role="alert"
          className="fixed left-1/2 top-4 z-[100] -translate-x-1/2 border border-red-500/40 bg-background px-4 py-2 text-sm text-red-400 shadow-lg"
        >
          {logoutError}
        </div>
      )}
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
        onRenameTask={handleRenameTask}
        onLogout={() => { void handleLogout(); }}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex h-7 shrink-0 items-center justify-end border-b border-border/60 px-3">
          <SimpleChatSyncStatusView
            status={syncSnapshot.status}
            error={syncSnapshot.error}
            onRetry={() => void coordinatorRef.current?.flush('manual')}
          />
        </div>
        <ChatArea
          user={user}
          project={activeProject}
          task={activeTask}
          onUpdateTask={handleUpdateTask}
          onPersistTask={handlePersistTask}
          onUpdateProject={handleUpdateProject}
          onCreateTask={(projectId) => handleCreateTask(projectId)}
          onSelectTask={(task) => setActiveTaskId(task.id)}
          onUpdateAgent={(agent) => activeProject && handleUpdateAgent(activeProject.id, agent)}
          onDeleteAgent={(agentId) => activeProject && handleDeleteAgent(activeProject.id, agentId)}
          onSkillToAgent={(skill) => activeProject && handleSkillToAgent(activeProject.id, skill)}
          onLogout={() => { void handleLogout(); }}
          onBackToWorkspace={() => router.replace('/?view=dashboard')}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>
    </div>
  );
}
