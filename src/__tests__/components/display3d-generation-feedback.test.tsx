// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Display3DPanel from '@/components/display3d-panel';
import { hasVenueRegionCoordinates, VenueRegionCanvas } from '@/components/venue-region-canvas';

type FetchFixture = (url: string, init?: RequestInit) => Promise<Response>;

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function setupFixture(submit: FetchFixture, poll?: FetchFixture, onAddImages?: (urls: string[]) => void | Promise<void>, captureCanvasInsertion?: () => (urls: string[]) => Promise<void>): void {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/models?')) return Promise.resolve(response({ providers: [], models: [] }));
    if (url === '/api/display-3d/generate') return submit(url, init);
    if (url === '/api/poll-task' && poll) return poll(url, init);
    throw new Error(`Unexpected fixture request: ${url}`);
  }));
  render(<Display3DPanel onClose={() => {}} onAddImages={onAddImages} captureCanvasInsertion={captureCanvasInsertion} />);
  fireEvent.change(screen.getByPlaceholderText('如：NIKE、星巴克、华为'), { target: { value: '合成品牌' } });
  fireEvent.click(screen.getByRole('button', { name: '生成展陈方案' }));
}

describe('display 3D generation feedback', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('only uses finite normalized region boxes as coordinates', () => {
    const region = { id:'r1', name:'区域', type:'main', position:{ x:0.1, y:0.2, w:0.3, h:0.4 } };
    expect(hasVenueRegionCoordinates(region)).toBe(true);
    expect(hasVenueRegionCoordinates({ ...region, position:'左侧入口' })).toBe(false);
    expect(hasVenueRegionCoordinates({ ...region, position:{ x:0.9, y:0.2, w:0.3, h:0.4 } })).toBe(false);
    expect(hasVenueRegionCoordinates({ ...region, position:{ x:NaN, y:0.2, w:0.3, h:0.4 } })).toBe(false);
  });

  it('draws an unknown region type with a safe fallback label and color', async () => {
    const fillText = vi.fn();
    const ctx = { clearRect:vi.fn(),drawImage:vi.fn(),fillRect:vi.fn(),strokeRect:vi.fn(),setLineDash:vi.fn(),measureText:() => ({width:10}),beginPath:vi.fn(),roundRect:vi.fn(),fill:vi.fn(),fillText,strokeStyle:'' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('Image', class {
      crossOrigin = '';
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    render(<VenueRegionCanvas imageUrl="/synthetic/venue.png" regions={[{id:'r1',name:'区域',type:'constructor',position:{x:0.1,y:0.1,w:0.3,h:0.4}}]} />);
    await waitFor(() => expect(fillText).toHaveBeenCalledWith('constructor · 区域',expect.any(Number),expect.any(Number)));
    expect(ctx.strokeStyle).toBe('#f97316');
  });

  it('shows a confirmed request rejection and keeps the entered brand', async () => {
    setupFixture(async () => response({ error: '未找到可用的图像模型，请在管理员后台配置' },400));
    expect(await screen.findByText('未找到可用的图像模型，请在管理员后台配置')).toBeTruthy();
    expect(screen.getByPlaceholderText('如：NIKE、星巴克、华为')).toHaveProperty('value','合成品牌');
  });

  it('tells the user that a server error leaves the submission outcome unknown', async () => {
    setupFixture(async () => response({ error:'synthetic upstream error' },503));
    expect(await screen.findByText(/提交结果暂无法确认/)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/display-3d/generate')).toHaveLength(1);
  });

  it('shows the task identity when a submitted task reports failure', async () => {
    setupFixture(async () => response({taskId:'synthetic-task'}), async () => response({status:'failed',error:'合成任务失败'}));
    expect((await screen.findByText(/合成任务失败/)).textContent).toContain('synthetic-task');
  });

  it('reports an unknown submission outcome when the request loses its response', async () => {
    setupFixture(async () => { throw new Error('synthetic network interruption'); });
    expect(await screen.findByText(/提交结果暂无法确认/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name:'生成展陈方案' })).toHaveProperty('disabled', false));
  });

  it('retains the submitted task identity when its status response cannot be parsed', async () => {
    setupFixture(async () => response({taskId:'synthetic-task'}), async () => ({ok:false,status:503,json:async () => {throw new SyntaxError('synthetic non-JSON response');}}) as unknown as Response);
    expect((await screen.findByRole('alert')).textContent).toContain('synthetic-task');
    expect(screen.getByRole('alert').textContent).toContain('暂无法确认');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/display-3d/generate')).toHaveLength(1);
  });

  it('shows an unconfirmed task and stops presenting it as actively generating', async () => {
    setupFixture(async () => response({taskId:'synthetic-task'}), async () => response({status:'processing',code:'DISPLAY3D_OUTCOME_UNCONFIRMED'}));
    const alert = await screen.findByRole('alert', {}, { timeout: 500 });
    expect(alert.textContent).toContain('synthetic-task');
    expect(alert.textContent).toContain('待核');
    expect(screen.getByRole('button', {name:'生成展陈方案'})).toHaveProperty('disabled', true);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/poll-task')).toHaveLength(1);
  });

  it('treats a JSON status-service error as unconfirmed instead of polling indefinitely', async () => {
    setupFixture(async () => response({taskId:'synthetic-task'}), async () => response({status:'error',error:'synthetic unavailable'},503));
    const alert = await screen.findByRole('alert', {}, { timeout: 500 });
    expect(alert.textContent).toContain('synthetic-task');
    expect(alert.textContent).toContain('待核');
    expect(screen.getByRole('button', {name:'生成展陈方案'})).toHaveProperty('disabled', true);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/poll-task')).toHaveLength(1);
  });

  it('rechecks the same task after a temporary status-service error without resubmitting', async () => {
    let polls = 0;
    const add = vi.fn();
    setupFixture(async () => response({taskId:'recoverable-task'}), async () => ++polls === 1
      ? response({status:'error',error:'synthetic unavailable'},503)
      : response({status:'completed',result:{imageUrls:['/synthetic/recovered.png']}}), add);
    expect((await screen.findByRole('alert')).textContent).toContain('recoverable-task');
    fireEvent.click(screen.getByRole('button',{name:'重新查询原任务'}));
    await waitFor(() => expect(add).toHaveBeenCalledWith(['/synthetic/recovered.png'],expect.any(Object)));
    await waitFor(() => expect(screen.getByRole('button',{name:'生成展陈方案'})).toHaveProperty('disabled',false));
    expect(screen.queryByRole('alert')).toBeNull();
    const requests = vi.mocked(fetch).mock.calls;
    expect(requests.filter(([url]) => String(url) === '/api/display-3d/generate')).toHaveLength(1);
    const statusRequests = requests.filter(([url]) => String(url) === '/api/poll-task');
    expect(statusRequests).toHaveLength(2);
    expect(statusRequests.every(([,init]) => JSON.parse(String(init?.body)).taskId === 'recoverable-task')).toBe(true);
  });

  it('keeps a task unconfirmed when a recheck reports completion without an image', async () => {
    let polls = 0;
    const add = vi.fn();
    setupFixture(async () => response({taskId:'missing-result-task'}), async () => ++polls === 1
      ? response({status:'error'},503) : response({status:'completed',result:{}}), add);
    expect((await screen.findByRole('alert')).textContent).toContain('missing-result-task');
    fireEvent.click(screen.getByRole('button',{name:'重新查询原任务'}));
    await waitFor(() => expect(polls).toBe(2));
    expect(screen.getByRole('alert').textContent).toContain('missing-result-task');
    expect(screen.getByRole('button',{name:'生成展陈方案'})).toHaveProperty('disabled',true);
    expect(add).not.toHaveBeenCalled();
  });

  it('coalesces repeated recheck clicks and keeps a still-running task unconfirmed', async () => {
    let releasePoll: (value: Response) => void = () => { throw new Error('recheck was not started'); };
    const pending = new Promise<Response>(resolve => { releasePoll = resolve; });
    let polls = 0;
    setupFixture(async () => response({taskId:'running-task'}), async () => ++polls === 1 ? response({status:'error'},503) : pending);
    await screen.findByRole('alert');
    const button = screen.getByRole('button',{name:'重新查询原任务'});
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(polls).toBe(2));
    releasePoll(response({status:'processing'}));
    await screen.findByRole('button',{name:'重新查询原任务'});
    expect(screen.getByRole('alert').textContent).toContain('running-task');
    expect(screen.getByRole('button',{name:'生成展陈方案'})).toHaveProperty('disabled',true);
    expect(polls).toBe(2);
  });

  it('stops polling and reports a cancelled task without calling it completed', async () => {
    const add = vi.fn();
    setupFixture(async () => response({taskId:'synthetic-task'}), async () => response({status:'cancelled'}), add);
    const alert = await screen.findByRole('alert', {}, { timeout: 500 });
    expect(alert.textContent).toContain('synthetic-task');
    expect(alert.textContent).toContain('已取消');
    expect(screen.getByRole('button', {name:'生成展陈方案'})).toHaveProperty('disabled', false);
    expect(add).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/poll-task')).toHaveLength(1);
  });

  it.each(['任务不存在或已过期，请重新提交', '生成超时', '请求过于频繁，请稍后再试'])(
    'does not present an uncertain task result as a confirmed upstream failure: %s', async (error) => {
    setupFixture(async () => response({taskId:'synthetic-task'}), async () => response({status:'failed',error}));
    expect((await screen.findByRole('alert')).textContent).toContain('任务结果暂无法确认');
    expect(screen.getByRole('alert').textContent).toContain('synthetic-task');
    expect(screen.getByRole('alert').textContent).not.toContain('请重新提交');
    expect(screen.getByRole('alert').textContent).not.toContain('请稍后再试');
  });

  it('treats a non-JSON submission response as an unknown outcome', async () => {
    setupFixture(async () => ({ ok:true, status:200, json:async () => { throw new SyntaxError('synthetic non-JSON response'); } }) as unknown as Response);
    expect((await screen.findByRole('alert')).textContent).toContain('提交结果暂无法确认');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/display-3d/generate')).toHaveLength(1);
  });

  it('still delivers a successfully completed task to the canvas', async () => {
    const add = vi.fn();
    setupFixture(async () => response({taskId:'synthetic-task'}), async () => response({status:'completed',result:{imageUrls:['/synthetic/result.png']}}), add);
    await waitFor(() => expect(add).toHaveBeenCalledWith(['/synthetic/result.png'], expect.any(Object)));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a completed task separately when adding its result to the canvas fails', async () => {
    setupFixture(async () => response({taskId:'synthetic-task'}), async () => response({status:'completed',result:{imageUrls:['/synthetic/result.png']}}), () => { throw new Error('synthetic canvas error'); });
    expect((await screen.findByRole('alert')).textContent).toContain('任务已完成');
    expect(screen.getByRole('alert').textContent).toContain('synthetic-task');
    expect(screen.getByRole('alert').textContent).toContain('未能添加到画布');
  });

  it('waits for asynchronous canvas insertion and reports its rejection as a completed task', async () => {
    let rejectInsert: (reason: Error) => void = () => { throw new Error('insertion was not started'); };
    const pending = new Promise<void>((_resolve, reject) => { rejectInsert = reject; });
    void pending.catch(() => {});
    const add = vi.fn(() => pending);
    setupFixture(async () => response({taskId:'async-insertion-task'}), async () => response({status:'completed',result:{imageUrls:['/synthetic/result.png']}}), add);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', {name:/生成中/})).toHaveProperty('disabled', true);
    const send = screen.getByRole('button', {name:'发送到画布'});
    expect(send).toHaveProperty('disabled', true);
    fireEvent.click(send);
    expect(add).toHaveBeenCalledTimes(1);
    rejectInsert(new Error('synthetic canvas rejection'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('任务已完成');
    expect(alert.textContent).toContain('async-insertion-task');
    expect(alert.textContent).toContain('未能添加到画布');
  });

  it('uses the insertion scope captured when generation began after a project switch', async () => {
    let releasePoll: (value: Response) => void = () => { throw new Error('poll was not started'); };
    const pendingPoll = new Promise<Response>(resolve => { releasePoll = resolve; });
    let scopeActive = true;
    const scopedInsert = vi.fn(async () => { if (!scopeActive) throw new Error('synthetic scope expired'); });
    const capture = vi.fn(() => scopedInsert);
    const fallback = vi.fn();
    setupFixture(async () => response({taskId:'scope-task'}), async () => pendingPoll, fallback, capture);
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    scopeActive = false;
    releasePoll(response({status:'completed',result:{imageUrls:['/synthetic/result.png']}}));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('任务已完成');
    expect(alert.textContent).toContain('未能添加到画布');
    expect(scopedInsert).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not submit a generation when the destination scope cannot be captured', async () => {
    const submit = vi.fn(async () => response({taskId:'should-not-submit'}));
    setupFixture(submit, async () => response({status:'completed',result:{imageUrls:['/synthetic/result.png']}}), vi.fn(), () => { throw new Error('synthetic canvas unavailable'); });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('画布');
    expect(alert.textContent).toContain('未提交');
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'生成展陈方案'})).toHaveProperty('disabled',false);
  });

  it('keeps an earlier proposal visible but does not lock it against changed requirements after a new generation fails', async () => {
    let proposalRuns = 0;
    const lock = vi.fn();
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') {
        Object.defineProperty(this, 'files', { configurable: true, value: [new File(['synthetic'], 'venue.png', { type: 'image/png' })] });
        fireEvent.change(this);
      }
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/models?')) return Promise.resolve(response({providers:[],models:[]}));
      if (url === '/api/activity-venue/analyze') return Promise.resolve(response({taskId:'analysis-task'}));
      if (url === '/api/activity-venue/proposals') return Promise.resolve(response({taskId:`proposal-${++proposalRuns}`}));
      if (url === '/api/activity-venue/lock-design') { lock(); return Promise.resolve(response({designId:{}})); }
      if (url === '/api/poll-task') {
        const taskId = (JSON.parse(String(init?.body)) as {taskId:string}).taskId;
        if (taskId === 'analysis-task') return Promise.resolve(response({status:'completed',result:{analysis:{regions:[],estimatedDimensions:{length:1,width:1,height:1}}}}));
        if (taskId === 'proposal-1') return Promise.resolve(response({status:'completed',result:{proposals:[{id:'old',name:'原方案',concept:'原需求'}]}}));
        if (taskId === 'proposal-2') return Promise.resolve(response({status:'failed',error:'供应商未返回有效方案'}));
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
    render(<Display3DPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    const eventName = await screen.findByPlaceholderText('如：夏季新品发布会');
    fireEvent.change(screen.getByPlaceholderText('品牌名称'),{target:{value:'合成品牌'}});
    fireEvent.change(eventName,{target:{value:'原活动'}});
    fireEvent.click(screen.getByRole('button',{name:'生成 3 套布局方案'}));
    fireEvent.click(await screen.findByRole('button',{name:/原方案/}));
    fireEvent.change(eventName,{target:{value:'新活动'}});
    fireEvent.click(screen.getByRole('button',{name:'生成 3 套布局方案'}));
    expect(await screen.findByText('供应商未返回有效方案')).toBeTruthy();
    expect(screen.getByRole('button',{name:/原方案/})).toBeTruthy();
    const lockButton = screen.queryByRole('button',{name:'锁定为 Design ID'});
    if (lockButton) { expect(lockButton).toHaveProperty('disabled',true); fireEvent.click(lockButton); }
    expect(lock).not.toHaveBeenCalled();
    expect(screen.getByText(/方案.*需求.*变化|需求.*变化.*方案/)).toBeTruthy();
  });

  it('shows a venue analysis with descriptive regions without inventing canvas coordinates', async () => {
    const analysis = {spaceType:'mall_atrium',estimatedDimensions:{length:12000,width:8000,height:4500},lighting:'mixed',regions:[{id:'r1',name:'左侧入口',type:'entrance',position:'左侧入口',estimatedSize:{length:3000,width:2000},notes:''}],structuralLimits:[],designNotes:'合成结果'};
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') {
        Object.defineProperty(this, 'files', { configurable: true, value: [new File(['synthetic'], 'venue.png', { type: 'image/png' })] });
        fireEvent.change(this);
      }
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/models?')) return Promise.resolve(response({providers:[],models:[]}));
      if (url === '/api/activity-venue/analyze') return Promise.resolve(response({taskId:'analysis-task'}));
      if (url === '/api/poll-task') return Promise.resolve(response({status:'completed',result:{analysis}}));
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
    render(<Display3DPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    await screen.findByText(/场馆分析完成/);
    fireEvent.click(screen.getByRole('button',{name:'场馆'}));
    expect(screen.getByText(/3000\s*×\s*2000\s*mm/)).toBeTruthy();
    expect(screen.getByText('位置：左侧入口')).toBeTruthy();
    expect(screen.getByText(/未提供.*坐标/)).toBeTruthy();
  });

  it('does not revive an earlier passing result when a different image is checked after recheck failure', async () => {
    let qcCount = 0;
    let renders = 0;
    const pending = new Promise<Response>(() => {});
    const dimension={score:8,comment:'合成'};
    const passed={passed:true,overallScore:8,dimensions:{brandIdentity:dimension,styleConsistency:dimension,spaceLayout:dimension,materialColor:dimension,overallQuality:dimension},issues:[],suggestions:[],verdict:'旧图质检通过'};
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') {
        Object.defineProperty(this, 'files', { configurable:true, value:[new File(['synthetic'],'venue.png',{type:'image/png'})] });
        fireEvent.change(this);
      }
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/models?')) return Promise.resolve(response({providers:[],models:[]}));
      if (url === '/api/activity-venue/analyze') return Promise.resolve(response({taskId:'analysis-task'}));
      if (url === '/api/activity-venue/proposals') return Promise.resolve(response({taskId:'proposal-task'}));
      if (url === '/api/activity-venue/lock-design') return Promise.resolve(response({designId:{brandName:'合成品牌',theme:'合成主题',version:'v1',lockedFields:{concept:'合成概念',layout:{},materials:[],colors:{}}}}));
      if (url === '/api/display-3d/generate') return Promise.resolve(response({taskId:`render-${++renders}`}));
      if (url === '/api/activity-venue/qc') return Promise.resolve(response({taskId:`qc-${++qcCount}`}));
      if (url === '/api/poll-task') {
        const taskId = (JSON.parse(String(init?.body)) as {taskId:string}).taskId;
        if (taskId === 'analysis-task') return Promise.resolve(response({status:'completed',result:{analysis:{regions:[],estimatedDimensions:{length:1,width:1,height:1}}}}));
        if (taskId === 'proposal-task') return Promise.resolve(response({status:'completed',result:{proposals:[{id:'proposal-a',name:'合成方案',concept:'合成概念'}]}}));
        if (taskId.startsWith('render-')) return Promise.resolve(response({status:'completed',result:{imageUrls:[`/synthetic/${taskId}.png`]}}));
        if (taskId === 'qc-1') return Promise.resolve(response({status:'completed',result:{qcResult:passed}}));
        if (taskId === 'qc-2') return Promise.resolve(response({status:'failed',error:'重检失败'}));
        if (taskId === 'qc-3') return pending;
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
    render(<Display3DPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    fireEvent.change(await screen.findByPlaceholderText('品牌名称'),{target:{value:'合成品牌'}});
    fireEvent.change(screen.getByPlaceholderText('如：夏季新品发布会'),{target:{value:'合成活动'}});
    fireEvent.click(screen.getByRole('button',{name:'生成 3 套布局方案'}));
    fireEvent.click(await screen.findByRole('button',{name:/合成方案/}));
    fireEvent.click(await screen.findByRole('button',{name:'锁定为 Design ID'}));
    fireEvent.click(await screen.findByRole('button',{name:'生成效果图'}));
    await screen.findByText('版本历史 (1)');
    fireEvent.click(screen.getByRole('button',{name:'AI 质检'}));
    await waitFor(() => expect(screen.getByText(/v1 · v1/).parentElement?.textContent).toContain('通过'));
    fireEvent.click(screen.getByRole('button',{name:'AI 质检'}));
    await screen.findByText('重检失败');
    expect(screen.getByText(/v1 · v1/).parentElement?.textContent).not.toContain('通过');
    fireEvent.click(screen.getByRole('button',{name:'生成效果图'}));
    await screen.findByText('版本历史 (2)');
    fireEvent.click(screen.getByRole('button',{name:'AI 质检'}));
    await waitFor(() => expect(qcCount).toBe(3));
    expect(screen.getByText(/v1 · v1/).parentElement?.textContent).not.toContain('通过');
    const originalCard = screen.getByText(/v1 · v1/).parentElement?.parentElement;
    expect(originalCard).toBeTruthy();
    const summary = within(originalCard!).getByText('查看上次质检结果');
    fireEvent.click(summary);
    expect(summary.parentElement).toHaveProperty('open', true);
    expect(within(originalCard!).getByText('上次结论：通过')).toBeTruthy();
    expect(within(originalCard!).getByText('旧图质检通过')).toBeTruthy();
    expect(within(originalCard!).getByText('本次重检尚未取得有效结果，下方为上次记录。')).toBeTruthy();
  });

  it('keeps a late quality result on its original image after a newer image is generated', async () => {
    let releaseQc: (value: Response) => void = () => { throw new Error('quality poll missing'); };
    const pendingQc = new Promise<Response>(resolve => { releaseQc = resolve; });
    let renders = 0;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') {
        Object.defineProperty(this, 'files', { configurable:true, value:[new File(['synthetic'],'venue.png',{type:'image/png'})] });
        fireEvent.change(this);
      }
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/models?')) return Promise.resolve(response({providers:[],models:[]}));
      if (url === '/api/activity-venue/analyze') return Promise.resolve(response({taskId:'analysis-task'}));
      if (url === '/api/activity-venue/proposals') return Promise.resolve(response({taskId:'proposal-task'}));
      if (url === '/api/activity-venue/lock-design') return Promise.resolve(response({designId:{brandName:'合成品牌',theme:'合成主题',version:'v1',lockedFields:{concept:'合成概念',layout:{},materials:[],colors:{}}}}));
      if (url === '/api/display-3d/generate') return Promise.resolve(response({taskId:`render-${++renders}`}));
      if (url === '/api/activity-venue/qc') return Promise.resolve(response({taskId:'qc-old'}));
      if (url === '/api/poll-task') {
        const taskId = (JSON.parse(String(init?.body)) as {taskId:string}).taskId;
        if (taskId === 'analysis-task') return Promise.resolve(response({status:'completed',result:{analysis:{regions:[],estimatedDimensions:{length:1,width:1,height:1}}}}));
        if (taskId === 'proposal-task') return Promise.resolve(response({status:'completed',result:{proposals:[{id:'proposal-a',name:'合成方案',concept:'合成概念'}]}}));
        if (taskId.startsWith('render-')) return Promise.resolve(response({status:'completed',result:{imageUrls:[`/synthetic/${taskId}.png`]}}));
        if (taskId === 'qc-old') return pendingQc;
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
    render(<Display3DPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    fireEvent.change(await screen.findByPlaceholderText('品牌名称'),{target:{value:'合成品牌'}});
    fireEvent.change(screen.getByPlaceholderText('如：夏季新品发布会'),{target:{value:'合成活动'}});
    fireEvent.click(screen.getByRole('button',{name:'生成 3 套布局方案'}));
    fireEvent.click(await screen.findByRole('button',{name:/合成方案/}));
    fireEvent.click(await screen.findByRole('button',{name:'锁定为 Design ID'}));
    fireEvent.click(await screen.findByRole('button',{name:'生成效果图'}));
    await screen.findByText('版本历史 (1)');
    fireEvent.click(screen.getByRole('button',{name:'AI 质检'}));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/poll-task',expect.objectContaining({body:JSON.stringify({taskId:'qc-old'})})));
    fireEvent.click(screen.getByRole('button',{name:'生成效果图'}));
    await screen.findByText('版本历史 (2)');
    const dimension={score:8,comment:'合成'};
    await act(async () => { releaseQc(response({status:'completed',result:{qcResult:{passed:true,overallScore:8,dimensions:{brandIdentity:dimension,styleConsistency:dimension,spaceLayout:dimension,materialColor:dimension,overallQuality:dimension},issues:[],suggestions:[],verdict:'旧图质检通过'}}})); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText(/v1 · v1/).parentElement?.textContent).toContain('通过'));
    expect(screen.getByText(/v2 · v1/).parentElement?.textContent).not.toContain('通过');
    expect(screen.queryByText('旧图质检通过')).toBeNull();
    expect(screen.queryByText(/质检通过 \(综合评分/)).toBeNull();
  });

  it('reports a completed venue render separately when canvas insertion fails', async () => {
    let releaseVenue: (value: Response) => void = () => { throw new Error('venue poll was not started'); };
    const pendingVenue = new Promise<Response>(resolve => { releaseVenue = resolve; });
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') {
        Object.defineProperty(this, 'files', { configurable: true, value: [new File(['synthetic'], 'venue.png', { type: 'image/png' })] });
        fireEvent.change(this);
      }
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/models?')) return Promise.resolve(response({providers:[],models:[]}));
      if (url === '/api/activity-venue/analyze') return Promise.resolve(response({taskId:'analysis-task'}));
      if (url === '/api/activity-venue/proposals') return Promise.resolve(response({taskId:'proposal-task'}));
      if (url === '/api/activity-venue/lock-design') return Promise.resolve(response({designId:{brandName:'合成品牌',theme:'合成主题',version:'v1',lockedFields:{concept:'合成概念',layout:{},materials:[],colors:{}}}}));
      if (url === '/api/display-3d/generate') return Promise.resolve(response({taskId:'venue-render-task'}));
      if (url === '/api/poll-task') {
        const taskId = (JSON.parse(String(init?.body)) as {taskId:string}).taskId;
        if (taskId === 'analysis-task') return Promise.resolve(response({status:'completed',result:{analysis:{regions:[],estimatedDimensions:{length:1,width:1,height:1}}}}));
        if (taskId === 'proposal-task') return Promise.resolve(response({status:'completed',result:{proposals:[{id:'proposal-a',name:'合成方案',concept:'合成概念'}]}}));
        if (taskId === 'venue-render-task') return pendingVenue;
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
    render(<Display3DPanel onClose={() => {}} onAddImages={() => { throw new Error('synthetic canvas error'); }} />);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    fireEvent.change(await screen.findByPlaceholderText('品牌名称'),{target:{value:'合成品牌'}});
    fireEvent.change(screen.getByPlaceholderText('如：夏季新品发布会'),{target:{value:'合成活动'}});
    fireEvent.click(screen.getByRole('button',{name:'生成 3 套布局方案'}));
    fireEvent.click(await screen.findByRole('button',{name:/合成方案/}));
    fireEvent.click(await screen.findByRole('button',{name:'锁定为 Design ID'}));
    fireEvent.click(await screen.findByRole('button',{name:'生成效果图'}));
    fireEvent.click(screen.getByRole('button',{name:'展陈设计'}));
    expect(screen.getByRole('button',{name:'生成展陈方案'})).toHaveProperty('disabled',true);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    releaseVenue(response({status:'completed',result:{imageUrls:['/synthetic/venue.png']}}));
    const message = await screen.findByText(/任务已完成/, {}, {timeout:500});
    expect(message.textContent).toContain('venue-render-task');
    expect(message.textContent).toContain('未能添加到画布');
    expect(screen.getByRole('button',{name:'生成效果图'})).toHaveProperty('disabled',false);
    expect(screen.queryByText(/结果待核/)).toBeNull();
  });

  it.each([
    { kind:'valid image', images:['/synthetic/old-venue.png'], message:/原场馆.*已完成/, remainsUnconfirmed:false },
    { kind:'missing image', images:[] as string[], message:/结果待核/, remainsUnconfirmed:true },
  ])('does not insert $kind after the user removes the original venue', async ({images,message,remainsUnconfirmed}) => {
    let releaseVenue: (value: Response) => void = () => { throw new Error('venue poll was not started'); };
    const pendingVenue = new Promise<Response>(resolve => { releaseVenue = resolve; });
    const add = vi.fn();
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') {
        Object.defineProperty(this, 'files', { configurable: true, value: [new File(['synthetic'], 'venue.png', { type: 'image/png' })] });
        fireEvent.change(this);
      }
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/models?')) return Promise.resolve(response({providers:[],models:[]}));
      if (url === '/api/activity-venue/analyze') return Promise.resolve(response({taskId:'analysis-old'}));
      if (url === '/api/activity-venue/proposals') return Promise.resolve(response({taskId:'proposal-old'}));
      if (url === '/api/activity-venue/lock-design') return Promise.resolve(response({designId:{brandName:'合成品牌',theme:'合成主题',version:'v1',lockedFields:{concept:'合成概念',layout:{},materials:[],colors:{}}}}));
      if (url === '/api/display-3d/generate') return Promise.resolve(response({taskId:'old-venue-render'}));
      if (url === '/api/poll-task') {
        const taskId = (JSON.parse(String(init?.body)) as {taskId:string}).taskId;
        if (taskId === 'analysis-old') return Promise.resolve(response({status:'completed',result:{analysis:{regions:[],estimatedDimensions:{length:1,width:1,height:1}}}}));
        if (taskId === 'proposal-old') return Promise.resolve(response({status:'completed',result:{proposals:[{id:'old-proposal',name:'原方案',concept:'原概念'}]}}));
        if (taskId === 'old-venue-render') return pendingVenue;
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
    render(<Display3DPanel onClose={() => {}} onAddImages={add} />);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    fireEvent.change(await screen.findByPlaceholderText('品牌名称'),{target:{value:'合成品牌'}});
    fireEvent.change(screen.getByPlaceholderText('如：夏季新品发布会'),{target:{value:'合成活动'}});
    fireEvent.click(screen.getByRole('button',{name:'生成 3 套布局方案'}));
    fireEvent.click(await screen.findByRole('button',{name:/原方案/}));
    fireEvent.click(await screen.findByRole('button',{name:'锁定为 Design ID'}));
    fireEvent.click(await screen.findByRole('button',{name:'生成效果图'}));
    const venueImage = document.querySelector('img[src^="data:image/"]');
    const removeButton = venueImage?.parentElement?.querySelector('button');
    expect(removeButton).toBeTruthy();
    fireEvent.click(removeButton!);
    releaseVenue(response({status:'completed',result:{imageUrls:images}}));
    expect((await screen.findByText(message)).textContent).toContain('old-venue-render');
    if (remainsUnconfirmed) expect(screen.getByRole('button',{name:'重新查询原任务'})).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'发送到画布'})).toBeNull();
  });

  it.each(['analysis','proposals','lock'] as const)('ignores a late %s response after the venue is removed', async phase => {
    let release: (value: Response) => void = () => { throw new Error('request was not started'); };
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const analysis = {regions:[],estimatedDimensions:{length:1,width:1,height:1}};
    const proposal = {id:'stale-proposal',name:'旧场馆方案',concept:'旧概念'};
    const designId = {brandName:'合成品牌',theme:'旧主题',version:'old-v1',lockedFields:{concept:'旧概念',layout:{},materials:[],colors:{}}};
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') {
        Object.defineProperty(this, 'files', { configurable: true, value: [new File(['synthetic'], 'venue.png', { type: 'image/png' })] });
        fireEvent.change(this);
      }
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/models?')) return Promise.resolve(response({providers:[],models:[]}));
      if (url === '/api/activity-venue/analyze') return Promise.resolve(response({taskId:'late-analysis'}));
      if (url === '/api/activity-venue/proposals') return Promise.resolve(response({taskId:'late-proposals'}));
      if (url === '/api/activity-venue/lock-design') return phase === 'lock' ? pending : Promise.resolve(response({designId}));
      if (url === '/api/poll-task') {
        const taskId = (JSON.parse(String(init?.body)) as {taskId:string}).taskId;
        if (taskId === 'late-analysis') return phase === 'analysis' ? pending : Promise.resolve(response({status:'completed',result:{analysis}}));
        if (taskId === 'late-proposals') return phase === 'proposals' ? pending : Promise.resolve(response({status:'completed',result:{proposals:[proposal]}}));
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
    render(<Display3DPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    if (phase !== 'analysis') {
      fireEvent.change(await screen.findByPlaceholderText('品牌名称'),{target:{value:'合成品牌'}});
      fireEvent.change(screen.getByPlaceholderText('如：夏季新品发布会'),{target:{value:'合成活动'}});
      fireEvent.click(screen.getByRole('button',{name:'生成 3 套布局方案'}));
    }
    if (phase === 'lock') {
      fireEvent.click(await screen.findByRole('button',{name:/旧场馆方案/}));
      fireEvent.click(await screen.findByRole('button',{name:'锁定为 Design ID'}));
    }
    const image = document.querySelector('img[src^="data:image/"]');
    const remove = image?.parentElement?.querySelector('button');
    expect(remove).toBeTruthy();
    fireEvent.click(remove!);
    await act(async () => {
      release(phase === 'analysis' ? response({status:'completed',result:{analysis}})
        : phase === 'proposals' ? response({status:'completed',result:{proposals:[proposal]}}) : response({designId}));
      await Promise.resolve();
    });
    expect(screen.queryByPlaceholderText('如：夏季新品发布会')).toBeNull();
    expect(screen.queryByText('旧场馆方案')).toBeNull();
    expect(screen.queryByText(/DesignID: old-v1/)).toBeNull();
    expect(screen.queryByRole('button',{name:'生成效果图'})).toBeNull();
  });

  it('does not let an old venue analysis keep or clear a newer analysis loading state', async () => {
    let releaseOld: (value: Response) => void = () => { throw new Error('old analysis missing'); };
    let releaseNew: (value: Response) => void = () => { throw new Error('new analysis missing'); };
    const oldPoll = new Promise<Response>(resolve => { releaseOld = resolve; });
    const newPoll = new Promise<Response>(resolve => { releaseNew = resolve; });
    let submissions = 0;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') {
        Object.defineProperty(this, 'files', { configurable: true, value: [new File(['synthetic'], 'venue.png', { type: 'image/png' })] });
        fireEvent.change(this);
      }
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/models?')) return Promise.resolve(response({providers:[],models:[]}));
      if (url === '/api/activity-venue/analyze') return Promise.resolve(response({taskId:++submissions === 1 ? 'old-analysis' : 'new-analysis'}));
      if (url === '/api/poll-task') return (JSON.parse(String(init?.body)) as {taskId:string}).taskId === 'old-analysis' ? oldPoll : newPoll;
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
    render(<Display3DPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button',{name:'活动现场'}));
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    await waitFor(() => expect(submissions).toBe(1));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/poll-task', expect.objectContaining({body:JSON.stringify({taskId:'old-analysis'})})));
    const remove = document.querySelector('img[src^="data:image/"]')?.parentElement?.querySelector('button');
    expect(remove).toBeTruthy();
    fireEvent.click(remove!);
    fireEvent.click(screen.getByRole('button',{name:/点击上传场馆照片/}));
    fireEvent.click(await screen.findByRole('button',{name:'AI 分析场馆'}));
    await waitFor(() => expect(submissions).toBe(2));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/poll-task', expect.objectContaining({body:JSON.stringify({taskId:'new-analysis'})})));
    const oldResponse = response({status:'completed',result:{analysis:{regions:[]}}});
    const oldJson = vi.spyOn(oldResponse, 'json');
    await act(async () => { releaseOld(oldResponse); await Promise.resolve(); });
    await waitFor(() => expect(oldJson).toHaveBeenCalled());
    expect(screen.getByRole('button',{name:/AI 分析中/})).toHaveProperty('disabled',true);
    await act(async () => { releaseNew(response({status:'completed',result:{analysis:{regions:[]}}})); await Promise.resolve(); });
    expect(await screen.findByRole('button',{name:'重新分析'})).toHaveProperty('disabled',false);
  });

  it('keeps the prior preview when a later completed result cannot be added to the canvas', async () => {
    const add = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('synthetic canvas error'); });
    let pollCount = 0;
    setupFixture(async () => response({taskId:`synthetic-${pollCount + 1}`}), async () => response({status:'completed',result:{imageUrls:[`/synthetic/result-${++pollCount}.png`]}}), add);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name:'生成展陈方案'}));
    expect((await screen.findByRole('alert')).textContent).toContain('任务已完成');
    const preview = screen.getByRole('img');
    expect(preview.getAttribute('src')).toBe('/synthetic/result-1.png');
    expect(screen.getByRole('alert').textContent).not.toContain('在展陈预览中查看结果');
  });
});
