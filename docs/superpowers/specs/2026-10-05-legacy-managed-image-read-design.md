# 8C 旧图片缺 MIME：可信受管读取设计

## 所属范围与成功条件

本设计补齐整体第7/Yjs8C批注来源准入合同的读取基础，接续 `2026-10-04-annotation-source-admission`，不新建整体目标。最终业务仍须完成实际 execute→edit→本人收费一次→派发→持久恢复→canonical发布→受管交付。仅本读取基础通过不能关闭原Task1/2/3、8C或旧图片执行兼容。

现有实证：相同PNG原字节，登记MIME时完整链路成功；NULL MIME时来源/编译成功，但收费SQL409，受管描述也拒绝。静默补写原版本会改变既有完整行冻结指纹；单独放宽SQL则没有可信原媒体证明。采用只读派生描述，不改资产、版本、文件或账本。

## 契约

**当前限定结论（2026-10-05）：** 读取基础本地验证及独审完成，原I1–I4与后发现中文UTF8分块M2已确认ADDRESSED。最新候选在294七文件138PASS/1原NULL409/139中验证，292非增量tsc与296准确strictlint终态0；298保护59BLOCK，完整业务仍OPEN。下方“首审接续”的未修状态为历史，不重新开发已验收读取切片；后继继续原Task2可信原图证明用于收费/派发/持久恢复/发布。

仅 ready image 且 MIME字段真正缺失（undefined/数据库NULL映射）走新分支。空字符串、显式非图片、未知MIME、视频不进入派生；原登记MIME分支保持行为。仍要求登记 byteSize 为1..32MiB的安全整数；更广的缺大小历史恢复属于原来源合同剩余项，不能由这次隐式放开。

格式来自实际二进制，而不是扩展名、客户端或S3 Content-Type。支持现有六种受管图片：PNG/JPEG/WebP/GIF/AVIF/BMP。前五使用原可取消、15秒截止、等待close后释放租约的Sharp子进程完整解码，直接返回解码器验证的尺寸；BMP复用已有严格BI_RGB 24/32位完整像素布局验证。新分支最多2个完整读取、输入缓冲最多64MiB；已中止或非法deadline在I/O前拒绝；有效deadline最大30秒，并传递到S3和解码。

本地保留真实根目录、O_NOFOLLOW、dev/ino、实际文件大小及同文件句柄读取；S3保留精确key、size、ETag/VersionId条件读取。NULL MIME的S3 Content-Type可缺失或为application/octet-stream；显式图片Content-Type必须匹配实际格式，其他类型拒绝。不走公网URL或另外的数据根回退。

派生SHA256：登记checksum存在时只接受64位hex或sha256:64位hex且须匹配原字节；缺失时计算但不回写。登记尺寸存在时必须与解码尺寸一致，缺失时派生但不回写。不缓存派生结果。描述保持原assetVersionId和source，输出真实mimeType/byteSize/width/height/checksum。

readManagedAssetVersionBytes对缺MIME源直接切片并交付本次验证的同一缓冲，不在解码后重新打开文件/读取对象，避免返回未校验的替换字节；原响应大小/Range守卫不放宽。getManagedAssetMediaDescriptor只返回描述，不向调用方暴露原缓冲。

## 与收费和恢复的接续

本描述不是授权能力。后继必须由真实生产调用方在SQL锁外读取原图，绑定actor/owner/project/grant/entity/placement/version/URL、原版本整行指纹和派生byteProof，并在既有publication_intent持久冻结。收费锁下复验原身份/指纹，仅服务器持有的有效证明可以让对应NULL父版本准入；客户端字段不授予权限。派发、非终态重放和完成/恢复沿既有合同比对原证明；不新增任务/账务系统，不免费内部请求，不在锁内网络I/O。当前收费SQL保持严格直至这项接续通过真实PG失败注入。

## 验证和边界

真实本地文件与实际解码测试：六格式及GIF/WebP多帧、缺checksum/尺寸派生、登记checksum/尺寸冲突、损坏内容、数据库NULL/空字符串映射、明确非图片、大小、Range、abort、deadline。现有S3测试为精确读取接口替身，证明条件参数与实际返回字节后的校验；不等于生产HTTP/SDK响应流生命周期或云端S3验证，后两项仍待真实独立证据。读后替换文件不得改变已验证缓冲交付。原binary decoder生命周期测试及canvas-share原严格读取守卫回归保留。

## 2026-10-05 首审接续

Kuhn限定首审C0/I4/M1、不放行。空字段生产mapper及多帧尺寸、额外完整缓冲已分别形成实际RED，扩展storage.ts的两字段映射和safe-image-input.ts既有magic探测的只读导出；不改原版本或旧完整接缝测试。多帧保留animated全帧解码及总像素预算，描述返回pageHeight。I3本地I/O生命周期仍未解决：必须在独立可终止进程中完成路径、根、fd身份、读取/close，deadline/abort杀死并等待close后释租约；仅Promise.race早返/早释预算不能完成该门禁。不得因其他三个修复通过而关闭读取Task1。S3接口替身层级准确标注，生产HTTP/SDK与真实云端证据继续开放。

I3采用内联原生fs worker，不引入独立后台服务。父进程只分配一个登记大小输入缓冲，worker最多64KiB分块且等待stdout backpressure；文件校验和close都由worker完成。abort/deadline仅SIGKILL，真实close后才拒绝并释放读取预算。禁止继承NODE_OPTIONS/NODE_PATH，windowsHide/shell:false；stdout精确大小、stderr有界路径JSON、exit0与根内身份全部满足才进入原SHA/全解码。原登记MIME读取不重构。测试可在实际worker原生fs边界注入停顿，不能称真实磁盘/网络故障。

仅main原地编辑，stable只读；不安装、不重启原5010/55494、不接业务55432、不真实付费、不浏览器/Coze/推送/部署。已有控制清单保留历史；当前四条生产写路径须明确修前备份/新指纹，不把旧240的修前通过冒充修后验证。Pear移出、PSD保留。按用户免重复确认授权选择实现方案，但不扩大外部副作用。
