# 无界AI全平台测试用例清单

> 版本: v1.0 | 生成时间: 2026-07-20

---

## 用例统计

| 测试套件 | 文件 | 用例数 | 类型 |
|---------|------|--------|------|
| 核心 API 测试 | tests/api/core-api.test.ts | 46 | API |
| 异常混沌测试 | tests/api/chaos-test.test.ts | 21 | API |
| 安全测试 | tests/api/security-test.test.ts | 31 | API |
| P0 核心流程 | tests/e2e/p0-core.spec.ts | 1×3浏览器 | E2E |
| P0 认证会话 | tests/e2e/p0-auth-session.spec.ts | 1×3浏览器 | E2E |
| P0 认证流程 | tests/e2e/p0-auth.spec.ts | 1×3浏览器 | E2E |
| 流程B 上传 | tests/e2e/flow-b-upload.spec.ts | 3 | E2E |
| 流程D 画布操作 | tests/e2e/flow-d-canvas.spec.ts | 5 | E2E |
| 流程E 模块遍历 | tests/e2e/flow-e-modules.spec.ts | 4 | E2E |
| **合计** | — | **121** | — |

---

## 一、API 测试用例 (46项)

### 1.1 认证 API (12项)

| ID | 用例 | 方法 | 端点 | 预期 |
|----|------|------|------|------|
| API-AUTH-001 | 正常登录 | POST | /api/auth/login | 200 + Set-Cookie |
| API-AUTH-002 | 错误密码 | POST | /api/auth/login | 401 |
| API-AUTH-003 | 空用户名 | POST | /api/auth/login | 400 |
| API-AUTH-004 | 空密码 | POST | /api/auth/login | 400 |
| API-AUTH-005 | 不存在用户 | POST | /api/auth/login | 401 |
| API-AUTH-006 | 会话验证 | GET | /api/session | 200 + user对象 |
| API-AUTH-007 | 未登录会话 | GET | /api/session | 401 |
| API-AUTH-008 | 正常注销 | POST | /api/auth/logout | 200 + 清除Cookie |
| API-AUTH-009 | 注销后会话失效 | GET | /api/session | 401 |
| API-AUTH-010 | 注册 — 用户名过短 | POST | /api/auth/register | 400 |
| API-AUTH-011 | 注册 — 密码过短 | POST | /api/auth/register | 400 |
| API-AUTH-012 | 注册 — 空字段 | POST | /api/auth/register | 400 |

### 1.2 图像生成 API (8项)

| ID | 用例 | 方法 | 端点 | 预期 |
|----|------|------|------|------|
| API-GEN-001 | 正常提交 | POST | /api/generate | 200 + taskId |
| API-GEN-002 | 缺少prompt | POST | /api/generate | 400 |
| API-GEN-003 | 空prompt | POST | /api/generate | 400 |
| API-GEN-004 | 未授权 | POST | /api/generate | 401 |
| API-GEN-005 | 无效模型 | POST | /api/generate | 200(默认)或4xx |
| API-GEN-006 | 批量生成 | POST | /api/generate | 200 + taskIds数组 |
| API-GEN-007 | 自定义比例 | POST | /api/generate | 200 + taskId |
| API-GEN-008 | 重复提交 | POST | /api/generate | 两个不同taskId |

### 1.3 任务轮询 API (6项)

| ID | 用例 | 方法 | 端点 | 预期 |
|----|------|------|------|------|
| API-POLL-001 | 轮询存在的任务 | POST | /api/poll-task | 200 + status |
| API-POLL-002 | 轮询不存在任务 | POST | /api/poll-task | 200 + failed/cancelled |
| API-POLL-003 | 未授权轮询 | POST | /api/poll-task | 200(无需认证) |
| API-POLL-004 | 空taskId | POST | /api/poll-task | 400 |
| API-POLL-005 | 无效taskId格式 | POST | /api/poll-task | 200 + 错误状态 |
| API-POLL-006 | 并发轮询 | POST | /api/poll-task | 多请求均返回 |

