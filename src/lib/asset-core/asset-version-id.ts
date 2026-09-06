const SAFE_ASSET_VERSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const LEGACY_IMAGE_VERSION_TOKEN = /^image-[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)+$/;

export function isAssetVersionId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 256
    && (SAFE_ASSET_VERSION_TOKEN.test(value) || LEGACY_IMAGE_VERSION_TOKEN.test(value));
}
