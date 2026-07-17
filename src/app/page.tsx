'use client';

import { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getResumedTaskPollingOutcome, RESUMED_TASK_MAX_POLL_ATTEMPTS } from '@/lib/resumed-task-polling';
import { hasDirectVideoPollingTimedOut } from '@/lib/video-task-polling';
import { shouldPersistProcessingPlaceholder } from '@/lib/canvas-task-placeholders';
import { InfiniteCanvas, CanvasImage, ImageGroup } from '@/components/infinite-canvas';
import { IncrementalHistoryManager } from '@/lib/canvas-incremental-history';
import { TreeHistoryManager, type VersionNode } from '@/lib/canvas-tree-history';
import { createAutoConnection, type ConnectionRelationType } from '@/lib/canvas-connections';
import { GenerationPanel, GenerationParams, CtrlRefSelection } from '@/components/generation-panel';
import VideoGenerationPanel, { type VideoGenerationPanelHandle } from '@/components/video-generation-panel';
import { ImagePreview } from '@/components/image-preview';
import { ChatPanel } from '@/components/chat-panel';
import { PromptEquation } from '@/components/prompt-equation';

import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Image as ImageIcon, MessageSquare, Sparkles, ChevronLeft, ChevronRight, X, Bell } from 'lucide-react';
import NodeEditor from '@/components/node-editor';
import WorkflowHub from '@/components/workflow-hub';
import DashboardView from '@/components/dashboard/dashboard-view';
import { type Workflow } from '@/lib/workflow-engine';
import { ImageEditor } from '@/components/image-editor';
import { LoginPanel } from '@/components/dashboard/login-panel';
import { ProjectDataPanel } from '@/components/project-data-panel';

import { HelpGuide } from '@/components/help-guide';
import { FavoritesPanel } from '@/components/favorites-panel';
import PromptTemplatePanel from '@/components/prompt-template-panel';
import { taskEventsClient } from '@/lib/task-events-client';

interface FavoriteItem {
  id: number;
  user_id: string;
  username: string;
  image_url: string;
  prompt: string;
  negative_prompt: string;
  model: string;
  model_name: string;
  aspect_ratio: string;
  quality: string;
  image_width: number;
  image_height: number;
  original_width: number;
  original_height: number;
  api_provider: string;
  api_base_url: string;
  source_type: string;
  created_at: number;
}
import { User, Project, ImageGroupData, CanvasImage as PersistableCanvasImage } from '@/lib/user-types';
import { UserManager as UserManagerCore } from '@/lib/user-manager';
import { toStableImageUrl, awaitStableImageUrl } from '@/lib/stable-image-url';
import { APP_FULL_VERSION_LABEL, APP_NAME } from '@/config/app-meta';

type ThemeStyle = 'gold' | 'monochrome';
type ActivePanel = 'generate' | 'video' | 'chat';


function recordUserData(input: {
  userId?: string;
  area: 'images' | 'chat' | 'projects' | 'uploads' | 'layers' | 'exports' | '3d';
  type: string;
  filename?: string;
  content?: string;
  dataUrl?: string;
  metadata?: Record<string, unknown>;
  payload?: unknown;
}) {
  if (!input.userId) return;
  void fetch('/api/user-data/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).catch(() => undefined);
}

function getCanvasImageDisplaySize(naturalWidth: number, naturalHeight: number) {
  const safeWidth = Math.max(1, naturalWidth || 512);
  const safeHeight = Math.max(1, naturalHeight || 512);
  const maxDisplaySide = 420;
  const scale = Math.min(maxDisplaySide / safeWidth, maxDisplaySide / safeHeight, 1);

  return {
    width: Math.round(safeWidth * scale),
    height: Math.round(safeHeight * scale),
  };
}

function loadCanvasImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 512, height: 512 });
    img.src = url;
  });
}

