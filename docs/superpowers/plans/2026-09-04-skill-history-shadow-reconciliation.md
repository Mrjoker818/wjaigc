# Skill历史恢复后同步冲突实施计划

> 执行要求：使用executing-plans逐项实施，先失败测试，再最小修改，保留全部证据。

**目标：** 修复shadow旧删除节点重新合入导致的批量保存失败，以及历史恢复图片尺寸错误。

**架构：** 保留现有资产、项目修订及生命周期权威。服务端返回与项目快照一致的明确删除身份；客户端精确过滤而非覆盖本地集合。尺寸从可信元数据或现有安全读取路径补全。

**技术栈：** TypeScript、Next.js、PostgreSQL、Vitest、Chrome。

## 全局约束

- 仅main，stable不动；不清缓存、不直接修业务库、不自动恢复trashed。
- 普通本地新增图片必须保留，完整性及权限校验不放宽。
- 不重做Stage4，不新增供应商任务，不更改GPU策略或运行模式。

## 1. 删除身份契约和客户端回归

文件：`src/__tests__/lib/user-manager-asset-v3-authority.test.ts`、`src/lib/user-manager.ts`、`src/lib/asset-core/deleted-canvas-placements.ts`。

- [x] 使用真实UserManager加载/保存路径增加shadow测试：明确删除身份不再进入下次POST，未同步图片仍保留。
- [x] 增加身份不匹配、缺失删除记录、并发恢复/请求晚到反例。
- [x] 运行新测试并保存RED结果，不以Mock外部响应冒充云端通过。`output/skill-shadow-deletion-red-20260904.json`：10通过/1失败，失败为旧节点未排除。
- [x] 最小实现解析与精确过滤，复用请求代际和revision检查。

进度：客户端五字段精确过滤、过期revision拒绝、mutationGeneration接纳守卫均已接入；本地新增、身份不匹配及GET期间新增反例已通过模块回归。历史RED和阶段性测试统计保留在测试报告，本节只记录当前状态。

## 2. 服务端一致性和权限

文件：`src/app/api/user-data/sync/route.ts`、`src/lib/asset-core/canvas-project-sync.ts`及对应API/隔离PG测试。

- [x] 在同一只读一致快照读取项目、revision及当前用户已删除画布身份；单条SQL读取，避免读取间恢复导致混合时点。
- [x] 覆盖跨用户隔离、并发删除/恢复、身份字段；新增行为先RED，缺失配置直接调用真实读取函数确认拒绝。
- [x] 接入响应契约，旧客户端及legacy兼容；无法读取时明确失败，不返回伪空列表。
- [x] 运行真实隔离PostgreSQL专项，不使用云端业务库跑破坏性测试。

进度：API一致快照、读取失败拒绝、字符串快照归一化及归属过滤已接入；真实隔离PG覆盖跨用户隔离、删除/恢复变化和事务快照中的并发恢复。客户端显式恢复晚到已验证。独立tsx进程清空DATABASE_URL/PGDATABASE_URL后，assert.rejects(readCanvasShadowSnapshot(...), /No DATABASE_URL or PGDATABASE_URL/)通过，退出0；未连接任何数据库。任务2本地验证已完成，最终发布门禁及云端仍待完成。

## 3. 历史恢复尺寸

文件：`src/lib/asset-core/storage.ts`、`src/components/infinite-canvas.tsx`及相关恢复测试。

- [x] 重现version尺寸null、transform空、恢复快照缺失尺寸并被归一化成1的链路。
- [x] 保留删除前几何与原始尺寸；缺失时复用现有浏览器图片尺寸读取，在锁外完成，拒绝伪造占位尺寸。
- [x] 本地测试验证迟到结果、读取取消、恢复后删除及读取失败不破坏原图；不代表云端验收完成。

取消边界新增RED为5通过2失败（`output/skill-size-cancel-red-20260904.json`）。最小修复后8项尺寸专项已包含在通过的模块套件中，覆盖独立读取、取消重试、失败URL不无限重试、换URL重试、删除及相邻完成。读取失败仍不具备真实尺寸，不能按尺寸恢复成功验收。

## 4. 回归与发布

**当前状态：本地发布候选门禁完成，main候选已推送，Chrome云端验收未完成。** 最新只读核对本地HEAD及远端main均为`db3f9ca6283b905d920c9d57051b9825e438eae4`，tree为`63d5cddc9fe4e60565f9a7ea338426f7ecca5fd2`，远端stable仍为`52f7c601ed150769e15d06fb435c6e360e28c9e7`。Coze同步指令已发送一次，尚未取得构建终态；当前正确Chrome项目页和预览页返回`Debugger unattached`，不是Coze构建失败证据，不重发或重建。最后源码修改之后5253项全量通过0失败0跳过；ts-check通过；全仓lint0错误944警告（943存量+1非阻断cleanup ref提示）；38功能保护通过。默认4GB构建OOM退出134的证据保留，确认本机容量后进程级8GB重试退出0，119/119页面，Build ID zYUQ6fpF8dLGH1FP9itrn。下方阶段检查点为历史记录，不重复执行。

最新续接：尺寸取消/失败/逐张完成边界已关闭本地测试；完整5251通过0失败0跳过后，独立审查又发现本地新增与GET竞态、字符串快照漏传模式。两项先RED（32通过2失败）后最小修复，最新127项模块回归通过，ts-check通过，本轮改动文件lint为0错误19警告。最后两项修复后的最终全量、构建与云端仍未完成。Chrome正确项目及原预览连接已恢复，云端仍为旧tree74b594，不能提前验收新修复。详见测试报告最新检查点。

此前5234项加12项补跑、5251项完整运行、首次功能保护失败等证据均保留在测试报告，不作为最后两项修复后的最终门禁。当前正在执行`output/skill-shadow-release-full-20260904.json`对应全量运行；等待真实终态后更新。

- [x] 模块回归、全量Vitest含隔离PG、ts-check、lint、功能保护、生产构建全部取得真实退出码；保留默认堆OOM与944项警告，不声称零告警。
- [x] 检查diff及stable未变化，统一提交推送main候选；本轮git ls-remote再次确认远端main为db3f9ca6、stable未变化。
- [ ] Coze指定SHA/tree同步、受控构建重启；现有Chrome强刷后检查旧节点不复活、蛋糕尺寸正确、所有项目保存/刷新正常。
- [ ] 更新验收报告、缺陷登记和Obsidian；未验证部分不标通过。
