# 8C 原 Task2：旧图片实际字节证明

## 目标与原范围

接续已限定验收的legacy-managed-image-read，不建立平行目标。须使原D893完整NULL-MIME真实execute→edit→本人单次收费→真实worker→规范发布→managed原图交付通过，并覆盖伪造、来源变化、迟到、重放和恢复；完成此文档或证明生产器不能代替完整Task2/8C。

采用现有任务、费用、publication_intent和素材版本体系，main原地、不stage/commit/push/Coze/浏览器/安装/服务重启/真实模型付费；stable只读。Pear按用户2026-09-27决定移出，PSD核心保留。

## 选择与安全边界

不静默补写原版本MIME，否则冻结全行指纹会变化；不全局放宽MIME条件，也不信任客户端或内部HTTP携带的byteProof。采用服务端WeakMap能力：实际/api/edit先严格认证并解析原annotationSource，再读取受权原资产版本，只有数据库NULL MIME才生成证明。客户端JSON或structuredClone后的空对象不能伪造能力。

证明包含version=1、actorUserId/ownerId/projectId/grantGeneration、imageId/versionId/assetId/assetVersionId/placementId、原URL的SHA256、既有完整源行及父关系指纹、实际mimeType/byteSize/width/height/checksum；无凭证、原图或编译图字节。证明只读生成，实际受管读取完整解码/预算/取消沿读取基础；SQL事务和授权锁不跨媒体I/O。

读前短只读快照→释放连接→实际原图读取→重验来源授权和读后快照，前后完整身份一致才签发WeakMap能力。数据库空MIME/非图、缺大小、坏内容、SHA/尺寸不符仍拒绝。登记MIME不签发且保持原行为。

## 收费、派发与持久恢复

prepareCanvasTaskPublicationInTransaction必须在structuredClone前识别原WeakMap能力，再复制其只读数据；只有singleAdmission=edit且annotationSource完整匹配、唯一对应父版本、当前全行指纹相同时可让这一NULL版本通过既有图片准入。证明在既有annotationEditSource.byteProof与原sourceSnapshot、requestDigest一同持久冻结。非终态重放必须证明完全相同，客户端不能自带serialized能力，旧登记MIME任务不要求新证明。

实际worker加载的原图Buffer在任何变换/发送之前须匹配冻结实际SHA/大小/MIME；不能只验证编译overlay。媒体被换成另一张合法图时也不发送供应商。原撤权/来源原子复验、一次费用/退款、remoteTaskId已接受跳过重复发送保留。

完成和恢复的prepareTaskPublication在BEGIN/授权行锁之前校验持久证明与当前受权原图实际字节；随后既有事务再次核来源全行指纹、授权和selection。前后持久证明不得变化；最终assertTaskPublication沿原同事务指纹复验。不能持锁做解码，也不能因规范发布被拒绝重复退款已经接受的本人任务。

## 证据

原四案D893测试不改期望/断言。新证明真库测试覆盖NULL签发、登记MIME不签发、JSON克隆伪造拒绝、坏字节/不同合法字节/授权/URL/版本/指纹变化、持久proof严格schema及冻结；实际收费/dispatch/late/publication恢复案例不能由helper正控制替代。新增消费者必须保留旧typed/private/workflow/annotation合同回归，准确lint/tsc、保护基线和独审逐项留证；保护许可不扩。真实HTTP/SDK/S3、云端101/多实例/设备/build/NFT/CI仍待原门禁，不能由接口替身或本地PG推断。
