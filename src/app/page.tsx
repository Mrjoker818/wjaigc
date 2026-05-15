'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { InfiniteCanvas, CanvasImage, ImageGroup } from '@/components/infinite-canvas';
import { GenerationPanel, GenerationParams, CtrlRefSelection } from '@/components/generation-panel';
import { ImagePreview } from '@/components/image-preview';
import ImageEditor from '@/components/image-editor';
import { ChatPanel } from '@/components/chat-panel';
import { PromptEquation } from '@/components/prompt-equation';

import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Image as ImageIcon, MessageSquare, Sparkles } from 'lucide-react';
import { UserManager } from '@/components/user-manager';
import { ProjectDataPanel } from '@/components/project-data-panel';
import { AdminSystem } from '@/components/admin-system';
import { HelpGuide } from '@/components/help-guide';
import { User, Project } from '@/lib/user-types';
import { UserManager as UserManagerCore } from '@/lib/user-manager';
import { toStableImageUrl } from '@/lib/stable-image-url';
import { APP_FULL_VERSION_LABEL, APP_NAME } from '@/config/app-meta';

type ThemeStyle = 'gold' | 'monochrome';
type ActivePanel = 'generate' | 'chat';


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

  // ====== Undo (Ctrl+Z) History ======
  // All undo state is managed synchronously in refs to avoid React async-state races.
  // The "current" state is always historyStack[historyIndex].
  // After a normal edit: push new state, advance index.
  // After undo: just decrement index and apply.
  const historyStackRef = useRef<CanvasImage[][]>([]);
  const historyIndexRef = useRef<number>(-1);

  // Wrap setImages to record history before each change
  const setImages = useCallback((action: React.SetStateAction<CanvasImage[]>) => {
    setImagesRaw(prev => {
      // Snapshot current state before the change
      const currentSnapshot = prev.map(img => ({ ...img }));
      const stack = historyStackRef.current;
      const idx = historyIndexRef.current;

      // If we're not at the end of history, truncate future states
      if (idx < stack.length - 1) {
        historyStackRef.current = stack.slice(0, idx + 1);
      }

      // Push current state
      historyStackRef.current.push(currentSnapshot);
      historyIndexRef.current = historyStackRef.current.length - 1;

      // Apply the change
      const next = typeof action === 'function' ? action(prev) : action;
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx < 0) return; // Nothing to undo

    const previousState = historyStackRef.current[idx];
    historyIndexRef.current = idx - 1;

    // Directly set state — no re-recording into history
    setImagesRaw(previousState);
  }, []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImage, setPreviewImage] = useState<CanvasImage | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | undefined>(undefined);
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>('gold');
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>('generate');
  const [showUserManager, setShowUserManager] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAdminSystem, setShowAdminSystem] = useState(false);
  const [showProjectData, setShowProjectData] = useState(false);
  const [navigateToImageId, setNavigateToImageId] = useState<string | null>(null);
  const [showHelpGuide, setShowHelpGuide] = useState(false);
  const [initialGroups, setInitialGroups] = useState<ImageGroup[]>([]);
  const [ctrlRefSelections, setCtrlRefSelections] = useState<CtrlRefSelection[]>([]);
  // Alt+Click inline reference markers (displayed as numbered tags in the prompt textarea)
  const [altRefMarkers, setAltRefMarkers] = useState<Array<{id: string; url: string; number: number}>>([]);
  const [showPromptEquation, setShowPromptEquation] = useState(false);

  // Language-based image editing state
  const [langEditMode, setLangEditMode] = useState<'idle' | 'selecting'>('idle');
  const [editingImage, setEditingImage] = useState<CanvasImage | null>(null);
  const [editSourceRect, setEditSourceRect] = useState<{ left: number; top: number; right: number; bottom: number; width: number; height: number } | null>(null);

  // Current chat model info from ChatPanel (used for vision-prompt)
  const [currentChatModelInfo, setCurrentChatModelInfo] = useState<{
    model: string; providerId: string; providerPreset?: string;
  } | null>(null);

  // Oh My Prompt - Vision Prompt state
  const [visionPromptEnabled, setVisionPromptEnabled] = useState(false);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);

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
          // Auto-load most recent project or create default
          try {
            const projects = userMgr.getProjects();
            if (projects.length > 0) {
              setCurrentProject(projects[0]);
              // 加载项目画布数据，确保刷新后图片不丢失
              if (projects[0].canvasImages && projects[0].canvasImages.length > 0) {
                setImages((projects[0].canvasImages as unknown as Record<string, unknown>[]).map(img => ({
                  id: img.id as string,
                  url: img.url as string,
                  prompt: (img.prompt as string) || '',
                  modifyPrompt: (img.modifyPrompt as string) || '',
                  model: (img.model as string) || '',
                  quality: (img.quality as string) || '',
                  aspectRatio: (img.aspectRatio as string) || '',
                  stylePreset: (img.stylePreset as string) || '',
                  category: (img.category as string) || '',
                  size: (img.size as string) || '',
                  groupId: (img.groupId as string) || '',
                  threeDModelUrl: (img.threeDModelUrl as string) || '',
                  threeDModelUrls: (img.threeDModelUrls as Record<string, string>) || undefined,
                  x: img.x as number,
                  y: img.y as number,
                  width: (img.width as number) || 256,
                  height: (img.height as number) || 256,
                  originalWidth: (img.originalWidth as number) || 512,
                  originalHeight: (img.originalHeight as number) || 512,
                  createdAt: (img.createdAt as number) || Date.now(),
                })));
                // 恢复分组数据（优先 metadata，其次 localStorage 兜底）
                const metaGroups = projects[0].metadata?.groups;
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
                  // localStorage 兜底：防止 metadata 未保存时分组丢失
                  try {
                    const lsGroups = localStorage.getItem(`wujie-groups-${projects[0].id}`);
                    if (lsGroups) {
                      restoredGroups = JSON.parse(lsGroups);
                    }
                  } catch {}
                }
                setInitialGroups(restoredGroups);
              }
            } else {
              const defaultProject = userMgr.createProject('默认项目', '我的第一个创作项目');
              setCurrentProject(defaultProject);
            }
          } catch { /* non-blocking */ }
          setShowUserManager(false);
          setAuthChecked(true);
          return;
        }
      } catch {}

      try {
        const userMgr = UserManagerCore.getInstance();
        userMgr.logout();
        if (cancelled) return;
        setCurrentUser(null);
        setShowUserManager(true);
      } catch {}
      if (!cancelled) setAuthChecked(true);
    };
    void initCurrentUser();
    return () => {
      cancelled = true;
    };
  }, []);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [ohMyPromptOpen, setOhMyPromptOpen] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  // 用于跟踪当前生成任务的ID，确保旧任务的进度不会显示
  const generationTaskRef = useRef<number>(0);
  // 生成计时器
  const [generationElapsed, setGenerationElapsed] = useState<number>(0);
  const generationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const groupsRef = useRef<Array<{id: string; name: string; note: string; imageIds: string[]; x: number; y: number; collapsed: boolean}>>([]);

  const stabilizeCanvasImages = useCallback((items: Array<{ id: string; url: string }>) => {
    items.forEach(({ id, url }) => {
      if (!url || url.startsWith('data:')) return;
      void toStableImageUrl(url).then(stableUrl => {
        if (!stableUrl || stableUrl === url) return;
        setImages(prev => prev.map(img => img.id === id ? { ...img, url: stableUrl } : img));
      });
    });
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
  // 项目切换中标记：防止自动保存回调用旧闭包数据覆盖刚保存的新数据
  const switchingProjectRef = useRef(false);
  useEffect(() => {
    if (!currentProject || images.length === 0) return;
    // 项目切换进行中时，跳过自动保存，避免旧闭包数据覆盖
    if (switchingProjectRef.current) return;
    // 防抖：1秒后保存
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      // 二次检查：定时器触发时如果正在切换项目，也跳过
      if (switchingProjectRef.current) return;
      try {
        const mgr = UserManagerCore.getInstance();
        // 先将 data:/blob: URL 持久化到服务器
        const urlMapping: Record<string, string> = {};
        const sourceUrlMapping: Record<string, string> = {};
        const nonPersistentUrls = images.filter(img =>
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
                body: JSON.stringify({ imageUrl: urlToSave, userId: currentUser?.id, sourceUrl: img.url }),
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
        const resolvedImages = images.map(img => ({
          ...img,
          url: urlMapping[img.url] || img.url,
        }));
        const persistableCanvasImages = resolvedImages
          .map(img => ({
            id: img.id,
            url: img.url.startsWith('data:') || img.url.startsWith('blob:') ? '' : img.url,
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
          }))
          .filter(img => img.url);

        const updatedMeta = {
          ...(currentProject.metadata || {}),
          groups: groupsRef.current,
        };
        mgr.updateProject(currentProject.id, {
          canvasImages: persistableCanvasImages,
          metadata: updatedMeta,
        });
        // 同步更新 React 状态，确保后续自动保存使用最新 metadata
        setCurrentProject(prev => prev ? { ...prev, canvasImages: persistableCanvasImages, metadata: updatedMeta, updatedAt: Date.now() } : prev);
        recordUserData({
          userId: currentUser?.id,
          area: 'projects',
          type: 'autosave',
          filename: `${currentProject.id}.json`,
          content: JSON.stringify({
            projectId: currentProject.id,
            canvasImages: persistableCanvasImages,
            metadata: {
              ...(currentProject.metadata || {}),
              groups: groupsRef.current,
            },
            savedAt: Date.now(),
          }, null, 2),
          metadata: { projectId: currentProject.id, imageCount: persistableCanvasImages.length },
        });
      } catch (e) {
        // 静默失败，不影响用户体验
      }
    }, 1000);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [images, currentProject, currentUser?.id]);

  // 页面关闭/刷新前同步保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!currentProject || images.length === 0) return;
      try {
        const mgr = UserManagerCore.getInstance();
        const persistableCanvasImages = images
          .map(img => ({
            id: img.id,
            url: img.url.startsWith('data:') || img.url.startsWith('blob:') ? '' : img.url,
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
          }))
          .filter(img => img.url);
        mgr.updateProject(currentProject.id, {
          canvasImages: persistableCanvasImages,
          metadata: {
            ...(currentProject.metadata || {}),
            groups: groupsRef.current,
          },
        });
      } catch { /* best effort */ }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [images, currentProject]);

  const handleGenerate = useCallback(async (params: GenerationParams) => {
    // 为新任务生成唯一ID
    const taskId = ++generationTaskRef.current;
    setIsGenerating(true);
    setGenerationElapsed(0);
    if (generationTimerRef.current) clearInterval(generationTimerRef.current);
    generationTimerRef.current = setInterval(() => {
      setGenerationElapsed(prev => prev + 1);
    }, 1000);
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
      setGenerationProgress({ current: 0, total: outputCount });
      
      // 检查是否使用第三方模型
      const isThirdParty = !!(params as GenerationParams & { universalBaseUrl?: string }).universalBaseUrl;
      const apiEndpoint = isThirdParty ? '/api/universal-generate' : '/api/generate';
      
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, userId: currentUser?.id }),
      });

      if (taskId !== generationTaskRef.current) return;
      
      const data = await response.json();

      // === 直接返回模式：API 直接返回图片URL ===
      if (data.success && data.mode === 'direct') {
        const { imageUrls, model, prompt: enhancedPrompt, originalPrompt, category, style } = data;
        setGenerationProgress({ current: outputCount, total: outputCount });
        
        for (let i = 0; i < imageUrls.length; i++) {
          const imageUrl = imageUrls[i];
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

          let imgW = 1024, imgH = 1024;
          if (params.size?.includes('x') || params.size?.includes('×')) {
            const [sw, sh] = params.size.replace(/×/g, 'x').split('x');
            imgW = parseInt(sw) || 1024;
            imgH = parseInt(sh) || 1024;
          }
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
                width: imgW * 0.5, height: imgH * 0.5,
                originalWidth: imgW, originalHeight: imgH,
                isProcessingPlaceholder: false,
                processing: undefined,
                createdAt: Date.now(),
              } : img
            ));
          }
        }
        // 移除多余的占位框（outputCount > imageUrls.length 时）
        const usedPlaceholderIds = new Set(placeholderIds.slice(0, imageUrls.length));
        setImages(prev => prev.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id) || usedPlaceholderIds.has(img.id)));
        setGenerationProgress({ current: outputCount, total: outputCount });
        
        toast.success('生成完成', {
          description: `${data.modelName || model} 已生成 ${imageUrls.length} 张图片`,
          className: 'bg-[#141414] border border-[#d4af37]/30 text-white',
          duration: 3000,
        });
        return;
      }

      // === 新模式：前端轮询 ===
      if (data.success && data.mode === 'polling') {
        const { taskIds, estimatedTime, prompt: enhancedPrompt, originalPrompt, category, style } = data;
        
        setGenerationProgress({ current: Math.ceil(outputCount * 0.1), total: outputCount });

        // 自适应轮询间隔策略
        // 根据模型预估时间调整：快速模型1.5s起步，慢速模型2.5s起步
        const getPollInterval = (pollCount: number, estTime: number) => {
          const baseInterval = estTime <= 20 ? 1500 : estTime <= 60 ? 2000 : 2500;
          // 后期延长间隔避免浪费请求
          if (pollCount > 20) return baseInterval + 1500;
          if (pollCount > 10) return baseInterval + 500;
          return baseInterval;
        };

        // 最大轮询时间：预估时间 * 3 + 30秒（兜底），最少60秒，最多600秒（兼容token link等慢速API）
        const maxPollTime = Math.min(600, Math.max(60, estimatedTime * 3 + 30)) * 1000;
        const pollStartTime = Date.now();

        const completedImages: Array<{ id: string; url: string; prompt: string; model?: string; quality?: string; aspectRatio?: string; stylePreset?: string; category?: string; size?: string; sourceUrl?: string }> = [];        let consecutiveErrors = 0;

        for (let taskIdx = 0; taskIdx < taskIds.length; taskIdx++) {
          const currentTaskId = taskIds[taskIdx];
          let pollCount = 0;
          let taskCompleted = false;

          while (!taskCompleted) {
            // 检查是否超时
            if (Date.now() - pollStartTime > maxPollTime) {
              toast.error('生成超时', {
                description: `${data.modelName} 生成时间过长，请尝试降低分辨率或简化提示词后重试`,
                className: 'bg-[#141414] border border-red-900 text-white',
                duration: 8000,
              });
              break;
            }

            // 检查是否被新任务取代
            if (taskId !== generationTaskRef.current) return;

            const interval = getPollInterval(pollCount, estimatedTime);
            await new Promise(resolve => setTimeout(resolve, interval));
            pollCount++;

            try {
              const pollResponse = await fetch('/api/poll-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: currentTaskId, model: params.model, providerId: params.providerId, userId: currentUser?.id }),
              });

              const pollData = await pollResponse.json();

              if (!pollData.success && !pollData.retryable) {
                // 不可重试的错误
                toast.error('生成失败', {
                  description: pollData.error || '任务执行失败',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
                break;
              }

              // 可重试的错误（如模型返回文本而非图像），超过一定次数后放弃
              if (!pollData.success && pollData.retryable && pollCount > 15) {
                toast.error('生成失败', {
                  description: pollData.error || '多次重试后仍未生成图像',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
                break;
              }

              if (pollData.status === 'completed' && pollData.imageUrl) {
                const imageUrl = pollData.imageUrl as string;
                completedImages.push({
                  id: `${Date.now()}-${taskIdx}`,
                  url: imageUrl,
                  prompt: enhancedPrompt || params.prompt,
                  model: params.model,
                  quality: params.quality,
                  aspectRatio: params.aspectRatio,
                  stylePreset: params.stylePreset,
                  category: params.imageCategory || params.productCategory,
                  size: params.size,
                  sourceUrl: imageUrl,
                });
                taskCompleted = true;
                consecutiveErrors = 0;

                // 更新进度
                const progressVal = Math.ceil((taskIdx + 1) / taskIds.length * outputCount * 0.9);
                setGenerationProgress({ 
                  current: progressVal, 
                  total: outputCount 
                });
                // 更新对应占位框的进度
                const phId = placeholderIds[taskIdx];
                if (phId) {
                  setImages(prev => prev.map((img): CanvasImage =>
                    img.id === phId && img.isProcessingPlaceholder ? {
                      ...img,
                      processing: { ...img.processing, progress: Math.min(progressVal / outputCount * 100, 95), status: 'generating', label: img.processing?.label || '生成中...' },
                    } : img
                  ));
                }

              } else if (pollData.status === 'failed') {
                // 移除对应的占位框
                const failedPhId = placeholderIds[taskIdx];
                if (failedPhId) {
                  setImages(prev => prev.filter(img => img.id !== failedPhId));
                }
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
          // 持久化 data: URL（base64 图片保存到服务器，避免刷新丢失）
          for (let i = 0; i < completedImages.length; i++) {
            if (completedImages[i].url.startsWith('data:')) {
              try {
                const saveResp = await fetch('/api/save-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: completedImages[i].url, userId: currentUser?.id, sourceUrl: completedImages[i].sourceUrl }),
                });
                const saveData = await saveResp.json();
                if (saveData.success && saveData.url) {
                  completedImages[i].url = saveData.url;
                  completedImages[i].sourceUrl = completedImages[i].sourceUrl || saveData.sourceUrl;
                }
              } catch { /* save failed, keep data URL */ }
            }
          }

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

          const displayScale = 0.5;
          const completedCanvasImages: CanvasImage[] = completedImages.map((img, idx) => {
            const displaySize = getDisplaySize(params.size);
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
              width: displaySize.w * displayScale,
              height: displaySize.h * displayScale,
              originalWidth: displaySize.w,
              originalHeight: displaySize.h,
              createdAt: Date.now(),
            };
          });

          // 替换占位框为实际图片
          setImages(prev => {
            let updated = [...prev];
            for (let i = 0; i < completedCanvasImages.length; i++) {
              const phId = placeholderIds[i];
              if (phId) {
                const phIdx = updated.findIndex(img => img.id === phId);
                if (phIdx >= 0) {
                  // 保留占位框的位置，替换内容
                  updated[phIdx] = {
                    ...completedCanvasImages[i],
                    x: updated[phIdx].x,
                    y: updated[phIdx].y,
                  };
                } else {
                  updated.push(completedCanvasImages[i]);
                }
              } else {
                updated.push(completedCanvasImages[i]);
              }
            }
            // 移除多余的占位框
            const usedPlaceholderIds = new Set(placeholderIds.slice(0, completedCanvasImages.length));
            updated = updated.filter(img => !img.isProcessingPlaceholder || !placeholderIds.includes(img.id) || usedPlaceholderIds.has(img.id));
            stabilizeCanvasImages(updated.map(img => ({ id: img.id, url: img.url })));
            return updated;
          });
          setGenerationProgress({ current: outputCount, total: outputCount });

          toast.success(`生成成功`, {
            description: `已生成 ${completedImages.length} 张图片`,
            className: 'bg-[#141414] border-[#2a2a2a] text-white',
          });
          try { UserManagerCore.getInstance().recordUsage('image'); } catch { /* non-blocking */ }
        }

      // === 旧模式兼容：直接返回结果 - 自动排列布局 ===
      } else if (data.success && data.images) {
        // 持久化 data: URL
        for (const img of data.images as Array<{ url: string; sourceUrl?: string }>) {
          if (img.url.startsWith('data:')) {
            try {
              const saveResp = await fetch('/api/save-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: img.url, userId: currentUser?.id, sourceUrl: img.sourceUrl }),
              });
              const saveData = await saveResp.json();
              if (saveData.success && saveData.url) {
                img.url = saveData.url;
                img.sourceUrl = img.sourceUrl || saveData.sourceUrl;
              }
            } catch { /* save failed, keep data URL */ }
          }
        }

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

        const displayScale = 0.5;
        const legacyImages: CanvasImage[] = data.images.map((img: { id: string; url: string; prompt: string }, idx: number) => {
          const displaySize = getDisplaySize(params.size);
          return {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            url: img.url,
            prompt: img.prompt,
            model: params.model,
            quality: params.quality,
            aspectRatio: params.aspectRatio,
            stylePreset: params.stylePreset,
            category: params.imageCategory || params.productCategory,
            size: params.size,
            x: 0,
            y: 0,
            width: displaySize.w * displayScale,
            height: displaySize.h * displayScale,
            originalWidth: displaySize.w,
            originalHeight: displaySize.h,
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
        setGenerationProgress({ current: outputCount, total: outputCount });

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
      toast.error('生成失败', {
        description: '网络错误，请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    } finally {
      if (taskId === generationTaskRef.current) {
        setIsGenerating(false);
        setGenerationProgress(undefined);
        if (generationTimerRef.current) { clearInterval(generationTimerRef.current); generationTimerRef.current = null; }
      }
    }
  }, []);

  // 添加参考图到画布
  const handleAddToCanvas = useCallback(async (imageUrl: string) => {
    // 检查图片是否已存在于画布中
    if (images.some(img => img.url === imageUrl)) {
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
      userId: currentUser?.id,
      area: 'images',
      type: 'canvas-add',
      filename: `${newImage.id}.json`,
      content: JSON.stringify(newImage, null, 2),
      metadata: { source: 'canvas', imageUrl },
    });
    stabilizeCanvasImages([{ id: newImage.id, url: imageUrl }]);
    toast.success('已添加到画布', {
      description: '参考图已成功添加到画布',
      className: 'bg-[#141414] border-[#2a2a2a] text-white',
    });
  }, [images, stabilizeCanvasImages, currentUser?.id]);

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
  const handleAddImages = useCallback(async (imageUrls: string[]) => {
    const newImages: CanvasImage[] = [];
    
    for (let rawUrl of imageUrls) {
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
      
      // 将 data: URL 持久化到服务器（避免 base64 数据丢失）
      if (rawUrl.startsWith('data:')) {
        try {
          const saveResp = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: rawUrl, userId: currentUser?.id }),
          });
          const saveData = await saveResp.json();
          if (saveData.success && saveData.url) {
            rawUrl = saveData.url;
          }
        } catch { /* save failed, keep data URL */ }
      }
      
      // 跳过已存在的图片
      if (images.some(img => img.url === rawUrl) || newImages.some(img => img.url === rawUrl)) {
        continue;
      }
      // 先获取图片真实尺寸
      const { width: natW, height: natH } = await loadCanvasImageSize(rawUrl);
      const displaySize = getCanvasImageDisplaySize(natW, natH);
      
      const tempId = `ref-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      newImages.push({
        id: tempId,
        url: rawUrl,
        prompt: '',
        x: 0,
        y: 0,
        width: displaySize.width,
        height: displaySize.height,
        originalWidth: natW,
        originalHeight: natH,
        createdAt: Date.now(),
      });
    }
    
    if (newImages.length > 0) {
      // 应用自动布局计算位置，然后添加到画布
      setImages(prev => {
        const laidOut = autoLayoutImages(prev, newImages);
        stabilizeCanvasImages(laidOut.map(img => ({ id: img.id, url: img.url })));
        return [...prev, ...laidOut];
      });
      recordUserData({
        userId: currentUser?.id,
        area: 'images',
        type: 'canvas-add-batch',
        filename: `canvas-images-${Date.now()}.json`,
        content: JSON.stringify(newImages, null, 2),
        metadata: { imageCount: newImages.length },
      });
      toast.success(`已添加 ${newImages.length} 张图片到画布`, {
        description: '图片已自动排列到画布',
        className: 'bg-[#141414] border-[#2a2a2a] text-white',
      });
    } else if (imageUrls.length > 0) {
      toast.info('图片已在画布中', {
        description: '所有图片已经存在于画布',
        className: 'bg-[#141414] border-[#2a2a2a] text-white',
      });
    }
  }, [images, autoLayoutImages, stabilizeCanvasImages, currentUser?.id]);

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
          className: 'bg-[#141414] border-[#d4af37] text-white',
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
  }, []);

  const handleGenerateVariation = useCallback(async (params: GenerationParams & { originalImage: CanvasImage }) => {
    // 如果有原图，使用原图作为参考
    if (params.originalImage.url) {
      params.referenceImages = [params.originalImage.url];
      params.referenceMode = 'style';
    }

    const taskId = ++generationTaskRef.current;
    setIsGenerating(true);
    setGenerationElapsed(0);
    if (generationTimerRef.current) clearInterval(generationTimerRef.current);
    generationTimerRef.current = setInterval(() => {
      setGenerationElapsed(prev => prev + 1);
    }, 1000);
    const outputCount = params.outputCount || 1;
    
    try {
      setGenerationProgress({ current: 0, total: outputCount });
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, userId: currentUser?.id }),
      });

      if (taskId !== generationTaskRef.current) return;
      const data = await response.json();

      // === 新模式：前端轮询 ===
      if (data.success && data.mode === 'polling') {
        const { taskIds, estimatedTime, prompt: enhancedPrompt } = data;
        
        setGenerationProgress({ current: Math.ceil(outputCount * 0.1), total: outputCount });

        const getPollInterval = (pollCount: number, estTime: number) => {
          const baseInterval = estTime <= 20 ? 1500 : estTime <= 60 ? 2000 : 2500;
          if (pollCount > 20) return baseInterval + 1500;
          if (pollCount > 10) return baseInterval + 500;
          return baseInterval;
        };

        const maxPollTime = Math.min(300, Math.max(60, estimatedTime * 3 + 30)) * 1000;
        const pollStartTime = Date.now();

        const completedImages: Array<{ id: string; url: string; prompt: string; model?: string; quality?: string; aspectRatio?: string; stylePreset?: string; category?: string; size?: string; sourceUrl?: string }> = [];        let consecutiveErrors = 0;

        for (let taskIdx = 0; taskIdx < taskIds.length; taskIdx++) {
          const currentTaskId = taskIds[taskIdx];
          let pollCount = 0;
          let taskCompleted = false;

          while (!taskCompleted) {
            if (Date.now() - pollStartTime > maxPollTime) {
              toast.error('生成超时', {
                description: '请尝试降低分辨率或简化提示词后重试',
                className: 'bg-[#141414] border border-red-900 text-white',
              });
              break;
            }

            if (taskId !== generationTaskRef.current) return;

            const interval = getPollInterval(pollCount, estimatedTime);
            await new Promise(resolve => setTimeout(resolve, interval));
            pollCount++;

            try {
              const pollResponse = await fetch('/api/poll-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: currentTaskId, model: params.model, providerId: params.providerId, userId: currentUser?.id }),
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

              if (pollData.status === 'completed' && pollData.imageUrl) {
                const imageUrl = pollData.imageUrl as string;
                completedImages.push({
                  id: `${Date.now()}-${taskIdx}`,
                  url: imageUrl,
                  prompt: enhancedPrompt || params.prompt,
                  model: params.model,
                  quality: params.quality,
                  aspectRatio: params.aspectRatio,
                  stylePreset: params.stylePreset,
                  category: params.imageCategory || params.productCategory,
                  size: params.size,
                  sourceUrl: imageUrl,
                });
                taskCompleted = true;
                consecutiveErrors = 0;
                setGenerationProgress({ 
                  current: Math.ceil((taskIdx + 1) / taskIds.length * outputCount * 0.9), 
                  total: outputCount 
                });
              } else if (pollData.status === 'failed' || pollData.status === 'cancelled') {
                toast.error('生成失败', {
                  description: pollData.error || '任务失败',
                  className: 'bg-[#141414] border border-red-900 text-white',
                });
                taskCompleted = true;
              } else {
                consecutiveErrors = 0;
              }
            } catch (pollError) {
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
            createdAt: Date.now(),
          }));

          setImages(prev => {
            const laidOut = autoLayoutImages(prev, newImages);
            stabilizeCanvasImages(laidOut.map(img => ({ id: img.id, url: img.url })));
            return [...prev, ...laidOut];
          });
          setGenerationProgress({ current: outputCount, total: outputCount });

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
        setGenerationProgress({ current: outputCount, total: outputCount });

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
      if (taskId === generationTaskRef.current) {
        setIsGenerating(false);
        setGenerationProgress(undefined);
        if (generationTimerRef.current) {
          clearInterval(generationTimerRef.current);
          generationTimerRef.current = null;
        }
      }
    }
  }, []);

  const handlePreview = useCallback((image: CanvasImage) => {
    setPreviewImage(image);
  }, []);

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
    // 为新任务生成唯一ID
    const taskId = ++generationTaskRef.current;
    setIsGenerating(true);
    const outputCount = params.count || 1;
    
    try {
      // 开始处理 - 10%
      setGenerationProgress({ current: 0, total: outputCount });
      
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
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          size,
          referenceImages: params.referenceImages,
          referenceMode: 'blend',
          imageCategory: 'general',
          productCategory: 'none',
          aspectRatio: params.aspectRatio,
          stylePreset: 'auto',
          outputCount: params.count,
          userId: currentUser?.id,
        }),
      });

      // API调用中 - 30%
      if (taskId !== generationTaskRef.current) return;
      setGenerationProgress({ current: Math.ceil(outputCount * 0.3), total: outputCount });
      
      const data = await response.json();

      if (data.success && data.images) {
        // 数据返回 - 60%
        if (taskId !== generationTaskRef.current) return;
        setGenerationProgress({ current: Math.ceil(outputCount * 0.6), total: outputCount });
        
        const newImageUrls: string[] = data.images.map((img: { id: string; url: string; prompt: string }) => img.url);

        // 添加图片到画布 - 80%（使用自动布局）
        if (taskId !== generationTaskRef.current) return;
        setGenerationProgress({ current: Math.ceil(outputCount * 0.8), total: outputCount });
        
        await handleAddImages(newImageUrls);
        
        // 完成 - 100%
        if (taskId !== generationTaskRef.current) return;
        setGenerationProgress({ current: outputCount, total: outputCount });
        
        toast.success('融合成功', {
          description: `已生成 ${data.images.length} 张融合图片`,
          className: 'bg-[#141414] border-[#d4af37] text-white',
        });
      } else {
        toast.error('融合失败', {
          description: data.error || '未知错误',
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
      // 只有当前任务ID匹配时才清除状态
      if (taskId === generationTaskRef.current) {
        setIsGenerating(false);
        setGenerationProgress(undefined);
        if (generationTimerRef.current) { clearInterval(generationTimerRef.current); generationTimerRef.current = null; }
      }
    }
  }, []);

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
  const handleExtractKeywords = useCallback(async (image: { id: string; url: string }) => {
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: image.url, category: 'general' }),
      });
      const data = await response.json();
      if (data.success && data.prompt) {
        toast.success('关键词已提取', {
          description: data.prompt.substring(0, 80) + (data.prompt.length > 80 ? '...' : ''),
          className: 'bg-[#141414] border-[#d4af37] text-white',
        });
        // 同时复制到剪贴板
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(data.prompt);
          toast.info('已复制到剪贴板', {
            description: '可粘贴到右侧图片描述区',
            className: 'bg-[#141414] border-[#d4af37] text-white',
          });
        }
      }
    } catch (error) {
      console.error('Extract keywords error:', error);
      toast.error('提取失败', {
        description: '关键词提取失败，请重试',
        className: 'bg-[#141414] border border-red-900 text-white',
      });
    }
  }, []);

  // 提示词大师 - 从chat-panel传递到generation-panel
  const [externalPrompt, setExternalPrompt] = useState<string | undefined>(undefined);
  const [externalReferenceImage, setExternalReferenceImage] = useState<string | null>(null);

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
        className: 'bg-[#141414] border-[#d4af37] text-white',
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
            className: 'bg-[#141414] border-[#d4af37] text-white',
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
  }, [currentChatModelInfo]);

  const handleAddToPrompt = useCallback((optimizedPrompt: string) => {
    setExternalPrompt(optimizedPrompt);
    setActivePanel('generate');
  }, []);

  const handleExternalPromptConsumed = useCallback(() => {
    setExternalPrompt(undefined);
  }, []);

  // 适配 InfiniteCanvas 的简单回调函数
  const handleCanvasGenerateVariation = useCallback((image: CanvasImage) => {
    setExternalReferenceImage(image.url);
  }, []);

  const handleCanvasExtractKeywords = useCallback((image: CanvasImage) => {
    handleExtractKeywords({ id: image.id, url: image.url });
  }, [handleExtractKeywords]);

  const handleCanvasFusion = useCallback((images: CanvasImage[]) => {
    handleFusion({
      prompt: '',
      aspectRatio: '1:1',
      quality: 'standard',
      count: 1,
      referenceImages: images.map(img => img.url)
    });
  }, [handleFusion]);

  // Language-based image editing handler - called by canvas when opening editor
  const handleOpenEditor = useCallback((image: CanvasImage, sourceRect?: DOMRect | null) => {
    setEditingImage(image);
    setEditSourceRect(sourceRect ? { left: sourceRect.left, top: sourceRect.top, right: sourceRect.right, bottom: sourceRect.bottom, width: sourceRect.width, height: sourceRect.height } : null);
    setLangEditMode('idle');
  }, []);

  // Language-based image editing handler - called when editor confirms/replaces image
  // Language-based image editing handler - called by canvas when opening editor via connection point
  const handleCanvasEditImage = useCallback((imageId: string, imageUrl: string, resultPrompt?: string, sourceRect?: { left: number; top: number; right: number; bottom: number; width: number; height: number }) => {
    if (sourceRect) {
      // Connection point click: open the ImageEditor
      const img = images.find(i => i.id === imageId);
      if (img) {
        setEditingImage(img);
        setEditSourceRect(sourceRect);
        setLangEditMode('idle');
      }
    } else {
      // Editor confirmation: update the image URL
      setImages(prev => prev.map(img =>
        img.id === imageId
          ? { ...img, url: imageUrl, prompt: resultPrompt || img.prompt }
          : img
      ));
    }
  }, [images]);

  return (
    <div className={`h-screen w-screen relative overflow-hidden ${themeStyle === 'monochrome' ? 'bg-white' : 'bg-[#0a0a0a]'}`}>
      {/* Canvas - 全屏 */}
      <div className="absolute inset-0">
        <InfiniteCanvas
          images={images}
          onImagesChange={setImages}
          onUndo={handleUndo}

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
          isGenerating={isGenerating}
          generationProgress={generationProgress}
          themeStyle={themeStyle}
          onVisionPrompt={handleVisionPrompt}
          visionPromptEnabled={visionPromptEnabled}
          onToggleVisionPrompt={() => {
            setVisionPromptEnabled(prev => !prev);
            setOhMyPromptOpen(prev => !prev);
          }}
          ohMyPromptOpen={ohMyPromptOpen}
          onCloseOhMyPrompt={() => { setOhMyPromptOpen(false); setVisionPromptEnabled(false); }}
          onInsertPrompt={(prompt: string) => setExternalPrompt(prompt)}
          ohMyPromptThemeStyle={themeStyle}
          isVisionAnalyzing={isVisionAnalyzing}
          onToggleSettings={() => setPanelCollapsed(prev => !prev)}
          onToggleTheme={() => setThemeStyle(prev => prev === 'gold' ? 'monochrome' : 'gold')}
          onToggleUserManager={() => setShowUserManager(prev => !prev)}
          onToggleAdminSystem={() => setShowAdminSystem(prev => !prev)}
          isAdmin={currentUser?.role === 'admin'}
          onToggleProjectData={() => setShowProjectData(prev => !prev)}
          onToggleHelp={() => setShowHelpGuide(true)}
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
          onForceSave={() => {
            try {
              if (currentProject?.id && images.length > 0) {
                const mgr = UserManagerCore.getInstance();
                const persistable = images.map(img => ({
                  id: img.id,
                  url: img.url.startsWith('data:') || img.url.startsWith('blob:') ? '' : img.url,
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
          onEditImage={handleCanvasEditImage}
          langEditMode={langEditMode}
          onLangEditModeChange={setLangEditMode}
        />
      </div>

      {/* Floating Panel */}
      {!panelCollapsed && (
        <div className={`absolute top-3 right-3 bottom-3 w-[340px] z-30 flex flex-col transition-all duration-300 overflow-hidden ${
          themeStyle === 'monochrome' 
            ? 'bg-white/98 backdrop-blur-xl border border-gray-200 shadow-2xl rounded-xl' 
            : 'bg-[#141414]/95 backdrop-blur-xl border border-[#d4af37]/20 rounded-xl shadow-2xl'
        }`}>
          {/* 软件标题 - 版本号在下方，项目名在右侧 */}
          <div className={`px-4 py-2 border-b flex-shrink-0 flex items-center justify-between ${
            themeStyle === 'monochrome' ? 'border-gray-200 bg-gray-50/50' : 'border-[#2a2a2a]'
          }`}>
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <h1 className={`text-lg font-bold leading-tight ${
                  themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
                }`}>
                  {APP_NAME}
                </h1>
                <span className={`text-[10px] leading-tight ${
                  themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#555]'
                }`}>
                  {APP_FULL_VERSION_LABEL}
                </span>
              </div>
              {currentProject && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  themeStyle === 'monochrome' 
                    ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' 
                    : 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30'
                }`}>
                  {currentProject.name}
                </span>
              )}
            </div>
          </div>

          {/* Panel Tabs - 紧凑化 */}
          <div className={`flex border-b flex-shrink-0 ${
            themeStyle === 'monochrome' ? 'border-gray-200' : 'border-[#2a2a2a]'
          }`}>
            <button
              onClick={() => setActivePanel('generate')}
              className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-1.5 transition-all text-sm ${
                activePanel === 'generate'
                  ? themeStyle === 'monochrome'
                    ? 'text-gray-900 border-b-2 border-yellow-400 bg-white'
                    : 'text-[#d4af37] border-b-2 border-[#d4af37]'
                  : themeStyle === 'monochrome'
                    ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    : 'text-[#888] hover:text-white'
              }`}
            >
              <ImageIcon size={15} />
              <span className="text-sm font-medium">图像生成</span>
            </button>
            <button
              onClick={() => setActivePanel('chat')}
              className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-1.5 transition-all text-sm ${
                activePanel === 'chat'
                  ? themeStyle === 'monochrome'
                    ? 'text-gray-900 border-b-2 border-yellow-400 bg-white'
                    : 'text-[#d4af37] border-b-2 border-[#d4af37]'
                  : themeStyle === 'monochrome'
                    ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    : 'text-[#888] hover:text-white'
              }`}
            >
              <MessageSquare size={15} />
              <span className="text-sm font-medium">智能对话</span>
            </button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className={activePanel === 'generate' ? 'flex-1 overflow-y-auto' : 'hidden'} style={{
              scrollbarWidth: 'thin',
              scrollbarColor: themeStyle === 'monochrome' ? '#d1d5db transparent' : '#444 transparent'
            }}>
              <GenerationPanel
                    onGenerate={handleGenerate}
                    isGenerating={isGenerating}
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
                    onError={(error: string) => {
                      toast.error('生成失败', {
                        description: error,
                        className: themeStyle === 'monochrome' 
                          ? 'bg-white border border-gray-200 text-gray-900' 
                          : 'bg-[#141414] border-[#2a2a2a] text-white',
                      });
                      setIsGenerating(false);
                      setGenerationProgress(undefined);
                      if (generationTimerRef.current) { clearInterval(generationTimerRef.current); generationTimerRef.current = null; }
                    }}
                  />
              </div>
              <div className={activePanel === 'chat' ? 'flex-1 overflow-hidden' : 'hidden'}>
                <ChatPanel themeStyle={themeStyle} onAddToPrompt={handleAddToPrompt} onAddImages={handleAddImages} canvasImages={images} onChatModelChange={setCurrentChatModelInfo} />
              </div>

            {/* 固定在底部的开始生成按钮 */}
            {activePanel === 'generate' && (
              <div className={`border-t px-4 py-3 flex-shrink-0 ${
                themeStyle === 'monochrome' ? 'border-gray-200 bg-gray-50' : 'border-[#2a2a2a]'
              }`}>
                {/* 进度条和耗时 */}
                {isGenerating && (
                  <div className="mb-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs font-medium ${
                        themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'
                      }`}>
                        {(() => {
                          const pct = generationProgress ? Math.round((generationProgress.current / generationProgress.total) * 100) : 0;
                          return pct > 0 ? `生成进度 ${pct}%` : '任务提交中...';
                        })()}
                      </span>
                      {generationElapsed > 0 && (
                        <span className={`text-xs tabular-nums ${
                          themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#777]'
                        }`}>
                          {generationElapsed >= 60 
                            ? `${Math.floor(generationElapsed / 60)}分${generationElapsed % 60}秒`
                            : `${generationElapsed}秒`}
                        </span>
                      )}
                    </div>
                    <div className={`w-full h-1 rounded-full overflow-hidden ${
                      themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-[#2a2a2a]'
                    }`}>
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ease-out ${
                          themeStyle === 'monochrome' 
                            ? 'bg-gradient-to-r from-yellow-400 to-yellow-500' 
                            : 'bg-gradient-to-r from-[#d4af37] to-[#daa520]'
                        }`}
                        style={{ width: `${Math.max(generationProgress ? Math.round((generationProgress.current / generationProgress.total) * 100) : 0, isGenerating ? 3 : 0)}%` }}
                      />
                    </div>
                  </div>
                )}
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent('trigger-generate'))}
                  disabled={isGenerating}
                  className={`w-full py-2 px-4 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    isGenerating
                      ? themeStyle === 'monochrome'
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : 'bg-[#2a2a2a] text-[#666] cursor-not-allowed'
                      : themeStyle === 'monochrome'
                        ? 'bg-gradient-to-r from-yellow-400 to-yellow-500 text-white hover:from-yellow-500 hover:to-yellow-600 shadow-md hover:shadow-lg'
                        : 'bg-gradient-to-r from-[#d4af37] to-[#daa520] text-black hover:from-[#daa520] hover:to-[#d4af37] shadow-md hover:shadow-lg'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>生成中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>开始生成</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}


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
        onEditImage={(img) => {
          setPreviewImage(null);
          setEditingImage(img);
          // Calculate source rect from the preview image element
          setTimeout(() => {
            const el = document.querySelector(`[data-image-id="${img.id}"]`);
            if (el) {
              const rect = el.getBoundingClientRect();
              setEditSourceRect({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
            }
          }, 100);
        }}
      />

      {/* Language Image Editor */}
      {editingImage && editSourceRect && (
        <ImageEditor
          image={editingImage}
          sourceRect={editSourceRect}
          onClose={() => { setEditingImage(null); setEditSourceRect(null); }}
          onConfirm={(imageId: string, resultUrl: string, resultPrompt?: string) => {
            setImages(prev => prev.map(img =>
              img.id === imageId
                ? { ...img, url: resultUrl, prompt: resultPrompt || img.prompt }
                : img
            ));
            setEditingImage(null);
            setEditSourceRect(null);
          }}
        />
      )}

      {/* Toast */}
      <Toaster 
        position="top-center" 
        toastOptions={{
          className: themeStyle === 'monochrome' 
            ? 'bg-white border border-gray-200 text-gray-900' 
            : 'bg-[#141414] border border-[#2a2a2a] text-white',
        }}
      />

      {/* User Manager Modal */}
      {showUserManager && (
        <UserManager
          themeStyle={themeStyle}
          onClose={() => setShowUserManager(false)}
          currentImageCount={images.length}
          currentProjectId={currentProject?.id}
          onLogin={(user) => {
            if (user) {
              setCurrentUser(user);
              setShowUserManager(false);
              // Auto-load most recent project or create default
              try {
                const userMgr = UserManagerCore.getInstance();
                const projects = userMgr.getProjects();
                if (projects.length > 0) {
                  const project = projects[0];
                  setCurrentProject(project);
                  // 加载项目画布数据
                  if (project.canvasImages && project.canvasImages.length > 0) {
                    setImages((project.canvasImages as unknown as Record<string, unknown>[]).map(img => ({
                      id: img.id as string,
                      url: img.url as string,
                      prompt: (img.prompt as string) || '',
                      modifyPrompt: (img.modifyPrompt as string) || '',
                      model: (img.model as string) || '',
                      quality: (img.quality as string) || '',
                      aspectRatio: (img.aspectRatio as string) || '',
                      stylePreset: (img.stylePreset as string) || '',
                      category: (img.category as string) || '',
                      size: (img.size as string) || '',
                      groupId: (img.groupId as string) || '',
                      threeDModelUrl: (img.threeDModelUrl as string) || '',
                      threeDModelUrls: (img.threeDModelUrls as Record<string, string>) || undefined,
                      x: img.x as number,
                      y: img.y as number,
                      width: (img.width as number) || 256,
                      height: (img.height as number) || 256,
                      originalWidth: (img.originalWidth as number) || 512,
                      originalHeight: (img.originalHeight as number) || 512,
                      createdAt: (img.createdAt as number) || Date.now(),
                    })));
                    // 恢复分组数据（优先 metadata，其次 localStorage 兜底）
                    const metaGroups = project.metadata?.groups;
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
                        const lsGroups = localStorage.getItem(`wujie-groups-${project.id}`);
                        if (lsGroups) restoredGroups = JSON.parse(lsGroups);
                      } catch {}
                    }
                    setInitialGroups(restoredGroups);
                  } else {
                    setImages([]);
                    setInitialGroups([]);
                  }
                } else {
                  const defaultProject = userMgr.createProject('默认项目', '我的第一个创作项目');
                  setCurrentProject(defaultProject);
                  setImages([]);
                  setInitialGroups([]);
                }
              } catch { /* Project creation failed - non-blocking */ }
              toast.success('登录成功', {
                description: `欢迎回来，${user.name}`,
                className: themeStyle === 'monochrome' 
                  ? 'bg-white border border-gray-200 text-gray-900' 
                  : 'bg-[#141414] border border-[#2a2a2a] text-white',
              });
            } else {
              setCurrentUser(null);
              setShowUserManager(false);
            }
          }}
          onLogout={async () => {
            // 退出前同步保存当前项目数据（含 data: URL 持久化）
            try {
              if (currentProject && images.length > 0) {
                const mgr = UserManagerCore.getInstance();
                // 同步持久化 data:/blob: URL
                const urlMapping: Record<string, string> = {};
                const sourceUrlMapping: Record<string, string> = {};
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
                    url: urlMapping[img.url] || (img.url.startsWith('data:') || img.url.startsWith('blob:') ? '' : img.url),
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
                  }))
                  .filter(img => img.url);
                mgr.updateProject(currentProject.id, {
                  canvasImages: persistableCanvasImages,
                  metadata: {
                    ...(currentProject.metadata || {}),
                    groups: groupsRef.current,
                  },
                });
              }
            } catch { /* save failed - non-blocking */ }
            setCurrentUser(null);
            setCurrentProject(null);
            setImages([]);
            setInitialGroups([]);
            // 显示登录界面
            setShowUserManager(true);
            toast.info('已退出登录', {
              description: '请重新登录以继续使用',
              className: themeStyle === 'monochrome'
                ? 'bg-white border border-gray-200 text-gray-900'
                : 'bg-[#141414] border border-[#2a2a2a] text-white',
            });
          }}
          onSelectProject={async (project) => {
            // 标记项目切换中，阻止自动保存用旧闭包数据覆盖
            switchingProjectRef.current = true;
            // 清除可能正在等待的自动保存定时器
            if (autoSaveRef.current) {
              clearTimeout(autoSaveRef.current);
              autoSaveRef.current = null;
            }

            // 切换项目前先保存当前项目数据（含 data: URL 持久化 + metadata/groups）
            try {
              if (currentProject && images.length > 0) {
                const mgr = UserManagerCore.getInstance();
                // 同步持久化 data:/blob: URL
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
                  if (Object.keys(urlMapping).length > 0) {
                    setImages(prev => prev.map(img => urlMapping[img.url] ? { ...img, url: urlMapping[img.url] } : img));
                  }
                }
                const persistableCanvasImages = images
                  .map(img => ({
                    id: img.id,
                    url: urlMapping[img.url] || (img.url.startsWith('data:') || img.url.startsWith('blob:') ? '' : img.url),
                    x: img.x, y: img.y, width: img.width, height: img.height,
                    originalWidth: img.originalWidth || img.width * 2,
                    originalHeight: img.originalHeight || img.height * 2,
                    rotation: 0, zIndex: 0, createdAt: img.createdAt || Date.now(),
                    prompt: img.prompt || '', modifyPrompt: img.modifyPrompt || '',
                    model: img.model || '', quality: img.quality || '',
                    aspectRatio: img.aspectRatio || '', stylePreset: img.stylePreset || '',
                    category: img.category || '', size: img.size || '',
                    groupId: img.groupId || '',
                    threeDModelUrl: img.threeDModelUrl || '',
                    threeDModelUrls: img.threeDModelUrls || undefined,
                  }))
                  .filter(img => img.url);
                // 保存 canvasImages + metadata(groups)，与自动保存逻辑保持一致
                mgr.updateProject(currentProject.id, {
                  canvasImages: persistableCanvasImages,
                  metadata: {
                    ...(currentProject.metadata || {}),
                    groups: groupsRef.current,
                  },
                });
              }
            } catch { /* save failed - non-blocking */ }

            // 从 UserManager 单例获取最新项目数据（而非组件中的过快照）
            // 避免因组件 state 未刷新导致使用过时的 canvasImages（可能为空）
            const mgr = UserManagerCore.getInstance();
            const freshProject = mgr.getProject(project.id) || project;

            setCurrentProject(freshProject);
            // 加载项目画布数据
            if (freshProject.canvasImages && freshProject.canvasImages.length > 0) {
              setImages((freshProject.canvasImages as unknown as Record<string, unknown>[]).map(img => ({
                id: img.id as string,
                url: img.url as string,
                prompt: (img.prompt as string) || '',
                modifyPrompt: (img.modifyPrompt as string) || '',
                model: (img.model as string) || '',
                quality: (img.quality as string) || '',
                aspectRatio: (img.aspectRatio as string) || '',
                stylePreset: (img.stylePreset as string) || '',
                category: (img.category as string) || '',
                size: (img.size as string) || '',
                groupId: (img.groupId as string) || '',
                threeDModelUrl: (img.threeDModelUrl as string) || '',
                threeDModelUrls: (img.threeDModelUrls as Record<string, string>) || undefined,
                x: img.x as number,
                y: img.y as number,
                width: (img.width as number) || 256,
                height: (img.height as number) || 256,
                originalWidth: (img.originalWidth as number) || 512,
                originalHeight: (img.originalHeight as number) || 512,
                createdAt: (img.createdAt as number) || Date.now(),
              })));
              // 恢复分组数据（优先 metadata，其次 localStorage 兜底）
              const metaGroups = freshProject.metadata?.groups;
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
                  const lsGroups = localStorage.getItem(`wujie-groups-${freshProject.id}`);
                  if (lsGroups) restoredGroups = JSON.parse(lsGroups);
                } catch {}
              }
              setInitialGroups(restoredGroups);
              toast.success('项目已加载', {
                description: `${freshProject.name} - ${freshProject.canvasImages.length} 张图片`,
                className: themeStyle === 'monochrome'
                  ? 'bg-white border border-gray-200 text-gray-900'
                  : 'bg-[#141414] border border-[#d4af37]/50 text-white',
              });
            } else {
              // 项目无图片，清空画布
              setImages([]);
              setInitialGroups([]);
              toast.info('项目已加载', {
                description: `${freshProject.name} - 暂无图片`,
                className: themeStyle === 'monochrome'
                  ? 'bg-white border border-gray-200 text-gray-900'
                  : 'bg-[#141414] border border-[#2a2a2a] text-white',
              });
            }
            setShowUserManager(false);
            // 项目切换完成，解除自动保存拦截
            switchingProjectRef.current = false;
          }}
        />
      )}

      {showAdminSystem && currentUser?.role === 'admin' && (
        <AdminSystem
          themeStyle={themeStyle}
          onClose={() => setShowAdminSystem(false)}
        />
      )}

      {/* Help Guide Modal */}
      <HelpGuide
        isOpen={showHelpGuide}
        onClose={() => setShowHelpGuide(false)}
        themeStyle={themeStyle}
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
          createdAt: img.createdAt,
        }))}
        onDeleteImages={(ids) => {
          setImages(prev => prev.filter(img => !ids.includes(img.id)));
          setSelectedImage(null);
        }}
        onNavigateToImage={(imageId) => {
          setNavigateToImageId(imageId);
          setShowProjectData(false);
        }}
        isMonochrome={themeStyle === 'monochrome'}
      />

      {/* Auth gate overlay - covers everything when not authenticated */}
      {!authChecked && (
        <div className="fixed inset-0 flex items-center justify-center z-[90] bg-[#0a0a0a]">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
            <p className="text-white/60 text-sm">正在验证身份...</p>
          </div>
        </div>
      )}
      {authChecked && !currentUser && !showUserManager && (
        <div className="fixed inset-0 flex items-center justify-center z-[90] bg-[#0a0a0a]">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-bold text-white">无界 AI</h1>
            <p className="text-white/50 text-sm">请先登录以使用画布</p>
            <button
              onClick={() => setShowUserManager(true)}
              className="px-6 py-2.5 bg-[#d4af37] text-black font-medium rounded-lg hover:bg-[#c4a030] transition-colors"
            >
              登录 / 注册
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export default function Home() {
  return <CanvasApp />;
}
