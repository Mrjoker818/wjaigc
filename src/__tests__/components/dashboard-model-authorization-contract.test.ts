import { describe, expect, it } from 'vitest';
import * as dashboardModule from '@/components/dashboard/dashboard-view';

interface ModelOption {
  id: string;
  name: string;
  providerId: string;
}

const dashboardHelpers = dashboardModule as unknown as {
  providerModelOptions?: (
    models: string[] | undefined,
    providerId: string,
    providerName: string,
  ) => ModelOption[];
  normalizeModelAssignmentsForSave?: (
    assignments: string[],
    options: ModelOption[],
  ) => string[];
};

describe('dashboard model authorization contract', () => {
  it('labels duplicate model ids with their provider while keeping exact assignment ids', () => {
    const options = dashboardHelpers.providerModelOptions?.(
      ['shared-model'],
      'provider-a',
      'Provider A',
    );

    expect(options).toEqual([{
      id: 'provider-a::shared-model',
      name: 'shared-model · Provider A',
      providerId: 'provider-a',
    }]);
  });

  it('removes a same-model legacy bare assignment when an exact provider pair is selected', () => {
    const options: ModelOption[] = [
      {
        id: 'provider-a::shared-model',
        name: 'shared-model · Provider A',
        providerId: 'provider-a',
      },
      {
        id: 'provider-b::shared-model',
        name: 'shared-model · Provider B',
        providerId: 'provider-b',
      },
    ];

    const payload = dashboardHelpers.normalizeModelAssignmentsForSave?.(
      ['shared-model', 'provider-a::shared-model', 'legacy-other', 'provider-a::shared-model'],
      options,
    );

    expect(payload).toEqual(['provider-a::shared-model', 'legacy-other']);
  });
});
