# 8C 旧图片可信受管读取实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this tightly coupled plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让缺MIME的既有合法图片可按实际原字节只读派生描述并安全交付，为原8C收费和持久来源接续提供基础。

**Architecture:** 缺MIME分支与登记MIME分支隔离；同一次有界读取、完整解码、SHA和元数据匹配产生描述及内部缓冲，字节API交付同一缓冲。解码器复用原可杀死进程，增加尺寸返回而保留validateBinaryImage的void合同。

**Tech Stack:** TypeScript、Node fs/crypto/AbortSignal、Sharp子进程、Vitest、既有精确S3接口。

**Spec:** `docs/superpowers/specs/2026-10-05-legacy-managed-image-read-design.md`

## Global Constraints

- 仅main，stable只读；不stage/commit/push/部署/Coze/安装/服务重启/真实模型付费。
- 原资产、版本、文件、授权、账本不改；缺MIME描述不是收费授权能力。
- 新分支最多2个完整读取、64MiB输入缓冲，单图片32MiB，deadline最多30秒；原解码15秒、close后释放租约不改。
- PNG/JPEG/WebP/GIF/AVIF/BMP全部覆盖，显式错误MIME不放宽，缺登记byteSize仍拒绝。
- 原收费准入409和完整业务RED保留，直到真实生产采用持久原图证明；不关闭原Task1/2/3或8C。

## Task 1：可信缺MIME描述和同缓冲交付

**状态（2026-10-05）：读取基础限定本地完成。** 283原I1–I4复审与301中文路径M2补审通过；294最终七文件138PASS/1原NULL业务RED/139、0skip、53.42s，292非增量tsc及296五路径strictlint终态0。298保护仍59BLOCK，不许可发布；不是原来源完整Task1/2/3或8C完成。最新证据见legacy-utf8-final-report-302.md，接续原Task2持久原图证明，不重做本读取切片。

**Files:** Modify `src/lib/asset-core/binary-image-validation.ts`、`src/lib/asset-core/managed-media-read.ts`、`src/lib/asset-core/storage.ts`、`src/lib/safe-image-input.ts`；Create `src/__tests__/lib/legacy-managed-image-read.test.ts`。后两生产路径仅修正SQL NULL/空字段映射和导出现有零拷贝格式探测；原完整接缝测试与旧控制测试不修改。

**Interfaces:** 新增 `inspectBinaryImage(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<{ width: number; height: number }>`；既有validateBinaryImage保持Promise<void>。getManagedAssetMediaDescriptor和readManagedAssetVersionBytes保持原签名及登记MIME路径。内部prepare函数返回descriptor及可选verifiedBytes，不对外暴露缓冲。

- [x] 写真实PNG缺MIME描述/字节正控制及登记checksum失配负控制，观测当前NOT_READY/UNAVAILABLE真实RED；生成夹具仅在mkdtemp根，finally仅清理本次已验证根。
  ```ts
  const original = structuredClone(version);
  expect(await getManagedAssetMediaDescriptor(version, 'image', { dataRoot })).toMatchObject({
    assetVersionId: 'legacy-version', mimeType: 'image/png', width: 3, height: 2,
  });
  expect((await readManagedAssetVersionBytes(version, 'image', { dataRoot })).bytes).toEqual(png);
  expect(version).toEqual(original);
  ```
- [x] `pnpm exec vitest run src/__tests__/lib/legacy-managed-image-read.test.ts --reporter=verbose`保存原生RED，不把夹具/导入错误算业务RED。
- [x] 扩展真实格式/损坏/大小/尺寸/空MIME/显式非图片、Range、abort/deadline、条件S3与解码后原文件替换用例；每案名字说明具体错误，真实解码保持。
- [x] 先扩展子进程返回已解码尺寸，再接缺MIMEprepare及同缓冲交付。指纹存在时严格匹配，缺失时计算且不回写；NULL S3仅在受控Content-Type策略下条件全读取并核真实格式。
- [x] 上述新test、原binary-image-validation与canvas-share-snapshot及restore、两safe-input、原完整PG接缝七文件准确回归；再运行非增量tsc、四生产+新test严格eslint。保存修前副本和准确增量，未更改控制路径按旧清单核验；原完整PG NULL409作为未闭业务RED明确保留，不称全绿。
- [x] 独立限定只读审查本任务Spec/Quality；Critical/Important未关闭不得标完成。没有提交步骤，遵从人类main-only及不提交约束。

### 首审 I3 生命周期修复（同一 Task 1，限定完成）

- [x] 原地保留修前副本 `before-legacy-local-265`。真实本地PNG、原文件/版本不变，注入本地root/open/fd-stat/path-stat/read/close停顿；请求abort与deadline必须返回安全失败，实际子进程已退出且close已送达。修前父进程I/O等待必须实际RED，不把无子进程的断言当唯一失败。
- [x] 仅缺MIME的本地路径采用内联原生fs子进程：真实根、O_NOFOLLOW、dev/ino、大小、同fd读取、close均在子进程；父进程保留单个登记大小缓冲，子进程使用至多64KiB分块并等待stdout backpressure，不新增完整输入副本。stderr仅有界路径元数据，不记录原字节或凭证。
  ```ts
  // Promise只在真实close处结算；abort只杀死，不早释输入预算。
  signal.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
  child.once('close', () => { /* 精确大小/元数据验证后resolve，否则reject */ });
  ```
- [x] 补真实根越界、句柄身份失配、短读/超量输出、spawn失败和两读close延迟时第三读拒绝。替身仅注入精确fs/进程边界，路径正控制与六格式仍实际读取/解码；生产代码不加测试开关。
- [x] 准确回归新test、decoder、share、storage restore、两safe-input及原完整PG接缝；原NULL业务409仍保留。非增量tsc、四生产+新test strict lint、保护基线、原控制指纹及公共只读计数逐项记录；新SHA/准确diff后复用Kuhn同席复审。保护仍59BLOCK，仅记录失败，不标发布门禁通过。

### M2 中文路径分块修复（同一 Task 1，限定完成）

- [x] 284保留复审前两路径副本；286实际UTF8拆块中文basename RED，285混合Windows路径拼写的夹具错误另列。
- [x] 同一StringDecoder.write保留UTF8跨chunk状态，真实close后end+JSON解析；8192字节预算和资源生命周期不改。287聚焦GREEN，最后测试类型标注纠正不改变断言。
- [x] 293准确两路径diff及最终295/300 SHA核验；294/292/296终态与301同席M2 ADDRESSED分别留证，不把审查读日志写成独立运行。

## 接续门禁（原来源准入计划，不缩小业务目标）

完成Task1后继续原 `2026-10-04-annotation-source-admission` Task2：实际原图证明用于收费/派发/持久冻结/恢复/发布，最后旧NULL完整接缝202、一次本人费用和真实canonical/managed交付通过。Task1单独通过仍保持原完整业务RED，不改其期望、不用它代替Task2。

## 自审

本计划一个紧耦合任务，无独立并行实现路径；主代理使用executing-plans，独立只读复审作为侧车。两生产接口相容，原validator void包装保持；所有新读取、解码、交付和负面门禁对应Task1。更广历史缺大小/FILE_ONLY以及云端/多实例/重启不在本任务完成声明内，仍属于原完整8C待办。
