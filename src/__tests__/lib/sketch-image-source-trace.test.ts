import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { CanvasSourceTraceBadge, WorkspaceSourceTraceDetails } from '@/components/workspace-source-trace';

const trace = {
  source: 'sketch-to-image', taskId: 'skimg_result-1', projectId: 'project-1',
  previewAssetVersionId: 'sketch-input-v1', imageAssetVersionId: 'generated-image-v1',
  visionProviderId: 'vision-provider', visionModelId: '视觉模型-1',
  imageProviderId: 'image-provider', imageModelId: '图像模型-1',
};

describe('honest sketch image provenance from the protected result binding', () => {
  it('preserves the original PNG and generated image versions plus both explicit model pairs', () => {
    const parsed = parseWorkspaceSourceTrace(trace);
    expect(parsed).toEqual(trace);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed).not.toHaveProperty('htmlAssetVersionId');
    expect(parsed).not.toHaveProperty('createdAt');
  });
  it('does not let volatile receipt time, secrets or arbitrary metadata alter canonical provenance', () => {
    const parsed = parseWorkspaceSourceTrace({ ...trace, createdAt: '2026-10-13T00:00:00.000Z',
      apiKey: 'secret-image-key', token: 'secret-auth-token', instruction: 'private-keywords' });
    expect(parsed).toEqual(trace);
    expect(JSON.stringify(parsed)).not.toMatch(/secret-|private-|createdAt|instruction|apiKey|token/);
  });
  it.each(['taskId', 'projectId', 'previewAssetVersionId', 'imageAssetVersionId',
    'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId'] as const)(
    'rejects an incomplete result binding: %s', field => {
      const invalid: Record<string, unknown> = { ...trace }; delete invalid[field];
      expect(parseWorkspaceSourceTrace(invalid)).toBeUndefined();
    });
  it.each(['taskId', 'projectId', 'previewAssetVersionId', 'imageAssetVersionId'] as const)(
    'rejects non-identifier result provenance: %s', field => {
      expect(parseWorkspaceSourceTrace({ ...trace, [field]: '../foreign' })).toBeUndefined();
    });
  it.each(['visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId'] as const)(
    'rejects unbounded or control-bearing model labels: %s', field => {
      expect(parseWorkspaceSourceTrace({ ...trace, [field]: '' })).toBeUndefined();
      expect(parseWorkspaceSourceTrace({ ...trace, [field]: 'x'.repeat(257) })).toBeUndefined();
      expect(parseWorkspaceSourceTrace({ ...trace, [field]: 'model\nprivate' })).toBeUndefined();
    });
  it('retains labels at the existing image-task 256-character boundary, including slash model names', () => {
    const bounded = { ...trace, visionModelId: 'v'.repeat(256), imageModelId: 'vendor/image/model-v2' };
    expect(parseWorkspaceSourceTrace(bounded)).toEqual(bounded);
  });
  it('keeps the independent HTML provenance contract intact', () => {
    const html = { source: 'sketch-to-code', taskId: 'sketch-1', projectId: 'project-1',
      previewAssetVersionId: 'png-v1', htmlAssetVersionId: 'html-v1', createdAt: '2026-10-09T00:00:00.000Z' };
    expect(parseWorkspaceSourceTrace(html)).toEqual(html);
    expect(parseWorkspaceSourceTrace({ ...html, htmlAssetVersionId: undefined })).toBeUndefined();
    expect(parseWorkspaceSourceTrace({ ...trace, source: 'sketch-to-code' })).toBeUndefined();
  });
});

describe('sketch image provenance presentation', () => {
  it('labels image generation honestly, without calling its result HTML or intelligent chat', () => {
    const details = renderToStaticMarkup(React.createElement(WorkspaceSourceTraceDetails, { sourceTrace: trace }));
    const badge = renderToStaticMarkup(React.createElement(CanvasSourceTraceBadge, { sourceTrace: trace, isSelected: true }));
    expect(details).toContain('草图生图'); expect(badge).toContain('草图生图');
    for (const value of [trace.taskId, trace.projectId, trace.previewAssetVersionId, trace.imageAssetVersionId,
      trace.visionProviderId, trace.visionModelId, trace.imageProviderId, trace.imageModelId]) expect(details).toContain(value);
    expect(details + badge).not.toMatch(/草图转代码|来源：智能对话|HTML版本|本地接收时间/);
  });
  it('does not render an unselected, invalid or secret-bearing provenance label', () => {
    expect(renderToStaticMarkup(React.createElement(CanvasSourceTraceBadge, { sourceTrace: trace, isSelected: false }))).toBe('');
    expect(renderToStaticMarkup(React.createElement(WorkspaceSourceTraceDetails, { sourceTrace: { ...trace, imageModelId: undefined } }))).toBe('');
    const markup = renderToStaticMarkup(React.createElement(WorkspaceSourceTraceDetails, {
      sourceTrace: { ...trace, apiKey: 'secret-image-key', instruction: 'private-keywords' },
    }));
    expect(markup).toContain('草图生图'); expect(markup).not.toMatch(/secret-image-key|private-keywords/);
  });
});