### 1.4 用户数据同步 API (8项)

| ID | 用例 | 方法 | 端点 | 预期 |
|----|------|------|------|------|
| API-SYNC-001 | 正常同步 | POST | /api/user-data/sync | 200 |
| API-SYNC-002 | 读取数据 | GET | /api/user-data/sync | 200 + data |
| API-SYNC-003 | 未授权同步 | POST | /api/user-data/sync | 401 |
| API-SYNC-004 | 未授权读取 | GET | /api/user-data/sync | 401 |
| API-SYNC-005 | 无效key前缀 | POST | /api/user-data/sync | 403 |
| API-SYNC-006 | projects前缀 | POST | /api/user-data/sync | 200 |
| API-SYNC-007 | metadata前缀 | POST | /api/user-data/sync | 200 |
| API-SYNC-008 | 并发同步 | POST | /api/user-data/sync | 多请求成功 |

### 1.5 任务取消 API (3项)

| ID | 用例 | 方法 | 端点 | 预期 |
|----|------|------|------|------|
| API-CANCEL-001 | 取消存在的任务 | POST | /api/cancel-task | 200 |
| API-CANCEL-002 | 取消不存在任务 | POST | /api/cancel-task | 200或404 |
| API-CANCEL-003 | 未授权取消 | POST | /api/cancel-task | 401 |

### 1.6 图片保存 API (4项)

| ID | 用例 | 方法 | 端点 | 预期 |
|----|------|------|------|------|
| API-SAVE-001 | 保存base64图片 | POST | /api/save-image | 200 + url |
| API-SAVE-002 | 未授权保存 | POST | /api/save-image | 401 |
| API-SAVE-003 | 空数据 | POST | /api/save-image | 400 |
| API-SAVE-004 | 无效格式 | POST | /api/save-image | 400 |

### 1.7 错误响应格式 (2项)

| ID | 用例 | 方法 | 端点 | 预期 |
|----|------|------|------|------|
| API-ERR-001 | 401包含error字段 | POST | /api/generate | body.error存在 |
| API-ERR-002 | 400包含error字段 | POST | /api/generate | body.error存在 |

### 1.8 并发与幂等 (3项)

| ID | 用例 | 方法 | 端点 | 预期 |
|----|------|------|------|------|
| API-CONC-001 | 5并发登录 | POST | /api/auth/login | 全部成功 |
| API-CONC-002 | 5并发生成 | POST | /api/generate | 全部taskId不同 |
| API-CONC-003 | 10并发轮询 | POST | /api/poll-task | 全部返回 |

---

## 二、异常混沌测试用例 (21项)

### 2.1 HTTP 错误码 (8项)

| ID | 用例 | 模拟方式 | 预期 |
|----|------|---------|------|
| CHAOS-HTTP-001 | 400 Bad Request | 发送无效JSON | 客户端收到结构化错误 |
| CHAOS-HTTP-002 | 401 Unauthorized | 无Cookie请求 | 返回401+error |
| CHAOS-HTTP-003 | 403 Forbidden | 非管理员访问管理API | 返回403 |
| CHAOS-HTTP-004 | 404 Not Found | 请求不存在路由 | 返回404 |
| CHAOS-HTTP-005 | 405 Method Not Allowed | 错误HTTP方法 | 返回405 |
| CHAOS-HTTP-006 | 409 Conflict | 重复注册 | 返回409 |
| CHAOS-HTTP-007 | 413 Payload Too Large | 发送10KB+ body | 服务器处理或拒绝 |
| CHAOS-HTTP-008 | 非JSON响应 | 服务器返回非JSON | 客户端不崩溃 |

### 2.2 模型异常 (5项)

| ID | 用例 | 模拟方式 | 预期 |
|----|------|---------|------|
| CHAOS-MODEL-001 | 模型不存在 | 使用无效模型ID | 服务器降级或报错 |
| CHAOS-MODEL-002 | 空提示词 | 提交空prompt | 返回400 |
| CHAOS-MODEL-003 | 超长提示词 | 10000字符prompt | 服务器处理或拒绝 |
| CHAOS-MODEL-004 | 特殊字符 | XSS payload | 不执行脚本 |
| CHAOS-MODEL-005 | 二进制提示词 | 非UTF8字符 | 不崩溃 |

