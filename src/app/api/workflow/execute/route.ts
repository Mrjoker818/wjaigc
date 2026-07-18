/**
 * 工作流执行 API
 * POST /api/workflow/execute
 *
 * 执行工作流：DAG拓扑排序 → 逐节点调度 → API调用 → 真实数据传递
 * 支持: start(启动) / status(查询) / cancel(取消)
 *
 * P0: 连线语义类型约束 + 节点间真实数据传递 + 画布模式专用节点
 * P0升级: 串行等待执行 — 上游节点失败时跳过下游节点
 */
import { NextRequest, NextResponse } from 'next/server';
import { getInternalApiUrl } from '@/lib/api-helpers';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  topologicalSort,
  getNodeInputs,
  evaluateWorkflowCondition,
  resolveGroupOutput,
  resolveInlineSubgraph,
  resolveControlOutputPorts,
  resolveWorkflowIterations,
  shouldSkipNodeForInactiveBranches,
  buildNodeExecutionRequest,
  replaceLoopVariables,
  type WorkflowNode,
  type WorkflowConnection,
  type ExecutionResult,
  type NodeType,
} from '@/lib/workflow-engine';
import { findProviderForModel, findProviderForFeature, findProviderById } from '@/lib/server-api-config';
import { normalizeModelForApi } from '@/lib/model-capabilities';
import { validateApiInputs } from '@/lib/api-validator';
import { logError, OP_ACTIONS } from '@/lib/op-log';
import { createCloudTask, getCloudTaskForUser, updateCloudTask } from '@/lib/cloud-task-storage';

type WorkflowExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface WorkflowExecutionState {
  status: WorkflowExecutionStatus;
  results: Record<string, ExecutionResult>;
  currentNodeId: string | null;
  startedAt: number;
  completedAt: number | null;
  error?: string;
  userId?: string;
  totalNodes: number;
}

// 内存中的执行状态
const executionCache = new Map<string, WorkflowExecutionState>();

// 30分钟后自动清理
const CLEANUP_MS = 30 * 60 * 1000;
const wfCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of executionCache) {
    if (val.completedAt && now - val.completedAt > CLEANUP_MS) {
      executionCache.delete(key);
    }
  }
}, 5 * 60 * 1000);
if (wfCleanupTimer && typeof wfCleanupTimer === 'object' && 'unref' in wfCleanupTimer) {
  wfCleanupTimer.unref();
}

function toCloudWorkflowStatus(status: WorkflowExecutionStatus): 'processing' | 'completed' | 'failed' | 'cancelled' {
  return status === 'running' ? 'processing' : status;
}

function fromCloudWorkflowStatus(status: string): WorkflowExecutionStatus {
  return status === 'processing' || status === 'queued' || status === 'pending' ? 'running'
    : status === 'completed' || status === 'cancelled' ? status
      : 'failed';
}

async function persistWorkflowExecution(executionId: string, execState: WorkflowExecutionState): Promise<void> {
  if (!execState.userId) return;
  try {
    await updateCloudTask(executionId, {
      status: toCloudWorkflowStatus(execState.status),
      progress: execState.status === 'running'
        ? Math.min(99, Math.round((Object.keys(execState.results).length / Math.max(execState.totalNodes, 1)) * 100))
        : 100,
      label: execState.currentNodeId ? `执行节点 ${execState.currentNodeId}` : '工作流执行',
      result: {
        currentNodeId: execState.currentNodeId,
        results: execState.results,
        startedAt: execState.startedAt,
        completedAt: execState.completedAt,
      },
      error: execState.error,
    });
  } catch (error) {
    console.warn('[Workflow] 执行状态持久化失败:', error);
  }
}

function hydrateInlineSubgraphInputs(nodes: WorkflowNode[], parentInputs: Record<string, unknown>): WorkflowNode[] {
  return nodes.map(node => {
    if (!node.type.startsWith('input-') && node.type !== 'audio-input') return node;
    return { ...node, config: { ...parentInputs, ...node.config } };
  });
}

function collectInlineSubgraphOutput(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  results: Record<string, ExecutionResult>,
): Record<string, unknown> {
  const sourceIds = new Set(connections.map(connection => connection.fromNodeId));
  return nodes
    .filter(node => !sourceIds.has(node.id))
    .reduce<Record<string, unknown>>((output, node) => ({ ...output, ...(results[node.id]?.output || {}) }), {});
}

/**
 * 节点类型 → 所需API功能映射
 */
