# API Mock 虚拟测试技能

## 概述

基于 Mock 的 API 虚拟测试框架，通过模拟外部 AI 服务接口（OpenAI/Gemini/Video APIs 等），对 Web 应用的所有 API 路由进行自动化集成测试，无需真实的 API Key 和外部服务即可验证功能链路的完整性。

## 适用场景

- Web 项目交付前的全量功能验证
- 代码变更后的回归测试
- CI/CD 流水线中的自动化测试
- 新功能开发时的接口冒烟测试

## 架构

```
┌──────────────┐     HTTP      ┌──────────────────┐     HTTP      ┌──────────────┐
│  Test Runner  │ ────────────→ │  App Server      │ ────────────→ │  Mock Server │
│  (test-runner)│   :5000       │  (Next.js)       │   :3456       │  (mock-api)  │
│               │ ←──────────── │                  │ ←──────────── │              │
└──────────────┘   Response     └──────────────────┘   Response     └──────────────┘
```

- **Mock Server**: 模拟外部 AI 服务（OpenAI、Gemini、视频API等），返回预设的 Mock 响应
- **Test Runner**: 向应用服务器发送测试请求，验证响应格式和状态码
- **App Server**: 被测应用服务器，将外部 API 调用转发到 Mock Server

## 使用方法

### 1. 启动 Mock 服务器

```bash
# 在项目根目录下
node api-mock-tester/mock-server.mjs --port 3456
```

### 2. 运行测试

```bash
# 运行所有测试
node api-mock-tester/test-runner.mjs

# 指定应用地址和 Mock 端口
node api-mock-tester/test-runner.mjs --app-url http://localhost:5000 --mock-port 3456

# 运行特定测试组
node api-mock-tester/test-runner.mjs --group image-gen

# 详细输出模式
node api-mock-tester/test-runner.mjs --verbose

# 设置超时时间（秒）
node api-mock-tester/test-runner.mjs --timeout 60
```

### 3. 测试组列表

| 测试组 | 名称 | 覆盖范围 |
|--------|------|----------|
| `infra` | 🏗️ 基础设施 | 应用服务可达、Mock服务、健康检测、模型列表 |
| `auth` | 🔐 认证 | 登录、无效凭证、获取用户信息 |
| `admin` | ⚙️ 管理员 | API提供商CRUD、用户列表、连接测试 |
| `image-gen` | 🎨 图像生成 | 生成任务提交、轮询、取消 |
| `chat` | 💬 AI 聊天 | 聊天消息、提示词优化、图片识词 |
| `image-edit` | ✏️ 图片编辑 | 擦除、放大、移除背景、扩展、多角度 |
| `video` | 🎬 视频生成 | 默认配置、文生视频、延长配置 |
| `workflow` | 🔗 工作流 | 模型列表、保存工作流 |
| `data-persist` | 💾 数据持久化 | 保存图片、用户数据同步 |
| `svg-trace` | ✏️ SVG描摹 | 彩色/黑白模式 |
| `edit` | 🖌️ 语言修图 | 模型列表、修图任务 |
| `agent` | 🤖 Agent编排 | Agent编辑任务 |
| `task-mgmt` | 📋 任务管理 | 队列位置、SSE事件 |
| `upscale` | 🔍 无损放大 | 本地放大、AI放大Pro |
| `upload` | 📤 上传服务 | 图片上传、缓存代理 |

## Mock Server 支持的接口

| 外部API | 端点 | Mock 行为 |
|---------|------|-----------|
| OpenAI | GET /v1/models | 返回5个测试模型 |
| OpenAI | POST /v1/images/generations | 返回64×64彩色测试图 |
| OpenAI | POST /v1/chat/completions | 返回文本/SSE流式响应 |
| OpenAI | POST /v1/images/edits | 返回测试图 |
| Gemini | POST /v1beta/models/*:generateContent | 返回文本响应 |
| Dashscope | POST/GET 视频任务 | 返回mock视频URL |
| Volcengine | POST/GET 视频任务 | 返回mock视频URL |
| Minimax | POST/GET 视频任务 | 返回mock视频URL |
| Fal | POST/GET 队列任务 | 返回mock视频URL |
| Vidu | POST/GET 视频任务 | 返回mock视频URL |
| IOPaint | POST /api/paint | 返回测试图 |
| PearAPI | POST /api/photo-enhancer | 返回测试图 |
| 3D API | POST/GET 3D任务 | 返回mock GLB模型 |
| RemoveBG | POST /api/removebg | 返回测试图 |

## 扩展指南

### 添加新测试用例

在 `test-runner.mjs` 的 `TEST_GROUPS` 数组中添加新的测试组或测试用例：

```javascript
{
  name: 'my-feature',
  label: '🎯 我的特性',
  tests: [
    {
      name: '测试描述',
      fn: async (assert, ctx) => {
        const resp = await fetchJSON(`${CONFIG.appUrl}/api/my-endpoint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ctx.token}` },
          body: JSON.stringify({ /* 测试数据 */ }),
        });
        assert.ok(resp.ok, 'API响应正常');
        assert.hasKey(resp.json, 'result', '返回结果字段');
      }
    }
  ]
}
```

### 添加新 Mock 端点

在 `mock-server.mjs` 的 `MOCK_RESPONSES` 对象中添加：

```javascript
'POST /v1/my-new-endpoint': (body) => {
  return { /* mock 响应数据 */ };
},
```

### 断言方法

| 方法 | 说明 |
|------|------|
| `assert.ok(value, msg)` | 验证值为真 |
| `assert.equal(actual, expected, msg)` | 验证相等 |
| `assert.includes(value, substring, msg)` | 验证包含字符串 |
| `assert.hasKey(obj, key, msg)` | 验证对象包含键 |
| `assert.statusOK(resp, msg)` | 验证HTTP响应OK |
| `assert.typeOf(value, type, msg)` | 验证类型 |

## 注意事项

1. **先启动 Mock Server，再运行测试**：测试运行器需要 Mock Server 提前运行
2. **管理员账户**：默认使用 admin/admin123，可在 CONFIG 中修改
3. **测试隔离**：每个测试用例应独立运行，不依赖其他测试的副作用
4. **异步任务**：涉及异步API的测试（生成、编辑等）会自动轮询任务状态
5. **Mock Provider 注册**：测试前会自动向管理员系统注册 Mock 提供商
6. **文件清理**：Mock Server 和测试运行器不会自动清理生成的测试数据

## 技术栈

- Node.js 原生 HTTP 模块（零依赖）
- ES Modules (.mjs)
- 支持 SSE 流式响应 Mock
- 内置 PNG/MP4/GLB 测试资源生成
