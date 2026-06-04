'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, Environment, Grid, GizmoHelper, GizmoViewport, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
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
  Package, Tag, Archive, Cuboid, Circle
} from 'lucide-react';
import { useProgressTimer } from '@/hooks/useProgressTimer';

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

const GEOMETRY_PRESETS: { type: SceneObject['type']; name: string; icon: React.ReactNode; defaultScale: [number, number, number]; defaultColor: string }[] = [
  { type: 'box', name: '立方体', icon: <BoxIcon size={16} />, defaultScale: [1, 1, 1], defaultColor: '#808080' },
  { type: 'cylinder', name: '圆柱', icon: <CylinderIcon size={16} />, defaultScale: [0.5, 1, 0.5], defaultColor: '#808080' },
  { type: 'plane', name: '平面', icon: <PlaneIcon size={16} />, defaultScale: [2, 1, 2], defaultColor: '#505050' },
  { type: 'sphere', name: '球体', icon: <Circle size={16} />, defaultScale: [0.5, 0.5, 0.5], defaultColor: '#808080' },
  { type: 'stage-round', name: '圆形展台', icon: <CircleDot size={16} />, defaultScale: [1, 0.15, 1], defaultColor: '#2a2a2a' },
  { type: 'stage-rect', name: '矩形展台', icon: <BoxSelect size={16} />, defaultScale: [1.5, 0.15, 1], defaultColor: '#2a2a2a' },
  { type: 'backdrop', name: '背景板', icon: <LayoutGrid size={16} />, defaultScale: [4, 3, 0.05], defaultColor: '#1a1a1a' },
  { type: 'lightbox', name: '灯箱', icon: <Sun size={16} />, defaultScale: [1, 2, 0.1], defaultColor: '#ffffff' },
  { type: 'billboard', name: '广告牌', icon: <Tag size={16} />, defaultScale: [2, 1.5, 0.05], defaultColor: '#d4af37' },
  { type: 'standee', name: '立牌', icon: <FlipHorizontal size={16} />, defaultScale: [0.8, 1.8, 0.05], defaultColor: '#ffffff' },
];

const LIGHT_PRESETS: Omit<SceneLight, 'id'>[] = [
  { type: 'ambient', name: '环境光', intensity: 0.6, color: '#fff4e6', position: [0, 5, 0] },
  { type: 'directional', name: '主光', intensity: 1.2, color: '#ffffff', position: [3, 5, 4] },
  { type: 'directional', name: '补光', intensity: 0.5, color: '#e6f0ff', position: [-3, 3, 2] },
  { type: 'directional', name: '背光', intensity: 0.3, color: '#fff4e6', position: [0, 4, -4] },
];

const CAMERA_PRESETS: { name: string; key: CameraPreset; position: [number, number, number]; target: [number, number, number] }[] = [
  { name: '正面', key: 'front', position: [0, 2, 6], target: [0, 1, 0] },
  { name: '侧面', key: 'side', position: [6, 2, 0], target: [0, 1, 0] },
  { name: '俯视', key: 'top', position: [0, 8, 0.01], target: [0, 0, 0] },
  { name: '45°商业', key: '45degree', position: [4, 3, 6], target: [0, 0.5, 0] },
  { name: '自由', key: 'free', position: [4, 3, 6], target: [0, 0.5, 0] },
];

const STRENGTH_MODES: { key: StrengthMode; name: string; value: number; desc: string }[] = [
  { key: 'strict', name: '严格保留构图', value: 85, desc: '最大限度保持3D构图' },
  { key: 'balanced', name: '平衡优化', value: 60, desc: '保持构图，提升质感' },
  { key: 'creative', name: '创意发挥', value: 35, desc: '只参考大结构，AI自由发挥' },
  { key: 'commercial', name: '商业强化', value: 70, desc: '强化广告质感、光影、材质' },
];

