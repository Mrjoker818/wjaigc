import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('configured upscale toolbar wiring', () => {
  it('loads the enabled upscaler catalog and forwards the selected provider-model pair', () => {
    expect(source).toContain("fetch('/api/models?type=upscaler')");
    expect(source).toContain('selectedUpscaleModel');
    expect(source).not.toContain('THREE_O_TWO_UPSCALE_MODELS');
    expect(source).toContain("upscaleMode === 'ai-only'");
    expect(source).toContain("upscaleModel: upscaleMode === 'ai-only' ? selectedUpscaleModel?.modelId : undefined");
    expect(source).toContain("providerId: upscaleMode === 'ai-only' ? selectedUpscaleModel?.providerId : (modelInfo.providerId || getCurrentProviderId())");
  });
});
