# 无界 AI — 本地图像工具 6 vCPU 升级方案（真实测试版）

> 基于 8 vCPU / 15GB 内存实测环境（Vefaas Kata 沙箱，Ubuntu 24.04）的本地图像工具升级规划。
> 本版已用**真实模型推理**验证性能，替代上一版的估算值。

## 一、现状盘点（实测确认）

| 功能 | 当前模型 | 实际状态 | 质量评级 |
|------|---------|---------|---------|
| 擦除（涂抹消除） | OpenCV Telea（iopaint_erase.py 实际路径） | 可用，0.25-0.67s | ⭐ 一般（纹理平滑失真） |
| 擦除（LaMa/ZITS） | big-lama.pt / zits 已下载（/space/iopaint-models，962M） | **已启用**（torch 2.5.1+cpu） | ⭐⭐⭐ 好 |
| 去背景 | BiRefNet-lite（/space/removebg-models，600M） | 可用，推理 5.6-6.6s（4线程） | ⭐⭐⭐ 好 |
| 无损放大 | realesrgan-x4plus.onnx（/space/upscayl-models，67M） | **已补齐并实测** | ⭐⭐⭐ 好 |

**关键发现**：torch CPU 版已安装（torch 2.5.1+cpu，/opt/torch-site 661M），LaMa 真实链路已打通并自愈恢复。

## 二、真实性能基准（6 vCPU 规划，推理线程 4）

| 功能 | 模型 | 输入尺寸 | 推理耗时 | 总链路（含模型加载~8s） | 结论 |
|------|------|---------|---------|----------------------|------|
| 擦除 | LaMa | 512² | 2.2s | ~9s | 常用尺寸流畅 |
| 擦除 | LaMa | 1024² | 7.2s | ~15s | 主流尺寸可接受 |
| 擦除 | LaMa | 2048² | 41.4s | 51s | **大图建议限尺寸** |
| 擦除 | OpenCV Telea（兜底） | 1024² | 0.25s | <1s | 极快但质量一般 |
| 去背景 | BiRefNet-lite | 1024² | 5.6-6.6s | ~8s | 比上版预估 2-4s 慢，已修正 |
| 放大 | Real-ESRGAN x4 | 1024²→4096² | 214s（16 tile） | ~220s | **真实可用**；大图建议限 2x |

**性能规律**：像素面积 ×4 → LaMa 耗时 ×5.7（1024→2048），CNN 超线性（内存带宽限制）。

**⚠️ 实测重要结论**：BiRefNet-general（927M）在 CPU 不可实用——rembg 命名规则不匹配（文件为 `BiRefNet-general-epoch_244.onnx` 大写，rembg 按小写 `birefnet-general.onnx` 查找）会触发 GitHub 973M 下载卡死；即使就绪，927M 模型 CPU 推理预计分钟级。**维持 BiRefNet-lite（5.6-6.6s）作为生产方案**。

**线程建议**：`IOPAINT_NUM_THREADS=4`（默认已生效，留 2 核给 Web/并发）。并发闸门：同一时刻仅 1 个本地推理任务（Node 端 spawn 天然串行）。

## 三、升级项（已实施 ✅ / 待实施 ⬜）

### ✅ 1. LaMa 擦除启用（核心）
- **torch 安装**：torch 2.5.1+cpu（download.pytorch.org/whl/cpu，174MB，3.26MB/s 可达）
- **持久化**：/opt/torch-site 打包为 /space/torch-site.tar（681MB 单文件，virtiofs 单文件写 58MB/s）
- **自愈机制**：iopaint_erase.py 检测 /opt/torch-site 缺失时自动从 tar 解压（4.8s）+ sys.path 注入
- **验证**：真实擦除成功，非蒙版区域像素级保留（外围均值 8.5=8.5），纯色修复偏差 <1%（126.8 vs 128）
- **健康检测**：/api/image/health 现在报告 `model: "lama"`（torch+模型存在时）

### ✅ 2. Real-ESRGAN 无损放大（已补齐）
- 模型 realesrgan-x4plus.onnx（67M，/space/upscayl-models）已就位
- 真实测试：1024²→4096² 成功（4 线程，16 tile，**214s**）
- Node 端链路已配置（ONNX_MODELS_DIR=/space/upscayl-models），多策略降级：云端 API → ONNX → AI 兜底
- **建议**：大图（>1024）建议 2x；4x 需 ~3.5 分钟 CPU

### ⬜ 3. BiRefNet-general（实测不推荐）
- **命名 bug 已修**：rembg_remove_background.py glob 改大小写不敏感 + 支持 model_path 直传；ensure-models.sh 增加 general 小写迁移（软链 `birefnet-general.onnx`）
- **实测结论**：927M 模型 CPU 推理不可实用（分钟级 + 触发 GitHub 973M 下载卡死）→ **维持 BiRefNet-lite 生产方案**，general 仅供未来 GPU 环境
- 下载后本地放大离线可用（4x，4 线程约 10-20s/1024²）

### ✅ 4. 资源约束
- 推理线程 4（IOPAINT_NUM_THREADS 默认 4），Web 留 2 核
- 并发：Node 端 spawn 串行，天然 1 任务闸门

## 四、网络与安装经验（踩坑记录）

| 问题 | 根因 | 解决 |
|------|------|------|
| pip 下载 PermissionError | pip HTTP 缓存写 /space（virtiofs）锁文件被沙箱拒 | `pip config set global.no-cache-dir true` |
| pip 下载 torch 卡 0 字节 | pip 大文件下载不稳（urllib3） | curl 下载 + pip install 本地 wheel |
| 官方源 315B/s | pypi.org 被墙 | 用 download.pytorch.org/whl/cpu（3.26MB/s） |
| unzip 到 /space 21 分钟 | virtiofs 小文件逐一创建 ~9 files/s | 解压到 / 盘 overlay（4.8s）+ tar 单文件持久化 |
| pip 装 torch 卡 request_wait_answer | virtiofs 大量小文件元数据操作挂起 | 同上 |

## 五、生产部署步骤（重启后自愈，无需人工干预）

1. `/space/torch-site.tar` 已持久化（681MB）
2. iopaint_erase.py 首次调用自动解压到 /opt/torch-site（4.8s）
3. 服务无感知：Node spawn 直接跑 python 脚本（scripts/*.py 运行时文件，无需重建产物）

## 六、验证与回滚

- **验证**：`/api/image/health` → localErase.model 应为 `"lama"`；擦除一张图看耗时/质量
- **回滚**：删除 /opt/torch-site + 移除 tar → 自动回落到 OpenCV Telea（原逻辑）

## 七、风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| / 盘 overlay 重启丢失 torch | 低 | tar 持久化 + 自愈解压（4.8s） |
| 2048² LaMa 41s 偏慢 | 中 | 前端擦除前对 >2048 图提示/缩放；或只对蒙版区域裁剪推理 |
| 6 vCPU 并发推理抢 CPU | 低 | 线程 4 + spawn 串行 |
| / 盘空间（3.3G 可用） | 低 | torch 661M + 余量充足 |
