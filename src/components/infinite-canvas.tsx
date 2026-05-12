'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import {
  Plus, Trash2, Copy, Download, Image as ImageIcon,
  Move, ZoomIn, ZoomOut, Maximize2, Hand, Info,
  FileText, X, ChevronDown, ArrowUpFromLine, Eraser,
  Scissors, Wand2, Expand, Layers, Paintbrush,
  Check, MousePointer2, BoxSelect, Upload, Eye, Sparkles,
  RotateCcw, Minus, Type, GitMerge, Wrench, ChevronRight,
  Settings, Palette, Users, HelpCircle, Box, Camera, ImagePlus, SlidersHorizontal, Shield, FolderOpen
} from 'lucide-react';
import type { PsdLayerItem } from '@/types/psdLayer';
import { toStableImageUrl } from '@/lib/stable-image-url';
import { APP_VERSION_LABEL } from '@/config/app-meta';
import OhMyPrompt from '@/components/oh-my-prompt';
import dynamic from 'next/dynamic';

const ModelViewer3D = dynamic(() => import('@/components/model-viewer-3d'), { ssr: false });

const PsdLayerEditor = lazy(() => import('@/components/psd-editor/PsdLayerEditor'));


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
      const octx = offscreen.getContext('2d')!;
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
    const pitch = (tilt / 45) * Math.PI * 0.5;    // -PI/2 to PI/2
    const camDist = 2.5 / zoom;

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
    offCanvas.getContext('2d')!.putImageData(outImg, 0, 0);
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
         tilt > 25 ? '俯视' : tilt < -25 ? '仰视' : '斜视'}
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
  threeDModelUrls?: Record<string, string>;
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
  onToggleSettings?: () => void;
  onToggleTheme?: () => void;
  onToggleUserManager?: () => void;
  onToggleAdminSystem?: () => void;
  onToggleProjectData?: () => void;
  isAdmin?: boolean;
  onToggleHelp?: () => void;
  isPanelCollapsed?: boolean;
  onUndo?: () => void;
  onOpenLayerGraph?: () => void;
  navigateToImageId?: string | null;
  onNavigateToImageComplete?: () => void;
  onGroupsChange?: (groups: ImageGroup[]) => void;
  initialGroups?: ImageGroup[];
  /** Called when Alt+Click marks an image as reference with number */
  onAltMarkReference?: (image: CanvasImage) => void;
  /** IDs of images currently marked as Alt references */
  altRefMarkerIds?: string[];
}

