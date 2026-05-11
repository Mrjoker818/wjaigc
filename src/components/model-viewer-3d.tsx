'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, Component, type ReactNode } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { X, Download, ZoomIn, ZoomOut, Maximize2, RotateCcw, Move, Box, Image, Eye, ChevronDown } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Simple Error Boundary for Three.js loading failures                */
/* ------------------------------------------------------------------ */
interface EBProps { children: ReactNode; onError: (msg: string) => void }
interface EBState { hasError: boolean }

class CanvasErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false };
  static getDerivedStateFromError(): EBState { return { hasError: false }; }
  componentDidCatch(err: Error) { this.props.onError(err.message); }
  render() {
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/*  Proxy helper — route through our backend to avoid CORS             */
/* ------------------------------------------------------------------ */
function proxyUrl(url: string): string {
  if (url.startsWith('/')) return url;
  if (typeof window !== 'undefined' && url.startsWith(window.location.origin)) return url;
  return `/api/proxy-3d-model?url=${encodeURIComponent(url)}`;
}

/* ------------------------------------------------------------------ */
/*  Detect model format from URL or filename                          */
/* ------------------------------------------------------------------ */
function detectFormat(url: string): 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl' | 'usdz' | 'unknown' {
  try {
    const clean = url.split('?')[0].split('#')[0].toLowerCase();
    if (clean.endsWith('.glb')) return 'glb';
    if (clean.endsWith('.gltf')) return 'gltf';
    if (clean.endsWith('.obj')) return 'obj';
    if (clean.endsWith('.fbx')) return 'fbx';
    if (clean.endsWith('.stl')) return 'stl';
    if (clean.endsWith('.usdz')) return 'usdz';
  } catch { /* ignore */ }
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/*  Model Info                                                         */
/* ------------------------------------------------------------------ */
interface ModelInfo {
  vertices: number;
  faces: number;
  materials: number;
  animations: number;
  format: string;
  fileSize?: string;
}

/* ------------------------------------------------------------------ */
/*  Shared helpers: ensure visible materials, center & scale           */
/* ------------------------------------------------------------------ */
function ensureVisibleMaterials(object: THREE.Object3D) {
  object.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0)) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          side: THREE.DoubleSide,
          roughness: 0.6,
          metalness: 0.1,
        });
      } else if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m: THREE.Material) => {
          if ('side' in m) (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
          if ('transparent' in m && (m as THREE.MeshStandardMaterial).transparent) {
            (m as THREE.MeshStandardMaterial).opacity = Math.max((m as THREE.MeshStandardMaterial).opacity, 0.8);
          }
        });
      } else {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if ('side' in mat) mat.side = THREE.DoubleSide;
        if ('transparent' in mat && mat.transparent && mat.opacity < 0.5) {
          mat.opacity = 1.0;
          mat.transparent = false;
        }
      }
    }
  });
}

function centerAndScaleModel(object: THREE.Object3D): { center: THREE.Vector3; size: THREE.Vector3; maxDim: number } {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return { center: new THREE.Vector3(), size: new THREE.Vector3(), maxDim: 0 };
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  if (maxDim > 0 && isFinite(maxDim)) {
    object.position.set(-center.x, -center.y, -center.z);
    const s = 2 / maxDim;
    object.scale.set(s, s, s);
  }

  object.updateMatrixWorld(true);
  return { center, size, maxDim };
}

function computeModelInfo(object: THREE.Object3D, format: string, raw?: unknown): ModelInfo {
  let vertices = 0;
  let faces = 0;
  const materials = new Set<string>();

  object.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geo = mesh.geometry;
      if (geo) {
        vertices += geo.attributes.position?.count ?? 0;
        faces += geo.index
          ? geo.index.count / 3
          : (geo.attributes.position?.count ?? 0) / 3;
      }
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m: THREE.Material) => materials.add(m.uuid));
      }
    }
  });

  const anims = (raw as { animations?: unknown[] })?.animations?.length ?? 0;
  const formatLabel = format === 'obj' ? 'OBJ' : format === 'fbx' ? 'FBX' : format === 'stl' ? 'STL' : format === 'usdz' ? 'USDZ' : format === 'gltf' ? 'glTF' : 'GLB/glTF';

  return { vertices, faces: Math.floor(faces), materials: materials.size, animations: anims, format: formatLabel };
}

