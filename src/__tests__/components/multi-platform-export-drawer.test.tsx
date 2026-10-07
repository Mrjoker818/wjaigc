// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiPlatformExportDrawer } from '@/components/skill-runtime/MultiPlatformExportDrawer';
import type { AgentRunProjection } from '@/lib/agent-runtime/types';
import { createMultiPlatformExportRequestFingerprint } from '@/lib/skill-runtime/multi-platform-export-client';

const enabledPresets = [
  {
    id: 'instagram-post', version: 1, platform: 'Instagram', usage: 'post',
    label: 'Instagram 帖子', width: 1080, height: 1080,
    recommendedFormat: 'png' as const, supportsTransparency: true, enabled: true,
  },
  {
    id: 'youtube-cover', version: 1, platform: 'YouTube', usage: 'cover',
    label: 'YouTube 封面', width: 1280, height: 720,
    recommendedFormat: 'jpeg' as const, supportsTransparency: false, enabled: true,
  },
];

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function projection(overrides: Partial<AgentRunProjection> = {}): AgentRunProjection {
  return {
    runId: 'run-export-1', status: 'executing', lastSequence: 4,
    plan: [{ id: 'export', label: '生成平台尺寸', status: 'processing' }],
    assetVersionIds: [], ignoredEventIds: [], missingSequences: [], qualityChecks: [],
    progress: 25,
    ...overrides,
  };
}

