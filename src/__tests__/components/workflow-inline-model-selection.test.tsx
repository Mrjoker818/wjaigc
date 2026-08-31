// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowLegacyNodeCard, type WorkflowLegacyModelOption } from '@/components/workflow/WorkflowLegacyNodeCard';
import { DEFAULT_WORKFLOW_NODE_THEME } from '@/components/workflow/WorkflowLegacySurface';
import NodeEditor from '@/components/node-editor';
import { buildNodeExecutionRequest, createEmptyWorkflow, createWorkflowNode, type WorkflowNode } from '@/lib/workflow-engine';

const imageModels: WorkflowLegacyModelOption[] = [
  { id: 'gpt-image-2', name: 'GPT Image 2', type: 'image', provider: 'AILINK', providerId: 'ailink' },
  { id: 'gpt-image-2', name: 'GPT Image 2', type: 'image', provider: 'Pear', providerId: 'pear' },
  { id: 'gpt-image-2', name: 'GPT Image 2', type: 'image', provider: 'APImart', providerId: 'apimart' },
];
const llmModels: WorkflowLegacyModelOption[] = [
  { id: 'chat-model', name: 'Chat Model', type: 'chat', provider: 'Pear', providerId: 'pear' },
  { id: 'chat-model', name: 'Chat Model', type: 'chat', provider: 'APImart', providerId: 'apimart' },
  { id: 'unique-chat', name: 'Unique Chat', type: 'chat', provider: 'APImart', providerId: 'apimart' },
];

interface HarnessProps {
  initialNode: WorkflowNode;
  onOptimize?: (nodeId: string, prompt: string, model: string, systemPrompt: string, instruction: string) => void;
}

function CardHarness({ initialNode, onOptimize }: HarnessProps) {
  const [node, setNode] = useState(initialNode);
  return <>
    <WorkflowLegacyNodeCard
      node={node}
      isSelected
      isHighlighted={false}
      isHovered={false}
      isRunning={false}
      theme={DEFAULT_WORKFLOW_NODE_THEME}
      imageModels={imageModels}
      llmModels={llmModels}
      onNodeFieldChange={(_id, field, value) => setNode(current => ({ ...current, config: { ...current.config, [field]: value } }))}
      onLlmOptimize={onOptimize}
      onSelect={vi.fn()}
      onHover={vi.fn()}
      onDragStart={vi.fn()}
      onPortMouseDown={vi.fn()}
      onPortMouseUp={vi.fn()}
      onDelete={vi.fn()}
      onDeselect={vi.fn()}
      onPreviewImage={vi.fn()}
      layout="embedded"
    />
    <output data-testid="node-config">{JSON.stringify(node.config)}</output>
  </>;
}

function imageNode(config: WorkflowNode['config'] = {}): WorkflowNode {
  const node = createWorkflowNode('ai-generate', 0, 0, 'image-node');
  return { ...node, config: { ...node.config, ...config } };
}

