import 'server-only';
import { randomUUID } from 'node:crypto';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';
import { findProviderById } from '@/lib/server-api-config';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { SketchGenerationDependencies } from './generation';
import { createSketchProviderStages } from './provider';

/** Create per logical task, not a shared credential cache or new task authority. */
export function createConfiguredSketchDependencies(dependencies: {
  authorizeProject?: typeof authorizeGenerationProject;
  resolveTaskModel?: (providerId: string, modelId: string, actorUserId: string) => Promise<TaskModelDescriptor>;
  findProviderById?: (providerId: string) => Promise<ApiProvider | null>;
  transport?: typeof fetch;
  requestId?: string;
} = {}): SketchGenerationDependencies {
  let stages: Pick<SketchGenerationDependencies, 'analyze' | 'reconstruct'> | undefined;
  let resolutionStarted = false;
  return {
    authorizeProject: (actorUserId, projectId) => (dependencies.authorizeProject || authorizeGenerationProject)({ actorUserId, projectId }),
    resolveTaskModel: async (providerId, modelId, actorUserId) => {
      if (resolutionStarted) throw new Error('SKETCH_DEPENDENCIES_ALREADY_BOUND');
      resolutionStarted = true;
      const descriptor = await (dependencies.resolveTaskModel || resolveTaskModel)(providerId, modelId, actorUserId);
      if (descriptor.providerId !== providerId || descriptor.modelId !== modelId || descriptor.kind !== 'chat'
        || descriptor.supportsVision !== true || descriptor.protocol !== 'chat-completions' || descriptor.executionMode !== 'sync') {
        throw new Error('SKETCH_MODEL_UNAVAILABLE');
      }
      const provider = await (dependencies.findProviderById || findProviderById)(providerId);
      if (!provider || provider.id !== providerId) throw new Error('SKETCH_PROVIDER_UNAVAILABLE');
      stages = createSketchProviderStages({ provider, modelId, requestId: dependencies.requestId || randomUUID() }, { transport: dependencies.transport });
      return descriptor;
    },
    analyze: (...input) => {
      if (!stages) return Promise.reject(new Error('SKETCH_PROVIDER_NOT_RESOLVED'));
      return stages.analyze(...input);
    },
    reconstruct: (...input) => {
      if (!stages) return Promise.reject(new Error('SKETCH_PROVIDER_NOT_RESOLVED'));
      return stages.reconstruct(...input);
    },
  };
}
