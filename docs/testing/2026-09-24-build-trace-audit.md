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

## 2026-09-25 当前主线数据根目录追踪边界

本地 `main@125de216` 在只提交目标源码的前提下完成数据根目录运行期路径的两层最小忽略标记。先前临时单路由探针由约 4,080 文件、包含 `next.config.ts` 降至 125 文件、不含配置；探针已从源码撤回。本轮重新执行不含探针的 `pnpm build`，退出 0、静态页面 121/121、检查 239 份 trace，并确认 `.next/server/app/api/traceprobe-dataroot/route.js.nft.json` 不存在。该构建并非干净 exact-tree：六份既有 `.superpowers/sdd` 用户文档仍为未暂存修改，`.next/BUILD_ID` 与完成标记均为 `unverified-652339ac9e6a18c6c79baeed5f710477`，不能等同 `HEAD^{tree}`。

正式 API NFT 审计为 **227 路由、510,186 累计引用、75 条宽路由、26 条含 `next.config.ts`、27 条含项目根 Markdown**。`node scripts/audit-build-traces.mjs --strict` 退出 1。与此前主线只读记录的 227/215/214/214 对比，本地追踪显著收敛，但严格门禁仍红；这个对比不是同一份 clean-tree 云端构建的发布证明。当前剩余配置路由包括 `generate`、`image-edit`、`vision-prompt`、`serve-upload/[...path]`、`recover-images`、`cache-image`、`chat`、`agent-runs`/`skill-runs` 等 26 条；另有仅命中根文档的 `/api/user-data/record`。构建警告仍显示 `generate` 等路由对运行期媒体文件的项目级模式匹配，下一步需按正式导入链逐入口收敛，而非再扩大 `server-data-root` 的忽略范围或放宽审计器。

本轮真实临时文件测试 3 文件/6 项、`pnpm validate`、保护基线 38/38 且 0 警告均退出 0。独立只读复审未发现本轮明确新增回归，但指出既有的迁移“空目录”文字与 `system/users` 实际判据不完全一致，以及保存/写目录的 `..` 和删除经符号链接越界的旧风险；这些尚未形成新的 RED→GREEN 修复，不宣称已解决。当前未推送、未同步 Coze、未部署、未主动查询或修改业务数据库，也未执行付费任务；`stable` 保持只读。严格 NFT、运行时资源装配、Coze 同源 `101`、真实付费取消/唯一退款、CI 和正式发布仍为独立开放门禁。

## 2026-09-25 缓存图片路由的当前主线增量

在上述无探针构建中，`/api/cache-image` 的 NFT 为 **5,309 文件，含配置与 24 份根文档**。本地 `main@4f52221d` 仅将该路由两处运行期目录存在性判断接到已验证的 `pathExistsSync`，并补真实临时目录测试，覆盖生产环境的持久目录和 `public/uploads` 缺失时创建、已存在时保留原文件、新图片双副本及返回 URL。改动前行为测试 2/2 已通过，是保留行为的 characterization；真正的构建级 RED 是上述 NFT 污染，不把行为测试称为失败测试。

改动后的完整 `pnpm build` 退出 0、121/121 页、239 traces；目标路由降至 **2,753 文件，不含配置或根文档**。全站变为 **227 路由、507,631 累计引用、75 宽、25 含配置、26 含根文档**；严格审计仍退出 1，目标路由也仍高于 2,000 的宽阈值。独立只读复审未发现这两处替换的新增功能回归，并明确不将局部收敛外推为全站绿灯。聚焦 3 文件/4 项、`pnpm validate`、保护基线 38/38 且 0 警告均退出 0。

本轮另起 `127.0.0.1:55486` 临时 PostgreSQL 18 集群和全新 `wujie_trace_cache` 测试库，应用 29 项迁移后全量 Vitest **853 文件/7,304 项通过，0 失败、0 跳过，退出 0**。集群已正常停止且 55486 无监听；精确临时目录 `J:\无界本地版\projects\_tmp_e2e\pg-trace-cache-2ec37756` 的递归清理被执行策略拒绝，未绕过，目录仍保留。六份用户文档脏改使本轮构建身份仍为 `unverified-*`，不能宣称干净 exact-tree，也未推送或部署。下一步继续按正式残余清单处理 `recover-images`、`serve-upload`、`vision-prompt` 等入口，并在所有本地门禁绿后才做 Coze exact-main 验收。
