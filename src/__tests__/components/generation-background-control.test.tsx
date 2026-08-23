// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GenerationBackgroundControl } from '@/components/generation-background-control';

describe('GenerationBackgroundControl', () => {
  it('lets a supported GPT Image model select native transparency', () => {
    const onChange = vi.fn();
    render(
      <GenerationBackgroundControl
        modelId="gpt-image-2"
        value={{ background: 'auto', outputFormat: 'png' }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '透明' }));
    expect(onChange).toHaveBeenCalledWith({
      background: 'transparent',
      outputFormat: 'png',
    });
  });

  it('disables transparency for models without background support', () => {
    render(
      <GenerationBackgroundControl
        modelId="dall-e-3"
        value={{ background: 'auto', outputFormat: 'png' }}
        onChange={() => undefined}
      />,
    );

    expect((screen.getByRole('button', { name: '透明' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('当前模型不支持原生透明背景')).toBeTruthy();
  });

  it('explains that transparent output is locked to PNG', () => {
    render(
      <GenerationBackgroundControl
        modelId="gpt-image-2"
        value={{ background: 'transparent', outputFormat: 'png' }}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText('真正透明的 PNG（含 Alpha 通道）')).toBeTruthy();
  });
});
