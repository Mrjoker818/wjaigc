"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/simple-chat/sidebar";
import ChatArea from "@/components/simple-chat/chat-area";
import { SimpleChatSyncStatusView } from "@/components/simple-chat/simple-chat-sync-status";
import { LoginPanel } from "@/components/dashboard/login-panel";
import {
  SimpleChatAgent,
  SimpleChatProject as Project, SimpleChatTask as Task,
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

type ProjectUpdater = Project[] | ((current: Project[]) => Project[]);

interface PreReadyProjectCandidate {
  userId: string;
  projects: Project[];
  dirty: boolean;
}

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

function mergeProjects(remote: Project[], local: Project[]): Project[] {
  const localById = new Map(local.map(project => [project.id, project]));
  const remoteIds = new Set(remote.map(project => project.id));
  return [
    ...remote.map(project => localById.get(project.id) ?? project),
    ...local.filter(project => !remoteIds.has(project.id)),
  ];
}

export default function SimpleChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [logoutSyncNotice, setLogoutSyncNotice] = useState<string | null>(null);
  const logoutInFlight = useRef(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const projectsRef = useRef<Project[]>([]);
  const [dataOwnerUserId, setDataOwnerUserId] = useState<string | null>(null);
  const dataOwnerUserIdRef = useRef<string | null>(null);
  const [preReadyCandidate, setPreReadyCandidate] = useState<PreReadyProjectCandidate | null>(null);
  const preReadyCandidateRef = useRef<PreReadyProjectCandidate | null>(null);
  const coordinatorRef = useRef<SimpleChatSyncCoordinator | null>(null);
  const coordinatorUserIdRef = useRef<string | null>(null);
  const coordinatorReadyRef = useRef(false);
  const coordinatorTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const latestUserIdRef = useRef<string | null>(user?.id ?? null);
  latestUserIdRef.current = user?.id ?? null;
  const [syncSnapshot, setSyncSnapshot] = useState<SimpleChatSyncSnapshot>({
    status: 'loading',
    projects: [],
    pendingOperations: [],
    error: null,
  });
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);

  const visibleProjects = user && dataOwnerUserId === user.id
    ? projects
    : user && preReadyCandidate?.userId === user.id
      ? preReadyCandidate.projects
      : [];
  const visibleActiveProjectId = visibleProjects.some(project => project.id === activeProjectId)
    ? activeProjectId
    : null;
  const visibleActiveProject = visibleProjects.find(project => project.id === visibleActiveProjectId) ?? null;
  const visibleActiveTaskId = visibleActiveProject?.tasks.some(task => task.id === activeTaskId)
    ? activeTaskId
    : null;

  const getCurrentUserProjects = useCallback((userId: string): Project[] => {
    if (dataOwnerUserIdRef.current === userId) return projectsRef.current;
    const candidate = preReadyCandidateRef.current;
    return candidate?.userId === userId ? candidate.projects : [];
  }, []);

  const commitProjects = useCallback((updater: ProjectUpdater): Project[] => {
    const userId = user?.id;
    if (!userId) return [];
    const current = getCurrentUserProjects(userId);
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (coordinatorReadyRef.current && coordinatorUserIdRef.current === userId) {
      projectsRef.current = next;
      setProjects(next);
      coordinatorRef.current?.update(next);
    } else {
      const nextCandidate = { userId, projects: next, dirty: true };
      preReadyCandidateRef.current = nextCandidate;
      setPreReadyCandidate(nextCandidate);
      const coordinator = coordinatorUserIdRef.current === userId ? coordinatorRef.current : null;
      void coordinator?.stageLocalProjectsForRecovery(next).catch(() => undefined);
    }
    return next;
  }, [getCurrentUserProjects, user?.id]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  useEffect(() => {
    const handlePageHide = (): void => {
      void coordinatorRef.current?.flush('pagehide');
    };
    const handleOnline = (): void => {
      void coordinatorRef.current?.handleOnline();
    };
    const handleOffline = (): void => {
      const coordinator = coordinatorRef.current;
      if (!coordinator || !coordinatorReadyRef.current) return;
      coordinator.update(coordinator.snapshot().projects);
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Auth
  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      try {
        const data = await fetchSessionPayload();
        if (cancelled) return;
        if (!data.success || !data.user) {
          setShowLogin(true);
          return;
        }

        setUser(data.user);
        setShowLogin(false);
      } catch {
        if (!cancelled) setShowLogin(true);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let cancelled = false;
    let coordinator: SimpleChatSyncCoordinator | null = null;
    let unsubscribe: (() => void) | null = null;
    if (preReadyCandidateRef.current?.userId !== userId) {
      preReadyCandidateRef.current = null;
      setPreReadyCandidate(null);
    }
    const publishProjects = (loaded: Project[]): void => {
      projectsRef.current = loaded;
      setProjects(loaded);
      dataOwnerUserIdRef.current = userId;
      setDataOwnerUserId(userId);

      const currentProject = loaded.find(project => project.id === activeProjectIdRef.current);
      const currentTaskExists = currentProject?.tasks.some(task => task.id === activeTaskIdRef.current) ?? false;
      if (currentProject && currentTaskExists) return;

      const requestedProjectId = new URLSearchParams(window.location.search).get('projectId');
      const requestedTaskId = new URLSearchParams(window.location.search).get('taskId');
      const initial = selectInitialSimpleChatProject(loaded, requestedProjectId, requestedTaskId);
      activeProjectIdRef.current = initial?.projectId ?? null;
      activeTaskIdRef.current = initial?.taskId ?? null;
      setActiveProjectId(initial?.projectId ?? null);
      setActiveTaskId(initial?.taskId ?? null);
    };

    const applySnapshot = (nextSnapshot: SimpleChatSyncSnapshot): void => {
      if (cancelled) return;
      setSyncSnapshot(nextSnapshot);
      if (nextSnapshot.status !== 'synced' && nextSnapshot.status !== 'syncing') return;

      coordinatorReadyRef.current = true;
      const candidate = preReadyCandidateRef.current?.userId === userId
        ? preReadyCandidateRef.current
        : null;
      let loaded = candidate?.dirty
        ? mergeProjects(nextSnapshot.projects, candidate.projects)
        : nextSnapshot.projects;
      let shouldUpdate = candidate?.dirty === true;
      if (loaded.length === 0) {
        loaded = [createDefaultProject()];
        shouldUpdate = true;
      }
      preReadyCandidateRef.current = null;
      setPreReadyCandidate(null);
      if (shouldUpdate) coordinator?.update(loaded);
      publishProjects(loaded);
    };

    const initialize = async (): Promise<void> => {
      await coordinatorTransitionRef.current;
      if (cancelled || latestUserIdRef.current !== userId) return;
      coordinator = createSimpleChatSyncCoordinator({
        store: createIndexedDbSimpleChatEnvelopeStore(),
      });
      coordinatorRef.current = coordinator;
      coordinatorUserIdRef.current = userId;
      coordinatorReadyRef.current = false;
      setSyncSnapshot({ status: 'loading', projects: [], pendingOperations: [], error: null });
      unsubscribe = coordinator.subscribe(applySnapshot);
      const initialized = await coordinator.initialize(userId);
      if (cancelled) return;
      applySnapshot(initialized);
    };

    void initialize();
    return () => {
      cancelled = true;
      coordinatorReadyRef.current = false;
      unsubscribe?.();
      if (coordinator === null) return;
      const ownsCoordinator = coordinatorRef.current === coordinator;
      if (ownsCoordinator) coordinatorRef.current = null;
      if (coordinatorUserIdRef.current === userId) coordinatorUserIdRef.current = null;
      if (ownsCoordinator && latestUserIdRef.current === userId) {
        void coordinator.flush('user-switch');
        void coordinator.dispose();
      } else {
        const disposal = coordinator.dispose({ flush: false });
        coordinatorTransitionRef.current = disposal.catch(() => undefined);
      }
    };
  }, [user?.id]);

  const activeProject = visibleActiveProject;
  const activeTask = activeProject?.tasks.find(t => t.id === visibleActiveTaskId) ?? null;

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
    commitProjects(prev => [...prev, p]);
    setActiveProjectId(p.id);
    setActiveTaskId(p.tasks[0].id);
  }, [commitProjects]);

  const handleUpdateProject = useCallback((project: Project) => {
    commitProjects(prev => prev.map(p => p.id === project.id ? {
      ...project,
      tasks: p.tasks,
      updatedAt: Date.now(),
    } : p));
  }, [commitProjects]);

  const handleDeleteProject = useCallback((id: string) => {
    commitProjects(prev => {
      const remaining = prev.filter(p => p.id !== id);
      if (activeProjectId === id) {
        const next = remaining[0];
        setActiveProjectId(next?.id ?? null);
        setActiveTaskId(next?.tasks[0]?.id ?? null);
      }
      return remaining;
    });
  }, [activeProjectId, commitProjects]);

  const handleRenameProject = useCallback((id: string, name: string) => {
    commitProjects(prev => prev.map(p => p.id === id ? { ...p, name, updatedAt: Date.now() } : p));
  }, [commitProjects]);

  // Task ops
  const handleCreateTask = useCallback((projectId: string, initialTask?: Partial<Task>) => {
    const task: Task = {
      id: generateId(), projectId, name: initialTask?.name || '新对话',
      messages: initialTask?.messages || [], model: initialTask?.model || '', providerId: initialTask?.providerId || '',
      createdAt: Date.now(), updatedAt: Date.now()
    };
    commitProjects(prev => prev.map(p => p.id === projectId ? { ...p, tasks: [...p.tasks, task], updatedAt: Date.now() } : p));
    setActiveTaskId(task.id);
  }, [commitProjects]);

  const handleDeleteTask = useCallback((projectId: string, taskId: string) => {
    commitProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const remaining = p.tasks.filter(t => t.id !== taskId);
      if (activeTaskId === taskId) setActiveTaskId(remaining[0]?.id ?? null);
      return { ...p, tasks: remaining, updatedAt: Date.now() };
    }));
  }, [activeTaskId, commitProjects]);

  const handleRenameTask = useCallback((projectId: string, taskId: string, name: string) => {
    commitProjects(prev => prev.map(p => p.id === projectId ? {
      ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, name, updatedAt: Date.now() } : t),
      updatedAt: Date.now()
    } : p));
  }, [commitProjects]);

  const handleUpdateTask = useCallback((task: Task) => {
    commitProjects(prev => prev.map(p => ({
      ...p,
      tasks: p.tasks.map(t => t.id === task.id ? { ...task, updatedAt: Date.now() } : t),
      updatedAt: p.id === task.projectId ? Date.now() : p.updatedAt
    })));
  }, [commitProjects]);

  const handlePersistTask = useCallback(async (task: Task) => {
    const userId = user?.id;
    if (!userId) return;
    const next = getCurrentUserProjects(userId).map(project => ({
      ...project,
      tasks: project.tasks.map(current => current.id === task.id
        ? { ...task, updatedAt: Date.now() }
        : current),
      updatedAt: project.id === task.projectId ? Date.now() : project.updatedAt,
    }));
    commitProjects(next);
    await coordinatorRef.current?.flush('manual');
  }, [commitProjects, getCurrentUserProjects, user?.id]);

  const handleLogout = useCallback(async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLogoutError(null);
    setLogoutSyncNotice(null);

    const userId = user?.id;
    const coordinator = userId && coordinatorUserIdRef.current === userId
      ? coordinatorRef.current
      : null;
    if (!coordinator) {
      logoutInFlight.current = false;
      setLogoutError('同步尚未就绪，请稍后重试');
      return;
    }
    try {
      const result = await logoutSimpleChatSession({
        flush: async () => {
          const candidate = preReadyCandidateRef.current?.userId === userId
            ? preReadyCandidateRef.current
            : null;
          let stagingError: unknown = null;
          if (candidate !== null) {
            try {
              await coordinator.stageLocalProjectsForRecovery(candidate.projects);
            } catch (error) {
              stagingError = error;
            }
          }
          try {
            await coordinator.flush('logout');
          } catch (error) {
            throw stagingError ?? error;
          }
          if (stagingError !== null) throw stagingError;
          const syncSnapshot = coordinator.snapshot();
          if (
            syncSnapshot.status !== 'synced'
            || syncSnapshot.pendingOperations.length !== 0
          ) {
            throw new Error('Simple chat logout sync did not complete');
          }
        },
      });
      if (result.loggedOut) {
        const shouldContinueSync = result.sync === 'failed' || result.sync === 'timed-out';
        if (shouldContinueSync) {
          setLogoutSyncNotice('同步未完成，将在下次登录继续同步');
        }
        await coordinator.dispose({ flush: false });
        if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
        if (coordinatorUserIdRef.current === userId) coordinatorUserIdRef.current = null;
        coordinatorReadyRef.current = false;
        projectsRef.current = [];
        dataOwnerUserIdRef.current = null;
        if (!shouldContinueSync) preReadyCandidateRef.current = null;
        activeProjectIdRef.current = null;
        activeTaskIdRef.current = null;
        setProjects([]);
        setDataOwnerUserId(null);
        if (!shouldContinueSync) setPreReadyCandidate(null);
        setActiveProjectId(null);
        setActiveTaskId(null);
        setUser(null);
        setShowLogin(true);
      } else {
        setLogoutError('退出登录失败，请检查网络后重试');
      }
    } finally {
      logoutInFlight.current = false;
    }
  }, [user?.id]);

  // Agent ops
  const handleCreateAgent = useCallback((projectId: string, agent: SimpleChatAgent) => {
    commitProjects(prev => prev.map(p => p.id === projectId ? {
      ...p, agents: [...p.agents, agent], updatedAt: Date.now()
    } : p));
  }, [commitProjects]);

  const handleUpdateAgent = useCallback((projectId: string, agent: SimpleChatAgent) => {
    commitProjects(prev => prev.map(p => p.id === projectId ? {
      ...p, agents: p.agents.map(a => a.id === agent.id ? agent : a), updatedAt: Date.now()
    } : p));
  }, [commitProjects]);

  const handleDeleteAgent = useCallback((projectId: string, agentId: string) => {
    commitProjects(prev => prev.map(p => p.id === projectId ? {
      ...p, agents: p.agents.filter(a => a.id !== agentId), updatedAt: Date.now()
    } : p));
  }, [commitProjects]);

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
        {logoutSyncNotice && (
          <div
            role="status"
            className="fixed left-1/2 top-4 z-[100] -translate-x-1/2 border border-amber-500/40 bg-background px-4 py-2 text-sm text-amber-500 shadow-lg"
          >
            {logoutSyncNotice}
          </div>
        )}
        <LoginPanel onLogin={async (u: User) => {
          setLogoutSyncNotice(null);
          setUser(u);
          setShowLogin(false);
        }} />
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
        projects={visibleProjects}
        activeProjectId={visibleActiveProjectId}
        activeTaskId={visibleActiveTaskId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onSelectProject={id => { setActiveProjectId(id); const p = visibleProjects.find(x => x.id === id); setActiveTaskId(p?.tasks[0]?.id ?? null); }}
        onSelectTask={id => setActiveTaskId(id)}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
        onCreateTask={handleCreateTask}
        onDeleteTask={handleDeleteTask}
        onRenameTask={handleRenameTask}
        onLogout={() => { void handleLogout(); }}
      />
      <div className="flex-1 flex flex-col min-w-0 w-full">
        <div className="flex h-7 shrink-0 items-center justify-end border-b border-border/60 px-3">
          <SimpleChatSyncStatusView
            status={syncSnapshot.status}
            error={syncSnapshot.error}
            onRetry={() => void coordinatorRef.current?.handleOnline()}
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
