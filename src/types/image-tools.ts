// ============================================================
// Image Tools — Type Definitions
// ============================================================

/** 图片编辑模式 */
export type ImageEditMode = 'erase' | 'mask';

/** 支持的放大模型 */
export type UpscaleModel =
  | 'remacri'
  | 'ultramix-balanced'
  | 'ultrasharp'
  | '4x-UltraSharp'
  | 'realesrgan-x4plus'
  | 'realesrgan-x4plus-anime'
  | 'esrgan-x4';

/** 放大请求参数 */
export interface UpscaleRequest {
  imageUrl: string;
  model?: UpscaleModel;
  scale?: 2 | 4;
  tileSize?: number;
  outputFormat?: 'png' | 'jpg' | 'webp';
  compression?: number;
}

/** 放大响应 */
export interface UpscaleResponse {
  success: boolean;
  imageUrl?: string;
  originalSize?: { width: number; height: number };
  outputSize?: { width: number; height: number };
  model?: string;
  scale?: number;
  error?: string;
}

/** 修复引擎类型 */
export type InpaintEngine = 'iopaint-lama';

/** 修复请求参数 */
export interface InpaintRequest {
  image: File;
  mask: File;
  prompt?: string;
}

/** 修复响应 */
export interface InpaintResponse {
  success: boolean;
  imageUrl?: string;
  originalSize?: { width: number; height: number };
  outputSize?: { width: number; height: number };
  engine?: InpaintEngine;
  error?: string;
}

/** Health 检测响应 */
export interface ImageHealthResponse {
  localAiEnabled: boolean;
  iopaint: {
    available: boolean;
    baseUrl: string;
    model?: string;
  };
  upscayl: {
    available: boolean;
    models: string[];
  };
}

/** ImageHealthStatus 别名 (兼容组件引用) */
export type ImageHealthStatus = ImageHealthResponse;

/** 画笔模式 */
export type BrushMode = 'brush' | 'eraser';

/** MaskBrushCanvas 属性 */
export interface MaskBrushCanvasProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  brushSize: number;
  brushMode: BrushMode;
  onMaskChange?: (maskDataUrl: string) => void;
}

/** UpscaleDialog 属性 */
export interface UpscaleDialogProps {
  imageUrl: string;
  onClose: () => void;
  onSuccess: (resultImageUrl: string) => void;
}

/** 图片编辑工具栏属性 */
export interface ImageEditToolbarProps {
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  brushMode: BrushMode;
  onBrushModeChange: (mode: BrushMode) => void;
  onUndo: () => void;
  onClear: () => void;
  onStartRepair: () => void;
  isProcessing: boolean;
  prompt?: string;
  onPromptChange?: (prompt: string) => void;
  showPrompt?: boolean;
  // 完整工具栏按钮回调（供无限画布使用）
  onUpscale?: () => void;
  onErase?: () => void;
  onMask?: () => void;
  onExpand?: () => void;
  onCrop?: () => void;
  onImg2Img?: () => void;
  onRemoveBg?: () => void;
  onRasterize?: () => void;
  onEditElements?: () => void;
  onDownload?: () => void;
  on3D?: () => void;
  disabled?: boolean;
}

/** 可用放大模型列表 */
export const UPSCALE_MODELS: { id: UpscaleModel; label: string }[] = [
  { id: 'remacri', label: 'Remacri (通用)' },
  { id: 'ultramix-balanced', label: 'UltraMix Balanced (均衡)' },
  { id: 'ultrasharp', label: 'UltraSharp (锐利)' },
  { id: '4x-UltraSharp', label: '4x UltraSharp (超清)' },
  { id: 'realesrgan-x4plus', label: 'RealESRGAN x4+ (写实)' },
  { id: 'realesrgan-x4plus-anime', label: 'RealESRGAN x4+ Anime (动漫)' },
];
