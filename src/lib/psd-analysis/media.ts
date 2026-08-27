import { createHash } from 'node:crypto';

import { AssetServiceError, createAssetService } from '@/lib/asset-core/service';
import {
  PsdAnalysisError,
  type PsdAnalysisRequest,
} from '@/lib/psd-analysis/contracts';
import {
  loadSafeImageInput,
  type DecodedSafeImage,
  type SafeImageInputOptions,
} from '@/lib/safe-image-input';

const PSD_ANALYSIS_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PSD_ANALYSIS_MAX_IMAGE_PIXELS = 40_000_000;
const DATA_IMAGE_PATTERN = /^data:image\/(?:avif|jpeg|png|webp);base64,/i;

interface AssetReferenceInput {
  actorUserId: string;
  projectId: string;
  assetVersionId: string;
}

interface AssetReferenceResult {
  url: string;
  assetVersionId?: string;
}

export interface PsdAnalysisMediaDependencies {
  resolveAssetReference: (input: AssetReferenceInput) => Promise<AssetReferenceResult>;
  loadImage: (
    input: string,
    options?: SafeImageInputOptions,
  ) => Promise<DecodedSafeImage>;
}

export interface ResolvePsdAnalysisMediaInput {
  request: PsdAnalysisRequest;
  actorUserId: string;
  signal?: AbortSignal;
  dependencies?: Partial<PsdAnalysisMediaDependencies>;
}

export interface ResolvedPsdAnalysisMedia extends DecodedSafeImage {
  sha256: string;
  dataUrl: string;
  sourceVersionId?: string;
}

function defaultDependencies(): PsdAnalysisMediaDependencies {
  return {
    resolveAssetReference: input => createAssetService().resolveAssetReference(input),
    loadImage: loadSafeImageInput,
  };
}

function mediaError(
  code: string,
  message: string,
  status: number,
  retryable: boolean,
  cause?: unknown,
): PsdAnalysisError {
  return new PsdAnalysisError(
    code,
    message,
    status,
    retryable,
    cause === undefined ? undefined : { cause },
  );
}

export async function resolvePsdAnalysisMedia(
  input: ResolvePsdAnalysisMediaInput,
): Promise<ResolvedPsdAnalysisMedia> {
  const defaults = defaultDependencies();
  const dependencies: PsdAnalysisMediaDependencies = {
    resolveAssetReference: input.dependencies?.resolveAssetReference ?? defaults.resolveAssetReference,
    loadImage: input.dependencies?.loadImage ?? defaults.loadImage,
  };

  let source: string;
  if (input.request.image) {
    if (!DATA_IMAGE_PATTERN.test(input.request.image)) {
      throw mediaError(
        'PSD_ANALYSIS_MEDIA_INVALID',
        'PSD 分析只接受受控图片 data URL 或当前用户资产版本',
        400,
        false,
      );
    }
    source = input.request.image;
  } else {
    try {
      const reference = await dependencies.resolveAssetReference({
        actorUserId: input.actorUserId,
        projectId: input.request.projectId!,
        assetVersionId: input.request.sourceVersionId!,
      });
      source = reference.url;
    } catch (error) {
      if (!(error instanceof AssetServiceError) || error.code !== 'ASSET_NOT_FOUND') {
        throw mediaError(
          'PSD_ANALYSIS_MEDIA_UNAVAILABLE',
          'PSD 分析资产服务暂时不可用',
          503,
          true,
          error,
        );
      }
      throw mediaError(
        'PSD_ANALYSIS_MEDIA_FORBIDDEN',
        '当前用户无权访问该 PSD 分析来源',
        403,
        false,
        error,
      );
    }
  }

  let image: DecodedSafeImage;
  try {
    image = await dependencies.loadImage(source, {
      maxBytes: PSD_ANALYSIS_MAX_IMAGE_BYTES,
      maxPixels: PSD_ANALYSIS_MAX_IMAGE_PIXELS,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof PsdAnalysisError) throw error;
    throw mediaError(
      'PSD_ANALYSIS_MEDIA_INVALID',
      'PSD 分析图片未通过格式、体积或像素安全校验',
      400,
      false,
      error,
    );
  }

  return {
    ...image,
    sha256: createHash('sha256').update(image.buffer).digest('hex'),
    dataUrl: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
    ...(input.request.sourceVersionId
      ? { sourceVersionId: input.request.sourceVersionId }
      : {}),
  };
}
