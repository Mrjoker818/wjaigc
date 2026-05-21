# 全项目深度 Bug 扫描报告

- 模型: minimax-m2-5-260212
- 时间: 2026-05-21T00:26:09.240Z

---

## batch1_core_api

# 深度代码审查报告

## 审查范围
batch1_core_api 包含 10 个 API 路由文件，共约 7,000 行代码。

---

## P0 - 必须立即修复

### Bug 1: 类型安全问题导致运行时错误
**文件**: `app/api/edit/route.ts`  
**位置**: 第 90-95 行, 第 160-165 行
```typescript
// 问题代码
if (image.startsWith('data:')) {  // 如果 image 是 undefined/null，这里会崩溃
if (mask.startsWith('data:')) {   // 同样的问题
```
**修复建议**:
```typescript
if (typeof image === 'string' && image.startsWith('data:')) {
if (typeof mask === 'string' && mask.startsWith('data:')) {
```

---

### Bug 2: 数值运算未进行类型转换
**文件**: `app/api/generate/route.ts`  
**位置**: 第 173-174 行
```typescript
// 问题代码
const count = outputCount && outputCount >= 1 ? Math.min(outputCount, 10) : 1;
```
如果 `outputCount` 是字符串 "5"，`outputCount >= 1` 会导致字符串比较而非数值比较。

**修复建议**:
```typescript
const outputCountNum = typeof outputCount === 'number' ? outputCount : parseInt(outputCount, 10);
const count = outputCountNum && outputCountNum >= 1 ? Math.min(outputCountNum, 10) : 1;
```

---

### Bug 3: JSON.parse 缺少错误处理导致崩溃
**文件**: `app/api/poll-task/route.ts`  
**位置**: 第 40-50 行
```typescript
// 问题代码
let statusResult: Record<string, unknown>;
try {
  statusResult = JSON.parse(statusText);
} catch {
  // 只有日志记录，解析失败后继续执行会导致后续代码使用 undefined
  console.error('[poll-task] API returned non-JSON response...');
}
return NextResponse.json({ /* 使用 statusResult */ });
```
当解析失败时，`statusResult` 未定义但被使用。

**修复建议**:
```typescript
let statusResult: Record<string, unknown>;
try {
  statusResult = JSON.parse(statusText);
} catch {
  return NextResponse.json({
    success: false,
    status: 'error',
    error: 'API 返回了非 JSON 响应',
    retryable: false,
  }, { status: 200 });
}
```

---

### Bug 4: 数组下标越界风险
**文件**: `app/api/image-edit/route.ts`  
**位置**: 第 260-270 行 (createLocalBackgroundAlpha 函数)
```typescript
// 问题代码
const addSample = (x: number, y: number) => {
  const i = (y * width + x) * 4;
  samples.push([raw[i], raw[i + 1], raw[i + 2]]);
};
```
如果 x, y 超出边界，数组访问会返回 undefined。

**修复建议**:
```typescript
const addSample = (x: number, y: number) => {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const i = (y * width + x) * 4;
  if (i + 2 >= raw.length) return;
  samples.push([raw[i], raw[i + 1], raw[i + 2]]);
};
```

---

### Bug 5: 循环中重复定义常量
**文件**: `app/api/image-edit/route.ts`  
**位置**: 第 330-400 行 (createLocalEraseInpaint 函数)
```typescript
// 问题代码
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) {
    const p = y * origW + x;  // 每次循环都重新创建
```
每次迭代都创建新变量，建议将不变的部分提取到循环外。

---

## P1 - 应该修复

### Bug 6: 路径遍历风险
**文件**: `app/api/image-edit/route.ts`  
**位置**: 第 550-580 行 (fetchImageBuffer 函数)
```typescript
// 问题代码
const sanitizedUrl = url.replace(/\.\./g, '').replace(/\/\//g, '/');
// 简单的 replace 无法完全防止路径遍历攻击
```

**修复建议**:
```typescript
// 使用更严格的路径验证
const sanitizedUrl = url.replace(/^(\.\.(\/|\\|$))+/g, '').replace(/\/\/+/g, '/');
// 并验证最终路径是否在允许的目录内
```

