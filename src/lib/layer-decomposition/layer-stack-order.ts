import type { EditableLayerAsset } from '@/lib/layer-decomposition/types';

export function getVisibleLayersInPaintOrder(
  layers: EditableLayerAsset[],
): EditableLayerAsset[] {
  const visibleLayers = layers.filter((layer) => layer.visible);
  const pearLayers = visibleLayers
    .filter((layer) => layer.source === 'pear-psd')
    .reverse();
  const reconstructionLayers = visibleLayers.filter((layer) => (
    layer.role === 'reconstruction-correction'
    || layer.role === 'reconstruction-reference'
  ));
  const localLayers = visibleLayers.filter((layer) => (
    layer.source !== 'pear-psd'
    && layer.role !== 'reconstruction-correction'
    && layer.role !== 'reconstruction-reference'
  ));

  return pearLayers.length > 0
    ? [...pearLayers, ...localLayers, ...reconstructionLayers]
    : visibleLayers;
}
