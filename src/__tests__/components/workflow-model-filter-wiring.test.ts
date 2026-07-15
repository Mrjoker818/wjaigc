import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/workflow-engine.ts'), 'utf8');

describe('workflow model filter wiring', () => {
  it('uses the API layer model type for the element segmentation node', () => {
    const propertyFields = source.slice(source.indexOf('export function getNodePropertyFields'));
    const segmentFields = propertyFields.slice(propertyFields.indexOf("if (type === 'ai-segment')"), propertyFields.indexOf("if (type === 'ai-multi-angle')"));

    expect(segmentFields).toContain("modelFilter: 'layer'");
    expect(segmentFields).not.toContain("modelFilter: 'segment'");
  });
});
