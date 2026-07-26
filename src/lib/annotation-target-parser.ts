import { z } from 'zod';

import { clampNormalizedRegion } from '@/features/annotations/annotation-geometry';
import type { AnnotationRegion } from '@/features/annotations/annotation-types';
import { extractFirstJsonObject } from '@/lib/quick-create-compile';

export interface ParsedIdentifiedImageTarget {
  label: string;
  confidence: number;
  region: AnnotationRegion;
}

const identifiedImageTargetSchema = z.object({
  label: z.string().trim().min(1).max(120),
  confidence: z.number().min(0).max(1),
  region: z.object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    w: z.number().finite().positive().max(1),
    h: z.number().finite().positive().max(1),
  }).strict(),
}).strict();

export function parseIdentifiedImageTargetPayload(
  content: string,
): ParsedIdentifiedImageTarget | null {
  try {
    const result = identifiedImageTargetSchema.safeParse(
      JSON.parse(extractFirstJsonObject(content)) as unknown,
    );
    if (!result.success) return null;
    const region = clampNormalizedRegion(result.data.region);
    if (region.w <= 0 || region.h <= 0) return null;
    return {
      label: result.data.label,
      confidence: result.data.confidence,
      region,
    };
  } catch {
    return null;
  }
}
