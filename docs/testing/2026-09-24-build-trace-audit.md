# API 构建文件追踪审计（2026-09-24）

## 目的与边界

`scripts/audit-build-traces.mjs` 只读取已完成构建的 `.next/server/app/api/**/route.js.nft.json`，不修改追踪清单、源代码或业务数据。它用于识别 API 路由意外追踪项目级文件的现象；清单收敛不能单独证明 Coze 部署内存问题已解决。

## 用法

在目标源码树完成 `pnpm build` 后执行：

```bash
node scripts/audit-build-traces.mjs
node scripts/audit-build-traces.mjs --strict
```

检查另一份已构建源码树时，可加 `--project-root <绝对路径>`。默认宽路由阈值为 2,000 条引用；`--wide-threshold <正整数>`只改变统计分类，不改变严格模式的判定。

输出为 JSON：API 路由数、引用总数、宽路由数及完整宽路由清单、含 `next.config.ts` 的路由、含项目根目录 Markdown 文档的路由，以及引用数最高的十条路由。Windows 上按不区分大小写的路径语义识别项目配置和根文档；其他平台保留大小写敏感的路径语义。`--strict` 在任一 API 清单包含配置文件或根文档时退出 1；没有 API 清单或清单损坏也以错误退出。该模式目前用于发布候选的人工门禁，**尚未接入 `pnpm build` 自动失败链**。

## 当前证据与后续

干净 exact-main 本机构建的只读审计结果是 225 条 API 路由、604,922 条累计引用、212 条宽路由；同样 212 条路由包含 `next.config.ts` 和项目根文档，因此严格模式退出 1，目标清单哈希前后不变。修订后的隔离工具分支构建因新增脚本/测试本身被现有宽追踪收录，累计引用变为 605,347；`--strict` 仍退出 1，完整宽路由清单为 212 条。不能把该差值解释为产品变化或已收敛。

在全新 localhost PostgreSQL 18 测试库上完成 26 项迁移后，候选树完成最终全量 `vitest` 回归：835 个测试文件、7200 项全部通过，退出码 0；专用数据库服务随后停止，55591 端口关闭。`pnpm validate` 和 `pnpm build` 亦退出 0。此结果只证明本地回归，不代表 Coze exact-main 打包或正式部署已通过。

下一步先在保留同步目录选择、可写检测、旧数据迁移与图片读写行为的前提下收敛 `server-data-root` 的未限定动态文件路径；再由本审计确认异常文件消失，并以持久化回归、完整测试和 Coze exact-main 打包验收证明可发布。旧候选的 OOM 不能代替最新源码的正式部署结果。

## 2026-09-25 主线与既有隔离候选只读对照

本轮没有修改业务源码、重新构建或连接业务库。当前本地主线 `main@d3dfe4eb` 的既有构建身份为 `unverified-*`，只读审计得到 **227 路由、965585 累计引用、215 宽路由、214 条含 `next.config.ts`、214 条含项目根 Markdown**；`--strict` 退出 1。该构建在本轮文档改动之前产生，不能作为改动后的 exact-tree 证明。

既有隔离候选 `codex/trace-runtime-path-20260924@ba8d50be` 工作树干净，其现存 `.next/BUILD_ID` 与 `HEAD^{tree}=803bc9ce8686df24f9fd6e5e0a0b397391cdb470` 一致。对该旧源码树的现存构建只读审计得到 **225 路由、53 宽路由、11 条含配置、12 条含根文档**。这证明该候选树的打包追踪显著收敛，却不证明把候选移植到当前 `main` 后得到相同结果，也不证明 Coze OOM 已消除。候选的 `--strict` 仍应判失败；不得推送或部署。

候选中残余 11 条含配置的路由为 `/api/credits/payment-config`、`/api/diag/storage`、`/api/export-project`、`/api/generate`、`/api/image-edit`、`/api/image/health`、`/api/image/start-services`、`/api/image/upscale`、`/api/image/upscale-pro`、`/api/refine-engine`、`/api/upscayl`；另有 `/api/user-data/record` 命中根文档但未命中配置。图像工具与生成入口可能共享运行期文件访问链，这只是下一步要以独立构建验证的假设，不能由清单重叠直接归因为同一函数。

正式目标要求只修改 `main`，而旧实施计划要求候选仅留隔离分支，二者不一致。后续实施以用户的 `main` 约束为准：先重新建立当前主线的行为 RED/GREEN 与真实 NFT 对照，保留数据根优先级、迁移、媒体及 S3 回退；严格审计未通过时只作为本地未发布候选，不把旧分支结果直接合入、推送或用于 Coze 同步。不得降低严格审计条件或用全局追踪排除制造通过。
