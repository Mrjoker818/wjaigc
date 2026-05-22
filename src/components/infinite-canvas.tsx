'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import {
  Plus, Trash2, Copy, Download, Image as ImageIcon,
  Move, ZoomIn, ZoomOut, Maximize2, Hand, Info,
  FileText, X, ChevronDown, ArrowUpFromLine, Eraser,
  Scissors, Wand2, Expand, Layers, Paintbrush,
  Check, MousePointer2, BoxSelect, Upload, Eye, Sparkles,
  RotateCcw, Minus, Type, GitMerge, Wrench, ChevronRight,
  Settings, Palette, Users, HelpCircle, Box, Camera, ImagePlus, SlidersHorizontal, Shield, FolderOpen, Contrast, Minimize2, Frame, PenTool, Pencil, Settings2, ChevronUp, Bot, Heart
} from 'lucide-react';
import type { CanvasGenGroup, GenGroupToolbar, GroupRefImage, GenGroupType, ReferenceCategory, HexCubeGroup, HexCubeFaceData, CubeFace, ZoomLevel } from '@/lib/canvas-generation-group';
import { createGroupRefImage, createGenGroup, generateGroupId, calculateConnectionPoints, aspectRatioToDimensions, calculateActualPixels, REFERENCE_CATEGORIES, REFERENCE_CATEGORY_LABELS, createHexCubeGroup, CUBE_FACE_ORDER, CUBE_FACE_LABELS, ZOOM_LEVEL_LABELS, MODEL_ASPECT_RATIOS, MODEL_QUALITIES, QUALITY_DISPLAY_NAMES, QUALITY_TO_SIZE, ASPECT_RATIO_TO_PIXELS, DEFAULT_ASPECT_RATIOS, DEFAULT_QUALITIES, findModelConfig } from '@/lib/canvas-generation-group';
import { getModelDisplayName } from '@/lib/model-name-map';
import type { PsdLayerItem } from '@/types/psdLayer';
import { toStableImageUrl } from '@/lib/stable-image-url';
import { APP_VERSION_LABEL } from '@/config/app-meta';
import OhMyPrompt from '@/components/oh-my-prompt';
import dynamic from 'next/dynamic';

const ModelViewer3D = dynamic(() => import('@/components/model-viewer-3d'), { ssr: false });

