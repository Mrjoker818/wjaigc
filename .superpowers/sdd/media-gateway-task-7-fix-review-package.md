# Final Important fix package: 4b196bd470a1844940e41558657eaa0bcc5ff369..4a6ae9da2e752cc6a7958a4ebfaf10c0ed629ce1

## Commits
4a6ae9da docs: record bounded response verification
0ae86da8 fix: bound gateway response body reads
392f4492 test: reproduce pending gateway response bodies

## Files changed
 .superpowers/sdd/media-gateway-task-7-report.md    |  23 ++++
 .../components/media-gateway-admin.test.tsx        | 142 +++++++++++++++++++++
 src/components/dashboard/media-gateway-admin.tsx   |  38 ++++--
 3 files changed, 193 insertions(+), 10 deletions(-)

## Diff
diff --git a/.superpowers/sdd/media-gateway-task-7-report.md b/.superpowers/sdd/media-gateway-task-7-report.md
index 565ff540..0787fc0c 100644
--- a/.superpowers/sdd/media-gateway-task-7-report.md
+++ b/.superpowers/sdd/media-gateway-task-7-report.md
@@ -318,3 +318,26 @@ TypeScript：`pnpm ts-check` 退出码 0。目标 ESLint（key-service、其单
 ### 关注

 - 当前环境缺少 `POSTGRES_TEST_DATABASE_URL`，所以 7 个真实 PostgreSQL 用例未执行；其中新增的 `Asia/Shanghai` 会话 UTC 边界交叉验证必须由 Task 8 真库门禁执行。除此之外未发现未关闭的 Task 7 Important。
+
+## 最后 1 个 Important：body 生命周期 RED（2026-09-14）
+
+- 命令：`pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx`。
+- 结果：退出码 1；1 个测试文件失败，34 项中 `30 passed / 4 failed`。
+- 四个预期失败分别证明：mutation 已取得响应头后 body 永不 resolve 时不会超时进入歧义；authority GET 的 body 永不 resolve 时仍停在“正在核对”；退出 Sheet 无法 abort 已开始读取的 mutation body；退出后 authority signal 未取消，迟到 body 仍存在污染状态的通路。
+- 本轮仍未修改生产代码；RED 测试只增加在既有授权的 `src/__tests__/components/media-gateway-admin.test.tsx`。
+
+### GREEN 与验证
+
+- RED 提交：`392f44922f2218f25a3b48b488f7a11fe77c0613`；生产修复提交：`0ae86da83602e91fa721c3f387807969ff3130cc`。
+- 最小 GREEN：`pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx`，1 个文件、`34 passed (34)`。
+- Task 7 目标：`pnpm exec vitest run src/__tests__/api/admin-media-gateway-keys.test.ts src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/lib/media-gateway-admission.test.ts src/__tests__/lib/media-gateway-utc-day-window.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts`，7 个文件、`102 passed (102)`。
+- TypeScript：`pnpm ts-check` 退出码 0；`next typegen` 与 `tsc -p tsconfig.json` 通过。
+- Scoped ESLint：`pnpm exec eslint src/components/dashboard/media-gateway-admin.tsx src/__tests__/components/media-gateway-admin.test.tsx` 退出码 0，`0 errors / 0 warnings`。
+- Scoped diff-check：组件及组件测试 `git diff --check`、生产 staged diff-check 均退出码 0。
+- 未重复运行全媒体网关、Playwright 或 PostgreSQL；按控制器要求避免无关门禁。非 UTC PostgreSQL 用例仍保留给 Task 8，UTC、Secret、审计及局部锁实现未改动。
+
+### 实现自审
+
+- 单一 `AbortController` 与 5 秒 timeout 现在覆盖 `fetch`、body 完整读取及 `response.json()` 解析，controller 仅在整个操作结束后从 scope Map 移除。
+- abort Promise 与 JSON 读取竞速，因此测试中的永不 resolve body 能按时收敛；返回前同时检查 `signal.aborted` 和当前 scope controller 身份，即使 mock 无视 abort 后迟到 resolve，也无法进入状态更新。
+- mutation 与 authority GET 均通过同一个 `runBoundedJsonRequest`；退出 Sheet/AlertDialog 仍按原局部 scope abort 并解锁，Secret 状态与持久化边界没有变化。
diff --git a/src/__tests__/components/media-gateway-admin.test.tsx b/src/__tests__/components/media-gateway-admin.test.tsx
index 6de4dec7..639390c3 100644
--- a/src/__tests__/components/media-gateway-admin.test.tsx
+++ b/src/__tests__/components/media-gateway-admin.test.tsx
@@ -29,6 +29,17 @@ function jsonResponse(body: unknown, status = 200): Response {
   });
 }

