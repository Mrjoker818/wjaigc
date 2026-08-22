import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modulePath = resolve(process.cwd(), 'src/lib/canvas-edit-image-source.ts');

async function loadModule() {
  if (!existsSync(modulePath)) return null;
  return import('@/lib/canvas-edit-image-source');
}

describe('canvas edit image source', () => {
  it('提供独立的编辑图片地址解析器', () => {
    expect(existsSync(modulePath), '缺少编辑图片同源地址解析器').toBe(true);
  });

  it('保留已经可由当前页面安全读取的地址', async () => {
    const imageSourceModule = await loadModule();
    if (!imageSourceModule) return;

    for (const source of [
      '/api/serve-upload/uploads/example.png',
      '/uploads/example.png',
      'data:image/png;base64,AA==',
      'blob:https://wujie.test/example',
    ]) {
      expect(imageSourceModule.getCanvasEditImageSource(source)).toBe(source);
    }
  });

  it('将远程 HTTP 图片映射到鉴权的同源安全读取端点', async () => {
    const imageSourceModule = await loadModule();
    if (!imageSourceModule) return;

    const remote = 'https://cdn.pearapi.ai/path/image.png?token=one two';
    expect(imageSourceModule.getCanvasEditImageSource(remote)).toBe(
      `/api/image/source?url=${encodeURIComponent(remote)}`,
    );
  });

  it('不把非 HTTP 协议伪装成可代理远程图片', async () => {
    const imageSourceModule = await loadModule();
    if (!imageSourceModule) return;

    expect(imageSourceModule.getCanvasEditImageSource('file:///etc/passwd')).toBe('');
    expect(imageSourceModule.getCanvasEditImageSource('javascript:alert(1)')).toBe('');
  });
});
