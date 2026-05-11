import type { DesignDocument, LayerNode, SceneGraph } from '@/types/designGraph';

type CanvasLikeImage = {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
  prompt?: string;
  model?: string;
  createdAt?: number;
};

const now = () => Date.now();

export function createLayerId(prefix = 'layer') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function canvasImageToLayer(image: CanvasLikeImage, zIndex = 0): LayerNode {
  return {
    id: image.id || createLayerId('image'),
    name: image.prompt ? image.prompt.slice(0, 26) : `Image Layer ${zIndex + 1}`,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    bbox: {
      x: image.x || 0,
      y: image.y || 0,
      width: image.width || image.originalWidth || 512,
      height: image.height || image.originalHeight || 512,
    },
    transform: {
      x: image.x || 0,
      y: image.y || 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    },
    zIndex,
    imageUrl: image.url,
    semantic: {
      label: 'generated-image',
      prompt: image.prompt,
      model: image.model,
      engine: 'none',
    },
    metadata: {
      source: 'wujie-canvas',
      originalCanvasId: image.id,
      createdAt: image.createdAt || now(),
    },
  };
}

export function createSceneFromCanvasImages(images: CanvasLikeImage[], name = 'Wujie Design'): SceneGraph {
  const layers = images.map(canvasImageToLayer);
  const maxRight = Math.max(1024, ...layers.map(layer => layer.bbox.x + layer.bbox.width));
  const maxBottom = Math.max(1024, ...layers.map(layer => layer.bbox.y + layer.bbox.height));

  return {
    id: createLayerId('scene'),
    name,
    width: Math.ceil(maxRight),
    height: Math.ceil(maxBottom),
    background: '#0a0a0a',
    layers,
    selectedLayerIds: layers[0] ? [layers[0].id] : [],
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createDesignDocumentFromCanvasImages(images: CanvasLikeImage[], name = 'Wujie Layer Graph'): DesignDocument {
  const scene = createSceneFromCanvasImages(images, name);
  return {
    schema: 'wujie.design.v1',
    id: createLayerId('doc'),
    name,
    scene,
    assets: scene.layers
      .filter(layer => layer.imageUrl)
      .map(layer => ({ id: `asset_${layer.id}`, type: 'image' as const, url: layer.imageUrl, name: layer.name })),
    history: [{ id: createLayerId('history'), label: 'Create Layer Graph from canvas', createdAt: now() }],
    metadata: {
      runtime: 'wujie-layer-graph',
      compatibleWith: ['svg', 'psd', 'figma-json'],
    },
  };
}

export function updateLayer(scene: SceneGraph, layerId: string, patch: Partial<LayerNode>): SceneGraph {
  return {
    ...scene,
    layers: scene.layers.map(layer => layer.id === layerId ? { ...layer, ...patch } : layer),
    updatedAt: now(),
  };
}

export function selectLayer(scene: SceneGraph, layerId: string): SceneGraph {
  return { ...scene, selectedLayerIds: [layerId], updatedAt: now() };
}

export function moveLayer(scene: SceneGraph, layerId: string, direction: 'up' | 'down'): SceneGraph {
  const layers = [...scene.layers].sort((a, b) => a.zIndex - b.zIndex);
  const index = layers.findIndex(layer => layer.id === layerId);
  if (index < 0) return scene;
  const swapIndex = direction === 'up' ? index + 1 : index - 1;
  if (swapIndex < 0 || swapIndex >= layers.length) return scene;
  [layers[index], layers[swapIndex]] = [layers[swapIndex], layers[index]];
  return {
    ...scene,
    layers: layers.map((layer, zIndex) => ({ ...layer, zIndex })),
    updatedAt: now(),
  };
}

export function addVectorSvgToLayer(scene: SceneGraph, layerId: string, svg: string): SceneGraph {
  return updateLayer(scene, layerId, {
    type: 'vector',
    svg,
    semantic: {
      ...(scene.layers.find(layer => layer.id === layerId)?.semantic || {}),
      engine: 'vtracer',
      label: 'vectorized-layer',
    },
  });
}