function CanvasApp() {
  const [images, setImagesRaw] = useState<CanvasImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<CanvasImage | null>(null);

  // ====== Incremental Diff Undo (Ctrl+Z) / Redo (Ctrl+Shift+Z) History ======
  // Uses IncrementalHistoryManager for O(changes) memory instead of O(n) full snapshots.
  // Dragging one image records only {x, y} change, not the entire image array.
  const incrementalHistoryRef = useRef<IncrementalHistoryManager<CanvasImage>>(new IncrementalHistoryManager<CanvasImage>(100));
  const isMountedRef = useRef(true);
  const prevImagesRef = useRef<CanvasImage[]>([]);
  // ★ 跳过历史记录标记：项目加载/服务器同步等非用户操作不记录 undo diff
  // 防止 Ctrl+Z 撤销到项目加载前的空画布状态
  const skipHistoryRef = useRef(false);

  // ====== Tree History (Version History Panel) ======
  // 树状版本历史，支持分支和任意节点回溯
  const treeHistoryRef = useRef<TreeHistoryManager>(new TreeHistoryManager({ maxNodes: 50 }));
  const [, ] = useState<VersionNode[]>([]);

  // P2-1: 画布连线状态
  const [canvasConnections, setCanvasConnections] = useState<import('@/lib/canvas-connections').CanvasConnection[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  // Wrap setImages to record incremental diff before each change
  const setImages = useCallback((action: React.SetStateAction<CanvasImage[]>) => {
    setImagesRaw(prev => {
      // Apply the change first
      const next = typeof action === 'function' ? action(prev) : action;

      // ★ 检测被删除的图片ID，注册到 UserManagerCore 防止服务器同步恢复
      // 仅在非服务器同步期间检测，避免误将服务器端删除注册为本地删除
      if (next.length < prev.length && !serverSyncMergeRef.current) {
        const nextIdSet = new Set(next.map(img => img.id));
        const deletedIds = prev.filter(img => !nextIdSet.has(img.id)).map(img => img.id).filter(Boolean);
        if (deletedIds.length > 0) {
          try {
            UserManagerCore.getInstance().recordDeletedImageIds(deletedIds);
          } catch { /* non-blocking */ }
        }
      }

      // Record diff: if prevImagesRef is stale, squash from stale→prev and prev→next into one step
      // ★ 跳过非用户操作（项目加载/服务器同步）的 diff 记录，防止 Ctrl+Z 撤销到空画布
      if (!skipHistoryRef.current) {
        const baseState = prevImagesRef.current === prev ? prev : prevImagesRef.current;
        if (baseState.length > 0 || next.length > 0) {
          incrementalHistoryRef.current.recordChange(baseState, next);
        }
      }

      prevImagesRef.current = next;
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (!incrementalHistoryRef.current.canUndo()) return;
    // Flush pending diff and apply reverse
    const result = incrementalHistoryRef.current.undo(prevImagesRef.current);
    prevImagesRef.current = result;
    setImagesRaw(result);
  }, []);

  const handleRedo = useCallback(() => {
    if (!incrementalHistoryRef.current.canRedo()) return;
    const result = incrementalHistoryRef.current.redo(prevImagesRef.current);
    prevImagesRef.current = result;
    setImagesRaw(result);
  }, []);
  const [, setActiveGenerationCount] = useState(0);
  const [previewImage, setPreviewImage] = useState<CanvasImage | null>(null);
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>('gold');
  const themeStyleRef = useRef(themeStyle);
  themeStyleRef.current = themeStyle;
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>('generate');
  // 从工作台加载指定项目
  const loadProjectById = useCallback(async (projectId: string) => {
    try {
      // ★ 加载项目前：清空 undo 历史 + 跳过 diff 记录，防止 Ctrl+Z 撤销到空画布
      skipHistoryRef.current = true;
      incrementalHistoryRef.current.clear();
      prevImagesRef.current = [];

      const userMgr = UserManagerCore.getInstance();
      const projects = userMgr.getProjects();
      const targetProject = projects.find((p: Project) => p.id === projectId);
      if (targetProject) {
        setCurrentProject(targetProject);
        // ★ 调试日志：追踪项目加载
        console.log('[page] loadProjectById:', targetProject.id, targetProject.name, 'canvasImages:', targetProject.canvasImages?.length || 0);
        if (targetProject.canvasImages && targetProject.canvasImages.length > 0) {
          setImages(targetProject.canvasImages.map(img => ({
            id: img.id,
            url: img.url,
            prompt: img.prompt || '',
            modifyPrompt: img.modifyPrompt || '',
            model: img.model || '',
            quality: img.quality || '',
            aspectRatio: img.aspectRatio || '',
            stylePreset: img.stylePreset || '',
            category: img.category || '',
            size: img.size || '',
            groupId: img.groupId || '',
            threeDModelUrl: img.threeDModelUrl || '',
            threeDModelUrls: img.threeDModelUrls || undefined,
            x: img.x,
            y: img.y,
            width: img.width || 256,
            height: img.height || 256,
            originalWidth: img.originalWidth || 512,
            originalHeight: img.originalHeight || 512,
            svgDataUrl: img.svgDataUrl || undefined,
            // Video fields — must be preserved to avoid data loss on project load
            videoUrl: img.videoUrl || undefined,
            videoDuration: img.videoDuration || undefined,
            videoThumbnailUrl: img.videoThumbnailUrl || undefined,
            mediaType: img.mediaType || undefined,
            isPlaying: img.isPlaying || false,
            // Metadata fields — must be preserved for display
            modelName: img.modelName || undefined,
            apiProvider: img.apiProvider || undefined,
            generatedFromImageId: img.generatedFromImageId || undefined,
            relationType: img.relationType || undefined,
            isProcessingPlaceholder: img.isProcessingPlaceholder || false,
            processing: img.processing || undefined,
          })) as CanvasImage[]);
        } else {
          setImages([]);
        }
        if (targetProject.metadata?.groups) {
          groupsRef.current = targetProject.metadata.groups as ImageGroupData[];
        }
      }

      // ★ 加载完成后恢复 diff 记录（延迟，确保 setImages 的回调已执行完毕）
      setTimeout(() => { skipHistoryRef.current = false; }, 0);
    } catch (e) {
      skipHistoryRef.current = false;
      console.error('加载项目失败:', e);
    }
  }, [setImages]);

  const [appMode, setAppMode] = useState<'canvas' | 'node' | 'workflow-hub' | 'dashboard'>('canvas');
  const [pendingModeSwitch, setPendingModeSwitch] = useState<'node' | 'workflow-hub' | 'dashboard' | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  useRouter();
  const searchParams = useSearchParams();

  const [showProjectData, setShowProjectData] = useState(false);
  const [navigateToImageId, setNavigateToImageId] = useState<string | null>(null);
  const [showHelpGuide, setShowHelpGuide] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showPromptTemplate, setShowPromptTemplate] = useState(false);
  const [favoriteParams, setFavoriteParams] = useState<{
    prompt: string;
    negativePrompt?: string;
    model?: string;
    aspectRatio?: string;
    quality?: string;
  } | null>(null);
  const [initialGroups, setInitialGroups] = useState<ImageGroup[]>([]);
  const [, setViewState] = useState<{ offsetX: number; offsetY: number; zoom: number } | null>(null);
  const viewStateRef = useRef<{ offsetX: number; offsetY: number; zoom: number } | null>(null);
  const [ctrlRefSelections, setCtrlRefSelections] = useState<CtrlRefSelection[]>([]);
  // Alt+Click inline reference markers (displayed as numbered tags in the prompt textarea)
  const [altRefMarkers, setAltRefMarkers] = useState<Array<{id: string; url: string; number: number}>>([]);
  const [showPromptEquation, setShowPromptEquation] = useState(false);
  const [announcement, setAnnouncement] = useState<{ text: string; type: string; id: string; displayMode?: string } | null>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const dismissedAnnouncementsRef = useRef<Set<string>>(new Set());

  // Language-based image editing state
  const [showImageEditor, setShowImageEditor] = useState(false);
  const [editingImage, setEditingImage] = useState<CanvasImage | null>(null);

  // Floating video panel state
  const [showVideoPanel, setShowVideoPanel] = useState(false);

  useEffect(() => {
    const openVideoPanel = () => {
      setShowImageEditor(false);
      setShowVideoPanel(true);
    };
    window.addEventListener('wujie:open-video-panel', openVideoPanel);
    return () => window.removeEventListener('wujie:open-video-panel', openVideoPanel);
  }, []);

  useEffect(() => {
    const closeExternalToolPanels = () => {
      setShowImageEditor(false);
      setShowVideoPanel(false);
    };
    window.addEventListener('wujie:canvas-tool-opened', closeExternalToolPanels);
    return () => window.removeEventListener('wujie:canvas-tool-opened', closeExternalToolPanels);
  }, []);

  // Chat panel integration states
  const [chatInitialImage, setChatInitialImage] = useState<CanvasImage | null>(null);
  const [chatTabOpen, setChatTabOpen] = useState(false);

  // Current chat model info from ChatPanel (used for vision-prompt)
  const [currentChatModelInfo, setCurrentChatModelInfo] = useState<{
    model: string; providerId: string; providerPreset?: string;
  } | null>(null);

  // ★ 检测画布中是否有进行中的生图任务
  const hasActiveCanvasTasks = images.some(img => shouldPersistProcessingPlaceholder(img) || img.processing?.status === 'processing');

  // 安全切换模式：有进行中任务时弹窗确认
  const safeSwitchMode = useCallback((targetMode: 'node' | 'workflow-hub' | 'dashboard') => {
    if (hasActiveCanvasTasks) {
      setPendingModeSwitch(targetMode);
    } else {
      setAppMode(targetMode);
    }
  }, [hasActiveCanvasTasks]);

  const confirmModeSwitch = useCallback(() => {
    // 不移除占位框 — 轮询在后台继续运行，结果通过 setImages 持久化
    // 切换回画布时即可看到已完成的结果
    setPendingModeSwitch(null);
    if (pendingModeSwitch) {
      setAppMode(pendingModeSwitch);
    }
  }, [pendingModeSwitch]);

  const cancelModeSwitch = useCallback(() => {
    setPendingModeSwitch(null);
  }, []);

  // Oh My Prompt - Vision Prompt state
  const [visionPromptEnabled, setVisionPromptEnabled] = useState(false);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);
  const [visionResult, setVisionResult] = useState<import('@/components/oh-my-prompt').VisionApiResultData | null>(null);

  // Fetch system announcement
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        const dismissed = localStorage.getItem('dismissed_announcements');
        if (dismissed) {
          dismissedAnnouncementsRef.current = new Set(JSON.parse(dismissed));
        }
        const res = await fetch('/api/announcement', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json() as { success: boolean; announcement?: { text: string; type: string; enabled: boolean; displayMode?: string } };
          if (data.success && data.announcement?.enabled && data.announcement.text?.trim()) {
            const displayMode = data.announcement.displayMode || 'banner';
            const id = `${displayMode}:${data.announcement.text.slice(0, 64)}`;
            if (!dismissedAnnouncementsRef.current.has(id)) {
              setAnnouncement({ text: data.announcement.text, type: data.announcement.type || 'info', id, displayMode });
              setShowAnnouncement(true);
            }
          }
        }
      } catch { /* ignore */ }
    };
    fetchAnnouncement();
  }, []);

  const dismissAnnouncement = useCallback(() => {
    if (!announcement) return;
    dismissedAnnouncementsRef.current.add(announcement.id);
    localStorage.setItem('dismissed_announcements', JSON.stringify([...dismissedAnnouncementsRef.current]));
    setShowAnnouncement(false);
  }, [announcement]);

  // Initialize current user and admin UI state
  useEffect(() => {
    let cancelled = false;
    const initCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' });
        const data = await response.json() as { success?: boolean; user?: User | null };
        if (!cancelled && data.success && data.user) {

          const userMgr = UserManagerCore.getInstance();
          const hydratedUser = await userMgr.upsertUserFromServer(data.user);
          setCurrentUser(hydratedUser);
          // 确保从服务器加载最新项目数据（跨设备同步保障）
          await userMgr.loadProjectsFromServer();

          // 检查 URL 中是否有 projectId 参数（从工作台跳转过来）
          const projectId = searchParams.get('projectId');

          if (projectId) {
            // ★ 初始化加载项目：跳过 diff 记录，防止 Ctrl+Z 撤销到空画布
            skipHistoryRef.current = true;
            incrementalHistoryRef.current.clear();
            prevImagesRef.current = [];

            // 从工作台跳转过来，加载指定项目
            try {
              const projects = userMgr.getProjects();
              const targetProject = projects.find((p: Project) => p.id === projectId);
              if (targetProject) {
                setCurrentProject(targetProject);
                if (targetProject.canvasImages && targetProject.canvasImages.length > 0) {
                  setImages(targetProject.canvasImages.map(img => ({
                    id: img.id,
                    url: img.url,
                    prompt: img.prompt || '',
                    modifyPrompt: img.modifyPrompt || '',
                    model: img.model || '',
                    quality: img.quality || '',
                    aspectRatio: img.aspectRatio || '',
                    stylePreset: img.stylePreset || '',
                    category: img.category || '',
                    size: img.size || '',
                    groupId: img.groupId || '',
                    threeDModelUrl: img.threeDModelUrl || '',
                    threeDModelUrls: img.threeDModelUrls || undefined,
                    x: img.x,
                    y: img.y,
                    width: img.width || 256,
                    height: img.height || 256,
                    originalWidth: img.originalWidth || 512,
                    originalHeight: img.originalHeight || 512,
                    createdAt: img.createdAt || Date.now(),
                    modelName: img.modelName || '',
                    apiProvider: img.apiProvider || '',
                    apiBaseUrl: img.apiBaseUrl || '',
                    // Video fields — must be preserved to avoid data loss on project load
                    videoUrl: img.videoUrl || undefined,
                    videoDuration: img.videoDuration || undefined,
                    videoThumbnailUrl: img.videoThumbnailUrl || undefined,
                    mediaType: img.mediaType || undefined,
                    isPlaying: img.isPlaying || false,
                    svgDataUrl: img.svgDataUrl || undefined,
                    generatedFromImageId: img.generatedFromImageId || undefined,
                    relationType: img.relationType || undefined,
                    isProcessingPlaceholder: img.isProcessingPlaceholder || false,
                    processing: img.processing || undefined,
                  })) as CanvasImage[]);
                  // 恢复分组数据
                  const metaGroups = targetProject.metadata?.groups;
                  let restoredGroups: Array<{id: string; name: string; note: string; imageIds: string[]; x: number; y: number; collapsed: boolean}> = [];
                  if (metaGroups && metaGroups.length > 0) {
                    restoredGroups = metaGroups.map(g => ({
                      id: g.id,
                      name: g.name,
                      note: g.note || '',
                      imageIds: g.imageIds,
                      x: g.x || 0,
                      y: g.y || 0,
                      collapsed: g.collapsed || false,
                    }));
                  } else {
                    try {
                      const lsGroups = localStorage.getItem(`wujie-groups-${targetProject.id}`);
                      if (lsGroups) restoredGroups = JSON.parse(lsGroups);
                    } catch {}
                  }
                  setInitialGroups(restoredGroups);
                  // 恢复视图状态
                  const metaViewState = targetProject.metadata?.viewState;
                  if (metaViewState && typeof metaViewState === 'object' && 'offsetX' in metaViewState) {
                    setViewState(metaViewState as { offsetX: number; offsetY: number; zoom: number });
                    viewStateRef.current = metaViewState as { offsetX: number; offsetY: number; zoom: number };
                  }
                }
              }
            } catch { /* non-blocking */ }
            // ★ 初始化项目加载完成，恢复 diff 记录
            setTimeout(() => { skipHistoryRef.current = false; }, 0);
          } else {
            // 无 projectId → 显示工作台视图（在画布页面内部）
            setAuthChecked(true);
            setAppMode('dashboard');
            return;
          }
          setAuthChecked(true);
          return;
        }
      } catch {}

      try {
        const userMgr = UserManagerCore.getInstance();
        userMgr.logout();
        if (cancelled) return;
        setCurrentUser(null);
      } catch {}
      if (!cancelled) setAuthChecked(true);
    };
    void initCurrentUser();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setImages]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [ohMyPromptOpen, setOhMyPromptOpen] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const currentProjectRef = useRef(currentProject);
  currentProjectRef.current = currentProject;
  const videoPanelRef = useRef<VideoGenerationPanelHandle>(null);
  const shotTaskIdMapRef = useRef<Map<string, string>>(new Map());
  const groupsRef = useRef<ImageGroupData[]>([]);

  const stabilizeCanvasImages = useCallback((items: Array<{ id: string; url: string }>) => {
    const toStabilize = items.filter(({ url }) => url && !url.startsWith('data:'));
    if (toStabilize.length === 0) return;

    // 批量并发稳定化所有 URL，然后一次性更新状态，避免 N 次 React 重渲染
    void Promise.all(
      toStabilize.map(async ({ id, url }) => {
        try {
          const stableUrl = await toStableImageUrl(url);
          return { id, stableUrl: stableUrl !== url ? stableUrl : null };
        } catch {
          return { id, stableUrl: null };
        }
      })
    ).then(results => {
      const updates = new Map<string, string>();
      for (const { id, stableUrl } of results) {
        if (stableUrl) updates.set(id, stableUrl);
      }
      if (updates.size === 0) return;
      setImages(prev => prev.map(img => {
        const newUrl = updates.get(img.id);
        return newUrl ? { ...img, url: newUrl } : img;
      }));
    });
  }, [setImages]);

  // 从 simple-chat 传来的图片桥接
  useEffect(() => {
    const bridgeKey = 'wujie_canvas_bridge';
    try {
      const raw = localStorage.getItem(bridgeKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      localStorage.removeItem(bridgeKey);
      if (!data?.images || !Array.isArray(data.images) || data.images.length === 0) return;
      const timestamp = Date.now();
      const newImages: CanvasImage[] = data.images.map((url: string, idx: number) => ({
        id: `chat-bridge-${timestamp}-${idx}`,
        url,
        prompt: '',
        model: '',
        quality: 'standard',
        aspectRatio: '1:1',
        stylePreset: '',
        category: 'general',
        size: '1024x1024',
        x: 200 + (idx % 5) * 220,
        y: 200 + Math.floor(idx / 5) * 220,
        width: 512,
        height: 512,
        originalWidth: 1024,
        originalHeight: 1024,
        isAiGenerated: true,
      }));
      setImagesRaw(prev => [...prev, ...newImages]);
    } catch {
      // ignore parse errors
    }
  }, []);

  // 应用主题
  useEffect(() => {
    const root = document.documentElement;
    if (themeStyle === 'monochrome') {
      root.style.setProperty('--theme-accent', '#ffffff');
      root.style.setProperty('--theme-accent-light', '#333333');
      root.style.setProperty('--theme-accent-dark', '#1a1a1a');
      root.classList.add('theme-monochrome');
      root.classList.remove('theme-gold');
    } else {
      root.style.setProperty('--theme-accent', '#d4af37');
      root.style.setProperty('--theme-accent-light', '#daa520');
      root.style.setProperty('--theme-accent-dark', '#b8860b');
      root.classList.add('theme-gold');
      root.classList.remove('theme-monochrome');
    }
  }, [themeStyle]);

  // 自动保存画布图片到当前项目
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSaveSignatureRef = useRef<string | null>(null);
  // 项目切换中标记：防止自动保存回调用旧闭包数据覆盖刚保存的新数据
  const switchingProjectRef = useRef(false);
  // 服务器同步合并中标记：防止自动保存用旧闭包数据覆盖刚从服务器合并的新数据
  const serverSyncMergeRef = useRef(false);
  // ★ 近期删除的图片 ID 集合：防止服务器同步把刚删除的图片恢复回来
  const recentlyDeletedIdsRef = useRef<Set<string>>(new Set());
  // Keep a ref to latest images to avoid stale closure in setTimeout
  const latestImagesRef = useRef(images);
  latestImagesRef.current = images;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const resumedTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const pending = images.filter((image) => image.isProcessingPlaceholder && image.processing?.taskId);

    for (const image of pending) {
      const taskId = image.processing?.taskId;
      if (!taskId || resumedTaskIdsRef.current.has(taskId)) continue;
      resumedTaskIdsRef.current.add(taskId);

      void (async () => {
        for (let attempt = 0; attempt < RESUMED_TASK_MAX_POLL_ATTEMPTS && !cancelled; attempt += 1) {
          try {
            const response = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: image.model || image.modelName, providerId: image.apiProvider }),
            });
            const data = await response.json();
            const videoUrl = data.videoUrl || data.result?.videoUrl;
            const imageUrl = data.imageUrl || data.result?.imageUrl;
            if (data.status === 'completed' && (videoUrl || imageUrl)) {
              setImages((current) => current.map((item) => item.id === image.id ? {
                ...item,
                url: videoUrl || imageUrl,
                videoUrl: videoUrl || undefined,
                mediaType: videoUrl ? 'video' as const : item.mediaType,
                isProcessingPlaceholder: false,
                processing: undefined,
              } : item));
              return;
            }
            if (data.status === 'failed' || data.status === 'cancelled') {
              setImages((current) => current.map((item) => item.id === image.id ? {
                ...item,
                processing: { ...item.processing!, status: 'failed', label: data.error || '生成失败' },
              } : item));
              return;
            }
            setImages((current) => current.map((item) => item.id === image.id ? {
              ...item,
              processing: { ...item.processing!, status: 'processing', progress: Math.max(item.processing?.progress || 0, data.progress || 0), label: data.label || item.processing?.label || '生成中' },
            } : item));
          } catch { /* transient polling errors are retried */ }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        if (!cancelled) {
          const outcome = getResumedTaskPollingOutcome(RESUMED_TASK_MAX_POLL_ATTEMPTS, true);
          if (outcome) {
            setImages((current) => current.map((item) => item.id === image.id ? {
              ...item,
              processing: { ...item.processing!, status: outcome.status, label: outcome.label },
            } : item));
          }
        }
      })();
    }

    return () => { cancelled = true; };
  }, [images, setImages]);

  // ★ 追踪图片删除：当 images 减少时，记录被删除的 ID，5 秒后自动清除
  const prevImageIdsRef2 = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(images.map(img => img.id));
    const prevIds = prevImageIdsRef2.current;
    // 找出被删除的 ID（上一轮有、这一轮没有的）
    const deleted = new Set<string>();
    prevIds.forEach(id => {
      if (!currentIds.has(id)) deleted.add(id);
    });
    if (deleted.size > 0) {
      deleted.forEach(id => recentlyDeletedIdsRef.current.add(id));
      // 5 秒后清除（足够让自动保存完成并同步到服务器）
      setTimeout(() => {
        deleted.forEach(id => recentlyDeletedIdsRef.current.delete(id));
      }, 5000);
    }
    prevImageIdsRef2.current = currentIds;
  }, [images]);
  useEffect(() => {
    if (!currentProject?.id) return;
    // 项目切换进行中时，跳过自动保存，避免旧闭包数据覆盖
    if (switchingProjectRef.current) return;
    // 服务器同步合并中，跳过自动保存，避免旧闭包数据覆盖刚合并的服务器数据
    if (serverSyncMergeRef.current) return;
    // 防抖：1秒后保存
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      // 二次检查：定时器触发时如果正在切换项目，也跳过
      if (switchingProjectRef.current) return;
      const project = currentProjectRef.current;
      if (!project) return;
      // 验证用户一致性：使用 ref 获取最新 userId 避免闭包过期
      const userId = currentUserRef.current?.id;
      if (!userId) return;
      try {
        // 先将 data:/blob: URL 持久化到服务器
        const urlMapping: Record<string, string> = {};
        const sourceUrlMapping: Record<string, string> = {};
        const nonPersistentUrls = latestImagesRef.current.filter(img =>
          img.url.startsWith('data:') || img.url.startsWith('blob:')
        );
        if (nonPersistentUrls.length > 0) {
          const saveResults = await Promise.allSettled(
            nonPersistentUrls.map(async (img) => {
              // blob: 先转 data:
              let urlToSave = img.url;
              if (urlToSave.startsWith('blob:')) {
                try {
                  const resp = await fetch(urlToSave);
                  const blob = await resp.blob();
                  urlToSave = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                  });
                } catch { return null; }
              }
                const saveResp = await fetch('/api/save-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: urlToSave, userId, sourceUrl: img.url }),
              });
              const saveData = await saveResp.json();
              if (saveData.success && saveData.url) {
                return { original: img.url, persisted: saveData.url };
              }
              return null;
            })
          );
          for (const result of saveResults) {
            if (result.status === 'fulfilled' && result.value) {
              urlMapping[result.value.original] = result.value.persisted;
              sourceUrlMapping[result.value.original] = result.value.original;
            }
          }
          // 更新 images 状态中的非持久化 URL
          if (Object.keys(urlMapping).length > 0) {
            setImages(prev => prev.map(img =>
              urlMapping[img.url] ? { ...img, url: urlMapping[img.url], sourceUrl: img.sourceUrl || sourceUrlMapping[img.url] || img.url } : img
            ));
          }
        }

        // 合并 URL 映射后的图片列表（使用 urlMapping 覆盖，避免 stale closure）
        const resolvedImages = latestImagesRef.current.map(img => ({
          ...img,
          url: urlMapping[img.url] || img.url,
        }));
        const persistableCanvasImages = resolvedImages
          .map(img => ({
            id: img.id,
            url: img.url,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            originalWidth: img.originalWidth || img.width * 2,
            originalHeight: img.originalHeight || img.height * 2,
            rotation: 0,
            zIndex: 0,
            createdAt: img.createdAt || Date.now(),
            prompt: img.prompt || '',
            modifyPrompt: img.modifyPrompt || '',
            model: img.model || '',
            quality: img.quality || '',
            aspectRatio: img.aspectRatio || '',
            stylePreset: img.stylePreset || '',
            category: img.category || '',
            size: img.size || '',
            groupId: img.groupId || '',
            threeDModelUrl: img.threeDModelUrl || '',
            threeDModelUrls: img.threeDModelUrls || undefined,
            modelName: img.modelName || '',
            apiProvider: img.apiProvider || '',
            apiBaseUrl: img.apiBaseUrl || '',
            sourceUrl: img.sourceUrl || '',
            generatedFromImageId: img.generatedFromImageId || '',
            svgDataUrl: img.svgDataUrl || '',
            svgUrl: img.svgUrl || '',
            mediaType: img.mediaType || '',
            videoUrl: img.videoUrl || '',
            videoDuration: img.videoDuration || undefined,
            videoThumbnailUrl: img.videoThumbnailUrl || '',
            isProcessingPlaceholder: img.isProcessingPlaceholder || false,
            processing: img.processing,
          }))
          .filter(img => img.url || img.videoUrl || img.svgDataUrl || shouldPersistProcessingPlaceholder(img)) as PersistableCanvasImage[];
        const updatedMeta = {
          ...(project.metadata || {}),
          groups: groupsRef.current,
          viewState: viewStateRef.current,
        };
        const saveSignature = JSON.stringify({
          projectId: project.id,
          images: persistableCanvasImages,
          metadata: updatedMeta,
        });
        if (lastAutoSaveSignatureRef.current === saveSignature) return;

        const autoSaveMgr = UserManagerCore.getInstance();
        autoSaveMgr.updateProject(project.id, {
          canvasImages: persistableCanvasImages,
          metadata: updatedMeta,
        });
        lastAutoSaveSignatureRef.current = saveSignature;
        recordUserData({
          userId,
          area: 'projects',
          type: 'autosave',
          filename: `${project.id}.json`,
          content: JSON.stringify({
            projectId: project.id,
            canvasImages: persistableCanvasImages,
            metadata: {
              ...(project.metadata || {}),
              groups: groupsRef.current,
            },
            savedAt: Date.now(),
          }, null, 2),
          metadata: { projectId: currentProject.id, imageCount: persistableCanvasImages.length },
        });
      } catch {
        // 静默失败，不影响用户体验
      }
    }, 1000);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [images, currentProject?.id, currentUser?.id, setImages]);

  // 页面关闭/刷新前同步保存（localStorage + sendBeacon到服务器）
  // 使用 ref 避免每次 images 变化都重建 beforeunload 监听器
  const currentProjectRef2 = useRef(currentProject);
  currentProjectRef2.current = currentProject;
  useEffect(() => {
    const handleBeforeUnload = () => {
      const proj = currentProjectRef2.current;
      if (!proj) return;
      try {
        const mgr = UserManagerCore.getInstance();
        // 验证用户一致性：确保只保存当前登录用户的数据
        if (!currentUserRef.current?.id) return;
        // 保留所有图片URL，包括 data: URL（避免异步持久化未完成时丢失图片）
        const persistableCanvasImages = latestImagesRef.current
          .map(img => ({
            id: img.id,
            url: img.url,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            originalWidth: img.originalWidth || img.width * 2,
            originalHeight: img.originalHeight || img.height * 2,
            rotation: 0,
            zIndex: 0,
            createdAt: img.createdAt || Date.now(),
            prompt: img.prompt || '',
            modifyPrompt: img.modifyPrompt || '',
            model: img.model || '',
            quality: img.quality || '',
            aspectRatio: img.aspectRatio || '',
            stylePreset: img.stylePreset || '',
            category: img.category || '',
            size: img.size || '',
            groupId: img.groupId || '',
            threeDModelUrl: img.threeDModelUrl || '',
            threeDModelUrls: img.threeDModelUrls || undefined,
            modelName: img.modelName || '',
            apiProvider: img.apiProvider || '',
            apiBaseUrl: img.apiBaseUrl || '',
            sourceUrl: img.sourceUrl || '',
            generatedFromImageId: img.generatedFromImageId || '',
            svgDataUrl: img.svgDataUrl || '',
            svgUrl: img.svgUrl || '',
            mediaType: img.mediaType || '',
            videoUrl: img.videoUrl || '',
            videoDuration: img.videoDuration || undefined,
            videoThumbnailUrl: img.videoThumbnailUrl || '',
            isProcessingPlaceholder: img.isProcessingPlaceholder || false,
            processing: img.processing,
          }))
          .filter(img => img.url || img.videoUrl || shouldPersistProcessingPlaceholder(img)) as PersistableCanvasImage[];
        // 1. localStorage 即时写入
        mgr.updateProject(proj.id, {
          canvasImages: persistableCanvasImages,
          metadata: {
            ...(proj.metadata || {}),
            groups: groupsRef.current,
            viewState: viewStateRef.current,
          },
        });
        // 2. sendBeacon 异步发送到服务器，确保云部署不丢数据
        if (currentUserRef.current?.id) {
          const payload = {
            key: 'projects',
            value: mgr.getProjects().map(p => ({
              id: p.id,
              name: p.name,
              description: p.description,
              canvasImages: p.id === proj.id ? persistableCanvasImages : p.canvasImages,
              metadata: p.id === proj.id ? { ...(proj.metadata || {}), groups: groupsRef.current } : p.metadata,
              settings: p.settings,
              createdAt: p.createdAt,
              updatedAt: p.id === proj.id ? Date.now() : p.updatedAt,
              userId: currentUserRef.current?.id,
            })),
          };
          const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
          // sendBeacon 限制约 64KB，超出则跳过（依赖定期同步兜底）
          if (blob.size <= 65536) {
            navigator.sendBeacon('/api/user-data/sync', blob);
          } else {
            // sendBeacon 超出64KB限制，使用 fetch keepalive 作为 fallback
            try {
              fetch('/api/user-data/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true,
              }).catch(() => {});
            } catch { /* best effort */ }
          }
        }
      } catch { /* best effort */ }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []); // 使用 ref 获取最新值，避免每次 images 变化都重建监听器

  // 定期从服务器同步项目数据（跨设备/跨浏览器数据同步）
  useEffect(() => {
    if (!currentUser) return;
    const syncInterval = setInterval(async () => {
      try {
        const userMgr = UserManagerCore.getInstance();
        await userMgr.loadProjectsFromServer();
      } catch { /* best effort */ }
    }, 30000); // 每30秒同步一次
    return () => clearInterval(syncInterval);
  }, [currentUser]);

  // 监听服务器项目数据变化（周期同步/跨设备同步触发的更新）
  useEffect(() => {
    if (!currentUser) return;
    const userMgr = UserManagerCore.getInstance();
    const unsubscribe = userMgr.onProjectsChanged(() => {
      try {
        // ★ 数据隔离保护：验证当前用户身份，防止跨用户数据污染
        const currentUserId = UserManagerCore.getInstance().getUser()?.id;
        if (!currentUserId || currentUserId !== currentUserRef.current?.id) return;
        // 标记服务器同步合并中，防止自动保存用旧闭包数据覆盖
        serverSyncMergeRef.current = true;
        // ★ 跳过历史记录，防止服务器同步合并被记入 undo 历史
        skipHistoryRef.current = true;
        const projects = userMgr.getProjects();
        const curProjectId = currentProjectRef.current?.id;
        if (curProjectId) {
          const latest = projects.find(p => p.id === curProjectId);
          if (latest) {
            setCurrentProject(latest);
            if (latest.canvasImages) {
              // 保留当前正在处理的占位框（isProcessingPlaceholder），避免服务器同步覆盖导致加载框消失
              const processingPlaceholders = latestImagesRef.current.filter(shouldPersistProcessingPlaceholder);
              // 去重：避免服务器数据中已包含占位框 id 时重复添加
              const serverIds = new Set(latest.canvasImages.map(img => img.id));
              const uniquePlaceholders = processingPlaceholders.filter(
                img => !serverIds.has(img.id)
              );
              // 清理无效图片框：没有 url 且不是处理中占位框的图片（可能是之前生成失败残留）
              // ★ BUG3 修复：如果服务器数据中 URL 为空但本地有有效 URL，不从 validImages 中移除
              // 后续 enrichment 会从 localImgMap 恢复 URL
              const validImages = latest.canvasImages.filter(
                (img) => img.url || shouldPersistProcessingPlaceholder(img) || img._needsPersist
              );
              // ★ 过滤近期删除的图片：防止服务器同步把刚删除的图片恢复回来
              const afterDeletedFilter = validImages.filter(
                (img) => !recentlyDeletedIdsRef.current.has(img.id)
              );
              // ★ 数据隔离：仅从过滤后的服务器图片 ID 集合查找本地补充数据
              const serverImgIdSet = new Set(afterDeletedFilter.map(img => img.id));
              const localImgMap = new Map<string, CanvasImage>();
              for (const li of latestImagesRef.current) {
                // 仅纳入服务器也有的图片 ID，排除不属于当前项目的图片
                if (li.id && serverImgIdSet.has(li.id)) localImgMap.set(li.id, li);
              }
              // ★ BUG3 修复：保留本地独有的图片（服务器尚未同步的新生成图片）
              // 如果本地有图片但服务器没有（syncToServer 还没跑），不要丢失这些图片
              const localOnlyImages = latestImagesRef.current.filter(
                li => li.id && !serverImgIdSet.has(li.id)
                  && !recentlyDeletedIdsRef.current.has(li.id)
                  && !li.isProcessingPlaceholder
                  && li.url // 必须有有效 URL
              );
              const enrichedImages = afterDeletedFilter.map((img) => {
                const localImg = localImgMap.get(img.id);
                const enriched = { ...img };
                // 回填：历史数据 modelName 为空但 model 有值时，用 model 补充
                if ((!enriched.modelName || enriched.modelName === '') && enriched.model) {
                  enriched.modelName = enriched.model;
                }
                // ★ BUG3 关键修复：从本地恢复被 trimDataUrls 清空的 URL
                // 当 localStorage 配额溢出时，trimDataUrls 会将 data:/blob: URL 清空为 ''
                // 服务器同步下来的数据也会有空 URL，必须从本地内存数据恢复
                if ((!enriched.url || enriched.url === '') && localImg?.url) {
                  enriched.url = localImg.url;
                  // 清除 _needsPersist 标记（URL 已恢复）
                  if (enriched._needsPersist) {
                    delete (enriched as Record<string, unknown>)._needsPersist;
                  }
                }
                // ★ 关键修复：保留本地的位置信息（x, y, width, height）
                // 用户可能在本地拖动了图片，但服务器还没同步到最新位置
                // 优先使用本地的位置数据，避免图片"回位"
                // A project sync can arrive after the local task has completed.
                // The stale server placeholder must never put the completed image back into processing.
                if (localImg && !localImg.isProcessingPlaceholder && localImg.url) {
                  enriched.isProcessingPlaceholder = false;
                  enriched.processing = undefined;
                }
                if (localImg) {
                  if (localImg.x !== undefined) enriched.x = localImg.x;
                  if (localImg.y !== undefined) enriched.y = localImg.y;
                  if (localImg.width !== undefined) enriched.width = localImg.width;
                  if (localImg.height !== undefined) enriched.height = localImg.height;
                }
                // 逐字段检查，从本地补充服务器缺失的字段
                if ((!enriched.modelName || enriched.modelName === '') && localImg?.modelName) {
                  enriched.modelName = localImg.modelName;
                }
                if ((!enriched.apiProvider || enriched.apiProvider === '') && localImg?.apiProvider) {
                  enriched.apiProvider = localImg.apiProvider;
                }
                if ((!enriched.originalWidth) && localImg?.originalWidth) {
                  enriched.originalWidth = localImg.originalWidth;
                }
                if ((!enriched.originalHeight) && localImg?.originalHeight) {
                  enriched.originalHeight = localImg.originalHeight;
                }
                if ((!enriched.model || enriched.model === '') && localImg?.model) {
                  enriched.model = localImg.model;
                }
                if ((!enriched.apiBaseUrl || enriched.apiBaseUrl === '') && localImg?.apiBaseUrl) {
                  enriched.apiBaseUrl = localImg.apiBaseUrl;
                }
                // ★ 视频字段回填：服务器同步时保留本地的视频元数据
                if (!enriched.mediaType && localImg?.mediaType) {
                  enriched.mediaType = localImg.mediaType;
                }
                if ((!enriched.videoUrl || enriched.videoUrl === '') && localImg?.videoUrl) {
                  enriched.videoUrl = localImg.videoUrl;
                }
                if (!enriched.videoDuration && localImg?.videoDuration) {
                  enriched.videoDuration = localImg.videoDuration;
                }
                if ((!enriched.videoThumbnailUrl || enriched.videoThumbnailUrl === '') && localImg?.videoThumbnailUrl) {
                  enriched.videoThumbnailUrl = localImg.videoThumbnailUrl;
                }
                // ★ SVG字段回填：保留本地的SVG数据
                if ((!enriched.svgDataUrl || enriched.svgDataUrl === '') && localImg?.svgDataUrl) {
                  enriched.svgDataUrl = localImg.svgDataUrl;
                }
                if ((!enriched.svgUrl || enriched.svgUrl === '') && localImg?.svgUrl) {
                  enriched.svgUrl = localImg.svgUrl;
                }
                // ★ 源图URL和连线关系回填
                if ((!enriched.sourceUrl || enriched.sourceUrl === '') && localImg?.sourceUrl) {
                  enriched.sourceUrl = localImg.sourceUrl;
                }
                if ((!enriched.generatedFromImageId || enriched.generatedFromImageId === '') && localImg?.generatedFromImageId) {
                  enriched.generatedFromImageId = localImg.generatedFromImageId;
                }
                return enriched;
              });
              setImages([
                ...(enrichedImages as CanvasImage[]),
                ...(localOnlyImages as CanvasImage[]),
                ...uniquePlaceholders,
              ]);
              // ★ 调试日志：追踪图片恢复
              console.log('[page] onProjectsChanged: setImages total=', enrichedImages.length + localOnlyImages.length + uniquePlaceholders.length,
                'enriched=', enrichedImages.length, 'localOnly=', localOnlyImages.length, 'placeholders=', uniquePlaceholders.length);
            }
          }
        }
        // 项目列表可能变化（如其他设备新建了项目）
        setCurrentUser({ ...currentUser }); // 触发 UI 刷新
        // 延迟清除同步合并标记，确保 setImages 引起的自动保存跳过本轮
        // ★ 同时恢复历史记录（延迟更久，确保 setImages 回调链完成）
        setTimeout(() => { serverSyncMergeRef.current = false; skipHistoryRef.current = false; }, 2000);
      } catch { /* best effort */ serverSyncMergeRef.current = false; skipHistoryRef.current = false; }
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [currentUser, currentProject?.id, setImages]);

  // ★ 异步持久化 data:/blob: URL：页面加载后自动检测并持久化临时 URL
  // 解决刷新后图片消失的问题：data: URL 在 normalizeImageUrls 中不再被清空，
  // 但需要尽快转换为服务器 URL 以确保跨会话可用
  const persistedDataUrlIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pendingImages = images.filter(img =>
      img.url && (img.url.startsWith('data:') || img.url.startsWith('blob:'))
      && !persistedDataUrlIdsRef.current.has(img.id)
    );
    if (pendingImages.length === 0) return;

    // 标记为正在处理，避免重复提交
    for (const img of pendingImages) {
      persistedDataUrlIdsRef.current.add(img.id);
    }

    const persistDataUrls = async () => {
      const urlMapping: Record<string, string> = {};
      for (const img of pendingImages) {
        try {
          let urlToSave = img.url;
          // blob: 先转 data:
          if (urlToSave.startsWith('blob:')) {
            try {
              const resp = await fetch(urlToSave);
              const blob = await resp.blob();
              urlToSave = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            } catch { continue; }
          }
          const saveResp = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: urlToSave, userId: currentUser?.id }),
          });
          if (!saveResp.ok) {
            console.warn(`[persistPendingDataUrls] save-image returned ${saveResp.status} for image ${img.id}`);
            continue;
          }
          const saveData = await saveResp.json();
          if (saveData.success && saveData.url) {
            urlMapping[img.id] = saveData.url;
          }
        } catch (error) {
          console.warn(`[persistPendingDataUrls] Failed to persist image ${img.id}:`, error);
        }
      }
      // 更新 images 状态中的非持久化 URL
      if (Object.keys(urlMapping).length > 0) {
        setImages(prev => prev.map(img =>
          urlMapping[img.id] ? { ...img, url: urlMapping[img.id] } : img
        ));
      }
    };

    // 延迟 2 秒执行，等待页面渲染和服务器数据加载完成
    const timer = setTimeout(persistDataUrls, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // ★ SSE 连接：实时推送任务完成事件，避免轮询延迟
  useEffect(() => {
    taskEventsClient.connect();
    return () => { taskEventsClient.disconnect(); };
  }, []);

  const handleGenerate = useCallback(async (params: GenerationParams) => {
    // 增加活跃任务计数
    setActiveGenerationCount(prev => prev + 1);
    // 获取生图数量，默认为1
    const outputCount = params.outputCount || 1;

    // 【调整1】在画布上创建进度占位框
    const placeholderBaseSize = 400;
    const aspectRatio = params.aspectRatio || '1:1';
    const [arW, arH] = aspectRatio.split(':').map(Number);
    const arRatio = (arW || 1) / (arH || 1);
    const phWidth = arRatio >= 1 ? placeholderBaseSize : Math.round(placeholderBaseSize * arRatio);
    const phHeight = arRatio >= 1 ? Math.round(placeholderBaseSize / arRatio) : placeholderBaseSize;

    const placeholderIds: string[] = [];
    // 计算视口中心位置用于放置占位框
    const canvasEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
    const viewportWidth = canvasEl ? canvasEl.clientWidth : 1200;
    const viewportHeight = canvasEl ? canvasEl.clientHeight : 800;
    let viewOffsetX = 0, viewOffsetY = 0, currentZoom = 1;
    const transformLayer = canvasEl?.querySelector('[style*="transform"]') as HTMLElement | null;
    if (transformLayer) {
      const match = transformLayer.style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
      if (match) { viewOffsetX = parseFloat(match[1]); viewOffsetY = parseFloat(match[2]); currentZoom = parseFloat(match[3]); }
    }
    const canvasCenterX = (viewportWidth / 2 - viewOffsetX) / currentZoom;
    const canvasCenterY = (viewportHeight / 2 - viewOffsetY) / currentZoom;
    const totalPhWidth = outputCount * phWidth + (outputCount - 1) * 20;
    const phStartX = canvasCenterX - totalPhWidth / 2;
    const phStartY = canvasCenterY - phHeight / 2;

    for (let i = 0; i < outputCount; i++) {
      const phId = `gen-ph-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
      placeholderIds.push(phId);
      const offsetX = i * (phWidth + 20);
      setImages(prev => [...prev, {
        id: phId,
        url: '',
        x: phStartX + offsetX, y: phStartY,
        width: phWidth, height: phHeight,
        originalWidth: phWidth * 2, originalHeight: phHeight * 2,
        isProcessingPlaceholder: true,
        processing: {
          label: '生成中',
          status: 'submitting',
          progress: 5,
          startTime: Date.now(),
        },
        aspectRatio: params.aspectRatio,
        model: params.model,
        quality: params.quality,
        prompt: params.prompt,
        createdAt: Date.now(),
      }]);
    }

    try {
      // 开始处理 - 提交任务

      // 检查是否使用第三方模型
      const isThirdParty = !!(params as GenerationParams & { universalBaseUrl?: string }).universalBaseUrl;
      const apiEndpoint = isThirdParty ? '/api/universal-generate' : '/api/generate';

      // 提交生成请求（带超时保护，避免网络异常导致无限等待）
      // 超时需匹配后端 maxDuration (600s=10分钟)，部分第三方API出图可达90秒+
      const submitController = new AbortController();
      const submitTimeout = setTimeout(() => submitController.abort(), 600000); // 10分钟超时，匹配后端maxDuration

      let response: Response;
      try {
        // ★ submitOnly模式：后端立即返回taskId，前端轮询等待结果
        response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, userId: currentUserRef.current?.id, submitOnly: true }),
          signal: submitController.signal,
        });
      } finally {
        clearTimeout(submitTimeout);
      }

      const data = await response.json();

      // === HTTP 错误处理 ===
      if (!response.ok) {
        console.error('[生成] API HTTP错误:', response.status, data);
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        toast.error('生成失败', {
          description: data.error || `服务器错误 (${response.status})，请稍后重试`,
          className: 'bg-[#141414] border border-red-900 text-white',
          duration: 5000,
        });
        return;
      }

      // === 提交失败处理 ===
      if (!data.success) {
        console.error('[生成] API提交失败:', data.error, data);
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        toast.error('生成失败', {
          description: data.error || 'API提交失败，请检查模型和提示词后重试',
          className: 'bg-[#141414] border border-red-900 text-white',
          duration: 5000,
        });
        return;
      }

      // === 直接返回模式：API 直接返回图片URL ===
      if (data.mode === 'direct') {
        const { imageUrls, model, prompt: enhancedPrompt, originalPrompt, category, style, modelName, providerName, apiBaseUrl } = data;

        // 并行持久化所有需要持久化的图片URL（跳过已经是本地路径的URL）
        const savedUrls = await Promise.all(imageUrls.map(async (imageUrl: string) => {
          // 已经是本地路径（serve-upload/本地文件），无需再次持久化
          if (imageUrl.startsWith('/api/serve-upload/') || imageUrl.startsWith('/uploads/') || imageUrl.startsWith('blob:')) {
            return imageUrl;
          }
          // data: URL 或远程 HTTP URL 需要持久化
          let savedUrl = imageUrl;
          try {
            const saveRes = await fetch('/api/save-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl }),
            });
            if (saveRes.ok) {
              const saveData = await saveRes.json();
              if (saveData.success && saveData.savedUrl) savedUrl = saveData.savedUrl;
            }
          } catch {}
          return savedUrl;
        }));

        // 加载每张图片的真实像素尺寸（第三方API可能返回与请求不同的尺寸）
        const loadActualSize = (url: string, retries = 2): Promise<{ w: number; h: number }> => {
          return new Promise(resolve => {
            const img = new window.Image();
            const timeout = setTimeout(() => {
              img.src = '';
              if (retries > 0) {
                resolve(loadActualSize(url, retries - 1));
              } else {
                resolve({ w: 0, h: 0 });
              }
            }, 15000); // 15秒超时，4K大图可能需要更长时间加载
            img.onload = () => { clearTimeout(timeout); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
            img.onerror = () => {
              clearTimeout(timeout);
              if (retries > 0) {
                resolve(loadActualSize(url, retries - 1));
              } else {
                resolve({ w: 0, h: 0 }); // 加载失败时返回0，后续使用fallback
              }
            };
            img.src = url;
          });
        };
        const actualSizes = await Promise.all(savedUrls.map(url => loadActualSize(url)));

        for (let i = 0; i < savedUrls.length; i++) {
          const savedUrl = savedUrls[i];
          const actualSize = actualSizes[i];

          // 从请求参数推算像素尺寸作为fallback
          let imgW = 1024, imgH = 1024;
          if (params.size?.includes('x') || params.size?.includes('×')) {
            const [sw, sh] = params.size.replace(/×/g, 'x').split('x');
            const pw = parseInt(sw), ph = parseInt(sh);
            // 像素格式 (如 "2304x4096")
            if (pw > 100 && ph > 100) {
              imgW = pw; imgH = ph;
            }
          }
          // 如果无法从size解析像素，尝试从quality和aspectRatio推算
          if (imgW <= 100 && params.aspectRatio) {
            const [aw, ah] = params.aspectRatio.replace(/×/g, ':').split(':').map(Number);
            if (aw > 0 && ah > 0) {
              const basePixels: Record<string, number> = {
                '1K': 1024, '2K': 2048, '3K': 3072, '4K': 4096,
              };
              const base = basePixels[params.quality || '2K'] || 2048;
              const longEdge = base;
              if (aw >= ah) { imgW = longEdge; imgH = Math.round(longEdge * ah / aw); }
              else { imgH = longEdge; imgW = Math.round(longEdge * aw / ah); }
            }
          }
          // 优先使用图片真实像素尺寸，fallback到请求尺寸
          const finalW = actualSize.w > 0 ? actualSize.w : imgW;
          const finalH = actualSize.h > 0 ? actualSize.h : imgH;

          // 替换对应的占位框
          const phId = placeholderIds[i];
          if (phId) {
            setImages(prev => prev.map(img =>
              img.id === phId ? {
                ...img,
                id: `gen-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
                url: savedUrl,
                prompt: enhancedPrompt || originalPrompt || params.prompt,
                model: model,
                quality: params.quality,
                aspectRatio: params.aspectRatio,
                stylePreset: style,
                category: category,
                size: params.size,
                width: finalW * 0.5, height: finalH * 0.5,
                originalWidth: finalW, originalHeight: finalH,
                isProcessingPlaceholder: false,
                processing: undefined,
                createdAt: Date.now(),
                modelName: modelName || model,
                apiProvider: providerName || '',
                apiBaseUrl: apiBaseUrl || '',
              } : img
            ));
          }
        }
        // 移除多余的占位框（outputCount > imageUrls.length 时）
        const usedPlaceholderIds = new Set(placeholderIds.slice(0, imageUrls.length));
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id) || usedPlaceholderIds.has(img.id)));

        toast.success('生成完成', {
          description: `${data.modelName || model} 已生成 ${imageUrls.length} 张图片`,
          className: themeStyle === 'monochrome' ? 'bg-white border border-blue-200 text-gray-900' : 'bg-[#141414] border border-[#d4af37]/30 text-white',
          duration: 3000,
        });
        return;
      }

      // === 轮询模式：API返回任务ID，前端轮询结果 ===
      if (data.mode === 'polling') {
        const { taskIds, estimatedTime, prompt: enhancedPrompt, modelName: pollingModelName, providerName: pollingProviderName, apiBaseUrl: pollingApiBaseUrl } = data;

        // 自适应轮询间隔策略（优化版）
        // 前期更快探测，后期适度延长避免浪费请求
        const getPollInterval = (pollCount: number, estTime: number) => {
          // 优化：更激进的初始轮询（300ms起），快速检测任务完成
          // 后端已完成时，前端应在 <1s 内感知到
          const baseInterval = estTime <= 20 ? 300 : estTime <= 60 ? 500 : 800;
          if (pollCount > 50) return baseInterval + 2000;
          if (pollCount > 30) return baseInterval + 1000;
          if (pollCount > 15) return baseInterval + 300;
          return baseInterval;
        };

        // 最大轮询时间：预估时间 * 6 + 120秒（兜底），最少180秒，最多1800秒（30分钟，兼容极慢API如token link）
        // ★ 每个任务独立计算超时：避免串行任务时前期任务消耗掉后期任务的时间预算
        // 全局最大时间：预估时间 * 6 + 120秒（兜底），最少180秒，最多1800秒（30分钟）
        // 单任务最大时间：预估时间 * 4 + 120秒，最少120秒，最多600秒（10分钟）
        const globalMaxPollTime = Math.min(1800, Math.max(180, estimatedTime * 6 + 120)) * 1000;
        const perTaskMaxPollTime = Math.min(600, Math.max(120, estimatedTime * 4 + 120)) * 1000;
        const globalStartTime = Date.now();

        const completedImages: Array<{ id: string; url: string; prompt: string; model?: string; quality?: string; aspectRatio?: string; stylePreset?: string; category?: string; size?: string; sourceUrl?: string; modelName?: string; apiProvider?: string }> = [];        let consecutiveErrors = 0;

        for (let taskIdx = 0; taskIdx < taskIds.length; taskIdx++) {
          const currentTaskId = taskIds[taskIdx];
          let pollCount = 0;
          let taskCompleted = false;
          const taskStartTime = Date.now(); // ★ 每个任务独立的开始时间

          while (!taskCompleted && isMountedRef.current) {
            const taskElapsed = Date.now() - taskStartTime;
            const globalElapsed = Date.now() - globalStartTime;
            // 检查是否超时：单任务超时 或 全局超时
            if (taskElapsed > perTaskMaxPollTime || globalElapsed > globalMaxPollTime) {
              console.warn(`[生成轮询] 超时退出 taskId=${currentTaskId}, 任务耗时=${Math.round(taskElapsed / 1000)}s, 全局耗时=${Math.round(globalElapsed / 1000)}s, perTaskMax=${perTaskMaxPollTime / 1000}s, globalMax=${globalMaxPollTime / 1000}s`);
              toast.error('生成超时', {
                description: `${data.modelName} 生成时间过长（已等待${Math.round(taskElapsed / 1000)}秒）。可能原因：API排队中、模型负载高、提示词复杂度高。请稍后重试或降低分辨率`,
                className: 'bg-[#141414] border border-red-900 text-white',
                duration: 10000,
              });
              break;
            }

            const interval = getPollInterval(pollCount, estimatedTime);
            // ★ SSE加速：同时等待定时器和SSE完成事件，任一先到即继续
            await Promise.race([
              new Promise(resolve => setTimeout(resolve, interval)),
              new Promise(resolve => {
                if (!taskEventsClient.isConnected()) { resolve(undefined); return; }
                const unsub = taskEventsClient.onTaskEvent(event => {
                  if (event.taskId === currentTaskId && ['completed', 'failed', 'cancelled'].includes(event.type)) {
                    unsub();
                    resolve(undefined);
                  }
                });
                // 安全超时：确保不会永久等待SSE（SSE可能断连）
                setTimeout(() => { unsub(); resolve(undefined); }, interval + 2000);
              })
            ]);
            pollCount++;

            try {
              const pollResponse = await fetch('/api/poll-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: currentTaskId, model: params.model, providerId: params.providerId, userId: currentUserRef.current?.id }),              });

              const pollData = await pollResponse.json();
              console.log(`[poll] #${pollCount} taskId=${currentTaskId} success=${pollData.success} status=${pollData.status} retryable=${pollData.retryable} progress=${pollData.progress} taskElapsed=${Math.round((Date.now()-taskStartTime)/1000)}s`);

              if (!pollData.success && !pollData.retryable) {
                // 不可重试的错误
                console.error(`[poll] taskId=${currentTaskId} NON-RETRYABLE error after ${Math.round((Date.now()-taskStartTime)/1000)}s, pollCount=${pollCount}`, pollData.error);
                // 清理处理帧占位符，避免空图片框残留在画布上
                for (const failedPhId of placeholderIds) {
                  setImages(prev => prev.filter(img => img.id !== failedPhId));
                }
                toast.error('生成失败', {
                  description: pollData.error || '任务执行失败',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
                break;
              }

              // 可重试的错误（如模型返回文本而非图像、API临时429/500等）
              // 根据单任务最大轮询时间动态计算最大重试次数（间隔按3s估算），确保不会过早放弃
              if (!pollData.success && pollData.retryable && pollCount > Math.floor(perTaskMaxPollTime / 3000)) {
                console.warn(`[生成] 可重试错误已达 ${pollCount} 次 (上限 ${Math.floor(perTaskMaxPollTime / 3000)})，最后错误: ${pollData.error}`);
                // 清理处理帧占位符，避免空图片框残留在画布上
                for (const failedPhId of placeholderIds) {
                  setImages(prev => prev.filter(img => img.id !== failedPhId));
                }
                toast.error('生成失败', {
                  description: pollData.error || '多次重试后仍未生成图像，建议稍后在画布查看',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
                break;
              }
              // 可重试错误时短暂等待后继续（不消耗正常轮询间隔）
              if (!pollData.success && pollData.retryable) {
                await new Promise(r => setTimeout(r, 3000));
                continue;
              }

              const completedImageUrl = (pollData.imageUrl || pollData.result?.imageUrl || (pollData.result?.image as Record<string, unknown>)?.url || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url) as string | undefined;
              if (pollData.status === 'completed' && completedImageUrl) {
                const rawImageUrl = completedImageUrl;
                completedImages.push({
                  id: `${Date.now()}-${taskIdx}`,
                  url: rawImageUrl,
                  prompt: enhancedPrompt || params.prompt,
                  model: params.model,
                  quality: params.quality,
                  aspectRatio: params.aspectRatio,
                  stylePreset: params.stylePreset,
                  category: (params.imageCategory && params.imageCategory !== 'none') ? params.imageCategory : ((params.productCategory && params.productCategory !== 'none') ? params.productCategory : undefined),
                  size: params.size,
                  sourceUrl: rawImageUrl,
                  modelName: pollData.modelName || undefined,
                  apiProvider: pollData.providerName || undefined,
                });
                taskCompleted = true;
                consecutiveErrors = 0;

                // 立即替换对应占位框为真实图片（而非等全部完成）
                const phId = placeholderIds[taskIdx];
                if (phId) {
                  // 持久化 data: URL
                  const persistAndReplace = async () => {
                    let finalUrl = rawImageUrl;
                    if (rawImageUrl.startsWith('data:')) {
                      try {
                        const saveResp = await fetch('/api/save-image', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ imageUrl: rawImageUrl, userId: currentUserRef.current?.id, sourceUrl: rawImageUrl }),
                        });
                        const saveData = await saveResp.json();
                        if (saveData.success && saveData.url) finalUrl = saveData.url;
                      } catch { /* save failed, keep data URL */ }
                    }

                    // 获取图片真实尺寸
                    const loadSize = (url: string): Promise<{w: number; h: number}> => new Promise(resolve => {
                      const img = new window.Image();
                      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
                      img.onerror = () => resolve({ w: 0, h: 0 });
                      img.src = url;
                    });
                    const { w: natW, h: natH } = await loadSize(finalUrl);

                    // 替换占位框为真实图片
                    setImages(prev => prev.map((img): CanvasImage => {
                      if (img.id !== phId || !img.isProcessingPlaceholder) return img;
                      const displayW = natW > 0 ? Math.round(natW * Math.min(400 / natW, 400 / (natH || 1))) : img.width;
                      const displayH = natH > 0 ? Math.round(natH * Math.min(400 / (natW || 1), 400 / natH)) : img.height;
                      return {
                        ...img,
                        url: finalUrl,
                        width: displayW || img.width,
                        height: displayH || img.height,
                        originalWidth: natW || img.originalWidth,
                        originalHeight: natH || img.originalHeight,
                        isProcessingPlaceholder: false,
                        processing: undefined,
                        prompt: enhancedPrompt || params.prompt,
                        model: params.model,
                        quality: params.quality,
                        aspectRatio: params.aspectRatio,
                        stylePreset: params.stylePreset,
                        category: (params.imageCategory && params.imageCategory !== 'none') ? params.imageCategory : ((params.productCategory && params.productCategory !== 'none') ? params.productCategory : undefined),
                        size: params.size,
                        sourceUrl: finalUrl,
                        modelName: pollData.modelName || undefined,
                        apiProvider: pollData.providerName || undefined,
                      };
                    }));
                  };
                  persistAndReplace().catch(() => {
                    // 持久化失败时也替换占位框（用原始URL）
                    setImages(prev => prev.map((img): CanvasImage =>
                      img.id === phId && img.isProcessingPlaceholder ? {
                        ...img,
                        url: rawImageUrl,
                        isProcessingPlaceholder: false,
                        processing: undefined,
                        prompt: enhancedPrompt || params.prompt,
                        model: params.model,
                        quality: params.quality,
                        aspectRatio: params.aspectRatio,
                        sourceUrl: rawImageUrl,
                        modelName: pollData.modelName || undefined,
                        apiProvider: pollData.providerName || undefined,
                      } : img
                    ));
                  });

                  // 更新剩余占位框的进度标签，显示已完成数量
                  const completedSoFar = taskIdx + 1;
                  const remainingCount = taskIds.length - completedSoFar;
                  if (remainingCount > 0) {
                    setImages(prev => prev.map((img): CanvasImage => {
                      if (img.isProcessingPlaceholder && img.processing) {
                        return {
                          ...img,
                          processing: {
                            ...img.processing,
                            label: `已完成 ${completedSoFar}/${taskIds.length}，剩余 ${remainingCount} 张`,
                            progress: Math.round((completedSoFar / taskIds.length) * 100),
                          },
                        };
                      }
                      return img;
                    }));
                  }
                }

              } else if (pollData.status === 'failed') {
                console.warn(`[poll] taskId=${currentTaskId} FAILED after ${Math.round((Date.now()-taskStartTime)/1000)}s, pollCount=${pollCount}`, pollData.error);
                // 移除对应的占位框，并更新剩余占位框标签
                const failedPhId = placeholderIds[taskIdx];
                const completedSoFar = taskIdx + 1;
                const remainingCount = taskIds.length - completedSoFar;
                setImages(prev => {
                  const filtered = prev.filter(img => img.id !== failedPhId);
                  if (remainingCount > 0) {
                    return filtered.map((img): CanvasImage => {
                      if (img.isProcessingPlaceholder && img.processing) {
                        return {
                          ...img,
                          processing: {
                            ...img.processing,
                            label: `已完成 ${completedSoFar}/${taskIds.length}，剩余 ${remainingCount} 张`,
                            progress: Math.round((completedSoFar / taskIds.length) * 100),
                          },
                        };
                      }
                      return img;
                    });
                  }
                  return filtered;
                });
                toast.error('生成失败', {
                  description: pollData.error || '图像生成任务失败',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;

              } else if (pollData.status === 'cancelled') {
                toast.error('任务已取消', {
                  description: pollData.error || '图像生成任务被取消',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;

              } else {
                // pending / processing - 更新进度（根据API返回的estimatedTime动态调整）
                if (pollData.estimatedTime && pollCount === 1) {
                  console.log(`Task ${currentTaskId} estimated time: ${pollData.estimatedTime}s`);
                }
                consecutiveErrors = 0;
              }

            } catch (pollError) {
              consecutiveErrors++;
              console.error(`Poll error (consecutive: ${consecutiveErrors}):`, pollError);

              if (consecutiveErrors >= 5) {
                toast.error('轮询失败', {
                  description: '连续多次查询失败，请检查网络连接',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
              }
              // 否则继续轮询
            }
          }
        }

        // 处理完成的图片 - 自动排列布局
        if (completedImages.length > 0) {
          // 持久化 data: URL（base64 图片保存到服务器，避免刷新丢失）— 并行化
          const persistPromises = completedImages
            .filter(img => img.url.startsWith('data:'))
            .map(async (img) => {
              try {
                const saveResp = await fetch('/api/save-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: img.url, userId: currentUserRef.current?.id, sourceUrl: img.sourceUrl }),
                });
                const saveData = await saveResp.json();
                if (saveData.success && saveData.url) {
                  img.url = saveData.url;
                  img.sourceUrl = img.sourceUrl || saveData.sourceUrl;
                }
              } catch { /* save failed, keep data URL */ }
            });
          await Promise.all(persistPromises);

          const getDisplaySize = (size: string) => {
            let originalWidth = 1024;
            let originalHeight = 1024;
            if (size && (size.includes('x') || size.includes('×'))) {
              const parts = size.replace(/×/g, 'x').split('x');
              originalWidth = parseInt(parts[0]) || 1024;
              originalHeight = parseInt(parts[1]) || 1024;
            }
            return { w: originalWidth, h: originalHeight };
          };

          const loadActualSize = (url: string): Promise<{ w: number; h: number }> => {
            return new Promise(resolve => {
              const img = new window.Image();
              img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
              img.onerror = () => resolve({ w: 0, h: 0 });
              img.src = url;
            });
          };
          const actualSizes = await Promise.all(completedImages.map(img => loadActualSize(img.url)));

          const displayScale = 0.5;
          const completedCanvasImages: CanvasImage[] = completedImages.map((img, idx) => {
            const displaySize = getDisplaySize(params.size);
            // 优先使用图片真实像素尺寸，fallback到请求尺寸
            const finalW = actualSizes[idx]?.w > 0 ? actualSizes[idx].w : displaySize.w;
            const finalH = actualSizes[idx]?.h > 0 ? actualSizes[idx].h : displaySize.h;
            return {
              id: img.id,
              url: img.url,
              prompt: img.prompt,
              modifyPrompt: undefined,
              model: img.model,
              quality: img.quality,
              aspectRatio: img.aspectRatio,
              stylePreset: img.stylePreset,
              category: img.category,
              size: img.size,
              x: 0,
              y: 0,
              width: finalW * displayScale,
              height: finalH * displayScale,
              originalWidth: finalW,
              originalHeight: finalH,
              createdAt: Date.now(),
              modelName: img.modelName || pollingModelName || img.model,
              apiProvider: img.apiProvider || pollingProviderName || '',
              apiBaseUrl: pollingApiBaseUrl || '',
            };
          });

          // 替换尚未被逐个替换的占位框为实际图片
          setImages(prev => {
            let updated = [...prev];
            for (let i = 0; i < completedCanvasImages.length; i++) {
              const phId = placeholderIds[i];
              if (phId) {
                const phIdx = updated.findIndex(img => img.id === phId);
                if (phIdx >= 0) {
                  const existing = updated[phIdx];
                  if (existing.isProcessingPlaceholder) {
                    // 尚未被逐个替换的占位框，现在替换
                    updated[phIdx] = {
                      ...completedCanvasImages[i],
                      x: existing.x,
                      y: existing.y,
                    };
                  }
                  // 已被逐个替换的，保留（可能URL已持久化，尺寸更准确）
                } else {
                  updated.push(completedCanvasImages[i]);
                }
              } else {
                updated.push(completedCanvasImages[i]);
              }
            }
            // 移除多余的占位框（如轮询失败或超时残留的）
            updated = updated.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id));
            stabilizeCanvasImages(updated.map(img => ({ id: img.id, url: img.url })));
            return updated;
          });

          toast.success(`生成成功`, {
            description: `已生成 ${completedImages.length} 张图片`,
            className: 'bg-[#141414] border-[#2a2a2a] text-white',
          });
          try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }
        }

      // === 旧模式兼容：直接返回结果 - 自动排列布局 ===
      } else if (data.success && data.images) {
        // 持久化 data: URL — 并行化
        const persistPromises = (data.images as Array<{ url: string; sourceUrl?: string }>)
          .filter(img => img.url.startsWith('data:'))
          .map(async (img) => {
            try {
              const saveResp = await fetch('/api/save-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: img.url, userId: currentUserRef.current?.id, sourceUrl: img.sourceUrl }),
              });
              const saveData = await saveResp.json();
              if (saveData.success && saveData.url) {
                img.url = saveData.url;
                img.sourceUrl = img.sourceUrl || saveData.sourceUrl;
              }
            } catch { /* save failed, keep data URL */ }
          });
        await Promise.all(persistPromises);

        const getDisplaySize = (size: string) => {
          let originalWidth = 1024;
          let originalHeight = 1024;
          if (size && (size.includes('x') || size.includes('×'))) {
            const parts = size.replace(/×/g, 'x').split('x');
            originalWidth = parseInt(parts[0]) || 1024;
            originalHeight = parseInt(parts[1]) || 1024;
          }
          return { w: originalWidth, h: originalHeight };
        };

        // 加载每张图片的真实像素尺寸
        const loadActualSize = (url: string): Promise<{ w: number; h: number }> => {
          return new Promise(resolve => {
            const img = new window.Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 0, h: 0 });
            img.src = url;
          });
        };
        const legacyActualSizes = await Promise.all(
          (data.images as Array<{ url: string }>).map((img: { url: string }) => loadActualSize(img.url))
        );

        const displayScale = 0.5;
        const legacyImages: CanvasImage[] = data.images.map((img: { id: string; url: string; prompt: string }, idx: number) => {
          const displaySize = getDisplaySize(params.size);
          const finalW = legacyActualSizes[idx]?.w > 0 ? legacyActualSizes[idx].w : displaySize.w;
          const finalH = legacyActualSizes[idx]?.h > 0 ? legacyActualSizes[idx].h : displaySize.h;
          return {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            url: img.url,
            prompt: img.prompt,
            model: params.model,
            quality: params.quality,
            aspectRatio: params.aspectRatio,
            stylePreset: params.stylePreset,
            category: (params.imageCategory && params.imageCategory !== 'none') ? params.imageCategory : ((params.productCategory && params.productCategory !== 'none') ? params.productCategory : undefined),
            size: params.size,
            x: 0,
            y: 0,
            width: finalW * displayScale,
            height: finalH * displayScale,
            originalWidth: finalW,
            originalHeight: finalH,
            createdAt: Date.now(),
          };
        });

        setImages(prev => {
          let updated = [...prev];
          for (let i = 0; i < legacyImages.length; i++) {
            const phId = placeholderIds[i];
            if (phId) {
              const phIdx = updated.findIndex(img => img.id === phId);
              if (phIdx >= 0) {
                updated[phIdx] = { ...legacyImages[i], x: updated[phIdx].x, y: updated[phIdx].y };
              } else {
                updated.push(legacyImages[i]);
              }
            } else {
              updated.push(legacyImages[i]);
            }
          }
          const usedPlaceholderIds = new Set(placeholderIds.slice(0, legacyImages.length));
          updated = updated.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id) || usedPlaceholderIds.has(img.id));
          stabilizeCanvasImages(updated.map(img => ({ id: img.id, url: img.url })));
          return updated;
        });
        toast.success(`生成成功`, {
          description: `已生成 ${data.images.length} 张图片`,
          className: 'bg-[#141414] border-[#2a2a2a] text-white',
        });
        try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }

      // === 错误处理 ===
      } else if (data.requiresApiKey) {
        toast.warning(`${data.modelName || '当前模型'} 需要配置 API Key`, {
          description: '请联系管理员在后台配置可用的 API Key',
          action: data.docsUrl ? {
            label: '查看文档',
            onClick: () => window.open(data.docsUrl, '_blank')
          } : undefined,
          className: 'bg-[#141414] border border-amber-700 text-white',
        });
      } else if (data.networkError) {
        // 清理占位框
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        toast.error('网络连接失败', {
          description: data.error || '无法访问 API 服务',
          className: 'bg-[#141414] border border-red-900 text-white',
          duration: 8000,
        });
      } else {
        // 清理占位框
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
        toast.error('生成失败', {
          description: data.error || '未知错误',
          className: 'bg-[#141414] border border-red-900 text-white',
        });
      }
    } catch (error) {
      // 清理占位框
      setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id)));
      console.error('Generation error:', error);
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      toast.error('生成失败', {
        description: isAbort ? '请求超时，请检查网络后重试' : '网络错误，请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    } finally {
      setActiveGenerationCount(prev => Math.max(0, prev - 1));
    }
  }, [setImages, stabilizeCanvasImages, themeStyle]);

  // 添加参考图到画布
  const handleAddToCanvas = useCallback(async (imageUrl: string) => {
    // 检查图片是否已存在于画布中（使用ref避免闭包过期）
    if (latestImagesRef.current.some(img => img.url === imageUrl)) {
      toast.info('图片已在画布中', {
        description: '该参考图已经添加到画布',
        className: 'bg-[#141414] border-[#2a2a2a] text-white',
      });
      return;
    }
    const { width: natW, height: natH } = await loadCanvasImageSize(imageUrl);
    const displaySize = getCanvasImageDisplaySize(natW, natH);
    const newImage: CanvasImage = {
      id: `ref-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url: imageUrl,
      prompt: '',
      x: Math.random() * 400 + 100,
      y: Math.random() * 400 + 100,
      width: displaySize.width,
      height: displaySize.height,
      originalWidth: natW,
      originalHeight: natH,
      createdAt: Date.now(),
    };
    setImages(prev => [...prev, newImage]);
    recordUserData({
      userId: currentUserRef.current?.id,
      area: 'images',
      type: 'add-to-canvas',
      filename: `${newImage.id}.json`,
      content: JSON.stringify(newImage, null, 2),
      metadata: { source: 'canvas', imageUrl },
    });
    stabilizeCanvasImages([{ id: newImage.id, url: imageUrl }]);
    toast.success('已添加到画布', {
      description: '参考图已成功添加到画布',
      className: 'bg-[#141414] border-[#2a2a2a] text-white',
    });
  }, [setImages, stabilizeCanvasImages]); // 使用 latestImagesRef/currentUserRef 避免 images 闭包

  // 自动排列布局：横向顶对齐，间距10px，超出视口宽度换行
  const autoLayoutImages = useCallback((existingImages: CanvasImage[], newImages: CanvasImage[]): CanvasImage[] => {
    const GAP = 10;

    // 计算当前视口中心（画布坐标系）
    const canvasEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
    const viewportWidth = canvasEl ? canvasEl.clientWidth : 1200;
    const viewportHeight = canvasEl ? canvasEl.clientHeight : 800;

    // 从 DOM 上读取当前 viewOffset 和 zoom（通过 CSS transform）
    let viewOffsetX = 0;
    let viewOffsetY = 0;
    let currentZoom = 1;
    const transformLayer = canvasEl?.querySelector('[style*="transform"]') as HTMLElement | null;
    if (transformLayer) {
      const style = transformLayer.style;
      const match = style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
      if (match) {
        viewOffsetX = parseFloat(match[1]);
        viewOffsetY = parseFloat(match[2]);
        currentZoom = parseFloat(match[3]);
      }
    }

    // 视口中心在画布坐标中的位置
    const canvasCenterX = (viewportWidth / 2 - viewOffsetX) / currentZoom;
    const canvasCenterY = (viewportHeight / 2 - viewOffsetY) / currentZoom;

    // 收集所有已有图片的边界框
    let maxRight = 0;
    let maxBottom = 0;
    for (const img of existingImages) {
      const r = img.x + img.width;
      const b = img.y + img.height;
      if (r > maxRight) maxRight = r;
      if (b > maxBottom) maxBottom = b;
    }

    // 新图片的起始位置
    let startX: number;
    let startY: number;

    if (existingImages.length > 0) {
      // 有已有图片时，从最右侧追加
      startX = maxRight + GAP;
      startY = 0;
    } else {
      // 没有已有图片时，在视口中心开始
      // 先计算所有新图片的总宽度，用于居中
      const totalWidth = newImages.reduce((sum, img) => sum + img.width + GAP, -GAP);
      const totalHeight = newImages.length > 0 ? Math.max(...newImages.map(img => img.height)) : 0;
      startX = canvasCenterX - totalWidth / 2;
      startY = canvasCenterY - totalHeight / 2;
    }

    // 行布局
    let currentX = startX;
    let currentY = startY;
    let rowHeight = 0;
    const laidOut: CanvasImage[] = [];

    for (const img of newImages) {
      // 如果当前行超出视口右边，换行
      if (currentX + img.width > startX + viewportWidth / currentZoom && currentX > startX) {
        currentX = startX;
        currentY += rowHeight + GAP;
        rowHeight = 0;
      }

      laidOut.push({
        ...img,
        x: currentX,
        y: currentY,
      });

      rowHeight = Math.max(rowHeight, img.height);
      currentX += img.width + GAP;
    }

    return laidOut;
  }, []);

  // 加载图片真实尺寸
  // 添加多张图片到画布（自动排列布局）
  const handleAddImages = useCallback(async (imageUrls: string[], sourceImageId?: string, meta?: { modelName?: string; apiProvider?: string; relationType?: ConnectionRelationType }) => {
    const newImages: CanvasImage[] = [];

    // Find source image for positioning if provided
    const sourceImg = sourceImageId ? images.find(img => img.id === sourceImageId) : null;

    // ★ 确定模型信息：优先使用 meta 参数，其次从源图继承
    const effectiveModelName = meta?.modelName || sourceImg?.modelName || '';
    const effectiveApiProvider = meta?.apiProvider || sourceImg?.apiProvider || '';

    for (let i = 0; i < imageUrls.length; i++) {
      let rawUrl = imageUrls[i];
      // 将 blob: URL 转为 data URL（blob: 在页面刷新后失效）
      if (rawUrl.startsWith('blob:')) {
        try {
          const blobResp = await fetch(rawUrl);
          const blob = await blobResp.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          rawUrl = dataUrl;
        } catch { /* conversion failed, keep blob URL */ }
      }

      // 将 data: URL 和外部 HTTP URL 持久化到服务器（避免数据丢失和外部 URL 过期）
      if (rawUrl.startsWith('data:') || rawUrl.startsWith('http')) {
        try {
          const saveResp = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: rawUrl, userId: currentUser?.id }),
          });
          if (!saveResp.ok) {
            console.warn(`[handleAddImages] save-image returned ${saveResp.status} for image, keeping original URL`);
          } else {
            const saveData = await saveResp.json();
            if (saveData.success && saveData.url) {
              rawUrl = saveData.url;
            } else {
              console.warn('[handleAddImages] save-image returned non-success:', saveData.error || 'unknown');
            }
          }
        } catch (err) {
          console.warn('[handleAddImages] save-image failed, keeping original URL:', err);
        }
      }

      // 跳过已存在的图片
      if (images.some(img => img.url === rawUrl) || newImages.some(img => img.url === rawUrl)) {
        continue;
      }
      // 先获取图片真实尺寸
      const { width: natW, height: natH } = await loadCanvasImageSize(rawUrl);
      const displaySize = getCanvasImageDisplaySize(natW, natH);

      const tempId = `ref-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // If source image exists, position generated images to its right
      const offsetX = sourceImg ? sourceImg.x + sourceImg.width + 30 : 0;
      const offsetY = sourceImg ? sourceImg.y + i * (displaySize.height + 20) : 0;

      newImages.push({
        id: tempId,
        url: rawUrl,
        prompt: '',
        x: offsetX,
        y: offsetY,
        width: displaySize.width,
        height: displaySize.height,
        originalWidth: natW,
        originalHeight: natH,
        createdAt: Date.now(),
        generatedFromImageId: sourceImageId,
        // ★ 保留模型信息和API提供商信息
        ...(effectiveModelName ? { modelName: effectiveModelName } : {}),
        ...(effectiveApiProvider ? { apiProvider: effectiveApiProvider } : {}),
      });
    }

    if (newImages.length > 0) {
      if (sourceImg) {
        // Direct placement next to source image
        setImages(prev => [...prev, ...newImages]);
      } else {
        // 应用自动布局计算位置，然后添加到画布
        setImages(prev => {
          const laidOut = autoLayoutImages(prev, newImages);
          stabilizeCanvasImages(laidOut.map(img => ({ id: img.id, url: img.url })));
          return [...prev, ...laidOut];
        });
      }
      // ★ 自动连线：当有源图片时，为新图片自动创建连线
      if (sourceImageId && newImages.length > 0) {
        const relationType = meta?.relationType || 'variant';
        setCanvasConnections(prev => {
          const newConns = newImages.map(img =>
            createAutoConnection(sourceImageId, img.id, relationType)
          );
          return [...prev, ...newConns];
        });
      }
      recordUserData({
        userId: currentUser?.id,
        area: 'images',
        type: 'canvas-add-batch',
        filename: `canvas-images-${Date.now()}.json`,
        content: JSON.stringify(newImages, null, 2),
        metadata: { imageCount: newImages.length },
      });
      if (sourceImg && newImages.length > 1) {
        toast.success(`已生成 ${newImages.length} 张图片，已与原图连线`, {
          description: '图片组已自动排列在原图右侧',
          className: 'bg-[#141414] border-[#2a2a2a] text-white',
        });
      } else {
        toast.success(`已添加 ${newImages.length} 张图片到画布`, {
          description: '图片已自动排列到画布',
          className: 'bg-[#141414] border-[#2a2a2a] text-white',
        });
      }
    } else if (imageUrls.length > 0) {
      toast.info('图片已在画布中', {
        description: '所有图片已经存在于画布',
        className: 'bg-[#141414] border-[#2a2a2a] text-white',
      });
    }
  }, [images, currentUser?.id, setImages, autoLayoutImages, stabilizeCanvasImages]);

  // 提取图片关键词
  const handleExtractPrompt = useCallback(async (imageUrl: string) => {
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageUrl, category: 'general' }),
      });
      const data = await response.json();
      if (data.success && data.prompt) {
        // 创建带有关键词的新图片
        const newImage: CanvasImage = {
          id: `extracted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          url: imageUrl,
          prompt: data.prompt,
          x: Math.random() * 400 + 100,
          y: Math.random() * 400 + 100,
          width: 256,
          height: 256,
          originalWidth: 512,
          originalHeight: 512,
          createdAt: Date.now(),
        };
        setImages(prev => [...prev, newImage]);
        // 同时复制到剪贴板
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(data.prompt);
        }
        toast.success('关键词已提取并复制', {
          description: data.prompt.substring(0, 50) + '...',
          className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
        });
        return data.prompt;
      }
    } catch (error) {
      console.error('Extract prompt error:', error);
      toast.error('提取失败', {
        description: '关键词提取失败，请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    }
    return null;
  }, [setImages, themeStyle]);

  useCallback(async (params: GenerationParams & { originalImage: CanvasImage }) => {
        // 如果有原图，使用原图作为参考
        if (params.originalImage.url) {
          params.referenceImages = [params.originalImage.url];
          params.referenceMode = 'style';
        }

        setActiveGenerationCount(prev => prev + 1);

        try {

          const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...params, userId: currentUserRef.current?.id, submitOnly: true }),      });

          const data = await response.json();

          // === 新模式：前端轮询 ===
          if (data.success && data.mode === 'polling') {
            const { taskIds, estimatedTime, prompt: enhancedPrompt } = data;

            const getPollInterval = (pollCount: number, estTime: number) => {
              // 优化：更激进的初始轮询
              const baseInterval = estTime <= 20 ? 300 : estTime <= 60 ? 500 : 800;
              if (pollCount > 50) return baseInterval + 2000;
              if (pollCount > 30) return baseInterval + 1000;
              if (pollCount > 15) return baseInterval + 300;
              return baseInterval;
            };

            // ★ 每个任务独立计算超时：避免串行任务时前期任务消耗掉后期任务的时间预算
            // 全局最大时间：预估时间 * 5 + 120秒，最少180秒，最多1800秒（30分钟）
            // 单任务最大时间：预估时间 * 4 + 120秒，最少120秒，最多600秒（10分钟）
            const globalMaxPollTime = Math.min(1800, Math.max(180, estimatedTime * 5 + 120)) * 1000;
            const perTaskMaxPollTime = Math.min(600, Math.max(120, estimatedTime * 4 + 120)) * 1000;
            const globalStartTime = Date.now();

            const completedImages: Array<{ id: string; url: string; prompt: string; model?: string; quality?: string; aspectRatio?: string; stylePreset?: string; category?: string; size?: string; sourceUrl?: string; modelName?: string; apiProvider?: string }> = [];        let consecutiveErrors = 0;

            for (let taskIdx = 0; taskIdx < taskIds.length; taskIdx++) {
              const currentTaskId = taskIds[taskIdx];
              let pollCount = 0;
              let taskCompleted = false;
              const taskStartTime = Date.now(); // ★ 每个任务独立的开始时间

              while (!taskCompleted && isMountedRef.current) {
                const taskElapsed = Date.now() - taskStartTime;
                const globalElapsed = Date.now() - globalStartTime;
                if (taskElapsed > perTaskMaxPollTime || globalElapsed > globalMaxPollTime) {
                  toast.error('生成超时', {
                    description: `已等待${Math.round(taskElapsed / 1000)}秒，请尝试降低分辨率或简化提示词后重试`,
                    className: 'bg-[#141414] border border-red-900 text-white',
                  });
                  break;
                }

                const interval = getPollInterval(pollCount, estimatedTime);
                // ★ SSE加速：同时等待定时器和SSE完成事件
                await Promise.race([
                  new Promise(resolve => setTimeout(resolve, interval)),
                  new Promise(resolve => {
                    if (!taskEventsClient.isConnected()) { resolve(undefined); return; }
                    const unsub = taskEventsClient.onTaskEvent(event => {
                      if (event.taskId === currentTaskId && ['completed', 'failed', 'cancelled'].includes(event.type)) {
                        unsub();
                        resolve(undefined);
                      }
                    });
                    setTimeout(() => { unsub(); resolve(undefined); }, interval + 2000);
                  })
                ]);
                pollCount++;

                try {
                  const pollResponse = await fetch('/api/poll-task', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId: currentTaskId, model: params.model, providerId: params.providerId, userId: currentUserRef.current?.id }),
                  });

                  const pollData = await pollResponse.json();

                  if (!pollData.success && !pollData.retryable) {
                    toast.error('生成失败', {
                      description: pollData.error || '任务执行失败',
                      className: 'bg-[#141414] border border-red-900 text-white',
                    });
                    taskCompleted = true;
                    break;
                  }

                  const completedImageUrl2 = (pollData.imageUrl || pollData.result?.imageUrl || (pollData.result?.image as Record<string, unknown>)?.url || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url) as string | undefined;
                  if (pollData.status === 'completed' && completedImageUrl2) {
                    const imageUrl = completedImageUrl2;
                    completedImages.push({
                      id: `${Date.now()}-${taskIdx}`,
                      url: imageUrl,
                      prompt: enhancedPrompt || params.prompt,
                      model: params.model,
                      quality: params.quality,
                      aspectRatio: params.aspectRatio,
                      stylePreset: params.stylePreset,
                      category: (params.imageCategory && params.imageCategory !== 'none') ? params.imageCategory : ((params.productCategory && params.productCategory !== 'none') ? params.productCategory : undefined),
                      size: params.size,
                      sourceUrl: imageUrl,
                      modelName: pollData.modelName || '',
                      apiProvider: pollData.providerName || '',
                    });
                    taskCompleted = true;
                    consecutiveErrors = 0;
                  } else if (pollData.status === 'failed' || pollData.status === 'cancelled') {
                    toast.error('生成失败', {
                      description: pollData.error || '任务失败',
                      className: 'bg-[#141414] border border-red-900 text-white',
                    });
                    taskCompleted = true;
                  } else {
                    consecutiveErrors = 0;
                  }
                } catch {
                  consecutiveErrors++;
                  if (consecutiveErrors >= 5) {
                    toast.error('轮询失败', {
                      description: '连续多次查询失败，请检查网络',
                      className: 'bg-[#141414] border border-red-900 text-white',
                    });
                    taskCompleted = true;
                  }
                }
              }
            }

            if (completedImages.length > 0) {
              const originalImg = params.originalImage;
              const newImages: CanvasImage[] = completedImages.map((img) => ({
                id: img.id,
                url: img.url,
                prompt: img.prompt,
                model: img.model,
                quality: img.quality,
                aspectRatio: img.aspectRatio,
                stylePreset: img.stylePreset,
                category: img.category,
                size: img.size,
                x: 0,
                y: 0,
                width: originalImg.width,
                height: originalImg.height,
                originalWidth: originalImg.originalWidth,
                originalHeight: originalImg.originalHeight,
                modelName: img.modelName,
                apiProvider: img.apiProvider,
                createdAt: Date.now(),
              }));

              setImages(prev => {
                const laidOut = autoLayoutImages(prev, newImages);
                stabilizeCanvasImages(laidOut.map(img => ({ id: img.id, url: img.url })));
                return [...prev, ...laidOut];
              });

              toast.success(`变体生成成功`, {
                description: `已生成 ${completedImages.length} 张变体图片`,
                className: 'bg-[#141414] border-[#2a2a2a] text-white',
              });
              try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }
            }

          // === 旧模式兼容 ===
          } else if (data.success && data.images) {
            const newImageUrls: string[] = data.images.map((img: { id: string; url: string; prompt: string }) => img.url);

            await handleAddImages(newImageUrls);

            toast.success(`变体生成成功`, {
              description: `已生成 ${data.images.length} 张变体图片`,
              className: 'bg-[#141414] border-[#2a2a2a] text-white',
            });
            try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }
          } else {
            toast.error('生成失败', {
              description: data.error || '未知错误',
              className: 'bg-[#141414] border border-red-900 text-white',
            });
          }
        } catch (error) {
          console.error('Variation generation error:', error);
          toast.error('生成失败', {
            description: '网络错误，请重试',
            className: 'bg-[#141414] border border-red-900 text-white',
          });
        } finally {
          setActiveGenerationCount(prev => Math.max(0, prev - 1));
        }
      }, [autoLayoutImages, handleAddImages, setImages, stabilizeCanvasImages]);

  const handlePreview = useCallback((image: CanvasImage) => {
    setPreviewImage(image);
  }, []);

  // 视频生成处理
  const handleVideoGenerate = useCallback(async (params: {
    prompt: string;
    model: string;
    imageUrl?: string;
    mode: 'text2video' | 'image2video-first' | 'image2video-firstlast' | 'image2video-ref' | 'video-extend' | 'multi-shot';
    aspectRatio: string;
    duration: number;
    quality: string;
    videoUrl?: string;
    extendDuration?: number;
    generateAudio?: boolean;
    providerId?: string;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    referenceImages?: string[];
    resolution?: string;
    // 新增高级参数
    cameraControl?: { type: string; angle?: number; speed?: number };
    motionBrush?: { maskDataUrl: string; trajectories: Array<{ startX: number; startY: number; endX: number; endY: number; speed?: number }> };
    characterReferences?: string[];
    motionStrength?: number;
    seed?: number;
    negativePrompt?: string;
    multiShotScenes?: Array<{ id: string; prompt: string; duration: number; cameraControl?: { type: string; angle?: number; speed?: number } }>;
    chainContinuity?: boolean;
    useGlobalReferences?: boolean;
    // 导演增强
    useDirector?: boolean;
    directorStyle?: string;
    compiledPrompt?: string;
    compiledNegative?: string;
    shotPlan?: unknown[];
    shotId?: string;
    shotIndex?: number;
    directorMode?: boolean;
    directorIntent?: string;
    _vgenReqId?: string;
  }) => {
    // ★ 链式多片段生成：当 chainContinuity=true 且有多个场景时，顺序生成每个片段
    if (params.chainContinuity && params.multiShotScenes && params.multiShotScenes.length > 1) {
      console.log(`[handleVideoGenerate] Chain mode: ${params.multiShotScenes.length} scenes`);
      setActiveGenerationCount(prev => prev + 1);

      // 辅助：从视频URL提取最后一帧（优先使用后端 ffmpeg 抽帧 API，降级用前端 video 元素）
      const extractLastFrame = async (videoUrl: string): Promise<string | null> => {
        // 1) 优先后端 ffmpeg（稳定、无跨域、画质好）
        try {
          const resp = await fetch('/api/video/extract-frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl, frame: 'last' }),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.imageUrl) return data.imageUrl;
          }
        } catch (e) {
          console.warn('[extractLastFrame] backend ffmpeg failed:', e);
        }
        // 2) 降级：前端 video 元素 canvas 截帧
        try {
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          video.muted = true;
          video.preload = 'auto';
          video.src = videoUrl;
          await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () => reject(new Error('Video load failed'));
            setTimeout(() => reject(new Error('Video load timeout')), 15000);
          });
          video.currentTime = Math.max(0, video.duration - 0.1);
          await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            setTimeout(() => reject(new Error('Seek timeout')), 5000);
          });
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(video, 0, 0);
          return canvas.toDataURL('image/jpeg', 0.92);
        } catch (e) {
          console.warn('[extractLastFrame] frontend fallback failed:', e);
          return null;
        }
      };

      // 辅助：保存 data URL 到服务器并获取本地路径
      const saveFrameToServer = async (dataUrl: string): Promise<string | null> => {
        try {
          const resp = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageData: dataUrl }),
          });
          if (resp.ok) {
            const data = await resp.json();
            return data.url || null;
          }
        } catch (e) {
          console.warn('[saveFrameToServer] Failed:', e);
        }
        return null;
      };

      // 顺序生成每个场景
      const chainResults: Array<{ sceneIndex: number; videoUrl: string }> = [];
      let prevVideoUrl: string | null = null;

      for (let i = 0; i < params.multiShotScenes.length; i++) {
        const scene = params.multiShotScenes[i];
        const isFirstScene = i === 0;
        const sceneLabel = `场景 ${i + 1}/${params.multiShotScenes.length}`;

        // 链式首帧：非第一个场景使用上一个场景视频的最后一帧
        let chainFirstFrame: string | undefined;
        if (!isFirstScene && prevVideoUrl) {
          const lastFrame = await extractLastFrame(prevVideoUrl);
          if (lastFrame) {
            const savedUrl = await saveFrameToServer(lastFrame);
            chainFirstFrame = savedUrl || lastFrame;
          }
        }

        // 构建场景请求
        const sceneRequest: Record<string, unknown> = {
          prompt: scene.prompt,
          model: params.model,
          imageUrl: chainFirstFrame || (isFirstScene ? (params.firstFrameUrl || params.imageUrl) : undefined),
          lastFrameImageUrl: undefined,
          referenceImages: params.useGlobalReferences ? params.referenceImages : undefined,
          characterReferences: params.useGlobalReferences ? params.characterReferences : undefined,
          mode: 'image2video-first',
          aspectRatio: params.aspectRatio,
          duration: scene.duration || params.duration,
          quality: params.quality,
          generateAudio: params.generateAudio,
          providerId: params.providerId,
          cameraControl: scene.cameraControl,
          motionStrength: params.motionStrength,
          seed: params.seed,
          negativePrompt: params.negativePrompt,
          useDirector: params.useDirector,
          directorStyle: params.directorStyle,
        };

        // 创建占位符
        const aspectRatio = params.aspectRatio || '16:9';
        const [arW, arH] = aspectRatio.split(':').map(Number);
        const arRatio = (arW || 16) / (arH || 9);
        const phWidth = arRatio >= 1 ? 400 : Math.round(400 * arRatio);
        const phHeight = arRatio >= 1 ? Math.round(400 / arRatio) : 400;
        const phId = `vid-chain-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;

        const canvasEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
        const viewportWidth = canvasEl ? canvasEl.clientWidth : 1200;
        const viewportHeight = canvasEl ? canvasEl.clientHeight : 800;
        let viewOffsetX = 0, viewOffsetY = 0, currentZoom = 1;
        const transformLayer = canvasEl?.querySelector('[style*="transform"]') as HTMLElement | null;
        if (transformLayer) {
          const match = transformLayer.style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
          if (match) { viewOffsetX = parseFloat(match[1]); viewOffsetY = parseFloat(match[2]); currentZoom = parseFloat(match[3]); }
        }
        const offsetX = i * (phWidth + 60);
        const canvasCenterX = (viewportWidth / 2 - viewOffsetX) / currentZoom + offsetX;
        const canvasCenterY = (viewportHeight / 2 - viewOffsetY) / currentZoom;

        setImages(prev => [...prev, {
          id: phId,
          url: '',
          x: canvasCenterX - phWidth / 2,
          y: canvasCenterY - phHeight / 2,
          width: phWidth, height: phHeight,
          originalWidth: phWidth * 2, originalHeight: phHeight * 2,
          isProcessingPlaceholder: true,
          processing: {
            label: `${sceneLabel} · 视频生成中`,
            status: 'submitting',
            progress: 5,
            startTime: Date.now(),
          },
          aspectRatio: params.aspectRatio,
          model: params.model,
          prompt: scene.prompt,
          createdAt: Date.now(),
          mediaType: 'video' as const,
        }]);

        try {
          // 提交场景请求
          const submitResp = await fetch('/api/video/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sceneRequest),
          });
          const submitData = await submitResp.json();
          if (!submitResp.ok || submitData.error) {
            throw new Error(submitData.error || '场景提交失败');
          }

          const taskId = submitData.taskId;
          setImages(prev => prev.map(img =>
            img.id === phId ? {
              ...img,
              processing: { ...img.processing, status: 'processing' as const, progress: 10, taskId },
            } as CanvasImage : img
          ));

          // 轮询场景结果
          const sceneResult = await new Promise<{ videoUrl: string | null; error: string | null }>((resolve) => {
            const maxPollTime = 25 * 60 * 1000;
            const startTime = Date.now();
            let attempts = 0;

            const poll = async () => {
              if (attempts > 500 || Date.now() - startTime > maxPollTime) {
                resolve({ videoUrl: null, error: '超时' });
                return;
              }
              const interval = attempts < 3 ? 1000 : attempts < 8 ? 1500 : attempts < 20 ? 2000 : 3000;
              if (attempts > 0) await new Promise(r => setTimeout(r, interval));

              try {
                const pollResp = await fetch('/api/poll-task', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId, model: params.model, providerId: params.providerId }),
                });
                const pollData = await pollResp.json();

                if (pollData.status === 'completed') {
                  const videoUrl = pollData.videoUrl || pollData.result?.videoUrl;
                  resolve({ videoUrl: videoUrl || null, error: videoUrl ? null : '未获取到视频地址' });
                } else if (pollData.status === 'failed') {
                  resolve({ videoUrl: null, error: pollData.error || '生成失败' });
                } else {
                  const progress = pollData.progress || 0;
                  setImages(prev => prev.map(img =>
                    img.id === phId ? {
                      ...img,
                      processing: { ...img.processing, progress: Math.max(10, progress), status: 'processing' as const, label: `${sceneLabel} · ${pollData.label || '生成中'}` },
                    } as CanvasImage : img
                  ));
                  attempts++;
                  poll();
                }
              } catch {
                attempts++;
                poll();
              }
            };
            poll();
          });

          if (sceneResult.videoUrl) {
            // 持久化视频
            let persistedUrl = sceneResult.videoUrl;
            try {
              const persistResp = await fetch('/api/save-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: sceneResult.videoUrl, isVideo: true }),
              });
              if (persistResp.ok) {
                const persistData = await persistResp.json();
                if (persistData.url) persistedUrl = persistData.url;
              }
            } catch { /* 持久化失败用原URL */ }

            chainResults.push({ sceneIndex: i, videoUrl: persistedUrl });
            prevVideoUrl = persistedUrl;

            // 更新占位符为完成状态
            setImages(prev => prev.map(img =>
              img.id === phId ? {
                ...img,
                url: persistedUrl,
                mediaType: 'video' as const,
                videoUrl: persistedUrl,
                originalWidth: 1920,
                originalHeight: 1080,
                isProcessingPlaceholder: false,
                processing: undefined,
                prompt: scene.prompt,
                modelName: params.model,
                apiProvider: params.providerId || undefined,
              } as CanvasImage : img
            ));

            try { UserManagerCore.getInstance().recordUsage('video'); } catch {}
          } else {
            // 场景失败，移除占位符
            setImages(prev => prev.filter(img => img.id !== phId));
            toast.error(`${sceneLabel}生成失败`, { description: sceneResult.error || '未知错误', className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
            // 链式生成：一个场景失败后停止后续场景
            break;
          }
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : '场景生成失败';
          setImages(prev => prev.filter(img => img.id !== phId));
          toast.error(`${sceneLabel}生成失败`, { description: errorMsg, className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
          break;
        }
      }

      setActiveGenerationCount(prev => Math.max(0, prev - 1));
      if (chainResults.length > 0) {
        toast.success(`链式生成完成`, { description: `成功生成 ${chainResults.length}/${params.multiShotScenes.length} 个场景`, className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
      }
      return; // 链式模式不走常规单视频生成逻辑
    }

    setActiveGenerationCount(prev => prev + 1);

    const placeholderBaseSize = 400;
    const aspectRatio = params.aspectRatio || '16:9';
    const [arW, arH] = aspectRatio.split(':').map(Number);
    const arRatio = (arW || 16) / (arH || 9);
    const phWidth = arRatio >= 1 ? placeholderBaseSize : Math.round(placeholderBaseSize * arRatio);
    const phHeight = arRatio >= 1 ? Math.round(placeholderBaseSize / arRatio) : placeholderBaseSize;

    const phId = `vid-ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const canvasEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
    const viewportWidth = canvasEl ? canvasEl.clientWidth : 1200;
    const viewportHeight = canvasEl ? canvasEl.clientHeight : 800;
    let viewOffsetX = 0, viewOffsetY = 0, currentZoom = 1;
    const transformLayer = canvasEl?.querySelector('[style*="transform"]') as HTMLElement | null;
    if (transformLayer) {
      const match = transformLayer.style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
      if (match) { viewOffsetX = parseFloat(match[1]); viewOffsetY = parseFloat(match[2]); currentZoom = parseFloat(match[3]); }
    }
    const canvasCenterX = (viewportWidth / 2 - viewOffsetX) / currentZoom;
    const canvasCenterY = (viewportHeight / 2 - viewOffsetY) / currentZoom;

    setImages(prev => [...prev, {
      id: phId,
      url: '',
      x: canvasCenterX - phWidth / 2,
      y: canvasCenterY - phHeight / 2,
      width: phWidth, height: phHeight,
      originalWidth: phWidth * 2, originalHeight: phHeight * 2,
      isProcessingPlaceholder: true,
      processing: {
        label: params.mode === 'video-extend' ? '视频延长中' : '视频生成中',
        status: 'submitting',
        progress: 5,
        startTime: Date.now(),
      },
      aspectRatio: params.aspectRatio,
      model: params.model,
      prompt: params.prompt,
      createdAt: Date.now(),
      mediaType: 'video' as const,
    }]);

    try {
      // 视频延长使用 /api/video/extend，其他使用 /api/video/generate
      const isExtend = params.mode === 'video-extend';
      const apiEndpoint = isExtend ? '/api/video/extend' : '/api/video/generate';
      const requestBody = isExtend ? {
        videoUrl: params.videoUrl,
        prompt: params.prompt,
        model: params.model,
        extendDuration: params.extendDuration || params.duration,
        generateAudio: params.generateAudio,
        providerId: params.providerId,
        useDirector: params.useDirector,
        directorStyle: params.directorStyle || params.directorMode,
        negativePrompt: params.compiledNegative || params.negativePrompt,
        cameraControl: params.cameraControl,
        seed: params.seed,
        directorIntent: params.directorIntent,
      } : {
        prompt: params.compiledPrompt || params.prompt,
        model: params.model,
        imageUrl: params.firstFrameUrl || params.imageUrl,
        lastFrameImageUrl: params.lastFrameUrl,
        referenceImages: params.referenceImages,
        mode: params.mode,
        aspectRatio: params.aspectRatio,
        duration: params.duration,
        quality: params.quality,
        generateAudio: params.generateAudio,
        providerId: params.providerId,
        resolution: params.resolution,
        cameraControl: params.cameraControl,
        motionBrush: params.motionBrush,
        characterReferences: params.characterReferences,
        motionStrength: params.motionStrength,
        seed: params.seed,
        negativePrompt: params.compiledNegative || params.negativePrompt,
        multiShotScenes: params.multiShotScenes,
        chainContinuity: params.chainContinuity,
        useGlobalReferences: params.useGlobalReferences,
        useDirector: params.useDirector,
        directorMode: params.directorStyle || params.directorMode,
        directorIntent: params.directorIntent,
        shotId: params.shotId,
        _vgenReqId: phId,
      };

      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '视频生成提交失败');
      }

      const taskId = data.taskId;
      if (params.shotId && taskId) {
        shotTaskIdMapRef.current.set(params.shotId, taskId);
      }
      setImages(prev => prev.map(img =>
        img.id === phId ? {
          ...img,
          processing: { ...img.processing, status: 'processing' as const, progress: 10, taskId },
        } as CanvasImage : img
      ));

      // 渐进式轮询视频任务（与图片生成一致，SSE加速 + 渐进间隔）
      const videoPollStartTime = Date.now();
      const pollVideoResult = async (attempt = 0): Promise<void> => {
        if (hasDirectVideoPollingTimedOut(attempt, Date.now() - videoPollStartTime)) {
          setImages(prev => prev.filter(img => img.id !== phId));
          toast.error('视频生成超时', { description: '已超过最大等待时间', className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
          setActiveGenerationCount(prev => Math.max(0, prev - 1));
          return;
        }
        // 渐进式间隔：1s → 1.5s → 2s → 3s（视频生成通常较慢，间隔不宜过短）
        const getVideoPollInterval = (a: number) => {
          if (a < 3) return 1000;    // 前3次：1秒（快速检测早期完成）
          if (a < 8) return 1500;    // 3-8次：1.5秒
          if (a < 20) return 2000;   // 8-20次：2秒
          return 3000;               // 20次后：3秒
        };

        try {
          // 首次轮询立即执行（不等待间隔），后续轮询SSE加速 + 渐进间隔
          if (attempt > 0) {
            // SSE加速：同时等待SSE事件和定时器，哪个先到用哪个
            const ssePromise = new Promise<void>((resolve) => {
              let resolved = false;
              const handler = (event: { taskId?: string; task?: { status?: string } }) => {
                if (event.taskId === taskId && !resolved) {
                  resolved = true;
                  unsub();
                  resolve();
                }
              };
              const unsub = taskEventsClient.onTaskEvent(handler);
              // 5秒后移除监听，避免内存泄漏
              setTimeout(() => {
                if (!resolved) { resolved = true; unsub(); resolve(); }
              }, 5000);
            });

            const pollPromise = (async () => {
              const interval = getVideoPollInterval(attempt);
              await new Promise(r => setTimeout(r, interval));
            })();

            await Promise.race([ssePromise, pollPromise]);
          }

          const pollRes = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, model: params.model, providerId: params.providerId }),
          });
          const pollData = await pollRes.json();

          if (pollData.status === 'completed') {
            if (!isMountedRef.current) return; // 组件已卸载，停止轮询
            const rawVideoUrl = pollData.videoUrl || pollData.url;
            const rawThumbnailUrl = pollData.thumbnailUrl || pollData.url;
            if (rawVideoUrl) {
              // ★ 持久化远程URL到本地，防止过期后图片/视频消失
              const [stableThumbnail, stableVideo] = await Promise.all([
                awaitStableImageUrl(rawThumbnailUrl, 30000, { isVideo: false }),
                awaitStableImageUrl(rawVideoUrl, 120000, { isVideo: true }),
              ]);
              if (!isMountedRef.current) return; // 持久化期间组件可能卸载
              setImages(prev => prev.map(img =>
                img.id === phId ? {
                  ...img,
                  url: stableThumbnail || '',
                  videoUrl: stableVideo,
                  videoDuration: params.duration,
                  mediaType: 'video' as const,
                  originalWidth: pollData.width || 1920,
                  originalHeight: pollData.height || 1080,
                  isProcessingPlaceholder: false,
                  processing: undefined,
                  prompt: params.prompt,
                  modelName: params.model,
                  apiProvider: params.providerId || undefined,
                } as CanvasImage : img
              ));
              // Track video usage
              try { UserManagerCore.getInstance().recordUsage('video'); } catch {}
              // 通知视频面板回填镜头结果（用于多镜头尾帧接力串行流水线）
              try {
                const shotId = params.shotId;
                if (shotId && videoPanelRef.current?.notifyShotVideoGenerated) {
                  videoPanelRef.current.notifyShotVideoGenerated({
                    shotId,
                    videoUrl: stableVideo || rawVideoUrl,
                    thumbnailUrl: stableThumbnail || rawThumbnailUrl || undefined,
                  });
                }
              } catch {}
            } else {
              setImages(prev => prev.filter(img => img.id !== phId));
              toast.error('视频生成失败', { description: '未获取到视频地址', className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
            }
            setActiveGenerationCount(prev => Math.max(0, prev - 1));
          } else if (pollData.status === 'failed') {
            setImages(prev => prev.filter(img => img.id !== phId));
            toast.error('视频生成失败', { description: pollData.error || '未知错误', className: themeStyle === 'monochrome' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-[#141414] border-[#2a2a2a] text-white' });
            setActiveGenerationCount(prev => Math.max(0, prev - 1));
            // 通知视频面板：shot 失败（解开 waitForShotTask 的等待）
            try {
                const shotId = params.shotId;
              if (shotId && videoPanelRef.current?.notifyShotVideoFailed) {
                videoPanelRef.current.notifyShotVideoFailed({ shotId, error: pollData.error || '视频生成失败' });
              }
            } catch {}
          } else {
            // 更新进度，继续轮询
            const progress = pollData.progress || 0;
            setImages(prev => prev.map(img =>
              img.id === phId ? {
                ...img,
                processing: { ...img.processing, progress: Math.max(10, progress), status: 'processing' as const, label: pollData.label || '视频生成中' },
              } as CanvasImage : img
            ));
            // 递归继续轮询
            if (isMountedRef.current) pollVideoResult(attempt + 1);
          }
        } catch {
          // 轮询错误，继续尝试
          if (isMountedRef.current) pollVideoResult(attempt + 1);
        }
      };

      // 立即开始第一次轮询（不等待间隔）
      pollVideoResult(0);

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '视频生成失败';
      setImages(prev => prev.filter(img => img.id !== phId));
      toast.error('视频生成失败', {
        description: errorMsg,
        className: themeStyle === 'monochrome'
          ? 'bg-white border border-gray-200 text-gray-900'
          : 'bg-[#141414] border-[#2a2a2a] text-white',
      });
      setActiveGenerationCount(prev => Math.max(0, prev - 1));
    }
  }, [setImages, themeStyle]);

  const handleAnalyzeImage = useCallback(async (imageData: string): Promise<string> => {
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, category: 'general' }),
      });

      const data = await response.json();

      if (data.success && data.prompt) {
        return data.prompt;
      } else {
        throw new Error(data.error || '分析失败');
      }
    } catch (error) {
      console.error('Image analysis error:', error);
      throw error;
    }
  }, []);

  // 图片融合
  const handleFusion = useCallback(async (params: {
    prompt: string;
    aspectRatio: string;
    quality: string;
    count: number;
    referenceImages: string[];
  }) => {
    setActiveGenerationCount(prev => prev + 1);

    try {
      const ratioToSize: Record<string, string> = {
        '1:1': '1024x1024',
        '4:3': '1366x1024',
        '3:4': '1024x1366',
        '16:9': '1820x1024',
        '9:16': '1024x1820',
        '3:2': '1536x1024',
        '2:3': '1024x1536',
      };

      const size = ratioToSize[params.aspectRatio] || '1024x1024';

      // 根据画质添加提示词后缀
      let qualityPrompt = '';
      switch (params.quality) {
        case 'ultra': qualityPrompt = ', ultra detailed, extremely high quality'; break;
        case '2k': qualityPrompt = ', 2K resolution, high detail'; break;
        case '4k': qualityPrompt = ', 4K resolution, ultra detailed'; break;
        case 'hd': qualityPrompt = ', high quality, detailed'; break;
        default: qualityPrompt = ', high quality';
      }

      const fullPrompt = params.prompt + qualityPrompt;

      // ★ 获取当前选择的模型和提供商
      const currentModelRaw = typeof window !== 'undefined' ? localStorage.getItem('wujie_selected_model') : null;
      let fusionModel: string | undefined;
      let fusionProviderId: string | undefined;
      if (currentModelRaw) {
        try {
          const wsm = JSON.parse(currentModelRaw);
          fusionModel = wsm.model;
          fusionProviderId = wsm.providerId;
        } catch {}
      }

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          size,
          model: fusionModel,
          providerId: fusionProviderId,
          referenceImages: params.referenceImages,
          referenceMode: 'blend',
          imageCategory: 'general',
          productCategory: 'none',
          aspectRatio: params.aspectRatio,
          stylePreset: 'auto',
          outputCount: params.count,
          submitOnly: true,
          userId: currentUser?.id,
        }),
      });

      const data = await response.json();

      if (!data.success || !data.taskIds || data.taskIds.length === 0) {
        toast.error('融合失败', {
          description: data.error || '提交任务失败',
          className: 'bg-[#141414] border border-red-900 text-white',
        });
        setActiveGenerationCount(prev => Math.max(0, prev - 1));
        return;
      }

      const newImageUrls: string[] = [];

      for (let i = 0; i < data.taskIds.length; i++) {
        const taskId = data.taskIds[i];
        let pollAttempts = 0;
        const maxAttempts = 180;

        while (pollAttempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          pollAttempts++;

          try {
            const pollRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: fusionModel, providerId: fusionProviderId }),
            });
            const pollData = await pollRes.json();

            if (pollData.status === 'completed') {
              const resultUrl = pollData.imageUrl || pollData.result?.url || pollData.result?.imageUrl || pollData.result?.image?.url || (pollData.result?.images && pollData.result.images[0]?.url) || (pollData.images && pollData.images[0]?.url);
              if (resultUrl) {
                newImageUrls.push(resultUrl);
              }
              break;
            } else if (pollData.status === 'failed') {
              console.error('融合任务失败:', pollData.error);
              break;
            }
          } catch (pollErr) {
            console.error('轮询错误:', pollErr);
          }
        }
      }

      if (newImageUrls.length > 0) {
        await handleAddImages(newImageUrls);

        toast.success('融合成功', {
          description: `已生成 ${newImageUrls.length} 张融合图片`,
          className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
        });
      } else {
        toast.error('融合失败', {
          description: '生成超时或失败，请重试',
          className: 'bg-[#141414] border border-red-900 text-white',
        });
      }
    } catch (error) {
      console.error('Fusion error:', error);
      toast.error('融合失败', {
        description: '网络错误，请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    } finally {
      setActiveGenerationCount(prev => Math.max(0, prev - 1));
    }
  }, [currentUser?.id, handleAddImages, themeStyle]);

  // 画布Ctrl+点击参考图片选择
  const handleCanvasReferenceSelect = useCallback((image: CanvasImage) => {
    setCtrlRefSelections(prev => {
      const exists = prev.find(r => r.id === image.id);
      if (exists) {
        // 取消选择 - 移除并重新编号
        const filtered = prev.filter(r => r.id !== image.id);
        return filtered.map((r, i) => ({ ...r, number: i + 1 }));
      }
      // 添加新选择，分配编号
      return [...prev, { url: image.url, id: image.id, number: prev.length + 1, keyword: '' }];
    });
  }, []);

  // 更新参考图片关键词
  const handleUpdateCtrlRefKeyword = useCallback((id: string, keyword: string) => {
    setCtrlRefSelections(prev => prev.map(r => r.id === id ? { ...r, keyword } : r));
  }, []);

  // 移除单个参考选择
  const handleRemoveCtrlRef = useCallback((id: string) => {
    setCtrlRefSelections(prev => {
      const filtered = prev.filter(r => r.id !== id);
      return filtered.map((r, i) => ({ ...r, number: i + 1 }));
    });
  }, []);

  // Alt+Click 标记参考图 - 添加到创意描述文本框的数字标记
  const handleAltMarkReference = useCallback((image: CanvasImage) => {
    setAltRefMarkers(prev => {
      const exists = prev.find(r => r.id === image.id);
      if (exists) {
        // 已标记则取消标记
        const filtered = prev.filter(r => r.id !== image.id);
        return filtered.map((r, i) => ({ ...r, number: i + 1 }));
      }
      // 添加新标记
      return [...prev, { id: image.id, url: image.url, number: prev.length + 1 }];
    });
  }, []);

  // 移除单个 Alt 标记
  const handleRemoveAltRefMarker = useCallback((id: string) => {
    setAltRefMarkers(prev => {
      const filtered = prev.filter(r => r.id !== id);
      return filtered.map((r, i) => ({ ...r, number: i + 1 }));
    });
  }, []);

  // 融合生成
  const handleFusionGenerate = useCallback((refs: CtrlRefSelection[], fusionPrompt: string) => {
    const refKeywords = refs.map(r => r.keyword).filter(Boolean);
    // 构建融合提示词：清晰描述参考图关系 + 融合目标
    let combinedPrompt = '';
    if (refKeywords.length > 0) {
      combinedPrompt += refs.map((r) => `[参考${r.number}: ${r.keyword}]`).join(' ');
    }
    if (fusionPrompt) {
      combinedPrompt += (combinedPrompt ? ' → ' : '') + fusionPrompt;
    }
    if (!combinedPrompt) {
      combinedPrompt = '将参考图片融合成统一、完整的创意构图';
    }
    // 同时设置参考图片
    const refUrls = refs.map(r => r.url);
    // 调用生成 - 使用支持图生图的 Gemini 模型
    handleGenerate({
      prompt: combinedPrompt,
      size: '1024x1024',
      referenceImages: refUrls,
      referenceMode: 'fusion' as const,
      imageCategory: 'none',
      productCategory: 'none',
      aspectRatio: '1:1',
      stylePreset: 'none',
      outputCount: 1,
      model: 'gemini-2.5-flash-image-preview',
      quality: '1K',
    });
  }, [handleGenerate]);

  // 一键提取关键词（从画布图片提取）
  useCallback(async (image: { id: string; url: string }) => {
        try {
          // 使用管理员配置的视觉模型（与"灵感提示词"功能共用模型选择逻辑）
          let visionModel = '';
          let providerId: string | undefined;
          let providerPreset: string | undefined;

          // Priority 1: Use the currently selected chat model
          if (currentChatModelInfo) {
            if (currentChatModelInfo.providerId) {
              visionModel = currentChatModelInfo.model;
              providerId = currentChatModelInfo.providerId;
              providerPreset = currentChatModelInfo.providerPreset;
            } else {
              visionModel = currentChatModelInfo.model;
            }
          }

          // Priority 2: Fallback - search for a vision-capable model (chat + VLM)
          if (!visionModel) {
            try {
              // Search both chat and VLM model types
              const [chatRes, vlmRes] = await Promise.all([
                fetch('/api/models?type=chat').then(r => r.json()).catch(() => ({ providers: [], models: [] })),
                fetch('/api/models?type=vlm').then(r => r.json()).catch(() => ({ providers: [], models: [] })),
              ]);
              const providers = [
                ...(Array.isArray(chatRes.providers) ? chatRes.providers : []),
                ...(Array.isArray(vlmRes.providers) ? vlmRes.providers : []),
              ];
              const models = [
                ...(Array.isArray(chatRes.models) ? chatRes.models : []),
                ...(Array.isArray(vlmRes.models) ? vlmRes.models : []),
              ];
              const visionModelPatterns = [
                /gpt-4o/i, /gpt-4-turbo/i, /gpt-4\./i, /gpt-5/i,
                /claude-3/i, /claude-4/i, /claude-3\.5/i,
                /gemini/i,
                /qwen-vl/i, /qwen2-vl/i, /qwen2\.5-vl/i, /qvq/i,
                /glm-4v/i, /glm-4\.6v/i,
                /internvl/i, /llava/i, /cogvlm/i, /doubao/i, /seed/i,
              ];
              const foundModel = models.find((model: { id?: string; name?: string; providerId?: string }) => {
                const haystack = `${model.id || ''} ${model.name || ''}`;
                return visionModelPatterns.some(pat => pat.test(haystack));
              });
              if (foundModel?.id) {
                const provider = providers.find((item: { id?: string; providerPreset?: string }) => item.id === foundModel.providerId);
                visionModel = foundModel.id;
                providerId = foundModel.providerId;
                providerPreset = provider?.providerPreset;
              }
            } catch {}
          }

          if (!visionModel) {
            toast.error('未找到支持图片理解的模型', {
              description: '请在智能对话面板中选择一个支持视觉的模型',
              className: 'bg-[#141414] border border-red-900 text-white',
            });
            return;
          }

          const response = await fetch('/api/vision-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageUrl: image.url,
              model: visionModel,
              providerId,
              providerPreset,
              userId: currentUser?.id,
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `API 调用失败: ${response.status}`);
          }

          const result = await response.json();
          const prompt = result?.data?.bilingual || result?.data?.english || result?.data?.chinese || result?.prompt || '';

          if (prompt) {
            // 直接填充到图像生成面板的提示词输入框
            setExternalPrompt(prompt);
            toast.success('关键词已提取并填入描述区', {
              description: prompt.substring(0, 80) + (prompt.length > 80 ? '...' : ''),
              className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
            });
          } else {
            toast.error('提取结果为空', {
              description: '模型未返回有效关键词',
              className: 'bg-[#141414] border border-red-900 text-white',
            });
          }
        } catch (error) {
          console.error('Extract keywords error:', error);
          toast.error('提取失败', {
            description: '关键词提取失败，请重试',
            className: 'bg-[#141414] border border-red-900 text-white',
          });
        }
      }, [currentChatModelInfo, currentUser, themeStyle]);

  // 提示词大师 - 从chat-panel传递到generation-panel
  const [externalPrompt, setExternalPrompt] = useState<string | undefined>(undefined);
  const [externalReferenceImage, setExternalReferenceImage] = useState<{ url: string; description?: string } | null>(null);

  // Oh My Prompt - Vision Prompt handler
  const handleVisionPrompt = useCallback(async (imageUrl: string) => {
    // Use the same model/API as the chat panel (智能对话)
    let visionModel = '';
    let providerId: string | undefined;
    let providerPreset: string | undefined;

    // Priority 1: Use the currently selected chat model from ChatPanel
    if (currentChatModelInfo) {
      if (currentChatModelInfo.providerId) {
        // Third-party chat model
        visionModel = currentChatModelInfo.model;
        providerId = currentChatModelInfo.providerId;


        providerPreset = currentChatModelInfo.providerPreset;
      } else {
        // Server-managed model
        visionModel = currentChatModelInfo.model;
      }
    }

    // Priority 2: Fallback - search for a vision-capable model from server-managed providers
    if (!visionModel) {
      try {
        const response = await fetch('/api/models?type=chat', { cache: 'no-store' });
        const data = await response.json();
        const providers = Array.isArray(data.providers) ? data.providers : [];
        const models = Array.isArray(data.models) ? data.models : [];

        const visionModelPatterns = [
          /gpt-4o/i, /gpt-4-turbo/i, /gpt-4\./i,
          /claude-3/i, /claude-4/i, /claude-3\.5/i,
          /gemini/i,
          /qwen-vl/i, /qwen2-vl/i, /qwen2\.5-vl/i, /qvq/i,
          /glm-4v/i, /glm-4\.6v/i,
          /internvl/i, /llava/i, /cogvlm/i, /moondream/i, /kosmos/i, /fuyu/i,
        ];

        const foundModel = models.find((model: { id?: string; name?: string; providerId?: string }) => {
          const haystack = `${model.id || ''} ${model.name || ''}`;
          return visionModelPatterns.some(pat => pat.test(haystack));
        });

        if (foundModel?.id) {
          const provider = providers.find((item: { id?: string; providerPreset?: string }) => item.id === foundModel.providerId);
          visionModel = foundModel.id;
          providerId = foundModel.providerId;
          providerPreset = provider?.providerPreset;
        } else {
          for (const provider of providers as Array<{ id?: string; selectedModels?: string[]; providerPreset?: string }>) {
            const found = provider.selectedModels?.find((modelId: string) => visionModelPatterns.some(pat => pat.test(modelId)));
            if (found) {
              visionModel = found;
              providerId = provider.id;
              providerPreset = provider.providerPreset;
              break;
            }
          }
        }
      } catch {}
    }

    if (!visionModel) {
      toast.error('未找到支持图片理解的模型', {
        description: '请在智能对话面板中选择一个支持视觉的模型',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
      return;
    }

    setIsVisionAnalyzing(true);
    try {
      toast.info('正在分析图片...', {
        description: '灵感提示词库正在生成双语提示词',
        className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
        duration: 5000,
      });

      const response = await fetch('/api/vision-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          model: visionModel,
              providerId,


          providerPreset,
          userId: currentUser?.id,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `API 调用失败: ${response.status}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        const data = result.data;
        // Store structured vision result for OhMyPrompt component
        setVisionResult(data);

        // Build bilingual prompt string
        let promptText = '';
        if (data.zh?.prompt) {
          promptText += `【中文提示词】${data.zh.prompt}`;
        }
        if (data.en?.prompt) {
          promptText += `${promptText ? '\n' : ''}【英文提示词】${data.en.prompt}`;
        }
        if (data.zh_style_tags?.length || data.en_style_tags?.length) {
          const zhTags = data.zh_style_tags?.length ? data.zh_style_tags.join(', ') : '';
          const enTags = data.en_style_tags?.length ? data.en_style_tags.join(', ') : '';
          promptText += `\n【风格标签】${zhTags}${enTags ? ' | ' + enTags : ''}`;
        }
        if (!promptText && data.raw) {
          promptText = data.raw;
        }

        if (promptText) {
          setExternalPrompt(promptText);
          toast.success('提示词生成成功', {
            description: data.zh?.title || data.en?.title || '双语提示词已生成',
            className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
          });
        } else {
          toast.warning('分析结果为空', {
            description: '模型未能生成有效的提示词',
            className: 'bg-[#141414] border border-yellow-900 text-white',
          });
        }
      } else {
        throw new Error(result.error || '分析失败');
      }
    } catch (error) {
      console.error('Vision prompt error:', error);
      toast.error('图片分析失败', {
        description: error instanceof Error ? error.message : '请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    } finally {
      setIsVisionAnalyzing(false);
    }
  }, [currentChatModelInfo, currentUser?.id, themeStyle]);

  // 右键提取关键词 - 打开oh-my-prompt识词面板并显示进度
  const handleCanvasExtractKeywords = useCallback((image: { id: string; url: string }) => {
    // 打开oh-my-prompt面板并自动触发识词
    setOhMyPromptOpen(true);
    setVisionPromptEnabled(true);
    // 显示提取中提示
    toast.loading('正在识别图片关键词...', {
      className: themeStyle === 'monochrome' ? 'bg-white border-blue-500 text-gray-900' : 'bg-[#141414] border-[#d4af37] text-white',
    });
    // 调用识词API
    handleVisionPrompt(image.url);
  }, [handleVisionPrompt, themeStyle]);

  const handleAddToPrompt = useCallback((optimizedPrompt: string) => {
    setExternalPrompt(optimizedPrompt);
    setActivePanel('generate');
  }, []);

  const handleExternalPromptConsumed = useCallback(() => {
    setExternalPrompt(undefined);
  }, []);

  // AI聊天中的图像生成回调 - 当AI建议生成图片时直接触发
  const handleChatGenerateImage = useCallback((prompt: string, outputCount?: number, aspectRatio?: string, quality?: string) => {
    // 从 wujie_selected_model 读取当前选择的图像生成模型（与 generation-panel 同步）
    let model = '';
    let providerId: string | undefined;
    try {
      const rawModel = localStorage.getItem('wujie_selected_model');
      if (rawModel) {
        const modelInfo = JSON.parse(rawModel);
        model = modelInfo.model || '';
        providerId = modelInfo.providerId || undefined;
      }
      // 备用：从 userData 读取
      if (!model) {
        const currentUserId = localStorage.getItem('unbounded_ai_current_user');
        const raw = localStorage.getItem('unbounded_ai_user_data');
        if (raw && currentUserId) {
          const data = JSON.parse(raw);
          const selectedModel = data?.userData?.[currentUserId]?.selectedModel;
          if (selectedModel) {
            if (selectedModel.includes('::')) {
              const parts = selectedModel.split('::');
              providerId = parts[0];
              model = parts.slice(1).join('::');
            } else {
              model = selectedModel;
            }
          }
        }
      }
    } catch { /* fallback */ }

    if (!model) {
      toast.error('未选择图像生成模型', {
        description: '请先在图像生成面板中选择模型',
        className: 'bg-[#141414] border border-yellow-900 text-white',
      });
      return;
    }

    // 调用 handleGenerate 执行实际的图像生成
    handleGenerate({
      prompt: prompt,
      outputCount: outputCount || 1,
      aspectRatio: aspectRatio || '1:1',
      size: '',
      referenceImages: [],
      referenceMode: 'style',
      imageCategory: '',
      productCategory: '',
      stylePreset: '',
      quality: quality || 'standard',
      model: model,
      providerId: providerId,
    });
  }, [handleGenerate]);

  // 适配 InfiniteCanvas 的简单回调函数
  const handleCanvasGenerateVariation = useCallback((image: CanvasImage) => {
    setExternalReferenceImage({ url: image.url, description: image.prompt || '' });
  }, []);

  const handleCanvasFusion = useCallback((images: CanvasImage[]) => {
    handleFusion({
      prompt: '',
      aspectRatio: '1:1',
      quality: 'standard',
      count: 1,
      referenceImages: images.map(img => img.url)
    });
  }, [handleFusion]);

  // Canvas img2img handler - reuses handleGenerate for reliable submission + polling
  // Language-based image editing handler
  const handleEditImage = useCallback((image: CanvasImage | null) => {
    window.dispatchEvent(new Event('wujie:close-canvas-tool-panels'));
    setShowVideoPanel(false);
    setEditingImage(image);
    setShowImageEditor(true);
  }, []);

  const handleOpenVideoPanel = useCallback(() => {
    window.dispatchEvent(new Event('wujie:close-canvas-tool-panels'));
    setShowImageEditor(false);
    setShowVideoPanel(true);
  }, []);

  const handleEditCancel = useCallback(() => {
    setShowImageEditor(false);
    setEditingImage(null);
  }, []);

  // Add image to favorites
  // localStorage 兜底：数据库不可用时用本地存储
  const getLocalFavorites = useCallback((): FavoriteItem[] => {
    try {
      const raw = localStorage.getItem('wujie-favorites-local');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }, []);

  const saveLocalFavorites = useCallback((items: FavoriteItem[]) => {
    try { localStorage.setItem('wujie-favorites-local', JSON.stringify(items)); } catch { /* ignore */ }
  }, []);

  const handleAddToFavorites = useCallback(async (image: CanvasImage) => {
    if (!currentUser) {
      toast.error('请先登录后再收藏');
      return;
    }
    const userId = currentUser.id || currentUser.name;
    const currentModel = localStorage.getItem('wujie-current-image-model') || '';
    const currentProvider = localStorage.getItem('wujie-current-api-provider') || '';
    const favData = {
      userId,
      username: currentUser.name || '',
      imageUrl: image.url,
      prompt: image.prompt || '',
      negativePrompt: image.negativePrompt || '',
      model: currentModel,
      modelName: currentModel,
      aspectRatio: image.width && image.height ? `${image.width}:${image.height}` : '',
      imageWidth: image.width,
      imageHeight: image.height,
      originalWidth: image.originalWidth,
      originalHeight: image.originalHeight,
      apiProvider: currentProvider,
      sourceType: 'generated',
    };
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(favData),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || '已添加到收藏夹');
        // 同步到本地缓存
        const local = getLocalFavorites();
        if (!local.find(f => f.image_url === image.url)) {
          local.unshift({
            id: data.id || Date.now(),
            user_id: userId,
            username: favData.username,
            image_url: image.url,
            prompt: favData.prompt,
            negative_prompt: favData.negativePrompt,
            model: favData.model,
            model_name: favData.modelName,
            aspect_ratio: favData.aspectRatio,
            quality: '',
            image_width: favData.imageWidth || 0,
            image_height: favData.imageHeight || 0,
            original_width: favData.originalWidth || 0,
            original_height: favData.originalHeight || 0,
            api_provider: favData.apiProvider,
            api_base_url: '',
            source_type: 'generated',
            created_at: Date.now(),
          });
          saveLocalFavorites(local);
        }
      } else {
        // API返回错误 → localStorage兜底
        const local = getLocalFavorites();
        if (!local.find(f => f.image_url === image.url)) {
          local.unshift({
            id: Date.now(),
            user_id: userId,
            username: favData.username,
            image_url: image.url,
            prompt: favData.prompt,
            negative_prompt: favData.negativePrompt,
            model: favData.model,
            model_name: favData.modelName,
            aspect_ratio: favData.aspectRatio,
            quality: '',
            image_width: favData.imageWidth || 0,
            image_height: favData.imageHeight || 0,
            original_width: favData.originalWidth || 0,
            original_height: favData.originalHeight || 0,
            api_provider: favData.apiProvider,
            api_base_url: '',
            source_type: 'generated',
            created_at: Date.now(),
          });
          saveLocalFavorites(local);
        }
        toast.success('已添加到收藏夹（本地）');
      }
    } catch (err) {
      // 网络错误 → localStorage兜底
      console.error('[Favorites] add error, falling back to localStorage:', err);
      const local = getLocalFavorites();
      if (!local.find(f => f.image_url === image.url)) {
        local.unshift({
          id: Date.now(),
          user_id: userId,
          username: favData.username,
          image_url: image.url,
          prompt: favData.prompt,
          negative_prompt: favData.negativePrompt,
          model: favData.model,
          model_name: favData.modelName,
          aspect_ratio: favData.aspectRatio,
          quality: '',
          image_width: favData.imageWidth || 0,
          image_height: favData.imageHeight || 0,
          original_width: favData.originalWidth || 0,
          original_height: favData.originalHeight || 0,
          api_provider: favData.apiProvider,
          api_base_url: '',
          source_type: 'generated',
          created_at: Date.now(),
        });
        saveLocalFavorites(local);
      }
      toast.success('已添加到收藏夹（本地）');
    }
  }, [currentUser, getLocalFavorites, saveLocalFavorites]);

  // Workflow state for node mode
  const [nodeWorkflow, setNodeWorkflow] = useState<Workflow | null>(null);

  // Mode switching - early return for non-canvas modes
  if (appMode === 'node') {
    return (
      <NodeEditor
        workflow={nodeWorkflow}
        userId={currentUser?.id}
        onBack={() => setAppMode('canvas')}
        onWorkflowChange={setNodeWorkflow}
        onOpenWorkflowHub={() => setAppMode('workflow-hub')}
        canvasImages={images.map(img => ({ id: img.id, url: img.url, name: img.prompt?.slice(0, 30) || '图片', description: img.prompt || '', width: img.width, height: img.height }))}
        themeStyle={themeStyle}
        onAddImages={(urls, meta) => handleAddImages(urls, undefined, meta)}
      />
    );
  }
  if (appMode === 'workflow-hub') {
    return <WorkflowHub userId={currentUser?.id} onBack={() => setAppMode('canvas')} onEditWorkflow={(wf) => { setNodeWorkflow(wf); setAppMode('node'); }} themeStyle={themeStyle} />;
  }

  if (appMode === 'dashboard') {
    return (
      <>
      <DashboardView
        key={currentUser?.id || 'no-user'}
        isMonochrome={themeStyle === 'monochrome'}
        user={currentUser!}
        onOpenProject={(project) => {
          setAppMode('canvas');
          loadProjectById(project.id);
        }}
        onSetFavoriteParams={(params) => {
          setFavoriteParams(params);
        }}
        onNewProject={async () => {
          try {
            const mgr = UserManagerCore.getInstance();
            const newProject = await mgr.createProject('未命名项目');
            loadProjectById(newProject.id);
            setAppMode('canvas');
          } catch (e) {
            console.error('创建项目失败:', e);
          }
        }}
        onLogout={async () => {
          // 退出前同步保存当前项目数据
          try {
            if (currentProject && images.length > 0) {
              const mgr = UserManagerCore.getInstance();
              const urlMapping: Record<string, string> = {};
              const nonPersistent = images.filter(img => img.url.startsWith('data:') || img.url.startsWith('blob:'));
              if (nonPersistent.length > 0) {
                const results = await Promise.allSettled(nonPersistent.map(async (img) => {
                  let urlToSave = img.url;
                  if (urlToSave.startsWith('blob:')) {
                    try {
                      const resp = await fetch(urlToSave);
                      const blob = await resp.blob();
                      urlToSave = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(blob);
                      });
                    } catch { return null; }
                  }
                  const saveResp = await fetch('/api/save-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageUrl: urlToSave, userId: currentUser?.id, sourceUrl: img.url }),
                  });
                  const saveData = await saveResp.json();
                  if (saveData.success && saveData.url) return { original: img.url, persisted: saveData.url };
                  return null;
                }));
                for (const r of results) {
                  if (r.status === 'fulfilled' && r.value) urlMapping[r.value.original] = r.value.persisted;
                }
              }
              const persistableCanvasImages = images
                .map(img => ({
                  id: img.id,
                  url: urlMapping[img.url] || img.url,
                  x: img.x, y: img.y, width: img.width, height: img.height,
                  originalWidth: img.originalWidth || img.width * 2,
                  originalHeight: img.originalHeight || img.height * 2,
                  rotation: 0, zIndex: 0, createdAt: img.createdAt || Date.now(),
                  prompt: img.prompt || '', modifyPrompt: img.modifyPrompt || '',
                  model: img.model || '', quality: img.quality || '',
                  aspectRatio: img.aspectRatio || '', stylePreset: img.stylePreset || '',
                  category: img.category || '', size: img.size || '',
                  groupId: img.groupId || '', threeDModelUrl: img.threeDModelUrl || '',
                  threeDModelUrls: img.threeDModelUrls || undefined,
                  modelName: img.modelName || '', apiProvider: img.apiProvider || '',
                  apiBaseUrl: img.apiBaseUrl || '',
                  sourceUrl: img.sourceUrl || '',
                  generatedFromImageId: img.generatedFromImageId || '',
                  svgDataUrl: img.svgDataUrl || '',
                  svgUrl: img.svgUrl || '',
                  mediaType: img.mediaType || '',
                  videoUrl: img.videoUrl || '',
                  videoDuration: img.videoDuration || undefined,
                  videoThumbnailUrl: img.videoThumbnailUrl || '',
                  isProcessingPlaceholder: img.isProcessingPlaceholder || false,
                  processing: img.processing,
                }))
                .filter(img => img.url || img.videoUrl || img.isProcessingPlaceholder) as PersistableCanvasImage[];
              mgr.updateProject(currentProject.id, {
                canvasImages: persistableCanvasImages,
                metadata: { ...(currentProject.metadata || {}), groups: groupsRef.current },
              });
            }
          } catch { /* save failed - non-blocking */ }
          const userMgr = UserManagerCore.getInstance();
          userMgr.logout();
          setCurrentUser(null);
          setCurrentProject(null);
          // ★ 清空 undo 历史，防止退出登录后残留历史
          incrementalHistoryRef.current.clear();
          prevImagesRef.current = [];
          setImages([]);
          latestImagesRef.current = []; // 立即清除 ref，防止残留图片数据
          setInitialGroups([]);
          setAppMode('canvas');
          toast.info('已退出登录', {
            description: '请重新登录以继续使用',
            className: themeStyle === 'monochrome'
              ? 'bg-white border border-gray-200 text-gray-900'
              : 'bg-[#141414] border border-[#2a2a2a] text-white',
          });
        }}
      />
    </>
    );
  }

  return (
    <div className={`h-screen w-screen relative overflow-hidden ${themeStyle === 'monochrome' ? 'bg-gradient-to-br from-blue-50 via-white to-purple-50/30' : 'bg-[#0a0a0a]'}`}>
      {/* System Announcement - Banner mode (top bar) */}
      {announcement && showAnnouncement && announcement.displayMode !== 'popup' && announcement.displayMode !== 'sidebar' && (
        <div className={`fixed top-0 left-0 right-0 z-[400] flex items-center justify-center gap-2 px-4 py-2 text-sm ${
          announcement.type === 'warning'
            ? 'bg-amber-500 text-amber-950'
            : announcement.type === 'danger'
              ? 'bg-red-500 text-white'
              : themeStyle === 'monochrome'
                ? 'bg-blue-600 text-white'
                : 'bg-[#d4af37] text-[#0a0a0a]'
        }`}>
          <Bell className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-center">{announcement.text}</span>
          <button onClick={dismissAnnouncement} className="p-1 hover:opacity-70 transition-opacity flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* System Announcement - Popup mode (center modal) */}
      {announcement && showAnnouncement && announcement.displayMode === 'popup' && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`max-w-md w-[90vw] mx-4 rounded-xl shadow-2xl ${
            themeStyle === 'monochrome' ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-[#333]'
          }`}>
            <div className={`flex items-center gap-3 px-5 py-4 border-b ${
              themeStyle === 'monochrome' ? 'border-gray-100' : 'border-[#2a2a2a]'
            }`}>
              <div className={`p-2 rounded-lg ${
                announcement.type === 'warning'
                  ? 'bg-amber-100 text-amber-600'
                  : announcement.type === 'danger'
                    ? 'bg-red-100 text-red-600'
                    : themeStyle === 'monochrome'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-[#d4af37]/20 text-[#d4af37]'
              }`}>
                <Bell className="w-5 h-5" />
              </div>
              <h3 className={`font-semibold text-lg ${
                themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
              }`}>系统公告</h3>
              <button onClick={dismissAnnouncement} className={`ml-auto p-1.5 rounded-lg transition-colors ${
                themeStyle === 'monochrome' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-[#2a2a2a] text-gray-500'
              }`}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-6">
              <p className={`text-base leading-relaxed whitespace-pre-wrap ${
                themeStyle === 'monochrome' ? 'text-gray-700' : 'text-gray-300'
              }`}>{announcement.text}</p>
            </div>
            <div className={`flex justify-end gap-3 px-5 py-4 border-t ${
              themeStyle === 'monochrome' ? 'border-gray-100' : 'border-[#2a2a2a]'
            }`}>
              <button onClick={dismissAnnouncement} className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                themeStyle === 'monochrome'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-[#d4af37] text-[#0a0a0a] hover:bg-[#c4a030]'
              }`}>我知道了</button>
            </div>
          </div>
        </div>
      )}
      {/* System Announcement - Sidebar/Toast mode (right side notification) */}
      {announcement && showAnnouncement && announcement.displayMode === 'sidebar' && (
        <div className={`fixed top-20 right-4 z-[450] max-w-sm w-80 rounded-xl shadow-2xl animate-in slide-in-from-right duration-300 ${
          themeStyle === 'monochrome' ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-[#333]'
        }`}>
          <div className={`flex items-start gap-3 p-4`}>
            <div className={`p-2 rounded-lg flex-shrink-0 ${
              announcement.type === 'warning'
                ? 'bg-amber-100 text-amber-600'
                : announcement.type === 'danger'
                  ? 'bg-red-100 text-red-600'
                  : themeStyle === 'monochrome'
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-[#d4af37]/20 text-[#d4af37]'
            }`}>
              <Bell className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`font-semibold text-sm mb-1 ${
                themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
              }`}>系统通知</div>
              <p className={`text-sm leading-relaxed whitespace-pre-wrap ${
                themeStyle === 'monochrome' ? 'text-gray-600' : 'text-gray-400'
              }`}>{announcement.text}</p>
            </div>
            <button onClick={dismissAnnouncement} className={`p-1 rounded flex-shrink-0 transition-colors ${
              themeStyle === 'monochrome' ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-[#2a2a2a] text-gray-500'
            }`}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {/* ★ 模式切换确认对话框：有进行中生图任务时弹出 */}
      {pendingModeSwitch && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={`max-w-md rounded-xl p-6 shadow-2xl ${themeStyle === 'monochrome' ? 'bg-white border border-blue-200' : 'bg-[#1a1a1a] border border-[#d4af37]/30'}`}>
            <h3 className={`text-lg font-semibold mb-3 ${themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'}`}>
              切换模式确认
            </h3>
            <p className={`text-sm mb-2 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-gray-300'}`}>
              当前画布有正在进行的生图任务，切换模式后进度显示将暂时隐藏。
            </p>
            <p className={`text-xs mb-5 ${themeStyle === 'monochrome' ? 'text-gray-500' : 'text-gray-400'}`}>
              任务将在后台继续执行，切换回画布模式后可查看生成结果。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelModeSwitch}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  themeStyle === 'monochrome'
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-[#2a2a2a] text-gray-300 hover:bg-[#3a3a3a]'
                }`}
              >
                继续等待
              </button>
              <button
                onClick={confirmModeSwitch}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                确认切换
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Canvas - 全屏 */}
      <div className="absolute inset-0">
        <InfiniteCanvas
          images={images}
          onImagesChange={setImages}
          onUndo={handleUndo}
          onRedo={handleRedo}

          selectedImage={selectedImage}
          onSelectImage={setSelectedImage}
          onPreviewImage={handlePreview}
          onGenerateVariation={handleCanvasGenerateVariation}
          onExtractKeywords={handleCanvasExtractKeywords}
          onFusion={handleCanvasFusion}
          onAddImages={handleAddImages}
          onReferenceSelect={handleCanvasReferenceSelect}
          referenceIds={ctrlRefSelections.map(r => r.id)}
          altRefMarkerIds={altRefMarkers.map(r => r.id)}
          onAltMarkReference={handleAltMarkReference}
          themeStyle={themeStyle}
          onVisionPrompt={handleVisionPrompt}
          visionPromptEnabled={visionPromptEnabled}
          onToggleVisionPrompt={() => {
            setVisionPromptEnabled(prev => !prev);
            setOhMyPromptOpen(prev => !prev);
          }}
          ohMyPromptOpen={ohMyPromptOpen}
          onCloseOhMyPrompt={() => { setOhMyPromptOpen(false); setVisionPromptEnabled(false); }}
          onToggleOhMyPrompt={() => setOhMyPromptOpen(prev => !prev)}
          onInsertPrompt={(prompt: string) => setExternalPrompt(prompt)}
          ohMyPromptThemeStyle={themeStyle === 'monochrome' ? 'default' : 'gold'}
          isVisionAnalyzing={isVisionAnalyzing}
          visionResult={visionResult}
          onToggleSettings={() => setPanelCollapsed(prev => !prev)}
          onToggleTheme={() => setThemeStyle(prev => prev === 'gold' ? 'monochrome' : 'gold')}
          onToggleUserManager={() => setAppMode('dashboard')}
          onToggleAdminSystem={() => setAppMode('dashboard')}
          isAdmin={currentUser?.role === 'admin'}
          onToggleProjectData={() => setShowProjectData(prev => !prev)}
          onToggleHelp={() => setShowHelpGuide(true)}
          onAddToFavorites={handleAddToFavorites}
          onToggleFavorites={() => setShowFavorites(true)}
          onTogglePromptTemplate={() => setShowPromptTemplate(true)}
          brandProject={currentProject ? {
            id: currentProject.id,
            brandName: currentProject.name || '',
            description: currentProject.description || '',
            targetAudience: '',
            tone: '',
            brandDna: null,
          } : null}
          onSwitchToNodeMode={() => safeSwitchMode('node')}
          onSwitchToWorkflowHub={() => safeSwitchMode('workflow-hub')}
          onSwitchToDashboard={() => safeSwitchMode('dashboard')}
          initialViewState={viewStateRef.current || undefined}
          isPanelCollapsed={panelCollapsed}
          navigateToImageId={navigateToImageId}
          onNavigateToImageComplete={() => setNavigateToImageId(null)}
          onGroupsChange={(groups) => {
            groupsRef.current = groups;
            // 额外持久化分组到 localStorage，防止竞态条件下数据丢失
            try {
              if (currentProject?.id) {
                localStorage.setItem(`wujie-groups-${currentProject.id}`, JSON.stringify(groups));
              }
            } catch {}
          }}
          initialGroups={initialGroups}
          onViewStateChange={(vs) => {
            viewStateRef.current = vs;
            setViewState(vs);
          }}
          onForceSave={() => {
            try {
              if (currentProject?.id && images.length > 0) {
                const mgr = UserManagerCore.getInstance();
                const persistable = images.map(img => ({
                  id: img.id,
                  url: img.url,
                  x: img.x, y: img.y,
                  width: img.width, height: img.height,
                  originalWidth: img.originalWidth || img.width,
                  originalHeight: img.originalHeight || img.height,
                  rotation: 0, zIndex: 0,
                  createdAt: img.createdAt || Date.now(),
                  prompt: img.prompt || '',
                  ...(img.groupId ? { groupId: img.groupId } : {}),
                }));
                mgr.updateProject(currentProject.id, { canvasImages: persistable });
              }
            } catch {}
          }}
          onEditImage={handleEditImage}
          onSendToChat={(image) => {
            setChatInitialImage(image);
            setChatTabOpen(true);
          }}
          connections={canvasConnections}
          onConnectionsChange={setCanvasConnections}
          versionHistoryManager={treeHistoryRef.current}
          onOpenVideoPanel={handleOpenVideoPanel}
        />
      </div>

      {/* Language-based Image Editor */}
      {showImageEditor && (
        <ImageEditor
          image={editingImage}
          canvasImages={images}
          onClose={handleEditCancel}
          themeStyle={themeStyle}
          onConfirm={(result) => {
            // Always add a new image to canvas (preserve the original)
            const ar = result.aspectRatio || '1:1';
            const [arW, arH] = ar.split(':').map(Number);
            const baseSize = 400;
            let imgW: number, imgH: number;
            if (arW >= arH) {
              imgW = baseSize;
              imgH = Math.round(baseSize * arH / arW);
            } else {
              imgH = baseSize;
              imgW = Math.round(baseSize * arW / arH);
            }
            // Position new image to the right of the original if editing existing
            let newX = 100 + Math.random() * 200;
            let newY = 100 + Math.random() * 200;
            if (editingImage) {
              newX = editingImage.x + editingImage.width + 20;
              newY = editingImage.y;
            }
            const newImg: CanvasImage = {
              id: `lang-edit-${Date.now()}`,
              url: result.url,
              prompt: result.prompt,
              x: newX,
              y: newY,
              width: imgW,
              height: imgH,
            };
            setImages(prev => [...prev, newImg]);
            setShowImageEditor(false);
            setEditingImage(null);
          }}
        />
      )}

      {/* Right Panel - with vertical collapse strip */}
      <div className={`fixed top-0 right-0 bottom-0 z-[70] flex transition-all duration-300 ease-in-out ${panelCollapsed ? '' : ''}`} style={{ width: panelCollapsed ? '20px' : 'min(480px, 100vw)' }}>
        {/* Vertical collapse strip */}
        <button
          onClick={() => setPanelCollapsed(prev => !prev)}
          className={`w-5 flex items-center justify-center cursor-pointer transition-all duration-200 shrink-0 ${themeStyle === 'monochrome' ? 'bg-gray-100 hover:bg-gray-200 border-r border-gray-200' : 'bg-[#0F1117] hover:bg-[#1a1d26] border-r border-white/[0.06]'}`}
          style={{ borderRadius: '4px 0 0 4px' }}
          title={panelCollapsed ? '展开面板' : '收起面板'}
          aria-label={panelCollapsed ? '展开面板' : '收起面板'}
        >
          {panelCollapsed ? (
            <ChevronLeft size={14} className={themeStyle === 'monochrome' ? 'text-gray-500' : 'text-gold-muted'} />
          ) : (
            <ChevronRight size={14} className={themeStyle === 'monochrome' ? 'text-gray-500' : 'text-gold-muted'} />
          )}
        </button>

        {/* Panel Content */}
        {!panelCollapsed && (
        <div className={`flex-1 flex flex-col ${themeStyle === 'monochrome' ? 'bg-white border-l border-gray-200' : 'bg-[#141418] border-l border-white/[0.06]'} overflow-hidden`}>
          {/* 软件标题 */}
          <div className="px-4 py-2.5 flex-shrink-0 flex items-center">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className={`text-lg font-bold leading-tight tracking-tight ${themeStyle === 'monochrome' ? 'text-gray-900' : 'text-foreground'}`}>
                  {APP_NAME}
                </h1>
                <div className={`w-1.5 h-1.5 rounded-full ${themeStyle === 'monochrome' ? 'bg-blue-500' : 'bg-gold shadow-[0_0_6px_rgba(200,164,92,0.5)]'}`} />
              </div>
              <span className={`text-[10px] leading-tight font-mono ${themeStyle === 'monochrome' ? 'text-gray-400' : 'text-gold-muted'}`}>
                {APP_FULL_VERSION_LABEL}
              </span>
            </div>
          </div>
          <div className={`h-px ${themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-gradient-to-r from-transparent via-gold/15 to-transparent'}`} />

          {/* Panel Tabs - 紧凑化 */}
          <div className="flex flex-shrink-0">
            <button
              onClick={() => { setActivePanel('chat'); setChatTabOpen(true); }}
              className={`flex-1 py-2 px-3 flex items-center justify-center gap-1.5 transition-all text-sm relative ${
                activePanel === 'chat'
                  ? themeStyle === 'monochrome' ? 'text-blue-600 font-semibold' : 'text-gold font-semibold'
                  : themeStyle === 'monochrome' ? 'text-gray-500 hover:text-gray-800 hover:bg-gray-50' : 'text-gold-muted hover:text-text-bright hover:bg-white/5'
              }`}
            >
              <MessageSquare size={15} />
              <span className="text-sm">AI聊天</span>
              {activePanel === 'chat' && (
                <span className={`absolute bottom-0 left-2 right-2 h-[2px] rounded-full ${themeStyle === 'monochrome' ? 'bg-blue-500' : 'bg-gold shadow-[0_0_6px_rgba(200,164,92,0.5)]'}`} />
              )}
            </button>
            <button
              onClick={() => { setActivePanel('generate'); setChatTabOpen(false); }}
              className={`flex-1 py-2 px-3 flex items-center justify-center gap-1.5 transition-all text-sm relative ${
                activePanel === 'generate'
                  ? themeStyle === 'monochrome' ? 'text-blue-600 font-semibold' : 'text-gold font-semibold'
                  : themeStyle === 'monochrome' ? 'text-gray-500 hover:text-gray-800 hover:bg-gray-50' : 'text-gold-muted hover:text-text-bright hover:bg-white/5'
              }`}
            >
              <ImageIcon size={15} />
              <span className="text-sm">图像生成</span>
              {activePanel === 'generate' && (
                <span className={`absolute bottom-0 left-2 right-2 h-[2px] rounded-full ${themeStyle === 'monochrome' ? 'bg-blue-500' : 'bg-gold shadow-[0_0_6px_rgba(200,164,92,0.5)]'}`} />
              )}
            </button>
            {/* Video generation is now a floating panel accessible from bottom toolbar */}
          </div>
          <div className={`h-px ${themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-gradient-to-r from-transparent via-gold/15 to-transparent'}`} />

          {/* Panel Content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className={activePanel === 'generate' ? 'flex-1 overflow-y-auto scroll-smooth' : 'hidden'} style={{
              scrollbarWidth: 'thin',
              scrollbarColor: themeStyle === 'monochrome' ? '#d1d5db transparent' : '#444 transparent'
            }}>
              <GenerationPanel
                    onGenerate={handleGenerate}
                    onAnalyzeImage={handleAnalyzeImage}
                    onAddToCanvas={handleAddToCanvas}
                    onExtractPrompt={handleExtractPrompt}
                    externalPrompt={externalPrompt}
                    onExternalPromptConsumed={handleExternalPromptConsumed}
                    ctrlRefSelections={ctrlRefSelections}
                    onRemoveCtrlRef={handleRemoveCtrlRef}
                    onUpdateCtrlRefKeyword={handleUpdateCtrlRefKeyword}
                    onFusionGenerate={handleFusionGenerate}
                    altRefMarkers={altRefMarkers}
                    onRemoveAltRefMarker={handleRemoveAltRefMarker}
                    themeStyle={themeStyle}
                    externalReferenceImage={externalReferenceImage}
                    onExternalReferenceImageConsumed={() => setExternalReferenceImage(null)}
                    onOpenPromptEquation={() => setShowPromptEquation(true)}
                    applyFavoriteParams={favoriteParams}
                    onFavoriteParamsApplied={() => setFavoriteParams(null)}
                    selectedImageUrl={selectedImage?.url}
                    onError={(error: string) => {
                      toast.error('生成失败', {
                        description: error,
                        className: themeStyle === 'monochrome'
                          ? 'bg-white border border-gray-200 text-gray-900'
                          : 'bg-[#141414] border-[#2a2a2a] text-white',
                      });
                      setActiveGenerationCount(prev => Math.max(0, prev - 1));
                    }}
                  />
              </div>
              <div className={activePanel === 'chat' ? 'flex-1 overflow-hidden' : 'hidden'}>
                <ChatPanel themeStyle={themeStyle} projectId={currentProject?.id} onAddToPrompt={handleAddToPrompt} onAddImages={handleAddImages} canvasImages={images} selectedCanvasImage={selectedImage} onChatModelChange={setCurrentChatModelInfo} chatInitialImage={chatInitialImage} onChatInitialImageConsumed={() => setChatInitialImage(null)} chatTabOpen={chatTabOpen} onChatTabOpenChange={setChatTabOpen} onNavigateToImage={(id: string) => setNavigateToImageId(id)} onGenerateImage={handleChatGenerateImage} />
              </div>

            {/* 固定在底部的开始生成按钮 */}
            {activePanel === 'generate' && (
              <div className="px-4 py-3 flex-shrink-0">
                <div className={`h-px mb-3 ${themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-gradient-to-r from-transparent via-gold/15 to-transparent'}`} />
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent('trigger-generate'))}
                  className={`btn-press w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${themeStyle === 'monochrome' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-md hover:shadow-lg active:shadow-sm' : 'bg-gradient-to-r from-gold to-gold-dark text-black hover:from-gold-light hover:to-gold shadow-md hover:shadow-lg active:shadow-sm'}`}
                >
                  <Sparkles className="h-4 w-4" />
                  <span>开始生成</span>
                </button>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
      {/* End Right Panel */}


      {/* 提示词方程式 */}
      <PromptEquation
        open={showPromptEquation}
        onClose={() => setShowPromptEquation(false)}
        onSendToPrompt={(text) => {
          setExternalPrompt(text);
          setShowPromptEquation(false);
        }}
        chatModel={currentChatModelInfo?.model || ''}
        isMonochrome={themeStyle === 'monochrome'}
      />

      {/* Preview */}
      <ImagePreview
        image={previewImage}
        onClose={() => setPreviewImage(null)}
        themeStyle={themeStyle}
        onEditImage={(img) => { setPreviewImage(null); handleEditImage(img); }}
      />

      {/* Floating Video Generation Panel */}
      {showVideoPanel && (
        <VideoGenerationPanel
          ref={videoPanelRef}
          floating
          onVideoGenerate={async (params) => {
            await handleVideoGenerate(params);
            return {};
          }}
          onAddImages={(urls: string[]) => handleAddImages(urls)}
          onClose={() => setShowVideoPanel(false)}
          onError={(error: string) => {
            toast.error('视频生成失败', {
              description: error,
              className: themeStyle === 'monochrome'
                ? 'bg-white border border-gray-200 text-gray-900'
                : 'bg-[#141414] border-[#2a2a2a] text-white',
            });
          }}
          themeStyle={themeStyle}
          selectedImageUrl={selectedImage?.mediaType !== 'video' ? selectedImage?.url : undefined}
          selectedVideoUrl={selectedImage?.mediaType === 'video' ? selectedImage?.videoUrl : undefined}
        />
      )}

      {/* Toast */}
      <Toaster
        position="top-center"
        toastOptions={{
          className: themeStyle === 'monochrome'
            ? 'bg-white border border-gray-200 text-gray-900 shadow-lg shadow-gray-200/50'
            : 'bg-[#1a1a1a] border border-[#2a2a2a] text-white shadow-lg shadow-black/30',
          style: {
            borderRadius: '12px',
            fontSize: '13px',
          },
        }}
      />

      {/* Login Panel - shown when not authenticated */}
      {authChecked && !currentUser && (
        <LoginPanel
          onLogin={async (user, productType) => {
            void productType;
            // 智能对话用户：进入工作台，工作台已支持智能对话入口
            // 关键：先清除旧用户的所有状态，防止数据跨用户泄露
            setCurrentProject(null);
            // ★ 清空 undo 历史，防止旧用户的历史影响新用户
            incrementalHistoryRef.current.clear();
            prevImagesRef.current = [];
            skipHistoryRef.current = true;
            setImages([]);
            latestImagesRef.current = []; // 立即清除 ref，防止 onProjectsChanged 用旧图片覆盖新用户数据
            setCurrentUser(user);
            // 加载项目数据后跳转到工作台
            try {
              const userMgr = UserManagerCore.getInstance();
              await userMgr.loadProjectsFromServer();
            } catch { /* non-blocking */ }
            toast.success('登录成功', {
              description: `欢迎回来，${user.name}`,
              className: themeStyle === 'monochrome'
                ? 'bg-white border border-gray-200 text-gray-900'
                : 'bg-[#141414] border border-[#2a2a2a] text-white',
            });
            // 登录成功后进入工作台
            setAppMode('dashboard');
            // ★ 延迟恢复历史记录（登录清空图片不需要记录到 undo）
            setTimeout(() => { skipHistoryRef.current = false; }, 100);
          }}
        />
      )}

      {/* Help Guide Modal */}
      <HelpGuide
        isOpen={showHelpGuide}
        onClose={() => setShowHelpGuide(false)}
        themeStyle={themeStyle}
      />

      {/* Favorites Panel */}
      {showFavorites && currentUser && (
        <FavoritesPanel
          userId={currentUser.id || currentUser.name}
          onClose={() => setShowFavorites(false)}
          isMonochrome={themeStyle === 'monochrome'}
          onApplyParams={(item) => {
            // ★ 修复：尝试为收藏夹中的纯 modelId 构建 providerId::modelId 复合键
            let favModel = item.model || '';
            if (favModel && !favModel.includes('::')) {
              try {
                const wsmStr = localStorage.getItem('wujie_selected_model');
                if (wsmStr) {
                  const wsm = JSON.parse(wsmStr);
                  if (wsm.providerId && wsm.model === favModel) {
                    favModel = `${wsm.providerId}::${favModel}`;
                  }
                }
              } catch {}
            }
            setFavoriteParams({
              prompt: item.prompt || '',
              negativePrompt: item.negativePrompt || '',
              model: favModel,
              aspectRatio: item.aspectRatio || '',
              quality: item.quality || '',
            });
            setShowFavorites(false);
          }}
        />
      )}

      {/* Prompt Template Panel */}
      <PromptTemplatePanel
        isOpen={showPromptTemplate}
        onClose={() => setShowPromptTemplate(false)}
        isMonochrome={themeStyle === 'monochrome'}
        isAdmin={currentUser?.role === 'admin'}
        onUseTemplate={(content: string) => {
          setExternalPrompt(content);
          setShowPromptTemplate(false);
        }}
      />

      {/* Project Data Panel */}
      <ProjectDataPanel
        isOpen={showProjectData && !!currentUser}
        onClose={() => setShowProjectData(false)}
        projectName={currentProject?.name || ''}
        projectDescription={currentProject?.description || ''}
        images={images.map(img => ({
          id: img.id,
          url: img.url,
          x: img.x,
          y: img.y,
          width: img.width,
          height: img.height,
          prompt: img.prompt,
          model: img.model,
          quality: img.quality,
          aspectRatio: img.aspectRatio,
          stylePreset: img.stylePreset,
          category: img.category,
          size: img.size,
          createdAt: img.createdAt,
          negativePrompt: img.negativePrompt,
          modelName: img.modelName,
          apiProvider: img.apiProvider,
        }))}
        onDeleteImages={(ids) => {
          setImages(prev => prev.filter(img => !ids.includes(img.id)));
          setSelectedImage(null);
        }}
        onNavigateToImage={(imageId) => {
          setNavigateToImageId(imageId);
          setShowProjectData(false);
        }}
        onMakeSame={(img) => {
          // ★ 修复：构建包含 providerId 的复合键，避免多提供商同名模型选错
          // img.apiProvider 存的是提供商名称，需要反查 providerId
          let modelValue = img.model || '';
          if (img.model && img.apiProvider && !img.model.includes('::')) {
            // 尝试从画布模型列表反查 providerId
            const canvasModelsStr = localStorage.getItem('wujie_canvas_gen_models');
            if (canvasModelsStr) {
              try {
                const canvasModels: unknown = JSON.parse(canvasModelsStr);
                const match = Array.isArray(canvasModels)
                  ? canvasModels.find((entry): entry is { id: string; providerName?: string; providerId?: string } =>
                    typeof entry === 'object' && entry !== null &&
                    typeof (entry as { id?: unknown }).id === 'string' &&
                    (entry as { id: string; providerName?: string }).id === img.model &&
                    (entry as { providerName?: string }).providerName === img.apiProvider,
                  )
                  : undefined;
                if (match?.providerId) {
                  modelValue = `${match.providerId}::${img.model}`;
                }
              } catch {}
            }
            // 如果反查失败，尝试从 wujie_selected_model 读取
            if (!modelValue.includes('::')) {
              try {
                const wsmStr = localStorage.getItem('wujie_selected_model');
                if (wsmStr) {
                  const wsm = JSON.parse(wsmStr);
                  if (wsm.providerId && wsm.model === img.model) {
                    modelValue = `${wsm.providerId}::${img.model}`;
                  }
                }
              } catch {}
            }
          }
          setFavoriteParams({
            prompt: img.prompt || '',
            model: modelValue,
            aspectRatio: img.aspectRatio,
            quality: img.quality,
            negativePrompt: img.negativePrompt,
          });
          setShowProjectData(false);
        }}
        isMonochrome={themeStyle === 'monochrome'}
      />

      {/* Auth loading overlay */}
      {!authChecked && (
        <div className="fixed inset-0 flex items-center justify-center z-[90] bg-[#0a0a0a]">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
            <p className="text-white/60 text-sm">正在验证身份...</p>
          </div>
        </div>
      )}

    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-10 h-10 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <CanvasApp />
    </Suspense>
  );
}
