# V588-STABILITY-002 PSD 分析安全与稳定性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 PSD 语义分析具备受控媒体输入、授权 VLM 回退、严格输出预算、跨实例幂等与一次性退款，并删除客户端二次付费回退。

**Architecture:** `/api/analyze-psd` 变成薄控制器；`src/lib/psd-analysis/` 分别承担契约、媒体、候选模型和持久任务服务。所有付费状态进入现有 `cloud_tasks` 与 `task-core`，当前 `psd-export.ts` 仅保留一次专用请求，本地 PSD 分解继续作为不付费的结果兜底。

**Tech Stack:** Next.js 16 Route Handlers、TypeScript 5、Vitest、Sharp、PostgreSQL `cloud_tasks`、现有 Asset Core、现有安全下载器、OpenAI 兼容 VLM 与 Coze SDK。

## Global Constraints

- 只修改 `main`；`origin/stable` 固定为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`，不得触碰。
- V5.8.8 donor `J:\无界云端0820` 只读，不复制 `local-image-to-data-url.ts` 或完整路由。
- 请求体最大 28 MiB；图片最大 20 MiB、40,000,000 像素；响应最大 256 KiB。
- 显式 `providerId + model` 必须精确执行，失败不得切换提供商。
- 自动候选最多 3 个，所有阶段共用 45 秒总截止时间。
- 生产代码前必须先运行并观察对应 RED；失败测试不得跳过或删除。
- 不修改 AI PSD 独立生成器、Pear 分层、元素拆解、PSD 合成算法和管理员系统。
- 文档、错误信息和实施报告使用中文；代码标识保持英文。

---

## 文件结构

- Create: `src/lib/psd-analysis/contracts.ts` — 请求读取、字段约束、错误类型、严格输出解析和请求摘要。
- Create: `src/lib/psd-analysis/media.ts` — 当前用户媒体归属解析、安全图片加载和上游 data URL。
- Create: `src/lib/psd-analysis/model-router.ts` — 授权候选构建、总截止时间、JSON/SSE 响应预算与实际模型记录。
- Create: `src/lib/psd-analysis/service.ts` — 持久任务声明、复用等待、完成/失败/退款结算。
- Modify: `src/lib/safe-image-input.ts` — 本地受控文件 `realpath` 根目录二次验证。
- Modify: `src/app/api/analyze-psd/route.ts` — 薄控制器、统一错误响应和依赖接线。
- Modify: `src/lib/psd-export.ts` — 单请求客户端和 50 秒截止时间，删除 `/api/chat` 二次回退。
- Create: `src/__tests__/lib/psd-analysis-contracts.test.ts`
- Create: `src/__tests__/lib/psd-analysis-media.test.ts`
- Create: `src/__tests__/lib/psd-analysis-model-router.test.ts`
- Create: `src/__tests__/lib/psd-analysis-service.test.ts`
- Create: `src/__tests__/lib/psd-analysis-client.test.ts`
- Create: `src/__tests__/api/analyze-psd-route.test.ts`
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

---

### Task 1: 请求与输出契约

**Files:**
- Create: `src/lib/psd-analysis/contracts.ts`
- Test: `src/__tests__/lib/psd-analysis-contracts.test.ts`

**Interfaces:**
- Produces: `PsdAnalysisRequest`, `PsdAnalysisResult`, `PsdAnalysisError`, `readPsdAnalysisRequest(request)`, `parsePsdAnalysisOutput(text)`, `createPsdAnalysisRequestDigest(input)`。

- [ ] **Step 1: 写入请求体、幂等键和严格输出 RED**

```ts
it('rejects a streamed body larger than 28 MiB before JSON parsing', async () => {
  await expect(readPsdAnalysisRequest(oversizedRequest())).rejects.toMatchObject({
    code: 'PSD_ANALYSIS_BODY_TOO_LARGE', status: 413,
  });
});

it('rejects invalid output instead of manufacturing default layers', () => {
  expect(() => parsePsdAnalysisOutput('not json')).toThrowError(
    expect.objectContaining({ code: 'PSD_ANALYSIS_OUTPUT_INVALID' }),
  );
});