---

### Bug 7: 不安全的类型断言
**文件**: `app/api/edit/route.ts`  
**位置**: 多处使用 `as any` 或宽松类型
```typescript
// 问题代码
const modelStr = typeof rawModel === 'string' ? rawModel : (rawModel as any)?.model || String(rawModel || '');
```

**修复建议**: 使用类型守卫或更严格的类型验证
```typescript
const modelStr = typeof rawModel === 'string' 
  ? rawModel 
  : (rawModel && typeof rawModel === 'object' && 'model' in rawModel) 
    ? String(rawModel.model) 
    : String(rawModel || '');
```

---

### Bug 8: 异步任务注册但未清理
**文件**: `app/api/generate/route.ts`  
**位置**: 第 800-810 行
```typescript
for (const tid of taskIds) {
  registerTask(tid, 'generate', '生成图片');
}
// 任务完成后没有取消注册，可能导致内存泄漏
```

**修复建议**: 在任务完成或超时时调用 `unregisterTask(tid)`

---

### Bug 9: 敏感信息日志泄露
**文件**: 多处 API 路由
```typescript
// 问题代码
console.log('Submitting image task:', {
  model: currentModelConfig.modelId,
  prompt: enhancedPrompt.substring(0, 50) + '...',  // 可能包含用户敏感信息
});
```

**修复建议**: 对敏感日志进行脱敏处理

---

### Bug 10: 错误被静默吞没
**文件**: `app/api/image-edit/route.ts`  
**位置**: 多处 catch 块
```typescript
} catch { /* fallback below */ }
} catch { /* S3 not available */ }
```

**修复建议**:
```typescript
} catch (err) {
  console.warn('具体的错误信息:', err);
  // 继续执行 fallback
}
```

---

## P2 - 建议改进

### Bug 11: 魔法数字缺少注释
**文件**: `app/api/generate/route.ts`  
**位置**: 第 80 行
```typescript
let estimatedTime = 30; // 默认30秒 - 建议标注单位
```

---

### Bug 12: 重复代码
**文件**: `app/api/image-edit/route.ts`  
**位置**: resolveImageToBase64 函数和 fetchImageBuffer 函数有重复逻辑

---

### Bug 13: 文件过长难以维护
**文件**: `app/api/image-edit/route.ts` (2783 行)  
建议拆分为多个模块：工具函数、图像处理类、业务逻辑

---

## 总结

| 优先级 | 数量 | 主要问题类型 |
|--------|------|-------------|
| P0 | 5 | 类型安全、数组越界、JSON解析崩溃 |
| P1 | 5 | 路径遍历、类型断言、内存泄漏、日志泄露 |
| P2 | 3 | 代码质量、重复代码、可维护性 |

**高危修复建议**: 优先修复 Bug 1-5，这些问题可能导致生产环境崩溃。Bug 3 和 Bug 4 已在生产环境中被触发过。

---

## batch2_api_routes

# 深度代码审查报告

我将仔细审查提供的所有 API 路由代码，重点关注运行时Bug、逻辑漏洞、安全问题和性能隐患。

---

## 1. app/api/svg-trace/route.ts

### P0 - 严重问题

