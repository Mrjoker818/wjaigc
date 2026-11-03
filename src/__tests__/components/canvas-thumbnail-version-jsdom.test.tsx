// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasImage, InfiniteCanvas as InfiniteCanvasType } from '@/components/infinite-canvas';
import { installJsdomMediaQueries, runJsdomFixtureCleanup } from '../helpers/jsdom-browser-apis';

// The client fixture has no reason to load server database modules.
vi.mock('pg', () => { throw Error('CANVAS_THUMBNAIL_DATABASE_FORBIDDEN'); });
vi.mock('@/lib/db-client', () => { throw Error('CANVAS_THUMBNAIL_DATABASE_FORBIDDEN'); });
vi.mock('@/lib/db-storage', () => { throw Error('CANVAS_THUMBNAIL_DATABASE_FORBIDDEN'); });
vi.mock('@/lib/server-data-root', () => { throw Error('CANVAS_THUMBNAIL_DATA_ROOT_FORBIDDEN'); });
let InfiniteCanvas: typeof InfiniteCanvasType;

// jsdom never fetches/decodes these images. Probe completion and DOM events are
// explicitly driven; native 404/decode ordering remains a browser test boundary.
class ControlledProbe {
  static all: ControlledProbe[] = [];
  src = '';
  decoding = 'async';
  naturalWidth = 64;
  naturalHeight = 64;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { ControlledProbe.all.push(this); }
  decode(): Promise<void> { return Promise.resolve(); }
}

const first: CanvasImage = {
  id: 'image-a', url: '/uploads/a.png', thumbnailUrl: '/thumb-a.png',
  assetId: 'asset-a', assetVersionId: 'version-a', mediaAvailability: 'ready',
  x: 20, y: 20, width: 64, height: 64, rotation: 0, zIndex: 1, createdAt: 1,
};
const second: CanvasImage = { ...first, url: '/uploads/b.png', thumbnailUrl: '/thumb-b.png', assetVersionId: 'version-b' };
let changeImage: ((image: CanvasImage) => void) | undefined;
let restoreMedia = (): void => {};
let unexpected: string[] = [];

function Fixture(): React.JSX.Element {
  const [images, setImages] = useState<CanvasImage[]>([first]);
  useEffect(() => {
    changeImage = image => setImages([image]);
    return () => { changeImage = undefined; };
  }, []);
  return <InfiniteCanvas images={images} onImagesChange={setImages} selectedImage={null}
    onSelectImage={() => undefined} onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
    onRequestTaskPoll={async ():Promise<Response> => { throw Error('unexpected task poll'); }}
    onFusion={() => undefined} onAddImages={() => undefined}
    projectId="synthetic-project" initialViewState={{offsetX:0,offsetY:0,zoom:0.5}} />;
}

async function mount(): Promise<ReturnType<typeof render>> {
  let view!: ReturnType<typeof render>;
  await act(async () => { view=render(<Fixture />); for(let i=0;i<10;i++)await Promise.resolve(); });
  return view;
}

function image(container: HTMLElement): HTMLImageElement {
  const element = container.querySelector<HTMLImageElement>('[data-canvas-media-node="image-a"]');
  if (!element) throw Error('expected mounted real canvas media');
  return element;
}
async function switchVersion(): Promise<void> {
  if (!changeImage) throw Error('missing synthetic parent setter');
  await act(async () => { changeImage!(second); });
  await waitFor(() => expect(ControlledProbe.all.some(p => p.src === '/thumb-b.png')).toBe(true));
}
async function failProbe(source: string): Promise<void> {
  const probe = ControlledProbe.all.findLast(p => p.src === source);
  if (!probe?.onerror) throw Error(`missing probe for ${source}`);
  await act(async () => { probe.onerror!(); });
}
function src(element: HTMLImageElement): string { return new URL(element.src).pathname; }

