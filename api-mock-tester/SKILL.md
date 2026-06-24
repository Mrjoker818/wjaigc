---
name: api-mock-tester
description: 用于对Web应用API端点进行Mock自动化虚拟测试；当用户需要验证接口连通性、运行全量API冒烟测试、检查功能链路完整性时使用。
---

# API Mock 测试框架

## 何时使用

- 用户要求对应用所有API进行虚拟测试
- 需要验证接口连通性和响应格式，但无真实API Key
- 代码变更后需要回归测试
- 项目交付前需要全量功能验证

## 操作步骤

### 1. 启动Mock服务器

```bash
node ${COZE_WORKSPACE_PATH}/api-mock-tester/scripts/mock-server.mjs --port 3456
```

Mock服务器模拟以下外部API：
- OpenAI /v1/images/generations — 图像生成（返回最小有效PNG）
- OpenAI /v1/chat/completions — 聊天（SSE流式响应）
- OpenAI /v1/images/edits — 图片编辑
- OpenAI /v1/models — 模型列表
- 视频API — 6种协议（dashscope-kling/volcengine-ark/minimax/vidu/openai-video/fal-video）
- PearAPI / IOPaint / RemoveBG / 3D模型等

### 2. 运行测试

```bash
node ${COZE_WORKSPACE_PATH}/api-mock-tester/scripts/test-runner.mjs --target http://localhost:${DEPLOY_RUN_PORT} --mock-port 3456
```

可选参数：
- --target — 目标应用地址（默认 http://localhost:5000）
- --mock-port — Mock服务器端口（默认 3456）
- 环境变量 ADMIN_USER / ADMIN_PASS — 管理员凭据

### 3. 查看结果

终端彩色输出，通过/失败/跳过，汇总通过率。

## 测试覆盖

48+测试用例，15个分组：infra / auth / admin / image-gen / chat / image-edit / video / workflow / data-persist / svg-trace / edit / agent / task-mgmt / upscale / upload

## 资源索引

- scripts/mock-server.mjs: Mock API服务器，当需要模拟外部AI服务时运行
- scripts/test-runner.mjs: 测试运行器，当需要执行自动化测试时运行

## 扩展指南

在 scripts/test-runner.mjs 的 TEST_GROUPS 数组中添加新测试组，在 scripts/mock-server.mjs 的 MOCK_RESPONSES 中添加新Mock端点。

## 注意事项

1. 先启动Mock Server再运行测试
2. 管理员账户默认使用环境变量 ADMIN_USER/ADMIN_PASS
3. 测试前自动向管理员系统注册Mock API提供商
4. 异步任务测试会自动轮询任务状态
5. 零依赖：使用Node.js原生模块，无需安装额外npm包
