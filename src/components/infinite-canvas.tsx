'use client';
import NextImage from 'next/image';
import { toast } from 'sonner';
import { } from '@/lib/canvas-mode-handlers';
import { findClosestStandardRatio, STANDARD_RATIOS, type StandardRatio } from '@/lib/canvas-utils';

import React, { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Trash2, Download, ZoomIn, ZoomOut, Maximize2, Hand,
  FileText, X, ChevronDown, Eraser,
  Scissors, Wand2, Expand, Layers, Paintbrush,
  Check, MousePointer2, Upload, Sparkles,
  RotateCcw, Minus, GitMerge, GitBranch,
  Settings, Palette, Users, HelpCircle, Box as BoxIcon, Camera, ImagePlus, Shield, FolderOpen, Contrast, PenTool, Pencil, Settings2, ChevronUp, Bot, Heart, ShoppingBag, Scan, GripVertical, Building2, FileImage, Workflow, LayoutGrid, LayoutDashboard, ChevronsRight, ChevronsLeft, Boxes, MessageCircle, Play, Pause, Package, Store, Globe, Volume2, Loader2, Film
} from 'lucide-react';
import type { CanvasAnnotation, AnnotationRegion, AnnotationExecutionResult } from '@/lib/canvas-annotation';
import { createAnnotation, hitTestAnnotationTarget, buildAnnotationPrompt, computeAnnotationRegion, BRUSH_COLOR_PALETTE, applyMergedAnnotationExecutionResult } from '@/lib/canvas-annotation';
import type { CanvasGenGroup, GenGroupToolbar, GroupRefImage, GenGroupType, ReferenceCategory, HexCubeGroup, CubeFace, ZoomLevel } from '@/lib/canvas-generation-group';
import { calculateActualPixels, REFERENCE_CATEGORIES, REFERENCE_CATEGORY_LABELS, createHexCubeGroup, CUBE_FACE_ORDER, CUBE_FACE_LABELS, ZOOM_LEVEL_LABELS, MODEL_ASPECT_RATIOS, QUALITY_DISPLAY_NAMES, DEFAULT_ASPECT_RATIOS, findModelConfig, getModelParamType, getResolutionTierOptions, getQualityLevelOptions, RESOLUTION_TIER_DISPLAY_NAMES, QUALITY_LEVEL_DISPLAY_NAMES } from '@/lib/canvas-generation-group';
import { getModelDisplayName } from '@/lib/model-name-map';
import type { PsdLayerItem } from '@/types/psdLayer';
import { awaitStableImageUrl, onPersistComplete, getCachedLocalUrl, persistVideoUrlInBackground, persistRemoteUrlInBackground } from '@/lib/stable-image-url';
import { taskEventsClient } from '@/lib/task-events-client';
import { extractTaskResultImageUrl } from '@/lib/task-result-url';
import { } from '@/lib/canvas-annotation-visibility';
import { closestSupportedImageAspectRatio } from '@/lib/image-aspect-ratio';
import { getHexCubeInitialPosition } from '@/lib/hex-cube-position';
import { buildHexCubeGenerationInput } from '@/lib/hex-cube-generation';
import { resolveRefineEngineInitialImageUrl } from '@/lib/refine-engine-image';
import { translateApiError } from '@/lib/api-error-translator';
import { } from '@/config/app-meta';
import { shouldSuspendCanvasVirtualization } from '@/lib/canvas-pan-virtualization';
import { applyCanvasGenerationResults } from '@/lib/canvas-generation-results';
import OhMyPrompt from '@/components/oh-my-prompt';
import { CanvasHelpModal } from '@/components/canvas/CanvasHelpModal';
import dynamic from 'next/dynamic';

const ModelViewer3D = dynamic(() => import('@/components/model-viewer-3d'), { ssr: false });
const VideoPlayer = dynamic(() => import('@/components/video-player'), { ssr: false });
const VideoEditPanel = dynamic(() => import('@/components/video-edit-panel').then(m => ({ default: m.VideoEditPanel })), { ssr: false });
const VideoCompareDialog = dynamic(() => import('@/components/video-compare-dialog'), { ssr: false });

const PsdLayerEditor = lazy(() => import('@/components/psd-editor/PsdLayerEditor'));
const AgentEditor = lazy(() => import('@/components/agent-editor').then(m => ({ default: m.AgentEditor })));
import { computeSnapGuides, findBestSnapOffset, type SnapGuide } from '@/lib/canvas-snap-guides';
import { type CanvasConnection, type ConnectionRelationType, createAutoConnection, computeConnectionEndpoints, buildConnectionPath, buildArrowHead, RELATION_TYPE_CONFIG } from '@/lib/canvas-connections';
import { EngineSelectDialog, type EditEngine } from '@/components/engine-select-dialog';
const BrandEcommercePanel = lazy(() => import('@/components/brand-ecommerce-panel').then(m => ({ default: m.BrandEcommercePanel })));
const RefineEnginePanel = lazy(() => import('@/components/refine-engine-panel'));
const FontDesignPanel = lazy(() => import('@/components/font-design-panel'));
const BrandFactoryPanel = lazy(() => import('@/components/brand-factory-panel'));
const LogoSkillPanel = lazy(() => import('@/components/logo-skill-panel'));
const AiPsdPanel = lazy(() => import('@/components/ai-psd/ai-psd-panel'));
const ImageCompareDialog = lazy(() => import('@/components/image-compare-dialog').then(m => ({ default: m.ImageCompareDialog })));
const SceneStudioPanel = lazy(() => import('@/components/scene-studio-panel'));
const StickerAssistantPanel = lazy(() => import('@/components/sticker-assistant-panel'));
const BrandPackagingPanel = lazy(() => import('@/components/brand-packaging-panel'));
const Display3DPanel = lazy(() => import('@/components/display3d-panel'));

// P1: 图层面板 + 版本历史面板
const LayerPanel = lazy(() => import('@/components/layer-panel').then(m => ({ default: m.LayerPanel })));
const VersionHistoryPanel = lazy(() => import('@/components/version-history-panel').then(m => ({ default: m.VersionHistoryPanel })));

/* ====== Multi-Angle Sphere Preview (Canvas 2D) ====== */
function MultiAngleSpherePreview({
  imageUrl,
  rotation,
  tilt,
  zoom,
  isMonochrome,
}: {
  imageUrl: string;
  rotation: number;
  tilt: number;
  zoom: number;
  isMonochrome: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgDataRef = useRef<ImageData | null>(null);
  const imgLoadingRef = useRef(false);

  // Preload image pixel data
  useEffect(() => {
    if (imgLoadingRef.current) return;
    imgLoadingRef.current = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxDim = 256;
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const w = Math.floor(img.width * scale);
      const h = Math.floor(img.height * scale);
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const octx = offscreen.getContext('2d');
      if (!octx) { imgLoadingRef.current = false; return; }
      octx.drawImage(img, 0, 0, w, h);
      try {
        imgDataRef.current = octx.getImageData(0, 0, w, h);
      } catch {
        imgDataRef.current = null;
      }
      imgLoadingRef.current = false;
    };
    img.onerror = () => { imgLoadingRef.current = false; };
    img.src = imageUrl;
    return () => {
      // Cancel pending image load on cleanup to prevent stale updates
      img.onload = null;
      img.onerror = null;
      img.src = '';
      imgLoadingRef.current = false;
    };
  }, [imageUrl]);

  // Render sphere on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const R = Math.min(W, H) * 0.38;

    ctx.clearRect(0, 0, W, H);

    // Dark bg
    ctx.fillStyle = isMonochrome ? '#f9fafb' : '#0d0d0d';
    ctx.fillRect(0, 0, W, H);

    const imgData = imgDataRef.current;
    const yaw = (rotation / 90) * Math.PI * 0.5;  // -PI/2 to PI/2
    const pitch = -(tilt / 60) * Math.PI * 0.5;   // negated: positive tilt = looking up (仰视)
    const camDist = 2.5 / (zoom === 0 ? 0.7 : zoom === 2 ? 1.5 : 1.0);
    void camDist;  // 特写=0.7, 标准=1.0, 广角=1.5

    if (!imgData) {
      // Draw placeholder sphere
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2);
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = isMonochrome ? '#e5e7eb' : '#1a1a1a';
      ctx.fill();
      ctx.fillStyle = isMonochrome ? '#9ca3af' : '#555';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('加载中...', W / 2, H / 2 + 4);
      return;
    }

    const srcW = imgData.width;
    const srcH = imgData.height;
    const src = imgData.data;
    const cx = W / 2;
    const cy = H / 2;

    // Low-res rendering for performance
    const scale = 0.4;
    const rW = Math.floor(W * scale);
    const rH = Math.floor(H * scale);
    const rR = R * scale;
    const rCx = rW / 2;
    const rCy = rH / 2;

    const outImg = ctx.createImageData(rW, rH);
    const out = outImg.data;

    const rR2 = rR * rR;

    for (let py = 0; py < rH; py++) {
      for (let px = 0; px < rW; px++) {
        const dx = px - rCx;
        const dy = py - rCy;
        const d2 = dx * dx + dy * dy;
        if (d2 > rR2) continue;

        const dz = Math.sqrt(rR2 - d2);
        // Normalize to unit sphere
        const nx = dx / rR;
        const ny = -dy / rR;
        const nz = dz / rR;

        // Apply inverse rotation (yaw then pitch)
        const cosY = Math.cos(-yaw), sinY = Math.sin(-yaw);
        const rx = nx * cosY + nz * sinY;
        const rz2 = -nx * sinY + nz * cosY;
        const cosP = Math.cos(-pitch), sinP = Math.sin(-pitch);
        const ry = ny * cosP - rz2 * sinP;
        const rz = ny * sinP + rz2 * cosP;

        // Spherical to UV (equirectangular)
        const u = Math.atan2(rx, rz) / (2 * Math.PI) + 0.5;
        const v = Math.asin(Math.max(-1, Math.min(1, ry))) / Math.PI + 0.5;

        // Sample texture
        let sx = Math.floor(u * srcW);
        const sy = Math.floor((1 - v) * srcH);
        if (sx < 0) sx += srcW;
        if (sx >= srcW) sx -= srcW;
        const si = (Math.min(sy, srcH - 1) * srcW + sx) * 4;

        // Diffuse lighting
        const lightDir = { x: 0.3, y: 0.5, z: 0.8 };
        const len = Math.sqrt(lightDir.x ** 2 + lightDir.y ** 2 + lightDir.z ** 2);
        const lx = lightDir.x / len, ly = lightDir.y / len, lz = lightDir.z / len;
        const diffuse = Math.max(0.15, nx * lx + ny * ly + nz * lz);

        const idx = (py * rW + px) * 4;
        out[idx] = Math.min(255, Math.round(src[si] * diffuse));
        out[idx + 1] = Math.min(255, Math.round(src[si + 1] * diffuse));
        out[idx + 2] = Math.min(255, Math.round(src[si + 2] * diffuse));
        out[idx + 3] = 255;
      }
    }

    // Draw low-res to offscreen, then scale up
    const offCanvas = document.createElement('canvas');
    offCanvas.width = rW;
    offCanvas.height = rH;
    const offCtx = offCanvas.getContext('2d');
    if (offCtx) offCtx.putImageData(outImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offCanvas, 0, 0, rW, rH, 0, 0, W, H);

    // Gold grid lines
    ctx.strokeStyle = 'rgba(212,175,55,0.15)';
    ctx.lineWidth = 1;
    // Equator
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * Math.abs(Math.cos(pitch)) * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Meridian
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * Math.abs(Math.cos(yaw)) * 0.3, R, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Camera indicator dot
    const dotX = cx + Math.sin(yaw) * R * 0.85;
    const dotY = cy - Math.sin(pitch) * R * 0.6;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#d4af37';
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,55,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 10, 0, Math.PI * 2);
    ctx.stroke();

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, R + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(212,175,55,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

  }, [imageUrl, rotation, tilt, zoom, isMonochrome]);

  return (
    <div className="w-full h-full flex items-center justify-center relative">
      <canvas
        ref={canvasRef}
        width={260}
        height={196}
        className="rounded-xl"
        style={{ width: '100%', height: '100%' }}
      />
      <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs ${isMonochrome ? 'bg-white/80 text-gray-500 border border-gray-200' : 'bg-black/60 text-muted-foreground border border-white/10'}`}>
        {Math.abs(rotation) < 10 && Math.abs(tilt) < 10 ? '正面' :
         rotation > 60 ? '左侧' : rotation < -60 ? '右侧' :
         tilt > 25 ? '仰视' : tilt < -25 ? '俯视' : '斜视'}
      </div>
    </div>
  );
}

export interface ImageGroup {
  id: string;
  name: string;
  note: string;
  imageIds: string[];
  x: number;
  y: number;
  collapsed: boolean;
}

export interface CanvasImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
  marked?: boolean;
  prompt?: string;
  modifyPrompt?: string;
  model?: string;
  quality?: string;
  aspectRatio?: string;
  stylePreset?: string;
  category?: string;
  size?: string;
  createdAt?: number;
  sourceUrl?: string;
  isProcessingPlaceholder?: boolean;
  groupId?: string;
  processing?: {
    label: string;
    status: string;
    progress: number;
    taskId?: string;
    sourceUrl?: string;
    error?: string;
    startTime?: number; // 生图开始时间戳(ms)，用于显示已用时间
  };
  threeDModelUrl?: string;
  svgDataUrl?: string; // 保存SVG数据用于下载（画布显示PNG预览时）
  svgUrl?: string; // SVG服务器文件URL（轻量级，用于下载矢量图，避免存储超大svgDataUrl）
  threeDModelUrls?: Record<string, string>;
  threeDThumbnailUrls?: Record<string, string>;
  threeDTextureUrls?: Array<Record<string, string>>;
  threeDModelInfo?: { faceCount?: number; vertexCount?: number; fileSize?: string; providerId?: string; providerName?: string; model3DName?: string; modelTaskId?: string };
  negativePrompt?: string;
  modelName?: string;
  /** ID of the source image that this image was generated from (for SVG connection lines) */
  generatedFromImageId?: string;
  apiProvider?: string;
  apiBaseUrl?: string;
  thumbnailUrl?: string; // 缩略图URL，用于画布渲染（4K图片性能优化）
  // 视频媒体扩展
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  videoDuration?: number;
  videoThumbnailUrl?: string;
  // 图层面板扩展字段
  /** 图层是否可见（默认true） */
  visible?: boolean;
  /** 图层是否锁定（默认false，锁定后不可移动/编辑） */
  locked?: boolean;
  /** 图层名称（用户自定义或自动生成） */
  name?: string;
  /** 图层堆叠顺序（默认0，数值越大越在上层） */
  zIndex?: number;
}

type JsonRecord = Record<string, unknown>;

interface GroupGenerationResponse {
  error?: string;
  mode?: string;
  imageUrls: string[];
  taskIds: string[];
  estimatedTime?: number;
  modelName?: string;
  providerName?: string;
}

interface ImageEditResponse {
  success?: boolean;
  error?: unknown;
  imageUrl?: string;
  taskId?: string;
  engine?: string;
  cropInfo?: unknown;
  compositeInfo?: unknown;
  targetWidth?: number;
  targetHeight?: number;
}

function asJsonRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function getJsonString(record: JsonRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getJsonNumber(record: JsonRecord | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseGroupGenerationResponse(value: unknown): GroupGenerationResponse {
  const record = asJsonRecord(value);
  return {
    error: getJsonString(record, 'error'),
    mode: getJsonString(record, 'mode'),
    imageUrls: Array.isArray(record?.imageUrls)
      ? record.imageUrls.filter((url): url is string => typeof url === 'string')
      : [],
    taskIds: Array.isArray(record?.taskIds)
      ? record.taskIds.filter((taskId): taskId is string => typeof taskId === 'string')
      : [],
    estimatedTime: getJsonNumber(record, 'estimatedTime'),
    modelName: getJsonString(record, 'modelName'),
    providerName: getJsonString(record, 'providerName'),
  };
}

function parseImageEditResponse(value: unknown): ImageEditResponse {
  const record = asJsonRecord(value);
  return {
    success: typeof record?.success === 'boolean' ? record.success : undefined,
    error: record?.error,
    imageUrl: getJsonString(record, 'imageUrl'),
    taskId: getJsonString(record, 'taskId'),
    engine: getJsonString(record, 'engine'),
    cropInfo: record?.cropInfo,
    compositeInfo: record?.compositeInfo,
    targetWidth: getJsonNumber(record, 'targetWidth'),
    targetHeight: getJsonNumber(record, 'targetHeight'),
  };
}

interface InfiniteCanvasProps {
  images: CanvasImage[];
  onImagesChange: (images: CanvasImage[]) => void;
  selectedImage: CanvasImage | null;
  onSelectImage: (image: CanvasImage | null) => void;
  onPreviewImage: (image: CanvasImage) => void;
  onGenerateVariation: (image: CanvasImage) => void;
  onExtractKeywords: (image: CanvasImage) => void;
  onFusion: (images: CanvasImage[]) => void;
  onAddImages: (imageUrls: string[], sourceImageId?: string, meta?: { modelName?: string; apiProvider?: string }) => void;
  onReferenceSelect?: (image: CanvasImage) => void;
  referenceIds?: string[];
  isGenerating?: boolean;
  generationProgress?: { current: number; total: number } | undefined;
  themeStyle?: string;
  onVisionPrompt?: (imageUrl: string) => void;
  visionPromptEnabled?: boolean;
  onToggleVisionPrompt?: () => void;
  ohMyPromptOpen?: boolean;
  onCloseOhMyPrompt?: () => void;
  onToggleOhMyPrompt?: () => void;
  onInsertPrompt?: (prompt: string) => void;
  ohMyPromptThemeStyle?: 'gold' | 'default';
  isVisionAnalyzing?: boolean;
  visionResult?: import('@/components/oh-my-prompt').VisionApiResultData | null;
  ompActiveTab?: 'vision' | 'agent';
  ompVisionImageUrl?: string | null;
  onToggleSettings?: () => void;
  onToggleTheme?: () => void;
  onToggleUserManager?: () => void;
  onToggleAdminSystem?: () => void;
  onToggleProjectData?: () => void;
  isAdmin?: boolean;
  onToggleHelp?: () => void;
  isPanelCollapsed?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  navigateToImageId?: string | null;
  onNavigateToImageComplete?: () => void;
  onGroupsChange?: (groups: ImageGroup[]) => void;
  initialGroups?: ImageGroup[];
  /** Called when Alt+Click marks an image as reference with number */
  onAltMarkReference?: (image: CanvasImage) => void;
  /** IDs of images currently marked as Alt references */
  altRefMarkerIds?: string[];
  /** Force save canvas data to localStorage + server */
  onForceSave?: () => void;
  /** 用户绘制的连线 */
  connections?: CanvasConnection[];
  /** 连线变更回调 */
  onConnectionsChange?: (connections: CanvasConnection[]) => void;
  /** Called when user wants to open the language-based image editor (null = open empty) */
  onEditImage?: (image: CanvasImage | null) => void;
  /** Called when view state (offset/zoom) changes for persistence */
  onViewStateChange?: (state: { offsetX: number; offsetY: number; zoom: number }) => void;
  /** Initial view state to restore from persistence */
  initialViewState?: { offsetX: number; offsetY: number; zoom: number };
  /** Callback when user adds image to favorites */
  onAddToFavorites?: (image: CanvasImage) => void;
  /** Callback to open favorites panel */
  onToggleFavorites?: () => void;
  /** Callback to open prompt template panel */
  onTogglePromptTemplate?: () => void;
  /** Callback to open Logo Generator Skill panel (legacy, now uses internal state) */
  /** Brand project info for Logo Generator panel */
  brandProject?: { id?: string; brandName?: string; description?: string; targetAudience?: string; tone?: string; brandDna?: { mainColors?: string[]; secondaryColors?: string[]; fontStyle?: string } | null } | null;
  /** Switch to node editor mode */
  onSwitchToNodeMode?: () => void;
  /** Switch to workflow hub */
  onSwitchToWorkflowHub?: () => void;
  /** Switch to dashboard (workspace) */
  onSwitchToDashboard?: () => void;
  /** Send canvas image to chat panel for AI modification */
  onSendToChat?: (image: CanvasImage) => void;
  /** 树状版本历史管理器（P1功能） */
  versionHistoryManager?: import('@/lib/canvas-tree-history').TreeHistoryManager;
  /** Open floating video generation panel */
  onOpenVideoPanel?: () => void;
}

type EditMode = 'none' | 'erase' | 'mask' | 'expand' | 'crop' | 'upscale' | 'colorAdjust' | 'panorama';
type ActiveTool = 'none' | 'upscale' | 'download' | 'multiAngle' | 'to3d' | 'colorAdjust' | 'panorama';
type MultiAngleMode = 'image' | 'camera';
type ThreeDBackend = 'api' | 'local';
type ThreeDType = 'ip' | 'figure' | 'product' | 'character';

/** 前端兜底：将纯英文 API 错误翻译为中文友好提示 */
function translateErrorFrontend(msg: string): string {
  if (!msg) return '操作失败，请重试';
  const lower = msg.toLowerCase();

  // ★ Cloudflare 超时专用检测 (524/504)
  if (lower.includes('524') || lower.includes('a timeout occurred') || lower.includes('origin_gateway_timeout')) {
    return '网络网关超时 (524)，服务器处理时间过长。建议：1) 切换其他模型重试 2) 稍后再试';
  }
  if (lower.includes('504') || lower.includes('gateway time-out') || lower.includes('gateway timeout')) {
    return '网络网关超时 (504)，服务器未及时响应。建议：1) 切换其他模型重试 2) 稍后再试';
  }
  if (lower.includes('503') || lower.includes('service unavailable') || lower.includes('service temporarily unavailable')) {
    return '服务暂时不可用 (503)，请稍后重试或切换其他模型';
  }
  if (lower.includes('502') || lower.includes('bad gateway')) {
    return '网关错误 (502)，上游服务异常。请稍后重试';
  }

  // ★ 内容审核拦截
  if (lower.includes('moderation_blocked') || lower.includes('content_policy_violation') || lower.includes('content policy')) {
    return '内容审核拦截：生成内容违反了安全策略。请修改提示词后重试（避免涉及版权角色、公众人物等）';
  }

  // ★ 限速与余额
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return '请求过于频繁，请稍后再试';
  }
  if (lower.includes('insufficient_quota') || lower.includes('billing_hard_limit') || lower.includes('insufficient balance') || lower.includes('insufficient')) {
    return 'API 余额不足，请联系管理员充值';
  }

  // ★ API Key 问题
  if (lower.includes('invalid_api_key') || lower.includes('incorrect_api_key') || lower.includes('invalid api key')) {
    return 'API Key 无效或已过期，请联系管理员更新';
  }

  // ★ 模型问题
  if (lower.includes('model not found')) {
    return '模型不存在或已下线，请尝试切换其他模型';
  }

  // ★ 尺寸无效
  if (lower.includes('invalid size') || lower.includes('must be divisible by 16')) {
    return '图片尺寸不符合模型要求，请尝试切换画面比例后重试';
  }

  // ★ 超时
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return '请求超时，请稍后重试或切换其他模型';
  }

  // ★ 部分结果
  if (lower.includes('partial') && lower.includes('image')) {
    return '生成中断，仅获取到部分结果。请重试以获取完整图片';
  }

  if (lower.includes('try again later') || lower.includes('please wait')) {
    return '当前模型暂时不可用，请稍后重试或切换其他模型';
  }
  // 纯英文兜底
  if (/^[a-zA-Z]/.test(msg) && !/[\u4e00-\u9fff]/.test(msg)) {
    return `API 返回错误: ${msg.replace(/\s*\(request id:.*?\)\s*/i, '').trim()}`;
  }
  return msg;
}

// ★ 生图计时器组件：显示已用时间（秒），每秒更新
function ElapsedTime({ startTime, className }: { startTime: number; className?: string }) {
  const [elapsed, setElapsed] = useState(() => Math.round((Date.now() - startTime) / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const formatted = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;

  return <span className={className}>{formatted}</span>;
}

export function InfiniteCanvas({ images, onImagesChange, selectedImage, onSelectImage, onGenerateVariation, onExtractKeywords, onAddImages, referenceIds = [], isGenerating = false, generationProgress = undefined, themeStyle = 'gold', onVisionPrompt, visionPromptEnabled = false, onToggleVisionPrompt, ohMyPromptOpen = false, onCloseOhMyPrompt, onInsertPrompt, ohMyPromptThemeStyle = 'gold', isVisionAnalyzing = false, visionResult = null, ompActiveTab = 'agent', ompVisionImageUrl = null, onToggleSettings, onToggleTheme, onToggleUserManager, onToggleAdminSystem, onToggleProjectData, isAdmin = false, onToggleHelp, onUndo, onRedo, navigateToImageId, onNavigateToImageComplete, onGroupsChange, initialGroups, altRefMarkerIds = [], onForceSave, onEditImage, onViewStateChange, initialViewState, onAddToFavorites, onToggleFavorites, onTogglePromptTemplate, onSwitchToNodeMode, onSwitchToWorkflowHub, onSwitchToDashboard, onSendToChat, connections, onConnectionsChange, versionHistoryManager, onOpenVideoPanel }: InfiniteCanvasProps) {
  const isMonochrome = themeStyle === 'monochrome';

  // Stable refs for callbacks used in effects (avoid stale closures)
  const onSelectImageRef = useRef(onSelectImage);
  onSelectImageRef.current = onSelectImage;
  const onNavigateToImageCompleteRef = useRef(onNavigateToImageComplete);
  onNavigateToImageCompleteRef.current = onNavigateToImageComplete;
  // Ref for connections to avoid stale closure in completeProcessingFrame
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const onConnectionsChangeRef = useRef(onConnectionsChange);
  onConnectionsChangeRef.current = onConnectionsChange;

  // Resize preview: stores live dimensions during resize, applied to images only on mouseup
  const [resizePreview, setResizePreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Canvas grid background mode: dots / lines / blank
  const [gridMode, setGridMode] = useState<'dots' | 'lines' | 'blank'>('dots');
  const [showConnections, setShowConnections] = useState(false);

  // Hover toolbar: shown when hovering over an image (separate from visionHoverImage)
  const [hoverToolbarImageId, setHoverToolbarImageId] = useState<string | null>(null);
  const hoverToolbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepHoverToolbar = useCallback((imageId: string) => {
    if (hoverToolbarTimerRef.current) clearTimeout(hoverToolbarTimerRef.current);
    setHoverToolbarImageId(imageId);
  }, []);
  const hideHoverToolbar = useCallback(() => {
    hoverToolbarTimerRef.current = setTimeout(() => setHoverToolbarImageId(null), 300);
  }, []);

  /** 对比模式：选中第一张图后点击第二张进行叠加滑块对比 */
  const [compareFirstImageId, ] = useState<string | null>(null);
  void compareFirstImageId;
  const [, ] = useState(false);
  const [, ] = useState(50); // 百分比 0-100
  useRef(false);

  // Agent editor state
  const [showAgentEditor, setShowAgentEditor] = useState(false);
  const [agentEditImage, setAgentEditImage] = useState<CanvasImage | null>(null);

  // Brand e-commerce state
  const [showBrandEcommerce, setShowBrandEcommerce] = useState(false);

  // SVG trace panel state (independent of editMode, like img2img)
  const [showSvgTracePanel, setShowSvgTracePanel] = useState(false);

  // Refine engine state
  const [showRefineEngine, setShowRefineEngine] = useState(false);
  const [refineEngineImageUrl, setRefineEngineImageUrl] = useState<string>('');
  const [agentSelectingImage, setAgentSelectingImage] = useState(false);

  // Font design state
  const [showFontDesign, setShowFontDesign] = useState(false);
  const [showBrandFactory, setShowBrandFactory] = useState(false);
  const [showLogoSkill, setShowLogoSkill] = useState(false);
  const [logoSkillBrandProject, setLogoSkillBrandProject] = useState<{ id: string; brandName: string } | null>(null);
  const [showAiPsd, setShowAiPsd] = useState(false);
  const [showStickerAssistant, setShowStickerAssistant] = useState(false);
  const [showSceneStudio, setShowSceneStudio] = useState(false);
  const [pendingSceneStudioModel, setPendingSceneStudioModel] = useState<{url: string; name: string} | null>(null);
  const [showBrandPackaging, setShowBrandPackaging] = useState(false);
  const [showDisplay3D, setShowDisplay3D] = useState(false);

  // Image compare state
  const [showCompareDialog, setShowCompareDialog] = useState(false);
  const [compareImages, setCompareImages] = useState<{ left: CanvasImage | null; right: CanvasImage | null }>({ left: null, right: null });
  const [compareSelecting, setCompareSelecting] = useState(false); // selecting second image for compare

  // Layer panel state (P1: 专业用户刚需)
  const [showLayerPanel, setShowLayerPanel] = useState(false);

  // Version history panel state (P1: 树状版本历史)
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // View state
  const [viewOffset, setViewOffset] = useState({ x: initialViewState?.offsetX ?? 0, y: initialViewState?.offsetY ?? 0 });
  const [zoom, setZoom] = useState(initialViewState?.zoom ?? 1);
  const [isPanning, setIsPanning] = useState(false);
  const [isMiddlePanning, setIsMiddlePanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Persist view state changes (debounced)
  const viewStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!onViewStateChange) return;
    if (viewStateTimerRef.current) clearTimeout(viewStateTimerRef.current);
    viewStateTimerRef.current = setTimeout(() => {
      onViewStateChange({ offsetX: viewOffset.x, offsetY: viewOffset.y, zoom });
    }, 500);
    return () => { if (viewStateTimerRef.current) clearTimeout(viewStateTimerRef.current); };
  }, [viewOffset, zoom, onViewStateChange]);

  // Virtualization: viewport culling — only render images in the visible area
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasTransformRef = useRef<HTMLDivElement | null>(null);
  const panRafRef = useRef<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ★ SSE连接：实时任务事件，加速轮询感知
  useEffect(() => {
    taskEventsClient.connect();
    return () => { taskEventsClient.disconnect(); };
  }, []);

  // ★ Spatial Index: RBush R-tree for O(log n) hit testing and viewport culling
  const spatialIndexRef = useRef<import('@/lib/canvas-spatial-index').CanvasSpatialIndex | null>(null);
  if (!spatialIndexRef.current) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    spatialIndexRef.current = new (require('@/lib/canvas-spatial-index').CanvasSpatialIndex)();
  }

  const visibleImages = useMemo(() => {
    if (canvasSize.width === 0 || canvasSize.height === 0) return images;
    if (shouldSuspendCanvasVirtualization(isPanning, isMiddlePanning)) return images;
    // Visible area in canvas coordinates
    const vx1 = -viewOffset.x / zoom;
    const vy1 = -viewOffset.y / zoom;
    const vx2 = vx1 + canvasSize.width / zoom;
    const vy2 = vy1 + canvasSize.height / zoom;

    // ★ Use spatial index for viewport culling when image count is large enough to benefit
    if (images.length > 20 && spatialIndexRef.current) {
      const visibleIds = new Set(spatialIndexRef.current.viewportQuery(vx1, vy1, vx2, vy2, 0.5));
      return images.filter(img => img.isProcessingPlaceholder || visibleIds.has(img.id));
    }

    // Fallback: linear scan for small image sets
    const marginW = (vx2 - vx1) * 0.5;
    const marginH = (vy2 - vy1) * 0.5;
    return images.filter(img => {
      if (img.isProcessingPlaceholder) return true;
      const ix1 = img.x;
      const iy1 = img.y;
      const ix2 = img.x + img.width;
      const iy2 = img.y + img.height;
      return ix2 >= vx1 - marginW && ix1 <= vx2 + marginW && iy2 >= vy1 - marginH && iy1 <= vy2 + marginH;
    });
  }, [images, viewOffset, zoom, canvasSize, isPanning, isMiddlePanning]);

  // ★ Keep spatial index in sync with images
  useEffect(() => {
    if (spatialIndexRef.current) {
      spatialIndexRef.current.rebuild(images);
    }
  }, [images]);

  // Track total vs visible for debugging
  useMemo(() => ({ total: images.length, visible: visibleImages.length }), [images.length, visibleImages.length]);

  // ★ 缩略图生成：为大图（>1024px）生成客户端缩略图，减少4K图片解码开销
  const thumbnailCacheRef = useRef<Map<string, string>>(new Map()); // imageUrl → thumbnailDataUrl
  const THUMBNAIL_MAX = 1280; // 缩略图最大边长（800→1280，确保放大查看时仍清晰）
  const ORIG_THRESHOLD = 1200; // 原图超过此尺寸才生成缩略图
  const thumbnailGenInProgressRef = useRef<Set<string>>(new Set());
  const [thumbnailVersion, setThumbnailVersion] = useState(0); // 触发重渲染
  const thumbnailRafRef = useRef<number | null>(null); // RAF 批量更新

  useEffect(() => {
    let cancelled = false;

    for (const img of images) {
      if (img.isProcessingPlaceholder || !img.url || img.url.startsWith('data:') || img.thumbnailUrl) continue;
      // 仅对大图生成缩略图
      const origW = img.originalWidth || img.width;
      const origH = img.originalHeight || img.height;
      if (origW <= ORIG_THRESHOLD && origH <= ORIG_THRESHOLD) continue;
      // 已有缓存
      if (thumbnailCacheRef.current.has(img.url)) continue;
      // 正在生成
      if (thumbnailGenInProgressRef.current.has(img.url)) continue;

      thumbnailGenInProgressRef.current.add(img.url);

      // 异步生成缩略图
      const generateThumbnail = async (imageUrl: string) => {
        try {
          const imageEl = new window.Image();
          imageEl.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            imageEl.onload = () => resolve();
            imageEl.onerror = () => reject(new Error('Failed to load image for thumbnail'));
            imageEl.src = imageUrl;
          });
          if (cancelled) return;

          const w = imageEl.naturalWidth;
          const h = imageEl.naturalHeight;
          if (w <= ORIG_THRESHOLD && h <= ORIG_THRESHOLD) return;

          const scale = Math.min(1, THUMBNAIL_MAX / Math.max(w, h));
          const tw = Math.round(w * scale);
          const th = Math.round(h * scale);

          const canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(imageEl, 0, 0, tw, th);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          thumbnailCacheRef.current.set(imageUrl, dataUrl);
          // 使用 RAF 批量触发重渲染，避免每张缩略图都触发一次 setState
          if (thumbnailRafRef.current === null) {
            thumbnailRafRef.current = requestAnimationFrame(() => {
              thumbnailRafRef.current = null;
              setThumbnailVersion(v => v + 1);
            });
          }
        } catch {
          // 缩略图生成失败不影响原图显示
        } finally {
          thumbnailGenInProgressRef.current.delete(imageUrl);
        }
      };

      generateThumbnail(img.url);
    }

    return () => { cancelled = true; };
  }, [images]);

  // 为 visibleImages 附加 thumbnailUrl
  const visibleImagesWithThumbnails = useMemo(() => {
    // thumbnailVersion 作为依赖确保缓存更新后重新计算
    void thumbnailVersion;
    return visibleImages.map(img => {
      if (img.thumbnailUrl) return img;
      const cached = thumbnailCacheRef.current.get(img.url);
      if (cached) return { ...img, thumbnailUrl: cached };
      return img;
    });
  }, [visibleImages, thumbnailVersion]);

  // ★ 清理已移除图片的缩略图缓存，避免内存泄漏
  useEffect(() => {
    const currentUrls = new Set(images.map(img => img.url));
    for (const key of thumbnailCacheRef.current.keys()) {
      if (!currentUrls.has(key)) {
        thumbnailCacheRef.current.delete(key);
      }
    }
    // 组件卸载时取消未执行的 RAF
    return () => {
      if (thumbnailRafRef.current !== null) {
        cancelAnimationFrame(thumbnailRafRef.current);
        thumbnailRafRef.current = null;
      }
    };
  }, [images]);

  // ★ 远程 URL 后台持久化监听：当远程图片持久化为本地 URL 后，更新画布图片
  // Use imagesRef to avoid stale closure over images
  useEffect(() => {
    const unsubscribe = onPersistComplete((originalUrl: string, localUrl: string) => {
      const currentImages = imagesRef.current;
      let changed = false;
      const updated = currentImages.map(img => {
        // 更新匹配的 url（缩略图）或 videoUrl（视频播放地址）
        if (img.url === originalUrl) {
          changed = true;
          return { ...img, url: localUrl };
        }
        if (img.videoUrl === originalUrl) {
          changed = true;
          return { ...img, videoUrl: localUrl };
        }
        return img;
      });
      if (changed) onImagesChange(updated);
    });
    return unsubscribe;
  }, [onImagesChange]);

  // ★ 自动持久化远程视频 URL：视频的第三方预签名链接通常1~24小时过期
  // 检测画布上的远程视频 URL，触发后台持久化保存到本地服务器
  const videoPersistAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const remoteVideos = images.filter(img =>
      img.mediaType === 'video' &&
      img.videoUrl &&
      /^https?:\/\//i.test(img.videoUrl) &&
      !videoPersistAttemptedRef.current.has(img.id)
    );
    if (remoteVideos.length === 0) return;

    for (const img of remoteVideos) {
      videoPersistAttemptedRef.current.add(img.id);
    }

    // 触发后台持久化（不阻塞渲染）
    for (const img of remoteVideos) {
      if (img.videoUrl) {
        persistVideoUrlInBackground(img.videoUrl);
      }
      // 缩略图如果是远程URL也持久化
      if (img.url && /^https?:\/\//i.test(img.url)) {
        persistRemoteUrlInBackground(img.url, false);
      }
    }
  }, [images]);

  // ★ 自动回填 originalWidth/originalHeight：当图片缺少真实尺寸时，异步加载并补全
  const sizeFillAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const imagesNeedingSize = images.filter(img => !img.originalWidth || !img.originalHeight);
    // 跳过已尝试过但失败的图片，避免无限重试
    const untried = imagesNeedingSize.filter(img => !sizeFillAttemptedRef.current.has(img.id));
    if (untried.length === 0) return;

    // 标记这些图片为已尝试
    for (const img of untried) {
      sizeFillAttemptedRef.current.add(img.id);
    }

    let cancelled = false;
    const updates = new Map<string, { originalWidth: number; originalHeight: number }>();

    Promise.all(untried.map(img => {
      return new Promise<void>((resolve) => {
        const imageEl = new window.Image();
        imageEl.onload = () => {
          if (!cancelled && imageEl.naturalWidth && imageEl.naturalHeight) {
            updates.set(img.id, { originalWidth: imageEl.naturalWidth, originalHeight: imageEl.naturalHeight });
          }
          // poll-task returns image URL in multiple formats:resolve();
        };
        imageEl.onerror = () => resolve();
        imageEl.src = img.url;
      });
    })).then(() => {
      if (cancelled || updates.size === 0) return;
      const currentImages = imagesRef.current;
      let changed = false;
      const updated = currentImages.map(img => {
        const sizeUpdate = updates.get(img.id);
        if (sizeUpdate) {
          changed = true;
          return { ...img, ...sizeUpdate };
        }
        return img;
      });
      if (changed) {
        onImagesChange(updated);
      }
    });

    return () => { cancelled = true; };
  }, [images, onImagesChange]);

  // Navigate to image when navigateToImageId changes
  useEffect(() => {
    if (!navigateToImageId) return;
    const targetImg = images.find(img => img.id === navigateToImageId);
    if (!targetImg) return;
    // Calculate center position of the target image
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const canvasW = canvasEl.clientWidth;
    const canvasH = canvasEl.clientHeight;
    const imgCenterX = targetImg.x + targetImg.width / 2;
    const imgCenterY = targetImg.y + targetImg.height / 2;
    // Set zoom to 1 and offset to center the image
    setZoom(1);
    setViewOffset({
      x: canvasW / 2 - imgCenterX,
      y: canvasH / 2 - imgCenterY,
    });
    // Select the image
    onSelectImageRef.current(targetImg);
    // Notify parent that navigation is complete
    onNavigateToImageCompleteRef.current?.();
  }, [images, navigateToImageId]);

  // Auto-center view on newly added images (upload / generate / paste)
  const prevImageCountRef = useRef(images.length);
  const prevImageIdsRef = useRef<Set<string>>(new Set(images.map(img => img.id)));
  useEffect(() => {
    const currentIds = new Set(images.map(img => img.id));
    const newImages = images.filter(img => !prevImageIdsRef.current.has(img.id));

    if (newImages.length > 0) {
      // Center on the first new image (most recent addition)
      const targetImg = newImages[0];
      const canvasEl = canvasRef.current;
      if (canvasEl) {
        const canvasW = canvasEl.clientWidth;
        const canvasH = canvasEl.clientHeight;
        const imgCenterX = targetImg.x + targetImg.width / 2;
        const imgCenterY = targetImg.y + targetImg.height / 2;

        // Calculate zoom to fit the image nicely (show image at ~80% of viewport)
        const fitZoomX = (canvasW * 0.8) / targetImg.width;
        const fitZoomY = (canvasH * 0.8) / targetImg.height;
        const fitZoom = Math.min(fitZoomX, fitZoomY, 2); // Cap at 2x zoom

        // Keep current zoom if it shows the image well, otherwise use fitZoom
        const currentZoom = zoom;
        const imgScreenWidth = targetImg.width * currentZoom;
        const imgScreenHeight = targetImg.height * currentZoom;
        const isVisible = imgScreenWidth > 30 && imgScreenHeight > 30 && imgScreenWidth < canvasW * 3 && imgScreenHeight < canvasH * 3;
        const newZoom = isVisible ? currentZoom : fitZoom;

        setZoom(newZoom);
        setViewOffset({
          x: canvasW / 2 - imgCenterX * newZoom,
          y: canvasH / 2 - imgCenterY * newZoom,
        });

        // Select the first new image
        setSelectedIds(new Set([targetImg.id]));
        onSelectImageRef.current(targetImg);
      }
    }

    prevImageIdsRef.current = currentIds;
    prevImageCountRef.current = images.length;
  }, [images, zoom]);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<ImageGroup[]>(initialGroups || []);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupEditName, setGroupEditName] = useState('');
  const [groupEditNote, setGroupEditNote] = useState('');
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  // Refs for RAF-throttled drag updates to avoid excessive re-renders
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragRafRef = useRef<number | null>(null);
  const snapGuidesRef = useRef<SnapGuide[]>([]);
  const hoveredGenGroupIdRef = useRef<string | null>(null);

  // Group drag state
  const [groupDragTarget, setGroupDragTarget] = useState<string | null>(null);
  const [groupDragStart, setGroupDragStart] = useState({ x: 0, y: 0 });
  const [groupDragOffset, setGroupDragOffset] = useState({ x: 0, y: 0 });
  const groupDragReadyRef = useRef(false);
  const groupDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeRefFromGroupRef = useRef<(groupId: string, imageId: string) => void>(() => {});
  const exitEditModeRef = useRef<() => void>(() => {});

  // 同步groups到父组件
  useEffect(() => {
    onGroupsChange?.(groups);
  }, [groups, onGroupsChange]);

  // ★ 组件卸载时：不做 abort（轮询仍在后台继续，结果通过 setImages 持久化到父级状态）
  // 切换回画布模式时，InfiniteCanvas 重新挂载即可看到已完成的结果

  // 当 initialGroups 从外部变化时同步更新 groups（项目切换、页面刷新加载）
  const prevInitialGroupsRef = useRef<string>('');
  useEffect(() => {
    const key = initialGroups ? JSON.stringify(initialGroups) : '__empty__';
    if (key !== prevInitialGroupsRef.current) {
      prevInitialGroupsRef.current = key;
      setGroups(initialGroups || []);
    }
  }, [initialGroups]);

  // Resize
  const [resizingImage, setResizingImage] = useState<string | null>(null);
  const [resizeCorner, setResizeCorner] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0, imgX: 0, imgY: 0 });

  // Box select
  const [boxSelectStart, setBoxSelectStart] = useState<{ x: number; y: number } | null>(null);
  const [boxSelectEnd, setBoxSelectEnd] = useState<{ x: number; y: number } | null>(null);

  // Middle button pan state
  const middlePanStartRef = useRef({ x: 0, y: 0 });
  const middlePanMovedRef = useRef(false); // 中键拖动是否移动过（防止拖动后误触发 auxclick 缩放重置）

  // Long press for drag
  const [, setIsLongPressing] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseDownPosRef = useRef({ x: 0, y: 0 });
  const mouseDownOnImageRef = useRef(false);
  const imageDragReadyRef = useRef(false);

  // Ctrl key tracking for reference selection hint
  const [ctrlKeyHeld, setCtrlKeyHeld] = useState(false);
  // Alt key tracking for reference marking hint
  const [altKeyHeld, setAltKeyHeld] = useState(false);

  // Canvas-embedded image generator state
  const [showCanvasGenerator, setShowCanvasGenerator] = useState(false);
  const [canvasGenFrameId, setCanvasGenFrameId] = useState<string | null>(null);
  const [canvasGenPrompt, setCanvasGenPrompt] = useState('');
  const [canvasGenNegativePrompt, setCanvasGenNegativePrompt] = useState('');
  const [canvasGenModel, setCanvasGenModel] = useState('');
  const [canvasGenAspectRatio, setCanvasGenAspectRatio] = useState('16:9');
  const [canvasGenResolution, setCanvasGenResolution] = useState('2K'); // 分辨率档位（1K/2K/4K）
  const [canvasGenQuality, setCanvasGenQuality] = useState('auto'); // 质量级别（auto/low/medium/high/standard）
  const [canvasGenCount, setCanvasGenCount] = useState(1);
  const [canvasGenPartialFailCount, setCanvasGenPartialFailCount] = useState(0); // B3: 部分失败计数
  const [canvasGenRefImages, setCanvasGenRefImages] = useState<string[]>([]);
  const [canvasGenModels, setCanvasGenModels] = useState<{id: string, providerId: string, providerName: string, apiDisplayName?: string}[]>([]);
  // 模型ID → 提供商名称 映射（用于历史图片 apiProvider 回填）
  const modelProviderMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of canvasGenModels) {
      if (m.providerName) {
        // 复合键映射（providerId::modelId）始终写入，保证精确匹配
        if (m.providerId) {
          map.set(`${m.providerId}::${m.id}`, m.providerName);
          // 也映射纯 providerId → providerName（某些图片的 apiProvider 存的是 providerId）
          if (!map.has(m.providerId)) map.set(m.providerId, m.providerName);
        }
        // 纯 modelId 映射仅首次写入，避免多提供商同名模型时后者覆盖前者
        if (!map.has(m.id)) map.set(m.id, m.providerName);
      }
    }
    return map;
  }, [canvasGenModels]);
  const [canvasGenGenerating, setCanvasGenGenerating] = useState(false);
  const [canvasGenPreviewUrl, setCanvasGenPreviewUrl] = useState<string | null>(null);
  const [canvasGenProgress, setCanvasGenProgress] = useState(0);
  const [, setCanvasGenFramePos] = useState<{x: number, y: number}>({ x: 0, y: 0 });
  const canvasGenFrameWidth = 512;
  const canvasGenFrameHeight = 288; // 16:9 ratio
  // 浮动面板拖拽状态
  const [canvasGenPanelPos, setCanvasGenPanelPos] = useState({ x: 60, y: 60 });
  const [canvasGenDragging, setCanvasGenDragging] = useState(false);
  const [canvasGenDragOffset, setCanvasGenDragOffset] = useState({ x: 0, y: 0 });
  const [canvasGenMinimized, setCanvasGenMinimized] = useState(false);
  const [visionHoverImage, setVisionHoverImage] = useState<CanvasImage | null>(null);
  const [showRefFusion, setShowRefFusion] = useState(false);

  // Context menu
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [showContextMenu, setShowContextMenu] = useState(false);

  // Canvas context menu
  const [canvasMenuPos, setCanvasMenuPos] = useState({ x: 0, y: 0 });
  const [showCanvasMenu, setShowCanvasMenu] = useState(false);

  // Edit mode
  const [editMode, setEditMode] = useState<EditMode>('none');
  const [editImageId, setEditImageId] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(20);
  const [editPrompt, setEditPrompt] = useState('');
  const [, setExpandRatio] = useState('原始比例');
  const [, ] = useState(false);
  // 参数调色状态
  const [, ] = useState({ brightness: 0, contrast: 0, saturation: 0, temperature: 0, hue: 0 });
  const [colorBrightness, setColorBrightness] = useState(0);
  const [colorContrast, setColorContrast] = useState(0);
  const [colorSaturation, setColorSaturation] = useState(0);
  const [colorTemperature, setColorTemperature] = useState(0);
  const [colorHue, setColorHue] = useState(0);
  const [colorAdjustProcessing, setColorAdjustProcessing] = useState(false);
  // 全景生成状态
  const [panoramaPrompt, ] = useState('360度全景室内环境，等距圆柱投影，无缝全景，HDR高质量');
  const [, setIsGeneratingPanorama] = useState(false);
  const [, ] = useState(false);
  // 视频抽帧状态
  const [videoExtractMode, setVideoExtractMode] = useState<'uniform'|'fps'|'first_last'|'keyframes'>('uniform');
  const [showVideoExtractPanel, setShowVideoExtractPanel] = useState(false);
  const [videoExtractFrameCount, setVideoExtractFrameCount] = useState(12);
  const [videoExtractProcessing, setVideoExtractProcessing] = useState(false);
  // 即梦风格方向性扩展：上下左右独立 padding（像素值，基于原始图片尺寸）
  const [expandPadding, setExpandPadding] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  // 拖拽控制点状态
  const [, setDraggingHandle] = useState<string | null>(null);
  const expandPaddingRef = useRef({ top: 0, right: 0, bottom: 0, left: 0 });
  const [cropRatio, setCropRatio] = useState('free');
  const [, setShowExpandRatios] = useState(false);
  const [showCropRatios, setShowCropRatios] = useState(false);
  // 图片工具栏折叠状态
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [leftToolbarExpanded, setLeftToolbarExpanded] = useState(false);
  const [bottomBarHovered, setBottomBarHovered] = useState(false);

  // P2-1: 轻量连线状态
  const canvasConnections = connections ?? [];
  const separatorCls = isMonochrome ? 'w-px h-5 bg-gray-200' : 'w-px h-5 bg-white/[0.06]';
  const ltExpandedBtnCls = isMonochrome
    ? 'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all bg-blue-50 text-blue-700 hover:bg-blue-100'
    : 'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright';
  const ltActiveBtnCls = isMonochrome
    ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
    : 'bg-gold/20 text-gold hover:bg-gold/30';
  const ltDividerCls = isMonochrome
    ? 'mx-2 h-px bg-gray-200'
    : 'mx-2 h-px bg-white/[0.06]';
  const ltSectionTitleCls = isMonochrome
    ? 'text-xs font-semibold mb-1 px-2 text-gray-400'
    : 'text-xs font-semibold mb-1 px-2 text-gold-muted';
  const ltAdminBtnCls = isMonochrome
    ? 'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all bg-red-50 text-red-600 hover:bg-red-100'
    : 'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all bg-gold/15 text-gold hover:bg-gold/25';

  // Colorful icons for monochrome mode
  const mIcon: Record<string, string> = isMonochrome ? {
    ohMyPrompt: 'text-amber-500', refFusion: 'text-orange-500', users: 'text-blue-500',
    folder: 'text-blue-500', palette: 'text-violet-500', contrast: 'text-violet-500',
    workflow: 'text-pink-500', layoutGrid: 'text-teal-500', settings: 'text-slate-500',
    shield: 'text-red-500', heart: 'text-rose-500', helpCircle: 'text-sky-500',
    chevronsLeft: 'text-gray-400', chevronsRight: 'text-gray-400',
    generator: 'text-blue-600', pencil: 'text-violet-500', bot: 'text-fuchsia-500',
    shoppingBag: 'text-orange-500', scan: 'text-teal-500', fontDesign: 'text-amber-600',
    building: 'text-cyan-500', fileImage: 'text-indigo-500', hexCube: 'text-rose-500',
    maximize: 'text-emerald-500', mousePointer: 'text-blue-500', hand: 'text-green-500',
    upload: 'text-purple-500', fileText: 'text-emerald-500',
  } : {};
  const leftToolbarRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭左侧工具栏
  const leftToolbarExpandedRef = useRef(leftToolbarExpanded);
  leftToolbarExpandedRef.current = leftToolbarExpanded;
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (leftToolbarExpandedRef.current && leftToolbarRef.current && !leftToolbarRef.current.contains(e.target as Node)) {
        setLeftToolbarExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [showToolbarCustomize, setShowToolbarCustomize] = useState(false);
  // 工具栏自定义排序/可见性（从 localStorage 读取）
  const [toolbarItemOrder, setToolbarItemOrder] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try { const saved = localStorage.getItem('wujie_toolbar_order'); if (saved) return JSON.parse(saved); } catch {}
    }
    return ['放大','移除背景','SVG智能描摹','擦除','蒙版','调色','编辑元素','多角度','图转3D工厂','扩展','裁切','全景生成','精修引擎','语言修图','Agent编排','下载'];
  });
  const [toolbarHiddenItems, setToolbarHiddenItems] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try { const saved = localStorage.getItem('wujie_toolbar_hidden'); if (saved) return new Set(JSON.parse(saved)); } catch {}
    }
    return new Set<string>();
  });

  // 持久化工具栏自定义设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('wujie_toolbar_order', JSON.stringify(toolbarItemOrder));
    }
  }, [toolbarItemOrder]);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('wujie_toolbar_hidden', JSON.stringify([...toolbarHiddenItems]));
    }
  }, [toolbarHiddenItems]);

  // Active tool panel
  const [activeTool, setActiveTool] = useState<ActiveTool>('none');

  // ChatCanvas 批注模式
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotations, setAnnotations] = useState<CanvasAnnotation[]>([]);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);

  // Snap guides state - alignment assist lines during drag
  const [activeSnapGuides, setActiveSnapGuides] = useState<SnapGuide[]>([]);
  const snapEnabledRef = useRef(true);

  const [annotationInputText, setAnnotationInputText] = useState('');
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [annAtPickerOpen, setAnnAtPickerOpen] = useState(false);
  const [annAtFilter, setAnnAtFilter] = useState('');
  const [annAtHighlightIdx, setAnnAtHighlightIdx] = useState(0);
  const annAtPickerItems = useMemo(() => {
    return images
      .filter(img => !annAtFilter || (img.prompt || '').toLowerCase().includes(annAtFilter.toLowerCase()) || `图片#${images.indexOf(img) + 1}`.includes(annAtFilter))
      .map((img) => {
        const num = images.indexOf(img) + 1;
        return { id: img.id, url: img.url, label: `图片 #${num}`, desc: img.prompt ? img.prompt.slice(0, 20) : '', num };
      });
  }, [images, annAtFilter]);
  const handleAnnAtSelect = useCallback((item: { id: string; url: string; label: string; desc: string; num: number }) => {
    setAnnotationInputText(prev => {
      const cursorPos = annotationInputRef.current?.selectionStart ?? prev.length;
      const textBefore = prev.slice(0, cursorPos);
      const atIdx = textBefore.lastIndexOf('@');
      if (atIdx >= 0) return prev.slice(0, atIdx) + `@图片#${item.num} ` + prev.slice(cursorPos);
      return prev;
    });
    setAnnAtPickerOpen(false);
    setAnnAtFilter('');
    setAnnAtHighlightIdx(0);
  }, []);
  const annotationIdCounter = useRef(0);
  useRef<HTMLDivElement>(null);
  const annotationInputRef = useRef<HTMLTextAreaElement>(null);
  const [followUpInputId, setFollowUpInputId] = useState<string | null>(null);
  const annotationPanelRef = useRef<HTMLDivElement>(null);
  const annotationPanelPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const annotationPanelDragging = useRef(false);
  const annotationPanelDragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const [, ] = useState({ x: 0, y: 0 });
  useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const [followUpInputText, setFollowUpInputText] = useState('');
  const [, ] = useState<string | null>(null);
  // Region selection state for annotation drag
  const [annotationRegionStart, setAnnotationRegionStart] = useState<{cx: number; cy: number} | null>(null);
  const [annotationRegionCurrent, setAnnotationRegionCurrent] = useState<{cx: number; cy: number} | null>(null);

  // Annotation sub-tool: pin / region / brush
  const [annotationTool, setAnnotationTool] = useState<'pin' | 'region' | 'brush'>('pin');
  // Brush mask drawing state
  const [brushDrawingAnnId, setBrushDrawingAnnId] = useState<string | null>(null);
  const brushDrawingAnnIdRef = useRef<string | null>(null);
  const [annotationBrushSize, setAnnotationBrushSize] = useState(20);
  const [annotationBrushColor, setAnnotationBrushColor] = useState('#ef4444');
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isBrushDrawingRef = useRef(false);
  const brushScaleRef = useRef<{ x: number; y: number }>({ x: 1, y: 1 });
  const brushStrokesRef = useRef<{ x: number; y: number }[]>([]); // Screen-space points for live preview
  const [brushStrokes, setBrushStrokes] = useState<{ x: number; y: number }[]>([]); // For re-render
  const [isDraggingRegion, setIsDraggingRegion] = useState(false);

  // Upscale state
  const [, setUpscaleMultiplier] = useState(2);
  const [, setUpscaylAvailable] = useState(false);
  const [upscaylSelectedModel] = useState('realesrgan-x4plus');
  const [, setUpscaylChecking] = useState(true);
  const [upscalePreset, setUpscalePreset] = useState<'2k' | '4k' | '8k'>('2k');
  const [showUpscalePresetMenu, setShowUpscalePresetMenu] = useState(false);
  const [upscaleMode, setUpscaleMode] = useState<'lossless' | 'ai'>('lossless'); // 无损放大 / AI放大
  // Engine preference for tools: auto/ai/local (persisted in localStorage)
  const getEnginePref = (key: string): 'auto' | 'ai' | 'local' => {
    try { const v = localStorage.getItem(`wujie_engine_${key}`); if (v === 'ai' || v === 'local' || v === 'auto') return v; } catch {}
    return 'auto';
  };
  const [removeBgEngine, setRemoveBgEngine] = useState<'auto' | 'ai' | 'local'>(() => getEnginePref('removebg'));
  const [upscaleEnginePref, setUpscaleEnginePref] = useState<'auto' | 'ai' | 'local'>(() => getEnginePref('upscale'));
  const [, setSegmentEnginePref] = useState<'auto' | 'ai' | 'local'>(() => getEnginePref('segment'));
  const [engineDialog, setEngineDialog] = useState<null | 'upscale' | 'removebg' | 'svg' | 'segment'>(null);
  // Actual pixel dimensions of the image being upscaled (loaded from DOM)
  const [upscaleActualW, setUpscaleActualW] = useState(0);
  const [upscaleActualH, setUpscaleActualH] = useState(0);

  // SVG智能描摹 state
  const [svgTraceMode, setSvgTraceMode] = useState<'color' | 'bw'>('color');
  const [svgTraceQualityPreset, setSvgTraceQualityPreset] = useState<'fast' | 'balanced' | 'high' | 'max' | 'print' | 'print-pro'>('balanced');
  const [svgTraceEngine, setSvgTraceEngine] = useState<'auto' | 'vectorize-api' | 'vlm' | 'vtracer' | 'wasm-vtracer'>('auto');
  const svgTraceOutputFormat = 'svg' as const;
  const [svgTraceColorPrecision, setSvgTraceColorPrecision] = useState<number | null>(null);  // null = use preset
  const [svgTraceFilterSpeckle, ] = useState<number | null>(null);
  const [svgTraceCornerThreshold, setSvgTraceCornerThreshold] = useState<number | null>(null);
  const [svgTraceLengthThreshold, ] = useState<number | null>(null);
  const [svgTraceCurveMode, ] = useState<'polygon' | 'spline' | null>(null);
  const [svgTraceHierarchical, ] = useState<'stacked' | 'cutout' | null>(null);

  // Fixed position ref for SVG trace panel — prevents random movement on click
  const svgTraceFixedPosRef = useRef<{top: number; left: number} | null>(null);
  useEffect(() => {
    if (!showSvgTracePanel) svgTraceFixedPosRef.current = null;
  }, [showSvgTracePanel]);
  const [svgTraceBwThreshold, setSvgTraceBwThreshold] = useState(50);
  const [svgTraceBwTurdSize, ] = useState(2);
  const [svgTraceBwInvert, ] = useState(false);

  // Check ONNX upscale availability on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/upscayl');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setUpscaylAvailable(data.available ?? false);
      } catch {
        setUpscaylAvailable(false);
      } finally {
        setUpscaylChecking(false);
      }
    })();
  }, []);

  // Multi-angle state
  const [multiAngleMode, setMultiAngleMode] = useState<MultiAngleMode>('image');
  const [multiAngleRotation, setMultiAngleRotation] = useState(0);
  const [multiAngleTilt, setMultiAngleTilt] = useState(0);
  const [multiAngleZoom, setMultiAngleZoom] = useState(1); // 0=特写, 1=标准, 2=广角
  const [isMultiAngleProcessing, setIsMultiAngleProcessing] = useState(false);
  const [isMultiAngleDragging, setIsMultiAngleDragging] = useState(false);

  // Image to 3D state
  const [show3DModal, setShow3DModal] = useState(false);

  const [, ] = useState<'erase' | 'mask'>('erase');
  const [threeDBackend, setThreeDBackend] = useState<ThreeDBackend>('api');
  const [threeDType, ] = useState<ThreeDType>('ip');
  // 3D Model Viewer state
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [viewer3DModelUrl, setViewer3DModelUrl] = useState('');
  const [viewer3DPreviewUrl, setViewer3DPreviewUrl] = useState('');
  const [viewer3DModelUrls, setViewer3DModelUrls] = useState<Record<string, string>>({});
  const [viewer3DThumbnailUrls, setViewer3DThumbnailUrls] = useState<Record<string, string>>({});
  const [viewer3DTextureUrls, setViewer3DTextureUrls] = useState<Array<Record<string, string>>>([]);
  const [viewer3DModelInfo, setViewer3DModelInfo] = useState<{ faceCount?: number; vertexCount?: number; fileSize?: string; providerId?: string; providerName?: string; model3DName?: string; modelTaskId?: string }>({});

  // Video player state
  const [videoPlayerUrl, setVideoPlayerUrl] = useState('');
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false);
  // Video compare dialog
  const [compareVideos, setCompareVideos] = useState<{ a: { url: string; label?: string }; b: { url: string; label?: string } } | null>(null);
  // Canvas inline video playback state
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [inlineVideoProgress, setInlineVideoProgress] = useState<Record<string, number>>({});
  const [inlineVideoDuration, setInlineVideoDuration] = useState<Record<string, number>>({});
  const [inlineVideoPaused, setInlineVideoPaused] = useState<Record<string, boolean>>({});
  const inlineVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [showVideoEditPanel, setShowVideoEditPanel] = useState(false);
  const [videoEditTarget, setVideoEditTarget] = useState<CanvasImage | null>(null);
  const [, setVideoEditTab] = useState<'edit' | 'extend'>('edit');
  // AI视频配音
  const [showVideoDubPanel, setShowVideoDubPanel] = useState(false);
  const [videoDubTarget, setVideoDubTarget] = useState<CanvasImage | null>(null);
  const [dubText, setDubText] = useState('');
  const [dubVoice, setDubVoice] = useState('female-calm');
  const [dubSpeed, setDubSpeed] = useState(1);
  const [isDubbing, setIsDubbing] = useState(false);
  const handleVideoDub = useCallback(async () => {
    if (!videoDubTarget?.videoUrl || !dubText.trim()) { toast.error('请输入配音文本'); return; }
    setIsDubbing(true);
    const tid = toast.loading('正在生成配音并合成视频...');
    try {
      // 先调用TTS生成音频
      const ttsRes = await fetch('/api/audio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: dubText, voice: dubVoice, speed: dubSpeed }),
      });
      if (!ttsRes.ok) throw new Error('配音生成失败');
      const ttsData = await ttsRes.json();
      if (!ttsData.audioUrl) throw new Error('配音生成失败');
      // 然后调用视频合成接口
      const composeRes = await fetch('/api/video/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-audio', videoUrl: videoDubTarget.videoUrl, audioUrl: ttsData.audioUrl, volume: 1.0 }),
      });
      if (!composeRes.ok) throw new Error('视频合成失败');
      const composeData = await composeRes.json();
      if (composeData.videoUrl) {
        onAddImages([composeData.videoUrl]);
        toast.success('配音视频已添加到画布', { id: tid });
        setShowVideoDubPanel(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '配音失败', { id: tid });
    } finally {
      setIsDubbing(false);
    }
  }, [videoDubTarget, dubText, dubVoice, dubSpeed, onAddImages]);

  // Whether any floating panel is open (used to auto-hide connections & image toolbar)
  const anyPanelOpen = showSvgTracePanel || showAgentEditor || showBrandEcommerce || showFontDesign || showBrandFactory || showSceneStudio || showBrandPackaging || showDisplay3D || showVideoEditPanel || showCanvasGenerator || showRefineEngine || showLogoSkill || showAiPsd || showStickerAssistant || showVideoDubPanel;

  // Video tools handler
  const handleVideoTool = async (action: 'to-gif' | 'extract-cover' | 'compress' | 'extract-frame', image: CanvasImage, timestamp?: number) => {
    if (!image.videoUrl) return;

    // Client-side frame extraction using HTML5 Canvas
    if (action === 'extract-cover' || action === 'extract-frame') {
      try {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.src = image.videoUrl;
        video.muted = true;
        video.preload = 'auto';

        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('视频加载失败'));
          video.load();
        });

        const targetTime = timestamp ?? 0;
        video.currentTime = Math.min(targetTime, video.duration - 0.1);

        await new Promise<void>(resolve => {
          video.onseeked = () => resolve();
        });

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context failed');
        ctx.drawImage(video, 0, 0);

        const dataUrl = canvas.toDataURL('image/png');
        const label = timestamp !== undefined
          ? `帧 @ ${Math.floor(timestamp)}s`
          : '视频封面';

        // Save frame as image and add to canvas
        const saveRes = await fetch('/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, filename: `frame-${Date.now()}.png` }),
        });
        const saveData = await saveRes.json();
        const frameUrl = saveData.url || saveData.localPath || dataUrl;

        onAddImages([frameUrl], undefined, {
          modelName: 'frame-extract',
          apiProvider: 'local',
        });
        toast.success(`已提取${label}`);
      } catch (err) {
        console.error('[frame-extract] error:', err);
        toast.error('帧提取失败，视频可能存在跨域限制');
      }
      return;
    }
    
    try {
      const response = await fetch('/api/video/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          videoUrl: image.videoUrl,
          // GIF 参数
          fps: 10,
          width: 480,
          // 压缩参数
          quality: 0.7,
        }),
      });
      
      const result = await response.json();
      if (result.success) {
        console.log(`[video-tool] ${action} success:`, result.data);
      } else {
        console.error(`[video-tool] ${action} failed:`, result.error);
      }
    } catch (error) {
      console.error(`[video-tool] ${action} error:`, error);
    }
  };

  const [threeDQuality, setThreeDQuality] = useState('high');
  const [threeDTexture, setThreeDTexture] = useState('4k');
  const [threeDFormat, setThreeDFormat] = useState('glb');

  // 3D mode: single-image / multi-image / text-to-3d
  const [threeDMode, setThreeDMode] = useState<'single-image' | 'multi-image' | 'text-to-3d'>('single-image');
  const [threeDPrompt, setThreeDPrompt] = useState('');
  const [threeDSingleImageUrl, setThreeDSingleImageUrl] = useState<string>('');
  const [threeDShowCanvasPicker, setThreeDShowCanvasPicker] = useState(false);
  const [threeDEnablePBR, setThreeDEnablePBR] = useState(false);
  const [threeDFaceCount, setThreeDFaceCount] = useState(30000);
  const [threeDPose, setThreeDPose] = useState<'' | 'a-pose' | 't-pose'>('');
  // Multi-image views for 3D generation
  const [threeDMultiImages, setThreeDMultiImages] = useState<Array<{ url: string; view: string; label: string }>>([]);

  const [threeDProviderId, setThreeDProviderId] = useState('');
  const [threeDLocalEndpoint, setThreeDLocalEndpoint] = useState('http://127.0.0.1:7860/api/image-to-3d');
  const [threeDLocalModel, setThreeDLocalModel] = useState('Hunyuan3D-2.1');
  const [threeDProgress, setThreeDProgress] = useState<string | null>(null);
  const [admin3DModels, setAdmin3DModels] = useState<Array<{ id: string; name: string; baseUrl: string; apiKey: string; model?: string; providerPreset?: string; providerName: string; advancedParams?: Record<string, string> }>>([]);

  // Crop state
  const [, setCropLeft] = useState(0);
  const [, setCropTop] = useState(0);
  const [, setCropWidth] = useState(0);
  const [, setCropHeight] = useState(0);

  // Mask keyword popup

  const [maskKeyword, setMaskKeyword] = useState('');

  // Download popup
  const [showDownloadPopup, setShowDownloadPopup] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'svg' | '3d'>('png');
  const [threeDDownloadFormat, setThreeDDownloadFormat] = useState('');
  const [svgMode, setSvgMode] = useState<'pro' | 'studio'>('pro');
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);

  // Auto-select best 3D format when downloadFormat is '3d'
  // Priority: glb > gltf > fbx > obj > stl > usdz
  // Only auto-select when format is empty (initial selection) or selected image changes
  const prevSelectedImageRef = useRef<string>('');
  useEffect(() => {
    if (downloadFormat !== '3d') return;
    const firstSelectedId = selectedIds.values().next().value as string | undefined;
    if (!firstSelectedId) return;

    // Auto-select when: format is empty, or the selected image changed
    const imageChanged = firstSelectedId !== prevSelectedImageRef.current;
    if (!threeDDownloadFormat || imageChanged) {
      prevSelectedImageRef.current = firstSelectedId;
      const selected = images.find(img => img.id === firstSelectedId);
      if (selected?.threeDModelUrls) {
        const availableFormats = Object.keys(selected.threeDModelUrls);
        const priority = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'usdz'];
        const preferred = priority.find(fmt => availableFormats.includes(fmt));
        const bestFormat = preferred || availableFormats[0];
        if (bestFormat) {
          setThreeDDownloadFormat(bestFormat);
        }
      }
    }
  }, [downloadFormat, images, selectedIds, threeDDownloadFormat]);

  // Reset 3D format when download format changes away from '3d'
  useEffect(() => {
    if (downloadFormat !== '3d') {
      setThreeDDownloadFormat('');
    }
  }, [downloadFormat]);

  // PSD Layer Editor
  const [showPsdEditor, setShowPsdEditor] = useState(false);
  const [psdEditorImageUrl, setPsdEditorImageUrl] = useState<string>('');
  const [, ] = useState<PsdLayerItem[]>([]);
  const [psdEditorMode, setPsdEditorMode] = useState<'basic' | 'standard' | 'advanced' | 'studio'>('standard');

  // Misc
  const [showHelpModal, setShowHelpModal] = useState<'instructions' | 'changelog' | null>(null);

  // Edit mode drawing - strokes stored in canvas coordinates
  const [editStrokes, setEditStrokes] = useState<{ x: number; y: number; reverse: boolean }[][]>([]);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number; reverse: boolean }[]>([]);
  const [isEditProcessing, setIsEditProcessing] = useState(false);
  const [isSvgTraceProcessing, setIsSvgTraceProcessing] = useState(false);
  // Floating window brush tool mode: 'brush' or 'eraser'
  const [editBrushMode, setEditBrushMode] = useState<'brush' | 'eraser'>('brush');
  // Erase model selection (LaMa / ZITS / Anime-Lama)
  const [eraseModelId, setEraseModelId] = useState<string>('lama');
  // RemoveBG model selection
  const [removeBgModelId, setRemoveBgModelId] = useState<string>('u2net');
  // RemoveBG model picker dialog
  const [showRemoveBgPicker, setShowRemoveBgPicker] = useState(false);
  // Floating window canvas zoom/pan
  const [editCanvasZoom, setEditCanvasZoom] = useState(1);
  const [editCanvasPan, setEditCanvasPan] = useState({ x: 0, y: 0 });
  // Use refs for frequently-changing mouse state to avoid stale closures in event handlers
  const isDrawingRef = useRef(false);
  const isAltErasingRef = useRef(false);
  const brushCursorPosRef = useRef<{ x: number; y: number } | null>(null);
  // Force re-render for brush cursor display

  // Force re-render when strokes change (for SVG overlay)
  const [, setStrokesVersion] = useState(0);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropDragStart, setCropDragStart] = useState<{ x: number; y: number } | null>(null);
  const [cropDragMode, setCropDragMode] = useState<'create' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br'>('create');
  const [cropDragOrigin, setCropDragOrigin] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<CanvasImage[]>(images);

  // 【调整2&3】生成组状态 — Alt+左键参考图组 / Ctrl+左键融图组
  const [genGroups, setGenGroups] = useState<CanvasGenGroup[]>([]);
  const genGroupsRef = useRef<CanvasGenGroup[]>(genGroups);
  // 临时存储参考图组的元数据（descriptions/categories/strengths），供 fetch 请求使用
  const groupRefMetaRef = useRef<{ referenceDescriptions?: string[]; referenceCategories?: Record<string, string[]>; referenceStrengths?: number[] }>({});
  const [optimizingGroupId, setOptimizingGroupId] = useState<string | null>(null);
  const [openModelDropdownGroupId, setOpenModelDropdownGroupId] = useState<string | null>(null);
  const [genGroupTick, setGenGroupTick] = useState(0);
  // Tick timer for gen group elapsed time display
  useEffect(() => {
    const hasProcessing = genGroups.some(g => g.resultPlaceholder.isProcessing);
    if (!hasProcessing) return;
    const timer = setInterval(() => setGenGroupTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [genGroups]);
  // GenGroup 拖动状态
  const [genGroupDragTarget, setGenGroupDragTarget] = useState<string | null>(null);
  const [genGroupDragStart, setGenGroupDragStart] = useState({ x: 0, y: 0 });
  const [genGroupDragOffset, setGenGroupDragOffset] = useState({ x: 0, y: 0 });
  const genGroupDragReadyRef = useRef(false);
  const genGroupDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // HexCube 六面体组状态
  const [hexCubeGroups, setHexCubeGroups] = useState<HexCubeGroup[]>([]);
  useRef<HexCubeGroup[]>(hexCubeGroups);
  const [hexCubeDragTarget, setHexCubeDragTarget] = useState<string | null>(null);
  const [hexCubeDragStart, setHexCubeDragStart] = useState({ x: 0, y: 0 });
  const [hexCubeDragOffset, setHexCubeDragOffset] = useState({ x: 0, y: 0 });
  const hexCubeDragReadyRef = useRef(false);
  const hexCubeDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hexCube3dDragging, setHexCube3dDragging] = useState(false);
  const hexCube3dDragRef = useRef<{ groupId: string; startX: number; startY: number; startRotY: number; startTiltX: number } | null>(null);
  const [hoveredGenGroupId, setHoveredGenGroupId] = useState<string | null>(null);
  const multiAngleDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startRotation: number;
    startTilt: number;
  } | null>(null);
  // Use a ref to track current stroke for reliable access in mouseUp
  const currentStrokeRef = useRef<{ x: number; y: number; reverse: boolean }[]>([]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // 同步 genGroups ref
  useEffect(() => {
    genGroupsRef.current = genGroups;
  }, [genGroups]);

  /** Get current image model from localStorage (independent of component state) */
  const getCurrentModel = useCallback((): { model: string; providerId?: string; apiDisplayName?: string; providerName?: string } => {
    try {
      // 优先读取 wujie_selected_model（generation-panel 写入）
      const raw = localStorage.getItem('wujie_selected_model');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.model) return {
          model: parsed.model,
          providerId: parsed.providerId,
          apiDisplayName: parsed.apiDisplayName || '',
          providerName: parsed.providerName || '',
        };
      }
      // 兜底：从 unbounded_ai_user_data 读取
      const userId = localStorage.getItem('unbounded_ai_current_user');
      if (userId) {
        const stored = localStorage.getItem('unbounded_ai_user_data');
        if (stored) {
          const data = JSON.parse(stored);
          const compositeKey = data?.userData?.[userId]?.selectedModel;
          if (compositeKey) {
            const pureId = compositeKey.includes('::') ? compositeKey.split('::').pop()! : compositeKey;
            const providerId = compositeKey.includes('::') ? compositeKey.split('::')[0] : '';
            return { model: pureId, providerId };
          }
        }
      }
    } catch {}
    return { model: 'gemini-3-pro-image-preview' };
  }, []);

  // Helper: check if keyboard event target is an input field (should not trigger canvas shortcuts)
  const isInputFocused = useCallback((e: KeyboardEvent): boolean => {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable === true;
  }, []);

  // Helper: check if a native event originates from a dialog/modal/overlay/panel (should be ignored by canvas)
  const isEventFromOverlay = useCallback((e: Event): boolean => {
    const target = e.target as HTMLElement;
    return !!target?.closest?.('[data-compare-dialog], [data-modal], [data-popup], [data-floating-panel], [data-toolbar], [role="dialog"], [role="tabpanel"]');
  }, []);

  // Sync selectedImage prop
  useEffect(() => {
    if (selectedImage) {
      setSelectedIds(new Set([selectedImage.id]));
    }
  }, [selectedImage]);

  // Track Ctrl/Meta key for reference selection visual hint
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEventFromOverlay(e)) return;
      if (e.ctrlKey || e.metaKey) setCtrlKeyHeld(true);
      if (e.altKey) setAltKeyHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (isEventFromOverlay(e)) return;
      if (!e.ctrlKey && !e.metaKey) setCtrlKeyHeld(false);
      if (!e.altKey) setAltKeyHeld(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isEventFromOverlay]);

  const clampMultiAngleValue = useCallback((value: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, value));
  }, []);

  const handleMultiAnglePreviewMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isMultiAngleProcessing) return;
    e.preventDefault();
    e.stopPropagation();
    multiAngleDragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startRotation: multiAngleRotation,
      startTilt: multiAngleTilt,
    };
    setIsMultiAngleDragging(true);
  }, [isMultiAngleProcessing, multiAngleRotation, multiAngleTilt]);

  useEffect(() => {
    if (!isMultiAngleDragging) return;
    const handleMove = (event: MouseEvent) => {
      if (isEventFromOverlay(event)) return;
      const drag = multiAngleDragRef.current;
      if (!drag?.active) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setMultiAngleRotation(Math.round(clampMultiAngleValue(drag.startRotation + dx * 0.55, -90, 90)));
      // Invert dy: drag down → look down (俯视, negative tilt), drag up → look up (仰视, positive tilt)
      setMultiAngleTilt(Math.round(clampMultiAngleValue(drag.startTilt - dy * 0.55, -30, 60)));
    };
    const handleUp = () => {
      multiAngleDragRef.current = null;
      setIsMultiAngleDragging(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [clampMultiAngleValue, isEventFromOverlay, isMultiAngleDragging]);

  // HexCube 3D cube drag interaction
  useEffect(() => {
    if (!hexCube3dDragging) return;
    const handleMove = (event: MouseEvent) => {
      if (isEventFromOverlay(event)) return;
      const drag = hexCube3dDragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const newRotY = Math.round(Math.max(0, Math.min(360, drag.startRotY + dx * 0.5)));
      const newTiltX = Math.round(Math.max(-60, Math.min(60, drag.startTiltX + dy * 0.4)));
      setHexCubeGroups(prev => prev.map(g => g.id === drag.groupId ? { ...g, toolbar: { ...g.toolbar, rotationY: newRotY, tiltX: newTiltX } } : g));
    };
    const handleUp = (e: MouseEvent) => {
      if (isEventFromOverlay(e)) return;
      hexCube3dDragRef.current = null;
      setHexCube3dDragging(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [hexCube3dDragging, isEventFromOverlay]);

  const selectImage = useCallback((id: string | null) => {
    if (id) {
      const img = images.find(i => i.id === id);
      onSelectImage(img || null);
      // Agent选择图片模式：点击图片后将其设为Agent编辑器的图片
      if (agentSelectingImage && img) {
        setAgentEditImage(img);
        setAgentSelectingImage(false);
      }
    } else {
      onSelectImage(null);
    }
  }, [images, onSelectImage, agentSelectingImage]);

  // Create a group from selected images
  const handleCreateGroup = useCallback(() => {
    if (selectedIds.size < 2) return;
    const selectedImages = images.filter(img => selectedIds.has(img.id));
    if (selectedImages.length < 2) return;

    const groupId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Calculate bounding box
    const minX = Math.min(...selectedImages.map(i => i.x));
    const minY = Math.min(...selectedImages.map(i => i.y));
    Math.max(...selectedImages.map(i => i.x + i.width));
    Math.max(...selectedImages.map(i => i.y + i.height));
    const padding = 30;
    const titleBarH = 36;

    const newGroup: ImageGroup = {
      id: groupId,
      name: `组 ${groups.length + 1}`,
      note: '',
      imageIds: [...selectedIds],
      x: minX - padding,
      y: minY - titleBarH - padding,
      collapsed: false,
    };

    // Offset images into group-relative coordinates
    const updatedImages = images.map(img => {
      if (selectedIds.has(img.id)) {
        return { ...img, groupId };
      }
      return img;
    });

    onImagesChange(updatedImages);
    setGroups(prev => [...prev, newGroup]);
    setEditingGroupId(groupId);
    setGroupEditName(newGroup.name);
    setGroupEditNote('');
  }, [selectedIds, images, groups, onImagesChange]);

  // Delete a group (un-group, doesn't delete images)
  const handleDeleteGroup = useCallback((groupId: string) => {
    const updatedImages = images.map(img =>
      img.groupId === groupId ? { ...img, groupId: undefined } : img
    );
    onImagesChange(updatedImages);
    setGroups(prev => prev.filter(g => g.id !== groupId));
  }, [images, onImagesChange]);

  // Toggle group collapse
  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
    ));
  }, []);

  // Save group name/note
  const handleSaveGroupEdit = useCallback(() => {
    if (!editingGroupId) return;
    setGroups(prev => prev.map(g =>
      g.id === editingGroupId ? { ...g, name: groupEditName, note: groupEditNote } : g
    ));
    setEditingGroupId(null);
  }, [editingGroupId, groupEditName, groupEditNote]);

  // Window-level mouseUp listener to ensure drawing always stops even if mouse released outside canvas
  useEffect(() => {
    const handleWindowMouseUp = (e: MouseEvent) => {
      if (isEventFromOverlay(e)) return;
      if (isDrawingRef.current) {
        const stroke = currentStrokeRef.current;
        if (stroke.length > 1) {
          setEditStrokes(prev => [...prev, stroke]);
        }
        currentStrokeRef.current = [];
        setCurrentStroke([]);
        isDrawingRef.current = false;
        setStrokesVersion(v => v + 1);
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [isEventFromOverlay]);

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if event originates from dialog/modal/overlay
      if (isEventFromOverlay(e)) return;
      // Skip if user is typing in an input field (unified check)
      const inputFocused = isInputFocused(e);

      // Ctrl+Z / Cmd+Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        if (inputFocused) return;
        e.preventDefault();
        onUndo?.();
        return;
      }
      // Ctrl+Shift+Z / Cmd+Shift+Z: Redo
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && e.shiftKey) {
        if (inputFocused) return;
        e.preventDefault();
        if (onRedo) {
          onRedo();
        }
        return;
      }
      // Ctrl + Plus: Zoom in
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
        e.preventDefault();
        const newZoom = Math.min(5, zoom * 1.15);
        if (canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect();
          const cx = rect.width / 2;
          const cy = rect.height / 2;
          setViewOffset({
            x: cx - (cx - viewOffset.x) * (newZoom / zoom),
            y: cy - (cy - viewOffset.y) * (newZoom / zoom),
          });
        }
        setZoom(newZoom);
        return;
      }
      // Ctrl + Minus: Zoom out
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
        e.preventDefault();
        const newZoom = Math.max(0.1, zoom / 1.15);
        if (canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect();
          const cx = rect.width / 2;
          const cy = rect.height / 2;
          setViewOffset({
            x: cx - (cx - viewOffset.x) * (newZoom / zoom),
            y: cy - (cy - viewOffset.y) * (newZoom / zoom),
          });
        }
        setZoom(newZoom);
        return;
      }
      // Ctrl + D: Duplicate selected images (prevent browser bookmark shortcut)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
        if (inputFocused) return;
        e.preventDefault();
        if (selectedIds.size > 0) {
          const offset = 30;
          const dupImages = images
            .filter(img => selectedIds.has(img.id) && !img.isProcessingPlaceholder)
            .map(img => ({
              ...img,
              id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
              x: img.x + offset,
              y: img.y + offset,
            }));
          if (dupImages.length > 0) {
            onImagesChange([...imagesRef.current, ...dupImages]);
            setSelectedIds(new Set(dupImages.map(d => d.id)));
            selectImage(dupImages[0].id);
          }
        }
        return;
      }
      // Ctrl+Shift+G: Create group from selected images (Shift+G to avoid browser Ctrl+G search conflict)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyG') {
        if (inputFocused) return;
        e.preventDefault();
        if (selectedIds.size >= 2) {
          handleCreateGroup();
        }
        return;
      }
      // Ctrl+G is also accepted for backward compatibility, but prevent browser default
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyG') {
        if (inputFocused) return;
        e.preventDefault();
        if (selectedIds.size >= 2) {
          handleCreateGroup();
        }
        return;
      }
      // Ctrl+Shift+Q: Masonry layout for selected images (Shift+Q to avoid Firefox Ctrl+Q close tab)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyQ') {
        if (inputFocused) return;
        e.preventDefault();
        if (selectedIds.size > 1) {
          const selImgs = images.filter(i => selectedIds.has(i.id));
          const COL_WIDTH = 280;
          const GAP = 16;
          const numCols = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(selImgs.length))));
          const colHeights = new Array(numCols).fill(0);
          const updated = images.map(img => {
            if (!selectedIds.has(img.id)) return img;
            const scale = COL_WIDTH / img.width;
            const newW = COL_WIDTH;
            const newH = Math.round(img.height * scale);
            const minCol = colHeights.indexOf(Math.min(...colHeights));
            const newX = minCol * (COL_WIDTH + GAP);
            const newY = colHeights[minCol];
            colHeights[minCol] += newH + GAP;
            return { ...img, x: newX, y: newY, width: newW, height: newH };
          });
          onImagesChange(updated);
        }
        return;
      }
      // Ctrl+Q without Shift also accepted for backward compatibility, but prevent Firefox close
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyQ') {
        if (inputFocused) return;
        e.preventDefault();
        if (selectedIds.size > 1) {
          const selImgs = images.filter(i => selectedIds.has(i.id));
          const COL_WIDTH = 280;
          const GAP = 16;
          const numCols = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(selImgs.length))));
          const colHeights = new Array(numCols).fill(0);
          const updated = images.map(img => {
            if (!selectedIds.has(img.id)) return img;
            const scale = COL_WIDTH / img.width;
            const newW = COL_WIDTH;
            const newH = Math.round(img.height * scale);
            const minCol = colHeights.indexOf(Math.min(...colHeights));
            const newX = minCol * (COL_WIDTH + GAP);
            const newY = colHeights[minCol];
            colHeights[minCol] += newH + GAP;
            return { ...img, x: newX, y: newY, width: newW, height: newH };
          });
          onImagesChange(updated);
        }
        return;
      }
      // C key: Toggle annotation mode (ChatCanvas) — only when no modifier and not in overlay
      if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (inputFocused) return;
        e.preventDefault();
        setAnnotationMode(prev => !prev);
        if (!annotationMode) { setAnnotationTool('pin'); setEditMode('none'); } // reset to pin + exit any edit mode when entering
        return;
      }
      // B key to toggle brush tool in annotation mode
      if (e.code === 'KeyB' && annotationMode && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (inputFocused) return;
        setAnnotationTool(prev => prev === 'brush' ? 'pin' : 'brush');
        return;
      }
      // R key to toggle region tool in annotation mode
      if (e.code === 'KeyR' && annotationMode && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (inputFocused) return;
        setAnnotationTool(prev => prev === 'region' ? 'pin' : 'region');
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        if (inputFocused) return;
        e.preventDefault();
        setIsSpacePressed(true);
      }
      if (e.code === 'Escape') {
        // 退出批注模式
        if (annotationMode) {
          setAnnotationMode(false);
          setEditingAnnotationId(null);
        }
        // 退出图片对比选择模式
        if (compareSelecting) {
          setCompareSelecting(false);
          setCompareImages({ left: null, right: null });
        }
        // 退出Agent选择图片模式
        if (agentSelectingImage) {
          setAgentSelectingImage(false);
        }
        if (editMode === 'upscale' || editMode === 'erase' || editMode === 'mask') {
        }
        if (showSvgTracePanel) {
          setShowSvgTracePanel(false);
        }
        if (editMode !== 'none') {
          setEditMode('none');
          setEditImageId(null);
          setEditStrokes([]);
          setCurrentStroke([]);
          isDrawingRef.current = false;
          currentStrokeRef.current = [];
          setActiveTool('none');
        } else {
          setActiveTool('none');
          setShowDownloadPopup(false);
          setSelectedIds(new Set());
          selectImage(null);
        }
        setShowContextMenu(false);
        setShowCanvasMenu(false);
      }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (inputFocused) return;
        // Prevent browser Backspace navigation
        e.preventDefault();
        if (selectedIds.size > 0 && editMode === 'none') {
          const deletingIds = selectedIds;
          onImagesChange(images.filter(img => !deletingIds.has(img.id)));
          setSelectedIds(new Set());
          selectImage(null);
          if (editImageId && deletingIds.has(editImageId)) { setEditImageId(null); }
        }
      }
      // Track Alt key for reverse drawing in erase/mask modes
      if (e.altKey && (editMode === 'erase' || editMode === 'mask')) {
        isAltErasingRef.current = true;
      }
      // [ and ] keys to adjust brush size in erase/mask modes (like IOPaint/Photoshop)
      if ((editMode === 'erase' || editMode === 'mask')) {
        if (e.code === 'BracketLeft') {
          e.preventDefault();
          setBrushSize(prev => Math.max(5, prev - 5));
        } else if (e.code === 'BracketRight') {
          e.preventDefault();
          setBrushSize(prev => Math.min(200, prev + 5));
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
      if (!e.altKey) {
        isAltErasingRef.current = false;
      }
    };

    // Paste event: handle clipboard images (screenshots, copied images)
    const handlePaste = async (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      const imageFiles: File[] = [];
      // Check for image files in clipboard (screenshots from WeChat/QQ, copied images)
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;
      e.preventDefault();

      // Upload each image and add to canvas
      const newImages: CanvasImage[] = [];
      for (const file of imageFiles) {
        try {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          if (!res.ok) continue;
          const data = await res.json();
          const url = data.url || data.filePath;
          if (!url) continue;

          // Calculate position in center of current viewport
          const canvasEl = canvasRef.current;
          let cx = 400, cy = 300;
          if (canvasEl) {
            const rect = canvasEl.getBoundingClientRect();
            cx = (rect.width / 2 - viewOffset.x) / zoom;
            cy = (rect.height / 2 - viewOffset.y) / zoom;
          }
          // Offset each pasted image slightly so they don't stack
          const offsetIdx = newImages.length * 30;
          // Load actual pixel dimensions first to ensure correct originalWidth/originalHeight
          const imgDim = await new Promise<{ natW: number; natH: number; dispW: number; dispH: number }>((resolve) => {
            const tempImg = new Image();
            tempImg.onload = () => {
              const natW = tempImg.naturalWidth;
              const natH = tempImg.naturalHeight;
              const maxEdge = 500;
              const scale = Math.min(maxEdge / natW, maxEdge / natH, 1);
              const dispW = Math.round(natW * scale);
              const dispH = Math.round(natH * scale);
              resolve({ natW, natH, dispW, dispH });
            };
            tempImg.onerror = () => {
              // Fallback to default dimensions
              resolve({ natW: 400, natH: 300, dispW: 400, dispH: 300 });
            };
            tempImg.src = url;
          });
          newImages.push({
            id: `paste-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            url,
            x: cx + offsetIdx,
            y: cy + offsetIdx,
            width: imgDim.dispW,
            height: imgDim.dispH,
            originalWidth: imgDim.natW,
            originalHeight: imgDim.natH,
          });
        } catch {
          // Skip failed uploads
        }
      }

      if (newImages.length > 0) {
        onImagesChange([...imagesRef.current, ...newImages]);
        setSelectedIds(new Set(newImages.map(img => img.id)));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('paste', handlePaste);
    };
  }, [selectedIds, images, onImagesChange, selectImage, editMode, onUndo, zoom, viewOffset, isEventFromOverlay, isInputFocused, annotationMode, onRedo, handleCreateGroup, compareSelecting, agentSelectingImage, showSvgTracePanel, editImageId]);

  // Click outside to close menus
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (isEventFromOverlay(e)) return;
      setShowContextMenu(false);
      setShowCanvasMenu(false);
      setShowExpandRatios(false);
      setShowCropRatios(false);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [isEventFromOverlay]);

  // Non-passive wheel listener to prevent browser Ctrl+zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Coordinate conversion
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (screenX - rect.left - viewOffset.x) / zoom,
      y: (screenY - rect.top - viewOffset.y) / zoom,
    };
  }, [viewOffset, zoom]);

  // Hit test — ★ Uses spatial index for O(log n) when available
  const hitTestImage = useCallback((canvasX: number, canvasY: number): string | null => {
    // Collect IDs of gen group result images (they are hidden on canvas, skip them in hit test)
    const genGroupResultIds = new Set<string>();
    for (const g of genGroupsRef.current) {
      if (g.resultImageIds) {
        for (const rid of g.resultImageIds) genGroupResultIds.add(rid);
      }
    }

    // ★ Spatial index path: O(log n) candidate filtering + z-order sort
    if (images.length > 20 && spatialIndexRef.current) {
      const candidates = spatialIndexRef.current.hitTestAll(canvasX, canvasY);
      // Sort by z-order (index in images array, last = top) and return topmost non-excluded
      let topIndex = -1;
      let topId: string | null = null;
      for (const id of candidates) {
        if (genGroupResultIds.has(id)) continue;
        const idx = images.findIndex(img => img.id === id);
        if (idx > topIndex) {
          topIndex = idx;
          topId = id;
        }
      }
      return topId;
    }

    // Fallback: linear scan for small image sets
    for (let i = images.length - 1; i >= 0; i--) {
      const img = images[i];
      if (genGroupResultIds.has(img.id)) continue;
      if (canvasX >= img.x && canvasX <= img.x + img.width &&
          canvasY >= img.y && canvasY <= img.y + img.height) {
        return img.id;
      }
    }
    return null;
  }, [images]);

  // Edit mode mouse handlers - use refs to avoid stale closures
  const handleEditMouseDown = useCallback((e: React.MouseEvent) => {
    if (editMode === 'none') return;
    if (e.button !== 0) return; // Only left click

    // Erase/mask modes now use floating window - don't capture strokes on main canvas
    if (editMode === 'erase' || editMode === 'mask') return;

    const editImg = images.find(i => i.id === editImageId);
    if (!editImg) return;

    if (editMode === 'crop') {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const x = e.clientX - canvasRect.left;
      const y = e.clientY - canvasRect.top;

      // Get image screen bounds for clamping
      const imgScreenX = editImg.x * zoom + viewOffset.x;
      const imgScreenY = editImg.y * zoom + viewOffset.y;
      const imgScreenW = editImg.width * zoom;
      const imgScreenH = editImg.height * zoom;

      // Check if clicking on existing crop rect corners or inside
      if (cropRect && cropRect.w > 5 && cropRect.h > 5) {
        const cornerSize = 12;
        const corners: Record<string, { x: number; y: number }> = {
          'resize-tl': { x: cropRect.x, y: cropRect.y },
          'resize-tr': { x: cropRect.x + cropRect.w, y: cropRect.y },
          'resize-bl': { x: cropRect.x, y: cropRect.y + cropRect.h },
          'resize-br': { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
        };
        for (const [mode, corner] of Object.entries(corners)) {
          if (Math.abs(x - corner.x) < cornerSize && Math.abs(y - corner.y) < cornerSize) {
            setCropDragMode(mode as 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br');
            setCropDragStart({ x, y });
            setCropDragOrigin({ ...cropRect });
            return;
          }
        }
        // Check if inside crop rect (move mode)
        if (x >= cropRect.x && x <= cropRect.x + cropRect.w &&
            y >= cropRect.y && y <= cropRect.y + cropRect.h) {
          setCropDragMode('move');
          setCropDragStart({ x, y });
          setCropDragOrigin({ ...cropRect });
          return;
        }
      }

      // Create new crop rect by dragging
      // Clamp start point to image bounds
      const clampedX = Math.max(imgScreenX, Math.min(x, imgScreenX + imgScreenW));
      const clampedY = Math.max(imgScreenY, Math.min(y, imgScreenY + imgScreenH));
      setCropDragMode('create');
      setCropDragStart({ x: clampedX, y: clampedY });
      setCropRect({ x: clampedX, y: clampedY, w: 0, h: 0 });
      setCropDragOrigin(null);
    }
  }, [editMode, editImageId, images, cropRect, zoom, viewOffset]);

  const handleEditMouseMove = useCallback((e: React.MouseEvent) => {
    // Erase/mask modes now use floating window - don't handle strokes on main canvas
    if (editMode === 'erase' || editMode === 'mask') {
      return;
    } else if (cropDragStart && editMode === 'crop') {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const x = e.clientX - canvasRect.left;
      const y = e.clientY - canvasRect.top;

      const editImg = images.find(i => i.id === editImageId);
      if (!editImg) return;

      // Image screen bounds for clamping
      const imgScreenX = editImg.x * zoom + viewOffset.x;
      const imgScreenY = editImg.y * zoom + viewOffset.y;
      const imgScreenW = editImg.width * zoom;
      const imgScreenH = editImg.height * zoom;

      // Clamp mouse position to image bounds
      const clampX = Math.max(imgScreenX, Math.min(x, imgScreenX + imgScreenW));
      const clampY = Math.max(imgScreenY, Math.min(y, imgScreenY + imgScreenH));

      // Parse ratio constraint
      const applyRatio = (w: number, h: number): { w: number; h: number } => {
        if (cropRatio === 'free') return { w, h };
        const parts = cropRatio.split(':').map(Number);
        if (parts.length !== 2 || parts[0] <= 0 || parts[1] <= 0) return { w, h };
        const targetRatio = parts[0] / parts[1];
        const currentRatio = w / h;
        if (currentRatio > targetRatio) {
          return { w: h * targetRatio, h };
        } else {
          return { w, h: w / targetRatio };
        }
      };

      if (cropDragMode === 'create') {
        let newW = Math.abs(clampX - cropDragStart.x);
        let newH = Math.abs(clampY - cropDragStart.y);
        const ratioApplied = applyRatio(newW, newH);
        newW = ratioApplied.w;
        newH = ratioApplied.h;
        // Determine direction from start to current
        const goRight = clampX >= cropDragStart.x;
        const goDown = clampY >= cropDragStart.y;
        const newX = goRight ? cropDragStart.x : cropDragStart.x - newW;
        const newY = goDown ? cropDragStart.y : cropDragStart.y - newH;
        setCropRect({ x: newX, y: newY, w: newW, h: newH });
      } else if (cropDragMode === 'move' && cropDragOrigin) {
        const dx = x - cropDragStart.x;
        const dy = y - cropDragStart.y;
        let newX = cropDragOrigin.x + dx;
        let newY = cropDragOrigin.y + dy;
        // Clamp so crop rect stays within image
        newX = Math.max(imgScreenX, Math.min(newX, imgScreenX + imgScreenW - cropDragOrigin.w));
        newY = Math.max(imgScreenY, Math.min(newY, imgScreenY + imgScreenH - cropDragOrigin.h));
        setCropRect({ x: newX, y: newY, w: cropDragOrigin.w, h: cropDragOrigin.h });
      } else if (cropDragMode.startsWith('resize-') && cropDragOrigin) {
        const corner = cropDragMode.replace('resize-', '');
        let newX = cropDragOrigin.x;
        let newY = cropDragOrigin.y;
        let newW = cropDragOrigin.w;
        let newH = cropDragOrigin.h;

        if (corner.includes('r')) {
          newW = clampX - cropDragOrigin.x;
        }
        if (corner.includes('l')) {
          const right = cropDragOrigin.x + cropDragOrigin.w;
          newX = clampX;
          newW = right - clampX;
        }
        if (corner.includes('b')) {
          newH = clampY - cropDragOrigin.y;
        }
        if (corner.includes('t')) {
          const bottom = cropDragOrigin.y + cropDragOrigin.h;
          newY = clampY;
          newH = bottom - clampY;
        }

        // Ensure positive dimensions
        if (newW < 10) { newW = 10; }
        if (newH < 10) { newH = 10; }

        // Apply ratio constraint
        const ratioApplied = applyRatio(newW, newH);
        if (cropRatio !== 'free') {
          if (corner.includes('l')) {
            newX = cropDragOrigin.x + cropDragOrigin.w - ratioApplied.w;
          }
          if (corner.includes('t')) {
            newY = cropDragOrigin.y + cropDragOrigin.h - ratioApplied.h;
          }
          newW = ratioApplied.w;
          newH = ratioApplied.h;
        }

        // Clamp to image bounds
        newX = Math.max(imgScreenX, newX);
        newY = Math.max(imgScreenY, newY);
        if (newX + newW > imgScreenX + imgScreenW) newW = imgScreenX + imgScreenW - newX;
        if (newY + newH > imgScreenY + imgScreenH) newH = imgScreenY + imgScreenH - newY;

        setCropRect({ x: newX, y: newY, w: newW, h: newH });
      }
    }
  }, [editMode, editImageId, images, cropDragStart, cropDragMode, cropDragOrigin, cropRatio, zoom, viewOffset]);

  const handleEditMouseUp = useCallback(() => {
    if (isDrawingRef.current) {
      // Finalize current stroke
      const stroke = currentStrokeRef.current;
      if (stroke.length > 1) {
        setEditStrokes(prev => [...prev, stroke]);
      }
      currentStrokeRef.current = [];
      setCurrentStroke([]);
      isDrawingRef.current = false;
      setStrokesVersion(v => v + 1);
    }
    if (cropDragMode === 'create') {
      setCropRect(prev => (prev && (prev.w < 4 || prev.h < 4) ? null : prev));
    }
    setCropDragStart(null);
    setCropDragMode('create');
    setCropDragOrigin(null);
  }, [cropDragMode]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Skip if event originates from a floating panel/popup/modal/toolbar
    const target = e.target as HTMLElement;
    if (target?.closest?.('[data-floating-panel], [data-popup], [data-modal], [data-toolbar], [data-compare-dialog]')) {
      return;
    }

    // Close any open model dropdown
    setOpenModelDropdownGroupId(null);

    // Click on blank canvas area: close done annotation bubbles
    if (!annotationMode && editMode === 'none' && e.button === 0) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      const hitId = hitTestImage(canvasPos.x, canvasPos.y);
      if (!hitId) {
        // Clicked blank area - close any "done" annotation bubbles that aren't explicitly expanded
        const hasDoneBubbles = annotations.some(a => a.status === 'done' && a.chatExpanded !== false);
        if (hasDoneBubbles) {
          setAnnotations(prev => prev.map(a =>
            a.status === 'done' ? { ...a, chatExpanded: false } : a
          ));
        }
      }
    }

    if (editMode !== 'none') {
      handleEditMouseDown(e);
      return;
    }

    // ChatCanvas annotation mode: click=pin, drag=region/brush
    if (annotationMode && e.button === 0) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      // Brush mode: use selected image (preferred) or hit-test image
      let targetImageId: string | null = null;
      if (annotationTool === 'brush') {
        // Prefer currently selected image
        if (selectedIds.size === 1) {
          targetImageId = Array.from(selectedIds)[0];
        }
        // Fallback to hit-test if no image selected
        if (!targetImageId) {
          targetImageId = hitTestImage(canvasPos.x, canvasPos.y);
        }
      } else {
        targetImageId = hitTestImage(canvasPos.x, canvasPos.y);
      }

      if (annotationTool === 'brush') {
        if (!targetImageId) {
          // No target image for brush — show a brief toast and ignore
          toast.error('请先选择一张图片，或在图片上开始画笔批注');
          return;
        }
        // Brush mode: create annotation + start drawing on canvas overlay
        const targetImg = images.find(i => i.id === targetImageId);
        if (targetImg) {
          const newAnn = createAnnotation(canvasPos.x, canvasPos.y, '', targetImageId, undefined);
          newAnn.brushColor = annotationBrushColor;
          setAnnotations(prev => [...prev, newAnn]);
          setEditingAnnotationId(newAnn.id);
          setBrushDrawingAnnId(newAnn.id);
          brushDrawingAnnIdRef.current = newAnn.id;

          // Initialize brush canvas overlay for this image — use original dimensions
          const overlayW = targetImg.originalWidth || targetImg.width;
          const overlayH = targetImg.originalHeight || targetImg.height;
          const scaleRatioX = overlayW / targetImg.width;
          const scaleRatioY = overlayH / targetImg.height;
          const overlayCanvas = document.createElement('canvas');
          overlayCanvas.width = overlayW;
          overlayCanvas.height = overlayH;
          const ctx = overlayCanvas.getContext('2d');
          if (ctx) {
            // Black background = keep area
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          }
          brushCanvasRef.current = overlayCanvas;
          brushCtxRef.current = ctx;
          isBrushDrawingRef.current = true;
          // Store scale ratios for coordinate conversion
          brushScaleRef.current = { x: scaleRatioX, y: scaleRatioY };
          // Start live preview stroke path (clamped to image bounds)
          const firstClampedX = Math.max(targetImg.x, Math.min(canvasPos.x, targetImg.x + targetImg.width));
          const firstClampedY = Math.max(targetImg.y, Math.min(canvasPos.y, targetImg.y + targetImg.height));
          const firstScreenX = firstClampedX * zoom + viewOffset.x;
          const firstScreenY = firstClampedY * zoom + viewOffset.y;
          brushStrokesRef.current = [{ x: firstScreenX, y: firstScreenY }];
          setBrushStrokes([{ x: firstScreenX, y: firstScreenY }]);

          // Draw first brush point (clamped to image bounds)
          if (ctx) {
            const clampedX = Math.max(targetImg.x, Math.min(canvasPos.x, targetImg.x + targetImg.width));
            const clampedY = Math.max(targetImg.y, Math.min(canvasPos.y, targetImg.y + targetImg.height));
            const relX = (clampedX - targetImg.x) * scaleRatioX;
            const relY = (clampedY - targetImg.y) * scaleRatioY;
            const scaledBrushR = (annotationBrushSize / 2) * scaleRatioX;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(relX, relY, scaledBrushR, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (annotationTool === 'region' || (annotationTool === 'pin')) {
        // Pin / Region mode: start potential region drag (allow from any area)
        setAnnotationRegionStart({ cx: canvasPos.x, cy: canvasPos.y });
        setAnnotationRegionCurrent({ cx: canvasPos.x, cy: canvasPos.y });
        setIsDraggingRegion(false);
      }
      return;
    }

    if (e.button === 2) return;

    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };

    // Middle button: pan canvas
    if (e.button === 1) {
      e.preventDefault();
      setIsMiddlePanning(true);
      middlePanStartRef.current = { x: e.clientX - viewOffset.x, y: e.clientY - viewOffset.y };
      middlePanMovedRef.current = false; // 重置移动标记
      return;
    }

    // Space + left click: pan canvas
    if (isSpacePressed) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewOffset.x, y: e.clientY - viewOffset.y });
      return;
    }

    // Check resize handle
    if (selectedIds.size === 1) {
      const selId = Array.from(selectedIds)[0];
      const selImg = images.find(i => i.id === selId);
      if (selImg) {
        const handleSize = 8 / zoom;
        const corners = [
          { name: 'tl', x: selImg.x, y: selImg.y },
          { name: 'tr', x: selImg.x + selImg.width, y: selImg.y },
          { name: 'bl', x: selImg.x, y: selImg.y + selImg.height },
          { name: 'br', x: selImg.x + selImg.width, y: selImg.y + selImg.height },
        ];
        for (const corner of corners) {
          if (Math.abs(canvasPos.x - corner.x) < handleSize &&
              Math.abs(canvasPos.y - corner.y) < handleSize) {
            setResizingImage(selId);
            setResizeCorner(corner.name);
            setResizeStart({ x: canvasPos.x, y: canvasPos.y, w: selImg.width, h: selImg.height, imgX: selImg.x, imgY: selImg.y });
            return;
          }
        }
      }
    }

    const hitId = hitTestImage(canvasPos.x, canvasPos.y);
    if (hitId) {
      // Image compare: selecting second image
      if (compareSelecting && compareImages.left && hitId !== compareImages.left.id) {
        const rightImg = images.find(i => i.id === hitId);
        if (rightImg) {
          setCompareImages(prev => ({ ...prev, right: rightImg }));
          setCompareSelecting(false);
          setShowCompareDialog(true);
          return;
        }
      }
      mouseDownOnImageRef.current = true;
      imageDragReadyRef.current = false;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click is handled entirely by onClick on the image div to avoid double-toggle
        mouseDownOnImageRef.current = true;
        return;
      } else if (!selectedIds.has(hitId)) {
        setSelectedIds(new Set([hitId]));
        selectImage(hitId);
      }
      // Start long press timer for drag (user must hold 200ms before dragging)
      setDragTarget(hitId);
      setDragStart(canvasPos);
      setDragOffset({ x: 0, y: 0 });
      longPressTimerRef.current = setTimeout(() => {
        imageDragReadyRef.current = true;
      }, 200);
    } else {
      mouseDownOnImageRef.current = false;
      imageDragReadyRef.current = false;
      setSelectedIds(new Set());
      selectImage(null);
      setActiveTool('none');
      setShowDownloadPopup(false);
      // Box select: left-click drag on blank area immediately starts box selection
      setBoxSelectStart({ x: e.clientX, y: e.clientY });
      setBoxSelectEnd({ x: e.clientX, y: e.clientY });
    }
  }, [isSpacePressed, viewOffset, selectedIds, images, screenToCanvas, hitTestImage, selectImage, editMode, zoom, handleEditMouseDown, compareSelecting, compareImages, annotationMode, annotationTool, annotationBrushSize, annotationBrushColor, annotations]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Annotation region drag tracking or brush drawing
    if (annotationMode && (annotationRegionStart || isBrushDrawingRef.current)) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);

      // Brush drawing (clamped to image bounds)
      const activeBrushDrawingAnnId = brushDrawingAnnIdRef.current;
      if (isBrushDrawingRef.current && activeBrushDrawingAnnId && brushCtxRef.current) {
        const ann = annotations.find(a => a.id === activeBrushDrawingAnnId);
        const targetImg = ann?.targetImageId ? images.find(i => i.id === ann.targetImageId) : null;
        if (targetImg) {
          const scaleRatio = brushScaleRef.current;
          // Clamp canvas position to image bounds
          const clampedX = Math.max(targetImg.x, Math.min(canvasPos.x, targetImg.x + targetImg.width));
          const clampedY = Math.max(targetImg.y, Math.min(canvasPos.y, targetImg.y + targetImg.height));
          const relX = (clampedX - targetImg.x) * scaleRatio.x;
          const relY = (clampedY - targetImg.y) * scaleRatio.y;
          const scaledBrushR = (annotationBrushSize / 2) * scaleRatio.x;
          brushCtxRef.current.fillStyle = '#ffffff';
          brushCtxRef.current.beginPath();
          brushCtxRef.current.arc(relX, relY, scaledBrushR, 0, Math.PI * 2);
          brushCtxRef.current.fill();
          // Add point for live preview (use clamped screen position)
          const clampedScreenX = clampedX * zoom + viewOffset.x;
          const clampedScreenY = clampedY * zoom + viewOffset.y;
          brushStrokesRef.current.push({ x: clampedScreenX, y: clampedScreenY });
          setBrushStrokes([...brushStrokesRef.current]);
        }
        return;
      }

      // Region drag tracking
      if (annotationRegionStart) {
        setAnnotationRegionCurrent({ cx: canvasPos.x, cy: canvasPos.y });
        const dx = canvasPos.x - annotationRegionStart.cx;
        const dy = canvasPos.y - annotationRegionStart.cy;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          setIsDraggingRegion(true);
        }
      }
      return;
    }

    if (editMode !== 'none') {
      handleEditMouseMove(e);
      return;
    }
    const canvasPos = screenToCanvas(e.clientX, e.clientY);

    // Middle button panning
    if (isMiddlePanning) {
      middlePanMovedRef.current = true; // 标记已移动，防止 auxclick 误触发缩放重置
      const mx = e.clientX - middlePanStartRef.current.x;
      const my = e.clientY - middlePanStartRef.current.y;
      if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
      panRafRef.current = requestAnimationFrame(() => {
        const el = canvasTransformRef.current;
        if (el) {
          el.style.transform = `translate(${mx}px, ${my}px) scale(${zoom})`;
        }
        panRafRef.current = null;
      });
      return;
    }

    if (isPanning) {
      // 使用 rAF + 直接 DOM 操作，避免每帧触发 React 重渲染
      const newX = e.clientX - panStart.x;
      const newY = e.clientY - panStart.y;
      if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
      panRafRef.current = requestAnimationFrame(() => {
        const el = canvasTransformRef.current;
        if (el) {
          el.style.transform = `translate(${newX}px, ${newY}px) scale(${zoom})`;
        }
        panRafRef.current = null;
      });
      return;
    }

    // Box select (left-click drag on blank area)
    if (boxSelectStart) {
      setBoxSelectEnd({ x: e.clientX, y: e.clientY });
      return;
    }

    if (resizingImage && resizeCorner) {
      const img = images.find(i => i.id === resizingImage);
      if (!img) return;
      const dx = canvasPos.x - resizeStart.x;
      const aspect = resizeStart.w / resizeStart.h;
      let newW = resizeStart.w;
      let newH = resizeStart.h;
      let newX = resizeStart.imgX;
      let newY = resizeStart.imgY;

      if (resizeCorner === 'br') {
        newW = Math.max(40, resizeStart.w + dx);
        newH = newW / aspect;
      } else if (resizeCorner === 'bl') {
        newW = Math.max(40, resizeStart.w - dx);
        newH = newW / aspect;
        newX = resizeStart.imgX + (resizeStart.w - newW);
      } else if (resizeCorner === 'tr') {
        newW = Math.max(40, resizeStart.w + dx);
        newH = newW / aspect;
        newY = resizeStart.imgY + (resizeStart.h - newH);
      } else if (resizeCorner === 'tl') {
        newW = Math.max(40, resizeStart.w - dx);
        newH = newW / aspect;
        newX = resizeStart.imgX + (resizeStart.w - newW);
        newY = resizeStart.imgY + (resizeStart.h - newH);
      }

      // Update resize preview (only apply to images on mouseup — avoids flooding undo history)
      setResizePreview({ x: newX, y: newY, width: newW, height: newH });
      return;
    }

    // Image drag: only allow after long press (imageDragReadyRef)
    if (dragTarget && imageDragReadyRef.current) {
      const rawOffsetX = canvasPos.x - dragStart.x;
      const rawOffsetY = canvasPos.y - dragStart.y;

      // Compute snap guides for alignment assist
      let offsetX = rawOffsetX;
      let offsetY = rawOffsetY;
      let guides: SnapGuide[] = [];

      if (snapEnabledRef.current && editMode === 'none') {
        const draggedImg = images.find(i => i.id === dragTarget);
        if (draggedImg) {
          const dragBounds = {
            id: draggedImg.id,
            x: draggedImg.x + rawOffsetX,
            y: draggedImg.y + rawOffsetY,
            width: draggedImg.width,
            height: draggedImg.height,
          };
          const allBounds = images.map(img => ({
            id: img.id, x: img.x, y: img.y, width: img.width, height: img.height,
          }));
          guides = computeSnapGuides(dragBounds, allBounds, 6);
          const { dx, dy } = findBestSnapOffset(guides);
          offsetX = rawOffsetX + dx;
          offsetY = rawOffsetY + dy;
        }
      }
      // ── Hover detection: check if dragged image is over a GenGroup container ──
      let hoveredGroup: string | null = null;
      if (imageDragReadyRef.current && dragTarget) {
        const draggedImg = images.find(i => i.id === dragTarget);
        if (draggedImg) {
          const imgCX = draggedImg.x + offsetX + draggedImg.width / 2;
          const imgCY = draggedImg.y + offsetY + draggedImg.height / 2;
          for (const gGroup of genGroupsRef.current) {
            const srcImgs = gGroup.sourceImageIds
              .map(sid => images.find(i => i.id === sid))
              .filter(Boolean) as CanvasImage[];
            if (srcImgs.length === 0) continue;
            const allBounds = [
              ...srcImgs.map(si => ({ x: si.x, y: si.y, w: si.width, h: si.height })),
              { x: gGroup.resultPlaceholder.x, y: gGroup.resultPlaceholder.y, w: gGroup.resultPlaceholder.width, h: gGroup.resultPlaceholder.height + 200 },
            ];
            const cPad = 24;
            const cMinX = Math.min(...allBounds.map(b => b.x)) - cPad;
            const cMinY = Math.min(...allBounds.map(b => b.y)) - cPad - 40;
            const cMaxX = Math.max(...allBounds.map(b => b.x + b.w)) + cPad;
            const cMaxY = Math.max(...allBounds.map(b => b.y + b.h)) + cPad;
            if (imgCX >= cMinX && imgCX <= cMaxX && imgCY >= cMinY && imgCY <= cMaxY) {
              hoveredGroup = gGroup.id;
              break;
            }
          }
        }
      }
      // RAF-throttled state updates for drag performance
      dragOffsetRef.current = { x: offsetX, y: offsetY };
      snapGuidesRef.current = guides;
      hoveredGenGroupIdRef.current = hoveredGroup;
      if (dragRafRef.current === null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          setDragOffset(dragOffsetRef.current);
          setActiveSnapGuides(snapGuidesRef.current);
          setHoveredGenGroupId(hoveredGenGroupIdRef.current);
        });
      }
    }

    // Group drag: only allow after long press (groupDragReadyRef)
    if (groupDragTarget && groupDragReadyRef.current) {
      const offsetX = canvasPos.x - groupDragStart.x;
      const offsetY = canvasPos.y - groupDragStart.y;
      setGroupDragOffset({ x: offsetX, y: offsetY });
    }

    // GenGroup drag: only allow after long press (genGroupDragReadyRef)
    if (genGroupDragTarget && genGroupDragReadyRef.current) {
      const offsetX = canvasPos.x - genGroupDragStart.x;
      const offsetY = canvasPos.y - genGroupDragStart.y;
      setGenGroupDragOffset({ x: offsetX, y: offsetY });
    }
    // HexCube drag (screen coordinates for floating panel)
    if (hexCubeDragTarget && hexCubeDragReadyRef.current) {
      const offsetX = e.clientX - hexCubeDragStart.x;
      const offsetY = e.clientY - hexCubeDragStart.y;
      setHexCubeDragOffset({ x: offsetX, y: offsetY });
    }
  }, [annotationMode, annotationRegionStart, editMode, screenToCanvas, isMiddlePanning, isPanning, boxSelectStart, resizingImage, resizeCorner, dragTarget, groupDragTarget, genGroupDragTarget, hexCubeDragTarget, annotations, images, annotationBrushSize, zoom, viewOffset.x, viewOffset.y, handleEditMouseMove, panStart.x, panStart.y, resizeStart.x, resizeStart.w, resizeStart.h, resizeStart.imgX, resizeStart.imgY, dragStart.x, dragStart.y, groupDragStart.x, groupDragStart.y, genGroupDragStart.x, genGroupDragStart.y, hexCubeDragStart.x, hexCubeDragStart.y]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Brush drawing completion
    const activeBrushDrawingAnnId = brushDrawingAnnIdRef.current;
    if (isBrushDrawingRef.current && activeBrushDrawingAnnId && brushCanvasRef.current) {
      isBrushDrawingRef.current = false;
      // Export brush mask as data URL and save to annotation
      const maskDataUrl = brushCanvasRef.current.toDataURL('image/png');
      setAnnotations(prev => prev.map(a =>
        a.id === activeBrushDrawingAnnId ? { ...a, brushMaskDataUrl: maskDataUrl } : a
      ));
      setBrushDrawingAnnId(null);
      brushDrawingAnnIdRef.current = null;
      brushCanvasRef.current = null;
      brushCtxRef.current = null;
      brushStrokesRef.current = [];
      setBrushStrokes([]);
      // Focus the annotation input
      setTimeout(() => annotationInputRef.current?.focus(), 50);
      return;
    }

    // Annotation region drag completion
    if (annotationRegionStart && annotationMode && isDraggingRegion && annotationRegionCurrent) {
      const x1 = Math.min(annotationRegionStart.cx, annotationRegionCurrent.cx);
      const y1 = Math.min(annotationRegionStart.cy, annotationRegionCurrent.cy);
      const x2 = Math.max(annotationRegionStart.cx, annotationRegionCurrent.cx);
      const y2 = Math.max(annotationRegionStart.cy, annotationRegionCurrent.cy);
      const w = x2 - x1;
      const h = y2 - y1;
      if (w > 15 && h > 15) {
        // Hit test to find target image
        const hitId = hitTestImage(annotationRegionStart.cx, annotationRegionStart.cy);
        // Normalize region coordinates relative to target image
        let region: AnnotationRegion | undefined;
        if (hitId) {
          const hitImg = images.find(i => i.id === hitId);
          if (hitImg) {
            region = {
              x: Math.max(0, Math.min(1, (x1 - hitImg.x) / hitImg.width)),
              y: Math.max(0, Math.min(1, (y1 - hitImg.y) / hitImg.height)),
              w: Math.min(1, w / hitImg.width),
              h: Math.min(1, h / hitImg.height),
            };
          }
        }
        const newAnn = createAnnotation((x1 + x2) / 2, (y1 + y2) / 2, '', hitId, region);
        setAnnotations(prev => [...prev, newAnn]);
        setEditingAnnotationId(newAnn.id);
        setAnnotationInputText('');
        setTimeout(() => annotationInputRef.current?.focus(), 50);
      }
      setAnnotationRegionStart(null);
      setAnnotationRegionCurrent(null);
      setIsDraggingRegion(false);
      return;
    }
    // Clean up annotation region state
    if (annotationRegionStart && annotationMode) {
      if (!isDraggingRegion) {
        // No actual drag happened — only create Pin in 'pin' mode
        if (annotationTool === 'pin') {
          const canvasPos = screenToCanvas(e.clientX, e.clientY);
          const targetImageId = hitTestImage(canvasPos.x, canvasPos.y);
          if (targetImageId) {
            const newAnn = createAnnotation(canvasPos.x, canvasPos.y, '', targetImageId);
            setAnnotations(prev => [...prev, newAnn]);
            setEditingAnnotationId(newAnn.id);
            setAnnotationInputText('');
            setTimeout(() => annotationInputRef.current?.focus(), 50);
          }
        }
        // In 'region' mode: click without drag = do nothing (user cancelled)
      }
      setAnnotationRegionStart(null);
      setAnnotationRegionCurrent(null);
      setIsDraggingRegion(false);
    }

    if (editMode !== 'none') {
      handleEditMouseUp();
      return;
    }

    // Middle button up: stop middle panning
    if (isMiddlePanning && e.button === 1) {
      // 中键平移结束：同步 DOM 位置回 React state
      if (canvasTransformRef.current) {
        const currentTransform = canvasTransformRef.current.style.transform;
        const translateMatch = currentTransform.match(/translate\(([^)]+)\)/);
        if (translateMatch) {
          const [tx, ty] = translateMatch[1].split(',').map(Number);
          setViewOffset({ x: tx, y: ty });
        }
      }
      setIsMiddlePanning(false);
      return;
    }

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isPanning) {
      // 平移结束，从 DOM 同步回 React state
      const el = canvasTransformRef.current;
      if (el) {
        const style = el.style.transform;
        const match = style.match(/translate\(([^)]+)px,\s*([^)]+)px\)/);
        if (match) {
          setViewOffset({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
        }
      }
      setIsPanning(false);
      setIsLongPressing(false);
      return;
    }

    if (boxSelectStart && boxSelectEnd) {
      const selectDx = Math.abs(boxSelectEnd.x - boxSelectStart.x);
      const selectDy = Math.abs(boxSelectEnd.y - boxSelectStart.y);
      // Only select images if the drag distance is meaningful (> 5px)
      if (selectDx > 5 || selectDy > 5) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const left = Math.min(boxSelectStart.x, boxSelectEnd.x) - rect.left;
          const top = Math.min(boxSelectStart.y, boxSelectEnd.y) - rect.top;
          const right = Math.max(boxSelectStart.x, boxSelectEnd.x) - rect.left;
          const bottom = Math.max(boxSelectStart.y, boxSelectEnd.y) - rect.top;

          const selected = new Set<string>();
          // Collect gen group result image IDs to exclude from selection (they're hidden on canvas)
          const genGroupResultIds = new Set<string>();
          genGroups.forEach(g => { if (g.resultImageIds) g.resultImageIds.forEach(id => genGroupResultIds.add(id)); });
          // Use spatial index for O(log n + k) box selection instead of O(n) linear scan
          const canvasLeft = screenToCanvas(left + (rect?.left || 0), top + (rect?.top || 0));
          const canvasRight = screenToCanvas(right + (rect?.left || 0), bottom + (rect?.top || 0));
          const hitIds = spatialIndexRef.current?.searchInBounds(
            canvasLeft.x, canvasLeft.y,
            canvasRight.x, canvasRight.y,
          ) ?? [];
          for (const id of hitIds) {
            if (!genGroupResultIds.has(id)) {
              selected.add(id);
            }
          }
          if (selected.size > 0) {
            setSelectedIds(selected);
          }
        }
      }
      setBoxSelectStart(null);
      setBoxSelectEnd(null);
      setIsLongPressing(false);
    }

    // Apply resize preview to images (single history entry instead of one per mousemove)
    if (resizingImage && resizePreview) {
      onImagesChange(images.map(i =>
        i.id === resizingImage ? { ...i, x: resizePreview.x, y: resizePreview.y, width: resizePreview.width, height: resizePreview.height } : i
      ));
    }
    setResizePreview(null);

    setResizingImage(null);
    setResizeCorner(null);

    if (dragTarget) {
      if (imageDragReadyRef.current && (dragOffset.x !== 0 || dragOffset.y !== 0)) {
        const updatedImages = images.map(img => {
          if (selectedIds.has(img.id)) {
            return { ...img, x: img.x + dragOffset.x, y: img.y + dragOffset.y };
          }
          return img;
        });
        onImagesChange(updatedImages);

        // ── Drag-in/Drag-out detection for GenGroups ──
        // For each dragged image, check if it landed inside a GenGroup container
        for (const imgId of selectedIds) {
          const draggedImg = updatedImages.find(i => i.id === imgId);
          if (!draggedImg) continue;
          const imgCX = draggedImg.x + draggedImg.width / 2;
          const imgCY = draggedImg.y + draggedImg.height / 2;

          for (const gGroup of genGroupsRef.current) {
            const srcImgs = gGroup.sourceImageIds
              .map(sid => images.find(i => i.id === sid))
              .filter(Boolean) as CanvasImage[];
            if (srcImgs.length === 0) continue;

            // Calculate container bounds (same logic as render)
            const allBounds = [
              ...srcImgs.map(si => ({ x: si.x, y: si.y, w: si.width, h: si.height })),
              { x: gGroup.resultPlaceholder.x, y: gGroup.resultPlaceholder.y, w: gGroup.resultPlaceholder.width, h: gGroup.resultPlaceholder.height + 200 },
            ];
            const cPad = 24;
            const cMinX = Math.min(...allBounds.map(b => b.x)) - cPad;
            const cMinY = Math.min(...allBounds.map(b => b.y)) - cPad - 40;
            const cMaxX = Math.max(...allBounds.map(b => b.x + b.w)) + cPad;
            const cMaxY = Math.max(...allBounds.map(b => b.y + b.h)) + cPad;

            const isInside = imgCX >= cMinX && imgCX <= cMaxX && imgCY >= cMinY && imgCY <= cMaxY;

            if (isInside && !gGroup.sourceImageIds.includes(imgId)) {
              // ── Drag IN: add image to this group as reference ──
              if (gGroup.sourceImageIds.length < 14) {
                const nextNum = gGroup.refImages.length + 1;
                setGenGroups(prev => prev.map(g => {
                  if (g.id !== gGroup.id) return g;
                  return {
                    ...g,
                    sourceImageIds: [...g.sourceImageIds, imgId],
                    refImages: [...g.refImages, {
                      imageId: imgId,
                      url: draggedImg.url,
                      number: nextNum,
                      categories: [],
                      strengths: {},
                    }],
                    sourceCategories: { ...g.sourceCategories, [imgId]: [] },
                    sourceStrengths: { ...g.sourceStrengths, [imgId]: {} },
                  };
                }));
              }
            } else if (!isInside && gGroup.sourceImageIds.includes(imgId)) {
              // ── Drag OUT: remove image from this group ──
              removeRefFromGroupRef.current(gGroup.id, imgId);
            }
          }
        }
      }
      setDragTarget(null);
      // Cancel any pending RAF and reset drag refs
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      dragOffsetRef.current = { x: 0, y: 0 };
      setDragOffset({ x: 0, y: 0 });
      setHoveredGenGroupId(null);
      imageDragReadyRef.current = false;
      setActiveSnapGuides([]); // Clear snap guides when drag ends
    }

    // Group drag finish
    if (groupDragTarget) {
      if (groupDragReadyRef.current && (groupDragOffset.x !== 0 || groupDragOffset.y !== 0)) {
        // Move all images in the group by the drag offset
        onImagesChange(images.map(img => {
          if (img.groupId === groupDragTarget) {
            return { ...img, x: img.x + groupDragOffset.x, y: img.y + groupDragOffset.y };
          }
          return img;
        }));
      }
      setGroupDragTarget(null);
      setGroupDragOffset({ x: 0, y: 0 });
      groupDragReadyRef.current = false;
    }
    if (groupDragTimerRef.current) {
      clearTimeout(groupDragTimerRef.current);
      groupDragTimerRef.current = null;
    }

    // GenGroup drag finish
    if (genGroupDragTarget) {
      if (genGroupDragReadyRef.current && (genGroupDragOffset.x !== 0 || genGroupDragOffset.y !== 0)) {
        const dx = genGroupDragOffset.x;
        const dy = genGroupDragOffset.y;
        // Move all reference images in the gen group
        const updatedImages = images.map(img => {
          const ref = genGroupsRef.current.find(g => g.id === genGroupDragTarget)?.sourceImageIds.includes(img.id);
          if (ref) return { ...img, x: img.x + dx, y: img.y + dy };
          return img;
        });
        onImagesChange(updatedImages);
        // Move the gen group's resultPlaceholder position
        setGenGroups(prev => prev.map(g => {
          if (g.id === genGroupDragTarget) {
            return {
              ...g,
              position: {
                ...g.position,
                x: g.position.x + dx,
                y: g.position.y + dy,
                sourceCenterX: (g.position.sourceCenterX ?? 0) + dx,
                sourceCenterY: (g.position.sourceCenterY ?? 0) + dy,
                resultX: (g.position.resultX ?? g.resultPlaceholder.x) + dx,
                resultY: (g.position.resultY ?? g.resultPlaceholder.y) + dy,
              },
              resultPlaceholder: {
                ...g.resultPlaceholder,
                x: g.resultPlaceholder.x + dx,
                y: g.resultPlaceholder.y + dy,
              },
            };
          }
          return g;
        }));
      }
      setGenGroupDragTarget(null);
      setGenGroupDragOffset({ x: 0, y: 0 });
      genGroupDragReadyRef.current = false;
    }
    if (genGroupDragTimerRef.current) {
      clearTimeout(genGroupDragTimerRef.current);
      genGroupDragTimerRef.current = null;
    }

    // HexCube drag end (convert screen offset to canvas offset)
    if (hexCubeDragTarget && hexCubeDragReadyRef.current && hexCubeDragOffset.x !== 0 && hexCubeDragOffset.y !== 0) {
      setHexCubeGroups(prev => prev.map(g => {
        if (g.id === hexCubeDragTarget) {
          return { ...g, position: { x: g.position.x + hexCubeDragOffset.x / zoom, y: g.position.y + hexCubeDragOffset.y / zoom } };
        }
        return g;
      }));
    }
    if (hexCubeDragTarget) {
      setHexCubeDragTarget(null);
      setHexCubeDragOffset({ x: 0, y: 0 });
      hexCubeDragReadyRef.current = false;
    }
    if (hexCubeDragTimerRef.current) {
      clearTimeout(hexCubeDragTimerRef.current);
      hexCubeDragTimerRef.current = null;
    }

    mouseDownOnImageRef.current = false;
  }, [annotationRegionStart, annotationMode, isDraggingRegion, annotationRegionCurrent, editMode, isMiddlePanning, isPanning, boxSelectStart, boxSelectEnd, resizingImage, resizePreview, dragTarget, groupDragTarget, genGroupDragTarget, hexCubeDragTarget, hexCubeDragOffset.x, hexCubeDragOffset.y, hitTestImage, images, annotationTool, screenToCanvas, handleEditMouseUp, genGroups, onImagesChange, dragOffset.x, dragOffset.y, selectedIds, groupDragOffset.x, groupDragOffset.y, genGroupDragOffset.x, genGroupDragOffset.y, zoom]);

  const handleMouseLeave = useCallback(() => {
    if (editMode !== 'none') {
      handleEditMouseUp();
      return;
    }
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsPanning(false);
    // 平移结束：同步 DOM 位置回 React state
    if (canvasTransformRef.current) {
      const style = canvasTransformRef.current.style.transform;
      const match = style.match(/translate\(([^)]+)px,\s*([^)]+)px\)/);
      if (match) {
        setViewOffset({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
      }
    }
    setIsMiddlePanning(false);
    setIsLongPressing(false);
    setBoxSelectStart(null);
    setBoxSelectEnd(null);
    setResizingImage(null);
    setResizeCorner(null);
    brushCursorPosRef.current = null;
    if (dragTarget) {
      setDragTarget(null);
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      dragOffsetRef.current = { x: 0, y: 0 };
      setDragOffset({ x: 0, y: 0 });
      imageDragReadyRef.current = false;
    }
    if (groupDragTarget) {
      setGroupDragTarget(null);
      setGroupDragOffset({ x: 0, y: 0 });
      groupDragReadyRef.current = false;
    }
    if (groupDragTimerRef.current) {
      clearTimeout(groupDragTimerRef.current);
      groupDragTimerRef.current = null;
    }
  }, [dragTarget, editMode, groupDragTarget, handleEditMouseUp]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Prevent scroll from affecting canvas when cursor is over a modal/overlay/popup
    const target = e.target as HTMLElement;
    const isInsideFloatingUI = target.closest(
      '.fixed, [data-modal], [data-popup], [data-toolbar], [data-floating-panel], [data-compare-dialog]'
    );
    if (isInsideFloatingUI) return;
    const isInsideCanvas = canvasRef.current?.contains(target);
    if (!isInsideCanvas) return;
    e.preventDefault();

    // In erase/mask mode, scroll adjusts brush size (like IOPaint/Photoshop)
    if ((editMode === 'erase' || editMode === 'mask') && !e.ctrlKey && !e.metaKey) {
      const delta = e.deltaY > 0 ? -5 : 5;
      setBrushSize(prev => Math.max(5, Math.min(200, prev + delta)));
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      // Ctrl + scroll: zoom canvas centered on mouse
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5, zoom * delta));
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const newOffsetX = mouseX - (mouseX - viewOffset.x) * (newZoom / zoom);
      const newOffsetY = mouseY - (mouseY - viewOffset.y) * (newZoom / zoom);
      setZoom(newZoom);
      setViewOffset({ x: newOffsetX, y: newOffsetY });
    } else {
      // Scroll without Ctrl: vertical scroll canvas
      setViewOffset(prev => ({
        x: prev.x - (e.deltaX || 0),
        y: prev.y - e.deltaY,
      }));
    }
  }, [zoom, viewOffset, editMode]);

  // Double-click middle button: reset view to 100% centered on mouse
  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) {
      // 中键拖动过则跳过缩放重置（防止拖动后误触发）
      if (middlePanMovedRef.current) return;
      // Middle button double-click: center on mouse at 100%
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      // Reset to 100% zoom, centered on mouse position
      setZoom(1);
      setViewOffset({
        x: mouseX - (mouseX - viewOffset.x) * (1 / zoom),
        y: mouseY - (mouseY - viewOffset.y) * (1 / zoom),
      });
    }
  }, [zoom, viewOffset]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    const hitId = hitTestImage(canvasPos.x, canvasPos.y);

    if (hitId) {
      if (!selectedIds.has(hitId)) {
        // If multi-select is active, add the clicked image to selection instead of replacing
        if (selectedIds.size > 1) {
          setSelectedIds(new Set([...selectedIds, hitId]));
          selectImage(hitId);
        } else {
          setSelectedIds(new Set([hitId]));
          selectImage(hitId);
        }
      }
      setContextMenuPos({ x: e.clientX, y: e.clientY });
      setShowContextMenu(true);
      setShowCanvasMenu(false);
    } else {
      setCanvasMenuPos({ x: e.clientX, y: e.clientY });
      setShowCanvasMenu(true);
      setShowContextMenu(false);
    }
  }, [screenToCanvas, hitTestImage, selectedIds, selectImage]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      const promises = files.map(file =>
        new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onload = (event) => resolve((event.target?.result as string) || '');
          reader.readAsDataURL(file);
        })
      );
      Promise.allSettled(promises).then(results => {
        const validUrls = results.filter(r => r.status === 'fulfilled' && r.value).map(r => (r as PromiseFulfilledResult<string>).value);
        if (validUrls.length > 0) onAddImages(validUrls);
      });
    }
  }, [onAddImages]);

  const handleCanvasImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // ★ 大文件自动压缩（>1MB 的图片压缩到 2048px 以内）
      const promises = Array.from(files).map(async file => {
        try {
          if (file.size > 1024 * 1024) {
            // 大于 1MB，先压缩
            const { compressImage } = await import('@/lib/image-compress');
            const result = await compressImage(file, {
              maxWidth: 2048,
              maxHeight: 2048,
              quality: 0.85,
              format: 'jpeg',
              maxSizeKB: 1024,
            });
            return result.dataUrl;
          }
          // 小文件直接读取
          return await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onload = event => resolve((event.target?.result as string) || '');
            reader.readAsDataURL(file);
          });
        } catch {
          // 压缩失败，回退到直接读取
          return await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onload = event => resolve((event.target?.result as string) || '');
            reader.readAsDataURL(file);
          });
        }
      });
      try {
        const results = await Promise.allSettled(promises);
        const validUrls = results.filter(r => r.status === 'fulfilled' && r.value).map(r => (r as PromiseFulfilledResult<string>).value);
        if (validUrls.length > 0) onAddImages(validUrls);
      } catch (error) {
        console.error('Failed to read images:', error);
      }
    }
    e.target.value = '';
  };

  // ──────────────── 【调整2&3】生成组：Alt/Ctrl+左键 创建参考图/融图组 ────────────────

  /** Find a position that doesn't overlap with existing images */
  const findNonOverlappingPosition = useCallback((startX: number, startY: number, width: number, height: number, excludeIds: string[]): { x: number; y: number } => {
    const pad = 40;
    const step = 100;
    // Check if a rect overlaps with any existing image
    const rectOverlaps = (rx: number, ry: number, rw: number, rh: number): boolean => {
      for (const img of imagesRef.current) {
        if (excludeIds.includes(img.id)) continue;
        if (rx < img.x + img.width + pad && rx + rw + pad > img.x &&
            ry < img.y + img.height + pad && ry + rh + pad > img.y) {
          return true;
        }
      }
      // Also check existing gen group result placeholders
      for (const g of genGroupsRef.current) {
        const rp = g.resultPlaceholder;
        if (rx < rp.x + rp.width + pad && rx + rw + pad > rp.x &&
            ry < rp.y + rp.height + pad && ry + rh + pad > rp.y) {
          return true;
        }
      }
      return false;
    };

    // Try original position first
    if (!rectOverlaps(startX, startY, width, height)) {
      return { x: startX, y: startY };
    }

    // Spiral search for a free position
    const maxRadius = 5000;
    for (let radius = step; radius < maxRadius; radius += step) {
      // Check positions in a spiral pattern: right, down, left, up
      const positions = [
        { x: startX + radius, y: startY },
        { x: startX, y: startY + radius },
        { x: startX - radius, y: startY },
        { x: startX, y: startY - radius },
      ];
      for (const pos of positions) {
        if (!rectOverlaps(pos.x, pos.y, width, height)) {
          return pos;
        }
      }
      // Diagonal positions
      const diagPositions = [
        { x: startX + radius, y: startY + radius },
        { x: startX + radius, y: startY - radius },
        { x: startX - radius, y: startY + radius },
        { x: startX - radius, y: startY - radius },
      ];
      for (const pos of diagPositions) {
        if (!rectOverlaps(pos.x, pos.y, width, height)) {
          return pos;
        }
      }
    }

    // Fallback: place far to the right
    return { x: startX + 2000, y: startY };
  }, []);

  /** 创建新生成组 */
  const createGenGroupLocal = useCallback((firstImage: CanvasImage, groupType: GenGroupType): CanvasGenGroup => {
    const groupId = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const placeholderId = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const refImg: GroupRefImage = {
      imageId: firstImage.id,
      url: firstImage.url,
      number: 1,
      categories: [],
      strengths: {},
    };
    // 计算结果框位置：先尝试第一张图右侧，然后自动避让
    const defaultResultX = firstImage.x + firstImage.width + 80;
    const defaultResultY = firstImage.y;
    const resultW = firstImage.width;
    const resultH = firstImage.height;
    const resultPos = findNonOverlappingPosition(defaultResultX, defaultResultY, resultW, resultH, [firstImage.id]);
    const { model: currentModel, providerId: currentProviderId } = getCurrentModel();
    // 根据当前模型获取支持的参数
    const initSupportedRatios = findModelConfig(MODEL_ASPECT_RATIOS, currentModel) || DEFAULT_ASPECT_RATIOS;
    const initSupportedQualities = getResolutionTierOptions(currentModel);
    const initAspectRatio = initSupportedRatios.includes('1:1') ? '1:1' : initSupportedRatios[0];
    const initQuality = initSupportedQualities[0] || '1K';
    const initSize = calculateActualPixels(initAspectRatio, initQuality, currentModel);
    const group: CanvasGenGroup = {
      id: groupId,
      type: groupType,
      status: 'idle',
      refImages: [refImg],
      sourceImageIds: [firstImage.id],
      resultPlaceholder: {
        x: resultPos.x,
        y: resultPos.y,
        width: resultW,
        height: resultH,
        aspectRatio: initAspectRatio,
        imageId: placeholderId,
      },
      toolbar: {
        model: currentModel || '',
        providerId: currentProviderId,
        aspectRatio: initAspectRatio,
        size: initSize,
        resolution: initQuality,
        quality: 'auto',
        outputCount: 1,
        n: 1,
        prompt: '',
        negativePrompt: '',
      },
      position: {
        x: firstImage.x,
        y: firstImage.y,
        sourceCenterX: firstImage.x + firstImage.width / 2,
        sourceCenterY: firstImage.y + firstImage.height / 2,
        resultX: resultPos.x,
        resultY: resultPos.y,
      },
      sourceCategories: { [firstImage.id]: [] },
      sourceStrengths: { [firstImage.id]: {} },
      resultImageIds: [],
      createdAt: Date.now(),
    };
    return group;
  }, [getCurrentModel, findNonOverlappingPosition]);

  /** Alt+Click: 追加到参考图组或创建新组 */
  const handleAltClickAddToGroup = useCallback((image: CanvasImage) => {
    setGenGroups(prev => {
      const groupType: GenGroupType = 'reference';
      // 查找同类型的活跃组（status不是completed的最近组）
      const activeGroups = prev.filter(g => g.type === groupType && g.status !== 'completed');
      if (activeGroups.length > 0) {
        const latestGroup = activeGroups[activeGroups.length - 1];
        // 最多14张
        if (latestGroup.refImages.length >= 14) return prev;
        // 不重复添加
        if (latestGroup.refImages.some(r => r.imageId === image.id)) return prev;
        // 追加
        const newRef: GroupRefImage = {
          imageId: image.id,
          url: image.url,
          number: latestGroup.refImages.length + 1,
          categories: [],
          strengths: {},
        };
        const allRefs = [...latestGroup.refImages, newRef];
        const refImageObjs = allRefs
          .map(r => images.find(img => img.id === r.imageId))
          .filter(Boolean) as CanvasImage[];
        const avgX = refImageObjs.reduce((s, img) => s + img.x + img.width / 2, 0) / refImageObjs.length;
        const avgY = refImageObjs.reduce((s, img) => s + img.y + img.height / 2, 0) / refImageObjs.length;
        return prev.map(g => {
          if (g.id !== latestGroup.id) return g;
          return {
            ...g,
            refImages: allRefs,
            sourceImageIds: [...g.sourceImageIds, image.id],
            sourceCategories: { ...g.sourceCategories, [image.id]: [] },
            sourceStrengths: { ...g.sourceStrengths, [image.id]: {} },
            position: { ...g.position, sourceCenterX: avgX, sourceCenterY: avgY },
          };
        });
      }
      // 创建新组
      const newGroup = createGenGroupLocal(image, groupType);
      return [...prev, newGroup];
    });
  }, [createGenGroupLocal, images]);

  /** Ctrl+Click: 追加到融图组或创建新组 */
  const handleCtrlClickAddToGroup = useCallback((image: CanvasImage) => {
    setGenGroups(prev => {
      const groupType: GenGroupType = 'fusion';
      const activeGroups = prev.filter(g => g.type === groupType && g.status !== 'completed');
      if (activeGroups.length > 0) {
        const latestGroup = activeGroups[activeGroups.length - 1];
        if (latestGroup.refImages.length >= 14) return prev;
        if (latestGroup.refImages.some(r => r.imageId === image.id)) return prev;
        const newRef: GroupRefImage = {
          imageId: image.id,
          url: image.url,
          number: latestGroup.refImages.length + 1,
          categories: [],
          strengths: {},
        };
        const allRefs = [...latestGroup.refImages, newRef];
        const refImageObjs = allRefs
          .map(r => images.find(img => img.id === r.imageId))
          .filter(Boolean) as CanvasImage[];
        const avgX = refImageObjs.reduce((s, img) => s + img.x + img.width / 2, 0) / refImageObjs.length;
        const avgY = refImageObjs.reduce((s, img) => s + img.y + img.height / 2, 0) / refImageObjs.length;
        return prev.map(g => {
          if (g.id !== latestGroup.id) return g;
          return {
            ...g,
            refImages: allRefs,
            sourceImageIds: [...g.sourceImageIds, image.id],
            position: { ...g.position, sourceCenterX: avgX, sourceCenterY: avgY },
          };
        });
      }
      const newGroup = createGenGroupLocal(image, groupType);
      return [...prev, newGroup];
    });
  }, [createGenGroupLocal, images]);

  /** 从生成组中移除参考图 */
  const removeRefFromGroup = useCallback((groupId: string, imageId: string) => {
    setGenGroups(prev => {
      return prev.map(g => {
        if (g.id !== groupId) return g;
        const newRefs = g.refImages.filter(r => r.imageId !== imageId);
        // 如果移除后没有参考图了，删除整个组
        if (newRefs.length === 0) return g; // 返回原组，由调用者决定是否删除
        // 重新编号
        const reindexed = newRefs.map((r, i) => ({ ...r, number: i + 1 }));
        const newSourceIds = g.sourceImageIds.filter(id => id !== imageId);
        const newCategories = { ...g.sourceCategories };
        const newStrengths = { ...g.sourceStrengths };
        delete newCategories[imageId];
        delete newStrengths[imageId];
        return { ...g, refImages: reindexed, sourceImageIds: newSourceIds, sourceCategories: newCategories, sourceStrengths: newStrengths };
      }).filter(g => g.refImages.length > 0);
    });
  }, []);
  useEffect(() => { removeRefFromGroupRef.current = removeRefFromGroup; }, [removeRefFromGroup]);


  useCallback((groupId: string, updates: Partial<GenGroupToolbar>) => {
        setGenGroups(prev => prev.map(g => {
          if (g.id !== groupId) return g;
          return { ...g, toolbar: { ...g.toolbar, ...updates } };
        }));
      }, []);

  useCallback((groupId: string, imageId: string, categories: ReferenceCategory[], strengths: Record<string, number>) => {
        setGenGroups(prev => prev.map(g => {
          if (g.id !== groupId) return g;
          return {
            ...g,
            refImages: g.refImages.map(r =>
              r.imageId === imageId ? { ...r, categories, strengths } : r
            ),
          };
        }));
      }, []);

  /** 删除生成组 */
  const deleteGenGroup = useCallback((groupId: string) => {
    const group = genGroupsRef.current.find(g => g.id === groupId);
    // When closing the group, result images stay on canvas as independent editable images
    // Only remove the group container and connection lines, not the images
    // Mark result images as no longer part of any group so they show on canvas
    if (group?.resultImageIds && group.resultImageIds.length > 0) {
      // Result images are already in the images array; they were hidden because
      // isGenGroupResultImage matched. Removing the group will automatically
      // un-hide them since the genGroups state no longer contains this group.
      // No need to modify images array.
    }
    setGenGroups(prev => prev.filter(g => g.id !== groupId));
  }, []);

  /** 创建六面体组 */
  const handleCreateHexCube = useCallback(() => {
    const position = getHexCubeInitialPosition({ viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1000, viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 800, viewOffset, zoom });
    const group = createHexCubeGroup({ x: position.x, y: position.y });
    // 设置当前模型
    const currentModelInfo = getCurrentModel();
    group.toolbar.model = currentModelInfo.model;
    group.toolbar.providerId = currentModelInfo.providerId || '';
    // 从 canvasGenModels 查找 providerName
    const currentModelObj = canvasGenModels.find(m => m.id === currentModelInfo.model && m.providerId === currentModelInfo.providerId);
    group.toolbar.providerName = currentModelObj?.providerName || '';
    setHexCubeGroups(prev => [...prev, group]);
  }, [canvasGenModels, getCurrentModel, viewOffset, zoom]);

  /** 删除六面体组 */
  const deleteHexCubeGroup = useCallback((groupId: string) => {
    setHexCubeGroups(prev => prev.filter(g => g.id !== groupId));
  }, []);

  /** 更新六面体面图片 */
  const updateHexCubeFace = useCallback((groupId: string, face: CubeFace, imageUrl: string | null, imageId: string | null) => {
    setHexCubeGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        faces: g.faces.map(f => f.face === face ? { ...f, imageUrl, imageId } : f),
      };
    }));
  }, []);

  /** 优化组提示词 — 调用当前LLM模型 */
  const handleOptimizeGroupPrompt = useCallback(async (groupId: string) => {
    const group = genGroupsRef.current.find(g => g.id === groupId);
    if (!group || !group.toolbar.prompt.trim()) return;
    setOptimizingGroupId(groupId);
    try {
      // 不传 model/providerId，让服务端自动查找可用的 LLM (chat) 模型
      // 之前从 localStorage 读取的 selectedModel 是图像模型，不是聊天模型
      const res = await fetch('/api/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: group.toolbar.prompt,
          mode: 'enhance',
        }),
      });
      if (!res.ok) throw new Error('优化失败');
      const data = await res.json();
      if (data.optimized || data.optimizedPrompt) {
        let optimizedPrompt = data.optimized || data.optimizedPrompt;
        // 清理思考过程：移除 <think/> 标签内容，保留中英文双语关键词
        const hasThinkTags = /<think[\s\S]*?<\/think>/gi.test(optimizedPrompt) || /<thinking[\s\S]*?<\/thinking>/gi.test(optimizedPrompt);
        optimizedPrompt = optimizedPrompt
          .replace(/<think[\s\S]*?<\/think>/gi, '')  // 移除 <think...</think >
          .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')  // 移除 <thinking...</thinking >
          .trim();
        // 仅在检测到LLM思考标签时才清理【】和**标记（避免误删用户原始输入）
        if (hasThinkTags) {
          optimizedPrompt = optimizedPrompt
            .replace(/【[^】]*】/g, '')  // 移除【】标记
            .replace(/\*\*[^*]*\*\*/g, '')  // 移除**加粗**标记
            .trim();
        }
        setGenGroups(prev => prev.map(g => {
          if (g.id !== groupId) return g;
          return { ...g, toolbar: { ...g.toolbar, prompt: optimizedPrompt } };
        }));
      }
    } catch (error) {
      console.error('提示词优化失败:', error);
    } finally {
      setOptimizingGroupId(null);
    }
  }, []);

  /** 处理生成组的生成请求 */
  const handleGroupGenerate = useCallback(async (group: CanvasGenGroup) => {
    const toolbar = group.toolbar;
    if (!toolbar.prompt.trim()) return;

    // 计算结果框尺寸（根据用户选择的比例和模型尺寸）
    const [arW, arH] = toolbar.aspectRatio.split(':').map(Number);
    const arRatio = (arW || 1) / (arH || 1);
    // 根据工具栏中的尺寸设置计算结果框的显示尺寸
    let displayBaseSize = 400;
    if (toolbar.size) {
      const [sw, sh] = toolbar.size.replace(/×/g, 'x').split('x').map(Number);
      const maxEdge = Math.max(sw || 1024, sh || 1024);
      // 根据实际像素尺寸缩放显示大小
      if (maxEdge <= 512) displayBaseSize = 200;
      else if (maxEdge <= 1024) displayBaseSize = 300;
      else if (maxEdge <= 1536) displayBaseSize = 350;
      else if (maxEdge <= 1792) displayBaseSize = 400;
      else if (maxEdge <= 2048) displayBaseSize = 420;
      else displayBaseSize = 500;
    }
    const phWidth = arRatio >= 1 ? displayBaseSize : Math.round(displayBaseSize * arRatio);
    const phHeight = arRatio >= 1 ? Math.round(displayBaseSize / arRatio) : displayBaseSize;

    const phX = group.position.resultX ?? 0;
    const phY = group.position.resultY ?? 0;

    // 更新组的resultPlaceholder尺寸和进度状态（不创建单独的画布占位图片）
    setGenGroups(prev => prev.map(g => {
      if (g.id !== group.id) return g;
      return {
        ...g,
        status: 'generating' as const,
        resultPlaceholder: {
          ...g.resultPlaceholder,
          x: phX, y: phY,
          width: phWidth, height: phHeight,
          aspectRatio: toolbar.aspectRatio,
          isProcessing: true,
          progress: 5,
          startedAt: Date.now(),
          errorMsg: undefined,
        },
      };
    }));

    // 自动将视图平移到 processing frame 的位置
    const canvasEl = canvasRef.current;
    if (canvasEl) {
      const canvasW = canvasEl.clientWidth;
      const canvasH = canvasEl.clientHeight;
      const phCenterX = phX + phWidth / 2;
      const phCenterY = phY + phHeight / 2;

      // 适度缩放以显示 processing frame
      const fitZoomX = (canvasW * 0.6) / phWidth;
      const fitZoomY = (canvasH * 0.6) / phHeight;
      const fitZoom = Math.min(fitZoomX, fitZoomY, 2);
      // 如果当前缩放太小看不到，则调整缩放
      const newZoom = zoom < fitZoom * 0.5 ? fitZoom : zoom;

      setZoom(newZoom);
      setViewOffset({
        x: canvasW / 2 - phCenterX * newZoom,
        y: canvasH / 2 - phCenterY * newZoom,
      });
    }

    // 构建提示词
    let fullPrompt = toolbar.prompt;
    let calculatedStrength: number | undefined;

    if (group.type === 'reference' && group.refImages.length > 0) {
      // 参考图组：收集类别/强度/描述，传给后端处理
      // 前端不再构建复杂提示词，避免与后端逻辑冲突导致重复指令和变形

      // 收集参考图的原始描述（用于增强主体识别精度）
      const refDescriptions = group.refImages
        .map(r => {
          const canvasImg = images.find(img => img.id === r.imageId);
          return canvasImg?.prompt?.trim() || '';
        });

      // 收集所有激活的类别及其最大强度（跨多张参考图取最大值）
      const catStrengthMap: Record<string, number> = {};
      for (const r of group.refImages) {
        const cats = group.sourceCategories[r.imageId] || [];
        const strengths = group.sourceStrengths[r.imageId] || {};
        for (const c of cats) {
          const s = strengths[c] || 0;
          if (s > 0) {
            catStrengthMap[c] = Math.max(catStrengthMap[c] || 0, s);
          }
        }
      }

      const activeKeys = Object.keys(catStrengthMap);
      const keyword = fullPrompt.trim();

      // 构建后端需要的 referenceCategories 和 referenceStrengths 格式
      // referenceCategories: { "0": ["style", "subject"], "1": ["composition"] }
      const referenceCategories: Record<string, string[]> = {};
      const referenceStrengthsArr: number[] = [];
      for (let i = 0; i < group.refImages.length; i++) {
        const r = group.refImages[i];
        const cats = group.sourceCategories[r.imageId] || [];
        const strengths = group.sourceStrengths[r.imageId] || {};
        if (cats.length > 0) {
          referenceCategories[String(i)] = cats;
          // 取该参考图激活类别中的最大强度
          const maxStr = cats.reduce((max, c) => Math.max(max, strengths[c] || 0), 0);
          referenceStrengthsArr.push(maxStr);
        } else {
          referenceStrengthsArr.push(0);
        }
      }

      // strength 计算：保留方面多/强 → strength 低（更接近原图）
      // preserveRatio=0 (无保留) → strength=0.80 (允许较大变化)
      // preserveRatio=1 (全部最高保留) → strength=0.15 (几乎不变)
      if (activeKeys.length > 0) {
        const totalPreserveScore = activeKeys.reduce((sum, cat) => sum + catStrengthMap[cat], 0);
        const maxScore = activeKeys.length * 100;
        const preserveRatio = totalPreserveScore / maxScore;
        calculatedStrength = Math.round((0.80 - preserveRatio * 0.65) * 100) / 100;
        // 当保留主体时，额外降低 strength
        if (catStrengthMap['subject'] > 0) {
          const subjectStr = catStrengthMap['subject'] || 0;
          const subjectReduction = (subjectStr / 100) * 0.25;
          calculatedStrength = Math.max(0.15, calculatedStrength - subjectReduction);
        }
      }

      // 保存这些信息供 fetch 请求使用
      groupRefMetaRef.current = {
        referenceDescriptions: refDescriptions,
        referenceCategories: Object.keys(referenceCategories).length > 0 ? referenceCategories : undefined,
        referenceStrengths: referenceStrengthsArr.some(s => s > 0) ? referenceStrengthsArr : undefined,
      };

      // fullPrompt 只保留用户的原始关键词，后端根据 categories/descriptions 构建完整提示词
      if (!keyword) {
        fullPrompt = 'Generate a creative variation of the reference image(s).';
      }
    } else if (group.type === 'fusion' && group.refImages.length > 0) {
      // 融图组：融合多张参考图
      calculatedStrength = 0.65;
      const keyword = fullPrompt.trim();
      // 收集融合参考图的原始描述
      const fusionRefDescs = group.refImages
        .map(r => {
          const canvasImg = images.find(img => img.id === r.imageId);
          return canvasImg?.prompt?.trim();
        })
        .filter((d): d is string => !!d);
      const fusionDescHint = fusionRefDescs.length > 0
        ? ` The reference images depict: "${fusionRefDescs.join('; ')}".`
        : '';
      if (keyword) {
        fullPrompt = `[fusion] Seamlessly blend and fuse elements from the reference images, then create: ${keyword}.${fusionDescHint}`;
      } else {
        fullPrompt = `[fusion] Seamlessly blend and fuse elements from the reference images into a cohesive new image.${fusionDescHint}`;
      }
    }

    // 调用生图 API（始终使用工具栏中选择的模型和 providerId）
    try {
      const model = toolbar.model;
      const providerId = toolbar.providerId;
      if (!model) {
        setGenGroups(prev => prev.map(g => {
          if (g.id !== group.id) return g;
          return { ...g, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, errorMsg: '请先选择模型' } };
        }));
        return;
      }

      // 将 data: URL 参考图先上传到服务器，避免请求体过大 (base64 图片会触发 413 Request Entity Too Large)
      const rawRefUrls = group.refImages.map(r => r.url);
      const referenceImages: string[] = [];
      const succeededIndices: number[] = []; // 跟踪成功上传的参考图索引
      for (let idx = 0; idx < rawRefUrls.length; idx++) {
        const url = rawRefUrls[idx];
        if (url.startsWith('data:')) {
          try {
            const saveRes = await fetch('/api/save-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: url }),
            });
            const saveData = await saveRes.json();
            if (saveData.success && saveData.url) {
              referenceImages.push(saveData.url);
              succeededIndices.push(idx);
            } else {
              console.warn('[handleGroupGenerate] Failed to save data URL, skipping:', saveData.error);
            }
          } catch (e) {
            console.warn('[handleGroupGenerate] Failed to upload data URL reference image:', e);
          }
        } else {
          referenceImages.push(url);
          succeededIndices.push(idx);
        }
      }

      if (referenceImages.length === 0 && rawRefUrls.length > 0) {
        setGenGroups(prev => prev.map(g => {
          if (g.id !== group.id) return g;
          return { ...g, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, errorMsg: '参考图上传失败，请重试' } };
        }));
        return;
      }

      // 提交生成请求（带超时保护）
      // 超时需匹配后端 maxDuration (600s=10分钟)，部分第三方API出图可达90秒+
      const genController = new AbortController();
      const genTimeout = setTimeout(() => genController.abort(), 600000); // 10分钟超时，匹配后端maxDuration

      let res: Response;
      try {
        // 诊断日志：显示参考图参数
        console.log(`[handleGroupGenerate] model=${model}, providerId=${providerId}, referenceImages.length=${referenceImages?.length || 0}, refImages.length=${group.refImages?.length || 0}`);
        res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: fullPrompt,
            negativePrompt: toolbar.negativePrompt,
            model,
            providerId,
            aspectRatio: toolbar.aspectRatio,
            resolution: toolbar.resolution || '2K',
            quality: toolbar.quality || 'auto',
          outputCount: toolbar.outputCount,
          referenceImages,
          referenceMode: group.type === 'fusion' ? 'fusion' : 'reference',
          submitOnly: true,
          ...(calculatedStrength != null && calculatedStrength > 0 ? { strength: calculatedStrength } : {}),
          ...(groupRefMetaRef.current.referenceDescriptions?.some(d => d.trim()) ? { referenceDescriptions: succeededIndices.map(i => groupRefMetaRef.current.referenceDescriptions?.[i] || '').filter(d => d.trim()) } : {}),
          ...(groupRefMetaRef.current.referenceCategories ? { referenceCategories: Object.fromEntries(succeededIndices.map((origIdx, newIdx) => [String(newIdx), groupRefMetaRef.current.referenceCategories?.[String(origIdx)] || []]).filter(([,v]) => v.length > 0)) } : {}),
          ...(groupRefMetaRef.current.referenceStrengths?.length ? { referenceStrengths: groupRefMetaRef.current.referenceStrengths } : {}),
        }),
        signal: genController.signal,
      });
      } finally {
        clearTimeout(genTimeout);
        // 清理参考图元数据，避免污染下一次生成
        groupRefMetaRef.current = {};
      }

      // 安全解析响应：优先尝试 JSON，回退到纯文本
      let data: GroupGenerationResponse;
      const responseText = await res.text();
      try {
        data = parseGroupGenerationResponse(JSON.parse(responseText));
      } catch {
        console.error('[GroupGenerate] Non-JSON response:', res.status, responseText.substring(0, 200));
        const errMsg = res.status === 413 ? '请求体过大，请减少参考图数量或缩小图片尺寸' : `服务器错误 (${res.status}): ${responseText.substring(0, 80)}`;
        setGenGroups(prev => prev.map(g => {
          if (g.id !== group.id) return g;
          return { ...g, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, errorMsg: errMsg } };
        }));
        return;
      }
      // 检查 API 错误
      if (data.error) {
        console.error('[GroupGenerate] API error:', data.error);
        setGenGroups(prev => prev.map(g => {
          if (g.id !== group.id) return g;
          return { ...g, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, errorMsg: String(data.error).substring(0, 100) } };
        }));
        return;
      }

      if (data.mode === 'direct' && data.imageUrls) {
        // 直接模式：立即显示结果
        // Save images to get persistent URLs, then add to canvas images for persistence
        const savedUrls: string[] = [];
        for (const url of data.imageUrls) {
          try {
            const saveRes = await fetch('/api/save-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: url }),
            });
            const saveData = await saveRes.json();
            savedUrls.push(saveData.url || url);
          } catch {
            savedUrls.push(url);
          }
        }
        // Add result images as REGULAR canvas images (visible, downloadable, editable)
        // Position: right side of the result placeholder frame
        const srcImgs = group.sourceImageIds.map(id => imagesRef.current.find(i => i.id === id)).filter(Boolean) as CanvasImage[];
        const srcRightEdge = srcImgs.length > 0 ? Math.max(...srcImgs.map(img => img.x + img.width)) : 0;
        const srcCenterY = srcImgs.length > 0 ? srcImgs.reduce((s, img) => s + img.y + img.height / 2, 0) / srcImgs.length : 0;
        const resultFrameRight = srcRightEdge + 80 + Math.max(phWidth, 420);
        // Parse actual pixel dimensions from toolbar size string (e.g. "1536×1024")
        const actualSize = toolbar.size ? toolbar.size.replace(/×/g, 'x').split('x').map(Number) : [phWidth, phHeight];
        const actualW = actualSize[0] || phWidth;
        const actualH = actualSize[1] || phHeight;
        const newImages = savedUrls.map((url: string, i: number) => ({
          id: `grp-result-${Date.now()}-${i}`,
          url,
          x: resultFrameRight + 20 + i * (phWidth + 20),
          y: srcCenterY - phHeight / 2,
          width: phWidth, height: phHeight,
          originalWidth: actualW,
          originalHeight: actualH,
          prompt: toolbar.prompt,
          aspectRatio: toolbar.aspectRatio,
          modelName: data.modelName || model,
          apiProvider: data.providerName,
        }));
        onImagesChange([...imagesRef.current, ...newImages]);
        // ★ 异步修正：API 可能忽略 size 参数返回不同尺寸的图片，需检测实际像素尺寸并修正
        newImages.forEach((newImg) => {
          const vImg = new Image();
          vImg.onload = () => {
            const nW = vImg.naturalWidth;
            const nH = vImg.naturalHeight;
            if (nW > 0 && nH > 0 && (nW !== actualW || nH !== actualH)) {
              // API 返回了与请求不同的尺寸，修正显示尺寸和原始尺寸
              const displayH = phHeight;
              const correctedDisplayW = Math.round(displayH * nW / nH);
              const updated = imagesRef.current.map(i =>
                i.id === newImg.id ? {
                  ...i,
                  originalWidth: nW,
                  originalHeight: nH,
                  width: correctedDisplayW,
                  height: displayH,
                } : i
              );
              imagesRef.current = updated;
              onImagesChange(updated);
            }
          };
          vImg.src = newImg.url;
        });
        // Reset group: keep toolbar visible, clear result for next generation
        setGenGroups(prev => prev.map(g => {
          if (g.id !== group.id) return g;
          return {
            ...g,
            status: 'idle' as const,
            resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, resultUrl: undefined, resultImageIds: [], errorMsg: undefined },
            resultImageIds: [],
          };
        }));
      } else if (data.error) {
        // API返回错误
        setGenGroups(prev => prev.map(g => {
          if (g.id !== group.id) return g;
          return { ...g, status: 'idle' as const, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, errorMsg: data.error } };
        }));
      } else if (data.taskIds) {
        // 轮询模式 — 与生成面板一致的动态轮询策略
        // ★ 支持多 taskId 并行轮询（outputCount>1 时 API 可能返回多个 taskIds）
        const allTaskIds = data.taskIds;
        const estimatedTime = data.estimatedTime || 30;
        // 单任务最大25分钟（1500秒），兼容慢速API如apimart(可能需要10-20分钟)、gpt-image-2 4K(7-10分钟)
        const maxPollTime = Math.min(1500, Math.max(600, estimatedTime * 8 + 600)) * 1000;
        const startTime = Date.now();
        let pollCount = 0;

        const pollWithBackoff = async () => {
          // 收集所有已完成任务的结果
          const completedResults = new Map<string, string[]>();
          const failedTasks = new Set<string>();

          while (Date.now() - startTime < maxPollTime) {
            // 检查是否所有任务都已完成或失败
            const pendingTaskIds = allTaskIds.filter(tid => !completedResults.has(tid) && !failedTasks.has(tid));
            if (pendingTaskIds.length === 0) break;

            pollCount++;
            // 动态间隔：快速初始轮询，逐步增长
            const delay = pollCount <= 5 ? 300 : pollCount <= 15 ? 600 : pollCount <= 30 ? 1200 : 2000;
            await Promise.race([
              new Promise(r => setTimeout(r, delay)),
              new Promise(resolve => {
                if (!taskEventsClient.isConnected()) { resolve(undefined); return; }
                const unsub = taskEventsClient.onTaskEvent(event => {
                  if (pendingTaskIds.includes(event.taskId) && ['completed', 'failed', 'cancelled'].includes(event.type)) {
                    unsub();
                    resolve(undefined);
                  }
                });
                setTimeout(() => { unsub(); resolve(undefined); }, delay + 2000);
              })
            ]);

            // ★ 并行轮询所有未完成的任务
            const pollPromises = pendingTaskIds.map(async (tid) => {
              try {
                const pollRes = await fetch('/api/poll-task', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId: tid, model, providerId, quickPoll: true }),
                });
                // ★ 修复：即使 pollRes 不 ok 也解析响应，以便识别错误类型
                const pollData = await pollRes.json().catch(() => ({})) as Record<string, unknown>;
                if (!pollRes.ok) {
                  // poll-task 返回错误（如找不到提供商），标记任务失败
                  console.warn(`[pollForResult] taskId=${tid} poll-task error: ${pollRes.status}`, pollData);
                  return { taskId: tid, data: { ...pollData, status: 'failed', error: pollData.error || `poll-task returned ${pollRes.status}` } };
                }
                return { taskId: tid, data: pollData };
              } catch (err) {
                console.warn(`[pollForResult] taskId=${tid} fetch error:`, err);
                return;
              }
            });
            const pollResults = (await Promise.all(pollPromises)).filter(Boolean) as Array<{ taskId: string; data: Record<string, unknown> }>;

            // 更新进度
            const maxProgress = pollResults.reduce((max, r) => {
              const p = typeof r.data.progress === 'number' ? r.data.progress : 0;
              return Math.max(max, p);
            }, 0);
            if (maxProgress > 0) {
              setGenGroups(prev => prev.map(g => {
                if (g.id !== group.id) return g;
                return { ...g, resultPlaceholder: { ...g.resultPlaceholder, progress: Math.max(maxProgress, 5) } };
              }));
            }

            // 处理已完成的任务
            for (const { taskId: tid, data: pollData } of pollResults) {
              const pollResult = pollData as unknown as Record<string, unknown>;
              const normalizedResultUrl = extractTaskResultImageUrl(pollResult);
              const pollResultData = pollResult.result as Record<string, unknown> | undefined;
              // ★ 兼容多种返回格式
              const singleResultUrl = normalizedResultUrl || (pollResult.imageUrl as string)
                || (pollResultData?.url as string)
                || (pollResultData?.imageUrl as string)
                || ((pollResultData?.image as Record<string, unknown>)?.url as string)
                || ((pollResultData?.images as Array<Record<string, unknown>>)?.[0]?.url as string);
              const resultUrlsFromArray: string[] = [];
              if (Array.isArray(pollResultData?.images)) {
                for (const img of (pollResultData?.images as Array<Record<string, unknown>>)) {
                  const imageUrl = extractTaskResultImageUrl({ result: { image: img } });
                  if (imageUrl) resultUrlsFromArray.push(imageUrl);
                }
              }
              console.log(`[pollForResult] taskId=${tid} pollData.status=${pollData.status}, imageUrl=${singleResultUrl ? 'YES' : 'NO'}, results=${resultUrlsFromArray.length || 0}`);
              if (['completed', 'succeeded', 'success', 'done'].includes(pollData.status as string)) {
                const resultUrls: string[] = [];
                if (pollResult.results && Array.isArray(pollResult.results) && pollResult.results.length > 0) {
                  resultUrls.push(...(pollResult.results as string[]));
                }
                if (resultUrlsFromArray.length > 0) {
                  resultUrls.push(...resultUrlsFromArray);
                }
                if (singleResultUrl) {
                  resultUrls.push(singleResultUrl as string);
                }
                if (resultUrls.length > 0) {
                  completedResults.set(tid, resultUrls);
                } else {
                  // 完成但没有图片 → 失败
                  failedTasks.add(tid);
                }
              } else if (pollData.status === 'failed' || (pollData.status === 'error' && !pollData.retryable)) {
                failedTasks.add(tid);
              }
              // 可重试错误/processing → 继续轮询
            }
          }

          // ★ 收集所有结果图片
          const allResultUrls: string[] = [];
          for (const urls of completedResults.values()) {
            allResultUrls.push(...urls);
          }

          if (allResultUrls.length > 0) {
            const savedUrls: string[] = [];
            for (const url of allResultUrls) {
              try {
                const saveRes = await fetch('/api/save-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: url }),
                });
                const saveData = await saveRes.json();
                savedUrls.push(saveData.url || url);
              } catch {
                savedUrls.push(url);
              }
            }
            const srcImgs = group.sourceImageIds.map(id => imagesRef.current.find(i => i.id === id)).filter(Boolean) as CanvasImage[];
            const srcRightEdge = srcImgs.length > 0 ? Math.max(...srcImgs.map(img => img.x + img.width)) : 0;
            const srcCenterY = srcImgs.length > 0 ? srcImgs.reduce((s, img) => s + img.y + img.height / 2, 0) / srcImgs.length : 0;
            const resultFrameRight = srcRightEdge + 80 + Math.max(phWidth, 420);
            const actualSize = toolbar.size ? toolbar.size.replace(/×/g, 'x').split('x').map(Number) : [phWidth, phHeight];
            const actualW = actualSize[0] || phWidth;
            const actualH = actualSize[1] || phHeight;
            const resultImages = savedUrls.map((url: string, i: number) => ({
              id: `grp-result-${Date.now()}-${i}`,
              url,
              x: resultFrameRight + 20 + i * (phWidth + 20),
              y: srcCenterY - phHeight / 2,
              width: phWidth, height: phHeight,
              originalWidth: actualW,
              originalHeight: actualH,
              prompt: toolbar.prompt,
              aspectRatio: toolbar.aspectRatio,
              modelName: model,
              apiProvider: modelProviderMap.get(providerId?.split('::')[0] || '') || providerId?.split('::')[0] || undefined,
            }));
            onImagesChange([...imagesRef.current, ...resultImages]);
            // ★ 异步修正：API 可能忽略 size 参数返回不同尺寸的图片
            resultImages.forEach((newImg) => {
              const vImg = new Image();
              vImg.onload = () => {
                const nW = vImg.naturalWidth;
                const nH = vImg.naturalHeight;
                if (nW > 0 && nH > 0 && (nW !== actualW || nH !== actualH)) {
                  const displayH = phHeight;
                  const correctedDisplayW = Math.round(displayH * nW / nH);
                  const updated = imagesRef.current.map(i =>
                    i.id === newImg.id ? {
                      ...i,
                      originalWidth: nW,
                      originalHeight: nH,
                      width: correctedDisplayW,
                      height: displayH,
                    } : i
                  );
                  imagesRef.current = updated;
                  onImagesChange(updated);
                }
              };
              vImg.src = newImg.url;
            });
            setGenGroups(prev => prev.map(g => {
              if (g.id !== group.id) return g;
              return {
                ...g,
                status: 'idle' as const,
                resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, resultUrl: undefined, resultImageIds: [], errorMsg: undefined },
                resultImageIds: [],
              };
            }));
          } else {
            // 超时或全部失败
            const errMsg = failedTasks.size > 0 ? '生成失败，请检查模型和API配置' : '生成超时，请重试';
            setGenGroups(prev => prev.map(g => {
              if (g.id !== group.id) return g;
              return { ...g, status: 'idle' as const, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, errorMsg: errMsg } };
            }));
          }
        };
        pollWithBackoff();
      }
      } catch (error) {
      // 网络错误，重置组状态
      console.error('[handleGroupGenerate] error:', error);
      setGenGroups(prev => prev.map(g => {
        if (g.id !== group.id) return g;
        return { ...g, status: 'idle' as const, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, errorMsg: `生成失败: ${error instanceof Error ? error.message : String(error)}` } };
      }));
    }
  }, [images, modelProviderMap, onImagesChange, zoom]);

  // handleGenGroupGenerate: 通过groupId查找组并调用handleGroupGenerate
  const handleGenGroupGenerate = useCallback((groupId: string) => {
    const group = genGroupsRef.current.find(g => g.id === groupId);
    console.log('[handleGenGroupGenerate] groupId:', groupId, 'group found:', !!group, 'total groups:', genGroupsRef.current.length);
    if (group) {
      handleGroupGenerate(group);
    } else {
      console.error('[handleGenGroupGenerate] group not found in ref!');
    }
  }, [handleGroupGenerate]);

  // ──────────────── 【调整2&3 结束】────────────────

  const createProcessingFrameRightOf = useCallback((
    sourceImage: CanvasImage,
    label: string,
    width = sourceImage.width,
    height = sourceImage.height,
    status = '准备生成...'
  ): string => {
    const gap = 10;
    const placeholder: CanvasImage = {
      id: `processing-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      url: sourceImage.url,
      x: sourceImage.x + sourceImage.width + gap,
      y: sourceImage.y,
      width,
      height,
      originalWidth: Math.round(width),
      originalHeight: Math.round(height),
      prompt: sourceImage.prompt,
      model: sourceImage.model,
      isProcessingPlaceholder: true,
      processing: {
        label,
        status,
        progress: 6,
        sourceUrl: sourceImage.url,
        startTime: Date.now(),
      },
      // ★ 继承源图的模型信息，确保处理帧完成后不会丢失
      modelName: sourceImage.modelName,
      apiProvider: sourceImage.apiProvider,
      // ★ 记录来源图片ID，完成后自动创建连线
      generatedFromImageId: sourceImage.id,
    };
    const nextImages = [...imagesRef.current, placeholder];
    imagesRef.current = nextImages;
    onImagesChange(nextImages);
    setSelectedIds(new Set([sourceImage.id]));
    onSelectImage(sourceImage);
    return placeholder.id;
  }, [onImagesChange, onSelectImage]);

  const updateProcessingFrame = useCallback((id: string, patch: Partial<NonNullable<CanvasImage['processing']>>) => {
    const nextImages = imagesRef.current.map(image => {
      if (image.id !== id || !image.processing) return image;
      return {
        ...image,
        processing: {
          ...image.processing,
          ...patch,
          progress: Math.max(0, Math.min(100, patch.progress ?? image.processing.progress)),
        },
      };
    });
    imagesRef.current = nextImages;
    onImagesChange(nextImages);
  }, [onImagesChange]);

  const completeProcessingFrame = useCallback((
    id: string,
    newUrl: string,
    newWidth: number,
    newHeight: number,
    extra?: Partial<CanvasImage>,
    relationType?: 'variant' | 'edit' | 'img2img' | 'upscale' | 'removebg' | 'trace' | 'reference'
  ): CanvasImage | null => {
    let completedImage: CanvasImage | null = null;
    const nextImages = imagesRef.current.map(image => {
      if (image.id !== id) return image;
      completedImage = {
        ...image,
        url: newUrl,
        width: newWidth,
        height: newHeight,
        // 优先使用 extra 中的原始尺寸；若无则保留原图的原始尺寸（避免用显示宽度覆盖）
        originalWidth: extra?.originalWidth ?? image.originalWidth ?? Math.round(newWidth),
        originalHeight: extra?.originalHeight ?? image.originalHeight ?? Math.round(newHeight),
        isProcessingPlaceholder: false,
        processing: undefined,
      };
      // extra 展开放在后面，确保 extra.originalWidth/Height 能覆盖上面的默认值
      if (extra) {
        completedImage = { ...completedImage, ...extra };
      }
      return completedImage;
    });
    imagesRef.current = nextImages;
    onImagesChange(nextImages);

    // ★ 异步验证修正：始终从图片真实像素尺寸修正 originalWidth/Height 和 width/height
    // 因为 API 可能忽略 size 参数返回不同尺寸的图片（特别是 /images/edits 端点）
    const imgToVerify = completedImage as CanvasImage | null;
    if (imgToVerify && imgToVerify.url) {
      const verifyImg = new Image();
      const verifyUrl = imgToVerify.url;
      verifyImg.onload = () => {
        const natW = verifyImg.naturalWidth;
        const natH = verifyImg.naturalHeight;
        if (natW > 0 && natH > 0) {
          const currentImg = imagesRef.current.find(i => i.id === id);
          if (currentImg && (currentImg.originalWidth !== natW || currentImg.originalHeight !== natH)) {
            // ★ 同时更新显示尺寸(width/height)以匹配实际图片比例
            // 避免显示尺寸与实际图片比例不一致导致 object-cover 裁剪
            const currentDisplayH = currentImg.height;
            const correctedDisplayW = Math.round(currentDisplayH * natW / natH);
            const updated = imagesRef.current.map(i =>
              i.id === id ? {
                ...i,
                originalWidth: natW,
                originalHeight: natH,
                // 按实际图片比例修正显示宽度，保持高度不变
                width: correctedDisplayW,
                height: currentDisplayH,
              } : i
            );
            imagesRef.current = updated;
            onImagesChange(updated);
          }
        }
      };
      verifyImg.src = verifyUrl;
    }
    const selectedCompleted = nextImages.find(image => image.id === id && !image.isProcessingPlaceholder) || null;
    if (selectedCompleted) {
      setSelectedIds(new Set([selectedCompleted.id]));
      onSelectImage(selectedCompleted);
    }
    // ★ 自动创建连线：从源图指向新完成的图片
    if (relationType && selectedCompleted) {
      const sourceId = selectedCompleted.generatedFromImageId;
      if (sourceId) {
        const sourceImage = imagesRef.current.find(img => img.id === sourceId && !img.isProcessingPlaceholder);
        if (sourceImage) {
          const newConn = createAutoConnection(sourceId, id, relationType);
          if (newConn && onConnectionsChangeRef.current) {
            // Use ref to avoid stale closure — merge with latest connections
            const latestConns = connectionsRef.current || [];
            onConnectionsChangeRef.current([...latestConns, newConn]);
          }
        }
      }
    }
    // 预加载验证：如果图片 URL 无法加载，自动通过 /api/save-image 兜底
    // 同时获取图片真实像素尺寸更新 originalWidth/originalHeight
    if (newUrl && !newUrl.startsWith('data:')) {
      const testImg = new window.Image();
      testImg.onload = () => {
        // 更新真实像素尺寸（覆盖显示尺寸/请求尺寸）
        const natW = testImg.naturalWidth;
        const natH = testImg.naturalHeight;
        if (natW > 0 && natH > 0) {
          const needUpdate = imagesRef.current.find(img => img.id === id);
          if (needUpdate && (needUpdate.originalWidth !== natW || needUpdate.originalHeight !== natH)) {
            const updatedImages = imagesRef.current.map(img =>
              img.id === id ? { ...img, originalWidth: natW, originalHeight: natH } : img
            );
            imagesRef.current = updatedImages;
            onImagesChange(updatedImages);
          }
        }
      }; // 加载成功，更新真实尺寸
      testImg.onerror = () => {
        // 已持久化到本地的URL不应该加载失败，如果失败说明文件系统有问题，直接跳过不做fallback
        if (newUrl.startsWith('/api/serve-upload/') || newUrl.startsWith('/uploads/')) {
          console.warn('[Canvas] Local persisted image URL failed to load (file system issue):', newUrl);
          return;
        }
        console.warn('[Canvas] Image URL failed to load, attempting save-image fallback:', newUrl);
        // 通过 /api/save-image 将图片持久化为可靠的 data URL
        fetch('/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: newUrl }),
        })
        .then(r => r.json())
        .then(data => {
          if (data.success && data.url) {
            // 更新图片 URL 为持久化后的 URL，同时获取真实尺寸
            const fallbackImg = new window.Image();
            fallbackImg.onload = () => {
              const natW = fallbackImg.naturalWidth;
              const natH = fallbackImg.naturalHeight;
              const fallbackImages = imagesRef.current.map(img => {
                if (img.id === id) {
                  return { ...img, url: data.url, originalWidth: natW > 0 ? natW : img.originalWidth, originalHeight: natH > 0 ? natH : img.originalHeight };
                }
                return img;
              });
              imagesRef.current = fallbackImages;
              onImagesChange(fallbackImages);
            };
            fallbackImg.onerror = () => {
              // 持久化 URL 也无法加载，仅更新 URL
              const fallbackImages = imagesRef.current.map(img => {
                if (img.id === id) {
                  return { ...img, url: data.url };
                }
                return img;
              });
              imagesRef.current = fallbackImages;
              onImagesChange(fallbackImages);
            };
            fallbackImg.src = data.url;
          }
        })
        .catch(err => console.warn('[Canvas] save-image fallback failed:', err));
      };
      testImg.src = newUrl;
    } else if (newUrl && newUrl.startsWith('data:')) {
      // data: URL 也需要获取真实尺寸
      const dataImg = new window.Image();
      dataImg.onload = () => {
        const natW = dataImg.naturalWidth;
        const natH = dataImg.naturalHeight;
        if (natW > 0 && natH > 0) {
          const needUpdate = imagesRef.current.find(img => img.id === id);
          if (needUpdate && (needUpdate.originalWidth !== natW || needUpdate.originalHeight !== natH)) {
            const updatedImages = imagesRef.current.map(img =>
              img.id === id ? { ...img, originalWidth: natW, originalHeight: natH } : img
            );
            imagesRef.current = updatedImages;
            onImagesChange(updatedImages);
          }
        }
      };
      dataImg.src = newUrl;
    }
    return completedImage;
  }, [onImagesChange, onSelectImage]);

  const removeProcessingFrame = useCallback((id: string) => {
    const nextImages = imagesRef.current.filter(image => image.id !== id);
    imagesRef.current = nextImages;
    onImagesChange(nextImages);
  }, [onImagesChange]);

  // Get selected image data
  const getSelectedImageData = (): CanvasImage | null => {
    if (selectedIds.size !== 1) return null;
    return images.find(i => i.id === Array.from(selectedIds)[0]) || null;
  };

  const selectedImageData = getSelectedImageData();

  // 获取当前编辑的图片数据：优先用 editImageId（面板打开后选择可能丢失），fallback 到 selectedImageData
  const getActiveImageData = useCallback((): CanvasImage | null => {
    if (editImageId) {
      return images.find(i => i.id === editImageId) || null;
    }
    return selectedImageData;
  }, [editImageId, images, selectedImageData]);

  const loadImageAsDataUrl = useCallback(async (url: string): Promise<{ dataUrl: string; width: number; height: number }> => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to load image'));
      image.src = url;
    });
    const width = image.naturalWidth || image.width || 1024;
    const height = image.naturalHeight || image.height || 1024;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.drawImage(image, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  }, []);

  const makeSvgDataUrl = useCallback((svg: string) => {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  const renderEditElementsPreview = useCallback(async (img: CanvasImage): Promise<string> => {
    const source = await loadImageAsDataUrl(img.url);
    const width = source.width;
    const height = source.height;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="blur"><feGaussianBlur stdDeviation="${Math.max(8, width / 80)}"/></filter>
    <linearGradient id="veil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.88"/><stop offset="1" stop-color="#f5f5f5" stop-opacity="0.96"/></linearGradient>
  </defs>
  <image href="${source.dataUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" filter="url(#blur)" opacity="0.46"/>
  <rect width="100%" height="100%" fill="url(#veil)"/>
  <image href="${source.dataUrl}" x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.08)}" width="${Math.round(width * 0.36)}" height="${Math.round(height * 0.36)}" preserveAspectRatio="xMidYMid meet" opacity="0.88"/>
  <g font-family="Arial, sans-serif">
    <text x="${Math.round(width * 0.52)}" y="${Math.round(height * 0.18)}" font-size="${Math.max(24, Math.round(width / 22))}" font-weight="700" fill="#111827">元素编辑副本</text>
    <text x="${Math.round(width * 0.52)}" y="${Math.round(height * 0.25)}" font-size="${Math.max(13, Math.round(width / 58))}" fill="#6b7280">已创建语义图层工作区：背景、主体、文字、装饰</text>
    ${['背景层 / Background', '主体层 / Subject', '文字候选 / Text', '装饰与特效 / Deco'].map((label, i) => {
      const y = Math.round(height * (0.36 + i * 0.12));
      return `<rect x="${Math.round(width * 0.52)}" y="${y}" width="${Math.round(width * 0.36)}" height="${Math.round(height * 0.075)}" rx="14" fill="#ffffff" stroke="#e5e7eb"/><circle cx="${Math.round(width * 0.55)}" cy="${y + Math.round(height * 0.038)}" r="${Math.max(5, Math.round(width / 120))}" fill="#d4af37"/><text x="${Math.round(width * 0.58)}" y="${y + Math.round(height * 0.048)}" font-size="${Math.max(12, Math.round(width / 64))}" fill="#111827">${label}</text>`;
    }).join('')}
  </g>
</svg>`;
    return makeSvgDataUrl(svg);
  }, [loadImageAsDataUrl, makeSvgDataUrl]);

  // 3D model name to friendly Chinese label mapping
  const get3DModelLabel = useCallback((modelId: string): string => {
    if (!modelId) return modelId;
    const lower = modelId.toLowerCase();
    // 混元3D model mapping
    if (lower.includes('hunyuan') && lower.includes('lite')) return '混元3D 极速版';
    if (lower.includes('hunyuan') && lower.includes('standard')) return '混元3D 专业版';
    if (lower.includes('hunyuan') && lower.includes('pro')) return '混元3D 专业版';
    if (lower.includes('hunyuan') && (lower.includes('quick') || lower.includes('极速'))) return '混元3D 极速版';
    if (lower.includes('hunyuan') && (lower.includes('pro') || lower.includes('专业'))) return '混元3D 专业版';
    if (lower.includes('hunyuan')) return '混元3D';
    // Generic 3D models
    if (lower.includes('quick') || lower.includes('极速')) return `${modelId} (极速版)`;
    if (lower.includes('pro') || lower.includes('专业')) return `${modelId} (专业版)`;
    return modelId;
  }, []);

  // Load admin 3D models from server
  useEffect(() => {
    const loadAdmin3DModels = async () => {
      try {
        const res = await fetch('/api/models?type=3d');
        if (res.ok) {
          const data = await res.json();
          const models: Array<{ id: string; name: string; baseUrl: string; apiKey: string; model?: string; providerPreset?: string; providerName: string; advancedParams?: Record<string, string> }> = [];
          const providerMap = new Map<string, {name: string; baseUrl: string; apiKey: string; providerPreset?: string; advancedParams?: Record<string, string>}>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, { name: p.name || p.displayName || '管理员', baseUrl: p.baseUrl, apiKey: p.apiKey, providerPreset: p.providerPreset, advancedParams: p.advancedParams });
            }
          }
          // 从顶层 models 数组读取（已由服务端按 selectedModels + type 过滤）
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              const pInfo = providerMap.get(m.providerId);
              const modelId = `admin-3d::${m.providerId}::${m.id || m.name}`;
              models.push({
                id: modelId,
                name: pInfo?.name || '管理员',
                baseUrl: pInfo?.baseUrl || '',
                apiKey: pInfo?.apiKey || '',
                model: m.id || m.name,
                providerPreset: pInfo?.providerPreset || '',
                providerName: pInfo?.name || '管理员',
                advancedParams: pInfo?.advancedParams,
              });
            }
          }
          setAdmin3DModels(models);
        }
      } catch {
        // 静默失败
      }
    };
    loadAdmin3DModels();
  }, []);

  // Load image models for canvas generator
  useEffect(() => {
    const loadImageModels = async () => {
      try {
        const res = await fetch('/api/models?type=image');
        if (res.ok) {
          const data = await res.json();
          const models: {id: string, providerId: string, providerName: string, apiDisplayName?: string}[] = [];
          const providerMap = new Map<string, string>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, p.name || p.displayName || '');
            }
          }
          // 从顶层 models 数组读取（已由服务端按 selectedModels + type 过滤）
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              models.push({
                id: m.id || m.name,
                providerId: m.providerId || '',
                providerName: providerMap.get(m.providerId) || m.providerId || '',
                apiDisplayName: (m.name && m.name !== m.id) ? m.name : '',
              });
            }
          }
          setCanvasGenModels(models);
        }
      } catch { /* silent */ }
      // Also load user third-party APIs
      try {
        const stored = localStorage.getItem('unbounded_ai_universal_apis');
        if (stored) {
          const providers = JSON.parse(stored) as Array<{ id: string; name: string; displayName?: string; baseUrl: string; apiKey: string; isEnabled: boolean; modelType?: string; type?: string; selectedModel?: string; selectedModels?: string[] }>;
          const userModels: {id: string, providerId: string, providerName: string}[] = [];
          for (const p of providers) {
            if (!p.isEnabled) continue;
            if (p.modelType?.includes('image') || p.modelType === 'general' || p.type === 'general' || (!p.modelType && p.type === 'universal')) {
              const displayName = p.displayName || p.name;
              if (p.selectedModels && p.selectedModels.length > 0) {
                for (const m of p.selectedModels) {
                  userModels.push({ id: m, providerId: p.id, providerName: displayName });
                }
              }
            }
          }
          setCanvasGenModels(prev => {
            const existingKeys = new Set(prev.map(m => `${m.providerId}::${m.id}`));
            const newOnes = userModels.filter(m => !existingKeys.has(`${m.providerId}::${m.id}`));
            return [...prev, ...newOnes];
          });
        }
      } catch { /* silent */ }
    };
    loadImageModels();

    // Auto-refresh when page becomes visible (admin may have updated models)
    const handleVisibility = () => { if (document.visibilityState === 'visible') loadImageModels(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => { document.removeEventListener('visibilitychange', handleVisibility); };
  }, []);

  const getThreeDProviders = useCallback((): Array<{ id: string; name: string; baseUrl: string; apiKey: string; model?: string; providerPreset?: string; advancedParams?: Record<string, string>; providerName?: string }> => {
    const results: Array<{ id: string; name: string; baseUrl: string; apiKey: string; model?: string; providerPreset?: string; advancedParams?: Record<string, string>; providerName?: string }> = [];

    // 1. Admin-configured 3D models (server-side)
    for (const m of admin3DModels) {
      results.push({
        id: m.id,
        name: m.name,
        baseUrl: m.baseUrl,
        apiKey: m.apiKey,
        model: m.model,
        providerPreset: m.providerPreset,
        advancedParams: m.advancedParams,
        providerName: m.providerName,
      });
    }

    // 2. User third-party 3D APIs (localStorage)
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('unbounded_ai_universal_apis');
        if (stored) {
          const providers = JSON.parse(stored) as Array<{ id: string; name: string; displayName?: string; baseUrl: string; apiKey: string; isEnabled: boolean; modelType?: string; type?: string; selectedModel?: string; selectedModels?: string[]; providerPreset?: string; advancedParams?: Record<string, string> }>;
          for (const p of providers) {
            if (!p.isEnabled) continue;
            if (!(p.modelType?.includes('3d') || p.modelType === 'general' || p.type === 'general' || (!p.modelType && p.type === 'universal'))) continue;
            const displayName = p.displayName || p.name;
            if (p.selectedModels && p.selectedModels.length > 0) {
              for (const model of p.selectedModels) {
                results.push({
                  id: `${p.id}::${model}`,
                  name: displayName,
                  baseUrl: p.baseUrl,
                  apiKey: p.apiKey,
                  model,
                  providerPreset: p.providerPreset || '',
                  advancedParams: p.advancedParams,
                  providerName: displayName,
                });
              }
            } else if (p.selectedModel) {
              results.push({
                id: `${p.id}::${p.selectedModel}`,
                name: displayName,
                baseUrl: p.baseUrl,
                apiKey: p.apiKey,
                model: p.selectedModel,
                providerPreset: p.providerPreset || '',
                advancedParams: p.advancedParams,
                providerName: displayName,
              });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    return results;
  }, [admin3DModels]);

  // 3D provider capabilities configuration
  const threeDCapabilities = useMemo((): {
    qualities: { value: string; label: string }[];
    textures: { value: string; label: string }[];
    formats: { value: string; label: string }[];
  } => {
    const providers = getThreeDProviders();
    const selectedProvider = providers.find(p => p.id === threeDProviderId);
    const preset = selectedProvider?.providerPreset || '';

    // Default capabilities
    const defaultCap = {
      qualities: [{ value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }],
      textures: [{ value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
      formats: [{ value: 'glb', label: 'GLB' }, { value: 'obj', label: 'OBJ' }, { value: 'usdz', label: 'USDZ' }],
    };

    // Provider-specific capabilities
    const capMap: Record<string, typeof defaultCap> = {
      meshy: {
        qualities: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }],
        textures: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
        formats: [{ value: 'glb', label: 'GLB' }, { value: 'obj', label: 'OBJ' }, { value: 'fbx', label: 'FBX' }, { value: 'usdz', label: 'USDZ' }],
      },
      tripo: {
        qualities: [{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }],
        textures: [{ value: 'none', label: '无纹理' }, { value: '1k', label: '1K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
        formats: [{ value: 'glb', label: 'GLB' }, { value: 'obj', label: 'OBJ' }, { value: 'usdz', label: 'USDZ' }, { value: 'stl', label: 'STL' }],
      },
      rodin: {
        qualities: [{ value: 'draft', label: 'Draft' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }],
        textures: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
        formats: [{ value: 'glb', label: 'GLB' }, { value: 'obj', label: 'OBJ' }, { value: 'fbx', label: 'FBX' }],
      },
      deemos: {
        qualities: [{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }],
        textures: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
        formats: [{ value: 'glb', label: 'GLB' }, { value: 'obj', label: 'OBJ' }],
      },
      hunyuan: {
        qualities: [{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }],
        textures: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
        formats: [{ value: 'glb', label: 'GLB' }, { value: 'obj', label: 'OBJ' }],
      },
      // 极速版(rapid) - STL/USDZ/FBX + EnablePBR + EnableGeometry
      // Note: rapid version API does not support GLB output format
      'hunyuan-rapid': {
        qualities: [{ value: 'standard', label: 'Standard' }],
        textures: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }],
        formats: [{ value: 'fbx', label: 'FBX' }, { value: 'stl', label: 'STL' }, { value: 'usdz', label: 'USDZ' }],
      },
      // 专业版 - higher quality options
      'hunyuan-pro': {
        qualities: [{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }],
        textures: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
        formats: [{ value: 'glb', label: 'GLB' }, { value: 'obj', label: 'OBJ' }],
      },
    };

    // Match by preset name (case-insensitive partial match)
    const presetLower = preset.toLowerCase();
    for (const [key, cap] of Object.entries(capMap)) {
      if (presetLower.includes(key)) return cap;
    }

    // Also check provider name for keywords
    const providerName = (selectedProvider?.name || '').toLowerCase();
    for (const [key, cap] of Object.entries(capMap)) {
      if (providerName.includes(key)) return cap;
    }

    // Also check model name for version-specific capabilities
    const modelName = (selectedProvider?.model || '').toLowerCase();
    if (modelName.includes('lite') || modelName.includes('极速') || modelName.includes('quick') || modelName.includes('rapid')) {
      return capMap['hunyuan-rapid'] || defaultCap;
    }
    if (modelName.includes('pro') || modelName.includes('专业') || modelName.includes('standard')) {
      return capMap['hunyuan-pro'] || defaultCap;
    }

    // Local models
    if (threeDBackend === 'local') {
      return {
        qualities: [{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }],
        textures: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }],
        formats: [{ value: 'glb', label: 'GLB' }, { value: 'obj', label: 'OBJ' }],
      };
    }

    return defaultCap;
  }, [getThreeDProviders, threeDProviderId, threeDBackend]);

  // Auto-reset quality/texture/format when capabilities change
  useEffect(() => {
    if (!threeDCapabilities.qualities.find((q: { value: string }) => q.value === threeDQuality)) {
      setThreeDQuality(threeDCapabilities.qualities[0]?.value || 'high');
    }
    if (!threeDCapabilities.textures.find((t: { value: string }) => t.value === threeDTexture)) {
      setThreeDTexture(threeDCapabilities.textures[0]?.value || '2k');
    }
    if (!threeDCapabilities.formats.find((f: { value: string }) => f.value === threeDFormat)) {
      setThreeDFormat(threeDCapabilities.formats[0]?.value || 'glb');
    }
  }, [threeDCapabilities, threeDFormat, threeDQuality, threeDTexture]);

  // 获取当前选择的 providerId（从复合键中拆解）
  const getCurrentProviderId = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      const currentUserId = localStorage.getItem('unbounded_ai_current_user');
      if (!currentUserId) return null;
      const stored = localStorage.getItem('unbounded_ai_user_data');
      if (!stored) return null;
      const data = JSON.parse(stored);
      const userData = data.userData?.[currentUserId];
      if (!userData?.selectedModel) return null;
      // 从复合键 providerId::modelId 中拆解出 providerId
      const selectedModel = userData.selectedModel as string;
      if (selectedModel.includes('::')) {
        return selectedModel.split('::')[0] || null;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  // Render edit strokes onto a canvas and return base64
  useCallback(async (
        originalImageUrl: string,
        maskBase64: string,
        resultImageUrl: string,
        origW: number,
        origH: number,
        cropInfo?: { cropX: number; cropY: number; cropW: number; cropH: number } | null,
        mode?: 'erase' | 'mask'
      ): Promise<string> => {
        // 使用 Canvas 2D 合成，IOPaint/LaMa 风格的蒙版合成
        // cropInfo: 如果API使用了裁剪策略，结果图像是裁剪尺寸，需要放置到(cropX, cropY)位置
        const isErase = mode === 'erase';
        const canvas = document.createElement('canvas');
        canvas.width = origW;
        canvas.height = origH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        // 1. 加载所有图像
        const [origImg, maskImg, resultImg] = await Promise.all([
          loadImage(originalImageUrl),
          loadImage(maskBase64),
          loadImage(resultImageUrl),
        ]);

        // 2. 绘制原图作为底层
        ctx.drawImage(origImg, 0, 0, origW, origH);

        // 3. 解析蒙版（带模糊，擦除用12px，蒙版修图用18px）
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = origW;
        maskCanvas.height = origH;
        const maskCtx = maskCanvas.getContext('2d');
        if (!maskCtx) throw new Error('Canvas 2D context unavailable');
        maskCtx.drawImage(maskImg, 0, 0, origW, origH);
        const blurMaskCanvas = document.createElement('canvas');
        blurMaskCanvas.width = origW;
        blurMaskCanvas.height = origH;
        const blurMaskCtx = blurMaskCanvas.getContext('2d');
        if (!blurMaskCtx) throw new Error('Canvas 2D context unavailable');
        try {
          blurMaskCtx.filter = `blur(${isErase ? 12 : 18}px)`;
        } catch {
          // ignore unsupported filter
        }
        blurMaskCtx.drawImage(maskCanvas, 0, 0, origW, origH);
        const maskData = blurMaskCtx.getImageData(0, 0, origW, origH);

        // 4. 创建蒙版化的生成结果
        // 如果有cropInfo，结果图像是裁剪区域的，需要放置到正确位置
        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = origW;
        resultCanvas.height = origH;
        const resultCtx = resultCanvas.getContext('2d');
        if (!resultCtx) throw new Error('Canvas 2D context unavailable');

        if (cropInfo) {
          // 裁剪策略：结果图像需要覆盖 (cropX, cropY, cropW, cropH) 区域
          // 使用 inside 模式：等比缩放保留 AI 完整内容，居中放置，避免 cover 裁切导致错位
          const resultAspect = resultImg.naturalWidth / resultImg.naturalHeight;
          const cropAspect = cropInfo.cropW / cropInfo.cropH;
          let drawW: number, drawH: number, drawX: number, drawY: number;
          if (resultAspect > cropAspect) {
            // 结果更宽，以高度为准缩放
            drawH = cropInfo.cropH;
            drawW = Math.round(cropInfo.cropH * resultAspect);
            drawX = cropInfo.cropX + Math.round((cropInfo.cropW - drawW) / 2);
            drawY = cropInfo.cropY;
          } else if (resultAspect < cropAspect) {
            // 结果更高，以宽度为准缩放
            drawW = cropInfo.cropW;
            drawH = Math.round(cropInfo.cropW / resultAspect);
            drawX = cropInfo.cropX;
            drawY = cropInfo.cropY + Math.round((cropInfo.cropH - drawH) / 2);
          } else {
            drawW = cropInfo.cropW;
            drawH = cropInfo.cropH;
            drawX = cropInfo.cropX;
            drawY = cropInfo.cropY;
          }
          resultCtx.drawImage(resultImg, drawX, drawY, drawW, drawH);
          // 蒙版修图模式：对裁剪边缘做羽化处理 + 应用蒙版alpha通道
          if (!isErase) {
            // ★ 修复叠加bug：蒙版修图必须应用蒙版alpha通道，不能仅做边缘羽化
            // 否则裁剪区域内蒙版外的区域也会显示AI结果，产生叠加效果
            
            // 1) 先对裁剪边缘做羽化处理
            const edgeFeather = 24;
            const patchData = resultCtx.getImageData(0, 0, origW, origH);
            const cropRight = cropInfo.cropX + cropInfo.cropW - 1;
            const cropBottom = cropInfo.cropY + cropInfo.cropH - 1;
            for (let y = cropInfo.cropY; y <= cropBottom; y++) {
              for (let x = cropInfo.cropX; x <= cropRight; x++) {
                const idx = (y * origW + x) * 4 + 3;
                const edgeDistance = Math.min(
                  x - cropInfo.cropX,
                  y - cropInfo.cropY,
                  cropRight - x,
                  cropBottom - y
                );
                if (edgeDistance < edgeFeather) {
                  patchData.data[idx] = Math.min(
                    patchData.data[idx],
                    Math.max(0, Math.round((edgeDistance / edgeFeather) * 255))
                  );
                }
              }
            }
            
            // 2) 应用蒙版alpha通道：仅蒙版白色区域显示AI结果，蒙版黑色区域保持原图
            const WHITE_START = 160;
            const BLACK_START = 4;
            for (let i = 0; i < maskData.data.length; i += 4) {
              const maskValue = maskData.data[i]; // R channel (模糊后)
              let maskAlpha: number;
              if (maskValue >= WHITE_START) {
                maskAlpha = 255;
              } else if (maskValue <= BLACK_START) {
                maskAlpha = 0;
              } else {
                maskAlpha = Math.round(((maskValue - BLACK_START) / (WHITE_START - BLACK_START)) * 255);
              }
              // 取蒙版alpha和边缘羽化alpha的较小值，确保蒙版外区域完全透明
              const currentAlpha = patchData.data[i + 3];
              patchData.data[i + 3] = Math.min(currentAlpha, maskAlpha);
            }
            
            resultCtx.putImageData(patchData, 0, 0);
            ctx.drawImage(resultCanvas, 0, 0);
            return canvas.toDataURL('image/png');
          }
        } else {
          // 全图策略：结果图像是完整尺寸
          resultCtx.drawImage(resultImg, 0, 0, origW, origH);
        }

        // 获取生成结果的像素数据
        const resultImageData = resultCtx.getImageData(0, 0, origW, origH);

        // 5. 应用蒙版作为 alpha 通道（IOPaint sd_mask_blur 风格）
        // 模糊后的蒙版提供更平滑的边界过渡
        // 擦除模式：WHITE_START=210, BLACK_START=24 → 保留更多原图边界
        // 蒙版模式：WHITE_START=160, BLACK_START=4 → 更自然的过渡边界
        const WHITE_START = isErase ? 210 : 160;
        const BLACK_START = isErase ? 24 : 4;
        for (let i = 0; i < maskData.data.length; i += 4) {
          const maskValue = maskData.data[i]; // R channel (模糊后)
          let alpha: number;
          if (maskValue >= WHITE_START) {
            alpha = 255;
          } else if (maskValue <= BLACK_START) {
            alpha = 0;
          } else {
            alpha = Math.round(((maskValue - BLACK_START) / (WHITE_START - BLACK_START)) * 255);
          }
          resultImageData.data[i + 3] = alpha;
        }
        resultCtx.putImageData(resultImageData, 0, 0);

        // 6. 将蒙版化的生成结果覆盖到原图上
        ctx.drawImage(resultCanvas, 0, 0);

        // 7. 输出结果
        return canvas.toDataURL('image/png');
      }, []);

  // 加载图像辅助函数
  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  const renderMaskFromStrokes = useCallback((imgWidth: number, imgHeight: number): string | null => {
    if (editStrokes.length === 0) return null;

    const editImg = images.find(i => i.id === editImageId);
    if (!editImg) return null;

    // Use original image dimensions for mask to ensure pixel-perfect alignment
    // imgWidth/imgHeight are original pixel dimensions passed in
    const origW = imgWidth;
    const origH = imgHeight;

    // Create mask at original resolution for maximum precision
    // If original is very large (>2048), downscale to keep mask manageable
    const MAX_MASK_DIM = 2048;
    const uniformMaskScale = Math.min(MAX_MASK_DIM / origW, MAX_MASK_DIM / origH, 1);
    const maskW = Math.round(origW * uniformMaskScale);
    const maskH = Math.round(origH * uniformMaskScale);

    const canvas = document.createElement('canvas');
    canvas.width = maskW;
    canvas.height = maskH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Start with black (keep original)
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, maskW, maskH);

    // Stroke coordinates from the floating window are already in original image pixel space
    // (0..origW, 0..origH), so we just need to apply the mask scale factor
    const maskScale = uniformMaskScale;

    // Brush size is already in original image pixel space from the floating window
    const scaledBrushSize = brushSize * maskScale;

    // Use smooth interpolation for better mask quality
    ctx.imageSmoothingEnabled = true;

    // Draw normal strokes as white (masked area to modify)
    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = scaledBrushSize;

    for (const stroke of editStrokes) {
      const normalPoints = stroke.filter(p => !p.reverse);

      if (normalPoints.length === 1) {
        const px = normalPoints[0].x * maskScale;
        const py = normalPoints[0].y * maskScale;
        ctx.beginPath();
        ctx.arc(px, py, scaledBrushSize / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (normalPoints.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(
          normalPoints[0].x * maskScale,
          normalPoints[0].y * maskScale
        );
        for (let i = 1; i < normalPoints.length; i++) {
          ctx.lineTo(
            normalPoints[i].x * maskScale,
            normalPoints[i].y * maskScale
          );
        }
        ctx.stroke();
      }
    }

    // Draw reverse strokes as black (unmask/erase mask)
    ctx.strokeStyle = 'black';
    ctx.fillStyle = 'black';
    for (const stroke of editStrokes) {
      const reversePoints = stroke.filter(p => p.reverse);

      if (reversePoints.length === 1) {
        const px = reversePoints[0].x * maskScale;
        const py = reversePoints[0].y * maskScale;
        ctx.beginPath();
        ctx.arc(px, py, scaledBrushSize / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (reversePoints.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(
          reversePoints[0].x * maskScale,
          reversePoints[0].y * maskScale
        );
        for (let i = 1; i < reversePoints.length; i++) {
          ctx.lineTo(
            reversePoints[i].x * maskScale,
            reversePoints[i].y * maskScale
          );
        }
        ctx.stroke();
      }
    }

    // Apply Gaussian blur to mask edges for seamless blending
    try {
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = maskW;
      blurCanvas.height = maskH;
      const blurCtx = blurCanvas.getContext('2d');
      if (blurCtx) {
        blurCtx.filter = `blur(${editMode === 'erase' ? 12 : 18}px)`;
        blurCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, maskW, maskH);
        ctx.drawImage(blurCanvas, 0, 0);
      }
    } catch {
      // filter not supported in some browsers, skip blur
    }

    return canvas.toDataURL('image/png');
  }, [editStrokes, brushSize, images, editImageId, editMode]);

  // Poll for task completion
  // 存储最近一次 pollForResult 的错误信息，供调用方展示更精准的错误提示
  const lastPollErrorRef = useRef<string>('');
  // ★ 视频任务结果暂存（pollForResult返回imageUrl后，调用方从这里读取视频元数据）
  const lastVideoResultRef = useRef<{ videoUrl?: string; videoDuration?: number; videoThumbnailUrl?: string } | null>(null);

  // ★ 取消控制器：当前正在轮询的任务可通过 cancelTask 取消
  const pollingAbortRef = useRef<AbortController | null>(null);

  const pollForResult = useCallback(async (
    taskId: string,
    apiKeyOrModel: string,
    onProgress?: (progress: number, status: string) => void,
    engine?: string
  ): Promise<string | null> => {
    // apiKeyOrModel was previously apiKey, now we pass the model name for server-side key lookup
    // ★ 使用传入的 model 参数（由后端 usedModel 返回），而非 getCurrentModel()，
    // 避免用户在轮询期间切换模型导致查询错误的提供商
    const pollModel = apiKeyOrModel || getCurrentModel().model;
    const cachedProviderId = getCurrentProviderId(); // ★ 缓存 providerId，避免轮询期间用户切换模型导致查询错误的提供商
    const maxAttempts = 360; // 360次 × 动态间隔 ≈ 最长15分钟，适配各种慢速API
    let consecutiveErrors = 0;
    const getEditPollInterval = (attempt: number) => {
      if (attempt <= 2) return 800;    // 前期快轮询，尽快捕获短任务
      if (attempt <= 8) return 1200;
      if (attempt <= 20) return 1800;
      if (attempt <= 60) return 2500;  // 中期2.5s
      return 4000;                    // 后期4s，避免高频请求浪费
    };
    lastPollErrorRef.current = '';

    // ★ 创建取消控制器
    const abortController = new AbortController();
    pollingAbortRef.current = abortController;

    const startTime = Date.now();
    for (let i = 0; i < maxAttempts; i++) {
      // ★ 检查是否被取消
      if (abortController.signal.aborted) {
        lastPollErrorRef.current = '任务已被取消';
        return null;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed/60)}m${elapsed%60}s`;
      // 进度曲线：0-30s快速爬升(20→40)，30-120s平缓(40→75)，120s+缓慢(75→92)
      const baseProgress = elapsed < 30
        ? 20 + Math.round((elapsed / 30) * 20)
        : elapsed < 120
          ? 40 + Math.round(((elapsed - 30) / 90) * 35)
          : Math.min(92, 75 + Math.round(((elapsed - 120) / 600) * 17));
      onProgress?.(
        Math.min(92, baseProgress),
        `AI 正在生成中... (已等待 ${elapsedStr})`
      );
      // ★ SSE加速：同时等待定时器和SSE完成事件
      const pollDelay = getEditPollInterval(i);
      await Promise.race([
        new Promise(r => setTimeout(r, pollDelay)),
        new Promise(resolve => {
          if (!taskEventsClient.isConnected()) { resolve(undefined); return; }
          const unsub = taskEventsClient.onTaskEvent(event => {
            if (event.taskId === taskId && ['completed', 'failed', 'cancelled'].includes(event.type)) {
              unsub();
              resolve(undefined);
            }
          });
          setTimeout(() => { unsub(); resolve(undefined); }, pollDelay + 2000);
        })
      ]);
      try {
        const res = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, model: pollModel, providerId: cachedProviderId, engine }),
          signal: abortController.signal,
        });
        if (!res.ok) throw new Error(`Poll HTTP ${res.status}`);
        const data = await res.json();
        consecutiveErrors = 0;

        // ★ 检查服务端返回的真实进度（若有）
        if (typeof data.progress === 'number' && data.progress > 0) {
          const serverProgress = Math.min(92, Math.round(data.progress * 0.9) + 10);
          onProgress?.(serverProgress, data.status || `AI 正在生成中... (已等待 ${elapsedStr})`);
        }

        // ★ 检查服务端取消状态
        if (data.status === 'cancelled') {
          lastPollErrorRef.current = '任务已被取消';
          return null;
        }

        if (data.status === 'completed' && data.imageUrl) {
          onProgress?.(95, '生成完成，正在处理图片...');
          // ★ 视频任务：将视频元数据暂存到全局变量，供调用方使用
          if (data.taskType === 'video' && data.videoUrl) {
            lastVideoResultRef.current = {
              videoUrl: data.videoUrl,
              videoDuration: data.videoDuration,
              videoThumbnailUrl: data.videoThumbnailUrl,
            };
          }
          // ★ 记录使用统计
          try {
            const taskType = data.taskType || 'image';
            const usageTypeMap: Record<string, 'image' | 'video' | 'edit' | '3d' | 'chat'> = {
              image: 'image', video: 'video', edit: 'edit',
              erase: 'edit', mask: 'edit', upscale: 'edit',
              extend: 'edit', removebg: 'edit', outpaint: 'edit',
              refine: 'edit', '3d': '3d', agent: 'edit',
            };
            const um = await import('@/lib/user-manager').then(m => m.UserManager.getInstance());
            um.recordUsage(usageTypeMap[taskType] ?? 'image');
          } catch {}
          return data.imageUrl;
        }
        if (data.status === 'failed' || data.status === 'error') {
          console.error('Task failed:', data.error);
          lastPollErrorRef.current = translateErrorFrontend(data.error || 'AI 模型处理失败');
          return null;
        }
        // retryable errors — continue polling
        if (data.retryable === false) {
          lastPollErrorRef.current = translateErrorFrontend(data.error || '任务不可重试');
          return null;
        }
      } catch (e: unknown) {
        // ★ 取消导致的abort不重试
        if (e instanceof DOMException && e.name === 'AbortError') {
          lastPollErrorRef.current = '任务已被取消';
          return null;
        }
        // Network/polling errors — continue polling with backoff
        consecutiveErrors++;
        console.error('Poll error:', e);
        if (consecutiveErrors >= 10) {
          lastPollErrorRef.current = '网络连接不稳定，请重试';
          return null;
        }
        // 网络错误时多等一会
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    lastPollErrorRef.current = '生成超时，AI 模型响应时间过长，请稍后重试或切换其他模型';
    return null;
  }, [getCurrentModel, getCurrentProviderId]);

  // ========================
  // TOOL IMPLEMENTATIONS
  // ========================

  // ========================
  // Canvas-Embedded Image Generator
  // ========================

  const handleOpenCanvasGenerator = useCallback(() => {
    if (showCanvasGenerator) {
      // Close: remove placeholder frame
      if (canvasGenFrameId) {
        onImagesChange(imagesRef.current.filter(img => img.id !== canvasGenFrameId));
        setCanvasGenFrameId(null);
      }
      setShowCanvasGenerator(false);
      return;
    }
    // Set initial panel position (right side of viewport)
    const container = canvasRef.current?.getBoundingClientRect();
    const panelX = container ? Math.min(container.right - 440, window.innerWidth - 440) : window.innerWidth - 440;
    const panelY = container ? container.top + 60 : 60;
    setCanvasGenPanelPos({ x: Math.max(10, panelX), y: Math.max(10, panelY) });
    setCanvasGenMinimized(false);
    setShowCanvasGenerator(true);
    setCanvasGenPrompt('');
    setCanvasGenNegativePrompt('');
    setCanvasGenRefImages([]);
    // Auto-select first model if none selected
    if (!canvasGenModel && canvasGenModels.length > 0) {
      setCanvasGenModel(`${canvasGenModels[0].providerId}::${canvasGenModels[0].id}`);
    }
  }, [showCanvasGenerator, canvasGenFrameId, onImagesChange, canvasGenModel, canvasGenModels]);

  const handleCanvasGenerate = useCallback(async () => {
    if (!canvasGenPrompt.trim() || canvasGenGenerating) return;
    setCanvasGenGenerating(true);
    setCanvasGenPreviewUrl(null);
    setCanvasGenProgress(0);

    // Create a processing frame on the canvas (if not already existing)
    let currentFrameId = canvasGenFrameId;
    if (!currentFrameId) {
      const container = canvasRef.current?.getBoundingClientRect();
      const centerX = container ? (container.width / 2 - viewOffset.x) / zoom : 100;
      const centerY = container ? (container.height / 2 - viewOffset.y) / zoom : 100;
      const frameId = `gen-frame-${Date.now()}`;
      const newFrame: CanvasImage = {
        id: frameId,
        url: '',
        x: centerX - canvasGenFrameWidth / 2,
        y: centerY - canvasGenFrameHeight / 2,
        width: canvasGenFrameWidth,
        height: canvasGenFrameHeight,
        isProcessingPlaceholder: true,
        processing: { label: '生成中...', status: 'processing', progress: 10, startTime: Date.now() },
      };
      onImagesChange([...imagesRef.current, newFrame]);
      setCanvasGenFrameId(frameId);
      setCanvasGenFramePos({ x: newFrame.x, y: newFrame.y });
      currentFrameId = frameId;
    } else {
      // Update existing frame to processing state
      onImagesChange(images.map(img => {
        if (img.id === currentFrameId) {
          return { ...img, processing: { label: '生成中...', status: 'processing', progress: 10, startTime: img.processing?.startTime || Date.now() } };
        }
        return img;
      }));
    }

    try {
      const canvasGenPureModel = canvasGenModel?.includes('::') ? canvasGenModel.split('::')[1] : canvasGenModel || undefined;
      const canvasGenProviderId = canvasGenModel?.includes('::') ? canvasGenModel.split('::')[0] : undefined;
      // 提交生成请求（带超时保护）
      // 超时需匹配后端 maxDuration (600s=10分钟)，部分第三方API出图可达90秒+
      const canvasGenController = new AbortController();
      const canvasGenTimeout = setTimeout(() => canvasGenController.abort(), 600000); // 10分钟超时，匹配后端maxDuration

      let res: Response;
      try {
        res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: canvasGenPrompt,
            negativePrompt: canvasGenNegativePrompt || undefined,
            model: canvasGenPureModel,
            providerId: canvasGenProviderId,
            aspectRatio: canvasGenAspectRatio,
            resolution: canvasGenResolution,
            quality: canvasGenQuality,
            n: canvasGenCount,
            submitOnly: true,  // 异步提交模式：立即返回taskId，前端轮询
            referenceImages: canvasGenRefImages.length > 0 ? canvasGenRefImages : undefined,
          }),
          signal: canvasGenController.signal,
        });
      } finally {
        clearTimeout(canvasGenTimeout);
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '生成失败');
      }

      const data = await res.json();

      // === 直接返回模式：API 直接返回图片 ===
      // 支持两种格式：
      // 1. { success: true, mode: 'direct', imageUrls: [...] }
      // 2. { taskIds: [], directImageUrls: [...], usedModel, usedProviderId } (Responses API)
      const directUrls: string[] = (data.success && data.mode === 'direct')
        ? data.imageUrls
        : (data.directImageUrls && data.directImageUrls.length > 0)
          ? data.directImageUrls
          : [];

      if (directUrls.length > 0) {
        const imageUrls = directUrls;
        // 并行持久化所有图片URL
        const savedUrls = await Promise.all(imageUrls.map(async (imageUrl: string) => {
          let savedUrl = imageUrl;
          try {
            const saveRes = await fetch('/api/save-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl }),
            });
            if (saveRes.ok) {
              const saveData = await saveRes.json();
              if (saveData.success && saveData.url) savedUrl = saveData.url;
            }
          } catch {}
          return savedUrl;
        }));
        const nextImages = applyCanvasGenerationResults(
          imagesRef.current, currentFrameId, savedUrls,
          (frame, url) => ({ ...frame, url, isProcessingPlaceholder: false, processing: undefined, prompt: canvasGenPrompt, modelName: data.usedModel || data.modelName || canvasGenPureModel, apiProvider: data.usedProviderId || data.providerName }),
          (frame, url, index) => ({ id: `canvas-gen-${Date.now()}-${index}`, url, x: frame ? frame.x + frame.width + 20 + index * (canvasGenFrameWidth + 20) : 100, y: frame?.y ?? 100, width: canvasGenFrameWidth, height: canvasGenFrameHeight, prompt: canvasGenPrompt, modelName: data.usedModel || data.modelName || canvasGenPureModel, apiProvider: data.usedProviderId || data.providerName } as CanvasImage),
        );
        imagesRef.current = nextImages;
        onImagesChange(nextImages);
        setCanvasGenGenerating(false);
        // 设置预览URL，保持面板打开让用户查看结果
        if (savedUrls[0]) {
          setCanvasGenPreviewUrl(savedUrls[0]);
          setCanvasGenProgress(100);
        }
        // 不自动关闭面板，让用户查看结果
        return;
      }

      const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);
      // 使用服务端实际使用的模型（可能因自动切换而与请求模型不同）
      const actualGenModel = data.model || (canvasGenModel?.includes('::') ? canvasGenModel.split('::').pop()! : canvasGenModel) || undefined;

      if (taskIds.length === 0) {
        throw new Error('未获取到任务ID');
      }

      // Poll for results
      let lastPollData: Record<string, unknown> | null = null;
      const pollForResult = async (taskId: string): Promise<string | null> => {
        const maxAttempts = 300; // 兼容慢速API
        const getPollInterval = (attempt: number) => {
          if (attempt <= 5) return 200;   // 快速检测任务完成
          if (attempt <= 15) return 500;
          if (attempt <= 30) return 1000;
          if (attempt <= 50) return 1500;
          return 2000;
        };
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // ★ SSE加速：同时等待定时器和SSE完成事件
          const pollDelay = getPollInterval(attempt);
          await Promise.race([
            new Promise(r => setTimeout(r, pollDelay)),
            new Promise(resolve => {
              if (!taskEventsClient.isConnected()) { resolve(undefined); return; }
              const unsub = taskEventsClient.onTaskEvent(event => {
                if (event.taskId === taskId && ['completed', 'failed', 'cancelled'].includes(event.type)) {
                  unsub();
                  resolve(undefined);
                }
              });
              setTimeout(() => { unsub(); resolve(undefined); }, pollDelay + 2000);
            })
          ]);
          try {
            const pollRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: actualGenModel, providerId: canvasGenProviderId }),
            });
            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();
            // ★ 兼容多种返回格式：
            // 1. 顶层 imageUrl (completedTaskCache路径)
            // 2. result.image.url (异步轮询路径)
            // 3. result.images[0].url (多图返回路径)
            // 4. result.url (本地任务路径)
            const resultUrl = pollData.imageUrl 
              || pollData.result?.url 
              || pollData.result?.imageUrl 
              || (pollData.result?.image as Record<string, unknown>)?.url 
              || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url;
            // ★ 支持 submitOnly 模式返回的 imageUrls 数组（单 taskId → 多张图）
            const imageUrlsArr = pollData.result?.imageUrls as string[] | undefined;
            if (pollData.status === 'completed') {
              if (imageUrlsArr && imageUrlsArr.length > 0) {
                lastPollData = pollData;
                // 返回特殊标记，由上层展开
                return `__multi__${JSON.stringify(imageUrlsArr)}`;
              }
              if (resultUrl) {
                lastPollData = pollData;
                return resultUrl as string;
              }
            }
            if (pollData.status === 'failed' || pollData.status === 'cancelled') {
              return null;
            }
            // Update progress
            const progress = Math.min(90, 10 + (attempt / maxAttempts) * 80);
            setCanvasGenProgress(progress);
            if (currentFrameId) {
              onImagesChange(imagesRef.current.map(img => {
                if (img.id === currentFrameId) {
                  return { ...img, processing: { label: '生成中...', status: 'processing', progress } };
                }
                return img;
              }));
            }
          } catch { /* continue polling */ }
        }
        return null;
      };

      const results = await Promise.all(taskIds.map(pollForResult));
      // ★ 展开 submitOnly 模式返回的多图数组（__multi__[...]）
      const validUrls: string[] = [];
      for (const url of results) {
        if (url && typeof url === 'string') {
          if (url.startsWith('__multi__')) {
            try {
              const urlsArr = JSON.parse(url.slice(9)) as string[];
              validUrls.push(...urlsArr);
            } catch { /* ignore parse error */ }
          } else {
            validUrls.push(url);
          }
        }
      }

      if (validUrls.length > 0) {
        const completedPollData = lastPollData as Record<string, unknown> | null;
        const nextImages = applyCanvasGenerationResults(
          imagesRef.current, currentFrameId, validUrls,
          (frame, url) => ({ ...frame, url, isProcessingPlaceholder: false, processing: undefined, prompt: canvasGenPrompt, model: canvasGenPureModel, quality: canvasGenQuality, aspectRatio: canvasGenAspectRatio, modelName: typeof completedPollData?.modelName === 'string' ? completedPollData.modelName : canvasGenPureModel, apiProvider: typeof completedPollData?.providerName === 'string' ? completedPollData.providerName : undefined }),
          (frame, url, index) => ({ id: `gen-result-${Date.now()}-${index}`, url, x: frame ? frame.x + frame.width + 20 + index * (canvasGenFrameWidth + 20) : 100, y: frame?.y ?? 100, width: canvasGenFrameWidth, height: canvasGenFrameHeight, prompt: canvasGenPrompt, model: canvasGenPureModel, quality: canvasGenQuality, aspectRatio: canvasGenAspectRatio, modelName: typeof completedPollData?.modelName === 'string' ? completedPollData.modelName : canvasGenPureModel, apiProvider: typeof completedPollData?.providerName === 'string' ? completedPollData.providerName : undefined } as CanvasImage),
        );
        imagesRef.current = nextImages;
        onImagesChange(nextImages);
        // 设置面板预览框的结果
        setCanvasGenPreviewUrl(validUrls[0]);
        setCanvasGenProgress(100);
        // 不自动关闭面板，让用户查看结果并继续操作
        setCanvasGenFrameId(null);
        // B3: 部分失败追踪
        if (validUrls.length < taskIds.length) {
          setCanvasGenPartialFailCount(taskIds.length - validUrls.length);
        } else {
          setCanvasGenPartialFailCount(0);
        }
      } else {
        throw new Error('生成超时或失败');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '生成失败';
      // Show error on frame
      if (currentFrameId) {
        onImagesChange(imagesRef.current.map(img => {
          if (img.id === currentFrameId) {
            return { ...img, processing: { label: errorMsg, status: 'failed', progress: 0 } };
          }
          return img;
        }));
      }
    } finally {
      setCanvasGenGenerating(false);
    }
  }, [canvasGenPrompt, canvasGenGenerating, canvasGenFrameId, viewOffset.x, viewOffset.y, zoom, onImagesChange, images, canvasGenModel, canvasGenNegativePrompt, canvasGenAspectRatio, canvasGenResolution, canvasGenQuality, canvasGenCount, canvasGenRefImages]);

  // Update frame position when images change
  useEffect(() => {
    if (canvasGenFrameId && showCanvasGenerator) {
      const frame = images.find(img => img.id === canvasGenFrameId);
      if (frame) {
        setCanvasGenFramePos({ x: frame.x, y: frame.y });
      }
    }
  }, [images, canvasGenFrameId, showCanvasGenerator]);

  // 浮动面板拖拽处理
  const handleCanvasGenDragStart = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const header = target.closest('[data-panel-header]');
    if (!header) return;
    e.preventDefault();
    e.stopPropagation();
    setCanvasGenDragging(true);
    setCanvasGenDragOffset({ x: e.clientX - canvasGenPanelPos.x, y: e.clientY - canvasGenPanelPos.y });
  }, [canvasGenPanelPos]);

  useEffect(() => {
    if (!canvasGenDragging) return;
    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCanvasGenPanelPos({ x: e.clientX - canvasGenDragOffset.x, y: e.clientY - canvasGenDragOffset.y });
    };
    const onUp = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCanvasGenDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [canvasGenDragging, canvasGenDragOffset]);

  // ============ ChatCanvas 批注功能 ============

  useCallback((canvasX: number, canvasY: number) => {
        // 碰撞检测：找到点击位置对应的图片
        const targetId = hitTestAnnotationTarget(canvasX, canvasY, images);
        if (!targetId) {
          // 点击空白区域，提示用户
          return;
        }
        // 创建批注并进入编辑状态
        const ann = createAnnotation(canvasX, canvasY, '', targetId);
        // 计算点击区域（用于告诉AI修改位置）
        const targetImg = images.find(i => i.id === targetId);
        if (targetImg) {
          ann.region = computeAnnotationRegion(canvasX, canvasY, targetImg.x, targetImg.y, targetImg.width, targetImg.height);
        }
        annotationIdCounter.current += 1;
        setAnnotations(prev => [...prev, ann]);
        setEditingAnnotationId(ann.id);
      }, [images]);

  useCallback((annotationId: string, text: string) => {
        if (!text.trim()) {
          // 空文字，删除批注
          setAnnotations(prev => prev.filter(a => a.id !== annotationId));
          setEditingAnnotationId(null);
          return;
        }
        setAnnotations(prev => prev.map(a =>
          a.id === annotationId ? { ...a, text: text.trim(), status: 'pending' as const } : a
        ));
        setEditingAnnotationId(null);
      }, []);

  /** 执行单条批注：调用 /api/edit 修图 */
  const executeAnnotation = useCallback(async (annotation: CanvasAnnotation): Promise<AnnotationExecutionResult> => {
    if (!annotation.targetImageId || !annotation.text.trim()) return { status: 'failed', aiReply: '无目标图片或批注内容为空' };

    const targetImg = images.find(i => i.id === annotation.targetImageId);
    if (!targetImg) return { status: 'failed', aiReply: '未找到目标图片' };

    // 标记为执行中 + 保存原始图片URL用于对比
    setAnnotations(prev => prev.map(a =>
      a.id === annotation.id ? { ...a, status: 'running' as const, originalImageUrl: a.originalImageUrl || targetImg.url } : a
    ));

    try {
      // 构建提示词（包含区域描述）
      let prompt = buildAnnotationPrompt(annotation);

      // Multi-image context: describe other images on canvas for AI understanding
      const canvasImages = images.filter(i => !i.isProcessingPlaceholder && i.id !== targetImg.id);
      if (canvasImages.length > 0) {
        const contextParts = canvasImages.slice(0, 5).map((img, i) => {
          const desc = img.prompt || '无描述';
          return `图片${i + 1}: ${desc.slice(0, 60)}`;
        });
        prompt = `[画布上下文：当前画布上还有${canvasImages.length}张其他图片 — ${contextParts.join('；')}] ${prompt}`;
      }

      // 将图片转为 data URL
      const imgToDataUrl = (url: string): Promise<string> => new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if (!ctx) { reject(new Error('Canvas context failed')); return; }
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = url;
      });

      let imageDataUrl: string;
      try {
        imageDataUrl = await imgToDataUrl(targetImg.url);
      } catch {
        // 如果跨域加载失败，直接用URL
        imageDataUrl = targetImg.url;
      }

      // 构建请求体（含蒙版）
      // Use currently selected model from generation panel
      const { model: currentModel, providerId: currentProviderId } = getCurrentModel();
      const effectiveModel = currentModel || 'gpt-image-2';
      // Calculate aspect ratio from original image
      const aspectRatio = closestSupportedImageAspectRatio(targetImg.width, targetImg.height);
      const requestBody: Record<string, unknown> = {
        image: imageDataUrl,
        prompt,
        size: aspectRatio,
        quality: 'high',
        model: effectiveModel,
        providerId: currentProviderId || undefined,
        count: 1,
      };

      // 如果有画笔蒙版，直接使用
      if (annotation.brushMaskDataUrl) {
        requestBody.mask = annotation.brushMaskDataUrl;
      }
      // 如果有框选区域，生成蒙版并附加
      else if (annotation.region && targetImg) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Image load failed for mask'));
            img.src = targetImg.url;
          });
          const mc = document.createElement('canvas');
          mc.width = img.naturalWidth;
          mc.height = img.naturalHeight;
          const mctx = mc.getContext('2d');
          if (mctx && annotation.region) {
            // 黑色背景（保留区域）
            mctx.fillStyle = '#000000';
            mctx.fillRect(0, 0, mc.width, mc.height);
            // 白色蒙版（修改区域）— region is normalized 0~1
            const rx = annotation.region.x * img.naturalWidth;
            const ry = annotation.region.y * img.naturalHeight;
            const rw = annotation.region.w * img.naturalWidth;
            const rh = annotation.region.h * img.naturalHeight;
            mctx.fillStyle = '#ffffff';
            mctx.fillRect(rx, ry, rw, rh);
            requestBody.mask = mc.toDataURL('image/png');
          }
        } catch {
          // 蒙版生成失败，不附加蒙版
        }
      }

      // 提交修图任务
      const submitResp = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!submitResp.ok) {
        const errText = await submitResp.text().catch(() => '');
        console.error('Submit refine error:', submitResp.status, errText);
        const aiReply = translateApiError(errText, submitResp.status, errText).title || '提交修改请求失败';
        setAnnotations(prev => prev.map(a =>
          a.id === annotation.id ? { ...a, status: 'failed' as const, aiReply } : a
        ));
        return { status: 'failed', aiReply };
      }
      const submitData = await submitResp.json();
      if (!submitData.success || !submitData.taskId) {
        const errMsg = submitData.error || '提交修改失败';
        setAnnotations(prev => prev.map(a =>
          a.id === annotation.id ? { ...a, status: 'failed' as const, aiReply: errMsg } : a
        ));
        return { status: 'failed', aiReply: errMsg };
      }

      // 轮询任务结果
      const taskId = submitData.taskId;
      const maxPollTime = 1500000; // 25分钟
      const pollStart = Date.now();
      let completed = false;

      while (!completed && Date.now() - pollStart < maxPollTime) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const pollResp = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, model: effectiveModel, providerId: currentProviderId || undefined }),
          });
          if (!pollResp.ok) {
            console.error('Poll refine error:', pollResp.status);
            continue;
          }
          const pollData = await pollResp.json();
          if (!pollData.success && pollData.status !== 'completed') {
            // 任务不存在或已过期
            if (pollData.status === 'failed' || pollData.status === 'not_found') {
              const aiReply = pollData.error || '任务已过期或不存在';
              setAnnotations(prev => prev.map(a =>
                a.id === annotation.id ? { ...a, status: 'failed' as const, aiReply } : a
              ));
              completed = true;
              return { status: 'failed', aiReply };
            }
            continue;
          }
          // ★ 兼容多种返回格式：
          // 1. 顶层 imageUrl (completedTaskCache路径)
          // 2. result.image.url (异步轮询路径)
          // 3. result.images[0].url (多图返回路径)
          // 4. result.url (本地任务路径)
          const resultUrl = pollData.imageUrl 
            || pollData.result?.url 
            || pollData.result?.imageUrl 
            || (pollData.result?.image as Record<string, unknown>)?.url 
            || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url;
          if (pollData.status === 'completed' && resultUrl) {
            completed = true;
            // 添加结果图片到原图右侧（不覆盖原图，方便对比）
            const gap = 40;
            const newImage: CanvasImage = {
              id: `edit_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              url: resultUrl,
              x: targetImg.x + targetImg.width + gap,
              y: targetImg.y,
              width: targetImg.width,
              height: targetImg.height,
              prompt: annotation.text || prompt.replace(/^\[画布上下文[：:][^\]]*\]\s*/, ''),
            };
            onImagesChange([...imagesRef.current, newImage]);
            const aiReply = '修改完成';
            setAnnotations(prev => prev.map(a =>
              a.id === annotation.id ? { ...a, status: 'done' as const, resultImageUrl: resultUrl, aiReply, chatExpanded: true } : a
            ));
            return { status: 'done', aiReply, resultImageUrl: resultUrl };
          } else if (pollData.status === 'failed' || pollData.status === 'not_found' || !pollData.success) {
            completed = true;
            const aiReply = pollData.error || pollData.label || '修改失败';
            setAnnotations(prev => prev.map(a =>
              a.id === annotation.id ? { ...a, status: 'failed' as const, aiReply, chatExpanded: true } : a
            ));
            return { status: 'failed', aiReply };
          }
        } catch {
          // 轮询网络错误，继续重试
        }
      }

      if (!completed) {
        const aiReply = '修改超时';
        setAnnotations(prev => prev.map(a =>
          a.id === annotation.id ? { ...a, status: 'failed' as const, aiReply } : a
        ));
        return { status: 'failed', aiReply };
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '修改失败';
      setAnnotations(prev => prev.map(a =>
        a.id === annotation.id ? { ...a, status: 'failed' as const, aiReply: errMsg } : a
      ));
      return { status: 'failed', aiReply: errMsg };
    }
    // TypeScript exhaustiveness — all code paths above return
    return { status: 'failed', aiReply: '未知错误' };
  }, [getCurrentModel, images, onImagesChange]);

  useCallback(async () => {
        const pendingAnnotations = annotations.filter(a => a.status === 'pending' && a.text.trim());
        if (pendingAnnotations.length === 0) return;

        // 按图片分组，同图批注串行执行
        const grouped = new Map<string, CanvasAnnotation[]>();
        for (const ann of pendingAnnotations) {
          const key = ann.targetImageId || 'none';
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(ann);
        }

        // 不同图片的批注可以并行
        const promises: Promise<void>[] = [];
        for (const [, groupAnns] of grouped) {
          promises.push((async () => {
            for (const ann of groupAnns) {
              await executeAnnotation(ann);
            }
          })());
        }
        await Promise.all(promises);
      }, [annotations, executeAnnotation]);

  useCallback((id: string) => {
        setAnnotations(prev => prev.filter(a => a.id !== id));
        if (editingAnnotationId === id) setEditingAnnotationId(null);
      }, [editingAnnotationId]);

  useCallback(() => {
        setAnnotationMode(false);
        setEditingAnnotationId(null);
      }, []);

  /** 提交批注输入框内容 */
  const submitAnnotationInput = useCallback(() => {
    if (!editingAnnotationId || !annotationInputText.trim()) return;
    setAnnotations(prev => prev.map(a =>
      a.id === editingAnnotationId ? { ...a, text: annotationInputText.trim() } : a
    ));
    setEditingAnnotationId(null);
    setAnnotationInputText('');
  }, [editingAnnotationId, annotationInputText]);

  /** 执行当前图片的所有pending批注 */
  const executePendingAnnotations = useCallback(async () => {
    const pending = annotations.filter(a => a.status === 'pending' && a.text.trim());
    if (pending.length === 0) return;

    // Group annotations by targetImageId — same image annotations merged into one request
    const groups = new Map<string, CanvasAnnotation[]>();
    for (const ann of pending) {
      const key = ann.targetImageId || '__no_target__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ann);
    }

    // Execute each group (different images can run in parallel)
    const promises: Promise<AnnotationExecutionResult>[] = [];
    for (const [, groupAnns] of groups) {
      if (groupAnns.length === 1) {
        // Single annotation — execute directly
        promises.push(executeAnnotation(groupAnns[0]));
      } else {
        // Multiple annotations on same image — merge into one request
        const mergedText = groupAnns.map((a, i) => `${i + 1}. ${a.text}`).join('\n');
        const firstAnn = groupAnns[0];
        // Mark all as running
        setAnnotations(prev => prev.map(a =>
          groupAnns.some(ga => ga.id === a.id) ? { ...a, status: 'running' as const } : a
        ));
        const mergedAnn: CanvasAnnotation = {
          ...firstAnn,
          id: `merged_${firstAnn.id}`,
          text: mergedText,
        };
        promises.push(
          executeAnnotation(mergedAnn).then((result) => {
            setAnnotations(prev => prev.map(a =>
              groupAnns.some(ga => ga.id === a.id)
                ? applyMergedAnnotationExecutionResult(a, result)
                : a
            ));
            return result;
          }).catch((err: unknown) => {
            const aiReply = err instanceof Error ? err.message : '修改失败';
            setAnnotations(prev => prev.map(a =>
              groupAnns.some(ga => ga.id === a.id)
                ? applyMergedAnnotationExecutionResult(a, { status: 'failed', aiReply })
                : a
            ));
            return { status: 'failed' as const, aiReply };
          })
        );
      }
    }
    await Promise.all(promises);
  }, [annotations, executeAnnotation]);

  // Follow-up question for a completed annotation
  const handleAnnotationFollowUp = useCallback(async (annId: string, followUpText: string) => {
    const ann = annotations.find(a => a.id === annId);
    if (!ann || !ann.targetImageId) return;

    const newEntry = { role: 'user' as const, content: followUpText };
    setAnnotations(prev => prev.map(a =>
      a.id === annId ? {
        ...a,
        followUpHistory: [...(a.followUpHistory || []), newEntry],
        status: 'running' as const,
      } : a
    ));
    setFollowUpInputId(null);
    setFollowUpInputText('');

    try {
      // Find the target image
      const targetImage = images.find(img => img.id === ann.targetImageId);
      if (!targetImage) throw new Error('Target image not found');

      const modelInfo = getCurrentModel();
      const imageUrl = targetImage.url.startsWith('/') ? `${window.location.origin}${targetImage.url}` : targetImage.url;

      // Build combined prompt: original + follow-up history
      const historyPrompt = (ann.followUpHistory || []).map(h => `${h.role === 'user' ? 'User' : 'AI'}: ${h.content}`).join('\n');
      const combinedPrompt = historyPrompt
        ? `Previous edits:\n${historyPrompt}\n\nAdditional modification: ${followUpText}`
        : followUpText;

      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageUrl,
          prompt: combinedPrompt,
          model: modelInfo.model,
          providerId: modelInfo.providerId || undefined,
          size: '1:1',
          quality: 'high',
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('Edit API error:', res.status, errText);
        return;
      }
      const data = await res.json();
      if (data.taskId) {
        // Poll for result
        let completed = false;
        let pollAttempts = 0;
        const maxPollAttempts = 750; // ~25 minutes
        while (!completed && pollAttempts < maxPollAttempts) {
          pollAttempts++;
          await new Promise(r => setTimeout(r, 2000));
          const pollRes = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: data.taskId, model: modelInfo.model, providerId: modelInfo.providerId || undefined }),
          });
          if (!pollRes.ok) { completed = true; break; }
          const pollData = await pollRes.json();
          // ★ 兼容多种返回格式：
          // 1. 顶层 imageUrl (completedTaskCache路径)
          // 2. result.image.url (异步轮询路径)
          // 3. result.images[0].url (多图返回路径)
          // 4. result.url (本地任务路径)
          const newImageUrl = pollData.imageUrl 
            || pollData.result?.url 
            || pollData.result?.imageUrl 
            || (pollData.result?.image as Record<string, unknown>)?.url 
            || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url;
          if (pollData.status === 'completed' && newImageUrl) {
            // Add result image next to original (instead of replacing)
            const targetImage = images.find(img => img.id === ann.targetImageId);
            if (targetImage) {
              const gap = 40;
              const newImage: CanvasImage = {
                id: `followup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                url: newImageUrl,
                x: targetImage.x + targetImage.width + gap,
                y: targetImage.y,
                width: targetImage.width,
                height: targetImage.height,
                prompt: combinedPrompt,
              };
              onImagesChange([...imagesRef.current, newImage]);
            }
            const aiReplyEntry = { role: 'assistant' as const, content: '已根据您的反馈完成修改' };
            setAnnotations(prev => prev.map(a =>
              a.id === annId ? {
                ...a,
                status: 'done' as const,
                aiReply: '已根据您的反馈完成修改',
                followUpHistory: [...(a.followUpHistory || []), aiReplyEntry],
              } : a
            ));
            completed = true;
          } else if (pollData.status === 'failed') {
            throw new Error(pollData.error || 'Modification failed');
          }
        }
      } else if (data.imageUrl) {
        onImagesChange(images.map(img =>
          img.id === ann.targetImageId ? { ...img, url: data.imageUrl, prompt: combinedPrompt } : img
        ));
        const aiReplyEntry = { role: 'assistant' as const, content: '已根据您的反馈完成修改' };
        setAnnotations(prev => prev.map(a =>
          a.id === annId ? {
            ...a,
            status: 'done' as const,
            aiReply: '已根据您的反馈完成修改',
            followUpHistory: [...(a.followUpHistory || []), aiReplyEntry],
          } : a
        ));
      } else {
        throw new Error(data.error || 'No result returned');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Follow-up failed';
      const aiReplyEntry = { role: 'assistant' as const, content: `修改失败: ${errorMsg}` };
      setAnnotations(prev => prev.map(a =>
        a.id === annId ? {
          ...a,
          status: 'failed' as const,
          aiReply: `修改失败: ${errorMsg}`,
          followUpHistory: [...(a.followUpHistory || []), aiReplyEntry],
        } : a
      ));
    }
  }, [annotations, images, getCurrentModel, onImagesChange]);

  // Clean up pending annotations when exiting annotation mode
  useEffect(() => {
    if (!annotationMode) {
      // Remove pending (unsubmitted) annotations when leaving mode
      setAnnotations(prev => prev.filter(a => a.status !== 'pending'));
      setEditingAnnotationId(null);
      setAnnotationInputText('');
      setFollowUpInputId(null);
      setFollowUpInputText('');
      setAnnotationRegionStart(null);
      setAnnotationRegionCurrent(null);
    }
  }, [annotationMode]);

  // 1. UPSCALE - floating panel with size options
  useCallback((mult: number) => {
        setUpscaleMultiplier(mult);
      }, []);

  // Compute target dimensions from preset (2x/4x/8x multiplier based on actual image size)
  const getUpscaleTargetDimensions = useCallback((origW: number, origH: number, preset: '2k' | '4k' | '8k') => {
    // Preset multiplier: 2K=2x, 4K=4x, 8K=8x based on actual image dimensions
    const multiplier = preset === '2k' ? 2 : preset === '4k' ? 4 : 8;
    return {
      w: Math.round(origW * multiplier),
      h: Math.round(origH * multiplier),
      multiplier,
    };
  }, []);

  const handleUpscaleConfirm = useCallback(async () => {
    const img = getActiveImageData();
    if (!img) return;

    // Use actual pixel dimensions loaded from the image element
    const origW = upscaleActualW || img.originalWidth || img.width;
    const origH = upscaleActualH || img.originalHeight || img.height;
    const { w: targetW, h: targetH, multiplier: upMultiplier } = getUpscaleTargetDimensions(origW, origH, upscalePreset);

    // 放大结果应保持与原图相同的画布显示尺寸，仅 originalWidth/Height 变大
    const displayW = img.width;
    const displayH = img.height;

    const placeholderId = createProcessingFrameRightOf(
      img,
      '放大中',
      displayW,
      displayH,
      '正在提交放大任务...'
    );
    setIsEditProcessing(true);
    exitEditModeRef.current();
    try {
      const modelInfo = getCurrentModel();
      // Determine actual engine for upscale from preference
      const actualEngine: 'auto'|'ai'|'local'|'cpu' = upscaleEnginePref === 'local' ? 'cpu' : (upscaleEnginePref === 'ai' ? 'ai' : 'auto');
      updateProcessingFrame(placeholderId, { progress: 8, status: actualEngine === 'cpu' ? '正在使用本地 Real-ESRGAN 放大...' : actualEngine === 'ai' ? '正在提交到 AI 模型...' : '正在选择最优放大引擎...' });
      // ★ 放大操作可能耗时较长（如108s），设置5分钟超时与后端直接模式600s对齐
      const upscaleController = new AbortController();
      const upscaleTimeout = setTimeout(() => upscaleController.abort(), 600000); // 10分钟超时，匹配后端maxDuration
      let res: Response;
      try {
        if (actualEngine === 'cpu') {
          // 本地 upscayl：调用 /api/image/upscale (upscayl-node)
          res = await fetch('/api/image/upscale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageUrl: img.url,
              scale: upMultiplier,
              model: upscaylSelectedModel,
            }),
            signal: upscaleController.signal,
          });
        } else {
          res = await fetch('/api/image-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'upscale',
              imageUrl: img.url,
              prompt: img.prompt || img.modifyPrompt || '', // 传图片描述给后端，让AI知道原图内容
              targetWidth: targetW,
              targetHeight: targetH,
              aspectRatio: findClosestStandardRatio(origW, origH),
              model: modelInfo.model,
              providerId: modelInfo.providerId || getCurrentProviderId(),
              scale: upMultiplier,
              originalWidth: origW,
              originalHeight: origH,
              upscaleMode: actualEngine === 'ai' ? 'ai' : 'auto',
              engine: actualEngine,
            }),
            signal: upscaleController.signal,
          });
        }
      } catch (fetchErr: unknown) {
        clearTimeout(upscaleTimeout);
        const err = fetchErr as Error;
        if (err.name === 'AbortError') {
          updateProcessingFrame(placeholderId, {
            progress: -1,
            status: '❌ 放大请求超时，AI模型响应时间过长，请稍后重试',
            error: '放大请求超时',
          });
          setTimeout(() => removeProcessingFrame(placeholderId), 5000);
        } else {
          updateProcessingFrame(placeholderId, {
            progress: -1,
            status: `❌ 放大请求失败: ${err.message}`,
            error: err.message,
          });
          setTimeout(() => removeProcessingFrame(placeholderId), 5000);
        }
        setIsEditProcessing(false);
        return;
      }
      clearTimeout(upscaleTimeout);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        const errorMsg = errorText || `服务器错误 (${res.status})`;
        console.error('[upscale] API error:', res.status, errorText.slice(0, 200));
        alert(`放大失败: ${errorMsg}`);
        setIsEditProcessing(false);
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch (jsonErr) {
        console.error('[upscale] JSON parse error:', jsonErr);
        alert('放大失败: 服务器返回了无效的响应');
        setIsEditProcessing(false);
        return;
      }

      if (!data.success) {
        updateProcessingFrame(placeholderId, {
          progress: -1,
          status: `❌ ${translateErrorFrontend(String(data.error || '放大失败'))}`,
          error: translateErrorFrontend(String(data.error || '放大失败')),
        });
        setTimeout(() => removeProcessingFrame(placeholderId), 5000);
        setIsEditProcessing(false);
        return;
      }

      updateProcessingFrame(placeholderId, { progress: 22, status: upscaleMode === 'lossless' ? '无损放大中（Real-ESRGAN 超分辨率 + AI画质精修）...' : 'AI 放大 + 画质精修中...' });
      let resultUrl: string | null;
      let actualOutW = targetW;
      let actualOutH = targetH;
      let usedModelName = modelInfo.apiDisplayName || modelInfo.model;

      let proStrategy = '';
      if (upscaleMode === 'lossless') {
        // 无损放大：可能直接返回URL，也可能降级到异步轮询
        proStrategy = (data.strategy as string) || '';
        const isFallback = data.fallback === true;
        const fallbackReason = (data.fallbackReason as string) || '';

        if (data.requiresPolling && data.taskId) {
          // 降级到AI异步轮询
          const aiTaskId = data.taskId as string;
          usedModelName = 'AI重绘放大(降级)';
          resultUrl = await pollForResult(aiTaskId, usedModelName, (progress, status) => {
            updateProcessingFrame(placeholderId, { progress, status });
          });
        } else {
          resultUrl = (data.url as string) || null;
          const proModel = (data.model as string) || 'Real-ESRGAN';
          const isEnhanced = data.enhanced === true;
          if (proStrategy === 'onnx+ai-enhance') {
            usedModelName = 'Real-ESRGAN+AI精修' + (isFallback ? '(降级)' : '');
          } else if (proStrategy === 'cloud+ai-enhance') {
            usedModelName = '云端无损+AI精修';
          } else if (proStrategy === 'local-upscayl') {
            usedModelName = '本地Real-ESRGAN' + (isFallback ? '(降级)' : '');
          } else if (proStrategy === 'ai-redraw+ai-enhance') {
            usedModelName = 'AI放大+精修' + (isFallback ? '(降级)' : '');
          } else if (proStrategy === 'ai-redraw') {
            usedModelName = 'AI重绘放大' + (isFallback ? '(降级)' : '');
          } else {
            usedModelName = proModel === 'SeedVR2-Upscaler' ? 'SeedVR2 无损放大' : 'Real-ESRGAN 无损放大';
            if (isEnhanced) usedModelName += '+AI精修';
          }
        }

        if (isFallback && fallbackReason) {
          console.warn(`[upscale] 降级提示: ${fallbackReason}`);
          toast.warning(`无损放大提示: ${fallbackReason}`);
        }
      } else {
        usedModelName = String(data.usedModel || modelInfo.model);
        resultUrl = (data.imageUrl as string | null) || await pollForResult((data.taskId as string) || '', usedModelName, (progress, status) => {
          updateProcessingFrame(placeholderId, { progress, status });
        });
        const outSize = data.outputSize as { width: number; height: number } | undefined;
        actualOutW = outSize?.width || (data.outputWidth as number) || targetW;
        actualOutH = outSize?.height || (data.outputHeight as number) || targetH;
      }
      if (resultUrl) {
        updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入结果...' });
        const stableUrl = await awaitStableImageUrl(resultUrl as string);
        // 无损放大结果异步检测实际尺寸
        if (upscaleMode === 'lossless') {
          const imgEl = new Image();
          imgEl.onload = () => {
            actualOutW = imgEl.naturalWidth;
            actualOutH = imgEl.naturalHeight;
          };
          imgEl.src = stableUrl;
        }
        completeProcessingFrame(placeholderId, stableUrl, displayW, displayH, {
          originalWidth: actualOutW,
          originalHeight: actualOutH,
          modifyPrompt: `${upMultiplier}x ${upscaleMode === 'lossless' ? '无损' : 'HD'} ${upscalePreset.toUpperCase()} 放大`,
          modelName: usedModelName,
          apiProvider: upscaleMode === 'lossless' ? (proStrategy === 'local-upscayl' ? '本地' : proStrategy === 'ai-redraw' ? 'AI重绘' : proStrategy === 'cloud-fal-SeedVR2' ? 'fal.ai' : 'PearAPI') : (modelInfo.providerName || ''),
        }, 'upscale');
      } else {
        const pollError = lastPollErrorRef.current || '放大超时，请重试';
        updateProcessingFrame(placeholderId, {
          progress: -1,
          status: `❌ ${pollError}`,
          error: pollError,
        });
        setTimeout(() => removeProcessingFrame(placeholderId), 5000);
      }
    } catch (e) {
      console.error('Upscale error:', e);
      updateProcessingFrame(placeholderId, {
        progress: -1,
        status: `❌ 操作失败: ${e instanceof Error ? e.message : '请重试'}`,
        error: e instanceof Error ? e.message : '请重试',
      });
      setTimeout(() => removeProcessingFrame(placeholderId), 5000);
    }
    setIsEditProcessing(false);
    setActiveTool('none');
  }, [getActiveImageData, upscaleActualW, upscaleActualH, getUpscaleTargetDimensions, upscalePreset, createProcessingFrameRightOf, getCurrentModel, upscaleEnginePref, updateProcessingFrame, upscaleMode, upscaylSelectedModel, getCurrentProviderId, removeProcessingFrame, pollForResult, completeProcessingFrame]);

  // Engine selection helper: if pref saved, run directly; else open dialog
  const triggerWithEngine = useCallback((tool: 'upscale'|'removebg'|'svg'|'segment', doExecute: (engine: 'auto'|'ai'|'local') => void) => {
    const pref = getEnginePref(tool);
    // First time (localStorage empty → default 'auto' is returned, which is valid, run directly)
    // Always run with the saved pref directly (auto is smart default)
    doExecute(pref);
  }, []);

  // 1b. Upscale trigger - opens floating control bar
  const handleOpenUpscale = useCallback(() => {
    triggerWithEngine('upscale', () => {
    const img = getActiveImageData();
    if (!img) return;
    setEditImageId(img.id);
    setEditMode('upscale');
    // Load actual pixel dimensions from the image element
    const imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    imgEl.onload = () => {
      const actualW = imgEl.naturalWidth;
      const actualH = imgEl.naturalHeight;
      setUpscaleActualW(actualW);
      setUpscaleActualH(actualH);
      // Auto-select preset based on actual image size
      const maxDim = Math.max(actualW, actualH);
      if (maxDim >= 2000) setUpscalePreset('2k'); // Large images: 2x is enough
      else if (maxDim >= 800) setUpscalePreset('4k'); // Medium: 4x
      else setUpscalePreset('2k'); // Small: 2x default
    };
    imgEl.onerror = () => {
      // Fallback to stored dimensions
      const origW = img.originalWidth || img.width;
      const origH = img.originalHeight || img.height;
      setUpscaleActualW(origW);
      setUpscaleActualH(origH);
      const maxDim = Math.max(origW, origH);
      if (maxDim >= 2000) setUpscalePreset('2k');
      else if (maxDim >= 800) setUpscalePreset('4k');
      else setUpscalePreset('2k');
    };
    imgEl.src = img.url;
    });
  }, [getActiveImageData, triggerWithEngine]);

  // 2. REMOVE BACKGROUND - auto, result to the right
  const handleRemoveBackground = useCallback(async () => {
    const img = getActiveImageData();
    if (!img) return;
    const placeholderId = createProcessingFrameRightOf(
      img,
      '去背景中',
      img.width,
      img.height,
      '正在创建去背景任务...'
    );
    setIsEditProcessing(true);
    try {
      const modelInfo = getCurrentModel();
      updateProcessingFrame(placeholderId, { progress: 12, status: '正在提交到 AI 模型...' });
      const res = await fetch('/api/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_background',
          imageUrl: img.url,
          aspectRatio: findClosestStandardRatio(img.originalWidth || img.width, img.originalHeight || img.height),
          model: modelInfo.model,
          providerId: modelInfo.providerId || getCurrentProviderId(),
          removeBgModel: removeBgModelId,
          engine: removeBgEngine,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        const errorMsg = errorText || `服务器错误 (${res.status})`;
        console.error('[removeBg] API error:', res.status, errorText.slice(0, 200));
        alert(`移除背景失败: ${errorMsg}`);
        setIsEditProcessing(false);
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch (jsonErr) {
        console.error('[removeBg] JSON parse error:', jsonErr);
        alert('移除背景失败: 服务器返回了无效的响应');
        setIsEditProcessing(false);
        return;
      }

      if (!data.success) {
        alert(translateErrorFrontend(String(data.error || '移除背景失败')));
        setIsEditProcessing(false);
        return;
      }

      updateProcessingFrame(placeholderId, { progress: 22, status: data.engine === 'local-background-alpha' ? '正在生成透明背景...' : String(data.engine || '').includes('iopaint') ? 'IOPaint 正在去除背景...' : 'AI 正在识别主体边缘...' });

      // 兼容两种后端返回：
      // 1) 同步返回 imageUrl（本地透明化 / AI 直接出图 — 后端已做棋盘格后处理）
      // 2) 异步返回 taskId（AI 模型通过 APImart 等代理异步处理，前端轮询）
      let resultUrl: string | null = data.imageUrl ? String(data.imageUrl) : null;
      let maskResultUrl: string | null = data.maskUrl ? String(data.maskUrl) : null;
      if (!resultUrl && data.taskId) {
        // AI RemoveBG 异步轮询：APImart 代理可能需要 60-120 秒
        // 轮询次数增加到 60 次（约 120 秒），适应 AI 模型处理时间
        const isAIRemoveBg = String(data.engine || '').includes('ai-background-remove');
        const maxRemoveBgAttempts = isAIRemoveBg ? 120 : 60;
        const asyncResult = await (async () => {
          const taskId = data.taskId as string;
          const modelInfo = getCurrentModel();
          const cachedProviderId = getCurrentProviderId(); // ★ 缓存 providerId
          const getEditPollInterval = (attempt: number) => {
            if (attempt <= 5) return 300;
            if (attempt <= 15) return 600;
            return 1200;
          };
          for (let i = 0; i < maxRemoveBgAttempts; i++) {
            updateProcessingFrame(placeholderId, {
              progress: Math.min(90, 22 + Math.round((i / maxRemoveBgAttempts) * 68)),
              status: i < 3 ? '等待 AI 模型响应...' : isAIRemoveBg ? 'AI 正在识别主体并移除背景...' : 'AI 正在处理背景...'
            });
            await new Promise<string | undefined>(resolve => {
              if (taskEventsClient.isConnected()) {
                const unsub = taskEventsClient.onTaskEvent(event => {
                  if (event.taskId === taskId && (event.type === 'completed' || event.type === 'failed')) {
                    unsub(); resolve(undefined);
                  }
                });
                setTimeout(() => { unsub(); resolve(undefined); }, getEditPollInterval(i));
              } else {
                setTimeout(() => resolve(undefined), getEditPollInterval(i));
              }
            });
            try {
              const res = await fetch('/api/poll-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, model: modelInfo.model, providerId: cachedProviderId, engine: data.engine }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const pollData = await res.json();
              // ★ 兼容多种返回格式
              const resultUrl = pollData.imageUrl 
                || pollData.result?.url 
                || pollData.result?.imageUrl 
                || (pollData.result?.image as Record<string, unknown>)?.url 
                || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url;
              if (pollData.status === 'completed' && resultUrl) {
                return { imageUrl: resultUrl as string, maskUrl: (pollData.maskUrl || pollData.result?.maskUrl || '') as string };
              }
              if (pollData.status === 'failed' || pollData.status === 'error' || pollData.status === 'cancelled' || pollData.retryable === false) return null;
            } catch { /* continue */ }
          }
          return null;
        })();
        if (asyncResult) {
          resultUrl = asyncResult.imageUrl;
          if (asyncResult.maskUrl) maskResultUrl = asyncResult.maskUrl;
        }
      }

      if (resultUrl) {
        const w = img.originalWidth || Math.round(img.width);
        const h = img.originalHeight || Math.round(img.height);
        updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入透明背景结果...' });
        const stableUrl = await awaitStableImageUrl(resultUrl);
        const completedImage = completeProcessingFrame(placeholderId, stableUrl, img.width, img.height, {
          originalWidth: w,
          originalHeight: h,
          modifyPrompt: data.engine === 'local-background-alpha' ? '背景移除（本地透明化）' : String(data.engine || '').includes('ai-background-remove') ? '背景移除（AI高精度）' : '背景移除',
          modelName: modelInfo.apiDisplayName || modelInfo.model,
          apiProvider: modelInfo.providerName || '',
        }, 'removebg');

        // 同时添加黑白蒙版图到画布（紧邻主体图右侧）
        if (maskResultUrl && completedImage) {
          try {
            const stableMaskUrl = await awaitStableImageUrl(maskResultUrl);
            const gap = 10;
            const maskImage: CanvasImage = {
              id: `mask-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
              url: stableMaskUrl,
              x: completedImage.x + completedImage.width + gap,
              y: completedImage.y,
              width: completedImage.width,
              height: completedImage.height,
              originalWidth: w,
              originalHeight: h,
              prompt: '黑白蒙版（白色=主体，黑色=背景）',
              model: 'removebg-mask',
            };
            const nextImages = [...imagesRef.current, maskImage];
            imagesRef.current = nextImages;
            onImagesChange(nextImages);
          } catch (maskErr) {
            console.warn('[removeBg] Failed to add mask image to canvas:', maskErr);
          }
        }
      } else {
        alert(translateErrorFrontend(lastPollErrorRef.current || String(data.error || '移除背景超时，请重试')));
      }
    } catch (e) {
      console.error('Remove background error:', e);
      alert(`操作失败: ${e instanceof Error ? e.message : '请重试'}`);
    }
    setIsEditProcessing(false);
  }, [getActiveImageData, createProcessingFrameRightOf, getCurrentModel, updateProcessingFrame, getCurrentProviderId, removeBgModelId, removeBgEngine, completeProcessingFrame, onImagesChange]);

  // 3. SVG智能描摹 - Sharp + VTracer (彩色) / ImageMagick + Potrace (黑白) / Sharp (压缩/缩略图)
  const handleOpenSvgTrace = useCallback(() => {
    const img = getActiveImageData();
    if (!img) return;
    setEditImageId(img.id);
    setShowSvgTracePanel(true);
  }, [getActiveImageData]);

  const handleSvgTraceConfirm = useCallback(async () => {
    const img = getActiveImageData();
    if (!img) return;
    const modelInfo = getCurrentModel();

    const modeLabels: Record<string, string> = {
      color: '全彩矢量化',
      bw: '黑白描摹',
    };
    const modeLabel = modeLabels[svgTraceMode] || 'SVG描摹';

    const placeholderId = createProcessingFrameRightOf(
      img,
      modeLabel + '中',
      img.width,
      img.height,
      '正在处理...'
    );
    // 点击开始后立即关闭面板，让画布显示处理进度
    setShowSvgTracePanel(false);
    setIsSvgTraceProcessing(true);
    try {
      // === WASM 引擎：前端直接转换，无需服务器 ===
      if (svgTraceEngine === 'wasm-vtracer') {
        try {
          updateProcessingFrame(placeholderId, { progress: 10, status: '正在加载 WASM 引擎...' });
          const { vtracerWasmClient } = await import('@/lib/vtracer-wasm-client');
          
          updateProcessingFrame(placeholderId, { progress: 20, status: `正在${modeLabel} (WASM)...` });
          
          // WASM 引擎使用位深度(1-8)，而非颜色数量；使用质量预设映射
          const WASM_PRESETS: Record<string, { colorPrecision: number; filterSpeckle: number; maxColors?: number }> = {
            fast: { colorPrecision: 4, filterSpeckle: 4, maxColors: 16 },
            balanced: { colorPrecision: 5, filterSpeckle: 4, maxColors: 32 },
            high: { colorPrecision: 6, filterSpeckle: 4, maxColors: 64 },
            max: { colorPrecision: 7, filterSpeckle: 4, maxColors: 128 },
          };
          const wasmPreset = WASM_PRESETS[svgTraceQualityPreset] || WASM_PRESETS.balanced;
          const result = await vtracerWasmClient.convertImage(img.url, {
            colorMode: svgTraceMode === 'bw' ? 'bw' : 'color',
            colorPrecision: wasmPreset.colorPrecision,
            filterSpeckle: wasmPreset.filterSpeckle,
            ...(svgTraceCornerThreshold !== null ? { cornerThreshold: svgTraceCornerThreshold } : {}),
            ...(svgTraceLengthThreshold !== null ? { lengthThreshold: svgTraceLengthThreshold } : {}),
            ...(svgTraceHierarchical !== null ? { hierarchical: svgTraceHierarchical } : {}),
            maxColors: wasmPreset.maxColors,
          });

          if (!result.success || !result.svg) {
            throw new Error(result.error || 'WASM 转换失败');
          }

          updateProcessingFrame(placeholderId, { progress: 80, status: '正在保存结果...' });

          // 保存 SVG 到服务器用于下载
          let svgUrl = '';
          let displayUrl = '';
          try {
            const saveSvgRes = await fetch('/api/save-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`, format: 'svg' }),
            });
            if (saveSvgRes.ok) {
              const saveData = await saveSvgRes.json();
              svgUrl = saveData.url || '';
              displayUrl = svgUrl;
            }
          } catch {}

          // 生成 PNG 预览用于画布显示
          if (!displayUrl) {
            displayUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
          }

          const engineLabel = `WASM·VTracer`;
          completeProcessingFrame(placeholderId, displayUrl, img.width, img.height, {
            originalWidth: img.originalWidth || Math.round(img.width),
            originalHeight: img.originalHeight || Math.round(img.height),
            modifyPrompt: `${modeLabel} (${engineLabel})${result.pathCount ? '·' + result.pathCount + '路径' : ''}`,
            ...(svgUrl ? { svgUrl } : {}),
            svgDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`,
            modelName: modelInfo.apiDisplayName || modelInfo.model,
            apiProvider: modelInfo.providerName || '',
          }, 'trace');

          setIsSvgTraceProcessing(false);
          setShowSvgTracePanel(false);
          return;
        } catch (wasmErr) {
          console.error('[svg-trace] WASM failed:', wasmErr);
          removeProcessingFrame(placeholderId);
          alert(`WASM 矢量化失败: ${wasmErr instanceof Error ? wasmErr.message : '请重试'}`);
          setIsSvgTraceProcessing(false);
          return;
        }
      }

      // === 服务器端引擎：调用 /api/svg-trace ===
      // Prepare image URL: convert data/blob URLs to server URLs first
      let imageUrl = img.url;
      if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
        updateProcessingFrame(placeholderId, { progress: 10, status: '正在上传图片...' });
        const saveRes = await fetch('/api/save-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl }) });
        if (saveRes.ok) {
          const saveData = await saveRes.json();
          imageUrl = saveData.url || imageUrl;
        }
      }

      updateProcessingFrame(placeholderId, { progress: 20, status: `正在${modeLabel}...` });

      const requestBody: Record<string, unknown> = {
        imageUrl,
        mode: svgTraceMode,
        qualityPreset: svgTraceQualityPreset,
        outputFormat: svgTraceOutputFormat,
        engine: svgTraceEngine,
      };

      // Mode-specific params (only include if user has explicitly set, otherwise use preset)
      if (svgTraceMode === 'color') {
        if (svgTraceColorPrecision !== null) requestBody.colorPrecision = svgTraceColorPrecision;
        if (svgTraceFilterSpeckle !== null) requestBody.filterSpeckle = svgTraceFilterSpeckle;
        if (svgTraceCornerThreshold !== null) requestBody.cornerThreshold = svgTraceCornerThreshold;
        if (svgTraceLengthThreshold !== null) requestBody.lengthThreshold = svgTraceLengthThreshold;
        if (svgTraceCurveMode !== null) requestBody.curveMode = svgTraceCurveMode;
        if (svgTraceHierarchical !== null) requestBody.hierarchical = svgTraceHierarchical;
      } else if (svgTraceMode === 'bw') {
        requestBody.threshold = svgTraceBwThreshold;
        requestBody.turdSize = svgTraceBwTurdSize;
        requestBody.invert = svgTraceBwInvert;
        // alphaMax not used in simplified panel
      }

      const svgTraceController = new AbortController();
      const svgTraceTimeout = setTimeout(() => svgTraceController.abort(new Error('SVG描摹超时，请重试或选择其他引擎')), 300_000); // 5分钟超时（自动模式需多引擎降级）
      const response = await fetch('/api/svg-trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: svgTraceController.signal,
      }).finally(() => clearTimeout(svgTraceTimeout));

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`SVG描摹失败: ${errText || response.status}`);
      }

      updateProcessingFrame(placeholderId, { progress: 60, status: '正在处理结果...' });

      const data = await response.json();

      if (data.success) {
        updateProcessingFrame(placeholderId, { progress: 88, status: '正在渲染预览...' });

        if (svgTraceMode === 'color' || svgTraceMode === 'bw') {
          // SVG结果 - 优先使用PNG预览图用于画布显示，保留SVG数据用于下载
          // API返回: data.dataUrl(PNG服务器URL或SVG服务器URL), data.url(服务器SVG文件路径), data.isSvgPreview(PNG是否生成成功)
          // 显示策略: data.dataUrl(PNG服务器URL优先，SVG服务器URL兜底)
          // 下载策略: 优先svgDataUrl(离线可用), 其次从svgUrl服务器获取
          const displayUrl = data.dataUrl || data.url;
          const engineLabelMap: Record<string, string> = {
            vtracer: 'VTracer', potrace: 'Potrace', 'vectorize-api': 'Vectorizer', vlm: 'VLM', imagetracer: 'ImageTracer', 'wasm-vtracer': 'WASM·VTracer'
          };
          const engineLabel = engineLabelMap[data.engine] || data.engine || 'Auto';
          completeProcessingFrame(placeholderId, displayUrl, img.width, img.height, {
            originalWidth: img.originalWidth || Math.round(img.width),
            originalHeight: img.originalHeight || Math.round(img.height),
            modifyPrompt: `${modeLabel} (${engineLabel})${data.engineFallbackWarning ? ' ⚠️' : ''}`,
            // 保存SVG服务器URL用于下载（轻量级，不占localStorage空间）
            ...(data.url ? { svgUrl: data.url } : {}),
            // 保存小型SVG data URL用于离线下载（大型SVG通过svgUrl下载）
            ...(data.svgDataUrl ? { svgDataUrl: data.svgDataUrl } : {}),
            modelName: modelInfo.apiDisplayName || modelInfo.model,
            apiProvider: modelInfo.providerName || '',
          }, 'trace');
          // 显示引擎降级警告
          if (data.engineFallbackWarning) {
            toast.warning(data.engineFallbackWarning, { duration: 8000 });
          }
        } else {
          // Compress / thumbnail result - use data URL for display
          const displayUrl = data.dataUrl || data.url;
          let resultW = img.width;
          let resultH = img.height;
          if (data.stats) {
            resultW = data.stats.width || img.width;
            resultH = data.stats.height || img.height;
          }
          completeProcessingFrame(placeholderId, displayUrl, resultW, resultH, {
            originalWidth: img.originalWidth || Math.round(img.width),
            originalHeight: img.originalHeight || Math.round(img.height),
            modifyPrompt: modeLabel,
            modelName: modelInfo.apiDisplayName || modelInfo.model,
            apiProvider: modelInfo.providerName || '',
          }, 'trace');
        }
      } else {
        // 如果是路径数量过多错误，自动重试并强制输出
        const errorMsg = data.error || '处理失败';
        if (errorMsg.includes('路径数量过多') || errorMsg.includes('path count')) {
          console.log('[svg-trace] 路径过多，自动重试(forceSvg)...');
          updateProcessingFrame(placeholderId, { progress: 30, status: '正在简化路径...' });
          const forceBody: Record<string, unknown> = { ...requestBody, forceSvg: true };
          const forceRes = await fetch('/api/svg-trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(forceBody),
          });
          if (forceRes.ok) {
            const forceData = await forceRes.json();
            if (forceData.success) {
              // 重试成功，继续处理
              updateProcessingFrame(placeholderId, { progress: 88, status: '正在渲染预览...' });
              if (svgTraceMode === 'color' || svgTraceMode === 'bw') {
                const displayUrl = forceData.dataUrl || forceData.url;
                completeProcessingFrame(placeholderId, displayUrl, img.width * 2, img.height * 2, {
                  prompt: `SVG描摹(${svgTraceMode === 'color' ? '全彩' : '黑白'}${forceData.engine ? '·' + forceData.engine : ''}${forceData.pathCount ? '·' + forceData.pathCount + '路径' : ''})`,
                  svgDataUrl: forceData.svgDataUrl || forceData.svg,
                  originalWidth: forceData.width || Math.round(img.width * 2),
                  originalHeight: forceData.height || Math.round(img.height * 2),
                  modifyPrompt: 'trace',
                  modelName: modelInfo.apiDisplayName || modelInfo.model,
                  apiProvider: modelInfo.providerName || '',
                }, 'trace');
              }
              setIsSvgTraceProcessing(false);
              setShowSvgTracePanel(false);
              return;
            }
          }
        }
        throw new Error(errorMsg);
      }
    } catch (e) {
      console.error('SVG trace failed:', e);
      // 移除处理中的占位框，避免画布上残留空白框
      removeProcessingFrame(placeholderId);
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      const abortReason = isAbort && e.message ? e.message : '';
      alert(`SVG智能描摹失败: ${abortReason || (e instanceof Error ? e.message : '请重试')}`);
    }
    setIsSvgTraceProcessing(false);
    setShowSvgTracePanel(false);
  }, [getActiveImageData, getCurrentModel, svgTraceMode, createProcessingFrameRightOf, svgTraceEngine, updateProcessingFrame, svgTraceQualityPreset, svgTraceCornerThreshold, svgTraceLengthThreshold, svgTraceHierarchical, completeProcessingFrame, removeProcessingFrame, svgTraceColorPrecision, svgTraceFilterSpeckle, svgTraceCurveMode, svgTraceBwThreshold, svgTraceBwTurdSize, svgTraceBwInvert]);

  // Multi-angle - Lovart-style subject/camera mode, result to the right
  const handleOpenMultiAngle = useCallback(() => {
    if (!selectedImageData) return;
    setMultiAngleMode('image');
    setMultiAngleRotation(0);
    setMultiAngleTilt(0);
    setMultiAngleZoom(1);
    setActiveTool('multiAngle');
  }, [selectedImageData]);

  const handleMultiAngleConfirm = useCallback(async () => {
    const img = getActiveImageData();
    if (!img) return;
    const placeholderId = createProcessingFrameRightOf(
      img,
      '多角度生成中',
      img.width,
      img.height,
      '正在创建伪 3D 摄影棚任务...'
    );
    setIsMultiAngleProcessing(true);
    try {
      const modelInfo = getCurrentModel();
      updateProcessingFrame(placeholderId, { progress: 8, status: '正在提交角度参数...' });
      const submitStart = Date.now();
      const res = await fetch('/api/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'multi_angle',
          imageUrl: img.url,
          angleMode: multiAngleMode,
          rotation: multiAngleRotation,
          tilt: multiAngleTilt,
          zoom: multiAngleZoom,
          originalPrompt: img.prompt || img.modifyPrompt || '',
          aspectRatio: (() => { const ar = img.aspectRatio; if (ar && (STANDARD_RATIOS as readonly string[]).includes(ar)) return ar as StandardRatio; return findClosestStandardRatio(img.originalWidth || Math.round(img.width), img.originalHeight || Math.round(img.height)); })(),
          originalWidth: img.originalWidth || Math.round(img.width),
          originalHeight: img.originalHeight || Math.round(img.height),
          model: modelInfo.model,
          providerId: modelInfo.providerId || getCurrentProviderId(),
        }),
      });
      const submitElapsed = Math.round((Date.now() - submitStart) / 1000);
      if (!res.ok) throw new Error(`多角度生成失败: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) {
        removeProcessingFrame(placeholderId);
        alert(translateErrorFrontend(data.error || '多角度生成失败'));
        return;
      }
      // 提交完成后，如果是同步返回结果（directUrl），直接使用
      if (data.imageUrl && !data.taskId) {
        updateProcessingFrame(placeholderId, { progress: 90, status: '正在载入新角度图片...' });
        const stableUrl = await awaitStableImageUrl(data.imageUrl);
        completeProcessingFrame(placeholderId, stableUrl, img.width, img.height, {
          originalWidth: img.originalWidth || Math.round(img.width),
          originalHeight: img.originalHeight || Math.round(img.height),
          modifyPrompt: `AI视角变换 / ${multiAngleMode === 'image' ? '相机环绕(Orbit)' : '相机位移(Dolly)'} / 水平${multiAngleRotation >= 0 ? '右转' : '左转'}${Math.abs(multiAngleRotation)}°(露出${multiAngleRotation >= 0 ? '左' : '右'}侧) / ${multiAngleTilt === 0 ? '平视' : multiAngleTilt > 0 ? `仰视${multiAngleTilt}°` : `俯视${Math.abs(multiAngleTilt)}°`} / ${['特写', '标准', '广角'][multiAngleZoom]}`,
          modelName: modelInfo.apiDisplayName || modelInfo.model,
          apiProvider: modelInfo.providerName || '',
        }, 'variant');
        setActiveTool('none');
        return;
      }
      // 异步任务：开始轮询
      updateProcessingFrame(placeholderId, { progress: 15, status: `任务已提交，等待模型响应${submitElapsed > 2 ? `(提交耗时 ${submitElapsed}s)` : ''}...` });
      const resultUrl = data.imageUrl || await pollForResult(data.taskId, modelInfo.model, (progress, status) => {
        updateProcessingFrame(placeholderId, { progress, status });
      });
      if (!resultUrl) {
        removeProcessingFrame(placeholderId);
        alert(lastPollErrorRef.current || '多角度生成超时，请重试');
        return;
      }
      updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入新角度图片...' });
      // ★ 使用 awaitStableImageUrl 同步等待持久化完成，确保URL可被浏览器加载
      const stableUrl = await awaitStableImageUrl(resultUrl);
      completeProcessingFrame(placeholderId, stableUrl, img.width, img.height, {
        originalWidth: img.originalWidth || Math.round(img.width),
        originalHeight: img.originalHeight || Math.round(img.height),
        modifyPrompt: `AI视角变换 / ${multiAngleMode === 'image' ? '相机环绕(Orbit)' : '相机位移(Dolly)'} / 水平${multiAngleRotation >= 0 ? '右转' : '左转'}${Math.abs(multiAngleRotation)}°(露出${multiAngleRotation >= 0 ? '左' : '右'}侧) / ${multiAngleTilt === 0 ? '平视' : multiAngleTilt > 0 ? `仰视${multiAngleTilt}°` : `俯视${Math.abs(multiAngleTilt)}°`} / ${['特写', '标准', '广角'][multiAngleZoom]}`,
        modelName: modelInfo.apiDisplayName || modelInfo.model,
        apiProvider: modelInfo.providerName || '',
      }, 'variant');
      setActiveTool('none');
    } catch (e) {
      console.error('Multi-angle failed:', e);
      removeProcessingFrame(placeholderId);
      alert('多角度 AI 生成失败，请检查模型或 API Key');
    } finally {
      setIsMultiAngleProcessing(false);
    }
  }, [getActiveImageData, createProcessingFrameRightOf, getCurrentModel, updateProcessingFrame, multiAngleMode, multiAngleRotation, multiAngleTilt, multiAngleZoom, getCurrentProviderId, pollForResult, completeProcessingFrame, removeProcessingFrame]);

  // Edit elements - open semantic layer editor directly
  const handleEditElements = useCallback(async () => {
    const img = getActiveImageData();
    if (!img) return;
    // Directly open the PSD layer editor with AI semantic analysis
    setPsdEditorImageUrl(img.url);
    setPsdEditorMode('studio');
    setShowPsdEditor(true);
  }, [getActiveImageData]);

  const handleOpen3D = useCallback((fromToolbar?: boolean) => {
    const providers = getThreeDProviders();
    if (!threeDProviderId && providers[0]) {
      setThreeDProviderId(providers[0].id);
    }
    // Auto-fill single image URL from selected canvas image
    if (selectedImageData) {
      setThreeDSingleImageUrl(selectedImageData.url);
      if (threeDMode === 'single-image') {
        // Keep single-image mode, selected image auto-fills
      }
    } else if (fromToolbar) {
      // No selected image from toolbar — default to single-image mode with empty image
      setThreeDMode('single-image');
      setThreeDSingleImageUrl('');
    }
    // Auto-add selected image as front view for multi-image mode
    if (selectedImageData && threeDMode === 'multi-image' && !threeDMultiImages.find(img => img.view === 'front')) {
      setThreeDMultiImages(prev => [{ url: selectedImageData.url, view: 'front', label: '正面' }, ...prev]);
    }
    setShow3DModal(true);
    setActiveTool('to3d');
    setThreeDProgress(null);
  }, [selectedImageData, getThreeDProviders, threeDProviderId, threeDMode, threeDMultiImages]);

  const handle3DConfirm = useCallback(async () => {
    const img = getActiveImageData();
    // For single-image, prefer threeDSingleImageUrl (from upload/canvas pick), fallback to selected image
    const singleImageUrl = threeDSingleImageUrl || img?.url || selectedImageData?.url || '';
    if (threeDMode === 'single-image' && !singleImageUrl) {
      alert('请先选择或上传一张图片');
      return;
    }
    if (threeDMode === 'text-to-3d' && !threeDPrompt.trim()) {
      alert('请输入3D模型描述');
      return;
    }
    if (threeDMode === 'multi-image' && threeDMultiImages.length === 0) {
      alert('请至少上传一张图片');
      return;
    }
    const modelInfo = getCurrentModel();
    const providers = getThreeDProviders();
    const provider = providers.find(p => p.id === threeDProviderId);
    if (threeDBackend === 'api' && !provider) {
      alert('请先在图像生成面板的「第三方模型」中添加 3D 模型 API，或切换到本地模型模式');
      return;
    }

    setThreeDProgress('正在创建 3D 转换任务...');
    try {
      const sourceImage = img || selectedImageData;
      const placeholderId = sourceImage
        ? createProcessingFrameRightOf(sourceImage, '图转3D中', sourceImage.width, sourceImage.height, '正在创建图转3D任务...')
        : createProcessingFrameRightOf({ id: 'text-to-3d-source', url: '', x: 100, y: 100, width: 300, height: 200 }, '图转3D中', 300, 200, '正在创建文生3D任务...');
      updateProcessingFrame(placeholderId, { progress: 16, status: '正在提交3D转换参数...' });
      // 关闭3D弹窗，回到画布查看进度
      setShow3DModal(false);
      setActiveTool('none');
      // Determine 3D version from model name
      const modelName3D = (provider?.model || '').toLowerCase();
      const threeDVersion: 'rapid' | 'pro' = modelName3D.includes('lite') || modelName3D.includes('rapid') || modelName3D.includes('极速')
        ? 'rapid'
        : 'pro';
      const res = await fetch('/api/image-to-3d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: singleImageUrl,
          mode: threeDMode,
          images: threeDMode === 'multi-image' ? threeDMultiImages : undefined,
          prompt: threeDMode === 'text-to-3d' ? threeDPrompt : undefined,
          backend: threeDBackend,
          type: threeDType,
          quality: threeDQuality,
          texture: threeDTexture,
          format: threeDFormat,
          version: threeDVersion,
          enablePBR: threeDEnablePBR,
          faceCount: threeDFaceCount,
          pose: threeDPose,
          provider,
          local: {
            endpoint: threeDLocalEndpoint,
            model: threeDLocalModel,
          },
        }),
      });
      if (!res.ok) throw new Error(`3D任务创建失败: HTTP ${res.status}`);
      const data = await res.json();
      console.log('[3D] API response:', JSON.stringify(data).slice(0, 500));
      if (!data.success) {
        alert(translateErrorFrontend(data.error || '图生 3D 任务创建失败'));
        setThreeDProgress(null);
        return;
      }

      let previewUrl: string | null = null;
      let threeDModelUrls: Record<string, string> | undefined;

      if (data.taskId) {
        // Async task - need to poll for result
        updateProcessingFrame(placeholderId, { progress: 25, status: '3D 任务已提交，等待 AI 生成...' });
        const maxAttempts = 1440; // 最多轮询1440次（7200秒/120分钟，兼容3D等超慢速API）
        for (let i = 0; i < maxAttempts; i++) {
          // 动态更新进度和状态
          const elapsed = (i + 1) * 5;
          const progressVal = Math.min(90, 25 + Math.round((i / maxAttempts) * 65));
          updateProcessingFrame(placeholderId, {
            progress: progressVal,
            status: `AI 正在生成 3D 模型... 已等待 ${elapsed}s`
          });
          await new Promise(r => setTimeout(r, 5000));
          try {
            const pollRes = await fetch('/api/poll-3d-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: data.taskId,
                version: threeDVersion,
                provider: {
                  apiKey: provider?.apiKey,
                  baseUrl: provider?.baseUrl,
                  providerPreset: provider?.providerPreset,
                  name: provider?.name,
                  model: provider?.model,
                },
              }),
            });
            const pollData = await pollRes.json();
            console.log(`[3D] Poll ${i + 1}:`, JSON.stringify(pollData).slice(0, 300));

            if (pollData.status === 'running' || pollData.status === 'pending') {
              // 仍在运行，继续轮询
              continue;
            }

            if ((pollData.status === 'completed' || pollData.status === 'succeeded') && (pollData.assetUrl || pollData.modelUrls)) {
              previewUrl = pollData.previewImageUrl || pollData.assetUrl || (pollData.modelUrls && Object.values(pollData.modelUrls)[0]) || '';
              threeDModelUrls = pollData.modelUrls;
              break;
            }
            if (pollData.status === 'failed') {
              alert(translateErrorFrontend(pollData.error || '3D 生成失败'));
              removeProcessingFrame(placeholderId);
              setThreeDProgress(null);
              return;
            }
          } catch (pollErr) {
            console.error('[3D] Poll error:', pollErr);
          }
        }
        if (!previewUrl) {
          alert('3D 生成超时，请稍后重试');
          removeProcessingFrame(placeholderId);
          setThreeDProgress(null);
          return;
        }
      } else if (data.assetUrl) {
        // Synchronous result - got asset URL directly
        previewUrl = data.previewImageUrl || data.assetUrl;
      } else {
        // No taskId and no assetUrl - fallback
        previewUrl = data.previewImageUrl || (img ? await renderEditElementsPreview(img) : '');
      }

      updateProcessingFrame(placeholderId, { progress: 94, status: '正在载入 3D 预览...' });
      // Pick first available model URL from modelUrls (format-agnostic), then fallback
      const firstModelEntry = threeDModelUrls ? Object.values(threeDModelUrls).find((v: string) => v && typeof v === 'string') as string | undefined : undefined;
      const threeDAssetUrl = firstModelEntry || data.assetUrl || '';
      completeProcessingFrame(placeholderId, previewUrl || '', img?.width || 1024, img?.height || 1024, {
        originalWidth: img?.originalWidth || Math.round(img?.width || 1024),
        originalHeight: img?.originalHeight || Math.round(img?.height || 1024),
        modifyPrompt: `图生3D/${threeDType}/${threeDBackend}/${threeDQuality}/${threeDFormat}${threeDAssetUrl ? ` → ${threeDAssetUrl}` : ''}`,
        threeDModelUrl: threeDAssetUrl || data.assetUrl || '',
        threeDModelUrls: threeDModelUrls || data.modelUrls,
        threeDThumbnailUrls: data.thumbnailUrls || {},
        threeDTextureUrls: data.textureUrls || [],
        threeDModelInfo: { ...(data.modelInfo || {}), providerId: modelInfo.providerId || '', providerName: provider?.name || provider?.providerName || '', model3DName: provider?.model || threeDType, modelTaskId: data.taskId || '' },
        modelName: provider?.model || threeDType,
        apiProvider: provider?.name || provider?.providerName || '',
      }, 'variant');
      setThreeDProgress(null);
    } catch (e) {
      console.error('Image to 3D failed:', e);
      alert('图生 3D 调用失败，请检查 API 或本地模型服务');
      setThreeDProgress(null);
    }
  }, [getActiveImageData, threeDSingleImageUrl, selectedImageData, threeDMode, threeDPrompt, threeDMultiImages, getCurrentModel, getThreeDProviders, threeDBackend, threeDProviderId, createProcessingFrameRightOf, updateProcessingFrame, threeDType, threeDQuality, threeDTexture, threeDFormat, threeDEnablePBR, threeDFaceCount, threeDPose, threeDLocalEndpoint, threeDLocalModel, completeProcessingFrame, removeProcessingFrame, renderEditElementsPreview]);

  // 4. ERASE - floating window mode
  const handleOpenErase = useCallback(() => {
    const img = getActiveImageData();
    if (!img) return;
    setEditImageId(img.id);
    setEditMode('erase');
    setEditStrokes([]);
    setCurrentStroke([]);
    setEditBrushMode('brush');
    setEditCanvasZoom(1);
    setEditCanvasPan({ x: 0, y: 0 });
    setMaskKeyword('');
  }, [getActiveImageData]);

  // 参数调色处理
  const colorAdjustingRef = useRef(false);
  const handleOpenColorAdjust = useCallback(() => {
    const img = getActiveImageData();
    if (!img) return;
    setEditImageId(img.id);
    setEditMode('colorAdjust');
    setColorBrightness(0);
    setColorContrast(0);
    setColorSaturation(0);
    setColorTemperature(0);
    setColorHue(0);
  }, [getActiveImageData]);

  const applyColorAdjust = useCallback(async () => {
    if (colorAdjustingRef.current) return;
    const img = getActiveImageData();
    if (!img) return;
    colorAdjustingRef.current = true;
    setColorAdjustProcessing(true);
    try {
      const res = await fetch('/api/image/color-adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: img.url,
          params: {
            brightness: colorBrightness,
            contrast: colorContrast,
            saturation: colorSaturation,
            temperature: colorTemperature,
            hue: colorHue,
          }
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '调色失败');
      if (data.url) {
        // API直接返回可访问URL，直接替换图片
        onImagesChange(images.map(i => i.id === img.id ? { ...i, url: data.url } : i));
        toast.success('调色完成');
        setEditMode('none');
      } else {
        throw new Error('返回结果为空');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '调色失败');
    } finally {
      colorAdjustingRef.current = false;
      setColorAdjustProcessing(false);
    }
  }, [getActiveImageData, colorBrightness, colorContrast, colorSaturation, colorTemperature, colorHue, onImagesChange, images]);

  const handleConfirmColorAdjust = applyColorAdjust;

  // 视频批量抽帧
  const handleVideoExtractFrames = useCallback(async (img: CanvasImage, mode: string = 'uniform', count: number = 8) => {
    if (!img.videoUrl) { toast.error('这不是视频文件'); return; }
    const tid = toast.loading('正在从视频中提取帧...');
    try {
      const res = await fetch('/api/video/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract-frames', videoUrl: img.videoUrl, mode, frameCount: count, fps: 1 }),
      });
      if (!res.ok) throw new Error('抽帧失败');
      const data = await res.json();
      if (data.frames && data.frames.length > 0) {
        const frameUrls = data.frames.map((f: {url: string}) => f.url);
        onAddImages(frameUrls);
        toast.success(`成功提取 ${frameUrls.length} 帧`, { id: tid });
      } else {
        toast.error('未能提取到帧', { id: tid });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '抽帧失败', { id: tid });
    }
  }, [onAddImages]);

  // 720全景图生成（直接调用图像生成API）
  const handleGeneratePanorama = useCallback(async (img?: CanvasImage) => {
    const sourceImg = img || getActiveImageData();
    if (!sourceImg) { toast.error('请先选择一张参考图'); return; }
    setIsGeneratingPanorama(true);
    const tid = toast.loading('正在生成720°全景图...');
    try {
      // 调用现有的图生图接口，用全景提示词
      const prompt = panoramaPrompt + (sourceImg.prompt ? `, based on reference image style: ${sourceImg.prompt}` : '');
      const modelInfo = getCurrentModel();
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          aspectRatio: '2:1',  // 全景图2:1等距圆柱投影比例
          imageUrl: sourceImg.url, // 作为参考图
          model: modelInfo.model,
          apiKey: 'server-managed',
          submitOnly: true,
        }),
      });
      if (!res.ok) throw new Error('全景生成失败');
      const data = await res.json();
      if (data.taskId) {
        // 创建占位框然后轮询结果
        createProcessingFrameRightOf(sourceImg, '全景生成中', sourceImg.width * 2, sourceImg.width, '正在生成720度全景图...');
        pollForResult(data.taskId, modelInfo.model, undefined, 'panorama');
        toast.dismiss(tid);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '全景生成失败', { id: tid });
    } finally {
      setIsGeneratingPanorama(false);
    }
  }, [getActiveImageData, panoramaPrompt, getCurrentModel, createProcessingFrameRightOf, pollForResult]);

  // 全景查看器
  const [panoramaViewerUrl, setPanoramaViewerUrl] = useState<string | null>(null);
  useCallback((img: CanvasImage) => {
        setPanoramaViewerUrl(img.url);
      }, []);

  // 5. MASK - floating window mode
  const handleOpenMask = useCallback(() => {
    const img = getActiveImageData();
    if (!img) return;
    setEditImageId(img.id);
    setEditMode('mask');
    setEditStrokes([]);
    setCurrentStroke([]);
    setEditBrushMode('brush');
    setEditCanvasZoom(1);
    setEditCanvasPan({ x: 0, y: 0 });
    setMaskKeyword('');
  }, [getActiveImageData]);

  // 6. EXPAND - 即梦风格方向性扩展
  const handleOpenExpand = useCallback(() => {
    const img = getActiveImageData();
    if (!img) return;
    setEditMode('expand');
    setEditImageId(img.id);
    setExpandRatio('1:1');
    // 重置方向性扩展 padding
    setExpandPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    expandPaddingRef.current = { top: 0, right: 0, bottom: 0, left: 0 };
  }, [getActiveImageData]);

  // 即梦风格扩展：拖拽控制点事件处理
  useCallback((handle: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDraggingHandle(handle);
        const startX = e.clientX;
        const startY = e.clientY;
        const startPadding = { ...expandPaddingRef.current };

        const handleMouseMove = (ev: MouseEvent) => {
          if (isEventFromOverlay(ev)) return;
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          // 屏幕像素 → 原始像素
          const origImg = images.find(i => i.id === editImageId);
          if (!origImg) return;
          const origW = origImg.originalWidth || Math.round(origImg.width);
          const origH = origImg.originalHeight || Math.round(origImg.height);
          const displayW = origImg.width;
          const displayH = origImg.height;
          const scaleX = origW / (displayW * zoom);
          const scaleY = origH / (displayH * zoom);

          const newPadding = { ...startPadding };
          const step = 8; // 对齐到8的倍数

          // 根据拖拽方向更新 padding
          if (handle === 'top' || handle === 'top-left' || handle === 'top-right') {
            const delta = Math.round((-dy * scaleY) / step) * step;
            newPadding.top = Math.max(0, startPadding.top + delta);
          }
          if (handle === 'bottom' || handle === 'bottom-left' || handle === 'bottom-right') {
            const delta = Math.round((dy * scaleY) / step) * step;
            newPadding.bottom = Math.max(0, startPadding.bottom + delta);
          }
          if (handle === 'left' || handle === 'top-left' || handle === 'bottom-left') {
            const delta = Math.round((-dx * scaleX) / step) * step;
            newPadding.left = Math.max(0, startPadding.left + delta);
          }
          if (handle === 'right' || handle === 'top-right' || handle === 'bottom-right') {
            const delta = Math.round((dx * scaleX) / step) * step;
            newPadding.right = Math.max(0, startPadding.right + delta);
          }

          expandPaddingRef.current = newPadding;
          setExpandPadding(newPadding);
        };

        const handleMouseUp = () => {
          setDraggingHandle(null);
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      }, [isEventFromOverlay, images, zoom, editImageId]);

  // 快捷扩展：等比扩展四边
  const handleExpandEqualPadding = useCallback((pixels: number) => {
    const newPadding = { top: pixels, right: pixels, bottom: pixels, left: pixels };
    expandPaddingRef.current = newPadding;
    setExpandPadding(newPadding);
  }, []);

  // 快捷扩展：单方向扩展
  useCallback((direction: 'top' | 'right' | 'bottom' | 'left', pixels: number) => {
        const newPadding = { ...expandPaddingRef.current };
        newPadding[direction] = pixels;
        expandPaddingRef.current = newPadding;
        setExpandPadding(newPadding);
      }, []);

  // 快捷扩展：扩展到指定比例（居中放置原图）
  const handleExpandToRatio = useCallback((ratioW: number, ratioH: number) => {
    const img = images.find(i => i.id === editImageId);
    if (!img) return;
    const ow = img.originalWidth || Math.round(img.width);
    const oh = img.originalHeight || Math.round(img.height);
    // 计算目标尺寸：保持短边不变，按比例扩展长边
    const targetW = Math.round(oh * ratioW / ratioH);
    const targetH = Math.round(ow * ratioH / ratioW);
    // 选择能完全包含原图的最小尺寸
    const finalW = Math.max(targetW, ow);
    const finalH = Math.max(targetH, oh);
    // 8px对齐
    const padL = Math.round((finalW - ow) / 2 / 8) * 8;
    const padR = finalW - ow - padL;
    const padT = Math.round((finalH - oh) / 2 / 8) * 8;
    const padB = finalH - oh - padT;
    const newPadding = { top: padT, right: padR, bottom: padB, left: padL };
    expandPaddingRef.current = newPadding;
    setExpandPadding(newPadding);
  }, [images, editImageId]);

  // 7. CROP - floating toolbar with custom ratios, drag crop points
  const handleOpenCrop = useCallback(() => {
    const img = getActiveImageData();
    if (!img) return;
    setEditMode('crop');
    setEditImageId(img.id);
    setCropRatio('free');
    setCropDragMode('create');
    setCropDragStart(null);
    setCropDragOrigin(null);
    setCropRect(null);
    setCropLeft(0);
    setCropTop(0);
    setCropWidth(img.originalWidth || Math.round(img.width));
    setCropHeight(img.originalHeight || Math.round(img.height));
  }, [getActiveImageData]);

  // 8. DOWNLOAD - popup with PNG/SVG/PSD
  const handleOpenDownload = useCallback(() => {
    setShowDownloadPopup(true);
    setActiveTool('download');
  }, []);

  // Edit mode handlers
  const exitEditMode = useCallback(() => {
    setEditMode('none');
    setEditImageId(null);
    setEditPrompt('');
    setEditStrokes([]);
    setCurrentStroke([]);
    setIsEditProcessing(false);
    setCropRect(null);
    setEditBrushMode('brush');
    setEditCanvasZoom(1);
    setEditCanvasPan({ x: 0, y: 0 });
    setShowUpscalePresetMenu(false);
    isDrawingRef.current = false;
    isAltErasingRef.current = false;
    brushCursorPosRef.current = null;
    setStrokesVersion(v => v + 1);
    currentStrokeRef.current = [];
  }, []);
  useEffect(() => { exitEditModeRef.current = exitEditMode; }, [exitEditMode]);


  // Edit confirm for erase/mask/expand/crop
  const handleEditConfirm = useCallback(async () => {
    const editImg = images.find(i => i.id === editImageId);
    if (!editImg) { exitEditMode(); return; }
    const modelInfo = getCurrentModel();

    if (editMode === 'crop') {
      if (!cropRect) {
        exitEditMode();
        return;
      }
      try {
        const placeholderId = createProcessingFrameRightOf(
          editImg,
          '裁切中',
          Math.max(1, cropRect.w / zoom),
          Math.max(1, cropRect.h / zoom),
          '正在按选区裁切图片...'
        );
        setIsEditProcessing(false);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = editImg.url; });

        const canvas = document.createElement('canvas');
        const displayX = Math.max(0, (cropRect.x - editImg.x * zoom - viewOffset.x) / zoom);
        const displayY = Math.max(0, (cropRect.y - editImg.y * zoom - viewOffset.y) / zoom);
        const displayW = Math.min(editImg.width - displayX, cropRect.w / zoom);
        const displayH = Math.min(editImg.height - displayY, cropRect.h / zoom);
        const sourceScaleX = img.naturalWidth / editImg.width;
        const sourceScaleY = img.naturalHeight / editImg.height;
        const sx = Math.max(0, displayX * sourceScaleX);
        const sy = Math.max(0, displayY * sourceScaleY);
        const sw = Math.min(img.naturalWidth - sx, displayW * sourceScaleX);
        const sh = Math.min(img.naturalHeight - sy, displayH * sourceScaleY);

        canvas.width = Math.max(1, Math.round(sw));
        canvas.height = Math.max(1, Math.round(sh));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          const newUrl = canvas.toDataURL('image/png');
          updateProcessingFrame(placeholderId, { progress: 92, status: '正在生成裁切结果...' });
          completeProcessingFrame(placeholderId, newUrl, displayW, displayH, { originalWidth: canvas.width, originalHeight: canvas.height, modelName: modelInfo.apiDisplayName || modelInfo.model, apiProvider: modelInfo.providerName || '' }, 'edit');
        }
      } catch (e) {
        console.error('Crop failed:', e);
      }
      exitEditMode();
      return;
    }

    if (editMode === 'erase' || editMode === 'mask') {

      const maskBase64 = renderMaskFromStrokes(
        editImg.originalWidth || Math.round(editImg.width),
        editImg.originalHeight || Math.round(editImg.height)
      );
      if (!maskBase64) {
        alert('请在图片上绘制需要修改的区域');
        return;
      }
      // Debug: log mask info
      console.log(`[handleEditConfirm] mode=${editMode}, editStrokes.length=${editStrokes.length}, maskBase64 length=${maskBase64.length}`);

      // 保存当前编辑图片引用和蒙版，然后立即退出编辑模式返回画布
      const currentEditImg = { ...editImg };
      const currentEditMode = editMode;
      const currentMaskKeyword = maskKeyword;
      const currentEditPrompt = editPrompt;

      const placeholderId = createProcessingFrameRightOf(
        currentEditImg,
        currentEditMode === 'mask' ? '蒙版生成中' : '擦除中',
        currentEditImg.width,
        currentEditImg.height,
        currentEditMode === 'mask' ? '正在创建蒙版重绘任务...' : '正在创建擦除修复任务...'
      );

      // 立即退出编辑模式，返回无限画布，后台继续执行
      exitEditMode();

      try {
        // 使用管理员系统的图像模型进行 AI 修复
        const prompt = currentEditMode === 'mask'
          ? (currentMaskKeyword || currentEditPrompt || '')
          : 'Remove the masked area and seamlessly fill with surrounding context'; // 擦除模式：自动填充默认prompt

        let resultUrl: string | null = null;

        updateProcessingFrame(placeholderId, { progress: 8, status: '正在提交编辑请求...' });

        const modelInfo = getCurrentModel();
        const requestBody = {
          action: 'inpaint',
          imageUrl: currentEditImg.url,
          maskImage: maskBase64,
          prompt,
          editMode: currentEditMode as 'erase' | 'mask',
          aspectRatio: currentEditImg.aspectRatio && (STANDARD_RATIOS as readonly string[]).includes(currentEditImg.aspectRatio) ? currentEditImg.aspectRatio as StandardRatio : findClosestStandardRatio(currentEditImg.originalWidth || currentEditImg.width || 1, currentEditImg.originalHeight || currentEditImg.height || 1),
          model: modelInfo.model,
          providerId: modelInfo.providerId || getCurrentProviderId(),
          ...(currentEditMode === 'erase' ? { eraseModel: eraseModelId } : {}),
        };

        const bodyStr = JSON.stringify(requestBody);
        // 日志：记录请求体大小以便排查 "Failed to fetch" 问题
        console.log('[inpaint] bodySize:', Math.round(bodyStr.length / 1024) + 'KB', 'urlType:', currentEditImg.url?.substring(0, 20));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000); // 10分钟超时，匹配后端maxDuration

        let res: Response;
        try {
          res = await fetch('/api/image-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyStr,
            signal: controller.signal,
          });
        } catch (fetchErr: unknown) {
          clearTimeout(timeoutId);
          const err = fetchErr as Error;
          console.error('[inpaint] fetch failed:', err.name, err.message, 'bodySize:', Math.round(bodyStr.length / 1024) + 'KB');
          if (err.name === 'AbortError') {
            throw new Error('请求超时，服务器响应时间过长，请重试');
          }
          throw new Error(`网络请求失败 (${err.message})，请检查网络连接后重试`);
        }
        clearTimeout(timeoutId);

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.error('[inpaint] HTTP error:', res.status, text.substring(0, 200));
          throw new Error(`服务器错误 (${res.status})，请稍后重试`);
        }

        let data: ImageEditResponse;
        try {
          data = parseImageEditResponse(await res.json());
        } catch {
          console.error('[inpaint] JSON parse failed, response starts with:', (await res.text().catch(() => '')).substring(0, 100));
          throw new Error('服务器返回了非预期格式，请稍后重试');
        }
        if (!data.success) {
          console.error('Image edit failed:', data.error);
          // 后端已根据 editMode 返回不同错误消息
          const errorMessage = translateErrorFrontend(String(data.error ?? '编辑失败'));
          updateProcessingFrame(placeholderId, {
            progress: -1,
            status: `❌ ${errorMessage}`,
            error: errorMessage,
          });
          setTimeout(() => removeProcessingFrame(placeholderId), 5000);
          return;
        }

        const syncResultUrl: string | undefined = data.imageUrl; // 异步擦除超时后返回的合成信息

        if (syncResultUrl) {
          const engineLabel = data.engine?.includes('iopaint') ? 'IOPaint 正在处理' : data.engine === 'local-erase' ? '本地修复完成' : '正在载入编辑结果';
          updateProcessingFrame(placeholderId, { progress: 80, status: engineLabel + '...' });
          resultUrl = syncResultUrl;
        } else if (data.taskId) {
          updateProcessingFrame(placeholderId, { progress: 24, status: 'AI 正在重绘选区...' });
          resultUrl = await pollForResult(data.taskId, modelInfo.model, (progress, status) => {
            updateProcessingFrame(placeholderId, { progress, status });
          });
        } else {
          removeProcessingFrame(placeholderId);
          return;
        }

        // 异步蒙版/擦除结果：poll-task 已在后端完成蒙版合成，前端直接使用即可

        if (resultUrl) {
          updateProcessingFrame(placeholderId, { progress: 96, status: '正在合成编辑结果...' });
          try {
            const stableUrl = await awaitStableImageUrl(resultUrl);
            completeProcessingFrame(placeholderId, stableUrl, currentEditImg.width, currentEditImg.height, { originalWidth: currentEditImg.originalWidth || Math.round(currentEditImg.width), originalHeight: currentEditImg.originalHeight || Math.round(currentEditImg.height), modelName: modelInfo.apiDisplayName || modelInfo.model, apiProvider: modelInfo.providerName || '' }, 'edit');
          } catch (stableErr) {
            console.error('Stable URL conversion failed:', stableErr);
            completeProcessingFrame(placeholderId, resultUrl, currentEditImg.width, currentEditImg.height, { originalWidth: currentEditImg.originalWidth || Math.round(currentEditImg.width), originalHeight: currentEditImg.originalHeight || Math.round(currentEditImg.height), modelName: modelInfo.apiDisplayName || modelInfo.model, apiProvider: modelInfo.providerName || '' }, 'edit');
          }
        } else {
          const pollError = lastPollErrorRef.current || '未获取到结果';
          updateProcessingFrame(placeholderId, {
            progress: -1,
            status: `❌ ${pollError}`,
            error: pollError,
          });
          setTimeout(() => removeProcessingFrame(placeholderId), 5000);
        }
      } catch (e) {
        console.error('Edit confirm error:', e);
        updateProcessingFrame(placeholderId, {
          progress: -1,
          status: `❌ 操作失败: ${e instanceof Error ? e.message : '请重试'}`,
          error: e instanceof Error ? e.message : '请重试',
        });
        setTimeout(() => removeProcessingFrame(placeholderId), 5000);
      }

      return;
    }



    if (editMode === 'expand') {
      // 方向性扩展：使用 expandPadding (top/right/bottom/left)
      const pad = expandPadding;
      const hasPadding = pad.top > 0 || pad.right > 0 || pad.bottom > 0 || pad.left > 0;
      if (!hasPadding) {
        alert('请拖动控制点设置扩展区域');
        return;
      }

      const origW = editImg.originalWidth || Math.round(editImg.width);
      const origH = editImg.originalHeight || Math.round(editImg.height);
      const targetW = origW + pad.left + pad.right;
      const targetH = origH + pad.top + pad.bottom;

      // 保存当前编辑图片引用（exitEditMode后state会清空）
      const currentEditImg = { ...editImg };

      // Processing frame size matches the target expanded size (in display coords)
      const scale = currentEditImg.width / origW;
      const displayTargetW = targetW * scale;
      const displayTargetH = targetH * scale;
      const placeholderId = createProcessingFrameRightOf(
        currentEditImg,
        '扩展中',
        displayTargetW,
        displayTargetH,
        '正在创建扩图任务...'
      );
      // 立即退出编辑模式，让进度在右侧处理框中显示
      exitEditMode();
      try {
        const modelInfo = getCurrentModel();
        updateProcessingFrame(placeholderId, { progress: 16, status: '正在提交扩展请求...' });
        const res = await fetch('/api/image-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'outpaint',
            imageUrl: currentEditImg.url,
            expandPadding: { top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left },
            aspectRatio: `${targetW}:${targetH}`,
            prompt: editPrompt || 'Naturally extend the image beyond its original borders. Fill the new areas with content that seamlessly continues the existing scene, maintaining consistent style, lighting, perspective and color palette.',
            model: modelInfo.model,
            providerId: modelInfo.providerId || getCurrentProviderId(),
          }),
        });

        let data: ImageEditResponse;
        try {
          const resText = await res.text();
          try { data = parseImageEditResponse(JSON.parse(resText)); } catch { data = { success: false, error: resText.substring(0, 200) }; }
        } catch {
          data = { success: false, error: `HTTP ${res.status}` };
        }
        if (!data.success) {
          alert(translateErrorFrontend(String(data.error ?? '扩展失败')));
          removeProcessingFrame(placeholderId);
          return;
        }

        // 处理两种响应模式：同步(有imageUrl) / 异步(有taskId)
        const finalW = data.targetWidth || targetW;
        const finalH = data.targetHeight || targetH;
        let resultUrl: string | null = null;

        if (data.imageUrl) {
          // 同步结果 - 后端已合成原图到中心
          updateProcessingFrame(placeholderId, { progress: 80, status: '正在载入扩展结果...' });
          resultUrl = data.imageUrl;
        } else if (data.taskId) {
          // 异步结果 - 需要轮询
          updateProcessingFrame(placeholderId, { progress: 24, status: 'AI 正在补全画面...' });
          resultUrl = await pollForResult(data.taskId, modelInfo.model, (progress, status) => {
            updateProcessingFrame(placeholderId, { progress, status });
          });
        } else {
          alert('扩展请求失败，请重试');
          removeProcessingFrame(placeholderId);
          return;
        }

        if (resultUrl) {
          updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入扩展结果...' });
          try {
            const stableUrl = await awaitStableImageUrl(resultUrl);
            completeProcessingFrame(placeholderId, stableUrl, currentEditImg.width * (finalW / origW), currentEditImg.height * (finalH / origH), { originalWidth: finalW, originalHeight: finalH, modelName: modelInfo.apiDisplayName || modelInfo.model, apiProvider: modelInfo.providerName || '' }, 'edit');
          } catch {
            completeProcessingFrame(placeholderId, resultUrl, currentEditImg.width * (finalW / origW), currentEditImg.height * (finalH / origH), { originalWidth: finalW, originalHeight: finalH, modelName: modelInfo.apiDisplayName || modelInfo.model, apiProvider: modelInfo.providerName || '' }, 'edit');
          }
        } else {
          const pollError = lastPollErrorRef.current || '扩展超时，请重试';
          alert(pollError);
          removeProcessingFrame(placeholderId);
        }
      } catch (e) {
        console.error('Expand error:', e);
        const errMsg = e instanceof Error ? e.message : String(e);
        alert(`操作失败: ${errMsg}`);
        removeProcessingFrame(placeholderId);
      }

      return;
    }

    exitEditMode();
  }, [images, getCurrentModel, editMode, exitEditMode, editImageId, cropRect, createProcessingFrameRightOf, zoom, viewOffset.x, viewOffset.y, updateProcessingFrame, completeProcessingFrame, renderMaskFromStrokes, editStrokes.length, maskKeyword, editPrompt, getCurrentProviderId, eraseModelId, removeProcessingFrame, pollForResult, expandPadding]);

  // Mask keyword confirm
  // Download handlers
  /** Ensure an SVG string has viewBox and xmlns:xlink for Adobe Illustrator compatibility */
  function ensureSvgAiCompatible(svgStr: string): string {
    try {
      // Add xmlns:xlink if missing
      if (!svgStr.includes('xmlns:xlink')) {
        svgStr = svgStr.replace('<svg ', '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
      }
      // Add viewBox if missing — derive from width/height
      if (!svgStr.includes('viewBox')) {
        const wMatch = svgStr.match(/width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"/);
        const hMatch = svgStr.match(/height="(\d+(?:\.\d+)?)"[^>]*width="(\d+(?:\.\d+)?)"/);
        let w = 0, h = 0;
        if (wMatch) { w = parseFloat(wMatch[1]); h = parseFloat(wMatch[2]); }
        else if (hMatch) { h = parseFloat(hMatch[1]); w = parseFloat(hMatch[2]); }
        if (w > 0 && h > 0) {
          svgStr = svgStr.replace('<svg ', `<svg viewBox="0 0 ${w} ${h}" `);
        }
      }
      // Ensure xml declaration
      if (!svgStr.startsWith('<?xml')) {
        svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgStr;
      }
    } catch { /* best effort */ }
    return svgStr;
  }

  // Auto-numbered filename helper: wujie_YYYYMMDD_NNN_name.ext
  const generateSafeFilename = (baseName: string, ext: string, counter?: number) => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    // Use session counter to avoid name collisions
    const safeName = (baseName || 'image').replace(/[\\/:*?"<>|]/g, '_').substring(0, 40);
    const seq = counter !== undefined ? String(counter).padStart(3, '0') : String(Math.floor(Math.random() * 900) + 100);
    return `wujie_${dateStr}_${seq}_${safeName}.${ext}`;
  };

  const handleDownloadImage = async (image: CanvasImage, format: string = 'png') => {
    try {
      if (format === '3d') {
        setDownloadProgress('正在下载3D模型...');
        const modelUrls = image.threeDModelUrls || {};
        const targetFormat = threeDDownloadFormat || Object.keys(modelUrls)[0] || 'glb';
        const modelUrl = modelUrls[targetFormat] || image.threeDModelUrl;
        if (!modelUrl) {
          setDownloadProgress(null);
          return;
        }
        // Use proxy to avoid CORS
        const proxyUrl = `/api/proxy-3d-model?url=${encodeURIComponent(modelUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`下载失败: ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = generateSafeFilename(image.prompt || '3d-model', targetFormat);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setDownloadProgress(null);
        setShowDownloadPopup(false);
        setActiveTool('none');
        return;
      }
      if (format === 'svg') {
        // SVG下载策略:
        // 1. 优先使用svgUrl（服务器SVG文件URL，来自SVG描摹，轻量级）
        // 2. 其次使用svgDataUrl（SVG data URL，历史数据兼容）
        // 3. 如果url本身是SVG服务器文件，直接获取
        const svgSource = image.svgDataUrl || image.url;
        const isSvgServerUrl = !!(image.svgUrl) || (!image.svgDataUrl && image.url && (image.url.includes('/svg-trace/') || image.url.endsWith('.svg')));
        const svgServerUrl = image.svgUrl || (isSvgServerUrl ? image.url : null);
        // If image URL is already an SVG data URL (from SVG描摹), download directly
        if (svgSource.startsWith('data:image/svg+xml') || isSvgServerUrl) {
          setDownloadProgress('正在导出矢量图...');
          try {
            let svgContent: string;
            if (svgSource.startsWith('data:image/svg+xml')) {
              svgContent = decodeURIComponent(svgSource.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
            } else if (svgServerUrl) {
              // 从服务器URL获取SVG内容
              const svgRes = await fetch(svgServerUrl);
              if (!svgRes.ok) throw new Error('获取SVG文件失败');
              svgContent = await svgRes.text();
            } else {
              throw new Error('无法获取SVG内容');
            }
            // Apply AI-compatible sanitization: add viewBox, ensure proper namespaces
            svgContent = ensureSvgAiCompatible(svgContent);
            const blob = new Blob([svgContent], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = generateSafeFilename(image.prompt || 'vector', 'svg');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch {
            // Fallback to re-vectorize if data URL parsing fails
            const { downloadSVG } = await import('@/lib/svg-export');
            await downloadSVG(svgSource, svgMode);
          }
          setDownloadProgress(null);
          setShowDownloadPopup(false);
          setActiveTool('none');
          return;
        }
        // Non-data-URL SVG source - vectorize via vtracer
        setDownloadProgress('正在矢量化...');
        const { downloadSVG } = await import('@/lib/svg-export');
        await downloadSVG(image.url, svgMode, (stage, progress) => {
          const stageLabels: Record<string, string> = {
            preparing_image: '准备图片...',
            tracing_vectors: '追踪矢量路径...',
            recognizing_shapes: '识别形状...',
            optimizing_paths: '优化路径...',
            rendering_preview: '渲染预览...',
            completed: '完成',
          };
          setDownloadProgress(`${stageLabels[stage] || stage} ${Math.round(progress)}%`);
        });
        setDownloadProgress(null);
        setShowDownloadPopup(false);
        setActiveTool('none');
        return;
      }
      // PNG format - try direct fetch, fallback to server proxy for CORS
      let downloadSuccess = false;
      let downloadError = '';

      // Step 1: 如果URL是远程URL，先通过服务器持久化确保可下载
      let downloadUrl = image.url;
      const isRemoteUrl = downloadUrl.startsWith('http') && !downloadUrl.includes(window.location.host);
      if (isRemoteUrl) {
        try {
          setDownloadProgress('正在准备下载...');
          const persistRes = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: image.url }),
          });
          const persistData = await persistRes.json();
          if (persistData.success && (persistData.url || persistData.savedUrl || persistData.localUrl)) {
            downloadUrl = persistData.url || persistData.savedUrl || persistData.localUrl;
            console.log('[download] Remote URL persisted to:', downloadUrl);
          }
        } catch (e) {
          console.warn('[download] Failed to persist remote URL, trying direct download:', e);
        }
      }

      // Step 2: 下载图片
      try {
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = generateSafeFilename(image.prompt || 'image', 'png');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        downloadSuccess = true;
      } catch {
        // Direct fetch failed, try server-side proxy
        try {
          const proxyRes = await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: image.url }),
          });
          const proxyData = await proxyRes.json();
          const proxyUrl = proxyData.url || proxyData.savedUrl || proxyData.localUrl;
          if (proxyUrl) {
            const response = await fetch(proxyUrl);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = generateSafeFilename(image.prompt || 'image', 'png');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            downloadSuccess = true;
          } else {
            downloadError = proxyData.error || '服务器无法获取图片';
          }
        } catch (proxyError) {
          downloadError = '下载失败：无法从服务器获取图片';
          console.error('Download proxy also failed:', proxyError);
        }
      }

      if (!downloadSuccess && downloadError) {
        toast.error(downloadError);
      }
    } catch (error) {
      console.error('Download failed:', error);
      setDownloadProgress(null);
    }
    setShowDownloadPopup(false);
    setActiveTool('none');
  };

  const handleCopyImage = async (image: CanvasImage) => {
    try {
      const response = await fetch(image.url);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  // Action toolbar items with distinct monochrome colors
  const monoColors: Record<string, string> = {
    '放大': 'text-blue-600', '移除背景': 'text-pink-500', 'SVG智能描摹': 'text-blue-500',
    '擦除': 'text-orange-500', '蒙版': 'text-violet-500', '编辑元素': 'text-cyan-500',
    '多角度': 'text-teal-500', '图转3D工厂': 'text-indigo-500', '扩展': 'text-amber-500',
    '裁切': 'text-rose-500', '精修引擎': 'text-violet-500', '语言修图': 'text-sky-500', 'Agent编排': 'text-fuchsia-500',
    '下载': 'text-gray-600',
  };
  const imageActions = [
    { icon: <ZoomIn size={14} className={isMonochrome ? monoColors['放大'] : ''} />, label: '放大', desc: '智能补细节放大，变大变高清，不改内容', action: handleOpenUpscale },
    { icon: <Eraser size={14} className={isMonochrome ? monoColors['移除背景'] : ''} />, label: '移除背景', desc: '一键删除背景，只剩透明底主体', action: () => setShowRemoveBgPicker(true) },
    { icon: <PenTool size={14} className={isMonochrome ? monoColors['SVG智能描摹'] : ''} />, label: 'SVG智能描摹', desc: '矢量描摹/压缩/缩略图', action: handleOpenSvgTrace },
    { icon: <Paintbrush size={14} className={isMonochrome ? monoColors['擦除'] : ''} />, label: '擦除', desc: '涂抹消除，自动无缝补全画面', action: handleOpenErase },
    { icon: <Wand2 size={14} className={isMonochrome ? monoColors['蒙版'] : ''} />, label: '蒙版', desc: '精准遮罩控制，只改露出的区域', action: handleOpenMask },
    { icon: <Palette size={14} className={isMonochrome ? '' : 'text-pink-500'} />, label: '调色', desc: '亮度/对比度/饱和度/色温/色相参数调节', action: handleOpenColorAdjust },
    { icon: <Layers size={14} className={isMonochrome ? monoColors['编辑元素'] : ''} />, label: '编辑元素', desc: '按元素分层，独立编辑', action: handleEditElements },
    { icon: <RotateCcw size={14} className={isMonochrome ? monoColors['多角度'] : ''} />, label: '多角度', desc: '多视角生成', action: handleOpenMultiAngle },
    { icon: <BoxIcon size={14} className={isMonochrome ? monoColors['图转3D工厂'] : ''} />, label: '图转3D工厂', desc: '生成3D模型预览', action: handleOpen3D },
    { icon: <Expand size={14} className={isMonochrome ? monoColors['扩展'] : ''} />, label: '扩展', desc: '向四周延伸画面，自动补齐背景', action: handleOpenExpand },
    { icon: <Scissors size={14} className={isMonochrome ? monoColors['裁切'] : ''} />, label: '裁切', desc: '自由/预设比例裁切', action: handleOpenCrop },
    { icon: <Scan size={14} className={isMonochrome ? monoColors['精修引擎'] : ''} />, label: '精修引擎', desc: '产品精修：标准/专家模式，AI商业级修图', action: () => { setRefineEngineImageUrl(resolveRefineEngineInitialImageUrl(selectedImageData, selectedImage)); setShowRefineEngine(true); } },
    { icon: <Pencil size={14} className={isMonochrome ? monoColors['语言修图'] : ''} />, label: '语言修图', desc: '用自然语言描述修改图片', action: () => { if (selectedImage) onEditImage?.(selectedImage); else onEditImage?.(null); } },
    { icon: <Bot size={14} className={isMonochrome ? monoColors['Agent编排'] : ''} />, label: 'Agent编排', desc: '智能编排多工具编辑图片', action: () => { const img = selectedImageData || selectedImage; if (img) { setAgentEditImage(img); } else { setAgentEditImage(null); } setShowAgentEditor(true); } },
    { icon: <Globe size={14} className={isMonochrome ? 'text-emerald-500' : 'text-emerald-400'} />, label: '全景生成', desc: '生成720°全景图', action: () => handleGeneratePanorama() },
    { icon: <Film size={14} className={isMonochrome ? 'text-purple-500' : 'text-purple-400'} />, label: '视频抽帧', desc: '从视频中提取帧图片', action: () => { const img = selectedImageData; if (img?.mediaType === 'video') { setEditImageId(img.id); setVideoExtractFrameCount(12); setVideoExtractProcessing(false); setShowVideoExtractPanel(true); } else { toast.error('请先选中视频文件'); } } },
    { icon: <Volume2 size={14} className={isMonochrome ? 'text-orange-500' : 'text-orange-400'} />, label: 'AI配音', desc: '为视频添加AI配音', action: () => { const img = selectedImageData; if (img?.mediaType === 'video') { setVideoDubTarget(img); setShowVideoDubPanel(true); } else toast.error('请先选中视频文件'); } },
    { icon: <Download size={14} className={isMonochrome ? monoColors['下载'] : ''} />, label: '下载', desc: 'PNG/SVG/PSD下载', action: handleOpenDownload },
  ];

  // 根据 toolbarItemOrder 和 toolbarHiddenItems 过滤/排序工具栏
  // 确保新增的工具项（localStorage中可能没有）也能显示
  const allActionLabels = imageActions.map(a => a.label);
  const fullOrder = [...toolbarItemOrder].filter(label => allActionLabels.includes(label));
  for (const label of allActionLabels) {
    if (!fullOrder.includes(label)) fullOrder.push(label);
  }
  // 根据媒体类型过滤可用工具
  const getAvailableToolsByMediaType = (mediaType?: 'image' | 'video' | '3d'): string[] => {
    const imageTools = ['放大', '移除背景', 'SVG智能描摹', '擦除', '蒙版', '调色', '编辑元素', '多角度', '图转3D工厂', '扩展', '裁切', '全景生成', '精修引擎', '语言修图', 'Agent编排', '下载'];
    const videoTools = ['视频抽帧', 'AI配音', '下载'];
    const model3DTools = ['下载'];
    
    if (mediaType === 'video') return videoTools;
    if (mediaType === '3d') return model3DTools;
    return imageTools; // 默认图片类型
  };

  const selectedMediaType = selectedImageData?.mediaType;
  const availableTools = getAvailableToolsByMediaType(selectedMediaType);

  const visibleImageActions = fullOrder
    .filter(label => !toolbarHiddenItems.has(label) && availableTools.includes(label))
    .map(label => imageActions.find(a => a.label === label))
    .filter((a): a is typeof imageActions[number] => a !== undefined);

  // 折叠时仅显示前5个
  const displayedActions = toolbarExpanded ? visibleImageActions : visibleImageActions.slice(0, 5);
  const hasMoreActions = visibleImageActions.length > 5;

  // Canvas right-click menu items
  const canvasMenuItems = [
    { label: '粘贴', shortcut: 'Ctrl+V', action: () => {} },
    { label: '放大', shortcut: 'Ctrl++', action: () => { setZoom(z => Math.min(5, z * 1.2)); } },
    { label: '缩小', shortcut: 'Ctrl+-', action: () => { setZoom(z => Math.max(0.1, z / 1.2)); } },
    { label: '显示所有元素', shortcut: 'Shift+1', action: () => { if (images.length === 0) return; const minX = Math.min(...images.map(i => i.x)); const minY = Math.min(...images.map(i => i.y)); Math.max(...images.map(i => i.x + i.width)); Math.max(...images.map(i => i.y + i.height)); setViewOffset({ x: -minX * zoom + 50, y: -minY * zoom + 50 }); } },
    { label: '缩放至100%', shortcut: 'Ctrl+0', action: () => { setZoom(1); setViewOffset({ x: 0, y: 0 }); } },
  ];

  // Helper to save image changes and force persist
  const applyImageChanges = (newImages: typeof images) => {
    onImagesChange(newImages);
    onForceSave?.();
  };

  const imageContextMenuItems = selectedIds.size > 1 ? [
    ...(selectedIds.size === 2 ? [{ label: '图片对比', shortcut: '', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length === 2) {
        setCompareImages({ left: selImgs[0], right: selImgs[1] });
        setShowCompareDialog(true);
      }
    } }] : []),
    { label: '创建组', shortcut: 'Ctrl+G', action: () => { handleCreateGroup(); } },
    { label: '对齐-左', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 2) return;
      const minX = Math.min(...selImgs.map(i => i.x));
      applyImageChanges(images.map(i => selectedIds.has(i.id) ? { ...i, x: minX } : i));
    } },
    { label: '对齐-右', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 2) return;
      const maxRight = Math.max(...selImgs.map(i => i.x + i.width));
      applyImageChanges(images.map(i => selectedIds.has(i.id) ? { ...i, x: maxRight - i.width } : i));
    } },
    { label: '对齐-上', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 2) return;
      const minY = Math.min(...selImgs.map(i => i.y));
      applyImageChanges(images.map(i => selectedIds.has(i.id) ? { ...i, y: minY } : i));
    } },
    { label: '对齐-下', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 2) return;
      const maxBottom = Math.max(...selImgs.map(i => i.y + i.height));
      applyImageChanges(images.map(i => selectedIds.has(i.id) ? { ...i, y: maxBottom - i.height } : i));
    } },
    { label: '水平居中', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 2) return;
      const center = (Math.min(...selImgs.map(i => i.x)) + Math.max(...selImgs.map(i => i.x + i.width))) / 2;
      applyImageChanges(images.map(i => selectedIds.has(i.id) ? { ...i, x: center - i.width / 2 } : i));
    } },
    { label: '垂直居中', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 2) return;
      const center = (Math.min(...selImgs.map(i => i.y)) + Math.max(...selImgs.map(i => i.y + i.height))) / 2;
      applyImageChanges(images.map(i => selectedIds.has(i.id) ? { ...i, y: center - i.height / 2 } : i));
    } },
    { label: '水平等间距', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 3) return;
      const sorted = [...selImgs].sort((a, b) => a.x - b.x);
      const leftMost = sorted[0].x;
      const rightMost = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
      const totalWidth = sorted.reduce((s, i) => s + i.width, 0);
      const gap = (rightMost - leftMost - totalWidth) / (sorted.length - 1);
      let cx = leftMost;
      const xMap = new Map<string, number>();
      for (const img of sorted) {
        xMap.set(img.id, cx);
        cx += img.width + gap;
      }
      applyImageChanges(images.map(i => selectedIds.has(i.id) && xMap.has(i.id) ? { ...i, x: xMap.get(i.id)! } : i));
    } },
    { label: '垂直等间距', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 3) return;
      const sorted = [...selImgs].sort((a, b) => a.y - b.y);
      const topMost = sorted[0].y;
      const bottomMost = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
      const totalHeight = sorted.reduce((s, i) => s + i.height, 0);
      const gap = (bottomMost - topMost - totalHeight) / (sorted.length - 1);
      let cy = topMost;
      const yMap = new Map<string, number>();
      for (const img of sorted) {
        yMap.set(img.id, cy);
        cy += img.height + gap;
      }
      applyImageChanges(images.map(i => selectedIds.has(i.id) && yMap.has(i.id) ? { ...i, y: yMap.get(i.id)! } : i));
    } },
    { label: '一键排版 Ctrl+Q', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 2) return;
      // Waterfall/masonry layout - like Pinterest/Huaban
      const COL_WIDTH = 280; // Column width in canvas pixels
      const GAP = 16; // Gap between columns and rows
      const NUM_COLS = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(selImgs.length))));
      // Initialize column heights
      const colHeights: number[] = new Array(NUM_COLS).fill(0);
      // Find the starting position (top-left of bounding box)
      const startX = Math.min(...selImgs.map(i => i.x));
      const startY = Math.min(...selImgs.map(i => i.y));
      // Assign each image to the shortest column
      const posMap = new Map<string, { x: number; y: number; width: number; height: number }>();
      // Sort images by height descending for better masonry packing
      const sorted = [...selImgs].sort((a, b) => b.height - a.height);
      for (const img of sorted) {
        // Scale image to fit column width while maintaining aspect ratio
        const scale = COL_WIDTH / img.width;
        const newWidth = COL_WIDTH;
        const newHeight = Math.round(img.height * scale);
        // Find shortest column
        const minColIdx = colHeights.indexOf(Math.min(...colHeights));
        const x = startX + minColIdx * (COL_WIDTH + GAP);
        const y = startY + colHeights[minColIdx];
        posMap.set(img.id, { x, y, width: newWidth, height: newHeight });
        colHeights[minColIdx] += newHeight + GAP;
      }
      applyImageChanges(images.map(i => {
        if (!selectedIds.has(i.id) || !posMap.has(i.id)) return i;
        const pos = posMap.get(i.id)!;
        return { ...i, x: pos.x, y: pos.y, width: pos.width, height: pos.height };
      }));
    } },
    { label: '网格排版', action: () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length < 2) return;
      const colsStr = prompt(`输入列数（当前${selImgs.length}张）`, String(Math.ceil(Math.sqrt(selImgs.length))));
      if (!colsStr) return;
      const cols = Math.max(1, Math.min(10, parseInt(colsStr) || 3));
      const gap = 20;
      // Determine cell size based on largest image
      const cellW = Math.max(...selImgs.map(i => i.width));
      const cellH = Math.max(...selImgs.map(i => i.height));
      const startX = Math.min(...selImgs.map(i => i.x));
      const startY = Math.min(...selImgs.map(i => i.y));
      const posMap = new Map<string, { x: number; y: number }>();
      selImgs.forEach((img, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        posMap.set(img.id, { x: startX + col * (cellW + gap), y: startY + row * (cellH + gap) });
      });
      applyImageChanges(images.map(i => {
        if (!selectedIds.has(i.id) || !posMap.has(i.id)) return i;
        const pos = posMap.get(i.id)!;
        return { ...i, x: pos.x, y: pos.y };
      }));
      toast.success(`已按${cols}列网格排列`);
    } },
    { label: '批量下载 ZIP', action: async () => {
      const selImgs = images.filter(i => selectedIds.has(i.id));
      if (selImgs.length === 0) return;
      toast.loading(`正在打包 ${selImgs.length} 张图片...`, { id: 'batch-download' });
      try {
        // Dynamically import JSZip
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        // Download all images in parallel
        const downloads = await Promise.all(selImgs.map(async (img, idx) => {
          try {
            const url = img.svgDataUrl || img.url;
            const isSvg = !!img.svgDataUrl;
            const resp = await fetch(url);
            const blob = await resp.blob();
            const ext = isSvg ? 'svg' : (url.toLowerCase().includes('.webp') ? 'webp' : 'png');
            const name = `wujie_${String(idx + 1).padStart(3, '0')}_${(img.prompt || 'image').slice(0, 30).replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
            return { name, blob };
          } catch {
            return null;
          }
        }));
        downloads.filter(Boolean).forEach(d => { if (d) zip.file(d.name, d.blob); });
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        // Download zip
        const zipUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = zipUrl;
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        a.download = `wujie_${dateStr}_${selImgs.length}images.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(zipUrl);
        toast.success(`已打包 ${downloads.filter(Boolean).length} 张图片`, { id: 'batch-download' });
      } catch (err) {
        console.error('[batch-download] failed:', err);
        toast.error('打包失败，请重试', { id: 'batch-download' });
      }
    } },
  ] : [
    { label: '复制', shortcut: 'Ctrl+C', action: () => { const img = selectedImageData; if (img) handleCopyImage(img); } },
    { label: '下载', action: () => { handleOpenDownload(); } },
    ...(selectedImageData?.threeDModelUrl ? [{ label: '3D 预览', action: () => { setViewer3DModelUrl(selectedImageData.threeDModelUrl || ''); setViewer3DPreviewUrl(selectedImageData.url); setViewer3DModelUrls(selectedImageData.threeDModelUrls || {}); setViewer3DThumbnailUrls(selectedImageData.threeDThumbnailUrls || {}); setViewer3DTextureUrls(selectedImageData.threeDTextureUrls || []); setViewer3DModelInfo(selectedImageData.threeDModelInfo || {}); setShow3DViewer(true); } }] : []),
    ...(selectedImageData?.mediaType === 'video' && selectedImageData?.videoUrl ? [{ label: '播放视频', action: () => { setVideoPlayerUrl(selectedImageData.videoUrl!); setVideoPlayerVisible(true); } }] : []),
    ...(selectedImageData?.mediaType === 'video' && selectedImageData?.videoUrl ? [{ label: '视频编辑', action: () => { setVideoEditTarget(selectedImageData); setShowVideoEditPanel(true); } }] : []),
    ...(selectedImageData?.mediaType === 'video' && selectedImageData?.videoUrl ? [{ label: '视频延长', action: () => { setVideoEditTarget(selectedImageData); setShowVideoEditPanel(true); setVideoEditTab('extend'); } }] : []),
    ...(selectedImageData?.mediaType === 'video' && selectedImageData?.videoUrl ? [{ label: '视频对比', action: () => { const img = selectedImageData; if (img?.videoUrl) setCompareVideos({ a: { url: img.videoUrl, label: img.prompt?.slice(0, 30) || '视频1' }, b: { url: img.videoUrl, label: '请选择第二个视频' } }); } }] : []),
    ...(selectedImageData?.mediaType === 'video' && selectedImageData?.videoUrl ? [{ label: '提取帧生成视频', action: async () => { const img = selectedImageData; if (!img?.videoUrl) return; try { const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.src = img.videoUrl; video.muted = true; video.preload = 'auto'; await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('视频加载失败')); video.load(); }); video.currentTime = 0; await new Promise<void>(resolve => { video.onseeked = () => resolve(); }); const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas context failed'); ctx.drawImage(video, 0, 0); const dataUrl = canvas.toDataURL('image/png'); const saveRes = await fetch('/api/save-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl, filename: `frame-for-video-${Date.now()}.png` }), }); const saveData = await saveRes.json(); const frameUrl = saveData.url || saveData.localPath || dataUrl; onAddImages([frameUrl], undefined, { modelName: 'frame-extract', apiProvider: 'local' }); toast.success('已提取帧到画布，选中后可在视频面板中图生视频'); } catch (err) { console.error('[extract-frame-video] error:', err); toast.error('帧提取失败'); } } }] : []),
    // 视频工具集
    ...(selectedImageData?.mediaType === 'video' && selectedImageData?.videoUrl ? [
      { label: '─'.repeat(15), action: () => {} }, // 分隔线
      { label: '转 GIF', action: () => { handleVideoTool('to-gif', selectedImageData); } },
      { label: '提取封面', action: () => { handleVideoTool('extract-cover', selectedImageData); } },
      { label: '批量抽帧(均匀5帧)', action: () => { handleVideoExtractFrames(selectedImageData, 'uniform', 5); } },
      { label: '批量抽帧(关键帧)', action: () => { handleVideoExtractFrames(selectedImageData, 'keyframes', 0); } },
      { label: 'AI配音合成', action: () => { setVideoDubTarget(selectedImageData); setShowVideoDubPanel(true); } },
      { label: '提取帧', action: () => { const t = prompt('输入提取时间点（秒）', '0'); if (t !== null) handleVideoTool('extract-frame', selectedImageData, parseFloat(t)); } },
      { label: '视频压缩', action: () => { handleVideoTool('compress', selectedImageData); } },
    ] : []),
    { label: '删除', shortcut: 'Delete', action: () => { const deletingIds = selectedIds; onImagesChange(images.filter(i => !deletingIds.has(i.id))); setSelectedIds(new Set()); selectImage(null); if (editImageId && deletingIds.has(editImageId)) { setEditImageId(null); setEditMode('none'); } } },
    { label: '发送参考图', action: () => { const img = selectedImageData; if (img) onGenerateVariation(img); } },
    { label: '提取关键词', action: () => { const img = selectedImageData; if (img) onExtractKeywords(img); } },
    { label: '语言修图', action: () => { const img = selectedImageData; if (img) onEditImage?.(img); else onEditImage?.(null); } },
    { label: 'Agent编排', action: () => { const img = selectedImageData; if (img) { setAgentEditImage(img); setShowAgentEditor(true); } } },
    ...(selectedImageData?.mediaType !== 'video' ? [{ label: '生成720全景图', action: () => { handleGeneratePanorama(selectedImageData ?? undefined); } }] : []),
    { label: '发送到聊天修改', action: () => { const img = selectedImageData; if (img && onSendToChat) onSendToChat(img); } },
    { label: '图片对比', action: () => { const img = selectedImageData; if (img) { setCompareImages({ left: img, right: null }); setCompareSelecting(true); } } },
    { label: '加入收藏夹', action: () => { const img = selectedImageData; if (img && onAddToFavorites) onAddToFavorites(img); } },
  ];

  const ratioOptions = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'];

  // Floating panel style helpers
  const panelBaseClass = `flex items-center gap-1.5 px-3 py-2 rounded-xl border shadow-xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1e1e1e] border-[#333]'}`;
  const panelLabelClass = `text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-text-bright'}`;
  const panelSmallLabelClass = `text-xs ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`;
  const panelDividerClass = `w-px h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'} mx-1`;
  const panelBtnClass = `px-3 py-1.5 text-xs font-medium ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c049]'} rounded-lg transition-colors`;
  const panelCancelBtnClass = `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'}`;
  const panelInputClass = `w-16 px-2 py-1 text-xs rounded-lg border text-center ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-[#2a2a2a] border-[#444] text-white'}`;

  // Get toolbar position for selected image
  const getToolbarPosition = () => {
    const img = selectedImageData;
    if (!img) return { x: 0, y: 0 };
    const imgScreenX = img.x * zoom + viewOffset.x;
    const imgScreenY = img.y * zoom + viewOffset.y;
    const imgScreenW = img.width * zoom;
    return {
      x: imgScreenX + imgScreenW / 2,
      y: imgScreenY - 8,
    };
  };

  return (
    <div className="w-full h-full relative">
      {/* Canvas Area */}
      <div
        ref={(el) => { canvasRef.current = el; canvasContainerRef.current = el; }}
        data-canvas-viewport
        className={`absolute inset-0 overflow-hidden select-none ${
          annotationMode
            ? 'cursor-crosshair'
            : altKeyHeld && editMode === 'none'
            ? 'cursor-copy'
            : ctrlKeyHeld && editMode === 'none'
            ? 'cursor-pointer'
            : isPanning || isSpacePressed
            ? 'cursor-grab active:cursor-grabbing'
            : boxSelectStart
            ? 'cursor-crosshair'
            : (editMode === 'erase' || editMode === 'mask')
            ? 'cursor-default'  // 擦除/蒙版使用浮动窗口，主画布保持默认光标
            : editMode !== 'none'
            ? 'cursor-crosshair'
            : isSpacePressed
            ? 'cursor-grab'
            : isPanning || isMiddlePanning
            ? 'cursor-grabbing'
            : 'cursor-default'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Grid background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={
            gridMode === 'blank' ? {
              backgroundColor: isMonochrome ? '#ffffff' : '#0F1117',
            }
            : isMonochrome ? {
                backgroundColor: '#ffffff',
                backgroundImage: gridMode === 'dots'
                  ? `radial-gradient(circle, #d1d5db ${zoom < 0.3 ? 0.5 : zoom < 0.7 ? 0.8 : 1.15}px, transparent ${zoom < 0.3 ? 0.5 : zoom < 0.7 ? 0.8 : 1.15}px)`
                  : 'linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)',
                backgroundSize: gridMode === 'dots'
                  ? `${12 / Math.max(zoom, 0.15)}px ${12 / Math.max(zoom, 0.15)}px`
                  : `${24 / Math.max(zoom, 0.15)}px ${24 / Math.max(zoom, 0.15)}px`,
                transform: gridMode === 'dots'
                  ? `translate(${viewOffset.x % (12 / Math.max(zoom, 0.15))}px, ${viewOffset.y % (12 / Math.max(zoom, 0.15))}px)`
                  : `translate(${viewOffset.x % (24 / Math.max(zoom, 0.15))}px, ${viewOffset.y % (24 / Math.max(zoom, 0.15))}px)`,
              }
            : {
                backgroundColor: '#0F1117',
                backgroundImage: gridMode === 'dots'
                  ? `radial-gradient(circle, rgba(255,255,255,${zoom < 0.3 ? 0.08 : zoom < 0.7 ? 0.12 : 0.18}) ${zoom < 0.3 ? 0.5 : 0.8}px, transparent ${zoom < 0.3 ? 0.5 : 0.8}px)`
                  : 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                backgroundSize: gridMode === 'dots'
                  ? `${12 / Math.max(zoom, 0.15)}px ${12 / Math.max(zoom, 0.15)}px`
                  : `${24 / Math.max(zoom, 0.15)}px ${24 / Math.max(zoom, 0.15)}px`,
                transform: gridMode === 'dots'
                  ? `translate(${viewOffset.x % (12 / Math.max(zoom, 0.15))}px, ${viewOffset.y % (12 / Math.max(zoom, 0.15))}px)`
                  : `translate(${viewOffset.x % (24 / Math.max(zoom, 0.15))}px, ${viewOffset.y % (24 / Math.max(zoom, 0.15))}px)`,
              }
          }
        />

        {/* Collapsible toolbar - top left (click to toggle) */}
        <div ref={leftToolbarRef} data-toolbar="left-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        {leftToolbarExpanded ? (
          /* Expanded: full toolbar */
          <div className={`absolute top-4 left-4 z-50 flex flex-col gap-1 min-w-[160px] p-2 rounded-xl ${isMonochrome ? 'bg-white border border-gray-200 shadow-lg' : 'bg-[#1a1a1a] border border-white/[0.12] shadow-2xl'} transition-all duration-200`}>
            {/* Logo header */}
            <div className="flex items-center gap-2 px-2 py-1.5">
              <NextImage unoptimized width={1} height={1} src="/logo.png" alt="无界AI" className="w-6 h-6 object-contain rounded" />
              <span className={`text-sm font-bold ${isMonochrome ? 'text-gray-900' : 'text-foreground'}`}>无界AI</span>
            </div>
            {/* Divider */}
            <div className={ltDividerCls} />
            {/* Workspace / Dashboard */}
            <button
              aria-label="工作台"
              onClick={onSwitchToDashboard}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="工作台"
            >
              <LayoutDashboard className={`h-3.5 w-3.5 ${mIcon.layoutGrid}`} />
              <span>工作台</span>
            </button>
            {/* OMP Toggle */}
            <button
              aria-label="Oh My Prompt - 提示词管理与图片识词"
              onClick={() => {
                if (onToggleVisionPrompt) onToggleVisionPrompt();
              }}
              className={`min-h-[44px] flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                ohMyPromptOpen
                  ? ltActiveBtnCls
                  : ltExpandedBtnCls
              }`}
              title="Oh My Prompt - 提示词管理与图片识词"
            >
              <Sparkles className={`h-3.5 w-3.5 ${mIcon.ohMyPrompt}`} />
              <span>Oh My Prompt</span>
              {ohMyPromptOpen && (
                <span className={`ml-auto w-1.5 h-1.5 rounded-full animate-pulse ${isMonochrome ? 'bg-blue-500' : 'bg-gold'}`} />
              )}
            </button>
            {/* Ctrl+Click Reference Fusion Toggle */}
            <button
              aria-label="Ctrl+Click 画布图片选择参考融合"
              onClick={() => setShowRefFusion(prev => !prev)}
              className={`min-h-[44px] flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                showRefFusion
                  ? ltActiveBtnCls
                  : ltExpandedBtnCls
              }`}
              title="Ctrl+Click 画布图片选择参考融合"
            >
              <GitMerge className={`h-3.5 w-3.5 ${mIcon.refFusion}`} />
              <span>参考融合</span>
              {showRefFusion && (
                <span className={`ml-auto w-1.5 h-1.5 rounded-full animate-pulse ${isMonochrome ? 'bg-blue-500' : 'bg-gold'}`} />
              )}
            </button>
            {/* Divider */}
            <div className={ltDividerCls} />
            {/* Section: Mode switching */}
            <div className={ltSectionTitleCls}>模式切换</div>
            {/* Settings */}
            <button
              aria-label="设置"
              onClick={onToggleSettings}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="设置"
            >
              <Settings className={`h-3.5 w-3.5 ${mIcon.settings}`} />
              <span>设置</span>
            </button>
            {/* UI Theme Toggle */}
            <button
              aria-label="UI 主题切换"
              onClick={onToggleTheme}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="UI 主题切换"
            >
              {isMonochrome ? <Palette className={`h-3.5 w-3.5 ${mIcon.palette}`} /> : <Contrast className={`h-3.5 w-3.5 ${mIcon.contrast}`} />}
              <span>{isMonochrome ? '彩色模式' : '黑白模式'}</span>
            </button>
            {/* User Manager */}
            <button
              aria-label="用户管理"
              onClick={onToggleUserManager}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="用户管理"
            >
              <Users className={`h-3.5 w-3.5 ${mIcon.users}`} />
              <span>用户管理</span>
            </button>
            {/* Project Data */}
            <button
              aria-label="项目数据"
              onClick={onToggleProjectData}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="项目数据"
            >
              <FolderOpen className={`h-3.5 w-3.5 ${mIcon.folder}`} />
              <span>项目数据</span>
            </button>
            {isAdmin && (
              <button
                aria-label="管理员系统"
                onClick={onToggleAdminSystem}
                className={`min-h-[44px] ${ltAdminBtnCls}`}
                title="管理员系统"
              >
                <Shield className={`h-3.5 w-3.5 ${mIcon.shield}`} />
                <span>管理员系统</span>
              </button>
            )}
            {/* Favorites */}
            <button
              aria-label="收藏夹"
              onClick={onToggleFavorites}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="收藏夹"
            >
              <Heart className={`h-3.5 w-3.5 ${mIcon.heart}`} />
              <span>收藏夹</span>
            </button>
            {/* Prompt Templates */}
            <button
              aria-label="提示词模板"
              onClick={onTogglePromptTemplate}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="提示词模板"
            >
              <FileText className={`h-3.5 w-3.5 ${mIcon.fileText}`} />
              <span>提示词模板</span>
            </button>
            {/* Help */}
            <button
              aria-label="使用说明"
              onClick={onToggleHelp}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="使用说明"
            >
              <HelpCircle className={`h-3.5 w-3.5 ${mIcon.helpCircle}`} />
              <span>使用说明</span>
            </button>
            {/* Divider */}
            <div className={ltDividerCls} />
            {/* Node Mode */}
            <button
              onClick={onSwitchToNodeMode}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="节点模式"
            >
              <Workflow className={`h-3.5 w-3.5 ${mIcon.workflow}`} />
              <span>节点模式</span>
            </button>
            {/* Workflow Hub */}
            <button
              onClick={onSwitchToWorkflowHub}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="工作流中心"
            >
              <LayoutGrid className={`h-3.5 w-3.5 ${mIcon.layoutGrid}`} />
              <span>工作流中心</span>
            </button>
            {/* Divider */}
            <div className={ltDividerCls} />
            {/* Collapse button */}
            <button
              onClick={() => setLeftToolbarExpanded(false)}
              className={`min-h-[44px] ${ltExpandedBtnCls}`}
              title="收起工具栏"
            >
              <ChevronsLeft className={`h-3.5 w-3.5 ${mIcon.chevronsLeft}`} />
              <span>收起</span>
            </button>
          </div>
        ) : (
          /* Collapsed: icon column */
          <div className={`absolute top-4 left-4 z-50 flex flex-col items-center py-2 gap-1 rounded-full ${isMonochrome ? 'bg-white border border-gray-200 shadow-lg' : 'bg-[#1a1a1a] border border-white/[0.12] shadow-2xl'} transition-all duration-200`} style={{ width: 48 }}>
            {/* Workspace / Dashboard */}
            <button
              onClick={onSwitchToDashboard}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${isMonochrome ? `bg-gray-50 ${mIcon.layoutGrid} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`}
              title="工作台"
            >
              <LayoutDashboard className="w-4 h-4" />
            </button>
            <button
              onClick={() => { if (onToggleVisionPrompt) onToggleVisionPrompt(); }}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${ohMyPromptOpen ? ltActiveBtnCls : isMonochrome ? `bg-gray-50 ${mIcon.ohMyPrompt} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`}
              title="Oh My Prompt"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleUserManager}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${isMonochrome ? `bg-gray-50 ${mIcon.users} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`}
              title="用户管理"
            >
              <Users className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleProjectData}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${isMonochrome ? `bg-gray-50 ${mIcon.folder} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`}
              title="项目数据"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
            <button
              onClick={onTogglePromptTemplate}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${isMonochrome ? `bg-gray-50 ${mIcon.fileText} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`}
              title="提示词模板"
            >
              <FileText className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleTheme}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${isMonochrome ? `bg-gray-50 ${mIcon.palette} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`}
              title={isMonochrome ? '切换彩色模式' : '切换黑白模式'}
            >
              {isMonochrome ? <Palette className="w-4 h-4" /> : <Contrast className="w-4 h-4" />}
            </button>
            <div className={`w-5 my-1 h-px ${isMonochrome ? 'bg-gray-200' : 'bg-white/[0.06]'}`} />
            <button
              onClick={onSwitchToNodeMode}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${isMonochrome ? `bg-gray-50 ${mIcon.workflow} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`}
              title="节点模式"
            >
              <Workflow className={`w-4 h-4 ${mIcon.workflow}`} />
            </button>
            <button
              onClick={onSwitchToWorkflowHub}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${isMonochrome ? `bg-gray-50 ${mIcon.layoutGrid} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`}
              title="工作流中心"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <div className={`w-5 my-1 h-px ${isMonochrome ? 'bg-gray-200' : 'bg-white/[0.06]'}`} />
            <button
              onClick={() => setLeftToolbarExpanded(true)}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 ${isMonochrome ? `bg-gray-50 ${mIcon.chevronsRight} hover:bg-gray-100` : 'bg-white/5 text-gold-muted hover:bg-white/10 hover:text-text-bright'}`} title="展开工具栏"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        )}
        </div>

        {/* Oh My Prompt Panel - floating window from toolbar */}
        {ohMyPromptOpen && (
          <OhMyPrompt
            isOpen={true}
            onClose={() => onCloseOhMyPrompt?.()}
            onInsertPrompt={(prompt: string) => onInsertPrompt?.(prompt)}
            onVisionPrompt={(url: string) => onVisionPrompt?.(url)}
            isVisionAnalyzing={isVisionAnalyzing}
            visionResult={visionResult}
            themeStyle={ohMyPromptThemeStyle}
            floating={true}
            defaultActiveTab={ompActiveTab}
            autoAnalyzeImageUrl={ompVisionImageUrl}
          />
        )}

        {/* Alt+Click reference mark hint (top center) */}
        {altKeyHeld && editMode === 'none' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-lg flex items-center gap-1.5 ${isMonochrome ? 'bg-blue-500/90 text-white' : 'bg-gold/90 text-black'}`}>
              <span className="text-xs">Alt+Click</span>
              <span className="opacity-70">标记图片为参考图</span>
            </div>
          </div>
        )}

        {/* Ctrl+Click reference hint (top center) */}
        {ctrlKeyHeld && editMode === 'none' && showRefFusion && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-lg flex items-center gap-1.5 ${isMonochrome ? 'bg-blue-500/90 text-white' : 'bg-gold/90 text-black'}`}>
              <span className="text-xs">Ctrl+Click</span>
              <span className="opacity-70">选择参考图片</span>
            </div>
          </div>
        )}

        {/* Agent 选择图片提示 (top center) */}
        {agentSelectingImage && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-lg flex items-center gap-1.5 ${isMonochrome ? 'bg-blue-500/90 text-white' : 'bg-gold/90 text-black'}`}>
              <Bot className="w-3 h-3" />
              <span>点击图片进行 Agent 编排</span>
              <span className="opacity-70">· ESC 取消</span>
            </div>
          </div>
        )}

        {/* Image compare: selecting second image */}
        {compareSelecting && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-lg flex items-center gap-1.5 ${isMonochrome ? 'bg-blue-500/90 text-white' : 'bg-gold/90 text-black'}`}>
              <Contrast className="w-3 h-3" />
              <span>点击另一张图片进行对比</span>
              <span className="opacity-70">· ESC 取消</span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {images.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-3 max-w-sm">
              <div className={`text-2xl font-light ${isMonochrome ? 'text-gray-400' : 'text-gray-300'}`}>无限画布</div>
              <div className={`text-xs leading-relaxed space-y-1 ${isMonochrome ? 'text-gray-400' : 'text-gray-500'}`}>
                <p>拖入图片 / 上传图片 / AI 生成图片到画布</p>
                <p>左键选择 · 滚轮缩放 · 空格+拖动平移 · 右键菜单</p>
                <p>底部工具栏：图像生成 · 图转3D工厂 · 修图 · Agent编排 · 字境大师 · 精修引擎 · 品牌电商</p>
              </div>
            </div>
          </div>
        )}

        {/* Canvas images */}
        <div ref={canvasTransformRef} style={{ transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${zoom})`, transformOrigin: '0 0', willChange: 'transform', contain: 'layout style' }}>
          {/* Image Groups */}
          {groups.map(group => {
            const groupImages = images.filter(img => img.groupId === group.id);
            if (groupImages.length === 0) return null;
            const padding = 12;
            const titleBarH = 36;
            const minX = Math.min(...groupImages.map(i => i.x));
            const minY = Math.min(...groupImages.map(i => i.y));
            const maxX = Math.max(...groupImages.map(i => i.x + i.width));
            const maxY = Math.max(...groupImages.map(i => i.y + i.height));
            const dragOff = (groupDragTarget === group.id && (groupDragReadyRef.current || groupDragOffset.x !== 0 || groupDragOffset.y !== 0)) ? groupDragOffset : { x: 0, y: 0 };
            const groupX = minX - padding + dragOff.x;
            const groupY = minY - titleBarH - padding + dragOff.y;
            const groupW = maxX - minX + padding * 2;
            const groupH = maxY - minY + titleBarH + padding * 2;
            const isEditing = editingGroupId === group.id;
            return (
              <div
                key={group.id}
                className={`absolute rounded-xl border-2 ${isMonochrome ? 'border-blue-400/60 bg-blue-50/10' : 'border-gold/40 bg-gold/5'} pointer-events-auto`}
                style={{
                  left: groupX,
                  top: groupY,
                  width: groupW,
                  height: group.collapsed ? titleBarH + padding * 2 : groupH,
                  zIndex: 5,
                  overflow: 'hidden',
                  transition: 'height 0.3s ease',
                }}
              >
                {/* Title bar */}
                <div
                  className={`flex items-center gap-2 px-3 ${isMonochrome ? 'bg-blue-50/80' : 'bg-[#222]'} rounded-t-lg h-[36px] select-none ${groupDragTarget === group.id && groupDragReadyRef.current ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onClick={(e) => { e.stopPropagation(); }}
                  onDoubleClick={() => {
                    if (editingGroupId === group.id) return; // already editing
                    setEditingGroupId(group.id);
                    setGroupEditName(group.name);
                    setGroupEditNote(group.note);
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return; // only left button
                    // Don't start drag if clicking on buttons or input
                    const target = e.target as HTMLElement;
                    if (target.closest('button') || target.closest('input')) return;
                    e.stopPropagation();
                    if (editingGroupId === group.id) return; // don't drag while editing name
                    // Start long press timer for group drag (hold 200ms before dragging)
                    groupDragReadyRef.current = false;
                    setGroupDragTarget(group.id);
                    const canvasPos = screenToCanvas(e.clientX, e.clientY);
                    setGroupDragStart(canvasPos);
                    setGroupDragOffset({ x: 0, y: 0 });
                    groupDragTimerRef.current = setTimeout(() => {
                      groupDragReadyRef.current = true;
                    }, 200);
                  }}
                >
                  {isEditing ? (
                    <input
                      className={`flex-1 text-sm font-medium bg-transparent border-none outline-none ${isMonochrome ? 'text-blue-700' : 'text-gold'}`}
                      value={groupEditName}
                      onChange={(e) => setGroupEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGroupEdit(); if (e.key === 'Escape') setEditingGroupId(null); }}
                      onBlur={handleSaveGroupEdit}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={`flex-1 text-sm font-medium truncate ${isMonochrome ? 'text-blue-700' : 'text-gold'}`}>
                      {group.name}
                    </span>
                  )}
                  {group.note && !isEditing && (
                    <span className={`text-xs truncate max-w-[120px] ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>
                      {group.note}
                    </span>
                  )}
                  <button
                    className={`p-0.5 rounded hover:bg-white/10 transition-colors ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}
                    onClick={(e) => { e.stopPropagation(); handleToggleGroupCollapse(group.id); }}
                    title={group.collapsed ? '展开' : '折叠'}
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${group.collapsed ? '-rotate-90' : ''}`} />
                  </button>
                  <button
                    className={`p-0.5 rounded hover:bg-red-500/20 transition-colors ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}
                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }}
                    title="取消分组"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* Collapsed indicator */}
                {group.collapsed && groupImages.length > 0 && (
                  <div className={`px-3 py-1 text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/50'}`}>
                    {groupImages.length} 张图片
                  </div>
                )}
                {/* Note editing */}
                {isEditing && (
                  <div className="px-3 py-1">
                    <input
                      className={`w-full text-xs bg-transparent border-b outline-none ${isMonochrome ? 'text-gray-500 border-gray-200' : 'text-gold-muted border-white/[0.12]'}`}
                      placeholder="添加备注..."
                      value={groupEditNote}
                      onChange={(e) => setGroupEditNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGroupEdit(); }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {visibleImagesWithThumbnails.map(image => {
            const isSelected = selectedIds.has(image.id);
            const isDragging = dragTarget && selectedIds.has(image.id);
            // Hide images belonging to collapsed groups
            const isGroupCollapsed = image.groupId ? (groups.find(g => g.id === image.groupId)?.collapsed ?? false) : false;
            // Hide images belonging to collapsed gen groups (reference/fusion groups)
            const collapsedGenGroup = genGroups.find(g => g.isCollapsed && (g.refImages.some(r => r.imageId === image.id) || (g.resultImageIds && g.resultImageIds.includes(image.id))));
            const isInCollapsedGenGroup = !!collapsedGenGroup;
            // Hide result images on canvas (they're shown in the result frame instead)
            const isGenGroupResultImage = genGroups.some(g => g.resultImageIds && g.resultImageIds.includes(image.id));
            // Apply group drag offset to images in the dragged group
            const isGroupDragging = groupDragTarget && image.groupId === groupDragTarget;
            // Apply genGroup drag offset to images belonging to the dragged gen group
            const draggedGenGroup = genGroupDragTarget ? genGroups.find(g => g.id === genGroupDragTarget) : null;
            const isInDraggedGenGroup = !!draggedGenGroup && (draggedGenGroup.refImages.some(r => r.imageId === image.id) || (draggedGenGroup.resultImageIds && draggedGenGroup.resultImageIds.includes(image.id)));
            return (
              <div
                key={image.id}
                className={`absolute group z-10 ${isSelected ? 'z-20' : ''} ${editMode !== 'none' && editImageId !== image.id ? 'opacity-30' : ''}`}
                style={{
                  left: (resizingImage === image.id && resizePreview ? resizePreview.x : image.x) + (isDragging ? dragOffset.x : 0) + (isGroupDragging ? groupDragOffset.x : 0) + (isInDraggedGenGroup ? genGroupDragOffset.x : 0),
                  top: (resizingImage === image.id && resizePreview ? resizePreview.y : image.y) + (isDragging ? dragOffset.y : 0) + (isGroupDragging ? groupDragOffset.y : 0) + (isInDraggedGenGroup ? genGroupDragOffset.y : 0),
                  width: resizingImage === image.id && resizePreview ? resizePreview.width : image.width,
                  height: resizingImage === image.id && resizePreview ? resizePreview.height : image.height,
                  display: (isGroupCollapsed || isInCollapsedGenGroup || isGenGroupResultImage) ? 'none' : undefined,
                  contentVisibility: 'auto',
                  containIntrinsicSize: `${image.width}px ${image.height}px`,
                }}
                onMouseEnter={() => {
                  if (visionPromptEnabled && editMode === 'none') {
                    setVisionHoverImage(image);
                  }
                  if (editMode === 'none' && !dragTarget && !resizingImage && !compareSelecting) {
                    keepHoverToolbar(image.id);
                  }
                }}
                onMouseLeave={() => {
                  setVisionHoverImage(null);
                  hideHoverToolbar();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (image.isProcessingPlaceholder) return;
                  if (editMode !== 'none') return;
                  if (annotationMode) return; // annotation mode handles its own clicks via mousedown
                  if (e.altKey) {
                    // 【调整2】Alt+Click: 创建/追加参考图组
                    handleAltClickAddToGroup(image);
                    return;
                  }
                  if (e.ctrlKey || e.metaKey) {
                    // 【调整3】Ctrl+Click: 创建/追加融图组
                    handleCtrlClickAddToGroup(image);
                    return;
                  } else {
                    setSelectedIds(new Set([image.id]));
                    selectImage(image.id);
                  }
                }}
              >
                {image.isProcessingPlaceholder && image.processing ? (
                  <div className={`relative w-full h-full overflow-hidden border ${isMonochrome ? 'border-gray-200 bg-gray-100' : 'border-white/[0.14] bg-[#0f0f0f]'}`}>
                    {(image.processing.sourceUrl || image.url) && (
                    <NextImage unoptimized width={1} height={1}                       src={image.processing.sourceUrl || image.url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-40 pointer-events-none"
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                    />
                    )}
                    <div className="absolute inset-0 bg-black/50 pointer-events-none" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
                      {image.processing.label.includes('3D') ? (
                        /* 3D专属进度UI：旋转立方体图标 + 金色脉冲 */
                        <>
                          <div className="relative">
                            <svg width="40" height="40" viewBox="0 0 40 40" className="animate-spin" style={{ animationDuration: '3s' }}>
                              <defs>
                                <linearGradient id="cubeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                  <stop offset="0%" style={{ stopColor: '#d4af37' }} />
                                  <stop offset="100%" style={{ stopColor: '#f4e18f' }} />
                                </linearGradient>
                              </defs>
                              <path d="M20 4 L36 13 L36 27 L20 36 L4 27 L4 13 Z" fill="none" stroke="url(#cubeGrad)" strokeWidth="1.5" opacity="0.8" />
                              <path d="M20 4 L20 18 M20 36 L20 22 M4 13 L18 18 M36 13 L22 18" fill="none" stroke="url(#cubeGrad)" strokeWidth="1" opacity="0.5" />
                              <path d="M20 18 L20 22" fill="none" stroke="#d4af37" strokeWidth="2" opacity="0.9" />
                            </svg>
                            <div className="absolute inset-0 rounded-full bg-gold/20 animate-ping" style={{ animationDuration: '2s' }} />
                          </div>
                          <div className={`px-3 py-1.5 rounded-full bg-black/90 text-xs font-semibold shadow-lg border ${isMonochrome ? 'text-blue-400 border-blue-400/20' : 'text-gold border-gold/20'}`}>
                            {image.processing.label}
                          </div>
                          <div className="w-40 max-w-[75%] h-2 rounded-full bg-white/10 overflow-hidden shadow-inner">
                            <div
                              className="h-full rounded-full progress-shimmer transition-all duration-700 ease-out"
                              style={{
                                width: `${image.processing.progress}%`,
                                background: isMonochrome ? 'linear-gradient(90deg, #3b82f6, #93c5fd, #3b82f6)' : 'linear-gradient(90deg, #d4af37, #f4e18f, #d4af37)',
                                backgroundSize: '200% 100%',
                                boxShadow: isMonochrome ? '0 0 8px rgba(59,130,246,0.4)' : '0 0 8px rgba(212,175,55,0.4)',
                              }}
                            />
                          </div>
                          <div className="text-xs text-white/80 text-center px-3 font-medium">
                            {image.processing.status}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono ${isMonochrome ? 'text-blue-400/70' : 'text-gold/70'}`}>
                              {Math.round(image.processing.progress)}%
                            </span>
                            {image.processing.startTime && (
                              <span className={`text-xs font-mono ${isMonochrome ? 'text-blue-400/50' : 'text-gold/50'}`}>
                                <ElapsedTime startTime={image.processing.startTime} />
                              </span>
                            )}
                          </div>
                          {/* ★ 取消按钮 */}
                          <button
                            className="pointer-events-auto mt-0.5 px-3 py-1 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (pollingAbortRef.current) {
                                pollingAbortRef.current.abort();
                                pollingAbortRef.current = null;
                              }
                              removeProcessingFrame(image.id);
                            }}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        /* 通用进度UI */
                        <>
                          <div className={`px-4 py-2 rounded-full bg-black/90 text-sm font-medium shadow-lg border ${isMonochrome ? 'text-blue-400 border-blue-400/20' : 'text-white border-white/10'}`}>
                            {image.processing.label}
                          </div>
                          <div className="w-36 max-w-[70%] h-1.5 rounded-full bg-white/15 overflow-hidden">
                            <div
                              className="h-full rounded-full progress-shimmer transition-all duration-500"
                              style={{
                                width: `${image.processing.progress}%`,
                                background: isMonochrome ? 'linear-gradient(90deg, #3b82f6, #93c5fd, #3b82f6)' : 'linear-gradient(90deg, #d4af37, #f4e18f, #d4af37)',
                                backgroundSize: '200% 100%',
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-2 text-xs px-3">
                            <span className="text-white/70">
                              {image.processing.status} {Math.round(image.processing.progress)}%
                            </span>
                            {image.processing.startTime && (
                              <span className={`font-mono ${isMonochrome ? 'text-blue-400/50' : 'text-gold/50'}`}>
                                <ElapsedTime startTime={image.processing.startTime} />
                              </span>
                            )}
                          </div>
                          {/* ★ 取消按钮 */}
                          <button
                            className="pointer-events-auto mt-0.5 px-3 py-1 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (pollingAbortRef.current) {
                                pollingAbortRef.current.abort();
                                pollingAbortRef.current = null;
                              }
                              removeProcessingFrame(image.id);
                            }}
                          >
                            取消
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : image.url ? (
                  <NextImage unoptimized width={1} height={1}                     src={zoom > 0.5 || (image.width && image.width * zoom > THUMBNAIL_MAX) ? image.url : (image.thumbnailUrl || image.url)}
                    alt={image.prompt ? image.prompt.replace(/^\[画布上下文[：:][^\]]*\]\s*/, '').substring(0, 60) : 'canvas image'}
                    className="w-full h-full object-cover pointer-events-none overflow-hidden"
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    style={{ contain: 'paint', imageRendering: zoom > 1 ? 'auto' : undefined }}
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.dataset.retried) return; // 已重试过，不再循环
                      img.dataset.retried = '1';
                      // 如果缩略图失败，回退到原图
                      if (image.thumbnailUrl && img.src === image.thumbnailUrl) {
                        img.src = image.url;
                        return;
                      }
                      const url = image.url;
                      // /uploads/xxx → /api/serve-upload/xxx (S3回退恢复)
                      if (url.startsWith('/uploads/')) {
                        img.src = '/api/serve-upload/' + url.replace('/uploads/', '');
                      }
                      // 外部URL → 尝试 /api/serve-upload/ (通过save-image持久化过的)
                      else if (url.startsWith('http') && !url.includes('localhost')) {
                        // 从URL提取文件名
                        const filename = url.split('/').pop()?.split('?')[0];
                        if (filename) img.src = '/api/serve-upload/' + filename;
                        // ★ 同时触发异步持久化，成功后更新图片URL
                        fetch('/api/save-image', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ imageUrl: url }),
                        }).then(r => r.json()).then(data => {
                          if (data.success && data.url && typeof data.url === 'string') {
                            // 更新图片URL为本地持久化URL
                            onImagesChange(images.map((im: CanvasImage) => im.id === image.id ? { ...im, url: data.url } : im));
                          }
                        }).catch(() => {});
                      }
                      // 本地路径加载失败 → 尝试通过 getCachedLocalUrl 获取持久化后的URL
                      else if (url.startsWith('/api/serve-upload/')) {
                        const cachedLocal = getCachedLocalUrl(url);
                        if (cachedLocal !== url) {
                          img.src = cachedLocal;
                        }
                      }
                    }}
                  />
                ) : null}
                {/* Video inline playback / play button overlay */}
                {image.mediaType === 'video' && !image.isProcessingPlaceholder && (
                  playingVideoId === image.id ? (
                    /* ── Inline video playing state ── */
                    <div className="absolute inset-0 z-20 flex flex-col bg-black">
                      <video
                        ref={(el) => { inlineVideoRefs.current[image.id] = el; }}
                        src={image.videoUrl}
                        className="w-full h-full object-contain cursor-pointer"
                        autoPlay
                        playsInline
                        loop={false}
                        onTimeUpdate={() => {
                          const v = inlineVideoRefs.current[image.id];
                          if (v) setInlineVideoProgress(prev => ({ ...prev, [image.id]: v.currentTime }));
                        }}
                        onDurationChange={() => {
                          const v = inlineVideoRefs.current[image.id];
                          if (v) setInlineVideoDuration(prev => ({ ...prev, [image.id]: v.duration }));
                        }}
                        onEnded={() => setPlayingVideoId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          const v = inlineVideoRefs.current[image.id];
                          if (v) {
                            if (v.paused) { v.play(); setInlineVideoPaused(prev => ({ ...prev, [image.id]: false })); }
                            else { v.pause(); setInlineVideoPaused(prev => ({ ...prev, [image.id]: true })); }
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (image.videoUrl) {
                            setVideoPlayerUrl(image.videoUrl);
                            setVideoPlayerVisible(true);
                          }
                        }}
                      />
                      {/* Inline mini control bar */}
                      <div className={`absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1 ${isMonochrome ? 'bg-black/80' : 'bg-gradient-to-t from-black/90 via-black/60 to-transparent'}`}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const v = inlineVideoRefs.current[image.id];
                            if (v) {
                              if (v.paused) { v.play(); setInlineVideoPaused(prev => ({ ...prev, [image.id]: false })); }
                              else { v.pause(); setInlineVideoPaused(prev => ({ ...prev, [image.id]: true })); }
                            }
                          }}
                          className="shrink-0 cursor-pointer"
                        >
                          {inlineVideoPaused[image.id] ? (
                            <Play className="w-3.5 h-3.5 text-white" fill="white" />
                          ) : (
                            <Pause className="w-3.5 h-3.5 text-white" fill="white" />
                          )}
                        </button>
                        {/* Progress bar */}
                        <div
                          className="flex-1 h-1 bg-white/20 rounded-full cursor-pointer relative group/progress"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                            const v = inlineVideoRefs.current[image.id];
                            const dur = inlineVideoDuration[image.id] || 0;
                            if (v && dur > 0) { v.currentTime = ratio * dur; }
                          }}
                        >
                          <div
                            className={`h-full rounded-full transition-[width] duration-100 ${isMonochrome ? 'bg-white' : 'bg-gold'}`}
                            style={{ width: `${((inlineVideoProgress[image.id] || 0) / (inlineVideoDuration[image.id] || 1)) * 100}%` }}
                          />
                        </div>
                        {/* Time / Duration */}
                        <span className="text-[9px] text-white/70 font-mono shrink-0">
                          {Math.floor((inlineVideoProgress[image.id] || 0) / 60)}:{String(Math.floor((inlineVideoProgress[image.id] || 0) % 60)).padStart(2, '0')}/
                          {Math.floor((inlineVideoDuration[image.id] || image.videoDuration || 0) / 60)}:{String(Math.floor((inlineVideoDuration[image.id] || image.videoDuration || 0) % 60)).padStart(2, '0')}
                        </span>
                        {/* Expand to fullscreen */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (image.videoUrl) {
                              setVideoPlayerUrl(image.videoUrl);
                              setVideoPlayerVisible(true);
                            }
                          }}
                          className="shrink-0 cursor-pointer"
                        >
                          <Maximize2 className="w-3 h-3 text-white/70 hover:text-white" />
                        </button>
                        {/* Close inline playback */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const v = inlineVideoRefs.current[image.id];
                            if (v) v.pause();
                            setPlayingVideoId(null);
                          }}
                          className="shrink-0 cursor-pointer"
                        >
                          <X className="w-3 h-3 text-white/70 hover:text-white" />
                        </button>
                      </div>
                      {/* Breathing border animation */}
                      {!isMonochrome && (
                        <div className="absolute inset-0 border-2 border-gold/40 rounded-sm pointer-events-none animate-pulse" />
                      )}
                    </div>
                  ) : (
                    /* ── Static thumbnail + play button ── */
                    <div
                      className="absolute inset-0 flex items-center justify-center z-20 cursor-pointer group/play"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (image.videoUrl) {
                          setPlayingVideoId(image.id);
                          setInlineVideoPaused(prev => ({ ...prev, [image.id]: false }));
                        }
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (image.videoUrl) {
                          setVideoPlayerUrl(image.videoUrl);
                          setVideoPlayerVisible(true);
                        }
                      }}
                    >
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 ${isMonochrome ? 'bg-black/60 hover:bg-black/80' : 'bg-black/60 hover:bg-gold/90'}`}>
                        <Play className={`w-5 h-5 ml-0.5 ${isMonochrome ? 'text-white group-hover/play:text-white' : 'text-white group-hover/play:text-black'}`} fill="currentColor" />
                      </div>
                      {/* Video duration badge */}
                      {image.videoDuration && (
                        <div className={`absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono ${isMonochrome ? 'bg-black/70 text-white' : 'bg-black/70 text-white'}`}>
                          {Math.floor(image.videoDuration / 60)}:{String(Math.floor(image.videoDuration % 60)).padStart(2, '0')}
                        </div>
                      )}
                      {/* Video label */}
                      <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${isMonochrome ? 'bg-blue-500/90 text-white' : 'bg-gold/90 text-black'}`}
                        style={{ fontSize: `${Math.max(9, 10 / zoom)}px` }}>
                        VIDEO
                      </div>
                    </div>
                  )
                )}
                {/* 3D model badge - click to open 3D viewer */}
                {image.threeDModelUrl && !image.isProcessingPlaceholder && (
                  <div className="absolute top-1 left-1 z-30"
                    style={{ fontSize: `${Math.max(9, 11 / zoom)}px` }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewer3DModelUrl(image.threeDModelUrl || '');
                        setViewer3DPreviewUrl(image.url);
                        setViewer3DModelUrls(image.threeDModelUrls || {});
                        setViewer3DThumbnailUrls(image.threeDThumbnailUrls || {});
                        setViewer3DTextureUrls(image.threeDTextureUrls || []);
                        setViewer3DModelInfo(image.threeDModelInfo || {});
                        setShow3DViewer(true);
                      }}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-bold shadow-lg transition-colors cursor-pointer ${isMonochrome ? 'bg-blue-500/90 text-white hover:bg-blue-500' : 'bg-gold/90 text-black hover:bg-gold'}`}
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1L14.5 5V11L8 15L1.5 11V5L8 1Z M8 1V8 M1.5 5L8 8L14.5 5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      </svg>
                      3D
                    </button>
                  </div>
                )}
                {/* Selection border */}
                {isSelected && editMode === 'none' && (
                  <div className="absolute inset-0 border-2 border-gold rounded-sm pointer-events-none">
                    {['tl', 'tr', 'bl', 'br'].map(corner => (
                      <div
                        key={corner}
                        className={`absolute w-2.5 h-2.5 rounded-sm pointer-events-auto cursor-${
                          corner === 'tl' ? 'nwse-resize' : corner === 'tr' ? 'nesw-resize' : corner === 'bl' ? 'nesw-resize' : 'nwse-resize'
                        } ${isMonochrome ? 'bg-blue-500' : 'bg-gold'}`}
                        style={{
                          [corner.includes('t') ? 'top' : 'bottom']: '-5px',
                          [corner.includes('l') ? 'left' : 'right']: '-5px',
                        }}
                      />
                    ))}
                  </div>
                )}
                {/* Alt+Click reference marker badge */}
                {altRefMarkerIds.includes(image.id) && !image.isProcessingPlaceholder && (() => {
                  const markerIdx = altRefMarkerIds.indexOf(image.id);
                  return (
                    <div className="absolute bottom-1 right-1 z-30 pointer-events-none"
                      style={{ fontSize: `${Math.max(10, 12 / zoom)}px` }}>
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#6366f1] text-white text-xs font-bold shadow-lg ring-2 ring-white/30">
                        R{markerIdx + 1}
                      </span>
                    </div>
                  );
                })()}
                {/* Ctrl+Click reference number badge */}
                {referenceIds.includes(image.id) && (() => {
                  const refIdx = referenceIds.indexOf(image.id);
                  return (
                    <div className="absolute top-1 left-1 z-30 pointer-events-none"
                      style={{ fontSize: `${Math.max(10, 12 / zoom)}px` }}>
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shadow-lg ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'}`}>
                        {refIdx + 1}
                      </span>
                    </div>
                  );
                })()}
                {/* Oh My Prompt - Vision hover sparkles button */}
                {visionPromptEnabled && visionHoverImage?.id === image.id && editMode === 'none' && !isVisionAnalyzing && (
                  <button
                    className={`absolute top-2 right-2 z-40 p-1.5 rounded-lg transition-all shadow-lg hover:scale-110 ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c249]'}`}
                    style={{ fontSize: `${Math.max(11, 13 / zoom)}px` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVisionPrompt?.(image.url);
                      setVisionHoverImage(null);
                    }}
                    title="生成双语提示词"
                  >
                    <Sparkles className={`h-4 w-4 ${mIcon.generator}`} />
                  </button>
                )}
                {/* Oh My Prompt - Analyzing indicator */}
                {visionPromptEnabled && visionHoverImage?.id === image.id && isVisionAnalyzing && (
                  <div
                    className={`absolute top-2 right-2 z-40 p-1.5 rounded-lg animate-pulse ${isMonochrome ? 'bg-blue-500/80 text-white' : 'bg-gold/80 text-black'}`}
                    style={{ fontSize: `${Math.max(11, 13 / zoom)}px` }}
                  >
                    <Sparkles className="h-4 w-4 animate-spin" />
                  </div>
                )}
                {/* Hover toolbar - quick actions on image hover */}
                {hoverToolbarImageId === image.id && editMode === 'none' && !dragTarget && !resizingImage && !compareSelecting && (
                  <div
                    className="absolute -top-9 left-1/2 -translate-x-1/2 z-50 flex items-center gap-0.5 px-1 py-0.5 rounded-lg shadow-lg"
                    style={{ fontSize: `${Math.max(10, 12 / zoom)}px` }}
                    onMouseEnter={() => keepHoverToolbar(image.id)}
                    onMouseLeave={() => hideHoverToolbar()}
                  >
                    <button
                      className={`p-1 rounded transition-colors ${isMonochrome ? 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200' : 'bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white/80 border border-white/10'}`}
                      onClick={(e) => { e.stopPropagation(); selectImage(image.id); onEditImage?.(image); hideHoverToolbar(); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      title="语言修图"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className={`p-1 rounded transition-colors ${isMonochrome ? 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200' : 'bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white/80 border border-white/10'}`}
                      onClick={(e) => { e.stopPropagation(); setCompareImages({ left: image, right: null }); setCompareSelecting(true); hideHoverToolbar(); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      title="图片对比"
                    >
                      <Contrast className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className={`p-1 rounded transition-colors ${isMonochrome ? 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200' : 'bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white/80 border border-white/10'}`}
                      onClick={(e) => { e.stopPropagation(); handleOpenDownload(); hideHoverToolbar(); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      title="下载"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className={`p-1 rounded transition-colors ${isMonochrome ? 'bg-white hover:bg-red-50 text-red-500 border border-gray-200' : 'bg-[#1a1a1a] hover:bg-red-900/30 text-white/80 hover:text-red-400 border border-white/10'}`}
                      onClick={(e) => { e.stopPropagation(); onImagesChange(images.filter(i => i.id !== image.id)); hideHoverToolbar(); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {/* Model & API info badge (bottom-left) */}
                {(() => {
                  // 3D模型优先使用3D提供商信息
                  const is3DImage = !!image.threeDModelInfo;
                  const displayModelName = is3DImage
                    ? (image.threeDModelInfo?.model3DName || image.modelName || '')
                    : (image.modelName || '');
                  const rawApiProvider = is3DImage
                    ? (image.threeDModelInfo?.providerName || image.apiProvider || '')
                    : (image.apiProvider || '');
                  const displayApiProvider = (() => {
                    // 1. 优先使用 apiProvider 直接值（后端返回的提供商名称）
                    if (rawApiProvider) {
                      // 如果 apiProvider 本身是 providerId（如 api_xxx），尝试从 map 查找友好名称
                      const mapped = modelProviderMap.get(rawApiProvider);
                      return mapped || rawApiProvider;
                    }
                    // 2. 如果图片有 modelName，尝试匹配复合键
                    const imgModel = image.model || '';
                    const imgModelName = image.modelName || '';
                    if (imgModel) {
                      // 遍历所有已知的复合键，查找 modelId 匹配的
                      for (const [key, name] of modelProviderMap.entries()) {
                        if (key.includes('::') && key.endsWith(`::${imgModel}`)) return name;
                      }
                      // 回退到纯 modelId 映射
                      const pureModelMatch = modelProviderMap.get(imgModel);
                      if (pureModelMatch) return pureModelMatch;
                    }
                    // 3. 最后尝试 modelName 映射
                    if (imgModelName) {
                      const nameMatch = modelProviderMap.get(imgModelName);
                      if (nameMatch) return nameMatch;
                    }
                    return '';
                  })();
                  return (displayModelName || displayApiProvider) && !image.isProcessingPlaceholder ? (
                  <div className="absolute bottom-1 left-1 z-20 pointer-events-none flex flex-col gap-0.5"
                    style={{ fontSize: `${Math.max(8, 9 / zoom)}px` }}>
                    {displayModelName && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap leading-tight ${
                        isMonochrome ? 'bg-black/60 text-white/90' : 'bg-black/70 text-white/90'
                      }`}>
                        {displayModelName}
                      </span>
                    )}
                    {displayApiProvider && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-normal whitespace-nowrap leading-tight ${
                        isMonochrome ? 'bg-black/50 text-blue-300/80' : 'bg-black/60 text-gold/70'
                      }`}>
                        {displayApiProvider}
                      </span>
                    )}
                  </div>
                ) : null;
                })()}
                {/* Image dimensions indicator (bottom-right, show on hover) */}
                <div className="absolute bottom-1 right-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
                  style={{ fontSize: `${Math.max(9, 10 / zoom)}px` }}>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-mono whitespace-nowrap ${
                    isMonochrome ? 'bg-black/60 text-white/90' : 'bg-black/70 text-white/90'
                  }`}>
                    {image.originalWidth || image.width} × {image.originalHeight || image.height}
                  </span>
                </div>
                {/* Edit mode stroke overlay - moved to floating window */}
              </div>
            );
          })}
          {/* 自动连线：原图→变体/编辑/图生图 关系 */}
          {showConnections && !anyPanelOpen && canvasConnections.length > 0 && (() => {
            return (
              <svg style={{ position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', overflow: 'visible', pointerEvents: 'none' }}>
                <defs>
                  <filter id="conn-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                {canvasConnections.map(conn => {
                  const fromImg = images.find(i => i.id === conn.fromId);
                  const toImg = images.find(i => i.id === conn.toId);
                  if (!fromImg || !toImg) return null;
                  const { fromX, fromY, toX, toY } = computeConnectionEndpoints(fromImg, toImg);
                  const path = buildConnectionPath(fromX, fromY, toX, toY);
                  const arrow = buildArrowHead(toX, toY, fromX, fromY, 6);
                  const color = conn.color || '#d4af37';
                  const dashArray = conn.dashArray;
                  // Type icon from config
                  const typeConfig = RELATION_TYPE_CONFIG[conn.relationType];
                  void typeConfig;
                  const midX = (fromX + toX) / 2;
                  const midY = (fromY + toY) / 2;
                  return (
                    <g key={conn.id}>
                      {/* Glow background for visibility */}
                      <path d={path} fill="none" stroke={color} strokeWidth={4} opacity={0.15} />
                      {/* Main line */}
                      <path d={path} fill="none" stroke={color} strokeWidth={1.5} opacity={0.6}
                        strokeDasharray={dashArray} />
                      {/* Arrow head */}
                      <path d={arrow} fill={color} opacity={0.6} />
                      {/* Label background pill */}
                      <rect
                        x={midX - (conn.label.length * 4.5 + 12)} y={midY - 10}
                        width={conn.label.length * 9 + 24} height={20}
                        rx={10} fill="black" opacity={0.6}
                      />
                      {/* Label text */}
                      <text x={midX} y={midY + 4} textAnchor="middle" fontSize={10} fontWeight={500}
                        fill={color} opacity={0.9}>{conn.label}</text>
                    </g>
                  );
                })}
              </svg>
            );
          })()}

          {/* Processing frame connection lines - elegant animated lines from source images to processing frames */}
          {(() => {
            const processingFrames = images.filter(img => img.isProcessingPlaceholder && img.processing?.sourceUrl);
            if (processingFrames.length === 0) return null;
            const gold = isMonochrome ? '#3b82f6' : '#d4af37';
            return (
              <svg style={{ position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', overflow: 'visible', pointerEvents: 'none' }}>
                <defs>
                  {processingFrames.map(frame => {
                    const sourceImage = images.find(img => img.url === frame.processing!.sourceUrl && !img.isProcessingPlaceholder);
                    if (!sourceImage) return null;
                    const sx = sourceImage.x + sourceImage.width / 2;
                    const sy = sourceImage.y + sourceImage.height / 2;
                    const tx = frame.x + frame.width / 2;
                    const ty = frame.y + frame.height / 2;
                    const dx = tx - sx;
                    const dy = ty - sy;
                    Math.sqrt(dx * dx + dy * dy);
                    return (
                      <g key={`proc-defs-${frame.id}`}>
                        {/* Gradient along the connection */}
                        <linearGradient id={`proc-grad-${frame.id}`} gradientUnits="userSpaceOnUse" x1={sx} y1={sy} x2={tx} y2={ty}>
                          <stop offset="0%" stopColor={gold} stopOpacity="0.6" />
                          <stop offset="50%" stopColor={gold} stopOpacity="0.3" />
                          <stop offset="100%" stopColor={gold} stopOpacity="0.8" />
                        </linearGradient>
                        {/* Glow filter */}
                        <filter id={`proc-glow-${frame.id}`} x="-50%" y="-50%" width="200%" height="200%">
                          <feGaussianBlur in="SourceGraphic" stdDeviation={3 / zoom} />
                        </filter>
                      </g>
                    );
                  })}
                </defs>
                {processingFrames.map(frame => {
                  const sourceImage = images.find(img => img.url === frame.processing!.sourceUrl && !img.isProcessingPlaceholder);
                  if (!sourceImage) return null;
                  const sx = sourceImage.x + sourceImage.width / 2;
                  const sy = sourceImage.y + sourceImage.height / 2;
                  const tx = frame.x + frame.width / 2;
                  const ty = frame.y + frame.height / 2;
                  const dx = tx - sx;
                  const dy = ty - sy;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  // Source anchor point (right edge center)
                  const srcAnchorX = sourceImage.x + sourceImage.width;
                  const srcAnchorY = sourceImage.y + sourceImage.height / 2;
                  // Target anchor point (left edge center)
                  const tgtAnchorX = frame.x;
                  const tgtAnchorY = frame.y + frame.height / 2;
                  // Control points for smooth S-curve
                  const cpOffset = Math.min(Math.max(dist * 0.4, 60 / zoom), 300 / zoom);
                  const cp1x = srcAnchorX + cpOffset;
                  const cp1y = srcAnchorY;
                  const cp2x = tgtAnchorX - cpOffset;
                  const cp2y = tgtAnchorY;
                  const pathD = `M ${srcAnchorX} ${srcAnchorY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tgtAnchorX} ${tgtAnchorY}`;
                  return (
                    <g key={`proc-conn-${frame.id}`}>
                      {/* Wide background glow */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={gold}
                        strokeWidth={12 / zoom}
                        strokeLinecap="round"
                        opacity={0.06}
                      />
                      {/* Medium soft glow */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={gold}
                        strokeWidth={6 / zoom}
                        strokeLinecap="round"
                        opacity={0.1}
                        filter={`url(#proc-glow-${frame.id})`}
                      />
                      {/* Main dashed line with gradient */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={`url(#proc-grad-${frame.id})`}
                        strokeWidth={1.5 / zoom}
                        strokeLinecap="round"
                        strokeDasharray={`${8 / zoom} ${5 / zoom}`}
                      />
                      {/* Flowing dot animation overlay */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={gold}
                        strokeWidth={2.5 / zoom}
                        strokeLinecap="round"
                        strokeDasharray={`${3 / zoom} ${18 / zoom}`}
                        opacity={0.7}
                      >
                        <animate attributeName="stroke-dashoffset" from="0" to={`${-21 / zoom}`} dur="1.2s" repeatCount="indefinite" />
                      </path>
                      {/* Source anchor dot */}
                      <circle cx={srcAnchorX} cy={srcAnchorY} r={3.5 / zoom} fill={gold} opacity={0.5} />
                      <circle cx={srcAnchorX} cy={srcAnchorY} r={2 / zoom} fill={gold} opacity={0.9} />
                      {/* Target anchor dot with pulse */}
                      <circle cx={tgtAnchorX} cy={tgtAnchorY} r={6 / zoom} fill={gold} opacity={0.1}>
                        <animate attributeName="r" values={`${4 / zoom};${8 / zoom};${4 / zoom}`} dur="2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.15;0.05;0.15" dur="2s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={tgtAnchorX} cy={tgtAnchorY} r={3.5 / zoom} fill={gold} opacity={0.5} />
                      <circle cx={tgtAnchorX} cy={tgtAnchorY} r={2 / zoom} fill={gold} opacity={0.9} />
                      {/* Direction arrow near midpoint */}
                      {(() => {
                        const t = 0.55;
                        const mt = 1 - t;
                        const mx = mt*mt*mt*srcAnchorX + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*tgtAnchorX;
                        const my = mt*mt*mt*srcAnchorY + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*tgtAnchorY;
                        const dt = 0.01;
                        const mt2 = 1 - (t + dt);
                        const nx = mt2*mt2*mt2*srcAnchorX + 3*mt2*mt2*(t+dt)*cp1x + 3*mt2*(t+dt)*(t+dt)*cp2x + (t+dt)*(t+dt)*(t+dt)*tgtAnchorX;
                        const ny = mt2*mt2*mt2*srcAnchorY + 3*mt2*mt2*(t+dt)*cp1y + 3*mt2*(t+dt)*(t+dt)*cp2y + (t+dt)*(t+dt)*(t+dt)*tgtAnchorY;
                        const angle = Math.atan2(ny - my, nx - mx) * 180 / Math.PI;
                        const arrowSize = 5 / zoom;
                        return (
                          <g transform={`translate(${mx}, ${my}) rotate(${angle})`}>
                            <path d={`M ${-arrowSize} ${-arrowSize * 0.6} L 0 0 L ${-arrowSize} ${arrowSize * 0.6}`} fill="none" stroke={gold} strokeWidth={1.2 / zoom} strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
                          </g>
                        );
                      })()}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
          {/* Auto connection lines - typed relations between images */}
          {showConnections && !anyPanelOpen && (() => {
            // Merge connections from prop (new typed system) with generatedFromImageId (legacy)
            const allConns: Array<{ sourceId: string; targetId: string; relationType: ConnectionRelationType }> = [
              ...canvasConnections.map(c => ({ sourceId: c.fromId, targetId: c.toId, relationType: c.relationType })),
              // Legacy: generatedFromImageId → 'variant' relation
              ...images
                .filter(img => img.generatedFromImageId && !img.isProcessingPlaceholder && !canvasConnections.some(c => c.toId === img.id))
                .map(img => ({ sourceId: img.generatedFromImageId!, targetId: img.id, relationType: 'variant' as ConnectionRelationType })),
            ];
            if (allConns.length === 0) return null;
            return (
              <svg style={{ position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', overflow: 'visible', pointerEvents: 'none' }}>
                {allConns.map(conn => {
                  const sourceImg = images.find(img => img.id === conn.sourceId);
                  const targetImg = images.find(img => img.id === conn.targetId);
                  if (!sourceImg || !targetImg || sourceImg.isProcessingPlaceholder || targetImg.isProcessingPlaceholder) return null;
                  const config = RELATION_TYPE_CONFIG[conn.relationType] || RELATION_TYPE_CONFIG.variant;
                  // Source anchor: right edge center
                  const srcX = sourceImg.x + sourceImg.width;
                  const srcY = sourceImg.y + sourceImg.height / 2;
                  // Target anchor: left edge center
                  const tgtX = targetImg.x;
                  const tgtY = targetImg.y + targetImg.height / 2;
                  const dx = tgtX - srcX;
                  const dy = tgtY - srcY;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  const cpOffset = Math.min(Math.max(dist * 0.4, 40 / zoom), 200 / zoom);
                  const cp1x = srcX + cpOffset;
                  const cp1y = srcY;
                  const cp2x = tgtX - cpOffset;
                  const cp2y = tgtY;
                  const pathD = `M ${srcX} ${srcY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tgtX} ${tgtY}`;
                  const lineColor = isMonochrome ? config.colorMono : config.color;
                  return (
                    <g key={`auto-conn-${conn.sourceId}-${conn.targetId}-${conn.relationType}`}>
                      {/* Subtle glow */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={lineColor}
                        strokeWidth={4 / zoom}
                        strokeLinecap="round"
                        opacity={0.08}
                      />
                      {/* Main line */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={lineColor}
                        strokeWidth={1.2 / zoom}
                        strokeLinecap="round"
                        strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                        opacity={0.5}
                      />
                      {/* Source dot */}
                      <circle cx={srcX} cy={srcY} r={2.5 / zoom} fill={lineColor} opacity={0.7} />
                      {/* Target dot */}
                      <circle cx={tgtX} cy={tgtY} r={2.5 / zoom} fill={lineColor} opacity={0.7} />
                      {/* Relation type label */}
                      {dist > 100 / zoom && (
                        <text
                          x={(srcX + tgtX) / 2}
                          y={(srcY + tgtY) / 2 - 8 / zoom}
                          textAnchor="middle"
                          fontSize={10 / zoom}
                          fill={lineColor}
                          opacity={0.7}
                          style={{ fontFamily: 'system-ui, sans-serif' }}
                        >
                          {config.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
          {/* Reference Fusion Visualization - inside transform container for correct coordinate system */}
          {showRefFusion && referenceIds.length > 0 && (() => {
            const refImages = referenceIds
              .map((id, idx) => {
                const img = images.find(i => i.id === id);
                return img ? { ...img, refNumber: idx + 1 } : null;
              })
              .filter(Boolean) as (CanvasImage & { refNumber: number })[];

            if (refImages.length === 0) return null;

            // Calculate output frame position - to the right of the last reference image
            const lastRef = refImages[refImages.length - 1];
            const outputFrameWidth = 320;
            const outputFrameHeight = 320;
            const gapX = 80;
            const outputX = lastRef.x + lastRef.width + gapX;
            const outputY = refImages[0].y;

            return (
              <>
                {/* SVG connection lines - using raw canvas coordinates (parent transform handles zoom/pan) */}
                <svg
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '1px',
                    height: '1px',
                    overflow: 'visible',
                    pointerEvents: 'none',
                    zIndex: 25,
                  }}
                >
                  {refImages.map((img) => {
                    // Source point: right edge center of reference image
                    const srcX = img.x + img.width;
                    const srcY = img.y + img.height / 2;
                    // Target point: left edge center of output frame
                    const tgtX = outputX;
                    const tgtY = outputY + outputFrameHeight / 2;
                    const midX = (srcX + tgtX) / 2;

                    return (
                      <g key={`fusion-line-${img.id}`}>
                        <path
                          d={`M ${srcX} ${srcY} C ${midX} ${srcY}, ${midX} ${tgtY}, ${tgtX} ${tgtY}`}
                          fill="none"
                          stroke="#d4af37"
                          strokeWidth={2 / zoom}
                          strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                          opacity={0.7}
                        />
                        {/* Source connection dot */}
                        <circle cx={srcX} cy={srcY} r={3.5 / zoom} fill="#d4af37" opacity={0.8} />
                        {/* Target connection dot */}
                        <circle cx={tgtX} cy={tgtY} r={3.5 / zoom} fill="#d4af37" opacity={0.8} />
                      </g>
                    );
                  })}
                </svg>

                {/* Output frame (blank image placeholder) */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: outputX,
                    top: outputY,
                    width: outputFrameWidth,
                    height: outputFrameHeight,
                    zIndex: 25,
                  }}
                >
                  <div className="w-full h-full border-2 border-dashed border-gold/50 rounded-lg flex flex-col items-center justify-center gap-2"
                    style={{
                      background: 'rgba(212,175,55,0.05)',
                    }}>
                    <div className="w-4 h-4 rotate-45 border border-gold/30" style={{ margin: '4px' }} />
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-blue-500/60' : 'text-gold/60'}`}>
                      融合输出
                    </span>
                    <span className={`text-xs ${isMonochrome ? 'text-blue-500/40' : 'text-gold/40'}`}>
                      {refImages.map(r => `#${r.refNumber}`).join(' + ')} →
                    </span>
                  </div>
                </div>
              </>
            );
          })()}

          {/* ====== Generation Groups (Alt/Ctrl reference groups) ====== */}
          {genGroups.length > 0 && genGroups.map(group => {
            const srcImages = group.sourceImageIds
              .map((id, idx) => {
                const img = images.find(i => i.id === id);
                return img ? { ...img, refNumber: idx + 1 } : null;
              })
              .filter(Boolean) as (CanvasImage & { refNumber: number })[];

            if (srcImages.length === 0) return null;

            // Accent colors
            const isRef = group.type === 'reference';
            const accentColor = isRef ? '#d4af37' : '#4ecdc4';
            const accentBg = isRef ? 'rgba(212,175,55,0.06)' : 'rgba(78,205,196,0.06)';
            const accentBgStrong = isRef ? 'rgba(212,175,55,0.12)' : 'rgba(78,205,196,0.12)';
            const accentBorder = isRef ? 'rgba(212,175,55,0.35)' : 'rgba(78,205,196,0.35)';
            const accentBorderStrong = isRef ? 'rgba(212,175,55,0.6)' : 'rgba(78,205,196,0.6)';

            // Drag offset for this group
            const isThisGroupDragging = genGroupDragTarget === group.id;
            const isHoveredForDrop = hoveredGenGroupId === group.id;
            const dragDx = isThisGroupDragging ? genGroupDragOffset.x : 0;
            const dragDy = isThisGroupDragging ? genGroupDragOffset.y : 0;

            // Dynamically calculate result size from toolbar aspect ratio and actual pixel size
            const arParts = group.toolbar.aspectRatio.split(':').map(Number);
            const arW = arParts[0] || 1;
            const arH = arParts[1] || 1;
            // Use actual pixel size from toolbar to determine display scale
            const sizeStr = group.toolbar.size || calculateActualPixels(group.toolbar.aspectRatio, group.toolbar.quality, group.toolbar.model);
            const sizeParts = sizeStr.replace(/×/g, 'x').split('x').map(Number);
            const pixelW = sizeParts[0] || 1024;
            const pixelH = sizeParts[1] || 1024;
            const maxPixel = Math.max(pixelW, pixelH);
            // Scale: 512px→200, 1024px→300, 1536px→350, 1792px→400, 2048px→420, 3840px→500
            let displayBase: number;
            if (maxPixel <= 512) displayBase = 200;
            else if (maxPixel <= 1024) displayBase = 300;
            else if (maxPixel <= 1536) displayBase = 350;
            else if (maxPixel <= 1792) displayBase = 400;
            else if (maxPixel <= 2048) displayBase = 420;
            else displayBase = 500;
            // Also consider source image sizes to ensure placeholder isn't too small
            const srcMaxDim = srcImages.length > 0 ? Math.max(...srcImages.map(img => Math.max(img.width, img.height))) : 0;
            const baseSize = Math.max(displayBase, srcMaxDim, 300);
            const resultW = arW >= arH ? baseSize : Math.round(baseSize * (arW / arH));
            const resultH = arH >= arW ? baseSize : Math.round(baseSize * (arH / arW));
            // 使用存储的组位置，而非动态计算（避免源图片移动时整个组跟着移动）
            const srcBounds = srcImages.map(img => ({ x: img.x + dragDx, y: img.y + dragDy, w: img.width, h: img.height }));
            // 结果框位置：优先使用存储的位置，避免跟随源图片移动
            const resultX = (group.position.resultX || 0) + dragDx;
            const resultY = (group.position.resultY || 0) + dragDy;

            // Container bounds: include all source images + result placeholder + toolbar (apply drag offset)
            const resultFrameW = Math.max(resultW, 420);
            const hasResult = !!group.resultPlaceholder.resultUrl;
            const toolbarH = hasResult ? 0 : 350; // toolbar hidden when result exists
            const allBounds = [
              ...srcBounds,
              { x: resultX, y: resultY, w: resultFrameW, h: resultH + toolbarH }
            ];
            const containerPad = 24;
            const bottomPad = isRef ? 142 : containerPad;
            const containerMinX = Math.min(...allBounds.map(b => b.x)) - containerPad;
            const containerMinY = Math.min(...allBounds.map(b => b.y)) - containerPad - 40;
            const containerMaxX = Math.max(...allBounds.map(b => b.x + b.w)) + containerPad;
            const containerMaxY = Math.max(...allBounds.map(b => b.y + b.h)) + bottomPad;
            const containerW = containerMaxX - containerMinX;
            const containerH = containerMaxY - containerMinY;

            // Find current model display name
            const currentModelObj = canvasGenModels.find(m => m.id === group.toolbar.model && m.providerId === (group.toolbar.providerId || ''));
            const modelDisplayName = currentModelObj ? `${currentModelObj.apiDisplayName || getModelDisplayName(currentModelObj.id)} · 来自 ${currentModelObj.providerName}` : (group.toolbar.model ? getModelDisplayName(group.toolbar.model) : '选择模型');

            return (
              <div key={`gen-group-${group.id}`}>
                {/* Container frame — visible border around the entire group */}
                <div
                  className="absolute pointer-events-none rounded-2xl"
                  style={{
                    left: containerMinX,
                    top: containerMinY,
                    width: containerW,
                    height: group.isCollapsed ? 40 : containerH,
                    background: isHoveredForDrop ? (isRef ? 'rgba(212,175,55,0.12)' : 'rgba(78,205,196,0.12)') : accentBg,
                    border: `2px solid ${isThisGroupDragging ? accentColor : isHoveredForDrop ? accentColor : accentBorder}`,
                    zIndex: 12,
                    overflow: (group.isCollapsed || openModelDropdownGroupId !== group.id) ? 'hidden' : 'visible',
                    transition: isThisGroupDragging ? 'none' : 'height 0.3s ease, border-color 0.2s, background 0.2s',
                    boxShadow: isHoveredForDrop ? `0 0 20px ${accentColor}40` : 'none',
                  }}
                >
                  {/* Title bar — draggable + collapse/close */}
                  <div
                    className="flex items-center justify-between px-4 py-1.5 rounded-t-2xl pointer-events-auto select-none"
                    style={{ background: accentBgStrong, borderBottom: group.isCollapsed ? 'none' : `1px solid ${accentBorder}` }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      if ((e.target as HTMLElement).closest('button')) return;
                      e.stopPropagation();
                      e.preventDefault();
                      setGenGroupDragTarget(group.id);
                      const canvasPos = screenToCanvas(e.clientX, e.clientY);
                      setGenGroupDragStart(canvasPos);
                      setGenGroupDragOffset({ x: 0, y: 0 });
                      genGroupDragReadyRef.current = false;
                      genGroupDragTimerRef.current = setTimeout(() => {
                        genGroupDragReadyRef.current = true;
                      }, 200);
                    }}
                    onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  >
                    <div className="flex items-center gap-2 cursor-grab active:cursor-grabbing">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: accentColor }} />
                      <span className="text-sm font-semibold" style={{ color: accentColor }}>
                        {isRef ? '参考图组' : '融图组'}
                      </span>
                      <span className="text-xs font-medium" style={{ color: `${accentColor}88` }}>
                        {srcImages.length} 张参考图
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, isCollapsed: !g.isCollapsed } : g
                          ));
                        }}
                        title={group.isCollapsed ? '展开' : '折叠'}
                      >
                        <svg className="w-4 h-4 transition-transform" style={{ color: accentColor, transform: group.isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      <button
                        className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/20 transition-colors"
                        onClick={(e) => { e.stopPropagation(); deleteGenGroup(group.id); }}
                        title="关闭组"
                      >
                        <svg className="w-3.5 h-3.5" style={{ color: '#ef4444' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Content (hidden when collapsed) */}
                  {!group.isCollapsed && (
                <div className="contents">
                {/* SVG connection lines */}
                <svg
                  style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 15, overflow: 'visible' }}
                >
                  <g transform={`translate(${-containerMinX}, ${-containerMinY})`}>
                  {srcImages.map(img => {
                    // Source point: right edge center of source image
                    const srcX = img.x + img.width + dragDx;
                    const srcY = img.y + img.height / 2 + dragDy;
                    // Target point: left edge center of result frame
                    const tgtX = resultX;
                    const tgtY = resultY + resultH / 2;
                    const midX = (srcX + tgtX) / 2;

                    return (
                      <g key={`gen-line-${img.id}`}>
                        {/* Animated dashed line */}
                        <path
                          d={`M ${srcX} ${srcY} C ${midX} ${srcY}, ${midX} ${tgtY}, ${tgtX} ${tgtY}`}
                          fill="none"
                          stroke={accentColor}
                          strokeWidth={2.5 / zoom}
                          strokeDasharray={`${8 / zoom} ${5 / zoom}`}
                          opacity={0.6}
                        >
                          <animate attributeName="stroke-dashoffset" from="0" to={`${-26 / zoom}`} dur="2s" repeatCount="indefinite" />
                        </path>
                        {/* Source connection dot (right edge of source image) */}
                        <circle cx={srcX} cy={srcY} r={4 / zoom} fill={accentColor} opacity={0.8} />
                        {/* Target connection dot (left edge of result frame) */}
                        <circle cx={tgtX} cy={tgtY} r={4 / zoom} fill={accentColor} opacity={0.8} />
                      </g>
                    );
                  })}
                  </g>
                </svg>

                {/* Source image labels (R1, R2, ...) with bottom category tags */}
                {srcImages.map(img => {
                  const imgCats = isRef ? (group.sourceCategories[img.id] || []) : [];
                  return (
                  <div
                    key={`ref-label-${img.id}`}
                    className="absolute flex flex-col"
                    style={{
                      left: img.x + dragDx - containerMinX,
                      top: img.y + dragDy - containerMinY,
                      zIndex: 26,
                    }}
                  >
                    {/* Image area - label overlay */}
                    <div className="relative" style={{ width: img.width, height: img.height }}>
                      {/* Label badge at top-left of image */}
                      <div
                        className="absolute top-0 left-0 flex items-center gap-1.5 px-2 py-1 rounded-lg pointer-events-auto"
                        style={{
                          background: isRef ? 'rgba(212,175,55,0.9)' : 'rgba(78,205,196,0.9)',
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs font-bold text-black">
                          R{img.refNumber}
                        </span>
                        <button
                          className="w-4 h-4 flex items-center justify-center rounded-full text-black/60 hover:text-black hover:bg-black/10 transition-colors text-xs font-bold"
                          onClick={(e) => { e.stopPropagation(); removeRefFromGroup(group.id, img.id); }}
                          title="移除此参考图"
                        >
                          x
                        </button>
                      </div>
                    </div>
                    {/* Per-image category sliders (reference group only) - BELOW image */}
                    {isRef && (
                      <div
                        className="pointer-events-auto mt-1 rounded-md overflow-hidden"
                        style={{
                          background: isMonochrome ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.35)',
                          border: isMonochrome ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.12)',
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onWheel={(e) => e.stopPropagation()}
                      >
                        {REFERENCE_CATEGORIES.map((cat, idx) => {
                          const isSelected = imgCats.includes(cat);
                          const strength = group.sourceStrengths[img.id]?.[cat] ?? 0;
                          return (
                            <div
                              key={cat}
                              className="flex items-center gap-1.5 px-2"
                              style={{
                                height: '22px',
                                borderBottom: idx < REFERENCE_CATEGORIES.length - 1
                                  ? isMonochrome ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.05)'
                                  : 'none',
                              }}
                            >
                              <span
                                className="flex-shrink-0 w-8 text-[11px] font-medium select-none cursor-pointer transition-colors"
                                style={{
                                  color: isSelected
                                    ? accentColor
                                    : isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setGenGroups(prev => prev.map(g => {
                                    if (g.id !== group.id) return g;
                                    const newCats = { ...g.sourceCategories };
                                    const newStr = { ...g.sourceStrengths };
                                    const cats = [...(newCats[img.id] || [])];
                                    const str = { ...(newStr[img.id] || {}) };
                                    if (isSelected) {
                                      const ci = cats.indexOf(cat);
                                      if (ci >= 0) cats.splice(ci, 1);
                                    } else {
                                      if (!cats.includes(cat)) cats.push(cat);
                                      if (!str[cat]) str[cat] = 0;
                                    }
                                    newCats[img.id] = cats;
                                    newStr[img.id] = str;
                                    return { ...g, sourceCategories: newCats, sourceStrengths: newStr };
                                  }));
                                }}
                              >
                                {REFERENCE_CATEGORY_LABELS[cat]}
                              </span>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={strength}
                                className="flex-1 h-[3px] appearance-none rounded-full cursor-pointer"
                                style={{
                                  accentColor,
                                  background: `linear-gradient(to right, ${isSelected ? accentColor : isMonochrome ? '#ccc' : '#555'} ${strength}%, ${isMonochrome ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'} ${strength}%)`,
                                  opacity: isSelected ? 1 : 0.35,
                                  transition: 'opacity 0.15s',
                                }}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setGenGroups(prev => prev.map(g => {
                                    if (g.id !== group.id) return g;
                                    const newStr = { ...g.sourceStrengths };
                                    newStr[img.id] = { ...(newStr[img.id] || {}), [cat]: val };
                                    const newCats = { ...g.sourceCategories };
                                    const cats = [...(newCats[img.id] || [])];
                                    if (!cats.includes(cat)) cats.push(cat);
                                    newCats[img.id] = cats;
                                    return { ...g, sourceCategories: newCats, sourceStrengths: newStr };
                                  }));
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span
                                className="flex-shrink-0 w-6 text-right text-[11px] font-semibold tabular-nums"
                                style={{
                                  color: isSelected
                                    ? accentColor
                                    : isMonochrome ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.2)',
                                }}
                              >
                                {strength}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

                {/* Result placeholder frame + Toolbar */}
                <div
                  className="absolute pointer-events-auto"
                  style={{
                    left: resultX - containerMinX,
                    top: resultY - containerMinY,
                    width: resultFrameW,
                    zIndex: 25,
                  }}
                >
                  {/* Image area */}
                  <div
                    className={`w-full rounded-xl flex flex-col items-center justify-center gap-3 overflow-hidden relative ${group.resultPlaceholder.resultUrl ? '' : ''}`}
                    style={{
                      height: resultH,
                      border: group.resultPlaceholder.resultUrl
                        ? `2px solid ${accentColor}60`
                        : `2px dashed ${accentBorderStrong}`,
                      background: group.resultPlaceholder.resultUrl ? 'transparent' : accentBg,
                    }}
                  >
                    {/* 'new' tag when result exists */}
                    {group.resultPlaceholder.resultUrl && (
                      <div
                        className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-xs font-bold z-10"
                        style={{ background: accentColor, color: '#000' }}
                      >
                        NEW
                      </div>
                    )}
                    {group.resultPlaceholder.isProcessing ? (
                      <>
                        <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin"
                          style={{ borderColor: accentColor, borderTopColor: 'transparent', borderWidth: '3px' }} />
                        <span className="text-sm font-semibold" style={{ color: accentColor }}>
                          生成中 {group.resultPlaceholder.progress ? `${Math.round(group.resultPlaceholder.progress)}%` : '0%'}
                        </span>
                        {group.resultPlaceholder.startedAt && (
                          <span className="text-xs" style={{ color: `${accentColor}88` }}>
                            {(() => {
                              void genGroupTick; // trigger re-render
                              const elapsed = Math.floor((Date.now() - group.resultPlaceholder.startedAt!) / 1000);
                              const min = Math.floor(elapsed / 60);
                              const sec = elapsed % 60;
                              return min > 0 ? `${min}分${sec}秒` : `${sec}秒`;
                            })()}
                          </span>
                        )}
                        {/* Progress bar */}
                        <div className="w-3/4 h-1.5 rounded-full overflow-hidden" style={{ background: `${accentColor}22` }}>
                          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${group.resultPlaceholder.progress || 0}%`, background: accentColor }} />
                        </div>
                        {/* Cancel button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); if (group.resultPlaceholder.imageId) { removeProcessingFrame(group.resultPlaceholder.imageId); fetch('/api/cancel-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: group.resultPlaceholder.imageId }) }).catch(() => {}); } }}
                          className="mt-1 px-3 py-1 text-xs rounded-md transition-colors hover:opacity-80"
                          style={{ background: `${accentColor}33`, color: accentColor }}
                        >
                          取消
                        </button>
                      </>
                    ) : group.resultPlaceholder.errorMsg ? (
                      <>
                        <div className="w-6 h-6 flex items-center justify-center rounded-full" style={{ background: 'rgba(239,68,68,0.2)' }}>
                          <span className="text-red-400 text-xs font-bold">!</span>
                        </div>
                        <span className="text-xs text-red-400 text-center px-2 max-w-full line-clamp-2">
                          {group.resultPlaceholder.errorMsg}
                        </span>
                      </>
                    ) : group.resultPlaceholder.resultUrl ? (
                      <NextImage unoptimized width={1} height={1}                         src={group.resultPlaceholder.resultUrl}
                        className="w-full h-full object-cover rounded-[10px]"
                        alt="result"
                        draggable={false}
                      />
                    ) : (
                      <>
                        <div className="w-6 h-6 rotate-45 rounded-sm"
                          style={{ border: `2px solid ${accentBorderStrong}`, margin: '4px' }} />
                        <span className="text-sm font-semibold" style={{ color: `${accentColor}99` }}>
                          {isRef ? '参考图输出' : '融图输出'}
                        </span>
                        <span className="text-xs font-medium" style={{ color: `${accentColor}77` }}>
                          {srcImages.map(r => `R${r.refNumber}`).join(' + ')} →
                        </span>
                        <span className="text-xs" style={{ color: `${accentColor}66` }}>
                          {group.toolbar.aspectRatio}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Toolbar — hidden when result exists, only show generating/idle toolbar */}
                  {!group.resultPlaceholder.resultUrl && (
                  <div
                    className="flex flex-col gap-2 mt-2 px-3 py-3 rounded-xl"
                    style={{
                      background: isMonochrome ? 'rgba(255,255,255,0.95)' : 'rgba(26,26,26,0.96)',
                      border: isMonochrome ? '1px solid rgba(200,200,200,0.5)' : `1px solid ${accentBorder}`,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onWheel={(e) => e.stopPropagation()}
                  >
                    {/* Row 1: Model selector — custom dropdown with highlight */}
                    <div className="relative">
                      <span className="text-xs font-medium shrink-0 mb-1 block" style={{ color: `${accentColor}cc` }}>模型</span>
                      <button
                        className={`w-full text-left text-sm px-2.5 py-1.5 rounded-lg border flex items-center justify-between ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-white/5 border-white/[0.14] text-text-bright'}`}
                        onMouseDown={(e) => { e.stopPropagation(); }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenModelDropdownGroupId(prev => prev === group.id ? null : group.id);
                        }}
                      >
                        <span className="truncate">{modelDisplayName}</span>
                        <svg className="w-3.5 h-3.5 shrink-0 ml-1 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                      {/* Custom dropdown */}
                      {openModelDropdownGroupId === group.id && (
                        <div
                          className="absolute left-0 right-0 top-full mt-1 rounded-lg shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto"
                          style={{ background: isMonochrome ? '#fff' : 'rgba(20,20,20,0.95)', border: isMonochrome ? '1px solid #ddd' : '1px solid #333' }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onWheel={(e) => e.stopPropagation()}
                        >
                          {canvasGenModels.map((m, mi) => {
                            const isSelected = group.toolbar.model === m.id && group.toolbar.providerId === m.providerId;
                            return (
                              <button
                                key={`${m.providerId}::${m.id}::${mi}`}
                                className={`w-full text-left text-sm px-3 py-2 flex items-center gap-2 transition-colors ${isSelected ? (isMonochrome ? 'bg-blue-50 text-blue-800' : 'bg-gold/15 text-gold') : (isMonochrome ? 'hover:bg-gray-100 text-gray-700' : 'hover:bg-[#2a2a2a] text-text-bright')}`}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 获取新模型支持的参数，重置质量和比例
                                  const newSupportedRatios = findModelConfig(MODEL_ASPECT_RATIOS, m.id) || DEFAULT_ASPECT_RATIOS;
                                  const newResolutions = getResolutionTierOptions(m.id);
                                  const newQualityLevels = getQualityLevelOptions(m.id);
                                  const newAspectRatio = newSupportedRatios.includes('1:1') ? '1:1' : newSupportedRatios[0];
                                  const newResolution = newResolutions[0] || '2K';
                                  const newQualityLevel = newQualityLevels[0] || 'auto';
                                  const newSize = calculateActualPixels(newAspectRatio, newResolution, m.id);
                                  setGenGroups(prev => prev.map(g =>
                                    g.id === group.id ? { ...g, toolbar: { ...g.toolbar, model: m.id, providerId: m.providerId, providerName: m.providerName, aspectRatio: newAspectRatio, resolution: newResolution, quality: newQualityLevel, size: newSize } } : g
                                  ));
                                  setOpenModelDropdownGroupId(null);
                                }}
                              >
                                {isSelected && <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                                <span className="truncate">{m.apiDisplayName || getModelDisplayName(m.id)} · 来自 {m.providerName}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Row 2: Aspect ratio + Resolution + Quality + Count */}
                    {(() => {
                      const supportedRatios = findModelConfig(MODEL_ASPECT_RATIOS, group.toolbar.model) || DEFAULT_ASPECT_RATIOS;
                      const supportedResolutions = getResolutionTierOptions(group.toolbar.model);
                      const supportedQualityLevels = getQualityLevelOptions(group.toolbar.model);
                      const paramType = getModelParamType(group.toolbar.model);
                      const showResolution = paramType === 'resolution' || paramType === 'both';
                      const showQuality = paramType === 'quality' || paramType === 'both';
                      const currentResolution = group.toolbar.resolution || supportedResolutions[0] || '2K';
                      const currentQuality = group.toolbar.quality || supportedQualityLevels[0] || 'auto';
                      return (
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* 图像比例 */}
                      <select
                        className={`text-[13px] px-2.5 py-1.5 rounded-lg border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-white/5 border-white/[0.14] text-text-bright'}`}
                        value={group.toolbar.aspectRatio}
                        onChange={(e) => {
                          const newAr = e.target.value;
                          const newSize = calculateActualPixels(newAr, currentResolution, group.toolbar.model);
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, toolbar: { ...g.toolbar, aspectRatio: newAr, size: newSize } } : g
                          ));
                        }}
                      >
                        {supportedRatios.map(r => (
                          <option key={r} value={r} className={isMonochrome ? 'bg-white text-gray-700' : 'bg-[#1a1d26] text-text-bright'}>{r}</option>
                        ))}
                      </select>
                      {/* 分辨率档位 */}
                      {showResolution && (
                      <select
                        className={`text-[13px] px-2.5 py-1.5 rounded-lg border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-white/5 border-white/[0.14] text-text-bright'}`}
                        value={currentResolution}
                        onChange={(e) => {
                          const newRes = e.target.value;
                          const newSize = calculateActualPixels(group.toolbar.aspectRatio, newRes, group.toolbar.model);
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, toolbar: { ...g.toolbar, resolution: newRes, size: newSize } } : g
                          ));
                        }}
                      >
                        {supportedResolutions.map(r => (
                          <option key={r} value={r} className={isMonochrome ? 'bg-white text-gray-700' : 'bg-[#1a1d26] text-text-bright'}>{RESOLUTION_TIER_DISPLAY_NAMES[r] || r}</option>
                        ))}
                      </select>
                      )}
                      {/* 图片质量 */}
                      {showQuality && (
                      <select
                        className={`text-[13px] px-2.5 py-1.5 rounded-lg border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-white/5 border-white/[0.14] text-text-bright'}`}
                        value={currentQuality}
                        onChange={(e) => {
                          const newQ = e.target.value;
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, toolbar: { ...g.toolbar, quality: newQ } } : g
                          ));
                        }}
                      >
                        {supportedQualityLevels.map(q => (
                          <option key={q} value={q} className={isMonochrome ? 'bg-white text-gray-700' : 'bg-[#1a1d26] text-text-bright'}>{QUALITY_LEVEL_DISPLAY_NAMES[q] || q}</option>
                        ))}
                      </select>
                      )}
                      {/* 出图数量 */}
                      <select
                        className={`text-[13px] px-2.5 py-1.5 rounded-lg border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-white/5 border-white/[0.14] text-text-bright'}`}
                        value={group.toolbar.outputCount || group.toolbar.n || 1}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, toolbar: { ...g.toolbar, outputCount: val, n: val } } : g
                          ));
                        }}
                      >
                        {[1,2,3,4].map(n => (
                          <option key={n} value={n} className={isMonochrome ? 'bg-white text-gray-700' : 'bg-[#1a1d26] text-text-bright'}>{n}张</option>
                        ))}
                      </select>
                    </div>
                    );
                    })()}

                    {/* Row 2.5: Per-image reference category settings are now shown on each image label */}

                    {/* Row 3: Prompt textarea with resize handle */}
                    <div className="relative">
                      <textarea
                        className={`w-full text-sm px-3 py-2 pr-10 rounded-lg border resize-y min-h-[60px] max-h-[160px] ${isMonochrome ? 'bg-white border-gray-200 text-gray-700 placeholder:text-gray-400 focus:ring-blue-400/30' : 'bg-white/5 border-white/[0.14] text-text-bright placeholder:text-gold-muted/70 focus:ring-gold/30'} focus:outline-none focus:ring-2 transition-all`}
                        placeholder={isRef ? '描述你想要生成的图片，用自然语言说明如何参考以上图片...' : '描述你想要融合生成的图片效果...'}
                        value={group.toolbar.prompt}
                        rows={2}
                        onChange={(e) => {
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, toolbar: { ...g.toolbar, prompt: e.target.value } } : g
                          ));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            // 不再自动触发生成，用户需要点击"生成"按钮
                            // Enter 换行由 textarea 默认行为处理
                          }
                        }}
                      />
                      {/* Resize handle indicator (bottom-right) */}
                      <div className="absolute bottom-1 right-1 w-4 h-4 opacity-30 pointer-events-none"
                        style={{ color: accentColor }}>
                        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 14H10L14 10V14ZM14 14H12L14 12V14ZM14 6L6 14H8L14 8V6Z" /></svg>
                      </div>
                    </div>

                    {/* Row 4: Optimize + Generate + Cancel */}
                    <div className="flex items-center gap-2">
                      <button
                        className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${isMonochrome ? 'bg-blue-50 hover:bg-blue-100 text-blue-600' : 'bg-[#252525] hover:bg-[#282828]/85 text-muted-foreground'}`}
                        onClick={() => handleOptimizeGroupPrompt(group.id)}
                        disabled={optimizingGroupId === group.id || !group.toolbar.prompt.trim()}
                        title="调用AI优化提示词"
                      >
                        {optimizingGroupId === group.id ? (
                          <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: accentColor, borderTopColor: 'transparent' }} />
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                        )}
                        <span>{optimizingGroupId === group.id ? '优化中' : '优化'}</span>
                      </button>
                      <button
                        className="flex-1 py-2.5 rounded-lg text-sm font-bold text-black transition-all hover:brightness-110 active:scale-[0.98]"
                        style={{ background: isRef ? 'linear-gradient(135deg, #d4af37, #f0d060)' : 'linear-gradient(135deg, #4ecdc4, #45b7d1)' }}
                        onClick={() => handleGenGroupGenerate(group.id)}
                        disabled={group.resultPlaceholder.isProcessing || !group.toolbar.prompt.trim()}
                      >
                        {group.resultPlaceholder.isProcessing ? '生成中...' : '生成'}
                      </button>
                      <button
                        className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isMonochrome ? 'bg-blue-50 hover:bg-blue-100 text-blue-500' : 'bg-[#252525] hover:bg-[#282828]/85 text-gold-muted'}`}
                        onClick={() => deleteGenGroup(group.id)}
                        title="取消并删除组"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                  )}
                </div>
                </div>
                )}
                </div>
              </div>
            );
          })}
        </div>


        {/* HexCube 六面体浮动面板 - 移到 canvas transform group 外部 */}

        {boxSelectStart && boxSelectEnd && (
          <div
            className="absolute border border-gold/50 bg-gold/10 z-30 pointer-events-none"
            style={{
              left: Math.min(boxSelectStart.x, boxSelectEnd.x) - (canvasRef.current?.getBoundingClientRect().left || 0),
              top: Math.min(boxSelectStart.y, boxSelectEnd.y) - (canvasRef.current?.getBoundingClientRect().top || 0),
              width: Math.abs(boxSelectEnd.x - boxSelectStart.x),
              height: Math.abs(boxSelectEnd.y - boxSelectStart.y),
            }}
          />
        )}

        {/* Snap guides overlay - alignment guides when dragging images */}
        {activeSnapGuides.length > 0 && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none z-30"
            style={{ overflow: 'visible' }}
          >
            {activeSnapGuides.map((guide, idx) => {
              if (guide.type === 'vertical') {
                const screenX = guide.position * zoom + viewOffset.x;
                return (
                  <line
                    key={`snap-v-${idx}`}
                    x1={screenX}
                    y1={0}
                    x2={screenX}
                    y2="100%"
                    stroke={isMonochrome ? '#3b82f6' : '#d4af37'}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    opacity={0.7}
                  />
                );
              } else {
                const screenY = guide.position * zoom + viewOffset.y;
                return (
                  <line
                    key={`snap-h-${idx}`}
                    x1={0}
                    y1={screenY}
                    x2="100%"
                    y2={screenY}
                    stroke={isMonochrome ? '#3b82f6' : '#d4af37'}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    opacity={0.7}
                  />
                );
              }
            })}
          </svg>
        )}

        {/* Edit mode overlay */}
        {editMode !== 'none' && editImageId && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const screenX = editImg.x * zoom + viewOffset.x;
          const screenY = editImg.y * zoom + viewOffset.y;
          const screenW = editImg.width * zoom;
          const screenH = editImg.height * zoom;

          return (
            <div className="absolute inset-0 z-40 pointer-events-none">
              {/* Dim overlay outside image */}
              <div className="absolute inset-0 bg-black/40" style={{ clipPath: `polygon(0% 0%, 0% 100%, ${screenX}px 100%, ${screenX}px ${screenY}px, ${screenX + screenW}px ${screenY}px, ${screenX + screenW}px ${screenY + screenH}px, ${screenX}px ${screenY + screenH}px, ${screenX}px 100%, 100% 100%, 100% 0%)` }} />
              {/* Brush cursor for erase/mask modes - moved to floating window */}
              {/* Crop rectangle */}
              {editMode === 'crop' && cropRect && (
                <div
                  className="absolute border-2 border-gold bg-gold/10"
                  style={{
                    left: cropRect.x,
                    top: cropRect.y,
                    width: cropRect.w,
                    height: cropRect.h,
                    cursor: 'move',
                  }}
                  onMouseDown={(e) => {
                    // This handles clicks inside the crop rect (move mode)
                    // But the main handleEditMouseDown already handles this
                    e.stopPropagation();
                  }}
                >
                  <div className="absolute left-1/3 top-0 bottom-0 border-l border-gold/40" />
                  <div className="absolute left-2/3 top-0 bottom-0 border-l border-gold/40" />
                  <div className="absolute top-1/3 left-0 right-0 border-t border-gold/40" />
                  <div className="absolute top-2/3 left-0 right-0 border-t border-gold/40" />
                  <div className={`absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'}`}>
                    {Math.round(cropRect.w / zoom)} x {Math.round(cropRect.h / zoom)}
                  </div>
                  {/* Corner drag handles */}
                  {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
                    <div
                      key={c}
                      className={`absolute w-3 h-3 rounded-full cursor-nwse-resize ${isMonochrome ? 'bg-blue-500' : 'bg-gold'}`}
                      style={{
                        [c.includes('t') ? 'top' : 'bottom']: '-6px',
                        [c.includes('l') ? 'left' : 'right']: '-6px',
                        cursor: c === 'tl' || c === 'br' ? 'nwse-resize' : 'nesw-resize',
                      }}
                    />
                  ))}
                </div>
              )}
              {/* Processing overlay (not for SVG trace - has its own canvas progress frame) */}
              {isEditProcessing && !showSvgTracePanel && !isSvgTraceProcessing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50 pointer-events-auto">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-white">处理中...</span>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ====== UPSCALE FLOATING CONTROL BAR ====== */}
        {editMode === 'upscale' && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgScreenX = editImg.x * zoom + viewOffset.x;
          const imgScreenY = editImg.y * zoom + viewOffset.y;
          const imgScreenW = editImg.width * zoom;
          const panelX = imgScreenX + imgScreenW / 2;
          const panelY = imgScreenY - 8;
          const origW = upscaleActualW || editImg.originalWidth || editImg.width;
          const origH = upscaleActualH || editImg.originalHeight || editImg.height;
          const targetDim = getUpscaleTargetDimensions(origW, origH, upscalePreset);
          const isSizeLoaded = upscaleActualW > 0 && upscaleActualH > 0;

          return (
            <div
              className="absolute z-50 pointer-events-auto"
              data-toolbar="edit-mode"
              style={{ left: panelX, top: panelY, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className={`${panelBaseClass} gap-2`} onMouseDown={(e) => e.stopPropagation()}>
                <ZoomIn size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                <span className={panelLabelClass}>HD 高清放大</span>
                <div className={panelDividerClass} />
                {/* Original size display */}
                <span className={`text-xs tabular-nums ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>
                  {isSizeLoaded ? `${origW}×${origH}` : '...'}
                </span>
                <div className={panelDividerClass} />
                {/* Resolution preset dropdown */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowUpscalePresetMenu(!showUpscalePresetMenu); }}
                    className={`px-2.5 py-1 text-xs rounded-md transition-all flex items-center gap-1 font-semibold ${
                      isMonochrome ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-[#252525] text-text-bright hover:bg-[#282828]/85'
                    }`}
                  >
                    {upscalePreset === '2k' ? '2×' : upscalePreset === '4k' ? '4×' : '8×'}
                    <ChevronDown size={10} />
                  </button>
                  {showUpscalePresetMenu && (
                    <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 min-w-[100px] ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1e1e1e] border-[#444]'}`}>
                      {(['2k', '4k', '8k'] as const).map(p => {
                        const pMul = p === '2k' ? 2 : p === '4k' ? 4 : 8;
                        const pTarget = getUpscaleTargetDimensions(origW, origH, p);
                        return (
                          <button key={p} onClick={(e) => { e.stopPropagation(); setUpscalePreset(p); setShowUpscalePresetMenu(false); }} className={`w-full px-3 py-1.5 text-xs text-left flex items-center justify-between ${isMonochrome ? 'hover:bg-blue-50' : 'hover:bg-gold/10'} ${upscalePreset === p ? (isMonochrome ? 'text-blue-600' : 'text-gold') : isMonochrome ? 'text-gray-600' : 'text-text-bright'}`}>
                            <span>{pMul}× <span className="opacity-60 ml-1">{pTarget.w}×{pTarget.h}</span></span>
                            {upscalePreset === p && <span className={isMonochrome ? 'text-blue-500' : 'text-gold'}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={panelDividerClass} />
                {/* Upscale mode selector: 无损放大 / AI放大 */}
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setUpscaleMode('lossless'); }}
                    className={`px-2 py-1 text-xs rounded-l-md transition-all font-medium ${
                      upscaleMode === 'lossless'
                        ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'
                        : isMonochrome ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-[#252525] text-gold-muted hover:bg-[#333]'
                    }`}
                    title="无损放大：Real-ESRGAN 超分辨率算法，真实无损，忠实还原每一个像素"
                  >
                    无损放大
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setUpscaleMode('ai'); }}
                    className={`px-2 py-1 text-xs rounded-r-md transition-all font-medium ${
                      upscaleMode === 'ai'
                        ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'
                        : isMonochrome ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-[#252525] text-gold-muted hover:bg-[#333]'
                    }`}
                    title="AI放大：AI模型智能补细节+增强清晰度，内容可能有变化"
                  >
                    AI放大
                  </button>
                </div>
                <div className={panelDividerClass} />
                {/* Target dimensions */}
                <span className={`text-xs tabular-nums font-semibold ${isMonochrome ? 'text-gray-700' : 'text-text-bright'}`}>
                  {isSizeLoaded ? `${targetDim.w}×${targetDim.h}` : '...'}
                </span>
                <div className={panelDividerClass} />
                {/* Execute button */}
                <button
                  onClick={handleUpscaleConfirm}
                  disabled={targetDim.multiplier <= 1}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                    targetDim.multiplier <= 1
                      ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-gold-muted/50 cursor-not-allowed'
                      : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-95' : 'bg-gold text-black hover:bg-[#e5c047] active:scale-95'
                  }`}
                  title="开始放大"
                >
                  <Sparkles size={14} />
                </button>
                <button onClick={exitEditMode} className={panelCancelBtnClass}>取消</button>
              </div>
              <div className="text-center mt-1">
                <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>Esc 退出</span>
              </div>
            </div>
          );
        })()}

        {/* ====== SVG智能描摹 FLOATING PANEL ====== */}
        {showSvgTracePanel && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgOrigW = editImg.originalWidth || Math.round(editImg.width);
          const imgOrigH = editImg.originalHeight || Math.round(editImg.height);
          // 面板位置只在首次打开时计算，后续渲染使用固定位置，避免点击时跳动
          if (!svgTraceFixedPosRef.current) {
            const initPos = getToolbarPosition();
            svgTraceFixedPosRef.current = { top: initPos.y, left: initPos.x };
          }
          const pos = svgTraceFixedPosRef.current;
          return (
            <div
              style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                width: 320,
                background: '#141414',
                border: '1px solid #333',
                borderRadius: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                zIndex: 60,
                padding: 16,
                color: '#ccc',
                fontSize: 13,
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Settings2 size={16} style={{ color: '#d4af37' }} />
                  SVG智能描摹
                </span>
                <span style={{ color: '#888', fontSize: 12 }}>Esc 退出</span>
              </div>

              {/* Mode selection */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {([
                  { key: 'color', label: '全彩矢量化', desc: 'AI识别分色', icon: <Palette size={14} style={{ color: '#d4af37' }} /> },
                  { key: 'bw', label: '黑白描摹', desc: '轮廓追踪', icon: <PenTool size={14} style={{ color: '#d4af37' }} /> },
                ] as const).map(m => (
                  <button
                    key={m.key}
                    onClick={() => setSvgTraceMode(m.key)}
                    style={{
                      flex: 1,
                      padding: '8px 6px',
                      borderRadius: 8,
                      border: svgTraceMode === m.key ? '1.5px solid #d4af37' : '1px solid #444',
                      background: svgTraceMode === m.key ? 'rgba(212,175,55,0.12)' : '#1e1e1e',
                      color: svgTraceMode === m.key ? '#d4af37' : '#aaa',
                      cursor: 'pointer',
                      textAlign: 'center',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{m.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{m.desc}</div>
                  </button>
                ))}
              </div>

              {/* Original image info */}
              <div style={{ fontSize: 11, color: '#888', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Check size={12} style={{ color: '#4ade80' }} />
                原图 {imgOrigW}×{imgOrigH}
              </div>

              {/* Color mode settings */}
              {svgTraceMode === 'color' && (
                <>
                  {/* Engine */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#999', fontSize: 12 }}>矢量化引擎</span>
                      <span style={{ color: '#666', fontSize: 10 }}>自动选择最优</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {([
                        { key: 'auto', label: '自动' },
                        { key: 'wasm-vtracer', label: 'WASM' },
                        { key: 'vectorize-api', label: 'Vectorizer' },
                        { key: 'vlm', label: 'VLM' },
                        { key: 'vtracer', label: 'VTracer' },
                      ] as const).map(e => (
                        <button
                          key={e.key}
                          onClick={() => setSvgTraceEngine(e.key as typeof svgTraceEngine)}
                          style={{
                            flex: 1,
                            padding: '5px 4px',
                            borderRadius: 6,
                            border: svgTraceEngine === e.key ? '1.5px solid #d4af37' : '1px solid #444',
                            background: svgTraceEngine === e.key ? 'rgba(212,175,55,0.12)' : '#1e1e1e',
                            color: svgTraceEngine === e.key ? '#d4af37' : '#aaa',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: svgTraceEngine === e.key ? 600 : 400,
                          }}
                        >
                          {e.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quality preset */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#999', fontSize: 12 }}>质量预设</span>
                      <span style={{ color: '#666', fontSize: 10 }}>调整后覆盖参数</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {[
                        { key: 'fast' as const, label: '快速' },
                        { key: 'balanced' as const, label: '均衡' },
                        { key: 'high' as const, label: '高清' },
                        { key: 'max' as const, label: '极致' },
                      ].map(q => (
                        <button
                          key={q.key}
                          onClick={() => setSvgTraceQualityPreset(q.key)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: svgTraceQualityPreset === q.key ? '1.5px solid #d4af37' : '1px solid #444',
                            background: svgTraceQualityPreset === q.key ? 'rgba(212,175,55,0.12)' : '#1e1e1e',
                            color: svgTraceQualityPreset === q.key ? '#d4af37' : '#aaa',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: svgTraceQualityPreset === q.key ? 600 : 400,
                          }}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Fine-tuning sliders */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ color: '#999', fontSize: 12, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                      <span>精细调节</span>
                      <span style={{ color: '#666', fontSize: 10 }}>覆盖预设值</span>
                    </div>
                    {/* Color count */}
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 2 }}>
                        <span>颜色数</span>
                        <span>{svgTraceColorPrecision}色</span>
                      </div>
                      <input type="range" min={2} max={256} value={svgTraceColorPrecision ?? 5} onChange={e => setSvgTraceColorPrecision(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#d4af37' }} />
                    </div>
                    {/* Corner threshold */}
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 2 }}>
                        <span>角点阈值</span>
                        <span>{svgTraceCornerThreshold ?? '自动'}</span>
                      </div>
                      <input type="range" min={0} max={100} value={svgTraceCornerThreshold ?? 60} onChange={e => setSvgTraceCornerThreshold(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#d4af37' }} />
                    </div>
                  </div>
                </>
              )}

              {/* BW mode settings */}
              {svgTraceMode === 'bw' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#999', fontSize: 12, marginBottom: 6 }}>黑白参数</div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 2 }}>
                      <span>阈值</span>
                      <span>{svgTraceBwThreshold}</span>
                    </div>
                    <input type="range" min={0} max={255} value={svgTraceBwThreshold} onChange={e => setSvgTraceBwThreshold(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#d4af37' }} />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={handleSvgTraceConfirm}
                  style={{
                    flex: 2,
                    padding: '10px 0',
                    borderRadius: 8,
                    border: 'none',
                    background: '#d4af37',
                    color: '#000',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  {svgTraceMode === 'color' ? '全彩矢量化' : '黑白描摹'}
                </button>
                <button
                  onClick={() => { setShowSvgTracePanel(false); setEditMode('none'); }}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1e1e1e',
                    color: '#aaa',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          );
        })()}
        {/* ====== ERASE/MASK FLOATING WINDOW ====== */}
        {(editMode === 'erase' || editMode === 'mask') && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgOrigW = editImg.originalWidth || Math.round(editImg.width);
          const imgOrigH = editImg.originalHeight || Math.round(editImg.height);
          const isErase = editMode === 'erase';
          // Window dimensions
          const winW = Math.min(900, typeof window !== 'undefined' ? window.innerWidth - 80 : 900);
          const winH = Math.min(600, typeof window !== 'undefined' ? window.innerHeight - 120 : 600);
          // Canvas area (left) takes ~70% of window
          const canvasAreaW = Math.round(winW * 0.7);
          const sidebarW = winW - canvasAreaW;
          // Calculate image fit in canvas area
          const fitScale = Math.min((canvasAreaW - 40) / imgOrigW, (winH - 80) / imgOrigH, 1) * editCanvasZoom;
          const displayW = imgOrigW * fitScale;
          const displayH = imgOrigH * fitScale;
          const canvasCenterX = (canvasAreaW - displayW) / 2 + editCanvasPan.x;
          const canvasCenterY = (winH - displayH) / 2 + editCanvasPan.y;

          return (
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center"
              style={{ cursor: 'default' }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseMove={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
            >
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/40" onClick={exitEditMode} />
              {/* Window */}
              <div
                className={`relative rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-300' : 'bg-[#1a1a1a] border-[#444]'}`}
                style={{ width: winW, height: winH, cursor: 'default' }}
              >
                {/* Title bar */}
                <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#222]'}`}>
                  <div className="flex items-center gap-2">
                    {isErase ? <Paintbrush size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} /> : <Wand2 size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />}
                    <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>
                      {isErase ? '擦除' : '蒙版修图'}
                    </span>
                    <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>
                      涂抹区域后点击&apos;开始修复&apos; · Shift+左键擦除涂抹
                    </span>
                  </div>
                  <button onClick={exitEditMode} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50' : 'text-gold-muted/70 hover:text-white hover:bg-[#282828]/85'}`}>
                    <X size={16} />
                  </button>
                </div>

                <div className="flex" style={{ height: winH - 44 }}>
                  {/* Left: Canvas area with checkered bg */}
                  <div
                    className={`relative overflow-hidden ${isMonochrome ? 'bg-gray-200' : 'bg-[#0d0d0d]'}`}
                    style={{ width: canvasAreaW, cursor: 'default' }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    ref={(el) => {
                      // Register non-passive wheel handler for proper preventDefault
                      if (el && !el.dataset.wheelBound) {
                        el.dataset.wheelBound = '1';
                        el.addEventListener('wheel', (e: WheelEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const delta = e.deltaY > 0 ? 0.9 : 1.1;
                          setEditCanvasZoom(z => Math.max(0.25, Math.min(5, z * delta)));
                        }, { passive: false });
                      }
                    }}
                  >
                    {/* Checkered background for image */}
                    <div
                      className="absolute"
                      style={{
                        left: canvasCenterX,
                        top: canvasCenterY,
                        width: displayW,
                        height: displayH,
                        backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%), linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%)',
                        backgroundSize: '16px 16px',
                        backgroundPosition: '0 0, 8px 8px',
                        backgroundColor: '#222',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      {/* Image */}
                      <NextImage unoptimized width={1} height={1}                         src={editImg.url}
                        alt="edit"
                        className="w-full h-full object-contain select-none"
                        draggable={false}
                        crossOrigin="anonymous"
                        referrerPolicy="no-referrer"
                        style={{ pointerEvents: 'none' }}
                      />
                      {/* Stroke overlay SVG */}
                      <svg
                        className="absolute inset-0 w-full h-full"
                        viewBox={`0 0 ${imgOrigW} ${imgOrigH}`}
                        style={{ pointerEvents: 'none' }}
                      >
                        {/* Render completed strokes */}
                        {editStrokes.map((stroke, si) => {
                          const normalPoints = stroke.filter(p => !p.reverse);
                          const reversePoints = stroke.filter(p => p.reverse);
                          return (
                            <React.Fragment key={si}>
                              {normalPoints.length === 1 && (
                                <circle
                                  cx={normalPoints[0].x}
                                  cy={normalPoints[0].y}
                                  r={brushSize / 2 / fitScale}
                                  fill={isErase ? 'rgba(255,80,80,0.5)' : 'rgba(212,175,55,0.5)'}
                                />
                              )}
                              {normalPoints.length > 1 && (
                                <polyline
                                  points={normalPoints.map(p => `${p.x},${p.y}`).join(' ')}
                                  fill="none"
                                  stroke={isErase ? 'rgba(255,80,80,0.5)' : 'rgba(212,175,55,0.5)'}
                                  strokeWidth={brushSize / fitScale}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              )}
                              {reversePoints.length === 1 && (
                                <circle
                                  cx={reversePoints[0].x}
                                  cy={reversePoints[0].y}
                                  r={brushSize / 2 / fitScale}
                                  fill="rgba(0,200,100,0.5)"
                                />
                              )}
                              {reversePoints.length > 1 && (
                                <polyline
                                  points={reversePoints.map(p => `${p.x},${p.y}`).join(' ')}
                                  fill="none"
                                  stroke="rgba(0,200,100,0.5)"
                                  strokeWidth={brushSize / fitScale}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeDasharray="4 4"
                                />
                              )}
                            </React.Fragment>
                          );
                        })}
                        {/* Current stroke */}
                        {currentStroke.length === 1 && (
                          <circle
                            cx={currentStroke[0].x}
                            cy={currentStroke[0].y}
                            r={brushSize / 2 / fitScale}
                            fill={currentStroke[0]?.reverse ? 'rgba(0,200,100,0.5)' : (isErase ? 'rgba(255,80,80,0.5)' : 'rgba(212,175,55,0.5)')}
                          />
                        )}
                        {currentStroke.length > 1 && (
                          <polyline
                            points={currentStroke.map(p => `${p.x},${p.y}`).join(' ')}
                            fill="none"
                            stroke={currentStroke[0]?.reverse ? 'rgba(0,200,100,0.5)' : (isErase ? 'rgba(255,80,80,0.5)' : 'rgba(212,175,55,0.5)')}
                            strokeWidth={brushSize / fitScale}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={currentStroke[0]?.reverse ? '4 4' : undefined}
                          />
                        )}
                      </svg>
                      {/* Drawing layer - captures mouse events for brush & pan */}
                      <div
                        className="absolute inset-0"
                        style={{ cursor: isDrawingRef.current ? 'crosshair' : 'crosshair' }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          // Middle/right button: canvas panning
                          if (e.button === 1 || e.button === 2) {
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const startPan = { ...editCanvasPan };
                            const onMove = (ev: MouseEvent) => {
                              if (isEventFromOverlay(ev)) return;
                              setEditCanvasPan({
                                x: startPan.x + ev.clientX - startX,
                                y: startPan.y + ev.clientY - startY,
                              });
                            };
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove);
                              window.removeEventListener('mouseup', onUp);
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                            return;
                          }
                          // Left button: draw
                          if (e.button !== 0) return;
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const x = (e.clientX - rect.left) / rect.width * imgOrigW;
                          const y = (e.clientY - rect.top) / rect.height * imgOrigH;
                          // Shift+click = erase (reverse) mode, otherwise use current brush mode
                          const isReverse = e.shiftKey || editBrushMode === 'eraser';
                          const firstPoint = { x, y, reverse: isReverse };
                          currentStrokeRef.current = [firstPoint];
                          setCurrentStroke([firstPoint]);
                          isDrawingRef.current = true;
                          isAltErasingRef.current = isReverse;
                        }}
                        onMouseMove={(e) => {
                          if (!isDrawingRef.current) return;
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const x = (e.clientX - rect.left) / rect.width * imgOrigW;
                          const y = (e.clientY - rect.top) / rect.height * imgOrigH;
                          // Shift held = erase, otherwise use current brush mode
                          const isReverse = e.shiftKey || editBrushMode === 'eraser';
                          const newPoint = { x, y, reverse: isReverse };
                          // Interpolate for smooth strokes
                          const prevPoints = currentStrokeRef.current;
                          if (prevPoints.length > 0) {
                            const last = prevPoints[prevPoints.length - 1];
                            const dist = Math.sqrt((x - last.x) ** 2 + (y - last.y) ** 2);
                            const step = Math.max(1, brushSize / fitScale / 4);
                            if (dist > step) {
                              const n = Math.ceil(dist / step);
                              for (let i = 1; i <= n; i++) {
                                const t = i / n;
                                currentStrokeRef.current.push({
                                  x: last.x + (x - last.x) * t,
                                  y: last.y + (y - last.y) * t,
                                  reverse: isReverse,
                                });
                              }
                            }
                          }
                          currentStrokeRef.current.push(newPoint);
                          setCurrentStroke([...currentStrokeRef.current]);
                        }}
                        onMouseUp={(e) => {
                          e.stopPropagation();
                          if (!isDrawingRef.current) return;
                          isDrawingRef.current = false;
                          const stroke = currentStrokeRef.current;
                          if (stroke.length > 0) {
                            setEditStrokes(prev => [...prev, stroke]);
                          }
                          currentStrokeRef.current = [];
                          setCurrentStroke([]);
                          setStrokesVersion(v => v + 1);
                        }}
                        onMouseLeave={() => {
                          if (!isDrawingRef.current) return;
                          isDrawingRef.current = false;
                          const stroke = currentStrokeRef.current;
                          if (stroke.length > 0) {
                            setEditStrokes(prev => [...prev, stroke]);
                          }
                          currentStrokeRef.current = [];
                          setCurrentStroke([]);
                        }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      />
                    </div>
                    {/* Zoom controls overlay */}
                    <div className={`absolute bottom-3 left-3 flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${isMonochrome ? 'bg-white/80 text-gray-600' : 'bg-[#2a2a2a] text-[#999]'}`} style={{ cursor: 'default' }}>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(z => Math.max(0.25, z / 1.2)); }} className="p-0.5 hover:text-gold"><Minus size={12} /></button>
                      <span className="w-10 text-center tabular-nums">{Math.round(editCanvasZoom * 100)}%</span>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(z => Math.min(5, z * 1.2)); }} className="p-0.5 hover:text-gold"><Plus size={12} /></button>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(1); setEditCanvasPan({ x: 0, y: 0 }); }} className="p-0.5 hover:text-gold"><Maximize2 size={12} /></button>
                    </div>
                    </div>

                  {/* Right: Sidebar controls */}
                  <div className={`flex flex-col border-l ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#1e1e1e]'}`} style={{ width: sidebarW }}>
                    {/* Brush mode toggle */}
                    <div className="px-3 pt-3 pb-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditBrushMode('brush')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-all ${
                            editBrushMode === 'brush'
                              ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                              : isMonochrome
                                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                          }`}
                        >
                          <Paintbrush size={12} />
                          画笔
                        </button>
                        <button
                          onClick={() => setEditBrushMode('eraser')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-all ${
                            editBrushMode === 'eraser'
                              ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                              : isMonochrome
                                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                          }`}
                        >
                          <Eraser size={12} />
                          橡皮擦
                        </button>
                      </div>
                    </div>

                    {/* Brush size slider */}
                    <div className="px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>画笔大小</span>
                        <span className={`text-xs tabular-nums ${isMonochrome ? 'text-gray-600' : 'text-text-bright'}`}>{brushSize}px</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="200"
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        className="w-full h-2 cursor-pointer accent-[#d4af37] rounded-lg"
                        style={{ minHeight: '20px' }}
                      />
                    </div>

                    {/* Erase model selector (only for erase mode) */}
                    {isErase && (
                      <div className="px-3 py-2">
                        <span className={`text-xs mb-1.5 block ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>擦除引擎</span>
                        <div className="flex flex-col gap-1.5">
                          {[
                            { id: 'lama', label: 'LaMa', desc: '通用擦除', recommended: true },
                            { id: 'zits', label: 'ZITS', desc: '结构保持', recommended: false },
                            { id: 'anime-lama', label: 'Anime', desc: '动漫专用', recommended: false },
                          ].map(m => (
                            <button
                              key={m.id}
                              onClick={() => setEraseModelId(m.id)}
                              className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-all text-left ${
                                eraseModelId === m.id
                                  ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                                  : isMonochrome
                                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                              }`}
                            >
                              <span className="font-medium">{m.label}</span>
                              <span className={`text-[10px] ${eraseModelId === m.id ? 'text-black/60' : isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{m.desc}</span>
                              {m.recommended && (
                                <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full ${
                                  eraseModelId === m.id
                                    ? 'bg-black/20 text-black/70'
                                    : isMonochrome
                                      ? 'bg-gray-200 text-gray-500'
                                      : 'bg-[#333] text-gold-muted'
                                }`}>推荐</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Undo/Clear buttons */}
                    <div className="px-3 py-2 flex gap-2">
                      <button
                        onClick={() => {
                          setEditStrokes(prev => prev.slice(0, -1));
                          setStrokesVersion(v => v + 1);
                        }}
                        disabled={editStrokes.length === 0}
                        className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded-lg transition-all ${
                          editStrokes.length === 0
                            ? 'opacity-40 cursor-not-allowed'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                        }`}
                      >
                        <RotateCcw size={12} />
                        撤销
                      </button>
                      <button
                        onClick={() => {
                          setEditStrokes([]);
                          setCurrentStroke([]);
                          currentStrokeRef.current = [];
                          setStrokesVersion(v => v + 1);
                        }}
                        disabled={editStrokes.length === 0}
                        className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded-lg transition-all ${
                          editStrokes.length === 0
                            ? 'opacity-40 cursor-not-allowed'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                        }`}
                      >
                        <Trash2 size={12} />
                        清空
                      </button>
                    </div>

                    {/* Mask prompt (only for mask mode) */}
                    {!isErase && (
                      <div className="px-3 py-2">
                        <span className={`text-xs mb-1 block ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>修复提示词 (可选)</span>
                        <textarea
                          value={maskKeyword}
                          onChange={(e) => setMaskKeyword(e.target.value)}
                          placeholder="描述修复内容..."
                          rows={3}
                          className={`w-full px-2.5 py-2 text-xs rounded-xl border resize-none ${
                            isMonochrome
                              ? 'bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gold/30'
                              : 'bg-[#0a0a0a] border-[#444] text-white placeholder:text-gold-muted/50 focus:outline-none focus:ring-2 focus:ring-gold/30'
                          }`}
                        />
                      </div>
                    )}

                    <div className="flex-1" />

                    {/* Confirm button */}
                    <div className="px-3 pb-3">
                      <button
                        onClick={handleEditConfirm}
                        disabled={editStrokes.length === 0 || isEditProcessing}
                        className={`w-full py-2.5 text-sm font-semibold rounded-xl transition-all ${
                          editStrokes.length === 0 || isEditProcessing
                            ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-gold-muted/50 cursor-not-allowed'
                            : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.98]' : 'bg-gold text-black hover:bg-[#e5c047] active:scale-[0.98]'
                        }`}
                      >
                        {isEditProcessing ? '处理中...' : (editMode === 'erase' ? '开始擦除' : '开始修复')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ====== COLOR ADJUST PANEL (参数调色) ====== */}
        {editMode === 'colorAdjust' && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const isProcessing = colorAdjustProcessing;
          return (
            <div
              className="fixed bg-[#1a1a1a] text-white rounded-2xl shadow-2xl overflow-hidden z-[65] border border-[#333] flex flex-col"
              style={{ top: '120px', right: '40px', width: '360px' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-[#333] bg-[#111]">
                <div className="flex items-center gap-2">
                  <Palette size={18} className="text-[#d4af37]" />
                  <h3 className="font-semibold text-sm">参数调色</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#888]">Esc 退出</span>
                  <button onClick={exitEditMode} className="text-[#888] hover:text-white transition-colors">
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="p-4 overflow-y-auto flex flex-col gap-4" style={{ maxHeight: '60vh' }}>
                {/* 实时预览 - 使用CSS filter即时反馈 */}
                <div className="w-full aspect-video rounded-lg overflow-hidden bg-black/40 flex items-center justify-center border border-[#333] relative">
                  <NextImage unoptimized width={1} height={1}                     src={editImg.url}
                    alt="预览"
                    className="max-w-full max-h-full object-contain transition-all duration-100"
                    crossOrigin="anonymous"
                    style={{
                      filter: `brightness(${1 + colorBrightness / 200}) contrast(${1 + colorContrast / 100}) saturate(${1 + colorSaturation / 100}) hue-rotate(${colorHue * 1.8}deg)${colorTemperature > 0 ? ` sepia(${colorTemperature / 200}) saturate(${1 + colorTemperature / 300})` : colorTemperature < 0 ? ` hue-rotate(${-colorTemperature * 0.5}deg) saturate(${1 - colorTemperature / 500})` : ''}`,
                    }}
                  />
                  <div className="absolute bottom-2 left-2 text-[10px] text-white/70 bg-black/50 px-2 py-0.5 rounded">实时预览</div>
                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="animate-spin text-[#d4af37]" size={28} />
                    </div>
                  )}
                </div>

                {/* 滑杆区域 */}
                <div className="grid grid-cols-1 gap-3">
                  {/* 亮度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">亮度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorBrightness > 0 ? '+' : ''}{colorBrightness}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorBrightness} onChange={e => setColorBrightness(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                  {/* 对比度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">对比度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorContrast > 0 ? '+' : ''}{colorContrast}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorContrast} onChange={e => setColorContrast(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                  {/* 饱和度 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">饱和度</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorSaturation > 0 ? '+' : ''}{colorSaturation}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorSaturation} onChange={e => setColorSaturation(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                  {/* 色温 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">色温</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorTemperature > 0 ? '+' : ''}{colorTemperature}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorTemperature} onChange={e => setColorTemperature(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                  {/* 色相 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[#aaa]">色相</span>
                      <span className="text-xs text-[#d4af37] font-mono">{colorHue > 0 ? '+' : ''}{colorHue}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={colorHue} onChange={e => setColorHue(Number(e.target.value))} className="w-full accent-[#d4af37]" />
                  </div>
                </div>

                {/* 重置按钮 */}
                <button
                  onClick={() => { setColorBrightness(0); setColorContrast(0); setColorSaturation(0); setColorTemperature(0); setColorHue(0); }}
                  className="text-xs text-[#888] hover:text-white py-1 transition-colors"
                >
                  ↺ 重置所有参数
                </button>
              </div>

              <div className="p-4 border-t border-[#333] bg-[#111]">
                <button
                  onClick={handleConfirmColorAdjust}
                  disabled={colorAdjustProcessing}
                  className="w-full py-3 rounded-lg bg-[#d4af37] text-black font-semibold text-sm hover:bg-[#e5c048] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {colorAdjustProcessing ? (
                    <><Loader2 size={16} className="animate-spin" /> 调色处理中...</>
                  ) : (
                    '应用调色'
                  )}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ====== REMOVE BACKGROUND MODEL PICKER ====== */}
        {showRemoveBgPicker && (() => {
          const removeBgModels: Array<{ id: string; label: string; description: string; size: string; recommended?: boolean }> = [
            { id: 'u2net', label: 'U2Net 通用', description: '主体保留最完整，通用推荐', size: '176MB', recommended: true },
            { id: 'isnet-general-use', label: 'ISNet 高精度', description: '精度高但蒙版偏紧', size: '170MB' },
            { id: 'silueta', label: 'Silueta 人像', description: '轻量人像去背景', size: '45MB' },
            { id: 'u2netp', label: 'U2Net 轻量', description: '极轻量快速备选', size: '4.5MB' },
          ];
          return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center" onMouseDown={(e) => e.stopPropagation()}>
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowRemoveBgPicker(false)} />
              <div className={`relative rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-300' : 'bg-[#1a1a1a] border-[#444]'}`} style={{ width: 420, maxHeight: '80vh' }}>
                {/* Title */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#222]'}`}>
                  <div className="flex items-center gap-2">
                    <Eraser size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                    <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>选择去背景模型</span>
                  </div>
                  <button onClick={() => setShowRemoveBgPicker(false)} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50' : 'text-gold-muted/70 hover:text-white hover:bg-[#282828]/85'}`}>
                    <X size={16} />
                  </button>
                </div>
                {/* Model list */}
                <div className="p-3 space-y-2">
                  {removeBgModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setRemoveBgModelId(m.id)}
                      className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                        removeBgModelId === m.id
                          ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'
                          : isMonochrome
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{m.label}</span>
                          {'recommended' in m && m.recommended && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                              removeBgModelId === m.id
                                ? 'bg-black/20 text-black/70'
                                : isMonochrome
                                  ? 'bg-gray-200 text-gray-500'
                                  : 'bg-[#333] text-gold-muted'
                            }`}>推荐</span>
                          )}
                        </div>
                        <div className={`text-[11px] mt-0.5 ${removeBgModelId === m.id ? 'text-black/60' : isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>
                          {m.description} · {m.size}
                        </div>
                      </div>
                      {removeBgModelId === m.id && (
                        <Check size={16} className="flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
                {/* Footer with confirm */}
                <div className={`px-4 py-3 border-t ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#444] bg-[#222]'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>当前选择:</span>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-blue-600' : 'text-gold'}`}>
                      {removeBgModels.find(m => m.id === removeBgModelId)?.label || removeBgModelId}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setShowRemoveBgPicker(false);
                      handleRemoveBackground();
                    }}
                    className={`w-full py-2.5 text-sm font-semibold rounded-xl active:scale-[0.98] transition-all ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'}`}
                  >
                    开始去背景
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ====== EXPAND PREVIEW OVERLAY + DRAG HANDLES ====== */}
        {editMode === 'expand' && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgSX = editImg.x * zoom + viewOffset.x;
          const imgSY = editImg.y * zoom + viewOffset.y;
          const imgSW = editImg.width * zoom;
          const imgSH = editImg.height * zoom;

          // Scale factor: display pixels → original pixels
          const scaleX = (editImg.originalWidth || Math.round(editImg.width)) / editImg.width;
          const scaleY = (editImg.originalHeight || Math.round(editImg.height)) / editImg.height;

          // Padding in screen pixels
          const padTop = expandPadding.top * zoom / scaleY;
          const padRight = expandPadding.right * zoom / scaleX;
          const padBottom = expandPadding.bottom * zoom / scaleY;
          const padLeft = expandPadding.left * zoom / scaleX;

          // Total expanded area bounds (screen coords)
          const expX = imgSX - padLeft;
          const expY = imgSY - padTop;
          const expW = imgSW + padLeft + padRight;
          const expH = imgSH + padTop + padBottom;

          // Handle size
          const hs = 10;
          const hColor = '#d4af37';

          // Handle definitions: position, cursor, direction flags
          const handles = [
            { id: 'top',          cx: expX + expW / 2, cy: expY,            cursor: 'ns-resize',  dir: 'top' },
            { id: 'bottom',       cx: expX + expW / 2, cy: expY + expH,     cursor: 'ns-resize',  dir: 'bottom' },
            { id: 'left',         cx: expX,            cy: expY + expH / 2, cursor: 'ew-resize',  dir: 'left' },
            { id: 'right',        cx: expX + expW,     cy: expY + expH / 2, cursor: 'ew-resize',  dir: 'right' },
            { id: 'top-left',     cx: expX,            cy: expY,            cursor: 'nwse-resize', dir: 'top-left' },
            { id: 'top-right',    cx: expX + expW,     cy: expY,            cursor: 'nesw-resize', dir: 'top-right' },
            { id: 'bottom-left',  cx: expX,            cy: expY + expH,     cursor: 'nesw-resize', dir: 'bottom-left' },
            { id: 'bottom-right', cx: expX + expW,     cy: expY + expH,     cursor: 'nwse-resize', dir: 'bottom-right' },
          ];

          // Padding dimension label positions (midpoint of each padding edge)
          const dimLabels = [
            { key: 'top',   x: imgSX + imgSW / 2, y: imgSY - padTop / 2,  val: expandPadding.top,    show: expandPadding.top > 0 },
            { key: 'bottom',x: imgSX + imgSW / 2, y: imgSY + imgSH + padBottom / 2, val: expandPadding.bottom, show: expandPadding.bottom > 0 },
            { key: 'left',  x: imgSX - padLeft / 2, y: imgSY + imgSH / 2,  val: expandPadding.left,   show: expandPadding.left > 0 },
            { key: 'right', x: imgSX + imgSW + padRight / 2, y: imgSY + imgSH / 2, val: expandPadding.right,  show: expandPadding.right > 0 },
          ];

          return (
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 45 }}>
              {/* Semi-transparent padding areas */}
              {/* Top padding */}
              {expandPadding.top > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: expX, top: expY,
                    width: expW, height: padTop,
                    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(212,175,55,0.12) 4px, rgba(212,175,55,0.12) 8px)',
                    border: '1px dashed rgba(212,175,55,0.5)',
                    borderBottom: 'none',
                  }}
                />
              )}
              {/* Bottom padding */}
              {expandPadding.bottom > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: expX, top: imgSY + imgSH,
                    width: expW, height: padBottom,
                    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(212,175,55,0.12) 4px, rgba(212,175,55,0.12) 8px)',
                    border: '1px dashed rgba(212,175,55,0.5)',
                    borderTop: 'none',
                  }}
                />
              )}
              {/* Left padding */}
              {expandPadding.left > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: expX, top: expY,
                    width: padLeft, height: expH,
                    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(212,175,55,0.12) 4px, rgba(212,175,55,0.12) 8px)',
                    border: '1px dashed rgba(212,175,55,0.5)',
                    borderRight: 'none',
                  }}
                />
              )}
              {/* Right padding */}
              {expandPadding.right > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: imgSX + imgSW, top: expY,
                    width: padRight, height: expH,
                    background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(212,175,55,0.12) 4px, rgba(212,175,55,0.12) 8px)',
                    border: '1px dashed rgba(212,175,55,0.5)',
                    borderLeft: 'none',
                  }}
                />
              )}

              {/* Outer border of expanded area */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: expX, top: expY,
                  width: expW, height: expH,
                  border: `2px solid ${hColor}`,
                }}
              />

              {/* Original image border highlight */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: imgSX, top: imgSY,
                  width: imgSW, height: imgSH,
                  border: '1.5px solid rgba(212,175,55,0.7)',
                }}
              />

              {/* Padding dimension labels */}
              {dimLabels.filter(d => d.show).map(d => (
                <div
                  key={d.key}
                  className="absolute pointer-events-none flex items-center justify-center"
                  style={{
                    left: d.x, top: d.y,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(0,0,0,0.8)', color: hColor, whiteSpace: 'nowrap' }}
                  >
                    +{d.val}px
                  </span>
                </div>
              ))}

              {/* Drag handles */}
              {handles.map(h => (
                <div
                  key={h.id}
                  className="absolute pointer-events-auto"
                  style={{
                    left: h.cx - hs / 2,
                    top: h.cy - hs / 2,
                    width: hs,
                    height: hs,
                    cursor: h.cursor,
                    zIndex: 46,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startPad = { ...expandPaddingRef.current };

                    const onMove = (ev: MouseEvent) => {
                      ev.preventDefault();
                      const dx = ev.clientX - startX;
                      const dy = ev.clientY - startY;
                      // Convert screen pixels to original pixels
                      const origDx = Math.round(dx / zoom * scaleX);
                      const origDy = Math.round(dy / zoom * scaleY);
                      // Step to nearest 8px for cleaner values
                      const stepDx = Math.round(origDx / 8) * 8;
                      const stepDy = Math.round(origDy / 8) * 8;

                      const newPad = { ...startPad };
                      if (h.dir.includes('top'))    newPad.top    = Math.max(0, startPad.top    - stepDy);
                      if (h.dir.includes('bottom')) newPad.bottom = Math.max(0, startPad.bottom + stepDy);
                      if (h.dir.includes('left'))   newPad.left   = Math.max(0, startPad.left   - stepDx);
                      if (h.dir.includes('right'))  newPad.right  = Math.max(0, startPad.right  + stepDx);

                      // Clamp max total dimension to 4096
                      const ow = (editImg?.originalWidth || Math.round(editImg?.width || 512));
                      const oh = (editImg?.originalHeight || Math.round(editImg?.height || 512));
                      const maxDim = 4096;
                      newPad.right  = Math.min(newPad.right,  maxDim - ow - newPad.left);
                      newPad.bottom = Math.min(newPad.bottom, maxDim - oh - newPad.top);
                      newPad.left   = Math.min(newPad.left,   maxDim - ow - newPad.right);
                      newPad.top    = Math.min(newPad.top,    maxDim - oh - newPad.bottom);

                      expandPaddingRef.current = newPad;
                      setExpandPadding(newPad);
                    };
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                >
                  {/* Inner handle visual */}
                  <div
                    className="w-full h-full rounded-sm"
                    style={{
                      background: h.dir.includes('-')
                        ? `linear-gradient(135deg, ${hColor} 30%, rgba(212,175,55,0.6) 30%, rgba(212,175,55,0.6) 70%, ${hColor} 70%)`
                        : hColor,
                      boxShadow: '0 0 6px rgba(212,175,55,0.5)',
                      border: '1px solid rgba(255,255,255,0.3)',
                    }}
                  />
                </div>
              ))}

              {/* Edge drag zones (thin strips for easier edge dragging) */}
              {[
                { id: 'edge-top',    x: expX + hs, y: expY - 4,             w: expW - hs * 2, h: 8, cursor: 'ns-resize',  dir: 'top' },
                { id: 'edge-bottom', x: expX + hs, y: expY + expH - 4,      w: expW - hs * 2, h: 8, cursor: 'ns-resize',  dir: 'bottom' },
                { id: 'edge-left',   x: expX - 4,  y: expY + hs,            w: 8, h: expH - hs * 2, cursor: 'ew-resize', dir: 'left' },
                { id: 'edge-right',  x: expX + expW - 4, y: expY + hs,      w: 8, h: expH - hs * 2, cursor: 'ew-resize', dir: 'right' },
              ].map(edge => (
                <div
                  key={edge.id}
                  className="absolute pointer-events-auto"
                  style={{
                    left: edge.x, top: edge.y,
                    width: edge.w, height: edge.h,
                    cursor: edge.cursor,
                    zIndex: 45,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startPad = { ...expandPaddingRef.current };

                    const onMove = (ev: MouseEvent) => {
                      ev.preventDefault();
                      const dx = ev.clientX - startX;
                      const dy = ev.clientY - startY;
                      const origDx = Math.round(dx / zoom * scaleX);
                      const origDy = Math.round(dy / zoom * scaleY);
                      const stepDx = Math.round(origDx / 8) * 8;
                      const stepDy = Math.round(origDy / 8) * 8;

                      const newPad = { ...startPad };
                      if (edge.dir === 'top')    newPad.top    = Math.max(0, startPad.top    - stepDy);
                      if (edge.dir === 'bottom') newPad.bottom = Math.max(0, startPad.bottom + stepDy);
                      if (edge.dir === 'left')   newPad.left   = Math.max(0, startPad.left   - stepDx);
                      if (edge.dir === 'right')  newPad.right  = Math.max(0, startPad.right  + stepDx);

                      const ow = (editImg?.originalWidth || Math.round(editImg?.width || 512));
                      const oh = (editImg?.originalHeight || Math.round(editImg?.height || 512));
                      const maxDim = 4096;
                      if (edge.dir === 'top' || edge.dir === 'bottom') {
                        const maxPad = maxDim - oh;
                        if (edge.dir === 'top')    newPad.top    = Math.min(newPad.top, maxPad);
                        if (edge.dir === 'bottom') newPad.bottom = Math.min(newPad.bottom, maxPad);
                      } else {
                        const maxPad = maxDim - ow;
                        if (edge.dir === 'left')  newPad.left  = Math.min(newPad.left, maxPad);
                        if (edge.dir === 'right') newPad.right = Math.min(newPad.right, maxPad);
                      }

                      expandPaddingRef.current = newPad;
                      setExpandPadding(newPad);
                    };
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                />
              ))}
            </div>
          );
        })()}

        {/* ====== EXPAND/CROP FLOATING TOOLBARS ====== */}
        {(editMode === 'expand' || editMode === 'crop') && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgScreenX = editImg.x * zoom + viewOffset.x;
          const imgScreenY = editImg.y * zoom + viewOffset.y;
          const imgScreenW = editImg.width * zoom;
          const panelX = imgScreenX + imgScreenW / 2;
          const panelY = imgScreenY - 8;

          return (
            <div
              className="absolute z-50 pointer-events-auto"
              data-toolbar="edit-mode"
              style={{ left: panelX, top: panelY, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {editMode === 'expand' && (
                <div className={panelBaseClass} style={{ minWidth: 360 }} onMouseDown={(e) => e.stopPropagation()}>
                  <Expand size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                  <span className={panelLabelClass}>扩图</span>
                  <div className={panelDividerClass} />
                  {/* 比例快捷按钮 */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {[
                      { label: '1:1', w: 1, h: 1 },
                      { label: '4:3', w: 4, h: 3 },
                      { label: '3:4', w: 3, h: 4 },
                      { label: '16:9', w: 16, h: 9 },
                      { label: '9:16', w: 9, h: 16 },
                      { label: '3:2', w: 3, h: 2 },
                      { label: '2:3', w: 2, h: 3 },
                      { label: '21:9', w: 21, h: 9 },
                    ].map(r => (
                      <button
                        key={r.label}
                        onClick={() => handleExpandToRatio(r.w, r.h)}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${
                          isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <div className={panelDividerClass} />
                  {/* 快捷扩展按钮 */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleExpandEqualPadding(256)}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                      }`}
                    >
                      +256
                    </button>
                    <button
                      onClick={() => handleExpandEqualPadding(512)}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                      }`}
                    >
                      +512
                    </button>
                  </div>
                  <div className={panelDividerClass} />
                  {/* 扩展尺寸信息 */}
                  <span className="text-xs text-gold-muted whitespace-nowrap">
                    {(() => {
                      const editImg2 = images.find(i => i.id === editImageId);
                      if (!editImg2) return '';
                      const ow = editImg2.originalWidth || Math.round(editImg2.width);
                      const oh = editImg2.originalHeight || Math.round(editImg2.height);
                      const tw = ow + expandPadding.left + expandPadding.right;
                      const th = oh + expandPadding.top + expandPadding.bottom;
                      return `${ow}×${oh} → ${tw}×${th}`;
                    })()}
                  </span>
                  <div className={panelDividerClass} />
                  <button
                    onClick={handleEditConfirm}
                    disabled={expandPadding.top + expandPadding.right + expandPadding.bottom + expandPadding.left === 0}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      expandPadding.top + expandPadding.right + expandPadding.bottom + expandPadding.left === 0
                        ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-gold-muted/50 cursor-not-allowed'
                        : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'
                    }`}
                  >
                    确认扩展
                  </button>
                  <button onClick={() => { setExpandPadding({ top: 0, right: 0, bottom: 0, left: 0 }); expandPaddingRef.current = { top: 0, right: 0, bottom: 0, left: 0 }; }} className={panelCancelBtnClass}>重置</button>
                  <button onClick={exitEditMode} className={panelCancelBtnClass}>取消</button>
                </div>
              )}

              {/* CROP toolbar */}
              {editMode === 'crop' && (
                <div className={panelBaseClass} style={{ minWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
                  <Scissors size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                  <span className={panelLabelClass}>裁切</span>
                  <div className={panelDividerClass} />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCropRatio('free')}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        cropRatio === 'free'
                          ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                          : isMonochrome
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                      }`}
                    >
                      自由
                    </button>
                    {ratioOptions.slice(0, 4).map(r => (
                      <button
                        key={r}
                        onClick={() => setCropRatio(r)}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${
                          cropRatio === r
                            ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-gold text-black font-medium'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowCropRatios(!showCropRatios); }}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'}`}
                      >
                        <ChevronDown size={10} />
                      </button>
                      {showCropRatios && (
                        <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1e1e1e] border-[#444]'}`}>
                          {ratioOptions.slice(4).map(r => (
                            <button key={r} onClick={(e) => { e.stopPropagation(); setCropRatio(r); setShowCropRatios(false); }} className={`w-full px-3 py-1.5 text-xs text-left hover:bg-gold/10 ${cropRatio === r ? 'text-gold' : isMonochrome ? 'text-gray-600' : 'text-text-bright'}`}>
                              {r} {cropRatio === r && '✓'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={panelDividerClass} />
                  <div className="flex items-center gap-1">
                    <span className={panelSmallLabelClass}>W</span>
                    <input
                      type="number"
                      value={Math.round(cropRect?.w || 0)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (cropRect) setCropRect({ ...cropRect, w: val });
                      }}
                      className={panelInputClass}
                    />
                    <span className={panelSmallLabelClass}>H</span>
                    <input
                      type="number"
                      value={Math.round(cropRect?.h || 0)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (cropRect) setCropRect({ ...cropRect, h: val });
                      }}
                      className={panelInputClass}
                    />
                  </div>
                  <div className={panelDividerClass} />
                  <button onClick={handleEditConfirm} className={panelBtnClass}>确认裁切</button>
                  <button onClick={exitEditMode} className={panelCancelBtnClass}>取消</button>
                </div>
              )}

              <div className={`text-center mt-1`}>
                <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>Esc 退出</span>
              </div>
            </div>
          );
        })()}

        {/* ====== ANNOTATION PIN SVG OVERLAY ====== */}
        {annotations.length > 0 && (
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: '100%', height: '100%', overflow: 'visible' }}
          >
            {annotations.map((ann, idx) => {
              const sx = ann.x * zoom + viewOffset.x;
              const sy = ann.y * zoom + viewOffset.y;
              const statusColors: Record<string, string> = {
                pending: isMonochrome ? '#3b82f6' : '#d4af37',
                running: isMonochrome ? '#60a5fa' : '#f0c040',
                done: '#22c55e',
                failed: '#ef4444',
              };
              const fillColor = statusColors[ann.status] || statusColors.pending;
              const isHovered = hoveredAnnotationId === ann.id;
              return (
                <g key={ann.id} className="pointer-events-auto" style={{ cursor: 'pointer' }}
                   onClick={(e) => {
                     e.stopPropagation();
                     setHoveredAnnotationId(ann.id);
                     // Toggle chat bubble expansion on click
                     if (ann.text && ann.status !== 'pending') {
                       setAnnotations(prev => prev.map(a =>
                         a.id === ann.id ? { ...a, chatExpanded: !a.chatExpanded } : a
                       ));
                     }
                   }}
                >
                  {/* Pin dot */}
                  <circle cx={sx} cy={sy} r={isHovered ? 10 : 7} fill={fillColor} stroke={isMonochrome ? '#fff' : '#1a1a1a'} strokeWidth={2} style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))' }} />
                  {/* Number label */}
                  <text x={sx} y={sy + 1} textAnchor="middle" dominantBaseline="central" fill={ann.status === 'done' ? '#fff' : isMonochrome ? '#fff' : '#1a1a1a'} fontSize={9} fontWeight="bold" fontFamily="system-ui">{idx + 1}</text>
                  {/* Running spinner ring + pulse animation */}
                  {ann.status === 'running' && (
                    <>
                      <circle cx={sx} cy={sy} r={11} fill="none" stroke={fillColor} strokeWidth={2} strokeDasharray="4 4" className="animate-spin" style={{ transformOrigin: `${sx}px ${sy}px` }} />
                      {/* Pulse glow */}
                      <circle cx={sx} cy={sy} r={14} fill={fillColor} opacity={0.2} className="animate-pulse" />
                      {/* Progress label */}
                      <text x={sx} y={sy + 22} textAnchor="middle" fill={fillColor} fontSize={9} fontFamily="system-ui" opacity={0.8}>处理中...</text>
                    </>
                  )}
                  {/* Hover tooltip with text */}
                  {isHovered && ann.text && (
                    <g>
                      <rect x={sx + 12} y={sy - 14} width={Math.min(ann.text.length * 8 + 16, 200)} height={28} rx={6} fill={isMonochrome ? '#1e293b' : '#1a1a1a'} stroke={isMonochrome ? '#3b82f6' : '#d4af37'} strokeWidth={1} opacity={0.95} />
                      <text x={sx + 20} y={sy + 2} fill={isMonochrome ? '#e2e8f0' : '#f5f0e0'} fontSize={11} fontFamily="system-ui">{ann.text.length > 20 ? ann.text.slice(0, 20) + '…' : ann.text}</text>
                    </g>
                  )}
                  {/* Region rectangle */}
                  {ann.region && (() => {
                    // Region is normalized (0~1) relative to target image — convert back to canvas coords then screen
                    const hitImg = ann.targetImageId ? images.find(i => i.id === ann.targetImageId) : null;
                    if (!hitImg || !ann.region) return null;
                    const rx = (hitImg.x + ann.region.x * hitImg.width) * zoom + viewOffset.x;
                    const ry = (hitImg.y + ann.region.y * hitImg.height) * zoom + viewOffset.y;
                    const rw = ann.region.w * hitImg.width * zoom;
                    const rh = ann.region.h * hitImg.height * zoom;
                    return (
                      <rect x={rx} y={ry} width={rw} height={rh} fill="none" stroke={fillColor} strokeWidth={1.5} strokeDasharray="6 3" rx={2} opacity={0.7} />
                    );
                  })()}
                  {/* Done checkmark */}
                  {ann.status === 'done' && (
                    <text x={sx} y={sy + 1} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={10} fontWeight="bold" fontFamily="system-ui">✓</text>
                  )}
                </g>
              );
            })}
            {/* Selection drag rectangle (while drawing) */}
            {isDraggingRegion && annotationRegionStart && annotationRegionCurrent && (() => {
              const x1 = Math.min(annotationRegionStart.cx, annotationRegionCurrent.cx) * zoom + viewOffset.x;
              const y1 = Math.min(annotationRegionStart.cy, annotationRegionCurrent.cy) * zoom + viewOffset.y;
              const w = Math.abs(annotationRegionCurrent.cx - annotationRegionStart.cx) * zoom;
              const h = Math.abs(annotationRegionCurrent.cy - annotationRegionStart.cy) * zoom;
              return (
                <rect x={x1} y={y1} width={w} height={h} fill={isMonochrome ? 'rgba(59,130,246,0.1)' : 'rgba(212,175,55,0.1)'} stroke={isMonochrome ? '#3b82f6' : '#d4af37'} strokeWidth={1.5} strokeDasharray="6 3" rx={2} />
              );
            })()}
            {/* Live brush stroke preview while drawing (clipped to target image) */}
            {brushStrokes.length > 1 && (() => {
              const ann = brushDrawingAnnId ? annotations.find(a => a.id === brushDrawingAnnId) : null;
              const targetImg = ann?.targetImageId ? images.find(i => i.id === ann.targetImageId) : null;
              const pathD = brushStrokes.map((p, i) => i === 0 ? `M${p.x} ${p.y}` : `L${p.x} ${p.y}`).join(' ');
              const clipId = `brush-clip-${brushDrawingAnnId || 'live'}`;
              if (targetImg) {
                const imgSx = targetImg.x * zoom + viewOffset.x;
                const imgSy = targetImg.y * zoom + viewOffset.y;
                const imgSw = targetImg.width * zoom;
                const imgSh = targetImg.height * zoom;
                return (
                  <g>
                    <defs><clipPath id={clipId}><rect x={imgSx} y={imgSy} width={imgSw} height={imgSh} /></clipPath></defs>
                    <path d={pathD} fill="none" stroke={annotationBrushColor} strokeWidth={annotationBrushSize} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} clipPath={`url(#${clipId})`} />
                  </g>
                );
              }
              return (
                <path d={pathD} fill="none" stroke={annotationBrushColor} strokeWidth={annotationBrushSize} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
              );
            })()}
          </svg>
        )}

        {/* ====== ANNOTATION INPUT POPUP ====== */}
        {editingAnnotationId && (() => {
          const ann = annotations.find(a => a.id === editingAnnotationId);
          if (!ann) return null;
          const panelLeft = Math.max(16, (window.innerWidth - 280) / 2);
          const panelTop = Math.max(60, (window.innerHeight - 260) / 2);
          return (
            <div
              className={`absolute z-[60] pointer-events-auto ${isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-gold/30'} rounded-xl shadow-2xl`}
              style={{ left: panelLeft, top: panelTop, width: 280 }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="p-3">
                <div className={`text-xs font-medium mb-2 ${isMonochrome ? 'text-gray-500' : 'text-gold-muted/70'}`}>
                  批注 #{annotations.indexOf(ann) + 1}
                </div>
                <textarea
                  ref={annotationInputRef}
                  value={annotationInputText}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAnnotationInputText(val);
                    const cursorPos = e.target.selectionStart ?? val.length;
                    const textBefore = val.slice(0, cursorPos);
                    const atMatch = textBefore.match(/@([^@\s]*)$/);
                    if (atMatch) {
                      setAnnAtPickerOpen(true);
                      setAnnAtFilter(atMatch[1]);
                      setAnnAtHighlightIdx(0);
                    } else {
                      setAnnAtPickerOpen(false);
                      setAnnAtFilter('');
                    }
                  }}
                  onKeyDown={(e) => {
                    if (annAtPickerOpen && annAtPickerItems.length > 0) {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setAnnAtHighlightIdx(i => (i + 1) % annAtPickerItems.length); return; }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setAnnAtHighlightIdx(i => (i - 1 + annAtPickerItems.length) % annAtPickerItems.length); return; }
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAnnAtSelect(annAtPickerItems[annAtHighlightIdx]); return; }
                      if (e.key === 'Escape') { setAnnAtPickerOpen(false); setAnnAtFilter(''); return; }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitAnnotationInput();
                    }
                    if (e.key === 'Escape') {
                      setEditingAnnotationId(null);
                      setAnnotationInputText('');
                    }
                  }}
                  placeholder="描述修改... 输入@引用画布图片"
                  className={`w-full h-20 resize-none rounded-lg px-3 py-2 text-sm ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-400' : 'bg-[#2a2a2a] border border-[#444] text-text-bright placeholder:text-gold-muted/40 focus:border-gold/50'} border focus:outline-none`}
                />
                {/* @图片下拉菜单 */}
                {annAtPickerOpen && annAtPickerItems.length > 0 && (
                  <div className={`absolute left-3 right-3 bottom-14 z-[70] max-h-48 overflow-y-auto rounded-xl border ${isMonochrome ? 'bg-white border-gray-200 shadow-lg' : 'bg-[#1a1a1a] border-gold/30 shadow-[0_0_20px_rgba(212,175,55,0.15)]'}`}>
                    <div className={`px-2 py-1.5 text-[10px] font-medium ${isMonochrome ? 'text-gray-400 border-b border-gray-100' : 'text-gold-muted/50 border-b border-[#333]'}`}>选择画布图片</div>
                    {annAtPickerItems.map((item, i) => (
                      <div
                        key={item.id}
                        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${i === annAtHighlightIdx ? (isMonochrome ? 'bg-blue-50' : 'bg-gold/10') : (isMonochrome ? 'hover:bg-gray-50' : 'hover:bg-white/5')}`}
                        onClick={() => handleAnnAtSelect(item)}
                        onMouseEnter={() => setAnnAtHighlightIdx(i)}
                      >
                        <div className="w-8 h-8 rounded overflow-hidden shrink-0 border border-white/10">
                          <NextImage unoptimized width={1} height={1} src={item.url} alt={item.label || '参考图片'} className="w-full h-full object-cover" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-medium truncate ${isMonochrome ? 'text-gray-800' : 'text-text-bright'}`}>{item.label}</div>
                          {item.desc && <div className={`text-[10px] truncate ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/50'}`}>{item.desc}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/50'}`}>Enter 提交 · Esc 取消</span>
                  <button
                    onClick={submitAnnotationInput}
                    disabled={!annotationInputText.trim()}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      !annotationInputText.trim()
                        ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-gold-muted/40 cursor-not-allowed'
                        : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'
                    }`}
                  >
                    提交
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ====== ANNOTATION DIALOG BUBBLES ====== */}
        {/* Show inline bubble for any annotation that is clicked/expanded */}
        {annotations.filter(a => a.chatExpanded || a.status === 'running' || a.status === 'pending' || a.status === 'done').map(ann => {
          const sx = ann.x * zoom + viewOffset.x;
          const sy = ann.y * zoom + viewOffset.y;
          const isFollowUpOpen = followUpInputId === ann.id;
          return (
            <div
              key={`bubble-${ann.id}`}
              className="absolute z-[59] pointer-events-auto"
              style={{ left: sx + 16, top: sy - 10, maxWidth: 260 }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {/* AI Reply / Status Bubble */}
              <div
                className={`rounded-xl shadow-lg transition-all ${isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-gold/30'}`}
              >
                <div className="p-2.5">
                  {/* Running status */}
                  {ann.status === 'running' && (
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full border-2 ${isMonochrome ? 'border-blue-500' : 'border-gold'} border-t-transparent animate-spin`} />
                      <span className={`text-xs ${isMonochrome ? 'text-gray-600' : 'text-text-bright/70'}`}>AI 正在处理...</span>
                    </div>
                  )}
                  {/* Failed status */}
                  {ann.status === 'failed' && (
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-red-500`} />
                      <div>
                        <div className={`text-xs ${isMonochrome ? 'text-red-600' : 'text-red-400'}`}>{ann.aiReply || '修改失败'}</div>
                        <button
                          onClick={() => {
                            setAnnotations(prev => prev.map(a => a.id === ann.id ? { ...a, status: 'pending' as const, aiReply: undefined } : a));
                          }}
                          className={`text-[10px] mt-1 ${isMonochrome ? 'text-blue-500 hover:text-blue-600' : 'text-gold hover:text-gold-light'}`}
                        >
                          重试
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Done status with AI reply */}
                  {ann.status === 'done' && ann.aiReply && (
                    <>
                      <div className="flex items-start gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isMonochrome ? 'bg-blue-400' : 'bg-gold'}`} />
                        <div className={`text-xs leading-relaxed flex-1 ${isMonochrome ? 'text-gray-700' : 'text-text-bright/80'}`}>
                          {ann.aiReply}
                        </div>
                        <button
                          onClick={() => {
                            setAnnotations(prev => prev.map(a =>
                              a.id === ann.id ? { ...a, chatExpanded: false } : a
                            ));
                          }}
                          className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full ${isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-gold-muted/50 hover:text-gold hover:bg-gold/10'}`}
                          title="关闭"
                        >
                          ✕
                        </button>
                      </div>
                      {/* Compare button - open built-in image comparison dialog */}
                      {ann.originalImageUrl && ann.resultImageUrl && (
                        <button
                          onClick={() => {
                            // Find the image objects for original and result
                            const origImg = images.find(i => i.url === ann.originalImageUrl);
                            const resultImg = images.find(i => i.url === ann.resultImageUrl);
                            setCompareImages({
                              left: (origImg || { id: `ann-orig-${ann.id}`, url: ann.originalImageUrl, prompt: ann.text || '', x: 0, y: 0, width: 512, height: 512 }) as CanvasImage,
                              right: (resultImg || { id: `ann-result-${ann.id}`, url: ann.resultImageUrl, prompt: ann.aiReply || '', x: 0, y: 0, width: 512, height: 512 }) as CanvasImage,
                            });
                            setShowCompareDialog(true);
                          }}
                          className={`text-[10px] mt-1.5 flex items-center gap-1 ${isMonochrome ? 'text-blue-500 hover:text-blue-600' : 'text-gold hover:text-gold-light'}`}
                        >
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="2" width="6" height="12" rx="1"/><rect x="9" y="2" width="6" height="12" rx="1"/></svg>
                          前后对比
                        </button>
                      )}
                      {/* Follow-up history */}
                      {ann.followUpHistory && ann.followUpHistory.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {ann.followUpHistory.map((fu, i) => (
                            <div key={i} className="ml-3.5">
                              <div className={`text-xs ${isMonochrome ? 'text-blue-500' : 'text-gold/70'}`}>↪ {fu.role === 'user' ? fu.content : ''}</div>
                              <div className={`text-xs mt-0.5 ${isMonochrome ? 'text-gray-600' : 'text-text-bright/60'}`}>{fu.role === 'assistant' ? fu.content : ''}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {/* Pending status with text */}
                  {ann.status === 'pending' && ann.text && (
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isMonochrome ? 'bg-blue-400' : 'bg-gold'}`} />
                      <div className={`text-xs leading-relaxed ${isMonochrome ? 'text-gray-700' : 'text-text-bright/80'}`}>
                        {ann.text}
                      </div>
                    </div>
                  )}
                  <div className={`text-xs mt-1.5 ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/40'}`}>
                    {ann.status === 'done' && (isFollowUpOpen ? '收起' : '点击追问')}
                    {ann.status === 'pending' && '等待执行'}
                  </div>
                </div>
              </div>

              {/* Follow-up Input (only for done annotations) */}
              {isFollowUpOpen && ann.status === 'done' && (
                <div className={`mt-1 rounded-xl shadow-lg ${isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-gold/30'}`}>
                  <div className="p-2.5">
                    <textarea
                      value={followUpInputText}
                      onChange={(e) => setFollowUpInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAnnotationFollowUp(ann.id, followUpInputText);
                          setFollowUpInputId(null);
                          setFollowUpInputText('');
                        }
                        if (e.key === 'Escape') {
                          setFollowUpInputId(null);
                          setFollowUpInputText('');
                        }
                      }}
                      placeholder="继续追问..."
                      className={`w-full h-14 resize-none rounded-lg px-2.5 py-1.5 text-xs ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-400' : 'bg-[#2a2a2a] border border-[#444] text-text-bright placeholder:text-gold-muted/40 focus:border-gold/50'} border focus:outline-none`}
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/50'}`}>Enter 发送</span>
                      <button
                        onClick={() => {
                          handleAnnotationFollowUp(ann.id, followUpInputText);
                          setFollowUpInputId(null);
                          setFollowUpInputText('');
                        }}
                        disabled={!followUpInputText.trim()}
                        className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-all ${
                          !followUpInputText.trim()
                            ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-gold-muted/40 cursor-not-allowed'
                            : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'
                        }`}
                      >
                        发送
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Before/After Comparison Overlay */}
              {ann.showComparison && ann.originalImageUrl && ann.resultImageUrl && (
                <div className={`mt-1 rounded-xl shadow-lg overflow-hidden ${isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-gold/30'}`}>
                  <div className="grid grid-cols-2 gap-0.5 p-1">
                    <div className="relative">
                      <NextImage unoptimized width={1} height={1} src={ann.originalImageUrl} alt="原图" className="w-full h-20 object-cover rounded" />
                      <span className={`absolute bottom-0.5 left-0.5 text-[9px] px-1 py-0.5 rounded ${isMonochrome ? 'bg-white/80 text-gray-600' : 'bg-black/60 text-gold'}`}>原图</span>
                    </div>
                    <div className="relative">
                      <NextImage unoptimized width={1} height={1} src={ann.resultImageUrl} alt="结果" className="w-full h-20 object-cover rounded" />
                      <span className={`absolute bottom-0.5 left-0.5 text-[9px] px-1 py-0.5 rounded ${isMonochrome ? 'bg-blue-500/80 text-white' : 'bg-gold/80 text-black'}`}>结果</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* ====== ANNOTATION MODE BANNER ====== */}
        {annotationMode && (
          <div
            data-toolbar="annotation-tools"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={`absolute top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2 rounded-xl shadow-lg ${isMonochrome ? 'bg-white border border-blue-200' : 'bg-[#1a1a1a] border border-gold/30'}`}
          >
            <MessageCircle size={16} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
            <span className={`text-sm font-medium ${isMonochrome ? 'text-gray-700' : 'text-text-bright'}`}>批注模式</span>
            {/* Tool selector */}
            <div className={`flex items-center gap-1 ml-1 ${isMonochrome ? 'bg-gray-100' : 'bg-[#2a2a2a]'} rounded-lg p-0.5`}>
              {([
                { key: 'pin' as const, label: 'Pin', shortcut: 'C' },
                { key: 'region' as const, label: '框选', shortcut: 'R' },
                { key: 'brush' as const, label: '画笔', shortcut: 'B' },
              ]).map(tool => (
                <button
                  key={tool.key}
                  onClick={() => setAnnotationTool(tool.key)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
                    annotationTool === tool.key
                      ? isMonochrome ? 'bg-blue-500 text-white shadow-sm' : 'bg-gold text-black shadow-sm'
                      : isMonochrome ? 'text-gray-500 hover:text-gray-700' : 'text-gold-muted/60 hover:text-gold-muted'
                  }`}
                >
                  {tool.label}
                </button>
              ))}
            </div>
            {/* Brush size slider (only in brush mode) */}
            {annotationTool === 'brush' && (
              <div className="flex items-center gap-1.5 ml-1">
                <span className={`text-[10px] ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/50'}`}>大小</span>
                <input
                  type="range"
                  min={5}
                  max={80}
                  value={annotationBrushSize}
                  onChange={(e) => setAnnotationBrushSize(Number(e.target.value))}
                  className="w-16 h-1 accent-current"
                />
                <span className={`text-[10px] w-5 text-right ${isMonochrome ? 'text-gray-500' : 'text-gold-muted/60'}`}>{annotationBrushSize}</span>
              </div>
            )}
            {/* Brush color picker (only in brush mode) */}
            {annotationTool === 'brush' && (
              <div className="flex items-center gap-1 ml-1">
                <span className={`text-[10px] ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/50'}`}>颜色</span>
                <div className="flex items-center gap-1">
                  {BRUSH_COLOR_PALETTE.map(c => (
                    <button
                      key={c}
                      onClick={() => setAnnotationBrushColor(c)}
                      className={`w-4 h-4 rounded-full border-2 transition-all ${annotationBrushColor === c ? 'border-white scale-110' : isMonochrome ? 'border-gray-300' : 'border-white/20'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className={`w-px h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-white/10'}`} />
            <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/60'}`}>Esc 退出</span>
            {annotations.filter(a => a.status === 'pending').length > 0 && (
              <>
                <div className={`w-px h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-white/10'}`} />
                <button
                  onClick={executePendingAnnotations}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'}`}
                >
                  <Play size={12} />
                  执行全部 ({annotations.filter(a => a.status === 'pending').length})
                </button>
              </>
            )}
          </div>
        )}

        {/* ====== ANNOTATION LIST PANEL ====== */}
        {annotations.length > 0 && (() => {
          const panelPos = annotationPanelPos;
          const dragging = annotationPanelDragging;
          const dragStart = annotationPanelDragStart;

          const onPointerDown = (e: React.PointerEvent) => {
            /* Only drag from header area */
            if ((e.target as HTMLElement).closest('[data-panel-body]')) return;
            dragging.current = true;
            dragStart.current = { mx: e.clientX, my: e.clientY, px: panelPos.current.x, py: panelPos.current.y };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            e.preventDefault();
          };
          const onPointerMove = (e: React.PointerEvent) => {
            if (!dragging.current) return;
            panelPos.current = {
              x: dragStart.current.px + (e.clientX - dragStart.current.mx),
              y: dragStart.current.py + (e.clientY - dragStart.current.my),
            };
            if (annotationPanelRef.current) {
              annotationPanelRef.current.style.transform = `translate(${panelPos.current.x}px, ${panelPos.current.y}px)`;
            }
          };
          const onPointerUp = () => { dragging.current = false; };

          return (
            <div
              ref={annotationPanelRef}
              style={{ transform: `translate(${panelPos.current.x}px, ${panelPos.current.y}px)` }}
              className={`absolute bottom-20 right-4 z-[60] max-w-md w-max max-h-60 rounded-xl shadow-lg ${isMonochrome ? 'bg-white border border-blue-200' : 'bg-[#1a1a1a] border border-gold/20'}`}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={`flex items-center justify-between px-3 py-2 border-b cursor-move select-none ${isMonochrome ? 'border-gray-100' : 'border-white/5'}`}
              >
                <div className="flex items-center gap-1.5">
                  <GripVertical size={12} className={isMonochrome ? 'text-gray-300' : 'text-white/20'} />
                  <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-600' : 'text-gold-muted'}`}>
                    批注 ({annotations.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {annotations.some(a => a.status === 'pending') && (
                    <button
                      onClick={executePendingAnnotations}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gold text-black hover:bg-[#e5c047]'}`}
                    >
                      <Play size={10} />
                      执行待处理
                    </button>
                  )}
                  <button
                    onClick={() => setAnnotations([])}
                    className={`p-0.5 rounded ${isMonochrome ? 'text-gray-300 hover:text-red-400' : 'text-white/20 hover:text-red-400'}`}
                    title="清空全部"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div data-panel-body="" className="overflow-y-auto max-h-44">
              {annotations.map(ann => {
                const targetImg = images.find(img => img.id === ann.targetImageId);
                return (
                  <div key={ann.id} className={`flex items-center gap-2 px-3 py-2 ${isMonochrome ? 'hover:bg-gray-50' : 'hover:bg-[#222]'} ${ann.status === 'done' ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                      if (ann.status === 'done') {
                        setAnnotations(prev => prev.map(a =>
                          a.id === ann.id ? { ...a, chatExpanded: !a.chatExpanded } : a
                        ));
                      }
                    }}
                  >
                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      ann.status === 'pending' ? (isMonochrome ? 'bg-gray-200 text-gray-600' : 'bg-gold/20 text-gold')
                      : ann.status === 'running' ? (isMonochrome ? 'bg-blue-100 text-blue-600' : 'bg-blue-500/20 text-blue-400')
                      : ann.status === 'done' ? (isMonochrome ? 'bg-green-100 text-green-600' : 'bg-green-500/20 text-green-400')
                      : (isMonochrome ? 'bg-red-100 text-red-600' : 'bg-red-500/20 text-red-400')
                    }`}>
                      {ann.status === 'running' ? '⟳' : ann.status === 'done' ? '✓' : ann.status === 'failed' ? '✗' : '#'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs truncate ${isMonochrome ? 'text-gray-700' : 'text-text-bright'}`}>{ann.text}</p>
                      {targetImg && <p className={`text-[10px] truncate ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/40'}`}>{targetImg.prompt?.slice(0,30) || '图片'}</p>}
                    </div>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                      ann.status === 'pending' ? (isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-white/5 text-gold-muted')
                      : ann.status === 'running' ? (isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-blue-500/10 text-blue-400')
                      : ann.status === 'done' ? (isMonochrome ? 'bg-green-50 text-green-600' : 'bg-green-500/10 text-green-400')
                      : (isMonochrome ? 'bg-red-50 text-red-600' : 'bg-red-500/10 text-red-400')
                    }`}>
                      {ann.status === 'pending' ? '待执行' : ann.status === 'running' ? '执行中' : ann.status === 'done' ? '已完成' : '失败'}
                    </span>
                    {ann.status === 'pending' && (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingAnnotationId(ann.id);
                        }}
                        className={`shrink-0 p-1.5 rounded z-10 relative ${isMonochrome ? 'text-gray-400 hover:text-blue-500 hover:bg-blue-50' : 'text-white/40 hover:text-gold hover:bg-gold/10'}`}
                        title="编辑批注"
                        style={{ pointerEvents: 'auto' }}
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                    {ann.status === 'pending' && (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setAnnotations(prev => prev.filter(a => a.id !== ann.id));
                        }}
                        className={`shrink-0 p-1.5 rounded z-10 relative ${isMonochrome ? 'text-gray-400 hover:text-red-500 hover:bg-red-50' : 'text-white/40 hover:text-red-400 hover:bg-red-500/20'}`}
                        title="删除此批注"
                        style={{ pointerEvents: 'auto' }}
                      >
                        <X size={14} />
                      </button>
                    )}
                    {ann.status === 'failed' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setAnnotations(prev => prev.map(a => a.id === ann.id ? { ...a, status: 'pending' as const } : a)); }}
                        className={`shrink-0 p-1 rounded ${isMonochrome ? 'text-gray-400 hover:text-blue-500 hover:bg-blue-50' : 'text-white/30 hover:text-blue-400 hover:bg-blue-500/10'}`}
                        title="重试"
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          );
        })()}

        {/* ====== IMAGE-TO-IMAGE FLOATING PANEL ====== */}
        {/* ====== MULTI-ANGLE FLOATING PANEL ====== */}
        {activeTool === 'multiAngle' && selectedImageData && editMode === 'none' && (() => {
          const pos = getToolbarPosition();
          return (
            <div
              className="absolute z-50 pointer-events-auto"
              style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className={`${panelBaseClass} flex-col !items-stretch !gap-3 !p-3 w-[300px]`} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RotateCcw size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                    <span className={panelLabelClass}>多角度</span>
                  </div>
                  <button
                    onClick={() => { setMultiAngleRotation(0); setMultiAngleTilt(0); setMultiAngleZoom(1); }}
                    className={`p-1 rounded-lg ${isMonochrome ? 'text-gray-400 hover:bg-gray-100' : 'text-[#777] hover:bg-[#252525]'}`}
                    title="重置"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>

                <div className={`grid grid-cols-2 gap-1 p-1 rounded-xl ${isMonochrome ? 'bg-gray-100' : 'bg-[#2a2a2a]'}`}>
                  {([
                    { mode: 'image' as const, label: '主体', icon: <Sparkles size={12} /> },
                    { mode: 'camera' as const, label: '摄像头', icon: <Camera size={12} /> },
                  ]).map(item => (
                    <button
                      key={item.mode}
                      onClick={() => setMultiAngleMode(item.mode)}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all ${
                        multiAngleMode === item.mode
                          ? 'bg-white text-gray-900 shadow-sm'
                          : isMonochrome ? 'text-blue-500 hover:text-blue-700' : 'text-gold-muted hover:text-white'
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>

                <div
                  className={`h-[200px] rounded-2xl overflow-hidden flex items-center justify-center select-none relative ${isMonochrome ? 'bg-gray-50' : 'bg-[#0d0d0d]'} ${isMultiAngleDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onMouseDown={handleMultiAnglePreviewMouseDown}
                  title="按住左键拖动：横向调整旋转，纵向调整倾斜"
                >
                  {multiAngleMode === 'image' ? (
                    /* CSS 3D Cube - 主体模式 */
                    <div className="w-full h-full flex items-center justify-center" style={{ perspective: '600px' }}>
                      <div
                        className="relative"
                        style={{
                          width: '110px',
                          height: '110px',
                          transformStyle: 'preserve-3d',
                          transform: `rotateX(${multiAngleTilt * 0.8}deg) rotateY(${multiAngleRotation * 1.2}deg)`,
                          transition: isMultiAngleDragging ? 'none' : 'transform 0.15s ease-out',
                        }}
                      >
                        {/* Front face - main image */}
                        <div className="absolute inset-0 rounded-lg overflow-hidden border-2 border-blue-400/60 shadow-[0_0_20px_rgba(59,130,246,0.3)]" style={{ transform: 'translateZ(55px)' }}>
                          <NextImage unoptimized width={1} height={1} src={selectedImageData.url} alt="front" className="w-full h-full object-cover" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                        </div>
                        {/* Back face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-200 border-gray-300' : 'bg-[#1e1e1e] border-[#444]'}`} style={{ transform: 'rotateY(180deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-gold-muted/50'}`}>背面</span>
                        </div>
                        {/* Right face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-white/[0.14]'}`} style={{ transform: 'rotateY(90deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>右侧</span>
                        </div>
                        {/* Left face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-white/[0.14]'}`} style={{ transform: 'rotateY(-90deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>左侧</span>
                        </div>
                        {/* Top face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-white/[0.14]'}`} style={{ transform: 'rotateX(90deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>顶部</span>
                        </div>
                        {/* Bottom face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-white/[0.14]'}`} style={{ transform: 'rotateX(-90deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>底部</span>
                        </div>
                      </div>
                      {/* Perspective hint label */}
                      <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs ${isMonochrome ? 'bg-white/80 text-gray-500 border border-gray-200' : 'bg-black/60 text-muted-foreground border border-white/10'}`}>
                        {Math.abs(multiAngleRotation) < 5 && Math.abs(multiAngleTilt) < 5 ? '正面' :
                         multiAngleTilt > 40 ? '强仰视' : multiAngleTilt > 20 ? '仰视' : multiAngleTilt > 5 ? '微仰视' :
                         multiAngleTilt < -20 ? '强俯视' : multiAngleTilt < -5 ? '俯视' :
                         multiAngleRotation > 60 ? '左侧面' : multiAngleRotation > 30 ? '左侧' : multiAngleRotation > 10 ? '微左侧' :
                         multiAngleRotation < -60 ? '右侧面' : multiAngleRotation < -30 ? '右侧' : multiAngleRotation < -10 ? '微右侧' :
                         '正面'}
                      </div>
                    </div>
                  ) : (
                    /* Canvas Sphere - 摄像头模式 */
                    <MultiAngleSpherePreview
                      imageUrl={selectedImageData.url}
                      rotation={multiAngleRotation}
                      tilt={multiAngleTilt}
                      zoom={multiAngleZoom}
                      isMonochrome={isMonochrome}
                    />
                  )}
                </div>

                <div className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${isMonochrome ? 'bg-gray-50 text-gray-500' : 'bg-[#0a0a0a]/90 text-gold-muted'}`}>
                  {multiAngleMode === 'image'
                    ? '主体模式：虚拟摄像机围绕主体环绕，整幅画面随新视角统一变化，所有元素保持空间关系不变。'
                    : '摄像头模式：虚拟摄像机在场景中移动到新位置，整幅画面随新机位统一重渲染。'}
                </div>

                {([
                  { label: '旋转', value: multiAngleRotation, min: -90, max: 90, step: 1, onChange: setMultiAngleRotation,
                    desc: multiAngleRotation === 0 ? '正面' : multiAngleRotation > 0 ? `左转${Math.abs(multiAngleRotation)}°（露出左侧）` : `右转${Math.abs(multiAngleRotation)}°（露出右侧）` },
                  { label: multiAngleMode === 'camera' ? '俯仰' : '倾斜', value: multiAngleTilt, min: -30, max: 60, step: 1, onChange: setMultiAngleTilt,
                    desc: multiAngleTilt === 0 ? '平视' : multiAngleTilt > 0 ? `仰视${Math.abs(multiAngleTilt)}°` : `俯视${Math.abs(multiAngleTilt)}°` },
                ]).map(item => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={panelLabelClass}>{item.label}</span>
                      <span className={panelSmallLabelClass}>{item.desc}</span>
                    </div>
                    <input
                      type="range"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={item.value}
                      onChange={(e) => item.onChange(Number(e.target.value))}
                      className="w-full accent-[#d4af37]"
                    />
                  </div>
                ))}

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={panelLabelClass}>{multiAngleMode === 'camera' ? '推进' : '缩放'}</span>
                    <span className={panelSmallLabelClass}>{['特写', '标准', '广角'][multiAngleZoom]}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {(['特写', '标准', '广角'] as const).map((label, idx) => (
                      <button
                        key={label}
                        onClick={() => setMultiAngleZoom(idx)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          multiAngleZoom === idx
                            ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              : 'bg-[#252525] text-gold-muted hover:bg-[#333]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleMultiAngleConfirm}
                    disabled={isMultiAngleProcessing}
                    className={`${panelBtnClass} flex-1 ${isMultiAngleProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isMultiAngleProcessing ? '生成中...' : '立即使用'}
                  </button>
                  <button onClick={() => setActiveTool('none')} className={panelCancelBtnClass}>取消</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ====== DOWNLOAD FLOATING PANEL ====== */}
        {showDownloadPopup && selectedImageData && editMode === 'none' && (() => {
          const pos = getToolbarPosition();
          return (
            <div
              className="absolute z-50 pointer-events-auto"
              data-popup="download"
              style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className={`${panelBaseClass} flex-col !items-stretch !gap-2 !p-3 min-w-[260px]`} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <Download size={14} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                  <span className={panelLabelClass}>下载</span>
                </div>

                {/* Format Selection */}
                <div className="flex flex-col gap-1">
                  {[
                    { format: 'png' as const, label: 'PNG 格式', desc: '位图格式，无损画质' },
                    { format: 'svg' as const, label: 'SVG 格式', desc: '矢量图形，可无损缩放' },
                    ...(selectedImageData?.threeDModelUrl ? [{ format: '3d' as const, label: '3D 模型', desc: '下载3D模型文件' }] : []),
                  ].map(item => (
                    <button
                      key={item.format}
                      onClick={() => setDownloadFormat(item.format)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg transition-all text-left ${
                        downloadFormat === item.format
                          ? (isMonochrome ? 'bg-blue-50 border border-blue-200' : 'bg-gold/10 border border-gold/30')
                          : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-gray-100' : 'bg-[#252525] hover:bg-[#333] border border-[#444]')
                      }`}
                    >
                      <div>
                        <div className={`text-xs font-medium ${isMonochrome ? 'text-gray-800' : 'text-white'}`}>{item.label}</div>
                        <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{item.desc}</div>
                      </div>
                      {downloadFormat === item.format && <Check size={12} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />}
                    </button>
                  ))}
                </div>

                {/* SVG Mode Selection */}
                {downloadFormat === 'svg' && (
                  <div className={`flex flex-col gap-1 pt-1 border-t ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>矢量化模式</span>
                    {([
                      { mode: 'pro' as const, label: 'Pro', desc: '分组优化，32色' },
                      { mode: 'studio' as const, label: 'Studio', desc: '形状识别+高级分组，48色' },
                    ]).map(item => (
                      <button
                        key={item.mode}
                        onClick={() => setSvgMode(item.mode)}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all text-left ${
                          svgMode === item.mode
                            ? (isMonochrome ? 'bg-blue-50 border border-blue-200' : 'bg-gold/10 border border-gold/30')
                            : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-transparent' : 'bg-[#252525] hover:bg-[#333] border border-transparent')
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-text-bright'}`}>{item.label}</span>
                          <span className={`text-xs ml-1.5 ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{item.desc}</span>
                        </div>
                        {svgMode === item.mode && <Check size={10} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />}
                      </button>
                    ))}
                  </div>
                )}

                {/* 3D Format Selection */}
                {downloadFormat === '3d' && selectedImageData?.threeDModelUrls && Object.keys(selectedImageData.threeDModelUrls).length > 0 && (
                  <div className={`flex flex-col gap-1 pt-1 border-t ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>模型格式</span>
                    {Object.entries(selectedImageData.threeDModelUrls).map(([format, ]) => (
                      <button
                        key={format}
                        onClick={() => setThreeDDownloadFormat(format)}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all text-left ${
                          threeDDownloadFormat === format
                            ? (isMonochrome ? 'bg-blue-50 border border-blue-200' : 'bg-gold/10 border border-gold/30')
                            : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-transparent' : 'bg-[#252525] hover:bg-[#333] border border-transparent')
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-medium uppercase ${isMonochrome ? 'text-gray-700' : 'text-text-bright'}`}>{format}</span>
                          <span className={`text-xs ml-1.5 ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{format === 'glb' ? 'glTF二进制格式' : format === 'obj' ? 'Wavefront格式' : format === 'stl' ? '3D打印格式' : format === 'fbx' ? 'Autodesk格式' : format === 'usdz' ? 'Apple AR格式' : '3D模型文件'}</span>
                        </div>
                        {threeDDownloadFormat === format && <Check size={10} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Progress */}
                {downloadProgress && (
                  <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${isMonochrome ? 'bg-gray-50' : 'bg-[#2a2a2a]'}`}>
                    <div className="w-3 h-3 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    <span className={`text-xs ${isMonochrome ? 'text-gray-600' : 'text-[#999]'}`}>{downloadProgress}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => { if (selectedImageData && !downloadProgress) handleDownloadImage(selectedImageData, downloadFormat); }}
                    className={`${panelBtnClass} flex-1 text-center ${downloadProgress ? 'opacity-40 cursor-not-allowed' : ''}`}
                    disabled={!!downloadProgress}
                  >
                    {downloadProgress ? '导出中...' : '确认下载'}
                  </button>
                  <button
                    onClick={() => { setShowDownloadPopup(false); setActiveTool('none'); setDownloadProgress(null); }}
                    className={panelCancelBtnClass}
                    disabled={!!downloadProgress}
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          );
        })()}



        {/* ====== IMAGE TO 3D MODAL ====== */}
        {show3DModal && (() => {
          const providers = getThreeDProviders();
          return (
            <div
              className="fixed inset-0 z-[998] flex items-center justify-center bg-[#1a1a1a]/80"
              data-modal="3d-conversion"
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              onClick={(e) => {
                if (e.target === e.currentTarget && !threeDProgress) {
                  setShow3DModal(false);
                  setActiveTool('none');
                }
              }}
            >
              <div className={`w-[560px] max-h-[90vh] overflow-hidden rounded-2xl border shadow-2xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#444]'}`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                  <div className="flex items-center gap-2">
                    <BoxIcon size={16} className={isMonochrome ? 'text-blue-500' : 'text-gold'} />
                    <div>
                      <div className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>图转3D工厂</div>
                      <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#777]'}`}>支持单图/多图/文生3D，结果在当前图片右侧生成</div>
                    </div>
                  </div>
                  <button
                    onClick={() => { if (!threeDProgress) { setShow3DModal(false); setActiveTool('none'); } }}
                    className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:bg-gray-100' : 'text-[#777] hover:bg-[#252525]'}`}
                    disabled={!!threeDProgress}
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="p-4 space-y-3 overflow-y-auto max-h-[75vh]">
                  {/* Mode tabs */}
                  <div className={`grid grid-cols-3 gap-1.5 p-1 rounded-xl ${isMonochrome ? 'bg-gray-100' : 'bg-[#0a0a0a]/90'}`}>
                    {([
                      { value: 'single-image' as const, label: '单图转3D', icon: '🖼' },
                      { value: 'multi-image' as const, label: '多图转3D', icon: '📷' },
                      { value: 'text-to-3d' as const, label: '文生3D', icon: '✏️' },
                    ]).map(item => (
                      <button
                        key={item.value}
                        onClick={() => setThreeDMode(item.value)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                          threeDMode === item.value
                            ? isMonochrome ? 'bg-blue-500 text-white shadow-sm' : 'bg-gold text-black shadow-sm'
                            : isMonochrome ? 'text-blue-500 hover:text-blue-700' : 'text-[#777] hover:text-white'
                        }`}
                      >
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Single image mode - upload / select from canvas */}
                  {threeDMode === 'single-image' && (
                    <div className="space-y-2">
                      {threeDSingleImageUrl ? (
                        <div className={`rounded-2xl overflow-hidden flex items-center justify-center p-3 relative group ${isMonochrome ? 'bg-gray-50' : 'bg-[#0a0a0a]/90'}`}>
                          <NextImage unoptimized width={1} height={1} src={threeDSingleImageUrl} alt="3D source" className="max-w-full max-h-[160px] object-contain rounded-lg" />
                          <button
                            onClick={() => setThreeDSingleImageUrl('')}
                            className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${isMonochrome ? 'bg-gray-200 text-gray-600 hover:bg-gray-300' : 'bg-black/60 text-white hover:bg-black/80'}`}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className={`rounded-2xl border-2 border-dashed flex flex-col items-center justify-center py-8 gap-3 ${isMonochrome ? 'border-gray-300 bg-gray-50' : 'border-white/20 bg-[#0a0a0a]/90'}`}>
                          <ImagePlus size={32} className={isMonochrome ? 'text-gray-400' : 'text-white/30'} />
                          <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>请选择或上传一张图片</div>
                        </div>
                      )}
                      {/* Upload and canvas-select buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = async (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (!file) return;
                              const formData = new FormData();
                              formData.append('file', file);
                              try {
                                const res = await fetch('/api/save-image', { method: 'POST', body: formData });
                                const data = await res.json();
                                if (data.url) setThreeDSingleImageUrl(data.url);
                              } catch { /* ignore */ }
                            };
                            input.click();
                          }}
                          className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${isMonochrome ? 'border-blue-200 text-blue-600 hover:bg-blue-50' : 'border-gold/30 text-gold hover:bg-gold/10'}`}
                        >
                          <Upload size={13} />
                          上传图片
                        </button>
                        <div className="relative flex-1">
                          <button
                            onClick={() => setThreeDShowCanvasPicker(!threeDShowCanvasPicker)}
                            className={`w-full py-2 rounded-xl text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${isMonochrome ? 'border-blue-200 text-blue-600 hover:bg-blue-50' : 'border-gold/30 text-gold hover:bg-gold/10'}`}
                          >
                            <LayoutGrid size={13} />
                            从画布选择
                          </button>
                          {/* Canvas image picker dropdown */}
                          {threeDShowCanvasPicker && (
                            <div className={`absolute top-full left-0 right-0 mt-1 rounded-xl border shadow-xl z-50 max-h-[200px] overflow-y-auto ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#444]'}`}>
                              {images.length === 0 ? (
                                <div className={`px-3 py-4 text-xs text-center ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>画布上暂无图片</div>
                              ) : (
                                images.map(img => (
                                  <button
                                    key={img.id}
                                    onClick={() => { setThreeDSingleImageUrl(img.url); setThreeDShowCanvasPicker(false); }}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${isMonochrome ? 'hover:bg-blue-50' : 'hover:bg-[#252525]'}`}
                                  >
                                    <NextImage unoptimized width={1} height={1} src={img.url} alt="" className="w-8 h-8 object-cover rounded-md" />
                                    <span className={`text-xs truncate flex-1 ${isMonochrome ? 'text-gray-700' : 'text-white/80'}`}>{img.prompt || '未命名图片'}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Multi-image mode - view slots */}
                  {threeDMode === 'multi-image' && (
                    <div className="space-y-2">
                      <div className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>
                        上传同一物体不同角度的图片，获得更精准的3D模型
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { view: 'front', label: '正面' },
                          { view: 'left', label: '左面' },
                          { view: 'right', label: '右面' },
                          { view: 'back', label: '背面' },
                          { view: 'top', label: '顶面' },
                          { view: 'bottom', label: '底面' },
                          { view: 'free1', label: '自由1' },
                          { view: 'free2', label: '自由2' },
                        ].map(slot => {
                          const existing = threeDMultiImages.find(img => img.view === slot.view);
                          return (
                            <div key={slot.view} className="flex flex-col items-center gap-1">
                              <div
                                className={`w-full aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center overflow-hidden relative cursor-pointer transition-colors ${
                                  existing
                                    ? isMonochrome ? 'border-blue-400 bg-blue-50' : 'border-gold/60 bg-gold/5'
                                    : isMonochrome ? 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50' : 'border-white/20 bg-[#0a0a0a]/90 hover:border-gold/40 hover:bg-gold/5'
                                }`}
                                onClick={() => {
                                  // If existing, remove it
                                  if (existing) {
                                    setThreeDMultiImages(prev => prev.filter(img => img.view !== slot.view));
                                    return;
                                  }
                                  // Otherwise open file picker
                                  const input = document.createElement('input');
                                  input.type = 'file';
                                  input.accept = 'image/*';
                                  input.onchange = async (e) => {
                                    const file = (e.target as HTMLInputElement).files?.[0];
                                    if (!file) return;
                                    const formData = new FormData();
                                    formData.append('file', file);
                                    try {
                                      const res = await fetch('/api/save-image', { method: 'POST', body: formData });
                                      const data = await res.json();
                                      if (data.url) {
                                        setThreeDMultiImages(prev => [...prev.filter(img => img.view !== slot.view), { url: data.url, view: slot.view, label: slot.label }]);
                                      }
                                    } catch { /* ignore */ }
                                  };
                                  input.click();
                                }}
                              >
                                {existing ? (
                                  <>
                                    <NextImage unoptimized width={1} height={1} src={existing.url} alt={slot.label} className="w-full h-full object-cover absolute inset-0" />
                                    <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 flex items-center justify-center">
                                      <X size={10} className="text-white" />
                                    </div>
                                  </>
                                ) : (
                                  <Plus size={18} className={isMonochrome ? 'text-gray-400' : 'text-white/30'} />
                                )}
                              </div>
                              <span className={`text-[10px] ${isMonochrome ? 'text-gray-500' : 'text-[#666]'}`}>{slot.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Quick add: use selected canvas image as front view */}
                      {selectedImageData && !threeDMultiImages.find(img => img.view === 'front') && (
                        <button
                          onClick={() => setThreeDMultiImages(prev => [...prev, { url: selectedImageData.url, view: 'front', label: '正面' }])}
                          className={`w-full py-2 rounded-xl text-xs border transition-colors ${isMonochrome ? 'border-blue-200 text-blue-600 hover:bg-blue-50' : 'border-gold/30 text-gold hover:bg-gold/10'}`}
                        >
                          + 使用当前选中图片作为正面
                        </button>
                      )}
                      {/* Auto-generate multi-view images using AI */}
                      <button
                        onClick={async () => {
                          const prompt = threeDPrompt || '一个精美的3D物体';
                          if (!confirm(`将使用AI自动生成4个视角的图片（正面/左面/右面/背面），然后自动提交3D生成。提示词：${prompt}\n\n确认开始？`)) return;
                          try {
                            toast.loading('正在自动生成多视角图片...', { id: 'auto-3d-multi' });
                            const res = await fetch('/api/image-to-3d/auto-multi-view', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ prompt, model: threeDType, apiProviderId: threeDBackend }),
                            });
                            const data = await res.json();
                            if (!res.ok || data.error) {
                              toast.error(data.error || '自动生成多视角图片失败', { id: 'auto-3d-multi' });
                              return;
                            }
                            // Fill multi-image slots with generated views
                            const generatedImages: Array<{url: string; view: string; label: string}> = [];
                            if (data.frontImageUrl) generatedImages.push({ url: data.frontImageUrl, view: 'front', label: '正面' });
                            if (data.leftImageUrl) generatedImages.push({ url: data.leftImageUrl, view: 'left', label: '左面' });
                            if (data.rightImageUrl) generatedImages.push({ url: data.rightImageUrl, view: 'right', label: '右面' });
                            if (data.backImageUrl) generatedImages.push({ url: data.backImageUrl, view: 'back', label: '背面' });
                            setThreeDMultiImages(generatedImages);
                            toast.success(`已生成${generatedImages.length}张视角图`, { id: 'auto-3d-multi' });
                          } catch {
                            toast.error('自动生成多视角图片失败', { id: 'auto-3d-multi' });
                          }
                        }}
                        className={`w-full py-2 rounded-xl text-xs border transition-colors flex items-center justify-center gap-1 ${isMonochrome ? 'border-purple-200 text-purple-600 hover:bg-purple-50' : 'border-purple-500/30 text-purple-400 hover:bg-purple-500/10'}`}
                      >
                        <Sparkles size={12} /> AI自动生成视角图
                      </button>
                    </div>
                  )}

                  {/* Text-to-3D mode - prompt input */}
                  {threeDMode === 'text-to-3d' && (
                    <div className="space-y-2">
                      <div className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>
                        用文字描述你想生成的3D模型，支持中英文
                      </div>
                      <textarea
                        value={threeDPrompt}
                        onChange={(e) => setThreeDPrompt(e.target.value)}
                        className={`w-full h-24 px-3 py-2 rounded-xl text-xs border resize-y ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white placeholder:text-[#555]'}`}
                        placeholder="例如：一只可爱的卡通猫咪，圆润的造型，大眼睛，粉色鼻子..."
                        maxLength={1024}
                      />
                      <div className={`text-right text-[10px] ${isMonochrome ? 'text-gray-400' : 'text-[#555]'}`}>
                        {threeDPrompt.length}/1024
                      </div>
                    </div>
                  )}

                  {/* Backend selector */}
                  <div className={`grid grid-cols-2 gap-2 p-1 rounded-xl ${isMonochrome ? 'bg-gray-100' : 'bg-[#0a0a0a]/90'}`}>
                    {([
                      { value: 'api' as const, label: 'API 大模型' },
                      { value: 'local' as const, label: '本地模型' },
                    ]).map(item => (
                      <button
                        key={item.value}
                        onClick={() => setThreeDBackend(item.value)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          threeDBackend === item.value
                            ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'
                            : isMonochrome ? 'text-blue-500 hover:text-blue-700' : 'text-[#777] hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  {/* Provider selector */}
                  {threeDBackend === 'api' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={panelSmallLabelClass}>3D 模型列表</span>
                        <span className={panelSmallLabelClass}>管理员配置 + 第三方 API</span>
                      </div>
                      <select
                        value={threeDProviderId}
                        onChange={(e) => setThreeDProviderId(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white'}`}
                      >
                        <option value="">选择 3D 模型</option>
                        {(() => {
                          const adminProviders = providers.filter(p => p.id.startsWith('admin-3d::'));
                          const thirdPartyProviders = providers.filter(p => !p.id.startsWith('admin-3d::'));
                          const groups: Array<{ label: string; items: typeof providers }> = [];
                          if (adminProviders.length > 0) groups.push({ label: '管理员配置', items: adminProviders });
                          if (thirdPartyProviders.length > 0) groups.push({ label: '第三方 API', items: thirdPartyProviders });
                          if (groups.length === 0 && providers.length > 0) {
                            const grouped = new Map<string, typeof providers>();
                            for (const p of providers) {
                              const key = p.name;
                              if (!grouped.has(key)) grouped.set(key, []);
                              grouped.get(key)!.push(p);
                            }
                            for (const [name, items] of grouped) {
                              groups.push({ label: name, items });
                            }
                          }
                          return groups.map(group => (
                            <optgroup key={group.label} label={group.label}>
                              {group.items.map(p => {
                                const modelLabel = get3DModelLabel(p.model || p.name);
                                const providerLabel = p.providerName || p.name || '';
                                return (
                                  <option key={p.id} value={p.id}>{providerLabel ? `${modelLabel} (${providerLabel})` : modelLabel}</option>
                                );
                              })}
                            </optgroup>
                          ));
                        })()}
                      </select>
                      {providers.length === 0 && (
                        <div className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-gold/10 text-gold'}`}>
                          未检测到 3D 模型。管理员可在后台添加 3D 模型 API，或添加 Meshy、Tripo、Rodin 等第三方 3D 中转服务。
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className={panelSmallLabelClass}>本地模型服务地址</label>
                      <input
                        value={threeDLocalEndpoint}
                        onChange={(e) => setThreeDLocalEndpoint(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white'}`}
                        placeholder="http://127.0.0.1:7860/api/image-to-3d"
                      />
                      <label className={panelSmallLabelClass}>本地模型</label>
                      <select
                        value={threeDLocalModel}
                        onChange={(e) => setThreeDLocalModel(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white'}`}
                      >
                        <option>Hunyuan3D-2.1</option>
                        <option>TripoSR</option>
                        <option>Stable Fast 3D</option>
                        <option>InstantMesh</option>
                        <option>CRM</option>
                      </select>
                    </div>
                  )}

                  {/* Quality / Texture / Format row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={panelSmallLabelClass}>质量</label>
                      <select value={threeDQuality} onChange={(e) => setThreeDQuality(e.target.value)} className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white'}`}>
                        {threeDCapabilities.qualities.map((q: { value: string; label: string }) => (
                          <option key={q.value} value={q.value}>{q.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={panelSmallLabelClass}>纹理</label>
                      <select value={threeDTexture} onChange={(e) => setThreeDTexture(e.target.value)} className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white'}`}>
                        {threeDCapabilities.textures.map((t: { value: string; label: string }) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={panelSmallLabelClass}>格式</label>
                      <select value={threeDFormat} onChange={(e) => setThreeDFormat(e.target.value)} className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white'}`}>
                        {threeDCapabilities.formats.map((f: { value: string; label: string }) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Advanced options row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={panelSmallLabelClass}>PBR 材质</label>
                      <button
                        type="button"
                        onClick={() => setThreeDEnablePBR(!threeDEnablePBR)}
                        className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border transition-colors ${
                          threeDEnablePBR
                            ? isMonochrome ? 'bg-blue-500 text-white border-blue-500' : 'bg-gold text-black border-gold'
                            : isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-500' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-[#777]'
                        }`}
                      >
                        {threeDEnablePBR ? '已开启' : '关闭'}
                      </button>
                    </div>
                    <div>
                      <label className={panelSmallLabelClass}>面数</label>
                      <select value={threeDFaceCount} onChange={(e) => setThreeDFaceCount(Number(e.target.value))} className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white'}`}>
                        <option value={3000}>低 (3K)</option>
                        <option value={10000}>中 (10K)</option>
                        <option value={30000}>标准 (30K)</option>
                        <option value={100000}>高 (100K)</option>
                        <option value={500000}>极高 (500K)</option>
                      </select>
                    </div>
                    <div>
                      <label className={panelSmallLabelClass}>姿态</label>
                      <select value={threeDPose} onChange={(e) => setThreeDPose(e.target.value as '' | 'a-pose' | 't-pose')} className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white'}`}>
                        <option value="">无</option>
                        <option value="a-pose">A-Pose</option>
                        <option value="t-pose">T-Pose</option>
                      </select>
                    </div>
                  </div>

                  {/* Progress indicator */}
                  {threeDProgress && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${isMonochrome ? 'bg-gray-50 text-gray-600' : 'bg-[#0a0a0a]/90 text-muted-foreground'}`}>
                      <div className="w-3 h-3 rounded-full border-2 border-gold border-t-transparent animate-spin" />
                      <span className="text-xs">{threeDProgress}</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                  <button
                    onClick={() => { setShow3DModal(false); setActiveTool('none'); setThreeDProgress(null); setThreeDMultiImages([]); }}
                    className={panelCancelBtnClass}
                    disabled={!!threeDProgress}
                  >
                    取消
                  </button>
                  <button
                    onClick={handle3DConfirm}
                    className={`${panelBtnClass} min-w-[120px] ${threeDProgress ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={!!threeDProgress}
                  >
                    开始转换
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ====== 3D MODEL VIEWER MODAL ====== */}
        {show3DViewer && viewer3DModelUrl && (
          <ModelViewer3D
            modelUrl={viewer3DModelUrl}
            modelUrls={viewer3DModelUrls}
            previewImageUrl={viewer3DPreviewUrl}
            thumbnailUrls={viewer3DThumbnailUrls}
            textureUrls={viewer3DTextureUrls}
            modelInfo={viewer3DModelInfo}
            onRetexture={() => {
              const glbUrl = viewer3DModelUrls?.glb || viewer3DModelUrl;
              if (!glbUrl) { toast.error('未找到模型文件'); return; }
              fetch('/api/image-to-3d/post-process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelUrl: glbUrl, action: '3d-retexture', providerId: viewer3DModelInfo?.providerId }),
              }).then(res => res.json()).then(data => {
                if (data.error) { toast.error(data.error); return; }
                toast.success('重贴图任务已提交');
              }).catch(() => toast.error('重贴图请求失败'));
            }}
            onRemesh={() => {
              const glbUrl = viewer3DModelUrls?.glb || viewer3DModelUrl;
              if (!glbUrl) { toast.error('未找到模型文件'); return; }
              fetch('/api/image-to-3d/post-process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelUrl: glbUrl, action: '3d-remesh', providerId: viewer3DModelInfo?.providerId }),
              }).then(res => res.json()).then(data => {
                if (data.error) { toast.error(data.error); return; }
                toast.success('重网格任务已提交');
              }).catch(() => toast.error('重网格请求失败'));
            }}
            onScreenshotToCanvas={(dataUrl: string) => {
              // 将3D截图添加到画布
              const fileName = `3d-screenshot-${Date.now()}.png`;
              fetch('/api/save-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageData: dataUrl, fileName }),
              }).then(res => res.json()).then(data => {
                if (data.url) {
                  onAddImages?.([data.url], undefined, { modelName: '3D截图', apiProvider: viewer3DModelInfo.providerName || '' });
                }
              }).catch(() => toast.error('截图保存失败'));
            }}
            onSendToSceneStudio={() => {
              // 关闭3D预览器，传递模型URL到3D构图面板
              const modelUrl = viewer3DModelUrl || viewer3DModelUrls?.glb || '';
              const modelName = viewer3DModelInfo.model3DName || '3D模型';
              setPendingSceneStudioModel(modelUrl ? { url: modelUrl, name: modelName } : null);
              setShow3DViewer(false);
              setShowSceneStudio(true);
            }}
            onClose={() => { setShow3DViewer(false); setViewer3DModelUrl(''); setViewer3DPreviewUrl(''); setViewer3DModelUrls({}); setViewer3DThumbnailUrls({}); setViewer3DTextureUrls([]); setViewer3DModelInfo({}); }}
          />
        )}

        {/* ====== VIDEO PLAYER MODAL ====== */}
        {videoPlayerVisible && videoPlayerUrl && (
          <VideoPlayer
            videoUrl={videoPlayerUrl}
            onClose={() => { setVideoPlayerVisible(false); setVideoPlayerUrl(''); }}
          />
        )}

        {/* ====== VIDEO COMPARE DIALOG ====== */}
        {compareVideos && (
          <VideoCompareDialog
            videoA={compareVideos.a}
            videoB={compareVideos.b}
            open={!!compareVideos}
            onClose={() => setCompareVideos(null)}
            isGold={!isMonochrome}
          />
        )}

        {/* ====== 720° PANORAMA VIEWER ====== */}
        {panoramaViewerUrl && (
          <div className="fixed inset-0 z-[201] bg-black flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) setPanoramaViewerUrl(null); }}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#111] border-b border-[#333]">
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-[#d4af37]" />
                <span className="text-sm font-medium">720° 全景浏览</span>
                <span className="text-xs text-[#888] ml-2">拖拽旋转 · 滚轮缩放</span>
              </div>
              <button onClick={() => setPanoramaViewerUrl(null)} className="text-white/70 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div 
              className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing relative select-none"
              onWheel={(e) => {
                const el = e.currentTarget.querySelector('.panorama-img') as HTMLElement | null;
                if (el) {
                  const current = parseFloat(el.dataset.scale || '1');
                  const next = Math.max(0.5, Math.min(3, current - e.deltaY * 0.001));
                  el.dataset.scale = String(next);
                  el.style.transform = `scale(${next})`;
                }
              }}
              onMouseDown={(e) => {
                const el = e.currentTarget;
                const img = el.querySelector('.panorama-img') as HTMLElement | null;
                if (!img) return;
                const startX = e.clientX;
                const startY = e.clientY;
                const startOffX = parseFloat(img.dataset.offsetX || '0');
                const startOffY = parseFloat(img.dataset.offsetY || '0');
                const onMove = (ev: MouseEvent) => {
                  const dx = ev.clientX - startX;
                  const dy = ev.clientY - startY;
                  img.dataset.offsetX = String(startOffX + dx);
                  img.dataset.offsetY = String(Math.max(-200, Math.min(200, startOffY + dy)));
                  const s = parseFloat(img.dataset.scale || '1');
                  img.style.transform = `scale(${s}) translate(${(startOffX + dx) / s}px, ${Math.max(-200, Math.min(200, startOffY + dy)) / s}px)`;
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            >
              <NextImage unoptimized width={1} height={1} 
                src={panoramaViewerUrl} 
                alt="全景图" 
                className="panorama-img absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-none h-full w-auto"
                data-scale="1"
                data-offset-x="0"
                data-offset-y="0"
                draggable={false}
              />
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur text-white/80 text-xs px-4 py-2 rounded-full">
                提示：左右拖拽水平环绕，上下拖拽垂直视角
              </div>
            </div>
          </div>
        )}

        {/* ====== VIDEO EXTRACT FRAMES PANEL ====== */}
        {showVideoExtractPanel && editImageId && (() => {
          const img = images.find(i => i.id === editImageId);
          if (!img) return null;
          return (
            <div className="fixed top-24 right-4 z-[65] w-80 bg-[#1a1a1a] rounded-xl shadow-2xl border border-[#333] overflow-hidden" data-popup="video-extract">
              <div className="px-4 py-3 bg-[#111] border-b border-[#333] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Film size={16} className="text-[#d4af37]" />
                  视频抽帧
                </h3>
                <button onClick={() => { setShowVideoExtractPanel(false); setEditMode('none'); setActiveTool('none'); }} className="text-white/60 hover:text-white">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div className="aspect-video bg-black rounded-lg overflow-hidden">
                  {img.videoUrl ? (
                    <video src={img.videoUrl} className="w-full h-full object-contain" controls muted />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/40 text-xs">请选择视频文件</div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60">抽帧模式</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: 'uniform', label: '均匀抽帧' },
                      { id: 'fps', label: '每秒1帧' },
                      { id: 'first_last', label: '首尾帧' },
                      { id: 'keyframes', label: '关键帧' },
                    ] as const).map(mode => (
                      <button
                        key={mode.id}
                        onClick={() => setVideoExtractMode(mode.id)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          videoExtractMode === mode.id ? 'bg-[#d4af37] text-black' : 'bg-[#2a2a2a] text-white/70 hover:bg-[#333]'
                        }`}
                      >{mode.label}</button>
                    ))}
                  </div>
                </div>
                {(videoExtractMode === 'uniform' || videoExtractMode === 'fps') && (
                  <div className="space-y-1">
                    <label className="text-xs text-white/60 flex justify-between">
                      帧数: {videoExtractFrameCount}
                    </label>
                    <input type="range" min="4" max="30" value={videoExtractFrameCount}
                      onChange={e => setVideoExtractFrameCount(Number(e.target.value))}
                      className="w-full accent-[#d4af37]" />
                  </div>
                )}
                <button
                  disabled={videoExtractProcessing || !img.videoUrl}
                  onClick={async () => {
                    if (!img.videoUrl) return;
                    setVideoExtractProcessing(true);
                    try {
                      const res = await fetch('/api/video/tools', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'extract-frames',
                          videoUrl: img.videoUrl,
                          mode: videoExtractMode,
                          frameCount: videoExtractMode === 'uniform' ? videoExtractFrameCount : videoExtractMode === 'fps' ? 0 : 0,
                          fps: videoExtractMode === 'fps' ? 1 : undefined,
                        }),
                      });
                      const data = await res.json();
                      if (data.frames?.length > 0) {
                        onAddImages(data.frames.flatMap((frame: unknown) => {
                          if (!frame || typeof frame !== 'object' || !('url' in frame)) return [];
                          return typeof frame.url === 'string' ? [frame.url] : [];
                        }));
                        toast.success(`成功提取 ${data.frames.length} 帧`);
                        setShowVideoExtractPanel(false);
                        setEditMode('none');
                      } else {
                        toast.error('未能提取到帧');
                      }
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : '抽帧失败');
                    } finally {
                      setVideoExtractProcessing(false);
                    }
                  }}
                  className="w-full py-2.5 rounded-lg bg-[#d4af37] text-black font-semibold text-sm hover:bg-[#e5c048] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {videoExtractProcessing ? <><Loader2 size={16} className="animate-spin" /> 提取中...</> : '开始抽帧'}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ====== VIDEO EDIT PANEL ====== */}
        {showVideoEditPanel && videoEditTarget && (
          <VideoEditPanel
            isOpen={showVideoEditPanel}
            videoUrl={videoEditTarget.videoUrl || videoEditTarget.url}
            thumbnailUrl={videoEditTarget.videoThumbnailUrl}
            originalPrompt={videoEditTarget.prompt}
            themeStyle={isMonochrome ? 'monochrome' : 'gold'}
            selectedVideoModel={videoEditTarget.modelName || ''}
            selectedVideoProviderId={videoEditTarget.apiProvider || ''}
            onClose={() => { setShowVideoEditPanel(false); setVideoEditTarget(null); setVideoEditTab('edit'); }}
            onEdit={async (params) => {
              // 视频编辑：通过视频生成API重新生成
              try {
                const res = await fetch('/api/video/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    prompt: params.prompt,
                    model: params.model || undefined,
                    providerId: params.providerId || undefined,
                    imageUrl: params.videoUrl,
                    mode: 'image2video',
                  }),
                });
                const data = await res.json();
                if (data.taskId) {
                  // 创建processing frame
                  const sourceId = videoEditTarget?.id;
                  const frameId = `processing-video-edit-${Date.now()}`;
                  const frame = {
                    id: frameId,
                    url: '',
                    x: videoEditTarget ? videoEditTarget.x + (videoEditTarget.width || 300) + 30 : 100,
                    y: videoEditTarget?.y || 100,
                    width: videoEditTarget?.width || 300,
                    height: videoEditTarget?.height || 200,
                    isProcessing: true,
                    processingLabel: '视频编辑中...',
                    prompt: params.prompt,
                  };
                  onImagesChange([...imagesRef.current, frame]);
                  // 使用视频模型的model/providerId，而非图片模型的
                  const videoModel = params.model || '';
                  const videoProviderId = params.providerId || '';
                  // 轮询任务结果（最多5分钟）
                  let videoEditPollCount = 0;
                  const pollInterval = setInterval(async () => {
                    videoEditPollCount++;
                    if (videoEditPollCount >= 100) { clearInterval(pollInterval); toast.error('视频编辑超时'); onImagesChange(imagesRef.current.filter((img: CanvasImage) => img.id !== frameId)); return; }
                    try {
                      const pollRes = await fetch('/api/poll-task', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ taskId: data.taskId, model: videoModel, providerId: videoProviderId }),
                      });
                      const pollData = await pollRes.json();
                      const resultUrl = pollData.imageUrl || pollData.result?.url || pollData.result?.imageUrl || (pollData.result?.image as Record<string, unknown>)?.url || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url;
                      if (pollData.status === 'completed' && resultUrl) {
                        clearInterval(pollInterval);
                        const rawVideoUrl = pollData.videoUrl || resultUrl;
                        const rawThumbUrl = pollData.videoThumbnailUrl || resultUrl;
                        // ★ 持久化视频URL，防止第三方URL过期消失
                        Promise.all([
                          awaitStableImageUrl(rawThumbUrl, 30000, { isVideo: false }),
                          awaitStableImageUrl(rawVideoUrl, 120000, { isVideo: true }),
                        ]).then(([stableThumb, stableVideo]) => {
                          onImagesChange(images.map((img: CanvasImage) =>
                            img.id === frameId
                              ? {
                                  ...img,
                                  url: stableThumb || '',
                                  videoUrl: stableVideo,
                                  mediaType: 'video' as const,
                                  isProcessing: false,
                                  processingLabel: undefined,
                                  generatedFromImageId: sourceId,
                                  relationType: 'edit' as const,
                                }
                              : img
                          ));
                        }).catch(() => {
                          // 持久化失败兜底：直接用原始URL
                          onImagesChange(images.map((img: CanvasImage) =>
                            img.id === frameId
                              ? {
                                  ...img,
                                  url: rawThumbUrl,
                                  videoUrl: rawVideoUrl,
                                  mediaType: 'video' as const,
                                  isProcessing: false,
                                  processingLabel: undefined,
                                  generatedFromImageId: sourceId,
                                  relationType: 'edit' as const,
                                }
                              : img
                          ));
                        });
                      } else if (pollData.status === 'failed' || pollData.status === 'cancelled') {
                        clearInterval(pollInterval);
                        toast.error(pollData.error || '视频编辑失败');
                        onImagesChange(imagesRef.current.filter((img: CanvasImage) => img.id !== frameId));
                      }
                    } catch { /* ignore poll errors */ }
                  }, 3000);
                } else if (data.error) {
                  toast.error(data.error);
                }
              } catch (err) {
                console.error('[video-edit] API error:', err);
                toast.error('视频编辑请求失败');
              }
              setShowVideoEditPanel(false);
            }}
            onExtend={async (params) => {
              // 视频延长：调用视频延长API
              try {
                const res = await fetch('/api/video/extend', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    videoUrl: params.videoUrl,
                    prompt: params.prompt || undefined,
                    extendDuration: params.duration || 5,
                    model: params.model || undefined,
                    providerId: params.providerId || undefined,
                  }),
                });
                const data = await res.json();
                if (data.taskId) {
                  const sourceId = videoEditTarget?.id;
                  const frameId = `processing-video-extend-${Date.now()}`;
                  const frame = {
                    id: frameId,
                    url: '',
                    x: videoEditTarget ? videoEditTarget.x + (videoEditTarget.width || 300) + 30 : 100,
                    y: videoEditTarget?.y || 100,
                    width: videoEditTarget?.width || 300,
                    height: videoEditTarget?.height || 200,
                    isProcessing: true,
                    processingLabel: '视频延长中...',
                    prompt: params.prompt,
                  };
                  onImagesChange([...imagesRef.current, frame]);
                  const videoModel = params.model || '';
                  const videoProviderId = params.providerId || '';
                  let videoExtendPollCount = 0;
                  const pollInterval = setInterval(async () => {
                    videoExtendPollCount++;
                    if (videoExtendPollCount >= 100) { clearInterval(pollInterval); toast.error('视频延长超时'); onImagesChange(imagesRef.current.filter((img: CanvasImage) => img.id !== frameId)); return; }
                    try {
                      const pollRes = await fetch('/api/poll-task', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ taskId: data.taskId, model: videoModel, providerId: videoProviderId }),
                      });
                      const pollData = await pollRes.json();
                      const resultUrl = pollData.imageUrl || pollData.result?.url || pollData.result?.imageUrl || (pollData.result?.image as Record<string, unknown>)?.url || (pollData.result?.images as Array<Record<string, unknown>>)?.[0]?.url;
                      if (pollData.status === 'completed' && resultUrl) {
                        clearInterval(pollInterval);
                        const rawVideoUrl = pollData.videoUrl || resultUrl;
                        const rawThumbUrl = pollData.videoThumbnailUrl || resultUrl;
                        // ★ 持久化视频URL，防止第三方URL过期消失
                        Promise.all([
                          awaitStableImageUrl(rawThumbUrl, 30000, { isVideo: false }),
                          awaitStableImageUrl(rawVideoUrl, 120000, { isVideo: true }),
                        ]).then(([stableThumb, stableVideo]) => {
                          onImagesChange(images.map((img: CanvasImage) =>
                            img.id === frameId
                              ? {
                                  ...img,
                                  url: stableThumb || '',
                                  videoUrl: stableVideo,
                                  mediaType: 'video' as const,
                                  isProcessing: false,
                                  processingLabel: undefined,
                                  generatedFromImageId: sourceId,
                                  relationType: 'edit' as const,
                                }
                              : img
                          ));
                        }).catch(() => {
                          // 持久化失败兜底：直接用原始URL
                          onImagesChange(images.map((img: CanvasImage) =>
                            img.id === frameId
                              ? {
                                  ...img,
                                  url: rawThumbUrl,
                                  videoUrl: rawVideoUrl,
                                  mediaType: 'video' as const,
                                  isProcessing: false,
                                  processingLabel: undefined,
                                  generatedFromImageId: sourceId,
                                  relationType: 'edit' as const,
                                }
                              : img
                          ));
                        });
                      } else if (pollData.status === 'failed' || pollData.status === 'cancelled') {
                        clearInterval(pollInterval);
                        toast.error(pollData.error || '视频延长失败');
                        onImagesChange(imagesRef.current.filter((img: CanvasImage) => img.id !== frameId));
                      }
                    } catch { /* ignore poll errors */ }
                  }, 3000);
                } else if (data.error) {
                  toast.error(data.error);
                }
              } catch (err) {
                console.error('[video-extend] API error:', err);
                toast.error('视频延长请求失败');
              }
              setShowVideoEditPanel(false);
            }}
          />
        )}

        {/* ====== AI 视频配音面板 ====== */}
        {showVideoDubPanel && videoDubTarget && (
          <div className="fixed top-20 right-4 z-[85] w-[420px] bg-card rounded-xl shadow-xl border border-border overflow-hidden">
            <div className="bg-primary/10 px-4 py-3 flex items-center justify-between border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-primary" />
                AI 配音合成
              </h3>
              <button onClick={() => { setShowVideoDubPanel(false); setVideoDubTarget(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="aspect-video bg-black rounded-lg overflow-hidden relative">
                {videoDubTarget.videoUrl ? (
                  <video src={videoDubTarget.videoUrl} className="w-full h-full object-contain" controls muted />
                ) : (
                  <NextImage unoptimized width={1} height={1} src={videoDubTarget.url} alt="视频配音目标图片" className="w-full h-full object-contain" />
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">配音文本</label>
                <textarea
                  value={dubText}
                  onChange={e => setDubText(e.target.value)}
                  placeholder="输入要配音的文字内容..."
                  className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">音色</label>
                  <select value={dubVoice} onChange={e => setDubVoice(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="female-calm">女声-沉稳</option>
                    <option value="female-sweet">女声-甜美</option>
                    <option value="male-professional">男声-专业</option>
                    <option value="male-energetic">男声-活力</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">语速: {dubSpeed.toFixed(1)}x</label>
                  <input type="range" min="0.5" max="2" step="0.1" value={dubSpeed}
                    onChange={e => setDubSpeed(parseFloat(e.target.value))} className="w-full accent-primary" />
                </div>
              </div>
              <button
                onClick={handleVideoDub}
                disabled={isDubbing || !dubText.trim()}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isDubbing ? (<><Loader2 className="w-4 h-4 animate-spin" />合成中...</>) : (<><Volume2 className="w-4 h-4" />生成配音视频</>)}
              </button>
              <p className="text-xs text-muted-foreground text-center">系统自动生成AI语音并合成到视频中</p>
            </div>
          </div>
        )}

        {/* ====== AGENT EDITOR ====== */}
        {showAgentEditor && (
          <Suspense fallback={null}>
            <AgentEditor
              imageUrl={agentEditImage?.url}
              imagePrompt={agentEditImage?.prompt}
              isMonochrome={isMonochrome}
              onApply={async (resultUrl: string) => {
                const stableUrl = await awaitStableImageUrl(resultUrl);
                if (agentEditImage) {
                  // ★ 保留模型信息：替换原图但保留 modelName/apiProvider
                  const updated = images.map(img =>
                    img.id === agentEditImage.id ? { ...img, url: stableUrl } : img
                  );
                  onImagesChange(updated);
                } else {
                  // 没有原图时，将结果作为新图片添加到画布
                  onAddImages([stableUrl], undefined, { modelName: 'Agent编辑', apiProvider: '' });
                }
                setShowAgentEditor(false);
                setAgentEditImage(null);
              }}
              onClose={() => { setShowAgentEditor(false); setAgentEditImage(null); }}
              onSelectImage={() => {
                // 进入画布选择图片模式
                setAgentSelectingImage(true);
              }}
              onChangeImage={() => {
                // 更换图片：进入画布选择模式
                setAgentSelectingImage(true);
              }}
            />
          </Suspense>
        )}

        {/* ====== IMAGE COMPARE DIALOG ====== */}
        {showCompareDialog && compareImages.left && compareImages.right && createPortal(
          <Suspense fallback={null}>
            <ImageCompareDialog
              leftImage={{ url: compareImages.left.url, prompt: compareImages.left.prompt, modelName: compareImages.left.modelName }}
              rightImage={{ url: compareImages.right.url, prompt: compareImages.right.prompt, modelName: compareImages.right.modelName }}
              isMonochrome={isMonochrome}
              onClose={() => { setShowCompareDialog(false); setCompareImages({ left: null, right: null }); }}
            />
          </Suspense>,
          document.body
        )}

        {/* ====== BRAND E-COMMERCE PANEL ====== */}
        {showBrandEcommerce && (
          <Suspense fallback={null}>
            <BrandEcommercePanel
              isMonochrome={isMonochrome}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
              onClose={() => setShowBrandEcommerce(false)}
            />
          </Suspense>
        )}

        {/* ====== REFINE ENGINE PANEL ====== */}
        {showRefineEngine && (
          <Suspense fallback={null}>
            <RefineEnginePanel
              isMonochrome={isMonochrome}
              onClose={() => setShowRefineEngine(false)}
              onAddImage={(url: string, meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.([url], undefined, meta);
              }}
              initialImageUrl={refineEngineImageUrl}
            />
          </Suspense>
        )}

        {/* ====== FONT DESIGN PANEL ====== */}
        {showFontDesign && (
          <Suspense fallback={null}>
            <FontDesignPanel
              isMonochrome={isMonochrome}
              onClose={() => setShowFontDesign(false)}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
            />
          </Suspense>
        )}

        {/* ====== BRAND FACTORY PANEL ====== */}
        {showBrandFactory && (
          <Suspense fallback={null}>
            <BrandFactoryPanel
              onClose={() => setShowBrandFactory(false)}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
              isMonochrome={isMonochrome}
              onOpenLogoSkill={(project?: { id: string; brandName: string }) => {
                setShowBrandFactory(false);
                setShowLogoSkill(true);
                if (project) {
                  setLogoSkillBrandProject(project);
                }
              }}
            />
          </Suspense>
        )}

        {/* ====== LOGO GENERATOR PRO PANEL ====== */}
        {showLogoSkill && (
          <Suspense fallback={null}>
            <LogoSkillPanel
              isMonochrome={isMonochrome}
              onClose={() => setShowLogoSkill(false)}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
              brandProject={logoSkillBrandProject}
              onOpenBrandDna={() => {
                setShowLogoSkill(false);
                setShowBrandFactory(true);
              }}
              onOpenMainKv={() => {
                setShowLogoSkill(false);
              }}
            />
          </Suspense>
        )}

        {/* ====== AI PSD GENERATOR PANEL ====== */}
        {showAiPsd && (
          <Suspense fallback={null}>
            <AiPsdPanel
              onClose={() => setShowAiPsd(false)}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
              isMonochrome={isMonochrome}
              sourceImageUrl={getActiveImageData()?.url}
            />
          </Suspense>
        )}

        {/* Sticker Assistant */}
        {showStickerAssistant && (
          <Suspense fallback={null}>
            <StickerAssistantPanel
              isOpen={showStickerAssistant}
              onClose={() => setShowStickerAssistant(false)}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
              isMonochrome={isMonochrome}
            />
          </Suspense>
        )}

        {/* 3D Scene Studio Panel */}
        {showSceneStudio && (
          <Suspense fallback={null}>
            <SceneStudioPanel
              onClose={() => { setShowSceneStudio(false); setPendingSceneStudioModel(null); }}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
              isMonochrome={isMonochrome}
              initialModelUrl={pendingSceneStudioModel?.url || ''}
              initialModelName={pendingSceneStudioModel?.name || ''}
            />
          </Suspense>
        )}

        {/* ====== 品牌包装系统 Pro FLOATING PANEL ====== */}
        {showBrandPackaging && (
          <Suspense fallback={null}>
            <BrandPackagingPanel
              onClose={() => setShowBrandPackaging(false)}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
              isMonochrome={isMonochrome}
            />
          </Suspense>
        )}

        {/* ====== 3D展陈系统 Pro FLOATING PANEL ====== */}
        {showDisplay3D && (
          <Suspense fallback={null}>
            <Display3DPanel
              onClose={() => setShowDisplay3D(false)}
              onAddImages={(urls: string[], meta?: { modelName?: string; apiProvider?: string }) => {
                onAddImages?.(urls, undefined, meta);
              }}
              isMonochrome={isMonochrome}
            />
          </Suspense>
        )}

        {/* ====== PSD LAYER EDITOR MODAL ====== */}
        {showPsdEditor && psdEditorImageUrl && (
          <div
            className="fixed inset-0 z-[100] pointer-events-none"
            data-modal="psd-editor"
            onWheel={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <PsdLayerEditor
              imageUrl={psdEditorImageUrl}
              mode={psdEditorMode}
              onClose={() => setShowPsdEditor(false)}
            />
          </div>
        )}

        {/* ====== HEXCUBE FLOATING PANEL ====== */}
        {hexCubeGroups.map(hcg => {
          // 使用屏幕坐标，不受画布缩放/平移影响
          const screenX = hcg.position.x * zoom + viewOffset.x;
          const screenY = hcg.position.y * zoom + viewOffset.y;
          const dragDx = hexCubeDragTarget === hcg.id ? hexCubeDragOffset.x : 0;
          const dragDy = hexCubeDragTarget === hcg.id ? hexCubeDragOffset.y : 0;
          const isThisGroupDragging = hexCubeDragTarget === hcg.id;
          const models = canvasGenModels;

          // 展开图格子大小
          const cellSize = 80;
          const cellGap = 4;
          const layoutCols = 3;
          const layoutRows = 2;
          const netW = layoutCols * cellSize + (layoutCols - 1) * cellGap;
          const previewSize = 180;

          return (
            <div
              key={`hexcube-float-${hcg.id}`}
              className="absolute z-50 pointer-events-auto"
              style={{
                left: screenX + dragDx,
                top: screenY + dragDy,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div
                className="rounded-2xl"
                style={{
                  background: isMonochrome ? 'rgba(255,255,255,0.97)' : 'rgba(20,20,20,0.96)',
                  border: `2px solid ${isThisGroupDragging ? (isMonochrome ? '#3b82f6' : '#d4af37') : isMonochrome ? '#e5e7eb' : '#333'}`,
                  boxShadow: isThisGroupDragging ? (isMonochrome ? '0 0 24px rgba(59,130,246,0.3)' : '0 0 24px rgba(212,175,55,0.3)') : '0 8px 32px rgba(0,0,0,0.4)',
                  minWidth: netW + previewSize + 80,
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                {/* Title bar (unified design) */}
                <div
                  className="flex items-center gap-2 px-3 py-2 select-none cursor-grab active:cursor-grabbing rounded-t-2xl"
                  style={{
                    background: isMonochrome ? '#f3f4f6' : '#1a1a1a',
                    borderBottom: `1px solid ${isMonochrome ? '#e5e7eb' : '#333'}`,
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    if ((e.target as HTMLElement).closest('button')) return;
                    e.stopPropagation();
                    e.preventDefault();
                    setHexCubeDragTarget(hcg.id);
                    setHexCubeDragStart({ x: e.clientX, y: e.clientY });
                    setHexCubeDragOffset({ x: 0, y: 0 });
                    hexCubeDragReadyRef.current = true;
                  }}
                >
                  <GripVertical size={14} style={{ color: isMonochrome ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)' }} />
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke={isMonochrome ? "#6b6b6b" : "#d4af37"} strokeWidth="2">
                    <path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" />
                    <path d="M12 3v18" />
                    <path d="M3 8l9 5 9-5" />
                  </svg>
                  <span className="text-sm font-semibold flex-1" style={{ color: isMonochrome ? '#6b6b6b' : '#d4af37' }}>六面体</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: isMonochrome ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.5)', background: isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)' }}>
                    6面贴图
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, isCollapsed: !g.isCollapsed } : g));
                      }}
                      title={hcg.isCollapsed ? '展开' : '折叠'}
                    >
                      <svg className="w-4 h-4 transition-transform" style={{ color: isMonochrome ? '#6b6b6b' : '#d4af37', transform: hcg.isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <button
                      className="p-2 min-h-[44px] min-w-[44px] rounded-md transition-colors"
                      onClick={(e) => { e.stopPropagation(); deleteHexCubeGroup(hcg.id); }}
                      title="关闭"
                      aria-label="关闭"
                      style={{ color: isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                      onMouseLeave={e => (e.currentTarget.style.color = isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)')}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {!hcg.isCollapsed && (
                <div className="p-4">
                  {/* 上排: 展开图 + 3D CSS 预览 */}
                  <div className="flex items-start gap-6">
                    {/* 展开图 */}
                    <div>
                      <div className="text-xs font-medium mb-2" style={{ color: isMonochrome ? '#6b7280' : '#888' }}>产品六面展开图</div>
                      <div
                        className="grid gap-1"
                        style={{
                          gridTemplateColumns: `repeat(${layoutCols}, ${cellSize}px)`,
                          gridTemplateRows: `repeat(${layoutRows}, ${cellSize}px)`,
                        }}
                      >
                        {CUBE_FACE_ORDER.map(face => {
                          const faceData = hcg.faces.find(f => f.face === face);
                          const label = CUBE_FACE_LABELS[face];
                          return (
                            <div
                              key={face}
                              className="relative rounded-lg overflow-hidden flex items-center justify-center cursor-pointer transition-all hover:ring-2 hover:ring-blue-400/50"
                              style={{
                                background: isMonochrome ? '#f9fafb' : '#252525',
                                border: `1px dashed ${isMonochrome ? '#d1d5db' : '#444'}`,
                                width: cellSize,
                                height: cellSize,
                              }}
                              onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = 'image/*';
                                input.onchange = async (e) => {
                                  const file = (e.target as HTMLInputElement).files?.[0];
                                  if (!file) return;
                                  const formData = new FormData();
                                  formData.append('file', file);
                                  try {
                                    const res = await fetch('/api/save-image', { method: 'POST', body: formData });
                                    if (!res.ok) throw new Error(`上传失败: HTTP ${res.status}`);
                                    const data = await res.json();
                                    if (data.url) {
                                      updateHexCubeFace(hcg.id, face, data.url, null);
                                    }
                                  } catch (err) {
                                    console.error('上传失败:', err);
                                  }
                                };
                                input.click();
                              }}
                            >
                              {faceData?.imageUrl ? (
                                <NextImage unoptimized width={1} height={1} src={faceData.imageUrl} alt={label} className="w-full h-full object-cover" />
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <svg className="w-5 h-5" style={{ color: isMonochrome ? '#93c5fd' : '#555' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M12 5v14M5 12h14" />
                                  </svg>
                                  <span className="text-xs font-medium" style={{ color: isMonochrome ? '#6b7280' : '#555' }}>{label}</span>
                                </div>
                              )}
                              <div className="absolute top-1 left-1 px-1 py-0.5 rounded text-[10px] font-bold" style={{ background: isMonochrome ? 'rgba(59,130,246,0.9)' : 'rgba(212,175,55,0.9)', color: '#fff' }}>{label}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 3D CSS 立方体预览 */}
                    <div>
                      <div className="text-xs font-medium mb-2" style={{ color: isMonochrome ? '#6b7280' : '#888' }}>3D 预览</div>
                      <div
                        className={`rounded-xl flex items-center justify-center overflow-hidden select-none ${hexCube3dDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                        style={{
                          width: previewSize,
                          height: previewSize,
                          background: isMonochrome ? '#f3f4f6' : '#0d0d0d',
                          border: `1px solid ${isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.08)'}`,
                          perspective: '600px',
                        }}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          e.preventDefault();
                          hexCube3dDragRef.current = {
                            groupId: hcg.id,
                            startX: e.clientX,
                            startY: e.clientY,
                            startRotY: hcg.toolbar.rotationY,
                            startTiltX: hcg.toolbar.tiltX,
                          };
                          setHexCube3dDragging(true);
                        }}
                      >
                        {/* CSS 3D Transform Cube */}
                        <div
                          className="relative"
                          style={{
                            width: '110px',
                            height: '110px',
                            transformStyle: 'preserve-3d',
                            transform: `rotateX(${-hcg.toolbar.tiltX * 0.8}deg) rotateY(${hcg.toolbar.rotationY * 1.2}deg)`,
                            transition: hexCube3dDragging ? 'none' : 'transform 0.15s ease-out',
                          }}
                        >
                          {/* Front face */}
                          {(() => {
                            const frontFace = hcg.faces.find(f => f.face === 'front');
                            return (
                              <div className="absolute inset-0 rounded-lg overflow-hidden border-2 border-blue-400/60 shadow-[0_0_20px_rgba(59,130,246,0.3)]" style={{ transform: 'translateZ(55px)', backfaceVisibility: 'hidden' }}>
                                {frontFace?.imageUrl ? (
                                  <NextImage unoptimized width={1} height={1} src={frontFace.imageUrl} alt="front" className="w-full h-full object-cover" />
                                ) : (
                                  <div className={`w-full h-full flex items-center justify-center ${isMonochrome ? 'bg-gray-200' : 'bg-[#1e1e1e]'}`}>
                                    <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-500' : 'text-gold-muted/50'}`}>前</span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {/* Back face */}
                          {(() => {
                            const backFace = hcg.faces.find(f => f.face === 'back');
                            return (
                              <div className={`absolute inset-0 rounded-lg border flex items-center justify-center overflow-hidden ${isMonochrome ? 'bg-gray-200 border-gray-300' : 'bg-[#1e1e1e] border-[#444]'}`} style={{ transform: 'rotateY(180deg) translateZ(55px)' }}>
                                {backFace?.imageUrl ? (
                                  <NextImage unoptimized width={1} height={1} src={backFace.imageUrl} alt="back" className="w-full h-full object-cover" />
                                ) : (
                                  <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-500' : 'text-gold-muted/50'}`}>后</span>
                                )}
                              </div>
                            );
                          })()}
                          {/* Right face */}
                          {(() => {
                            const rightFace = hcg.faces.find(f => f.face === 'right');
                            return (
                              <div className={`absolute inset-0 rounded-lg border flex items-center justify-center overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-white/[0.14]'}`} style={{ transform: 'rotateY(90deg) translateZ(55px)' }}>
                                {rightFace?.imageUrl ? (
                                  <NextImage unoptimized width={1} height={1} src={rightFace.imageUrl} alt="right" className="w-full h-full object-cover" />
                                ) : (
                                  <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>右</span>
                                )}
                              </div>
                            );
                          })()}
                          {/* Left face */}
                          {(() => {
                            const leftFace = hcg.faces.find(f => f.face === 'left');
                            return (
                              <div className={`absolute inset-0 rounded-lg border flex items-center justify-center overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-white/[0.14]'}`} style={{ transform: 'rotateY(-90deg) translateZ(55px)' }}>
                                {leftFace?.imageUrl ? (
                                  <NextImage unoptimized width={1} height={1} src={leftFace.imageUrl} alt="left" className="w-full h-full object-cover" />
                                ) : (
                                  <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>左</span>
                                )}
                              </div>
                            );
                          })()}
                          {/* Top face */}
                          {(() => {
                            const topFace = hcg.faces.find(f => f.face === 'top');
                            return (
                              <div className={`absolute inset-0 rounded-lg border flex items-center justify-center overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-white/[0.14]'}`} style={{ transform: 'rotateX(90deg) translateZ(55px)' }}>
                                {topFace?.imageUrl ? (
                                  <NextImage unoptimized width={1} height={1} src={topFace.imageUrl} alt="top" className="w-full h-full object-cover" />
                                ) : (
                                  <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>上</span>
                                )}
                              </div>
                            );
                          })()}
                          {/* Bottom face */}
                          {(() => {
                            const bottomFace = hcg.faces.find(f => f.face === 'bottom');
                            return (
                              <div className={`absolute inset-0 rounded-lg border flex items-center justify-center overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-white/[0.14]'}`} style={{ transform: 'rotateX(-90deg) translateZ(55px)' }}>
                                {bottomFace?.imageUrl ? (
                                  <NextImage unoptimized width={1} height={1} src={bottomFace.imageUrl} alt="bottom" className="w-full h-full object-cover" />
                                ) : (
                                  <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>下</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {/* 角度提示 */}
                        <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs ${isMonochrome ? 'bg-white/80 text-gray-500 border border-gray-200' : 'bg-black/60 text-muted-foreground border border-white/10'}`}>
                          {hcg.toolbar.rotationY}° / {hcg.toolbar.tiltX > 0 ? `+${hcg.toolbar.tiltX}` : hcg.toolbar.tiltX}°
                        </div>
                      </div>

                      {/* 旋转/倾斜滑块 */}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-[10px]" style={{ color: isMonochrome ? '#3b82f6' : '#666' }}>旋转</span>
                          <input
                            type="range" min={0} max={360} step={5}
                            value={hcg.toolbar.rotationY}
                            className="flex-1 h-1 accent-[#d4af37]"
                            onChange={(e) => {
                              setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, rotationY: parseInt(e.target.value) } } : g));
                            }}
                          />
                          <span className="text-[10px] w-7 text-right" style={{ color: isMonochrome ? '#6b7280' : '#666' }}>{hcg.toolbar.rotationY}°</span>
                        </div>
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-[10px]" style={{ color: isMonochrome ? '#3b82f6' : '#666' }}>倾斜</span>
                          <input
                            type="range" min={-60} max={60} step={5}
                            value={hcg.toolbar.tiltX}
                            className="flex-1 h-1 accent-[#d4af37]"
                            onChange={(e) => {
                              setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, tiltX: parseInt(e.target.value) } } : g));
                            }}
                          />
                          <span className="text-[10px] w-7 text-right" style={{ color: isMonochrome ? '#6b7280' : '#666' }}>{hcg.toolbar.tiltX}°</span>
                        </div>
                      </div>
                      {/* 缩放 */}
                      <div className="flex items-center gap-1 mt-1.5">
                        <span className="text-[10px]" style={{ color: isMonochrome ? '#6b7280' : '#666' }}>缩放</span>
                        <div className="flex gap-1 ml-1">
                          {(['close-up', 'standard', 'wide'] as ZoomLevel[]).map(z => (
                            <button
                              key={z}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${hcg.toolbar.zoom === z ? (isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black') : isMonochrome ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-[#252525] text-gold-muted hover:bg-[#282828]/85'}`}
                              onClick={() => setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, zoom: z } } : g))}
                            >{ZOOM_LEVEL_LABELS[z]}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 工具栏: 模型/比例/质量/数量/提示词/优化/生成 */}
                  <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${isMonochrome ? '#e5e7eb' : '#333'}` }}>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {/* 模型选择 */}
                      <div className="relative">
                        <button
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all"
                          style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.08)', color: isMonochrome ? '#374151' : '#ccc', border: `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.10)'}` }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenModelDropdownGroupId(openModelDropdownGroupId === `hex-${hcg.id}` ? null : `hex-${hcg.id}`);
                          }}
                        >
                          {(() => {
                            const hcgModelObj = models.find(m => m.id === hcg.toolbar.model && m.providerId === (hcg.toolbar.providerId || ''));
                            return hcgModelObj ? `${hcgModelObj.apiDisplayName || getModelDisplayName(hcgModelObj.id)} · 来自 ${hcgModelObj.providerName}` : (hcg.toolbar.model ? getModelDisplayName(hcg.toolbar.model) : '选择模型');
                          })()}
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                        {openModelDropdownGroupId === `hex-${hcg.id}` && (
                          <div className="absolute top-full left-0 mt-1 rounded-lg overflow-hidden z-50 max-h-64 overflow-y-auto" style={{ background: isMonochrome ? '#fff' : 'rgba(20,20,20,0.95)', border: `1px solid ${isMonochrome ? '#e5e7eb' : '#333'}`, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                            {models.map(m => (
                              <div
                                key={`${m.providerId}-${m.id}`}
                                className="px-3 py-2 text-xs cursor-pointer transition-colors flex items-center justify-between"
                                style={{
                                  background: hcg.toolbar.model === m.id && hcg.toolbar.providerId === m.providerId
                                    ? (isMonochrome ? '#dbeafe' : 'rgba(212,175,55,0.2)')
                                    : 'transparent',
                                  color: isMonochrome ? '#374151' : '#ccc',
                                }}
                                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = isMonochrome ? '#f3f4f6' : 'rgba(34,34,34,0.80)'; }}
                                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = hcg.toolbar.model === m.id && hcg.toolbar.providerId === m.providerId ? (isMonochrome ? '#dbeafe' : 'rgba(212,175,55,0.2)') : 'transparent'; }}
                                onClick={() => {
                                  // 获取新模型支持的参数，重置质量和比例
                                  const newSupportedRatios = findModelConfig(MODEL_ASPECT_RATIOS, m.id) || DEFAULT_ASPECT_RATIOS;
                                  const newResolutions = getResolutionTierOptions(m.id);
                                  const newQualityLevels = getQualityLevelOptions(m.id);
                                  const newAspectRatio = newSupportedRatios.includes('1:1') ? '1:1' : newSupportedRatios[0];
                                  const newResolution = newResolutions[0] || '2K';
                                  const newQuality = newQualityLevels[0] || 'auto';
                                  const newSize = calculateActualPixels(newAspectRatio, newResolution, m.id);
                                  setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, model: m.id, providerId: m.providerId, providerName: m.providerName, aspectRatio: newAspectRatio, resolution: newResolution, quality: newQuality, size: newSize } } : g));
                                  setOpenModelDropdownGroupId(null);
                                }}
                              >
                                <span>{m.apiDisplayName || getModelDisplayName(m.id)} · 来自 {m.providerName}</span>
                                {hcg.toolbar.model === m.id && hcg.toolbar.providerId === m.providerId && (
                                  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill={isMonochrome ? "#3b82f6" : "#d4af37"} stroke="none"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* 图像比例 + 分辨率/质量 */}
                      {(() => {
                        const hcgRatios = findModelConfig(MODEL_ASPECT_RATIOS, hcg.toolbar.model) || DEFAULT_ASPECT_RATIOS;
                        const hcgResolutions = getResolutionTierOptions(hcg.toolbar.model);
                        const hcgQualityLevels = getQualityLevelOptions(hcg.toolbar.model);
                        const paramType = getModelParamType(hcg.toolbar.model);
                        const curResolution = hcg.toolbar.resolution || hcgResolutions[0] || '2K';
                        const curQuality = hcg.toolbar.quality || hcgQualityLevels[0] || 'auto';
                        return (<>
                      {/* 图像比例 */}
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-medium" style={{ color: isMonochrome ? '#6b7280' : '#888' }}>比例</span>
                        <select
                          className="px-2 py-1.5 rounded-lg text-xs"
                          style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.08)', color: isMonochrome ? '#374151' : '#ccc', border: `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.10)'}` }}
                          value={hcg.toolbar.aspectRatio}
                          onChange={(e) => {
                            const newAr = e.target.value;
                            const newSize = calculateActualPixels(newAr, curResolution, hcg.toolbar.model);
                            setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, aspectRatio: newAr, size: newSize } } : g));
                          }}
                        >
                          {hcgRatios.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      {(paramType === 'both' || paramType === 'resolution') && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-medium" style={{ color: isMonochrome ? '#6b7280' : '#888' }}>分辨率</span>
                          <select
                            className="px-2 py-1.5 rounded-lg text-xs"
                            style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.08)', color: isMonochrome ? '#374151' : '#ccc', border: `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.10)'}` }}
                            value={curResolution}
                            onChange={(e) => {
                              const newRes = e.target.value;
                              const newSize = calculateActualPixels(hcg.toolbar.aspectRatio, newRes, hcg.toolbar.model);
                              setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, resolution: newRes, size: newSize } } : g));
                            }}
                          >
                            {hcgResolutions.map(q => <option key={q} value={q}>{RESOLUTION_TIER_DISPLAY_NAMES[q] || q}</option>)}
                          </select>
                        </div>
                      )}
                      {(paramType === 'both' || paramType === 'quality') && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-medium" style={{ color: isMonochrome ? '#6b7280' : '#888' }}>质量</span>
                          <select
                            className="px-2 py-1.5 rounded-lg text-xs"
                            style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.08)', color: isMonochrome ? '#374151' : '#ccc', border: `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.10)'}` }}
                            value={curQuality}
                            onChange={(e) => {
                              const newQ = e.target.value;
                              setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, quality: newQ } } : g));
                            }}
                          >
                            {hcgQualityLevels.map(q => <option key={q} value={q}>{QUALITY_LEVEL_DISPLAY_NAMES[q] || QUALITY_DISPLAY_NAMES[q] || q}</option>)}
                          </select>
                        </div>
                      )}
                      </>);
                      })()}
                      {/* 数量 */}
                      <select
                        className="px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.08)', color: isMonochrome ? '#374151' : '#ccc', border: `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.10)'}` }}
                        value={hcg.toolbar.outputCount}
                        onChange={(e) => setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, outputCount: parseInt(e.target.value) } } : g))}
                      >
                        {[1,2,3,4].map(n => <option key={n} value={n}>{n}张</option>)}
                      </select>
                    </div>
                    {/* 提示词 */}
                    <div className="relative">
                      <textarea
                        className="w-full rounded-lg px-3 py-2.5 text-sm resize-y"
                        style={{ background: isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.06)', color: isMonochrome ? '#111' : '#eee', border: `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.10)'}`, minHeight: 60, maxHeight: 160 }}
                        placeholder="描述你想要生成的产品效果..."
                        value={hcg.toolbar.prompt}
                        onChange={(e) => setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, prompt: e.target.value } } : g))}
                      />
                      <div className="absolute right-1.5 bottom-1 cursor-ns-resize" style={{ color: isMonochrome ? '#9ca3af' : '#555' }}>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                      </div>
                    </div>
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        className="px-3 py-2 rounded-lg text-xs font-medium transition-all"
                        style={{ background: isMonochrome ? '#eff6ff' : 'rgba(255,255,255,0.08)', color: isMonochrome ? '#3b82f6' : '#888', border: `1px solid ${isMonochrome ? '#bfdbfe' : 'rgba(255,255,255,0.10)'}` }}
                        onClick={async () => {
                          if (!hcg.toolbar.prompt.trim()) return;
                          setOptimizingGroupId(`hex-${hcg.id}`);
                          try {
                            // 不传 model/providerId，让服务端自动查找可用的 LLM (chat) 模型
                            const res = await fetch('/api/optimize-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: hcg.toolbar.prompt, mode: 'enhance' }) });
                            if (!res.ok) throw new Error(`优化提示词失败: HTTP ${res.status}`);
                            const data = await res.json();
                            if (data.optimized || data.optimizedPrompt) {
                              let optimizedPrompt = data.optimized || data.optimizedPrompt;
                              // 清理思考过程，保留中英文双语关键词
                              const hasThinkTags2 = /<think[\s\S]*?<\/think>/gi.test(optimizedPrompt) || /<thinking[\s\S]*?<\/thinking>/gi.test(optimizedPrompt);
                              optimizedPrompt = optimizedPrompt
                                .replace(/<think[\s\S]*?<\/think>/gi, '')
                                .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
                                .trim();
                              if (hasThinkTags2) {
                                optimizedPrompt = optimizedPrompt
                                  .replace(/【[^】]*】/g, '')
                                  .replace(/\*\*[^*]*\*\*/g, '')
                                  .trim();
                              }
                              setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, prompt: optimizedPrompt } } : g));
                            }
                          } catch (err) { console.error('优化失败:', err); }
                          setOptimizingGroupId(null);
                        }}
                        disabled={!hcg.toolbar.prompt.trim()}
                      >
                        {optimizingGroupId === `hex-${hcg.id}` ? '优化中...' : '一键优化'}
                      </button>
                      <button
                        className="flex-1 py-2.5 rounded-lg text-sm font-bold text-black transition-all hover:brightness-110 active:scale-[0.98]"
                        style={{ background: isMonochrome ? 'linear-gradient(135deg, #3b82f6, #60a5fa)' : 'linear-gradient(135deg, #d4af37, #f0d060)' }}
                        onClick={async () => {
                          if (!hcg.toolbar.model || !hcg.toolbar.prompt.trim()) return;
                          let hexCubeInput;
                          try {
                            hexCubeInput = buildHexCubeGenerationInput({
                              faces: hcg.faces,
                              rotationY: hcg.toolbar.rotationY,
                              tiltX: hcg.toolbar.tiltX,
                              zoom: hcg.toolbar.zoom,
                              userPrompt: hcg.toolbar.prompt,
                            });
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : '六面体参数无效');
                            return;
                          }
                          setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'generating', progress: 10 } : g));
                          try {
                            // 提交生成请求（带超时保护，匹配后端maxDuration）
                            const hexCubeController = new AbortController();
                            const hexCubeTimeout = setTimeout(() => hexCubeController.abort(), 600000); // 10分钟超时
                            let res: Response;
                            try {
                              res = await fetch('/api/generate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  ...hexCubeInput,
                                  model: hcg.toolbar.model,
                                  providerId: hcg.toolbar.providerId,
                                  aspectRatio: hcg.toolbar.aspectRatio,
                                  resolution: hcg.toolbar.resolution || '2K',
                                  quality: hcg.toolbar.quality || 'auto',
                                  n: hcg.toolbar.outputCount,
                                  submitOnly: true,
                                }),
                                signal: hexCubeController.signal,
                              });
                            } finally {
                              clearTimeout(hexCubeTimeout);
                            }
                            if (!res.ok) throw new Error(`HexCube生成失败: HTTP ${res.status}`);
                            const data = await res.json();
                            if (data.taskId || data.taskIds) {
                              const taskId = data.taskId || data.taskIds?.[0];
                              if (taskId) {
                                let attempts = 0;
                                const maxAttempts = 300;
                                const poll = async () => {
                                  if (attempts >= maxAttempts) return;
                                  attempts++;
                                  try {
                                    const pollRes = await fetch('/api/poll-task', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ taskId, model: hcg.toolbar.model, providerId: hcg.toolbar.providerId }),
                                    });
                                    const pollData = await pollRes.json();
                                    if (pollData.status === 'completed' && pollData.imageUrl) {
                                      if (onAddImages) onAddImages([pollData.imageUrl], undefined, { modelName: hcg.toolbar.model, apiProvider: modelProviderMap.get(hcg.toolbar.providerId || '') || hcg.toolbar.providerId });
                                      setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'completed', resultImageUrl: pollData.imageUrl, progress: 100 } : g));
                                      return;
                                    } else if (pollData.status === 'failed') {
                                      setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'idle', progress: 0 } : g));
                                      return;
                                    }
                                    setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, progress: Math.min(90, 10 + attempts * 2) } : g));
                                    setTimeout(poll, attempts <= 5 ? 300 : attempts <= 15 ? 600 : 1200);
                                  } catch { setTimeout(poll, 1500); }
                                };
                                poll();
                              }
                            } else if (data.imageUrl) {
                              if (onAddImages) onAddImages([data.imageUrl], undefined, { modelName: hcg.toolbar.model, apiProvider: modelProviderMap.get(hcg.toolbar.providerId || '') || hcg.toolbar.providerId });
                              setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'completed', resultImageUrl: data.imageUrl, progress: 100 } : g));
                            } else {
                              setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'idle', progress: 0 } : g));
                            }
                          } catch (err) {
                            console.error('生成失败:', err);
                            setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'idle', progress: 0 } : g));
                          }
                        }}
                        disabled={hcg.status === 'generating' || !hcg.toolbar.model || !hcg.toolbar.prompt.trim()}
                      >
                        {hcg.status === 'generating' ? `生成中 ${hcg.progress}%` : '生成'}
                      </button>
                    </div>
                  </div>
                </div>
                )}
              </div>
            </div>
          );
        })}

        {/* ====== IMAGE ACTION TOOLBAR (follows selected image) ====== */}
        {selectedIds.size === 1 && editMode === 'none' && activeTool === 'none' && !showDownloadPopup && !anyPanelOpen && (() => {
          const img = selectedImageData;
          if (!img) return null;
          const pos = getToolbarPosition();
          return (
            <div
              className="absolute z-50 pointer-events-auto"
              style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className={`flex items-center gap-0.5 px-1 py-1 rounded-full border shadow-xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-white/[0.12]'}`}>
                {displayedActions.map((action, idx) => (
                  <div key={action.label} className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); action.action(); }}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium transition-all ${
                        isMonochrome
                          ? 'text-blue-600 hover:bg-blue-50'
                          : 'text-gold-muted hover:text-text-bright hover:bg-white/10'
                      }`}
                      title={action.desc || action.label}
                    >
                      <span className={`${
                        isMonochrome
                          ? action.label === '放大' ? 'text-blue-500' : action.label === '移除背景' ? 'text-violet-500' : action.label === 'SVG智能描摹' || action.label === 'SVG描摹' ? 'text-pink-500' : action.label === '擦除' ? 'text-orange-500' : action.label === '蒙版' ? 'text-cyan-500' : action.label === '编辑元素' ? 'text-amber-500' : action.label === '扩展' ? 'text-blue-500' : action.label === '裁切' ? 'text-rose-500' : action.label === '精修引擎' ? 'text-violet-500' : action.label === '下载' ? 'text-teal-500' : action.label === 'Agent编排' ? 'text-purple-500' : action.label === '语言修图' ? 'text-fuchsia-500' : 'text-blue-500'
                          : ''
                      }`}>{action.icon}</span>
                      <span>{action.label}</span>
                    </button>
                    {idx < displayedActions.length - 1 && <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-px h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-white/[0.06]'}`} style={{ right: '-1px' }} />}
                  </div>
                ))}
                {/* 折叠/展开按钮 */}
                {hasMoreActions && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setToolbarExpanded(!toolbarExpanded); }}
                    className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isMonochrome
                        ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50'
                        : 'text-gold-muted hover:text-gold hover:bg-white/10'
                    }`}
                    title={toolbarExpanded ? '收起工具栏' : '展开更多工具'}
                  >
                    {toolbarExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    <span className="text-[10px]">{toolbarExpanded ? '收起' : `+${visibleImageActions.length - 5}`}</span>
                  </button>
                )}
                {/* 自定义按钮 */}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowToolbarCustomize(true); }}
                  className={`flex items-center px-1.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isMonochrome
                      ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                      : 'text-gold-muted/60 hover:text-gold-muted hover:bg-white/10'
                  }`}
                  title="自定义工具栏"
                >
                  <Settings2 size={12} />
                </button>
              </div>

              {/* 工具栏自定义弹窗 */}
              {showToolbarCustomize && (
                <div
                  className={`absolute top-full mt-2 left-1/2 -translate-x-1/2 w-72 p-3 rounded-xl border shadow-2xl z-50 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#141418] border-white/[0.12]'}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  data-popup="toolbar-customize"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs font-semibold ${isMonochrome ? 'text-blue-600' : 'text-gold'}`}>自定义工具栏</span>
                    <button onClick={() => setShowToolbarCustomize(false)} className={`p-1 rounded-lg ${isMonochrome ? 'text-blue-400 hover:text-blue-600' : 'text-gold-muted/70 hover:text-white'}`}><X size={14} /></button>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {toolbarItemOrder.filter(label => allActionLabels.includes(label)).map(label => {
                      const isHidden = toolbarHiddenItems.has(label);
                      return (
                        <div key={label} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${isMonochrome ? 'hover:bg-gray-50' : 'hover:bg-[#252525]'}`}>
                          <button
                            onClick={() => {
                              const newHidden = new Set(toolbarHiddenItems);
                              if (isHidden) newHidden.delete(label); else newHidden.add(label);
                              setToolbarHiddenItems(newHidden);
                            }}
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isHidden ? (isMonochrome ? 'border-gray-300' : 'border-white/[0.14]') : isMonochrome ? 'bg-blue-500 border-blue-500' : 'bg-gold border-gold'}`}
                          >
                            {!isHidden && <Check size={10} className="text-white" />}
                          </button>
                          <span className={`text-xs flex-1 ${isHidden ? (isMonochrome ? 'text-gray-400 line-through' : 'text-gold-muted/50 line-through') : (isMonochrome ? 'text-gray-700' : 'text-text-bright')}`}>{label}</span>
                          <div className="flex gap-0.5">
                            <button
                              onClick={() => {
                                const idx = toolbarItemOrder.indexOf(label);
                                if (idx > 0) {
                                  const newOrder = [...toolbarItemOrder];
                                  [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
                                  setToolbarItemOrder(newOrder);
                                }
                              }}
                              className={`p-0.5 rounded ${isMonochrome ? 'text-blue-400 hover:text-blue-600' : 'text-gold-muted/70 hover:text-white'}`}
                              title="上移"
                            ><ChevronUp size={12} /></button>
                            <button
                              onClick={() => {
                                const idx = toolbarItemOrder.indexOf(label);
                                if (idx < toolbarItemOrder.length - 1) {
                                  const newOrder = [...toolbarItemOrder];
                                  [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
                                  setToolbarItemOrder(newOrder);
                                }
                              }}
                              className={`p-0.5 rounded ${isMonochrome ? 'text-blue-400 hover:text-blue-600' : 'text-gold-muted/70 hover:text-white'}`}
                              title="下移"
                            ><ChevronDown size={12} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Image context menu */}
        {showContextMenu && (
          <div
            className={`fixed z-50 py-1.5 rounded-xl border shadow-2xl min-w-[160px] ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1e1e1e] border-[#333]'}`}
            data-popup="context-menu"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {imageContextMenuItems.map((item, idx) => (
              <button
                key={idx}
                onClick={() => { item.action(); setShowContextMenu(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                  isMonochrome ? 'text-gray-700 hover:bg-gray-100' : 'text-text-bright hover:bg-[#252525]'
                }`}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{item.shortcut}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Canvas context menu */}
        {showCanvasMenu && (
          <div
            className={`fixed z-50 py-1.5 rounded-xl border shadow-2xl min-w-[200px] ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1e1e1e] border-[#333]'}`}
            style={{ left: canvasMenuPos.x, top: canvasMenuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {canvasMenuItems.map((item, idx) => (
              <button
                key={idx}
                onClick={() => { item.action(); setShowCanvasMenu(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                  isMonochrome ? 'text-gray-700 hover:bg-gray-100' : 'text-text-bright hover:bg-[#252525]'
                }`}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{item.shortcut}</span>}
              </button>
            ))}
          </div>
        )}

        {showHelpModal && (
          <CanvasHelpModal mode={showHelpModal} isMonochrome={isMonochrome} onClose={() => setShowHelpModal(null)} />
        )}
      </div>

      {/* Canvas-Embedded Image Generator Panel */}
      {showCanvasGenerator && (() => {
        return (
          <div
            className="fixed z-[200]"
            style={{
              left: canvasGenPanelPos.x,
              top: canvasGenPanelPos.y,
              width: 420,
              backgroundColor: isMonochrome ? '#fff' : '#1a1a1a',
              border: canvasGenDragging
                ? `2px solid ${isMonochrome ? '#2563eb' : '#d4af37'}`
                : `1px solid ${isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.08)'}`,
              boxShadow: canvasGenDragging
                ? (isMonochrome ? '0 0 24px rgba(37,99,235,0.25), 0 25px 50px -12px rgba(0,0,0,0.25)' : '0 0 24px rgba(212,175,55,0.3), 0 25px 50px -12px rgba(0,0,0,0.5)')
                : (isMonochrome ? '0 25px 50px -12px rgba(0,0,0,0.25)' : '0 25px 50px -12px rgba(0,0,0,0.5)'),
              borderRadius: 16,
              overflow: 'hidden',
            }}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            data-popup
          >
            {/* Header - 可拖拽 */}
            <div
              data-panel-header
              className={`flex items-center gap-2 px-3 py-2 cursor-move select-none shrink-0 ${canvasGenMinimized ? 'rounded-2xl' : ''}`}
              style={{ borderBottom: canvasGenMinimized ? 'none' : `1px solid ${isMonochrome ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}` }}
              onMouseDown={handleCanvasGenDragStart}
            >
              <GripVertical size={14} style={{ color: isMonochrome ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)' }} />
              <Sparkles size={15} style={{ color: isMonochrome ? '#6b6b6b' : '#d4af37' }} />
              <span className="text-base font-semibold flex-1" style={{ color: isMonochrome ? '#6b6b6b' : '#d4af37' }}>
                图像生成器
              </span>
              {canvasGenModel && (() => {
                const m = canvasGenModels.find(m => `${m.providerId}::${m.id}` === canvasGenModel);
                return m ? (
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: isMonochrome ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.5)', background: isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)' }}>
                    {getModelDisplayName(m.id)}
                  </span>
                ) : null;
              })()}
              <button
                onClick={() => setCanvasGenMinimized(!canvasGenMinimized)}
                className="p-2 min-h-[44px] min-w-[44px] rounded-md transition-colors"
                aria-label="最小化"
                style={{ color: isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)' }}
                onMouseEnter={e => (e.currentTarget.style.color = isMonochrome ? '#000' : '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)')}
              >
                <Minus size={14} />
              </button>
              <button
                onClick={handleOpenCanvasGenerator}
                className="p-2 min-h-[44px] min-w-[44px] rounded-md transition-colors"
                aria-label="关闭"
                style={{ color: isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)' }}
                onMouseEnter={e => (e.currentTarget.style.color = isMonochrome ? '#000' : '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)')}
              >
                <X size={14} />
              </button>
            </div>

            {/* Content */}
            {!canvasGenMinimized && (
            <div className="p-3.5 space-y-3 max-h-[calc(85vh-50px)] overflow-y-auto">
              {/* Preview Frame - 根据画面比例显示预览框 */}
              <div className="flex justify-center mb-3">
                <div
                  className="relative rounded-lg overflow-hidden flex items-center justify-center"
                  style={{
                    width: (() => {
                      const ratioMap: Record<string, number> = { '1:1': 200, '16:9': 360, '9:16': 180, '4:3': 260, '3:4': 200, '3:2': 300, '2:3': 200, '21:9': 380, '9:21': 160 };
                      return ratioMap[canvasGenAspectRatio] || 280;
                    })(),
                    height: (() => {
                      const ratioMap: Record<string, number> = { '1:1': 200, '16:9': 200, '9:16': 360, '4:3': 200, '3:4': 260, '3:2': 200, '2:3': 300, '21:9': 160, '9:21': 380 };
                      return ratioMap[canvasGenAspectRatio] || 200;
                    })(),
                    background: isMonochrome ? '#f5f5f5' : '#0d0d0d',
                    border: `1px solid ${isMonochrome ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  {/* 空白状态 - 显示比例标识 */}
                  {!canvasGenGenerating && !canvasGenPreviewUrl && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className={`text-2xl font-light ${isMonochrome ? 'text-gray-300' : 'text-white/20'}`}>
                          {canvasGenAspectRatio}
                        </div>
                        <div className={`mt-1 text-xs ${isMonochrome ? 'text-gray-400' : 'text-white/30'}`}>
                          {(() => {
                            const ratioMap: Record<string, string> = { '1:1': '方形', '16:9': '横屏', '9:16': '竖屏', '4:3': '传统横屏', '3:4': '传统竖屏', '3:2': '经典横屏', '2:3': '经典竖屏', '21:9': '超宽屏', '9:21': '超竖屏' };
                            return ratioMap[canvasGenAspectRatio] || '自定义';
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 生成中状态 - 显示进度 */}
                  {canvasGenGenerating && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="animate-spin mb-2">
                          <Loader2 size={32} style={{ color: isMonochrome ? '#2563eb' : '#d4af37' }} />
                        </div>
                        <div className={`text-sm ${isMonochrome ? 'text-gray-600' : 'text-white/60'}`}>
                          生成中...
                        </div>
                        {canvasGenProgress > 0 && (
                          <div className="mt-2 w-40 h-1.5 rounded-full overflow-hidden" style={{ background: isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.1)' }}>
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${canvasGenProgress}%`, background: isMonochrome ? '#2563eb' : '#d4af37' }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* 生成完成 - 显示结果图片 */}
                  {canvasGenPreviewUrl && !canvasGenGenerating && (
                    <NextImage unoptimized width={1} height={1}                       src={canvasGenPreviewUrl}
                      alt="生成结果"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {/* B3: 部分失败补发按钮 */}
                  {canvasGenPartialFailCount > 0 && !canvasGenGenerating && canvasGenPreviewUrl && (
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
                      <button
                        onClick={async () => {
                          if (canvasGenGenerating) return;
                          const missing = canvasGenPartialFailCount;
                          setCanvasGenPartialFailCount(0);
                          setCanvasGenGenerating(true);
                          setCanvasGenProgress(0);
                          try {
                            const resp = await fetch('/api/generate', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                prompt: canvasGenPrompt,
                                negative: canvasGenNegativePrompt,
                                model: canvasGenModel,
                                aspectRatio: canvasGenAspectRatio,
                                resolution: canvasGenResolution,
                                quality: canvasGenQuality,
                                n: missing,
                              }),
                            });
                            if (!resp.ok) throw new Error(`生成失败: ${resp.status}`);
                            const data = await resp.json();
                            const newTaskIds: string[] = data.taskIds || [data.taskId].filter(Boolean);
                            const retryResults = await Promise.all(newTaskIds.map((tid: string) => pollForResult(tid, canvasGenModel)));
                            const retryUrls = retryResults.filter((url): url is string => url !== null);
                            if (retryUrls.length > 0) {
                              const frameImg = imagesRef.current.find(img => img.id === canvasGenFrameId);
                              const baseX = frameImg ? frameImg.x + frameImg.width + 20 : 100;
                              const baseY = frameImg ? frameImg.y : 100;
                              const extraImages = retryUrls.map((url, i) => ({
                                id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                                url,
                                x: baseX + i * 20,
                                y: baseY + i * 20,
                                width: 512,
                                height: 512,
                                prompt: canvasGenPrompt,
                                model: canvasGenModel?.includes('::') ? canvasGenModel.split('::').pop()! : canvasGenModel,
                                quality: canvasGenQuality,
                                aspectRatio: canvasGenAspectRatio,
                                modelName: canvasGenModel,
                                apiProvider: '',
                              }));
                              onImagesChange([...imagesRef.current, ...extraImages]);
                            }
                            setCanvasGenPartialFailCount(Math.max(0, missing - retryUrls.length));
                          } catch {
                            setCanvasGenPartialFailCount(missing);
                          } finally {
                            setCanvasGenGenerating(false);
                            setCanvasGenProgress(100);
                          }
                        }}
                        disabled={canvasGenGenerating}
                        className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                          isMonochrome
                            ? 'bg-blue-500 text-white hover:bg-blue-600'
                            : 'bg-[#d4af37] text-[#1a1a1a] hover:bg-[#c4a030]'
                        }`}
                      >
                        补发 {canvasGenPartialFailCount} 张失败图片
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {/* Model selector */}
              <div className="flex items-center gap-2.5">
                <label className={`text-xs font-medium min-w-[42px] ${isMonochrome ? 'text-gray-500' : 'text-[#777]'}`}>模型</label>
                <select
                  value={canvasGenModel}
                  onChange={(e) => {
                    const newModelKey = e.target.value;
                    const newModelId = newModelKey ? newModelKey.split('::').pop() || '' : '';
                    setCanvasGenModel(newModelKey);
                    if (newModelId) {
                      // 模型切换时重置参数为新模型支持的默认值
                      const newSupportedRatios = findModelConfig(MODEL_ASPECT_RATIOS, newModelId) || DEFAULT_ASPECT_RATIOS;
                      const newResolutionTiers = getResolutionTierOptions(newModelId);
                      const newQualityLevels = getQualityLevelOptions(newModelId);
                      // 根据模型名后缀自动选择默认分辨率/质量
                      const lower = newModelId.toLowerCase();
                      let defaultResolution = newResolutionTiers[0] || '2K';
                      let defaultQuality = newQualityLevels[0] || 'auto';
                      if (lower.includes('-4k') && newResolutionTiers.includes('4K')) defaultResolution = '4K';
                      else if (lower.includes('-2k') && newResolutionTiers.includes('2K')) defaultResolution = '2K';
                      if (lower.includes('-hd') || lower.includes('-high')) {
                        if (newQualityLevels.includes('high')) defaultQuality = 'high';
                      } else if (lower.includes('-4k') || lower.includes('-2k')) {
                        defaultQuality = newQualityLevels.includes('high') ? 'high' : defaultQuality;
                      }
                      // 优先保留当前值，如果当前值不被支持则使用推导的默认值
                      if (!newSupportedRatios.includes(canvasGenAspectRatio)) {
                        const defaultRatio = newSupportedRatios.includes('1:1') ? '1:1' : newSupportedRatios[0];
                        setCanvasGenAspectRatio(defaultRatio);
                      }
                      if (!newResolutionTiers.includes(canvasGenResolution)) {
                        setCanvasGenResolution(defaultResolution);
                      }
                      if (!newQualityLevels.includes(canvasGenQuality)) {
                        setCanvasGenQuality(defaultQuality);
                      }
                    }
                  }}
                  className={`flex-1 text-xs rounded-lg px-3 py-2 border outline-none transition-colors ${
                    isMonochrome
                      ? 'bg-white border-gray-200 text-gray-900 focus:border-gray-400'
                      : 'bg-[#0d0d0d] border-white/[0.12] text-text-bright focus:border-gold/40'
                  }`}
                >
                  {canvasGenModels.length === 0 && <option value="">暂无可用模型</option>}
                  {canvasGenModels.map(m => {
                    const compositeKey = `${m.providerId}::${m.id}`;
                    return <option key={compositeKey} value={compositeKey}>{m.apiDisplayName || getModelDisplayName(m.id)}{m.providerName ? ` (${m.providerName})` : ''}</option>;
                  })}
                </select>
              </div>

              {/* 图像比例 + 分辨率/质量 - 根据模型动态显示 */}
              {(() => {
                // 解析当前选中的模型ID
                const modelId = canvasGenModel ? canvasGenModel.split('::').pop() || '' : '';
                const paramType = modelId ? getModelParamType(modelId) : 'both';
                const modelRatios = modelId ? (findModelConfig(MODEL_ASPECT_RATIOS, modelId) || DEFAULT_ASPECT_RATIOS) : DEFAULT_ASPECT_RATIOS;
                const modelResolutions = modelId ? getResolutionTierOptions(modelId) : ['1K', '2K', '4K'];
                const modelQualities = modelId ? getQualityLevelOptions(modelId) : ['auto', 'low', 'medium', 'high'];
                return (
                <div className="flex items-center gap-2.5 flex-wrap">
                  <label className={`text-xs font-medium min-w-[42px] ${isMonochrome ? 'text-gray-500' : 'text-[#777]'}`}>图像比例</label>
                  <select
                    value={canvasGenAspectRatio}
                    onChange={(e) => {
                      const newAr = e.target.value;
                      setCanvasGenAspectRatio(newAr);
                    }}
                    className={`text-xs rounded-lg px-3 py-2 border outline-none transition-colors w-[110px] ${
                      isMonochrome
                        ? 'bg-white border-gray-200 text-gray-900 focus:border-gray-400'
                        : 'bg-[#0d0d0d] border-white/[0.12] text-text-bright focus:border-gold/40'
                    }`}
                  >
                    {modelRatios.map(r => {
                      const px = calculateActualPixels(r, canvasGenResolution, modelId);
                      return <option key={r} value={r}>{r} ({px})</option>;
                    })}
                  </select>
                  {(paramType === 'both' || paramType === 'resolution') && (
                    <>
                      <label className={`text-xs font-medium min-w-[30px] ${isMonochrome ? 'text-gray-500' : 'text-[#777]'}`}>分辨率</label>
                      <select
                        value={canvasGenResolution}
                        onChange={(e) => setCanvasGenResolution(e.target.value)}
                        className={`text-xs rounded-lg px-3 py-2 border outline-none transition-colors w-[90px] ${
                          isMonochrome
                            ? 'bg-white border-gray-200 text-gray-900 focus:border-gray-400'
                            : 'bg-[#0d0d0d] border-white/[0.12] text-text-bright focus:border-gold/40'
                        }`}
                      >
                        {modelResolutions.map(r => <option key={r} value={r}>{RESOLUTION_TIER_DISPLAY_NAMES[r] || r}</option>)}
                      </select>
                    </>
                  )}
                  {(paramType === 'both' || paramType === 'quality') && (
                    <>
                      <label className={`text-xs font-medium min-w-[30px] ${isMonochrome ? 'text-gray-500' : 'text-[#777]'}`}>质量</label>
                      <select
                        value={canvasGenQuality}
                        onChange={(e) => setCanvasGenQuality(e.target.value)}
                        className={`text-xs rounded-lg px-3 py-2 border outline-none transition-colors w-[90px] ${
                          isMonochrome
                            ? 'bg-white border-gray-200 text-gray-900 focus:border-gray-400'
                            : 'bg-[#0d0d0d] border-white/[0.12] text-text-bright focus:border-gold/40'
                        }`}
                      >
                        {modelQualities.map(q => <option key={q} value={q}>{QUALITY_LEVEL_DISPLAY_NAMES[q] || QUALITY_DISPLAY_NAMES[q] || q}</option>)}
                      </select>
                    </>
                  )}
                </div>);
              })()}

              {/* Count + Reference */}
              <div className="flex items-center gap-2.5">
                <label className={`text-xs font-medium min-w-[42px] ${isMonochrome ? 'text-gray-500' : 'text-[#777]'}`}>数量</label>
                <div className="flex items-center gap-1.5">
                  {[1, 2, 4].map(n => (
                    <button
                      key={n}
                      onClick={() => setCanvasGenCount(n)}
                      className={`w-8 h-7 text-xs rounded-lg transition-all font-medium ${
                        canvasGenCount === n
                          ? isMonochrome
                            ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20'
                            : 'bg-gradient-to-b from-[#d4af37] to-[#b8860b] text-black shadow-md shadow-[#d4af37]/20'
                          : isMonochrome
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                            : 'bg-[#252525] text-gold-muted hover:bg-[#333] border border-[#444]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async (e: Event) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      try {
                        const formData = new FormData();
                        formData.append('file', file);
                        const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
                        if (upRes.ok) { const upData = await upRes.json(); setCanvasGenRefImages(prev => [...prev, upData.url]); }
                      } catch { /* silent */ }
                    };
                    input.click();
                  }}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors border ${
                    isMonochrome
                      ? 'text-gray-500 hover:bg-gray-100 border-gray-200'
                      : 'text-gold-muted hover:bg-[#333] hover:text-[#bbb] border-[#444]'
                  }`}
                >
                  <ImagePlus size={12} />
                  <span>参考图</span>
                  {canvasGenRefImages.length > 0 && <span className={isMonochrome ? "text-blue-500 font-medium" : "text-gold font-medium"}>({canvasGenRefImages.length})</span>}
                </button>
              </div>

              {/* Reference images thumbnails */}
              {canvasGenRefImages.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {canvasGenRefImages.map((refUrl, idx) => (
                    <div key={idx} className="relative group">
                      <NextImage unoptimized width={1} height={1} src={refUrl} alt="" className={`w-9 h-9 rounded-lg object-cover border ${isMonochrome ? 'border-gray-200' : 'border-white/[0.12]'}`} />
                      <button
                        onClick={() => setCanvasGenRefImages(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                      >
                        <X size={8} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Prompt input */}
              <textarea
                value={canvasGenPrompt}
                onChange={(e) => setCanvasGenPrompt(e.target.value)}
                placeholder="描述你想要生成的图像..."
                className={`w-full text-sm rounded-xl px-3.5 py-2.5 border outline-none resize-none h-[72px] leading-relaxed transition-colors ${
                  isMonochrome
                    ? 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-gray-400'
                    : 'bg-[#0d0d0d] border-white/[0.12] text-text-bright placeholder:text-gold-muted/50 focus:border-gold/40'
                } focus:ring-1 ${isMonochrome ? 'focus:ring-blue-200' : 'focus:ring-gold/30/20'}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleCanvasGenerate();
                  }
                }}
              />

              {/* Generate button */}
              <button
                onClick={handleCanvasGenerate}
                disabled={canvasGenGenerating || !canvasGenPrompt.trim()}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  canvasGenGenerating || !canvasGenPrompt.trim()
                    ? isMonochrome
                      ? 'bg-blue-200 text-blue-400 cursor-not-allowed'
                      : 'bg-[#222]/80 text-gold-muted/50 cursor-not-allowed border border-white/[0.12]'
                    : isMonochrome
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/20 active:scale-[0.98]'
                      : 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black hover:from-[#e0bc4a] hover:to-[#cd9b1d] shadow-lg shadow-[#d4af37]/20 active:scale-[0.98]'
                }`}
              >
                {canvasGenGenerating ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-[#555] border-t-transparent rounded-full animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Wand2 size={14} />
                    生成
                    <span className={`text-xs font-normal ${isMonochrome ? 'text-gray-500' : 'text-black/50'}`}>Ctrl+Enter</span>
                  </>
                )}
              </button>
            </div>
            )}
          </div>
        );
      })()}

      {/* 图层面板 */}
      {showLayerPanel && (
        <Suspense fallback={null}>
          <LayerPanel
            images={images}
            selectedIds={Array.from(selectedIds)}
            isMonochrome={isMonochrome}
            onSelect={(ids) => setSelectedIds(new Set(ids))}
            onReorder={(newImages) => onImagesChange(newImages)}
            onToggleVisibility={(id) => {
              onImagesChange(images.map(img => 
                img.id === id ? { ...img, visible: !img.visible } : img
              ));
            }}
            onToggleLock={(id) => {
              onImagesChange(images.map(img => 
                img.id === id ? { ...img, locked: !img.locked } : img
              ));
            }}
            onRename={(id, name) => {
              onImagesChange(images.map(img => 
                img.id === id ? { ...img, name } : img
              ));
            }}
            onDelete={(id) => {
              onImagesChange(images.filter(img => img.id !== id));
              setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
            }}
            onClose={() => setShowLayerPanel(false)}
          />
        </Suspense>
      )}

      {/* 版本历史面板 */}
      {showVersionHistory && versionHistoryManager && (
        <Suspense fallback={null}>
          <VersionHistoryPanel
            manager={versionHistoryManager}
            isMonochrome={isMonochrome}
            onRestore={(nodeId) => {
              const snapshot = versionHistoryManager?.getSnapshot(nodeId);
              if (snapshot) {
                onImagesChange(snapshot);
                setSelectedIds(new Set());
              }
            }}
            onCreateBranch={(nodeId) => {
              versionHistoryManager?.setCurrentNodeId(nodeId);
            }}
            onClose={() => setShowVersionHistory(false)}
          />
        </Suspense>
      )}

        {/* Floating pill toolbar - semi-collapsed, expand on hover */}
      <div
        data-toolbar="bottom-toolbar"
        onMouseEnter={() => setBottomBarHovered(true)}
        onMouseLeave={() => setBottomBarHovered(false)}
        className={`absolute bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-full px-2.5 py-1.5 flex items-center transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${isMonochrome ? 'bg-white/95 border border-gray-200 shadow-lg' : 'bg-[#1a1a1a]/95 border border-white/[0.08] shadow-2xl backdrop-blur-md'} ${bottomBarHovered ? (isMonochrome ? 'shadow-xl' : 'shadow-2xl ring-1 ring-white/[0.06]') : ''}`}
      >
        {/* ── Center: Main function buttons (always visible) ── */}
        <button
          aria-label="选择工具"
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 ${isMonochrome ? `${mIcon.mousePointer} hover:text-gray-700 hover:bg-gray-100` : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
          title="选择工具"
        >
          <MousePointer2 className="h-4 w-4" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">选择工具</span>
        </button>

        <button
          aria-label="抓手工具"
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 ${
            isPanning || isSpacePressed
              ? (isMonochrome ? 'text-blue-600 bg-blue-50 ring-1 ring-blue-500/30' : 'text-text-bright bg-white/15 ring-1 ring-gold/30')
              : (isMonochrome ? `text-gray-500 hover:text-gray-700 hover:bg-gray-100` : 'text-gold-muted hover:text-text-bright hover:bg-white/10')
          }`}
          title="抓手工具"
          onClick={() => {
            setIsSpacePressed(true);
            const handleUp = (e: MouseEvent) => {
              if (isEventFromOverlay(e)) return;
              setIsSpacePressed(false);
              window.removeEventListener('mouseup', handleUp);
            };
            window.addEventListener('mouseup', handleUp);
          }}
        >
          <Hand className={`h-4 w-4 ${mIcon.hand}`} />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">抓手工具</span>
        </button>

        <div className={`w-px h-5 mx-1 ${separatorCls}`} />

        <input ref={uploadFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCanvasImageUpload} />
        <button
          aria-label="图片上传"
          onClick={() => uploadFileInputRef.current?.click()}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
          title="图片上传"
        >
          <Upload className={`h-4 w-4 ${mIcon.upload}`} />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">图片上传</span>
        </button>

        <div className={`w-px h-5 mx-1 ${separatorCls}`} />

        {/* Image Generator - gold accent */}
        <button
          aria-label="图像生成器"
          onClick={handleOpenCanvasGenerator}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] shadow-lg relative group hover:scale-110 active:scale-95 ${showCanvasGenerator ? (isMonochrome ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white ring-2 ring-blue-500/50' : 'bg-gradient-to-r from-gold to-gold-dark text-black ring-2 ring-gold/50') : (isMonochrome ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white' : 'bg-gradient-to-r from-gold to-gold-dark hover:from-gold-light hover:to-gold text-black')}`}
          title="图像生成器"
        >
          <Sparkles className="h-4 w-4" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">图像生成器</span>
        </button>

        <div className={`w-px h-5 mx-1.5 ${separatorCls}`} />

        {/* ── Right: Feature buttons (collapsible) ── */}
        <div
          className={`flex items-center transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
            bottomBarHovered ? 'max-w-[900px] opacity-100 ml-1.5 overflow-visible' : 'max-w-0 opacity-0 ml-0 overflow-hidden'
          }`}
        >
          <div className={`w-px h-5 mr-1.5 ${separatorCls}`} />

          {/* 图转3D工厂 - moved inside collapsible area */}
          <button
            aria-label="图转3D工厂"
            onClick={() => handleOpen3D(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${show3DModal ? (isMonochrome ? 'text-indigo-600 bg-indigo-50 ring-2 ring-indigo-500/50' : 'text-text-bright bg-gold/20 ring-2 ring-gold/40') : (isMonochrome ? 'text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50' : 'text-gold-muted hover:text-gold-light hover:bg-gold/10')}`}
            title="图转3D工厂"
          >
            <BoxIcon className={`h-4 w-4 ${isMonochrome ? 'text-indigo-500' : ''}`} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">图转3D工厂</span>
          </button>

          {/* Language Edit */}
          <button
            aria-label="语言修图"
            onClick={() => { onEditImage?.(null); }}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="语言修图"
          >
            <Pencil className={`h-4 w-4 ${mIcon.pencil}`} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">修图</span>
          </button>

          {/* Agent Edit */}
          <button
            aria-label="Agent编排"
            onClick={() => { setAgentEditImage(null); setShowAgentEditor(true); }}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="Agent编排"
          >
            <Bot className={`h-4 w-4 ${mIcon.bot}`} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">Agent</span>
          </button>

          {/* Video Generation - Floating Panel */}
          <button
            aria-label="视频生成"
            onClick={() => {
              onOpenVideoPanel?.();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('wujie:open-video-panel'));
              }
            }}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-blue-500 hover:text-blue-600 hover:bg-blue-50' : 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10'}`}
            title="视频生成"
          >
            <Film className="h-4 w-4" />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">视频生成</span>
          </button>

          <div className={`w-px h-5 mx-1 ${separatorCls} shrink-0`} />

          {/* Brand E-commerce */}
          <button
            aria-label="品牌电商"
            onClick={() => setShowBrandEcommerce(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="品牌电商"
          >
            <ShoppingBag className={`h-4 w-4 ${mIcon.shoppingBag}`} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">品牌电商</span>
          </button>

          {/* Refine Engine */}
          <button
            aria-label="精修引擎"
            onClick={() => { setRefineEngineImageUrl(''); setShowRefineEngine(true); }}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="精修引擎"
          >
            <Scan className={`h-4 w-4 ${mIcon.scan}`} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">精修引擎</span>
          </button>

          {/* Font Design */}
          <button
            aria-label="字境大师"
            onClick={() => setShowFontDesign(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-amber-600 hover:text-amber-500 hover:bg-amber-50' : 'text-gold hover:text-gold-light hover:bg-gold/10'}`}
            title="字境大师"
          >
            <span className="text-sm font-bold leading-none">字</span>
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">字境大师</span>
          </button>

          {/* Brand Factory */}
          <button
            onClick={() => setShowBrandFactory(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="品牌工厂"
          >
            <Building2 className={`h-4 w-4 ${mIcon.building}`} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">品牌工厂</span>
          </button>

          {/* Logo Generator Pro */}
          <button
            onClick={() => setShowLogoSkill(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-violet-600 hover:text-violet-500 hover:bg-violet-50' : 'text-gold hover:text-gold-light hover:bg-gold/10'}`}
            title="Logo生成器 Pro"
          >
            <PenTool className="h-4 w-4" />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">Logo Pro</span>
          </button>

          {/* 3D构图画布 Pro */}
          <button
            onClick={() => setShowSceneStudio(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="3D构图画布 Pro"
          >
            <Boxes className={`h-4 w-4 ${mIcon.hexCube}`} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">3D构图</span>
          </button>

          {/* 品牌包装系统 Pro */}
          <button
            onClick={() => setShowBrandPackaging(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="品牌包装系统 Pro"
          >
            <Package className="h-4 w-4" />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">包装Pro</span>
          </button>

          {/* 3D展陈系统 Pro */}
          <button
            onClick={() => setShowDisplay3D(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="3D展陈系统 Pro"
          >
            <Store className="h-4 w-4" />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">展陈Pro</span>
          </button>

          {/* AI PSD Generator */}
          <button
            onClick={() => setShowAiPsd(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="AI PSD生成器"
          >
            <FileImage className={`h-4 w-4 ${mIcon.fileImage}`} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">AI PSD</span>
          </button>

          {/* Sticker Assistant */}
          <button
            onClick={() => setShowStickerAssistant(true)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="表情助手"
          >
            <svg className={`h-4 w-4 ${mIcon.heart}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="2.5" />
              <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="2.5" />
            </svg>
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">表情助手</span>
          </button>

          <div className={`w-px h-5 mx-1 ${separatorCls} shrink-0`} />

          {/* HexCube */}
          <button
            onClick={handleCreateHexCube}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
            title="六面体"
          >
            <svg className={`h-4 w-4 ${mIcon.hexCube}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" />
              <path d="M12 3v18" />
              <path d="M3 8l9 5 9-5" />
            </svg>
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">六面体</span>
          </button>

          {/* ChatCanvas 批注模式 */}
          <button
            onClick={() => setAnnotationMode(prev => !prev)}
            className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${annotationMode ? (isMonochrome ? 'text-blue-500 bg-blue-50 ring-1 ring-blue-500/30' : 'text-gold bg-gold/20 ring-1 ring-gold/40') : (isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-gold-muted hover:text-gold-light hover:bg-gold/10')}`}
            title="ChatCanvas 批注 (C)"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">ChatCanvas (C)</span>
          </button>
        </div>

        {/* ── Far-right: Auxiliary controls (always visible) ── */}
        <div className={`w-px h-5 ml-1.5 ${separatorCls}`} />

        {/* Zoom controls */}
        <button
          onClick={() => { setZoom(z => Math.max(0.1, z / 1.2)); }}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
          title="缩小画布"
        >
          <ZoomOut className={`h-3.5 w-3.5 ${mIcon.zoomOut}`} />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">缩小</span>
        </button>

        <span className={`text-xs font-mono w-10 text-center select-none shrink-0 ${isMonochrome ? 'text-gray-500' : 'text-gold'}`}>
          {Math.round(zoom * 100)}%
        </span>

        <button
          onClick={() => { setZoom(z => Math.min(5, z * 1.2)); }}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
          title="放大画布"
        >
          <ZoomIn className={`h-3.5 w-3.5 ${mIcon.zoomIn}`} />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">放大</span>
        </button>

        <div className={`w-px h-5 mx-1 ${separatorCls} shrink-0`} />

        {/* Reset view */}
        <button
          onClick={() => { setZoom(1); setViewOffset({ x: 0, y: 0 }); }}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
          title="重置视图"
        >
          <Maximize2 className="h-4 w-4" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">重置视图</span>
        </button>

        {/* Grid mode toggle */}
        <button
          onClick={() => setGridMode(prev => prev === 'dots' ? 'lines' : prev === 'lines' ? 'blank' : 'dots')}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
          title={`网格: ${gridMode === 'dots' ? '点阵' : gridMode === 'lines' ? '线条' : '空白'}`}
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">{gridMode === 'dots' ? '点阵' : gridMode === 'lines' ? '线条' : '空白'}</span>
        </button>

        {/* Connection lines toggle */}
        <button
          onClick={() => setShowConnections(prev => !prev)}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${showConnections ? (isMonochrome ? 'text-blue-500 bg-blue-50 ring-1 ring-blue-500/30' : 'text-gold bg-gold/20 ring-1 ring-gold/40') : (isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-gold-muted hover:text-gold-light hover:bg-gold/10')}`}
          title={showConnections ? '隐藏连线' : '显示连线'}
        >
          <GitMerge className="h-4 w-4" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">{showConnections ? '隐藏连线' : '显示连线'}</span>
        </button>

        {/* 图层面板按钮 */}
        <button
          onClick={() => setShowLayerPanel(prev => !prev)}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${showLayerPanel ? (isMonochrome ? 'text-blue-500 bg-blue-50 ring-1 ring-blue-500/30' : 'text-gold bg-gold/20 ring-1 ring-gold/40') : (isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-gold-muted hover:text-gold-light hover:bg-gold/10')}`}
          title={showLayerPanel ? '关闭图层' : '打开图层'}
        >
          <Layers className="h-4 w-4" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">{showLayerPanel ? '关闭图层' : '图层面板'}</span>
        </button>

        {/* 版本历史按钮 */}
        <button
          onClick={() => setShowVersionHistory(prev => !prev)}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${showVersionHistory ? (isMonochrome ? 'text-blue-500 bg-blue-50 ring-1 ring-blue-500/30' : 'text-gold bg-gold/20 ring-1 ring-gold/40') : (isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-gold-muted hover:text-gold-light hover:bg-gold/10')}`}
          title={showVersionHistory ? '关闭版本历史' : '版本历史'}
        >
          <GitBranch className="h-4 w-4" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">{showVersionHistory ? '关闭历史' : '版本历史'}</span>
        </button>

        <div className={`w-px h-5 mx-1 ${separatorCls} shrink-0`} />

        {/* AI 引擎选择 */}
        <button
          onClick={() => setEngineDialog('upscale')}
          className={`p-2 rounded-full transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 ${isMonochrome ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gold-muted hover:text-text-bright hover:bg-white/10'}`}
          title="AI 引擎设置 (放大/去背景/SVG/分层)"
        >
          <Settings className="h-4 w-4" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">AI引擎设置</span>
        </button>

        {/* Generating progress (always visible when active) */}
        {isGenerating && (
          <>
            <div className={`w-px h-5 mx-1 ${separatorCls}`} />
            <div className="flex items-center gap-1.5">
              <div className="w-14 h-1.5 rounded-full overflow-hidden bg-[#333]">
                <div className="h-full rounded-full progress-bar shimmer" style={{ 
                  width: `${generationProgress ? (generationProgress.current / generationProgress.total * 100) : 0}%`,
                  background: 'linear-gradient(90deg, #C8A45C, #E8D5A3, #C8A45C)'
                }} />
              </div>
              <span className="text-xs text-gold/80">生成中</span>
            </div>
          </>
        )}
      </div>

      {/* AI 引擎选择对话框 */}
      <EngineSelectDialog
        open={engineDialog !== null}
        title={
          engineDialog === 'upscale' ? '放大引擎选择' :
          engineDialog === 'removebg' ? '去背景引擎选择' :
          engineDialog === 'svg' ? 'SVG描摹引擎选择' :
          '元素分层引擎选择'
        }
        subtitle="设置当前工具使用的处理引擎"
        toolType={(engineDialog || 'upscale') as 'upscale' | 'removebg' | 'svg' | 'segment'}
        onSelect={(eng: EditEngine) => {
          if (engineDialog === 'upscale') setUpscaleEnginePref(eng);
          else if (engineDialog === 'removebg') setRemoveBgEngine(eng);
          else if (engineDialog === 'svg') setSvgTraceEngine(eng === 'local' ? 'vtracer' : eng === 'ai' ? 'vlm' : 'auto');
          else if (engineDialog === 'segment') setSegmentEnginePref(eng);
          setEngineDialog(null);
          toast(`引擎已设置为：${eng === 'auto' ? '自动' : eng === 'ai' ? '云端AI' : '本地算法'}`);
        }}
        onClose={() => setEngineDialog(null)}
      />
    </div>
  );
}
