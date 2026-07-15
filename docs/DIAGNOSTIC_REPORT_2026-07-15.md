# 无界 AI 最新仓库诊断报告

## 诊断范围

- 仓库：`Mrjoker818/wjaigc`
- 同步分支：`main`
- 同步后提交：`5b1d4d3 merge: 拉取远程最新代码并解决冲突`
- 诊断时间：2026-07-15
- 原则：只读诊断；未修改任何业务代码。本文档是本次诊断唯一新增文件。

## 结论

当前 `main` **不可部署、不可通过本地验证，也不能视为可运行版本**。最高优先级原因是已提交到仓库的 Git 合并冲突标记。它们直接阻断 TypeScript、ESLint、Vitest、Next.js 生产构建、开发服务页面与 API 请求。

在清除冲突标记前，不应让扣子从当前 `main` 覆盖云端生产程序。

## 验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Git 同步 | 通过 | 本地 HEAD 与 `origin/main` 均为 `5b1d4d3`；同步前工作区干净。 |
| `pnpm install --frozen-lockfile` | 失败 | Windows 不能执行 `bash scripts/prepare-tools.sh 2>/dev/null || true`。 |
| `pnpm ts-check` | 失败 | 9 个文件含合并冲突标记。 |
| `pnpm test` | 失败 | 60 个测试文件：55 通过、5 失败；302 通过、5 失败。另有工作流测试文件无法转换。 |
| `pnpm lint --quiet` | 失败 | 395 errors、0 warnings。 |
| `pnpm build` | 失败 | 被 Windows 不兼容的 `postinstall` 阻断。 |
| `pnpm exec next build` | 失败 | Turbopack 报告 18 个源码解析错误。 |
| 本地运行态 | 失败 | `http://127.0.0.1:5001/` 与 `/api/image/health` 均返回 HTTP 500。 |
| 依赖漏洞审计 | 未完成 | `.npmrc` 指向的 `registry.npmmirror.com` 不实现 npm audit 端点。 |

## P0 阻断项

### P0-1：合并冲突标记被提交进源码

扫描到 69 个 `<<<<<<<`、`=======`、`>>>>>>>` 标记，分布于以下 9 个文件：

1. `src/app/page.tsx`
2. `src/app/api/image-edit/route.ts`
3. `src/app/api/image-to-3d/route.ts`
4. `src/app/api/poll-3d-task/route.ts`
5. `src/app/api/workflow/execute/route.ts`
6. `src/components/infinite-canvas.tsx`
7. `src/components/node-editor.tsx`
8. `src/lib/server-api-config.ts`
9. `src/__tests__/lib/workflow-engine.test.ts`

根因是合并提交未完成内容级冲突解决，但 Git 索引中没有未合并条目，因此这些标记已作为普通文本被提交。

影响范围：

- 根页面自身含冲突标记，主应用无法渲染。
- 图片编辑、302 放大、CPU 去背景、美陈拆解等均依赖 `image-edit` 路由，无法解析。
- 图生 3D 与 3D 轮询路由无法解析。
- 无限画布和节点编辑器无法解析。
- 工作流执行 API 无法解析。
- API 提供商配置模块无法解析，进而影响依赖它的大量服务端路由。

### P0-2：无限画布仍导入已删除模块

以下模块已从仓库删除，但 [infinite-canvas.tsx](../src/components/infinite-canvas.tsx) 仍在第 42-43 行导入：

- `src/lib/canvas-pan-virtualization.ts`
- `src/lib/canvas-generation-results.ts`

这意味着即使 P0-1 的冲突标记全部清理，画布仍会因模块无法解析而继续构建失败。该项影响无限画布平移虚拟化与生成结果落位流程。

### P0-3：标准安装脚本不支持 Windows

`package.json` 的 `postinstall` 为：

```text
bash scripts/prepare-tools.sh 2>/dev/null || true
```

当前项目使用 PowerShell/Windows 时：

- `bash` 不存在或不可用；
- `2>/dev/null` 与 `|| true` 不是 Windows 命令语法；
- `pnpm install --frozen-lockfile` 返回非零；
- `pnpm build` 先执行 `pnpm install`，因此在调用 Next.js 前失败。

Linux 云端可能具备 bash、apt、pip，但当前脚本仍会尝试在安装依赖阶段执行系统级安装，部署可重复性不足。

## P1 高风险项

### P1-1：本地 CPU 放大模型从仓库删除，功能依赖仍在

最新提交删除了：

- `onnx-models/realesrgan-x4plus-fp16.onnx`
- `onnx-models/realesrgan-x4plus.onnx`

但 `src/lib/image-tools/upscayl.ts`、`scripts/upscale_onnx.py`、`image/upscale-pro` 等仍要求这两个模型。代码会优先读取 `/space/onnx-models`，因此云端若已预置持久化模型可继续工作；但干净本地目录已不存在 `onnx-models`，本地 CPU 放大必然返回“ONNX 模型文件不存在”。