function getFeatureForNodeType(type: NodeType): 'imageEdit' | 'chat' | 'vectorize' | 'layer' | '3d' | 'video' {
  if (type === 'ai-analyze') return 'chat';
  if (type === 'ai-vectorize') return 'vectorize';
  if (type === 'ai-segment') return 'layer';
  if (type === 'ai-3d-model') return '3d';
  if (type === 'agent-auto' || type === 'agent-chat') return 'chat';
  // 视频生成/编辑节点 → video
  if (type === 'ai-video-generate' || type === 'ai-video-i2v' ||
      type === 'video-speed-change' || type === 'video-trim' ||
      type === 'video-concat' || type === 'video-filter' ||
      type === 'video-compose' || type === 'video-extract-frames') return 'video';
  // 图像生成/编辑/修图/字境/精修/品牌 → imageEdit
  return 'imageEdit';
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    // 输入校验
    const _validationError = validateApiInputs(body, {
        prompt: 'optionalPrompt'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const { action, executionId, nodes, connections } = body;

    // ─── 查询执行状态 ───
    if (action === 'status') {
      if (!executionId) {
        return NextResponse.json({ error: '缺少 executionId' }, { status: 400 });
      }
      const exec = executionCache.get(executionId);
      if (!exec) {
        if (auth.userId) {
          const persisted = await getCloudTaskForUser(executionId, auth.userId);
          if (persisted?.type === 'workflow') {
            const result = persisted.result || {};
            return NextResponse.json({
              executionId,
              status: fromCloudWorkflowStatus(persisted.status),
              currentNodeId: result.currentNodeId || null,
              results: result.results || {},
              startedAt: result.startedAt || persisted.createdAt,
              completedAt: result.completedAt || (persisted.status === 'processing' ? null : persisted.updatedAt),
              error: persisted.error,
            });
          }
        }
        return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
      }
      if (exec.userId && exec.userId !== auth.userId) {
        return NextResponse.json({ error: '无权访问该执行记录' }, { status: 403 });
      }
      return NextResponse.json({
        executionId,
        status: exec.status,
        currentNodeId: exec.currentNodeId,
        results: exec.results,
        startedAt: exec.startedAt,
        completedAt: exec.completedAt,
        error: exec.error,
      });
    }

    // ─── 取消执行 ───
    if (action === 'cancel') {
      if (!executionId) {
        return NextResponse.json({ error: '缺少 executionId' }, { status: 400 });
      }
      const exec = executionCache.get(executionId);
      if (exec?.userId && exec.userId !== auth.userId) {
        return NextResponse.json({ error: '无权取消该执行记录' }, { status: 403 });
      }
      if (exec && exec.status === 'running') {
        exec.status = 'cancelled';
        exec.completedAt = Date.now();
        await persistWorkflowExecution(executionId, exec);
      } else if (auth.userId) {
        const persisted = await getCloudTaskForUser(executionId, auth.userId);
        if (persisted?.type === 'workflow') {
          await updateCloudTask(executionId, { status: 'cancelled', progress: 100, error: '用户取消执行' });
        }
      }
      return NextResponse.json({ executionId, status: 'cancelled' });
    }

    // ─── 节点重试 (B2) ─── 仅重试单个失败节点，不重跑全流程
    if (action === 'retry') {
      if (!executionId) {
        return NextResponse.json({ error: '缺少 executionId' }, { status: 400 });
      }
      const { nodeId } = body;
      if (!nodeId) {
        return NextResponse.json({ error: '缺少 nodeId' }, { status: 400 });
      }
      const exec = executionCache.get(executionId);
      if (!exec) {
        return NextResponse.json({ error: '执行实例不存在或已过期' }, { status: 404 });
      }
      if (exec.userId && exec.userId !== auth.userId) {
        return NextResponse.json({ error: '无权重试该执行记录' }, { status: 403 });
      }
      const retryNode = (body.nodes || []).find((node: WorkflowNode) => node.id === nodeId);
      if (!retryNode) {
        return NextResponse.json({ error: '节点不存在' }, { status: 404 });
      }
      try {
        const retryResultMap = new Map(Object.entries(exec.results || {}));
        const nodeInputs = getNodeInputs(retryNode, body.connections || [], retryResultMap);
        const req = buildNodeExecutionRequest(retryNode, nodeInputs);
        if (!req) {
          // 纯逻辑节点：直接成功
          exec.results[nodeId] = { nodeId, status: 'success', output: { ...nodeInputs, _type: retryNode.type }, durationMs: 0 };
          await persistWorkflowExecution(executionId, exec);
          return NextResponse.json({ success: true, nodeId, output: { ...nodeInputs, _type: retryNode.type } });
        }
        // 获取 API 凭证
        let apiKey = ''; let baseUrl = '';
        const providerId = retryNode.config?.providerId as string | undefined;
        const modelName = String(nodeInputs.model || retryNode.config?.model || '');
        if (providerId) { const p = await findProviderById(providerId); if (p) { apiKey = p.apiKey; baseUrl = p.baseUrl; } }
        if (!apiKey && modelName) { const p = await findProviderForModel(modelName, undefined, providerId); if (p) { apiKey = p.apiKey; baseUrl = p.baseUrl; } }
        if (!apiKey || !baseUrl) {
          const feature = getFeatureForNodeType(retryNode.type as NodeType);
          const p = await findProviderForFeature(feature);
          if (p) { apiKey = apiKey || p.apiKey; baseUrl = baseUrl || p.baseUrl; }
        }
        const isInternal = req.endpoint.startsWith('/api/');
        const apiUrl = isInternal
          ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${req.endpoint}`
          : baseUrl ? `${baseUrl.replace(/\/+$/, '')}${req.endpoint}` : req.endpoint;
        const apiRes = await fetch(apiUrl, {
          method: req.method,
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(300000),
        });
        if (!apiRes.ok) {
          const errText = await apiRes.text().catch(() => '');
          throw new Error(errText || `API ${apiRes.status}`);
        }
        const data = await apiRes.json();
        exec.results[nodeId] = { nodeId, status: 'success', output: data, durationMs: 0 };
        await persistWorkflowExecution(executionId, exec);
        return NextResponse.json({ success: true, nodeId, output: data });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        exec.results[nodeId] = { nodeId, status: 'failed', error: message, durationMs: 0 };
        await persistWorkflowExecution(executionId, exec);
        return NextResponse.json({ success: false, nodeId, error: message });
      }
    }

    // ─── 启动执行 ───
    if (action !== 'start') {
      return NextResponse.json({ error: '无效的 action，支持: start, status, cancel, retry' }, { status: 400 });
    }

    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return NextResponse.json({ error: '节点列表不能为空' }, { status: 400 });
    }

    const executionIdNew = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const execState: WorkflowExecutionState = {
      status: 'running',
      results: {},
      currentNodeId: null,
      startedAt: Date.now(),
      completedAt: null,
      userId: auth.userId,
      totalNodes: nodes.length,
    };
    executionCache.set(executionIdNew, execState);

    if (auth.userId) {
      try {
        await createCloudTask({
          id: executionIdNew,
          userId: auth.userId,
          type: 'workflow',
          status: 'processing',
          progress: 0,
          label: '工作流执行',
          result: { currentNodeId: null, results: {}, startedAt: execState.startedAt, completedAt: null },
          createdAt: execState.startedAt,
          updatedAt: execState.startedAt,
        });
      } catch (error) {
        console.warn('[Workflow] 创建持久化执行记录失败:', error);
      }
    }

    // 异步执行工作流
    executeWorkflow(executionIdNew, execState, nodes, connections || []).catch(err => {
      console.error('[Workflow] 执行异常:', err);
      execState.status = 'failed';
      execState.error = err instanceof Error ? err.message : String(err);
      execState.completedAt = Date.now();
      void persistWorkflowExecution(executionIdNew, execState);
    });

    return NextResponse.json({
      executionId: executionIdNew,
      status: 'running',
      message: '工作流已开始执行',
    });

  } catch (error) {
    console.error('[Workflow] 请求处理失败:', error);
    logError(OP_ACTIONS.WORKFLOW_EXECUTE, error, { targetType: 'workflow' });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '工作流执行失败' },
      { status: 500 }
    );
  }
}

/**
 * 执行工作流核心逻辑
 * DAG排序 → 逐节点调度 → API调用 → 结果传递到下游
 * P0升级: 串行等待执行 — 检查上游节点是否都成功，失败则跳过下游
 */
async function executeWorkflow(
  executionId: string,
  execState: WorkflowExecutionState,
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  depth = 0,
) {
  console.log(`[Workflow] 开始执行 ${executionId}, ${nodes.length} 个节点`);

  // 1. DAG拓扑排序
  const sorted = topologicalSort(nodes, connections);
  const resultMap = new Map<string, ExecutionResult>();

  // P1: 循环上下文栈 — 跟踪嵌套循环节点
  const loopContextStack: Array<{ loopNodeId: string; index: number; total: number }> = [];

  // 2. 构建上游映射 (用于串行等待检测)
  const upstreamMap = new Map<string, string[]>();
  for (const node of nodes) {
    const upstreamIds = connections
      .filter(c => c.toNodeId === node.id)
      .map(c => c.fromNodeId);
    if (upstreamIds.length > 0) {
      upstreamMap.set(node.id, [...new Set(upstreamIds)]);
    }
  }

  // 3. 逐节点执行
  for (const node of sorted) {
    // 检查是否被取消
    if (execState.status === 'cancelled') {
      console.log(`[Workflow] 执行被取消: ${executionId}`);
      break;
    }

    // 检查是否已在循环节点内执行过
    if (resultMap.has(node.id)) {
      execState.results[node.id] = resultMap.get(node.id)!;
      continue;
    }

    // P0: 串行等待 — 检查上游节点是否全部成功
    const upstreamIds = upstreamMap.get(node.id) || [];
    const upstreamFailed = upstreamIds.some(uid => {
      const upResult = resultMap.get(uid);
      return !upResult || upResult.status === 'failed';
    });

    if (upstreamFailed && upstreamIds.length > 0) {
      // 上游有失败节点，跳过当前节点
      const failedUpstream = upstreamIds
        .filter(uid => { const r = resultMap.get(uid); return !r || r.status === 'failed'; })
        .map(uid => nodes.find(n => n.id === uid)?.label || uid);
      console.log(`[Workflow] 跳过节点 ${node.label}: 上游节点失败 [${failedUpstream.join(', ')}]`);
      const result: ExecutionResult = {
        nodeId: node.id,
        status: 'skipped',
        error: `上游节点失败: ${failedUpstream.join(', ')}`,
        durationMs: 0,
      };
      resultMap.set(node.id, result);
      execState.results[node.id] = result;
      continue;
    }

    if (shouldSkipNodeForInactiveBranches(node, connections, resultMap)) {
      const result: ExecutionResult = {
        nodeId: node.id,
        status: 'skipped',
        error: '条件分支未命中',
        durationMs: 0,
      };
      resultMap.set(node.id, result);
      execState.results[node.id] = result;
      continue;
    }

    execState.currentNodeId = node.id;
    await persistWorkflowExecution(executionId, execState);
    const nodeStart = Date.now();

    // P1: 循环计数器变量 — 获取当前循环上下文
    const currentLoopContext = loopContextStack.length > 0 ? loopContextStack[loopContextStack.length - 1] : null;

    try {
      // P0: 真实数据传递 — 从上游节点获取输入
      const inputs = getNodeInputs(node, connections, resultMap);

      // P1: 对输入文本应用循环变量替换
      if (currentLoopContext) {
        const { index, total } = currentLoopContext;
        for (const key of Object.keys(inputs)) {
          if (typeof inputs[key] === 'string') {
            inputs[key] = replaceLoopVariables(inputs[key] as string, index, total);
          }
        }
      }

      // P0: 自动注入缺失的 providerId — 当 AI 建图或历史节点缺少 providerId 时，根据 model 名自动查找
      if (node.config.model && !node.config.providerId) {
        const modelStr = String(node.config.model);
        // 解析复合键
        const sepIdx = modelStr.indexOf('::');
        const pureModelId = sepIdx >= 0 ? modelStr.slice(sepIdx + 2) : modelStr;
        const existingProviderId = sepIdx >= 0 ? modelStr.slice(0, sepIdx) : '';
        if (!existingProviderId) {
          const provider = await findProviderForModel(pureModelId, undefined, undefined);
          if (provider) {
            node.config.providerId = provider.id;
            console.log(`[workflow-execute] 自动注入 providerId=${provider.id} for model=${pureModelId}`);
          }
        } else {
          node.config.providerId = existingProviderId;
          // ★ 规范化模型名别名（使用provider的模型列表精确匹配，避免误剥离-4k/-2k后缀）
          let wfProviderModels: string[] = [];
          try {
            const wfProvider = await findProviderById(existingProviderId);
            wfProviderModels = wfProvider?.selectedModels || [];
          } catch {}
          const wfModelNorm = normalizeModelForApi(pureModelId, { providerModels: wfProviderModels });
          let wfApiModelName = pureModelId;
          if (wfModelNorm.wasNormalized && !wfProviderModels.includes(pureModelId)) {
            wfApiModelName = wfModelNorm.apiModelName;
            console.log(`[workflow-execute] Normalized model alias: "${pureModelId}" → "${wfApiModelName}" (provider does not have exact model)`);
          }
          node.config.model = wfApiModelName;
        }
      }

      // 构建执行请求
      if (node.type === 'ai-generate') {
        console.log('[workflow-execute] ai-generate inputs:', JSON.stringify(inputs));
        console.log('[workflow-execute] ai-generate node.config:', JSON.stringify(node.config));
        // 找出所有连到此节点的连线
        const incomingConns = connections.filter(c => c.toNodeId === node.id);
        console.log('[workflow-execute] ai-generate incoming connections:', JSON.stringify(incomingConns));
        for (const c of incomingConns) {
          const upResult = resultMap.get(c.fromNodeId);
          console.log(`[workflow-execute] upstream ${c.fromNodeId} result:`, JSON.stringify(upResult?.output));
        }
      }
      const req = buildNodeExecutionRequest(node, inputs);

      // P1: 对请求中的提示词字段应用循环变量替换
      if (currentLoopContext && req) {
        const { index, total } = currentLoopContext;
        const body = req.body as Record<string, unknown>;
        for (const key of Object.keys(body)) {
          if (typeof body[key] === 'string') {
            body[key] = replaceLoopVariables(body[key] as string, index, total);
          }
        }
      }

      // 逻辑节点/输出节点不需要外部API调用
      if (!req) {
        const outputData: Record<string, unknown> = { ...inputs, _type: node.type };
        if (node.type === 'condition-if' || node.type === 'condition-switch' || node.type === 'parallel') {
          outputData.activePorts = resolveControlOutputPorts(node, inputs);
        }
        // input-text 节点: text/contentEditable → prompt 映射，供下游节点读取
        if (node.type === 'input-text') {
          const textValue = outputData.textContent || outputData.text;
          if (textValue && !outputData.prompt) {
            outputData.prompt = textValue;
            outputData.text = textValue;
          }
        }
        // input-image 节点: 确保有 imageUrl
        if (node.type === 'input-image' && !outputData.imageUrl && node.config.imageUrl) {
          outputData.imageUrl = node.config.imageUrl;
        }
        if (node.type === 'group') {
          Object.assign(outputData, resolveGroupOutput(inputs));
        }
        if (node.type === 'subgraph') {
          if (depth >= 3) throw new Error('子图嵌套深度不能超过 3 层');
          const inlineSubgraph = resolveInlineSubgraph(node);
          if (!inlineSubgraph) throw new Error('子图配置无效：需要合法的 nodes 和 connections');
          const childState: WorkflowExecutionState = {
            status: 'running',
            results: {},
            currentNodeId: null,
            startedAt: Date.now(),
            completedAt: null,
            totalNodes: inlineSubgraph.nodes.length,
          };
          const childNodes = hydrateInlineSubgraphInputs(inlineSubgraph.nodes, inputs);
          await executeWorkflow(`${executionId}:${node.id}`, childState, childNodes, inlineSubgraph.connections, depth + 1);
          if (childState.status !== 'completed') {
            throw new Error(childState.error || '子图执行失败');
          }
          Object.assign(outputData, collectInlineSubgraphOutput(childNodes, inlineSubgraph.connections, childState.results));
          outputData.subgraphResults = childState.results;
          outputData.subgraphDepth = depth + 1;
        }
        const isLoopNode = node.type === 'loop-for' || node.type === 'loop-each' || node.type === 'loop-while';
        const loopIterations = isLoopNode ? resolveWorkflowIterations(node, inputs) : [];
        if (isLoopNode) {
          outputData.loopCount = loopIterations.length;
          outputData._loopNodeId = node.id;
          // Loop bodies run below; the normal DAG pass may only continue through out-done.
          outputData.activePorts = ['out-done'];
        }
        const result: ExecutionResult = {
          nodeId: node.id,
          status: 'success',
          output: outputData,
          durationMs: Date.now() - nodeStart,
        };
        resultMap.set(node.id, result);
        execState.results[node.id] = result;

        if (node.type === 'parallel') {
          const activePorts = new Set(Array.isArray(outputData.activePorts) ? outputData.activePorts : []);
          const parallelTargetIds = new Set(
            connections
              .filter(connection => connection.fromNodeId === node.id && activePorts.has(connection.fromPortId))
              .map(connection => connection.toNodeId),
          );
          const parallelBranches = sorted.filter(candidate => {
            if (!parallelTargetIds.has(candidate.id)) return false;
            const incoming = connections.filter(connection => connection.toNodeId === candidate.id);
            return incoming.every(connection => connection.fromNodeId === node.id || resultMap.has(connection.fromNodeId));
          });
          const branchStates = await Promise.all(parallelBranches.map(async branch => {
            const branchInputs = getNodeInputs(branch, connections, resultMap);
            const branchNode = { ...branch, config: { ...branch.config, ...inputs, ...branchInputs } };
            const branchState: WorkflowExecutionState = {
              status: 'running',
              results: {},
              currentNodeId: null,
              startedAt: Date.now(),
              completedAt: null,
              totalNodes: 1,
            };
            await executeWorkflow(`${executionId}:${node.id}:${branch.id}`, branchState, [branchNode], [], depth);
            return { nodeId: branch.id, state: branchState };
          }));
          const parallelResults: Record<string, ExecutionResult> = {};
          for (const branch of branchStates) {
            const branchResult = branch.state.results[branch.nodeId];
            if (!branchResult) continue;
            parallelResults[branch.nodeId] = branchResult;
            resultMap.set(branch.nodeId, branchResult);
            execState.results[branch.nodeId] = branchResult;
          }
          outputData.parallelResults = parallelResults;
        }

        if (isLoopNode) {
          const outgoing = connections.filter(connection => connection.fromNodeId === node.id);
          const explicitLoopBody = outgoing.filter(connection => connection.fromPortId === 'out-loop');
          const loopBodyConnections = explicitLoopBody.length > 0
            ? explicitLoopBody
            : outgoing.filter(connection => connection.fromPortId !== 'out-done');
          const loopBodyIds = new Set(loopBodyConnections.map(connection => connection.toNodeId));
          const downstreamNodes = sorted.filter(candidate => loopBodyIds.has(candidate.id));
          let lastLoopOutput: Record<string, unknown> | undefined;
          for (const loopIteration of loopIterations) {
            if (node.type === 'loop-while' && loopIteration.index > 1) {
              const condition = String(inputs.condition || node.config.condition || node.condition || '');
              if (!evaluateWorkflowCondition(condition, {
                ...inputs,
                result: lastLoopOutput ?? inputs.result,
              })) {
                break;
              }
            }
            loopContextStack.push({ loopNodeId: node.id, index: loopIteration.index, total: loopIteration.total });
            for (const dsNode of downstreamNodes) {
              if ((execState.status as string) === 'cancelled') break;
              const dsInputs = getNodeInputs(dsNode, connections, resultMap);
              dsInputs._loopItem = loopIteration.item;
              dsInputs._loopIndex = loopIteration.index;
              dsInputs._loopTotal = loopIteration.total;
              // P1: 对下游输入应用循环变量替换
              const loopCtx = loopContextStack[loopContextStack.length - 1];
              for (const key of Object.keys(dsInputs)) {
                if (typeof dsInputs[key] === 'string') {
                  dsInputs[key] = replaceLoopVariables(dsInputs[key] as string, loopCtx.index, loopCtx.total);
                }
              }
              const dsReq = buildNodeExecutionRequest(dsNode, dsInputs);
              // P1: 对下游请求体应用循环变量替换
              if (dsReq) {
                const body = dsReq.body as Record<string, unknown>;
                for (const key of Object.keys(body)) {
                  if (typeof body[key] === 'string') {
                    body[key] = replaceLoopVariables(body[key] as string, loopCtx.index, loopCtx.total);
                  }
                }
              }
              // 执行下游节点
              if (dsReq) {
                try {
                  const dsModelName = String(dsInputs.model || dsNode.config.model || '');
                  const dsConfigProviderId = dsNode.config.providerId as string | undefined;
                  let dsApiKey = '';
                  let dsBaseUrl = '';
                  // 1. 优先使用节点config中的providerId
                  if (dsConfigProviderId) {
                    const provider = await findProviderById(dsConfigProviderId);
                    if (provider) {
                      dsApiKey = provider.apiKey;
                      dsBaseUrl = provider.baseUrl;
                    }
                  }
                  // 2. 按模型名称查找
                  if (!dsApiKey && dsModelName) {
                    const provider = await findProviderForModel(dsModelName, undefined, dsConfigProviderId);
                    if (provider) {
                      dsApiKey = provider.apiKey;
                      dsBaseUrl = provider.baseUrl;
                    }
                  }
                  // 3. 按功能类型查找
                  if (!dsApiKey || !dsBaseUrl) {
                    const feature = getFeatureForNodeType(dsNode.type as NodeType);
                    const anyProvider = await findProviderForFeature(feature);
                    if (anyProvider) {
                      dsApiKey = dsApiKey || anyProvider.apiKey;
                      dsBaseUrl = dsBaseUrl || anyProvider.baseUrl;
                    }
                  }
                  // 内部API走本地fetch，外部API走完整URL
                  const isInternal = dsReq.endpoint.startsWith('/api/');
                  const apiUrl = isInternal
                    ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${dsReq.endpoint}`
                    : dsBaseUrl
                      ? `${dsBaseUrl.replace(/\/+$/, '')}${dsReq.endpoint}`
                      : dsReq.endpoint;

                  const dsRes = await fetch(apiUrl, {
                    method: dsReq.method,
                    headers: {
                      'Content-Type': 'application/json',
                      ...(dsApiKey ? { 'Authorization': `Bearer ${dsApiKey}` } : {}),
                    },
                    body: JSON.stringify(dsReq.body),
                    signal: AbortSignal.timeout(300000),
                  });
                  if (dsRes.ok) {
                    const dsData = await dsRes.json();
                    const dsResult = {
                      nodeId: dsNode.id,
                      status: 'success' as const,
                      output: { ...dsData, _type: dsNode.type, _loopIteration: loopIteration.index, _loopItem: loopIteration.item },
                      durationMs: Date.now() - nodeStart,
                    } as ExecutionResult;
                    lastLoopOutput = dsResult.output;
                    resultMap.set(dsNode.id, dsResult);
                    execState.results[dsNode.id] = dsResult;
                  }
                } catch {
                  // 下游节点执行失败，继续下一轮
                }
              }
            }
            loopContextStack.pop();
            if ((execState.status as string) === 'cancelled') break;
          }
        }
        await persistWorkflowExecution(executionId, execState);
        continue;
      }

      // 查找API密钥 (P0: 优先使用providerId，按节点类型智能匹配功能)
      const modelName = String(inputs.model || node.config.model || '');
      const configProviderId = node.config.providerId as string | undefined;
      let apiKey = '';
      let baseUrl = '';

      // 1. 优先使用节点config中的providerId
      if (configProviderId) {
        const provider = await findProviderById(configProviderId);
        if (provider) {
          apiKey = provider.apiKey;
          baseUrl = provider.baseUrl;
        }
      }

      // 2. 按模型名称查找
      if (!apiKey && modelName) {
        const provider = await findProviderForModel(modelName, undefined, configProviderId);
        if (provider) {
          apiKey = provider.apiKey;
          baseUrl = provider.baseUrl;
        }
      }

      // 3. 如果没找到对应模型的提供商，按功能类型查找
      if (!apiKey) {
        const feature = getFeatureForNodeType(node.type as NodeType);
        const provider = await findProviderForFeature(feature);
        if (provider) {
          apiKey = provider.apiKey;
          baseUrl = provider.baseUrl;
        }
      }

      // 决定调用方式
      // 内部API (以/api/开头) → 走本地fetch
      // 外部API → 走完整URL
      const isInternalApi = req.endpoint.startsWith('/api/');
      const apiUrl = isInternalApi
        ? `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}${req.endpoint}`
        : baseUrl
          ? `${baseUrl}${req.endpoint}`
          : req.endpoint;

      console.log(`[Workflow] 执行节点 ${node.label}(${node.type}) → ${req.endpoint}`);

      const fetchOptions: RequestInit = {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
      };

      if (req.method === 'POST') {
        fetchOptions.body = JSON.stringify(req.body);
      }

      // 对于异步API (generate, image-edit, edit, agent-edit, video/generate, video/extend)，使用提交+轮询模式
      const isAsyncApi = ['/api/generate', '/api/image-edit', '/api/edit', '/api/agent-edit', '/api/video/generate', '/api/video/extend'].includes(req.endpoint);

      // P1: 分镜串行 — 多场景按序生成
      if (node.type === 'storyboard-sequence' && req.body._storyboard) {
        const storyboard = req.body._storyboard as { scenes: string[]; character: string; style: string; continueMode: string; strength: number };
        const scenes = storyboard.scenes || [];
        delete req.body._storyboard;

        if (scenes.length === 0) {
          const result: ExecutionResult = { nodeId: node.id, status: 'failed', error: '场景列表为空', durationMs: Date.now() - nodeStart };
          resultMap.set(node.id, result);
          execState.results[node.id] = result;
          continue;
        }

        // 逐场景串行执行
        const sceneResults: { sceneIndex: number; imageUrl?: string; prompt: string }[] = [];
        let lastImageUrl = inputs.imageUrl as string || '';

        for (let si = 0; si < scenes.length; si++) {
          if ((execState.status as string) === 'cancelled') break;

          const sceneDesc = scenes[si].trim();
          const fullPrompt = [storyboard.style && `${storyboard.style} style,`, storyboard.character && `character: ${storyboard.character},`, sceneDesc].filter(Boolean).join(' ');

          const sceneReqBody = {
            ...req.body,
            prompt: fullPrompt,
            ...(storyboard.continueMode === 'img2img' && lastImageUrl ? { imageUrl: lastImageUrl, strength: storyboard.strength } : {}),
          };

          const sceneResult = await executeAsyncTask(apiUrl, sceneReqBody, fetchOptions, node.id, node.type as NodeType);

          if (sceneResult.status === 'success' && sceneResult.output?.imageUrl) {
            lastImageUrl = sceneResult.output.imageUrl as string;
            sceneResults.push({ sceneIndex: si, imageUrl: lastImageUrl, prompt: fullPrompt });
          } else {
            sceneResults.push({ sceneIndex: si, prompt: fullPrompt });
          }
        }

        const result: ExecutionResult = {
          nodeId: node.id,
          status: sceneResults.every(r => r.imageUrl) ? 'success' : 'failed',
          output: {
            sceneResults,
            imageUrls: sceneResults.filter(r => r.imageUrl).map(r => r.imageUrl),
            totalScenes: scenes.length,
            completedScenes: sceneResults.filter(r => r.imageUrl).length,
          },
          durationMs: Date.now() - nodeStart,
        };
        resultMap.set(node.id, result);
        execState.results[node.id] = result;
      } else if (isAsyncApi) {
        const result = await executeAsyncTask(apiUrl, req.body, fetchOptions, node.id, node.type as NodeType);
        resultMap.set(node.id, result);
        execState.results[node.id] = result;
      } else {
        // 同步API调用
        const response = await fetch(apiUrl, {
          ...fetchOptions,
          signal: AbortSignal.timeout(120000), // 2分钟超时
        });

        // 处理非JSON响应（外部API可能返回HTML错误页）
        let data: Record<string, unknown>;
        try {
          data = await response.json();
        } catch {
          const rawText = await response.text().catch(() => '');
          const result: ExecutionResult = {
            nodeId: node.id,
            status: 'failed',
            error: `API返回非JSON响应 (HTTP ${response.status}): ${rawText.slice(0, 200)}`,
            durationMs: Date.now() - nodeStart,
          };
          resultMap.set(node.id, result);
          execState.results[node.id] = result;
          console.warn(`[Workflow] 节点 ${node.label} 返回非JSON: HTTP ${response.status}`);
          continue;
        }

        // 翻译常见外部API错误为用户友好的中文提示
        let errorMessage: string | undefined = response.ok ? undefined : String(data.error || `HTTP ${response.status}`);
        if (!response.ok && typeof errorMessage === 'string') {
          // [NodeRunError] [GetContextManager] → 上下文管理失败，通常是API提供商内部错误
          if (errorMessage.includes('GetContextManager') || errorMessage.includes('context manager')) {
            errorMessage = 'API提供商内部错误(上下文管理失败)，请稍后重试或更换模型';
          }
          // Key not found → API密钥或配置问题
          if (errorMessage.includes('Key not found') || errorMessage.includes('key not found')) {
            errorMessage = 'API密钥无效或已过期，请检查管理员后台配置';
          }
          // No available channel → 渠道不可用
          if (/no\s+available\s+channel/i.test(errorMessage)) {
            errorMessage = '当前模型渠道暂不可用，请稍后重试或更换模型';
          }
        }
        // 检查成功响应中的隐藏错误（某些API返回200但包含错误信息）
        if (response.ok && data.error) {
          errorMessage = String(data.error);
        }

        const result: ExecutionResult = {
          nodeId: node.id,
          status: response.ok && !data.error ? 'success' : 'failed',
          output: response.ok && !data.error ? parseApiOutput(node.type as NodeType, data) : undefined,
          error: errorMessage,
          durationMs: Date.now() - nodeStart,
        };
        resultMap.set(node.id, result);
        execState.results[node.id] = result;

        if (result.status === 'failed') {
          console.warn(`[Workflow] 节点 ${node.label} 执行失败: ${result.error}`);
        }
      }

    } catch (err) {
      const result: ExecutionResult = {
        nodeId: node.id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - nodeStart,
      };
      resultMap.set(node.id, result);
      execState.results[node.id] = result;
      console.error(`[Workflow] 节点 ${node.label} 异常:`, err);
    }
    await persistWorkflowExecution(executionId, execState);
  }

  // 3. 完成
  execState.currentNodeId = null;
  execState.completedAt = Date.now();

  // 判断是否有失败节点
  const hasFailure = Object.values(execState.results).some(r => r.status === 'failed');
  execState.status = hasFailure ? 'failed' : 'completed';
  await persistWorkflowExecution(executionId, execState);

  console.log(`[Workflow] 执行完成 ${executionId}: ${execState.status}`);
}

