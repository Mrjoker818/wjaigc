import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileSketchHtml, SKETCH_PREVIEW_SANDBOX } from '@/lib/sketch-to-code/html';

// Isolated browser boundary, not the application UI or Coze acceptance.
describe('sketch HTML in a real sandboxed browser', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 30000);
  afterAll(async () => { await browser?.close(); });

  it('renders the compiled tree in an opaque frame and downloads identical UTF-8 bytes', async () => {
    const html = compileSketchHtml({ type: 'container', style: { display: 'flex', flexDirection: 'column', gap: 16 }, children: [
      { type: 'heading', text: '创作工作台', level: 1 },
      { type: 'input', placeholder: '项目名称', value: '无界' },
      { type: 'button', text: '开始创作' },
    ] });
    await page.setContent('<html><body><iframe title="安全预览"></iframe><a download="sketch.html">下载HTML</a></body></html>');
    await page.evaluate(({ html, sandbox }: { html: string; sandbox: string }): void => {
      const frame = document.querySelector('iframe')!;
      frame.setAttribute('sandbox', sandbox);
      frame.srcdoc = html;
      document.querySelector('a')!.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    }, { html, sandbox: SKETCH_PREVIEW_SANDBOX });
    expect(await page.locator('iframe').getAttribute('sandbox')).toBe('');
    const preview = page.frameLocator('iframe');
    await preview.getByRole('heading', { name: '创作工作台' }).waitFor();
    expect(await preview.getByPlaceholder('项目名称').inputValue()).toBe('无界');
    const frame = page.frames().find((candidate) => candidate.parentFrame() !== null)!;
    expect(await frame.evaluate((): boolean => {
      try { void parent.document.body; return false; } catch (error: unknown) { return error instanceof DOMException && error.name === 'SecurityError'; }
    })).toBe(true);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载HTML' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).equals(Buffer.from(html, 'utf8'))).toBe(true);
    await page.evaluate((): void => URL.revokeObjectURL(document.querySelector('a')!.href));
  }, 30000);

  it('blocks controlled script, external resource and form canaries; an unsandboxed control executes', async () => {
    const externalRequests: string[] = [];
    const routedRequests: string[] = [];
    const failedRequests: { url: string; error: string | undefined }[] = [];
    const listener = (request: { url(): string }): void => {
      if (request.url().startsWith('https://sketch-canary.invalid')) externalRequests.push(request.url());
    };
    const failureListener = (request: { url(): string; failure(): { errorText: string } | null }): void => {
      failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
    };
    page.on('request', listener);
    page.on('requestfailed', failureListener);
    await page.route('https://sketch-canary.invalid/**', (route) => { routedRequests.push(route.request().url()); return route.abort(); });
    try {
      const script = '<script>window.__sketchCanary=true</script>';
      const safeHtml = compileSketchHtml({ type: 'text', text: '安全内容' });
      // Deliberate test-only corruption probes both defenses; never returned to the product.
      const canaryHtml = safeHtml.replace('</main>', `${script}<img src="https://sketch-canary.invalid/pixel"><form action="https://sketch-canary.invalid/submit"><button>尝试提交</button></form></main>`);
      await page.setContent('<iframe title="编译预览"></iframe><iframe title="sandbox探针"></iframe><iframe title="正向对照"></iframe>');
      await page.evaluate(({ html, script, sandbox }: { html: string; script: string; sandbox: string }): void => {
        const frames = document.querySelectorAll('iframe');
        frames[0].setAttribute('sandbox', sandbox); frames[0].srcdoc = html;
        frames[1].setAttribute('sandbox', sandbox); frames[1].srcdoc = `${script}<p>隔离探针</p>`;
        frames[2].srcdoc = `${script}<p>可执行对照</p>`;
      }, { html: canaryHtml, script, sandbox: SKETCH_PREVIEW_SANDBOX });
      await page.frameLocator('iframe[title="编译预览"]').getByText('安全内容').waitFor();
      await page.frameLocator('iframe[title="sandbox探针"]').getByText('隔离探针').waitFor();
      await page.frameLocator('iframe[title="正向对照"]').getByText('可执行对照').waitFor();
      const frames = page.frames().filter((frame) => frame.parentFrame() !== null);
      const canaryState = async (index: number): Promise<boolean> => frames[index].evaluate((): boolean => Reflect.get(window, '__sketchCanary') === true);
      expect(await canaryState(0)).toBe(false);
      expect(await canaryState(1)).toBe(false);
      expect(await canaryState(2)).toBe(true);
      await page.frameLocator('iframe[title="编译预览"]').getByRole('button', { name: '尝试提交' }).click();
      // Wait through the next browser rendering checkpoint, not a guessed network delay.
      await page.evaluate((): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      // Playwright reports a request attempt even when Chromium rejects it before routing.
      expect(externalRequests).toEqual(['https://sketch-canary.invalid/pixel']);
      expect(failedRequests).toEqual([{ url: 'https://sketch-canary.invalid/pixel', error: 'csp' }]);
      expect(routedRequests).toEqual([]);
      expect(frames[0].url()).toBe('about:srcdoc');
    } finally {
      page.off('request', listener);
      page.off('requestfailed', failureListener);
      await page.unroute('https://sketch-canary.invalid/**');
    }
  }, 30000);
});
