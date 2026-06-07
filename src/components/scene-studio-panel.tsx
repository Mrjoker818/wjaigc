'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useThree, ThreeEvent, extend } from '@react-three/fiber';
import { OrbitControls, TransformControls, Grid, GizmoHelper, GizmoViewport, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';

// Register Three.js classes with R3F to avoid React 19 "incorrect casing" warnings
extend({
  AmbientLight: THREE.AmbientLight,
  DirectionalLight: THREE.DirectionalLight,
  PointLight: THREE.PointLight,
  SpotLight: THREE.SpotLight,
  GridHelper: THREE.GridHelper,
  MeshStandardMaterial: THREE.MeshStandardMaterial,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  BoxGeometry: THREE.BoxGeometry,
  CylinderGeometry: THREE.CylinderGeometry,
  SphereGeometry: THREE.SphereGeometry,
  PlaneGeometry: THREE.PlaneGeometry,
  CircleGeometry: THREE.CircleGeometry,
  Mesh: THREE.Mesh,
  Group: THREE.Group,
  Object3D: THREE.Object3D,
});
import {
  Box as BoxIcon, Cylinder as CylinderIcon, Plane as PlaneIcon,
  X, Plus, Trash2, Lock, Unlock, Eye, EyeOff,
  Move, RotateCcw, Maximize2, Copy, Download,
  Camera, Sun, Lightbulb, Image as ImageIcon,
  Sparkles, Wand2, Film, Save, FolderOpen,
  ChevronRight, ChevronDown, Upload, BoxSelect,
  Settings, Palette, Layers, MousePointer2,
  ZoomIn, ZoomOut, RotateCw, FlipHorizontal,
  ArrowRight, Check, Loader2, AlertCircle,
  Send, ImagePlus, Video, LayoutGrid, Store,
  Package, Tag, Archive, Cuboid, Circle,
  Layout, Columns3, Minimize2, Expand,
  Trash, Bookmark, RotateCcw as ResetIcon, GripVertical,
  Scan, Paintbrush, LayoutDashboard, Minus, Hammer, Boxes
} from 'lucide-react';

/* ========== TYPES ========== */

interface SceneObject {
  id: string;
  type: 'model' | 'box' | 'cylinder' | 'plane' | 'sphere' | 'stage-round' | 'stage-rect' | 'backdrop' | 'lightbox' | 'billboard' | 'standee';
  name: string;
  modelUrl?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  visible: boolean;
  locked: boolean;
}

interface SceneLight {
  id: string;
  type: 'ambient' | 'directional' | 'point' | 'spot';
  name: string;
  intensity: number;
  color: string;
  position: [number, number, number];
  angle?: number; // for spot light, in degrees
}

type CameraPreset = 'front' | 'side' | 'top' | '45degree' | 'free';

type GenerationMode = 'text-to-image' | 'image-to-image';
type StrengthMode = 'strict' | 'balanced' | 'creative' | 'commercial';

interface CameraView {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
}

interface GenerationResult {
  id: string;
  url: string;
  prompt: string;
  mode: GenerationMode;
  strengthMode: StrengthMode;
  timestamp: number;
}

interface SavedScene {
  id: string;
  name: string;
  objects: SceneObject[];
  lights: SceneLight[];
  cameraPreset: CameraPreset;
  savedCameraViews: CameraView[];
  prompt: string;
  timestamp: number;
  sceneData?: Record<string, unknown>;
}

interface SceneStudioProps {
  onClose: () => void;
  onAddImages: (urls: string[]) => void;
  isMonochrome?: boolean;
}

/* ========== CONSTANTS ========== */

const ACCENT = '#d4af37';
const ACCENT_DIM = '#b8941f';
const BG_PRIMARY = '#0a0a0a';
const BG_SECONDARY = '#111111';
const BG_TERTIARY = '#1a1a1a';
const BG_HOVER = '#222222';
const BORDER_COLOR = '#2a2a2a';
const TEXT_PRIMARY = '#f0f0f0';
const TEXT_SECONDARY = '#999999';
const TEXT_DIM = '#666666';

const GEOMETRY_PRESETS: { type: SceneObject['type']; name: string; icon: React.ReactNode; emoji: string; defaultScale: [number, number, number]; defaultColor: string }[] = [
  { type: 'box', name: '立方体', icon: <BoxIcon size={16} />, emoji: '📦', defaultScale: [1, 1, 1], defaultColor: '#808080' },
  { type: 'cylinder', name: '圆柱', icon: <CylinderIcon size={16} />, emoji: '🛢️', defaultScale: [0.5, 1, 0.5], defaultColor: '#808080' },
  { type: 'plane', name: '平面', icon: <PlaneIcon size={16} />, emoji: '⬜', defaultScale: [2, 1, 2], defaultColor: '#505050' },
  { type: 'sphere', name: '球体', icon: <Circle size={16} />, emoji: '🔮', defaultScale: [0.5, 0.5, 0.5], defaultColor: '#808080' },
  { type: 'stage-round', name: '圆形展台', icon: <CircleDot size={16} />, emoji: '⭕', defaultScale: [1, 0.15, 1], defaultColor: '#2a2a2a' },
  { type: 'stage-rect', name: '矩形展台', icon: <BoxSelect size={16} />, emoji: '▮', defaultScale: [1.5, 0.15, 1], defaultColor: '#2a2a2a' },
  { type: 'backdrop', name: '背景板', icon: <LayoutGrid size={16} />, emoji: '🖼️', defaultScale: [4, 3, 0.05], defaultColor: '#1a1a1a' },
  { type: 'lightbox', name: '灯箱', icon: <Sun size={16} />, emoji: '💡', defaultScale: [1, 2, 0.1], defaultColor: '#ffffff' },
  { type: 'billboard', name: '广告牌', icon: <Tag size={16} />, emoji: '📋', defaultScale: [2, 1.5, 0.05], defaultColor: '#d4af37' },
  { type: 'standee', name: '立牌', icon: <FlipHorizontal size={16} />, emoji: '🏪', defaultScale: [0.8, 1.8, 0.05], defaultColor: '#ffffff' },
];

const LIGHT_PRESETS_DATA: { name: string; lights: Omit<SceneLight, 'id'>[] }[] = [
  {
    name: '商业暖光',
    lights: [
      { type: 'ambient', name: '环境光', intensity: 0.6, color: '#fff4e6', position: [0, 5, 0] },
      { type: 'directional', name: '主光', intensity: 1.2, color: '#ffffff', position: [3, 5, 4] },
      { type: 'directional', name: '补光', intensity: 0.5, color: '#e6f0ff', position: [-3, 3, 2] },
      { type: 'directional', name: '背光', intensity: 0.3, color: '#fff4e6', position: [0, 4, -4] },
    ],
  },
  {
    name: '冷白产品光',
    lights: [
      { type: 'ambient', name: '环境光', intensity: 0.4, color: '#f0f4ff', position: [0, 5, 0] },
      { type: 'directional', name: '主光', intensity: 1.5, color: '#ffffff', position: [2, 6, 3] },
      { type: 'point', name: '补光', intensity: 0.6, color: '#e0e8ff', position: [-2, 3, 1] },
    ],
  },
  {
    name: '戏剧聚光',
    lights: [
      { type: 'ambient', name: '环境光', intensity: 0.2, color: '#1a1a2e', position: [0, 5, 0] },
      { type: 'spot', name: '聚光灯', intensity: 2.0, color: '#ffffff', position: [0, 6, 0] },
    ],
  },
  {
    name: '展陈柔和光',
    lights: [
      { type: 'ambient', name: '环境光', intensity: 0.8, color: '#fff8f0', position: [0, 5, 0] },
      { type: 'directional', name: '顶光', intensity: 0.8, color: '#ffffff', position: [0, 8, 0] },
      { type: 'directional', name: '侧光', intensity: 0.4, color: '#fff4e6', position: [5, 3, 0] },
    ],
  },
];

const CAMERA_PRESETS: { name: string; label: string; key: CameraPreset; position: [number, number, number]; target: [number, number, number] }[] = [
  { name: '正面', label: '正面', key: 'front', position: [0, 2, 6], target: [0, 1, 0] },
  { name: '侧面', label: '侧面', key: 'side', position: [6, 2, 0], target: [0, 1, 0] },
  { name: '俯视', label: '俯视', key: 'top', position: [0, 8, 0.01], target: [0, 0, 0] },
  { name: '45°商业', label: '45°', key: '45degree', position: [4, 3, 6], target: [0, 0.5, 0] },
  { name: '自由', label: '自由', key: 'free', position: [4, 3, 6], target: [0, 0.5, 0] },
];

const STRENGTH_MODES: { key: StrengthMode; name: string; label: string; value: number; desc: string; promptHint: string }[] = [
  { key: 'strict', name: '严格保留构图', label: '严格', value: 85, desc: '最大限度保持3D构图', promptHint: '严格按照参考图的构图和布局生成，保持物体的位置、大小和空间关系不变，只提升画质和细节' },
  { key: 'balanced', name: '平衡优化', label: '平衡', value: 60, desc: '保持构图，提升质感', promptHint: '保持整体构图不变，优化光影效果、材质质感和画面氛围，提升视觉表现力' },
  { key: 'creative', name: '创意发挥', label: '创意', value: 35, desc: '只参考大结构，AI自由发挥', promptHint: '参考整体构图结构，自由发挥创意，可以改变风格、色调、氛围，生成更有艺术感的画面' },
  { key: 'commercial', name: '商业强化', label: '强化', value: 70, desc: '强化广告质感、光影、材质', promptHint: '商业摄影级别，强化产品光影、材质质感和广告氛围，景深效果，studio lighting，8K ultra detail' },
];

const ASPECT_RATIOS = ['16:9', '1:1', '9:16', '4:3', '3:4'] as const;
const MAX_MODEL_SIZE_MB = 20;
const ACCENT_COLOR = '#d4af37';
const TEXT_MUTED = '#888';

// CircleDot icon (not in lucide-react by default)
function CircleDot({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

const AI_LAYOUT_TEMPLATES = [
  { key: 'brand-popup', name: '品牌快闪店', emoji: '🏪', desc: '年轻化品牌展示空间', prompt: '一个年轻化品牌快闪店，中央有产品展示台，暖色调灯光，背景板有品牌标识' },
  { key: 'product-stage', name: '产品展台', emoji: '🎁', desc: '高端产品展示台', prompt: '一个高端产品展示台，圆形展台居中，顶部聚光灯照射，简洁背景' },
  { key: 'convenience', name: '便利店场景', emoji: '🛒', desc: '货架陈列场景', prompt: '一个便利店场景，左右两侧有货架，中间有过道，顶部白色灯光' },
  { key: 'cosmetic', name: '美妆柜台', emoji: '💄', desc: '化妆品专柜展示', prompt: '一个美妆品牌专柜，玻璃展示柜，柔和灯光，镜面元素' },
  { key: 'tech-booth', name: '科技展位', emoji: '💻', desc: '科技产品展台', prompt: '一个科技产品展位，冷色调灯光，LED屏幕背景，未来感展台' },
  { key: 'food-shelf', name: '食品货架', emoji: '🍜', desc: '食品陈列展示', prompt: '一个食品货架展示场景，多层货架，暖色灯光，产品排列整齐' },
];

const GENERATION_MODES = [
  { key: 'text_to_image' as GenerationMode, label: '文生图', desc: '纯文字描述生成' },
  { key: 'image_to_image' as GenerationMode, label: '图生图', desc: '参考截图生成' },
  { key: 'variation' as GenerationMode, label: '变体', desc: '基于截图变体' },
];

/* ========== 3D SCENE OBJECT COMPONENTS ========== */

function TransformControlsWrapper({ meshRef, mode, objId, onTransformChange }: {
  meshRef: React.RefObject<THREE.Mesh | null>;
  mode: 'translate' | 'rotate' | 'scale';
  objId: string;
  onTransformChange: (id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void;
}) {
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    if (controlsRef.current && meshRef.current) {
      controlsRef.current.attach(meshRef.current);
    }
  }, [meshRef]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const callback = () => {
      if (meshRef.current) {
        const p = meshRef.current.position;
        const r = meshRef.current.rotation;
        const s = meshRef.current.scale;
        onTransformChange(
          objId,
          [p.x, p.y, p.z],
          [r.x * 180 / Math.PI, r.y * 180 / Math.PI, r.z * 180 / Math.PI],
          [s.x, s.y, s.z]
        );
      }
    };
    controls.addEventListener('objectChange', callback);
    return () => controls.removeEventListener('objectChange', callback);
  }, [objId, onTransformChange, meshRef]);

  return <TransformControls ref={controlsRef} mode={mode} />;
}

function SceneObjectMesh({ obj, isSelected, onSelect, transformMode, onTransformChange }: {
  obj: SceneObject;
  isSelected: boolean;
  onSelect: (id: string) => void;
  transformMode: 'translate' | 'rotate' | 'scale';
  onTransformChange: (id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!obj.locked) onSelect(obj.id);
  }, [obj.id, obj.locked, onSelect]);

  const geometry = useMemo(() => {
    switch (obj.type) {
      case 'box': case 'stage-rect': case 'backdrop': case 'billboard': case 'standee':
        return <boxGeometry args={[1, 1, 1]} />;
      case 'cylinder': case 'stage-round':
        return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
      case 'sphere':
        return <sphereGeometry args={[0.5, 32, 32]} />;
      case 'plane':
        return <planeGeometry args={[1, 1]} />;
      case 'lightbox':
        return <boxGeometry args={[1, 1, 0.1]} />;
      default:
        return <boxGeometry args={[1, 1, 1]} />;
    }
  }, [obj.type]);

  if (!obj.visible) return null;

  return (
    <>
      <mesh
        ref={meshRef}
        position={obj.position}
        rotation={obj.rotation.map(r => r * Math.PI / 180) as [number, number, number]}
        scale={obj.scale}
        onClick={handleClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        castShadow
        receiveShadow
      >
        {geometry}
        <meshStandardMaterial
          color={obj.color}
          roughness={0.6}
          metalness={0.1}
          emissive={obj.type === 'lightbox' ? obj.color : '#000000'}
          emissiveIntensity={obj.type === 'lightbox' ? 0.8 : 0}
        />
      </mesh>
      {isSelected && !obj.locked && (
        <TransformControlsWrapper
          meshRef={meshRef}
          mode={transformMode}
          objId={obj.id}
          onTransformChange={onTransformChange}
        />
      )}
    </>
  );
}

/* Fixed: Render each light type correctly */
function SceneLightHelper({ light }: { light: SceneLight }) {
  if (light.type === 'ambient') {
    return <ambientLight intensity={light.intensity} color={light.color} />;
  }
  if (light.type === 'directional') {
    return <directionalLight position={light.position} intensity={light.intensity} color={light.color} castShadow />;
  }
  if (light.type === 'spot') {
    return <spotLight position={light.position} intensity={light.intensity} color={light.color} angle={((light.angle ?? 45) / 180) * Math.PI} penumbra={0.5} castShadow />;
  }
  // point light
  return <pointLight position={light.position} intensity={light.intensity} color={light.color} castShadow />;
}

function SceneCanvas({ objects, lights, selectedId, transformMode, onSelectObject, onTransformChange, cameraPreset }: {
  objects: SceneObject[];
  lights: SceneLight[];
  selectedId: string | null;
  transformMode: 'translate' | 'rotate' | 'scale';
  onSelectObject: (id: string | null) => void;
  onTransformChange: (id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void;
  cameraPreset: CameraPreset;
}) {
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  useEffect(() => {
    if (!orbitRef.current) return;
    const preset = CAMERA_PRESETS.find(p => p.key === cameraPreset);
    if (preset && cameraPreset !== 'free') {
      orbitRef.current.reset();
      setTimeout(() => {
        if (!orbitRef.current) return;
        orbitRef.current.target.set(...preset.target);
        orbitRef.current.object.position.set(...preset.position);
        orbitRef.current.update();
      }, 50);
    }
  }, [cameraPreset]);

  return (
    <>
      {lights.map(l => <SceneLightHelper key={l.id} light={l} />)}
      <Grid
        args={[20, 20]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#333333"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#444444"
        fadeDistance={25}
        infiniteGrid
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
      {objects.map(obj => (
        <SceneObjectMesh
          key={obj.id}
          obj={obj}
          isSelected={selectedId === obj.id}
          onSelect={onSelectObject}
          transformMode={transformMode}
          onTransformChange={onTransformChange}
        />
      ))}
      <OrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={1}
        maxDistance={50}
      />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#f73b3b', '#3bf73b', '#3b3bf7']} labelColor="white" />
      </GizmoHelper>
    </>
  );
}

/* ========== LEFT SIDEBAR TAB CONTENTS ========== */

function GeometryGrid({ onAddObject }: { onAddObject: (type: SceneObject['type']) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 p-2">
      {GEOMETRY_PRESETS.map(preset => (
        <button
          key={preset.type}
          onClick={() => onAddObject(preset.type)}
          className="flex flex-col items-center gap-1 p-2 rounded-lg transition-all cursor-pointer hover:scale-[1.02]"
          style={{ background: BG_TERTIARY, border: `1px solid ${BORDER_COLOR}`, color: TEXT_SECONDARY }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER_COLOR; e.currentTarget.style.color = TEXT_SECONDARY; }}
        >
          {preset.icon}
          <span className="text-[13px]">{preset.name}</span>
        </button>
      ))}
    </div>
  );
}

function ObjectList({ objects, selectedId, onSelectObject, onDeleteObject, onToggleVisibility, onToggleLock, onDuplicateObject }: {
  objects: SceneObject[];
  selectedId: string | null;
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDuplicateObject: (id: string) => void;
}) {
  return (
    <div className="space-y-0.5 p-2">
      {objects.length === 0 && (
        <p className="text-center py-4 text-xs" style={{ color: TEXT_DIM }}>场景为空，添加几何体开始</p>
      )}
      {objects.map(obj => (
        <div
          key={obj.id}
          onClick={() => onSelectObject(obj.id)}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors group"
          style={{
            background: selectedId === obj.id ? `${ACCENT}15` : 'transparent',
            borderLeft: selectedId === obj.id ? `2px solid ${ACCENT}` : '2px solid transparent',
          }}
        >
          <span className="text-xs flex-1 truncate" style={{ color: selectedId === obj.id ? ACCENT : TEXT_PRIMARY, opacity: obj.visible ? 1 : 0.4 }}>
            {obj.name}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); onToggleVisibility(obj.id); }} className="p-0.5 cursor-pointer" style={{ color: TEXT_DIM }}>
              {obj.visible ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onToggleLock(obj.id); }} className="p-0.5 cursor-pointer" style={{ color: TEXT_DIM }}>
              {obj.locked ? <Lock size={11} /> : <Unlock size={11} />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDuplicateObject(obj.id); }} className="p-0.5 cursor-pointer" style={{ color: TEXT_DIM }}>
              <Copy size={11} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDeleteObject(obj.id); }} className="p-0.5 cursor-pointer hover:text-red-400" style={{ color: TEXT_DIM }}>
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelImportPanel({ onModelUpload }: { onModelUpload: (file: File) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    // Validate file size
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_MODEL_SIZE_MB) {
      setUploadError(`模型文件不能超过 ${MAX_MODEL_SIZE_MB}MB，当前 ${sizeMB.toFixed(1)}MB`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Validate format
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'glb' && ext !== 'gltf') {
      setUploadError('仅支持 .glb 和 .gltf 格式');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    onModelUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onModelUpload]);

  return (
    <div className="space-y-2 p-2">
      <input ref={fileInputRef} type="file" accept=".glb,.gltf" className="hidden" onChange={handleChange} />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed transition-colors cursor-pointer"
        style={{ borderColor: BORDER_COLOR, color: TEXT_SECONDARY, background: BG_TERTIARY }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER_COLOR; e.currentTarget.style.color = TEXT_SECONDARY; }}
      >
        <Upload size={16} />
        <span className="text-xs">导入 GLB / GLTF</span>
      </button>
      <p className="text-[13px] text-center" style={{ color: TEXT_DIM }}>支持 .glb .gltf 格式，最大 {MAX_MODEL_SIZE_MB}MB</p>
      {uploadError && (
        <p className="text-[13px] text-center text-red-400">{uploadError}</p>
      )}
    </div>
  );
}

