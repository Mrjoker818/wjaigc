// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const layerClientMocks = vi.hoisted(() => ({
  runLayerDecomposition: vi.fn(),
  cancelLayerDecomposition: vi.fn(),
  createLayerIdempotencyKey: vi.fn(() => 'layer-editor-cancel-key-1'),
}));

vi.mock('@/lib/layer-decomposition-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/layer-decomposition-client')>();
  return {
    ...original,
    runLayerDecomposition: layerClientMocks.runLayerDecomposition,
    cancelLayerDecomposition: layerClientMocks.cancelLayerDecomposition,
    createLayerIdempotencyKey: layerClientMocks.createLayerIdempotencyKey,
  };
});

vi.mock('@/components/psd-editor/PsdCanvas', () => ({
  PsdCanvas: () => <div data-testid="mock-psd-canvas" />,
}));
vi.mock('@/components/psd-editor/LayerPanel', () => ({
  LayerPanel: () => <div data-testid="mock-layer-panel" />,
}));
vi.mock('@/components/psd-editor/LayerInspector', () => ({
  LayerInspector: () => <div data-testid="mock-layer-inspector" />,
}));
vi.mock('@/components/psd-editor/ExportToolbar', () => ({
  ExportToolbar: () => <div data-testid="mock-export-toolbar" />,
}));

import PsdLayerEditor from '@/components/psd-editor/PsdLayerEditor';
import { LayerClientError } from '@/lib/layer-decomposition-client';

type TaskIdCallback = (taskId: string) => void | Promise<void>;

