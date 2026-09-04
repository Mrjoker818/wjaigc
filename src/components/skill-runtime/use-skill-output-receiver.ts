'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';

export type SkillOutputReceiver = (reference: WorkspaceAssetReference, meta?: {
  sourceImageId?: string;
  runId?: string;
  sourceVersionIds?: readonly string[];
  restoreDeletedPlacement?: boolean;
  signal?: AbortSignal;
}) => void | Promise<void>;

export function useSkillOutputReceiver(receiver: SkillOutputReceiver | undefined): SkillOutputReceiver | undefined {
  const current = useRef(receiver);
  useEffect(() => {
    current.current = receiver;
    return () => { current.current = undefined; };
  }, [receiver]);
  const receive = useCallback<SkillOutputReceiver>((reference, meta) => {
    if (!current.current) throw new Error('画布暂时无法接收 Skill 资产版本');
    return current.current(reference, meta);
  }, []);
  return receiver ? receive : undefined;
}
