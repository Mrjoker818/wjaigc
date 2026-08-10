import type { AssetGraphMode } from './types';

export function resolveAssetGraphMode(raw?: string): AssetGraphMode {
  if (raw === 'shadow' || raw === 'asset-v3') return raw;
  return 'legacy';
}
