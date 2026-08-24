import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';

const hasIsolatedPostgres = Boolean(process.env.POSTGRES_TEST_DATABASE_URL?.trim());
const postgresIt = hasIsolatedPostgres ? it : it.skip;
let dataRoot = '';
let previousDataRoot: string | undefined;

interface ProviderSeed {
  id: string;
  compatProfile: string;
  customHeader: string;
}

function createProviderSeed(id: string): ProviderSeed {
  return {
    id,
    compatProfile: `profile-${id}`,
    customHeader: `header-${id}`,
  };
}

describe('server API model capability PostgreSQL persistence', () => {
  beforeAll(async () => {
    previousDataRoot = process.env.WUJIE_DATA_DIR;
    dataRoot = await mkdtemp(join(tmpdir(), 'wujie-provider-capabilities-'));
    process.env.WUJIE_DATA_DIR = dataRoot;
    if (!hasIsolatedPostgres) {
      console.warn(
        '[BLOCKED] V588-PROVIDER-005 PostgreSQL verification was not executed: '
        + 'POSTGRES_TEST_DATABASE_URL is missing.',
      );
    }
  });

  afterAll(async () => {
    if (previousDataRoot === undefined) delete process.env.WUJIE_DATA_DIR;
    else process.env.WUJIE_DATA_DIR = previousDataRoot;
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
  });

  postgresIt('round-trips capability overrides and preserves concurrent provider updates', async () => {
    await withIsolatedPostgres('provider_model_capabilities_round_trip', async () => {
      const { ensureCoreTables, dbUpsertApiProvider } = await import('@/lib/db-storage');
      const {
        getApiProviders,
        updateApiProvider,
      } = await import('@/lib/server-api-config');
      const {
        readProviderCapabilityOverrides,
        serializeProviderCapabilityOverrides,
      } = await import('@/lib/task-core/model-capability-resolution');

      await ensureCoreTables();
      const seeds = [createProviderSeed('provider-a'), createProviderSeed('provider-b')];
      for (const [index, seed] of seeds.entries()) {
        const stored = await dbUpsertApiProvider({
          id: seed.id,
          name: seed.id,
          display_name: seed.id,
          base_url: 'https://api.example.test/v1',
          api_key: 'isolated-test-secret',
          is_enabled: true,
          type: 'image',
          model_type: 'image',
          request_style: 'images-generations',
          selected_models: ['shared-image-model'],
          advanced_params: {
            compatProfile: seed.compatProfile,
            customHeader: seed.customHeader,
          },
          is_default: false,
          created_at: 1_700_000_000_000 + index,
          updated_at: 1_700_000_000_000 + index,
          connection_status: 'success',
          discovered_models: [{
            id: 'shared-image-model',
            name: 'Shared image model',
            providerId: seed.id,
            type: 'image',
          }],
          sort_order: index,
        });
        expect(stored).toBe(true);
      }

      const capabilityA = serializeProviderCapabilityOverrides({
        version: 1,
        models: {
          'shared-image-model': {
            allowedRatios: ['1:1', '16:9'],
            allowedSizes: ['1024x1024'],
            qualityOptions: ['standard', 'hd'],
            maxOutputs: 4,
          },
        },
      });
      const capabilityB = serializeProviderCapabilityOverrides({
        version: 1,
        models: {
          'shared-image-model': {
            allowedRatios: ['3:4'],
            allowedSizes: ['1536x2048'],
            qualityOptions: ['high'],
            maxOutputs: 2,
          },
        },
      });

      await Promise.all([
        updateApiProvider('provider-a', {
          advancedParams: {
            compatProfile: seeds[0].compatProfile,
            customHeader: seeds[0].customHeader,
            taskModelCapabilities: capabilityA,
          },
        }),
        updateApiProvider('provider-b', {
          advancedParams: {
            compatProfile: seeds[1].compatProfile,
            customHeader: seeds[1].customHeader,
            taskModelCapabilities: capabilityB,
          },
        }),
      ]);

      const providers = await getApiProviders();
      const providerA = providers.find(provider => provider.id === 'provider-a');
      const providerB = providers.find(provider => provider.id === 'provider-b');
      expect(providerA?.advancedParams).toMatchObject({
        compatProfile: seeds[0].compatProfile,
        customHeader: seeds[0].customHeader,
      });
      expect(providerB?.advancedParams).toMatchObject({
        compatProfile: seeds[1].compatProfile,
        customHeader: seeds[1].customHeader,
      });
      expect(readProviderCapabilityOverrides(
        providerA?.advancedParams?.taskModelCapabilities,
      )).toEqual(JSON.parse(capabilityA));
      expect(readProviderCapabilityOverrides(
        providerB?.advancedParams?.taskModelCapabilities,
      )).toEqual(JSON.parse(capabilityB));
    });
  }, 60_000);
});