it('accepts one fenced JSON object within every output budget', () => {
  expect(parsePsdAnalysisOutput('```json\n{"backgroundColor":[255,255,255],"backgroundMode":"white","layers":[{"name":"Background","role":"bg","description":"White background"}]}\n```').layers).toHaveLength(1);
});
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-contracts.test.ts`

Expected: FAIL，因为 `@/lib/psd-analysis/contracts` 尚不存在。

- [ ] **Step 3: 实现最小契约**

```ts
export const PSD_ANALYSIS_MAX_BODY_BYTES = 28 * 1024 * 1024;
export const PSD_ANALYSIS_MAX_RESPONSE_BYTES = 256 * 1024;

export class PsdAnalysisError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) { super(message); this.name = 'PsdAnalysisError'; }
}

export interface PsdAnalysisRequest {
  image?: string;
  projectId?: string;
  sourceVersionId?: string;
  providerId?: string;
  model?: string;
  idempotencyKey: string;
}

export interface PsdAnalysisResult {
  backgroundColor: [number, number, number];
  backgroundMode: 'white' | 'corner' | 'color' | 'white-preserve' | 'none';
  layers: Array<{ name: string; role: 'bg' | 'subject' | 'text' | 'deco' | 'fx'; description: string }>;
}
```

读取器对 header 和实际流双重计数，字段白名单固定为 `image/projectId/sourceVersionId/providerId/model`；媒体来源必须二选一，模型字段必须成对。输出解析器对 fenced JSON、深度、RGB、枚举、图层数和字符串长度逐项验证。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-contracts.test.ts`

Expected: PASS，所有非法输入返回稳定 code/status。

- [ ] **Step 5: 提交契约**

```bash
git add src/lib/psd-analysis/contracts.ts src/__tests__/lib/psd-analysis-contracts.test.ts
git commit -m "test: define PSD analysis safety contracts"
```

### Task 2: 受控媒体与符号链接门禁

**Files:**
- Modify: `src/lib/safe-image-input.ts`
- Create: `src/lib/psd-analysis/media.ts`
- Create: `src/__tests__/lib/psd-analysis-media.test.ts`

**Interfaces:**
- Consumes: `PsdAnalysisRequest`。
- Produces: `resolvePsdAnalysisMedia({ request, actorUserId, signal }) -> { buffer, mimeType, sha256, dataUrl, sourceVersionId? }`。

- [ ] **Step 1: 写入路径、MIME、像素和跨用户 RED**

```ts
it.each(['/api/private/file.png', 'https://127.0.0.1/a.png', 'C:\\secret.png'])(
  'rejects direct non-data media %s', async image => {
    await expect(resolvePsdAnalysisMedia(input({ image }))).rejects.toMatchObject({
      code: 'PSD_ANALYSIS_MEDIA_INVALID',
    });
  },
);

it('rejects a managed-media symlink that resolves outside the upload root', async () => {
  await expect(loadSafeImageInput('/uploads/escape.png')).rejects.toMatchObject({
    code: 'UNSAFE_IMAGE_INPUT',
  });
});

it('resolves sourceVersionId through the current actor project boundary', async () => {
  expect(assetService.resolveAssetReference).toHaveBeenCalledWith({
    actorUserId: 'user-a', projectId: 'project-a', assetVersionId: 'version-a',
  });
});
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-media.test.ts`

Expected: FAIL，因为媒体解析器不存在且当前本地读取未检查 `realpath`。

- [ ] **Step 3: 实现受控媒体解析**

```ts
export interface ResolvedPsdAnalysisMedia {
  buffer: Buffer;
  mimeType: string;
  sha256: string;
  dataUrl: string;
  sourceVersionId?: string;
}

export async function resolvePsdAnalysisMedia(input: ResolvePsdAnalysisMediaInput): Promise<ResolvedPsdAnalysisMedia> {
  const source = input.request.image
    ? assertDataImage(input.request.image)
    : (await createAssetService().resolveAssetReference({
        actorUserId: input.actorUserId,
        projectId: input.request.projectId!,
        assetVersionId: input.request.sourceVersionId!,
      })).url;
  const image = await loadSafeImageInput(source, {
    maxBytes: 20 * 1024 * 1024,
    maxPixels: 40_000_000,
    signal: input.signal,
  });
  return {
    ...image,
    sha256: createHash('sha256').update(image.buffer).digest('hex'),
    dataUrl: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
    ...(input.request.sourceVersionId ? { sourceVersionId: input.request.sourceVersionId } : {}),
  };
}
```

`safe-image-input.ts` 使用 `realpath(root)` 和 `realpath(candidate)`，仅当真实候选严格位于真实根目录内才读取；不存在文件继续尝试下一个合法根，逃逸立即拒绝。

