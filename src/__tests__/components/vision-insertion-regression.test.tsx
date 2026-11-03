// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const catalog = vi.hoisted(() => ({ models: [], descriptorsByKey: new Map(), loading: false, error: null, reload: () => {} }));
vi.mock('@/hooks/use-task-model-catalog', () => ({ useTaskModelCatalog: () => catalog }));
vi.mock('@/lib/universal-api-manager', () => ({ UniversalApiManager: { getInstance: () => ({ getProviders: () => [] }) } }));
vi.mock('@/lib/user-manager', () => ({ UserManager: { getInstance: () => ({ getApiKeys: () => [] }) } }));
vi.mock('@/components/third-party-model-dialog', () => ({ ThirdPartyModelDialog: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { GenerationPanel } from '@/components/generation-panel';
import OhMyPrompt from '@/components/oh-my-prompt';

type Insertion = { id: number; scope: string; text: string };
const analysis = vi.fn();
function Parent(): React.ReactElement {
  const [scope, setScope] = useState('actor/project-a');
  const [insertions, setInsertions] = useState<Insertion[]>([]);
  const [externalPrompt, setExternalPrompt] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const pending = insertions.find(item => item.scope === scope);
  return <>
    <button onClick={() => setScope(value => value === 'actor/project-a' ? 'actor/project-b' : 'actor/project-a')}>切项目</button>
    <GenerationPanel onGenerate={() => {}} externalPrompt={externalPrompt} onExternalPromptConsumed={() => setExternalPrompt(undefined)}
      visionScopeKey={scope} initialVisionDraft={drafts[scope]} onVisionDraftChange={text => setDrafts(previous => previous[scope] === text ? previous : { ...previous, [scope]: text })}
      visionInsertion={pending} onVisionInsertionConsumed={id => setInsertions(previous => previous.filter(item => item.id !== id))} />
    <OhMyPrompt isOpen floating defaultActiveTab="vision" visionScopeKey={scope}
      visionResult={{ zh: { title: '示例', prompt: '合成蓝色海岸' }, negative_prompt: '模糊' }}
      onClose={() => {}} onVisionPrompt={analysis} onInsertPrompt={setExternalPrompt}
      onInsertVisionPrompt={text => { const id = ++sequence.current; setInsertions(previous => [...previous, { id, scope, text }]); }} />
  </>;
}
function prompt(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('描述你想要创建的图像... (输入 / 使用模板)') as HTMLTextAreaElement;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); analysis.mockReset(); });

it('appends each intentional vision send to the existing draft without starting analysis', async () => {
  const unexpectedFetch = vi.fn(() => { throw Error('unexpected network request'); });
  vi.stubGlobal('fetch', unexpectedFetch);
  render(<Parent />);
  fireEvent.change(prompt(), { target: { value: '原有草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '发送关键词' }));
  await waitFor(() => expect(prompt().value).toBe('原有草稿\n合成蓝色海岸'));
  expect(analysis).not.toHaveBeenCalled();
  expect(screen.getByText(/不会自动发送到专业创作/)).toBeTruthy();
  expect(unexpectedFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '已记录' }));
  await waitFor(() => expect(prompt().value).toBe('原有草稿\n合成蓝色海岸\n合成蓝色海岸'));
  expect(unexpectedFetch).not.toHaveBeenCalled();
});

it('keeps the appended draft in its project when the unkeyed panel changes scope', async () => {
  const unexpectedFetch = vi.fn(() => { throw Error('unexpected network request'); });
  vi.stubGlobal('fetch', unexpectedFetch);
  render(<Parent />);
  fireEvent.change(prompt(), { target: { value: 'A原草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '发送关键词' }));
  await waitFor(() => expect(prompt().value).toBe('A原草稿\n合成蓝色海岸'));
  fireEvent.click(screen.getByRole('button', { name: '切项目' }));
  expect(prompt().value).toBe('');
  fireEvent.change(prompt(), { target: { value: 'B原草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '切项目' }));
  expect(prompt().value).toBe('A原草稿\n合成蓝色海岸');
  expect(analysis).not.toHaveBeenCalled();
  expect(unexpectedFetch).not.toHaveBeenCalled();
});
