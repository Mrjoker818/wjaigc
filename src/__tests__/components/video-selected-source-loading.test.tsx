// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoGenerationPanel from '@/components/video-generation-panel';

const catalog = {
  success:true, capabilityCatalogVersion:1,
  providers:[{id:'synthetic-provider',name:'合成供应商'}],
  models:[{id:'synthetic-video',name:'合成视频模型',providerId:'synthetic-provider',type:'video',isDefault:true}],
  taskModelCatalog:[{providerId:'synthetic-provider',modelId:'synthetic-video',kind:'video',sourceType:'video',protocol:'openai',executionMode:'async',allowedRatios:['16:9'],allowedSizes:['1K'],qualityOptions:['std'],maxOutputs:1,supportsReferenceImages:false,supportsMask:false,allowedDurationsSeconds:[5],maxDurationSeconds:5,supportedOperations:['text-to-video','video-extend'],outputKinds:['video'],capabilitySources:{}}],
};

describe('video source selection while models load', () => {
  beforeEach(() => {
    Object.defineProperty(window,'matchMedia',{configurable:true,value:() => ({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})});
  });
  afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

  it('uses the selected canvas video once an eligible model finishes loading', async () => {
    let releaseCatalog: (value: Response) => void = () => {throw new Error('catalog not requested');};
    const pending = new Promise<Response>(resolve => {releaseCatalog=resolve;});
    const generate = vi.fn();
    vi.stubGlobal('fetch',vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/models?type=video') return pending;
      throw new Error(`Unexpected fixture request: ${String(input)}`);
    }));
    const view = render(<VideoGenerationPanel selectedVideoUrl="https://media.invalid/source.mp4" onVideoGenerate={generate} />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/models?type=video',expect.anything()));
    expect(screen.queryByRole('button',{name:'移除源视频'})).toBeNull();
    await act(async () => {releaseCatalog({ok:true,json:async () => catalog} as Response);await Promise.resolve();});
    expect(await screen.findByRole('button',{name:'移除源视频'})).toBeTruthy();
    expect(screen.getByText('https://media.invalid/source.mp4')).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'移除源视频'}));
    expect(screen.getByPlaceholderText('输入视频URL（画布选中视频会自动填充）')).toHaveProperty('value','');
    await act(async () => {fireEvent(document, new Event('visibilitychange'));await Promise.resolve();});
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    expect(screen.getByPlaceholderText('输入视频URL（画布选中视频会自动填充）')).toHaveProperty('value','');
    view.rerender(<VideoGenerationPanel selectedVideoUrl="https://media.invalid/second.mp4" onVideoGenerate={generate} />);
    expect(await screen.findByText('https://media.invalid/second.mp4')).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
  });

  it('waits for an eligible model and does not restore a source the user removed', async () => {
    const plain = {...catalog.models[0],id:'plain-video',name:'不支持延长',isDefault:true};
    const extend = {...catalog.models[0],name:'支持延长',isDefault:false};
    const plainDescriptor = {...catalog.taskModelCatalog[0],modelId:'plain-video',supportedOperations:['text-to-video']};
    const result = {...catalog,models:[plain,extend],taskModelCatalog:[plainDescriptor,catalog.taskModelCatalog[0]]};
    const generate = vi.fn();
    vi.stubGlobal('fetch',vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/models?type=video') return Promise.resolve({ok:true,json:async () => result} as Response);
      throw new Error(`Unexpected fixture request: ${String(input)}`);
    }));
    render(<VideoGenerationPanel selectedVideoUrl="https://media.invalid/source.mp4" onVideoGenerate={generate} />);
    const option = await screen.findByRole('option',{name:/^支持延长/});
    const select = option.parentElement;
    expect(select).toBeTruthy();
    await waitFor(() => expect(select).toHaveProperty('value','synthetic-provider::plain-video'));
    expect(screen.queryByRole('button',{name:'移除源视频'})).toBeNull();
    fireEvent.change(select!,{target:{value:'synthetic-provider::synthetic-video'}});
    fireEvent.click(await screen.findByRole('button',{name:'移除源视频'}));
    fireEvent.change(select!,{target:{value:'synthetic-provider::plain-video'}});
    fireEvent.change(select!,{target:{value:'synthetic-provider::synthetic-video'}});
    fireEvent.click(await screen.findByRole('button',{name:/视频延长/}));
    expect(screen.getByPlaceholderText('输入视频URL（画布选中视频会自动填充）')).toHaveProperty('value','');
    expect(generate).not.toHaveBeenCalled();
  });

  it('keeps a manual source when an eligible model arrives and applies a new canvas selection', async () => {
    let resolveCatalog!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveCatalog = resolve; });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/models?type=video') return pending;
      throw new Error('Unexpected fixture request: ' + String(input));
    }));
    const generate = vi.fn();
    const props = {
      externalPrompt: 'Extend this clip',
      externalPromptMode: 'extend' as const,
      onVideoGenerate: generate,
    };
    const canvasSource = 'https://media.invalid/canvas.mp4';
    const manualSource = 'https://media.invalid/manual.mp4';
    const view = render(<VideoGenerationPanel {...props} selectedVideoUrl={canvasSource} />);
    const input = await screen.findByPlaceholderText('输入视频URL（画布选中视频会自动填充）');
    fireEvent.change(input, { target: { value: manualSource } });
    expect(screen.getByText(manualSource)).toBeTruthy();

    await act(async () => { resolveCatalog(Response.json(catalog)); });
    await screen.findByRole('button', { name: '视频延长' });
    expect(screen.getByText(manualSource)).toBeTruthy();
    expect(screen.queryByText(canvasSource)).toBeNull();

    const nextCanvasSource = 'https://media.invalid/next-canvas.mp4';
    view.rerender(<VideoGenerationPanel {...props} selectedVideoUrl={nextCanvasSource} />);
    expect(await screen.findByText(nextCanvasSource)).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
  });
});
