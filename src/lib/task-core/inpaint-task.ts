import 'server-only';
import sharp from 'sharp';
import { persistAssetBytes, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import { compositeMaskedEdit } from '@/lib/image-tools/masked-edit-composite';
import { readPrivateInpaintInputs, type PrivateInpaintInputIdentity } from './inpaint-private-inputs';

export interface PersistInpaintAcceptedResultInput {
  identity: PrivateInpaintInputIdentity;
  editMode: 'erase' | 'mask';
  edited: Buffer;
  crop?: { cropX: number; cropY: number; cropW: number; cropH: number };
  signal?: AbortSignal;
}

/** Prepare a public output from private inputs; the caller still owns terminal CAS and cleanup. */
export async function persistInpaintAcceptedResult(
  input: PersistInpaintAcceptedResultInput,
): Promise<PersistedAssetFile> {
  input.signal?.throwIfAborted();
  const stored = await readPrivateInpaintInputs(input.identity);
  if (!stored) throw new Error('INPAINT_INPUT_NOT_FOUND');
  if (!Buffer.isBuffer(input.edited) || input.edited.length < 1 || input.edited.length > 50 * 1024 * 1024) {
    throw new Error('INPAINT_RESULT_INVALID');
  }
  let editedFullSize: Buffer;
  if (input.editMode === 'erase') {
    editedFullSize = await sharp(input.edited)
      .resize(stored.width, stored.height, { fit: 'fill' }).png().toBuffer();
  } else {
    const crop = input.crop;
    if (!crop || ![crop.cropX, crop.cropY, crop.cropW, crop.cropH].every(Number.isSafeInteger)
      || crop.cropX < 0 || crop.cropY < 0 || crop.cropW < 1 || crop.cropH < 1
      || crop.cropX + crop.cropW > stored.width || crop.cropY + crop.cropH > stored.height) {
      throw new Error('INPAINT_CROP_INVALID');
    }
    const inside = await sharp(input.edited)
      .resize(crop.cropW, crop.cropH, { fit: 'inside', withoutEnlargement: true })
      .png().toBuffer();
    const insideMeta = await sharp(inside).metadata();
    const padX = Math.floor((crop.cropW - (insideMeta.width || crop.cropW)) / 2);
    const padY = Math.floor((crop.cropH - (insideMeta.height || crop.cropH)) / 2);
    const cropImage = padX > 0 || padY > 0
      ? await sharp({ create: { width: crop.cropW, height: crop.cropH, channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: inside, left: padX, top: padY, blend: 'over' }])
        .png().toBuffer()
      : inside;
    editedFullSize = await sharp(stored.source)
      .composite([{ input: cropImage, left: crop.cropX, top: crop.cropY }]).png().toBuffer();
  }
  input.signal?.throwIfAborted();
  const output = await compositeMaskedEdit({ source: stored.source, edited: editedFullSize, mask: stored.mask });
  input.signal?.throwIfAborted();
  return persistAssetBytes({ bytes: output, filename: 'inpaint-output.png', mimeType: 'image/png',
    signal: input.signal });
}
