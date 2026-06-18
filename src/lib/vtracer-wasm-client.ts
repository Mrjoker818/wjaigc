/**
 * 前端 WebAssembly vtracer 封装模块
 * 
 * 基于 wasm_vtracer npm 包，实现纯浏览器端图片转矢量图。
 * 无需服务器，低配云服务器也能流畅运行。
 * 
 * 三道防线：
 * 1. 文件大小 < 5MB
 * 2. 最大分辨率 1200px（长边）
 * 3. 颜色数量限制（8-32色，可配置）
 */

export interface WasmVtracerOptions {
  /** 颜色模式: color=全彩, bw=黑白 */
  colorMode: 'color' | 'bw';
  /** 颜色精度 1-8 (bit数, 越高颜色越多) */
  colorPrecision: number;
  /** 过滤斑点大小 (px) */
  filterSpeckle: number;
  /** 角点阈值 (度) */
  cornerThreshold: number;
  /** 段长度阈值 */
  lengthThreshold: number;
  /** 拼接阈值 (度) */
  spliceThreshold: number;
  /** 层级模式: stacked=堆叠(默认), cutout=裁切 */
  hierarchical: 'stacked' | 'cutout';
  /** 路径精度 (小数位数) */
  pathPrecision: number;
  /** 最大颜色数量 (仅 color 模式) */
  maxColors: number;
}

export interface WasmVtracerResult {
  success: boolean;
  svg: string;
  pathCount: number;
  originalSize: { width: number; height: number };
  processingTime: number;
  warning?: string;
  error?: string;
}

export interface WasmVtracerDefenseCheck {
  passed: boolean;
  fileSizeOK: boolean;
  resolutionOK: boolean;
  fileSizeBytes: number;
  resolution: { width: number; height: number };
  warnings: string[];
}

// 默认配置
const DEFAULT_OPTIONS: WasmVtracerOptions = {
  colorMode: 'color',
  colorPrecision: 6,
  filterSpeckle: 4,
  cornerThreshold: 60,
  lengthThreshold: 4,
  spliceThreshold: 45,
  hierarchical: 'stacked',
  pathPrecision: 2,
  maxColors: 16,
};

// 防线常量
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_RESOLUTION = 1200;

// 质量预设
export const WASM_QUALITY_PRESETS: Record<string, { label: string; options: Partial<WasmVtracerOptions> }> = {
  fast: {
    label: '快速',
    options: { colorPrecision: 4, filterSpeckle: 6, cornerThreshold: 60, pathPrecision: 1, maxColors: 8 },
  },
  balanced: {
    label: '均衡',
    options: { colorPrecision: 5, filterSpeckle: 4, cornerThreshold: 55, pathPrecision: 2, maxColors: 16 },
  },
  high: {
    label: '高清',
    options: { colorPrecision: 6, filterSpeckle: 3, cornerThreshold: 50, pathPrecision: 3, maxColors: 24 },
  },
  max: {
    label: '极致',
    options: { colorPrecision: 8, filterSpeckle: 2, cornerThreshold: 45, pathPrecision: 4, maxColors: 32 },
  },
};

// WASM 模块类型（延迟加载）
type WasmVtracerModule = typeof import('wasm_vtracer');

// WASM 模块单例
let wasmModule: WasmVtracerModule | null = null;
let wasmInitPromise: Promise<WasmVtracerModule> | null = null;

/**
 * 初始化 WASM vtracer 模块
 * 在浏览器端动态加载 wasm_vtracer 包
 */
export async function initWasmVtracer(): Promise<WasmVtracerModule> {
  if (wasmModule) return wasmModule;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      // 动态导入 wasm_vtracer（Next.js webpack 会处理 WASM 加载）
      const vtracer = await import('wasm_vtracer');
      
      // 调用 init() 初始化（无需参数，WASM 由 webpack/bundler 自动加载）
      vtracer.init();
      
      // 验证是否就绪
      if (!vtracer.isReady()) {
        throw new Error('WASM vtracer 初始化后未就绪');
      }
      
      wasmModule = vtracer;
      return vtracer;
    } catch (error) {
      wasmInitPromise = null;
      throw error;
    }
  })();

  return wasmInitPromise;
}

/**
 * 检查 WASM vtracer 是否已初始化
 */
export function isWasmVtracerReady(): boolean {
  return wasmModule?.isReady() ?? false;
}

/**
 * 三道防线检查
 */
export function defenseCheck(imageFile: File | Blob, width: number, height: number): WasmVtracerDefenseCheck {
  const warnings: string[] = [];
  const fileSizeBytes = imageFile.size;
  const fileSizeOK = fileSizeBytes <= MAX_FILE_SIZE_BYTES;
  const resolutionOK = Math.max(width, height) <= MAX_RESOLUTION;

  if (!fileSizeOK) {
    warnings.push(`文件大小 ${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB 超过限制 ${MAX_FILE_SIZE_MB}MB`);
  }
  if (!resolutionOK) {
    warnings.push(`分辨率 ${width}×${height} 超过限制 ${MAX_RESOLUTION}px`);
  }

  return {
    passed: fileSizeOK && resolutionOK,
    fileSizeOK,
    resolutionOK,
    fileSizeBytes,
    resolution: { width, height },
    warnings,
  };
}

/**
 * 使用 WASM vtracer 将图片转为 SVG
 * 在浏览器端完成，不需要服务器
 */
