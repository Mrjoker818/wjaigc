import { z } from 'zod';

const providerKind = z.enum([
  'image', 'chat', 'universal', 'general', '3d', 'vectorize', 'layer', 'video',
  'vlm', 'imageEdit', 'upscaler', 'removebg', 'audio',
]);
const nonemptyText = z.string().trim().min(1);
const modelId = nonemptyText.max(512);
const httpEndpoint = nonemptyText.max(2048).refine(value => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
});

const providerConfig = z.object({
  id: nonemptyText.max(128),
  name: nonemptyText.max(256),
  displayName: nonemptyText.max(256).optional(),
  baseUrl: httpEndpoint,
  apiKey: nonemptyText.max(8192),
  type: providerKind.optional(),
  modelType: providerKind,
  requestStyle: z.enum(['chat-completions', 'images-generations', 'custom', 'auto']).optional(),
  selectedModels: z.array(modelId).max(300),
  advancedParams: z.record(z.string(), z.string()).optional(),
  discoveredModels: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
  isEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().nonnegative().max(2_147_483_647).optional(),
  balanceUsername: z.string().optional(),
  balancePassword: z.string().optional(),
}).strict();

const providerList = z.array(providerConfig).min(1).max(100);
export const INVALID_DEPLOYMENT_PROVIDER_CONFIGURATION = 'DEPLOYMENT_PROVIDER_CONFIGURATION_INVALID';

/** Only a secret supplied to a runtime can populate an empty deployment. */
export function parseDeploymentProviders(raw: string): Array<z.infer<typeof providerConfig>> {
  const invalid = () => new Error(INVALID_DEPLOYMENT_PROVIDER_CONFIGURATION);
  if (Buffer.byteLength(raw) > 256 * 1024) throw invalid();
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  const parsed = providerList.safeParse(input);
  if (!parsed.success) throw invalid();
  if (new Set(parsed.data.map(provider => provider.id)).size !== parsed.data.length) throw invalid();
  return parsed.data;
}