const PsdLayerEditor = lazy(() => import('@/components/psd-editor/PsdLayerEditor'));
const AgentEditor = lazy(() => import('@/components/agent-editor').then(m => ({ default: m.AgentEditor })));


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
    const camDist = 2.5 / (zoom === 0 ? 0.7 : zoom === 2 ? 1.5 : 1.0);  // 特写=0.7, 标准=1.0, 广角=1.5

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
    const invCamDist = 1 / camDist;

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
        let u = Math.atan2(rx, rz) / (2 * Math.PI) + 0.5;
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
      <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs ${isMonochrome ? 'bg-white/80 text-gray-500 border border-gray-200' : 'bg-black/60 text-[#aaa] border border-white/10'}`}>
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
    sourceUrl?: string;
    error?: string;
  };
  threeDModelUrl?: string;
  svgDataUrl?: string; // 保存SVG数据用于下载（画布显示PNG预览时）
  threeDModelUrls?: Record<string, string>;
  negativePrompt?: string;
  modelName?: string;
  apiProvider?: string;
  apiBaseUrl?: string;
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
  onAddImages: (imageUrls: string[]) => void;
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
  onInsertPrompt?: (prompt: string) => void;
  ohMyPromptThemeStyle?: string;
  isVisionAnalyzing?: boolean;
  visionResult?: import('@/components/oh-my-prompt').VisionApiResultData | null;
  onToggleSettings?: () => void;
  onToggleTheme?: () => void;
  onToggleUserManager?: () => void;
  onToggleAdminSystem?: () => void;
  onToggleProjectData?: () => void;
  isAdmin?: boolean;
  onToggleHelp?: () => void;
  isPanelCollapsed?: boolean;
  onUndo?: () => void;
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
}

type EditMode = 'none' | 'erase' | 'mask' | 'expand' | 'crop' | 'upscale' | 'svg-trace';
type ActiveTool = 'none' | 'upscale' | 'download' | 'multiAngle' | 'to3d';
type MultiAngleMode = 'image' | 'camera';
type ThreeDBackend = 'api' | 'local';
type ThreeDType = 'ip' | 'figure' | 'product' | 'character';

export function InfiniteCanvas({
  images,
  onImagesChange,
  selectedImage,
  onSelectImage,
  onPreviewImage,
  onGenerateVariation,
  onExtractKeywords,
  onFusion,
  onAddImages,
  onReferenceSelect,
  referenceIds = [],
  isGenerating = false,
  generationProgress = undefined,
  themeStyle = 'gold',
  onVisionPrompt,
  visionPromptEnabled = false,
  onToggleVisionPrompt,
  ohMyPromptOpen = false,
  onCloseOhMyPrompt,
  onInsertPrompt,
  ohMyPromptThemeStyle = 'gold',
  isVisionAnalyzing = false,
  visionResult = null,
  onToggleSettings,
  onToggleTheme,
  onToggleUserManager,
  onToggleAdminSystem,
  onToggleProjectData,
  isAdmin = false,
  onToggleHelp,
  isPanelCollapsed = true,
  onUndo,
  navigateToImageId,
  onNavigateToImageComplete,
  onGroupsChange,
  initialGroups,
  onAltMarkReference,
  altRefMarkerIds = [],
  onForceSave,
  onEditImage,
  onViewStateChange,
  initialViewState,
  onAddToFavorites,
  onToggleFavorites,
}: InfiniteCanvasProps) {
  const isMonochrome = themeStyle === 'monochrome';

  // Agent editor state
  const [showAgentEditor, setShowAgentEditor] = useState(false);
  const [agentEditImage, setAgentEditImage] = useState<CanvasImage | null>(null);
  const [agentSelectingImage, setAgentSelectingImage] = useState(false);

  // View state
  const [viewOffset, setViewOffset] = useState({ x: initialViewState?.offsetX ?? 0, y: initialViewState?.offsetY ?? 0 });
  const [zoom, setZoom] = useState(initialViewState?.zoom ?? 1);
  const [isPanning, setIsPanning] = useState(false);
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
  const visibleImages = useMemo(() => {
    if (canvasSize.width === 0 || canvasSize.height === 0) return images;
    // Visible area in canvas coordinates
    const vx1 = -viewOffset.x / zoom;
    const vy1 = -viewOffset.y / zoom;
    const vx2 = vx1 + canvasSize.width / zoom;
    const vy2 = vy1 + canvasSize.height / zoom;
    // Add margin to avoid pop-in (1 screen worth of margin on each side)
    const marginW = (vx2 - vx1) * 0.5;
    const marginH = (vy2 - vy1) * 0.5;
    return images.filter(img => {
      if (img.isProcessingPlaceholder) return true; // Always render processing frames
      const ix1 = img.x;
      const iy1 = img.y;
      const ix2 = img.x + img.width;
      const iy2 = img.y + img.height;
      return ix2 >= vx1 - marginW && ix1 <= vx2 + marginW && iy2 >= vy1 - marginH && iy1 <= vy2 + marginH;
    });
  }, [images, viewOffset, zoom, canvasSize]);
  // Track total vs visible for debugging
  const virtualizationStats = useMemo(() => ({ total: images.length, visible: visibleImages.length }), [images.length, visibleImages.length]);

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
    onSelectImage(targetImg);
    // Notify parent that navigation is complete
    onNavigateToImageComplete?.();
  }, [navigateToImageId]);

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
        onSelectImage(targetImg);
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

  // Group drag state
  const [groupDragTarget, setGroupDragTarget] = useState<string | null>(null);
  const [groupDragStart, setGroupDragStart] = useState({ x: 0, y: 0 });
  const [groupDragOffset, setGroupDragOffset] = useState({ x: 0, y: 0 });
  const groupDragReadyRef = useRef(false);
  const groupDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 同步groups到父组件
  useEffect(() => {
    onGroupsChange?.(groups);
  }, [groups, onGroupsChange]);

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
  const [isMiddlePanning, setIsMiddlePanning] = useState(false);
  const middlePanStartRef = useRef({ x: 0, y: 0 });

  // Long press for drag
  const [isLongPressing, setIsLongPressing] = useState(false);
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
  const [canvasGenQuality, setCanvasGenQuality] = useState('standard');
  const [canvasGenCount, setCanvasGenCount] = useState(1);
  const [canvasGenRefImages, setCanvasGenRefImages] = useState<string[]>([]);
  const [canvasGenModels, setCanvasGenModels] = useState<{id: string, providerId: string, providerName: string}[]>([]);
  const [canvasGenGenerating, setCanvasGenGenerating] = useState(false);
  const [canvasGenFramePos, setCanvasGenFramePos] = useState<{x: number, y: number}>({ x: 0, y: 0 });
  const canvasGenFrameWidth = 512;
  const canvasGenFrameHeight = 288; // 16:9 ratio
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
  const [expandRatio, setExpandRatio] = useState('原始比例');
  const [showExpandScaleMenu, setShowExpandScaleMenu] = useState(false);
  // 即梦风格方向性扩展：上下左右独立 padding（像素值，基于原始图片尺寸）
  const [expandPadding, setExpandPadding] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  // 拖拽控制点状态
  const [draggingHandle, setDraggingHandle] = useState<string | null>(null);
  const expandPaddingRef = useRef({ top: 0, right: 0, bottom: 0, left: 0 });
  const [cropRatio, setCropRatio] = useState('free');
  const [showExpandRatios, setShowExpandRatios] = useState(false);
  const [showCropRatios, setShowCropRatios] = useState(false);
  // 图片工具栏折叠状态
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [showToolbarCustomize, setShowToolbarCustomize] = useState(false);
  // 工具栏自定义排序/可见性（从 localStorage 读取）
  const [toolbarItemOrder, setToolbarItemOrder] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try { const saved = localStorage.getItem('wujie_toolbar_order'); if (saved) return JSON.parse(saved); } catch {}
    }
    return ['放大','移除背景','SVG智能描摹','擦除','蒙版','编辑元素','多角度','转3D','扩展','裁切','语言修图','Agent编排','下载'];
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

  // Upscale state
  const [upscaleMultiplier, setUpscaleMultiplier] = useState(2);
  const [upscaylAvailable, setUpscaylAvailable] = useState(false);
  const [upscaylModels, setUpscaylModels] = useState<{id: string; name: string; description: string; scale: number}[]>([]);
  const [upscaylSelectedModel, setUpscaylSelectedModel] = useState('realesrgan-x4plus');
  const [upscaylChecking, setUpscaylChecking] = useState(true);
  const [upscalePreset, setUpscalePreset] = useState<'2k' | '4k' | '8k'>('2k');
  const [showUpscalePresetMenu, setShowUpscalePresetMenu] = useState(false);
  // Actual pixel dimensions of the image being upscaled (loaded from DOM)
  const [upscaleActualW, setUpscaleActualW] = useState(0);
  const [upscaleActualH, setUpscaleActualH] = useState(0);

  // SVG智能描摹 state
  const [svgTraceMode, setSvgTraceMode] = useState<'color' | 'bw' | 'compress' | 'thumbnail'>('color');
  const [svgTraceQualityPreset, setSvgTraceQualityPreset] = useState<'fast' | 'balanced' | 'high' | 'max'>('balanced');
  const [svgTraceColorPrecision, setSvgTraceColorPrecision] = useState<number | null>(null);  // null = use preset
  const [svgTraceFilterSpeckle, setSvgTraceFilterSpeckle] = useState<number | null>(null);
  const [svgTraceCornerThreshold, setSvgTraceCornerThreshold] = useState<number | null>(null);
  const [svgTraceLengthThreshold, setSvgTraceLengthThreshold] = useState<number | null>(null);
  const [svgTraceCurveMode, setSvgTraceCurveMode] = useState<'polygon' | 'spline' | null>(null);
  const [svgTraceHierarchical, setSvgTraceHierarchical] = useState<'stacked' | 'cutout' | null>(null);
  const [svgTraceBwThreshold, setSvgTraceBwThreshold] = useState(50);
  const [svgTraceBwTurdSize, setSvgTraceBwTurdSize] = useState(2);
  const [svgTraceBwInvert, setSvgTraceBwInvert] = useState(false);
  const [svgTraceBwAlphaMax, setSvgTraceBwAlphaMax] = useState(1);
  const [svgTraceCompressQuality, setSvgTraceCompressQuality] = useState(80);
  const [svgTraceCompressFormat, setSvgTraceCompressFormat] = useState<'webp' | 'jpeg' | 'png'>('webp');
  const [svgTraceThumbWidth, setSvgTraceThumbWidth] = useState(200);
  const [svgTraceThumbHeight, setSvgTraceThumbHeight] = useState(200);
  const [svgTraceThumbFit, setSvgTraceThumbFit] = useState<'cover' | 'contain' | 'inside' | 'fill'>('cover');

  // Check Upscayl NCNN availability on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/upscayl');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setUpscaylAvailable(data.available ?? false);
        if (data.available && data.models) {
          const models = data.models.map((m: { id: string; name: string; description: string; scale: number }) => ({
            id: m.id, name: m.name, description: m.description, scale: m.scale
          }));
          setUpscaylModels(models);
          const modelIds = models.map((m: { id: string }) => m.id);
          if (modelIds.length > 0 && !modelIds.includes(upscaylSelectedModel)) {
            setUpscaylSelectedModel(modelIds[0]);
          }
        }
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

  const [imageEditMode, setImageEditMode] = useState<'erase' | 'mask'>('erase');
  const [threeDBackend, setThreeDBackend] = useState<ThreeDBackend>('api');
  const [threeDType, setThreeDType] = useState<ThreeDType>('ip');

  // 3D Model Viewer state
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [viewer3DModelUrl, setViewer3DModelUrl] = useState('');
  const [viewer3DPreviewUrl, setViewer3DPreviewUrl] = useState('');
  const [viewer3DModelUrls, setViewer3DModelUrls] = useState<Record<string, string>>({});

  const [threeDQuality, setThreeDQuality] = useState('high');
  const [threeDTexture, setThreeDTexture] = useState('4k');
  const [threeDFormat, setThreeDFormat] = useState('glb');

  const [threeDProviderId, setThreeDProviderId] = useState('');
  const [threeDLocalEndpoint, setThreeDLocalEndpoint] = useState('http://127.0.0.1:7860/api/image-to-3d');
  const [threeDLocalModel, setThreeDLocalModel] = useState('Hunyuan3D-2.1');
  const [threeDProgress, setThreeDProgress] = useState<string | null>(null);
  const [admin3DModels, setAdmin3DModels] = useState<Array<{ id: string; name: string; baseUrl: string; apiKey: string; model?: string; providerPreset?: string; providerName: string; advancedParams?: Record<string, string> }>>([]);

  // Crop state
  const [cropLeft, setCropLeft] = useState(0);
  const [cropTop, setCropTop] = useState(0);
  const [cropWidth, setCropWidth] = useState(0);
  const [cropHeight, setCropHeight] = useState(0);

  // Mask keyword popup

  const [maskKeyword, setMaskKeyword] = useState('');

  // Download popup
  const [showDownloadPopup, setShowDownloadPopup] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'svg' | 'psd' | '3d'>('png');
  const [threeDDownloadFormat, setThreeDDownloadFormat] = useState('');
  const [psdMode, setPsdMode] = useState<'pro' | 'studio'>('pro');
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
  }, [downloadFormat, images, selectedIds]);

  // Reset 3D format when download format changes away from '3d'
  useEffect(() => {
    if (downloadFormat !== '3d') {
      setThreeDDownloadFormat('');
    }
  }, [downloadFormat]);

  // PSD Layer Editor
  const [showPsdEditor, setShowPsdEditor] = useState(false);
  const [psdEditorImageUrl, setPsdEditorImageUrl] = useState<string>('');
  const [psdEditorLayers, setPsdEditorLayers] = useState<PsdLayerItem[]>([]);
  const [psdEditorMode, setPsdEditorMode] = useState<'basic' | 'standard' | 'advanced' | 'studio'>('standard');

  // Misc
  const [showHelpModal, setShowHelpModal] = useState<string | null>(null);

  // Edit mode drawing - strokes stored in canvas coordinates
  const [editStrokes, setEditStrokes] = useState<{ x: number; y: number; reverse: boolean }[][]>([]);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number; reverse: boolean }[]>([]);
  const [isEditProcessing, setIsEditProcessing] = useState(false);
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
  const [strokesVersion, setStrokesVersion] = useState(0);
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
  const hexCubeGroupsRef = useRef<HexCubeGroup[]>(hexCubeGroups);
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
  const getCurrentModel = useCallback((): { model: string; providerId?: string } => {
    try {
      // 优先读取 wujie_selected_model（generation-panel 写入）
      const raw = localStorage.getItem('wujie_selected_model');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.model) return { model: parsed.model, providerId: parsed.providerId };
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

  // Sync selectedImage prop
  useEffect(() => {
    if (selectedImage) {
      setSelectedIds(new Set([selectedImage.id]));
    }
  }, [selectedImage]);

  // Track Ctrl/Meta key for reference selection visual hint
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) setCtrlKeyHeld(true);
      if (e.altKey) setAltKeyHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) setCtrlKeyHeld(false);
      if (!e.altKey) setAltKeyHeld(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

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
      const drag = multiAngleDragRef.current;
      if (!drag?.active) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setMultiAngleRotation(Math.round(clampMultiAngleValue(drag.startRotation + dx * 0.55, -90, 90)));
      setMultiAngleTilt(Math.round(clampMultiAngleValue(drag.startTilt + dy * 0.55, -30, 60)));
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
  }, [clampMultiAngleValue, isMultiAngleDragging]);

  // HexCube 3D cube drag interaction
  useEffect(() => {
    if (!hexCube3dDragging) return;
    const handleMove = (event: MouseEvent) => {
      const drag = hexCube3dDragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const newRotY = Math.round(Math.max(0, Math.min(360, drag.startRotY + dx * 0.5)));
      const newTiltX = Math.round(Math.max(-60, Math.min(60, drag.startTiltX + dy * 0.4)));
      setHexCubeGroups(prev => prev.map(g => g.id === drag.groupId ? { ...g, toolbar: { ...g.toolbar, rotationY: newRotY, tiltX: newTiltX } } : g));
    };
    const handleUp = () => {
      hexCube3dDragRef.current = null;
      setHexCube3dDragging(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [hexCube3dDragging]);

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
    const maxX = Math.max(...selectedImages.map(i => i.x + i.width));
    const maxY = Math.max(...selectedImages.map(i => i.y + i.height));
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
    const handleWindowMouseUp = () => {
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
  }, []);

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z / Cmd+Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        onUndo?.();
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
      // Ctrl + D: Duplicate selected images
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
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
            onImagesChange([...images, ...dupImages]);
            setSelectedIds(new Set(dupImages.map(d => d.id)));
            selectImage(dupImages[0].id);
          }
        }
        return;
      }
      // Ctrl+Q: Masonry layout for selected images
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyQ') {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
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
      if (e.code === 'Space' && !e.repeat) {
        // Don't capture Space when user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        setIsSpacePressed(true);
      }
      if (e.code === 'Escape') {
        // 退出Agent选择图片模式
        if (agentSelectingImage) {
          setAgentSelectingImage(false);
        }
        if (editMode === 'upscale' || editMode === 'erase' || editMode === 'mask') {
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
        // Don't delete images when user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
        if (selectedIds.size > 0 && editMode === 'none') {
          onImagesChange(images.filter(img => !selectedIds.has(img.id)));
          setSelectedIds(new Set());
          selectImage(null);
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
          // Calculate display size (max 500px on longest edge)
          const maxEdge = 500;
          const displayW = 400;
          const displayH = 300;
          newImages.push({
            id: `paste-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            url,
            x: cx + offsetIdx,
            y: cy + offsetIdx,
            width: displayW,
            height: displayH,
            originalWidth: displayW,
            originalHeight: displayH,
          });
        } catch {
          // Skip failed uploads
        }
      }

      if (newImages.length > 0) {
        onImagesChange([...images, ...newImages]);
        setSelectedIds(new Set(newImages.map(img => img.id)));
        // Load natural dimensions for pasted images and update
        newImages.forEach(img => {
          const tempImg = new Image();
          tempImg.onload = () => {
            const natW = tempImg.naturalWidth;
            const natH = tempImg.naturalHeight;
            const maxEdge = 500;
            const scale = Math.min(maxEdge / natW, maxEdge / natH, 1);
            const dispW = Math.round(natW * scale);
            const dispH = Math.round(natH * scale);
            // Use imagesRef.current to avoid stale closure over images
            const updated = imagesRef.current.map(i =>
              i.id === img.id ? { ...i, width: dispW, height: dispH, originalWidth: natW, originalHeight: natH } : i
            );
            onImagesChange(updated);
          };
          tempImg.src = img.url;
        });
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
  }, [selectedIds, images, onImagesChange, selectImage, editMode, onUndo, zoom, viewOffset]);

  // Click outside to close menus
  useEffect(() => {
    const handleClick = () => {
      setShowContextMenu(false);
      setShowCanvasMenu(false);
      setShowExpandRatios(false);
      setShowCropRatios(false);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

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

  // Hit test
  const hitTestImage = useCallback((canvasX: number, canvasY: number): string | null => {
    // Collect IDs of gen group result images (they are hidden on canvas, skip them in hit test)
    const genGroupResultIds = new Set<string>();
    for (const g of genGroupsRef.current) {
      if (g.resultImageIds) {
        for (const rid of g.resultImageIds) genGroupResultIds.add(rid);
      }
    }
    for (let i = images.length - 1; i >= 0; i--) {
      const img = images[i];
      // Skip gen group result images (they are rendered inside the result frame, not on canvas)
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
  }, [editMode, editImageId, images, screenToCanvas, cropRect, zoom, viewOffset]);

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
  }, [editMode, editImageId, images, screenToCanvas, cropDragStart, cropDragMode, cropDragOrigin, cropRatio, zoom, viewOffset]);

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
    // Close any open model dropdown
    setOpenModelDropdownGroupId(null);

    if (editMode !== 'none') {
      handleEditMouseDown(e);
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
  }, [isSpacePressed, viewOffset, selectedIds, images, screenToCanvas, hitTestImage, selectImage, editMode, zoom, handleEditMouseDown]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (editMode !== 'none') {
      handleEditMouseMove(e);
      return;
    }
    const canvasPos = screenToCanvas(e.clientX, e.clientY);

    // Middle button panning
    if (isMiddlePanning) {
      setViewOffset({
        x: e.clientX - middlePanStartRef.current.x,
        y: e.clientY - middlePanStartRef.current.y,
      });
      return;
    }

    if (isPanning) {
      setViewOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
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
      const dy = canvasPos.y - resizeStart.y;
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

      onImagesChange(images.map(i =>
        i.id === resizingImage ? { ...i, x: newX, y: newY, width: newW, height: newH } : i
      ));
      return;
    }

    // Image drag: only allow after long press (imageDragReadyRef)
    if (dragTarget && imageDragReadyRef.current) {
      const offsetX = canvasPos.x - dragStart.x;
      const offsetY = canvasPos.y - dragStart.y;
      setDragOffset({ x: offsetX, y: offsetY });

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
      setHoveredGenGroupId(hoveredGroup);
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
  }, [editMode, isPanning, isMiddlePanning, panStart, boxSelectStart, isLongPressing, resizingImage, resizeCorner, images, dragTarget, dragStart, resizeStart, screenToCanvas, onImagesChange, handleEditMouseMove, groupDragTarget, groupDragStart, genGroupDragTarget, genGroupDragStart, hexCubeDragTarget, hexCubeDragStart]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (editMode !== 'none') {
      handleEditMouseUp();
      return;
    }

    // Middle button up: stop middle panning
    if (isMiddlePanning && e.button === 1) {
      setIsMiddlePanning(false);
      return;
    }

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isPanning) {
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
          images.forEach(img => {
            // Skip hidden gen group result images
            if (genGroupResultIds.has(img.id)) return;
            const imgScreenLeft = img.x * zoom + viewOffset.x;
            const imgScreenTop = img.y * zoom + viewOffset.y;
            const imgScreenRight = (img.x + img.width) * zoom + viewOffset.x;
            const imgScreenBottom = (img.y + img.height) * zoom + viewOffset.y;

            if (imgScreenRight > left && imgScreenLeft < right &&
                imgScreenBottom > top && imgScreenTop < bottom) {
              selected.add(img.id);
            }
          });
          if (selected.size > 0) {
            setSelectedIds(selected);
          }
        }
      }
      setBoxSelectStart(null);
      setBoxSelectEnd(null);
      setIsLongPressing(false);
    }

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
              removeRefFromGroup(gGroup.id, imgId);
            }
          }
        }
      }
      setDragTarget(null);
      setDragOffset({ x: 0, y: 0 });
      setHoveredGenGroupId(null);
      imageDragReadyRef.current = false;
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
  }, [editMode, isPanning, isMiddlePanning, boxSelectStart, boxSelectEnd, dragTarget, dragOffset, images, selectedIds, zoom, viewOffset, onImagesChange, handleEditMouseUp, groupDragTarget, groupDragOffset, genGroupDragTarget, genGroupDragOffset, hexCubeDragTarget, hexCubeDragOffset]);

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
    setIsMiddlePanning(false);
    setIsLongPressing(false);
    setBoxSelectStart(null);
    setBoxSelectEnd(null);
    setResizingImage(null);
    setResizeCorner(null);
    brushCursorPosRef.current = null;
    if (dragTarget) {
      setDragTarget(null);
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
  }, [dragTarget, editMode, handleEditMouseUp]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Prevent scroll from affecting canvas when cursor is over a modal/overlay/popup
    const target = e.target as HTMLElement;
    const isInsideFloatingUI = target.closest(
      '.fixed, [data-modal], [data-popup], [data-toolbar], [data-floating-panel]'
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
  }, [images, onImagesChange, onAddImages, screenToCanvas]);

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
    const initSupportedQualities = findModelConfig(MODEL_QUALITIES, currentModel) || DEFAULT_QUALITIES;
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
        quality: initQuality,
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

  /** 更新生成组工具栏设置 */
  const updateGroupToolbar = useCallback((groupId: string, updates: Partial<GenGroupToolbar>) => {
    setGenGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      return { ...g, toolbar: { ...g.toolbar, ...updates } };
    }));
  }, []);

  /** 更新参考图类别和强度 */
  const updateRefImageCategories = useCallback((groupId: string, imageId: string, categories: ReferenceCategory[], strengths: Record<string, number>) => {
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
    // 在视口中心创建
    const vpX = (typeof window !== 'undefined' ? window.innerWidth / 2 : 500);
    const vpY = (typeof window !== 'undefined' ? window.innerHeight / 2 : 400);
    // 计算画布坐标：将屏幕中心映射到画布坐标
    const cx = (vpX - viewOffset.x) / zoom;
    const cy = (vpY - viewOffset.y) / zoom;
    const group = createHexCubeGroup({ x: cx - 250, y: cy - 200 });
    // 设置当前模型
    const currentModelInfo = getCurrentModel();
    group.toolbar.model = currentModelInfo.model;
    group.toolbar.providerId = currentModelInfo.providerId || '';
    // 从 canvasGenModels 查找 providerName
    const currentModelObj = canvasGenModels.find(m => m.id === currentModelInfo.model && m.providerId === currentModelInfo.providerId);
    group.toolbar.providerName = currentModelObj?.providerName || '';
    setHexCubeGroups(prev => [...prev, group]);
  }, [canvasGenModels]);

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
        optimizedPrompt = optimizedPrompt
          .replace(/<think[\s\S]*?<\/think>/gi, '')  // 移除 <think...</think >
          .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')  // 移除 <thinking...</thinking >
          .replace(/【[^】]*】/g, '')  // 移除【】标记
          .replace(/\*\*[^*]*\*\*/g, '')  // 移除**加粗**标记
          .trim();
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
      // 参考图组：6类别参考逻辑
      const categoryEnMap: Record<string, string> = {
        'style': 'artistic style and visual aesthetics',
        'composition': 'composition and layout structure',
        'scene': 'scene and environment setting',
        'color': 'color palette and tone',
        'subject': 'main subject and focal point',
        'detail': 'fine details and textures',
      };

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

      if (activeKeys.length > 0) {
        // 收集保留方面（强度>0 表示要保留参考图的该方面）
        const preserveAspects = activeKeys
          .map(cat => {
            const s = catStrengthMap[cat];
            const desc = categoryEnMap[cat] || cat;
            if (s >= 80) return `strictly preserve the ${desc} of the reference image(s) — do NOT change the original ${cat === 'subject' ? 'product/object identity' : desc}`;
            if (s >= 50) return `maintain the ${desc} of the reference image(s) without altering the core ${cat === 'subject' ? 'identity' : desc}`;
            if (s >= 20) return `subtly reference the ${desc} of the reference image(s)`;
            return `lightly hint at the ${desc} of the reference image(s)`;
          });

        // 收集未激活的类别（可以自由改变）
        const freeAspects = Object.keys(categoryEnMap)
          .filter(cat => !catStrengthMap[cat] || catStrengthMap[cat] === 0)
          .map(cat => categoryEnMap[cat]);

        // 检查是否有主体保留
        const hasSubjectInRef = catStrengthMap['subject'] > 0;

        // 构建完整提示词
        if (keyword) {
          fullPrompt = `Create an image of: ${keyword}.`;
          if (preserveAspects.length > 0) {
            fullPrompt += ` While creating this new image, ${preserveAspects.join(', ')}.`;
          }
          if (hasSubjectInRef) {
            fullPrompt += ` IMPORTANT: The product/object in the result MUST be the SAME product/object as in the reference image — do NOT substitute or replace it with a different product.`;
          }
          if (freeAspects.length > 0) {
            fullPrompt += ` Feel free to reimagine the ${freeAspects.join(', ')}.`;
          }
        } else {
          fullPrompt = 'Generate a creative variation of the reference image(s).';
          if (preserveAspects.length > 0) {
            fullPrompt += ` Keep the ${preserveAspects.join(', ')}.`;
          }
          if (hasSubjectInRef) {
            fullPrompt += ` IMPORTANT: The product/object in the result MUST be the SAME product/object as in the reference image.`;
          }
          if (freeAspects.length > 0) {
            fullPrompt += ` Creatively transform the ${freeAspects.join(', ')}.`;
          }
        }

        // 显式告诉模型使用参考图
        fullPrompt = `[ref] Use the provided reference image(s) as the base. ${fullPrompt}`;
        // strength 计算：保留方面多/强 → strength 低（更接近原图）
        const totalPreserveScore = activeKeys.reduce((sum, cat) => sum + catStrengthMap[cat], 0);
        const maxScore = activeKeys.length * 100;
        const preserveRatio = totalPreserveScore / maxScore;
        // 0.20 (高度保留) ~ 0.80 (较多自由)
        calculatedStrength = Math.round((0.80 - preserveRatio * 0.60) * 100) / 100;
        // 当保留主体时，额外降低 strength
        if (hasSubjectInRef) {
          const subjectStr = catStrengthMap['subject'] || 0;
          const subjectReduction = (subjectStr / 100) * 0.25;
          calculatedStrength = Math.max(0.15, calculatedStrength - subjectReduction);
        }
      } else {
        // 无激活类别，仅作为参考图
        if (keyword) {
          fullPrompt = `[ref] Using the reference image(s) as visual context, create: ${keyword}`;
        }
      }
    } else if (group.type === 'fusion' && group.refImages.length > 0) {
      // 融图组：融合多张参考图
      calculatedStrength = 0.65;
      const keyword = fullPrompt.trim();
      if (keyword) {
        fullPrompt = `[fusion] Seamlessly blend and fuse elements from the reference images, then create: ${keyword}`;
      } else {
        fullPrompt = `[fusion] Seamlessly blend and fuse elements from the reference images into a cohesive new image.`;
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
      for (const url of rawRefUrls) {
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
            } else {
              console.warn('[handleGroupGenerate] Failed to save data URL, skipping:', saveData.error);
            }
          } catch (e) {
            console.warn('[handleGroupGenerate] Failed to upload data URL reference image:', e);
          }
        } else {
          referenceImages.push(url);
        }
      }

      if (referenceImages.length === 0 && rawRefUrls.length > 0) {
        setGenGroups(prev => prev.map(g => {
          if (g.id !== group.id) return g;
          return { ...g, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, errorMsg: '参考图上传失败，请重试' } };
        }));
        return;
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          negativePrompt: toolbar.negativePrompt,
          model,
          providerId,
          aspectRatio: toolbar.aspectRatio,
          quality: toolbar.quality,
          outputCount: toolbar.outputCount,
          referenceImages,
          referenceMode: group.type === 'fusion' ? 'fusion' : 'reference',
          ...(calculatedStrength != null && calculatedStrength > 0 ? { strength: calculatedStrength } : {}),
        }),
      });

      // 安全解析响应：优先尝试 JSON，回退到纯文本
      let data: any;
      const responseText = await res.text();
      try {
        data = JSON.parse(responseText);
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
        for (const url of data.imageUrls as string[]) {
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
        }));
        onImagesChange([...imagesRef.current, ...newImages]);
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
        const taskId = data.taskIds[0];
        const estimatedTime = data.estimatedTime || 30;
        const maxPollTime = Math.min(600, Math.max(60, estimatedTime * 3 + 30)) * 1000;
        const startTime = Date.now();
        let pollCount = 0;

        const pollWithBackoff = async () => {
          while (Date.now() - startTime < maxPollTime) {
            pollCount++;
            // 动态间隔：前5次1.5s，6-15次2s，16-30次3s，之后4s
            const delay = pollCount <= 5 ? 1500 : pollCount <= 15 ? 2000 : pollCount <= 30 ? 3000 : 4000;
            await new Promise(r => setTimeout(r, delay));

            try {
              const pollRes = await fetch('/api/poll-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, model, providerId, quickPoll: true }),
              });
              if (!pollRes.ok) continue;
              const pollData = await pollRes.json();

              // 更新组内进度
              if (pollData.progress !== undefined) {
                setGenGroups(prev => prev.map(g => {
                  if (g.id !== group.id) return g;
                  return { ...g, resultPlaceholder: { ...g.resultPlaceholder, progress: Math.max(pollData.progress, 5) } };
                }));
              }

              if (['completed', 'succeeded', 'success', 'done'].includes(pollData.status)) {
                // 生成完成
                const resultUrls: string[] = [];
                if (pollData.results && Array.isArray(pollData.results) && pollData.results.length > 0) {
                  resultUrls.push(...pollData.results);
                } else if (pollData.imageUrl) {
                  resultUrls.push(pollData.imageUrl);
                }
                if (resultUrls.length > 0) {
                  const savedUrls: string[] = [];
                  for (const url of resultUrls) {
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
                  }));
                  onImagesChange([...imagesRef.current, ...resultImages]);
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
                  const errMsg = pollData.error || '生成完成但未返回图片，请重试';
                  setGenGroups(prev => prev.map(g => {
                    if (g.id !== group.id) return g;
                    return { ...g, status: 'idle' as const, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, errorMsg: errMsg } };
                  }));
                }
                return; // 完成，退出轮询
              }

              // 不可重试错误：立即失败
              if (pollData.status === 'failed' || (pollData.status === 'error' && !pollData.retryable)) {
                const errMsg = pollData.error || '生成失败，请检查模型和API配置';
                setGenGroups(prev => prev.map(g => {
                  if (g.id !== group.id) return g;
                  return { ...g, status: 'idle' as const, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, errorMsg: errMsg } };
                }));
                return;
              }

              // 可重试错误（error/timeout + retryable）继续轮询
              if (pollData.status === 'error' || pollData.status === 'timeout') {
                setGenGroups(prev => prev.map(g => {
                  if (g.id !== group.id) return g;
                  return { ...g, resultPlaceholder: { ...g.resultPlaceholder, progress: Math.min(90, 5 + pollCount * 2) } };
                }));
                // continue polling
              }
            } catch {
              // 轮询网络错误，继续
            }
          }
          // 超时
          setGenGroups(prev => prev.map(g => {
            if (g.id !== group.id) return g;
            return { ...g, status: 'idle' as const, resultPlaceholder: { ...g.resultPlaceholder, isProcessing: false, progress: 0, errorMsg: '生成超时，请重试' } };
          }));
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
  }, [getCurrentModel, onImagesChange]);

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
      },
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
    extra?: Partial<CanvasImage>
  ): CanvasImage | null => {
    let completedImage: CanvasImage | null = null;
    const nextImages = imagesRef.current.map(image => {
      if (image.id !== id) return image;
      completedImage = {
        ...image,
        url: newUrl,
        width: newWidth,
        height: newHeight,
        originalWidth: Math.round(newWidth),
        originalHeight: Math.round(newHeight),
        isProcessingPlaceholder: false,
        processing: undefined,
        ...extra,
      };
      return completedImage;
    });
    imagesRef.current = nextImages;
    onImagesChange(nextImages);
    const selectedCompleted = nextImages.find(image => image.id === id && !image.isProcessingPlaceholder) || null;
    if (selectedCompleted) {
      setSelectedIds(new Set([selectedCompleted.id]));
      onSelectImage(selectedCompleted);
    }
    // 预加载验证：如果图片 URL 无法加载，自动通过 /api/save-image 兜底
    if (newUrl && !newUrl.startsWith('data:')) {
      const testImg = new window.Image();
      testImg.onload = () => {}; // 加载成功，无需处理
      testImg.onerror = () => {
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
            // 更新图片 URL 为持久化后的 URL
            const fallbackImages = imagesRef.current.map(img => {
              if (img.id === id) {
                return { ...img, url: data.url };
              }
              return img;
            });
            imagesRef.current = fallbackImages;
            onImagesChange(fallbackImages);
          }
        })
        .catch(err => console.warn('[Canvas] save-image fallback failed:', err));
      };
      testImg.src = newUrl;
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
          const models: {id: string, providerId: string, providerName: string}[] = [];
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

  const getThreeDProviders = useCallback((): Array<{ id: string; name: string; baseUrl: string; apiKey: string; model?: string; providerPreset?: string; advancedParams?: Record<string, string> }> => {
    const results: Array<{ id: string; name: string; baseUrl: string; apiKey: string; model?: string; providerPreset?: string; advancedParams?: Record<string, string> }> = [];

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
  }, [threeDCapabilities]);

  // Get API key from localStorage - use the first enabled API key
  const getApiKey = useCallback((): string => {
    // API Key 由服务端管理，前端不再传递 API Key
    return 'server-managed';
  }, []);

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
  /**
   * 蒙版合成：将 API 生成的结果仅应用到蒙版区域，保留原图非蒙版区域
   * 这是确保擦除/蒙版精准度的核心函数——无论 API 是否正确处理了 mask_image，
   * 最终结果只会修改用户涂抹的区域
   */
  const compositeInpaintResult = useCallback(async (
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
      // 蒙版修图模式：对裁剪边缘做羽化处理
      if (!isErase) {
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

  // ★ 取消控制器：当前正在轮询的任务可通过 cancelTask 取消
  const pollingAbortRef = useRef<AbortController | null>(null);

  const pollForResult = useCallback(async (
    taskId: string,
    apiKeyOrModel: string,
    onProgress?: (progress: number, status: string) => void,
    engine?: string
  ): Promise<string | null> => {
    // apiKeyOrModel was previously apiKey, now we pass the model name for server-side key lookup
    const currentModelInfo = getCurrentModel();
    const maxAttempts = 150; // 150次 × 动态间隔 ≈ 600秒，兼容token link等慢速API
    const getEditPollInterval = (attempt: number) => {
      if (attempt <= 2) return 500;
      if (attempt <= 5) return 800;
      if (attempt <= 15) return 1200;
      return 2000;
    };
    lastPollErrorRef.current = '';

    // ★ 创建取消控制器
    const abortController = new AbortController();
    pollingAbortRef.current = abortController;

    for (let i = 0; i < maxAttempts; i++) {
      // ★ 检查是否被取消
      if (abortController.signal.aborted) {
        lastPollErrorRef.current = '任务已被取消';
        return null;
      }

      onProgress?.(
        Math.min(95, 18 + Math.round((i / Math.max(1, maxAttempts - 1)) * 76)),
        i < 2 ? '任务已提交，等待模型响应...' : 'AI 正在生成结果...'
      );
      await new Promise(r => setTimeout(r, getEditPollInterval(i)));
      try {
        const res = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, model: currentModelInfo.model, providerId: getCurrentProviderId(), engine }),
          signal: abortController.signal,
        });
        if (!res.ok) throw new Error(`Poll HTTP ${res.status}`);
        const data = await res.json();

        // ★ 检查服务端取消状态
        if (data.status === 'cancelled') {
          lastPollErrorRef.current = '任务已被取消';
          return null;
        }

        if (data.status === 'completed' && data.imageUrl) {
          return data.imageUrl;
        }
        if (data.status === 'failed' || data.status === 'error') {
          console.error('Task failed:', data.error);
          lastPollErrorRef.current = data.error || 'AI 模型处理失败';
          return null;
        }
        // retryable errors — continue polling
        if (data.retryable === false) {
          lastPollErrorRef.current = data.error || '任务不可重试';
          return null;
        }
      } catch (e: unknown) {
        // ★ 取消导致的abort不重试
        if (e instanceof DOMException && e.name === 'AbortError') {
          lastPollErrorRef.current = '任务已被取消';
          return null;
        }
        // Network/polling errors — continue polling
        console.error('Poll error:', e);
      }
    }
    lastPollErrorRef.current = '生成超时，AI 模型响应时间过长，请稍后重试或切换其他模型';
    return null;
  }, [getCurrentModel]);

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
        onImagesChange(images.filter(img => img.id !== canvasGenFrameId));
        setCanvasGenFrameId(null);
      }
      setShowCanvasGenerator(false);
      return;
    }
    // Create a blank placeholder frame in the center of the canvas viewport
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
      processing: { label: '图像生成器', status: 'waiting', progress: 0 },
    };
    onImagesChange([...images, newFrame]);
    setCanvasGenFrameId(frameId);
    setCanvasGenFramePos({ x: newFrame.x, y: newFrame.y });
    setShowCanvasGenerator(true);
    setCanvasGenPrompt('');
    setCanvasGenNegativePrompt('');
    setCanvasGenRefImages([]);
    // Auto-select first model if none selected
    if (!canvasGenModel && canvasGenModels.length > 0) {
      setCanvasGenModel(`${canvasGenModels[0].providerId}::${canvasGenModels[0].id}`);
    }
  }, [showCanvasGenerator, canvasGenFrameId, images, zoom, viewOffset, onImagesChange, canvasGenModel, canvasGenModels]);

  const handleCanvasGenerate = useCallback(async () => {
    if (!canvasGenPrompt.trim() || canvasGenGenerating) return;
    setCanvasGenGenerating(true);

    // Update frame to processing state
    if (canvasGenFrameId) {
      onImagesChange(images.map(img => {
        if (img.id === canvasGenFrameId) {
          return { ...img, processing: { label: '生成中...', status: 'processing', progress: 10 } };
        }
        return img;
      }));
    }

    try {
      const canvasGenPureModel = canvasGenModel?.includes('::') ? canvasGenModel.split('::')[1] : canvasGenModel || undefined;
      const canvasGenProviderId = canvasGenModel?.includes('::') ? canvasGenModel.split('::')[0] : undefined;
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: canvasGenPrompt,
          negativePrompt: canvasGenNegativePrompt || undefined,
          model: canvasGenPureModel,
          providerId: canvasGenProviderId,
          aspectRatio: canvasGenAspectRatio,
          quality: canvasGenQuality,
          n: canvasGenCount,
          referenceImages: canvasGenRefImages.length > 0 ? canvasGenRefImages : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '生成失败');
      }

      const data = await res.json();

      // === 直接返回模式：API 直接返回图片 ===
      if (data.success && data.mode === 'direct') {
        const { imageUrls } = data;
        const savedUrls: string[] = [];
        for (const imageUrl of imageUrls) {
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
          savedUrls.push(savedUrl);
        }
        // Replace the processing frame with the actual images
        const newImages: CanvasImage[] = [];
        for (let i = 0; i < savedUrls.length; i++) {
          if (i === 0 && canvasGenFrameId) {
            // Replace the placeholder frame with the first result
            onImagesChange(images.map(img => {
              if (img.id === canvasGenFrameId) {
                return { ...img, url: savedUrls[i], isProcessingPlaceholder: false, processing: undefined, prompt: canvasGenPrompt };
              }
              return img;
            }));
          } else {
            // Add additional images next to the frame
            const pos = canvasGenFramePos || { x: 100, y: 100 };
            newImages.push({
              id: `canvas-gen-${Date.now()}-${i}`,
              url: savedUrls[i],
              x: pos.x + (i * 320),
              y: pos.y,
              width: 300,
              height: 300,
              prompt: canvasGenPrompt,
            });
          }
        }
        if (newImages.length > 0) {
          setTimeout(() => {
            onImagesChange([...images, ...newImages]);
          }, 100);
        }
        setCanvasGenGenerating(false);
        setShowCanvasGenerator(false);
        return;
      }

      const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);
      // 使用服务端实际使用的模型（可能因自动切换而与请求模型不同）
      const actualGenModel = data.model || (canvasGenModel?.includes('::') ? canvasGenModel.split('::')[0] : canvasGenModel) || undefined;

      if (taskIds.length === 0) {
        throw new Error('未获取到任务ID');
      }

      // Poll for results
      const pollForResult = async (taskId: string): Promise<string | null> => {
        const maxAttempts = 300; // 兼容慢速API
        const getPollInterval = (attempt: number) => {
          if (attempt <= 2) return 500;   // 首次快速检查
          if (attempt <= 5) return 700;
          if (attempt <= 10) return 1000;
          if (attempt <= 20) return 1500;
          return 2000;
        };
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // 动态间隔：首次快速检查，后续逐渐加长
          await new Promise(r => setTimeout(r, getPollInterval(attempt)));
          try {
            const pollRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: actualGenModel, providerId: canvasGenProviderId }),
            });
            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();
            if (pollData.status === 'completed' && pollData.imageUrl) {
              return pollData.imageUrl;
            }
            if (pollData.status === 'failed') {
              return null;
            }
            // Update progress
            if (canvasGenFrameId) {
              const progress = Math.min(90, 10 + (attempt / maxAttempts) * 80);
              onImagesChange(imagesRef.current.map(img => {
                if (img.id === canvasGenFrameId) {
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
      const validUrls = results.filter((url): url is string => url !== null);

      if (validUrls.length > 0) {
        // Replace the placeholder frame with the first result
        if (canvasGenFrameId) {
          onImagesChange(imagesRef.current.map(img => {
            if (img.id === canvasGenFrameId) {
              return {
                ...img,
                url: validUrls[0],
                isProcessingPlaceholder: false,
                processing: undefined,
                prompt: canvasGenPrompt,
                model: canvasGenModel,
                quality: canvasGenQuality,
                aspectRatio: canvasGenAspectRatio,
              };
            }
            return img;
          }));
        }
        // If multiple results, add the rest as new images to the right
        if (validUrls.length > 1) {
          const frameImg = imagesRef.current.find(img => img.id === canvasGenFrameId);
          const baseX = frameImg ? frameImg.x + frameImg.width + 20 : 100;
          const baseY = frameImg ? frameImg.y : 100;
          const additionalImages: CanvasImage[] = validUrls.slice(1).map((url, idx) => ({
            id: `gen-result-${Date.now()}-${idx}`,
            url,
            x: baseX + idx * (canvasGenFrameWidth + 20),
            y: baseY,
            width: canvasGenFrameWidth,
            height: canvasGenFrameHeight,
            prompt: canvasGenPrompt,
            model: canvasGenModel,
            quality: canvasGenQuality,
            aspectRatio: canvasGenAspectRatio,
          }));
          onImagesChange([...imagesRef.current, ...additionalImages]);
        }
        // Close generator panel
        setShowCanvasGenerator(false);
        setCanvasGenFrameId(null);
      } else {
        throw new Error('生成超时或失败');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '生成失败';
      // Show error on frame
      if (canvasGenFrameId) {
        onImagesChange(imagesRef.current.map(img => {
          if (img.id === canvasGenFrameId) {
            return { ...img, processing: { label: errorMsg, status: 'failed', progress: 0 } };
          }
          return img;
        }));
      }
    } finally {
      setCanvasGenGenerating(false);
    }
  }, [canvasGenPrompt, canvasGenNegativePrompt, canvasGenModel, canvasGenAspectRatio, canvasGenQuality, canvasGenCount, canvasGenRefImages, canvasGenGenerating, canvasGenFrameId, images, onImagesChange]);

  // Update frame position when images change
  useEffect(() => {
    if (canvasGenFrameId && showCanvasGenerator) {
      const frame = images.find(img => img.id === canvasGenFrameId);
      if (frame) {
        setCanvasGenFramePos({ x: frame.x, y: frame.y });
      }
    }
  }, [images, canvasGenFrameId, showCanvasGenerator]);

  // 1. UPSCALE - floating panel with size options
  const handleUpscaleMultiplierChange = useCallback((mult: number) => {
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
    const img = selectedImageData;
    if (!img) return;

    // Use actual pixel dimensions loaded from the image element
    const origW = upscaleActualW || img.originalWidth || img.width;
    const origH = upscaleActualH || img.originalHeight || img.height;
    const { w: targetW, h: targetH, multiplier: upMultiplier } = getUpscaleTargetDimensions(origW, origH, upscalePreset);

    const placeholderId = createProcessingFrameRightOf(
      img,
      '放大中',
      targetW / 2,
      targetH / 2,
      '正在提交放大任务...'
    );
    setIsEditProcessing(true);
    exitEditMode();
    try {
      const apiKey = getApiKey();
      const modelInfo = getCurrentModel();
      updateProcessingFrame(placeholderId, { progress: 8, status: '正在提交到 AI 模型...' });
      const res = await fetch('/api/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upscale',
          imageUrl: img.url,
          prompt: img.prompt || img.modifyPrompt || '', // 传图片描述给后端，让AI知道原图内容
          targetWidth: targetW,
          targetHeight: targetH,
          aspectRatio: `${origW}:${origH}`,
          model: modelInfo.model,
          apiKey,
          providerId: modelInfo.providerId || getCurrentProviderId(),
          scale: upMultiplier,
          originalWidth: origW,
          originalHeight: origH,
        }),
      });

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
          status: `❌ ${String(data.error || '放大失败')}`,
          error: String(data.error || '放大失败'),
        });
        setTimeout(() => removeProcessingFrame(placeholderId), 5000);
        setIsEditProcessing(false);
        return;
      }

      updateProcessingFrame(placeholderId, { progress: 22, status: data.engine === 'tile-upscale' ? 'AI 正在分块放大（更高质量，耗时稍长）...' : 'AI 正在放大细节...' });
      const usedModel = String(data.usedModel || modelInfo.model);
      const resultUrl = data.imageUrl || await pollForResult((data.taskId as string) || '', usedModel, (progress, status) => {
        updateProcessingFrame(placeholderId, { progress, status });
      });
      if (resultUrl) {
        updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入结果...' });
        const stableUrl = await toStableImageUrl(resultUrl as string);
        completeProcessingFrame(placeholderId, stableUrl, targetW / 2, targetH / 2, {
          originalWidth: targetW,
          originalHeight: targetH,
          modifyPrompt: `${upMultiplier}x HD ${upscalePreset.toUpperCase()} 放大`,
        });
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
  }, [selectedImageData, upscalePreset, upscaleActualW, upscaleActualH, getApiKey, getCurrentModel, pollForResult, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame, toStableImageUrl, getUpscaleTargetDimensions]);

  // 1b. Upscale trigger - opens floating control bar
  const handleOpenUpscale = useCallback(() => {
    const img = selectedImageData;
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
  }, [selectedImageData]);

  // 2. REMOVE BACKGROUND - auto, result to the right
  const handleRemoveBackground = useCallback(async () => {
    const img = selectedImageData;
    if (!img) return;
    const apiKey = getApiKey();

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
          aspectRatio: `${img.originalWidth || img.width}:${img.originalHeight || img.height}`,
          model: modelInfo.model,
          apiKey,
          providerId: modelInfo.providerId || getCurrentProviderId(),
          removeBgModel: removeBgModelId,
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
        alert(String(data.error || '移除背景失败'));
        setIsEditProcessing(false);
        return;
      }

      updateProcessingFrame(placeholderId, { progress: 22, status: data.engine === 'local-background-alpha' ? '正在生成透明背景...' : String(data.engine || '').includes('iopaint') ? 'IOPaint 正在去除背景...' : 'AI 正在识别主体边缘...' });

      // 兼容两种后端返回：
      // 1) 同步返回 imageUrl（本地透明化 / AI 直接出图 — 后端已做棋盘格后处理）
      // 2) 异步返回 taskId（AI 模型通过 APImart 等代理异步处理，前端轮询）
      let resultUrl: string | null = data.imageUrl ? String(data.imageUrl) : null;
      if (!resultUrl && data.taskId) {
        // AI RemoveBG 异步轮询：APImart 代理可能需要 60-120 秒
        // 轮询次数增加到 60 次（约 120 秒），适应 AI 模型处理时间
        const isAIRemoveBg = String(data.engine || '').includes('ai-background-remove');
        const maxRemoveBgAttempts = isAIRemoveBg ? 60 : 30;
        resultUrl = await (async () => {
          const taskId = data.taskId as string;
          const modelInfo = getCurrentModel();
          const getEditPollInterval = (attempt: number) => {
            if (attempt <= 2) return 800;
            if (attempt <= 5) return 1000;
            return 2000;
          };
          for (let i = 0; i < maxRemoveBgAttempts; i++) {
            updateProcessingFrame(placeholderId, {
              progress: Math.min(90, 22 + Math.round((i / maxRemoveBgAttempts) * 68)),
              status: i < 3 ? '等待 AI 模型响应...' : isAIRemoveBg ? 'AI 正在识别主体并移除背景...' : 'AI 正在处理背景...'
            });
            await new Promise(r => setTimeout(r, getEditPollInterval(i)));
            try {
              const res = await fetch('/api/poll-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, model: modelInfo.model, providerId: getCurrentProviderId(), engine: data.engine }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const pollData = await res.json();
              if (pollData.status === 'completed' && pollData.imageUrl) return pollData.imageUrl;
              if (pollData.status === 'failed' || pollData.status === 'error' || pollData.retryable === false) return null;
            } catch { /* continue */ }
          }
          return null;
        })();
      }

      if (resultUrl) {
        const w = img.originalWidth || Math.round(img.width);
        const h = img.originalHeight || Math.round(img.height);
        updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入透明背景结果...' });
        const stableUrl = await toStableImageUrl(resultUrl);
        completeProcessingFrame(placeholderId, stableUrl, img.width, img.height, {
          originalWidth: w,
          originalHeight: h,
          modifyPrompt: data.engine === 'local-background-alpha' ? '背景移除（本地透明化）' : String(data.engine || '').includes('ai-background-remove') ? '背景移除（AI高精度）' : '背景移除',
        });
      } else {
        alert(lastPollErrorRef.current || data.error || '移除背景超时，请重试');
      }
    } catch (e) {
      console.error('Remove background error:', e);
      alert(`操作失败: ${e instanceof Error ? e.message : '请重试'}`);
    }
    setIsEditProcessing(false);
  }, [selectedImageData, getApiKey, getCurrentModel, pollForResult, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame]);

  // 3. SVG智能描摹 - Sharp + VTracer (彩色) / ImageMagick + Potrace (黑白) / Sharp (压缩/缩略图)
  const handleOpenSvgTrace = useCallback(() => {
    if (!selectedImageData) return;
    if (selectedImage) setEditImageId(selectedImage.id);
    setEditMode('svg-trace');
  }, [selectedImageData, selectedImage]);

  const handleSvgTraceConfirm = useCallback(async () => {
    const img = selectedImageData;
    if (!img) return;

    const modeLabels: Record<string, string> = {
      color: '彩色矢量化',
      bw: '黑白描摹',
      compress: '图片压缩',
      thumbnail: '缩略图生成',
    };
    const modeLabel = modeLabels[svgTraceMode] || 'SVG描摹';

    const placeholderId = createProcessingFrameRightOf(
      img,
      modeLabel + '中',
      img.width,
      img.height,
      '正在处理...'
    );
    setIsEditProcessing(true);
    try {
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
        requestBody.alphaMax = svgTraceBwAlphaMax;
      } else if (svgTraceMode === 'compress') {
        requestBody.quality = svgTraceCompressQuality;
        requestBody.compressFormat = svgTraceCompressFormat;
      } else if (svgTraceMode === 'thumbnail') {
        requestBody.thumbnailWidth = svgTraceThumbWidth;
        requestBody.thumbnailHeight = svgTraceThumbHeight;
        requestBody.thumbnailFit = svgTraceThumbFit;
      }

      const response = await fetch('/api/svg-trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

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
          const displayUrl = data.pngPreviewUrl || data.dataUrl || data.url;
          const svgDataUrl = data.svgDataUrl || (data.dataUrl && !data.isSvgPreview ? data.dataUrl : undefined);
          const engineLabel = data.engine === 'vtracer' ? 'VTracer' : data.engine === 'potrace' ? 'Potrace' : data.engine;
          completeProcessingFrame(placeholderId, displayUrl, img.width, img.height, {
            originalWidth: img.originalWidth || Math.round(img.width),
            originalHeight: img.originalHeight || Math.round(img.height),
            modifyPrompt: `${modeLabel} (${engineLabel})`,
            // 保存SVG数据URL用于下载（如果PNG预览被使用）
            ...(svgDataUrl && data.isSvgPreview ? { svgDataUrl } : {}),
          });
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
          });
        }
      } else {
        throw new Error(data.error || '处理失败');
      }
    } catch (e) {
      console.error('SVG trace failed:', e);
      alert(`SVG智能描摹失败: ${e instanceof Error ? e.message : '请重试'}`);
    }
    setIsEditProcessing(false);
    setEditMode('none');
  }, [selectedImageData, svgTraceMode, svgTraceQualityPreset, svgTraceColorPrecision, svgTraceFilterSpeckle, svgTraceCornerThreshold, svgTraceLengthThreshold, svgTraceCurveMode, svgTraceHierarchical, svgTraceBwThreshold, svgTraceBwTurdSize, svgTraceBwInvert, svgTraceBwAlphaMax, svgTraceCompressQuality, svgTraceCompressFormat, svgTraceThumbWidth, svgTraceThumbHeight, svgTraceThumbFit, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame]);

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
    const img = selectedImageData;
    if (!img) return;
    const apiKey = getApiKey();
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
      updateProcessingFrame(placeholderId, { progress: 12, status: '正在提交角度参数...' });
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
          model: modelInfo.model,
          apiKey,
          providerId: modelInfo.providerId || getCurrentProviderId(),
        }),
      });
      if (!res.ok) throw new Error(`多角度生成失败: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) {
        alert(data.error || '多角度生成失败');
        return;
      }
      updateProcessingFrame(placeholderId, { progress: 24, status: 'AI 正在重建立体视角...' });
      const resultUrl = data.imageUrl || await pollForResult(data.taskId, apiKey, (progress, status) => {
        updateProcessingFrame(placeholderId, { progress, status });
      });
      if (!resultUrl) {
        alert(lastPollErrorRef.current || '多角度生成超时，请重试');
        return;
      }
      updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入新角度图片...' });
      const stableUrl = await toStableImageUrl(resultUrl);
      completeProcessingFrame(placeholderId, stableUrl, img.width, img.height, {
        originalWidth: img.originalWidth || Math.round(img.width),
        originalHeight: img.originalHeight || Math.round(img.height),
        modifyPrompt: `AI伪3D摄影棚 / ${multiAngleMode === 'image' ? '主体转角' : '摄像机位'} / yaw ${multiAngleRotation}° / pitch ${multiAngleTilt}° / ${['特写', '标准', '广角'][multiAngleZoom]}`,
      });
      setActiveTool('none');
    } catch (e) {
      console.error('Multi-angle failed:', e);
      alert('多角度 AI 生成失败，请检查模型或 API Key');
    } finally {
      setIsMultiAngleProcessing(false);
    }
  }, [selectedImageData, getApiKey, getCurrentModel, pollForResult, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame, removeProcessingFrame, multiAngleMode, multiAngleRotation, multiAngleTilt, multiAngleZoom]);

  // Edit elements - open semantic layer editor directly
  const handleEditElements = useCallback(async () => {
    const img = selectedImageData;
    if (!img) return;
    // Directly open the PSD layer editor with AI semantic analysis
    setPsdEditorImageUrl(img.url);
    setPsdEditorMode('studio');
    setShowPsdEditor(true);
  }, [selectedImageData]);

  const handleOpen3D = useCallback(() => {
    if (!selectedImageData) return;
    const providers = getThreeDProviders();
    if (!threeDProviderId && providers[0]) {
      setThreeDProviderId(providers[0].id);
    }
    setShow3DModal(true);
    setActiveTool('to3d');
    setThreeDProgress(null);
  }, [selectedImageData, getThreeDProviders, threeDProviderId]);

  const handle3DConfirm = useCallback(async () => {
    const img = selectedImageData;
    if (!img) return;
    const providers = getThreeDProviders();
    const provider = providers.find(p => p.id === threeDProviderId);
    if (threeDBackend === 'api' && !provider) {
      alert('请先在图像生成面板的「第三方模型」中添加 3D 模型 API，或切换到本地模型模式');
      return;
    }

    setThreeDProgress('正在创建 3D 转换任务...');
    try {
      const placeholderId = createProcessingFrameRightOf(
        img,
        '转 3D 中',
        img.width,
        img.height,
        '正在创建图生 3D 任务...'
      );
      updateProcessingFrame(placeholderId, { progress: 16, status: '正在提交 3D 转换参数...' });
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
          imageUrl: img.url,
          backend: threeDBackend,
          type: threeDType,
          quality: threeDQuality,
          texture: threeDTexture,
          format: threeDFormat,
          version: threeDVersion,
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
        alert(data.error || '图生 3D 任务创建失败');
        setThreeDProgress(null);
        return;
      }

      let previewUrl: string | null = null;
      let threeDModelUrls: Record<string, string> | undefined;

      if (data.taskId) {
        // Async task - need to poll for result
        updateProcessingFrame(placeholderId, { progress: 25, status: '3D 任务已提交，等待 AI 生成...' });
        const maxAttempts = 300; // 最多轮询300次（600秒，兼容token link等慢速API）
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
              alert(pollData.error || '3D 生成失败');
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
        previewUrl = data.previewImageUrl || await renderEditElementsPreview(img);
      }

      updateProcessingFrame(placeholderId, { progress: 94, status: '正在载入 3D 预览...' });
      // Pick first available model URL from modelUrls (format-agnostic), then fallback
      const firstModelEntry = threeDModelUrls ? Object.values(threeDModelUrls).find((v: string) => v && typeof v === 'string') as string | undefined : undefined;
      const threeDAssetUrl = firstModelEntry || data.assetUrl || '';
      completeProcessingFrame(placeholderId, previewUrl || '', img.width, img.height, {
        originalWidth: img.originalWidth || Math.round(img.width),
        originalHeight: img.originalHeight || Math.round(img.height),
        modifyPrompt: `图生3D/${threeDType}/${threeDBackend}/${threeDQuality}/${threeDFormat}${threeDAssetUrl ? ` → ${threeDAssetUrl}` : ''}`,
        threeDModelUrl: threeDAssetUrl || data.assetUrl || '',
        threeDModelUrls: threeDModelUrls || data.modelUrls,
      });
      setThreeDProgress(null);
    } catch (e) {
      console.error('Image to 3D failed:', e);
      alert('图生 3D 调用失败，请检查 API 或本地模型服务');
      setThreeDProgress(null);
    }
  }, [selectedImageData, getThreeDProviders, threeDProviderId, threeDBackend, threeDType, threeDQuality, threeDTexture, threeDFormat, threeDLocalEndpoint, threeDLocalModel, renderEditElementsPreview, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame, removeProcessingFrame]);

  // 4. ERASE - floating window mode
  const handleOpenErase = useCallback(() => {
    const img = selectedImageData;
    if (!img) return;
    setEditImageId(img.id);
    setEditMode('erase');
    setEditStrokes([]);
    setCurrentStroke([]);
    setEditBrushMode('brush');
    setEditCanvasZoom(1);
    setEditCanvasPan({ x: 0, y: 0 });
    setMaskKeyword('');
  }, [selectedImageData]);

  // 5. MASK - floating window mode
  const handleOpenMask = useCallback(() => {
    const img = selectedImageData;
    if (!img) return;
    setEditImageId(img.id);
    setEditMode('mask');
    setEditStrokes([]);
    setCurrentStroke([]);
    setEditBrushMode('brush');
    setEditCanvasZoom(1);
    setEditCanvasPan({ x: 0, y: 0 });
    setMaskKeyword('');
  }, [selectedImageData]);

  // 6. EXPAND - 即梦风格方向性扩展
  const handleOpenExpand = useCallback(() => {
    const img = selectedImageData;
    if (!img) return;
    setEditMode('expand');
    setEditImageId(img.id);
    setExpandRatio('1:1');
    // 重置方向性扩展 padding
    setExpandPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    expandPaddingRef.current = { top: 0, right: 0, bottom: 0, left: 0 };
  }, [selectedImageData]);

  // 即梦风格扩展：拖拽控制点事件处理
  const handleExpandDragStart = useCallback((handle: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingHandle(handle);
    const startX = e.clientX;
    const startY = e.clientY;
    const startPadding = { ...expandPaddingRef.current };

    const handleMouseMove = (ev: MouseEvent) => {
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

      let newPadding = { ...startPadding };
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
  }, [images, editImageId, zoom]);

  // 快捷扩展：等比扩展四边
  const handleExpandEqualPadding = useCallback((pixels: number) => {
    const newPadding = { top: pixels, right: pixels, bottom: pixels, left: pixels };
    expandPaddingRef.current = newPadding;
    setExpandPadding(newPadding);
  }, []);

  // 快捷扩展：单方向扩展
  const handleExpandDirection = useCallback((direction: 'top' | 'right' | 'bottom' | 'left', pixels: number) => {
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
    const img = selectedImageData;
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
  }, [selectedImageData]);

  // 8. DOWNLOAD - popup with PNG/SVG/PSD
  const handleOpenDownload = useCallback(() => {
    setShowDownloadPopup(true);
    setActiveTool('download');
  }, []);

  // Edit mode handlers
  const startEditMode = (mode: EditMode, imageId: string) => {
    setEditMode(mode);
    setEditImageId(imageId);
    setEditStrokes([]);
    setCurrentStroke([]);
    setCropRect(null);
    currentStrokeRef.current = [];
    isDrawingRef.current = false;
  };

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

  // Edit confirm for erase/mask/expand/crop
  const handleEditConfirm = useCallback(async () => {
    const editImg = images.find(i => i.id === editImageId);
    if (!editImg) { exitEditMode(); return; }

    const apiKey = getApiKey();

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
          completeProcessingFrame(placeholderId, newUrl, displayW, displayH, { originalWidth: canvas.width, originalHeight: canvas.height });
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
          : ''; // 擦除模式：空提示词

        let resultUrl: string | null = null;

        updateProcessingFrame(placeholderId, { progress: 8, status: '正在提交编辑请求...' });

        const modelInfo = getCurrentModel();
        const requestBody = {
          action: 'inpaint',
          imageUrl: currentEditImg.url,
          maskImage: maskBase64,
          prompt,
          editMode: currentEditMode as 'erase' | 'mask',
          aspectRatio: `${currentEditImg.originalWidth || currentEditImg.width || 1}:${currentEditImg.originalHeight || currentEditImg.height || 1}`,
          model: modelInfo.model,
          apiKey,
          providerId: modelInfo.providerId || getCurrentProviderId(),
          ...(currentEditMode === 'erase' ? { eraseModel: eraseModelId } : {}),
        };

        const bodyStr = JSON.stringify(requestBody);
        // 日志：记录请求体大小以便排查 "Failed to fetch" 问题
        console.log('[inpaint] bodySize:', Math.round(bodyStr.length / 1024) + 'KB', 'urlType:', currentEditImg.url?.substring(0, 20));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 3分钟超时

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

        let data: any;
        try {
          data = await res.json();
        } catch {
          console.error('[inpaint] JSON parse failed, response starts with:', (await res.text().catch(() => '')).substring(0, 100));
          throw new Error('服务器返回了非预期格式，请稍后重试');
        }
        if (!data.success) {
          console.error('Image edit failed:', data.error);
          // 后端已根据 editMode 返回不同错误消息
          let errorMessage = data.error || '编辑失败';
          updateProcessingFrame(placeholderId, {
            progress: -1,
            status: `❌ ${errorMessage}`,
            error: errorMessage,
          });
          setTimeout(() => removeProcessingFrame(placeholderId), 5000);
          return;
        }

        const syncResultUrl: string | undefined = data.imageUrl;
        const cropInfo = data.cropInfo || null;
        const compositeInfo = data.compositeInfo || null; // 异步擦除超时后返回的合成信息

        if (syncResultUrl) {
          const engineLabel = data.engine?.includes('iopaint') ? 'IOPaint 正在处理' : data.engine === 'local-erase' ? '本地修复完成' : '正在载入编辑结果';
          updateProcessingFrame(placeholderId, { progress: 80, status: engineLabel + '...' });
          resultUrl = syncResultUrl;
        } else if (data.taskId) {
          updateProcessingFrame(placeholderId, { progress: 24, status: 'AI 正在重绘选区...' });
          resultUrl = await pollForResult(data.taskId, apiKey, (progress, status) => {
            updateProcessingFrame(placeholderId, { progress, status });
          });
        } else {
          removeProcessingFrame(placeholderId);
          return;
        }

        // 异步结果前端蒙版合成
        if (resultUrl && !syncResultUrl) {
          try {
            // 如果有 compositeInfo（服务器端轮询超时后返回），使用其中的蒙版数据
            const compositeMask = compositeInfo?.maskDataUrl || maskBase64;
            const compositeOrigW = compositeInfo?.origW || (currentEditImg.originalWidth || Math.round(currentEditImg.width));
            const compositeOrigH = compositeInfo?.origH || (currentEditImg.originalHeight || Math.round(currentEditImg.height));
            const compositeUrl = await compositeInpaintResult(
              currentEditImg.url,
              compositeMask,
              resultUrl,
              compositeOrigW,
              compositeOrigH,
              cropInfo,
              editMode === 'erase' ? 'erase' : 'mask'
            );
            resultUrl = compositeUrl;
          } catch (compositeErr) {
            console.error('Composite inpaint failed, using raw result:', compositeErr);
          }
        }

        if (resultUrl) {
          updateProcessingFrame(placeholderId, { progress: 96, status: '正在合成编辑结果...' });
          try {
            const stableUrl = await toStableImageUrl(resultUrl);
            completeProcessingFrame(placeholderId, stableUrl, currentEditImg.width, currentEditImg.height, { originalWidth: currentEditImg.originalWidth || Math.round(currentEditImg.width), originalHeight: currentEditImg.originalHeight || Math.round(currentEditImg.height) });
          } catch (stableErr) {
            console.error('Stable URL conversion failed:', stableErr);
            completeProcessingFrame(placeholderId, resultUrl, currentEditImg.width, currentEditImg.height, { originalWidth: currentEditImg.originalWidth || Math.round(currentEditImg.width), originalHeight: currentEditImg.originalHeight || Math.round(currentEditImg.height) });
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
            aspectRatio: `${origW}:${origH}`,
            prompt: editPrompt || 'Naturally extend the image beyond its original borders. Fill the new areas with content that seamlessly continues the existing scene, maintaining consistent style, lighting, perspective and color palette.',
            model: modelInfo.model,
            apiKey,
            providerId: modelInfo.providerId || getCurrentProviderId(),
          }),
        });

        let data: any;
        try {
          const resText = await res.text();
          try { data = JSON.parse(resText); } catch { data = { success: false, error: resText.substring(0, 200) }; }
        } catch {
          data = { success: false, error: `HTTP ${res.status}` };
        }
        if (!data.success) {
          alert(data.error || '扩展失败');
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
          resultUrl = await pollForResult(data.taskId, apiKey, (progress, status) => {
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
            const stableUrl = await toStableImageUrl(resultUrl);
            completeProcessingFrame(placeholderId, stableUrl, currentEditImg.width * (finalW / origW), currentEditImg.height * (finalH / origH), { originalWidth: finalW, originalHeight: finalH });
          } catch (stableErr) {
            completeProcessingFrame(placeholderId, resultUrl, currentEditImg.width * (finalW / origW), currentEditImg.height * (finalH / origH), { originalWidth: finalW, originalHeight: finalH });
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
  }, [editMode, editImageId, images, editStrokes, editPrompt, maskKeyword, expandPadding, brushSize, zoom, cropRect, onImagesChange, getCurrentModel, renderMaskFromStrokes, exitEditMode, viewOffset, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame, removeProcessingFrame]);

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
        a.download = `${image.prompt?.substring(0, 30) || 'model'}.${targetFormat}`;
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
        // 优先使用svgDataUrl（画布显示PNG预览时保留的完整SVG数据）
        const svgSource = image.svgDataUrl || image.url;
        // If image URL is already an SVG data URL (from SVG描摹), download directly
        if (svgSource.startsWith('data:image/svg+xml')) {
          setDownloadProgress('正在导出矢量图...');
          try {
            let svgContent = decodeURIComponent(svgSource.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
            // Apply AI-compatible sanitization: add viewBox, ensure proper namespaces
            svgContent = ensureSvgAiCompatible(svgContent);
            const blob = new Blob([svgContent], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${image.prompt?.substring(0, 30) || 'vector'}.svg`;
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
      if (format === 'psd') {
        setDownloadProgress('正在生成 PSD...');
        const { downloadPSD } = await import('@/lib/psd-export');
        await downloadPSD(image.url, image.prompt || 'Image', psdMode, (stage, progress) => {
          const stageLabels: Record<string, string> = {
            preparing_image: '准备图片...',
            detecting_background: '分析背景...',
            segmenting_elements: '分割元素...',
            semantic_analysis: '语义识别...',
            building_scene: '构建分层...',
            assembling_psd: '写入PSD...',
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
      try {
        const response = await fetch(image.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${image.prompt?.substring(0, 30) || 'image'}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // Direct fetch failed (likely CORS), use server-side proxy
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
            a.download = `${image.prompt?.substring(0, 30) || 'image'}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
        } catch (proxyError) {
          console.error('Download proxy also failed:', proxyError);
        }
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
    '放大': 'text-blue-600', '移除背景': 'text-pink-500', 'SVG智能描摹': 'text-emerald-500',
    '擦除': 'text-orange-500', '蒙版': 'text-violet-500', '编辑元素': 'text-cyan-500',
    '多角度': 'text-teal-500', '转3D': 'text-indigo-500', '扩展': 'text-amber-500',
    '裁切': 'text-rose-500', '语言修图': 'text-sky-500', 'Agent编排': 'text-fuchsia-500',
    '下载': 'text-gray-600',
  };
  const imageActions = [
    { icon: <ZoomIn size={14} className={isMonochrome ? monoColors['放大'] : ''} />, label: '放大', desc: '智能补细节放大，变大变高清，不改内容', action: handleOpenUpscale },
    { icon: <Eraser size={14} className={isMonochrome ? monoColors['移除背景'] : ''} />, label: '移除背景', desc: '一键删除背景，只剩透明底主体', action: () => setShowRemoveBgPicker(true) },
    { icon: <PenTool size={14} className={isMonochrome ? monoColors['SVG智能描摹'] : ''} />, label: 'SVG智能描摹', desc: '矢量描摹/压缩/缩略图', action: handleOpenSvgTrace },
    { icon: <Paintbrush size={14} className={isMonochrome ? monoColors['擦除'] : ''} />, label: '擦除', desc: '涂抹消除，自动无缝补全画面', action: handleOpenErase },
    { icon: <Wand2 size={14} className={isMonochrome ? monoColors['蒙版'] : ''} />, label: '蒙版', desc: '精准遮罩控制，只改露出的区域', action: handleOpenMask },
    { icon: <Layers size={14} className={isMonochrome ? monoColors['编辑元素'] : ''} />, label: '编辑元素', desc: '按元素分层，独立编辑', action: handleEditElements },
    { icon: <RotateCcw size={14} className={isMonochrome ? monoColors['多角度'] : ''} />, label: '多角度', desc: '多视角生成', action: handleOpenMultiAngle },
    { icon: <Box size={14} className={isMonochrome ? monoColors['转3D'] : ''} />, label: '转3D', desc: '生成3D模型预览', action: handleOpen3D },
    { icon: <Expand size={14} className={isMonochrome ? monoColors['扩展'] : ''} />, label: '扩展', desc: '向四周延伸画面，自动补齐背景', action: handleOpenExpand },
    { icon: <Scissors size={14} className={isMonochrome ? monoColors['裁切'] : ''} />, label: '裁切', desc: '自由/预设比例裁切', action: handleOpenCrop },
    { icon: <Pencil size={14} className={isMonochrome ? monoColors['语言修图'] : ''} />, label: '语言修图', desc: '用自然语言描述修改图片', action: () => { if (selectedImage) onEditImage?.(selectedImage); else onEditImage?.(null); } },
    { icon: <Bot size={14} className={isMonochrome ? monoColors['Agent编排'] : ''} />, label: 'Agent编排', desc: '智能编排多工具编辑图片', action: () => { const img = selectedImageData || selectedImage; if (img) { setAgentEditImage(img); } else { setAgentEditImage(null); } setShowAgentEditor(true); } },
    { icon: <Download size={14} className={isMonochrome ? monoColors['下载'] : ''} />, label: '下载', desc: 'PNG/SVG/PSD下载', action: handleOpenDownload },
  ];

  // 根据 toolbarItemOrder 和 toolbarHiddenItems 过滤/排序工具栏
  // 确保新增的工具项（localStorage中可能没有）也能显示
  const allActionLabels = imageActions.map(a => a.label);
  const fullOrder = [...toolbarItemOrder];
  for (const label of allActionLabels) {
    if (!fullOrder.includes(label)) fullOrder.push(label);
  }
  const visibleImageActions = fullOrder
    .filter(label => !toolbarHiddenItems.has(label))
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
    { label: '显示所有元素', shortcut: 'Shift+1', action: () => { if (images.length === 0) return; const minX = Math.min(...images.map(i => i.x)); const minY = Math.min(...images.map(i => i.y)); const maxX = Math.max(...images.map(i => i.x + i.width)); const maxY = Math.max(...images.map(i => i.y + i.height)); setViewOffset({ x: -minX * zoom + 50, y: -minY * zoom + 50 }); } },
    { label: '缩放至100%', shortcut: 'Ctrl+0', action: () => { setZoom(1); setViewOffset({ x: 0, y: 0 }); } },
  ];

  // Helper to save image changes and force persist
  const applyImageChanges = (newImages: typeof images) => {
    onImagesChange(newImages);
    onForceSave?.();
  };

  const imageContextMenuItems = selectedIds.size > 1 ? [
    { label: '创建组', shortcut: '', action: () => { handleCreateGroup(); } },
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
  ] : [
    { label: '复制', shortcut: 'Ctrl+C', action: () => { const img = selectedImageData; if (img) handleCopyImage(img); } },
    { label: '下载', action: () => { handleOpenDownload(); } },
    ...(selectedImageData?.threeDModelUrl ? [{ label: '3D 预览', action: () => { setViewer3DModelUrl(selectedImageData.threeDModelUrl || ''); setViewer3DPreviewUrl(selectedImageData.url); setViewer3DModelUrls(selectedImageData.threeDModelUrls || {}); setShow3DViewer(true); } }] : []),
    { label: '删除', shortcut: 'Delete', action: () => { onImagesChange(images.filter(i => !selectedIds.has(i.id))); setSelectedIds(new Set()); selectImage(null); } },
    { label: '发送参考图', action: () => { const img = selectedImageData; if (img) onGenerateVariation(img); } },
    { label: '提取关键词', action: () => { const img = selectedImageData; if (img) onExtractKeywords(img); } },
    { label: '语言修图', action: () => { const img = selectedImageData; if (img) onEditImage?.(img); else onEditImage?.(null); } },
    { label: 'Agent编排', action: () => { const img = selectedImageData; if (img) { setAgentEditImage(img); setShowAgentEditor(true); } } },
    { label: '加入收藏夹', action: () => { const img = selectedImageData; if (img && onAddToFavorites) onAddToFavorites(img); } },
  ];

  const ratioOptions = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'];

  // Floating panel style helpers
  const panelBaseClass = `flex items-center gap-1.5 px-3 py-2 rounded-xl border shadow-xl ${isMonochrome ? 'bg-white/95 border-gray-200' : 'bg-[#1a1a1a]/95 border-[#2a2a2a]'}`;
  const panelLabelClass = `text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`;
  const panelSmallLabelClass = `text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`;
  const panelDividerClass = `w-px h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'} mx-1`;
  const panelBtnClass = `px-3 py-1.5 text-xs font-medium ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c049]'} rounded-lg transition-colors`;
  const panelCancelBtnClass = `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isMonochrome ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'}`;
  const panelInputClass = `w-16 px-2 py-1 text-xs rounded-lg border text-center ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-[#1a1a1a]/80 border-white/[0.12] text-white'}`;

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
          altKeyHeld && editMode === 'none'
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
            isMonochrome
              ? {
                  // 灰色网点，方便查看图片边缘
                  backgroundImage: 'radial-gradient(circle, #e5e5e5 1px, transparent 1px)',
                  backgroundSize: '12px 12px',
                  transform: `translate(${viewOffset.x % 12}px, ${viewOffset.y % 12}px)`,
                }
              : {
                  // 金色模式：白点网格
                  backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                  opacity: 0.1,
                  transform: `translate(${viewOffset.x % 20}px, ${viewOffset.y % 20}px)`,
                }
          }
        />

        {/* Collapsible toolbar - top left */}
        <div className="absolute top-3 left-3 z-50 group/toolbar">
          {/* Collapsed: minimal icon dot */}
          <div className="group-hover/toolbar:hidden">
            <button
              className={`flex items-center justify-center w-7 h-7 rounded-md transition-all ${
                isMonochrome
                  ? 'bg-white/60 text-blue-500 hover:bg-white/80 hover:text-blue-700'
                  : 'bg-[#181818]/80 text-[#666] hover:bg-[#252525] hover:text-[#aaa]'
              }`}
              title="展开工具栏"
            >
              <Wrench size={13} />
            </button>
          </div>
          {/* Expanded: show all buttons */}
          <div className={`hidden group-hover/toolbar:flex flex-col gap-1 min-w-[130px] p-1.5 rounded-xl ${
            isMonochrome ? 'bg-white/95 border border-gray-100 shadow-lg' : 'bg-[#181818]/95'
          }`}>
            {/* OMP Toggle */}
            <button
              onClick={() => {
                if (onToggleVisionPrompt) onToggleVisionPrompt();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                ohMyPromptOpen
                  ? isMonochrome
                    ? 'bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100'
                    : 'bg-[#d4af37]/20 border-[#d4af37]/50 text-[#d4af37] hover:bg-[#d4af37]/30'
                  : isMonochrome
                    ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                    : 'bg-transparent text-[#777] hover:text-[#ccc] hover:bg-white/[0.06]'
              }`}
              title="Oh My Prompt - 提示词管理与图片识词"
            >
              <Sparkles className={`h-3 w-3 ${ohMyPromptOpen ? '' : isMonochrome ? 'text-amber-500' : ''}`} />
              <span>Oh My Prompt</span>
              {ohMyPromptOpen && (
                <span className={`ml-auto w-1.5 h-1.5 rounded-full animate-pulse ${isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]'}`} />
              )}
            </button>
            {/* Ctrl+Click Reference Fusion Toggle */}
            <button
              onClick={() => setShowRefFusion(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                showRefFusion
                  ? isMonochrome
                    ? 'bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100'
                    : 'bg-[#d4af37]/20 border-[#d4af37]/50 text-[#d4af37] hover:bg-[#d4af37]/30'
                  : isMonochrome
                    ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                    : 'bg-transparent text-[#777] hover:text-[#ccc] hover:bg-white/[0.06]'
              }`}
              title="Ctrl+Click 画布图片选择参考融合"
            >
              <GitMerge className={`h-3 w-3 ${showRefFusion ? '' : isMonochrome ? 'text-teal-500' : ''}`} />
              <span>参考融合</span>
              {showRefFusion && (
                <span className={`ml-auto w-1.5 h-1.5 rounded-full animate-pulse ${isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]'}`} />
              )}
            </button>
            {/* Divider */}
            <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#333]'}`} />
            {/* Settings */}
            <button
              onClick={onToggleSettings}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isMonochrome
                  ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  : 'bg-transparent text-[#777] hover:text-[#ccc] hover:bg-white/[0.06]'
              }`}
              title="设置"
            >
              <Settings className={`h-3 w-3 ${isMonochrome ? 'text-slate-500' : ''}`} />
              <span>设置</span>
              {!isPanelCollapsed && (
                <span className={`ml-auto w-1.5 h-1.5 rounded-full animate-pulse ${isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]'}`} />
              )}
            </button>
            {/* UI Theme Toggle */}
            <button
              onClick={onToggleTheme}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isMonochrome
                  ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  : 'bg-transparent text-[#777] hover:text-[#ccc] hover:bg-white/[0.06]'
              }`}
              title="UI 主题切换"
            >
              <Palette className={`h-3 w-3 ${isMonochrome ? 'text-purple-500' : ''}`} />
              <span>{isMonochrome ? '彩色模式' : '黑白模式'}</span>
            </button>
            {/* User Manager */}
            <button
              onClick={onToggleUserManager}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isMonochrome
                  ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  : 'bg-transparent text-[#777] hover:text-[#ccc] hover:bg-white/[0.06]'
              }`}
              title="用户管理"
            >
              <Users className={`h-3 w-3 ${isMonochrome ? 'text-sky-500' : ''}`} />
              <span>用户管理</span>
            </button>
            {/* Project Data */}
            <button
              onClick={onToggleProjectData}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isMonochrome
                  ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  : 'bg-transparent text-[#777] hover:text-[#ccc] hover:bg-white/[0.06]'
              }`}
              title="项目数据"
            >
              <FolderOpen className={`h-3 w-3 ${isMonochrome ? 'text-emerald-500' : ''}`} />
              <span>项目数据</span>
            </button>
            {isAdmin && (
              <button
                onClick={onToggleAdminSystem}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isMonochrome
                    ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                    : 'bg-[#1a1a1a]/90 border-[#d4af37]/30 text-[#d4af37] hover:bg-[#222]/80'
                }`}
                title="管理员系统"
              >
                <Shield className={`h-3 w-3 ${isMonochrome ? 'text-orange-500' : ''}`} />
                <span>管理员系统</span>
              </button>
            )}
            {/* Help / Usage Guide */}
            <button
              onClick={onToggleFavorites}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isMonochrome
                  ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  : 'bg-transparent text-[#d4af37]/70 hover:text-[#d4af37] hover:bg-[#d4af37]/10'
              }`}
              title="收藏夹"
            >
              <Heart className={`h-3 w-3 ${isMonochrome ? 'text-rose-500' : ''}`} />
              <span>收藏夹</span>
            </button>
            <button
              onClick={onToggleHelp}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isMonochrome
                  ? 'bg-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  : 'bg-transparent text-[#777] hover:text-[#ccc] hover:bg-white/[0.06]'
              }`}
              title="使用说明"
            >
              <HelpCircle className={`h-3 w-3 ${isMonochrome ? 'text-indigo-500' : ''}`} />
              <span>使用说明</span>
            </button>
          </div>
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
          />
        )}

        {/* Alt+Click reference mark hint (top center) */}
        {altKeyHeld && editMode === 'none' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-lg flex items-center gap-1.5 ${isMonochrome ? 'bg-blue-500/90 text-white' : 'bg-[#d4af37]/90 text-black'}`}>
              <span className="text-xs">Alt+Click</span>
              <span className="opacity-70">标记图片为参考图</span>
            </div>
          </div>
        )}

        {/* Ctrl+Click reference hint (top center) */}
        {ctrlKeyHeld && editMode === 'none' && showRefFusion && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-lg flex items-center gap-1.5 ${isMonochrome ? 'bg-blue-500/90 text-white' : 'bg-[#d4af37]/90 text-black'}`}>
              <span className="text-xs">Ctrl+Click</span>
              <span className="opacity-70">选择参考图片</span>
            </div>
          </div>
        )}

        {/* Agent 选择图片提示 (top center) */}
        {agentSelectingImage && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className={`px-3 py-1 rounded-full text-xs font-medium shadow-lg flex items-center gap-1.5 ${isMonochrome ? 'bg-blue-500/90 text-white' : 'bg-[#d4af37]/90 text-black'}`}>
              <Bot className="w-3 h-3" />
              <span>点击图片进行 Agent 编排</span>
              <span className="opacity-70">· ESC 取消</span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {images.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-4 max-w-xs">
              <div className={`text-2xl font-light ${isMonochrome ? 'text-gray-400' : 'text-gray-300'}`}>无限画布</div>
              <div className="flex items-center justify-center gap-3 pointer-events-auto">
                <button onClick={() => setShowHelpModal('instructions')} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all border ${isMonochrome ? 'text-blue-600 border-blue-200 hover:text-blue-700 hover:border-blue-400' : 'text-[#888] border-white/[0.14] hover:text-[#d4af37] hover:border-[#d4af37]/40'}`}>
                  <Info size={14} /> 操作说明
                </button>
                <button onClick={() => setShowHelpModal('updates')} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all border ${isMonochrome ? 'text-blue-600 border-blue-200 hover:text-blue-700 hover:border-blue-400' : 'text-[#888] border-white/[0.14] hover:text-[#d4af37] hover:border-[#d4af37]/40'}`}>
                  <FileText size={14} /> 更新内容
                </button>
              </div>
              <div className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-gray-500'}`}>点击下方按钮开始创作</div>
            </div>
          </div>
        )}

        {/* Canvas images */}
        <div style={{ transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
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
                className={`absolute rounded-xl border-2 ${isMonochrome ? 'border-blue-400/60 bg-blue-50/10' : 'border-[#d4af37]/40 bg-[#d4af37]/5'} pointer-events-auto`}
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
                  className={`flex items-center gap-2 px-3 ${isMonochrome ? 'bg-blue-50/80' : 'bg-[#1a1a1a]/90'} rounded-t-lg h-[36px] select-none ${groupDragTarget === group.id && groupDragReadyRef.current ? 'cursor-grabbing' : 'cursor-grab'}`}
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
                      className={`flex-1 text-sm font-medium bg-transparent border-none outline-none ${isMonochrome ? 'text-blue-700' : 'text-[#d4af37]'}`}
                      value={groupEditName}
                      onChange={(e) => setGroupEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGroupEdit(); if (e.key === 'Escape') setEditingGroupId(null); }}
                      onBlur={handleSaveGroupEdit}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={`flex-1 text-sm font-medium truncate ${isMonochrome ? 'text-blue-700' : 'text-[#d4af37]'}`}>
                      {group.name}
                    </span>
                  )}
                  {group.note && !isEditing && (
                    <span className={`text-xs truncate max-w-[120px] ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>
                      {group.note}
                    </span>
                  )}
                  <button
                    className={`p-0.5 rounded hover:bg-white/10 transition-colors ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}
                    onClick={(e) => { e.stopPropagation(); handleToggleGroupCollapse(group.id); }}
                    title={group.collapsed ? '展开' : '折叠'}
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${group.collapsed ? '-rotate-90' : ''}`} />
                  </button>
                  <button
                    className={`p-0.5 rounded hover:bg-red-500/20 transition-colors ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}
                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }}
                    title="取消分组"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* Collapsed indicator */}
                {group.collapsed && groupImages.length > 0 && (
                  <div className={`px-3 py-1 text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#555]'}`}>
                    {groupImages.length} 张图片
                  </div>
                )}
                {/* Note editing */}
                {isEditing && (
                  <div className="px-3 py-1">
                    <input
                      className={`w-full text-xs bg-transparent border-b outline-none ${isMonochrome ? 'text-gray-500 border-gray-200' : 'text-[#888] border-white/[0.12]'}`}
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
          {visibleImages.map(image => {
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
                  left: image.x + (isDragging ? dragOffset.x : 0) + (isGroupDragging ? groupDragOffset.x : 0) + (isInDraggedGenGroup ? genGroupDragOffset.x : 0),
                  top: image.y + (isDragging ? dragOffset.y : 0) + (isGroupDragging ? groupDragOffset.y : 0) + (isInDraggedGenGroup ? genGroupDragOffset.y : 0),
                  width: image.width,
                  height: image.height,
                  display: (isGroupCollapsed || isInCollapsedGenGroup || isGenGroupResultImage) ? 'none' : undefined,
                }}
                onMouseEnter={() => {
                  if (visionPromptEnabled && editMode === 'none') {
                    setVisionHoverImage(image);
                  }
                }}
                onMouseLeave={() => {
                  setVisionHoverImage(null);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (image.isProcessingPlaceholder) return;
                  if (editMode !== 'none') return;
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
                    <img
                      src={image.processing.sourceUrl || image.url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-40 pointer-events-none"
                      draggable={false}
                    />
                    <div className="absolute inset-0 bg-black/50 pointer-events-none" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 pointer-events-none">
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
                            <div className="absolute inset-0 rounded-full bg-[#d4af37]/20 animate-ping" style={{ animationDuration: '2s' }} />
                          </div>
                          <div className={`px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-md text-xs font-semibold shadow-lg border ${isMonochrome ? 'text-blue-400 border-blue-400/20' : 'text-[#d4af37] border-[#d4af37]/20'}`}>
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
                          <div className={`text-xs font-mono ${isMonochrome ? 'text-blue-400/70' : 'text-[#d4af37]/70'}`}>
                            {Math.round(image.processing.progress)}%
                          </div>
                          {/* ★ 取消按钮 */}
                          <button
                            className="pointer-events-auto mt-1 px-3 py-1 rounded-full bg-red-500/70 hover:bg-red-500/90 text-white text-xs font-medium transition-colors backdrop-blur-sm"
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
                          <div className="px-4 py-2 rounded-full bg-black/55 backdrop-blur-md text-white text-sm font-medium shadow-lg border border-white/10">
                            {image.processing.label}
                          </div>
                          <div className="w-36 max-w-[70%] h-1.5 rounded-full bg-white/15 overflow-hidden">
                            <div
                              className="h-full rounded-full progress-shimmer transition-all duration-500"
                              style={{
                                width: `${image.processing.progress}%`,
                                background: 'linear-gradient(90deg, #d4af37, #f4e18f, #d4af37)',
                                backgroundSize: '200% 100%',
                              }}
                            />
                          </div>
                          <div className="text-xs text-white/70 text-center px-3">
                            {image.processing.status} {Math.round(image.processing.progress)}%
                          </div>
                          {/* ★ 取消按钮 */}
                          <button
                            className="pointer-events-auto mt-1 px-3 py-1 rounded-full bg-red-500/70 hover:bg-red-500/90 text-white text-xs font-medium transition-colors backdrop-blur-sm"
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
                ) : (
                  <img
                    src={image.url}
                    alt={image.prompt || 'canvas image'}
                    className="w-full h-full object-cover pointer-events-none"
                    draggable={false}
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.dataset.retried) return; // 已重试过，不再循环
                      img.dataset.retried = '1';
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
                      }
                    }}
                  />
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
                        setShow3DViewer(true);
                      }}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-bold shadow-lg transition-colors cursor-pointer ${isMonochrome ? 'bg-blue-500/90 text-white hover:bg-blue-500' : 'bg-[#d4af37]/90 text-black hover:bg-[#d4af37]'}`}
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
                  <div className="absolute inset-0 border-2 border-[#d4af37] rounded-sm pointer-events-none">
                    {['tl', 'tr', 'bl', 'br'].map(corner => (
                      <div
                        key={corner}
                        className={`absolute w-2.5 h-2.5 rounded-sm pointer-events-auto cursor-${
                          corner === 'tl' ? 'nwse-resize' : corner === 'tr' ? 'nesw-resize' : corner === 'bl' ? 'nesw-resize' : 'nwse-resize'
                        } ${isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]'}`}
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
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shadow-lg ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'}`}>
                        {refIdx + 1}
                      </span>
                    </div>
                  );
                })()}
                {/* Oh My Prompt - Vision hover sparkles button */}
                {visionPromptEnabled && visionHoverImage?.id === image.id && editMode === 'none' && !isVisionAnalyzing && (
                  <button
                    className={`absolute top-2 right-2 z-40 p-1.5 rounded-lg transition-all shadow-lg hover:scale-110 ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c249]'}`}
                    style={{ fontSize: `${Math.max(11, 13 / zoom)}px` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVisionPrompt?.(image.url);
                      setVisionHoverImage(null);
                    }}
                    title="生成双语提示词"
                  >
                    <Sparkles className="h-4 w-4" />
                  </button>
                )}
                {/* Oh My Prompt - Analyzing indicator */}
                {visionPromptEnabled && visionHoverImage?.id === image.id && isVisionAnalyzing && (
                  <div
                    className={`absolute top-2 right-2 z-40 p-1.5 rounded-lg animate-pulse ${isMonochrome ? 'bg-blue-500/80 text-white' : 'bg-[#d4af37]/80 text-black'}`}
                    style={{ fontSize: `${Math.max(11, 13 / zoom)}px` }}
                  >
                    <Sparkles className="h-4 w-4 animate-spin" />
                  </div>
                )}
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
            const outputCenterX = outputX + outputFrameWidth / 2;
            const outputCenterY = outputY + outputFrameHeight / 2;

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
                  <div className="w-full h-full border-2 border-dashed border-[#d4af37]/50 rounded-lg flex flex-col items-center justify-center gap-2"
                    style={{
                      background: 'rgba(212,175,55,0.05)',
                    }}>
                    <div className="w-4 h-4 rotate-45 border border-[#d4af37]/30" style={{ margin: '4px' }} />
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-blue-500/60' : 'text-[#d4af37]/60'}`}>
                      融合输出
                    </span>
                    <span className={`text-xs ${isMonochrome ? 'text-blue-500/40' : 'text-[#d4af37]/40'}`}>
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
            const srcBounds = srcImages.map(img => ({ x: img.x + dragDx, y: img.y + dragDy, w: img.width, h: img.height }));
            const srcRightEdge = srcBounds.length > 0 ? Math.max(...srcBounds.map(b => b.x + b.w)) : 0;
            const srcTopEdge = srcBounds.length > 0 ? Math.min(...srcBounds.map(b => b.y)) : 0;
            const srcCenterY = srcBounds.length > 0 ? srcBounds.reduce((s, b) => s + b.y + b.h / 2, 0) / srcBounds.length : 0;
            const gapBetweenSrcAndResult = 80; // 80px gap between source images and result frame
            const resultX = srcRightEdge + gapBetweenSrcAndResult;
            const resultY = srcCenterY - resultH / 2; // vertically centered relative to source images
            const resultCenterX = resultX + resultW / 2;
            const resultCenterY = resultY + resultH / 2;

            // Container bounds: include all source images + result placeholder + toolbar (apply drag offset)
            const resultFrameW = Math.max(resultW, 420);
            const hasResult = !!group.resultPlaceholder.resultUrl;
            const toolbarH = hasResult ? 0 : 350; // toolbar hidden when result exists
            const allBounds = [
              ...srcBounds,
              { x: resultX, y: resultY, w: resultFrameW, h: resultH + toolbarH }
            ];
            const containerPad = 24;
            // 参考图组下方需要额外空间显示类别标签
            const leftPad = containerPad;
            const bottomPad = isRef ? 142 : containerPad;
            const containerMinX = Math.min(...allBounds.map(b => b.x)) - containerPad;
            const containerMinY = Math.min(...allBounds.map(b => b.y)) - containerPad - 40;
            const containerMaxX = Math.max(...allBounds.map(b => b.x + b.w)) + containerPad;
            const containerMaxY = Math.max(...allBounds.map(b => b.y + b.h)) + bottomPad;
            const containerW = containerMaxX - containerMinX;
            const containerH = containerMaxY - containerMinY;

            // Find current model display name
            const currentModelObj = canvasGenModels.find(m => m.id === group.toolbar.model && m.providerId === (group.toolbar.providerId || ''));
            const modelDisplayName = currentModelObj ? `${getModelDisplayName(currentModelObj.id)} · 来自 ${currentModelObj.providerName}` : (group.toolbar.model ? getModelDisplayName(group.toolbar.model) : '选择模型');

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
                  const hasAnyCat = imgCats.length > 0;
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
                                className="flex-shrink-0 w-7 text-[9px] font-medium select-none cursor-pointer transition-colors"
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
                                className="flex-shrink-0 w-6 text-right text-[9px] font-semibold tabular-nums"
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
                      <img
                        src={group.resultPlaceholder.resultUrl}
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
                          {group.toolbar.aspectRatio} {calculateActualPixels(group.toolbar.aspectRatio, group.toolbar.quality, group.toolbar.model)}
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
                  >
                    {/* Row 1: Model selector — custom dropdown with highlight */}
                    <div className="relative">
                      <span className="text-xs font-medium shrink-0 mb-1 block" style={{ color: `${accentColor}cc` }}>模型</span>
                      <button
                        className={`w-full text-left text-sm px-2.5 py-1.5 rounded-lg border flex items-center justify-between ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-[#1f1f1f] border-white/[0.14] text-[#ddd]'}`}
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
                        >
                          {canvasGenModels.map((m, mi) => {
                            const isSelected = group.toolbar.model === m.id && group.toolbar.providerId === m.providerId;
                            return (
                              <button
                                key={`${m.providerId}::${m.id}::${mi}`}
                                className={`w-full text-left text-sm px-3 py-2 flex items-center gap-2 transition-colors ${isSelected ? (isMonochrome ? 'bg-blue-50 text-blue-800' : 'bg-[#d4af37]/15 text-[#d4af37]') : (isMonochrome ? 'hover:bg-gray-100 text-gray-700' : 'hover:bg-[#2a2a2a] text-[#ccc]')}`}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 获取新模型支持的参数，重置质量和比例
                                  const newSupportedRatios = findModelConfig(MODEL_ASPECT_RATIOS, m.id) || DEFAULT_ASPECT_RATIOS;
                                  const newSupportedQualities = findModelConfig(MODEL_QUALITIES, m.id) || DEFAULT_QUALITIES;
                                  const newAspectRatio = newSupportedRatios.includes('1:1') ? '1:1' : newSupportedRatios[0];
                                  const newQuality = newSupportedQualities[0];
                                  const newSize = calculateActualPixels(newAspectRatio, newQuality, m.id);
                                  setGenGroups(prev => prev.map(g =>
                                    g.id === group.id ? { ...g, toolbar: { ...g.toolbar, model: m.id, providerId: m.providerId, providerName: m.providerName, aspectRatio: newAspectRatio, quality: newQuality, size: newSize } } : g
                                  ));
                                  setOpenModelDropdownGroupId(null);
                                }}
                              >
                                {isSelected && <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                                <span className="truncate">{getModelDisplayName(m.id)} · 来自 {m.providerName}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Row 2: Aspect ratio + Quality + Count */}
                    {(() => {
                      const supportedRatios = findModelConfig(MODEL_ASPECT_RATIOS, group.toolbar.model) || DEFAULT_ASPECT_RATIOS;
                      const supportedQualities = findModelConfig(MODEL_QUALITIES, group.toolbar.model) || DEFAULT_QUALITIES;
                      return (
                    <div className="flex items-center gap-2">
                      <select
                        className={`flex-1 text-sm px-2.5 py-1.5 rounded-lg border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-[#1f1f1f] border-white/[0.14] text-[#ddd]'}`}
                        value={group.toolbar.aspectRatio}
                        onChange={(e) => {
                          const newAr = e.target.value;
                          const newSize = calculateActualPixels(newAr, group.toolbar.quality, group.toolbar.model);
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, toolbar: { ...g.toolbar, aspectRatio: newAr, size: newSize } } : g
                          ));
                        }}
                      >
                        {supportedRatios.map(r => (
                          <option key={r} value={r}>{r} ({calculateActualPixels(r, group.toolbar.quality, group.toolbar.model)})</option>
                        ))}
                      </select>
                      <select
                        className={`text-sm px-2.5 py-1.5 rounded-lg border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-[#1f1f1f] border-white/[0.14] text-[#ddd]'}`}
                        value={group.toolbar.quality}
                        onChange={(e) => {
                          const newQ = e.target.value;
                          const newSize = calculateActualPixels(group.toolbar.aspectRatio, newQ, group.toolbar.model);
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, toolbar: { ...g.toolbar, quality: newQ, size: newSize } } : g
                          ));
                        }}
                      >
                        {supportedQualities.map(q => (
                          <option key={q} value={q}>{QUALITY_DISPLAY_NAMES[q] || q} ({calculateActualPixels(group.toolbar.aspectRatio, q, group.toolbar.model)})</option>
                        ))}
                      </select>
                      <select
                        className={`text-sm px-2.5 py-1.5 rounded-lg border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-[#1f1f1f] border-white/[0.14] text-[#ddd]'}`}
                        value={group.toolbar.outputCount || group.toolbar.n || 1}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setGenGroups(prev => prev.map(g =>
                            g.id === group.id ? { ...g, toolbar: { ...g.toolbar, outputCount: val, n: val } } : g
                          ));
                        }}
                      >
                        {[1,2,3,4].map(n => (
                          <option key={n} value={n}>{n}张</option>
                        ))}
                      </select>
                    </div>
                    );
                    })()}

                    {/* Row 2.5: Per-image reference category settings are now shown on each image label */}

                    {/* Row 3: Prompt textarea with resize handle */}
                    <div className="relative">
                      <textarea
                        className={`w-full text-sm px-3 py-2 pr-10 rounded-lg border resize-y min-h-[60px] max-h-[160px] ${isMonochrome ? 'bg-white border-gray-200 text-gray-700 placeholder:text-gray-400 focus:ring-blue-400/30' : 'bg-[#1f1f1f] border-white/[0.14] text-[#ddd] placeholder:text-[#666] focus:ring-[#d4af37]/30'} focus:outline-none focus:ring-2 transition-all`}
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
                            e.preventDefault();
                            handleGenGroupGenerate(group.id);
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
                        className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${isMonochrome ? 'bg-blue-50 hover:bg-blue-100 text-blue-600' : 'bg-[#252525] hover:bg-[#282828]/85 text-[#aaa]'}`}
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
                        className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isMonochrome ? 'bg-blue-50 hover:bg-blue-100 text-blue-500' : 'bg-[#252525] hover:bg-[#282828]/85 text-[#888]'}`}
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
            className="absolute border border-[#d4af37]/50 bg-[#d4af37]/10 z-30 pointer-events-none"
            style={{
              left: Math.min(boxSelectStart.x, boxSelectEnd.x) - (canvasRef.current?.getBoundingClientRect().left || 0),
              top: Math.min(boxSelectStart.y, boxSelectEnd.y) - (canvasRef.current?.getBoundingClientRect().top || 0),
              width: Math.abs(boxSelectEnd.x - boxSelectStart.x),
              height: Math.abs(boxSelectEnd.y - boxSelectStart.y),
            }}
          />
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
                  className="absolute border-2 border-[#d4af37] bg-[#d4af37]/10"
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
                  <div className="absolute left-1/3 top-0 bottom-0 border-l border-[#d4af37]/40" />
                  <div className="absolute left-2/3 top-0 bottom-0 border-l border-[#d4af37]/40" />
                  <div className="absolute top-1/3 left-0 right-0 border-t border-[#d4af37]/40" />
                  <div className="absolute top-2/3 left-0 right-0 border-t border-[#d4af37]/40" />
                  <div className={`absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'}`}>
                    {Math.round(cropRect.w / zoom)} x {Math.round(cropRect.h / zoom)}
                  </div>
                  {/* Corner drag handles */}
                  {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
                    <div
                      key={c}
                      className={`absolute w-3 h-3 rounded-full cursor-nwse-resize ${isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]'}`}
                      style={{
                        [c.includes('t') ? 'top' : 'bottom']: '-6px',
                        [c.includes('l') ? 'left' : 'right']: '-6px',
                        cursor: c === 'tl' || c === 'br' ? 'nwse-resize' : 'nesw-resize',
                      }}
                    />
                  ))}
                </div>
              )}
              {/* Processing overlay */}
              {isEditProcessing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50 pointer-events-auto">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
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
                <ZoomIn size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
                <span className={panelLabelClass}>HD 高清放大</span>
                <div className={panelDividerClass} />
                {/* Original size display */}
                <span className={`text-xs tabular-nums ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>
                  {isSizeLoaded ? `${origW}×${origH}` : '...'}
                </span>
                <div className={panelDividerClass} />
                {/* Resolution preset dropdown */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowUpscalePresetMenu(!showUpscalePresetMenu); }}
                    className={`px-2.5 py-1 text-xs rounded-md transition-all flex items-center gap-1 font-semibold ${
                      isMonochrome ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-[#252525] text-[#ccc] hover:bg-[#282828]/85'
                    }`}
                  >
                    {upscalePreset === '2k' ? '2×' : upscalePreset === '4k' ? '4×' : '8×'}
                    <ChevronDown size={10} />
                  </button>
                  {showUpscalePresetMenu && (
                    <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 min-w-[100px] ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a]/85 border-white/[0.12]'}`}>
                      {(['2k', '4k', '8k'] as const).map(p => {
                        const pMul = p === '2k' ? 2 : p === '4k' ? 4 : 8;
                        const pTarget = getUpscaleTargetDimensions(origW, origH, p);
                        return (
                          <button key={p} onClick={(e) => { e.stopPropagation(); setUpscalePreset(p); setShowUpscalePresetMenu(false); }} className={`w-full px-3 py-1.5 text-xs text-left flex items-center justify-between ${isMonochrome ? 'hover:bg-blue-50' : 'hover:bg-[#d4af37]/10'} ${upscalePreset === p ? (isMonochrome ? 'text-blue-600' : 'text-[#d4af37]') : isMonochrome ? 'text-gray-600' : 'text-[#ccc]'}`}>
                            <span>{pMul}× <span className="opacity-60 ml-1">{pTarget.w}×{pTarget.h}</span></span>
                            {upscalePreset === p && <span className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={panelDividerClass} />
                {/* Target dimensions */}
                <span className={`text-xs tabular-nums font-semibold ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>
                  {isSizeLoaded ? `${targetDim.w}×${targetDim.h}` : '...'}
                </span>
                <div className={panelDividerClass} />
                {/* Execute button */}
                <button
                  onClick={handleUpscaleConfirm}
                  disabled={targetDim.multiplier <= 1}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                    targetDim.multiplier <= 1
                      ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-[#555] cursor-not-allowed'
                      : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-95' : 'bg-[#d4af37] text-black hover:bg-[#e5c047] active:scale-95'
                  }`}
                  title="开始放大"
                >
                  <Sparkles size={14} />
                </button>
                <button onClick={exitEditMode} className={panelCancelBtnClass}>取消</button>
              </div>
              <div className="text-center mt-1">
                <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>Esc 退出</span>
              </div>
            </div>
          );
        })()}

        {/* ====== SVG智能描摹 FLOATING PANEL ====== */}
        {editMode === 'svg-trace' && (() => {
          const editImg = images.find(i => i.id === editImageId);
          if (!editImg) return null;
          const imgOrigW = editImg.originalWidth || Math.round(editImg.width);
          const imgOrigH = editImg.originalHeight || Math.round(editImg.height);
          const pos = getToolbarPosition();

          const svgTraceModes = [
            { key: 'color' as const, label: '彩色矢量化', icon: <Palette size={14} />, desc: 'Sharp + VTracer', accent: '#d4af37' },
            { key: 'bw' as const, label: '黑白描摹', icon: <Contrast size={14} />, desc: 'ImageMagick + Potrace', accent: '#9ca3af' },
            { key: 'compress' as const, label: '图片压缩', icon: <Minimize2 size={14} />, desc: 'Sharp', accent: '#60a5fa' },
            { key: 'thumbnail' as const, label: '缩略图生成', icon: <Frame size={14} />, desc: 'Sharp', accent: '#34d399' },
          ];
          const activeAccent = svgTraceModes.find(m => m.key === svgTraceMode)?.accent || '#d4af37';

          return (
            <div
              className="absolute z-50 pointer-events-auto"
              data-toolbar="svg-trace"
              style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div
                className="flex flex-col items-stretch gap-2.5 p-3 min-w-[280px] max-w-[320px] rounded-xl border shadow-2xl"
                style={{ background: 'rgba(20,20,20,0.85)', borderColor: `${activeAccent}40`, borderWidth: '1px' }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center gap-2">
                  <PenTool size={14} style={{ color: activeAccent }} />
                  <span className="text-xs font-semibold" style={{ color: activeAccent }}>SVG智能描摹</span>
                  <span className="text-xs ml-auto text-gray-500">Esc 退出</span>
                </div>

                {/* Mode selector */}
                <div className="grid grid-cols-2 gap-1.5">
                  {svgTraceModes.map(m => (
                    <button
                      key={m.key}
                      onClick={(e) => { e.stopPropagation(); setSvgTraceMode(m.key); }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-left"
                      style={{
                        background: svgTraceMode === m.key ? `${m.accent}15` : '#111',
                        borderColor: svgTraceMode === m.key ? m.accent : '#333',
                        color: svgTraceMode === m.key ? m.accent : '#777',
                      }}
                    >
                      <span style={{ color: svgTraceMode === m.key ? m.accent : '#555' }}>{m.icon}</span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-medium leading-tight truncate">{m.label}</span>
                        <span className="text-[9px] leading-tight text-gray-600 truncate">{m.desc}</span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Source image info */}
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs" style={{ background: '#111', color: '#555' }}>
                  <ImageIcon size={12} />
                  <span>原图 {imgOrigW}×{imgOrigH}</span>
                </div>

                {/* Mode-specific options */}
                {svgTraceMode === 'color' && (
                  <div className="flex flex-col gap-2">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-[#aaa]">质量预设</label>
                        <span className="text-[10px] text-[#777]">调整后自动覆盖参数</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {([
                          { key: 'fast' as const, label: '快速', color: '#4ade80' },
                          { key: 'balanced' as const, label: '均衡', color: '#d4af37' },
                          { key: 'high' as const, label: '精细', color: '#f97316' },
                          { key: 'max' as const, label: '极致', color: '#ef4444' },
                        ]).map(p => (
                          <button key={p.key}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSvgTraceQualityPreset(p.key);
                              setSvgTraceColorPrecision(null);
                              setSvgTraceFilterSpeckle(null);
                              setSvgTraceCornerThreshold(null);
                              setSvgTraceLengthThreshold(null);
                              setSvgTraceCurveMode(null);
                              setSvgTraceHierarchical(null);
                            }}
                            className="py-1 rounded text-[10px] font-medium border transition-all"
                            style={{
                              background: svgTraceQualityPreset === p.key ? `${p.color}20` : '#111',
                              borderColor: svgTraceQualityPreset === p.key ? p.color : '#333',
                              color: svgTraceQualityPreset === p.key ? p.color : '#555',
                            }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Curve mode toggle */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-[#aaa]">曲线模式</label>
                      <div className="flex items-center gap-1 ml-auto">
                        {(['polygon', 'spline'] as const).map(cm => (
                          <button key={cm}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSvgTraceCurveMode(svgTraceCurveMode === cm ? null : cm);
                            }}
                            className="px-2 py-0.5 rounded text-[10px] border transition-all"
                            style={{
                              background: (svgTraceCurveMode ?? (svgTraceQualityPreset === 'high' || svgTraceQualityPreset === 'max' ? 'spline' : 'polygon')) === cm ? '#d4af3720' : '#111',
                              borderColor: (svgTraceCurveMode ?? (svgTraceQualityPreset === 'high' || svgTraceQualityPreset === 'max' ? 'spline' : 'polygon')) === cm ? '#d4af37' : '#333',
                              color: (svgTraceCurveMode ?? (svgTraceQualityPreset === 'high' || svgTraceQualityPreset === 'max' ? 'spline' : 'polygon')) === cm ? '#d4af37' : '#555',
                            }}
                          >
                            {cm === 'polygon' ? '折线' : '曲线'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Hierarchical toggle */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-[#aaa]">分层策略</label>
                      <div className="flex items-center gap-1 ml-auto">
                        {(['stacked', 'cutout'] as const).map(h => (
                          <button key={h}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSvgTraceHierarchical(svgTraceHierarchical === h ? null : h);
                            }}
                            className="px-2 py-0.5 rounded text-[10px] border transition-all"
                            style={{
                              background: (svgTraceHierarchical ?? (svgTraceQualityPreset === 'max' ? 'cutout' : 'stacked')) === h ? '#d4af3720' : '#111',
                              borderColor: (svgTraceHierarchical ?? (svgTraceQualityPreset === 'max' ? 'cutout' : 'stacked')) === h ? '#d4af37' : '#333',
                              color: (svgTraceHierarchical ?? (svgTraceQualityPreset === 'max' ? 'cutout' : 'stacked')) === h ? '#d4af37' : '#555',
                            }}
                          >
                            {h === 'stacked' ? '叠加' : '剪切'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Fine-tuning sliders (override preset values) */}
                    <div className="border-t border-white/[0.12] pt-2 mt-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-[#666]">精细调节（覆盖预设值）</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-[#888]">颜色精度</label>
                        <span className={`text-xs tabular-nums font-mono ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`}>{svgTraceColorPrecision ?? (svgTraceQualityPreset === 'fast' ? 6 : svgTraceQualityPreset === 'balanced' ? 8 : svgTraceQualityPreset === 'high' ? 10 : 12)}bit</span>
                      </div>
                      <input type="range" min={2} max={12} step={1} value={svgTraceColorPrecision ?? (svgTraceQualityPreset === 'fast' ? 6 : svgTraceQualityPreset === 'balanced' ? 8 : svgTraceQualityPreset === 'high' ? 10 : 12)}
                        onChange={e => setSvgTraceColorPrecision(Number(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        className="w-full h-1 accent-blue-500 cursor-pointer" />
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-[#888]">去斑</label>
                        <span className={`text-xs tabular-nums font-mono ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`}>{svgTraceFilterSpeckle ?? (svgTraceQualityPreset === 'fast' ? 12 : svgTraceQualityPreset === 'balanced' ? 6 : svgTraceQualityPreset === 'high' ? 4 : 2)}px</span>
                      </div>
                      <input type="range" min={0} max={20} step={1} value={svgTraceFilterSpeckle ?? (svgTraceQualityPreset === 'fast' ? 12 : svgTraceQualityPreset === 'balanced' ? 6 : svgTraceQualityPreset === 'high' ? 4 : 2)}
                        onChange={e => setSvgTraceFilterSpeckle(Number(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        className="w-full h-1 accent-blue-500 cursor-pointer" />
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-[#888]">角点阈值</label>
                        <span className={`text-xs tabular-nums font-mono ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`}>{svgTraceCornerThreshold ?? (svgTraceQualityPreset === 'fast' ? 1 : svgTraceQualityPreset === 'balanced' ? 1 : svgTraceQualityPreset === 'high' ? 1 : 1)}</span>
                      </div>
                      <input type="range" min={0} max={5} step={0.1} value={svgTraceCornerThreshold ?? (svgTraceQualityPreset === 'fast' ? 1 : svgTraceQualityPreset === 'balanced' ? 1 : svgTraceQualityPreset === 'high' ? 1 : 1)}
                        onChange={e => setSvgTraceCornerThreshold(Number(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        className="w-full h-1 accent-blue-500 cursor-pointer" />
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-[#888]">长度阈值</label>
                        <span className={`text-xs tabular-nums font-mono ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`}>{svgTraceLengthThreshold ?? (svgTraceQualityPreset === 'fast' ? 10 : svgTraceQualityPreset === 'balanced' ? 6 : svgTraceQualityPreset === 'high' ? 4 : 2)}</span>
                      </div>
                      <input type="range" min={1} max={20} step={1} value={svgTraceLengthThreshold ?? (svgTraceQualityPreset === 'fast' ? 10 : svgTraceQualityPreset === 'balanced' ? 6 : svgTraceQualityPreset === 'high' ? 4 : 2)}
                        onChange={e => setSvgTraceLengthThreshold(Number(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        className="w-full h-1 accent-blue-500 cursor-pointer" />
                    </div>
                  </div>
                )}

                {svgTraceMode === 'bw' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[#aaa]">二值化阈值</label>
                      <span className="text-xs tabular-nums font-mono text-[#9ca3af]">{svgTraceBwThreshold}%</span>
                    </div>
                    <input type="range" min={10} max={90} step={5} value={svgTraceBwThreshold}
                      onChange={e => setSvgTraceBwThreshold(Number(e.target.value))}
                      onClick={e => e.stopPropagation()}
                      className="w-full h-1 accent-[#9ca3af] cursor-pointer" />
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[#aaa]">去斑大小</label>
                      <span className="text-xs tabular-nums font-mono text-[#9ca3af]">{svgTraceBwTurdSize}px</span>
                    </div>
                    <input type="range" min={1} max={50} step={1} value={svgTraceBwTurdSize}
                      onChange={e => setSvgTraceBwTurdSize(Number(e.target.value))}
                      onClick={e => e.stopPropagation()}
                      className="w-full h-1 accent-[#9ca3af] cursor-pointer" />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSvgTraceBwInvert(!svgTraceBwInvert); }}
                        className="px-2.5 py-1 rounded text-xs border transition-all"
                        style={{
                          background: svgTraceBwInvert ? '#333' : '#111',
                          borderColor: svgTraceBwInvert ? '#555' : '#333',
                          color: svgTraceBwInvert ? '#ccc' : '#555',
                        }}
                      >
                        反色输出
                      </button>
                      <span className="text-[10px] text-gray-600">
                        {svgTraceBwInvert ? '白底黑线→黑底白线' : '黑线白底'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[#aaa]">透明度阈值</label>
                      <span className="text-xs tabular-nums font-mono text-[#9ca3af]">{svgTraceBwAlphaMax}%</span>
                    </div>
                    <input type="range" min={0} max={100} step={5} value={svgTraceBwAlphaMax}
                      onChange={e => setSvgTraceBwAlphaMax(Number(e.target.value))}
                      onClick={e => e.stopPropagation()}
                      className="w-full h-1 accent-[#9ca3af] cursor-pointer" />
                  </div>
                )}

                {svgTraceMode === 'compress' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[#aaa]">压缩质量</label>
                      <span className="text-xs tabular-nums font-mono text-[#60a5fa]">{svgTraceCompressQuality}%</span>
                    </div>
                    <input type="range" min={10} max={100} step={5} value={svgTraceCompressQuality}
                      onChange={e => setSvgTraceCompressQuality(Number(e.target.value))}
                      onClick={e => e.stopPropagation()}
                      className="w-full h-1 accent-[#60a5fa] cursor-pointer" />
                    <div className="flex items-center gap-1.5">
                      {(['webp', 'jpeg', 'png'] as const).map(fmt => (
                        <button key={fmt}
                          onClick={(e) => { e.stopPropagation(); setSvgTraceCompressFormat(fmt); }}
                          className="px-2.5 py-1 rounded text-xs border transition-all uppercase"
                          style={{
                            background: svgTraceCompressFormat === fmt ? '#60a5fa15' : '#111',
                            borderColor: svgTraceCompressFormat === fmt ? '#60a5fa' : '#333',
                            color: svgTraceCompressFormat === fmt ? '#60a5fa' : '#555',
                          }}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {svgTraceMode === 'thumbnail' && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-[#aaa]">宽度</label>
                        <input type="number" min={16} max={4096} value={svgTraceThumbWidth}
                          onChange={e => setSvgTraceThumbWidth(Math.max(16, Number(e.target.value)))}
                          onClick={e => e.stopPropagation()}
                          className="w-full mt-1 px-2 py-1 rounded text-xs tabular-nums border bg-[#1a1a1a]/80 border-white/[0.12] text-[#ccc]" />
                      </div>
                      <div>
                        <label className="text-xs text-[#aaa]">高度</label>
                        <input type="number" min={16} max={4096} value={svgTraceThumbHeight}
                          onChange={e => setSvgTraceThumbHeight(Math.max(16, Number(e.target.value)))}
                          onClick={e => e.stopPropagation()}
                          className="w-full mt-1 px-2 py-1 rounded text-xs tabular-nums border bg-[#1a1a1a]/80 border-white/[0.12] text-[#ccc]" />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(['cover', 'contain', 'fill', 'inside'] as const).map(fit => (
                        <button key={fit}
                          onClick={(e) => { e.stopPropagation(); setSvgTraceThumbFit(fit); }}
                          className="px-2 py-1 rounded text-xs border transition-all"
                          style={{
                            background: svgTraceThumbFit === fit ? '#34d39915' : '#111',
                            borderColor: svgTraceThumbFit === fit ? '#34d399' : '#333',
                            color: svgTraceThumbFit === fit ? '#34d399' : '#555',
                          }}
                        >
                          {fit === 'cover' ? '覆盖' : fit === 'contain' ? '包含' : fit === 'fill' ? '填充' : '适应'}
                        </button>
                      ))}
                    </div>
                    {/* Quick size presets */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {[
                        { label: '128', w: 128, h: 128 },
                        { label: '256', w: 256, h: 256 },
                        { label: '512', w: 512, h: 512 },
                        { label: '1024', w: 1024, h: 1024 },
                        { label: '同比例', w: 0, h: 0 },
                      ].map(p => (
                        <button key={p.label}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (p.w === 0) {
                              const scale = Math.min(256 / imgOrigW, 256 / imgOrigH, 1);
                              setSvgTraceThumbWidth(Math.round(imgOrigW * scale));
                              setSvgTraceThumbHeight(Math.round(imgOrigH * scale));
                            } else {
                              setSvgTraceThumbWidth(p.w);
                              setSvgTraceThumbHeight(p.h);
                            }
                          }}
                          className="px-2 py-0.5 rounded text-[10px] border transition-all"
                          style={{ borderColor: '#333', background: '#111', color: '#666' }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSvgTraceConfirm(); }}
                    disabled={isEditProcessing}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98]"
                    style={{
                      background: isEditProcessing ? '#333' : activeAccent,
                      color: isEditProcessing ? '#555' : '#000',
                      cursor: isEditProcessing ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isEditProcessing ? '处理中...' : svgTraceModes.find(m => m.key === svgTraceMode)?.label || '开始'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); exitEditMode(); }}
                    className="px-3 py-1.5 rounded-lg text-xs border transition-all"
                    style={{ background: 'rgba(34,34,34,0.80)', color: '#999', borderColor: '#444' }}
                  >
                    取消
                  </button>
                </div>
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
                className={`relative rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-300' : 'bg-[#1a1a1a]/85 border-white/[0.14]'}`}
                style={{ width: winW, height: winH, cursor: 'default' }}
              >
                {/* Title bar */}
                <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isMonochrome ? 'border-gray-200 bg-white' : 'border-white/[0.14] bg-[#1a1a1a]/80'}`}>
                  <div className="flex items-center gap-2">
                    {isErase ? <Paintbrush size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} /> : <Wand2 size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />}
                    <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>
                      {isErase ? '擦除' : '蒙版修图'}
                    </span>
                    <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>
                      涂抹区域后点击&apos;开始修复&apos; · Shift+左键擦除涂抹
                    </span>
                  </div>
                  <button onClick={exitEditMode} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50' : 'text-[#666] hover:text-white hover:bg-[#282828]/85'}`}>
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
                      <img
                        src={editImg.url}
                        alt="edit"
                        className="w-full h-full object-contain select-none"
                        draggable={false}
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
                    <div className={`absolute bottom-3 left-3 flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${isMonochrome ? 'bg-white/80 text-gray-600' : 'bg-[#1a1a1a]/80 text-[#999]'}`} style={{ cursor: 'default' }}>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(z => Math.max(0.25, z / 1.2)); }} className="p-0.5 hover:text-[#d4af37]"><Minus size={12} /></button>
                      <span className="w-10 text-center tabular-nums">{Math.round(editCanvasZoom * 100)}%</span>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(z => Math.min(5, z * 1.2)); }} className="p-0.5 hover:text-[#d4af37]"><Plus size={12} /></button>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(1); setEditCanvasPan({ x: 0, y: 0 }); }} className="p-0.5 hover:text-[#d4af37]"><Maximize2 size={12} /></button>
                    </div>
                    </div>

                  {/* Right: Sidebar controls */}
                  <div className={`flex flex-col border-l ${isMonochrome ? 'border-gray-200 bg-white' : 'border-white/[0.14] bg-[#1a1a1a]/80'}`} style={{ width: sidebarW }}>
                    {/* Brush mode toggle */}
                    <div className="px-3 pt-3 pb-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditBrushMode('brush')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-all ${
                            editBrushMode === 'brush'
                              ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-[#d4af37] text-black font-medium'
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
                              ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-[#d4af37] text-black font-medium'
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
                        <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>画笔大小</span>
                        <span className={`text-xs tabular-nums ${isMonochrome ? 'text-gray-600' : 'text-[#ccc]'}`}>{brushSize}px</span>
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
                        <span className={`text-xs mb-1.5 block ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>擦除引擎</span>
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
                                  ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-[#d4af37] text-black font-medium'
                                  : isMonochrome
                                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    : 'bg-[#252525] text-[#999] hover:bg-[#282828]/85'
                              }`}
                            >
                              <span className="font-medium">{m.label}</span>
                              <span className={`text-[10px] ${eraseModelId === m.id ? 'text-black/60' : isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{m.desc}</span>
                              {m.recommended && (
                                <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full ${
                                  eraseModelId === m.id
                                    ? 'bg-black/20 text-black/70'
                                    : isMonochrome
                                      ? 'bg-gray-200 text-gray-500'
                                      : 'bg-[#333] text-[#888]'
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
                        <span className={`text-xs mb-1 block ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>修复提示词 (可选)</span>
                        <textarea
                          value={maskKeyword}
                          onChange={(e) => setMaskKeyword(e.target.value)}
                          placeholder="描述修复内容..."
                          rows={3}
                          className={`w-full px-2.5 py-2 text-xs rounded-xl border resize-none ${
                            isMonochrome
                              ? 'bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30'
                              : 'bg-[#0a0a0a]/90 border-white/[0.14] text-white placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30'
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
                            ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-[#555] cursor-not-allowed'
                            : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.98]' : 'bg-[#d4af37] text-black hover:bg-[#e5c047] active:scale-[0.98]'
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
              <div className={`relative rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-300' : 'bg-[#1a1a1a]/85 border-white/[0.14]'}`} style={{ width: 420, maxHeight: '80vh' }}>
                {/* Title */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isMonochrome ? 'border-gray-200 bg-white' : 'border-white/[0.14] bg-[#1a1a1a]/80'}`}>
                  <div className="flex items-center gap-2">
                    <Eraser size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
                    <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>选择去背景模型</span>
                  </div>
                  <button onClick={() => setShowRemoveBgPicker(false)} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50' : 'text-[#666] hover:text-white hover:bg-[#282828]/85'}`}>
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
                          ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
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
                                  : 'bg-[#333] text-[#888]'
                            }`}>推荐</span>
                          )}
                        </div>
                        <div className={`text-[11px] mt-0.5 ${removeBgModelId === m.id ? 'text-black/60' : isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>
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
                <div className={`px-4 py-3 border-t ${isMonochrome ? 'border-gray-200 bg-white' : 'border-white/[0.14] bg-[#1a1a1a]/80'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>当前选择:</span>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>
                      {removeBgModels.find(m => m.id === removeBgModelId)?.label || removeBgModelId}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setShowRemoveBgPicker(false);
                      handleRemoveBackground();
                    }}
                    className={`w-full py-2.5 text-sm font-semibold rounded-xl active:scale-[0.98] transition-all ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c047]'}`}
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
                  <Expand size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
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
                  <span className="text-xs text-[#888] whitespace-nowrap">
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
                        ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-[#555] cursor-not-allowed'
                        : isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c047]'
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
                  <Scissors size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
                  <span className={panelLabelClass}>裁切</span>
                  <div className={panelDividerClass} />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCropRatio('free')}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        cropRatio === 'free'
                          ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-[#d4af37] text-black font-medium'
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
                            ? isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-[#d4af37] text-black font-medium'
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
                        <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a]/85 border-white/[0.12]'}`}>
                          {ratioOptions.slice(4).map(r => (
                            <button key={r} onClick={(e) => { e.stopPropagation(); setCropRatio(r); setShowCropRatios(false); }} className={`w-full px-3 py-1.5 text-xs text-left hover:bg-[#d4af37]/10 ${cropRatio === r ? 'text-[#d4af37]' : isMonochrome ? 'text-gray-600' : 'text-[#ccc]'}`}>
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
                <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>Esc 退出</span>
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
                    <RotateCcw size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
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

                <div className={`grid grid-cols-2 gap-1 p-1 rounded-xl ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]/80'}`}>
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
                          : isMonochrome ? 'text-blue-500 hover:text-blue-700' : 'text-[#888] hover:text-white'
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
                        <div className="absolute inset-0 rounded-lg overflow-hidden border-2 border-blue-400/60 shadow-[0_0_20px_rgba(59,130,246,0.3)]" style={{ transform: 'translateZ(55px)', backfaceVisibility: 'hidden' }}>
                          <img src={selectedImageData.url} alt="front" className="w-full h-full object-cover" />
                        </div>
                        {/* Back face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-200 border-gray-300' : 'bg-[#1a1a1a]/85 border-white/[0.12]'}`} style={{ transform: 'rotateY(180deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#555]'}`}>背面</span>
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
                      <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs ${isMonochrome ? 'bg-white/80 text-gray-500 border border-gray-200' : 'bg-black/60 text-[#aaa] border border-white/10'}`}>
                        {Math.abs(multiAngleRotation) < 10 && Math.abs(multiAngleTilt) < 10 ? '正面' :
                         multiAngleRotation > 45 ? '左侧' : multiAngleRotation < -45 ? '右侧' :
                         multiAngleTilt > 35 ? '仰视' : multiAngleTilt < -15 ? '俯视' : '斜视'}
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

                <div className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${isMonochrome ? 'bg-gray-50 text-gray-500' : 'bg-[#0a0a0a]/90 text-[#888]'}`}>
                  {multiAngleMode === 'image'
                    ? '主体模式：拖动立方体或调整滑块设定角度，AI 会推断隐藏侧面并生成转角后的摄影棚图。'
                    : '摄像头模式：拖动球体或调整滑块设定视角，AI 会移动虚拟相机生成新机位、俯仰和推进效果。'}
                </div>

                {([
                  { label: '旋转', value: multiAngleRotation, min: -90, max: 90, step: 1, onChange: setMultiAngleRotation },
                  { label: multiAngleMode === 'camera' ? '俯仰' : '倾斜', value: multiAngleTilt, min: -30, max: 60, step: 1, onChange: setMultiAngleTilt },
                ]).map(item => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={panelLabelClass}>{item.label}</span>
                      <span className={panelSmallLabelClass}>{item.value}°</span>
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
                            ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              : 'bg-[#1a1a1a]/85 text-[#888] hover:bg-[#222]/80'
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
                  <Download size={14} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
                  <span className={panelLabelClass}>下载</span>
                </div>

                {/* Format Selection */}
                <div className="flex flex-col gap-1">
                  {[
                    { format: 'png' as const, label: 'PNG 格式', desc: '位图格式，无损画质' },
                    { format: 'svg' as const, label: 'SVG 格式', desc: '矢量图形，可无损缩放' },
                    { format: 'psd' as const, label: 'PSD 格式', desc: 'Photoshop 分层文件' },
                    ...(selectedImageData?.threeDModelUrl ? [{ format: '3d' as const, label: '3D 模型', desc: '下载3D模型文件' }] : []),
                  ].map(item => (
                    <button
                      key={item.format}
                      onClick={() => setDownloadFormat(item.format)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg transition-all text-left ${
                        downloadFormat === item.format
                          ? (isMonochrome ? 'bg-blue-50 border border-blue-200' : 'bg-[#d4af37]/10 border border-[#d4af37]/30')
                          : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-gray-100' : 'bg-[#1a1a1a]/80 hover:bg-[#1a1a1a]/85 border border-white/[0.14]')
                      }`}
                    >
                      <div>
                        <div className={`text-xs font-medium ${isMonochrome ? 'text-gray-800' : 'text-white'}`}>{item.label}</div>
                        <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{item.desc}</div>
                      </div>
                      {downloadFormat === item.format && <Check size={12} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />}
                    </button>
                  ))}
                </div>

                {/* SVG Mode Selection */}
                {downloadFormat === 'svg' && (
                  <div className={`flex flex-col gap-1 pt-1 border-t ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>矢量化模式</span>
                    {([
                      { mode: 'pro' as const, label: 'Pro', desc: '分组优化，32色' },
                      { mode: 'studio' as const, label: 'Studio', desc: '形状识别+高级分组，48色' },
                    ]).map(item => (
                      <button
                        key={item.mode}
                        onClick={() => setSvgMode(item.mode)}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all text-left ${
                          svgMode === item.mode
                            ? (isMonochrome ? 'bg-blue-50 border border-blue-200' : 'bg-[#d4af37]/10 border border-[#d4af37]/30')
                            : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-transparent' : 'bg-[#1a1a1a]/80 hover:bg-[#1a1a1a]/85 border border-transparent')
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>{item.label}</span>
                          <span className={`text-xs ml-1.5 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{item.desc}</span>
                        </div>
                        {svgMode === item.mode && <Check size={10} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />}
                      </button>
                    ))}
                  </div>
                )}

                {/* PSD Mode Selection */}
                {downloadFormat === 'psd' && (
                  <div className={`flex flex-col gap-1 pt-1 border-t ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>分层模式</span>
                    {([
                      { mode: 'pro' as const, label: 'Pro', desc: '元素级分割+语义命名' },
                      { mode: 'studio' as const, label: 'Studio', desc: '阴影+分组+质量评分' },
                    ]).map(item => (
                      <button
                        key={item.mode}
                        onClick={() => setPsdMode(item.mode)}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all text-left ${
                          psdMode === item.mode
                            ? (isMonochrome ? 'bg-blue-50 border border-blue-200' : 'bg-[#d4af37]/10 border border-[#d4af37]/30')
                            : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-transparent' : 'bg-[#1a1a1a]/80 hover:bg-[#1a1a1a]/85 border border-transparent')
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>{item.label}</span>
                          <span className={`text-xs ml-1.5 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{item.desc}</span>
                        </div>
                        {psdMode === item.mode && <Check size={10} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />}
                      </button>
                    ))}
                  </div>
                )}

                {/* 3D Format Selection */}
                {downloadFormat === '3d' && selectedImageData?.threeDModelUrls && Object.keys(selectedImageData.threeDModelUrls).length > 0 && (
                  <div className={`flex flex-col gap-1 pt-1 border-t ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>模型格式</span>
                    {Object.entries(selectedImageData.threeDModelUrls).map(([format, url]) => (
                      <button
                        key={format}
                        onClick={() => setThreeDDownloadFormat(format)}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all text-left ${
                          threeDDownloadFormat === format
                            ? (isMonochrome ? 'bg-blue-50 border border-blue-200' : 'bg-[#d4af37]/10 border border-[#d4af37]/30')
                            : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-transparent' : 'bg-[#1a1a1a]/80 hover:bg-[#1a1a1a]/85 border border-transparent')
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-medium uppercase ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>{format}</span>
                          <span className={`text-xs ml-1.5 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{format === 'glb' ? 'glTF二进制格式' : format === 'obj' ? 'Wavefront格式' : format === 'stl' ? '3D打印格式' : format === 'fbx' ? 'Autodesk格式' : format === 'usdz' ? 'Apple AR格式' : '3D模型文件'}</span>
                        </div>
                        {threeDDownloadFormat === format && <Check size={10} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Progress */}
                {downloadProgress && (
                  <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]/80'}`}>
                    <div className="w-3 h-3 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
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
        {show3DModal && selectedImageData && (() => {
          const providers = getThreeDProviders();
          return (
            <div
              className="fixed inset-0 z-[998] flex items-center justify-center bg-black/60 backdrop-blur-sm"
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
              <div className={`w-[520px] max-h-[86vh] overflow-hidden rounded-2xl border shadow-2xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a]/80 border-white/[0.14]'}`}>
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                  <div className="flex items-center gap-2">
                    <Box size={16} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
                    <div>
                      <div className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>一键转 3D</div>
                      <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#777]'}`}>API 大模型 / 本地模型双后端，结果会在当前图片右侧生成</div>
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

                <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
                  {/* Source image thumbnail - larger display */}
                  <div className={`rounded-2xl overflow-hidden flex items-center justify-center p-3 ${isMonochrome ? 'bg-gray-50' : 'bg-[#0a0a0a]/90'}`}>
                    <img src={selectedImageData.url} alt="3D source" className="max-w-full max-h-[200px] object-contain rounded-lg" />
                  </div>

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
                            ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
                            : isMonochrome ? 'text-blue-500 hover:text-blue-700' : 'text-[#777] hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

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
                          // Separate admin and third-party providers
                          const adminProviders = providers.filter(p => p.id.startsWith('admin-3d::'));
                          const thirdPartyProviders = providers.filter(p => !p.id.startsWith('admin-3d::'));
                          const groups: Array<{ label: string; items: typeof providers }> = [];
                          if (adminProviders.length > 0) groups.push({ label: '管理员配置', items: adminProviders });
                          if (thirdPartyProviders.length > 0) groups.push({ label: '第三方 API', items: thirdPartyProviders });
                          // If no groups but single list, use name grouping
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
                                return (
                                  <option key={p.id} value={p.id}>{modelLabel}</option>
                                );
                              })}
                            </optgroup>
                          ));
                        })()}
                      </select>
                      {providers.length === 0 && (
                        <div className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-[#d4af37]/10 text-[#d4af37]'}`}>
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

                  {threeDProgress && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${isMonochrome ? 'bg-gray-50 text-gray-600' : 'bg-[#0a0a0a]/90 text-[#aaa]'}`}>
                      <div className="w-3 h-3 rounded-full border-2 border-[#d4af37] border-t-transparent animate-spin" />
                      <span className="text-xs">{threeDProgress}</span>
                    </div>
                  )}
                </div>

                <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                  <button
                    onClick={() => { setShow3DModal(false); setActiveTool('none'); setThreeDProgress(null); }}
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
            onClose={() => { setShow3DViewer(false); setViewer3DModelUrl(''); setViewer3DPreviewUrl(''); setViewer3DModelUrls({}); }}
          />
        )}

        {/* ====== AGENT EDITOR ====== */}
        {showAgentEditor && (
          <Suspense fallback={null}>
            <AgentEditor
              imageUrl={agentEditImage?.url}
              imagePrompt={agentEditImage?.prompt}
              isMonochrome={isMonochrome}
              onApply={(resultUrl: string) => {
                if (agentEditImage) {
                  const updated = images.map(img =>
                    img.id === agentEditImage.id ? { ...img, url: resultUrl } : img
                  );
                  onImagesChange(updated);
                } else {
                  // 没有原图时，将结果作为新图片添加到画布
                  onAddImages?.([resultUrl]);
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
          const netH = layoutRows * cellSize + (layoutRows - 1) * cellGap;
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
                {/* Title bar */}
                <div
                  className="flex items-center justify-between px-4 py-2 select-none cursor-grab active:cursor-grabbing rounded-t-2xl"
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
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={isMonochrome ? "#3b82f6" : "#d4af37"} strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                    <span className="text-sm font-semibold" style={{ color: isMonochrome ? '#3b82f6' : '#d4af37' }}>六面体</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, isCollapsed: !g.isCollapsed } : g));
                      }}
                      title={hcg.isCollapsed ? '展开' : '折叠'}
                    >
                      <svg className="w-4 h-4 transition-transform" style={{ color: isMonochrome ? '#3b82f6' : '#d4af37', transform: hcg.isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <button
                      className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/20 transition-colors"
                      onClick={(e) => { e.stopPropagation(); deleteHexCubeGroup(hcg.id); }}
                      title="关闭"
                    >
                      <svg className="w-3.5 h-3.5" style={{ color: '#ef4444' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
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
                                <img src={faceData.imageUrl} alt={label} className="w-full h-full object-cover" />
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
                                  <img src={frontFace.imageUrl} alt="front" className="w-full h-full object-cover" />
                                ) : (
                                  <div className={`w-full h-full flex items-center justify-center ${isMonochrome ? 'bg-gray-200' : 'bg-[#1a1a1a]/85'}`}>
                                    <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-500' : 'text-[#555]'}`}>前</span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {/* Back face */}
                          {(() => {
                            const backFace = hcg.faces.find(f => f.face === 'back');
                            return (
                              <div className={`absolute inset-0 rounded-lg border flex items-center justify-center overflow-hidden ${isMonochrome ? 'bg-gray-200 border-gray-300' : 'bg-[#1a1a1a]/85 border-white/[0.12]'}`} style={{ transform: 'rotateY(180deg) translateZ(55px)' }}>
                                {backFace?.imageUrl ? (
                                  <img src={backFace.imageUrl} alt="back" className="w-full h-full object-cover" />
                                ) : (
                                  <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-500' : 'text-[#555]'}`}>后</span>
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
                                  <img src={rightFace.imageUrl} alt="right" className="w-full h-full object-cover" />
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
                                  <img src={leftFace.imageUrl} alt="left" className="w-full h-full object-cover" />
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
                                  <img src={topFace.imageUrl} alt="top" className="w-full h-full object-cover" />
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
                                  <img src={bottomFace.imageUrl} alt="bottom" className="w-full h-full object-cover" />
                                ) : (
                                  <span className={`text-xs font-bold ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>下</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {/* 角度提示 */}
                        <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs ${isMonochrome ? 'bg-white/80 text-gray-500 border border-gray-200' : 'bg-black/60 text-[#aaa] border border-white/10'}`}>
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
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${hcg.toolbar.zoom === z ? (isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black') : isMonochrome ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-[#252525] text-[#888] hover:bg-[#282828]/85'}`}
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
                            return hcgModelObj ? `${getModelDisplayName(hcgModelObj.id)} · 来自 ${hcgModelObj.providerName}` : (hcg.toolbar.model ? getModelDisplayName(hcg.toolbar.model) : '选择模型');
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
                                  const newSupportedQualities = findModelConfig(MODEL_QUALITIES, m.id) || DEFAULT_QUALITIES;
                                  const newAspectRatio = newSupportedRatios.includes('1:1') ? '1:1' : newSupportedRatios[0];
                                  const newQuality = newSupportedQualities[0];
                                  const newSize = calculateActualPixels(newAspectRatio, newQuality, m.id);
                                  setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, model: m.id, providerId: m.providerId, providerName: m.providerName, aspectRatio: newAspectRatio, quality: newQuality, size: newSize } } : g));
                                  setOpenModelDropdownGroupId(null);
                                }}
                              >
                                <span>{getModelDisplayName(m.id)} · 来自 {m.providerName}</span>
                                {hcg.toolbar.model === m.id && hcg.toolbar.providerId === m.providerId && (
                                  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill={isMonochrome ? "#3b82f6" : "#d4af37"} stroke="none"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* 比例 */}
                      {(() => {
                        const hcgRatios = findModelConfig(MODEL_ASPECT_RATIOS, hcg.toolbar.model) || DEFAULT_ASPECT_RATIOS;
                        const hcgQualities = findModelConfig(MODEL_QUALITIES, hcg.toolbar.model) || DEFAULT_QUALITIES;
                        return (<>
                      <select
                        className="px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.08)', color: isMonochrome ? '#374151' : '#ccc', border: `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.10)'}` }}
                        value={hcg.toolbar.aspectRatio}
                        onChange={(e) => {
                          const newAr = e.target.value;
                          const newSize = calculateActualPixels(newAr, hcg.toolbar.quality, hcg.toolbar.model);
                          setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, aspectRatio: newAr, size: newSize } } : g));
                        }}
                      >
                        {hcgRatios.map(r => <option key={r} value={r}>{r} ({calculateActualPixels(r, hcg.toolbar.quality, hcg.toolbar.model)})</option>)}
                      </select>
                      {/* 质量 */}
                      <select
                        className="px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.08)', color: isMonochrome ? '#374151' : '#ccc', border: `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.10)'}` }}
                        value={hcg.toolbar.quality}
                        onChange={(e) => {
                          const newQ = e.target.value;
                          const newSize = calculateActualPixels(hcg.toolbar.aspectRatio, newQ, hcg.toolbar.model);
                          setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, toolbar: { ...g.toolbar, quality: newQ, size: newSize } } : g));
                        }}
                      >
                        {hcgQualities.map(q => <option key={q} value={q}>{QUALITY_DISPLAY_NAMES[q] || q} ({calculateActualPixels(hcg.toolbar.aspectRatio, q, hcg.toolbar.model)})</option>)}
                      </select>
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
                              optimizedPrompt = optimizedPrompt
                                .replace(/<think[\s\S]*?<\/think>/gi, '')
                                .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
                                .replace(/【[^】]*】/g, '')
                                .replace(/\*\*[^*]*\*\*/g, '')
                                .trim();
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
                          const faceDescriptions = hcg.faces
                            .filter(f => f.imageUrl)
                            .map(f => `[${CUBE_FACE_LABELS[f.face]}面]`)
                            .join(' ');
                          const fullPrompt = `${faceDescriptions} ${hcg.toolbar.prompt}`;
                          setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'generating', progress: 10 } : g));
                          try {
                            const res = await fetch('/api/generate', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                prompt: fullPrompt,
                                model: hcg.toolbar.model,
                                providerId: hcg.toolbar.providerId,
                                aspectRatio: hcg.toolbar.aspectRatio,
                                quality: hcg.toolbar.quality,
                                n: hcg.toolbar.outputCount,
                                referenceImageUrls: hcg.faces.filter(f => f.imageUrl).map(f => f.imageUrl!),
                              }),
                            });
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
                                      if (onAddImages) onAddImages([pollData.imageUrl]);
                                      setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'completed', resultImageUrl: pollData.imageUrl, progress: 100 } : g));
                                      return;
                                    } else if (pollData.status === 'failed') {
                                      setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, status: 'idle', progress: 0 } : g));
                                      return;
                                    }
                                    setHexCubeGroups(prev => prev.map(g => g.id === hcg.id ? { ...g, progress: Math.min(90, 10 + attempts * 2) } : g));
                                    setTimeout(poll, 2000);
                                  } catch { setTimeout(poll, 3000); }
                                };
                                poll();
                              }
                            } else if (data.imageUrl) {
                              if (onAddImages) onAddImages([data.imageUrl]);
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
        {selectedIds.size === 1 && editMode === 'none' && activeTool === 'none' && !showDownloadPopup && (() => {
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
              <div className={`flex items-center gap-0.5 px-1 py-1 rounded-xl border shadow-xl ${isMonochrome ? 'bg-white/95 border-gray-200' : 'bg-[#1a1a1a]/95 border-[#2a2a2a]'}`}>
                {displayedActions.map((action, idx) => (
                  <div key={action.label} className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); action.action(); }}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        isMonochrome
                          ? 'text-gray-700 hover:bg-gray-50'
                          : 'text-[#aaa] hover:text-[#d4af37] hover:bg-[#252525]'
                      }`}
                      title={action.desc || action.label}
                    >
                      <span className={`${
                        isMonochrome
                          ? action.label === '放大' ? 'text-emerald-500' : action.label === '移除背景' ? 'text-violet-500' : action.label === 'SVG智能描摹' || action.label === 'SVG描摹' ? 'text-pink-500' : action.label === '擦除' ? 'text-orange-500' : action.label === '蒙版' ? 'text-cyan-500' : action.label === '编辑元素' ? 'text-amber-500' : action.label === '扩展' ? 'text-blue-500' : action.label === '图生图' ? 'text-indigo-500' : action.label === '裁切' ? 'text-rose-500' : action.label === '下载' ? 'text-teal-500' : action.label === 'Agent编排' ? 'text-purple-500' : action.label === '语言修图' ? 'text-fuchsia-500' : 'text-blue-500'
                          : ''
                      }`}>{action.icon}</span>
                      <span>{action.label}</span>
                    </button>
                    {idx < displayedActions.length - 1 && <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-px h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} style={{ right: '-1px' }} />}
                  </div>
                ))}
                {/* 折叠/展开按钮 */}
                {hasMoreActions && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setToolbarExpanded(!toolbarExpanded); }}
                    className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isMonochrome
                        ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50'
                        : 'text-[#666] hover:text-[#d4af37] hover:bg-[#252525]'
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
                  className={`flex items-center px-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isMonochrome
                      ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                      : 'text-[#555] hover:text-[#888] hover:bg-[#252525]'
                  }`}
                  title="自定义工具栏"
                >
                  <Settings2 size={12} />
                </button>
              </div>

              {/* 工具栏自定义弹窗 */}
              {showToolbarCustomize && (
                <div
                  className={`absolute top-full mt-2 left-1/2 -translate-x-1/2 w-72 p-3 rounded-xl border shadow-2xl z-50 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a]/85 border-white/[0.12]'}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  data-popup="toolbar-customize"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs font-semibold ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>自定义工具栏</span>
                    <button onClick={() => setShowToolbarCustomize(false)} className={`p-1 rounded-lg ${isMonochrome ? 'text-blue-400 hover:text-blue-600' : 'text-[#666] hover:text-white'}`}><X size={14} /></button>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {toolbarItemOrder.map(label => {
                      const isHidden = toolbarHiddenItems.has(label);
                      return (
                        <div key={label} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${isMonochrome ? 'hover:bg-gray-50' : 'hover:bg-[#252525]'}`}>
                          <button
                            onClick={() => {
                              const newHidden = new Set(toolbarHiddenItems);
                              if (isHidden) newHidden.delete(label); else newHidden.add(label);
                              setToolbarHiddenItems(newHidden);
                            }}
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isHidden ? (isMonochrome ? 'border-gray-300' : 'border-white/[0.14]') : isMonochrome ? 'bg-blue-500 border-blue-500' : 'bg-[#d4af37] border-[#d4af37]'}`}
                          >
                            {!isHidden && <Check size={10} className="text-white" />}
                          </button>
                          <span className={`text-xs flex-1 ${isHidden ? (isMonochrome ? 'text-gray-400 line-through' : 'text-[#555] line-through') : (isMonochrome ? 'text-gray-700' : 'text-[#ccc]')}`}>{label}</span>
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
                              className={`p-0.5 rounded ${isMonochrome ? 'text-blue-400 hover:text-blue-600' : 'text-[#666] hover:text-white'}`}
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
                              className={`p-0.5 rounded ${isMonochrome ? 'text-blue-400 hover:text-blue-600' : 'text-[#666] hover:text-white'}`}
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
            className={`fixed z-50 py-1.5 rounded-xl border shadow-2xl min-w-[160px] ${isMonochrome ? 'bg-white/95 border-gray-200' : 'bg-[#1a1a1a]/95 border-[#2a2a2a]'}`}
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
                  isMonochrome ? 'text-gray-700 hover:bg-gray-100' : 'text-[#ccc] hover:bg-[#252525]'
                }`}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{item.shortcut}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Canvas context menu */}
        {showCanvasMenu && (
          <div
            className={`fixed z-50 py-1.5 rounded-xl border shadow-2xl min-w-[200px] ${isMonochrome ? 'bg-white/95 border-gray-200' : 'bg-[#1a1a1a]/95 border-[#2a2a2a]'}`}
            style={{ left: canvasMenuPos.x, top: canvasMenuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {canvasMenuItems.map((item, idx) => (
              <button
                key={idx}
                onClick={() => { item.action(); setShowCanvasMenu(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                  isMonochrome ? 'text-gray-700 hover:bg-gray-100' : 'text-[#ccc] hover:bg-[#252525]'
                }`}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{item.shortcut}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Help modal */}
        {showHelpModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center" onClick={() => setShowHelpModal(null)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className={`relative w-[360px] max-h-[70vh] rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a]/80 border-white/[0.14]'}`} onClick={(e) => e.stopPropagation()}>
              <div className={`flex items-center justify-between px-5 py-3.5 border-b ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
                <div className="flex items-center gap-2">
                  {showHelpModal === 'instructions' ? <Info size={16} className={isMonochrome ? 'text-gray-700' : 'text-[#d4af37]'} /> : <FileText size={16} className={isMonochrome ? 'text-gray-700' : 'text-[#d4af37]'} />}
                  <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>{showHelpModal === 'instructions' ? '操作说明' : '更新内容'}</span>
                </div>
                <button onClick={() => setShowHelpModal(null)} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-400 hover:text-blue-600 hover:bg-blue-50' : 'text-[#666] hover:text-white hover:bg-[#2a2a2a]'}`}><X size={16} /></button>
              </div>
              <div className={`px-5 py-4 overflow-y-auto max-h-[55vh] text-sm space-y-4 ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>
                {showHelpModal === 'instructions' ? (
                  <>
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>画布操作</div>
                      <div className="space-y-2">
                        {[['左键单击', '选择图片'], ['左键拖拽空白区域', '框选多图'], ['Ctrl+左键', '多选图片'], ['Alt+左键', '标记图片为参考图'], ['长按左键拖动图片', '移动图片'], ['空格+拖动 / 长按中键', '平移画布'], ['滚轮 / Ctrl+滚轮', '缩放画布'], ['右键', '上下文菜单'], ['Ctrl+D', '复制选中图片'], ['Ctrl+Z', '撤回操作'], ['ESC', '退出编辑/取消选择'], ['Delete', '删除选中图片']].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between"><span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{k}</span><span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]/85'}`} />
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>图片操作工具栏</div>
                      <div className="space-y-2">
                        {[['放大', '智能补细节，变大变高清'], ['移除背景', '一键去背景，生成透明底图'], ['SVG智能描摹', '彩色/黑白矢量化，图片压缩，缩略图'], ['擦除', '画笔涂抹消除，AI自动补全'], ['蒙版', '精准遮罩控制，AI重新生成'], ['编辑元素', '按元素智能分层，独立编辑'], ['多角度', '多视角生成图片'], ['转3D', '生成3D模型预览'], ['扩展', '向四周延伸画面，自动补齐'], ['裁切', '自由/预设比例裁切'], ['Agent编排', '智能编排多工具，自动选择最佳方案'], ['下载', 'PNG/SVG/PSD多格式下载']].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between"><span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{k}</span><span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]/85'}`} />
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>组与参考图</div>
                      <div className="space-y-2">
                        {[['多图右键', '创建组'], ['组标题栏折叠按钮', '折叠/展开组内容'], ['长按组标题栏拖动', '移动整个组'], ['Alt+左键点击图片', '标记为参考图（紫色R标记）'], ['参考图标记', '自动添加到创意描述文本框'], ['Backspace（光标起始处）', '删除最后一个参考图标记']].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between"><span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{k}</span><span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]/85'}`} />
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>左上角工具栏</div>
                      <div className="space-y-2">
                        {[['Oh My Prompt', '提示词管理与图片识词'], ['参考融合', 'Ctrl+Click选择参考图融合生成'], ['设置', '应用配置'], ['主题切换', '黑白/彩色模式切换'], ['用户管理', '多用户切换与管理'], ['项目数据', '项目保存与加载'], ['管理员系统', 'API与模型配置（仅管理员）'], ['使用说明', '操作与更新内容']].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between"><span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{k}</span><span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]/85'}`} />
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>底部工具栏</div>
                      <div className="space-y-2">
                        {[['选择工具', '默认模式，点击/框选图片'], ['抓手工具', '平移画布'], ['图片上传', '上传本地图片到画布'], ['图像生成器', 'AI图像生成（金色按钮）'], ['语言修图', '自然语言描述修改图片'], ['图层', '打开Layer Graph设计工程'], ['缩放控制', '放大/缩小/百分比/重置视图']].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between"><span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{k}</span><span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div>
                    <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>{APP_VERSION_LABEL}</div>
                    <div className="space-y-2.5">
                      {[
                        '11大图片工具：放大/移除背景/SVG智能描摹/擦除/蒙版/编辑元素/多角度/转3D/扩展/裁切/下载',
                        '放大：智能补细节把图片变大变高清，不改画面内容',
                        '移除背景：一键删除背景，生成透明底主体图',
                        'SVG智能描摹：彩色/黑白矢量化，多级质量预设，自定义参数，兼容Adobe Illustrator',
                        '擦除：画笔涂抹消除 + AI智能修复（全图发送避免变形），Alt键反向涂抹',
                        '蒙版：精准遮罩控制 + AI重新生成指定区域 + 后端精确蒙版合成',
                        '语言修图：自然语言描述修改意图，支持OpenAI（蒙版涂抹）+ Gemini（智能理解）',
                        '编辑元素：根据图片元素进行智能分层，独立编辑',
                        '多角度：多视角生成图片',
                        '转3D：生成3D模型并可在线预览旋转',
                        '扩展：比例预设 + AI向四周延伸画面',
                        'Alt+Click标记参考图：标记画布图片为参考图，自动添加到创意描述',
                        'Ctrl+Click参考融合：选择画布图片直接融合生成',
                        '组功能：多图右键创建组，支持折叠/展开，长按标题栏拖动',
                        '框选：左键拖拽空白区域直接框选，显示选择矩形',
                        'Ctrl+Z无限撤回：纯ref同步管理，流畅操作',
                        '右键菜单：图片右键可复制/下载/发送参考图/提取关键词/语言修图',
                        '下载：PNG/SVG/PSD三种格式，PSD支持Basic/Pro/Studio模式',
                        '服务器端API密钥管理：管理员统一配置，用户无需输入Key',
                        '通用模型类型：API管理支持通用模型，自动识别所有可用模型',
                        '高级参数与连接测试：添加固定API时支持高级参数和测试连接',
                        '矢量化多策略降级：矢量模型API → LLM视觉fallback → 本地vtracer兜底',
                        'API兼容层：通用多提供商适配，自动推断请求格式',
                      ].map((item, i) => (
                        <div key={i} className="flex items-start gap-2"><span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${isMonochrome ? 'bg-gray-400' : 'bg-[#d4af37]'}`} /><span>{item}</span></div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Canvas-Embedded Image Generator Panel */}
      {showCanvasGenerator && canvasGenFrameId && (() => {
        const frame = images.find(img => img.id === canvasGenFrameId);
        if (!frame) return null;
        const screenX = frame.x * zoom + viewOffset.x;
        const screenY = frame.y * zoom + viewOffset.y + frame.height * zoom + 12;
        return (
          <div
            className="absolute z-40"
            style={{ left: screenX, top: screenY, width: Math.max(frame.width * zoom, 380) }}
            data-floating-panel="canvas-generator"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`rounded-2xl border shadow-2xl overflow-hidden ${
              isMonochrome
                ? 'bg-white/95 border-gray-200'
                : 'bg-gradient-to-b from-[#181818] to-[#111111] border-white/[0.14] shadow-[0_8px_32px_rgba(0,0,0,0.6)]'
            }`}>
              {/* Header */}
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${
                isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'
              }`}>
                <div className="flex items-center gap-2.5">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                    isMonochrome ? 'bg-blue-100' : 'bg-[#d4af37]/15'
                  }`}>
                    <Sparkles size={13} className={isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'} />
                  </div>
                  <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>图像生成器</span>
                </div>
                <button
                  onClick={handleOpenCanvasGenerator}
                  className={`p-1.5 rounded-lg transition-colors ${isMonochrome ? 'text-blue-400 hover:text-blue-600 hover:bg-blue-50' : 'text-[#555] hover:text-white hover:bg-[#2a2a2a]'}`}
                >
                  <X size={14} />
                </button>
              </div>

              <div className="p-3.5 space-y-3">
                {/* Model selector */}
                <div className="flex items-center gap-2.5">
                  <label className={`text-xs font-medium min-w-[42px] ${isMonochrome ? 'text-gray-500' : 'text-[#777]'}`}>模型</label>
                  <select
                    value={canvasGenModel}
                    onChange={(e) => setCanvasGenModel(e.target.value)}
                    className={`flex-1 text-xs rounded-lg px-3 py-2 border outline-none transition-colors ${
                      isMonochrome
                        ? 'bg-white border-gray-200 text-gray-900 focus:border-gray-400'
                        : 'bg-[#0d0d0d] border-white/[0.12] text-[#ddd] focus:border-[#d4af37]/40'
                    }`}
                  >
                    {canvasGenModels.length === 0 && <option value="">暂无可用模型</option>}
                    {canvasGenModels.map(m => {
                      const compositeKey = `${m.providerId}::${m.id}`;
                      return <option key={compositeKey} value={compositeKey}>{m.id}{m.providerName ? ` (${m.providerName})` : ''}</option>;
                    })}
                  </select>
                </div>

                {/* Aspect ratio + Quality */}
                <div className="flex items-center gap-2.5">
                  <label className={`text-xs font-medium min-w-[42px] ${isMonochrome ? 'text-gray-500' : 'text-[#777]'}`}>比例</label>
                  <select
                    value={canvasGenAspectRatio}
                    onChange={(e) => setCanvasGenAspectRatio(e.target.value)}
                    className={`flex-1 text-xs rounded-lg px-3 py-2 border outline-none transition-colors ${
                      isMonochrome
                        ? 'bg-white border-gray-200 text-gray-900 focus:border-gray-400'
                        : 'bg-[#0d0d0d] border-white/[0.12] text-[#ddd] focus:border-[#d4af37]/40'
                    }`}
                  >
                    {['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <label className={`text-xs font-medium min-w-[36px] ${isMonochrome ? 'text-gray-500' : 'text-[#777]'}`}>质量</label>
                  <select
                    value={canvasGenQuality}
                    onChange={(e) => setCanvasGenQuality(e.target.value)}
                    className={`flex-1 text-xs rounded-lg px-3 py-2 border outline-none transition-colors ${
                      isMonochrome
                        ? 'bg-white border-gray-200 text-gray-900 focus:border-gray-400'
                        : 'bg-[#0d0d0d] border-white/[0.12] text-[#ddd] focus:border-[#d4af37]/40'
                    }`}
                  >
                    <option value="standard">标准</option>
                    <option value="hd">高清</option>
                  </select>
                </div>

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
                              : 'bg-[#1a1a1a]/85 text-[#888] hover:bg-[#252525] border border-white/[0.12]'
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
                        : 'text-[#888] hover:bg-[#1a1a1a]/85 hover:text-[#bbb] border-white/[0.12]'
                    }`}
                  >
                    <ImagePlus size={12} />
                    <span>参考图</span>
                    {canvasGenRefImages.length > 0 && <span className={isMonochrome ? "text-blue-500 font-medium" : "text-[#d4af37] font-medium"}>({canvasGenRefImages.length})</span>}
                  </button>
                </div>

                {/* Reference images thumbnails */}
                {canvasGenRefImages.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {canvasGenRefImages.map((refUrl, idx) => (
                      <div key={idx} className="relative group">
                        <img src={refUrl} alt="" className={`w-9 h-9 rounded-lg object-cover border ${isMonochrome ? 'border-gray-200' : 'border-white/[0.12]'}`} />
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
                      : 'bg-[#0d0d0d] border-white/[0.12] text-[#ddd] placeholder:text-[#555] focus:border-[#d4af37]/40'
                  } focus:ring-1 ${isMonochrome ? 'focus:ring-blue-200' : 'focus:ring-[#d4af37]/20'}`}
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
                        : 'bg-[#222]/80 text-[#555] cursor-not-allowed border border-white/[0.12]'
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
            </div>
          </div>
        );
      })()}

      {/* Floating pill toolbar - always on top (z-50) */}
      <div className={`absolute bottom-5 left-1/2 -translate-x-1/2 z-50 border rounded-2xl px-3 py-2 flex items-center gap-1.5 shadow-2xl ${
        isMonochrome 
          ? 'bg-white border-gray-200/80' 
          : 'bg-[#1a1a1a] border-[#333]'
      }`} style={{ boxShadow: isMonochrome ? '0 8px 24px rgba(0,0,0,0.08)' : '0 8px 32px rgba(0,0,0,0.5)' }}>
        {/* Select tool */}
        <button
          className={`tool-btn p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="选择工具"
        >
          <MousePointer2 className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-black/90 text-white'}`}>选择工具</span>
        </button>

        {/* Hand/Pan tool */}
        <button
          className={`tool-btn p-2 rounded-xl transition-all relative group ${
            isPanning || isSpacePressed
              ? isMonochrome
                ? 'bg-blue-100 text-blue-700'
                : 'bg-[#d4af37]/20 text-[#d4af37]'
              : isMonochrome
                ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'
                : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="抓手工具"
          onClick={() => {
            // Toggle pan mode: activate panning
            setIsSpacePressed(true);
            // Auto-deactivate when mouse is released after a pan
            const handleUp = () => {
              setIsSpacePressed(false);
              window.removeEventListener('mouseup', handleUp);
            };
            window.addEventListener('mouseup', handleUp);
          }}
        >
          <Hand className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-black/90 text-white'}`}>抓手工具</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />

        {/* Upload */}
        <input ref={uploadFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCanvasImageUpload} />
        <button
          onClick={() => uploadFileInputRef.current?.click()}
          className={`tool-btn p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-violet-600 hover:text-violet-700 hover:bg-violet-50'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="图片上传"
        >
          <Upload className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-black/90 text-white'}`}>图片上传</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />

        {/* Image Generator - gold accent / blue for monochrome */}
        <button
          onClick={handleOpenCanvasGenerator}
          className={`p-2 rounded-xl transition-all shadow-lg relative group ${isMonochrome ? (showCanvasGenerator ? 'bg-blue-500 text-white ring-2 ring-blue-400/50' : 'bg-blue-500 hover:bg-blue-600 text-white') : (showCanvasGenerator ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black ring-2 ring-[#d4af37]/50' : 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] hover:from-[#daa520] hover:to-[#cd9b1d] text-black')}`}
          title="图像生成器"
        >
          <Sparkles className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-blue-600 text-white' : 'bg-black/90 text-white'}`}>图像生成器</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />

        {/* Language Edit - 修图 */}
        <button
          onClick={() => { onEditImage?.(null); }}
          className={`tool-btn p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="语言修图"
        >
          <Pencil className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-black/90 text-white'}`}>修图</span>
        </button>

        {/* Agent Edit - Agent编排 */}
        <button
          onClick={() => { setAgentEditImage(null); setShowAgentEditor(true); }}
          className={`tool-btn p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-violet-600 hover:text-violet-700 hover:bg-violet-50'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="Agent编排"
        >
          <Bot className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-black/90 text-white'}`}>Agent</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />

        {/* HexCube 六面体 */}
        <button
          onClick={handleCreateHexCube}
          className={`tool-btn p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-orange-600 hover:text-orange-700 hover:bg-orange-50'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="六面体"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" />
            <path d="M12 3v18" />
            <path d="M3 8l9 5 9-5" />
          </svg>
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-black/90 text-white'}`}>六面体</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />

        {/* Zoom controls */}
        <div className="flex items-center gap-1 px-1">
          <button
            onClick={() => { setZoom(z => Math.max(0.1, z / 1.2)); }}
            className={`p-1.5 rounded-lg transition-all ${isMonochrome ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50' : 'text-[#888] hover:text-white hover:bg-white/10'}`}
            title="缩小"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className={`text-xs font-mono w-10 text-center ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => { setZoom(z => Math.min(5, z * 1.2)); }}
            className={`p-1.5 rounded-lg transition-all ${isMonochrome ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50' : 'text-[#888] hover:text-white hover:bg-white/10'}`}
            title="放大"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />

        {/* Reset view */}
        <button
          onClick={() => { setZoom(1); setViewOffset({ x: 0, y: 0 }); }}
          className={`tool-btn p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="重置视图"
        >
          <Maximize2 className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-black/90 text-white'}`}>重置视图</span>
        </button>

        {/* Generating progress */}
        {isGenerating && (
          <>
            <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />
            <div className="flex items-center gap-1.5">
              <div className={`w-14 h-1.5 rounded-full overflow-hidden ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`}>
                <div className="h-full rounded-full progress-bar shimmer" style={{ 
                  width: `${generationProgress ? (generationProgress.current / generationProgress.total * 100) : 0}%`,
                  background: 'linear-gradient(90deg, #d4af37, #f0d060, #d4af37)'
                }} />
              </div>
              <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#d4af37]/80'}`}>生成中</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
