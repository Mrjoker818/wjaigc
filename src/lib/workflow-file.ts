import {
  canConnectPorts, createConnection, createEmptyWorkflow, NODE_TYPE_LABELS,
  parseComfyUIWorkflow, PORT_COMPATIBILITY, topologicalSort, type NodePort, type Workflow,
  type WorkflowConnection, type WorkflowNode,
} from './workflow-engine';

type WorkflowGraph = Pick<Workflow, 'nodes' | 'connections'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every(key => typeof value[key] === 'string');
}

function hasUniqueIds(items: readonly { id: string }[]): boolean {
  return items.every(item => item.id.trim()) && new Set(items.map(item => item.id)).size === items.length;
}

function isNodePort(value: unknown): value is NodePort {
  return isRecord(value) && hasStrings(value, ['id', 'label', 'type'])
    && Object.hasOwn(PORT_COMPATIBILITY, value.type as string)
    && (value.direction === 'in' || value.direction === 'out');
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  return isRecord(value) && hasStrings(value, ['id', 'type', 'label'])
    && Object.hasOwn(NODE_TYPE_LABELS, value.type as string)
    && [value.x, value.y, value.width, value.height].every(dimension => typeof dimension === 'number' && Number.isFinite(dimension))
    && isRecord(value.config) && Array.isArray(value.ports) && value.ports.every(isNodePort)
    && hasUniqueIds(value.ports);
}

function isWorkflowConnection(value: unknown): value is WorkflowConnection {
  return isRecord(value) && hasStrings(value, ['id', 'fromNodeId', 'fromPortId', 'toNodeId', 'toPortId', 'type'])
    && Object.hasOwn(PORT_COMPATIBILITY, value.type as string);
}

export function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.connections)
    || !value.nodes.every(isWorkflowNode) || !value.connections.every(isWorkflowConnection)
    || !hasUniqueIds(value.nodes) || !hasUniqueIds(value.connections)) return false;

  const nodes: WorkflowNode[] = value.nodes;
  const connections: WorkflowConnection[] = value.connections;
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const edge of connections) {
    const source = byId.get(edge.fromNodeId);
    const from = source?.ports.find(port => port.id === edge.fromPortId && port.direction === 'out');
    const to = byId.get(edge.toNodeId)?.ports.find(port => port.id === edge.toPortId && port.direction === 'in');
    if (!source || !from || !to || edge.fromNodeId === edge.toNodeId) return false;

    // The executor accepts legacy 'any' bindings between compatible ports and
    // allows loop control signals to enter a typed body node.
    const loopControl = ['loop-for', 'loop-each', 'loop-while'].includes(source.type)
      && ['out-loop', 'out-done'].includes(from.id);
    if (!loopControl && (!canConnectPorts(from.type, to.type) || (edge.type !== 'any' && edge.type !== from.type))) {
      return false;
    }
  }

  try {
    topologicalSort(nodes, connections);
    return true;
  } catch {
    return false;
  }
}

function isComfyId(value: unknown): value is string | number {
  return (typeof value === 'string' && value.trim().length > 0) || Number.isSafeInteger(value);
}

function isComfySlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function addComfyEdge(workflow: Workflow, from: WorkflowNode | undefined, out: NodePort | undefined,
  to: WorkflowNode | undefined, input: NodePort | undefined): boolean {
  if (!from || !out || !to || !input || !canConnectPorts(out.type, input.type)) return false;
  workflow.connections.push(createConnection(from.id, out.id, to.id, input.id, out.type));
  return true;
}

const COMFY_INPUT_ALIASES: Readonly<Record<string, string>> = {
  image: 'in-image', images: 'in-image', pixels: 'in-image', mask: 'in-mask',
  prompt: 'in-prompt', positive: 'in-prompt', text: 'in-prompt',
};

const COMFY_OUTPUT_TYPES: Readonly<Record<string, NodePort['type']>> = {
  IMAGE: 'image', MASK: 'mask', CONDITIONING: 'prompt', STRING: 'prompt',
};

function getComfyPortType(type: unknown): NodePort['type'] | undefined {
  return typeof type === 'string' && Object.hasOwn(COMFY_OUTPUT_TYPES, type)
    ? COMFY_OUTPUT_TYPES[type] : undefined;
}

function comfyInputPort(node: WorkflowNode, name: string): NodePort | undefined {
  const alias = Object.hasOwn(COMFY_INPUT_ALIASES, name) ? COMFY_INPUT_ALIASES[name] : undefined;
  return node.ports.find(port => port.direction === 'in' && port.id === name)
    ?? node.ports.find(port => port.direction === 'in' && port.id === alias);
}

function comfyOutputPort(node: WorkflowNode, slot: number, type?: unknown): NodePort | undefined {
  // ComfyUI text encoders expose conditioning in slot zero. The native
  // text node also exposes a data output before its prompt output.
  const outputs = node.ports.filter(port => port.direction === 'out');
  const port = slot === 0 && type === 'CONDITIONING' && node.type === 'input-text'
    ? outputs.find(candidate => candidate.id === 'out-prompt')
    : outputs[slot];
  const expected = getComfyPortType(type);
  return expected && port?.type !== expected ? undefined : port;
}

