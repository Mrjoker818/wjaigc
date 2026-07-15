# 人物精修大师 Ultimate 仓库映射

| 参考能力 | 无界真实实现 | 接入方式 |
| --- | --- | --- |
| 用户鉴权 | `src/lib/api-auth.ts`、`src/lib/server-auth.ts` | 四个 `/api/human/*` 路由均先校验当前会话。 |
| 图片读取与对象存储 | `src/lib/fetch-image-buffer.ts`、`src/lib/server-data-root.ts` | 分析读取现有图片；候选和选中结果以新文件写入 `human-repair*` 目录。 |
| 编辑模型 Provider | `src/app/api/image-edit/route.ts` | GPT Image/FLUX 适配通过现有统一图像编辑路由，业务层不保存密钥。 |
| 异步任务 | `src/lib/task-registry.ts` | 人物精修创建 `image-edit` 类型任务并推送进度。 |
| 无限画布入口 | `src/components/infinite-canvas.tsx` | 图片浮动工具栏、右键菜单、底部工具栏打开同一懒加载面板。 |
| 工作流节点 | `src/lib/workflow-engine.ts`、`src/components/node-editor.tsx` | `ai-human-repair` 节点提交到 `/api/human/repair`。 |
| 领域逻辑 | `src/lib/human-ai-engine.ts` | 从参考 JS 转为严格 TypeScript，包含检测契约、评分、蒙版规格、保护和排序。 |
| UI | `src/components/human-repair-panel.tsx` | 一键修复、专业目标选择、候选版本选择、批量 URL 处理。 |

参考包中的独立 HTTP 服务、内存仓储、账号与计费基础设施未迁入；主项目既有能力已复用。