function LightPresetsPanel({ onApplyPreset }: { onApplyPreset: (preset: Omit<SceneLight, 'id'>[]) => void }) {
  return (
    <div className="space-y-1.5 p-2">
      <p className="text-[13px] uppercase tracking-wider font-semibold mb-1" style={{ color: TEXT_DIM }}>灯光预设</p>
      {LIGHT_PRESETS_DATA.map((preset, i) => (
        <button
          key={i}
          onClick={() => onApplyPreset(preset.lights)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer"
          style={{ background: BG_TERTIARY, color: TEXT_SECONDARY, border: `1px solid ${BORDER_COLOR}` }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER_COLOR; e.currentTarget.style.color = TEXT_SECONDARY; }}
        >
          <Sun size={12} />
          {preset.name}
          <span className="ml-auto text-[9px]" style={{ color: TEXT_DIM }}>{preset.lights.length}灯</span>
        </button>
      ))}
    </div>
  );
}

function CameraPresetsPanel({ currentPreset, onApplyPreset, savedViews, onSaveView, onDeleteView, onGoToView }: {
  currentPreset: CameraPreset;
  onApplyPreset: (preset: CameraPreset) => void;
  savedViews: CameraView[];
  onSaveView: () => void;
  onDeleteView: (id: string) => void;
  onGoToView: (view: CameraView) => void;
}) {
  return (
    <div className="space-y-2 p-2">
      <p className="text-[13px] uppercase tracking-wider font-semibold" style={{ color: TEXT_DIM }}>相机预设</p>
      <div className="flex flex-wrap gap-1">
        {CAMERA_PRESETS.map(preset => (
          <button
            key={preset.key}
            onClick={() => onApplyPreset(preset.key)}
            className="px-2.5 py-1.5 rounded text-[13px] transition-colors cursor-pointer"
            style={{
              background: currentPreset === preset.key ? `${ACCENT}20` : BG_TERTIARY,
              color: currentPreset === preset.key ? ACCENT : TEXT_SECONDARY,
              border: `1px solid ${currentPreset === preset.key ? ACCENT : BORDER_COLOR}`,
            }}
          >
            {preset.name}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <p className="text-[13px] uppercase tracking-wider font-semibold" style={{ color: TEXT_DIM }}>保存的视角</p>
        <button onClick={onSaveView} className="flex items-center gap-1 px-2 py-0.5 rounded text-[13px] cursor-pointer" style={{ color: ACCENT }}>
          <Bookmark size={10} /> 保存当前视角
        </button>
      </div>
      {savedViews.length === 0 ? (
        <p className="text-[13px] text-center py-2" style={{ color: TEXT_DIM }}>暂无保存的视角</p>
      ) : (
        <div className="space-y-0.5">
          {savedViews.map(view => (
            <div key={view.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded group" style={{ background: BG_TERTIARY }}>
              <Camera size={10} style={{ color: TEXT_DIM }} />
              <button onClick={() => onGoToView(view)} className="text-xs flex-1 text-left cursor-pointer" style={{ color: TEXT_PRIMARY }}>{view.name}</button>
              <button onClick={() => onDeleteView(view.id)} className="p-0.5 opacity-0 group-hover:opacity-100 cursor-pointer" style={{ color: TEXT_DIM }}>
                <Trash2 size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========== RIGHT PANEL: PROPERTIES ========== */

function PropertiesPanel({ selectedObject, onUpdateObject, isMonochrome }: {
  selectedObject: SceneObject | null;
  onUpdateObject: (id: string, updates: Partial<SceneObject>) => void;
  isMonochrome?: boolean;
}) {
  if (!selectedObject) {
    return (
      <div className="flex-shrink-0 flex flex-col items-center justify-center py-6" style={{ color: TEXT_DIM }}>
        <MousePointer2 size={20} />
        <p className="text-[13px] mt-2">选中对象查看属性</p>
      </div>
    );
  }

  const accent = isMonochrome ? '#3b82f6' : ACCENT;

  return (
    <div className="flex-shrink-0 flex flex-col overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
      {/* Object name */}
      <div className="p-2 border-b" style={{ borderColor: BORDER_COLOR }}>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ background: selectedObject.color }} />
          <input
            value={selectedObject.name}
            onChange={e => onUpdateObject(selectedObject.id, { name: e.target.value })}
            className="flex-1 bg-transparent text-xs font-medium outline-none"
            style={{ color: TEXT_PRIMARY }}
          />
        </div>
      </div>

      {/* Transform */}
      <div className="p-2 border-b" style={{ borderColor: BORDER_COLOR }}>
        <h4 className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: TEXT_DIM }}>位置</h4>
        <div className="grid grid-cols-3 gap-1">
          {(['x', 'y', 'z'] as const).map(axis => (
            <div key={axis} className="flex flex-col">
              <label className="text-[8px] mb-0.5" style={{ color: axis === 'x' ? '#f73b3b' : axis === 'y' ? '#3bf73b' : '#3b3bf7' }}>{axis.toUpperCase()}</label>
              <input
                type="number"
                step={0.1}
                value={selectedObject.position[{ x: 0, y: 1, z: 2 }[axis]]}
                onChange={e => {
                  const i = { x: 0, y: 1, z: 2 }[axis];
                  const p: [number, number, number] = [...selectedObject.position];
                  p[i] = parseFloat(e.target.value) || 0;
                  onUpdateObject(selectedObject.id, { position: p });
                }}
                className="w-full px-1 py-0.5 rounded text-[13px] outline-none"
                style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
              />
            </div>
          ))}
        </div>

        <h4 className="text-[9px] uppercase tracking-wider mb-1.5 mt-2 font-semibold" style={{ color: TEXT_DIM }}>旋转</h4>
        <div className="grid grid-cols-3 gap-1">
          {(['x', 'y', 'z'] as const).map(axis => (
            <div key={axis} className="flex flex-col">
              <label className="text-[8px] mb-0.5" style={{ color: axis === 'x' ? '#f73b3b' : axis === 'y' ? '#3bf73b' : '#3b3bf7' }}>{axis.toUpperCase()}</label>
              <input
                type="number"
                step={5}
                value={Math.round(selectedObject.rotation[{ x: 0, y: 1, z: 2 }[axis]])}
                onChange={e => {
                  const i = { x: 0, y: 1, z: 2 }[axis];
                  const r: [number, number, number] = [...selectedObject.rotation];
                  r[i] = parseFloat(e.target.value) || 0;
                  onUpdateObject(selectedObject.id, { rotation: r });
                }}
                className="w-full px-1 py-0.5 rounded text-[13px] outline-none"
                style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
              />
            </div>
          ))}
        </div>

        <h4 className="text-[9px] uppercase tracking-wider mb-1.5 mt-2 font-semibold" style={{ color: TEXT_DIM }}>缩放</h4>
        <div className="grid grid-cols-3 gap-1">
          {(['x', 'y', 'z'] as const).map(axis => (
            <div key={axis} className="flex flex-col">
              <label className="text-[8px] mb-0.5" style={{ color: axis === 'x' ? '#f73b3b' : axis === 'y' ? '#3bf73b' : '#3b3bf7' }}>{axis.toUpperCase()}</label>
              <input
                type="number"
                step={0.1}
                value={selectedObject.scale[{ x: 0, y: 1, z: 2 }[axis]].toFixed(2)}
                onChange={e => {
                  const i = { x: 0, y: 1, z: 2 }[axis];
                  const s: [number, number, number] = [...selectedObject.scale];
                  s[i] = parseFloat(e.target.value) || 0.1;
                  onUpdateObject(selectedObject.id, { scale: s });
                }}
                className="w-full px-1 py-0.5 rounded text-[13px] outline-none"
                style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Material */}
      <div className="p-2 border-b" style={{ borderColor: BORDER_COLOR }}>
        <h4 className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: TEXT_DIM }}>材质颜色</h4>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={selectedObject.color}
            onChange={e => onUpdateObject(selectedObject.id, { color: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer border-0"
            style={{ background: BG_TERTIARY }}
          />
          <input
            value={selectedObject.color}
            onChange={e => onUpdateObject(selectedObject.id, { color: e.target.value })}
            className="flex-1 px-2 py-0.5 rounded text-[13px] outline-none"
            style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
          />
        </div>
      </div>

      {/* Quick actions */}
      <div className="p-2">
        <h4 className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: TEXT_DIM }}>快捷操作</h4>
        <div className="space-y-0.5">
          <button
            onClick={() => onUpdateObject(selectedObject.id, { position: [0, 0, 0] })}
            className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[13px] transition-colors cursor-pointer"
            style={{ background: BG_TERTIARY, color: TEXT_SECONDARY, border: `1px solid ${BORDER_COLOR}` }}
          >
            <RotateCw size={10} /> 归零位置
          </button>
          <button
            onClick={() => onUpdateObject(selectedObject.id, { scale: [1, 1, 1] })}
            className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[13px] transition-colors cursor-pointer"
            style={{ background: BG_TERTIARY, color: TEXT_SECONDARY, border: `1px solid ${BORDER_COLOR}` }}
          >
            <Maximize2 size={10} /> 重置缩放
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========== AI GENERATION PANEL ========== */

function AIGenerationPanel({
  onCaptureScreenshot, generationMode, setGenerationMode, strengthMode, setStrengthMode,
  prompt, setPrompt, negativePrompt, setNegativePrompt, onGenerate, isGenerating,
  generationResults, onAddToCanvas, isMonochrome, aspectRatio, setAspectRatio, imageCount, setImageCount
}: {
  onCaptureScreenshot: () => void;
  generationMode: GenerationMode;
  setGenerationMode: (m: GenerationMode) => void;
  strengthMode: StrengthMode;
  setStrengthMode: (s: StrengthMode) => void;
  prompt: string;
  setPrompt: (p: string) => void;
  negativePrompt: string;
  setNegativePrompt: (p: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  generationResults: GenerationResult[];
  onAddToCanvas: (url: string) => void;
  isMonochrome?: boolean;
  aspectRatio: string;
  setAspectRatio: (r: string) => void;
  imageCount: number;
  setImageCount: (n: number) => void;
}) {
  const accent = isMonochrome ? '#3b82f6' : ACCENT;
  const [showNegPrompt, setShowNegPrompt] = useState(false);
  const [aiLayoutPrompt, setAiLayoutPrompt] = useState('');
  const [showResults, setShowResults] = useState(false);

  return (
    <div className="space-y-2 p-2">
      {/* Mode selection */}
      <div className="flex items-center gap-1">
        {[
          { mode: 'image-to-image' as GenerationMode, label: '当前视角生图', icon: <ImagePlus size={12} /> },
          { mode: 'text-to-image' as GenerationMode, label: '文生图', icon: <Sparkles size={12} /> },
        ].map(tab => (
          <button
            key={tab.mode}
            onClick={() => setGenerationMode(tab.mode)}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[13px] transition-all cursor-pointer"
            style={{
              background: generationMode === tab.mode ? `${accent}20` : 'transparent',
              color: generationMode === tab.mode ? accent : TEXT_DIM,
              border: generationMode === tab.mode ? `1px solid ${accent}40` : '1px solid transparent',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        <button
          onClick={onCaptureScreenshot}
          className="flex items-center gap-1 px-2 py-1 rounded text-[13px] cursor-pointer ml-auto"
          style={{ background: BG_TERTIARY, color: TEXT_SECONDARY, border: `1px solid ${BORDER_COLOR}` }}
        >
          <Camera size={10} /> 截图
        </button>
      </div>

      {/* Strength mode */}
      <div className="flex flex-wrap items-center gap-1">
        {STRENGTH_MODES.map(mode => (
          <button
            key={mode.key}
            onClick={() => { setStrengthMode(mode.key); if (!prompt.trim()) setPrompt(mode.promptHint); }}
            className="px-1.5 py-0.5 rounded text-[9px] transition-colors cursor-pointer"
            style={{
              background: strengthMode === mode.key ? `${accent}20` : BG_TERTIARY,
              color: strengthMode === mode.key ? accent : TEXT_DIM,
              border: `1px solid ${strengthMode === mode.key ? accent : BORDER_COLOR}`,
            }}
            title={mode.desc}
          >
            {mode.name}
          </button>
        ))}
      </div>

      {/* Aspect ratio and count */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-[9px]" style={{ color: TEXT_DIM }}>比例</span>
          <select
            value={aspectRatio}
            onChange={e => setAspectRatio(e.target.value)}
            className="px-1.5 py-0.5 rounded text-[13px] outline-none cursor-pointer"
            style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
          >
            {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px]" style={{ color: TEXT_DIM }}>数量</span>
          <div className="flex gap-0.5">
            {[1, 4].map(n => (
              <button
                key={n}
                onClick={() => setImageCount(n)}
                className="px-2 py-0.5 rounded text-[13px] cursor-pointer"
                style={{
                  background: imageCount === n ? `${accent}20` : BG_TERTIARY,
                  color: imageCount === n ? accent : TEXT_DIM,
                  border: `1px solid ${imageCount === n ? accent : BORDER_COLOR}`,
                }}
              >
                {n}张
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="描述你想要的画面效果..."
          rows={3}
          className="w-full px-2 py-1.5 rounded-lg text-[13px] outline-none resize-none"
          style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}`, scrollbarWidth: 'thin' }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isGenerating) onGenerate(); }}
        />
        <button
          onClick={() => setShowNegPrompt(!showNegPrompt)}
          className="text-[9px] text-left cursor-pointer"
          style={{ color: TEXT_DIM }}
        >
          {showNegPrompt ? '▼' : '▶'} 反向提示词
        </button>
        {showNegPrompt && (
          <textarea
            value={negativePrompt}
            onChange={e => setNegativePrompt(e.target.value)}
            placeholder="不想要的元素..."
            rows={2}
            className="w-full px-2 py-1.5 rounded-lg text-[13px] outline-none resize-none"
            style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
          />
        )}
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={isGenerating || !prompt.trim()}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: isGenerating ? BG_TERTIARY : accent,
          color: isGenerating ? TEXT_DIM : '#000000',
        }}
      >
        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        {isGenerating ? '生成中...' : `生成${imageCount > 1 ? ` ${imageCount} 张` : ''}`}
      </button>

      {/* Results */}
      {generationResults.length > 0 && (
        <div>
          <button
            onClick={() => setShowResults(!showResults)}
            className="flex items-center gap-1 text-[13px] cursor-pointer"
            style={{ color: accent }}
          >
            {showResults ? '▼' : '▶'} 生成结果 ({generationResults.length})
          </button>
          {showResults && (
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              {generationResults.map(result => (
                <div
                  key={result.id}
                  className="rounded-lg overflow-hidden relative group cursor-pointer"
                  style={{ border: `1px solid ${BORDER_COLOR}` }}
                >
                  <img src={result.url} alt="" className="w-full h-20 object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    <button
                      onClick={() => onAddToCanvas(result.url)}
                      className="px-1.5 py-0.5 rounded text-[9px] cursor-pointer"
                      style={{ background: accent, color: '#000' }}
                    >
                      加入画布
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========== AI AUTO LAYOUT PANEL ========== */

function AIAutoLayoutPanel({ onApplyLayout, isGenerating, isMonochrome, chatModels, selectedChatModel, onSelectChatModel }: {
  onApplyLayout: (description: string) => void;
  isGenerating: boolean;
  isMonochrome?: boolean;
  chatModels: { id: string; providerId: string; name: string; providerName?: string }[];
  selectedChatModel: string;
  onSelectChatModel: (id: string) => void;
}) {
  const [description, setDescription] = useState('');
  const accent = isMonochrome ? '#3b82f6' : ACCENT;

  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center gap-1.5">
        <Wand2 size={12} style={{ color: accent }} />
        <span className="text-[13px] font-medium" style={{ color: TEXT_PRIMARY }}>AI 自动布景</span>
      </div>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="描述你想要的场景，例如：做一个红色年轻化品牌快闪店，中央有产品展示台，左侧是便利店货架..."
        rows={4}
        className="w-full px-2 py-1.5 rounded-lg text-[13px] outline-none resize-none"
        style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}`, scrollbarWidth: 'thin' }}
      />
      {chatModels.length > 0 ? (
        <select
          value={selectedChatModel}
          onChange={e => onSelectChatModel(e.target.value)}
          className="w-full px-2 py-1 rounded-lg text-[11px] outline-none cursor-pointer"
          style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
        >
          {chatModels.map(m => (
            <option key={m.id} value={m.id}>
              {m.providerName ? `[${m.providerName}] ` : ''}{m.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-[10px] py-1" style={{ color: TEXT_DIM }}>请先在管理员后台配置 LLM 模型</p>
      )}
      <div className="space-y-1">
        <p className="text-[9px]" style={{ color: TEXT_DIM }}>快速模板：</p>
        <div className="flex flex-wrap gap-1">
          {['品牌快闪店', '产品展台', '便利店场景', '美妆柜台', '科技展位', '食品货架'].map(tpl => (
            <button
              key={tpl}
              onClick={() => setDescription(prev => prev + (prev ? '，' : '') + tpl)}
              className="px-1.5 py-0.5 rounded-full text-[9px] cursor-pointer transition-colors"
              style={{ background: BG_TERTIARY, color: TEXT_SECONDARY, border: `1px solid ${BORDER_COLOR}` }}
            >
              {tpl}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={() => onApplyLayout(description)}
        disabled={isGenerating || !description.trim()}
        className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: accent, color: '#000' }}
      >
        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
        {isGenerating ? 'AI 布景中...' : '一键布景'}
      </button>
    </div>
  );
}

/* ========== ASSET MANAGEMENT PANEL ========== */

function AssetManagementPanel({ onSaveScene, onLoadScene, onExportScene, onDeleteScene, onDuplicateScene, scenes, onLoadById, isMonochrome }: {
  onSaveScene: () => void;
  onLoadScene: () => void;
  onExportScene: () => void;
  onDeleteScene: (id: string) => void;
  onDuplicateScene: (id: string) => void;
  scenes: { id: string; name: string; updatedAt?: string }[];
  onLoadById: (id: string) => void;
  isMonochrome?: boolean;
}) {
  const accent = isMonochrome ? '#3b82f6' : ACCENT;
  const [showSceneList, setShowSceneList] = useState(false);

  return (
    <div className="space-y-1.5 p-2">
      <div className="flex items-center gap-1.5">
        <Archive size={12} style={{ color: accent }} />
        <span className="text-[13px] font-medium" style={{ color: TEXT_PRIMARY }}>资产管理</span>
      </div>

      <button
        onClick={onSaveScene}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors cursor-pointer"
        style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
      >
        <Save size={10} style={{ color: accent }} /> 保存当前场景
      </button>

      <button
        onClick={() => setShowSceneList(!showSceneList)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors cursor-pointer"
        style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
      >
        <FolderOpen size={10} style={{ color: accent }} /> 已保存场景 ({scenes.length})
      </button>

      {showSceneList && (
        <div className="space-y-0.5 max-h-40 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {scenes.length === 0 ? (
            <p className="text-[13px] text-center py-2" style={{ color: TEXT_DIM }}>暂无保存的场景</p>
          ) : (
            scenes.map(scene => (
              <div key={scene.id} className="flex items-center gap-1.5 px-2 py-1 rounded group" style={{ background: BG_TERTIARY }}>
                <LayoutGrid size={9} style={{ color: TEXT_DIM }} />
                <button onClick={() => onLoadById(scene.id)} className="text-[13px] flex-1 text-left cursor-pointer" style={{ color: TEXT_PRIMARY }}>
                  {scene.name}
                </button>
                <button onClick={() => onDuplicateScene(scene.id)} className="p-0.5 opacity-0 group-hover:opacity-100 cursor-pointer" style={{ color: TEXT_DIM }} title="复制场景">
                  <Copy size={9} />
                </button>
                <button onClick={() => onDeleteScene(scene.id)} className="p-0.5 opacity-0 group-hover:opacity-100 cursor-pointer" style={{ color: TEXT_DIM }}>
                  <Trash2 size={9} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <button
        onClick={onExportScene}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors cursor-pointer"
        style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
      >
        <Download size={10} style={{ color: accent }} /> 导出场景文件
      </button>
    </div>
  );
}

/* ========== LIGHT EDITOR PANEL ========== */

function LightEditorPanel({ lights, onLightsChange, isMonochrome }: {
  lights: SceneLight[];
  onLightsChange: (lights: SceneLight[]) => void;
  isMonochrome?: boolean;
}) {
  const accent = isMonochrome ? '#3b82f6' : ACCENT;
  const [expandedLight, setExpandedLight] = useState<string | null>(null);
  const LIGHT_TYPE_LABELS: Record<SceneLight['type'], string> = { ambient: '环境光', directional: '方向光', point: '点光', spot: '聚光灯' };

  return (
    <div className="space-y-1.5 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: TEXT_DIM }}>灯光设置</span>
        <button
          onClick={() => onLightsChange([...lights, {
            id: `light_${Date.now()}`,
            type: 'directional' as const,
            name: `灯光${lights.length + 1}`,
            intensity: 1,
            color: '#ffffff',
            position: [3, 5, 4] as [number, number, number],
          }])}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] cursor-pointer"
          style={{ color: accent }}
        >
          <Plus size={9} /> 添加
        </button>
      </div>
      {lights.map(light => (
        <div key={light.id}>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer" style={{ background: BG_TERTIARY }} onClick={() => setExpandedLight(expandedLight === light.id ? null : light.id)}>
            <Lightbulb size={10} style={{ color: light.color }} />
            <span className="text-[13px] flex-1 truncate" style={{ color: TEXT_PRIMARY }}>{light.name}</span>
            <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: BG_HOVER, color: TEXT_DIM }}>{LIGHT_TYPE_LABELS[light.type]}</span>
            <input
              type="range" min={0} max={3} step={0.1}
              value={light.intensity}
              onChange={e => { e.stopPropagation(); onLightsChange(lights.map(l => l.id === light.id ? { ...l, intensity: parseFloat(e.target.value) } : l)); }}
              className="w-10 h-1 accent-amber-500"
              onClick={e => e.stopPropagation()}
            />
            <input
              type="color"
              value={light.color}
              onChange={e => { e.stopPropagation(); onLightsChange(lights.map(l => l.id === light.id ? { ...l, color: e.target.value } : l)); }}
              className="w-4 h-4 rounded cursor-pointer border-0"
              onClick={e => e.stopPropagation()}
            />
            <button onClick={e => { e.stopPropagation(); onLightsChange(lights.filter(l => l.id !== light.id)); }} className="cursor-pointer" style={{ color: TEXT_DIM }}>
              <Trash2 size={9} />
            </button>
            {expandedLight === light.id ? <ChevronDown size={9} style={{ color: TEXT_DIM }} /> : <ChevronRight size={9} style={{ color: TEXT_DIM }} />}
          </div>
          {expandedLight === light.id && (
            <div className="px-2 py-1.5 space-y-1.5 mt-0.5 rounded-b" style={{ background: BG_HOVER }}>
              {/* Light name */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] w-8" style={{ color: TEXT_DIM }}>名称</span>
                <input
                  value={light.name}
                  onChange={e => onLightsChange(lights.map(l => l.id === light.id ? { ...l, name: e.target.value } : l))}
                  className="flex-1 px-1.5 py-0.5 rounded text-[13px] outline-none"
                  style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
                />
              </div>
              {/* Light type */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] w-8" style={{ color: TEXT_DIM }}>类型</span>
                <select
                  value={light.type}
                  onChange={e => onLightsChange(lights.map(l => l.id === light.id ? { ...l, type: e.target.value as SceneLight['type'] } : l))}
                  className="flex-1 px-1.5 py-0.5 rounded text-[13px] outline-none cursor-pointer"
                  style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
                >
                  <option value="ambient">环境光</option>
                  <option value="directional">方向光</option>
                  <option value="point">点光</option>
                  <option value="spot">聚光灯</option>
                </select>
              </div>
              {/* Light position */}
              {light.type !== 'ambient' && (
                <div className="space-y-1">
                  <span className="text-[9px]" style={{ color: TEXT_DIM }}>位置</span>
                  <div className="grid grid-cols-3 gap-1">
                    {(['x', 'y', 'z'] as const).map(axis => {
                      const idx = { x: 0, y: 1, z: 2 }[axis];
                      return (
                        <div key={axis} className="flex flex-col">
                          <label className="text-[8px]" style={{ color: axis === 'x' ? '#f73b3b' : axis === 'y' ? '#3bf73b' : '#3b3bf7' }}>{axis.toUpperCase()}</label>
                          <input
                            type="number" step={0.5}
                            value={light.position[idx]}
                            onChange={e => {
                              const p: [number, number, number] = [...light.position];
                              p[idx] = parseFloat(e.target.value) || 0;
                              onLightsChange(lights.map(l => l.id === light.id ? { ...l, position: p } : l));
                            }}
                            className="w-full px-1 py-0.5 rounded text-[13px] outline-none"
                            style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Spot angle */}
              {light.type === 'spot' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] w-8" style={{ color: TEXT_DIM }}>角度</span>
                  <input
                    type="range" min={10} max={90} step={5} value={light.angle ?? 45}
                    onChange={e => onLightsChange(lights.map(l => l.id === light.id ? { ...l, angle: parseInt(e.target.value) } : l))}
                    className="flex-1 h-1 accent-amber-500"
                  />
                  <span className="text-[9px]" style={{ color: TEXT_DIM }}>{light.angle ?? 45}°</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ========== MAIN COMPONENT ========== */

export default function SceneStudioPanel({ onClose, onAddImages, isMonochrome }: SceneStudioProps) {
  // Scene state
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [lights, setLights] = useState<SceneLight[]>([
    { id: 'ambient_1', type: 'ambient', name: '环境光', intensity: 0.6, color: '#fff4e6', position: [0, 5, 0] },
    { id: 'main_1', type: 'directional', name: '主光', intensity: 1.2, color: '#ffffff', position: [3, 5, 4] },
    { id: 'fill_1', type: 'directional', name: '补光', intensity: 0.5, color: '#e6f0ff', position: [-3, 3, 2] },
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('45degree');

  // AI generation state
  const [generationMode, setGenerationMode] = useState<GenerationMode>('image-to-image');
  const [strengthMode, setStrengthMode] = useState<StrengthMode>('balanced');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('低质量, 模糊, 变形, 畸形, 水印, 文字');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResults, setGenerationResults] = useState<GenerationResult[]>([]);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageCount, setImageCount] = useState(1);

  // Model selection state
  const [imageModels, setImageModels] = useState<{ id: string; name: string; providerId: string; providerName: string }[]>([]);
  const [chatModels, setChatModels] = useState<{ id: string; name: string; providerId: string; providerName: string }[]>([]);
  const [selectedImageModelId, setSelectedImageModelId] = useState<string>('');
  const [selectedChatModelId, setSelectedChatModelId] = useState<string>('');
  const [showImageModelDropdown, setShowImageModelDropdown] = useState(false);
  const [showChatModelDropdown, setShowChatModelDropdown] = useState(false);

  // Load models on mount
  useEffect(() => {
    (async () => {
      try {
        const [imgRes, chatRes] = await Promise.all([
          fetch('/api/models?type=image'),
          fetch('/api/models?type=chat'),
        ]);
        if (imgRes.ok) {
          const imgData = await imgRes.json();
          // Build providerId→providerName map from providers array
          const providerMap: Record<string, string> = {};
          for (const p of imgData.providers || []) {
            providerMap[p.id] = p.displayName || p.name || p.id;
          }
          // API returns flat models array: { id, name, providerId, ... }
          const models = (imgData.models || []).map((m: { id: string; name: string; providerId?: string }) => ({
            id: m.providerId ? `${m.providerId}::${m.id}` : m.id,
            name: m.name || m.id,
            providerId: m.providerId || '',
            providerName: m.providerId ? (providerMap[m.providerId] || m.providerId) : '',
          }));
          setImageModels(models);
          if (models.length > 0) setSelectedImageModelId(models[0].id);
        }
        if (chatRes.ok) {
          const chatData = await chatRes.json();
          const providerMap: Record<string, string> = {};
          for (const p of chatData.providers || []) {
            providerMap[p.id] = p.displayName || p.name || p.id;
          }
          const models = (chatData.models || []).map((m: { id: string; name: string; providerId?: string }) => ({
            id: m.providerId ? `${m.providerId}::${m.id}` : m.id,
            name: m.name || m.id,
            providerId: m.providerId || '',
            providerName: m.providerId ? (providerMap[m.providerId] || m.providerId) : '',
          }));
          setChatModels(models);
          if (models.length > 0) setSelectedChatModelId(models[0].id);
        }
      } catch (e) { console.error('[scene-studio] Failed to load models:', e); }
    })();
  }, []);

  // UI state
  const [rightTab, setRightTab] = useState<'build' | 'generate' | 'layout' | 'assets'>('build');
  const [savedCameraViews, setSavedCameraViews] = useState<CameraView[]>([]);
  const [isAILayoutGenerating, setIsAILayoutGenerating] = useState(false);
  const [sceneName, setSceneName] = useState('未命名场景');
  const [savedSceneList, setSavedSceneList] = useState<{ id: string; name: string; updatedAt?: string }[]>([]);
  const [showNegPrompt, setShowNegPrompt] = useState(false);

  // Window drag state (consistent with ImageEditor)
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [windowPos, setWindowPos] = useState(() => {
    if (typeof window !== 'undefined') {
      return { x: 40, y: 40 };
    }
    return { x: 40, y: 40 };
  });

  const accent = isMonochrome ? '#3b82f6' : ACCENT;
  const selectedObject = useMemo(() => objects.find(o => o.id === selectedId) || null, [objects, selectedId]);

  // Window drag handlers (consistent with ImageEditor pattern)
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragOffset({ x: e.clientX - windowPos.x, y: e.clientY - windowPos.y });
  }, [windowPos]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setWindowPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, dragOffset]);

  // Object management
  const addObject = useCallback((type: SceneObject['type']) => {
    const preset = GEOMETRY_PRESETS.find(p => p.type === type);
    const id = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newObj: SceneObject = {
      id,
      type,
      name: preset?.name || '模型',
      position: [0, type === 'plane' ? 0.01 : 0.5, 0],
      rotation: [0, 0, 0],
      scale: preset?.defaultScale || [1, 1, 1],
      color: preset?.defaultColor || '#808080',
      visible: true,
      locked: false,
    };
    setObjects(prev => [...prev, newObj]);
    setSelectedId(id);
  }, []);

  const addModelObject = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const id = `obj_model_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const name = file.name.replace(/\.(glb|gltf)$/i, '');
    const newObj: SceneObject = {
      id,
      type: 'model',
      name,
      modelUrl: url,
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#cccccc',
      visible: true,
      locked: false,
    };
    setObjects(prev => [...prev, newObj]);
    setSelectedId(id);
  }, []);

  const updateObject = useCallback((id: string, updates: Partial<SceneObject>) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  }, []);

  const deleteObject = useCallback((id: string) => {
    setObjects(prev => prev.filter(o => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const duplicateObject = useCallback((id: string) => {
    const obj = objects.find(o => o.id === id);
    if (!obj) return;
    const newId = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newObj: SceneObject = {
      ...obj,
      id: newId,
      name: `${obj.name} 副本`,
      position: [obj.position[0] + 1, obj.position[1], obj.position[2]],
    };
    setObjects(prev => [...prev, newObj]);
    setSelectedId(newId);
  }, [objects]);

  const handleTransformChange = useCallback((id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => {
    updateObject(id, { position, rotation, scale });
  }, [updateObject]);

  // Screenshot - Fixed: capture and use immediately
  const captureScreenshot = useCallback(() => {
    const canvas = document.querySelector('.scene-studio-canvas canvas');
    if (!canvas) return null;
    const url = (canvas as HTMLCanvasElement).toDataURL('image/png');
    setScreenshotUrl(url);
    return url;
  }, []);

  // AI Generation - Fixed: use screenshot immediately
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);

    try {
      // Capture screenshot immediately for image-to-image
      let referenceImageUrl: string | null = null;
      if (generationMode === 'image-to-image') {
        referenceImageUrl = captureScreenshot();
      }

      const strengthInfo = STRENGTH_MODES.find(m => m.key === strengthMode);
      const fullPrompt = generationMode === 'image-to-image'
        ? `请基于3D场景参考图生成一张高质量商业视觉图。画面结构必须参考输入图：保持主要物体位置、相机角度、前景中景背景关系、主体比例、空间透视。用户需求：${prompt}。视觉风格：${strengthInfo?.name || '平衡优化'}。输出要求：商业广告级画质，高级构图，真实光影，材质细腻，画面干净，品牌感强，不要杂乱，不要多余文字，不要水印。${negativePrompt ? `[negative: ${negativePrompt}]` : ''}`
        : `请根据用户需求生成一张商业级场景视觉图。用户需求：${prompt}。视觉风格：${strengthInfo?.name || '平衡优化'}。构图要求：主体明确，空间层次清晰，前景、中景、背景关系明确，适合商业广告展示。输出要求：高质量商业广告画面，真实光影，高级质感，画面整洁，品牌感强。${negativePrompt ? `[negative: ${negativePrompt}]` : ''}`;

      // Use scene-studio generate API
      const modelInfo = selectedImageModelId.includes('::')
        ? { model: selectedImageModelId.split('::').pop()!, providerId: selectedImageModelId.split('::')[0] }
        : { model: selectedImageModelId, providerId: undefined };

      const res = await fetch('/api/scene-studio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: generationMode === 'image-to-image' ? 'image_to_image' : 'text_to_image',
          prompt: fullPrompt,
          negativePrompt,
          screenshotData: referenceImageUrl,
          structureStrength: strengthInfo?.value || 60,
          aspectRatio,
          imageCount,
          model: modelInfo.model,
          providerId: modelInfo.providerId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      // Check for API-level errors (HTTP 200 but error in body)
      if (data.error) {
        throw new Error(data.error);
      }

      // Handle async polling response (pearapi, openai-async, etc.)
      if (data.isAsync && data.result?.taskIds?.length > 0) {
        const taskIds = data.result.taskIds;
        const pollModel = modelInfo.model;
        const pollProviderId = modelInfo.providerId;
        const pollApiBaseUrl = data.apiBaseUrl;
        const pollAdvancedParams = data.advancedParams;

        for (const taskId of taskIds) {
          const pollInterval = setInterval(async () => {
            try {
              const pollRes = await fetch('/api/poll-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, model: pollModel, providerId: pollProviderId, apiBaseUrl: pollApiBaseUrl, advancedParams: pollAdvancedParams }),
              });
              const pollData = await pollRes.json();
              if (pollData.status === 'completed' && pollData.result?.imageUrl) {
                clearInterval(pollInterval);
                setGenerationResults(prev => [{
                  id: `gen_${Date.now()}`,
                  url: pollData.result.imageUrl,
                  prompt,
                  mode: generationMode,
                  strengthMode,
                  timestamp: Date.now(),
                }, ...prev]);
                setIsGenerating(false);
              } else if (pollData.status === 'failed') {
                clearInterval(pollInterval);
                console.error('[SceneStudio] Poll failed:', pollData.error);
                alert('生成失败: ' + (pollData.error || '未知错误'));
                setIsGenerating(false);
              }
            } catch {
              clearInterval(pollInterval);
              setIsGenerating(false);
            }
          }, 2000);
          // Timeout after 3 minutes
          setTimeout(() => { clearInterval(pollInterval); setIsGenerating(false); }, 180000);
        }
        return; // Don't set isGenerating false yet — polling will handle it
      }

      // Handle different response formats from API providers
      const resultUrls: string[] = [];
      if (data.result?.data) {
        for (const item of (Array.isArray(data.result.data) ? data.result.data : [data.result.data])) {
          if (item.url) resultUrls.push(item.url);
          else if (item.b64_json) resultUrls.push(`data:image/png;base64,${item.b64_json}`);
        }
      } else if (data.result?.output?.image_urls) {
        resultUrls.push(...data.result.output.image_urls);
      }

      if (resultUrls.length > 0) {
        const newResults: GenerationResult[] = resultUrls.map(url => ({
          id: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          url,
          prompt,
          mode: generationMode,
          strengthMode,
          timestamp: Date.now(),
        }));
        setGenerationResults(prev => [...newResults, ...prev]);
      } else {
        // Fallback: try /api/generate + poll
        // Use selected model or fallback to localStorage
        const currentImageModel = (() => {
          // Prefer the model already selected in this panel
          if (selectedImageModelId) {
            return modelInfo; // { model, providerId } already parsed above
          }
          try {
            const saved = localStorage.getItem('wujie_selected_model');
            if (saved) {
              const parsed = JSON.parse(saved);
              const compositeKey = parsed.model || parsed.modelId || '';
              const pureModelId = compositeKey.includes('::') ? compositeKey.split('::')[1] : compositeKey;
              const providerId = compositeKey.includes('::') ? compositeKey.split('::')[0] : parsed.providerId;
              return { model: pureModelId, providerId };
            }
          } catch {}
          return { model: undefined, providerId: undefined };
        })();
        const fallbackRes = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: fullPrompt,
            aspectRatio,
            n: imageCount,
            referenceImageUrl,
            strength: strengthInfo?.value || 60,
            model: currentImageModel.model,
            providerId: currentImageModel.providerId,
          }),
        });

        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          const taskIds = fallbackData.taskIds || [];
          if (taskIds.length > 0) {
            const pollInterval = setInterval(async () => {
              try {
                const pollRes = await fetch('/api/poll-task', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId: taskIds[0], model: currentImageModel.model, providerId: currentImageModel.providerId }),
                });
                const pollData = await pollRes.json();
                if (pollData.status === 'completed' && pollData.result?.imageUrl) {
                  clearInterval(pollInterval);
                  setGenerationResults(prev => [{
                    id: `gen_${Date.now()}`,
                    url: pollData.result.imageUrl,
                    prompt,
                    mode: generationMode,
                    strengthMode,
                    timestamp: Date.now(),
                  }, ...prev]);
                  setIsGenerating(false);
                } else if (pollData.status === 'failed') {
                  clearInterval(pollInterval);
                  setIsGenerating(false);
                }
              } catch {
                clearInterval(pollInterval);
                setIsGenerating(false);
              }
            }, 2000);
            // Timeout after 3 minutes
            setTimeout(() => { clearInterval(pollInterval); setIsGenerating(false); }, 180000);
            return; // Don't set isGenerating false yet
          }
        }
      }

      // If we reach here without any results or async polling, show error
      if (!data.isAsync && resultUrls.length === 0) {
        const errMsg = data.error || data.result?.error || 'API 未返回图片结果，请检查模型配置';
        console.error('[SceneStudio] No results from API:', data);
        alert('生成失败: ' + errMsg);
      }
    } catch (err) {
      console.error('[SceneStudio] Generate error:', err);
      alert('生成失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, generationMode, strengthMode, negativePrompt, captureScreenshot, aspectRatio, imageCount, selectedImageModelId]);

  // AI Auto Layout
  const handleAILayout = useCallback(async (description: string) => {
    if (!description.trim()) return;
    setIsAILayoutGenerating(true);

    try {
      const chatModelInfo = selectedChatModelId.includes('::')
        ? { model: selectedChatModelId.split('::').pop()!, providerId: selectedChatModelId.split('::')[0] }
        : selectedChatModelId ? { model: selectedChatModelId, providerId: undefined } : {};

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `你是一个3D场景布景专家。请根据用户描述生成一个场景布局JSON。

用户描述：${description}

请输出以下格式的JSON（不要markdown代码块，直接输出JSON）：
{
  "objects": [
    {
      "type": "box|cylinder|plane|sphere|stage-round|stage-rect|backdrop|lightbox|billboard|standee",
      "name": "对象名称",
      "position": [x, y, z],
      "rotation": [rx, ry, rz],
      "scale": [sx, sy, sz],
      "color": "#hex颜色"
    }
  ],
  "cameraPreset": "front|side|top|45degree|free",
  "suggestedPrompt": "建议的AI生图提示词"
}

要求：
1. 所有坐标使用合理范围（position: -5到5，scale: 0.1到5）
2. 物体数量3-8个
3. 颜色使用hex格式
4. 场景要有层次感和商业感
5. 确保物体不会重叠`
          }],
          stream: false,
          ...chatModelInfo,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `AI layout failed (${res.status})`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.content || '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const layout = JSON.parse(jsonMatch[0]);
        if (layout.objects && Array.isArray(layout.objects)) {
          const newObjects: SceneObject[] = layout.objects.map((obj: Record<string, unknown>, i: number) => ({
            id: `obj_ai_${Date.now()}_${i}`,
            type: (obj.type as SceneObject['type']) || 'box',
            name: (obj.name as string) || `对象${i + 1}`,
            position: (obj.position as [number, number, number]) || [0, 0.5, 0],
            rotation: (obj.rotation as [number, number, number]) || [0, 0, 0],
            scale: (obj.scale as [number, number, number]) || [1, 1, 1],
            color: (obj.color as string) || '#808080',
            visible: true,
            locked: false,
          }));
          setObjects(newObjects);
          if (layout.cameraPreset) setCameraPreset(layout.cameraPreset as CameraPreset);
          if (layout.suggestedPrompt) setPrompt(layout.suggestedPrompt);
        }
      }
    } catch (err) {
      console.error('AI layout error:', err);
      const msg = err instanceof Error ? err.message : '未知错误';
      alert(`AI 布景失败：${msg}`);
    } finally {
      setIsAILayoutGenerating(false);
    }
  }, [selectedChatModelId]);
  const saveScene = useCallback(async (overrideName?: string, overrideSceneData?: Record<string, unknown>) => {
    try {
      let sceneData: Record<string, unknown>;
      if (overrideSceneData) {
        sceneData = { ...overrideSceneData, name: overrideName || (overrideSceneData.name as string) + ' 副本' };
        delete sceneData.id; // Generate new id for duplicate
        delete sceneData.updatedAt;
      } else {
        sceneData = {
          name: overrideName || sceneName,
          objects,
          lights,
          cameraPreset,
          savedCameraViews,
          prompt,
        };
      }
      const res = await fetch('/api/scene-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', sceneData }),
      });
      if (res.ok) {
        const data = await res.json();
        // Save screenshot too
        const screenshot = captureScreenshot();
        if (screenshot) {
          await fetch('/api/scene-studio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'saveScreenshot', sceneId: data.sceneId, screenshotData: screenshot }),
          });
        }
        loadSceneList();
      }
    } catch (err) {
      console.error('Save scene error:', err);
    }
  }, [sceneName, objects, lights, cameraPreset, savedCameraViews, prompt, captureScreenshot]);

  // Load scene list from server
  const loadSceneList = useCallback(async () => {
    try {
      const res = await fetch('/api/scene-studio');
      if (res.ok) {
        const data = await res.json();
        setSavedSceneList(data.scenes || []);
      }
    } catch { /* ignore */ }
  }, []);

  // Load scene by id
  const loadSceneById = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/scene-studio?sceneId=${id}`);
      if (res.ok) {
        const scene = await res.json();
        if (scene.objects) setObjects(scene.objects);
        if (scene.lights) setLights(scene.lights);
        if (scene.cameraPreset) setCameraPreset(scene.cameraPreset);
        if (scene.name) setSceneName(scene.name);
        if (scene.prompt) setPrompt(scene.prompt);
        if (scene.savedCameraViews) setSavedCameraViews(scene.savedCameraViews);
      }
    } catch (err) {
      console.error('Load scene error:', err);
    }
  }, []);

  // Delete scene
  const deleteScene = useCallback(async (id: string) => {
    try {
      await fetch('/api/scene-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', sceneId: id }),
      });
      loadSceneList();
    } catch { /* ignore */ }
  }, [loadSceneList]);

  const exportScene = useCallback(() => {
    const sceneJson = JSON.stringify({ name: sceneName, objects, lights, cameraPreset, savedCameraViews }, null, 2);
    const blob = new Blob([sceneJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sceneName}.wujie-scene`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sceneName, objects, lights, cameraPreset, savedCameraViews]);

  const addImageToCanvas = useCallback((url: string) => {
    onAddImages([url]);
  }, [onAddImages]);

  // Save camera view
  const saveCameraView = useCallback(() => {
    const orbitControls = document.querySelector('.scene-studio-canvas');
    // Get camera position from the OrbitControls
    const canvasEl = document.querySelector('.scene-studio-canvas canvas');
    if (!canvasEl) return;
    // Use a default approach - save the current camera preset position
    const preset = CAMERA_PRESETS.find(p => p.key === cameraPreset);
    const view: CameraView = {
      id: `view_${Date.now()}`,
      name: `视角${savedCameraViews.length + 1}`,
      position: preset?.position || [4, 3, 6],
      target: preset?.target || [0, 0.5, 0],
    };
    setSavedCameraViews(prev => [...prev, view]);
  }, [cameraPreset, savedCameraViews]);

  const goToCameraView = useCallback((_view: CameraView) => {
    // Camera view navigation is handled by the SceneCanvas component
    // For now, set the camera preset to 'free' and it would need a more complex implementation
    // to set exact camera position. This is a placeholder that works for preset views.
  }, []);

  const deleteCameraView = useCallback((id: string) => {
    setSavedCameraViews(prev => prev.filter(v => v.id !== id));
  }, []);

  // Apply light preset
  const applyLightPreset = useCallback((presetLights: Omit<SceneLight, 'id'>[]) => {
    const newLights = presetLights.map(l => ({
      ...l,
      id: `light_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    }));
    setLights(newLights);
  }, []);

  // Load scene list on mount
  useEffect(() => {
    loadSceneList();
  }, [loadSceneList]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && selectedObject && !selectedObject.locked) {
          deleteObject(selectedId);
        }
      }
      if (e.key === 'w' || e.key === 'W') setTransformMode('translate');
      if (e.key === 'e' || e.key === 'E') setTransformMode('rotate');
      if (e.key === 'r' || e.key === 'R') setTransformMode('scale');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selectedId, selectedObject, deleteObject]);

  // Tab button style helper
  const tabStyle = (isActive: boolean) => ({
    color: isActive ? accent : TEXT_DIM,
    borderBottom: isActive ? `2px solid ${accent}` : '2px solid transparent',
    background: 'transparent' as const,
  });

  // Side tab button helper

  // ====== RENDER ======
  return createPortal(
    <div
      className="fixed z-[200] flex items-start justify-start"
      style={{
        pointerEvents: 'auto',
        ...(isMinimized ? { inset: undefined, left: windowPos.x, top: windowPos.y } : { inset: 0 }),
      }}
    >
      {/* Semi-transparent overlay (only when expanded) */}
      {!isMinimized && <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />}

      {/* Draggable floating window */}
      <div
        data-popup
        className="relative flex flex-col rounded-xl overflow-hidden shadow-2xl border"
        style={{
          width: isMinimized ? 320 : 'calc(100vw - 80px)',
          height: isMinimized ? 'auto' : 'calc(100vh - 80px)',
          background: isMonochrome ? '#1a1a1a' : '#111',
          borderColor: isMonochrome ? '#333' : '#d4af3740',
          ...(isMinimized ? {} : { left: windowPos.x, top: windowPos.y }),
          ...(isDragging ? { outline: '2px solid #d4af37', outlineOffset: '-2px' } : {}),
        }}
        onMouseDown={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        {/* === Title bar (draggable) === */}
        <div
          data-panel-header
          className="flex items-center justify-between px-3 shrink-0 cursor-move select-none"
          style={{ height: 36, background: isMonochrome ? '#222' : '#161616', borderBottom: isMinimized ? 'none' : (isMonochrome ? '1px solid #333' : '1px solid #d4af3730') }}
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-2">
            <Boxes size={14} style={{ color: accent }} />
            <span className="text-sm font-medium" style={{ color: isMonochrome ? '#ccc' : '#d4af37' }}>3D构图</span>
            <span className="text-xs" style={{ color: '#666' }}>{sceneName}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
              onClick={() => setIsMinimized(!isMinimized)}
              title={isMinimized ? '展开' : '最小化'}
            >
              {isMinimized ? <Maximize2 size={14} style={{ color: '#888' }} /> : <Minus size={14} style={{ color: '#888' }} />}
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/30 transition-colors"
              onClick={onClose}
              title="关闭"
            >
              <X size={14} style={{ color: '#888' }} />
            </button>
          </div>
        </div>

        {/* === Minimized: only title bar visible === */}
        {!isMinimized && (
        <div className="flex-1 flex flex-row overflow-hidden">
          {/* === Left: 3D Viewport === */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top transform toolbar */}
            <div
              className="relative z-20 flex items-center gap-1 px-3 py-1.5 border-b"
              style={{
                background: isMonochrome ? '#1e1e1e' : '#131313',
                borderColor: isMonochrome ? '#333' : '#d4af3720',
                pointerEvents: 'auto'
              }}
            >
              {(['translate', 'rotate', 'scale'] as const).map(mode => (
                <button
                  key={mode}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${transformMode === mode ? 'text-white' : ''}`}
                  style={{
                    background: transformMode === mode ? (isMonochrome ? '#444' : '#d4af3730') : 'transparent',
                    color: transformMode === mode ? (isMonochrome ? '#fff' : '#d4af37') : '#888',
                  }}
                  onClick={() => setTransformMode(mode)}
                >
                  {mode === 'translate' ? 'W 移动' : mode === 'rotate' ? 'E 旋转' : 'R 缩放'}
                </button>
              ))}
              <div className="flex-1" />
              <span className="text-[13px]" style={{ color: '#555' }}>Del 删除 · Esc 取消</span>
            </div>

            {/* 3D Canvas */}
            <div className="flex-1 relative" style={{ minHeight: 0 }}>
              <div className="absolute inset-0 overflow-hidden scene-studio-canvas">
                <Canvas
                  shadows
                  camera={{ position: [5, 5, 5], fov: 50, near: 0.1, far: 200 }}
                  gl={{ preserveDrawingBuffer: true, antialias: true }}
                  style={{ background: '#0a0a0a' }}
                >
                  <SceneCanvas
                    objects={objects}
                    lights={lights}
                    cameraPreset={cameraPreset}
                    selectedId={selectedId}
                    transformMode={transformMode}
                    onTransformChange={handleTransformChange}
                    onSelectObject={(id: string | null) => setSelectedId(id)}
                  />
                </Canvas>
              </div>
              {/* Keyboard shortcuts hint */}
              <div className="absolute bottom-2 left-2 pointer-events-none z-10">
                <span className="text-[13px] px-2 py-1 rounded" style={{ color: '#555', background: 'rgba(0,0,0,0.6)' }}>
                  W 移动 · E 旋转 · R 缩放 · Del 删除 · Esc 取消选择
                </span>
              </div>
            </div>

            {/* Bottom action bar */}
            <div
              className="relative z-20 flex items-center gap-2 px-3 py-2 border-t flex-shrink-0"
              style={{
                background: isMonochrome ? '#1a1a1a' : '#0d0d0d',
                borderColor: isMonochrome ? '#333' : '#d4af3720',
                pointerEvents: 'auto'
              }}
            >
              {/* AI Generate button */}
              <button
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer"
                style={{
                  background: rightTab === 'generate' ? (isMonochrome ? '#444' : '#d4af3730') : (isMonochrome ? '#252525' : '#1a1a1a'),
                  color: rightTab === 'generate' ? (isMonochrome ? '#fff' : '#d4af37') : '#aaa',
                  border: rightTab === 'generate' ? (isMonochrome ? '1px solid #555' : '1px solid #d4af3750') : '1px solid transparent',
                }}
                onClick={() => setRightTab('generate')}
              >
                <Sparkles size={15} />
                <span>AI生成</span>
              </button>
              {/* Screenshot button */}
              <button
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer"
                style={{
                  background: rightTab === 'assets' && screenshotUrl ? (isMonochrome ? '#444' : '#d4af3730') : (isMonochrome ? '#252525' : '#1a1a1a'),
                  color: rightTab === 'assets' && screenshotUrl ? (isMonochrome ? '#fff' : '#d4af37') : '#aaa',
                  border: rightTab === 'assets' && screenshotUrl ? (isMonochrome ? '1px solid #555' : '1px solid #d4af3750') : '1px solid transparent',
                }}
                onClick={() => { captureScreenshot(); setRightTab('assets'); }}
              >
                <Camera size={15} />
                <span>截图</span>
              </button>
              {/* AI Layout button */}
              <button
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer"
                style={{
                  background: rightTab === 'layout' ? (isMonochrome ? '#444' : '#d4af3730') : (isMonochrome ? '#252525' : '#1a1a1a'),
                  color: rightTab === 'layout' ? (isMonochrome ? '#fff' : '#d4af37') : '#aaa',
                  border: rightTab === 'layout' ? (isMonochrome ? '1px solid #555' : '1px solid #d4af3750') : '1px solid transparent',
                }}
                onClick={() => setRightTab('layout')}
              >
                <LayoutGrid size={15} />
                <span>AI布景</span>
              </button>
              <div className="flex-1" />
              {/* Save button */}
              <button
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all cursor-pointer"
                style={{ background: isMonochrome ? '#252525' : '#1a1a1a', color: '#aaa', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}
                onClick={() => saveScene()}
              >
                <Save size={14} />
                <span>保存</span>
              </button>
              {/* Add to canvas button */}
              {generationResults.length > 0 && (
                <button
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer"
                  style={{ background: isMonochrome ? '#333' : '#d4af3720', color: isMonochrome ? '#fff' : '#d4af37' }}
                  onClick={() => addImageToCanvas(generationResults[0].url)}
                >
                  <Plus size={14} />
                  <span>加入画布</span>
                </button>
              )}
            </div>
          </div>

          {/* === Right: Unified Panel === */}
          <div
            className="flex flex-col overflow-hidden"
            style={{
              width: 280,
              background: isMonochrome ? '#1a1a1a' : '#111',
              borderLeft: isMonochrome ? '1px solid #333' : '1px solid #d4af3720',
            }}
          >
            {/* Tab buttons */}
            <div
              className="flex border-b flex-shrink-0"
              style={{ borderColor: isMonochrome ? '#333' : '#d4af3720' }}
            >
              {([
                { key: 'build' as const, label: '搭建', Icon: Hammer },
                { key: 'generate' as const, label: '生成', Icon: Sparkles },
                { key: 'layout' as const, label: '布景', Icon: LayoutGrid },
                { key: 'assets' as const, label: '资产', Icon: FolderOpen },
              ]).map(tab => (
                <button
                  key={tab.key}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 text-sm font-medium transition-colors cursor-pointer"
                  style={{
                    color: rightTab === tab.key ? (isMonochrome ? '#fff' : '#d4af37') : '#777',
                    borderBottom: rightTab === tab.key ? (isMonochrome ? '2px solid #fff' : `2px solid ${accent}`) : '2px solid transparent',
                    background: rightTab === tab.key ? (isMonochrome ? '#222' : '#d4af3710') : 'transparent',
                  }}
                  onClick={() => setRightTab(tab.key)}
                >
                  <tab.Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab content - scrollable */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ minHeight: 0 }}>
              {/* ===== BUILD TAB ===== */}
              {rightTab === 'build' && (
                <>
                  {/* Selected object properties */}
                  {selectedId && objects.find(o => o.id === selectedId) && (() => {
                    const obj = objects.find(o => o.id === selectedId)!;
                    return (
                      <div className="rounded-lg p-3 space-y-2.5" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                        <div className="text-sm font-medium" style={{ color: accent }}>属性 - {obj.name}</div>
                        {/* Position */}
                        <div>
                          <div className="text-xs mb-1" style={{ color: '#888' }}>位置</div>
                          <div className="flex gap-1">
                            {['x', 'y', 'z'].map((axis, i) => (
                              <div key={axis} className="flex-1">
                                <div className="text-[13px] text-center" style={{ color: axis === 'x' ? '#ef4444' : axis === 'y' ? '#22c55e' : '#3b82f6' }}>{axis.toUpperCase()}</div>
                                <input
                                  type="number"
                                  value={Math.round(obj.position[i])}
                                  onChange={e => {
                                    const newPos = [...obj.position] as [number, number, number];
                                    newPos[i] = parseFloat(e.target.value) || 0;
                                    updateObject(obj.id, { position: newPos });
                                  }}
                                  className="w-full px-1.5 py-1 rounded text-center text-sm"
                                  style={{ background: isMonochrome ? '#333' : '#0d0d0d', color: '#ccc', border: isMonochrome ? '1px solid #444' : '1px solid #333' }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Rotation */}
                        <div>
                          <div className="text-xs mb-1" style={{ color: '#888' }}>旋转</div>
                          <div className="flex gap-1">
                            {['x', 'y', 'z'].map((axis, i) => (
                              <div key={axis} className="flex-1">
                                <div className="text-[13px] text-center" style={{ color: axis === 'x' ? '#ef4444' : axis === 'y' ? '#22c55e' : '#3b82f6' }}>{axis.toUpperCase()}</div>
                                <input
                                  type="number"
                                  value={Math.round(obj.rotation[i])}
                                  onChange={e => {
                                    const newRot = [...obj.rotation] as [number, number, number];
                                    newRot[i] = parseFloat(e.target.value) || 0;
                                    updateObject(obj.id, { rotation: newRot });
                                  }}
                                  className="w-full px-1.5 py-1 rounded text-center text-sm"
                                  style={{ background: isMonochrome ? '#333' : '#0d0d0d', color: '#ccc', border: isMonochrome ? '1px solid #444' : '1px solid #333' }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Scale */}
                        <div>
                          <div className="text-xs mb-1" style={{ color: '#888' }}>缩放</div>
                          <div className="flex gap-1">
                            {['x', 'y', 'z'].map((axis, i) => (
                              <div key={axis} className="flex-1">
                                <div className="text-[13px] text-center" style={{ color: axis === 'x' ? '#ef4444' : axis === 'y' ? '#22c55e' : '#3b82f6' }}>{axis.toUpperCase()}</div>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={obj.scale[i].toFixed(1)}
                                  onChange={e => {
                                    const newScale = [...obj.scale] as [number, number, number];
                                    newScale[i] = parseFloat(e.target.value) || 1;
                                    updateObject(obj.id, { scale: newScale });
                                  }}
                                  className="w-full px-1.5 py-1 rounded text-center text-sm"
                                  style={{ background: isMonochrome ? '#333' : '#0d0d0d', color: '#ccc', border: isMonochrome ? '1px solid #444' : '1px solid #333' }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                        <button
                          className="w-full py-1.5 rounded text-sm cursor-pointer transition-colors"
                          style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444430' }}
                          onClick={() => deleteObject(obj.id)}
                        >
                          删除对象
                        </button>
                      </div>
                    );
                  })()}

                  {/* Geometry presets */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>几何体</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {GEOMETRY_PRESETS.map(preset => (
                        <button
                          key={preset.type}
                          className="flex flex-col items-center gap-0.5 p-1.5 rounded cursor-pointer transition-colors"
                          style={{ background: isMonochrome ? '#2a2a2a' : '#0d0d0d' }}
                          onClick={() => addObject(preset.type)}
                          title={preset.name}
                        >
                          <span className="text-base">{preset.emoji}</span>
                          <span className="text-[13px]" style={{ color: '#888' }}>{preset.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Model import */}
                  <ModelImportPanel
                    onModelUpload={addModelObject}
                  />

                  {/* Light presets */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>灯光预设</div>
                    <div className="space-y-1">
                      {LIGHT_PRESETS_DATA.map(preset => (
                        <button
                          key={preset.name}
                          className="w-full text-left px-2.5 py-2 rounded text-sm transition-colors cursor-pointer"
                          style={{ background: isMonochrome ? '#2a2a2a' : '#0d0d0d', color: '#bbb' }}
                          onClick={() => applyLightPreset(preset.lights)}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Light editor */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium" style={{ color: accent }}>灯光</div>
                      <button
                        className="px-2 py-0.5 rounded text-xs cursor-pointer"
                        style={{ background: isMonochrome ? '#333' : '#d4af3720', color: accent }}
                        onClick={() => setLights(prev => [...prev, { id: `light-${Date.now()}`, name: `灯光${prev.length + 1}`, type: 'point' as const, position: [2, 3, 2] as [number, number, number], intensity: 1, color: '#ffffff' }])}
                      >
                        + 添加
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {lights.map(light => (
                        <div key={light.id} className="flex items-center gap-1.5 p-1.5 rounded" style={{ background: isMonochrome ? '#2a2a2a' : '#0d0d0d' }}>
                          <input
                            type="color"
                            value={light.color}
                            onChange={e => setLights(prev => prev.map(l => l.id === light.id ? { ...l, color: e.target.value } : l))}
                            className="w-6 h-6 rounded cursor-pointer"
                            style={{ background: 'transparent', border: 'none' }}
                          />
                          <input
                            type="range"
                            min="0"
                            max="5"
                            step="0.1"
                            value={light.intensity}
                            onChange={e => setLights(prev => prev.map(l => l.id === light.id ? { ...l, intensity: parseFloat(e.target.value) } : l))}
                            className="flex-1"
                          />
                          <button
                            className="text-xs cursor-pointer"
                            style={{ color: '#ef4444' }}
                            onClick={() => setLights(prev => prev.filter(l => l.id !== light.id))}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Camera presets */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>相机预设</div>
                    <div className="grid grid-cols-3 gap-1">
                      {CAMERA_PRESETS.map(preset => (
                        <button
                          key={preset.key}
                          className="px-1.5 py-1.5 rounded text-xs text-center transition-colors cursor-pointer"
                          style={{
                            background: cameraPreset === preset.key ? (isMonochrome ? '#444' : '#d4af3730') : (isMonochrome ? '#2a2a2a' : '#0d0d0d'),
                            color: cameraPreset === preset.key ? accent : '#999',
                            border: cameraPreset === preset.key ? (isMonochrome ? '1px solid #666' : '1px solid #d4af3750') : '1px solid transparent',
                          }}
                          onClick={() => setCameraPreset(preset.key)}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ===== GENERATE TAB ===== */}
              {rightTab === 'generate' && (
                <>
                  {/* Image model selector */}
                  <div className="mb-2">
                    <label className="text-xs text-muted-foreground mb-1 block">图像模型</label>
                    {imageModels.length > 0 ? (
                      <select
                        value={selectedImageModelId}
                        onChange={e => setSelectedImageModelId(e.target.value)}
                        className="w-full rounded-md px-2 py-1.5 text-xs border border-border bg-muted text-foreground"
                      >
                        <option value="">自动选择</option>
                        {imageModels.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.providerName ? `[${m.providerName}] ` : ''}{m.name || m.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[11px] py-1" style={{ color: TEXT_DIM }}>请先在管理员后台配置图像模型</p>
                    )}
                  </div>
                  {/* Generation mode */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>生成模式</div>
                    <div className="space-y-1">
                      {GENERATION_MODES.map(m => (
                        <button
                          key={m.key}
                          className="w-full text-left px-2.5 py-2 rounded text-sm transition-colors cursor-pointer"
                          style={{
                            background: generationMode === m.key ? (isMonochrome ? '#444' : '#d4af3730') : (isMonochrome ? '#2a2a2a' : '#0d0d0d'),
                            color: generationMode === m.key ? accent : '#bbb',
                          }}
                          onClick={() => setGenerationMode(m.key)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Strength mode */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>风格强度</div>
                    <div className="space-y-1">
                      {STRENGTH_MODES.map(m => (
                        <button
                          key={m.key}
                          className="w-full text-left px-2.5 py-2 rounded text-sm transition-colors cursor-pointer"
                          style={{
                            background: strengthMode === m.key ? (isMonochrome ? '#444' : '#d4af3730') : (isMonochrome ? '#2a2a2a' : '#0d0d0d'),
                            color: strengthMode === m.key ? accent : '#bbb',
                          }}
                          onClick={() => setStrengthMode(m.key)}
                        >
                          <div className="font-medium">{m.name}</div>
                          <div className="text-xs" style={{ color: '#666' }}>{m.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Prompt */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>提示词</div>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder="描述你想要生成的图像..."
                      rows={3}
                      className="w-full px-2.5 py-2 rounded text-sm resize-y"
                      style={{ background: isMonochrome ? '#333' : '#0d0d0d', color: '#ccc', border: isMonochrome ? '1px solid #444' : '1px solid #333' }}
                    />
                    {/* Negative prompt toggle */}
                    <button
                      className="text-xs mt-1 cursor-pointer"
                      style={{ color: '#888' }}
                      onClick={() => setShowNegPrompt(!showNegPrompt)}
                    >
                      {showNegPrompt ? '▼' : '▶'} 反向提示词
                    </button>
                    {showNegPrompt && (
                      <textarea
                        value={negativePrompt}
                        onChange={e => setNegativePrompt(e.target.value)}
                        placeholder="排除的元素..."
                        rows={2}
                        className="w-full mt-1 px-2.5 py-2 rounded text-sm resize-y"
                        style={{ background: isMonochrome ? '#333' : '#0d0d0d', color: '#ccc', border: isMonochrome ? '1px solid #444' : '1px solid #333' }}
                      />
                    )}
                  </div>

                  {/* Aspect ratio & count */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>参数</div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-xs mb-1" style={{ color: '#888' }}>画面比例</div>
                        <div className="flex gap-1">
                          {(['1:1', '16:9', '9:16', '4:3', '3:4'] as const).map(r => (
                            <button
                              key={r}
                              className="px-2 py-1 rounded text-xs cursor-pointer transition-colors"
                              style={{
                                background: aspectRatio === r ? (isMonochrome ? '#444' : '#d4af3730') : (isMonochrome ? '#2a2a2a' : '#0d0d0d'),
                                color: aspectRatio === r ? accent : '#999',
                              }}
                              onClick={() => setAspectRatio(r)}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: '#888' }}>生成数量</div>
                        <div className="flex gap-1">
                          {[1, 4].map(n => (
                            <button
                              key={n}
                              className="px-2.5 py-1 rounded text-xs cursor-pointer transition-colors"
                              style={{
                                background: imageCount === n ? (isMonochrome ? '#444' : '#d4af3730') : (isMonochrome ? '#2a2a2a' : '#0d0d0d'),
                                color: imageCount === n ? accent : '#999',
                              }}
                              onClick={() => setImageCount(n)}
                            >
                              {n}张
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Generate button */}
                  <button
                    className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
                    style={{ background: isMonochrome ? '#444' : '#d4af37', color: isMonochrome ? '#fff' : '#111' }}
                    onClick={handleGenerate}
                    disabled={isGenerating || !prompt.trim()}
                  >
                    {isGenerating ? '生成中...' : '开始生成'}
                  </button>

                  {/* Generation results */}
                  {generationResults.length > 0 && (
                    <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                      <div className="text-sm font-medium mb-2" style={{ color: accent }}>生成结果</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {generationResults.map((result, i) => (
                          <div key={i} className="relative group">
                            <img src={result.url} alt={`结果${i + 1}`} className="w-full rounded cursor-pointer" onClick={() => addImageToCanvas(result.url)} />
                            <a
                              href={result.url}
                              download={`scene-result-${i + 1}.png`}
                              className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              style={{ background: isMonochrome ? '#333' : '#d4af37cc', color: isMonochrome ? '#fff' : '#000' }}
                              onClick={e => e.stopPropagation()}
                            >
                              ↓
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ===== LAYOUT TAB ===== */}
              {rightTab === 'layout' && (
                <>
                  <AIAutoLayoutPanel
                    onApplyLayout={handleAILayout}
                    isGenerating={isAILayoutGenerating}
                    isMonochrome={isMonochrome}
                    chatModels={chatModels}
                    selectedChatModel={selectedChatModelId}
                    onSelectChatModel={setSelectedChatModelId}
                  />

                  {/* Quick templates */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>快速模板</div>
                    <div className="space-y-1">
                      {AI_LAYOUT_TEMPLATES.map(t => (
                        <button
                          key={t.key}
                          className="w-full text-left px-2.5 py-2 rounded text-sm transition-colors cursor-pointer"
                          style={{ background: isMonochrome ? '#2a2a2a' : '#0d0d0d', color: '#bbb' }}
                          onClick={() => handleAILayout(t.prompt)}
                        >
                          {t.emoji} {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ===== ASSETS TAB ===== */}
              {rightTab === 'assets' && (
                <>
                  {/* Scene management */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>场景管理</div>
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={sceneName}
                        onChange={e => setSceneName(e.target.value)}
                        placeholder="场景名称"
                        className="w-full px-2.5 py-1.5 rounded text-sm"
                        style={{ background: isMonochrome ? '#333' : '#0d0d0d', color: '#ccc', border: isMonochrome ? '1px solid #444' : '1px solid #333' }}
                      />
                      <button
                        className="w-full py-2 rounded text-sm font-medium cursor-pointer transition-colors"
                        style={{ background: isMonochrome ? '#333' : '#d4af3720', color: accent }}
                        onClick={() => saveScene()}
                      >
                        保存场景
                      </button>
                    </div>
                  </div>

                  {/* Saved scenes list */}
                  {savedSceneList.length > 0 && (
                    <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                      <div className="text-sm font-medium mb-2" style={{ color: accent }}>已保存场景</div>
                      <div className="space-y-1">
                        {savedSceneList.map(scene => (
                          <div key={scene.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded" style={{ background: isMonochrome ? '#2a2a2a' : '#0d0d0d' }}>
                            <button
                              className="flex-1 text-left text-sm cursor-pointer"
                              style={{ color: '#bbb' }}
                              onClick={() => loadSceneById(scene.id)}
                            >
                              {scene.name}
                            </button>
                            <button
                              className="text-xs cursor-pointer"
                              style={{ color: '#999' }}
                              title="复制场景"
                              onClick={() => {
                                // Load scene, then save as copy
                                fetch(`/api/scene-studio?sceneId=${scene.id}`)
                                  .then(r => r.ok ? r.json() : null)
                                  .then(data => {
                                    if (data) saveScene(scene.name + ' 副本', data);
                                  })
                                  .catch(() => {});
                              }}
                            >
                              📋
                            </button>
                            <button
                              className="text-xs cursor-pointer"
                              style={{ color: '#ef4444' }}
                              onClick={() => deleteScene(scene.id)}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Generated images library */}
                  {generationResults.length > 0 && (
                    <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                      <div className="text-sm font-medium mb-2" style={{ color: accent }}>生成素材库 ({generationResults.length})</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {generationResults.map((result, i) => (
                          <div key={i} className="relative group">
                            <img src={result.url} alt={`素材${i + 1}`} className="w-full rounded cursor-pointer aspect-square object-cover" onClick={() => addImageToCanvas(result.url)} />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded gap-1">
                              <button
                                className="text-[9px] px-1 py-0.5 rounded cursor-pointer"
                                style={{ background: accent, color: '#000' }}
                                onClick={e => { e.stopPropagation(); addImageToCanvas(result.url); }}
                              >
                                加画布
                              </button>
                              <a
                                href={result.url}
                                download={`scene-asset-${i + 1}.png`}
                                className="text-[9px] px-1 py-0.5 rounded cursor-pointer"
                                style={{ background: isMonochrome ? '#444' : '#d4af37cc', color: isMonochrome ? '#fff' : '#000' }}
                                onClick={e => e.stopPropagation()}
                              >
                                下载
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Export options */}
                  <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                    <div className="text-sm font-medium mb-2" style={{ color: accent }}>导出</div>
                    <div className="space-y-1.5">
                      <button
                        className="w-full py-2 rounded text-sm cursor-pointer transition-colors"
                        style={{ background: isMonochrome ? '#2a2a2a' : '#0d0d0d', color: '#bbb', border: isMonochrome ? '1px solid #333' : '1px solid #333' }}
                        onClick={captureScreenshot}
                      >
                        📸 截取画面
                      </button>
                      {generationResults.length > 0 && (
                        <>
                          <button
                            className="w-full py-2 rounded text-sm font-medium cursor-pointer transition-colors"
                            style={{ background: isMonochrome ? '#333' : '#d4af3720', color: accent }}
                            onClick={() => addImageToCanvas(generationResults[0].url)}
                          >
                            加入无限画布
                          </button>
                          {generationResults.length > 1 && (
                            <button
                              className="w-full py-2 rounded text-sm cursor-pointer transition-colors"
                              style={{ background: isMonochrome ? '#2a2a2a' : '#0d0d0d', color: '#bbb', border: isMonochrome ? '1px solid #333' : '1px solid #333' }}
                              onClick={() => generationResults.forEach(r => addImageToCanvas(r.url))}
                            >
                              全部加入画布
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Screenshot preview */}
                  {screenshotUrl && (
                    <div className="rounded-lg p-3" style={{ background: isMonochrome ? '#222' : '#1a1a1a', border: isMonochrome ? '1px solid #333' : '1px solid #d4af3720' }}>
                      <div className="text-sm font-medium mb-2" style={{ color: accent }}>截图预览</div>
                      <img src={screenshotUrl} alt="截图" className="w-full rounded" />
                      <div className="flex gap-1.5 mt-2">
                        <a
                          href={screenshotUrl}
                          download="scene-screenshot.png"
                          className="flex-1 py-1.5 rounded text-sm text-center cursor-pointer"
                          style={{ background: isMonochrome ? '#333' : '#d4af3720', color: accent }}
                        >
                          下载
                        </a>
                        <button
                          className="flex-1 py-1.5 rounded text-sm cursor-pointer"
                          style={{ background: isMonochrome ? '#333' : '#d4af3720', color: accent }}
                          onClick={() => addImageToCanvas(screenshotUrl)}
                        >
                          加入画布
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>,
    document.body
  );
}