function importComfyFrontend(nodes: unknown[], links: unknown[]): Workflow | null {
  const originals = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    if (!isRecord(node) || !isComfyId(node.id) || typeof node.type !== 'string' || !node.type.trim()) return null;
    const id = String(node.id);
    if (originals.has(id)) return null;
    originals.set(id, node);
  }

  // Reuse the engine's node conversion, but bind links before exposing the graph.
  const workflow = parseComfyUIWorkflow(JSON.stringify({ nodes, links: [] }));
  if (!workflow || workflow.nodes.length !== originals.size) return null;
  const byId = new Map([...originals.keys()].map((id, index) => [id, workflow.nodes[index]]));
  const linkIds = new Set<string>();
  const boundInputs = new Set<string>();
  for (const link of links) {
    if (!Array.isArray(link)) return null;
    const [id, fromId, fromSlot, toId, toSlot, type] = link;
    if (!isComfyId(id) || !isComfyId(fromId) || !isComfyId(toId)
      || !isComfySlot(fromSlot) || !isComfySlot(toSlot) || linkIds.has(String(id))) return null;
    linkIds.add(String(id));
    const from = byId.get(String(fromId));
    const to = byId.get(String(toId));
    if (!from || !to) return null;
    const outputs = originals.get(String(fromId))?.outputs;
    const inputs = originals.get(String(toId))?.inputs;
    if ((Array.isArray(outputs) && !isRecord(outputs[fromSlot]))
      || (Array.isArray(inputs) && !isRecord(inputs[toSlot]))) return null;
    const declaredOutput = Array.isArray(outputs) ? outputs[fromSlot] : undefined;
    const declaredInput = Array.isArray(inputs) ? inputs[toSlot] : undefined;
    const out = comfyOutputPort(from, fromSlot, getComfyPortType(declaredOutput?.type) ? declaredOutput.type : type);
    const linkType = getComfyPortType(type);
    const input = isRecord(declaredInput) && typeof declaredInput.name === 'string'
      ? comfyInputPort(to, declaredInput.name)
      : to.ports.filter(port => port.direction === 'in')[toSlot];
    if (!out || !input || (linkType && out.type !== linkType)) return null;
    const binding = JSON.stringify([String(toId), input.id]);
    if (boundInputs.has(binding) || !addComfyEdge(workflow, from, out, to, input)) return null;
    boundInputs.add(binding);
  }
  return isWorkflowGraph(workflow) ? workflow : null;
}

function isComfyReference(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';
}

function importComfyApi(data: Record<string, unknown>): Workflow | null {
  const entries = Object.entries(data).filter((entry): entry is [string, Record<string, unknown>] =>
    isRecord(entry[1]) && typeof entry[1].class_type === 'string' && Boolean(entry[1].class_type.trim()));
  const nodeData = Object.fromEntries(entries.map(([id, node]) => [id, {
    ...node,
    inputs: isRecord(node.inputs)
      ? Object.fromEntries(Object.entries(node.inputs).filter(([, value]) => !isComfyReference(value)))
      : {},
  }]));
  const workflow = parseComfyUIWorkflow(JSON.stringify(nodeData));
  if (!workflow || workflow.nodes.length !== entries.length) return null;
  const byId = new Map(entries.map(([id], index) => [id, workflow.nodes[index]]));

  for (const [id, node] of entries) {
    const to = byId.get(id)!;
    if (!isRecord(node.inputs)) continue;
    const boundInputs = new Set<string>();
    for (const [name, value] of Object.entries(node.inputs)) {
      if (!isComfyReference(value)) continue;
      const [fromId, slot] = value;
      const from = byId.get(fromId);
      const input = comfyInputPort(to, name);
      if (!from || !input || !isComfySlot(slot) || boundInputs.has(input.id)
        || !addComfyEdge(workflow, from, comfyOutputPort(from, slot, name === 'positive' ? 'CONDITIONING' : undefined), to, input)) return null;
      boundInputs.add(input.id);
    }
  }
  return isWorkflowGraph(workflow) ? workflow : null;
}

export function importWorkflowFile(text: string): Workflow | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { name, description } = parsed;
  if (isWorkflowGraph(parsed)) {
    const workflow = createEmptyWorkflow(typeof name === 'string' && name.trim() ? name : '导入工作流');
    if (typeof description === 'string') workflow.description = description;
    return { ...workflow, nodes: parsed.nodes, connections: parsed.connections };
  }
  if (Object.hasOwn(parsed, 'connections')) return null;
  if (Array.isArray(parsed.nodes)) {
    return Array.isArray(parsed.links) ? importComfyFrontend(parsed.nodes, parsed.links) : null;
  }
  return importComfyApi(parsed);
}
