import {
  adoptExistingAgentTask,
  executeAdoptedAgentTask,
  type AdoptAndExecuteSameTaskResult,
  type AdoptSameTaskInput,
  type SameTaskAgentAdoption,
} from './same-task-adapter';
import type { LegacyAgentObservationInput } from './legacy-observer';
import type { AgentRuntimeMode } from './mode';
import type {
  AgentDownstreamExecutionContext,
  AgentDownstreamRecovery,
} from './downstream-operations';

type Deferred<T> = T | (() => T);

export interface AdmittedAgentTaskExecutionDependencies {
  observeShadow(input: LegacyAgentObservationInput): Promise<void>;
  adopt(input: AdoptSameTaskInput): Promise<SameTaskAgentAdoption>;
  executeAdoption<T>(input: {
    adoption: SameTaskAgentAdoption;
    execute: (context: AgentDownstreamExecutionContext) => Promise<T>;
    recovery?: AgentDownstreamRecovery<T>;
  }): Promise<AdoptAndExecuteSameTaskResult<T>>;
}

export interface PrepareAdmittedAgentTaskExecutionInput<T> {
  mode: AgentRuntimeMode;
  observation: Deferred<LegacyAgentObservationInput>;
  adoption: Deferred<AdoptSameTaskInput>;
  execute: (context?: AgentDownstreamExecutionContext) => Promise<T>;
  recovery?: AgentDownstreamRecovery<T>;
}

export interface PreparedAdmittedAgentTaskExecution<T> {
  runId?: string;
  execute(): Promise<T | undefined>;
}

const defaultDependencies: AdmittedAgentTaskExecutionDependencies = {
  async observeShadow(input): Promise<void> {
    const { observeLegacyAgentRun } = await import('./legacy-observer');
    return observeLegacyAgentRun(input);
  },
  adopt: adoptExistingAgentTask,
  executeAdoption: executeAdoptedAgentTask,
};

function resolveDeferred<T>(value: Deferred<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

export async function prepareAdmittedAgentTaskExecution<T>(
  input: PrepareAdmittedAgentTaskExecutionInput<T>,
  dependencies: AdmittedAgentTaskExecutionDependencies = defaultDependencies,
): Promise<PreparedAdmittedAgentTaskExecution<T>> {
  if (input.mode === 'legacy') {
    return { execute: input.execute };
  }

  if (input.mode === 'shadow') {
    return {
      async execute(): Promise<T> {
        try {
          await dependencies.observeShadow(resolveDeferred(input.observation));
        } catch {
          // Shadow diagnostics may never affect the legacy executor or response.
        }
        return input.execute();
      },
    };
  }

  const adoption = await dependencies.adopt(resolveDeferred(input.adoption));
  return {
    runId: adoption.runId,
    async execute(): Promise<T | undefined> {
      const result = await dependencies.executeAdoption({
        adoption,
        execute: input.execute,
        recovery: input.recovery,
      });
      if (typeof result === 'object' && result !== null && 'executed' in result) {
        return result.value;
      }
      return result as T;
    },
  };
}
