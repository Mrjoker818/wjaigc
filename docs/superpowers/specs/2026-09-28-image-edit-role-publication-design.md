# 图像编辑主图与蒙版独立发布设计

状态：Task8Cb3j4a本地限定完成，证据见本计划SDD task-8cb3j4a-report.md、fix2-review及controller-final-gates。M1并发补写缺失mask的额外覆盖留最终全分支审查，未冒充已验证。只关闭多角色发布这一纵向切片，不代表完整image-edit执行器、费用规则、父预付或UI已经接入。

## 目标、依据和方案

依据完整调查稿 `2026-09-28-image-edit-durable-integration-design.md` 的多角色结果要求。新图像编辑必须让primary保留原有derived/revision与append/replace意图，mask始终是独立derived资产并排附加；同URL仍是两个角色。准入、完成、逐项导入、重试恢复、手动采纳必须使用同一个服务端冻结合同。

采用既有publication_intent JSONB的可选版本化扩展与每输出capability；不新增表、队列、积分账本或供应商状态机。不采用修改全局outputUrls加入mask（会影响所有旧任务），不采用导入时看到maskUrl临时追加（没有请求意图且可能重放重复/继承revision）。

用户已经授权自主执行最优方案且限定main-only；不重复请求常规设计批准。Pear分层专项排除，PSD核心不删除；本角色功能不是Pear或新的PSD方案。

## 固定边界

- 仅本地main，保留dirty和七保护文件；无stage/commit/push/分支/worktree/stable/donor/安装/.env/业务库/供应商/付费/Coze/部署。
- 每条shell首句 `. '.superpowers/sdd/2026-09-25-v588-yjs-canvas-collaboration/task-8cb3i2-environment.ps1'`；workdir为 `J:/无界本地版/projects/_upstream-wjaigc-restore`。
- 仅复用127.0.0.1:55492/wujie_yjs_task8cb3i2_20260927，独立schema串行；不启停PG、不删除旧媒体或目录。每suite在WUJIE_DATA_DIR下建task-8cb3j4a前缀媒体子目录，所有非本地fetch拒绝。
- 上述端口/库名限定本轮执行环境，不写死进永久suite；永久测试要求显式测试URL与loopback校验，支持后续CI的另一独立本地库。当前仍只运行环境脚本绑定的3i2库。
- 不改变计费合同或当前route执行；未来执行器须在真实接受和后处理持久化后产生下述checkpoint。本段测试真实账务/任务/发布事务，但不冒充供应商接受或十action端到端验收。

## 1. 原子准入与规范意图

CanvasTaskPublicationInput新增服务器专用 `imageEditOutputs?: { version: 1; includeMask: boolean }`，且singleAdmission新增image-edit；必须成对出现。客户端CanvasPublicationIntentProposal继续strict，不接受角色、fingerprint、maskPlacement或资产族覆盖。

image-edit单任务要求实际type=image-edit、非空幂等key、64位小写hex requestDigest、至少一个规范image父版本；revision恰好一个父。允许append和replace，但不能放宽原edit/generate/universal-generate的append合同。persist时再核task type、image_edit_前缀、actor/project/key/digest；不允许其它task类型借用新policy。输入在第一次await前复制，不受调用方后续修改影响。

在原账务创建事务、授权和文档锁下解析root意图，并生成规范扩展：

```ts
imageEditOutputs: {
  version: 1;
  includeMask: boolean;
  requestDigest: string;
  sourceSnapshot: Array<{
    versionId: string; fingerprint: string;
    assetId: string; assetCurrentVersionId: string | null;
  }>;
  maskPlacement?: {
    action: 'attach';
    transform: { x: number; y: number; width: number; height: number; rotation: number; zIndex: number };
    strideX: number;
  };
}
```

