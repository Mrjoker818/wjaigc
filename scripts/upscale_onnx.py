#!/usr/bin/env python3
"""
Real-ESRGAN ONNX 无损放大脚本 — 纯 CPU 推理，分块处理

通过 stdin 接收 JSON，stdout 返回 JSON 结果

输入格式:
{
  "image": "<base64 PNG/JPEG>",
  "scale": 2 | 4,               (可选，默认 4)
  "tileSize": 128,              (可选，单块最大边长，默认 128)
  "model": "realesrgan-x4plus"  (可选，默认 realesrgan-x4plus)
}

输出格式:
{
  "success": true,
  "image": "<base64 PNG>",
  "engine": "onnx-realesrgan",
  "originalSize": [W, H],
  "outputSize": [W2, H2],
  "tiles": N,
  "model": "realesrgan-x4plus"
}
或
{
  "success": false,
  "error": "错误信息"
}
"""

import sys
import json
import base64
import io
import os
import traceback
import time
import math

try:
    import numpy as np
    from PIL import Image
    import onnxruntime as ort
except ImportError as e:
    result = {"success": False, "error": f"缺少依赖: {e}"}
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    sys.exit(1)

# ============================================================
# 模型路径配置
# ============================================================
_ONNX_MODELS_DIR = os.environ.get(
    "ONNX_MODELS_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "onnx-models")
)

# 模型文件名映射
_MODEL_FILES = {
    "realesrgan-x4plus": "realesrgan-x4plus.onnx",
    "realesrgan-x4plus-fp16": "realesrgan-x4plus-fp16.onnx",
}

# 全局 session 缓存（避免每次调用重新加载模型）
_session_cache: dict = {}


def get_session(model_name: str) -> ort.InferenceSession:
    """获取或创建 ONNX 推理 session"""
    if model_name in _session_cache:
        return _session_cache[model_name]

    # 确定模型文件路径 — 默认使用 fp16 模型（支持动态输入尺寸）
    # fp32 模型输入固定为 [1,3,64,64]，不支持分块处理，故默认走 fp16
    if model_name not in ("realesrgan-x4plus-fp16",):
        model_name = "realesrgan-x4plus-fp16"
    model_file = _MODEL_FILES.get(model_name, "realesrgan-x4plus-fp16.onnx")
    model_path = os.path.join(_ONNX_MODELS_DIR, model_file)

    if not os.path.exists(model_path):
        # 尝试 fp16 版本
        fp16_path = os.path.join(_ONNX_MODELS_DIR, "realesrgan-x4plus-fp16.onnx")
        if os.path.exists(fp16_path):
            model_path = fp16_path
            model_name = "realesrgan-x4plus-fp16"
        else:
            raise FileNotFoundError(f"ONNX 模型文件不存在: {model_path}")

    print(f"[upscale_onnx] Loading model: {model_path}", file=sys.stderr)
    sess_options = ort.SessionOptions()
    sess_options.intra_op_num_threads = 4
    sess_options.inter_op_num_threads = 2
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

    session = ort.InferenceSession(
        model_path,
        sess_options=sess_options,
        providers=['CPUExecutionProvider']
    )
    _session_cache[model_name] = session
    return session


def preprocess_image(img: Image.Image, tile_size: int = 128) -> np.ndarray:
    """预处理图片为模型输入张量 [1, 3, H, W]"""
    img_array = np.array(img).astype(np.float32) / 255.0
    # HWC -> CHW
    img_chw = np.transpose(img_array, (2, 0, 1))
    # 添加 batch 维度
    input_tensor = np.expand_dims(img_chw, axis=0)
    return input_tensor