- [ ] **Step 4: 运行 GREEN 与既有安全测试**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-media.test.ts src/__tests__/lib/safe-image-input.test.ts src/__tests__/lib/safe-image-download.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交媒体门禁**

```bash
git add src/lib/safe-image-input.ts src/lib/psd-analysis/media.ts src/__tests__/lib/psd-analysis-media.test.ts
git commit -m "fix: secure PSD analysis media inputs"
```

### Task 3: 授权 VLM 候选与响应预算

**Files:**
- Create: `src/lib/psd-analysis/model-router.ts`
- Create: `src/__tests__/lib/psd-analysis-model-router.test.ts`

**Interfaces:**
- Consumes: `User`, `ApiProvider[]`, `dataUrl`, optional exact model pair, shared `AbortSignal`。
- Produces: `buildPsdVisionCandidates(input)`, `invokePsdVisionCandidates(input) -> { content, providerId, model, fallbackReason? }`。

- [ ] **Step 1: 写入精确授权、去重、截止时间与预算 RED**

```ts
it('never falls back when an explicit provider/model pair fails', async () => {
  const result = invokePsdVisionCandidates(explicitInput());
  await expect(result).rejects.toMatchObject({ code: 'PSD_ANALYSIS_UPSTREAM_FAILED' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps only authorized unique automatic candidates and caps them at three', () => {
  expect(buildPsdVisionCandidates(input).map(item => item.key)).toEqual([
    'pear::gpt-4o', 'apimart::gemini-2.5-flash', 'pear::qwen-vl-max',
  ]);
});

it('aborts the current candidate when the shared 45 second deadline fires', async () => {
  await expect(invokePsdVisionCandidates(timeoutInput())).rejects.toMatchObject({
    code: 'PSD_ANALYSIS_TIMEOUT', status: 504,
  });
});
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-model-router.test.ts`

Expected: FAIL，因为模型路由器尚不存在。

- [ ] **Step 3: 实现最小候选路由**

```ts
export interface PsdVisionCandidate {
  key: string;
  kind: 'provider' | 'platform';
  providerId: string;
  providerName: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export function buildPsdVisionCandidates(input: BuildCandidatesInput): PsdVisionCandidate[] {
  const exact = input.providerId && input.model;
  const candidates = exact
    ? [requireExactAuthorizedCandidate(input)]
    : collectAuthorizedVisionCandidates(input);
  return Array.from(new Map(candidates.map(item => [item.key, item])).values()).slice(0, 3);
}
```

`invokePsdVisionCandidates()` 使用一个总截止 `AbortController` 与外部 signal 联动；响应以 reader 累计不超过 256 KiB，JSON/SSE 都提取 `choices[0].message.content`。显式模式任何失败立即返回；自动模式只对明确可重试错误继续。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-model-router.test.ts src/__tests__/lib/simple-chat-sse.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交模型路由**

```bash
git add src/lib/psd-analysis/model-router.ts src/__tests__/lib/psd-analysis-model-router.test.ts
git commit -m "feat: route PSD analysis through authorized VLMs"
```

### Task 4: 持久幂等与一次性账务结算

**Files:**
- Create: `src/lib/psd-analysis/service.ts`
- Create: `src/__tests__/lib/psd-analysis-service.test.ts`

**Interfaces:**
- Consumes: 已解析请求、媒体、候选和当前用户。
- Produces: `executePsdAnalysis(input) -> PsdAnalysisExecutionResult`。

- [ ] **Step 1: 写入并发、冲突、完成和退款 RED**

```ts
it('reuses one durable task for concurrent identical requests', async () => {
  const [first, second] = await Promise.all([execute(), execute()]);
  expect(first.taskId).toBe(second.taskId);
  expect(invokeVision).toHaveBeenCalledTimes(1);
  expect(createBillableTask).toHaveBeenCalledTimes(2);
});

it.each(['timeout', 'cancelled', 'invalid-output', 'all-candidates-failed'])(
  'settles %s and refunds exactly once', async failure => {
    await Promise.allSettled([executeFailure(failure), executeFailure(failure)]);
    expect(settleFailedTask).toHaveBeenCalledTimes(1);
  },
);

it('returns 409 when one idempotency key is reused with a different digest', async () => {
  await expect(executeConflict()).rejects.toMatchObject({ status: 409 });
});
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-service.test.ts`