export async function vectorizeWithWasm(
  imageSource: HTMLImageElement | HTMLCanvasElement | ImageData,
  userOptions?: Partial<WasmVtracerOptions>
): Promise<WasmVtracerResult> {
  const startTime = Date.now();
  
  // 确保 WASM 已初始化
  const vtracer = await initWasmVtracer();
  
  if (!vtracer.isReady()) {
    return { success: false, svg: '', pathCount: 0, originalSize: { width: 0, height: 0 }, processingTime: 0 };
  }

  // 合并选项
  const options = { ...DEFAULT_OPTIONS, ...userOptions };

  // 获取 ImageData
  let imageData: ImageData;
  let width: number;
  let height: number;

  if (imageSource instanceof ImageData) {
    imageData = imageSource;
    width = imageData.width;
    height = imageData.height;
  } else {
    // 创建 canvas 获取像素数据
    const canvas = document.createElement('canvas');
    if (imageSource instanceof HTMLCanvasElement) {
      canvas.width = imageSource.width;
      canvas.height = imageSource.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(imageSource, 0, 0);
    } else {
      // HTMLImageElement - 防线2: 限制最大分辨率
      let drawWidth = imageSource.naturalWidth || imageSource.width;
      let drawHeight = imageSource.naturalHeight || imageSource.height;
      
      if (Math.max(drawWidth, drawHeight) > MAX_RESOLUTION) {
        const scale = MAX_RESOLUTION / Math.max(drawWidth, drawHeight);
        drawWidth = Math.round(drawWidth * scale);
        drawHeight = Math.round(drawHeight * scale);
      }
      
      canvas.width = drawWidth;
      canvas.height = drawHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(imageSource, 0, 0, drawWidth, drawHeight);
    }
    
    width = canvas.width;
    height = canvas.height;
    const ctx = canvas.getContext('2d')!;
    imageData = ctx.getImageData(0, 0, width, height);
  }

  // 防线3: 限制颜色数量 (通过 colorPrecision 控制)
  const effectiveColorPrecision = options.colorMode === 'bw' ? 1 : options.colorPrecision;

  // 创建 TracerConfig
  const config = new vtracer.TracerConfig();
  try {
    // 设置颜色模式
    config.setColorMode(
      options.colorMode === 'bw'
        ? vtracer.ColorMode.Binary
        : vtracer.ColorMode.Color
    );
    
    // 设置层级模式
    config.setHierarchical(
      options.hierarchical === 'cutout'
        ? vtracer.Hierarchical.Cutout
        : vtracer.Hierarchical.Stacked
    );
    
    // 设置参数（带边界钳制，防止越界报错）
    config.setColorPrecision(Math.max(1, Math.min(8, effectiveColorPrecision)));
    config.setFilterSpeckle(Math.max(0, Math.round(options.filterSpeckle)));
    config.setCornerThreshold(Math.max(0, Math.min(180, options.cornerThreshold)));
    config.setLengthThreshold(Math.max(3.5, Math.min(10.0, options.lengthThreshold)));
    config.setSpliceThreshold(Math.max(0, Math.min(180, options.spliceThreshold)));
    config.setPathPrecision(Math.max(0, Math.min(8, options.pathPrecision)));

    // 执行转换
    const rgbaPixels = new Uint8Array(imageData.data.buffer);
    const svg = vtracer.convertImageToSvg(rgbaPixels, width, height, config);
    
    const processingTime = Date.now() - startTime;
    
    // 计算路径数量
    const pathCount = (svg.match(/<path/g) || []).length;
    
    // 添加警告
    let warning: string | undefined;
    if (pathCount > 5000) {
      warning = `路径数量较多(${pathCount}条)，可能影响渲染性能`;
    }

    return {
      success: true,
      svg,
      pathCount,
      originalSize: { width, height },
      processingTime,
      warning,
    };
  } finally {
    // 释放 WASM 资源
    if (config && typeof config.free === 'function') {
      config.free();
    }
  }
}

/**
 * 从图片 URL 加载并转换
 */
export async function vectorizeImageUrlWithWasm(
  imageUrl: string,
  options?: Partial<WasmVtracerOptions>
): Promise<WasmVtracerResult> {
  // 加载图片
  const img = new Image();
  img.crossOrigin = 'anonymous';
  
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageUrl;
  });

  return vectorizeWithWasm(img, options);
}

/**
 * 从 File/Blob 加载并转换
 * 包含完整的三道防线检查
 */
export async function vectorizeFileWithWasm(
  file: File | Blob,
  options?: Partial<WasmVtracerOptions>
): Promise<WasmVtracerResult> {
  // 加载图片获取尺寸
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = url;
    });

    // 防线检查
    const check = defenseCheck(file, img.naturalWidth, img.naturalHeight);
    if (!check.passed) {
      return {
        success: false,
        svg: '',
        pathCount: 0,
        originalSize: { width: img.naturalWidth, height: img.naturalHeight },
        processingTime: 0,
        warning: check.warnings.join('; '),
      };
    }

    return vectorizeWithWasm(img, options);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 统一客户端对象，方便外部 import */
export const vtracerWasmClient = {
  init: initWasmVtracer,
  isReady: isWasmVtracerReady,
  defenseCheck,
  convertImage: vectorizeImageUrlWithWasm,
  convertFile: vectorizeFileWithWasm,
  convertElement: vectorizeWithWasm,
  presets: WASM_QUALITY_PRESETS,
};
