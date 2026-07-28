import type { DesignLayer } from '@/lib/psd-export';
import type {
  EditableLayerAsset,
  EditableLayerRole,
} from '@/lib/layer-decomposition/types';

function mapRole(role: EditableLayerRole): DesignLayer['role'] {
  if (role === 'decoration' || role === 'unknown') return 'deco';
  return role;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function editableLayerAssetsToDesignLayers(
  assets: EditableLayerAsset[],
  documentWidth: number,
  documentHeight: number,
): DesignLayer[] {
  const canvasWidth = Math.max(1, Math.floor(finiteOr(documentWidth, 1)));
  const canvasHeight = Math.max(1, Math.floor(finiteOr(documentHeight, 1)));

  return assets.map((asset) => {
    const offsetX = Math.floor(finiteOr(asset.offsetX, 0));
    const offsetY = Math.floor(finiteOr(asset.offsetY, 0));
    const assetWidth = Math.max(1, Math.floor(finiteOr(asset.width, 1)));
    const assetHeight = Math.max(1, Math.floor(finiteOr(asset.height, 1)));
    const left = Math.max(0, Math.min(canvasWidth, offsetX));
    const top = Math.max(0, Math.min(canvasHeight, offsetY));
    const right = Math.max(left, Math.min(canvasWidth, offsetX + assetWidth));
    const bottom = Math.max(top, Math.min(canvasHeight, offsetY + assetHeight));
    const width = right - left;
    const height = bottom - top;
    const warnings = [...(asset.qualityWarnings || [])];
    if (width !== assetWidth || height !== assetHeight || left !== offsetX || top !== offsetY) {
      warnings.push('图层超出画布范围，编辑预览已按画布边界裁切');
    }

    return {
      id: asset.id,
      ...(asset.parentId ? { parentId: asset.parentId } : {}),
      role: mapRole(asset.role),
      name: asset.name,
      visible: asset.visible,
      opacity: Math.min(1, Math.max(0, finiteOr(asset.opacity, 1))),
      blendMode: asset.blendMode || 'normal',
      offsetX,
      offsetY,
      imageDataUrl: asset.imageUrl,
      boundingBox: { x: left, y: top, width, height },
      bbox: [left, top, right, bottom] as [number, number, number, number],
      maskScore: asset.source === 'pear-psd' ? 0.95 : 0.75,
      edgeScore: asset.source === 'pear-psd' ? 0.9 : 0.7,
      semanticLabel: asset.role === 'text'
        ? 'text'
        : asset.role === 'background'
          ? 'background'
          : asset.role === 'shadow'
            ? 'shadow'
            : asset.role === 'subject'
              ? 'main_subject'
              : 'decorative_element',
      warnings,
      reconstructMode: 'raster-safe' as const,
      source: asset.source,
    };
  });
}
