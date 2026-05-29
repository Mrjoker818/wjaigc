import { NextRequest, NextResponse } from 'next/server';
import {
  topologicalSort,
  getNodeInputs,
  buildNodeExecutionRequest,
  type WorkflowNode,
  type WorkflowConnection,
  type ExecutionResult,
} from '@/lib/workflow-engine';
import { findProviderForModel, findProviderForFeature } from '@/lib/server-api-config';

// 内存中的执行状态
const executionCache = new Map<string, {
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  results: Record<string, ExecutionResult>;
  currentNodeId: string | null;
  startedAt: number;
  completedAt: number | null;
  error?: string;
}>();

// 30分钟后自动清理
const CLEANUP_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of executionCache) {
    if (val.completedAt && now - val.completedAt > CLEANUP_MS) {
      executionCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * POST /api/workflow/execute
 * 执行工作流：DAG拓扑排序 → 逐节点调度 → API调用 → 结果传递
 * 
 * 请求体:
 * {
 *   action: 'start' | 'status' | 'cancel',
 *   executionId?: string,      // 查询/取消时需要
 *   nodes: WorkflowNode[],      // start时需要
 *   connections: WorkflowConnection[]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, executionId, nodes, connections } = body;

    // ─── 查询执行状态 ───
    if (action === 'status') {
      if (!executionId) {
        return NextResponse.json({ error: '缺少 executionId' }, { status: 400 });
      }
      const exec = executionCache.get(executionId);
      if (!exec) {
        return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
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
      if (exec && exec.status === 'running') {
        exec.status = 'cancelled';
        exec.completedAt = Date.now();
      }
      return NextResponse.json({ executionId, status: 'cancelled' });
    }

    // ─── 启动执行 ───
    if (action !== 'start') {
      return NextResponse.json({ error: '无效的 action，支持: start, status, cancel' }, { status: 400 });
    }

    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return NextResponse.json({ error: '节点列表不能为空' }, { status: 400 });
    }

    const executionIdNew = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const execState: typeof executionCache extends Map<string, infer V> ? V : never = {
      status: 'running',
      results: {},
      currentNodeId: null,
      startedAt: Date.now(),
      completedAt: null,
    };
    executionCache.set(executionIdNew, execState);

    // 异步执行工作流
    executeWorkflow(executionIdNew, execState, nodes, connections || []).catch(err => {
      console.error('[Workflow] 执行异常:', err);
      execState.status = 'failed';
      execState.error = err instanceof Error ? err.message : String(err);
      execState.completedAt = Date.now();
    });

    return NextResponse.json({
      executionId: executionIdNew,
      status: 'running',
      message: '工作流已开始执行',
    });

  } catch (error) {
    console.error('[Workflow] 请求处理失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '工作流执行失败' },
      { status: 500 }
    );
  }
}

/**
 * 执行工作流核心逻辑
 */