/* ------------------------------------------------------------------ */
/*  Camera Auto-Fit                                                    */
/* ------------------------------------------------------------------ */
function CameraAutoFit() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(2, 1.5, 3);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Format-specific model sub-components                               */
/* ------------------------------------------------------------------ */
interface SubModelProps {
  url: string;
  onInfo: (info: ModelInfo) => void;
  onLoadComplete: () => void;
}

function GlbModel({ url, onInfo, onLoadComplete }: SubModelProps) {
  const raw = useLoader(GLTFLoader, url);
  const processed = useRef(false);
  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const scene = raw.scene;
    ensureVisibleMaterials(scene);
    centerAndScaleModel(scene);
    onInfo(computeModelInfo(scene, 'glb', raw));
    onLoadComplete();
  }, [raw, onInfo, onLoadComplete]);
  return <primitive object={raw.scene} />;
}

function ObjModel({ url, onInfo, onLoadComplete }: SubModelProps) {
  const raw = useLoader(OBJLoader, url);
  const processed = useRef(false);
  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    ensureVisibleMaterials(raw);
    centerAndScaleModel(raw);
    onInfo(computeModelInfo(raw, 'obj', raw));
    onLoadComplete();
  }, [raw, onInfo, onLoadComplete]);
  return <primitive object={raw} />;
}

function FbxModel({ url, onInfo, onLoadComplete }: SubModelProps) {
  const raw = useLoader(FBXLoader, url);
  const processed = useRef(false);
  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    ensureVisibleMaterials(raw);
    centerAndScaleModel(raw);
    onInfo(computeModelInfo(raw, 'fbx', raw));
    onLoadComplete();
  }, [raw, onInfo, onLoadComplete]);
  return <primitive object={raw} />;
}

/* ------------------------------------------------------------------ */
/*  Model Router                                                       */
/* ------------------------------------------------------------------ */
function ModelRouter({ url, formatHint, onInfo, onLoadComplete }: {
  url: string;
  formatHint?: string;
  onInfo: (info: ModelInfo) => void;
  onLoadComplete: () => void;
}) {
  const fmt = formatHint && formatHint !== 'unknown'
    ? formatHint.toLowerCase() as 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl' | 'usdz'
    : detectFormat(url);
  const subProps: SubModelProps = { url, onInfo, onLoadComplete };
  if (fmt === 'obj') return <ObjModel {...subProps} />;
  if (fmt === 'fbx') return <FbxModel {...subProps} />;
  return <GlbModel {...subProps} />;
}

