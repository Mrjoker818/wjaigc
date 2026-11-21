# 精确路径补充源码审核

以下只解决已读源码的准入与来源记录，不授予数据库执行权限，也不声明正式运行通过。当前版本字节须由应用登记时的 Git blob 再次核对。

- `migrations/20261118_wj_drama_projects.sql`：全文创建短剧项目表及两个查询索引，包含 user_id、可选 project_id、JSON 文档与版本。未执行生产建表；实际所有者访问控制仍由当前服务层及真实验收核对，不由字段存在推定成立。
- `migrations/20261119_wj_video_product_type.sql`：全文仅在目标表/列存在时，给原 canvas 用户和分组补 video 权限；空/NULL 的原全平台规则不变。与上游拆出视频平台的意图一致，不据此扩大其他角色权限。受现有 opt-in 迁移入口约束，未执行生产更新。
- `migrations/20261118_wj_remove_node_workflows.sql`：采用已有完整删除语义复审；源码登记不等于允许执行删除。默认构建不运行，执行器另有已验证的历史非空/关系类型拒绝保护；原任务、私有回执与账务义务继续追踪，旧 SQL 与 checksum 不改。
- `src/app/api/drama/clip/route.ts`：全文检查登录及 video 权限，接受 file 字段，限制48MB和受支持媒体类型，保存到 drama-clips 并返回 videoUrl，存储错误固定500，不计费。当前没有新增 owner/project 资产关系，不把返回 URL 说成项目私有资产，也不把同进程/同主机重开说成 Coze 重发版持久化。现有实际 MP4/新进程证据保留这些限制；本次不更改文件服务可见性或宣称额外隐私保证。
- `src/lib/model-type-classification.ts`：全文349行已读。分类和302别名/元数据整理与权限准入分开；discovery fallback 是元数据候选，不能单独作为管理员授权。共同 catalog 的当前补丁另验证 selected 精确匹配、用户权限和裸名消歧，缺 selected 的 discovered-only 不可进入计费；本记录不恢复该漏洞或声明所有消费者已完成正式验收。
- `assets/wujie-coze-media/x64/LICENSE.txt` 与 `scripts/verify-annotation-upgrade.mjs`：采用独立完整文本及差异复审。前者仅为固定 GPLv3 文本内容与阶段脚本摘要关联，不是整库分发合规结论；Windows CRLF 与固定 LF 摘要差异须在实际发布字节中核验。后者只缩窄已退役节点范围，保留包路径、摘要、原目标及失败保护，不作为签名认证或全程序运行证明。

补充独立原始材料位于本机忽略目录 `output/canvas-chat-audit/ci-20261121/license-annotation-source-review/`、`remaining-history-source-review/` 及 D01/model-selection 各复审目录。后续仅增加实际缺失的精确路径，不授权整目录，不覆盖原160来源和286个历史授权元组。真实供应商、部署绑定、持久化和业务验收继续单列。