+function deferred<T>(): {
+  promise: Promise<T>;
+  resolve: (value: T) => void;
+} {
+  let resolve!: (value: T) => void;
+  const promise = new Promise<T>((resolver) => {
+    resolve = resolver;
+  });
+  return { promise, resolve };
+}
+
 function mockApi(initialKeys: Array<Record<string, unknown>> = [key]): ReturnType<typeof vi.fn> {
   const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
     const url = String(input);
@@ -446,6 +457,137 @@ describe('MediaGatewayAdmin', () => {
     expect((screen.getByRole('button', { name: '签发密钥' }) as HTMLButtonElement).disabled).toBe(false);
   });

+  it('keeps the issue timeout active until a pending mutation body is fully read', async () => {
+    vi.useFakeTimers();
+    let getCount = 0;
+    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        getCount += 1;
+        return Promise.resolve(jsonResponse({ success: true, keys: [] }));
+      }
+      return Promise.resolve({
+        ok: true,
+        status: 201,
+        json: () => new Promise<unknown>(() => undefined),
+      } as Response);
+    }));
+    render(<MediaGatewayAdmin />);
+    await act(async () => {
+      await Promise.resolve();
+      await Promise.resolve();
+    });
+    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
+    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
+    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
+    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
+
+    await act(async () => vi.advanceTimersByTimeAsync(5_000));
+    vi.useRealTimers();
+    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
+    expect((await within(sheet).findByRole('alert')).textContent).toContain('签发结果无法确认');
+    expect(getCount).toBe(2);
+  });
+
+  it('keeps the authority timeout active until its pending body is fully read', async () => {
+    vi.useFakeTimers();
+    let getCount = 0;
+    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        getCount += 1;
+        if (getCount === 1) return Promise.resolve(jsonResponse({ success: true, keys: [] }));
+        return Promise.resolve({
+          ok: true,
+          status: 200,
+          json: () => new Promise<unknown>(() => undefined),
+        } as Response);
+      }
+      return Promise.resolve(jsonResponse({ success: true, key, secret: 'wmg_too-short' }, 201));
+    }));
+    render(<MediaGatewayAdmin />);
+    await act(async () => {
+      await Promise.resolve();
+      await Promise.resolve();
+    });
+    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
+    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
+    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
+    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
+    await act(async () => {
+      await Promise.resolve();
+      await Promise.resolve();
+    });
+
+    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
+    expect(within(sheet).getByRole('alert').textContent).toContain('正在核对权威列表');
+    await act(async () => vi.advanceTimersByTimeAsync(5_000));
+    vi.useRealTimers();
+    expect((await within(sheet).findByRole('alert')).textContent).toContain('权威列表暂时无法确认');
+  });
+
+  it('aborts a pending mutation body when the sheet exits', async () => {
+    let mutationSignal: AbortSignal | null = null;
+    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        return Promise.resolve(jsonResponse({ success: true, keys: [] }));
+      }
+      mutationSignal = init?.signal ?? null;
+      return Promise.resolve({
+        ok: true,
+        status: 201,
+        json: () => new Promise<unknown>(() => undefined),
+      } as Response);
+    }));
+    render(<MediaGatewayAdmin />);
+    await screen.findByText('尚未签发媒体网关密钥');
+    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
+    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
+    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
+    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
+    await act(async () => {
+      await Promise.resolve();
+      await Promise.resolve();
+    });
+
+    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
+    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
+    await waitFor(() => expect(screen.queryByRole('dialog', { name: '签发媒体网关密钥' })).toBeNull());
+    expect((mutationSignal as AbortSignal | null)?.aborted).toBe(true);
+  });
+
+  it('ignores a late authority body after the sheet cancels its request', async () => {
+    const lateBody = deferred<unknown>();
+    let getCount = 0;
+    let authoritySignal: AbortSignal | null = null;
+    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        getCount += 1;
+        if (getCount === 1) return Promise.resolve(jsonResponse({ success: true, keys: [key] }));
+        authoritySignal = init?.signal ?? null;
+        return Promise.resolve({ ok: true, status: 200, json: () => lateBody.promise } as Response);
+      }
+      return Promise.resolve(jsonResponse({ success: true, key, secret: 'wmg_too-short' }, 201));
+    }));
+    render(<MediaGatewayAdmin />);
+    await screen.findAllByText('Production');
+    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
+    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
+    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
+    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
+    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
+    expect((await within(sheet).findByRole('alert')).textContent).toContain('正在核对权威列表');
+    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
+    await waitFor(() => expect(screen.queryByRole('dialog', { name: '签发媒体网关密钥' })).toBeNull());
+
+    await act(async () => {
+      lateBody.resolve({ success: true, keys: [{ ...key, label: 'Stale Authority' }] });
+      await lateBody.promise;
+      await Promise.resolve();
+    });
+    expect((authoritySignal as AbortSignal | null)?.aborted).toBe(true);
+    expect(screen.queryByText('Stale Authority')).toBeNull();
+    expect(screen.getAllByText('Production').length).toBeGreaterThan(0);
+  });
+
   it('uses a bounded mobile layout at 375px without a horizontally scrolling root', async () => {
     vi.stubGlobal('innerWidth', 375);
     mockApi();
diff --git a/src/components/dashboard/media-gateway-admin.tsx b/src/components/dashboard/media-gateway-admin.tsx
index faa60c8f..aee5eb38 100644
--- a/src/components/dashboard/media-gateway-admin.tsx
+++ b/src/components/dashboard/media-gateway-admin.tsx
@@ -65,6 +65,11 @@ interface KeyFormState {
   enabled: boolean;
 }

+interface BoundedJsonResponse {
+  response: Response;
+  body: Record<string, unknown>;
+}
+
 type DrawerMode = 'issue' | 'edit' | null;
 type MutationScope = 'issue' | `edit:${string}` | `revoke:${string}`;

@@ -199,17 +204,33 @@ export default function MediaGatewayAdmin() {
     });
   }, []);