/* ------------------------------------------------------------------ */
/*  Checkerboard Grid                                                  */
/* ------------------------------------------------------------------ */
function CheckerboardGrid() {
  return (
    <Grid
      infiniteGrid
      cellSize={0.5}
      cellThickness={0.5}
      cellColor="#444444"
      sectionSize={2}
      sectionThickness={1}
      sectionColor="#666666"
      fadeDistance={30}
      fadeStrength={1}
      position={[0, -1.2, 0]}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Loading fallback                                                    */
/* ------------------------------------------------------------------ */
function Loader() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#d4af37" wireframe />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  View Mode                                                          */
/* ------------------------------------------------------------------ */
type ViewMode = 'orbit' | 'pan';

/* ------------------------------------------------------------------ */
/*  Main Viewer Component                                              */
/* ------------------------------------------------------------------ */
interface ModelViewer3DProps {
  modelUrl: string;
  modelUrls?: Record<string, string>;
  previewImageUrl?: string;
  onClose: () => void;
}

export default function ModelViewer3D({
  modelUrl,
  modelUrls,
  previewImageUrl,
  onClose,
}: ModelViewer3DProps) {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('orbit');
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeFormat, setActiveFormat] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orbitRef = useRef<any>(null);

  /* Determine the best model URL and format from modelUrls */
  const bestModel = useMemo(() => {
    const priority = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'usdz'];
    if (modelUrls) {
      for (const fmt of priority) {
        if (modelUrls[fmt]) return { url: modelUrls[fmt], format: fmt };
      }
      const entries = Object.entries(modelUrls);
      if (entries.length > 0) return { url: entries[0][1], format: entries[0][0] };
    }
    return { url: modelUrl, format: detectFormat(modelUrl) };
  }, [modelUrls, modelUrl]);

  const currentModel = useMemo(() => {
    if (activeFormat && modelUrls?.[activeFormat]) {
      return { url: modelUrls[activeFormat], format: activeFormat };
    }
    return bestModel;
  }, [activeFormat, modelUrls, bestModel]);

  /* Proxy the model URL to avoid CORS */
  const proxiedUrl = useMemo(() => proxyUrl(currentModel.url), [currentModel.url]);

  /* Set initial active format */
  useEffect(() => {
    if (!activeFormat && bestModel.format) {
      setActiveFormat(bestModel.format);
    }
  }, [bestModel.format, activeFormat]);

  const handleInfo = useCallback((info: ModelInfo) => {
    setModelInfo(info);
  }, []);

  const handleLoadComplete = useCallback(() => {
    setLoading(false);
    setLoadError(null);
  }, []);

  /* Try to get file size via proxy HEAD request */
  useEffect(() => {
    setLoadError(null);
    setLoading(true);
    fetch(proxiedUrl, { method: 'HEAD' })
      .then((res) => {
        if (res.ok) {
          const contentLength = res.headers.get('content-length');
          if (contentLength) {
            const bytes = parseInt(contentLength, 10);
            const mb = (bytes / 1024 / 1024).toFixed(2);
            setModelInfo((prev) => (prev ? { ...prev, fileSize: `${mb} MB` } : prev));
          }
        }
      })
      .catch(() => { /* ignore */ });
  }, [proxiedUrl]);

  /* Keyboard escape */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const formatNumber = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;

  /* Download the 3D model file */
  const handleDownload = useCallback(async (url: string, filename: string) => {
    setDownloading(true);
    try {
      const proxyDownloadUrl = `/api/proxy-3d-model?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyDownloadUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('3D model download error:', err);
      window.open(url, '_blank');
    } finally {
      setDownloading(false);
    }
  }, []);

  /* Build available download options from modelUrls */
  const downloadOptions = useMemo(() => {
    const options: Array<{ label: string; url: string; ext: string }> = [];
    if (modelUrls) {
      const priority = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'usdz'];
      const sortedEntries = Object.entries(modelUrls)
        .filter(([, url]) => url && typeof url === 'string')
        .sort((a, b) => {
          const ai = priority.indexOf(a[0]);
          const bi = priority.indexOf(b[0]);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
      for (const [type, url] of sortedEntries) {
        options.push({ label: `${type.toUpperCase()} 格式`, url, ext: type });
      }
    }
    if (options.length === 0 && modelUrl) {
      const fmt = detectFormat(modelUrl);
      const ext = fmt === 'unknown' ? 'GLB' : fmt.toUpperCase();
      options.push({ label: `${ext} 格式`, url: modelUrl, ext: fmt });
    }
    return options;
  }, [modelUrls, modelUrl]);

  /* Available formats for switching */
  const availableFormats = useMemo(() => {
    if (!modelUrls) return [];
    return Object.entries(modelUrls)
      .filter(([, url]) => url && typeof url === 'string')
      .map(([fmt, url]) => ({ format: fmt, url, label: fmt.toUpperCase() }));
  }, [modelUrls]);

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="relative w-[92vw] max-w-[1200px] h-[85vh] max-h-[800px] rounded-2xl border border-[#2a2a2a]/80 bg-gradient-to-b from-[#141414] to-[#0a0a0a] overflow-hidden flex flex-col shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a2a]/60 bg-[#0d0d0d]/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#d4af37] to-[#b8860b] flex items-center justify-center">
              <Box size={16} className="text-black" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">3D 模型预览</div>
              {modelInfo && (
                <div className="text-xs text-[#666] mt-0.5">
                  {modelInfo.format} · {formatNumber(modelInfo.faces)} 面 · {formatNumber(modelInfo.vertices)} 顶点
                  {modelInfo.fileSize ? ` · ${modelInfo.fileSize}` : ''}
                  {modelInfo.animations > 0 ? ` · ${modelInfo.animations} 动画` : ''}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Sidebar toggle */}
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-2 rounded-lg text-[#777] hover:text-white hover:bg-white/5 transition-all"
              title={showSidebar ? '隐藏侧栏' : '显示侧栏'}
            >
              <ChevronDown size={14} className={`transition-transform ${showSidebar ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {/* Download button */}
            {downloadOptions.length > 0 && (
              <div className="relative group">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black hover:from-[#e0bf4a] hover:to-[#cd9b1d] transition-all shadow-lg shadow-[#d4af37]/20"
                  onClick={() => {
                    const opt = downloadOptions[0];
                    handleDownload(opt.url, `3d-model.${opt.ext}`);
                  }}
                  disabled={downloading}
                >
                  <Download size={12} />
                  {downloading ? '下载中...' : '下载模型'}
                </button>
                {downloadOptions.length > 1 && (
                  <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col gap-0.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-1 min-w-[140px] z-50 shadow-xl">
                    {downloadOptions.map((opt) => (
                      <button
                        key={opt.ext}
                        onClick={() => handleDownload(opt.url, `3d-model.${opt.ext}`)}
                        className="flex items-center justify-between px-3 py-1.5 rounded-md text-xs text-[#ccc] hover:bg-[#252525] transition-colors"
                        disabled={downloading}
                      >
                        <span>{opt.label}</span>
                        <Download size={10} className="text-[#666]" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[#777] hover:text-white hover:bg-white/5 transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar */}
          {showSidebar && (
            <div className="w-[240px] shrink-0 border-r border-[#2a2a2a]/60 bg-[#0d0d0d]/60 flex flex-col overflow-hidden">
              {/* Source image */}
              {previewImageUrl && (
                <div className="p-3 border-b border-[#2a2a2a]/40">
                  <div className="text-xs font-medium text-[#888] uppercase tracking-wider mb-2">原始图片</div>
                  <div className="rounded-xl overflow-hidden border border-[#2a2a2a]/60 bg-[#0a0a0a]">
                    <img
                      src={previewImageUrl}
                      alt="Source"
                      className="w-full h-[140px] object-contain"
                      draggable={false}
                    />
                  </div>
                </div>
              )}

              {/* Format selector */}
              {availableFormats.length > 1 && (
                <div className="p-3 border-b border-[#2a2a2a]/40">
                  <div className="text-xs font-medium text-[#888] uppercase tracking-wider mb-2">模型格式</div>
                  <div className="grid grid-cols-3 gap-1">
                    {availableFormats.map(({ format, label }) => (
                      <button
                        key={format}
                        onClick={() => { setActiveFormat(format); setLoading(true); setLoadError(null); }}
                        className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          activeFormat === format
                            ? 'bg-[#d4af37] text-black'
                            : 'bg-[#1a1a1a] text-[#888] hover:text-white hover:bg-[#252525]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Model info */}
              {modelInfo && (
                <div className="p-3 flex-1 overflow-y-auto">
                  <div className="text-xs font-medium text-[#888] uppercase tracking-wider mb-2">模型信息</div>
                  <div className="space-y-2">
                    {[
                      { label: '格式', value: modelInfo.format },
                      { label: '面数', value: formatNumber(modelInfo.faces) },
                      { label: '顶点', value: formatNumber(modelInfo.vertices) },
                      { label: '材质', value: `${modelInfo.materials}` },
                      ...(modelInfo.animations > 0 ? [{ label: '动画', value: `${modelInfo.animations}` }] : []),
                      ...(modelInfo.fileSize ? [{ label: '大小', value: modelInfo.fileSize }] : []),
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between text-xs">
                        <span className="text-[#666]">{label}</span>
                        <span className="text-[#ccc] font-mono">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* View controls */}
              <div className="p-3 border-t border-[#2a2a2a]/40">
                <div className="text-xs font-medium text-[#888] uppercase tracking-wider mb-2">视图模式</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setViewMode('orbit')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                      viewMode === 'orbit'
                        ? 'bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/30'
                        : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-transparent'
                    }`}
                  >
                    <RotateCcw size={11} /> 旋转
                  </button>
                  <button
                    onClick={() => setViewMode('pan')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                      viewMode === 'pan'
                        ? 'bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/30'
                        : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-transparent'
                    }`}
                  >
                    <Move size={11} /> 平移
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3D Canvas */}
          <div className="flex-1 relative" onContextMenu={(e) => e.preventDefault()}>
            {loadError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0d0d0d]">
                <div className="w-16 h-16 rounded-2xl bg-[#d4af37]/10 flex items-center justify-center">
                  <Box size={28} className="text-[#d4af37]" />
                </div>
                <p className="text-[#aaa] text-sm max-w-[300px] text-center">{loadError}</p>
                {downloadOptions.length > 0 && (
                  <button
                    onClick={() => {
                      const opt = downloadOptions[0];
                      handleDownload(opt.url, `3d-model.${opt.ext}`);
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#d4af37] text-black text-xs font-medium hover:bg-[#e0bf4a] transition-colors"
                    disabled={downloading}
                  >
                    <Download size={14} />
                    {downloading ? '下载中...' : '直接下载 3D 模型文件'}
                  </button>
                )}
                {previewImageUrl && (
                  <img
                    src={previewImageUrl}
                    alt="预览备用图"
                    className="max-w-[200px] max-h-[200px] rounded-xl border border-[#2a2a2a] object-contain"
                  />
                )}
              </div>
            ) : (
              <CanvasErrorBoundary onError={(msg) => { setLoadError(`模型加载失败: ${msg}`); setLoading(false); }}>
                <Canvas
                  camera={{ position: [2, 1.5, 3], fov: 45, near: 0.01, far: 1000 }}
                  gl={{ antialias: true, alpha: false }}
                  style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)' }}
                  onCreated={({ gl }) => {
                    gl.toneMapping = THREE.ACESFilmicToneMapping;
                    gl.toneMappingExposure = 1.2;
                  }}
                >
                  {/* Studio-like lighting */}
                  <ambientLight intensity={0.6} />
                  <directionalLight position={[5, 8, 5]} intensity={1.5} castShadow color="#ffffff" />
                  <directionalLight position={[-4, 4, -4]} intensity={0.5} color="#aabbdd" />
                  <directionalLight position={[0, -3, 2]} intensity={0.3} color="#d4af37" />
                  <pointLight position={[3, 3, 3]} intensity={0.4} color="#ffffff" />
                  <pointLight position={[-3, -1, -3]} intensity={0.2} color="#8888cc" />

                  <Suspense fallback={<Loader />}>
                    <ModelRouter url={proxiedUrl} formatHint={currentModel.format} onInfo={handleInfo} onLoadComplete={handleLoadComplete} />
                  </Suspense>

                  <CheckerboardGrid />
                  <CameraAutoFit />

                  <OrbitControls
                    ref={orbitRef}
                    makeDefault
                    enableDamping
                    dampingFactor={0.15}
                    rotateSpeed={0.8}
                    zoomSpeed={1.2}
                    minDistance={0.5}
                    maxDistance={50}
                    enablePan={viewMode === 'pan'}
                    target={[0, 0, 0]}
                    mouseButtons={{
                      LEFT: viewMode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
                      MIDDLE: THREE.MOUSE.DOLLY,
                      RIGHT: viewMode === 'orbit' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
                    }}
                  />
                </Canvas>
              </CanvasErrorBoundary>
            )}

            {/* Loading overlay */}
            {loading && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d0d]/80 pointer-events-none">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl border-2 border-[#d4af37] border-t-transparent animate-spin" />
                  <span className="text-[#aaa] text-xs">加载 3D 模型中...</span>
                </div>
              </div>
            )}

            {/* View mode indicator */}
            {!loading && !loadError && (
              <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-[#2a2a2a]/50 text-xs text-[#888]">
                {viewMode === 'orbit' ? (
                  <><RotateCcw size={10} className="text-[#d4af37]" /> 左键旋转 · 右键平移</>
                ) : (
                  <><Move size={10} className="text-[#d4af37]" /> 左键平移 · 右键旋转</>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[#2a2a2a]/60 bg-[#0d0d0d]/80 shrink-0">
          <div className="flex items-center gap-2">
            {/* View mode buttons */}
            <button
              onClick={() => setViewMode('orbit')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all ${
                viewMode === 'orbit' ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'text-[#666] hover:text-white'
              }`}
            >
              <RotateCcw size={11} /> 旋转
            </button>
            <button
              onClick={() => setViewMode('pan')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all ${
                viewMode === 'pan' ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'text-[#666] hover:text-white'
              }`}
            >
              <Move size={11} /> 平移
            </button>
            <div className="w-px h-4 bg-[#2a2a2a]" />
            <button
              onClick={() => {
                if (orbitRef.current) {
                  orbitRef.current.reset();
                }
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-[#666] hover:text-white transition-all"
            >
              <Maximize2 size={11} /> 重置
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#555]">
            <span className="flex items-center gap-1"><RotateCcw size={9} /> 左键{viewMode === 'orbit' ? '旋转' : '平移'}</span>
            <span>·</span>
            <span className="flex items-center gap-1"><ZoomIn size={9} /> 滚轮缩放</span>
            <span>·</span>
            <span>右键{viewMode === 'orbit' ? '平移' : '旋转'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
