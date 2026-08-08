import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('shared generation slot contract across entry points', () => {
  it('keeps the image generation panel on the submitOnly batch path with outputCount', () => {
    const panel = readSource('src/components/generation-panel.tsx');
    const workspace = readSource('src/components/canvas-workspace.tsx');

    expect(panel).toContain('outputCount,');
    expect(workspace).toContain("fetch('/api/generate'");
    expect(workspace).toContain('submitOnly: true');
    expect(workspace).toContain('normalizeGenerationSubmitSlots(');
    expect(workspace).toContain(
      'applyGenerationSlotsToProcessingPlaceholders(previous, submittedSlots, placeholderIds)',
    );
    expect(workspace).not.toContain(
      'applyGenerationSlotsToProcessingPlaceholders(previous, data.slots, placeholderIds)',
    );
  });

  it('keeps reference and fusion groups on the same durable slots response contract', () => {
    const canvas = readSource('src/components/infinite-canvas.tsx');
    const groupStart = canvas.indexOf('const handleGroupGenerate');
    const groupEnd = canvas.indexOf('const handleImageGroup', groupStart);
    const groupGeneration = canvas.slice(groupStart, groupEnd > groupStart ? groupEnd : undefined);

    expect(groupGeneration).toContain("fetch('/api/generate'");
    expect(groupGeneration).toContain('submitOnly: true');
    expect(groupGeneration).toContain('referenceMode: group.type');
    expect(groupGeneration).toContain('normalizeGenerationSubmitSlots(');
  });

  it('keeps chat image generation on the same durable slots response contract', () => {
    const chat = readSource('src/components/chat-panel.tsx');

    expect(chat).toContain("fetch('/api/generate'");
    expect(chat).toContain('submitOnly: true');
    expect(chat).toContain('normalizeGenerationSubmitSlots(');
    expect(chat).toContain('const slotErrors: string[] = [];');
    expect(chat).toContain(
      '? { ...msg, isGeneratingImage: true, generateError: slotError }',
    );
    expect(chat).toContain('generatedImages: uniqueResultUrls,');
    expect(chat).toContain('isGeneratingImage: false,');
  });

  it('keeps workflow image nodes routed through submitOnly /api/generate', () => {
    const workflow = readSource('src/lib/workflow-engine.ts');
    const generateStart = workflow.indexOf("case 'ai-generate':");
    const generateEnd = workflow.indexOf("case 'ai-edit':", generateStart);
    const generateBranch = workflow.slice(generateStart, generateEnd);

    expect(workflow).toContain("endpoint: '/api/generate'");
    expect(generateBranch).toContain('submitOnly: true');
    expect(generateBranch).toContain('outputCount: config.n || 1');
    expect(generateBranch.match(/submitOnly:\s*true/g)).toHaveLength(1);
  });
});