describe('PsdLayerEditor cancellation registration race', () => {
  let deliverTaskId: TaskIdCallback | null;
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); },
        clear: () => storage.clear(),
        key: (index: number) => Array.from(storage.keys())[index] ?? null,
        get length() { return storage.size; },
      },
    });
    deliverTaskId = null;
    layerClientMocks.cancelLayerDecomposition.mockResolvedValue({
      success: true,
      taskId: 'layer-task',
      status: 'cancelled',
      progress: 0,
    });
    layerClientMocks.runLayerDecomposition.mockImplementation(async (options) => {
      deliverTaskId = options.onTaskId || null;
      return await new Promise<never>(() => undefined);
    });
  });

  async function startLayering(): Promise<void> {
    render(<PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('layer-start'));
    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(1));
    expect(deliverTaskId).not.toBeNull();
  }

  it('queues cancellation until the submitted task id arrives', async () => {
    await startLayering();

    fireEvent.click(screen.getByTestId('layer-cancel'));
    expect(layerClientMocks.cancelLayerDecomposition).not.toHaveBeenCalled();

    await act(async () => { await deliverTaskId?.('layer-task-before-response'); });

    await waitFor(() => {
      expect(layerClientMocks.cancelLayerDecomposition)
        .toHaveBeenCalledExactlyOnceWith('layer-task-before-response');
    });
    expect(screen.getByTestId('layer-start')).toBeTruthy();
  });

  it('waits for server cancellation before closing the editor', async () => {
    const onClose = vi.fn();
    render(<PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('layer-start'));
    await waitFor(() => expect(deliverTaskId).not.toBeNull());

    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { await deliverTaskId?.('layer-task-close-race'); });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(layerClientMocks.cancelLayerDecomposition)
      .toHaveBeenCalledExactlyOnceWith('layer-task-close-race');
  });

  it('does not inherit a false cancellation intent from StrictMode effect replay', () => {
    const onClose = vi.fn();
    render(
      <React.StrictMode>
        <PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={onClose} />
      </React.StrictMode>,
    );

    fireEvent.click(screen.getByTitle('关闭 (Esc)'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(layerClientMocks.runLayerDecomposition).not.toHaveBeenCalled();
  });

  it('keeps the submit alive on unmount until it can cancel the registered task', async () => {
    let submitSignal: AbortSignal | undefined;
    layerClientMocks.runLayerDecomposition.mockImplementation(async (options) => {
      deliverTaskId = options.onTaskId || null;
      submitSignal = options.signal;
      return await new Promise<never>(() => undefined);
    });
    const view = render(
      <PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('layer-start'));
    await waitFor(() => expect(deliverTaskId).not.toBeNull());

    view.unmount();
    expect(submitSignal?.aborted).toBe(false);
    await act(async () => { await deliverTaskId?.('layer-task-unmounted-before-id'); });

    expect(layerClientMocks.cancelLayerDecomposition)
      .toHaveBeenCalledExactlyOnceWith(
        'layer-task-unmounted-before-id',
        { keepalive: true },
      );
  });

  it('cancels a registered task when the editor is unmounted externally', async () => {
    layerClientMocks.cancelLayerDecomposition
      .mockRejectedValueOnce(new TypeError('transient cancel failure'))
      .mockResolvedValueOnce({
        success: true,
        taskId: 'layer-task-unmounted-after-id',
        status: 'cancelled',
        progress: 0,
      });
    const view = render(
      <PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('layer-start'));
    await waitFor(() => expect(deliverTaskId).not.toBeNull());
    await act(async () => { await deliverTaskId?.('layer-task-unmounted-after-id'); });

    view.unmount();

    await waitFor(() => {
      expect(layerClientMocks.cancelLayerDecomposition)
        .toHaveBeenCalledTimes(2);
    });
    expect(layerClientMocks.cancelLayerDecomposition)
      .toHaveBeenNthCalledWith(2, 'layer-task-unmounted-after-id', { keepalive: true });
  });

  it('recovers an uncertain unmounted submit with the frozen request and cancels it', async () => {
    let rejectFirstSubmit: ((error: unknown) => void) | null = null;
    layerClientMocks.runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        return await new Promise<never>((_resolve, reject) => {
          rejectFirstSubmit = reject;
        });
      })
      .mockImplementationOnce(async (options) => {
        await options.onTaskId?.('layer-task-unmounted-recovered');
        options.signal?.throwIfAborted();
        return await new Promise<never>(() => undefined);
      });
    const view = render(
      <PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('layer-start'));
    await waitFor(() => expect(rejectFirstSubmit).not.toBeNull());

    view.unmount();
    await act(async () => { rejectFirstSubmit?.(new TypeError('submit response lost')); });

    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(2));
    const first = layerClientMocks.runLayerDecomposition.mock.calls[0]?.[0];
    const recovered = layerClientMocks.runLayerDecomposition.mock.calls[1]?.[0];
    expect(recovered).toMatchObject({
      imageUrl: first.imageUrl,
      engine: first.engine,
      providerId: first.providerId,
      modelId: first.modelId,
      idempotencyKey: first.idempotencyKey,
      keepalive: true,
    });
    await waitFor(() => {
      expect(layerClientMocks.cancelLayerDecomposition)
        .toHaveBeenCalledWith('layer-task-unmounted-recovered', { keepalive: true });
    });
  });

  it('preserves a frozen empty target during unmounted cancellation recovery', async () => {
    let rejectFirstSubmit: ((error: unknown) => void) | null = null;
    layerClientMocks.runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        await options.onResolvedSubmissionTarget?.(null);
        return await new Promise<never>((_resolve, reject) => {
          rejectFirstSubmit = reject;
        });
      })
      .mockImplementationOnce(async () => await new Promise<never>(() => undefined));
    const view = render(
      <PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('layer-start'));
    await waitFor(() => expect(rejectFirstSubmit).not.toBeNull());

    view.unmount();
    await act(async () => { rejectFirstSubmit?.(new TypeError('submit response lost')); });

    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(2));
    expect(layerClientMocks.runLayerDecomposition.mock.calls[1]?.[0]).toMatchObject({
      providerId: undefined,
      modelId: undefined,
      skipDefaultTargetResolution: true,
      keepalive: true,
      idempotencyKey: 'layer-editor-cancel-key-1',
    });
  });

  it('deduplicates repeated cancellation clicks for one registered task', async () => {
    let releaseCancel: (() => void) | null = null;
    layerClientMocks.cancelLayerDecomposition.mockImplementation(() => (
      new Promise((resolve) => {
        releaseCancel = () => resolve({
          success: true,
          taskId: 'layer-task-repeat',
          status: 'cancelled',
          progress: 0,
        });
      })
    ));
    await startLayering();
    await act(async () => { await deliverTaskId?.('layer-task-repeat'); });

    const cancelButton = screen.getByTestId('layer-cancel');
    fireEvent.click(cancelButton);
    fireEvent.click(cancelButton);

    expect(layerClientMocks.cancelLayerDecomposition).toHaveBeenCalledTimes(1);
    await act(async () => { releaseCancel?.(); });
  });

  it('does not report cancellation success when the server returns a completed task', async () => {
    layerClientMocks.cancelLayerDecomposition.mockResolvedValueOnce({
      success: true,
      taskId: 'layer-task-completed-race',
      status: 'completed',
      progress: 100,
    });
    await startLayering();
    await act(async () => { await deliverTaskId?.('layer-task-completed-race'); });

    fireEvent.click(screen.getByTestId('layer-cancel'));

    expect(await screen.findByTestId('layer-error')).toBeTruthy();
    expect(screen.getByText('图片分层任务已完成，无法确认取消。')).toBeTruthy();
    expect(screen.queryByTestId('layer-start')).toBeNull();
    expect(screen.queryByTestId('layer-retry')).toBeNull();
  });

  it('retries a failed cancellation instead of starting a new paid task', async () => {
    layerClientMocks.cancelLayerDecomposition
      .mockRejectedValueOnce(new Error('cancel network lost'))
      .mockResolvedValueOnce({
        success: true,
        taskId: 'layer-task-cancel-retry',
        status: 'cancelled',
        progress: 0,
      });
    await startLayering();
    await act(async () => { await deliverTaskId?.('layer-task-cancel-retry'); });

    fireEvent.click(screen.getByTestId('layer-cancel'));
    fireEvent.click(await screen.findByTestId('layer-retry'));

    await waitFor(() => expect(layerClientMocks.cancelLayerDecomposition).toHaveBeenCalledTimes(2));
    expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(1);
    expect(layerClientMocks.cancelLayerDecomposition).toHaveBeenNthCalledWith(
      2,
      'layer-task-cancel-retry',
    );
  });

  it('replays an uncertain submit with the same idempotency key and cancels the recovered task', async () => {
    let rejectFirstSubmit: ((error: unknown) => void) | null = null;
    layerClientMocks.runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        return await new Promise<never>((_resolve, reject) => {
          rejectFirstSubmit = reject;
        });
      })
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        return await new Promise<never>(() => undefined);
      });

    await startLayering();
    fireEvent.click(screen.getByTestId('layer-cancel'));
    await act(async () => { rejectFirstSubmit?.(new TypeError('submit response lost')); });

    fireEvent.click(screen.getByRole('button', { name: '云端' }));
    fireEvent.click(await screen.findByTestId('layer-retry'));
    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(2));
    const firstRequest = layerClientMocks.runLayerDecomposition.mock.calls[0]?.[0];
    const recoveryRequest = layerClientMocks.runLayerDecomposition.mock.calls[1]?.[0];
    expect(recoveryRequest).toMatchObject({
      imageUrl: firstRequest.imageUrl,
      engine: firstRequest.engine,
      providerId: firstRequest.providerId,
      modelId: firstRequest.modelId,
      idempotencyKey: firstRequest.idempotencyKey,
    });

    await act(async () => { await deliverTaskId?.('layer-task-recovered'); });
    await waitFor(() => {
      expect(layerClientMocks.cancelLayerDecomposition)
        .toHaveBeenCalledExactlyOnceWith('layer-task-recovered');
    });
  });

  it('freezes the resolved default target before recovering an uncertain submit', async () => {
    let rejectFirstSubmit: ((error: unknown) => void) | null = null;
    layerClientMocks.runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        await options.onResolvedSubmissionTarget?.({
          providerId: 'pear-provider-a',
          modelId: 'Image-Layered-A',
        });
        return await new Promise<never>((_resolve, reject) => {
          rejectFirstSubmit = reject;
        });
      })
      .mockImplementationOnce(async () => await new Promise<never>(() => undefined));

    await startLayering();
    fireEvent.click(screen.getByTestId('layer-cancel'));
    await act(async () => { rejectFirstSubmit?.(new TypeError('submit response lost')); });
    fireEvent.click(await screen.findByTestId('layer-retry'));

    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(2));
    expect(layerClientMocks.runLayerDecomposition.mock.calls[1]?.[0]).toMatchObject({
      providerId: 'pear-provider-a',
      modelId: 'Image-Layered-A',
      idempotencyKey: 'layer-editor-cancel-key-1',
    });
  });

  it('freezes an empty smart-mode target before recovering an uncertain submit', async () => {
    let rejectFirstSubmit: ((error: unknown) => void) | null = null;
    layerClientMocks.runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        await options.onResolvedSubmissionTarget?.(null);
        return await new Promise<never>((_resolve, reject) => {
          rejectFirstSubmit = reject;
        });
      })
      .mockImplementationOnce(async () => await new Promise<never>(() => undefined));

    await startLayering();
    fireEvent.click(screen.getByTestId('layer-cancel'));
    await act(async () => { rejectFirstSubmit?.(new TypeError('submit response lost')); });
    fireEvent.click(await screen.findByTestId('layer-retry'));

    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(2));
    expect(layerClientMocks.runLayerDecomposition.mock.calls[1]?.[0]).toMatchObject({
      providerId: undefined,
      modelId: undefined,
      skipDefaultTargetResolution: true,
      idempotencyKey: 'layer-editor-cancel-key-1',
    });
  });

  it('reuses the in-flight cancellation when the editor unmounts', async () => {
    let releaseCancel: (() => void) | null = null;
    layerClientMocks.cancelLayerDecomposition.mockImplementation(() => (
      new Promise((resolve) => {
        releaseCancel = () => resolve({
          success: true,
          taskId: 'layer-task-unmount-during-cancel',
          status: 'cancelled',
          progress: 0,
        });
      })
    ));
    const view = render(
      <PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('layer-start'));
    await waitFor(() => expect(deliverTaskId).not.toBeNull());
    await act(async () => { await deliverTaskId?.('layer-task-unmount-during-cancel'); });
    fireEvent.click(screen.getByTestId('layer-cancel'));
    expect(layerClientMocks.cancelLayerDecomposition).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(layerClientMocks.cancelLayerDecomposition).toHaveBeenCalledTimes(1);
    await act(async () => { releaseCancel?.(); });
    expect(layerClientMocks.cancelLayerDecomposition).toHaveBeenCalledTimes(1);
  });

  it('preserves the frozen cancellation operation across a recovery authentication failure', async () => {
    let rejectFirstSubmit: ((error: unknown) => void) | null = null;
    layerClientMocks.runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        return await new Promise<never>((_resolve, reject) => {
          rejectFirstSubmit = reject;
        });
      })
      .mockRejectedValueOnce(new LayerClientError(
        'AUTH_REQUIRED',
        '登录状态暂时不可用',
        { status: 401 },
      ))
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        return await new Promise<never>(() => undefined);
      });

    await startLayering();
    fireEvent.click(screen.getByTestId('layer-cancel'));
    await act(async () => { rejectFirstSubmit?.(new TypeError('submit response lost')); });

    fireEvent.click(await screen.findByTestId('layer-retry'));
    await screen.findByTestId('layer-error');
    fireEvent.click(await screen.findByTestId('layer-retry'));

    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(3));
    const keys = layerClientMocks.runLayerDecomposition.mock.calls
      .map((call) => call[0]?.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('retries uncertain cancellation recovery when close is requested again', async () => {
    const onClose = vi.fn();
    let rejectFirstSubmit: ((error: unknown) => void) | null = null;
    layerClientMocks.runLayerDecomposition
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        return await new Promise<never>((_resolve, reject) => {
          rejectFirstSubmit = reject;
        });
      })
      .mockImplementationOnce(async (options) => {
        deliverTaskId = options.onTaskId || null;
        return await new Promise<never>(() => undefined);
      });

    render(<PsdLayerEditor imageUrl="/api/serve-upload/source.png" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('layer-start'));
    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await act(async () => { rejectFirstSubmit?.(new TypeError('submit response lost')); });
    await screen.findByTestId('layer-error');

    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    await waitFor(() => expect(layerClientMocks.runLayerDecomposition).toHaveBeenCalledTimes(2));
    await act(async () => { await deliverTaskId?.('layer-task-close-recovered'); });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(layerClientMocks.cancelLayerDecomposition)
      .toHaveBeenCalledExactlyOnceWith('layer-task-close-recovered');
  });
});
