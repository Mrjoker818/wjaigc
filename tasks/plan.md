# WJ-STABLE-001 阶段 0 任务计划

## Overview

先固定 GitHub `origin/main@69ba94e` 的版本事实，再建立受保护功能目录、兼容样本、浏览器证据清单和发布阻断门禁。阶段 0 只改测试与文档基础设施，不改业务链路。

## Task List

### Phase 0: Version and feature freeze

- [ ] 固定本地、远端和云端 Commit 记录格式
- [ ] 建立 `protected-features.json` 和七个产品表面目录
- [ ] 修复功能盘点脚本的 UTF-8 乱码和手工聚合缺陷
- [ ] 建立旧项目兼容样本清单
- [ ] 建立截图、录像、Trace、Console、网络日志证据清单
- [ ] 建立受保护功能删除阻断门禁
- [ ] 建立阶段 0 Playwright 可达性与证据冒烟
- [ ] 生成阶段 0 未验证项报告

### Checkpoint: Stage 0

- [ ] 业务源码相对基线没有未授权差异
- [ ] 受保护入口、路由、节点类型和 Agent 工具没有减少
- [ ] 生成的报告注明静态发现不等于真实通过
- [ ] 浏览器证据带有 Commit、部署地址、浏览器和视口
- [ ] 缺少云端、供应商、PostgreSQL 或支付条件的项目保持阻塞/未验证

## Verification

- [ ] `pnpm test` 中的阶段 0 单元测试通过
- [ ] `pnpm test:inventory` 成功生成当前 Commit 的功能目录
- [ ] `pnpm check:protected-baseline -- --base origin/main --candidate HEAD` 能区分文档改动与业务改动
- [ ] Chromium 阶段 0 证据冒烟有真实产物，或明确写入阻塞报告
- [ ] 不将阶段 0 工具通过等同于平台业务通过
