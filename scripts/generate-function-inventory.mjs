import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

const root = process.cwd();
const apiRoot = join(root, 'src', 'app', 'api');
const output = join(root, 'docs', 'testing', 'FUNCTION_INVENTORY.md');

async function findRoutes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const routes = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...await findRoutes(path));
    if (entry.isFile() && entry.name === 'route.ts') {
      const routePath = '/' + relative(apiRoot, dirname(path)).split(sep).join('/').replace(/\[\.\.\.path\]/g, ':path*').replace(/\[([^\]]+)\]/g, ':$1');
      const source = await readFile(path, 'utf8');
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((method) => new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source));
      routes.push({ route: `/api${routePath === '/' ? '' : routePath}`, methods: methods.join(', ') || 'dynamic', file: relative(root, path).split(sep).join('/') });
    }
  }
  return routes;
}

function git(command, fallback) {
  try { return execFileSync('git', command, { cwd: root, encoding: 'utf8' }).trim(); } catch { return fallback; }
}

const featureRows = [
  ['登录/退出/会话', '首页登录页、用户菜单', '/', 'src/app/page.tsx; src/lib/server-auth.ts', '/api/auth/login, /logout, /me', 'wujie_users', 'PostgreSQL/Cookie', '已定位，P0真实测试待执行', 'P0'],
  ['自助注册', '未发现用户入口', '未发现独立页面', '未发现注册组件', '未发现 `/api/auth/register`', '管理员创建用户', 'PostgreSQL', '未实现或未暴露，需产品确认', 'P1'],
  ['Token刷新/访问控制', '全局路由/API中间层', '/', 'src/lib/server-auth.ts; src/lib/api-auth.ts', '受保护API', 'wujie_users', 'Cookie/服务端认证', '签名会话续期逻辑待真实验证；未发现独立refresh端点', 'P0'],
  ['项目仪表盘/项目管理', '登录后首页', '/', 'src/components/dashboard-view.tsx', '/api/user-data/sync, /api/artifacts', 'wujie_user_data', 'PostgreSQL', '已定位', 'P1'],
  ['无限画布', '首页“无限画布”/项目入口', '/', 'src/components/infinite-canvas.tsx', '/api/user-data/sync', 'wujie_user_data', '浏览器/对象存储', '已定位，P0真实测试待执行', 'P0'],
  ['上传/拖入/粘贴图片', '底部工具栏/画布', '/', 'src/components/infinite-canvas.tsx', '/api/upload, /api/save-image', 'wujie_user_data', 'S3或本地文件', '已定位，P0真实测试待执行', 'P0'],
  ['参考图/多参考图', '生成器“新增参考图”', '/', 'src/components/generation-panel.tsx', '/api/upload, /api/generate', '生成器状态', '对象存储/模型提供商', '已定位，P1待测', 'P1'],
  ['画布选择/多选/移动/缩放/删除/复制', '画布、选择工具、右键菜单', '/', 'src/components/infinite-canvas.tsx', '/api/user-data/sync', 'wujie_user_data', '浏览器交互', '已定位，P0真实测试待执行', 'P0'],
  ['画布平移/重置/图层/版本历史/连线', '底部工具栏', '/', 'src/components/infinite-canvas.tsx; src/components/layer-panel.tsx', '/api/user-data/sync', 'wujie_user_data', '浏览器交互', '已定位，P1待测', 'P1'],
  ['图像生成', '左侧生成器', '/', 'src/components/generation-panel.tsx', '/api/generate, /api/poll-task, /api/task-events', '任务注册表/用户数据', '模型提供商/SSE', '已定位，真实付费生成待授权', 'P0'],
  ['模型/尺寸/比例/质量/数量', '图像生成高级设置', '/', 'src/components/generation-panel.tsx', '/api/models, /api/generate', 'wujie_api_providers', '提供商模型配置', '已定位，P0真实测试待执行', 'P0'],
  ['任务状态/取消/恢复', '生成卡片/画布节点', '/', 'src/lib/task-events-client.ts', '/api/task-events, /api/poll-task, /api/cancel-task, /api/tasks/recover', '云端任务数据', 'SSE/轮询', '已定位，P0真实测试待执行', 'P0'],
  ['保存/刷新恢复/下载', '项目工具栏/图片工具栏', '/', 'src/app/page.tsx; src/lib/db-storage.ts', '/api/user-data/sync, /api/export-project', 'wujie_user_data', 'PostgreSQL/浏览器下载', '已定位，P0真实测试待执行', 'P0'],
  ['AI聊天/提示词大师/Skills/Agent', '智能对话页及画布聊天', '/simple-chat, /', 'src/components/chat-panel.tsx; src/app/simple-chat/page.tsx', '/api/chat, /api/optimize-prompt, /api/agent-edit', '用户数据/审计', 'LLM提供商', '已定位，P1待测', 'P1'],
  ['节点工作流', '底部工具栏“节点编辑器”', '/', 'src/components/node-editor.tsx', '/api/workflow/*', 'wujie_user_data', '模型提供商/SSE', '已定位，P1待测', 'P1'],
  ['节点选择/删除/连线/保存恢复', '节点编辑器', '/', 'src/components/node-editor.tsx', '/api/workflow/save, /api/workflow/execute', 'wujie_user_data', '浏览器/SSE', '已定位，P1待测', 'P1'],
  ['图转3D/多角度/六面体', '图片浮动工具栏/底部工具栏', '/', 'src/components/model-viewer-3d.tsx; src/components/*3d*.tsx', '/api/image-to-3d/*, /api/poll-3d-task', '任务数据', '3D供应商', '已定位，P1待测', 'P1'],
  ['语言修图/擦除/蒙版/扩图/放大/去背景', '图片浮动工具栏', '/', 'src/components/image-editor.tsx; src/components/image-editor/*', '/api/edit, /api/image-edit, /api/image/*', '任务数据', '模型提供商/本地AI', '已定位，P1待测', 'P1'],
  ['人物精修大师', '图片右键/浮动工具栏/底部工具栏', '/', 'src/components/human-ai-engine-panel.tsx', '/api/human/*', '任务数据', '人物精修引擎', '已定位，P1待测', 'P1'],
  ['品牌电商/品牌工厂/包装Pro/展陈Pro', '底部工具栏', '/', 'src/components/brand-*.tsx; src/components/display3d-panel.tsx', '/api/brand-*, /api/display-3d/*', '品牌资产数据', '模型提供商', '已定位，P1待测', 'P1'],
  ['字境大师/Logo Pro/AI PSD/表情助手/ChatCanvas', '底部工具栏', '/', 'src/components/font-design-panel.tsx; src/components/*panel.tsx', '/api/font-design/*, /api/logo-skill, /api/ai-psd/*', '用户数据', '模型提供商', '已定位，P1待测', 'P1'],
  ['视频生成/编辑/下载', '视频生成器', '/', 'src/components/video-generation-panel.tsx', '/api/video/*', '任务数据', '视频提供商', '已定位，P1待测', 'P1'],
  ['管理员/API提供商/积分/支付/审计', '管理员系统', '/', 'src/components/admin-system.tsx', '/api/admin/*, /api/credits/*', 'provider/credits/audit表', 'PostgreSQL/支付网关', '已定位，P1及安全待测', 'P1'],
  ['AI引擎设置', '画布底部“AI引擎设置”', '/', 'src/components/ai-engine-settings.tsx', '/api/admin/apis, /api/models', 'wujie_api_providers', '模型提供商', '已定位，P1待测', 'P1'],
  ['项目导出/文件下载', '图片工具栏、项目菜单', '/', 'src/lib/psd-export.ts; src/lib/svg-export.ts', '/api/export-project, /api/export/*', '用户数据/对象存储', '浏览器下载', '已定位，P0下载待测', 'P0'],
];