def postprocess_output(output: np.ndarray) -> Image.Image:
    """后处理模型输出为 PIL Image"""
    # [1, 3, H, W] -> [3, H, W] -> [H, W, 3]
    out = output[0]
    out = np.transpose(out, (1, 2, 0))
    out = np.clip(out * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def process_tile(session: ort.InferenceSession, tile_img: Image.Image) -> Image.Image:
    """处理单个 tile"""
    input_tensor = preprocess_image(tile_img)
    input_name = session.get_inputs()[0].name

    # fp16 模型需要 fp16 输入
    input_type = session.get_inputs()[0].type
    if input_type == 'tensor(float16)':
        input_tensor = input_tensor.astype(np.float16)

    output = session.run(None, {input_name: input_tensor})
    return postprocess_output(output[0])


def upscale_image_tiled(
    img: Image.Image,
    scale: int = 4,
    tile_size: int = 128,
    model_name: str = "realesrgan-x4plus"
) -> Image.Image:
    """
    分块放大图片
    
    Args:
        img: 输入 PIL Image (RGB)
        scale: 放大倍率 (模型固定 4x，如需 2x 会后处理缩放)
        tile_size: 单块最大边长 (像素)
        model_name: 模型名称
    
    Returns:
        放大后的 PIL Image
    """
    session = get_session(model_name)

    w, h = img.size
    # 计算分块网格
    cols = max(1, math.ceil(w / tile_size))
    rows = max(1, math.ceil(h / tile_size))
    total_tiles = cols * rows

    # 重叠像素 (tile 的 10%，最小 8px)
    overlap = max(8, tile_size // 10)

    print(f"[upscale_onnx] Image: {w}x{h}, Grid: {cols}x{rows}={total_tiles} tiles, "
          f"tile_size={tile_size}, overlap={overlap}", file=sys.stderr)

    # 计算每个 tile 的位置 (含重叠)
    tile_coords = []
    for row in range(rows):
        for col in range(cols):
            x_start = max(0, col * tile_size - (overlap if col > 0 else 0))
            y_start = max(0, row * tile_size - (overlap if row > 0 else 0))
            x_end = min(w, (col + 1) * tile_size + (overlap if col < cols - 1 else 0))
            y_end = min(h, (row + 1) * tile_size + (overlap if row < rows - 1 else 0))
            tile_coords.append((x_start, y_start, x_end, y_end))

    # 模型固定 4x 放大
    model_scale = 4
    out_w = w * model_scale
    out_h = h * model_scale

    # 创建输出画布 (使用 float 累加，权重混合)
    output_buffer = np.zeros((out_h, out_w, 3), dtype=np.float32)
    weight_buffer = np.zeros((out_h, out_w, 1), dtype=np.float32)

    for i, (x1, y1, x2, y2) in enumerate(tile_coords):
        tile = img.crop((x1, y1, x2, y2))
        tile_w, tile_h = tile.size

        # 处理 tile
        t0 = time.time()
        result = process_tile(session, tile)
        elapsed = time.time() - t0
        print(f"[upscale_onnx] Tile {i+1}/{total_tiles}: "
              f"({x1},{y1})-({x2},{y2}) {tile_w}x{tile_h} -> {result.size} "
              f"[{elapsed:.1f}s]", file=sys.stderr)

        # 计算在输出画布中的位置
        out_x1 = x1 * model_scale
        out_y1 = y1 * model_scale
        out_x2 = x2 * model_scale
        out_y2 = y2 * model_scale

        # 计算权重（中间区域权重=1，边缘渐变到0.5）
        tile_out_w = result.width
        tile_out_h = result.height
        weight = np.ones((tile_out_h, tile_out_w, 1), dtype=np.float32)

        # 左边重叠区域渐变
        left_overlap = (x1 > 0)
        right_overlap = (x2 < w)
        top_overlap = (y1 > 0)
        bottom_overlap = (y2 < h)

        if left_overlap:
            overlap_out = overlap * model_scale
            for px in range(min(overlap_out, tile_out_w)):
                weight[:, px, :] *= (px + 1) / overlap_out
        if right_overlap:
            overlap_out = overlap * model_scale
            for px in range(min(overlap_out, tile_out_w)):
                weight[:, tile_out_w - 1 - px, :] *= (px + 1) / overlap_out
        if top_overlap:
            overlap_out = overlap * model_scale
            for py in range(min(overlap_out, tile_out_h)):
                weight[py, :, :] *= (py + 1) / overlap_out
        if bottom_overlap:
            overlap_out = overlap * model_scale
            for py in range(min(overlap_out, tile_out_h)):
                weight[tile_out_h - 1 - py, :, :] *= (py + 1) / overlap_out

        # 累加到输出缓冲区
        result_array = np.array(result, dtype=np.float32)
        output_buffer[out_y1:out_y2, out_x1:out_x2] += result_array * weight
        weight_buffer[out_y1:out_y2, out_x1:out_x2] += weight

    # 归一化 (weight_buffer 是 [H, W, 1]，需要广播到 [H, W, 3])
    mask = weight_buffer > 0
    # 避免 division by zero
    weight_safe = np.where(mask, weight_buffer, 1.0)
    output_buffer = output_buffer / weight_safe  # 自动广播 [H,W,3] / [H,W,1]
    # 未被任何 tile 覆盖的区域置零
    output_buffer[~mask.squeeze(axis=2)] = 0
    output_buffer = np.clip(output_buffer, 0, 255).astype(np.uint8)

    result_img = Image.fromarray(output_buffer)

    # 如果目标倍率不是 4x，缩放到目标
    if scale != model_scale:
        target_w = w * scale
        target_h = h * scale
        result_img = result_img.resize((target_w, target_h), Image.LANCZOS)
        print(f"[upscale_onnx] Resized from {model_scale}x to {scale}x: "
              f"{out_w}x{out_h} -> {target_w}x{target_h}", file=sys.stderr)

    return result_img


def main():
    # 读取 stdin JSON
    input_data = sys.stdin.read()
    try:
        params = json.loads(input_data)
    except json.JSONDecodeError as e:
        result = {"success": False, "error": f"JSON 解析失败: {e}"}
        sys.stdout.write(json.dumps(result))
        return

    image_b64 = params.get("image", "")
    scale = params.get("scale", 4)
    tile_size = params.get("tileSize", 128)
    model_name = params.get("model", "realesrgan-x4plus")

    if not image_b64:
        result = {"success": False, "error": "缺少 image 参数"}
        sys.stdout.write(json.dumps(result))
        return

    # 限制 scale 范围
    if scale not in (2, 4):
        scale = 4

    # 限制 tile_size 范围
    tile_size = max(64, min(512, tile_size))

    try:
        # 解码 base64 图片
        image_bytes = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        orig_w, orig_h = img.size
        print(f"[upscale_onnx] Input: {orig_w}x{orig_h}, scale: {scale}x, "
              f"tile_size: {tile_size}, model: {model_name}", file=sys.stderr)

        # 执行放大
        t_start = time.time()
        result_img = upscale_image_tiled(img, scale, tile_size, model_name)
        elapsed = time.time() - t_start

        out_w, out_h = result_img.size
        print(f"[upscale_onnx] Output: {out_w}x{out_h}, total time: {elapsed:.1f}s", file=sys.stderr)

        # 编码输出为 base64 PNG
        buf = io.BytesIO()
        result_img.save(buf, format="PNG", optimize=True)
        output_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        result = {
            "success": True,
            "image": output_b64,
            "engine": "onnx-realesrgan",
            "originalSize": [orig_w, orig_h],
            "outputSize": [out_w, out_h],
            "model": model_name,
            "elapsed": round(elapsed, 1),
        }
        sys.stdout.write(json.dumps(result))

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[upscale_onnx] Error: {tb}", file=sys.stderr)
        result = {"success": False, "error": str(e)[:500]}
        sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
