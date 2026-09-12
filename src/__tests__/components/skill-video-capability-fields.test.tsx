// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SkillInputFields } from '@/components/skill-runtime/SkillInputFields';
import { resolveVideoCapabilityFieldOptions } from '@/lib/brief-to-video/capabilities';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

const descriptor: TaskModelDescriptor = {
  providerId: 'provider-video',
  modelId: 'video-model',
  kind: 'video',
  sourceType: 'video',
  protocol: 'apimart-video',
  executionMode: 'async',
  allowedRatios: ['16:9', '9:16'],
  allowedSizes: ['720p', '1080p'],
  qualityOptions: ['std'],
  maxOutputs: 1,
  supportsReferenceImages: true,
  maxReferenceImages: 2,
  supportsMask: false,
  allowedDurationsSeconds: [5, 10, 15],
  maxDurationSeconds: 15,
  supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
  outputKinds: ['mp4'],
  capabilitySources: {},
};

const fields = [
  {
    key: 'durationSeconds', label: '视频时长', kind: 'select' as const, required: true,
    capabilityOptions: { modelRole: 'video' as const, field: 'durationSeconds' as const },
  },
  {
    key: 'aspectRatio', label: '画面比例', kind: 'select' as const, required: true,
    capabilityOptions: { modelRole: 'video' as const, field: 'aspectRatio' as const },
  },
  {
    key: 'resolution', label: '分辨率', kind: 'select' as const, required: false,
    capabilityOptions: { modelRole: 'video' as const, field: 'resolution' as const },
  },
];

describe('Skill video capability fields', () => {
  it('derives only values supported by the frozen video descriptor', () => {
    expect(resolveVideoCapabilityFieldOptions(descriptor, 'durationSeconds'))
      .toEqual(['5', '10', '15']);
    expect(resolveVideoCapabilityFieldOptions(descriptor, 'aspectRatio'))
      .toEqual(['16:9', '9:16']);
    expect(resolveVideoCapabilityFieldOptions(descriptor, 'resolution'))
      .toEqual(['720p', '1080p']);
    expect(resolveVideoCapabilityFieldOptions({ ...descriptor, kind: 'image' }, 'resolution'))
      .toEqual([]);
  });

  it('renders capability options and emits a selected value', () => {
    const onChange = vi.fn();
    render(
      <SkillInputFields
        fields={fields}
        values={{}}
        capabilityDescriptors={{ video: descriptor }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('视频时长').textContent).toContain('15');
    expect(screen.getByLabelText('画面比例').textContent).not.toContain('1:1');
    fireEvent.change(screen.getByLabelText('分辨率'), { target: { value: '1080p' } });
    expect(onChange).toHaveBeenCalledWith('resolution', '1080p');
  });

  it('fails closed when the frozen video descriptor is missing', () => {
    render(<SkillInputFields fields={fields} values={{}} onChange={vi.fn()} />);

    expect(screen.getByLabelText('视频时长').querySelectorAll('option')).toHaveLength(1);
    expect(screen.getByLabelText('画面比例').querySelectorAll('option')).toHaveLength(1);
  });
});
