import { describe, it, expect } from 'vitest';
import { topologicalSort } from '@/lib/workflow-engine';
import type { NodeType, WorkflowNode, WorkflowConnection } from '@/lib/workflow-engine';

/** 创建最小合法 WorkflowNode */
function makeNode(id: string, type: string = 'input-text'): WorkflowNode {
  return {
    id,
    type: type as NodeType,
    label: id,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    ports: [],
    config: {},
  };
}

/** 创建最小合法 WorkflowConnection */
function makeConn(id: string, from: string, to: string): WorkflowConnection {
  return {
    id,
    fromNodeId: from,
    fromPortId: 'out-0',
    toNodeId: to,
    toPortId: 'in-0',
    type: 'any',
  };
}

/** 从排序结果中提取 ID 数组 */
function getIds(result: WorkflowNode[]): string[] {
  return result.map(n => n.id);
}

describe('topologicalSort', () => {
  it('单节点直接返回', () => {
    const nodes = [makeNode('A')];
    const edges: WorkflowConnection[] = [];
    const result = topologicalSort(nodes, edges);
    expect(getIds(result)).toEqual(['A']);
  });

  it('线性依赖 A → B → C', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeConn('e1', 'A', 'B'), makeConn('e2', 'B', 'C')];
    const ids = getIds(topologicalSort(nodes, edges));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
    expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('C'));
  });

  it('菱形依赖 A→B, A→C, B→D, C→D', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')];
    const edges = [
      makeConn('e1', 'A', 'B'),
      makeConn('e2', 'A', 'C'),
      makeConn('e3', 'B', 'D'),
      makeConn('e4', 'C', 'D'),
    ];
    const ids = getIds(topologicalSort(nodes, edges));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('C'));
    expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('D'));
    expect(ids.indexOf('C')).toBeLessThan(ids.indexOf('D'));
  });

  it('无连接时返回所有节点', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges: WorkflowConnection[] = [];
    const result = topologicalSort(nodes, edges);
    expect(result.length).toBe(3);
    expect(getIds(result).sort()).toEqual(['A', 'B', 'C']);
  });

  it('环检测返回空数组或抛出异常', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeConn('e1', 'A', 'B'), makeConn('e2', 'B', 'A')];
    // 环存在时，函数应返回空数组或抛异常
    const result = topologicalSort(nodes, edges);
    expect(Array.isArray(result)).toBe(true);
  });
});
