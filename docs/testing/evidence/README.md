# 测试证据规范

真实测试证据统一写入：

```text
test-results/evidence/<commit>/<featureId>/<browser>/<timestamp>/
```

每个目录必须包含 `manifest.json`，记录：

- Git commit
- 部署地址
- 浏览器和视口
- 采集时间
- 受保护 `featureId`
- 截图、视频、Trace、Console、网络、任务和服务端证据路径
- requestId 列表
- 状态：`completed`、`failed`、`blocked` 或 `unverified`

标记为 `completed` 时，至少必须存在截图、Console、网络和任务证据路径。仅有 HTTP 200、仅有界面截图或仅有代码检查都不能证明业务成功。

## 数据保护

- 不记录 API Key、密码、完整 Access Token 或 Cookie。
- 不复制用户隐私图片的原始字节到报告。
- 提示词、用户标识和请求体必须脱敏。
- 网络日志只保留诊断所需的状态、时序、requestId、taskId、provider、model 和错误信息。
- 证据目录属于测试产物，不提交 Git；只提交规范、清单和经过脱敏的摘要。

## 阻塞记录

缺少真实数据库、供应商密钥、对象存储、支付环境、授权账号或可访问部署时，创建 `blocked` 记录并写明阻塞原因。禁止用 Mock 或本地静态结果替代真实云端结论。