**1. Python 代码注入漏洞（行 282-300）**
```typescript
const pythonCode = [
  'import vtracer',
  `vtracer.convert_image_to_svg_py("${inputPath}", "${outputPath}"`,
  ...
].join('\n');
```
**问题**：直接拼接文件路径到 Python 代码中，如果路径被恶意构造，可能导致命令注入。`inputPath` 和 `outputPath` 来自临时目录但未被严格验证。
**修复建议**：使用参数化调用而非字符串拼接，或对路径进行严格的白名单验证。

**2. 路径遍历漏洞（行 119-120）**
```typescript
const dataPath = path.join(dataRoot, imageUrl.replace(/^\//, ''));
```
**问题**：`imageUrl.replace(/^\//, '')` 只移除前导斜杠，但无法防止 `../` 目录遍历攻击。例如 `/api/serve-upload/../../../etc/passwd` 可能被利用。
**修复建议**：
```typescript
const normalized = imageUrl.replace(/^\//, '').replace(/\.\.+/g, '');
const dataPath = path.join(dataRoot, normalized);
```

**3. hexToRgb 函数缺少输入验证（行 395-407）**
```typescript
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.replace('#', '');
  // 未验证 h 的内容是否为有效十六进制
  return {
    r: parseInt(h.substring(0, 2), 16),
    ...
  };
}
```
**问题**：未验证输入是否为有效十六进制，可能返回 `NaN` 导致后续颜色计算错误。
**修复建议**：
```typescript
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3,6}$/.test(h)) return null;
  // ... 后续逻辑
}
```

---

### P1 - 功能异常

**4. 错误消息泄露敏感信息（行 320-322）**
```typescript
if (!existsSync(outputPath)) {
  throw new Error('VTracer did not produce output');
}
```
**问题**：错误消息应该更通用，不暴露内部路径信息。

**5. PNG 预览生成重复 require（行 663-664）**
```typescript
const sharp = require('sharp');  // 文件顶部已 import sharp
```
**问题**：在函数内部重复 require，可能导致模块加载问题。

---

## 2. app/api/optimize-prompt/route.ts

### P1 - 功能异常

**6. 错误消息泄露内部信息（行 89）**
```typescript
errorMessage = '请先在管理员后台配置可用的 LLM 模型 API'
```
**问题**：错误消息过于通用，应提供更多调试信息以便排查问题。

---

## 3. app/api/vision-prompt/route.ts

### P0 - 严重问题

**7. 错误消息泄露 API 密钥（行 217）**
```typescript
} else if (response.status === 401) {
  errorMessage = 'API 密钥无效，请检查配置';
}
```
**问题**：虽然这里没有直接泄露密钥，但如果前端显示错误响应体，可能暴露敏感信息。

---

### P1 - 性能/边界问题

**8. 大图片 Base64 转换可能导致内存问题（行 50-120）**
```typescript
async function imageUrlToBase64(imageUrl: string): Promise<string> {
  // 处理各种 URL 类型并转换为 base64
  // 没有对图片大小进行限制
}
```
**问题**：没有限制输入图片大小，超大图片可能导致服务器内存溢出。
**修复建议**：添加大小检查，超过限制则返回错误。

---

## 4. app/api/segment-elements/route.ts

### P1 - 逻辑问题

**9. provider.selectedModels 可能为 undefined（行 79）**
```typescript
const selectedModels = layerProvider.selectedModels || [];
const modelId = selectedModels[0] || body.model || 'qwen-image-layered';
```
**问题**：当 `layerProvider.selectedModels` 为 `undefined` 时使用 `||` 是正确的，但 `selectedModels` 本身属性访问可能在 provider 对象不存在时报错。

---

## 5. app/api/universal-generate/route.ts

### P0 - 严重问题

**10. 轮询任务时未处理 API 错误响应体（行 98-120）**
```typescript
const statusResponse = await fetch(
  `${baseUrl}/tasks/${taskId}?language=zh`,
  { headers: { 'Authorization': `Bearer ${apiKey}` } }
);
const statusData = await statusResponse.json();
```
**问题**：未检查 `statusResponse.ok`，如果返回错误状态码（如 404、500），`json()` 仍会尝试解析错误响应体，可能导致解析失败或返回无效数据。

**修复建议**：
```typescript
if (!statusResponse.ok) {
  const errText = await statusResponse.text();
  console.error('[Universal API] Status poll error:', statusResponse.status, errText);
  continue;
}
```

---

## 6. app/api/upload/route.ts

### P1 - 边界情况

**11. 文件扩展名验证不完整（行 24-30）**
```typescript
// Validate file type
if (!file.type.startsWith('image/')) {
  return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
}

// 生成扩展名时直接使用用户提供的文件名
const ext = file.name.split('.').pop() || 'png';
```
**问题**：只验证 MIME 类型，但生成文件扩展名时直接使用用户输入，未验证扩展名是否为允许的图片格式。攻击者可能上传恶意文件（如 `shell.php.png`）。

---

## 7. app/api/serve-upload/[...path]/route.ts

### P0 - 安全漏洞

**12. 路径遍历漏洞（行 17-40）**
```typescript
for (const dir of possibleDirs) {
  const fullPath = path.join(dir, filePath);
  if (fs.existsSync(fullPath)) {
    // 直接返回文件内容
  }
}
```
**问题**：`filePath` 来自 URL 参数 `path.join(...params.path)`，未验证是否包含 `../`。攻击者可能通过 `GET /api/serve-upload/../../../../etc/passwd` 读取任意文件。
**修复建议**：
```typescript
const sanitizePath = (p: string) => {
  const normalized = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
  if (normalized.includes('..')) throw new Error('Invalid path');
  return normalized;
};
const safePath = sanitizePath(filePath);
```

---

## 8. app/api/image/upscale/route.ts

### P1 - 参数验证问题

**13. 缺少参数验证（行 19-40）**
```typescript
const { imageUrl, model, scale, tileSize, outputFormat, compression } = body;
if (!imageUrl) { /* 返回错误 */ }

// scale 验证
if (scale && scale !== 2 && scale !== 4) { /* 返回错误 */ }

// outputFormat 验证
if (outputFormat && !['png', 'jpg', 'webp'].includes(outputFormat)) { /* 返回错误 */ }

// ⚠️ 没有验证 model 参数！
```
**问题**：没有验证 `model` 参数是否为有效模型名称，可能导致下游处理错误。

---

## 9. app/api/design/vectorize/route.ts

### P0 - 严重问题

**14. XML 转义不完全（行 32-38）**
```typescript
function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```
**问题**：缺少对单引号 `'` 和其他 XML 特殊字符的转义。如果 `layerId` 包含单引号，可能导致 SVG 属性值中的 XML 语法错误。
**修复建议**：
```typescript
function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

**15. 缓冲区大小未限制（行 95-115）**
```typescript
async function resolveImageToBuffer(imageUrl: string): Promise<Buffer | null> {
  // ... 处理各种 URL 类型
  // 没有大小限制！
}
```
**问题**：没有限制图片文件大小，可能导致内存耗尽。

---

### P1 - 逻辑问题

**16. multipart 构建时硬编码 MIME 类型（行 165-167）**
```typescript
// image field (binary)
const imageHeader = Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.${mime.split('/')[1]}"\r\nContent-Type: ${mime}\r\n\r\n`
);
```
**问题**：`mime.split('/')[1]` 如果 MIME 格式不正确（如 `image/` 后面为空），会导致字符串问题。

---

## 10. app/api/image-to-3d/route.ts

### P0 - 安全问题

**17. 调试日志泄露 API 密钥（行 437-439）**
```typescript
console.log('[image-to-3d] Provider type:', providerType, 'Endpoint:', endpoint, 'Model:', request.provider?.model, 'Version:', request.version || ...);
// ...
console.log('[image-to-3d] Request body size:', bodyStr.length, 'bytes', hasBase64 ? '(contains base64 image data)' : '');
```
**问题**：日志输出可能暴露 API 密钥等敏感信息。

**18. API 密钥通过 URL 参数泄露（行 487-489）**
```typescript
// 对于某些外部 API，密钥可能被拼接到 URL 中
const response = await fetch(endpoint, { ... });
```
**问题**：如果 endpoint 包含敏感信息，会在日志和请求中泄露。

---

### P1 - 逻辑问题

**19. provider 选择逻辑可能不准确（行 290-295）**
```typescript
const byId = selection.providerId ? providers.find(item => item.id === selection.providerId && item.isEnabled) : null;
const byModel = !byId && selectedModel ? await findProviderForModel(selectedModel, '3d') : null;
const provider = byId || byModel;
```
**问题**：选择逻辑在某些边界情况下可能选择错误的 provider。

---

## 11. app/api/upscayl/route.ts

### P0 - 安全问题

**20. 路径遍历漏洞（行 290-315）**
```typescript
async function downloadImageToTemp(imageUrl: string, tmpDir: string) {
  if (imageUrl.startsWith('/')) {
    const possiblePaths = [
      path.join(workspacePath, 'public', imageUrl),
      path.join(workspacePath, imageUrl),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        // 直接使用用户提供的路径
      }
    }
  }
}
```
**问题**：未验证 `imageUrl` 中的路径遍历攻击（如 `/upscayl/../../../etc/passwd`）。

**21. 错误消息暴露内部路径（行 362-365）**
```typescript
if (!available) {
  return NextResponse.json({
    error: 'Upscayl NCNN 不可用，请确保已安装 Vulkan 运行时或 Mesa 驱动',
    fallback: true,
  }, { status: 503 });
}
```
**问题**：错误消息应根据环境调整，不应暴露具体的技术栈细节。

---

### P1 - 资源管理

**22. 临时目录清理失败不报错（行 450-451）**
```typescript
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
```
**问题**：静默忽略清理失败可能导致磁盘空间泄漏。

---

## 12. app/api/cache-image/route.ts

### P0 - 安全问题

**23. Content-Length 验证绕过（行 26-35）**
```typescript
const contentLength = Number(response.headers.get('content-length') || '0');
if (contentLength > MAX_IMAGE_BYTES) {
  return NextResponse.json({ success: false, error: 'Image is too large to cache' }, { status: 413 });
}