Expected: FAIL，因为服务尚不存在。

- [ ] **Step 3: 实现任务编排**

```ts
const claim = await createBillableTask({
  userId: input.user.id,
  idempotencyKey: input.request.idempotencyKey,
  requestDigest,
  creditCost: getOtherOperationCredits('segment'),
  task: {
    id: `psd_analysis_${randomUUID()}`,
    type: 'psd-analysis',
    status: 'processing',
    progress: 5,
    providerId: candidates[0]?.providerId,
    model: candidates[0]?.model,
    result: { imageSha256: media.sha256, requestId: input.requestId },
    createdAt: Date.now(), updatedAt: Date.now(), revision: 0,
  },
});
```

新任务拥有者调用视觉模型、严格解析后 `completeCloudTask()`；复用任务读取数据库终态，完成则重放，失败则返回原终态，不调用上游。异常路径按 abort 原因映射 `cancelled/timeout/failed`，调用 `settleFailedTask()`；只有任务拥有者结算。

- [ ] **Step 4: 运行 GREEN 与 PostgreSQL 并发专项**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-service.test.ts src/__tests__/lib/cloud-task-billing.test.ts src/__tests__/lib/annotation-postgres-concurrency.test.ts`

Expected: 单元测试 PASS；缺少隔离 PostgreSQL 时专项必须明确 SKIP，而不是伪 PASS。

- [ ] **Step 5: 提交持久服务**

```bash
git add src/lib/psd-analysis/service.ts src/__tests__/lib/psd-analysis-service.test.ts
git commit -m "fix: make PSD analysis billing idempotent"
```

### Task 5: 薄路由与统一错误响应

**Files:**
- Modify: `src/app/api/analyze-psd/route.ts`
- Create: `src/__tests__/api/analyze-psd-route.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4 的公开函数。
- Produces: `POST /api/analyze-psd` 稳定 JSON 响应。

- [ ] **Step 1: 写入鉴权顺序与错误映射 RED**

```ts
it('authenticates before reading the body or touching billing', async () => {
  const response = await POST(unauthorizedOversizedRequest());
  expect(response.status).toBe(401);
  expect(readPsdAnalysisRequest).not.toHaveBeenCalled();
  expect(executePsdAnalysis).not.toHaveBeenCalled();
});

it('returns actual provider/model and trace identities on success', async () => {
  const response = await POST(validRequest());
  expect(await response.json()).toMatchObject({
    success: true, taskId: 'task-1', requestId: 'req-1', providerId: 'pear', model: 'gpt-4o',
  });
});
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/api/analyze-psd-route.test.ts`

Expected: FAIL，旧路由仍直接 `request.json()`、硬编码模型并返回默认分析。

- [ ] **Step 3: 替换为薄控制器**

```ts
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const requestId = `req_${randomUUID()}`;
  try {
    const user = await getRequestUser(request);
    const input = await readPsdAnalysisRequest(request);
    const result = await executePsdAnalysis({ request: input, user, requestId, requestSignal: request.signal });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return psdAnalysisErrorResponse(error, requestId);
  }
}
```

- [ ] **Step 4: 运行 GREEN 与高风险鉴权门禁**

Run: `pnpm exec vitest run src/__tests__/api/analyze-psd-route.test.ts src/__tests__/api/high-risk-route-auth-contract.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交路由**

```bash
git add src/app/api/analyze-psd/route.ts src/__tests__/api/analyze-psd-route.test.ts
git commit -m "fix: harden the PSD analysis endpoint"
```

### Task 6: 删除客户端第二条付费回退

**Files:**
- Modify: `src/lib/psd-export.ts`
- Create: `src/__tests__/lib/psd-analysis-client.test.ts`

**Interfaces:**
- Consumes: `/api/analyze-psd` 新响应。
- Produces: 单一网络请求；失败返回 `null` 交给现有本地 PSD 分解。

- [ ] **Step 1: 写入单请求与幂等头 RED**

```ts
it('uses one stable idempotency key and never calls /api/chat', async () => {
  await analyzeImageWithAIForTest('data:image/png;base64,...');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/analyze-psd');
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Idempotency-Key')).toMatch(/^psd-analysis-/);
});