### P1-2：回归测试覆盖倒退

当前发现 60 个测试文件、160 个 API 路由文件。与同步前已验证的 68 个测试文件相比，最新提交删除了多项关键测试，包括：

- 无限画布虚拟化与生成结果测试；
- 3D 请求契约测试；
- 视频 API 解析与连续性测试；
- 底部工具栏上传、AI PSD 提供商等组件接线测试。

同时，当前测试失败包括：302 放大接线、CPU rembg 接线、无限画布拆分接线、工作流执行持久化接线，以及无法转换的工作流引擎测试。前四类失败直接暴露冲突两侧代码同时保留；最后一类由冲突标记导致。

### P1-3：Lint 基线不可用

`pnpm lint --quiet` 产生 395 个 error。除 9 个冲突文件的解析错误外，主要存量类别为：

- `@typescript-eslint/no-explicit-any`；
- React Hooks 声明顺序问题；
- 未转义 JSX 文本；
- 禁止的 `<head>` 用法；
- `prefer-const`。

这些不是当前 P0 的根因，但会在冲突清理后继续阻止 CI 质量门禁。

### P1-4：无界画布的重复备份文件参与源码扫描

`src/components/infinite-canvas.tsx.bak` 已被提交，约 727KB；正式画布组件约 864KB。该 `.bak` 文件未被 `tsconfig.json`、ESLint 或 `.gitignore` 排除，会增加类型检查、lint 与仓库维护负担，也可能使搜索和人工合并误选旧实现。

## P2 配置与安全风险

### P2-1：依赖完整性与漏洞审计不可验证

`.npmrc` 同时设置：

```text
registry=https://registry.npmmirror.com
strictStorePkgContentCheck=false
verifyStoreIntegrity=false
```

并且该镜像不支持 npm audit 端点。当前无法生成可信依赖漏洞结论，且依赖包内容校验被放宽。

### P2-2：常见密钥模式扫描

扫描命中两个文本位置：

- 一个版本化场景截图的 base64 内容出现与密钥相似的随机片段；
- 管理员面板中使用 `sk-...` 作为输入占位符。

检查后未发现可确认的明文活动 API Key，但建议在修复后将二进制截图数据移出版本库，并继续在 CI 中保留密钥扫描。

## 功能域状态

| 功能域 | 当前状态 | 判断依据 |
| --- | --- | --- |
| 主应用、仪表盘、聊天、图像生成 | 阻断 | `src/app/page.tsx` 含冲突标记，根页面 HTTP 500。 |
| 无限画布、批注、图片浮动工具栏 | 阻断 | 画布组件含冲突标记，且继续导入两个已删除模块。 |
| 图片编辑、去背景、放大、美陈拆解 | 阻断 | `image-edit` 路由含冲突标记；CPU 放大缺少本地模型。 |
| 图生 3D、3D 任务轮询 | 阻断 | 两个关键路由均含冲突标记。 |
| 工作流节点、Agent 执行 | 阻断 | 工作流执行路由及工作流测试含冲突标记，节点编辑器含冲突标记。 |
| API 提供商、管理员配置 | 阻断 | `server-api-config.ts` 含冲突标记，依赖链广泛。 |
| 视频、品牌、电商、字体、导出 | 未验证 | 根应用与构建已被 P0 阻断；不能据静态文件存在推断可用。 |
| 认证、积分、数据持久化 | 未验证 | 部分单测通过，但服务端无法整体编译和启动。 |

## 建议修复顺序

1. 从 `5b1d4d3` 的合并父提交中逐块恢复并人工合并 9 个冲突文件，确保仓库中零冲突标记。
2. 恢复或替换无限画布引用的两个删除模块，并恢复其最小回归测试。
3. 将 `postinstall` 改为跨平台 Node 脚本，或明确区分 Windows 与 Linux；系统工具安装不得让依赖安装失败。
4. 明确 ONNX 模型分发策略：重新版本化、部署时下载、挂载持久化卷，或在前端禁用不可用的本地放大选项。
5. 先恢复 `ts-check`、测试与生产构建，再分批处理 395 个 lint 错误和被删除的测试覆盖。
6. 使用支持 audit 的官方 npm registry 或独立 SCA 工具完成依赖审计，并恢复内容完整性校验。

## 复测验收条件

修复完成后至少应全部通过：

```bash
pnpm install --frozen-lockfile
pnpm ts-check
pnpm test
pnpm lint --quiet
pnpm build
```

随后需在干净环境验证：根页面、图像生成、无限画布平移与图片工具栏、去背景、302 放大、图生 3D、工作流节点执行、管理员 API 配置与任务轮询。