sourceSnapshot由readOrdinaryPublicationSourceSnapshot在该事务中捕获，不信任调用方副本。includeMask=false时禁止maskPlacement；true时必须有。append的mask位于primary.x+primary.width+32；replace时由准入文档中的目标几何冻结mask到其右侧，rotation=0，zIndex=min(target.zIndex+1,1000000)。主图replace维持原目标。几何沿既有schema验证，strideX=width+32，之后不重算。

规范parser严格验证并深冻结扩展及内部数组/对象；sourceSnapshot与有序parentVersionIds逐项一致，不允许重复、多余或缺少。已有v1且无扩展的旧意图保持兼容。同键重放对policy、parent/projection、selection或replace身份、请求摘要精确比较；不借重放重写布局。任何准入失败与publication持久化失败仍须令任务/消费一起回滚。

终态重放仍须遵守上述合同。RED04证实既有cloud-task-storage跳过所有终态prepare，因而允许已完成image-edit同键改变includeMask。精确写范围例外：只在`singleTaskIdentity?.type === 'image-edit'`时让completed/failed/cancelled/timeout也执行既有prepare；其他类型维持原非终态条件，不改终态迁移、账本、费用、j3 wrapper、batch revision或任务result。真实测试须证明合法终态精确重放（包括自身primary replace）仍可复用，policy/来源冲突不产生任何任务或账务变化，并保留其他类型终态重放行为。

首审I1范围裁定：这里的“第一次await前复制”以真实createBillableTask→createBillableCloudTask调用链为准，不能仅在内部prepare复制。允许cloud-task-storage在新image-edit publication准入首次await之前复制整份canvasPublication（含访问、选区、意图及角色policy），后续只读该副本；不修改billing-service、旧类型行为或账本/任务终态逻辑。测试必须直接调用真实createBillableTask并在同一同步栈修改调用方policy/嵌套意图，核实际冻结内容及一次消费。

fix1复审澄清：复制不能依赖尚未校验的singleAdmission恰好合法。实际task.type=image-edit且有canvasPublication时，先捕获完整副本，再由既有验证拒绝不配对标记；起始错误的非空标记（如generate）即使调用后改回image-edit也必须拒绝，不留下任务/publication/消费。不改变其他实际task.type的历史行为。此为原I1完整输入合同，不新增第二个功能或账务规则。

## 2. 服务端持久结果身份

新任务完成后只接受cloud_tasks中持久的 `result.imageEditPublicationCheckpoint`：

```ts
{
  version: 1, taskId: string, requestDigest: string, status: 'persisted',
  providerId: string, modelId: string,
  outputs: [
    { outputIndex: 0, role: 'primary', url: string },
    // 仅includeMask=true时必须存在：
    { outputIndex: 1, role: 'mask', url: string }
  ]
}
```

这是服务器持久输出checkpoint，不是客户端提交的清单：发布入口只从数据库读取；严格匹配冻结policy、task.id/type/request_digest，provider/model非空；输出列表精确1或2项，角色/序号/顺序固定，不容重复角色、交换、缺项或第三项。top-level imageUrl必须等于primary URL；includeMask=true时maskUrl必须等于mask URL。includeMask=false时旧shape中的maskUrl可以存在但绝不发布，checkpoint自身却不能多出mask。相同URL允许，禁止Set去重；URL只按安全媒体层读取规则处理，不能直接信任任意HTTP。

新image_edit_任务缺policy、checkpoint、请求摘要不符或尚未completed均不能落入旧flatten路径发布。历史非该前缀且无扩展的任务不改变输出规则。角色结果不使用公开assetProjection作为身份权威；模型身份来自同一经验证checkpoint，不从可变当前配置读取。本段不新增HTTP写checkpoint接口；完整执行器接入时必须另外验证accepted→persisted的真实性。

## 3. 一个输出规则贯穿三层

PublicationSnapshot增加已复制的outputs，每项有url、intent及新任务role/providerId/modelId；旧任务也生成与原request完全相同的逐项规则。requests和outputs严格同序同长度，幂等key仍canvas-task-output:v1(actor,project,task,index)，不能另起角色随机键。