/**
 * 异步任务: 提交 + 轮询
 */
async function executeAsyncTask(
  submitUrl: string,
  body: Record<string, unknown>,
  fetchOptions: RequestInit,
  nodeId: string,
  nodeType: NodeType,
): Promise<ExecutionResult> {
  const start = Date.now();

  // 提交任务（/api/generate 在 direct 模式下可能同步等待数分钟，需要足够长的超时）
  const isGenerateEndpoint = submitUrl.includes('/api/generate') || submitUrl.includes('/api/edit') || submitUrl.includes('/api/image-edit') || submitUrl.includes('/api/video/generate') || submitUrl.includes('/api/video/extend');
  const submitTimeoutMs = isGenerateEndpoint ? 600000 : 30000; // 生成/编辑类接口10分钟，其他30秒
  const submitRes = await fetch(submitUrl, {
    ...fetchOptions,
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(submitTimeoutMs),
  });

  const submitData = await submitRes.json();

  if (!submitRes.ok) {
    return {
      nodeId,
      status: 'failed',
      error: submitData.error || `提交失败 HTTP ${submitRes.status}`,
      durationMs: Date.now() - start,
    };
  }

  // 获取taskId(s)
  const taskIds: string[] = submitData.taskIds || (submitData.taskId ? [submitData.taskId] : []);
  if (taskIds.length === 0) {
    // 同步返回结果 — 持久化图片/视频URL
    const syncOutput = parseApiOutput(nodeType, submitData);
    const syncUrls = [syncOutput.imageUrl, syncOutput.videoUrl, syncOutput.videoThumbnailUrl, ...(Array.isArray(syncOutput.imageUrls) ? syncOutput.imageUrls as string[] : [])].filter(Boolean) as string[];
    for (const rawUrl of syncUrls) {
      if (typeof rawUrl === 'string' && (rawUrl.startsWith('data:') || rawUrl.startsWith('http'))) {
        try {
          const saveResp = await fetch(getInternalApiUrl('/api/save-image'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: rawUrl }),
          });
          const saveData = await saveResp.json();
          if (saveData.success && saveData.url) {
            if (syncOutput.imageUrl === rawUrl) syncOutput.imageUrl = saveData.url;
            if (syncOutput.videoUrl === rawUrl) syncOutput.videoUrl = saveData.url;
            if (syncOutput.videoThumbnailUrl === rawUrl) syncOutput.videoThumbnailUrl = saveData.url;
            if (Array.isArray(syncOutput.imageUrls)) {
              syncOutput.imageUrls = (syncOutput.imageUrls as string[]).map(u => u === rawUrl ? saveData.url : u);
            }
          }
        } catch { /* save failed */ }
      }
    }
    return {
      nodeId,
      status: 'success',
      output: syncOutput,
      durationMs: Date.now() - start,
    };
  }

  // 轮询任务状态 — 支持多taskIds并行轮询(n>1时返回多个图片)
  const maxPollTime = 600000; // 最多轮询10分钟，兼容极慢API
  const pollInterval = 1500;
  const pollStart = Date.now();
  const port = process.env.DEPLOY_RUN_PORT || 5000;

  // 跟踪每个taskId的完成结果
  const completedResults: Record<string, unknown>[] = [];
  const pendingTaskIds = new Set(taskIds);

  while (Date.now() - pollStart < maxPollTime && pendingTaskIds.size > 0) {
    await new Promise(r => setTimeout(r, pollInterval));

    // 并行轮询所有待完成的taskIds
    const pollPromises = Array.from(pendingTaskIds).map(async (tid) => {
      try {
        const pollRes = await fetch(`http://localhost:${port}/api/poll-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: tid, model: body.model, providerId: body.providerId }),
          signal: AbortSignal.timeout(10000),
        });
        const pollData = await pollRes.json();

        if (pollData.status === 'completed') {
          pendingTaskIds.delete(tid);
          completedResults.push(pollData);
        } else if (pollData.status === 'failed') {
          pendingTaskIds.delete(tid);
          console.warn(`[workflow] taskId=${tid} 失败: ${pollData.error}`);
        }
        // processing / queued → 继续轮询
      } catch {
        // 轮询失败，继续尝试
      }
    });

    await Promise.all(pollPromises);
  }

  // 合并所有完成的结果
  if (completedResults.length > 0) {
    // 合并所有图片URL到imageUrls数组
    const allImageUrls: string[] = [];
    let firstImageUrl = '';
    const mergedOutput: Record<string, unknown> = {};

    for (const result of completedResults) {
      const parsed = parseApiOutput(nodeType, result);
      if (parsed.imageUrl && !firstImageUrl) firstImageUrl = parsed.imageUrl as string;
      if (Array.isArray(parsed.imageUrls)) {
        allImageUrls.push(...(parsed.imageUrls as string[]));
      } else if (parsed.imageUrl) {
        allImageUrls.push(parsed.imageUrl as string);
      }
      // 合并其他字段（取第一个非空值）
      for (const [k, v] of Object.entries(parsed)) {
        if (k !== 'imageUrl' && k !== 'imageUrls' && v != null && !mergedOutput[k]) {
          mergedOutput[k] = v;
        }
      }
    }

    mergedOutput.imageUrl = firstImageUrl || allImageUrls[0] || '';
    if (allImageUrls.length > 0) {
      mergedOutput.imageUrls = allImageUrls;
    }

    // 持久化所有远程URL（图片+视频，data:和http:转存到服务器，避免外部URL过期）
    const allUrls = [
      mergedOutput.imageUrl,
      mergedOutput.videoUrl,
      mergedOutput.videoThumbnailUrl,
      ...(Array.isArray(mergedOutput.imageUrls) ? mergedOutput.imageUrls as string[] : []),
    ].filter(Boolean) as string[];
    for (const rawUrl of allUrls) {
      if (typeof rawUrl === 'string' && (rawUrl.startsWith('data:') || rawUrl.startsWith('http'))) {
        try {
          const saveResp = await fetch(getInternalApiUrl('/api/save-image'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: rawUrl }),
          });
          const saveData = await saveResp.json();
          if (saveData.success && saveData.url) {
            if (mergedOutput.imageUrl === rawUrl) mergedOutput.imageUrl = saveData.url;
            if (mergedOutput.videoUrl === rawUrl) mergedOutput.videoUrl = saveData.url;
            if (mergedOutput.videoThumbnailUrl === rawUrl) mergedOutput.videoThumbnailUrl = saveData.url;
            if (Array.isArray(mergedOutput.imageUrls)) {
              mergedOutput.imageUrls = (mergedOutput.imageUrls as string[]).map(u => u === rawUrl ? saveData.url : u);
            }
          }
        } catch { /* save failed */ }
      }
    }

    return {
      nodeId,
      status: 'success',
      output: mergedOutput,
      durationMs: Date.now() - start,
    };
  }

  // 检查是否有超时未完成的任务
  if (pendingTaskIds.size > 0) {
    return {
      nodeId,
      status: 'failed',
      error: `${pendingTaskIds.size}个任务轮询超时`,
      durationMs: Date.now() - start,
    };
  }

  return {
    nodeId,
    status: 'failed',
    error: '所有任务执行失败',
    durationMs: Date.now() - start,
  };
}

/**
 * 解析API输出为统一格式 (P0: 支持所有节点类型的输出)
 */
function parseApiOutput(nodeType: NodeType, data: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  // 图片URL (多种来源)
  if (data.imageUrl) output.imageUrl = data.imageUrl;
  if (data.url) output.imageUrl = data.url;
  if (data.image_url) output.imageUrl = data.image_url;
  if (Array.isArray(data.data) && data.data[0]) {
    const first = data.data[0] as Record<string, unknown>;
    if (first.url) output.imageUrl = first.url;
    if (first.b64_json) output.imageUrl = `data:image/png;base64,${first.b64_json}`;
  }
  // poll-task 返回的 imageUrl 在 result 内
  if (data.result && typeof data.result === 'object') {
    const result = data.result as Record<string, unknown>;
    if (result.imageUrl && !output.imageUrl) output.imageUrl = result.imageUrl;
    if (result.url && !output.imageUrl) output.imageUrl = result.url;
    // GPT Image格式: result.image.url
    if (result.image && typeof result.image === 'object' && !output.imageUrl) {
      const img = result.image as Record<string, unknown>;
      if (typeof img.url === 'string') output.imageUrl = img.url;
    }
    // images数组格式: result.images[0].url
    if (Array.isArray(result.images) && !output.imageUrl) {
      const firstImg = result.images[0] as Record<string, unknown>;
      if (firstImg && typeof firstImg.url === 'string') output.imageUrl = firstImg.url;
      if (firstImg && typeof firstImg.b64_json === 'string') {
        output.imageUrl = `data:image/png;base64,${firstImg.b64_json}`;
      }
    }
  }

  // 多图URL (taskIds对应多个结果)
  const allImageUrls: string[] = [];
  if (Array.isArray(data.imageUrls)) {
    for (const u of data.imageUrls as string[]) allImageUrls.push(u);
  }
  if (Array.isArray(data.data)) {
    for (const item of data.data as Record<string, unknown>[]) {
      if (item.url) allImageUrls.push(item.url as string);
      if (item.b64_json) allImageUrls.push(`data:image/png;base64,${item.b64_json}`);
    }
  }
  if (data.result && typeof data.result === 'object') {
    const result = data.result as Record<string, unknown>;
    if (Array.isArray(result.imageUrls)) {
      for (const u of result.imageUrls as string[]) allImageUrls.push(u);
    }
    // images数组: result.images[].url
    if (Array.isArray(result.images)) {
      for (const item of result.images as Record<string, unknown>[]) {
        if (typeof item.url === 'string') allImageUrls.push(item.url);
        if (typeof item.b64_json === 'string') {
          allImageUrls.push(`data:image/png;base64,${item.b64_json}`);
        }
      }
    }
  }
  // 根级images数组
  if (Array.isArray(data.images)) {
    for (const item of data.images as Record<string, unknown>[]) {
      if (typeof item.url === 'string') allImageUrls.push(item.url);
      if (typeof item.b64_json === 'string') {
        allImageUrls.push(`data:image/png;base64,${item.b64_json}`);
      }
    }
  }
  if (allImageUrls.length > 0) output.imageUrls = allImageUrls;
  // 兼容：第一张图也作为imageUrl
  if (allImageUrls.length > 0 && !output.imageUrl) output.imageUrl = allImageUrls[0];

  // SVG数据
  if (data.svgDataUrl) output.svgDataUrl = data.svgDataUrl;
  if (data.svgUrl) output.svgUrl = data.svgUrl;

  // 蒙版 (removebg输出)
  if (data.maskUrl) output.maskUrl = data.maskUrl;

  // 文本/分析结果
  if (data.text) output.text = data.text;
  if (data.prompt) output.prompt = data.prompt;
  // optimize-prompt API 返回 { optimized: "..." } 格式
  if (data.optimized && !output.prompt) output.prompt = data.optimized;
  if (data.optimized && !output.text) output.text = data.optimized;
  if (data.analysisResult) output.analysisResult = data.analysisResult;
  if (data.keywords) output.analysisResult = data.keywords;
  if (data.description) output.analysisResult = data.description;

  // 字境大师输出
  if (data.fontDesignPlan) output.fontDesignPlan = data.fontDesignPlan;
  if (data.styleLibrary) output.styleLibrary = data.styleLibrary;

  // 品牌电商输出
  if (data.brandKit) output.brandKit = data.brandKit;

  // 元素分层输出
  if (data.layers) output.layers = data.layers;
  if (data.psdUrl) output.psdUrl = data.psdUrl;

  // 多角度输出
  if (data.angles) output.angles = data.angles;

  // 3D模型输出
  if (data.modelUrl) output.modelUrl = data.modelUrl;
  if (data.modelData) output.modelData = data.modelData;

  // 视频输出
  if (data.videoUrl) output.videoUrl = data.videoUrl;
  if (data.videoThumbnailUrl) output.videoThumbnailUrl = data.videoThumbnailUrl;
  if (data.videoDuration) output.videoDuration = data.videoDuration;

  // 条件评估结果
  if (nodeType.startsWith('condition-')) {
    output.conditionResult = data.conditionResult ?? true;
  }

  return output;
}