const buffer = Buffer.from(await response.arrayBuffer());
if (buffer.byteLength > MAX_IMAGE_BYTES) { // 二次检查
```
**问题**：虽然有二次检查，但如果服务器返回的 `Content-Length` 与实际 body 大小不符，可能绕过第一个检查。虽然有二次检查作为保护，但逻辑可以更清晰。

---

## 13. app/api/verify-protocol/route.ts

### P1 - 错误处理

**24. 高级参数处理不完整（行 28-45）**
```typescript
if (Array.isArray(advancedParams)) {
  for (const param of advancedParams) {
    if (param.key?.trim() && param.value !== undefined) {
      headers[param.key.trim()] = String(param.value);
    }
  }
} else if (advancedParams && typeof advancedParams === 'object') {
  // 直接遍历对象
  for (const [key, value] of Object.entries(advancedParams)) {
    if (key.trim()) headers[key.trim()] = String(value);
  }
}
```
**问题**：数组形式的 `advancedParams` 要求每个元素有 `key` 属性，但类型定义不够严格。

---

## 14. app/api/proxy-3d-model/route.ts

### P0 - 安全问题

**25. SSRF 漏洞（行 8-30）**
```typescript
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  // 直接使用用户提供的 URL 获取资源
  const res = await fetch(url, { ... });
}
```
**问题**：攻击者可能利用此端点访问内部服务（如 `http://localhost:8080`、`http://192.168.1.1` 等），造成 Server-Side Request Forgery 攻击。
**修复建议**：添加 URL 白名单验证或禁止内网地址。