primary使用root parent/projection/placement；mask使用同一有序原始parent、derived、冻结maskPlacement。document-media-source从capability选中output读取URL/父系/资产族，并记住outputIndex；最终persist不能再用root意图决定revision。document-media-import最终事务使用同一output写sourceVersionIds、父边、模型身份以及可审计的outputRole/outputIndex元数据。仅primary revision更新原asset.current_version_id；mask新建自己的asset。

新角色任务的手动adopt也必须取得DB-minted capability，精确匹配对应canonical request（project/index/command/key），然后进入统一发布路径。任意换project、换command/key、sourceVersionId覆盖或伪造role被拒绝；旧普通手动导入保持兼容。底层prepareMediaTaskSource对image_edit_无capability须拒绝，避免只在最外层挡住绕过。

## 4. 来源、恢复和权限

每次prepare与最终事务重新读取冻结来源fingerprint，比较完整version/asset/有序parents；撤权、重新授权generation、停用协作、源删除/替换/跨scope必须拒绝。移动画布不重新布局也不改变来源身份。

这里的源删除/替换包含canonical placement：即使旧version/asset仍ready，原选区对应摆放被其它操作删除或换版，也不能继续作为未变化的来源发布。应复验冻结选区与有序父版本的规范画布引用；坐标移动不改变身份。例外只限下段证明的本任务primary replace，不能将“版本仍可读”当作第三方替换也可接受的依据；不得改变旧ordinary任务既有语义。

摆放替换例外与原资产head归一化是两个条件：derived+replace也要凭本任务primary/index0的准确command、lineage、有序parents及derived模式证明允许继续补mask/完成/重放，此时原资产head不变；revision+replace还需要下述原head证明。不能只在head变化时校验或允许自有replace。四种derived/revision×append/replace均须保留。

唯一允许的原asset head变化是同任务已发布primary revision。复用现有DB联合证明：ready version、同task/owner/project/actor lineage、output_index=0、准确command key+source digest、准确有序parents。不能仅task_id或assetProjection证明；mask/index1、其它任务或不完整证据不能触发归一化。普通ordinary任务原有保护不得弱化。

primary成功后mask失败，既有主图保持；恢复沿相同key返回主图已有引用并只补mask。并发/restart重复发布不多建版本/placement/命令，不新扣费或退款。不允许因第二输出错误将整个结果伪装完成，assetProjection仅在两项实际成功后completed。主图replace以后原placement不再引用旧version，仍允许凭冻结源与已发布primary联合证明完成mask，不依赖重新解析当前选区。

## 5. 验证和完成定义

先真实PostgreSQL业务RED，至少证明revision+mask原行为少输出/错资产族或replace多结果拒绝。不能用缺新导出、TS错误作业务RED。新测试走真实createBillableTask/transitionTask/publication/media/final SQL/Yjs，只有server-only标记、禁止外网及可控磁盘故障等外部边界可替身；不mock核心账务/事务/授权/结果投影。

覆盖：primary-only；append derived与revision；replace revision；相同URL；缺mask/额外角色/乱序/摘要或task/type错误；调用方变异；同键policy冲突与事务回滚；手动伪造；中途mask故障后重试；并发同键；source变更/撤权交错；自身primary head合法恢复和伪造mask head拒绝。断言实际SQL资产族/父边/命令/余额、持久Yjs几何和projection状态，而非只断言helper返回对象。

相关旧publication、media import/source、ordinary generation集成测试全部回归；非增量tsc、改动TS lint、限定独立规范/质量审查通过后才算本地本切片完成。主控核七保护SHA、refs/空index、38保护门禁；新增路径经审查后精确许可。不执行全平台/云端或真实供应商门禁；它们及完整image-edit/父预付/三工作区UI/草图保持开放。