it('returns null after a dedicated endpoint failure without a second paid request', async () => {
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
  await expect(analyzeImageWithAIForTest('data:image/png;base64,...')).resolves.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-client.test.ts`

Expected: FAIL，当前实现会在专用端点失败后调用 `/api/chat`。

- [ ] **Step 3: 实现单请求客户端**

```ts
const controller = new AbortController();
const timeoutId = window.setTimeout(() => controller.abort(new DOMException('PSD analysis timeout', 'TimeoutError')), 50_000);
try {
  const response = await fetch('/api/analyze-psd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `psd-analysis-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({ image: base64Data }),
    signal: controller.signal,
  });
  if (!response.ok) return null;
  return normalizeDedicatedAnalysis(await response.json());
} finally {
  window.clearTimeout(timeoutId);
}
```

删除整个 `/api/chat` 回退块；保留现有本地分层流程，不吞掉需要记录的 Console 信息。

- [ ] **Step 4: 运行 GREEN 与 PSD 回归**

Run: `pnpm exec vitest run src/__tests__/lib/psd-analysis-client.test.ts src/__tests__/lib/psd-export.test.ts src/__tests__/components/image-preview.test.tsx`

Expected: PASS；若实际测试文件名不同，使用 `rg --files src/__tests__ | rg 'psd|image-preview'` 确认并记录真实命令，不跳过现有测试。

- [ ] **Step 5: 提交客户端修复**

```bash
git add src/lib/psd-export.ts src/__tests__/lib/psd-analysis-client.test.ts
git commit -m "fix: prevent duplicate paid PSD analysis calls"
```

### Task 7: 全量门禁、报告、推送与云端验收

**Files:**
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Create: `docs/testing/evidence/v588-stability-002-cloud-2026-08-27.json`

**Interfaces:**
- Produces: 可追溯本地/云端证据、精确 SHA 与发布结论。

- [ ] **Step 1: 执行局部与静态门禁**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/psd-analysis-contracts.test.ts src/__tests__/lib/psd-analysis-media.test.ts src/__tests__/lib/psd-analysis-model-router.test.ts src/__tests__/lib/psd-analysis-service.test.ts src/__tests__/lib/psd-analysis-client.test.ts src/__tests__/api/analyze-psd-route.test.ts
pnpm ts-check
pnpm lint
```

Expected: 全部 PASS，零新增 ESLint error/warning。

- [ ] **Step 2: 执行全量门禁**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: 全量 PASS；PostgreSQL 专项若无隔离库必须在报告中保持“未验证”，不能写成通过。

- [ ] **Step 3: 更新中文报告**

登记：根因、RED 输出、实现提交、局部/全量命令、测试数量、未验证项、`origin/main` 和 `origin/stable` SHA。吸收清单仅在云端真实验收后标为“已吸收 / Coze 云端验证通过”。

- [ ] **Step 4: 推送 main 并确认 stable 未变化**

```bash
git push origin HEAD:main
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: `origin/main` 等于候选提交；`origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

- [ ] **Step 5: Coze 拉取与 Google Chrome 真实验收**

只使用已打开的 Coze 项目页和 Google Chrome 预览页，不创建新标签。沙箱断线时刷新项目页恢复，再强制刷新预览页。使用 PearAPI 或 APIMART 已授权视觉模型：

1. 完成一次 Pro PSD 导出。
2. 保存 Network、Console、响应、任务、积分前后与下载文件证据。
3. 同一幂等键重复请求，确认相同 taskId、零新增上游调用、零新增扣费。
4. 触发一次可控失败，确认终态与一次退款。

- [ ] **Step 6: 写入云端证据并最终提交**

```bash
git add docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing docs/testing/evidence/v588-stability-002-cloud-2026-08-27.json
git commit -m "docs: close V588 PSD analysis cloud acceptance"
git push origin HEAD:main
```

Expected: 证据包含测试 URL、时间、Git SHA、Chrome、provider/model、taskId/requestId、积分变化和最终结论；不包含密码、Cookie、API Key 或完整用户图片。

---

## 计划自检

- 规格覆盖：请求预算、媒体归属、SSRF/路径/MIME/像素、授权模型、精确路由、总超时、输出预算、幂等、退款、客户端单请求、报告与云端证据均有对应任务。
- 占位符扫描：所有步骤均包含明确文件、接口、命令、预期结果和实现内容。
- 类型一致性：请求、结果、错误、媒体、候选和执行结果只在前序任务定义，后序任务使用相同名称。
- 范围控制：未把管理员统计、支付、Pear ZIP、元素拆解或 PSD 合成质量混入本项。