// CircleDot icon (not in lucide-react by default)
function CircleDot({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

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

function SceneLightHelper({ light }: { light: SceneLight }) {
  if (light.type === 'ambient') return null;
  return (
    <pointLight
      position={light.position}
      intensity={light.intensity}
      color={light.color}
      castShadow={light.type === 'directional' || light.type === 'spot'}
    />
  );
}

function SceneCanvas({ objects, lights, selectedId, transformMode, onSelectObject, onTransformChange, cameraPreset, savedCameraViews }: {
  objects: SceneObject[];
  lights: SceneLight[];
  selectedId: string | null;
  transformMode: 'translate' | 'rotate' | 'scale';
  onSelectObject: (id: string | null) => void;
  onTransformChange: (id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void;
  cameraPreset: CameraPreset;
  savedCameraViews: CameraView[];
}) {
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  useEffect(() => {
    if (!orbitRef.current) return;
    const preset = CAMERA_PRESETS.find(p => p.key === cameraPreset);
    if (preset && cameraPreset !== 'free') {
      orbitRef.current.reset();
      // Use a small timeout to ensure the reset has completed
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
      <ambientLight intensity={0.3} color="#fff4e6" />
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

/* ========== LEFT PANEL: ASSETS ========== */

function AssetPanel({ objects, selectedId, onAddObject, onSelectObject, onDeleteObject, onToggleVisibility, onToggleLock, onDuplicateObject }: {
  objects: SceneObject[];
  selectedId: string | null;
  onAddObject: (type: SceneObject['type']) => void;
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDuplicateObject: (id: string) => void;
}) {
  const [section, setSection] = useState<'geometry' | 'objects' | 'models'>('geometry');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleModelUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onAddObject('model');
    // The model URL would be set via a separate mechanism
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onAddObject]);

  return (
    <div className="w-56 flex-shrink-0 flex flex-col border-r" style={{ borderColor: BORDER_COLOR, background: BG_PRIMARY }}>
      {/* Section tabs */}
      <div className="flex border-b" style={{ borderColor: BORDER_COLOR }}>
        {[
          { key: 'geometry' as const, label: '几何体', icon: <BoxIcon size={14} /> },
          { key: 'objects' as const, label: '场景', icon: <Layers size={14} /> },
          { key: 'models' as const, label: '模型', icon: <Package size={14} /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setSection(tab.key)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs transition-colors cursor-pointer"
            style={{
              color: section === tab.key ? ACCENT : TEXT_DIM,
              borderBottom: section === tab.key ? `2px solid ${ACCENT}` : '2px solid transparent',
              background: section === tab.key ? BG_TERTIARY : 'transparent',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2" style={{ scrollbarWidth: 'thin' }}>
        {section === 'geometry' && (
          <div className="grid grid-cols-2 gap-1.5">
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
                <span className="text-[10px]">{preset.name}</span>
              </button>
            ))}
          </div>
        )}

        {section === 'objects' && (
          <div className="space-y-0.5">
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
        )}

        {section === 'models' && (
          <div className="space-y-2">
            <input ref={fileInputRef} type="file" accept=".glb,.gltf" className="hidden" onChange={handleModelUpload} />
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
            <p className="text-[10px] text-center" style={{ color: TEXT_DIM }}>支持 .glb .gltf 格式，最大 20MB</p>
          </div>
        )}
      </div>
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
      <div className="w-64 flex-shrink-0 flex flex-col border-l items-center justify-center" style={{ borderColor: BORDER_COLOR, background: BG_PRIMARY }}>
        <MousePointer2 size={24} style={{ color: TEXT_DIM }} />
        <p className="text-xs mt-2" style={{ color: TEXT_DIM }}>选中对象查看属性</p>
      </div>
    );
  }

  const accent = isMonochrome ? '#3b82f6' : ACCENT;

  return (
    <div className="w-64 flex-shrink-0 flex flex-col border-l overflow-y-auto" style={{ borderColor: BORDER_COLOR, background: BG_PRIMARY, scrollbarWidth: 'thin' }}>
      {/* Object name */}
      <div className="p-3 border-b" style={{ borderColor: BORDER_COLOR }}>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ background: selectedObject.color }} />
          <input
            value={selectedObject.name}
            onChange={e => onUpdateObject(selectedObject.id, { name: e.target.value })}
            className="flex-1 bg-transparent text-sm font-medium outline-none"
            style={{ color: TEXT_PRIMARY }}
          />
        </div>
      </div>

      {/* Transform */}
      <div className="p-3 border-b" style={{ borderColor: BORDER_COLOR }}>
        <h4 className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: TEXT_DIM }}>位置</h4>
        <div className="grid grid-cols-3 gap-1.5">
          {(['x', 'y', 'z'] as const).map(axis => (
            <div key={axis} className="flex flex-col">
              <label className="text-[9px] mb-0.5" style={{ color: axis === 'x' ? '#f73b3b' : axis === 'y' ? '#3bf73b' : '#3b3bf7' }}>{axis.toUpperCase()}</label>
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
                className="w-full px-1.5 py-1 rounded text-xs outline-none"
                style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
              />
            </div>
          ))}
        </div>

        <h4 className="text-[10px] uppercase tracking-wider mb-2 mt-3 font-semibold" style={{ color: TEXT_DIM }}>旋转</h4>
        <div className="grid grid-cols-3 gap-1.5">
          {(['x', 'y', 'z'] as const).map(axis => (
            <div key={axis} className="flex flex-col">
              <label className="text-[9px] mb-0.5" style={{ color: axis === 'x' ? '#f73b3b' : axis === 'y' ? '#3bf73b' : '#3b3bf7' }}>{axis.toUpperCase()}</label>
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
                className="w-full px-1.5 py-1 rounded text-xs outline-none"
                style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
              />
            </div>
          ))}
        </div>

        <h4 className="text-[10px] uppercase tracking-wider mb-2 mt-3 font-semibold" style={{ color: TEXT_DIM }}>缩放</h4>
        <div className="grid grid-cols-3 gap-1.5">
          {(['x', 'y', 'z'] as const).map(axis => (
            <div key={axis} className="flex flex-col">
              <label className="text-[9px] mb-0.5" style={{ color: axis === 'x' ? '#f73b3b' : axis === 'y' ? '#3bf73b' : '#3b3bf7' }}>{axis.toUpperCase()}</label>
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
                className="w-full px-1.5 py-1 rounded text-xs outline-none"
                style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Material */}
      <div className="p-3 border-b" style={{ borderColor: BORDER_COLOR }}>
        <h4 className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: TEXT_DIM }}>材质颜色</h4>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={selectedObject.color}
            onChange={e => onUpdateObject(selectedObject.id, { color: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer border-0"
            style={{ background: BG_TERTIARY }}
          />
          <input
            value={selectedObject.color}
            onChange={e => onUpdateObject(selectedObject.id, { color: e.target.value })}
            className="flex-1 px-2 py-1 rounded text-xs outline-none"
            style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
          />
        </div>
      </div>

      {/* Quick actions */}
      <div className="p-3">
        <h4 className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: TEXT_DIM }}>快捷操作</h4>
        <div className="space-y-1">
          <button
            onClick={() => onUpdateObject(selectedObject.id, { position: [0, 0, 0] })}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors cursor-pointer"
            style={{ background: BG_TERTIARY, color: TEXT_SECONDARY, border: `1px solid ${BORDER_COLOR}` }}
          >
            <RotateCw size={12} /> 归零位置
          </button>
          <button
            onClick={() => onUpdateObject(selectedObject.id, { scale: [1, 1, 1] })}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors cursor-pointer"
            style={{ background: BG_TERTIARY, color: TEXT_SECONDARY, border: `1px solid ${BORDER_COLOR}` }}
          >
            <Maximize2 size={12} /> 重置缩放
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========== BOTTOM PANEL: AI GENERATION ========== */

function AIGenerationPanel({ onCaptureScreenshot, generationMode, setGenerationMode, strengthMode, setStrengthMode, prompt, setPrompt, negativePrompt, setNegativePrompt, onGenerate, isGenerating, generationResults, onAddToCanvas, isMonochrome }: {
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
}) {
  const accent = isMonochrome ? '#3b82f6' : ACCENT;
  const [showResults, setShowResults] = useState(false);

  return (
    <div className="flex-shrink-0 border-t" style={{ borderColor: BORDER_COLOR, background: BG_PRIMARY }}>
      {/* Tab bar */}
      <div className="flex items-center border-b" style={{ borderColor: BORDER_COLOR }}>
        <div className="flex-1 flex items-center gap-1 px-3 py-2">
          {[
            { mode: 'image-to-image' as GenerationMode, label: '当前视角生图', icon: <ImagePlus size={14} /> },
            { mode: 'text-to-image' as GenerationMode, label: '文生图', icon: <Sparkles size={14} /> },
          ].map(tab => (
            <button
              key={tab.mode}
              onClick={() => setGenerationMode(tab.mode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all cursor-pointer"
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
        </div>
        <div className="flex items-center gap-1 px-2">
          <button
            onClick={onCaptureScreenshot}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs transition-colors cursor-pointer"
            style={{ background: BG_TERTIARY, color: TEXT_SECONDARY, border: `1px solid ${BORDER_COLOR}` }}
          >
            <Camera size={12} /> 截图
          </button>
          {generationResults.length > 0 && (
            <button
              onClick={() => setShowResults(!showResults)}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs transition-colors cursor-pointer"
              style={{ background: `${accent}20`, color: accent, border: `1px solid ${accent}40` }}
            >
              <ImageIcon size={12} /> 结果({generationResults.length})
            </button>
          )}
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Strength mode */}
        <div className="flex items-center gap-1">
          {STRENGTH_MODES.map(mode => (
            <button
              key={mode.key}
              onClick={() => setStrengthMode(mode.key)}
              className="px-2 py-1 rounded text-[10px] transition-colors cursor-pointer"
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

        {/* Prompt input */}
        <div className="flex-1 flex items-center gap-2">
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="描述你想要的画面效果..."
            className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
            style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
            onKeyDown={e => { if (e.key === 'Enter' && !isGenerating) onGenerate(); }}
          />
          <button
            onClick={onGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: isGenerating ? BG_TERTIARY : accent,
              color: isGenerating ? TEXT_DIM : '#000000',
            }}
          >
            {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {isGenerating ? '生成中...' : '生成'}
          </button>
        </div>
      </div>

      {/* Generation results */}
      {showResults && generationResults.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex gap-2 overflow-x-auto py-2" style={{ scrollbarWidth: 'thin' }}>
            {generationResults.map(result => (
              <div
                key={result.id}
                className="flex-shrink-0 w-28 h-28 rounded-lg overflow-hidden relative group cursor-pointer"
                style={{ border: `1px solid ${BORDER_COLOR}` }}
              >
                <img src={result.url} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  <button
                    onClick={() => onAddToCanvas(result.url)}
                    className="px-2 py-1 rounded text-[10px] cursor-pointer"
                    style={{ background: accent, color: '#000' }}
                  >
                    加入画布
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== AI AUTO LAYOUT PANEL ========== */

function AIAutoLayoutPanel({ onApplyLayout, isGenerating, isMonochrome }: {
  onApplyLayout: (description: string) => void;
  isGenerating: boolean;
  isMonochrome?: boolean;
}) {
  const [description, setDescription] = useState('');
  const accent = isMonochrome ? '#3b82f6' : ACCENT;

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Wand2 size={14} style={{ color: accent }} />
        <span className="text-xs font-medium" style={{ color: TEXT_PRIMARY }}>AI 自动布景</span>
      </div>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="描述你想要的场景，例如：做一个红色年轻化品牌快闪店，中央有产品展示台，左侧是便利店货架，右侧是互动打卡墙..."
        rows={4}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none"
        style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}`, scrollbarWidth: 'thin' }}
      />
      <div className="space-y-1.5">
        <p className="text-[10px]" style={{ color: TEXT_DIM }}>快速模板：</p>
        <div className="flex flex-wrap gap-1">
          {[
            '品牌快闪店', '产品展台', '便利店场景', '美妆柜台', '科技展位', '食品货架'
          ].map(tpl => (
            <button
              key={tpl}
              onClick={() => setDescription(prev => prev + (prev ? '，' : '') + tpl)}
              className="px-2 py-1 rounded-full text-[10px] cursor-pointer transition-colors"
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
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: accent, color: '#000' }}
      >
        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
        {isGenerating ? 'AI 布景中...' : '一键布景'}
      </button>
    </div>
  );
}

/* ========== ASSET MANAGEMENT PANEL ========== */

function AssetManagementPanel({ onSaveScene, onLoadScene, onExportScene, sceneCount, isMonochrome }: {
  onSaveScene: () => void;
  onLoadScene: () => void;
  onExportScene: () => void;
  sceneCount: number;
  isMonochrome?: boolean;
}) {
  const accent = isMonochrome ? '#3b82f6' : ACCENT;

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Archive size={14} style={{ color: accent }} />
        <span className="text-xs font-medium" style={{ color: TEXT_PRIMARY }}>资产管理</span>
      </div>

      <button
        onClick={onSaveScene}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer"
        style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
      >
        <Save size={12} style={{ color: accent }} /> 保存当前场景
      </button>

      <button
        onClick={onLoadScene}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer"
        style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
      >
        <FolderOpen size={12} style={{ color: accent }} /> 打开已保存场景 ({sceneCount})
      </button>

      <button
        onClick={onExportScene}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer"
        style={{ background: BG_TERTIARY, color: TEXT_PRIMARY, border: `1px solid ${BORDER_COLOR}` }}
      >
        <Download size={12} style={{ color: accent }} /> 导出场景文件
      </button>
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

  // UI state
  const [activeTab, setActiveTab] = useState<'scene' | 'ai-generate' | 'ai-layout' | 'assets'>('scene');
  const [savedCameraViews, setSavedCameraViews] = useState<CameraView[]>([]);
  const [savedScenes, setSavedScenes] = useState<SceneObject[][]>([]);
  const [isAILayoutGenerating, setIsAILayoutGenerating] = useState(false);
  const [sceneName, setSceneName] = useState('未命名场景');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const accent = isMonochrome ? '#3b82f6' : ACCENT;

  const selectedObject = useMemo(() => objects.find(o => o.id === selectedId) || null, [objects, selectedId]);

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

  // Screenshot
  const captureScreenshot = useCallback(() => {
    const canvas = document.querySelector('.scene-studio-canvas canvas');
    if (!canvas) return;
    const url = (canvas as HTMLCanvasElement).toDataURL('image/png');
    setScreenshotUrl(url);
  }, []);

  // AI Generation
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);

    try {
      // Capture current view as reference
      let referenceImageUrl = screenshotUrl;
      if (generationMode === 'image-to-image') {
        captureScreenshot();
        referenceImageUrl = screenshotUrl;
      }

      // Build prompt based on mode
      const strengthInfo = STRENGTH_MODES.find(m => m.key === strengthMode);
      const fullPrompt = generationMode === 'image-to-image'
        ? `请基于3D场景参考图生成一张高质量商业视觉图。画面结构必须参考输入图：保持主要物体位置、相机角度、前景中景背景关系、主体比例、空间透视。用户需求：${prompt}。视觉风格：${strengthInfo?.name || '平衡优化'}。输出要求：商业广告级画质，高级构图，真实光影，材质细腻，画面干净，品牌感强，不要杂乱，不要多余文字，不要水印。${negativePrompt ? `[negative: ${negativePrompt}]` : ''}`
        : `请根据用户需求生成一张商业级场景视觉图。用户需求：${prompt}。视觉风格：${strengthInfo?.name || '平衡优化'}。构图要求：主体明确，空间层次清晰，前景、中景、背景关系明确，适合商业广告展示。输出要求：高质量商业广告画面，真实光影，高级质感，画面整洁，品牌感强。${negativePrompt ? `[negative: ${negativePrompt}]` : ''}`;

      // Call generate API
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          aspectRatio: '16:9',
          n: 1,
          referenceImageUrl,
          strength: strengthInfo?.value || 60,
        }),
      });

      if (!res.ok) throw new Error('Generation failed');
      const data = await res.json();
      const taskIds = data.taskIds || [];

      if (taskIds.length > 0) {
        // Poll for results
        const pollInterval = setInterval(async () => {
          try {
            const pollRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: taskIds[0] }),
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
      } else {
        setIsGenerating(false);
      }
    } catch {
      setIsGenerating(false);
    }
  }, [prompt, generationMode, strengthMode, screenshotUrl, negativePrompt, captureScreenshot]);

  // AI Auto Layout
  const handleAILayout = useCallback(async (description: string) => {
    if (!description.trim()) return;
    setIsAILayoutGenerating(true);

    try {
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
        }),
      });

      if (!res.ok) throw new Error('AI layout failed');
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.content || '';

      // Parse JSON from response
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
    } finally {
      setIsAILayoutGenerating(false);
    }
  }, []);

  // Save/Load scene
  const saveScene = useCallback(() => {
    try {
      const sceneData = { name: sceneName, objects, lights, savedCameraViews, timestamp: Date.now() };
      const saved = JSON.parse(localStorage.getItem('scene-studio-scenes') || '[]');
      saved.push(sceneData);
      localStorage.setItem('scene-studio-scenes', JSON.stringify(saved));
      setSavedScenes(saved.map((s: { objects: SceneObject[] }) => s.objects));
    } catch { /* ignore */ }
  }, [sceneName, objects, lights, savedCameraViews]);

  const loadScene = useCallback(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('scene-studio-scenes') || '[]');
      if (saved.length > 0) {
        const lastScene = saved[saved.length - 1];
        if (lastScene.objects) setObjects(lastScene.objects);
        if (lastScene.lights) setLights(lastScene.lights);
        if (lastScene.name) setSceneName(lastScene.name);
      }
    } catch { /* ignore */ }
  }, []);

  const exportScene = useCallback(() => {
    const sceneJson = JSON.stringify({ name: sceneName, objects, lights, cameraPreset }, null, 2);
    const blob = new Blob([sceneJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sceneName}.wujie-scene`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sceneName, objects, lights, cameraPreset]);

  const addImageToCanvas = useCallback((url: string) => {
    onAddImages([url]);
  }, [onAddImages]);

  // Load saved scenes count
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('scene-studio-scenes') || '[]');
      setSavedScenes(saved.map((s: { objects: SceneObject[] }) => s.objects));
    } catch { /* ignore */ }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && selectedObject && !selectedObject.locked) {
          deleteObject(selectedId);
        }
      }
      // Transform mode shortcuts
      if (e.key === 'w' || e.key === 'W') setTransformMode('translate');
      if (e.key === 'e' || e.key === 'E') setTransformMode('rotate');
      if (e.key === 'r' || e.key === 'R') setTransformMode('scale');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selectedId, selectedObject, deleteObject]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: '#000000' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: BORDER_COLOR, background: BG_PRIMARY }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <BoxIcon size={16} style={{ color: accent }} />
            <span className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>3D构图画布 Pro</span>
          </div>
          <div className="w-px h-4" style={{ background: BORDER_COLOR }} />
          <input
            value={sceneName}
            onChange={e => setSceneName(e.target.value)}
            className="bg-transparent text-xs outline-none px-2 py-0.5 rounded"
            style={{ color: TEXT_SECONDARY, border: `1px solid transparent` }}
            onFocus={e => { e.currentTarget.style.borderColor = BORDER_COLOR; e.currentTarget.style.background = BG_TERTIARY; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
          />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={saveScene} className="flex items-center gap-1 px-2.5 py-1 rounded text-xs cursor-pointer transition-colors" style={{ color: TEXT_SECONDARY }} onMouseEnter={e => e.currentTarget.style.color = accent} onMouseLeave={e => e.currentTarget.style.color = TEXT_SECONDARY}>
            <Save size={12} /> 保存
          </button>
          <button onClick={onClose} className="p-1.5 rounded cursor-pointer transition-colors" style={{ color: TEXT_SECONDARY }} onMouseEnter={e => e.currentTarget.style.color = '#ef4444'} onMouseLeave={e => e.currentTarget.style.color = TEXT_SECONDARY}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Assets */}
        <AssetPanel
          objects={objects}
          selectedId={selectedId}
          onAddObject={addObject}
          onSelectObject={setSelectedId}
          onDeleteObject={deleteObject}
          onToggleVisibility={id => updateObject(id, { visible: !objects.find(o => o.id === id)?.visible })}
          onToggleLock={id => updateObject(id, { locked: !objects.find(o => o.id === id)?.locked })}
          onDuplicateObject={duplicateObject}
        />

        {/* Center: 3D Canvas + Bottom panels */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b" style={{ borderColor: BORDER_COLOR, background: BG_SECONDARY }}>
            <div className="flex items-center gap-1">
              {/* Transform mode */}
              {[
                { mode: 'translate' as const, icon: <Move size={14} />, label: '移动(W)' },
                { mode: 'rotate' as const, icon: <RotateCcw size={14} />, label: '旋转(E)' },
                { mode: 'scale' as const, icon: <Maximize2 size={14} />, label: '缩放(R)' },
              ].map(item => (
                <button
                  key={item.mode}
                  onClick={() => setTransformMode(item.mode)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors cursor-pointer"
                  style={{
                    background: transformMode === item.mode ? `${accent}20` : 'transparent',
                    color: transformMode === item.mode ? accent : TEXT_DIM,
                  }}
                  title={item.label}
                >
                  {item.icon}
                </button>
              ))}
              <div className="w-px h-4 mx-1" style={{ background: BORDER_COLOR }} />
              {/* Camera presets */}
              {CAMERA_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  onClick={() => setCameraPreset(preset.key)}
                  className="px-2 py-1 rounded text-[10px] transition-colors cursor-pointer"
                  style={{
                    background: cameraPreset === preset.key ? `${accent}20` : 'transparent',
                    color: cameraPreset === preset.key ? accent : TEXT_DIM,
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={captureScreenshot} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer" style={{ color: TEXT_DIM }}>
                <Camera size={12} /> 截图视角
              </button>
              {screenshotUrl && (
                <img src={screenshotUrl} alt="screenshot" className="w-8 h-6 rounded object-cover" style={{ border: `1px solid ${BORDER_COLOR}` }} />
              )}
            </div>
          </div>

          {/* 3D Canvas */}
          <div ref={containerRef} className="flex-1 relative scene-studio-canvas" style={{ background: '#050505' }}>
            <Suspense fallback={
              <div className="absolute inset-0 flex items-center justify-center" style={{ color: TEXT_DIM }}>
                <Loader2 size={24} className="animate-spin" />
              </div>
            }>
              <Canvas
                shadows
                camera={{ position: [4, 3, 6], fov: 45, near: 0.1, far: 100 }}
                gl={{ preserveDrawingBuffer: true, antialias: true }}
                onPointerMissed={() => setSelectedId(null)}
              >
                <SceneCanvas
                  objects={objects}
                  lights={lights}
                  selectedId={selectedId}
                  transformMode={transformMode}
                  onSelectObject={setSelectedId}
                  onTransformChange={handleTransformChange}
                  cameraPreset={cameraPreset}
                  savedCameraViews={savedCameraViews}
                />
              </Canvas>
            </Suspense>
          </div>

          {/* Bottom tabs */}
          <div className="flex-shrink-0">
            {/* Tab headers */}
            <div className="flex items-center border-b" style={{ borderColor: BORDER_COLOR, background: BG_PRIMARY }}>
              {[
                { key: 'scene' as const, label: '灯光', icon: <Sun size={12} /> },
                { key: 'ai-generate' as const, label: 'AI生成', icon: <Sparkles size={12} /> },
                { key: 'ai-layout' as const, label: 'AI布景', icon: <Wand2 size={12} /> },
                { key: 'assets' as const, label: '资产', icon: <Archive size={12} /> },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs transition-colors cursor-pointer"
                  style={{
                    color: activeTab === tab.key ? accent : TEXT_DIM,
                    borderBottom: activeTab === tab.key ? `2px solid ${accent}` : '2px solid transparent',
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === 'scene' && (
              <div className="p-3 space-y-2" style={{ background: BG_PRIMARY }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: TEXT_DIM }}>灯光设置</span>
                  <button
                    onClick={() => setLights(prev => [...prev, {
                      id: `light_${Date.now()}`,
                      type: 'directional' as const,
                      name: `灯光${prev.length + 1}`,
                      intensity: 1,
                      color: '#ffffff',
                      position: [3, 5, 4] as [number, number, number],
                    }])}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] cursor-pointer"
                    style={{ color: accent }}
                  >
                    <Plus size={10} /> 添加灯光
                  </button>
                </div>
                <div className="space-y-1">
                  {lights.map(light => (
                    <div key={light.id} className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: BG_TERTIARY }}>
                      <Lightbulb size={12} style={{ color: light.color }} />
                      <span className="text-xs flex-1" style={{ color: TEXT_PRIMARY }}>{light.name}</span>
                      <input
                        type="range"
                        min={0} max={3} step={0.1}
                        value={light.intensity}
                        onChange={e => setLights(prev => prev.map(l => l.id === light.id ? { ...l, intensity: parseFloat(e.target.value) } : l))}
                        className="w-16 h-1 accent-amber-500"
                      />
                      <input
                        type="color"
                        value={light.color}
                        onChange={e => setLights(prev => prev.map(l => l.id === light.id ? { ...l, color: e.target.value } : l))}
                        className="w-5 h-5 rounded cursor-pointer border-0"
                      />
                      <button onClick={() => setLights(prev => prev.filter(l => l.id !== light.id))} className="cursor-pointer" style={{ color: TEXT_DIM }}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'ai-generate' && (
              <AIGenerationPanel
                onCaptureScreenshot={captureScreenshot}
                generationMode={generationMode}
                setGenerationMode={setGenerationMode}
                strengthMode={strengthMode}
                setStrengthMode={setStrengthMode}
                prompt={prompt}
                setPrompt={setPrompt}
                negativePrompt={negativePrompt}
                setNegativePrompt={setNegativePrompt}
                onGenerate={handleGenerate}
                isGenerating={isGenerating}
                generationResults={generationResults}
                onAddToCanvas={addImageToCanvas}
                isMonochrome={isMonochrome}
              />
            )}

            {activeTab === 'ai-layout' && (
              <AIAutoLayoutPanel
                onApplyLayout={handleAILayout}
                isGenerating={isAILayoutGenerating}
                isMonochrome={isMonochrome}
              />
            )}

            {activeTab === 'assets' && (
              <AssetManagementPanel
                onSaveScene={saveScene}
                onLoadScene={loadScene}
                onExportScene={exportScene}
                sceneCount={savedScenes.length}
                isMonochrome={isMonochrome}
              />
            )}
          </div>
        </div>

        {/* Right panel: Properties */}
        <PropertiesPanel
          selectedObject={selectedObject}
          onUpdateObject={updateObject}
          isMonochrome={isMonochrome}
        />
      </div>
    </div>,
    document.body
  );
}
