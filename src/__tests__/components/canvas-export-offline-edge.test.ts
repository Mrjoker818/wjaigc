// @vitest-environment node
// Offline installed Edge; no application server, account, database or provider.
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createCanvas } from '@napi-rs/canvas';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Keep this explicit proof out of ordinary unit runs on machines without Edge.
describe.runIf(process.env.WUJIE_CANVAS_EXPORT_EDGE_PROOF === '1')('offline installed Edge export proof', () => {

let browser: Browser;
let context: BrowserContext;
let page: Page;
let bundle: string;
let jpeg: Buffer;
const network: string[] = [];
const errors: string[] = [];

beforeAll(async () => {
  jpeg = process.env.WUJIE_CANVAS_EXPORT_FIXTURE
    ? await readFile(process.env.WUJIE_CANVAS_EXPORT_FIXTURE)
    : createCanvas(600, 900).toBuffer('image/jpeg');
  const compiled = await build({ write: false, bundle: true, platform: 'browser', format: 'iife',
    tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {loadCanvasPngBlob} from '@/lib/canvas-png-export';
      import {CanvasDownloadPopup} from '@/lib/canvas-download-popup';
      const proof = { convert: loadCanvasPngBlob, canvasWheel: 0, mount() {
        function Panel() {
          const [svg, setSvg] = useState(false);
          return <div onWheel={() => proof.canvasWheel++}>
            <CanvasDownloadPopup anchor={{left: 600, top: 282, transform: 'translate(-50%, -100%)'}}
              viewportElement={document.getElementById('canvas-viewport')}>
              <div style={{minHeight: svg ? 440 : 270, background: '#1e1e1e', color: 'white'}}>
                <button onClick={() => setSvg(true)}>SVG 格式</button>
                {svg && <div style={{height: 340}}>矢量化模式</div>}
                <button>确认下载</button>
              </div>
            </CanvasDownloadPopup>
          </div>;
        }
        createRoot(document.getElementById('root')).render(<Panel/>);
      }};
      window.exportProof = proof;
    ` } });
  bundle = compiled.outputFiles[0].text;
  browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  console.log('OFFLINE_EDGE', browser.version(), 'JPEG fixture:', process.env.WUJIE_CANVAS_EXPORT_FIXTURE ? 'original reproduction file' : 'native codec fixture');
}, 30000);

beforeEach(async () => {
  network.length = 0; errors.length = 0;
  context = await browser.newContext({ viewport: { width: 1920, height: 1040 }, offline: true, serviceWorkers: 'block' });
  await context.route('**/*', async route => { network.push(route.request().url()); await route.abort(); });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.setContent(`<style>
    body { margin:0; overflow:hidden; }
    #header { position:absolute; left:0; top:0; right:0; height:96px; }
    #canvas-viewport { position:absolute; left:24px; top:96px; width:calc(100vw - 48px); height:calc(100vh - 140px); }
    @media(max-width:767px) { #canvas-viewport { left:0; top:64px; width:100vw; height:calc(100vh - 64px); } }
    button { min-height:44px; }
  </style><div id="header">Project header</div><div id="canvas-viewport"></div><div id="root"></div>`);
  await page.addScriptTag({ content: bundle });
});

afterEach(async () => {
  try { expect(network).toEqual([]); expect(errors).toEqual([]); }
  finally { await context?.close(); }
});
afterAll(async () => { await browser?.close(); });

it('encodes the 600x900 JPEG bytes to PNG using native Edge decoding and toBlob', async () => {
  expect(Array.from(jpeg.subarray(0, 2))).toEqual([255, 216]);
  // Deliberately reproduce the false .png/MIME label as well as the JPEG body.
  const result = await page.evaluate(async source => {
    const proof = (window as unknown as { exportProof: { convert(source: string): Promise<Blob> } }).exportProof;
    const png = await proof.convert(source);
    const bytes = new Uint8Array(await png.arrayBuffer());
    const decoded = await createImageBitmap(png);
    const result = { mime: png.type, signature: Array.from(bytes.slice(0, 8)), width: decoded.width, height: decoded.height };
    decoded.close(); return result;
  }, `data:image/png;base64,${jpeg.toString('base64')}`);
  expect(result).toEqual({ mime: 'image/png', signature: [137, 80, 78, 71, 13, 10, 26, 10], width: 600, height: 900 });
});

it('preserves native dimensions and transparent, partial-alpha, and opaque pixels in Edge', async () => {
  const result = await page.evaluate(async () => {
    const proof = (window as unknown as { exportProof: { convert(source: string): Promise<Blob> } }).exportProof;
    const source = document.createElement('canvas'); source.width = 3; source.height = 2;
    const context = source.getContext('2d')!;
    context.fillStyle = 'rgba(255,0,0,0.5)'; context.fillRect(1, 0, 1, 1);
    context.fillStyle = 'rgb(0,255,0)'; context.fillRect(2, 0, 1, 1);
    const original = Array.from(context.getImageData(0, 0, 3, 1).data);
    const png = await proof.convert(source.toDataURL('image/png'));
    const decoded = await createImageBitmap(png);
    const output = document.createElement('canvas'); output.width = decoded.width; output.height = decoded.height;
    const target = output.getContext('2d')!; target.drawImage(decoded, 0, 0);
    const result = { width: decoded.width, height: decoded.height, original,
      output: Array.from(target.getImageData(0, 0, 3, 1).data) };
    decoded.close(); return result;
  });
  expect([result.width, result.height]).toEqual([3, 2]);
  expect(result.original).toEqual([0, 0, 0, 0, 255, 0, 0, 128, 0, 255, 0, 255]);
  expect(result.output).toEqual(result.original);
});

it('keeps SVG expansion below the header and scrolls a small viewport without canvas wheel events', async () => {
  await page.evaluate(() => (window as unknown as { exportProof: { mount(): void } }).exportProof.mount());
  const panel = page.locator('[data-popup="download"]');
  await panel.getByRole('button', { name: 'SVG 格式' }).click();
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeGreaterThanOrEqual(112);
  let bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(40);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1880);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(980);
  await page.setViewportSize({ width: 390, height: 420 });
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(300);
  bounds = (await panel.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(80);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(308);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(374);
  await panel.hover(); await page.mouse.wheel(0, 200);
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { exportProof: { canvasWheel: number } }).exportProof.canvasWheel)).toBe(0);
});
});
