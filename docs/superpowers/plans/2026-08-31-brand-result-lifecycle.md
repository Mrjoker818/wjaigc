# 品牌电商结果与重试修复实施计划

> 按executing-plans在本会话执行用户已经批准的最小范围，每项先RED再实现。用户明确要求仅main调试；不新建业务分支，不碰stable。

**目标：** 闭环PROVIDER-003的BUG-002/003/004，保留原品牌功能。

**架构：** 品牌面板共用提交/轮询/收尾入口；结果类型由前后端共用。服务端结果携带providerId/providerName/modelName，前端按结果身份调用现有onAddImages(urls, meta)，不按当前选择猜来源。

**技术栈：** React19、TypeScript、Next16、Vitest/Testing Library。

## 全局约束

基线98b6505d；规格见同日brand-result-lifecycle-design.md。只有三个批准Bug与其生命周期防回归，认证、账务、模板布局、执行协议、全局画布和stable/donor不变。真实测试与隔离测试分别报告。

## 任务1：真实组件失败回归（已完成）

文件：src/__tests__/components/brand-ecommerce-lifecycle.test.tsx。

- [x] 真实渲染BrandEcommercePanel，隔离fetch与浏览器存储。通过真实按钮配置/提交/重试，不替换业务组件。
- [x] 测试402完整提示、真实模板重试、重试HTTP/业务/解析失败及同步成功结束loading；不清除其他模板成功结果。
- [x] 假时钟驱动实际轮询：部分结果、完成、失败、取消、原120次上限、卸载和迟到响应；运行中点击不得额外POST。
- [x] 对服务器返回的固定来源执行入画布，随后改选同名供应商不能污染旧图；混合结果分组，旧无来源结果不推测。

关键断言：
```ts
expect(generateRequests[1].templateIds).toEqual(['white-bg']);
expect((screen.getByRole('button', { name: '批量生成' }) as HTMLButtonElement).disabled).toBe(false);
expect(addImages).toHaveBeenCalledWith(['/one.png'], { modelName: 'gpt-image-2', apiProvider: 'apimart-test' });
```

- [x] 执行并保存RED：pnpm exec vitest run src/__tests__/components/brand-ecommerce-lifecycle.test.tsx。

## 任务2：服务端结果契约失败回归（已完成）

文件：src/__tests__/api/brand-ecommerce-result-identity.test.ts。

- [x] 隔离after/供应商/账务/数据库，执行真实POST和已捕获后台回调。
- [x] 同步上游图片与异步上游任务均核对真实HTTP请求使用的模型，以及updateTaskProgress的partialResults和最终缓存每张图身份一致。
- [x] 不因请求中伪造显示名而采用客户端来源；错误结果也保留本次身份，但不产生虚构图片。

关键断言：
```ts
expect(result.results[0]).toMatchObject({ providerId: 'resolved-provider', modelName: 'gpt-image-2' });
expect(partial.results[0]).toMatchObject(result.results[0]);
```

- [x] 执行并保存RED：pnpm exec vitest run src/__tests__/api/brand-ecommerce-result-identity.test.ts。

## 任务3：最小实现（已完成）

- [x] 新增src/types/brand-ecommerce.ts结果类型，providerId/providerName/modelName为可选字段以兼容历史数据。
- [x] route.ts仅将实际provider和规范化model固定到每个results.push；部分/终态/缓存沿用相同数组。
- [x] brand-ecommerce-panel.tsx合并重复首次/重试控制流：运行句柄阻止并发，AbortController隔离旧请求；同一finish路径清理loading、taskId、计时与轮询。错误结果绑定本次真实模板。状态不明确时只结束本地等待并明确提示查询原任务，不自动重提。
- [x] 入画布读取results中的providerId/modelName，相同元数据分组使用现有回调；仅接受实际结果URL，不从选中菜单补身份。
- [x] BrandResultGallery展示错误全文且自动换行，部分成功不隐藏失败，正在生成时禁用重试。保留所有模板/结果/下载/入画布入口。
- [x] 运行两项新增测试与brand-ecommerce-provider-selection、model-defaults、provider-result-stores专项至全部通过。

## 任务4：集成与交付

当前执行证据：新增20项回归在未修改业务代码的独立基线上18失败、2通过；审查3处候选边界补4项RED后修正，最终5文件60项专项通过，独立复审无新增发现。最终610文件4470/4470零跳过、TypeScript/Lint、保护38/构建118通过，源码9b2e8d5f。首轮11环境跳过和两个中间中止保留；隔离测试库清理后停止。详见evidence/v588-provider-003-brand-lifecycle-20260831.json；云端不得据此记为通过。

- [x] pnpm ts-check、pnpm lint:build、全仓Vitest（隔离PostgreSQL且零跳过）、pnpm build与保护38项通过；失败原件保留，不调低门禁。
- [x] 检查git diff与认证/账务/模板/全局画布零变更，独立源码复审完成，源码提交9b2e8d5f只含批准文件。
- [x] 更新BUG_REGISTER/回归/发布/未验证/吸收清单与Obsidian，区分本地修复和云端待验。
- [x] push origin main后复读fac43cbf及stable不变；源码9b2e8d5f已包含，实际回执记录于Obsidian。
- [x] 原Coze同步一次并完成构建/单服务重启；合并c6b8cabb的tree/src tree匹配，Build ID D12Ets9rxSINh8SeuecwS，随后强刷原Chrome预览。
- [x] APImart真实单次任务ecom-1788182668572-7rblj5完成两图；部分/最终身份、改选Pear不污染、入画布/服务端保存/强刷恢复通过，BUG-004关闭。新增一笔-60，余额4880；不扩展为并发/退款通过。
- [ ] 新版云端失败重试收尾/真实模板ID与完整错误提示负向验收（BUG-002/003）；本次正向任务不替代，未人为变更权限/余额或重复消耗强造失败。

云端证据索引：docs/testing/evidence/v588-provider-003-brand-cloud-20260831.json。24份原件仅本地；未生成完整录像/Trace，3条Coze注入脚本加载失败与积分日期NaN保留。没有重跑本地门禁或改业务源码。

## 计划自查

三个Bug分别由组件与真实路由回归覆盖；没有加入Pear分层或其他未批准模块，没有更改生图数量、支付或取消退款机制。已有测试仅作基线，新源码后才跑新一轮完整门禁。