-  const runBoundedFetch = useCallback(async (
+  const runBoundedJsonRequest = useCallback(async (
     scope: string,
     input: RequestInfo | URL,
     init?: RequestInit,
-  ): Promise<Response> => {
+  ): Promise<BoundedJsonResponse> => {
     requestControllers.current.get(scope)?.abort();
     const controller = new AbortController();
     requestControllers.current.set(scope, controller);
     const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
+    const aborted = new Promise<never>((_resolve, reject) => {
+      controller.signal.addEventListener('abort', () => {
+        reject(new DOMException('Request cancelled', 'AbortError'));
+      }, { once: true });
+    });
     try {
-      return await fetch(input, { ...init, signal: controller.signal });
+      const response = await Promise.race([
+        fetch(input, { ...init, signal: controller.signal }),
+        aborted,
+      ]);
+      const body = await Promise.race([responseBody(response), aborted]);
+      if (
+        controller.signal.aborted
+        || requestControllers.current.get(scope) !== controller
+      ) {
+        throw new DOMException('Request cancelled', 'AbortError');
+      }
+      return { response, body };
     } finally {
       window.clearTimeout(timeout);
       if (requestControllers.current.get(scope) === controller) {
@@ -223,16 +244,15 @@ export default function MediaGatewayAdmin() {
   }, []);

   const readAuthoritativeKeys = useCallback(async (scope: string): Promise<GatewayKeyView[]> => {
-    const response = await runBoundedFetch(scope, '/api/admin/gateway/keys');
+    const { response, body } = await runBoundedJsonRequest(scope, '/api/admin/gateway/keys');
     if (!response.ok) throw new Error('request failed');
-    const body = await responseBody(response);
     if (body.success !== true || !Array.isArray(body.keys)) {
       throw new UntrustedResponseError('untrusted response');
     }
     const parsedKeys = body.keys.map(parseKey);
     if (parsedKeys.some(key => key === null)) throw new UntrustedResponseError('untrusted response');
     return parsedKeys as GatewayKeyView[];
-  }, [runBoundedFetch]);
+  }, [runBoundedJsonRequest]);

   const loadKeys = useCallback(async (): Promise<void> => {
     setLoading(true);
@@ -334,7 +354,7 @@ export default function MediaGatewayAdmin() {
       const isIssue = drawerMode === 'issue';
       const submittedLabel = form.label.trim();
       const submittedUserId = form.userId.trim();
-      const response = await runBoundedFetch(
+      const { response, body } = await runBoundedJsonRequest(
         scope,
         isIssue ? '/api/admin/gateway/keys' : `/api/admin/gateway/keys/${editingKey?.id ?? ''}`,
         {
@@ -353,7 +373,6 @@ export default function MediaGatewayAdmin() {
           }),
         },
       );
-      const body = await responseBody(response);
       if (!response.ok) {
         await reconcileAmbiguousMutation(scope, isIssue ? '签发结果无法确认。' : '保存结果无法确认。', setSheetError);
         return;
@@ -435,12 +454,11 @@ export default function MediaGatewayAdmin() {
     setRevoking(true);
     setRevokeError(null);
     try {
-      const response = await runBoundedFetch(
+      const { response, body } = await runBoundedJsonRequest(
         scope,
         `/api/admin/gateway/keys/${revokeKey.id}`,
         { method: 'DELETE' },
       );
-      const body = await responseBody(response);
       if (!response.ok) {
         await reconcileAmbiguousMutation(scope, '吊销结果无法确认。', setRevokeError);
         return;
