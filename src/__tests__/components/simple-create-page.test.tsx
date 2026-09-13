// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  SimpleCreatePage,
  type SimpleCreateDependencies,
  type SimpleCreateModel,
} from '@/components/simple-create/simple-create-page';
import type { ImageGenerationSession, ImageGenerationSlot } from '@/lib/image-generation-session';

const pearModel: SimpleCreateModel = {
  providerId: 'pear',
  providerName: 'PearAPI',
  modelId: 'gpt-image-2',
  modelName: 'GPT Image 2',
  allowedRatios: ['1:1', '16:9'],
  allowedSizes: ['1024x1024', '1536x1024'],
  qualityOptions: ['standard', 'high'],
  maxOutputs: 4,
  supportsReferenceImages: true,
  maxReferenceImages: 2,
};

function harness(options: { authenticated?: boolean; slots?: ImageGenerationSlot[] } = {}) {
  let listener: ((slots: ImageGenerationSlot[]) => void) | null = null;
  const initialSlots = options.slots ?? [];
  const session: ImageGenerationSession = {
    submit: vi.fn(async request => Array.from({ length: request.outputCount }, (_, index) => ({
      id: `slot-${index}`,
      projectId: request.projectId,
      taskId: `task-${index}`,
      status: 'processing' as const,
      progress: 10,
    }))),
    restore: vi.fn(async () => initialSlots),
    cancel: vi.fn(async () => true),
    retry: vi.fn(async () => null),
    dispose: vi.fn(),
    subscribe: vi.fn(callback => { listener = callback; return () => { listener = null; }; }),
    snapshot: vi.fn(() => initialSlots),
  };
  const dependencies: SimpleCreateDependencies = {
    getSession: vi.fn(async () => ({ authenticated: options.authenticated !== false })),
    loadModels: vi.fn(async () => [pearModel]),
    uploadReference: vi.fn(async () => ({ url: '/uploads/reference.png', assetVersionId: 'ref-v1' })),
    session,
    navigate: vi.fn(),
    download: vi.fn(),
  };
  return {
    dependencies,
    emit: (slots: ImageGenerationSlot[]) => listener?.(slots),
  };
}

describe('SimpleCreatePage', () => {
  it('returns unauthenticated users to login with returnTo intact', async () => {
    const fake = harness({ authenticated: false });
    render(<SimpleCreatePage dependencies={fake.dependencies} initialProjectId="p1" />);

    await waitFor(() => expect(fake.dependencies.navigate).toHaveBeenCalledWith(
      '/?returnTo=%2Fsimple-create%3FprojectId%3Dp1',
    ));
    expect(fake.dependencies.session.restore).not.toHaveBeenCalled();
  });

  it('limits controls to the selected model capabilities and submits four independent slots', async () => {
    const fake = harness();
    render(<SimpleCreatePage dependencies={fake.dependencies} initialProjectId="p1" />);

    expect((await screen.findByLabelText('模型')).textContent).toContain('PearAPI');
    expect(screen.getByLabelText('画面比例').querySelectorAll('option')).toHaveLength(2);
    expect(screen.getByLabelText('图片尺寸').querySelectorAll('option')).toHaveLength(2);
    expect(screen.getByLabelText('图片质量').querySelectorAll('option')).toHaveLength(2);
    expect(screen.getByLabelText('生成数量').querySelectorAll('option')).toHaveLength(4);

    const file = new File(['image'], '参考图.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('参考图'), { target: { files: [file] } });
    await screen.findByAltText('参考图已上传');
    fireEvent.change(screen.getByLabelText('提示词'), { target: { value: '黑金海报' } });
    fireEvent.change(screen.getByLabelText('生成数量'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(fake.dependencies.session.submit).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
      outputCount: 4,
      prompt: '黑金海报',
      providerId: 'pear',
      model: 'gpt-image-2',
      referenceImages: ['/uploads/reference.png'],
    })));
  });

  it('restores slots and exposes cancel and retry independently', async () => {
    const slots: ImageGenerationSlot[] = [
      { id: 'active', projectId: 'p1', taskId: 'task-a', status: 'processing', progress: 40 },
      {
        id: 'failed', projectId: 'p1', taskId: 'task-b', status: 'failed', progress: 20,
        error: { message: '上游超时', retryable: true },
      },
    ];
    const fake = harness({ slots });
    render(<SimpleCreatePage dependencies={fake.dependencies} initialProjectId="p1" />);

    await screen.findByText('40%');
    fireEvent.click(screen.getByRole('button', { name: '取消 active' }));
    fireEvent.click(screen.getByRole('button', { name: '重试 failed' }));

    expect(fake.dependencies.session.restore).toHaveBeenCalledWith('p1');
    expect(fake.dependencies.session.cancel).toHaveBeenCalledWith('active');
    expect(fake.dependencies.session.retry).toHaveBeenCalledWith('failed');
  });

  it('downloads a completed result and opens its managed placement in the same canvas', async () => {
    const fake = harness();
    render(<SimpleCreatePage dependencies={fake.dependencies} initialProjectId="p1" />);
    await screen.findByLabelText('模型');
    act(() => fake.emit([{
        id: 'done', projectId: 'p1', taskId: 'task-done', status: 'completed', progress: 100,
        url: '/media/result.png', assetVersionId: 'v1', placementId: 'pl1',
      }]));

    fireEvent.click(await screen.findByRole('button', { name: '下载 done' }));
    fireEvent.click(screen.getByRole('button', { name: '在画布中打开 done' }));

    expect(fake.dependencies.download).toHaveBeenCalledWith('/media/result.png', 'done.png');
    expect(fake.dependencies.navigate).toHaveBeenCalledWith('/?projectId=p1&assetVersionId=v1&placementId=pl1');
  });
});
