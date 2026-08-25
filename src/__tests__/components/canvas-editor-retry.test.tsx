// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  CanvasEditor,
  type CanvasAiEditRequest,
  type CanvasAiEditSnapshot,
} from '@/components/simple-chat/canvas-editor';

describe('CanvasEditor deterministic retry', () => {
  it('keeps the selection and instruction and retries the frozen edit once', async () => {
    const preparedRequests: CanvasAiEditRequest[] = [];
    const prepare = vi.fn((snapshot: CanvasAiEditSnapshot): CanvasAiEditRequest => {
      const request = {
        ...snapshot,
        idempotencyKey: 'canvas-edit:task-a:request-a',
        modelId: 'model-a',
        providerId: 'provider-a',
        projectId: 'project-a',
        taskId: 'task-a',
      };
      preparedRequests.push(request);
      return request;
    });
    const edit = vi.fn()
      .mockRejectedValueOnce(new Error('APIMart edit failed'))
      .mockResolvedValueOnce('前缀CANVAS_OK后缀');

    render(
      <CanvasEditor
        content="前缀原文后缀"
        onClose={vi.fn()}
        onPrepareAiEdit={prepare}
        onAiEdit={edit}
      />,
    );
    const editor = screen.getByPlaceholderText('在这里编辑文案...') as HTMLTextAreaElement;
    editor.setSelectionRange(2, 4);
    fireEvent.select(editor);
    fireEvent.change(screen.getByPlaceholderText('告诉 AI 如何修改选中部分...'), {
      target: { value: '替换选区' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }));

    expect((await screen.findByRole('alert')).textContent).toContain('APIMart edit failed');
    expect(screen.getByDisplayValue('替换选区')).toBeTruthy();
    expect(screen.getByText(/已选中 2 字/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试修改' }));

    await waitFor(() => expect(editor.value).toBe('前缀CANVAS_OK后缀'));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(preparedRequests).toHaveLength(1);
    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit.mock.calls[1][0]).toBe(edit.mock.calls[0][0]);
    expect(screen.getByText('版本 (2)')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not create a version for repeated failures', async () => {
    const prepare = (snapshot: CanvasAiEditSnapshot): CanvasAiEditRequest => ({
      ...snapshot,
      idempotencyKey: 'canvas-edit:task-a:request-b',
      modelId: 'model-a',
      providerId: 'provider-a',
      projectId: 'project-a',
      taskId: 'task-a',
    });
    const edit = vi.fn().mockRejectedValue(new Error('still failed'));
    render(
      <CanvasEditor
        content="原文"
        onClose={vi.fn()}
        onPrepareAiEdit={prepare}
        onAiEdit={edit}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('告诉 AI 如何修改全文...'), {
      target: { value: '润色' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试修改' }));

    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(screen.getByText('版本 (1)')).toBeTruthy();
  });
});
