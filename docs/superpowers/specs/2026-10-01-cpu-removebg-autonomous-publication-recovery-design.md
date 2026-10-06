# CPU 去背景画布发布的无流量恢复设计

状态：本地候选设计，非发布许可。仅覆盖已收费并完成 CPU／local 去背景执行、但文档画布主体图与蒙版投影尚未完成的任务。

## 问题与边界

当前完成任务的投影失败会留下 `assetProjection=projection_pending`，重放、本人轮询和项目恢复请求能重试；没有请求时不会推进。恢复器不得重新运行模型、创建新任务、更改报价、消费或退款。个人画布、一般生成、其他图像编辑动作及 Pear 分层不在本纵切内。

## 方案

Node 服务器启动时沿用 `instrumentation.ts` 的 worker 模式，非构建阶段启动单例定时器，启动后立即尝试一次，随后每分钟扫描。数据库只选 `cloud_tasks.status=completed`、`provider_id=local-rembg`、准入种类为 `document-cpu-removebg`、存在持久 `wujie_canvas_task_publications.publication_intent`、且投影未完成的任务；每批最多 10 条，失败后的 `lastAttemptAt` 至少间隔一分钟。扫描故障只记录固定错误码，下一轮重试，不阻断服务启动。

每条任务使用专用数据库连接上的会话级 `pg_try_advisory_lock`；抢不到锁就跳过。锁内重新读取任务状态和投影状态，再直接调用既有 `projectCanvasTaskResult`，由它重新验证持久发布意图及权威来源，走现有幂等双角色发布。这里不能调用带普通工作区 fallback 的 `projectPersistedCompletedTask`：若意图在扫描后被撤销，fallback 会把此专用任务错误发布为普通结果。失败时只通过既有 `recordTaskProjectionPending` 留下错误与退避时间。`finally` 释放锁；解锁异常丢弃连接，不能把不确定连接放回池。多实例与用户主动轮询可并发，业务发布自身仍以持久幂等键和事务锁裁决。

## 验证

先通过真实隔离 PostgreSQL 复现“完成且待发布的任务不发任何 HTTP 请求仍保持待发布”，再直接驱动一次扫描，核两项受管资产、画布投影、任务状态、单次消费及零模型重跑；并行扫描不能产生重复版本。单元测试覆盖批量上限、错误后的后续轮次、Node 启动与构建/Edge 禁用。最后执行相邻回归、类型、目标 lint 和构建；正确预览页与生产多实例运行另记未验证。不得因本纵切测试通过解除保护基线或发布门禁。