### 2.3 重复提交与中断 (4项)

| ID | 用例 | 模拟方式 | 预期 |
|----|------|---------|------|
| CHAOS-DUP-001 | 5次重复提交生成 | 快速连续POST | 各任务独立taskId |
| CHAOS-DUP-002 | 重复同步相同数据 | 快速连续POST | 不重复创建 |
| CHAOS-INT-001 | 提交后立即取消 | POST + DELETE | 任务状态为cancelled |
| CHAOS-INT-002 | 轮询已取消任务 | POST poll-task | 状态为cancelled/failed |

### 2.4 边界值与稳定性 (4项)

| ID | 用例 | 模拟方式 | 预期 |
|----|------|---------|------|
| CHAOS-BOUND-001 | 空字符串参数 | 各API传空字符串 | 返回400 |
| CHAOS-BOUND-002 | null参数 | 各API传null | 返回400 |
| CHAOS-BOUND-003 | 极大数字参数 | 传999999999 | 服务器处理或拒绝 |
| CHAOS-STAB-001 | 50次连续请求 | 快速循环 | 无内存泄漏/崩溃 |

---

## 三、安全测试用例 (31项)

### 3.1 A01 访问控制 (7项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-A01-001 | 未认证访问generate | POST无Cookie | 401 |
| SEC-A01-002 | 未认证访问user-data | POST无Cookie | 401 |
| SEC-A01-003 | 未认证访问save-image | POST无Cookie | 401 |
| SEC-A01-004 | 未认证访问admin API | GET无Cookie | 401/403 |
| SEC-A01-005 | 普通用户访问admin | 普通用户Cookie | 403 |
| SEC-A01-006 | 伪造isAdmin字段 | 注册时注入 | 不生效 |
| SEC-A01-007 | 越权读取其他用户数据 | 修改userId | 数据隔离 |

### 3.2 A02 加密失败 (3项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-A02-001 | Cookie HttpOnly | 检查Set-Cookie | HttpOnly存在 |
| SEC-A02-002 | Cookie SameSite | 检查Set-Cookie | SameSite=Lax |
| SEC-A02-003 | 密码不返回明文 | 登录响应 | 无password字段 |

### 3.3 A03 注入 (6项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-A03-001 | SQL注入 — 登录 | 用户名注入 | 登录失败 |
| SEC-A03-002 | SQL注入 — 注册 | 用户名注入 | 不执行SQL |
| SEC-A03-003 | SQL注入 — user-data key | key注入 | 403(前缀限制) |
| SEC-A03-004 | NoSQL注入 | JSON操作符 | 不生效 |
| SEC-A03-005 | 命令注入 | 特殊字符 | 不执行 |
| SEC-A03-006 | XSS — prompt注入 | script标签 | 被转义/拒绝 |

### 3.4 A04 不安全设计 (2项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-A04-001 | 错误消息不泄露堆栈 | 触发500 | 无stack trace |
| SEC-A04-002 | 错误消息不泄露路径 | 触发错误 | 无服务器路径 |

### 3.5 A05 安全配置 (3项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-A05-001 | 目录遍历 | 请求不存在路径 | 404 |
| SEC-A05-002 | 服务器头信息 | 检查headers | 无敏感信息 |
| SEC-A05-003 | 调试端点 | 访问/debug等 | 404 |

### 3.6 A07 认证失败 (3项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-A07-001 | 暴力破解 | 10次错误密码 | 均返回401 |
| SEC-A07-002 | 注销后Cookie失效 | 注销后访问 | Cookie被清除 |
| SEC-A07-003 | Token伪造 | 修改Cookie值 | 返回401 |

### 3.7 A08 数据完整性 (2项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-A08-001 | 请求体篡改 | 修改JSON字段 | 服务器验证 |
| SEC-A08-002 | 参数污染 | 重复参数 | 服务器处理 |

