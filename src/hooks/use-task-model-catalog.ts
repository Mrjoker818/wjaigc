'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  CAPABILITY_CATALOG_VERSION,
  createTaskModelCatalogIndex,
  type TaskModelDescriptor,
} from '@/lib/task-core/model-capability-contract';
import type { ApiKind, ModelInfo } from '@/lib/universal-api-types';

export interface TaskModelCatalogModel extends ModelInfo {
  providerId: string;
  providerName?: string;
  isDefault?: boolean;
}

interface TaskModelCatalogState {
  models: TaskModelCatalogModel[];
  descriptorsByKey: Map<string, TaskModelDescriptor>;
  loading: boolean;
  error: Error | null;
}

interface TaskModelCatalogResponse {
  success?: boolean;
  capabilityCatalogVersion?: number;
  providers?: Array<{ id?: string; name?: string; displayName?: string }>;
  models?: ModelInfo[];
  taskModelCatalog?: TaskModelDescriptor[];
}

const INITIAL_STATE: TaskModelCatalogState = {
  models: [],
  descriptorsByKey: new Map(),
  loading: true,
  error: null,
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function useTaskModelCatalog(type: ApiKind | 'all') {
  const [state, setState] = useState<TaskModelCatalogState>(INITIAL_STATE);
  const reload = useCallback(async (signal?: AbortSignal) => {
    setState(previous => ({ ...previous, loading: true, error: null }));
    const response = await fetch(`/api/models?type=${encodeURIComponent(type)}`, {
      cache: 'no-store',
      signal,
    });
    const data = await response.json() as TaskModelCatalogResponse;
    if (
      !response.ok
      || data.success === false
      || data.capabilityCatalogVersion !== CAPABILITY_CATALOG_VERSION
      || !Array.isArray(data.models)
      || !Array.isArray(data.taskModelCatalog)
    ) {
      throw new Error('模型能力目录不可用');
    }
    if (signal?.aborted) return;

    const providerNames = new Map((data.providers || []).map(provider => [
      provider.id || '',
      provider.name || provider.displayName || provider.id || '',
    ]));
    const models = data.models.map(model => ({
      ...model,
      providerName: providerNames.get(model.providerId) || model.providerId,
    }));
    setState({
      models,
      descriptorsByKey: createTaskModelCatalogIndex(data.taskModelCatalog),
      loading: false,
      error: null,
    });
  }, [type]);

  useEffect(() => {
    const controller = new AbortController();
    const handleFailure = (error: unknown) => {
      if (controller.signal.aborted) return;
      setState(previous => ({
        ...previous,
        loading: false,
        error: asError(error),
      }));
    };
    const refresh = () => {
      void reload(controller.signal).catch(handleFailure);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    refresh();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [reload]);

  return {
    ...state,
    reload,
  };
}
