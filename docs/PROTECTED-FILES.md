# 构建与预览稳定性修复说明

## 背景

每次从 GitHub 同步代码后，沙箱环境会重置 `node_modules`、`.next` 构建产物和系统依赖，同时 `git pull` 可能覆盖本地的关键修复文件，导致预览面板无法显示。

本文档列出所有**不可被覆盖**的文件及其正确内容，供同步后核对。

---

## 受保护文件清单

以下文件包含关键修复，**GitHub 同步后必须确认内容未被覆盖**：

| 文件 | 作用 | 被覆盖的后果 |
|------|------|-------------|
| `package.json` | 移除 canvas 原生依赖 + neverBuilt 配置 | canvas 编译失败 → install 失败 → 预览灰色 |
| `pnpm-lock.yaml` | 与 package.json 同步的锁文件 | lockfile 不匹配 → frozen-lockfile 失败 |
| `scripts/coze-start.sh` | 服务启动脚本（容错模式） | BUILD_ID 缺失直接 exit 1 → 服务无法启动 |
| `scripts/coze-preview-build.sh` | 开发环境构建脚本（自动降级） | frozen-lockfile 失败无降级 → 构建中断 |
| `scripts/coze-deploy-build.sh` | 生产部署构建脚本（先 install 再 build） | next: not found → 部署失败 |
| `.coze` | 项目配置（deploy build 指向正确脚本） | 部署时跳过依赖安装 → 构建失败 |
| `next.config.ts` | CSP frame-ancestors + turbopack 配置 | 预览 iframe 被阻止 / Turbopack 构建报错 |

---

## 各文件正确内容与校验方法

### 1. `package.json`

**不可被覆盖的两处修改：**

- `dependencies` 中**不得**包含 `"canvas": "^3.2.3"`（源码实际使用 `@napi-rs/canvas` 预编译二进制，无需系统依赖）
- `pnpm` 配置中**必须**包含 `neverBuilt: ["canvas"]`（阻止传递依赖触发原生编译）

**校验命令：**
```bash
# 应返回 0（canvas 不在 dependencies 中）
grep -c "\"canvas\":" package.json

# 应输出 neverBuilt 配置
grep -A3 "neverBuilt" package.json
```

**正确内容片段：**
```json
{
  "dependencies": {
    "@napi-rs/canvas": "^1.0.0",
    // ... 注意：没有 "canvas": "^3.2.3"
  },
  "pnpm": {
    "overrides": { ... },
    "neverBuilt": [
      "canvas"
    ]
  }
}
```

---

### 2. `scripts/coze-start.sh`

**核心逻辑：** BUILD_ID 缺失时自动 install + build，而非直接 exit 1。

**校验命令：**
```bash
# 应包含 robust_install 和自动重建逻辑
grep "robust_install" scripts/coze-start.sh
grep "pnpm run build" scripts/coze-start.sh
```

**错误标志（出现说明被覆盖）：**
```bash
# 如果出现以下行，说明被系统还原为严格模式
grep "Missing production build" scripts/coze-start.sh
```

**正确内容：**
```bash
#!/usr/bin/env bash
set -euo pipefail

robust_install() {
  if ! pnpm install --frozen-lockfile 2>&1; then
    echo "[coze-start] frozen-lockfile failed, trying --ignore-scripts..."
    pnpm install --ignore-scripts
    echo "[coze-start] Running postinstall hooks manually..."
    node scripts/prepare-tools.mjs 2>/dev/null || true
    node scripts/patch-pg-ssl.js 2>/dev/null || true
  fi
}

if [ ! -s ".next/BUILD_ID" ]; then
  echo "[coze-start] Production build is missing; installing dependencies and rebuilding."
  robust_install
  pnpm run build
elif [ ! -d "node_modules" ]; then
  echo "[coze-start] Dependencies are missing; installing before startup."
  robust_install
fi

pnpm run doctor -- --startup 2>/dev/null || true
exec pnpm run start
```

---

### 3. `scripts/coze-preview-build.sh`

**核心逻辑：** frozen-lockfile 失败时自动降级到 `--ignore-scripts` + 手动 postinstall。

**校验命令：**
```bash
grep "ignore-scripts" scripts/coze-preview-build.sh
grep "prepare-tools" scripts/coze-preview-build.sh
```

**正确内容：**
```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[coze-preview-build] Starting build process..."

if ! pnpm install --frozen-lockfile 2>&1; then
  echo "[coze-preview-build] frozen-lockfile failed, trying normal install with --ignore-scripts..."
  pnpm install --ignore-scripts
  echo "[coze-preview-build] Running postinstall hooks manually..."
  node scripts/prepare-tools.mjs 2>/dev/null || true
  node scripts/patch-pg-ssl.js 2>/dev/null || true
fi

echo "[coze-preview-build] Building Next.js project..."
pnpm run build

echo "[coze-preview-build] Build completed successfully."
```