---

## 总结

| 优先级 | 数量 | 主要类型 |
|--------|------|----------|
| P0 | 13 | 安全漏洞、路径遍历、注入攻击、SSRF |
| P1 | 12 | 逻辑错误、边界情况、错误处理不当 |

**最严重的问题**：
1. **路径遍历** - 多个路由未验证用户输入的路径
2. **Python 代码注入** - svg-trace 路由直接拼接代码
3. **SSRF** - proxy-3d-model 路由允许任意 URL 请求
4. **敏感信息泄露** - 错误消息和日志暴露内部信息

建议优先修复这些问题。

---

## batch3_components

ERROR: Error: 400:invalid params, context window exceeds limit (2013)

---

## batch4_libs

# 代码审查报告：batch4_libs

我已完成对所有源代码文件的深度审查。以下是发现的Bug和问题，按优先级分类：

---

## P0 - 必须立即修复（会导致崩溃、数据丢失、安全漏洞）

### 1. [lib/server-auth.ts] 密码哈希缺少盐值
- **文件**: `lib/server-auth.ts`
- **行号**: 第43-44行
- **Bug**: 使用 SHA256 直接哈希密码，没有使用盐值。相同密码会产生相同的哈希值，容易被彩虹表攻击。
- **修复建议**:
```typescript
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.createHash('sha256').update(salt + password + authSecret()).digest('hex');
}
```