function selectedModel(): HTMLSelectElement {
  return screen.getAllByRole('combobox')[0] as HTMLSelectElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workflow inline exact model selection', () => {
  it('keeps every same-named provider option distinct', () => {
    render(<CardHarness initialNode={imageNode()} />);
    expect(Array.from(selectedModel().options).filter(option => option.value).map(option => option.value))
      .toEqual(['ailink::gpt-image-2', 'pear::gpt-image-2', 'apimart::gpt-image-2']);
  });

  it('round-trips Pear and APImart selections through config and execution requests', () => {
    const initialNode = imageNode({ providerId: 'ailink' });
    render(<CardHarness initialNode={initialNode} />);
    for (const providerId of ['pear', 'apimart']) {
      fireEvent.change(selectedModel(), { target: { value: `${providerId}::gpt-image-2` } });
      expect(selectedModel().selectedOptions[0]?.textContent).toContain(providerId === 'pear' ? '(Pear)' : '(APImart)');
      const config = JSON.parse(screen.getByTestId('node-config').textContent || '{}') as WorkflowNode['config'];
      expect(config.model).toBe(`${providerId}::gpt-image-2`);
      expect(buildNodeExecutionRequest({ ...initialNode, config }, {})?.body)
        .toMatchObject({ model: 'gpt-image-2', providerId });
    }
  });

  it.each([
    { model: 'pear::gpt-image-2', providerId: 'ailink' },
    { model: 'gpt-image-2', providerId: 'pear' },
  ])('restores an explicit provider without selecting the first same-named option: %j', config => {
    render(<CardHarness initialNode={imageNode(config)} />);
    expect(selectedModel().value).toBe('pear::gpt-image-2');
    expect(selectedModel().selectedOptions[0]?.textContent).toContain('(Pear)');
  });

  it.each(['gpt-image-2', 'removed::gpt-image-2'])('does not silently remap ambiguous or removed selections: %s', model => {
    render(<CardHarness initialNode={imageNode({ model })} />);
    expect(selectedModel().value).toBe('');
  });

  it('keeps the prompt optimizer provider in both the menu and callback', () => {
    const onOptimize = vi.fn();
    const node = createWorkflowNode('input-text', 0, 0, 'text-node');
    node.config = { ...node.config, llmEnabled: true, textContent: 'A product photo' };
    render(<CardHarness initialNode={node} onOptimize={onOptimize} />);
    fireEvent.change(selectedModel(), { target: { value: 'apimart::chat-model' } });
    expect(selectedModel().selectedOptions[0]?.textContent).toContain('(APImart)');
    fireEvent.click(screen.getByRole('button', { name: '优化' }));
    expect(onOptimize).toHaveBeenCalledWith(node.id, 'A product photo', 'apimart::chat-model', '', '');
  });

  it('migrates an unambiguous saved optimizer model without changing the saved project', () => {
    const onOptimize = vi.fn();
    const node = createWorkflowNode('input-text', 0, 0, 'text-node');
    node.config = { ...node.config, llmEnabled: true, llmModel: 'unique-chat', textContent: 'A product photo' };
    render(<CardHarness initialNode={node} onOptimize={onOptimize} />);
    expect(selectedModel().value).toBe('apimart::unique-chat');
    fireEvent.click(screen.getByRole('button', { name: '优化' }));
    expect(onOptimize).toHaveBeenCalledWith(node.id, 'A product photo', 'apimart::unique-chat', '', '');
    expect(JSON.parse(screen.getByTestId('node-config').textContent || '{}').llmModel).toBe('unique-chat');
  });

  it('sends the optimizer exact pair to the application API, not a composite model name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: 'Optimized product photo' })));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    const node = createWorkflowNode('input-text', 0, 0, 'optimizer-node');
    node.config = { ...node.config, llmEnabled: true, llmModel: 'apimart::chat-model', textContent: 'A product photo' };
    const workflow = { ...createEmptyWorkflow('Exact model test'), nodes: [node] };
    render(<NodeEditor
      workflow={workflow}
      canvasImages={[]}
      taskModelOptions={llmModels.map(model => ({ ...model, type: 'chat', providerId: model.providerId! }))}
    />);
    fireEvent.click(screen.getByRole('button', { name: '优化' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/chat')).toBe(true));
    const [, request] = fetchMock.mock.calls.find(([url]) => url === '/api/chat')!;
    expect(JSON.parse(request.body)).toMatchObject({ model: 'chat-model', providerId: 'apimart', stream: false });
  });

  it('keeps an ambiguous legacy image selection unselected in both card and properties', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    const node = imageNode({ model: 'gpt-image-2' });
    const workflow = { ...createEmptyWorkflow('Legacy selection test'), nodes: [node] };
    render(<NodeEditor
      workflow={workflow}
      canvasImages={[]}
      taskModelOptions={imageModels.map(model => ({ ...model, type: 'image', providerId: model.providerId! }))}
    />);
    fireEvent.mouseDown(screen.getByLabelText(node.label), { button: 0 });
    fireEvent.mouseUp(screen.getByLabelText(node.label), { button: 0 });
    const modelSelects = (screen.getAllByRole('combobox') as HTMLSelectElement[])
      .filter(element => Array.from(element.options).some(option => option.value.includes('gpt-image-2')));
    expect(modelSelects).toHaveLength(2);
    expect(modelSelects.map(select => select.value)).toEqual(['', '']);
  });

  it.each([
    ['执行工作流', 'gpt-image-2'],
    ['RUN', 'gpt-image-2'],
    ['执行工作流', 'removed::gpt-image-2'],
    ['RUN', 'removed::gpt-image-2'],
  ])('blocks unresolved image execution before a request: %s / %s', async (buttonName, model) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    const node = imageNode({ model });
    render(<NodeEditor
      workflow={{ ...createEmptyWorkflow('Ambiguous legacy execution'), nodes: [node] }}
      canvasImages={[]}
      taskModelOptions={imageModels.map(model => ({ ...model, type: 'image', providerId: model.providerId! }))}
    />);
    fireEvent.click(screen.getByRole('button', { name: buttonName }));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/workflow/execute')).toHaveLength(0);
    expect(await screen.findByText(/请重新选择明确的图像模型及供应商/)).toBeTruthy();
  });

  it('freezes a unique legacy image selection in the execution copy without rewriting the project', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    const node = imageNode({ model: 'gpt-image-2' });
    render(<NodeEditor
      workflow={{ ...createEmptyWorkflow('Unique legacy execution'), nodes: [node] }}
      canvasImages={[]}
      taskModelOptions={[{ ...imageModels[1], type: 'image', providerId: 'pear' }]}
    />);
    fireEvent.click(screen.getByRole('button', { name: '执行工作流' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/workflow/execute')).toBe(true));
    const [, request] = fetchMock.mock.calls.find(([url]) => url === '/api/workflow/execute')!;
    expect(JSON.parse(request.body).nodes[0].config).toMatchObject({ model: 'pear::gpt-image-2', providerId: 'pear' });
    expect(node.config.model).toBe('gpt-image-2');
    expect(node.config.providerId).toBeUndefined();
  });

  it.each(['chat-model', 'removed::chat-model'])('does not allow the optimizer to submit an unresolved model: %s', model => {
    const onOptimize = vi.fn();
    const node = createWorkflowNode('input-text', 0, 0, 'text-node');
    node.config = { ...node.config, llmEnabled: true, llmModel: model, textContent: 'A product photo' };
    render(<CardHarness initialNode={node} onOptimize={onOptimize} />);
    const button = screen.getByRole('button', { name: '优化' }) as HTMLButtonElement;
    expect(selectedModel().value).toBe('');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onOptimize).not.toHaveBeenCalled();
  });
});