---

### 4. `scripts/coze-deploy-build.sh`

**核心逻辑：** 生产部署构建时先安装依赖再 build，解决 `next: not found`。

**校验命令：**
```bash
ls scripts/coze-deploy-build.sh
grep "pnpm install" scripts/coze-deploy-build.sh
```

**正确内容：**
```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[coze-deploy-build] Starting production build process..."

if ! pnpm install --frozen-lockfile 2>&1; then
  echo "[coze-deploy-build] frozen-lockfile failed, trying normal install with --ignore-scripts..."
  pnpm install --ignore-scripts
  echo "[coze-deploy-build] Running postinstall hooks manually..."
  node scripts/prepare-tools.mjs 2>/dev/null || true
  node scripts/patch-pg-ssl.js 2>/dev/null || true
fi

echo "[coze-deploy-build] Building Next.js project..."
pnpm run build

echo "[coze-deploy-build] Build completed successfully."
```

---

### 5. `.coze`

**核心逻辑：** `[deploy] build` 必须指向 `coze-deploy-build.sh`（包含依赖安装），而非裸 `pnpm run build`。

**校验命令：**
```bash
grep "coze-deploy-build" .coze
```

**错误标志（出现说明被覆盖）：**
```bash
# 如果 deploy build 是裸 pnpm run build，说明被还原
grep 'build = \[ "pnpm", "run", "build" \]' .coze
```

**正确内容：**
```toml
[project]
requires = [ "nodejs-24" ]
template = "nextjs"
version = "legacy"
appliedPatches = [
  "nextjs/validate@0.0.20",
  "nextjs/next-output-tracing-root@0.0.13"
]

[dev]
build = [ "bash", "./scripts/coze-preview-build.sh" ]
run = [ "bash", "./scripts/coze-start.sh" ]
validate = [ "bash", "./scripts/validate.sh" ]

[deploy]
build = [ "bash", "./scripts/coze-deploy-build.sh" ]
run = [ "bash", "./scripts/coze-start.sh" ]
```

---

### 6. `next.config.ts`

**两处不可被覆盖：**

1. **CSP `frame-ancestors`** 必须包含 `https://*.coze.cn https://code.coze.cn`（允许 IDE iframe 嵌入预览）
2. **`turbopack: {}`** 必须存在（Next.js 16 使用 Turbopack，无此配置且存在 webpack 配置会构建报错）

**校验命令：**
```bash
# 应输出包含 coze.cn 和 code.coze.cn 的行
grep "frame-ancestors" next.config.ts

# 应存在 turbopack 空对象配置
grep "turbopack: {}" next.config.ts
```

---

## 同步后一键自检脚本

GitHub 同步后，执行以下命令快速确认所有文件未被覆盖：

```bash
cd /workspace/projects && bash scripts/verify-protected-files.sh
```

---

## 同步后恢复流程

如果自检发现文件被覆盖，执行以下步骤：

```bash
cd /workspace/projects

# 1. 重新应用 package.json 修复（移除 canvas + 添加 neverBuilt）
sed -i '/^\s*"canvas":.*$/d' package.json

# 2. 恢复构建脚本
git checkout origin/main -- scripts/coze-start.sh scripts/coze-preview-build.sh scripts/coze-deploy-build.sh .coze

# 3. 更新 lockfile
pnpm install --ignore-scripts

# 4. 运行 postinstall hooks
node scripts/prepare-tools.mjs
node scripts/patch-pg-ssl.js

# 5. 构建
npx next build --webpack

# 6. 启动服务
pnpm run start
```

---

## 根因总结

| 问题 | 根因 | 修复 |
|------|------|------|
| 预览灰色（HTTP 000） | canvas 原生编译需要系统依赖，沙箱重置后丢失 | 移除 canvas 依赖 + neverBuilt |
| `next: not found` | 生产部署未先安装依赖 | 新增 coze-deploy-build.sh |
| `Missing production build` | coze-start.sh 被覆盖为严格模式 exit 1 | 恢复容错模式自动重建 |
| 预览 iframe 被阻止 | CSP frame-ancestors 缺少 code.coze.cn | 更新 next.config.ts |
| Turbopack 构建报错 | next.config.ts 有 webpack 配置但无 turbopack 配置 | 添加 turbopack: {} |
| frozen-lockfile 失败 | lockfile 与 package.json 不匹配 | 构建脚本自动降级到 --ignore-scripts |