async function executeWorkflow(
  executionId: string,
  execState: NonNullable<typeof executionCache extends Map<string, infer V> ? V : never>,
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
) {
  console.log(`[Workflow] 开始执行 ${executionId}, ${nodes.length} 个节点`);

  // 1. DAG拓扑排序
  const sorted = topologicalSort(nodes, connections);
  const resultMap = new Map<string, ExecutionResult>();

  // 2. 逐节点执行
  for (const node of sorted) {
    // 检查是否被取消
    if (execState.status === 'cancelled') {
      console.log(`[Workflow] 执行被取消: ${executionId}`);
      break;
    }

    execState.currentNodeId = node.id;
    const nodeStart = Date.now();

    try {
      // 获取输入
      const inputs = getNodeInputs(node, connections, resultMap);

      // 构建执行请求
      const req = buildNodeExecutionRequest(node, inputs);

      // 逻辑节点不需要API调用
      if (!req) {
        const result: ExecutionResult = {
          nodeId: node.id,
          status: 'success',
          output: { ...inputs, _type: node.type },
          durationMs: Date.now() - nodeStart,
        };
        resultMap.set(node.id, result);
        execState.results[node.id] = result;
        continue;
      }

      // 查找API密钥
      const modelName = (inputs.model || node.config.model) as string;
      let apiKey = '';
      let baseUrl = '';

      if (modelName) {
        const provider = await findProviderForModel(modelName);
        if (provider) {
          apiKey = provider.apiKey;
          baseUrl = provider.baseUrl;
        }
      }

      // 如果没找到对应模型的提供商，尝试按功能查找
      if (!apiKey) {
        const feature: 'imageEdit' | 'chat' | 'vectorize' | 'layer' | '3d' =
          node.type.startsWith('ai-generate') || node.type === 'ai-style-transfer' ? 'imageEdit' :
          node.type === 'ai-analyze' || node.type === 'ai-retouch' ? 'chat' : 'imageEdit';
        const provider = await findProviderForFeature(feature);
        if (provider) {
          apiKey = provider.apiKey;
          baseUrl = provider.baseUrl;
        }
      }

      // 调用API
      const apiUrl = baseUrl
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

      // 对于生成类API，使用提交+轮询模式
      if (req.endpoint === '/api/generate' || req.endpoint === '/api/image-edit') {
        const result = await executeAsyncTask(apiUrl, req.body, fetchOptions, node.id);
        resultMap.set(node.id, result);
        execState.results[node.id] = result;
      } else {
        // 同步API调用
        const response = await fetch(apiUrl, {
          ...fetchOptions,
          signal: AbortSignal.timeout(120000), // 2分钟超时
        });

        const data = await response.json();
        const result: ExecutionResult = {
          nodeId: node.id,
          status: response.ok ? 'success' : 'failed',
          output: response.ok ? parseApiOutput(node.type, data) : undefined,
          error: response.ok ? undefined : (data.error || `HTTP ${response.status}`),
          durationMs: Date.now() - nodeStart,
        };
        resultMap.set(node.id, result);
        execState.results[node.id] = result;

        if (!response.ok) {
          console.warn(`[Workflow] 节点 ${node.label} 执行失败: ${result.error}`);
          // 不中断整个工作流，继续执行后续节点
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
  }

  // 3. 完成
  execState.currentNodeId = null;
  execState.completedAt = Date.now();

  // 判断是否有失败节点
  const hasFailure = Object.values(execState.results).some(r => r.status === 'failed');
  execState.status = hasFailure ? 'failed' : 'completed';

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
): Promise<ExecutionResult> {
  const start = Date.now();

  // 提交任务
  const submitRes = await fetch(submitUrl, {
    ...fetchOptions,
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
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

  // 获取taskId
  const taskId = submitData.taskId || submitData.taskIds?.[0];
  if (!taskId) {
    // 如果是同步返回的结果
    return {
      nodeId,
      status: 'success',
      output: parseApiOutput('ai-generate', submitData),
      durationMs: Date.now() - start,
    };
  }

  // 轮询任务状态
  const maxPollTime = 180000; // 最多轮询3分钟
  const pollInterval = 2000;
  const pollStart = Date.now();

  while (Date.now() - pollStart < maxPollTime) {
    await new Promise(r => setTimeout(r, pollInterval));

    try {
      const pollRes = await fetch('/api/poll-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
        signal: AbortSignal.timeout(10000),
      });

      const pollData = await pollRes.json();

      if (pollData.status === 'completed') {
        return {
          nodeId,
          status: 'success',
          output: parseApiOutput('ai-generate', pollData),
          durationMs: Date.now() - start,
        };
      }

      if (pollData.status === 'failed') {
        return {
          nodeId,
          status: 'failed',
          error: pollData.error || '任务执行失败',
          durationMs: Date.now() - start,
        };
      }

      // 继续轮询 (processing / queued)
    } catch {
      // 轮询失败，继续尝试
    }
  }

  return {
    nodeId,
    status: 'failed',
    error: '轮询超时',
    durationMs: Date.now() - start,
  };
}

/**
 * 解析API输出为统一格式
 */
function parseApiOutput(nodeType: string, data: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  // 图片URL
  if (data.imageUrl) output.imageUrl = data.imageUrl;
  if (data.url) output.imageUrl = data.url;
  if (data.image_url) output.imageUrl = data.image_url;
  if (Array.isArray(data.data) && data.data[0]) {
    const first = data.data[0] as Record<string, unknown>;
    if (first.url) output.imageUrl = first.url;
    if (first.b64_json) output.imageUrl = `data:image/png;base64,${first.b64_json}`;
  }

  // SVG数据
  if (data.svgDataUrl) output.svgDataUrl = data.svgDataUrl;
  if (data.svgUrl) output.svgUrl = data.svgUrl;

  // 蒙版
  if (data.maskUrl) output.maskUrl = data.maskUrl;

  // 文本/分析结果
  if (data.text) output.text = data.text;
  if (data.prompt) output.prompt = data.prompt;
  if (data.analysisResult) output.analysisResult = data.analysisResult;
  if (data.keywords) output.analysisResult = data.keywords;
  if (data.description) output.analysisResult = data.description;

  // 条件评估结果
  if (nodeType.startsWith('condition-')) {
    output.conditionResult = data.conditionResult ?? true;
  }

  return output;
}
