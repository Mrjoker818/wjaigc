# 本地图像工具升级回归报告（6 vCPU）

> 生成时间：2026-08-05
> 范围：擦除（LaMa）、去背景（BiRefNet lite/general）、放大（Real-ESRGAN）、推理线程与并发控制
> 基线：origin/main `6c1f158`

---

## 变更摘要

| 工具 | 变更 | 关键文件 |
|------|------|---------|
| 擦除 | OpenCV Telea → LaMa/Anime-LaMa torch 推理，ZITS 可选，OpenCV 兜底 | `scripts/iopaint_erase.py`、`src/lib/image-tools/local-erase-client.ts` |
| 去背景 | 默认 BiRefNet-lite，保留 general/portrait/massive 切换，限制 onnxruntime 线程 | `scripts/rembg_remove_background.py`、`src/lib/image-tools/rembg-client.ts`、`src/components/infinite-canvas.tsx` |
| 放大 | 补齐 Real-ESRGAN ONNX 下载与目录兼容，支持 fp16/完整精度回退，float32 推理 | `scripts/upscale_onnx.py`、`src/lib/image-tools/upscayl.ts`、`scripts/download-upscale-models.sh`、`scripts/ensure-models.sh` |
| 并发 | 本地推理全局并发闸门（默认 1），推理线程上限 4 | `src/lib/image-tools/concurrency-gate.ts` |

---

## 自动测试结果

| 类别 | 结果 |
|------|------|
| 专项契约测试（擦除/rembg/放大/并发） | 23/23 通过 |
| 全量 Vitest | 1478 通过，3 skipped，1 个无关用例在全量并行下偶发超时，单独运行通过 |
| TypeScript | `pnpm ts-check` 通过 |
| ESLint（本次改动文件） | 0 error（12 个存量 warning） |
| 生产构建 | `pnpm build` 通过 |

---

## 真实运行时验证（本地 CPU）

1. 擦除（LaMa）：下载 `big-lama.pt` 后执行 `iopaint_erase.py ... lama`，返回 `Success method=lama`，200×150 样例约 5s（含模型加载）。
2. 擦除（兜底）：无模型时返回 `Success method=opencv-telea`，输出 PNG 正常。
3. 去背景（lite）：`rembg_remove_background.py` 使用 `birefnet-general-lite` 成功返回 `rgbaBase64` 与 `maskBase64`。
4. 放大（Real-ESRGAN）：`upscale_onnx.py` 使用 `realesrgan-x4plus.onnx` 将 96×64 放大为 384×256，`engine=onnx-realesrgan`。

---

## 生产环境待验证项

- `/api/image/health` 返回 `localErase.model = 'lama'` 且 `removebg.available = true`。
- 6 vCPU 下 2 用户并发触发本地推理时 Web 响应时间无明显上升。
- `/space/iopaint-models`、`/space/removebg-models`、`/space/onnx-models` 或 `/space/upscayl-models` 模型目录就绪后，无需重新下载。
