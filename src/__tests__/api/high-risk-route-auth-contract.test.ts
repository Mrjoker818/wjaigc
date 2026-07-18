import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const highRiskRouteFiles = [
  'src/app/api/ai-psd/create/route.ts',
  'src/app/api/brand-packaging/generate/route.ts',
  'src/app/api/workflow/ai-build/route.ts',
  'src/app/api/workflow/execute/route.ts',
  'src/app/api/excel/generate/route.ts',
  'src/app/api/export/bom/route.ts',
  'src/app/api/export/pdf/route.ts',
  'src/app/api/export/to-canvas/route.ts',
  'src/app/api/flowchart/generate/route.ts',
  'src/app/api/font-design/plan/route.ts',
  'src/app/api/font-design/prompt/route.ts',
  'src/app/api/image-to-3d/auto-multi-view/route.ts',
  'src/app/api/image-to-3d/poll-post-process/route.ts',
  'src/app/api/logo-skill/route.ts',
  'src/app/api/mindmap/generate/route.ts',
  'src/app/api/pdf/generate/route.ts',
  'src/app/api/ppt/generate/route.ts',
  'src/app/api/ppt/template/upload/route.ts',
  'src/app/api/recover-images/route.ts',
  'src/app/api/scene-studio/route.ts',
  'src/app/api/simple-chat/deep-research/route.ts',
  'src/app/api/simple-chat/upload-file/route.ts',
  'src/app/api/story-assets/plan/route.ts',
  'src/app/api/svg-convert/route.ts',
  'src/app/api/upscayl/route.ts',
  'src/app/api/video/director/prompt/route.ts',
  'src/app/api/video/director/shot-plan/route.ts',
  'src/app/api/word/generate/route.ts',
];

describe('high-risk API route authorization contract', () => {
  it('requires a verified request user before performing expensive or stateful work', () => {
    const missingAuthorization = highRiskRouteFiles.filter(routeFile => {
      const source = readFileSync(path.resolve(process.cwd(), routeFile), 'utf8');
      const handlerSource = source.slice(source.indexOf('export async function POST'));
      const authorizationIndex = handlerSource.indexOf('requireApiAuthOrReject(');
      const requestBodyIndex = handlerSource.search(/await\s+(?:request|req)\.(?:json|formData)\(/);

      return authorizationIndex < 0 || (requestBodyIndex >= 0 && authorizationIndex > requestBodyIndex);
    });

    expect(missingAuthorization).toEqual([]);
  });
});
