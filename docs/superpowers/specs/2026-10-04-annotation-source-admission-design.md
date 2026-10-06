# 协作批注来源授权与修图接缝设计

属于整体第7项/Yjs 8C，不是新阶段；8D、8E、内部Task9及整体第8项均不因此关闭。用户已授权自主选择方案，本文不提交或部署。

## 证据与根因

`output/playwright/semantic-target-source-20261004/annotation-source-red-matrix-03.log`：真实两个POST和来源查找中，外国项目/不存在图片配合`sourceImageUrl`分别得到200/202，而应404；30项中4失败。数据库持久化和远程模型/最终付费提交为替身，不称真库或真实付费证明。真实编辑者UI识别返回422并切回框选，仅证明无模型时安全失败。

两个接口的来源查找失败后直接信任客户端URL及版本，既绕过项目归属，也不支持合法文档编辑者。独立GET同一文档的来源`createdAt`随读回变化，不能作为持久内容版本。执行器转发`/api/edit`缺少项目和资产父版本；此外编译后的编号参考图是data URL，不是另一个已登记资产，不能冒充普通协作参考图。

## 方案裁定

采用服务端授权来源快照，复用现有`readGenerationProjectAccess`及`/api/edit`协作原子准入/任务/费用/发布。拒绝仅删URL兜底而不支持协作的收缩方案；拒绝将共享项目复制到个人列表。旧`findOwnedAnnotationSource`的其他业务消费者不在本修复内，不全局替换其语义。

## 来源合同

新增`findAuthorizedAnnotationSource(actorUserId, projectId, imageId)`。配置PG时，在同一REPEATABLE READ READ ONLY事务读取项目授权、项目状态、规范文档投影、活跃摆放及ready图片资产版本；entityId、placementId、版本、owner/project必须一致。返回服务器URL和持久批注版本以及服务端access（actor/owner/grantGeneration）和资产引用。文档禁止退回旧私人快照，视频海报不可作为源图。

未配置PG的旧私人文件模式仍使用原本人项目查找；不得将配置了但失败的PG服务降级成文件授权。外国/缺失来源404，不匹配或变化409，数据库故障503且不泄漏SQL。任何客户端URL、owner或grant字段均不能制造来源。与既有图像编辑来源合同一致，历史已登记image版本可缺MIME元数据，但显式非图片MIME拒绝；真实图片字节仍由现有安全读取及编译器校验，不把NULL MIME当作模型识别或解码成功。

文档源图用entityId及assetVersionId生成稳定、长度有界的批注版本，私有/通用asset mapper有旧持久身份者原样沿用；文档读回的源图身份必须绑定当前规范版本，不能沿用可能属于前一资产版本的legacy别名。派生展示createdAt不作为授权。现有标注记录、orderKey、语义版本和墓碑不批量迁移或改写。旧标注与当前版本不同必须提示stale，不能自动重新绑定后执行；恢复后旧标注是否可执行仍须单独验收，内容恢复通过不代表可执行通过。

来源复验在识别返回、编译完成且付费转发前进行；必须比较原actor/owner/grant、placement/asset/version/URL/批注版本。不在远程I/O期间持有数据库锁。识别撤权或换版的迟到结果不得成功返回。最终付费修图仍由现有准入和发布事务再次核验，不把点时快照当持久授权。

## 下游修图合同

执行器必须保留本人身份与projectId；文档请求转交服务器解析的assetWorkspace=canvas、assetWorkspaceId、assetParentVersionIds及源摆放/授权代次，不从客户端制造。编号参考图要走单独的受信内部编译产物字段，不能加入普通参考资产列表、跳过其授权，也不能接受外部请求伪造该字段。其字节参与完整请求摘要，蒙版和编号图实际送至指定provider/model。原grant在转发和收费期间变化必须拒绝，不能以新grant替换后收费。结果由既有canonical发布处理，UI迟到回调不得另造幽灵图片。

## 验收与边界

先保留四个RED，再补真库owner/editor/陌生人、撤权重授、删摆放、换版、视频、不可用资产、错误投影、数据库失败、合法旧私人来源及识别中变化。比较相关表前后，来源读取零写入。mapper连续读回身份稳定，有持久旧版本不改。下游需真实执行器HTTP请求和现有edit准入/任务/计费/发布的真库故障矩阵，不能只断言最终提交mock。

本地定向测试、非增量类型检查、准确路径lint/保护检查与独立复审分别记录；全量、构建、严格NFT、真实远程视觉/付费、Coze 101/多实例/重启、Chrome仍单独未验证。沿用现有隔离PG，不接业务55432，不复制真实模型配置或发新付费任务；main-only/stable只读，allowlist未经审查不扩。
