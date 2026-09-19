import { z } from 'zod';

export const canvasShareStatusSchema = z.enum(['active', 'revoked', 'expired']);

export const canvasShareViewportSchema = z.object({
  offsetX: z.number().finite(),
  offsetY: z.number().finite(),
  zoom: z.number().finite().positive(),
}).strict();

export const canvasSharePolicyPatchSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  allowDownload: z.boolean().optional(),
}).strict().refine(
  (patch) => patch.expiresAt !== undefined || patch.allowDownload !== undefined,
  { message: '至少需要提供一个可更新的分享策略字段' },
);

const canvasShareTransformSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  rotation: z.number().finite(),
  zIndex: z.number().int(),
}).strict();

const canvasShareSafeDisplaySchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  altText: z.string().trim().min(1).max(1_000).optional(),
}).strict();

const controlledMediaPathSchema = z.string().max(2_048).regex(
  /^media\/csr_[A-Za-z0-9_-]{43}$/u,
  '媒体地址必须是受控的相对读取路径',
);

const controlledDownloadPathSchema = z.string().max(2_048).regex(
  /^media\/csr_[A-Za-z0-9_-]{43}\/download$/u,
  '下载地址必须是受控的相对下载路径',
);

export const canvasSharePublicItemSchema = z.object({
  itemRef: z.string().trim().min(1).max(200),
  entityType: z.enum(['canvas-image', 'canvas-video']),
  assetKind: z.enum(['image', 'video']),
  transform: canvasShareTransformSchema,
  display: canvasShareSafeDisplaySchema,
  mimeType: z.string().trim().min(1).max(255),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  mediaPath: controlledMediaPathSchema,
  downloadPath: controlledDownloadPathSchema.optional(),
}).strict();

export const canvasSharePublicDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  revisionLabel: z.string().trim().min(1).max(100),
  createdAt: z.string().datetime({ offset: true }),
  allowDownload: z.boolean(),
  viewport: canvasShareViewportSchema,
  items: z.array(canvasSharePublicItemSchema).max(10_000),
}).strict();