type EditMode = 'none' | 'erase' | 'mask' | 'expand' | 'crop' | 'img2img' | 'upscale';
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
  onToggleSettings,
  onToggleTheme,
  onToggleUserManager,
  onToggleAdminSystem,
  onToggleProjectData,
  isAdmin = false,
  onToggleHelp,
  isPanelCollapsed = true,
  onUndo,
  onOpenLayerGraph,
  navigateToImageId,
  onNavigateToImageComplete,
  onGroupsChange,
  initialGroups,
  onAltMarkReference,
  altRefMarkerIds = [],
}: InfiniteCanvasProps) {
  const isMonochrome = themeStyle === 'monochrome';

  // View state
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);

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
    const newImages = images.filter(img => !prevImageIdsRef.current.has(img.id) && !img.isProcessingPlaceholder);

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

        // Use a reasonable zoom: keep current if it shows the image well, otherwise use fitZoom
        const newZoom = fitZoom;

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
  }, [images]);

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
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });

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
  const [expandScale, setExpandScale] = useState(1);
  const [showExpandScaleMenu, setShowExpandScaleMenu] = useState(false);
  const [cropRatio, setCropRatio] = useState('free');
  const [showExpandRatios, setShowExpandRatios] = useState(false);
  const [showCropRatios, setShowCropRatios] = useState(false);
  // 图生图 state
  const IMG2IMG_CATEGORIES = [
    { key: '风格', prefix: 'in the style of', placeholder: '如：水彩画风格' },
    { key: '构图', prefix: 'with the composition of', placeholder: '如：居中对称构图' },
    { key: '场景', prefix: 'in the scene of', placeholder: '如：夕阳下的海滩' },
    { key: '色彩', prefix: 'with the color palette of', placeholder: '如：暖橙色调' },
    { key: '主体', prefix: 'featuring the subject of', placeholder: '如：蒙娜丽莎' },
    { key: '细节', prefix: 'with the details of', placeholder: '如：细腻纹理' },
  ];

  const [img2imgStrengths, setImg2imgStrengths] = useState<Record<string, number>>({ '风格': 0, '构图': 0, '场景': 0, '色彩': 0, '主体': 0, '细节': 0 });
  const [img2imgKeyword, setImg2imgKeyword] = useState('');
  const [img2imgNegativePrompt, setImg2imgNegativePrompt] = useState('');
  const [img2imgGenerating, setImg2imgGenerating] = useState(false);
  const [img2imgShowNegative, setImg2imgShowNegative] = useState(false);
  const [img2imgActiveCategories, setImg2imgActiveCategories] = useState<Set<string>>(new Set());

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

  // Check Upscayl NCNN availability on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/upscayl');
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
  const [multiAngleZoom, setMultiAngleZoom] = useState(1);
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
      setMultiAngleTilt(Math.round(clampMultiAngleValue(drag.startTilt - dy * 0.45, -45, 45)));
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

  const selectImage = useCallback((id: string | null) => {
    if (id) {
      const img = images.find(i => i.id === id);
      onSelectImage(img || null);
    } else {
      onSelectImage(null);
    }
  }, [images, onSelectImage]);

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
      if (e.code === 'Space' && !e.repeat) {
        // Don't capture Space when user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        setIsSpacePressed(true);
      }
      if (e.code === 'Escape') {
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
          newImages.push({
            id: `paste-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            url,
            x: cx + offsetIdx,
            y: cy + offsetIdx,
            width: 400,
            height: 300,
          });
        } catch {
          // Skip failed uploads
        }
      }

      if (newImages.length > 0) {
        onImagesChange([...images, ...newImages]);
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
    for (let i = images.length - 1; i >= 0; i--) {
      const img = images[i];
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
            setResizeStart({ x: canvasPos.x, y: canvasPos.y, w: selImg.width, h: selImg.height });
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
      let newX = img.x;
      let newY = img.y;

      if (resizeCorner === 'br') {
        newW = Math.max(40, resizeStart.w + dx);
        newH = newW / aspect;
      } else if (resizeCorner === 'bl') {
        newW = Math.max(40, resizeStart.w - dx);
        newH = newW / aspect;
        newX = img.x + (resizeStart.w - newW);
      } else if (resizeCorner === 'tr') {
        newW = Math.max(40, resizeStart.w + dx);
        newH = newW / aspect;
        newY = img.y + (resizeStart.h - newH);
      } else if (resizeCorner === 'tl') {
        newW = Math.max(40, resizeStart.w - dx);
        newH = newW / aspect;
        newX = img.x + (resizeStart.w - newW);
        newY = img.y + (resizeStart.h - newH);
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
    }

    // Group drag: only allow after long press (groupDragReadyRef)
    if (groupDragTarget && groupDragReadyRef.current) {
      const offsetX = canvasPos.x - groupDragStart.x;
      const offsetY = canvasPos.y - groupDragStart.y;
      setGroupDragOffset({ x: offsetX, y: offsetY });
    }
  }, [editMode, isPanning, isMiddlePanning, panStart, boxSelectStart, isLongPressing, resizingImage, resizeCorner, images, dragTarget, dragStart, resizeStart, screenToCanvas, onImagesChange, handleEditMouseMove, groupDragTarget, groupDragStart]);

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
          images.forEach(img => {
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
        onImagesChange(images.map(img => {
          if (selectedIds.has(img.id)) {
            return { ...img, x: img.x + dragOffset.x, y: img.y + dragOffset.y };
          }
          return img;
        }));
      }
      setDragTarget(null);
      setDragOffset({ x: 0, y: 0 });
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

    mouseDownOnImageRef.current = false;
  }, [editMode, isPanning, isMiddlePanning, boxSelectStart, boxSelectEnd, dragTarget, dragOffset, images, selectedIds, zoom, viewOffset, onImagesChange, handleEditMouseUp, groupDragTarget, groupDragOffset]);

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
        setSelectedIds(new Set([hitId]));
        selectImage(hitId);
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
      Promise.all(promises).then(results => {
        const validUrls = results.filter(url => url);
        if (validUrls.length > 0) onAddImages(validUrls);
      });
    }
  }, [images, onImagesChange, onAddImages, screenToCanvas]);

  const handleCanvasImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const promises = Array.from(files).map(file =>
        new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onload = event => resolve((event.target?.result as string) || '');
          reader.readAsDataURL(file);
        })
      );
      try {
        const results = await Promise.all(promises);
        const validUrls = results.filter(url => url);
        if (validUrls.length > 0) onAddImages(validUrls);
      } catch (error) {
        console.error('Failed to read images:', error);
      }
    }
    e.target.value = '';
  };

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
          // 从 providers[].models 读取
          if (data.providers && Array.isArray(data.providers)) {
            for (const provider of data.providers) {
              if (provider.models && Array.isArray(provider.models)) {
                for (const m of provider.models) {
                  models.push({
                    id: `admin-3d::${provider.id}::${m.id || m.name}`,
                    name: provider.name || provider.displayName || '管理员',
                    baseUrl: provider.baseUrl,
                    apiKey: provider.apiKey,
                    model: m.id || m.name,
                    providerPreset: provider.providerPreset || '',
                    providerName: provider.name || provider.displayName || '管理员',
                    advancedParams: provider.advancedParams,
                  });
                }
              }
            }
          }
          // 也从顶层 models 数组读取（管理员配置的3D模型）
          if (data.models && Array.isArray(data.models)) {
            const existingIds = new Set(models.map(m => m.id));
            for (const m of data.models) {
              const modelId = `admin-3d::${m.providerId}::${m.id || m.name}`;
              if (!existingIds.has(modelId)) {
                const provider = data.providers?.find((p: {id: string}) => p.id === m.providerId);
                models.push({
                  id: modelId,
                  name: provider?.name || provider?.displayName || '管理员',
                  baseUrl: provider?.baseUrl || '',
                  apiKey: provider?.apiKey || '',
                  model: m.id || m.name,
                  providerPreset: provider?.providerPreset || '',
                  providerName: provider?.name || provider?.displayName || '管理员',
                  advancedParams: provider?.advancedParams,
                });
              }
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
          // 从 providers[].models 读取
          if (data.providers && Array.isArray(data.providers)) {
            for (const provider of data.providers) {
              if (provider.models && Array.isArray(provider.models)) {
                for (const m of provider.models) {
                  models.push({
                    id: m.id || m.name,
                    providerId: provider.id,
                    providerName: provider.name || provider.displayName,
                  });
                }
              }
            }
          }
          // 也从顶层 models 数组读取
          if (data.models && Array.isArray(data.models)) {
            const existingIds = new Set(models.map(m => m.id));
            for (const m of data.models) {
              if (!existingIds.has(m.id || m.name)) {
                models.push({
                  id: m.id || m.name,
                  providerId: m.providerId,
                  providerName: m.providerName,
                });
              }
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
            if (p.modelType?.includes('image') || (!p.modelType && p.type === 'universal')) {
              const displayName = p.displayName || p.name;
              if (p.selectedModels && p.selectedModels.length > 0) {
                for (const m of p.selectedModels) {
                  userModels.push({ id: m, providerId: p.id, providerName: displayName });
                }
              }
            }
          }
          setCanvasGenModels(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newOnes = userModels.filter(m => !existingIds.has(m.id));
            return [...prev, ...newOnes];
          });
        }
      } catch { /* silent */ }
    };
    loadImageModels();
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
            if (!(p.modelType?.includes('3d') || (!p.modelType && p.type === 'universal'))) continue;
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

  // Get current model name from localStorage
  const getCurrentModel = useCallback((): string => {
    if (typeof window === 'undefined') return 'gemini-2.5-flash-image-preview';
    try {
      const currentUserId = localStorage.getItem('unbounded_ai_current_user');
      if (!currentUserId) return 'gemini-2.5-flash-image-preview';
      const stored = localStorage.getItem('unbounded_ai_user_data');
      if (!stored) return 'gemini-2.5-flash-image-preview';
      const data = JSON.parse(stored);
      const userData = data.userData?.[currentUserId];
      if (!userData?.selectedModel) return 'gemini-2.5-flash-image-preview';
      return userData.selectedModel;
    } catch {
      return 'gemini-2.5-flash-image-preview';
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
    cropInfo?: { cropX: number; cropY: number; cropW: number; cropH: number } | null
  ): Promise<string> => {
    // 使用 Canvas 2D 合成，IOPaint/LaMa 风格的蒙版合成
    // cropInfo: 如果API使用了裁剪策略，结果图像是裁剪尺寸，需要放置到(cropX, cropY)位置
    const canvas = document.createElement('canvas');
    canvas.width = origW;
    canvas.height = origH;
    const ctx = canvas.getContext('2d')!;

    // 1. 加载所有图像
    const [origImg, maskImg, resultImg] = await Promise.all([
      loadImage(originalImageUrl),
      loadImage(maskBase64),
      loadImage(resultImageUrl),
    ]);

    // 2. 绘制原图作为底层
    ctx.drawImage(origImg, 0, 0, origW, origH);

    // 3. 解析蒙版
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = origW;
    maskCanvas.height = origH;
    const maskCtx = maskCanvas.getContext('2d')!;
    maskCtx.drawImage(maskImg, 0, 0, origW, origH);
    const maskData = maskCtx.getImageData(0, 0, origW, origH);

    // 4. 创建蒙版化的生成结果
    // 如果有cropInfo，结果图像是裁剪区域的，需要放置到正确位置
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = origW;
    resultCanvas.height = origH;
    const resultCtx = resultCanvas.getContext('2d')!;

    if (cropInfo) {
      // 裁剪策略：结果图像是裁剪尺寸，放置到 (cropX, cropY) 位置
      resultCtx.drawImage(resultImg, cropInfo.cropX, cropInfo.cropY, cropInfo.cropW, cropInfo.cropH);
    } else {
      // 全图策略：结果图像是完整尺寸
      resultCtx.drawImage(resultImg, 0, 0, origW, origH);
    }

    // 获取生成结果的像素数据
    const resultImageData = resultCtx.getImageData(0, 0, origW, origH);

    // 5. 应用蒙版作为 alpha 通道（IOPaint sd_mask_blur 风格）
    // 蒙版白色(>127) → 保留生成结果（显示生成内容）
    // 蒙版黑色(<128) → 设为透明（保留原图）
    // 使用渐变 alpha 实现羽化过渡：alpha = clamp(maskValue * 2, 0, 255)
    // 这样在蒙版边缘（128左右），alpha 会有平滑过渡
    for (let i = 0; i < maskData.data.length; i += 4) {
      const maskValue = maskData.data[i]; // R channel
      // 渐变 alpha：蒙版边缘区域（64-192）有平滑过渡
      // 白色区域(>192): alpha=255 (完全显示生成结果)
      // 黑色区域(<64): alpha=0 (完全显示原图)
      // 过渡区域(64-192): alpha 线性插值
      let alpha: number;
      if (maskValue >= 192) {
        alpha = 255;
      } else if (maskValue <= 64) {
        alpha = 0;
      } else {
        alpha = Math.round(((maskValue - 64) / 128) * 255);
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
        blurCtx.filter = 'blur(4px)';
        blurCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, maskW, maskH);
        ctx.drawImage(blurCanvas, 0, 0);
      }
    } catch {
      // filter not supported in some browsers, skip blur
    }

    return canvas.toDataURL('image/png');
  }, [editStrokes, brushSize, images, editImageId]);

  // Poll for task completion
  const pollForResult = useCallback(async (
    taskId: string,
    apiKeyOrModel: string,
    onProgress?: (progress: number, status: string) => void
  ): Promise<string | null> => {
    // apiKeyOrModel was previously apiKey, now we pass the model name for server-side key lookup
    const currentModel = getCurrentModel();
    const maxAttempts = 60;
    const getEditPollInterval = (attempt: number) => {
      if (attempt <= 2) return 800;
      if (attempt <= 5) return 1000;
      if (attempt <= 15) return 1500;
      return 2000;
    };
    for (let i = 0; i < maxAttempts; i++) {
      onProgress?.(
        Math.min(95, 18 + Math.round((i / Math.max(1, maxAttempts - 1)) * 76)),
        i < 2 ? '任务已提交，等待模型响应...' : 'AI 正在生成结果...'
      );
      await new Promise(r => setTimeout(r, getEditPollInterval(i)));
      try {
        const res = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, model: currentModel }),
        });
        const data = await res.json();
        if (data.status === 'completed' && data.imageUrl) {
          return data.imageUrl;
        }
        if (data.status === 'failed') {
          console.error('Task failed:', data.error);
          return null;
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }
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
      setCanvasGenModel(canvasGenModels[0].id);
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
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: canvasGenPrompt,
          negativePrompt: canvasGenNegativePrompt || undefined,
          model: canvasGenModel || undefined,
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
      const taskIds: string[] = data.taskIds || (data.taskId ? [data.taskId] : []);
      // 使用服务端实际使用的模型（可能因自动切换而与请求模型不同）
      const actualGenModel = data.model || canvasGenModel || undefined;

      if (taskIds.length === 0) {
        throw new Error('未获取到任务ID');
      }

      // Poll for results
      const pollForResult = async (taskId: string): Promise<string | null> => {
        const maxAttempts = 120;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const pollRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: actualGenModel }),
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
      const model = getCurrentModel();
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
          model,
          apiKey,
          scale: upMultiplier,
          originalWidth: origW,
          originalHeight: origH,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        updateProcessingFrame(placeholderId, {
          progress: -1,
          status: `❌ ${data.error || '放大失败'}`,
          error: data.error || '放大失败',
        });
        setTimeout(() => removeProcessingFrame(placeholderId), 5000);
        setIsEditProcessing(false);
        return;
      }

      updateProcessingFrame(placeholderId, { progress: 22, status: data.engine === 'tile-upscale' ? 'AI 正在分块放大（更高质量，耗时稍长）...' : 'AI 正在放大细节...' });
      const usedModel = data.usedModel || model;
      const resultUrl = data.imageUrl || await pollForResult(data.taskId, usedModel, (progress, status) => {
        updateProcessingFrame(placeholderId, { progress, status });
      });
      if (resultUrl) {
        updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入结果...' });
        const stableUrl = await toStableImageUrl(resultUrl);
        completeProcessingFrame(placeholderId, stableUrl, targetW / 2, targetH / 2, {
          originalWidth: targetW,
          originalHeight: targetH,
          modifyPrompt: `${upMultiplier}x HD ${upscalePreset.toUpperCase()} 放大`,
        });
      } else {
        updateProcessingFrame(placeholderId, {
          progress: -1,
          status: '❌ 放大超时，请重试',
          error: '放大超时，请重试',
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
      const model = getCurrentModel();
      updateProcessingFrame(placeholderId, { progress: 12, status: '正在提交到 AI 模型...' });
      const res = await fetch('/api/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_background',
          imageUrl: img.url,
          aspectRatio: `${img.originalWidth || img.width}:${img.originalHeight || img.height}`,
          model,
          apiKey,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        alert(data.error || '移除背景失败');
        setIsEditProcessing(false);
        return;
      }

      updateProcessingFrame(placeholderId, { progress: 22, status: 'AI 正在识别主体边缘...' });
      const resultUrl = await pollForResult(data.taskId, apiKey, (progress, status) => {
        updateProcessingFrame(placeholderId, { progress, status });
      });
      if (resultUrl) {
        const w = img.originalWidth || Math.round(img.width);
        const h = img.originalHeight || Math.round(img.height);
        updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入透明背景结果...' });
        const stableUrl = await toStableImageUrl(resultUrl);
        completeProcessingFrame(placeholderId, stableUrl, img.width, img.height, {
          originalWidth: w,
          originalHeight: h,
          modifyPrompt: '背景移除',
        });
      } else {
        alert('移除背景超时，请重试');
      }
    } catch (e) {
      console.error('Remove background error:', e);
      alert('操作失败，请重试');
    }
    setIsEditProcessing(false);
  }, [selectedImageData, getApiKey, getCurrentModel, pollForResult, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame]);

  // 3. VECTORIZE - convert raster image to true vector SVG via server API
  // Priority: admin-configured vectorize model → PY_VECTORIZE_ENDPOINT → client-side vtracer fallback
  const handleRasterize = useCallback(async () => {
    const img = selectedImageData;
    if (!img) return;

    const placeholderId = createProcessingFrameRightOf(
      img,
      '矢量化中',
      img.width,
      img.height,
      '正在分析颜色和轮廓...'
    );
    setIsEditProcessing(true);
    try {
      // Call server-side vectorize API (uses admin-configured vectorize model)
      updateProcessingFrame(placeholderId, { progress: 18, status: '正在调用矢量模型...' });
      const response = await fetch('/api/design/vectorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: img.url, layerId: img.id, mode: 'auto' }),
      });
      const data = await response.json();

      if (data.success && data.svg) {
        updateProcessingFrame(placeholderId, { progress: 88, status: '正在渲染 SVG 预览...' });
        const svgBlob = new Blob([data.svg], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const engineLabel = data.engine === 'raster-svg-wrapper' ? '容器模式' : (data.engine || '矢量');
        completeProcessingFrame(placeholderId, svgUrl, img.width, img.height, {
          modifyPrompt: `矢量化 SVG (${engineLabel})`,
        });
        if (data.warnings && data.warnings.length > 0) {
          console.warn('Vectorize warnings:', data.warnings);
        }
      } else {
        // Server API failed, fallback to client-side vtracer
        updateProcessingFrame(placeholderId, { progress: 34, status: '服务端矢量模型不可用，使用本地转换...' });
        const { exportAsSVG } = await import('@/lib/svg-export');
        const result = await exportAsSVG(img.url, { mode: 'pro' });

        if (result.svgString && result.svgString.length > 0) {
          updateProcessingFrame(placeholderId, { progress: 88, status: '正在渲染 SVG 预览...' });
          const svgBlob = new Blob([result.svgString], { type: 'image/svg+xml;charset=utf-8' });
          const svgUrl = URL.createObjectURL(svgBlob);
          completeProcessingFrame(placeholderId, svgUrl, img.width, img.height, {
            modifyPrompt: `矢量化 SVG (${result.quality?.label || '本地'})`,
          });
        } else {
          // Ultimate fallback: embed PNG in SVG wrapper
          const image = new Image();
          image.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = img.url; });
          const canvas = document.createElement('canvas');
          const width = image.naturalWidth || Math.round(img.originalWidth || img.width);
          const height = image.naturalHeight || Math.round(img.originalHeight || img.height);
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas context unavailable');
          ctx.drawImage(image, 0, 0, width, height);
          const embeddedPng = canvas.toDataURL('image/png');
          const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${embeddedPng}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
</svg>`;
          const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
          completeProcessingFrame(placeholderId, svgUrl, img.width, img.height, {
            modifyPrompt: '栅格化 (SVG)',
          });
        }
      }
    } catch (e) {
      console.error('Vectorize failed:', e);
      alert('矢量化失败');
    }
    setIsEditProcessing(false);
  }, [selectedImageData, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame]);

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
      const model = getCurrentModel();
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
          model,
          apiKey,
        }),
      });
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
        alert('多角度生成超时，请重试');
        return;
      }
      updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入新角度图片...' });
      const stableUrl = await toStableImageUrl(resultUrl);
      completeProcessingFrame(placeholderId, stableUrl, img.width, img.height, {
        originalWidth: img.originalWidth || Math.round(img.width),
        originalHeight: img.originalHeight || Math.round(img.height),
        modifyPrompt: `AI伪3D摄影棚 / ${multiAngleMode === 'image' ? '主体转角' : '摄像机位'} / yaw ${multiAngleRotation} / pitch ${multiAngleTilt} / dolly ${multiAngleZoom.toFixed(2)}`,
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
        const maxAttempts = 120; // 最多轮询120次（10分钟）
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

  // 6. EXPAND - floating toolbar with ratio presets
  const handleOpenExpand = useCallback(() => {
    const img = selectedImageData;
    if (!img) return;
    setEditMode('expand');
    setEditImageId(img.id);
    setExpandRatio('1:1');
    setExpandScale(1);
  }, [selectedImageData]);

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

        updateProcessingFrame(placeholderId, { progress: 8, status: '正在提交到 AI 模型...' });

        const model = getCurrentModel();
        const res = await fetch('/api/image-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'inpaint',
            imageUrl: currentEditImg.url,
            maskImage: maskBase64,
            prompt,
            editMode: currentEditMode as 'erase' | 'mask',
            aspectRatio: `${currentEditImg.originalWidth || currentEditImg.width}:${currentEditImg.originalHeight || currentEditImg.height}`,
            model,
            apiKey,
          }),
        });

        const data = await res.json();
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

        if (syncResultUrl) {
          updateProcessingFrame(placeholderId, { progress: 80, status: '正在载入编辑结果...' });
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
            const compositeUrl = await compositeInpaintResult(
              currentEditImg.url,
              maskBase64,
              resultUrl,
              currentEditImg.originalWidth || Math.round(currentEditImg.width),
              currentEditImg.originalHeight || Math.round(currentEditImg.height),
              cropInfo
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
          updateProcessingFrame(placeholderId, {
            progress: -1,
            status: '❌ 未获取到结果',
            error: '未获取到结果',
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

    if (editMode === 'img2img') {
      const img2imgModel = getCurrentModel();

      // 图生图提示词构建：明确告诉模型参考原图的哪些方面 + 用关键词作为新内容
      const categoryEnMap: Record<string, string> = {
        '风格': 'artistic style and visual aesthetics',
        '构图': 'composition and layout structure',
        '场景': 'scene and environment setting',
        '色彩': 'color palette and tone',
        '主体': 'main subject and focal point',
        '细节': 'fine details and textures',
      };

      const keyword = img2imgKeyword.trim();

      // 收集激活的类别（强度>0表示要保留原图该方面）
      const preserveAspects = Array.from(img2imgActiveCategories)
        .filter(cat => (img2imgStrengths[cat] || 0) > 0)
        .map(cat => {
          const s = img2imgStrengths[cat] || 0;
          const desc = categoryEnMap[cat] || cat;
          if (s >= 80) return `strictly preserve the ${desc} of the reference image`;
          if (s >= 50) return `maintain the ${desc} of the reference image`;
          if (s >= 20) return `subtly reference the ${desc} of the reference image`;
          return `lightly hint at the ${desc} of the reference image`;
        });

      // 收集未激活的类别（可以自由改变）
      const freeAspects = Object.keys(categoryEnMap)
        .filter(cat => !img2imgActiveCategories.has(cat) || (img2imgStrengths[cat] || 0) === 0)
        .map(cat => categoryEnMap[cat]);

      // 构建完整提示词
      let fullPrompt = '';
      if (keyword) {
        // 有关键词：以关键词为主题，保留原图指定方面
        fullPrompt = `Create an image of: ${keyword}.`;
        if (preserveAspects.length > 0) {
          fullPrompt += ` While creating this new image, ${preserveAspects.join(', ')}.`;
        }
        if (freeAspects.length > 0) {
          fullPrompt += ` Feel free to reimagine the ${freeAspects.join(', ')}.`;
        }
      } else {
        // 无关键词：对原图做创意变体
        fullPrompt = 'Generate a creative variation of the reference image.';
        if (preserveAspects.length > 0) {
          fullPrompt += ` Keep the ${preserveAspects.join(', ')}.`;
        }
        if (freeAspects.length > 0) {
          fullPrompt += ` Creatively transform the ${freeAspects.join(', ')}.`;
        }
      }

      // 关键：显式告诉模型使用参考图作为基础
      fullPrompt = `[img2img] Use the provided reference image as the base. ${fullPrompt}`;

      // Append negative prompt if present
      if (img2imgNegativePrompt.trim()) {
        fullPrompt += ` Avoid: ${img2imgNegativePrompt.trim()}`;
      }

      // strength 计算：
      // 保留方面多/强 → 需要更接近原图 → strength 低（偏离少）
      // 保留方面少/弱 → 允许更多自由 → strength 高（偏离多）
      // 基础 strength = 0.6，每个保留方面降低一些
      const totalPreserveScore = Array.from(img2imgActiveCategories)
        .reduce((sum, cat) => sum + (img2imgStrengths[cat] || 0), 0);
      const maxPossibleScore = 600; // 6个类别 * 100
      const preserveRatio = totalPreserveScore / maxPossibleScore;
      // strength 范围: 0.25（大量保留） ~ 0.85（几乎不保留）
      const img2imgStrength = 0.85 - preserveRatio * 0.6;

      const placeholderId = createProcessingFrameRightOf(
        editImg,
        '图生图中',
        editImg.width,
        editImg.height,
        '正在创建图生图任务...'
      );
      exitEditMode();
      try {
        updateProcessingFrame(placeholderId, { progress: 16, status: '正在提交图生图请求...' });
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: fullPrompt,
            model: img2imgModel,
            aspectRatio: (() => {
              const ow = editImg.originalWidth || Math.round(editImg.width);
              const oh = editImg.originalHeight || Math.round(editImg.height);
              const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b);
              const d = g(ow, oh);
              return `${ow / d}:${oh / d}`;
            })(),
            quality: 'standard',
            count: 1,
            referenceImages: [editImg.url],
            strength: img2imgStrength,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          alert(data.error || '图生图提交失败');
          removeProcessingFrame(placeholderId);
          return;
        }

        const taskId = data.taskIds?.[0] || data.taskId || data.id;
        // 使用服务端实际使用的模型（可能因自动切换而与请求模型不同）
        const actualModel = data.model || img2imgModel;
        if (!taskId) {
          alert('未获取到任务ID');
          removeProcessingFrame(placeholderId);
          return;
        }

        updateProcessingFrame(placeholderId, { progress: 24, status: 'AI 正在生成...' });
        // 轮询任务状态 - 快速递增间隔
        const getImg2ImgPollInterval = (attempt: number) => {
          if (attempt <= 2) return 800;
          if (attempt <= 5) return 1000;
          if (attempt <= 15) return 1500;
          return 2000;
        };
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, getImg2ImgPollInterval(i)));
          try {
            const pollRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: actualModel }),
            });
            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();

            if (pollData.status === 'completed' || pollData.status === 'succeeded') {
              if (pollData.imageUrl) {
                updateProcessingFrame(placeholderId, { progress: 96, status: '正在载入结果...' });
                const stableUrl = await toStableImageUrl(pollData.imageUrl);
                completeProcessingFrame(placeholderId, stableUrl, editImg.width, editImg.height, { originalWidth: editImg.originalWidth || Math.round(editImg.width), originalHeight: editImg.originalHeight || Math.round(editImg.height) });
              } else {
                alert(pollData.error || '图生图完成但未返回结果');
                removeProcessingFrame(placeholderId);
              }
              return;
            }
            if (pollData.status === 'failed' || pollData.status === 'error') {
              alert(pollData.error || pollData.message || '图生图失败');
              removeProcessingFrame(placeholderId);
              return;
            }
            // Still processing
            const progress = Math.min(90, 24 + i * 0.5);
            updateProcessingFrame(placeholderId, { progress, status: pollData.status === 'processing' ? 'AI 正在生成...' : '等待处理中...' });
          } catch {
            // continue polling
          }
        }
        alert('图生图超时，请重试');
        removeProcessingFrame(placeholderId);
      } catch (e) {
        console.error('Img2Img error:', e);
        alert('操作失败，请重试');
        removeProcessingFrame(placeholderId);
      }

      return;
    }

    if (editMode === 'expand') {
      // Calculate target dimensions before creating processing frame
      const origW = editImg.originalWidth || Math.round(editImg.width);
      const origH = editImg.originalHeight || Math.round(editImg.height);
      let targetW = origW;
      let targetH = origH;

      if (expandRatio === '原始比例') {
        targetW = Math.round(origW * expandScale);
        targetH = Math.round(origH * expandScale);
      } else {
        const [rw, rh] = expandRatio.split(':').map(Number);
        const targetRatio = rw / rh;
        const origRatio = origW / origH;
        // Target canvas must contain original image, expand in the short direction
        if (origRatio >= targetRatio) {
          // Original is wider than target ratio → expand height
          targetW = origW;
          targetH = Math.round(origW / targetRatio);
        } else {
          // Original is taller than target ratio → expand width
          targetH = origH;
          targetW = Math.round(origH * targetRatio);
        }
        // Apply scale multiplier
        targetW = Math.max(origW, Math.round(targetW * expandScale));
        targetH = Math.max(origH, Math.round(targetH * expandScale));
      }

      // 保存当前编辑图片引用（exitEditMode后state会清空）
      const currentEditImg = { ...editImg };

      // Processing frame size matches the target expanded size (in display coords)
      const displayTargetW = currentEditImg.width * (targetW / origW);
      const displayTargetH = currentEditImg.height * (targetH / origH);
      const placeholderId = createProcessingFrameRightOf(
        currentEditImg,
        '扩展中',
        displayTargetW,
        displayTargetH,
        '正在创建扩图任务...'
      );
      // 立即退出编辑模式，让进度在右侧处理框中显示（而非覆盖当前图片）
      exitEditMode();
      try {
        const model = getCurrentModel();
        updateProcessingFrame(placeholderId, { progress: 16, status: '正在提交扩展比例...' });
        const res = await fetch('/api/image-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'outpaint',
            imageUrl: currentEditImg.url,
            expandRatio,
            expandScale,
            aspectRatio: `${origW}:${origH}`,
            prompt: editPrompt || undefined,
            model,
            apiKey,
          }),
        });

        const data = await res.json();
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
          alert('扩展超时，请重试');
          removeProcessingFrame(placeholderId);
        }
      } catch (e) {
        console.error('Expand error:', e);
        alert('操作失败，请重试');
        removeProcessingFrame(placeholderId);
      }

      return;
    }

    exitEditMode();
  }, [editMode, editImageId, images, editStrokes, editPrompt, maskKeyword, expandRatio, expandScale, img2imgKeyword, img2imgStrengths, img2imgActiveCategories, img2imgNegativePrompt, brushSize, zoom, cropRect, onImagesChange, getApiKey, getCurrentModel, renderMaskFromStrokes, pollForResult, exitEditMode, viewOffset, createProcessingFrameRightOf, updateProcessingFrame, completeProcessingFrame, removeProcessingFrame]);

  // Mask keyword confirm
  // Download handlers
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
      // PNG format
      const response = await fetch(image.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${image.prompt?.substring(0, 30) || 'image'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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

  // Action toolbar items
  const imageActions = [
    { icon: <ZoomIn size={14} />, label: '放大', desc: '智能补细节放大，变大变高清，不改内容', action: handleOpenUpscale },
    { icon: <Eraser size={14} />, label: '移除背景', desc: '一键删除背景，只剩透明底主体', action: handleRemoveBackground },
    { icon: <ArrowUpFromLine size={14} />, label: '矢量化', desc: '转换为SVG矢量图', action: handleRasterize },
    { icon: <Paintbrush size={14} />, label: '擦除', desc: '涂抹消除，自动无缝补全画面', action: handleOpenErase },
    { icon: <Wand2 size={14} />, label: '蒙版', desc: '精准遮罩控制，只改露出的区域', action: handleOpenMask },
    { icon: <Layers size={14} />, label: '编辑元素', desc: '按元素分层，独立编辑', action: handleEditElements },
    { icon: <RotateCcw size={14} />, label: '多角度', desc: '多视角生成', action: handleOpenMultiAngle },
    { icon: <Box size={14} />, label: '转3D', desc: '生成3D模型预览', action: handleOpen3D },
    { icon: <Expand size={14} />, label: '扩展', desc: '向四周延伸画面，自动补齐背景', action: handleOpenExpand },
    { icon: <Scissors size={14} />, label: '裁切', desc: '自由/预设比例裁切', action: handleOpenCrop },
    { icon: <ImagePlus size={14} />, label: '图生图', desc: '基于当前图生成新图', action: () => { if (selectedImage) setEditImageId(selectedImage.id); setEditMode('img2img'); } },
    { icon: <Download size={14} />, label: '下载', desc: 'PNG/SVG/PSD下载', action: handleOpenDownload },
  ];

  // Canvas right-click menu items
  const canvasMenuItems = [
    { label: '粘贴', shortcut: 'Ctrl+V', action: () => {} },
    { label: '放大', shortcut: 'Ctrl++', action: () => { setZoom(z => Math.min(5, z * 1.2)); } },
    { label: '缩小', shortcut: 'Ctrl+-', action: () => { setZoom(z => Math.max(0.1, z / 1.2)); } },
    { label: '显示所有元素', shortcut: 'Shift+1', action: () => { if (images.length === 0) return; const minX = Math.min(...images.map(i => i.x)); const minY = Math.min(...images.map(i => i.y)); const maxX = Math.max(...images.map(i => i.x + i.width)); const maxY = Math.max(...images.map(i => i.y + i.height)); setViewOffset({ x: -minX * zoom + 50, y: -minY * zoom + 50 }); } },
    { label: '缩放至100%', shortcut: 'Ctrl+0', action: () => { setZoom(1); setViewOffset({ x: 0, y: 0 }); } },
  ];

  const imageContextMenuItems = selectedIds.size > 1 ? [
    { label: '创建组', shortcut: '', action: () => { handleCreateGroup(); } },
    { label: '对齐-左', action: () => { const minX = Math.min(...[...selectedIds].map(id => images.find(i => i.id === id)?.x || 0)); onImagesChange(images.map(i => selectedIds.has(i.id) ? { ...i, x: minX } : i)); } },
    { label: '对齐-右', action: () => { const ids = [...selectedIds]; const maxX = Math.max(...ids.map(id => { const img = images.find(i => i.id === id); return img ? img.x + img.width : 0; })); onImagesChange(images.map(i => { if (!selectedIds.has(i.id)) return i; const img = images.find(ii => ii.id === i.id); return img ? { ...i, x: maxX - img.width } : i; })); } },
    { label: '对齐-上', action: () => { const minY = Math.min(...[...selectedIds].map(id => images.find(i => i.id === id)?.y || 0)); onImagesChange(images.map(i => selectedIds.has(i.id) ? { ...i, y: minY } : i)); } },
    { label: '对齐-下', action: () => { const ids = [...selectedIds]; const maxY = Math.max(...ids.map(id => { const img = images.find(i => i.id === id); return img ? img.y + img.height : 0; })); onImagesChange(images.map(i => { if (!selectedIds.has(i.id)) return i; const img = images.find(ii => ii.id === i.id); return img ? { ...i, y: maxY - img.height } : i; })); } },
    { label: '等间距', action: () => {} },
  ] : [
    { label: '复制', shortcut: 'Ctrl+C', action: () => { const img = selectedImageData; if (img) handleCopyImage(img); } },
    { label: '下载', action: () => { handleOpenDownload(); } },
    ...(selectedImageData?.threeDModelUrl ? [{ label: '3D 预览', action: () => { setViewer3DModelUrl(selectedImageData.threeDModelUrl || ''); setViewer3DPreviewUrl(selectedImageData.url); setViewer3DModelUrls(selectedImageData.threeDModelUrls || {}); setShow3DViewer(true); } }] : []),
    { label: '删除', shortcut: 'Delete', action: () => { onImagesChange(images.filter(i => !selectedIds.has(i.id))); setSelectedIds(new Set()); selectImage(null); } },
    { label: '发送参考图', action: () => { const img = selectedImageData; if (img) onGenerateVariation(img); } },
    { label: '提取关键词', action: () => { const img = selectedImageData; if (img) onExtractKeywords(img); } },
  ];

  const ratioOptions = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'];

  // Floating panel style helpers
  const panelBaseClass = `flex items-center gap-1.5 px-3 py-2 rounded-xl border shadow-xl ${isMonochrome ? 'bg-white/95 border-gray-200' : 'bg-[#1a1a1a]/95 border-[#333] backdrop-blur-sm'}`;
  const panelLabelClass = `text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`;
  const panelSmallLabelClass = `text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`;
  const panelDividerClass = `w-px h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'} mx-1`;
  const panelBtnClass = `px-3 py-1.5 text-xs font-medium bg-[#d4af37] text-black rounded-lg hover:bg-[#e5c049] transition-colors`;
  const panelCancelBtnClass = `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-[#252525] text-[#999] hover:bg-[#333]'}`;
  const panelInputClass = `w-16 px-2 py-1 text-xs rounded-lg border text-center ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-[#111] border-[#333] text-white'}`;

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
        ref={canvasRef}
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
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
            backgroundSize: '20px 20px',
            transform: `translate(${viewOffset.x % 20}px, ${viewOffset.y % 20}px)`,
          }}
        />

        {/* Collapsible toolbar - top left */}
        <div className="absolute top-3 left-3 z-50 group/toolbar">
          {/* Collapsed: only show a small trigger button */}
          <div className="group-hover/toolbar:hidden">
            <button
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium shadow-lg border transition-all ${
                isMonochrome
                  ? 'bg-white/80 border-gray-200/80 text-gray-500'
                  : 'bg-[#1a1a1a]/90 border-[#2a2a2a]/80 text-[#666]'
              }`}
              title="展开工具栏"
            >
              <ChevronRight size={12} />
              <Wrench size={12} />
            </button>
          </div>
          {/* Expanded: show all buttons */}
          <div className="hidden group-hover/toolbar:flex flex-col gap-1.5 min-w-[140px]">
            {/* OMP Toggle */}
            <button
              onClick={() => {
                if (onToggleVisionPrompt) onToggleVisionPrompt();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg border ${
                ohMyPromptOpen
                  ? 'bg-[#d4af37]/20 border-[#d4af37]/50 text-[#d4af37] hover:bg-[#d4af37]/30'
                  : isMonochrome
                    ? 'bg-white/80 border-gray-200/80 text-gray-500 hover:text-gray-700 hover:bg-white/90'
                    : 'bg-[#1a1a1a]/90 border-[#2a2a2a]/80 text-[#666] hover:text-[#999] hover:bg-[#222]'
              }`}
              title="Oh My Prompt - 提示词管理与图片识词"
            >
              <Sparkles className={`h-3 w-3 ${ohMyPromptOpen ? 'text-[#d4af37]' : ''}`} />
              <span>Oh My Prompt</span>
              {ohMyPromptOpen && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
              )}
            </button>
            {/* Ctrl+Click Reference Fusion Toggle */}
            <button
              onClick={() => setShowRefFusion(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg border ${
                showRefFusion
                  ? 'bg-[#d4af37]/20 border-[#d4af37]/50 text-[#d4af37] hover:bg-[#d4af37]/30'
                  : isMonochrome
                    ? 'bg-white/80 border-gray-200/80 text-gray-500 hover:text-gray-700 hover:bg-white/90'
                    : 'bg-[#1a1a1a]/90 border-[#2a2a2a]/80 text-[#666] hover:text-[#999] hover:bg-[#222]'
              }`}
              title="Ctrl+Click 画布图片选择参考融合"
            >
              <GitMerge className={`h-3 w-3 ${showRefFusion ? 'text-[#d4af37]' : ''}`} />
              <span>参考融合</span>
              {showRefFusion && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
              )}
            </button>
            {/* Divider */}
            <div className={`h-px ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'}`} />
            {/* Settings */}
            <button
              onClick={onToggleSettings}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg border ${
                isMonochrome
                  ? 'bg-white/80 border-gray-200/80 text-gray-500 hover:text-gray-700 hover:bg-white/90'
                  : 'bg-[#1a1a1a]/90 border-[#2a2a2a]/80 text-[#666] hover:text-[#999] hover:bg-[#222]'
              }`}
              title="设置"
            >
              <Settings className="h-3 w-3" />
              <span>设置</span>
              {!isPanelCollapsed && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
              )}
            </button>
            {/* UI Theme Toggle */}
            <button
              onClick={onToggleTheme}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg border ${
                isMonochrome
                  ? 'bg-white/80 border-gray-200/80 text-gray-500 hover:text-gray-700 hover:bg-white/90'
                  : 'bg-[#1a1a1a]/90 border-[#2a2a2a]/80 text-[#666] hover:text-[#999] hover:bg-[#222]'
              }`}
              title="UI 主题切换"
            >
              <Palette className="h-3 w-3" />
              <span>{isMonochrome ? '彩色模式' : '黑白模式'}</span>
            </button>
            {/* User Manager */}
            <button
              onClick={onToggleUserManager}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg border ${
                isMonochrome
                  ? 'bg-white/80 border-gray-200/80 text-gray-500 hover:text-gray-700 hover:bg-white/90'
                  : 'bg-[#1a1a1a]/90 border-[#2a2a2a]/80 text-[#666] hover:text-[#999] hover:bg-[#222]'
              }`}
              title="用户管理"
            >
              <Users className="h-3 w-3" />
              <span>用户管理</span>
            </button>
            {/* Project Data */}
            <button
              onClick={onToggleProjectData}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg border ${
                isMonochrome
                  ? 'bg-white/80 border-gray-200/80 text-gray-500 hover:text-gray-700 hover:bg-white/90'
                  : 'bg-[#1a1a1a]/90 border-[#2a2a2a]/80 text-[#666] hover:text-[#999] hover:bg-[#222]'
              }`}
              title="项目数据"
            >
              <FolderOpen className="h-3 w-3" />
              <span>项目数据</span>
            </button>
            {isAdmin && (
              <button
                onClick={onToggleAdminSystem}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg border ${
                  isMonochrome
                    ? 'bg-white/80 border-gray-200/80 text-gray-500 hover:text-gray-700 hover:bg-white/90'
                    : 'bg-[#1a1a1a]/90 border-[#d4af37]/30 text-[#d4af37] hover:bg-[#222]'
                }`}
                title="管理员系统"
              >
                <Shield className="h-3 w-3" />
                <span>管理员系统</span>
              </button>
            )}
            {/* Help / Usage Guide */}
            <button
              onClick={onToggleHelp}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg border ${
                isMonochrome
                  ? 'bg-white/80 border-gray-200/80 text-gray-500 hover:text-gray-700 hover:bg-white/90'
                  : 'bg-[#1a1a1a]/90 border-[#2a2a2a]/80 text-[#666] hover:text-[#999] hover:bg-[#222]'
              }`}
              title="使用说明"
            >
              <HelpCircle className="h-3 w-3" />
              <span>使用说明</span>
            </button>
          </div>
        </div>

        {/* Oh My Prompt Panel - floating popup from toolbar */}
        {ohMyPromptOpen && (
          <div className="absolute top-3 left-[52px] z-50 w-[380px] max-h-[calc(100vh-80px)] overflow-hidden rounded-xl border shadow-2xl"
            style={{
              borderColor: isMonochrome ? '#e5e5e5' : '#2a2a2a',
              background: isMonochrome ? '#fff' : '#111',
            }}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b"
              style={{ borderColor: isMonochrome ? '#e5e5e5' : '#2a2a2a' }}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#d4af37]" />
                <span className="font-semibold text-sm" style={{ color: isMonochrome ? '#333' : '#eee' }}>
                  Oh My Prompt
                </span>
              </div>
              <button
                onClick={onCloseOhMyPrompt}
                className="p-1 rounded-md hover:bg-[#2a2a2a]/60 transition-colors"
                style={{ color: isMonochrome ? '#666' : '#999' }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(100vh-130px)]">
              <OhMyPrompt
                isOpen={true}
                onClose={() => onCloseOhMyPrompt?.()}
                onInsertPrompt={(prompt: string) => onInsertPrompt?.(prompt)}
                onVisionPrompt={(url: string) => onVisionPrompt?.(url)}
                isVisionAnalyzing={isVisionAnalyzing}
                themeStyle={ohMyPromptThemeStyle}
                embedded={true}
              />
            </div>
          </div>
        )}

        {/* Alt+Click reference mark hint (top center) */}
        {altKeyHeld && editMode === 'none' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className="px-3 py-1 rounded-full bg-[#d4af37]/90 text-black text-xs font-medium shadow-lg flex items-center gap-1.5">
              <span className="text-xs">Alt+Click</span>
              <span className="opacity-70">标记图片为参考图</span>
            </div>
          </div>
        )}

        {/* Ctrl+Click reference hint (top center) */}
        {ctrlKeyHeld && editMode === 'none' && showRefFusion && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className="px-3 py-1 rounded-full bg-[#d4af37]/90 text-black text-xs font-medium shadow-lg flex items-center gap-1.5">
              <span className="text-xs">Ctrl+Click</span>
              <span className="opacity-70">选择参考图片</span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {images.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-4 max-w-xs">
              <div className={`text-2xl font-light ${isMonochrome ? 'text-gray-400' : 'text-gray-300'}`}>无限画布</div>
              <div className="flex items-center justify-center gap-3 pointer-events-auto">
                <button onClick={() => setShowHelpModal('instructions')} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all border ${isMonochrome ? 'text-gray-600 border-gray-200 hover:text-gray-900 hover:border-gray-400' : 'text-[#888] border-[#2a2a2a] hover:text-[#d4af37] hover:border-[#d4af37]/40'}`}>
                  <Info size={14} /> 操作说明
                </button>
                <button onClick={() => setShowHelpModal('updates')} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all border ${isMonochrome ? 'text-gray-600 border-gray-200 hover:text-gray-900 hover:border-gray-400' : 'text-[#888] border-[#2a2a2a] hover:text-[#d4af37] hover:border-[#d4af37]/40'}`}>
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
                className={`absolute rounded-xl border-2 ${isMonochrome ? 'border-amber-400/60 bg-amber-50/10' : 'border-[#d4af37]/40 bg-[#d4af37]/5'} pointer-events-auto`}
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
                  className={`flex items-center gap-2 px-3 ${isMonochrome ? 'bg-amber-50/80' : 'bg-[#1a1a1a]/90'} rounded-t-lg h-[36px] select-none ${groupDragTarget === group.id && groupDragReadyRef.current ? 'cursor-grabbing' : 'cursor-grab'}`}
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
                      className={`flex-1 text-sm font-medium bg-transparent border-none outline-none ${isMonochrome ? 'text-amber-700' : 'text-[#d4af37]'}`}
                      value={groupEditName}
                      onChange={(e) => setGroupEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGroupEdit(); if (e.key === 'Escape') setEditingGroupId(null); }}
                      onBlur={handleSaveGroupEdit}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={`flex-1 text-sm font-medium truncate ${isMonochrome ? 'text-amber-700' : 'text-[#d4af37]'}`}>
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
                      className={`w-full text-xs bg-transparent border-b outline-none ${isMonochrome ? 'text-gray-500 border-gray-200' : 'text-[#888] border-[#333]'}`}
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
          {images.map(image => {
            const isSelected = selectedIds.has(image.id);
            const isDragging = dragTarget && selectedIds.has(image.id);
            // Hide images belonging to collapsed groups
            const isGroupCollapsed = image.groupId ? (groups.find(g => g.id === image.groupId)?.collapsed ?? false) : false;
            // Apply group drag offset to images in the dragged group
            const isGroupDragging = groupDragTarget && image.groupId === groupDragTarget;
            return (
              <div
                key={image.id}
                className={`absolute group z-10 ${isSelected ? 'z-20' : ''} ${editMode !== 'none' && editImageId !== image.id ? 'opacity-30' : ''}`}
                style={{
                  left: image.x + (isDragging ? dragOffset.x : 0) + (isGroupDragging ? groupDragOffset.x : 0),
                  top: image.y + (isDragging ? dragOffset.y : 0) + (isGroupDragging ? groupDragOffset.y : 0),
                  width: image.width,
                  height: image.height,
                  display: isGroupCollapsed ? 'none' : undefined,
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
                    // Alt+Click: mark as numbered reference for creative prompt
                    onAltMarkReference?.(image);
                    return;
                  }
                  if (e.ctrlKey || e.metaKey) {
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(image.id)) {
                        next.delete(image.id);
                      } else {
                        next.add(image.id);
                      }
                      return next;
                    });
                    onReferenceSelect?.(image);
                  } else {
                    setSelectedIds(new Set([image.id]));
                    selectImage(image.id);
                  }
                }}
              >
                {image.isProcessingPlaceholder && image.processing ? (
                  <div className={`relative w-full h-full overflow-hidden border ${isMonochrome ? 'border-gray-200 bg-gray-100' : 'border-[#2a2a2a] bg-[#0f0f0f]'}`}>
                    <img
                      src={image.processing.sourceUrl || image.url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-45 pointer-events-none"
                      draggable={false}
                    />
                    <div className="absolute inset-0 bg-black/45 pointer-events-none" />
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
                              {/* 立方体线框 */}
                              <path d="M20 4 L36 13 L36 27 L20 36 L4 27 L4 13 Z" fill="none" stroke="url(#cubeGrad)" strokeWidth="1.5" opacity="0.8" />
                              <path d="M20 4 L20 18 M20 36 L20 22 M4 13 L18 18 M36 13 L22 18" fill="none" stroke="url(#cubeGrad)" strokeWidth="1" opacity="0.5" />
                              <path d="M20 18 L20 22" fill="none" stroke="#d4af37" strokeWidth="2" opacity="0.9" />
                            </svg>
                            <div className="absolute inset-0 rounded-full bg-[#d4af37]/20 animate-ping" style={{ animationDuration: '2s' }} />
                          </div>
                          <div className="px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-md text-[#d4af37] text-xs font-semibold shadow-lg border border-[#d4af37]/20">
                            {image.processing.label}
                          </div>
                          <div className="w-40 max-w-[75%] h-2 rounded-full bg-white/10 overflow-hidden shadow-inner">
                            <div
                              className="h-full rounded-full transition-all duration-700 ease-out"
                              style={{
                                width: `${image.processing.progress}%`,
                                background: 'linear-gradient(90deg, #d4af37, #f4e18f)',
                                boxShadow: '0 0 8px rgba(212,175,55,0.4)',
                              }}
                            />
                          </div>
                          <div className="text-xs text-white/80 text-center px-3 font-medium">
                            {image.processing.status}
                          </div>
                          <div className="text-xs text-[#d4af37]/70 font-mono">
                            {Math.round(image.processing.progress)}%
                          </div>
                        </>
                      ) : (
                        /* 通用进度UI */
                        <>
                          <div className="px-4 py-2 rounded-full bg-black/45 backdrop-blur-md text-white text-sm font-medium shadow-lg">
                            {image.processing.label}
                          </div>
                          <div className="w-36 max-w-[70%] h-1.5 rounded-full bg-white/15 overflow-hidden">
                            <div
                              className="h-full bg-[#d4af37] rounded-full transition-all duration-500"
                              style={{ width: `${image.processing.progress}%` }}
                            />
                          </div>
                          <div className="text-xs text-white/70 text-center px-3">
                            {image.processing.status} {Math.round(image.processing.progress)}%
                          </div>
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
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#d4af37]/90 text-black font-bold shadow-lg hover:bg-[#d4af37] transition-colors cursor-pointer"
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
                        className={`absolute w-2.5 h-2.5 bg-[#d4af37] rounded-sm pointer-events-auto cursor-${
                          corner === 'tl' ? 'nwse-resize' : corner === 'tr' ? 'nesw-resize' : corner === 'bl' ? 'nesw-resize' : 'nwse-resize'
                        }`}
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
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#d4af37] text-black text-xs font-bold shadow-lg">
                        {refIdx + 1}
                      </span>
                    </div>
                  );
                })()}
                {/* Oh My Prompt - Vision hover sparkles button */}
                {visionPromptEnabled && visionHoverImage?.id === image.id && editMode === 'none' && !isVisionAnalyzing && (
                  <button
                    className="absolute top-2 right-2 z-40 p-1.5 rounded-lg bg-[#d4af37] text-black hover:bg-[#e5c249] transition-all shadow-lg hover:scale-110"
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
                    className="absolute top-2 right-2 z-40 p-1.5 rounded-lg bg-[#d4af37]/80 text-black animate-pulse"
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
                    const imgCenterX = img.x + img.width / 2;
                    const imgCenterY = img.y + img.height / 2;
                    const midX = (imgCenterX + outputCenterX) / 2;

                    return (
                      <g key={`fusion-line-${img.id}`}>
                        <path
                          d={`M ${imgCenterX} ${imgCenterY} C ${midX} ${imgCenterY}, ${midX} ${outputCenterY}, ${outputCenterX} ${outputCenterY}`}
                          fill="none"
                          stroke="#d4af37"
                          strokeWidth={2 / zoom}
                          strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                          opacity={0.7}
                        />
                        {/* Arrow head at output end */}
                        <polygon
                          points={`${outputCenterX},${outputCenterY} ${outputCenterX - 8 / zoom},${outputCenterY - 5 / zoom} ${outputCenterX - 8 / zoom},${outputCenterY + 5 / zoom}`}
                          fill="#d4af37"
                          opacity={0.7}
                        />
                        {/* Number label on line */}
                        <circle
                          cx={imgCenterX + (outputCenterX - imgCenterX) * 0.3}
                          cy={imgCenterY + (outputCenterY - imgCenterY) * 0.3}
                          r={10 / zoom}
                          fill="#d4af37"
                          opacity={0.85}
                        />
                        <text
                          x={imgCenterX + (outputCenterX - imgCenterX) * 0.3}
                          y={imgCenterY + (outputCenterY - imgCenterY) * 0.3}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#000"
                          fontSize={11 / zoom}
                          fontWeight="bold"
                        >
                          {img.refNumber}
                        </text>
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
                    <span className="text-[#d4af37]/60 text-xs font-medium">
                      融合输出
                    </span>
                    <span className="text-[#d4af37]/40 text-xs">
                      {refImages.map(r => `#${r.refNumber}`).join(' + ')} →
                    </span>
                  </div>
                </div>
              </>
            );
          })()}
        </div>

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
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-[#d4af37] text-black text-xs font-medium rounded whitespace-nowrap">
                    {Math.round(cropRect.w / zoom)} x {Math.round(cropRect.h / zoom)}
                  </div>
                  {/* Corner drag handles */}
                  {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
                    <div
                      key={c}
                      className="absolute w-3 h-3 bg-[#d4af37] rounded-full cursor-nwse-resize"
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
                <ZoomIn size={14} className="text-[#d4af37]" />
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
                      isMonochrome ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-[#252525] text-[#ccc] hover:bg-[#333]'
                    }`}
                  >
                    {upscalePreset === '2k' ? '2×' : upscalePreset === '4k' ? '4×' : '8×'}
                    <ChevronDown size={10} />
                  </button>
                  {showUpscalePresetMenu && (
                    <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 min-w-[100px] ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#333]'}`}>
                      {(['2k', '4k', '8k'] as const).map(p => {
                        const pMul = p === '2k' ? 2 : p === '4k' ? 4 : 8;
                        const pTarget = getUpscaleTargetDimensions(origW, origH, p);
                        return (
                          <button key={p} onClick={(e) => { e.stopPropagation(); setUpscalePreset(p); setShowUpscalePresetMenu(false); }} className={`w-full px-3 py-1.5 text-xs text-left flex items-center justify-between hover:bg-[#d4af37]/10 ${upscalePreset === p ? 'text-[#d4af37]' : isMonochrome ? 'text-gray-600' : 'text-[#ccc]'}`}>
                            <span>{pMul}× <span className="opacity-60 ml-1">{pTarget.w}×{pTarget.h}</span></span>
                            {upscalePreset === p && <span className="text-[#d4af37]">✓</span>}
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
                      ? 'bg-[#333] text-[#555] cursor-not-allowed'
                      : 'bg-[#d4af37] text-black hover:bg-[#e5c047] active:scale-95'
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
                className={`relative rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-gray-100 border-gray-300' : 'bg-[#1a1a1a] border-[#2a2a2a]'}`}
                style={{ width: winW, height: winH, cursor: 'default' }}
              >
                {/* Title bar */}
                <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#2a2a2a] bg-[#111]'}`}>
                  <div className="flex items-center gap-2">
                    {isErase ? <Paintbrush size={14} className="text-[#d4af37]" /> : <Wand2 size={14} className="text-[#d4af37]" />}
                    <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>
                      {isErase ? '擦除' : '蒙版修图'}
                    </span>
                    <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>
                      涂抹区域后点击&apos;开始修复&apos; · Shift+左键擦除涂抹
                    </span>
                  </div>
                  <button onClick={exitEditMode} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-[#666] hover:text-white hover:bg-[#333]'}`}>
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
                    <div className={`absolute bottom-3 left-3 flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${isMonochrome ? 'bg-white/80 text-gray-600' : 'bg-[#111]/80 text-[#999]'}`} style={{ cursor: 'default' }}>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(z => Math.max(0.25, z / 1.2)); }} className="p-0.5 hover:text-[#d4af37]"><Minus size={12} /></button>
                      <span className="w-10 text-center tabular-nums">{Math.round(editCanvasZoom * 100)}%</span>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(z => Math.min(5, z * 1.2)); }} className="p-0.5 hover:text-[#d4af37]"><Plus size={12} /></button>
                      <button onClick={(e) => { e.stopPropagation(); setEditCanvasZoom(1); setEditCanvasPan({ x: 0, y: 0 }); }} className="p-0.5 hover:text-[#d4af37]"><Maximize2 size={12} /></button>
                    </div>
                    </div>

                  {/* Right: Sidebar controls */}
                  <div className={`flex flex-col border-l ${isMonochrome ? 'border-gray-200 bg-white' : 'border-[#2a2a2a] bg-[#111]'}`} style={{ width: sidebarW }}>
                    {/* Brush mode toggle */}
                    <div className="px-3 pt-3 pb-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditBrushMode('brush')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-all ${
                            editBrushMode === 'brush'
                              ? 'bg-[#d4af37] text-black font-medium'
                              : isMonochrome
                                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : 'bg-[#252525] text-[#999] hover:bg-[#333]'
                          }`}
                        >
                          <Paintbrush size={12} />
                          画笔
                        </button>
                        <button
                          onClick={() => setEditBrushMode('eraser')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-all ${
                            editBrushMode === 'eraser'
                              ? 'bg-[#d4af37] text-black font-medium'
                              : isMonochrome
                                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : 'bg-[#252525] text-[#999] hover:bg-[#333]'
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
                              : 'bg-[#252525] text-[#999] hover:bg-[#333]'
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
                              : 'bg-[#252525] text-[#999] hover:bg-[#333]'
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
                              : 'bg-[#0a0a0a] border-[#2a2a2a] text-white placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30'
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
                            ? 'bg-[#333] text-[#555] cursor-not-allowed'
                            : 'bg-[#d4af37] text-black hover:bg-[#e5c047] active:scale-[0.98]'
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
                <div className={panelBaseClass} style={{ minWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
                  <Expand size={14} className="text-[#d4af37]" />
                  <span className={panelLabelClass}>扩图</span>
                  <div className={panelDividerClass} />
                  {/* 缩放比例 */}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowExpandScaleMenu(!showExpandScaleMenu); }}
                      className={`px-2 py-1 text-xs rounded-md transition-all flex items-center gap-1 ${
                        isMonochrome
                          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-[#252525] text-[#999] hover:bg-[#333]'
                      }`}
                    >
                      {expandScale}x
                      <ChevronDown size={10} />
                    </button>
                    {showExpandScaleMenu && (
                      <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 min-w-[80px] ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#333]'}`}>
                        {[1, 1.5, 2, 3, 4].map(s => (
                          <button key={s} onClick={(e) => { e.stopPropagation(); setExpandScale(s as number); setShowExpandScaleMenu(false); }} className={`w-full px-3 py-1.5 text-xs text-left flex items-center justify-between hover:bg-[#d4af37]/10 ${expandScale === s ? 'text-[#d4af37]' : isMonochrome ? 'text-gray-600' : 'text-[#ccc]'}`}>
                            <span>{s}x</span>
                            {expandScale === s && <span className="text-[#d4af37]">✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={panelDividerClass} />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setExpandRatio('原始比例')}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        expandRatio === '原始比例'
                          ? 'bg-[#d4af37] text-black font-medium'
                          : isMonochrome
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            : 'bg-[#252525] text-[#999] hover:bg-[#333]'
                      }`}
                    >
                      原始比例
                    </button>
                    {ratioOptions.slice(0, 4).map(r => (
                      <button
                        key={r}
                        onClick={() => setExpandRatio(r)}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${
                          expandRatio === r
                            ? 'bg-[#d4af37] text-black font-medium'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-[#252525] text-[#999] hover:bg-[#333]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowExpandRatios(!showExpandRatios); }}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-[#252525] text-[#999] hover:bg-[#333]'}`}
                      >
                        <ChevronDown size={10} />
                      </button>
                      {showExpandRatios && (
                        <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#333]'}`}>
                          {ratioOptions.slice(5).map(r => (
                            <button key={r} onClick={(e) => { e.stopPropagation(); setExpandRatio(r); setShowExpandRatios(false); }} className={`w-full px-3 py-1.5 text-xs text-left hover:bg-[#d4af37]/10 ${expandRatio === r ? 'text-[#d4af37]' : isMonochrome ? 'text-gray-600' : 'text-[#ccc]'}`}>
                              {r} {expandRatio === r && '✓'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={panelDividerClass} />
                  <button onClick={handleEditConfirm} className={panelBtnClass}>确认扩展</button>
                  <button onClick={exitEditMode} className={panelCancelBtnClass}>取消</button>
                </div>
              )}

              {/* CROP toolbar */}
              {editMode === 'crop' && (
                <div className={panelBaseClass} style={{ minWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
                  <Scissors size={14} className="text-[#d4af37]" />
                  <span className={panelLabelClass}>裁切</span>
                  <div className={panelDividerClass} />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCropRatio('free')}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        cropRatio === 'free'
                          ? 'bg-[#d4af37] text-black font-medium'
                          : isMonochrome
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            : 'bg-[#252525] text-[#999] hover:bg-[#333]'
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
                            ? 'bg-[#d4af37] text-black font-medium'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-[#252525] text-[#999] hover:bg-[#333]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowCropRatios(!showCropRatios); }}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-[#252525] text-[#999] hover:bg-[#333]'}`}
                      >
                        <ChevronDown size={10} />
                      </button>
                      {showCropRatios && (
                        <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg border shadow-xl z-50 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#333]'}`}>
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
        {editMode === 'img2img' && selectedImageData && (() => {
          const pos = getToolbarPosition();
          const categories = IMG2IMG_CATEGORIES.map(c => c.key);
          const placeholderHints: Record<string, string> = Object.fromEntries(
            IMG2IMG_CATEGORIES.map(c => [c.key, c.placeholder])
          );
          const activeCategories = img2imgActiveCategories;
          return (
            <div
              className="absolute z-50 pointer-events-auto"
              data-toolbar="img2img"
              style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div
                className="flex flex-col items-stretch gap-2 p-3 min-w-[300px] rounded-xl border shadow-2xl"
                style={{ background: '#1a1a1a', borderColor: '#d4af3740', borderWidth: '1px' }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center gap-2">
                  <ImagePlus size={14} style={{ color: '#d4af37' }} />
                  <span className="text-xs font-semibold text-[#d4af37]">图生图</span>
                  <span className="text-xs ml-auto text-gray-500">Esc 退出</span>
                </div>

                {/* Category Rows with toggle + strength */}
                <div className="flex flex-col gap-1">
                  {categories.map(cat => {
                    const strength = img2imgStrengths[cat] ?? 50;
                    const isActive = activeCategories.has(cat);
                    return (
                      <div key={cat} className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all" style={{ background: isActive ? '#252520' : 'transparent' }}>
                        {/* Toggle Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setImg2imgActiveCategories(prev => {
                              const next = new Set(prev);
                              if (next.has(cat)) {
                                next.delete(cat);
                              } else {
                                next.add(cat);
                                // 激活时设置默认强度为50%
                                if ((img2imgStrengths[cat] ?? 0) === 0) {
                                  setImg2imgStrengths(prev2 => ({ ...prev2, [cat]: 50 }));
                                }
                              }
                              return next;
                            });
                          }}
                          className="px-2 py-0.5 text-xs rounded-md transition-all font-medium shrink-0 border"
                          style={{
                            background: isActive ? '#d4af37' : 'transparent',
                            color: isActive ? '#000' : '#888',
                            borderColor: isActive ? '#d4af37' : '#555',
                          }}
                        >
                          {cat}
                        </button>
                        {/* Strength Slider */}
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={strength}
                          onChange={(e) => {
                            e.stopPropagation();
                            setImg2imgStrengths(prev => ({ ...prev, [cat]: Number(e.target.value) }));
                          }}
                          onClick={(e) => e.stopPropagation()}
                          disabled={!isActive}
                          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                          style={{
                            accentColor: '#d4af37',
                            opacity: isActive ? 1 : 0.3,
                            background: `linear-gradient(to right, #d4af37 ${strength}%, #444 ${strength}%)`,
                          }}
                        />
                        <span className="text-xs font-mono w-8 text-right shrink-0" style={{ color: isActive ? '#d4af37' : '#555' }}>{strength}%</span>
                      </div>
                    );
                  })}
                </div>

                {/* Keyword Input with resize handle */}
                <div className="relative">
                  <textarea
                    value={img2imgKeyword}
                    onChange={(e) => setImg2imgKeyword(e.target.value)}
                    placeholder="输入关键词描述你想要的效果，如：蒙娜丽莎"
                    rows={2}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border-none outline-none focus:ring-1 focus:ring-[#d4af37]/50 resize-y min-h-[36px] max-h-[120px]"
                    style={{ background: '#252520', color: '#e0e0e0' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
                        e.preventDefault();
                        handleEditConfirm();
                      }
                    }}
                  />
                </div>

                {/* Quick action buttons */}
                <div className="flex gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selectedImageData?.prompt) setImg2imgKeyword(selectedImageData.prompt);
                    }}
                    className="flex-1 py-1 text-xs rounded-lg transition-all text-left px-2 truncate"
                    style={{ background: '#252520', color: '#999', borderLeft: '2px solid #d4af37' }}
                    onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.color = '#d4af37'; }}
                    onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.color = '#999'; }}
                  >
                    当前图片描述
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setImg2imgShowNegative(prev => !prev);
                      if (!img2imgShowNegative && !img2imgNegativePrompt) {
                        setImg2imgNegativePrompt('低质量, 模糊, 变形, 畸形, 水印, 文字, 签名, 截图, 压缩伪影');
                      }
                    }}
                    className="flex-1 py-1 text-xs rounded-lg transition-all text-left px-2 truncate"
                    style={{ background: '#252520', color: img2imgShowNegative ? '#d4af37' : '#999', borderLeft: img2imgShowNegative ? '2px solid #d4af37' : '2px solid #555' }}
                    onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.color = '#d4af37'; }}
                    onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.color = img2imgShowNegative ? '#d4af37' : '#999'; }}
                  >
                    反向提示词
                  </button>
                </div>

                {/* Negative prompt input (collapsible) */}
                {img2imgShowNegative && (
                  <div className="relative">
                    <textarea
                      value={img2imgNegativePrompt}
                      onChange={(e) => setImg2imgNegativePrompt(e.target.value)}
                      placeholder="输入不想出现的元素，如: 模糊, 变形, 水印..."
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border-none outline-none focus:ring-1 focus:ring-red-500/50 resize-y min-h-[36px] max-h-[120px]"
                      style={{ background: '#252520', color: '#e0e0e0', borderLeft: '2px solid #ef4444' }}
                    />
                  </div>
                )}

                {/* Generate Button */}
                <button
                  onClick={handleEditConfirm}
                  className="w-full py-1.5 text-xs rounded-lg font-medium transition-all"
                  style={{ background: '#d4af37', color: '#000' }}
                  onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = '#c4a030'; }}
                  onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = '#d4af37'; }}
                >
                  生成
                </button>
              </div>
            </div>
          );
        })()}


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
                    <RotateCcw size={14} className="text-[#d4af37]" />
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

                <div className={`grid grid-cols-2 gap-1 p-1 rounded-xl ${isMonochrome ? 'bg-gray-100' : 'bg-[#111]'}`}>
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
                          : isMonochrome ? 'text-gray-500 hover:text-gray-800' : 'text-[#888] hover:text-white'
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
                          transform: `rotateX(${-multiAngleTilt * 0.6}deg) rotateY(${multiAngleRotation * 1.2}deg)`,
                          transition: isMultiAngleDragging ? 'none' : 'transform 0.15s ease-out',
                        }}
                      >
                        {/* Front face - main image */}
                        <div className="absolute inset-0 rounded-lg overflow-hidden border-2 border-[#d4af37]/60 shadow-[0_0_20px_rgba(212,175,55,0.3)]" style={{ transform: 'translateZ(55px)', backfaceVisibility: 'hidden' }}>
                          <img src={selectedImageData.url} alt="front" className="w-full h-full object-cover" />
                        </div>
                        {/* Back face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-200 border-gray-300' : 'bg-[#1a1a1a] border-[#333]'}`} style={{ transform: 'rotateY(180deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#555]'}`}>背面</span>
                        </div>
                        {/* Right face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-[#2a2a2a]'}`} style={{ transform: 'rotateY(90deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>右侧</span>
                        </div>
                        {/* Left face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-[#2a2a2a]'}`} style={{ transform: 'rotateY(-90deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>左侧</span>
                        </div>
                        {/* Top face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-[#2a2a2a]'}`} style={{ transform: 'rotateX(90deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>顶部</span>
                        </div>
                        {/* Bottom face */}
                        <div className={`absolute inset-0 rounded-lg border flex items-center justify-center ${isMonochrome ? 'bg-gray-100 border-gray-200' : 'bg-[#151515] border-[#2a2a2a]'}`} style={{ transform: 'rotateX(-90deg) translateZ(55px)' }}>
                          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#444]'}`}>底部</span>
                        </div>
                      </div>
                      {/* Perspective hint label */}
                      <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs ${isMonochrome ? 'bg-white/80 text-gray-500 border border-gray-200' : 'bg-black/60 text-[#aaa] border border-white/10'}`}>
                        {Math.abs(multiAngleRotation) < 10 && Math.abs(multiAngleTilt) < 10 ? '正面' :
                         multiAngleRotation > 60 ? '左侧' : multiAngleRotation < -60 ? '右侧' :
                         multiAngleTilt > 25 ? '俯视' : multiAngleTilt < -25 ? '仰视' : '斜视'}
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

                <div className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${isMonochrome ? 'bg-gray-50 text-gray-500' : 'bg-[#0a0a0a] text-[#888]'}`}>
                  {multiAngleMode === 'image'
                    ? '主体模式：拖动立方体或调整滑块设定角度，AI 会推断隐藏侧面并生成转角后的摄影棚图。'
                    : '摄像头模式：拖动球体或调整滑块设定视角，AI 会移动虚拟相机生成新机位、俯仰和推进效果。'}
                </div>

                {([
                  { label: multiAngleMode === 'camera' ? '旋转' : '旋转', value: multiAngleRotation, min: -90, max: 90, step: 1, onChange: setMultiAngleRotation },
                  { label: multiAngleMode === 'camera' ? '俯仰' : '倾斜', value: multiAngleTilt, min: -45, max: 45, step: 1, onChange: setMultiAngleTilt },
                ]).map(item => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={panelLabelClass}>{item.label}</span>
                      <span className={panelSmallLabelClass}>{item.value}</span>
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
                    <span className={panelSmallLabelClass}>{multiAngleZoom < 0.9 ? '远' : multiAngleZoom > 1.1 ? '近' : '中等'}</span>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={1.5}
                    step={0.01}
                    value={multiAngleZoom}
                    onChange={(e) => setMultiAngleZoom(Number(e.target.value))}
                    className="w-full accent-[#d4af37]"
                  />
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
                  <Download size={14} className="text-[#d4af37]" />
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
                          ? (isMonochrome ? 'bg-[#d4af37]/10 border border-[#d4af37]/30' : 'bg-[#d4af37]/10 border border-[#d4af37]/30')
                          : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-gray-100' : 'bg-[#111] hover:bg-[#1a1a1a] border border-[#2a2a2a]')
                      }`}
                    >
                      <div>
                        <div className={`text-xs font-medium ${isMonochrome ? 'text-gray-800' : 'text-white'}`}>{item.label}</div>
                        <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{item.desc}</div>
                      </div>
                      {downloadFormat === item.format && <Check size={12} className="text-[#d4af37]" />}
                    </button>
                  ))}
                </div>

                {/* SVG Mode Selection */}
                {downloadFormat === 'svg' && (
                  <div className={`flex flex-col gap-1 pt-1 border-t ${isMonochrome ? 'border-gray-100' : 'border-[#2a2a2a]'}`}>
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
                            ? (isMonochrome ? 'bg-[#d4af37]/10 border border-[#d4af37]/30' : 'bg-[#d4af37]/10 border border-[#d4af37]/30')
                            : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-transparent' : 'bg-[#111] hover:bg-[#1a1a1a] border border-transparent')
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>{item.label}</span>
                          <span className={`text-xs ml-1.5 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{item.desc}</span>
                        </div>
                        {svgMode === item.mode && <Check size={10} className="text-[#d4af37]" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* PSD Mode Selection */}
                {downloadFormat === 'psd' && (
                  <div className={`flex flex-col gap-1 pt-1 border-t ${isMonochrome ? 'border-gray-100' : 'border-[#2a2a2a]'}`}>
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
                            ? (isMonochrome ? 'bg-[#d4af37]/10 border border-[#d4af37]/30' : 'bg-[#d4af37]/10 border border-[#d4af37]/30')
                            : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-transparent' : 'bg-[#111] hover:bg-[#1a1a1a] border border-transparent')
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>{item.label}</span>
                          <span className={`text-xs ml-1.5 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{item.desc}</span>
                        </div>
                        {psdMode === item.mode && <Check size={10} className="text-[#d4af37]" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* 3D Format Selection */}
                {downloadFormat === '3d' && selectedImageData?.threeDModelUrls && Object.keys(selectedImageData.threeDModelUrls).length > 0 && (
                  <div className={`flex flex-col gap-1 pt-1 border-t ${isMonochrome ? 'border-gray-100' : 'border-[#2a2a2a]'}`}>
                    <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>模型格式</span>
                    {Object.entries(selectedImageData.threeDModelUrls).map(([format, url]) => (
                      <button
                        key={format}
                        onClick={() => setThreeDDownloadFormat(format)}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all text-left ${
                          threeDDownloadFormat === format
                            ? (isMonochrome ? 'bg-[#d4af37]/10 border border-[#d4af37]/30' : 'bg-[#d4af37]/10 border border-[#d4af37]/30')
                            : (isMonochrome ? 'bg-gray-50 hover:bg-gray-100 border border-transparent' : 'bg-[#111] hover:bg-[#1a1a1a] border border-transparent')
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-medium uppercase ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>{format}</span>
                          <span className={`text-xs ml-1.5 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{format === 'glb' ? 'glTF二进制格式' : format === 'obj' ? 'Wavefront格式' : format === 'stl' ? '3D打印格式' : format === 'fbx' ? 'Autodesk格式' : format === 'usdz' ? 'Apple AR格式' : '3D模型文件'}</span>
                        </div>
                        {threeDDownloadFormat === format && <Check size={10} className="text-[#d4af37]" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Progress */}
                {downloadProgress && (
                  <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${isMonochrome ? 'bg-gray-50' : 'bg-[#111]'}`}>
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
              <div className={`w-[520px] max-h-[86vh] overflow-hidden rounded-2xl border shadow-2xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#111] border-[#2a2a2a]'}`}>
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isMonochrome ? 'border-gray-100' : 'border-[#2a2a2a]'}`}>
                  <div className="flex items-center gap-2">
                    <Box size={16} className="text-[#d4af37]" />
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
                  <div className={`rounded-2xl overflow-hidden flex items-center justify-center p-3 ${isMonochrome ? 'bg-gray-50' : 'bg-[#0a0a0a]'}`}>
                    <img src={selectedImageData.url} alt="3D source" className="max-w-full max-h-[200px] object-contain rounded-lg" />
                  </div>

                  <div className={`grid grid-cols-2 gap-2 p-1 rounded-xl ${isMonochrome ? 'bg-gray-100' : 'bg-[#0a0a0a]'}`}>
                    {([
                      { value: 'api' as const, label: 'API 大模型' },
                      { value: 'local' as const, label: '本地模型' },
                    ]).map(item => (
                      <button
                        key={item.value}
                        onClick={() => setThreeDBackend(item.value)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          threeDBackend === item.value
                            ? 'bg-[#d4af37] text-black'
                            : isMonochrome ? 'text-gray-500 hover:text-gray-900' : 'text-[#777] hover:text-white'
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
                        className={`w-full px-3 py-2 rounded-xl text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a] border-[#2a2a2a] text-white'}`}
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
                        <div className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${isMonochrome ? 'bg-amber-50 text-amber-700' : 'bg-[#d4af37]/10 text-[#d4af37]'}`}>
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
                        className={`w-full px-3 py-2 rounded-xl text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a] border-[#2a2a2a] text-white'}`}
                        placeholder="http://127.0.0.1:7860/api/image-to-3d"
                      />
                      <label className={panelSmallLabelClass}>本地模型</label>
                      <select
                        value={threeDLocalModel}
                        onChange={(e) => setThreeDLocalModel(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a] border-[#2a2a2a] text-white'}`}
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
                      <select value={threeDQuality} onChange={(e) => setThreeDQuality(e.target.value)} className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a] border-[#2a2a2a] text-white'}`}>
                        {threeDCapabilities.qualities.map((q: { value: string; label: string }) => (
                          <option key={q.value} value={q.value}>{q.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={panelSmallLabelClass}>纹理</label>
                      <select value={threeDTexture} onChange={(e) => setThreeDTexture(e.target.value)} className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a] border-[#2a2a2a] text-white'}`}>
                        {threeDCapabilities.textures.map((t: { value: string; label: string }) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={panelSmallLabelClass}>格式</label>
                      <select value={threeDFormat} onChange={(e) => setThreeDFormat(e.target.value)} className={`mt-1 w-full px-2 py-2 rounded-lg text-xs border ${isMonochrome ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-[#0a0a0a] border-[#2a2a2a] text-white'}`}>
                        {threeDCapabilities.formats.map((f: { value: string; label: string }) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {threeDProgress && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${isMonochrome ? 'bg-gray-50 text-gray-600' : 'bg-[#0a0a0a] text-[#aaa]'}`}>
                      <div className="w-3 h-3 rounded-full border-2 border-[#d4af37] border-t-transparent animate-spin" />
                      <span className="text-xs">{threeDProgress}</span>
                    </div>
                  )}
                </div>

                <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${isMonochrome ? 'border-gray-100' : 'border-[#2a2a2a]'}`}>
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
              <div className={`flex items-center gap-0.5 px-1 py-1 rounded-xl border shadow-xl ${isMonochrome ? 'bg-white/95 border-gray-200' : 'bg-[#1a1a1a]/95 border-[#333] backdrop-blur-sm'}`}>
                {imageActions.map((action, idx) => (
                  <div key={idx} className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); action.action(); }}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        isMonochrome
                          ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                          : 'text-[#aaa] hover:text-[#d4af37] hover:bg-[#252525]'
                      }`}
                      title={action.desc || action.label}
                    >
                      {action.icon}
                      <span>{action.label}</span>
                    </button>
                    {idx < imageActions.length - 1 && <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-px h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} style={{ right: '-1px' }} />}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Image context menu */}
        {showContextMenu && (
          <div
            className={`fixed z-50 py-1.5 rounded-xl border shadow-2xl min-w-[160px] ${isMonochrome ? 'bg-white/95 border-gray-200' : 'bg-[#1a1a1a]/95 border-[#333] backdrop-blur-sm'}`}
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
            className={`fixed z-50 py-1.5 rounded-xl border shadow-2xl min-w-[200px] ${isMonochrome ? 'bg-white/95 border-gray-200' : 'bg-[#1a1a1a]/95 border-[#333] backdrop-blur-sm'}`}
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
            <div className={`relative w-[360px] max-h-[70vh] rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#111] border-[#2a2a2a]'}`} onClick={(e) => e.stopPropagation()}>
              <div className={`flex items-center justify-between px-5 py-3.5 border-b ${isMonochrome ? 'border-gray-100' : 'border-[#2a2a2a]'}`}>
                <div className="flex items-center gap-2">
                  {showHelpModal === 'instructions' ? <Info size={16} className={isMonochrome ? 'text-gray-700' : 'text-[#d4af37]'} /> : <FileText size={16} className={isMonochrome ? 'text-gray-700' : 'text-[#d4af37]'} />}
                  <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>{showHelpModal === 'instructions' ? '操作说明' : '更新内容'}</span>
                </div>
                <button onClick={() => setShowHelpModal(null)} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-[#666] hover:text-white hover:bg-[#2a2a2a]'}`}><X size={16} /></button>
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
                    <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]'}`} />
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>图片操作工具栏</div>
                      <div className="space-y-2">
                        {[['放大', '智能补细节，变大变高清'], ['移除背景', '一键去背景，生成透明底图'], ['矢量化', '转换为SVG矢量图'], ['擦除', '画笔涂抹消除，AI自动补全'], ['蒙版', '精准遮罩控制，AI重新生成'], ['编辑元素', '按元素智能分层，独立编辑'], ['多角度', '多视角生成图片'], ['转3D', '生成3D模型预览'], ['扩展', '向四周延伸画面，自动补齐'], ['裁切', '自由/预设比例裁切'], ['图生图', '6大类别参考，基于当前图生成新图'], ['下载', 'PNG/SVG/PSD多格式下载']].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between"><span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{k}</span><span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]'}`} />
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>组与参考图</div>
                      <div className="space-y-2">
                        {[['多图右键', '创建组'], ['组标题栏折叠按钮', '折叠/展开组内容'], ['长按组标题栏拖动', '移动整个组'], ['Alt+左键点击图片', '标记为参考图（紫色R标记）'], ['参考图标记', '自动添加到创意描述文本框'], ['Backspace（光标起始处）', '删除最后一个参考图标记']].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between"><span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{k}</span><span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]'}`} />
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>左上角工具栏</div>
                      <div className="space-y-2">
                        {[['Oh My Prompt', '提示词管理与图片识词'], ['参考融合', 'Ctrl+Click选择参考图融合生成'], ['设置', '应用配置'], ['主题切换', '黑白/彩色模式切换'], ['用户管理', '多用户切换与管理'], ['项目数据', '项目保存与加载'], ['管理员系统', 'API与模型配置（仅管理员）'], ['使用说明', '操作与更新内容']].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between"><span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{k}</span><span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]'}`} />
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-[#d4af37]'}`}>底部工具栏</div>
                      <div className="space-y-2">
                        {[['选择工具', '默认模式，点击/框选图片'], ['抓手工具', '平移画布'], ['图片上传', '上传本地图片到画布'], ['图像生成器', 'AI图像生成（金色按钮）'], ['图层', '打开Layer Graph设计工程'], ['缩放控制', '放大/缩小/百分比/重置视图']].map(([k, v]) => (
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
                        '12大图片工具：放大/移除背景/矢量化/擦除/蒙版/编辑元素/多角度/转3D/扩展/裁切/图生图/下载',
                        '放大：智能补细节把图片变大变高清，不改画面内容',
                        '移除背景：一键删除背景，生成透明底主体图',
                        '矢量化：调用管理员配置的矢量模型API，转换为SVG矢量图',
                        '擦除：画笔涂抹消除 + AI自动补全画面，Alt键反向涂抹',
                        '蒙版：精准遮罩控制 + AI重新生成指定区域',
                        '编辑元素：根据图片元素进行智能分层，独立编辑',
                        '多角度：多视角生成图片',
                        '转3D：生成3D模型并可在线预览旋转',
                        '扩展：比例预设 + AI向四周延伸画面',
                        '图生图：6大类别参考（风格/构图/场景/色彩/主体/细节），每类独立强度控制',
                        'Alt+Click标记参考图：标记画布图片为参考图，自动添加到创意描述',
                        'Ctrl+Click参考融合：选择画布图片直接融合生成',
                        '组功能：多图右键创建组，支持折叠/展开，长按标题栏拖动',
                        '框选：左键拖拽空白区域直接框选，显示选择矩形',
                        'Ctrl+Z无限撤回：纯ref同步管理，流畅操作',
                        '右键菜单：图片右键可复制/下载/发送参考图/提取关键词',
                        '下载：PNG/SVG/PSD三种格式，PSD支持Basic/Pro/Studio模式',
                        '服务器端API密钥管理：管理员统一配置，用户无需输入Key',
                        '通用模型类型：API管理支持通用模型，自动识别所有可用模型',
                        '高级参数与连接测试：添加固定API时支持高级参数和测试连接',
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
                : 'bg-gradient-to-b from-[#181818] to-[#111111] border-[#2a2a2a] shadow-[0_8px_32px_rgba(0,0,0,0.6)]'
            }`}>
              {/* Header */}
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${
                isMonochrome ? 'border-gray-100' : 'border-[#2a2a2a]'
              }`}>
                <div className="flex items-center gap-2.5">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                    isMonochrome ? 'bg-amber-100' : 'bg-[#d4af37]/15'
                  }`}>
                    <Sparkles size={13} className="text-[#d4af37]" />
                  </div>
                  <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>图像生成器</span>
                </div>
                <button
                  onClick={handleOpenCanvasGenerator}
                  className={`p-1.5 rounded-lg transition-colors ${isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-[#555] hover:text-white hover:bg-[#2a2a2a]'}`}
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
                        : 'bg-[#0d0d0d] border-[#333] text-[#ddd] focus:border-[#d4af37]/40'
                    }`}
                  >
                    {canvasGenModels.length === 0 && <option value="">暂无可用模型</option>}
                    {canvasGenModels.map(m => (
                      <option key={m.id} value={m.id}>{m.id}{m.providerName ? ` (${m.providerName})` : ''}</option>
                    ))}
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
                        : 'bg-[#0d0d0d] border-[#333] text-[#ddd] focus:border-[#d4af37]/40'
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
                        : 'bg-[#0d0d0d] border-[#333] text-[#ddd] focus:border-[#d4af37]/40'
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
                            ? 'bg-gradient-to-b from-[#d4af37] to-[#b8860b] text-black shadow-md shadow-[#d4af37]/20'
                            : isMonochrome
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                              : 'bg-[#1a1a1a] text-[#888] hover:bg-[#252525] border border-[#333]'
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
                        : 'text-[#888] hover:bg-[#1a1a1a] hover:text-[#bbb] border-[#333]'
                    }`}
                  >
                    <ImagePlus size={12} />
                    <span>参考图</span>
                    {canvasGenRefImages.length > 0 && <span className="text-[#d4af37] font-medium">({canvasGenRefImages.length})</span>}
                  </button>
                </div>

                {/* Reference images thumbnails */}
                {canvasGenRefImages.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {canvasGenRefImages.map((refUrl, idx) => (
                      <div key={idx} className="relative group">
                        <img src={refUrl} alt="" className={`w-9 h-9 rounded-lg object-cover border ${isMonochrome ? 'border-gray-200' : 'border-[#333]'}`} />
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
                      : 'bg-[#0d0d0d] border-[#333] text-[#ddd] placeholder:text-[#555] focus:border-[#d4af37]/40'
                  } focus:ring-1 focus:ring-[#d4af37]/20`}
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
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-[#222] text-[#555] cursor-not-allowed border border-[#333]'
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
      <div className={`absolute bottom-5 left-1/2 -translate-x-1/2 z-50 backdrop-blur-md border rounded-2xl px-3 py-2 flex items-center gap-1.5 shadow-2xl ${
        isMonochrome 
          ? 'bg-white/90 border-gray-200/80 shadow-gray-200/50' 
          : 'bg-[#141414]/90 border-[#2a2a2a]/80 shadow-black/50'
      }`}>
        {/* Select tool */}
        <button
          className={`p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="选择工具"
        >
          <MousePointer2 className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-gray-900 text-white' : 'bg-black/90 text-white'}`}>选择工具</span>
        </button>

        {/* Hand/Pan tool */}
        <button
          className={`p-2 rounded-xl transition-all relative group ${
            isPanning || isSpacePressed
              ? 'bg-[#d4af37]/20 text-[#d4af37]'
              : isMonochrome
                ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
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
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-gray-900 text-white' : 'bg-black/90 text-white'}`}>抓手工具</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'}`} />

        {/* Upload */}
        <input ref={uploadFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCanvasImageUpload} />
        <button
          onClick={() => uploadFileInputRef.current?.click()}
          className={`p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="图片上传"
        >
          <Upload className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-gray-900 text-white' : 'bg-black/90 text-white'}`}>图片上传</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'}`} />

        {/* Image Generator - gold accent */}
        <button
          onClick={handleOpenCanvasGenerator}
          className={`p-2 rounded-xl transition-all shadow-lg relative group ${showCanvasGenerator ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black ring-2 ring-[#d4af37]/50' : 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] hover:from-[#daa520] hover:to-[#cd9b1d] text-black'}`}
          title="图像生成器"
        >
          <Sparkles className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none bg-black/90 text-white`}>图像生成器</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'}`} />

        {/* Layer Graph */}
        <button
          onClick={() => onOpenLayerGraph?.()}
          className={`p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="图层"
        >
          <Layers className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-gray-900 text-white' : 'bg-black/90 text-white'}`}>图层</span>
        </button>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'}`} />

        {/* Zoom controls */}
        <div className="flex items-center gap-1 px-1">
          <button
            onClick={() => { setZoom(z => Math.max(0.1, z / 1.2)); }}
            className={`p-1.5 rounded-lg transition-all ${isMonochrome ? 'text-gray-500 hover:text-gray-900 hover:bg-gray-100' : 'text-[#888] hover:text-white hover:bg-white/10'}`}
            title="缩小"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className={`text-xs font-mono w-10 text-center ${isMonochrome ? 'text-gray-700' : 'text-[#d4af37]'}`}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => { setZoom(z => Math.min(5, z * 1.2)); }}
            className={`p-1.5 rounded-lg transition-all ${isMonochrome ? 'text-gray-500 hover:text-gray-900 hover:bg-gray-100' : 'text-[#888] hover:text-white hover:bg-white/10'}`}
            title="放大"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'}`} />

        {/* Reset view */}
        <button
          onClick={() => { setZoom(1); setViewOffset({ x: 0, y: 0 }); }}
          className={`p-2 rounded-xl transition-all relative group ${
            isMonochrome
              ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              : 'text-[#888] hover:text-white hover:bg-white/10'
          }`}
          title="重置视图"
        >
          <Maximize2 className="h-4 w-4" />
          <span className={`absolute -top-9 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${isMonochrome ? 'bg-gray-900 text-white' : 'bg-black/90 text-white'}`}>重置视图</span>
        </button>

        {/* Generating progress */}
        {isGenerating && (
          <>
            <div className={`w-px h-5 ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'}`} />
            <div className="flex items-center gap-1.5">
              <div className={`w-14 h-1 rounded-full overflow-hidden ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`}>
                <div className="h-full bg-[#d4af37] rounded-full transition-all" style={{ width: `${generationProgress ? (generationProgress.current / generationProgress.total * 100) : 0}%` }} />
              </div>
              <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>生成中</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