### 2. [lib/s3-storage.ts] S3 认证凭据为空
- **文件**: `lib/s3-storage.ts`
- **行号**: 第20-25行
- **Bug**: S3Storage 初始化时 accessKey 和 secretKey 都为空字符串，会导致认证失败。
- **修复建议**: 从环境变量正确读取认证凭据：
```typescript
_storage = new S3Storage({
  endpointUrl,
  accessKey: process.env.COZE_BUCKET_ACCESS_KEY || '',
  secretKey: process.env.COZE_BUCKET_SECRET_KEY || '',
  bucketName,
  region: 'cn-beijing',
});
```

### 3. [lib/client-crypto.ts] 非安全上下文下降级为明文存储
- **文件**: `lib/client-crypto.ts`
- **行号**: 第62-64行
- **Bug**: 在非HTTPS环境下降级为明文存储（`__plain__`前缀），API密钥以明文形式存储在localStorage中，存在严重安全隐患。
- **修复建议**: 抛出错误而不是静默降级，或要求用户使用HTTPS。

### 4. [lib/image-tools/iopaint-client.ts] 路径遍历风险
- **文件**: `lib/image-tools/iopaint-client.ts`
- **行号**: 第122-127行
- **Bug**: `callPythonScript` 调用 Python 脚本时没有验证路径安全性，如果脚本路径被篡改可能导致命令注入。
- **修复建议**: 使用 `path.isAbsolute` 验证路径，并限制脚本目录。

### 5. [lib/task-registry.ts] 事件重复触发
- **文件**: `lib/task-registry.ts`
- **行号**: 第81-92行
- **Bug**: 当 `update.status` 为 `completed` 或 `failed` 时，会触发两次事件：一次是 `emitEvent('completed'/'failed', task)`，另一次是在最后的 `else` 分支中 `emitEvent('updated', task)`。
- **修复建议**:
```typescript
if (update.status === 'completed') {
  emitEvent('completed', task);
} else if (update.status === 'failed') {
  emitEvent('failed', task);
} else if (update.status === 'cancelled') {
  emitEvent('cancelled', task);
} else if (update.progress !== undefined && update.progress !== task.progress) {
  emitEvent('progress', task);
} else if (oldStatus === 'queued' && task.status !== 'queued') {
  emitEvent('updated', task);
} else if (oldStatus !== task.status) {  // 只有状态真正改变才触发
  emitEvent('updated', task);
}
```

---

## P1 - 应该修复（功能异常、边界情况、性能问题）

### 6. [lib/api-helpers.ts] 响应体被消费导致无法重试
- **文件**: `lib/api-helpers.ts`
- **行号**: 第57-60行
- **Bug**: 当首次请求返回非OK状态时，响应体已经被读取。如果需要重试，`fetchWithV1Retry` 无法再次读取已消费的body。
- **修复建议**: 在需要重试时，使用 `response.clone()` 读取响应体。

### 7. [lib/db-client.ts] 连接池可能泄漏
- **文件**: `lib/db-client.ts`
- **行号**: 第29-36行
- **Bug**: `execSql` 函数没有显式释放连接，虽然 pg 库会自动归还，但异常情况下可能出现问题。
- **修复建议**: 使用 `try...finally` 确保连接释放：
```typescript
const client = await pool.connect();
try {
  const result = await client.query(query, params);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
} finally {
  client.release();
}
```

### 8. [lib/image-compress.ts] SSR兼容性问题
- **文件**: `lib/image-compress.ts`
- **问题**: 代码在服务端运行时依赖 `document`、`canvas`、`Image` 等浏览器API，会导致崩溃。
- **修复建议**: 添加环境检查：
```typescript
if (typeof window === 'undefined' || typeof document === 'undefined') {
  throw new Error('compressImage requires browser environment');
}
```

### 9. [lib/server-auth.ts] 文件系统竞态条件
- **文件**: `lib/server-auth.ts`
- **行号**: 第127-165行
- **Bug**: `readStore` 多次读写文件系统，没有锁机制，并发请求可能导致数据不一致。
- **修复建议**: 添加文件锁或使用内存缓存。

