// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ModelCapabilityEditor,
  buildCapabilityEditorModels,
  mergeAdvancedParamsWithCapabilities,
} from '@/components/dashboard/model-capability-editor';
import { ThirdPartyModelDialog } from '@/components/third-party-model-dialog';
import type { ProviderCapabilityOverridesV1 } from '@/lib/task-core/model-capability-contract';
import type { ModelInfo } from '@/lib/universal-api-types';

vi.mock('@/lib/universal-api-manager', () => ({
  UniversalApiManager: {
    getInstance: () => ({ getProviders: () => [] }),
  },
}));

const models: ModelInfo[] = [
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    providerId: 'provider-a',
    type: 'image',
    supportedAspectRatios: ['5:4'],
  },
  {
    id: 'video-a',
    name: 'Video A',
    providerId: 'provider-a',
    type: 'video',
    allowedDurationsSeconds: [7],
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    providerId: 'provider-a',
    type: 'chat',
  },
];

const initialValue: ProviderCapabilityOverridesV1 = {
  version: 1,
  models: {
    'gpt-image-2': { allowedRatios: ['1:1', '19:7'], maxOutputs: 1 },
    'video-a': { allowedDurationsSeconds: [5, 7, 10], maxDurationSeconds: 10 },
  },
};

describe('ModelCapabilityEditor', () => {
  it('builds fallback entries for selected models omitted from discovery using the provider type', () => {
    expect(buildCapabilityEditorModels([], ['video-not-discovered'], 'provider-a', 'video')).toEqual([
      {
        id: 'video-not-discovered',
        name: 'video-not-discovered',
        providerId: 'provider-a',
        type: 'video',
      },
    ]);
  });

  it('renders video capability controls through the legacy dialog', () => {
    render(
      <ThirdPartyModelDialog
        isOpen
        onClose={() => undefined}
        themeStyle="monochrome"
        defaultType="video"
      />,
    );

    expect(screen.getByText('还没有视频模型')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '添加视频模型' }));
    fireEvent.change(screen.getByPlaceholderText('搜索或手动输入模型ID'), {
      target: { value: 'video-only' },
    });
    fireEvent.click(screen.getByRole('button', { name: /添加.*video-only/ }));

    expect(screen.getByText('离散时长（秒）')).toBeTruthy();
    expect(screen.queryByLabelText('最大生成数量')).toBeNull();
  });

  it('hydrates the dashboard compatibility profile from editable advanced parameters', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'), 'utf8');

    expect(source).toContain("setCompatProfile(p.advancedParams?.compatProfile || 'auto')");
    expect(source).not.toContain("setCompatProfile(p.compatProfile || 'auto')");
  });

  it('normalizes dashboard advanced parameter entries while reserving the system capability key', () => {
    expect(mergeAdvancedParamsWithCapabilities([
      { key: 'compatProfile', value: 'pearapi' },
      { key: 'customHeader', value: 'x-client' },
      { key: 'taskModelCapabilities', value: '{"models":{"unsafe":true}}' },
    ], initialValue)).toEqual({
      compatProfile: 'pearapi',
      customHeader: 'x-client',
      taskModelCapabilities: JSON.stringify({
        version: 1,
        models: {
        'gpt-image-2': { allowedRatios: ['1:1', '19:7'], maxOutputs: 1 },
        'video-a': { allowedDurationsSeconds: [5, 7, 10], maxDurationSeconds: 10 },
        },
      }),
    });
  });

  it('edits image controls without overwriting another model capability override', () => {
    let currentValue = initialValue;
    const onChange = vi.fn((nextValue: ProviderCapabilityOverridesV1) => {
      currentValue = nextValue;
      rerender(<ModelCapabilityEditor models={models} value={currentValue} onChange={onChange} />);
    });
    const { rerender } = render(<ModelCapabilityEditor models={models} value={currentValue} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'GPT Image 2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '16:9' }));
    fireEvent.change(screen.getByLabelText('最大生成数量'), { target: { value: '4' } });

    expect(onChange).toHaveBeenLastCalledWith({
      version: 1,
      models: {
        'gpt-image-2': { allowedRatios: ['1:1', '19:7', '16:9'], maxOutputs: 4 },
        'video-a': { allowedDurationsSeconds: [5, 7, 10], maxDurationSeconds: 10 },
      },
    });
  });

  it('shows video-only discrete duration and operation controls', () => {
    render(<ModelCapabilityEditor models={[
      models[0],
      { ...models[1], supportedOperations: ['multi-reference'] },
    ]} value={{
      ...initialValue,
      models: {
        ...initialValue.models,
        'video-a': {
          ...initialValue.models['video-a'],
          supportedOperations: ['multi-reference'],
        },
      },
    }} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Video A' }));

    expect(screen.getByText('离散时长（秒）')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '文生视频' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '多参考图' })).toBeTruthy();
    expect(screen.queryByLabelText('最大生成数量')).toBeNull();
  });

  it('lists every compatibility profile supported by the request adapter', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'), 'utf8');

    for (const profile of ['openai-async', 'gemini-image', 'pearapi']) {
      expect(source).toContain(`value=\"${profile}\"`);
    }
  });

  it('keeps standard and persisted capability values editable', () => {
    render(<ModelCapabilityEditor models={models} value={initialValue} onChange={vi.fn()} />);

    for (const label of ['auto', '3:2', '2:3', '21:9', '5:4', '19:7']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Video A' }));
    for (const label of ['3', '4', '5', '6', '7', '8', '10', '12', '15', '16', '20', '30']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeTruthy();
    }
  });

  it('removes only the selected model override', () => {
    const onChange = vi.fn();
    render(<ModelCapabilityEditor models={models} value={initialValue} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'GPT Image 2' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 GPT Image 2 的能力配置' }));

    expect(onChange).toHaveBeenLastCalledWith({
      version: 1,
      models: {
        'video-a': { allowedDurationsSeconds: [5, 7, 10], maxDurationSeconds: 10 },
      },
    });
  });

  it('lets an administrator explicitly mark a chat model as vision-capable', () => {
    const onChange = vi.fn();
    render(<ModelCapabilityEditor models={models} value={initialValue} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'GPT-4o' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '支持视觉理解' }));

    expect(onChange).toHaveBeenLastCalledWith({
      version: 1,
      models: {
        ...initialValue.models,
        'gpt-4o': { supportsVision: true },
      },
    });
  });
});