const routes = (await findRoutes(apiRoot)).sort((a, b) => a.route.localeCompare(b.route));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const commit = git(['rev-parse', '--short', 'HEAD'], 'unknown');
const generatedAt = new Date().toISOString();
const routeRows = routes.map(({ route, methods, file }) => `| \`${route}\` | ${methods} | [${file}](../../${file}) |`).join('\n');
const featureTable = featureRows.map((row) => `| ${row.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`).join('\n');

const markdown = `# 无界AI功能盘点\n\n- 生成时间：${generatedAt}\n- Git Commit：\`${commit}\`\n- 软件版本：\`${packageJson.version}\`\n- 工作目录：\`${root}\`\n- 盘点方法：源码路由、页面入口、组件、数据存储和依赖静态扫描；“已定位”不代表已通过真实验证。\n\n## 架构\n\n| 领域 | 现状 | 证据 |\n| --- | --- | --- |\n| 前端/后端 | Next.js ${packageJson.dependencies.next} App Router + React ${packageJson.dependencies.react} + TypeScript | \`src/app\`、\`src/components\` |\n| UI/状态 | Tailwind 4、shadcn/Radix；React Hooks、localStorage、BroadcastChannel、用户数据同步 | \`src/components\`、\`src/app/page.tsx\` |\n| 数据库 | PostgreSQL（\`pg\`），\`DATABASE_URL\`/\`PGDATABASE_URL\` | \`src/lib/db-client.ts\`、\`src/lib/db-storage.ts\` |\n| 对象存储/上传 | S3兼容对象存储优先，服务器本地文件回退 | \`src/app/api/upload/route.ts\`、\`src/app/api/save-image/route.ts\` |\n| 身份鉴权 | 签名 HTTP-only cookie \`wujie_session\`，7天会话 | \`src/lib/server-auth.ts\`、\`/api/auth/*\` |\n| AI调用层 | 多提供商兼容层，OpenAI/Gemini兼容及管理员模型配置 | \`src/lib/api-compatibility.ts\`、\`src/app/api/generate/route.ts\` |\n| 异步任务 | 内存/云端任务注册、SSE推送，轮询回退、取消和恢复 | \`src/lib/task-registry.ts\`、\`/api/task-events\` |\n| 部署 | Coze云端/容器化；端口和域名由环境变量控制 | \`Dockerfile\`、\`docker-compose.yml\`、\`.coze*\` |\n| 日志/监控 | 操作审计、数据库审计；未发现Sentry依赖或GitHub Actions工作流 | \`src/components/operation-audit-client.tsx\`、\`src/app/api/admin/audit\` |\n| 积分/支付 | 积分、充值订单、支付二维码/回调接口 | \`/api/credits/*\`、\`wujie_recharge_orders\` |\n\n## 数据与关键依赖\n\n主要表/逻辑存储：\`wujie_users\`、\`wujie_api_providers\`、\`wujie_user_data\`、\`wujie_system_settings\`、\`wujie_recharge_orders\`、\`wujie_brand_assets\`、\`wujie_user_groups\`及积分、审计和任务关联数据。关键环境变量包括数据库连接、认证/内部/支付密钥、对象存储配置、管理员账户、模型提供商密钥和本地AI工具配置；详细可执行检查由 \`npm run doctor\` 输出。\n\n## 功能矩阵\n\n| 功能 | 入口 | 路由 | 前端组件/逻辑 | 后端接口 | 数据表/状态 | 外部依赖 | 当前状态 | 风险 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${featureTable}\n\n## API路由清单（${routes.length}项）\n\n| 路由 | 方法 | 源文件 |\n| --- | --- | --- |\n${routeRows}\n\n## 自动化覆盖现状\n\n已有 Vitest 测试位于 \`src/__tests__\`。本次新增的真实浏览器P0套件位于 \`tests/e2e/p0-core.spec.ts\`，并配置 Chromium、Firefox、WebKit 和移动 Chromium。当前文件仅描述覆盖设计，测试通过与否以 \`docs/testing/REGRESSION_REPORT.md\` 和 \`test-results/\` 中的真实执行证据为准。\n`;

const correctedMarkdown = markdown.replace(
  '未发现Sentry依赖或GitHub Actions工作流',
  '未发现Sentry依赖。GitHub Actions质量门禁已配置，但云端真实P0依赖仓库环境密钥',
).replace(
  '`src/components/operation-audit-client.tsx`、`src/app/api/admin/audit` |',
  '`src/components/operation-audit-client.tsx`、`src/app/api/admin/audit`、`.github/workflows/quality.yml` |',
);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, correctedMarkdown, 'utf8');
console.log(`Generated ${relative(root, output)} with ${routes.length} API routes at ${commit}.`);