beforeEach(async () => {
  ControlledProbe.all = []; unexpected = []; changeImage = undefined;
  restoreMedia = installJsdomMediaQueries(window, {colorScheme:'dark',reducedMotion:true});
  vi.spyOn(net.Socket.prototype,'connect').mockImplementation(() => { throw Error('CANVAS_THUMBNAIL_NETWORK_FORBIDDEN'); });
  vi.spyOn(dgram,'createSocket').mockImplementation(() => { throw Error('CANVAS_THUMBNAIL_NETWORK_FORBIDDEN'); });
  vi.spyOn(dns,'lookup').mockImplementation(() => { throw Error('CANVAS_THUMBNAIL_NETWORK_FORBIDDEN'); });
  vi.stubGlobal('Image', ControlledProbe);
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  const storage = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k),clear:()=>storage.clear()});
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url=new URL(String(input),'http://localhost:3000');
    const key=url.pathname+url.search;
    if(url.origin==='http://localhost:3000' && (!init?.method || init.method==='GET') &&
      ['/api/upscayl','/api/models?type=upscaler','/api/models?type=removebg','/api/models?type=3d','/api/session'].includes(key)) {
      return Promise.resolve(new Response(JSON.stringify(key==='/api/session'?{success:false}:{success:true,available:false,models:[],providers:[]}),{status:200,headers:{'Content-Type':'application/json'}}));
    }
    unexpected.push(`${init?.method ?? 'GET'} ${url.href}`); return Promise.reject(new Error('unexpected fetch in isolated canvas test'));
  });
  vi.stubGlobal('EventSource', class { constructor(url: string) { unexpected.push(`EventSource:${url}`); throw Error('unexpected EventSource'); } });
  vi.stubGlobal('WebSocket', class { constructor(url: string) { unexpected.push(`WebSocket:${url}`); throw Error('unexpected WebSocket'); } });
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(() => ({x:0,y:0,left:0,top:0,right:390,bottom:844,width:390,height:844,toJSON:()=>({})}));
  ({ InfiniteCanvas } = await import('@/components/infinite-canvas'));
});
afterEach(() => runJsdomFixtureCleanup([
  () => cleanup(),
  () => { expect(unexpected).toEqual([]); },
  () => restoreMedia(),
  () => vi.restoreAllMocks(),
  () => vi.unstubAllGlobals(),
]));

describe('canvas thumbnail retry per asset version', () => {
  it('rejects an unlisted request instead of contacting it', async () => {
    await expect(fetch('https://outside.invalid/unknown')).rejects.toThrow('unexpected fetch');
    expect(unexpected).toEqual(['GET https://outside.invalid/unknown']);
    unexpected = [];
  });
  it('rejects server database imports from the client fixture', async () => {
    await expect(import('@/lib/db-client')).rejects.toMatchObject({cause:{message:'CANVAS_THUMBNAIL_DATABASE_FORBIDDEN'}});
    await expect(import('@/lib/server-data-root')).rejects.toMatchObject({cause:{message:'CANVAS_THUMBNAIL_DATA_ROOT_FORBIDDEN'}});
    const socket=new net.Socket();
    try {expect(() => socket.connect(1,'127.0.0.1')).toThrow('CANVAS_THUMBNAIL_NETWORK_FORBIDDEN');}
    finally {socket.destroy();}
  });
  it('retries the first thumbnail error without replacing the original', async () => {
    const view = await mount(); const el=image(view.container);
    expect(src(el)).toBe('/thumb-a.png'); fireEvent.error(el);
    expect(new URL(el.src).searchParams.get('__wujie_thumbnail_retry')).toBe('1');
    expect(src(el)).toBe('/thumb-a.png');
  });
  it('falls back to the same original only after a second failure', async () => {
    const view = await mount(); const el=image(view.container);
    fireEvent.error(el);
    expect(src(el)).toBe('/thumb-a.png');
    expect(new URL(el.src).searchParams.get('__wujie_thumbnail_retry')).toBe('1');
    fireEvent.error(el);
    expect(src(el)).toBe('/uploads/a.png');
    expect(el.dataset.canvasMediaSource).toBe('original');
  });
  it('retries the new version independently after the old retry', async () => {
    const view=await mount(); fireEvent.error(image(view.container));
    expect(new URL(image(view.container).src).searchParams.get('__wujie_thumbnail_retry')).toBe('1');
    await switchVersion(); await failProbe('/thumb-b.png');
    const el=image(view.container); fireEvent.error(el);
    expect(src(el)).toBe('/thumb-b.png');
    expect(new URL(el.src).searchParams.get('__wujie_thumbnail_retry')).toBe('1');
  });
  it('does not allow a late old error to consume the new retry', async () => {
    const view=await mount(); const old=image(view.container);
    await switchVersion(); fireEvent.error(old); await failProbe('/thumb-b.png');
    const current=image(view.container); fireEvent.error(current);
    expect(src(current)).toBe('/thumb-b.png');
    expect(new URL(current.src).searchParams.get('__wujie_thumbnail_retry')).toBe('1');
  });
  it('keeps the old node during the pending transition and commits the new source', async () => {
    const view=await mount(); const old=image(view.container);
    Object.defineProperties(old,{naturalWidth:{configurable:true,value:64},naturalHeight:{configurable:true,value:64}});
    await act(async () => {fireEvent.load(old); await Promise.resolve();});
    await waitFor(()=>expect(old.getAttribute('data-canvas-media-state')).toBe('ready'));
    await switchVersion(); expect(image(view.container)).toBe(old); expect(src(old)).toBe('/thumb-a.png');
    const probe=ControlledProbe.all.findLast(p=>p.src==='/thumb-b.png');
    if (!probe?.onload) throw Error('missing new source probe');
    await act(async () => {probe.onload!(); await Promise.resolve();});
    expect(src(image(view.container))).toBe('/thumb-b.png');
  });
});