describe('MultiPlatformExportDrawer', () => {
  it.each(['document', 'legacy', 'located', 'denied', 'wrong-actor', 'wrong-project', 'wrong-run', 'wrong-version', 'late-actor', 'late-project', 'late-run', 'late-authority', 'late-unmount', 'late-locate', 'pending'] as const)('1397 fix1 actual Drawer source boundary %s', async mode => {
    const authority = mode === 'legacy' ? 'legacy' : mode === 'pending' ? 'pending' : 'document';
    const pending = deferred<Response>(); const locate = deferred<boolean>();
    const envelope = { actorUserId: mode === 'wrong-actor' ? 'other' : 'editor', projectId: mode === 'wrong-project' ? 'other' : 'project-1', runId: mode === 'wrong-run' ? 'other' : 'run-export-1' };
    const ref = { assetId: 'out-a', assetVersionId: 'out-v', kind: 'image', url: '/output.png' };
    const source = { assetId: 'source-a', assetVersionId: 'source-v', kind: 'image', url: '/source.png', name: 'Source' };
    const manifest = { schemaVersion: 1, schemaId: 'multi-platform-export-manifest-v1', runId: 'run-export-1',
      requestDigest: 'a'.repeat(64), createdAt: '2026-10-06T00:00:00Z', frozenParameters: {}, failures: [],
      files: [{ filename: 'out.png', sourceAssetVersionId: 'source-v', derivedAssetVersionId: 'out-v',
        platform: 'fixture', usage: 'post', width: 2, height: 2, mimeType: 'image/png', byteSize: 8, sha256: 'a'.repeat(64) }] };
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url === '/api/platform-export-presets') return Response.json({ success: true, presets: enabledPresets });
      if (url === '/manifest.json') return Response.json(manifest);
      if (url.includes('assetVersionId=source-v')) {
        if (authority === 'document' && url.startsWith('/api/skill-runs/run-export-1/sources?'))
          return mode.startsWith('late-') ? pending.promise : mode === 'denied' ? Response.json({error:'forbidden'}, {status:403}) : Response.json({...envelope, references:[mode === 'wrong-version' ? {...source,assetVersionId:'other'} : source]});
        if (authority === 'legacy' && url.startsWith('/api/assets?')) return Response.json(source);
        return Response.json({ error: 'not an output' }, { status: 403 });
      }
      return Response.json({ actorUserId: 'editor', projectId: 'project-1', runId: 'run-export-1', references:
        url.includes('assetVersionId=manifest') ? [{ assetId: 'manifest-a', assetVersionId: 'manifest', kind: 'document', url: '/manifest.json' }] : [ref] });
    });
    const props: React.ComponentProps<typeof MultiPlatformExportDrawer> = { open: true, authority, projectId: 'project-1', accountKey: 'editor', sourceAssetVersionIds: ['source-v'],
      values: {}, fetcher, onChange: vi.fn(), onEstimate: vi.fn(), onStart: vi.fn(), onClose: vi.fn(), onLocateSource: vi.fn(() => mode === 'late-locate' ? locate.promise : mode === 'located'),
      projection: projection({ status: 'completed', result: { outputs: [{ stepId: 'export', kind: 'json',
        schemaId: 'multi-platform-export-result-v1', content: JSON.stringify({ schemaVersion: 1, runId: 'run-export-1',
          outcome: 'completed', imageAssetVersionIds: ['out-v'], manifestAssetVersionId: 'manifest', zipAssetVersionId: 'zip', failures: [] }) }] } }) };
    const view = render(<MultiPlatformExportDrawer {...props} />);
    if (mode === 'pending') {
      await waitFor(() => expect(screen.getByText('画布权威尚未就绪')).not.toBeNull());
      expect(fetcher.mock.calls.some(([url]) => String(url).includes('assetVersionId=source-v'))).toBe(false); return;
    }
    fireEvent.click(await screen.findByRole('button', { name: '定位来源 source-v' }));
    if (mode.startsWith('late-')) {
      await waitFor(() => expect(props.onLocateSource).toHaveBeenCalled());
      if (mode !== 'late-locate') await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes('/sources?'))).toBe(true));
      if (mode === 'late-actor') view.rerender(<MultiPlatformExportDrawer {...props} accountKey="other" />);
      if (mode === 'late-project' || mode === 'late-locate') view.rerender(<MultiPlatformExportDrawer {...props} projectId="other" />);
      if (mode === 'late-authority') view.rerender(<MultiPlatformExportDrawer {...props} authority="pending" />);
      if (mode === 'late-run') view.rerender(<MultiPlatformExportDrawer {...props} projection={projection({status:'executing'})} />);
      if (mode === 'late-unmount') view.unmount();
      await act(async () => { locate.resolve(false); pending.resolve(Response.json({...envelope,references:[source]})); await pending.promise; });
      expect(screen.queryByAltText('Source')).toBeNull();
      if (mode === 'late-locate') expect(fetcher.mock.calls.some(([url]) => String(url).includes('/sources?'))).toBe(false);
    } else if (mode === 'located') {
      await waitFor(() => expect(props.onLocateSource).toHaveBeenCalledWith('source-v'));
      expect(fetcher.mock.calls.some(([url]) => String(url).includes('assetVersionId=source-v'))).toBe(false);
    } else if (mode === 'denied' || mode.startsWith('wrong-')) {
      await screen.findByRole('alert'); expect(screen.queryByAltText('Source')).toBeNull();
    } else expect((await screen.findByAltText('Source')).getAttribute('src')).toBe(source.url);
    expect(props.onLocateSource).toHaveBeenCalledWith('source-v');
    if (authority === 'document') expect(fetcher.mock.calls.some(([url]) => String(url).startsWith('/api/assets?'))).toBe(false);
  });
  it.each(['normal','actor','project','unmount'] as const)('run-bound manual delivery %s never uses private assets or consumes a stale scope',async mode=>{
    const pending=deferred<Response>();let reads=0;
    const ref={assetId:'asset',assetVersionId:'image',kind:'image',url:'/image.png'};
    const fetcher=vi.fn<typeof fetch>(async input=>{
      const url=String(input);if(url==='/api/platform-export-presets')return Response.json({success:true,presets:enabledPresets});
      if(!url.startsWith('/api/skill-runs/run-export-1/assets?'))throw new Error('Private assets forbidden');
      reads++;return reads===1?Response.json({actorUserId:'editor',runId:'run-export-1',projectId:'project-1',references:[ref]}):pending.promise;
    });
    const props={open:true,projectId:'project-1',accountKey:'editor',sourceAssetVersionIds:['source'],values:{},
      onChange:vi.fn(),onEstimate:vi.fn(),onStart:vi.fn(),onClose:vi.fn(),onAddToCanvas:vi.fn(),fetcher,
      projection:projection({status:'completed',result:{outputs:[{stepId:'export',kind:'json',schemaId:'multi-platform-export-result-v1',
        content:JSON.stringify({schemaVersion:1,runId:'run-export-1',outcome:'partial_success',imageAssetVersionIds:['image'],
          failures:[{sourceAssetVersionId:'source',code:'EXPORT_TRANSFORM_FAILED',retryable:true}]})}]}})};
    const view=render(<MultiPlatformExportDrawer {...props}/>);
    fireEvent.click(await screen.findByRole('button',{name:'批量放入画布'}));
    await waitFor(()=>expect(reads).toBe(2));
    if(mode==='actor')view.rerender(<MultiPlatformExportDrawer {...props} accountKey="other"/>);
    if(mode==='project')view.rerender(<MultiPlatformExportDrawer {...props} projectId="other"/>);
    if(mode==='unmount')view.unmount();
    await act(async()=>{pending.resolve(Response.json({actorUserId:'editor',runId:'run-export-1',projectId:'project-1',references:[ref]}));await pending.promise;});
    if(mode==='normal')await waitFor(()=>expect(props.onAddToCanvas).toHaveBeenCalledWith([ref]));
    else expect(props.onAddToCanvas).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url])=>String(url).startsWith('/api/assets?'))).toBe(false);
  });
  it('renders a bottom-toolbar drawer with the six approved sections and responsive controls', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      presets: [...enabledPresets, { ...enabledPresets[0], id: 'disabled', enabled: false }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    render(
      <MultiPlatformExportDrawer
        open
        projectId="project-1"
        sourceAssetVersionIds={['version-source-1', 'version-source-2']}
        values={{ fit: 'cover', background: '#ffffffff', namingTemplate: '{asset}-{size}' }}
        onChange={vi.fn()}
        onEstimate={vi.fn()}
        onStart={vi.fn()}
        onClose={vi.fn()}
        fetcher={fetcher}
      />,
    );

    expect(screen.getByRole('heading', { name: '多平台批量导出' })).not.toBeNull();
    for (const label of ['素材', '目标平台', '适配方式', '命名', '执行预览', '结果']) {
      expect(screen.getByRole('heading', { name: label })).not.toBeNull();
    }
    const drawer = screen.getByTestId('multi-platform-export-drawer');
    expect(drawer.hasAttribute('data-bottom-toolbar-drawer')).toBe(true);
    expect(drawer.style.bottom).toBe('var(--canvas-bottom-toolbar-offset)');
    expect(drawer.querySelector('.grid-cols-1')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => expect(screen.getByLabelText('Instagram 帖子')).not.toBeNull());
    expect(screen.getByLabelText('YouTube 封面')).not.toBeNull();
    expect(screen.queryByLabelText('disabled')).toBeNull();
    expect(screen.getByText('已选择 2 张受管图片')).not.toBeNull();
    expect(screen.getByText('积分 0')).not.toBeNull();
    expect(screen.getByRole('button', { name: '裁切填充' }).className).toContain('min-h-10');
    expect(screen.getByRole('button', { name: '完整留白' }).className).toContain('min-h-10');
    expect(drawer.querySelector('label label')).toBeNull();
    expect(screen.getByText('尚未校验')).not.toBeNull();
  });

  it('keeps export history inside the dedicated drawer and restores the selected run', async () => {
    const onRestoreRun = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.startsWith('/api/skill-runs?')) return Response.json({ runs: [{
        runId: 'run-history-1', projectId: 'project-1', surface: 'canvas',
        skillId: 'preset-multi-platform-export', status: 'completed', createdAt: 1,
        sourceVersionIds: ['version-source-1'], outputs: [],
      }] });
      return Response.json({ success: true, presets: enabledPresets });
    });
    render(<MultiPlatformExportDrawer
      open projectId="project-1" accountKey="user-1" activeRunId="run-current"
      sourceAssetVersionIds={['version-source-1']} values={{}}
      onChange={vi.fn()} onEstimate={vi.fn()} onStart={vi.fn()} onClose={vi.fn()}
      onRestoreRun={onRestoreRun} fetcher={fetcher}
    />);

    fireEvent.click(await screen.findByRole('button', { name: '查看任务 run-history-1' }));
    expect(onRestoreRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-history-1' }));
  });

  it('does not present a credit-only estimate as an authoritative export-plan validation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, presets: enabledPresets }));
    const values = { targetPresetIds: ['instagram-post-v1'] };
    render(<MultiPlatformExportDrawer
      open projectId="project-1" accountKey="user-1" sourceAssetVersionIds={['version-source-1']}
      values={values} estimate={{ minimum: 0, maximum: 0, steps: [{ stepId: 'export', cost: 0 }] }}
      estimateRequestFingerprint={createMultiPlatformExportRequestFingerprint({
        projectId: 'project-1', sourceAssetVersionIds: ['version-source-1'], values,
      })}
      projection={projection({ status: 'completed', progress: 100, result: { outputs: [
        { stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1', content: '{broken' },
      ] } })}
      onChange={vi.fn()} onEstimate={vi.fn()} onStart={vi.fn()} onRetry={vi.fn()} onClose={vi.fn()}
      fetcher={fetcher}
    />);

    expect(screen.getByText('积分已校验，导出计划尚未校验')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('结果数据损坏或版本不兼容');
    expect(screen.getByRole('button', { name: '查看运行日志' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '重试导出' })).not.toBeNull();
  });

  it('renders authoritative server file, pixel, ZIP and credit estimates when supplied', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, presets: enabledPresets }));
    const values = { targetPresetIds: ['instagram-post-v1'] };
    const estimate = {
      minimum: 0, maximum: 0, steps: [{ stepId: 'export', cost: 0 }],
      exportPlan: { fileCount: 2, totalPixels: 2_332_800, estimatedZipBytes: 1_680_000 },
    };
    render(<MultiPlatformExportDrawer
      open projectId="project-1" sourceAssetVersionIds={['version-source-1', 'version-source-2']}
      values={values} estimate={estimate}
      estimateRequestFingerprint={createMultiPlatformExportRequestFingerprint({
        projectId: 'project-1', sourceAssetVersionIds: ['version-source-1', 'version-source-2'], values,
      })}
      onChange={vi.fn()} onEstimate={vi.fn()} onStart={vi.fn()} onClose={vi.fn()} fetcher={fetcher}
    />);

    expect(screen.getByText('服务端校验成功')).not.toBeNull();
    expect(screen.getByText('服务端 2 个文件')).not.toBeNull();
    expect(screen.getByText('服务端 2,332,800 像素')).not.toBeNull();
    expect(screen.getByText(/\u670d\u52a1\u7aef ZIP/)).not.toBeNull();
  });

  it('invalidates a server estimate when any canonical export request field changes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, presets: enabledPresets }));
    const values = {
      targetPresetIds: ['instagram-post-v1'], fit: 'cover',
      background: '#ffffffff', namingTemplate: '{asset}-{size}',
    };
    const fingerprint = createMultiPlatformExportRequestFingerprint({
      projectId: 'project-1', sourceAssetVersionIds: ['version-source-1'], values,
    });
    const estimate = {
      minimum: 0, maximum: 0, steps: [{ stepId: 'export', cost: 0 }],
      exportPlan: { fileCount: 1, totalPixels: 1_166_400, estimatedZipBytes: 840_000 },
    };
    const props = {
      open: true, projectId: 'project-1', sourceAssetVersionIds: ['version-source-1'],
      values, estimate, estimateRequestFingerprint: fingerprint,
      onChange: vi.fn(), onEstimate: vi.fn(), onStart: vi.fn(), onClose: vi.fn(), fetcher,
    } as const;
    const { rerender } = render(<MultiPlatformExportDrawer {...props} />);
    expect(screen.getByText('服务端校验成功')).not.toBeNull();

    rerender(<MultiPlatformExportDrawer {...props} values={{ ...values, namingTemplate: '{asset}-{index}' }} />);
    expect(screen.queryByText('服务端校验成功')).toBeNull();
    expect(screen.queryByLabelText('服务端导出计划')).toBeNull();
    expect(screen.getByText('尚未校验')).not.toBeNull();
  });

  it('does not let an estimate for request A validate request B after the form changes in flight', async () => {
    const pending = deferred<{
      minimum: number;
      maximum: number;
      steps: Array<{ stepId: string; cost: number }>;
      exportPlan: { fileCount: number; totalPixels: number; estimatedZipBytes: number };
    }>();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, presets: enabledPresets }));
    const valuesA = {
      targetPresetIds: ['instagram-post-v1'], fit: 'cover',
      background: '#ffffffff', namingTemplate: '{asset}-{size}',
    };
    const props = {
      open: true, projectId: 'project-1', sourceAssetVersionIds: ['version-source-1'],
      values: valuesA, onChange: vi.fn(), onEstimate: vi.fn(() => pending.promise),
      onStart: vi.fn(), onClose: vi.fn(), fetcher,
    } as const;
    const { rerender } = render(<MultiPlatformExportDrawer {...props} />);
    await waitFor(() => expect(screen.getByLabelText('Instagram 帖子')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '校验计划' }));
    expect(screen.getByText('正在请求服务端校验')).not.toBeNull();
    rerender(<MultiPlatformExportDrawer {...props} values={{ ...valuesA, namingTemplate: '{asset}-{index}' }} />);
    await waitFor(() => expect(screen.getByText('尚未校验')).not.toBeNull());

    await act(async () => {
      pending.resolve({
        minimum: 0, maximum: 0, steps: [{ stepId: 'export', cost: 0 }],
        exportPlan: { fileCount: 1, totalPixels: 1_166_400, estimatedZipBytes: 840_000 },
      });
      await pending.promise;
    });
    expect(screen.queryByText('服务端校验成功')).toBeNull();
    expect(screen.queryByText('积分已校验，导出计划尚未校验')).toBeNull();
    expect(screen.getByText('尚未校验')).not.toBeNull();
  });

  it('shows a visible failed state when server validation does not return an estimate', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, presets: enabledPresets }));
    render(<MultiPlatformExportDrawer
      open projectId="project-1" sourceAssetVersionIds={['version-source-1']}
      values={{ targetPresetIds: ['instagram-post-v1'] }} onChange={vi.fn()}
      onEstimate={vi.fn().mockResolvedValue(undefined)} onStart={vi.fn()} onClose={vi.fn()} fetcher={fetcher}
    />);
    await waitFor(() => expect(screen.getByText('1 个文件')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '校验计划' }));
    await waitFor(() => expect(screen.getByText('服务端校验失败')).not.toBeNull());
  });

  it('uses selected public presets for the deterministic file, pixel and ZIP preview', async () => {
    const onChange = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true, presets: enabledPresets,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    render(
      <MultiPlatformExportDrawer
        open
        projectId="project-1"
        sourceAssetVersionIds={['version-source-1', 'version-source-2']}
        values={{ targetPresetIds: ['instagram-post-v1'], fit: 'cover', background: '#ffffffff', namingTemplate: '{asset}' }}
        onChange={onChange}
        onEstimate={vi.fn()}
        onStart={vi.fn()}
        onClose={vi.fn()}
        fetcher={fetcher}
      />,
    );

    await waitFor(() => expect(screen.getByText('2 个文件')).not.toBeNull());
    expect(screen.getByText('2,332,800 像素')).not.toBeNull();
    expect(screen.getByText(/预计 ZIP/)).not.toBeNull();
    fireEvent.click(screen.getByLabelText('YouTube 封面'));
    expect(onChange).toHaveBeenCalledWith('targetPresetIds', ['instagram-post-v1', 'youtube-cover-v1']);
  });

  it('shows only server projection progress and exposes PATCH-backed cancel and partial retry actions', async () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    const partialResult = {
      schemaVersion: 1, runId: 'run-export-1', outcome: 'partial_success',
      imageAssetVersionIds: ['version-image-1'], failures: [{
        sourceAssetVersionId: 'version-source-2', code: 'EXPORT_TRANSFORM_FAILED', retryable: true,
      }],
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true, presets: enabledPresets,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { rerender } = render(
      <MultiPlatformExportDrawer
        open projectId="project-1" sourceAssetVersionIds={['version-source-1']}
        values={{ targetPresetIds: ['instagram-post-v1'] }} onChange={vi.fn()}
        onEstimate={vi.fn()} onStart={vi.fn()} onClose={vi.fn()}
        projection={projection()} onCancel={onCancel} onRetry={onRetry} fetcher={fetcher}
      />,
    );
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('25');
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <MultiPlatformExportDrawer
        open projectId="project-1" sourceAssetVersionIds={['version-source-1']}
        values={{ targetPresetIds: ['instagram-post-v1'] }} onChange={vi.fn()}
        onEstimate={vi.fn()} onStart={vi.fn()} onClose={vi.fn()}
        projection={projection({
          status: 'failed', progress: 50,
          result: { outputs: [{ stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1', content: JSON.stringify(partialResult) }] },
        })}
        onRetry={onRetry} fetcher={fetcher}
      />,
    );
    expect(screen.getAllByText('部分成功')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '仅重试失败项' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith('export'));
  });

  it.each(['cancelled', 'timeout'] as const)('does not report absent output as corruption for %s runs', status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, presets: enabledPresets }));
    render(<MultiPlatformExportDrawer
      open projectId="project-1" sourceAssetVersionIds={['version-source-1']} values={{}}
      projection={projection({ status, result: undefined })}
      onChange={vi.fn()} onEstimate={vi.fn()} onStart={vi.fn()} onClose={vi.fn()} fetcher={fetcher}
    />);
    expect(screen.queryByText('结果数据损坏或版本不兼容')).toBeNull();
  });

});
