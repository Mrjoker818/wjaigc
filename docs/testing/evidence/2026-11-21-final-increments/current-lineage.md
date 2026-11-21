# 内联图片发布与当前血缘：隔离复验

本记录属于源码增量与隔离运行证据，正式站 Edge、完整候选 CI、跨浏览器及原草图账务仍待验。不重复已通过的旧 Agent 场景，不调用真实供应商。

| 实际发现 | 最小修复 | 保留边界 |
| --- | --- | --- |
| 原生 TEXT[] 模型名单收到 JSON 字符串，真实账号创建报 22P02 | db-storage 按真实列类型写原生数组；历史 JSONB/TEXT 编码不变 | null 与显式空列表、权限、账务、用户身份保持 |
| 内联生成先返回 data URI，文档接收拒绝不受控来源 | generate 内部同步路径等图片保存成功后才返回受控文件 URL | 普通远程 URL 后台路径、原任务和取消保护不变 |
| 恢复任务已有受控文件，但完成资产缺真实字节大小 | poll-task 完成前复用现有元数据读取 | 租约、CAS、终态、真实文件可读性保持 |
| 已产出但保存失败被普通 5xx 恢复重试 | 精确 GENERATED_IMAGE_PERSISTENCE_FAILED 标记不可重试 | 原单次退款，正常上游重试不改；不重放旧任务 |

实际运行：用户列表新 6 例先 4 失败/2 通过，修复后与迁移/CAS 邻居合计 19 通过，合成账号在专属 PostgreSQL 创建和回读成功。内联生成既有 373 个邻居通过；新增真实 POST/回读/恢复定点 15 通过，其中不重放分类先 2 失败再通过。

Stage4 新增 @stage4-current-lineage 场景最终 1 passed（47.6 秒），只选新场景、单 worker、零重试，严格 console/network 检查保留。真实应用链涵盖 PNG 附件、loopback 视觉/图像响应、任务及资产版本、服务端 imageRef 血缘、同资产到画布采用、页面刷新、A→B→A 作用域隔离及接收回执幂等。两个重复同键请求产生同一 placement/sequence，数据库只有一条文档命令、一项生成任务。原始 source placement 的 metadata.sourceTrace 为空不是已证实业务缺陷；当前契约使用服务端对话 imageRef 和转入后的 placement 血缘，未为错误中间假设改写源数据。

本机原始日志位于忽略目录 output/canvas-chat-audit/：

- generate-inline-output-neighbors-20261121.log
- generate-inline-no-replay-red-20261121.log
- generate-inline-no-replay-green-20261121.log
- current-lineage-e2e-presence-ready-20261121.log

运行输入使用新专属库 wujie_stage4_lineage_20261121_3c48d9a2，原实例/原库/其他进程未结束，两个自建应用进程已单独停止并核验。构建标识对应脏工作区证据，不能冒充 Git 提交或正式部署版本。原草图 taskId 尚未精确关联，14 积分状态没有因此关闭，未重复付费。
