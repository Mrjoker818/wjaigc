// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CanvasSkillSaveForm } from '@/components/chat-panel';

describe('Canvas Skill management interactions', () => {
  it('submits a named conversation Skill without requiring an active template', () => {
    const save = vi.fn();
    function Harness() {
      const [name, setName] = useState('');
      const [description, setDescription] = useState('');
      return (
        <CanvasSkillSaveForm
          themeStyle="monochrome"
          name={name}
          description={description}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onSave={() => save({ name, description })}
          onCancel={vi.fn()}
        />
      );
    }

    render(<Harness />);
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Skill 名称'), { target: { value: '海报复用' } });
    fireEvent.change(screen.getByLabelText('Skill 描述'), { target: { value: '保留本轮创作策略' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(save).toHaveBeenCalledWith({ name: '海报复用', description: '保留本轮创作策略' });
  });
});