### 3.8 A10 SSRF (2项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-A10-001 | SSRF — save-image URL | 内网URL | 拒绝或处理 |
| SEC-A10-002 | SSRF — save-image data URL | data:URL | 正常处理 |

### 3.9 路径穿越 (2项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-PATH-001 | serve-upload遍历 | ../../../etc/passwd | 400/404 |
| SEC-PATH-002 | serve-upload编码遍历 | %2e%2e%2f | 400/404 |

### 3.10 CSRF (1项)

| ID | 用例 | 测试方法 | 预期 |
|----|------|---------|------|
| SEC-CSRF-001 | 跨站请求 | 无Origin/Referer | SameSite=Lax保护 |

---

## 四、E2E 测试用例 (21项)

### 4.1 P0 核心流程 (3项×3浏览器)

| ID | 用例 | 浏览器 | 预期 |
|----|------|--------|------|
| E2E-P0-CORE | 完整核心流程 | Chromium/Firefox/WebKit | 登录→选择模型→输入提示词→生成→验证 |
| E2E-P0-AUTH | 认证流程 | Chromium/Firefox/WebKit | 登录→刷新保持→退出 |
| E2E-P0-SESSION | 会话管理 | Chromium/Firefox/WebKit | 登录→刷新→会话有效→退出→会话无效 |

### 4.2 流程B 图片上传 (3项)

| ID | 用例 | 预期 |
|----|------|------|
| E2E-B1 | 画布区域可见可操作 | canvas-ref元素存在 |
| E2E-B2 | 文件上传 | input[type=file]上传后画布显示图片 |
| E2E-B3 | 上传按钮存在 | 上传按钮可点击 |

### 4.3 流程D 画布操作 (5项)

| ID | 用例 | 预期 |
|----|------|------|
| E2E-D1 | 画布缩放 | 滚轮缩放不崩溃 |
| E2E-D2 | 工具栏存在 | 底部工具栏可见 |
| E2E-D3 | ESC快捷键 | ESC不崩溃 |
| E2E-D4 | Ctrl+Z撤销 | 撤销不崩溃 |
| E2E-D5 | 右键菜单 | 右键显示上下文菜单 |

### 4.4 流程E 模块遍历 (4项)

| ID | 用例 | 预期 |
|----|------|------|
| E2E-E1 | 页面无致命JS异常 | 无uncaught error |
| E2E-E2 | 核心UI元素存在 | 画布+面板+输入框 |
| E2E-E3 | 页面标题正确 | 包含"无界"或"AI" |
| E2E-E4 | 关键API无失败 | /api/session 200 |

---

## 五、测试执行记录

| 日期 | 套件 | 通过 | 失败 | 备注 |
|------|------|------|------|------|
| 2026-07-20 | core-api | 46 | 0 | 全通过 |
| 2026-07-20 | chaos-test | 21 | 0 | 全通过 |
| 2026-07-20 | security-test | 31 | 0 | 全通过 |
| 2026-07-20 | E2E P0 (3浏览器) | 9 | 0 | 全通过 |
| 2026-07-20 | E2E Flow B/D/E | 12 | 0 | 全通过 |
| **合计** | — | **119** | **0** | **100%** |

> 注：E2E P0 为 3 用例 × 3 浏览器 = 9 项执行。总用例数 121，执行 119 项（2 项为跨浏览器重复）。
# V588-UI-004 画布展示层

- `tests/e2e/v588-ui004-canvas-presentation.spec.ts` 使用真实登录、新建项目和图片上传，覆盖 `375x812`、`768x900`、`1440x900`。
- 验证底部抽屉四组入口、图片工具栏与 `+N`、放大、SVG、擦除、蒙版、调色、去背景、扩展、裁切均可达且不越界。
- 在 `prefers-reduced-motion: reduce` 下验证关键浮层不依赖动画到达；失败保留 screenshot、video、trace，并附加每个视口截图。