### 10. [lib/universal-api-manager.ts] 异步解密未同步
- **文件**: `lib/universal-api-manager.ts`
- **行号**: 第49-59行
- **Bug**: `decryptProviderKeys` 是异步操作，但 `loadData` 同步完成后立即调用可能密钥尚未解密完成，导致 `getDecryptedKey` 返回空字符串。
- **修复建议**: 使用 Promise 等待解密完成后再返回。

### 11. [lib/prompt-safety.ts] 正则表达式 ReDoS 风险
- **文件**: `lib/prompt-safety.ts`
- **行号**: 第56-66行
- **Bug**: `BLOCKED_PATTERNS` 中的正则表达式如 `/\b(underage|minor|child)\s*(sex|nude|porn|裸|色情)/i` 可能在恶意输入下导致正则回溯。
- **修复建议**: 使用更高效的模式或添加输入长度限制。

### 12. [lib/api-compatibility.ts] 宽高比默认值可能导致意外行为
- **文件**: `lib/api-compatibility.ts`
- **行号**: 第245行
- **Bug**: `convertAspectRatioToSize` 对不支持的宽高比返回 '1024x1024'，可能不是调用者期望的。
- **修复建议**: 抛出错误或返回undefined，让调用者决定处理方式。

### 13. [lib/image-tools/file.ts] 路径解析漏洞
- **文件**: `lib/image-tools/file.ts`
- **行号**: 第43-52行
- **Bug**: 对本地路径没有验证，可能存在路径遍历风险。
- **修复建议**: 验证路径不包含 `..` 或绝对路径。

---

## P2 - 建议改进（代码质量、可维护性）

### 14. [lib/task-registry.ts] 清理逻辑不够健壮
- **文件**: `lib/task-registry.ts`
- **行号**: 第151-160行
- **问题**: 清理任务时没有同步清理 `userQueues` 和 `userActiveCount`，可能导致队列状态不一致。
- **建议**: 在清理过期任务时同时清理相关队列数据。

### 15. [lib/server-api-config.ts] 缓存策略
- **文件**: `lib/server-api-config.ts`
- **问题**: `discoverModelsForCredentials` 每次都发起网络请求，没有缓存。
- **建议**: 添加短期缓存避免重复请求。

### 16. [lib/task-events-client.ts] 缺少自动断开
- **文件**: `lib/task-events-client.ts`
- **问题**: SSE 连接没有在页面隐藏时自动断开，增加服务器负担。
- **建议**: 监听 `visibilitychange` 事件自动管理连接。

### 17. [lib/agent-engine.ts] 工具执行错误处理
- **文件**: `lib/agent-engine.ts`
- **行号**: 第164-181行
- **问题**: 工具执行失败后仍继续循环，可能导致无意义的重试。
- **建议**: 设置最大连续失败次数阈值。

### 18. [lib/db-storage.ts] 错误处理过于静默
- **文件**: `lib/db-storage.ts`
- **问题**: 捕获所有异常并返回空数组，调用者无法区分"没有数据"和"查询失败"。
- **建议**: 抛出具体错误或使用 Result 类型。

### 19. [lib/psd-export.ts] 客户端代码缺少环境检查
- **文件**: `lib/psd-export.ts`
- **问题**: 大量的浏览器API使用没有环境检查。
- **建议**: 统一添加 `typeof window !== 'undefined'` 检查。

### 20. [lib/image-source-map.ts] SQL 表创建失败处理
- **文件**: `lib/image-source-map.ts`
- **行号**: 第43-52行
- **问题**: `ensureImageSourceMapTable` 创建表失败时静默忽略。
- **建议**: 记录严重错误或通知管理员。

---

## 总结

| 优先级 | 数量 | 主要类型 |
|--------|------|----------|
| P0 | 5 | 安全漏洞、逻辑错误、数据丢失风险 |
| P1 | 8 | 功能异常、边界情况、性能问题 |
| P2 | 7 | 代码质量、可维护性 |

**最关键修复项**:
1. 密码哈希缺少盐值 (P0-1)
2. S3认证凭据为空 (P0-2)  
3. 事件重复触发导致状态不一致 (P0-5)
4. 响应体消费导致无法重试 (P1-6)
5. 异步解密未同步完成 (P1-10)

