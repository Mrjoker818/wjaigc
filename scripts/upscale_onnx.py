#!/usr/bin/env python3
"""
Real-ESRGAN ONNX 无损放大脚本 — 纯 CPU 推理，分块处理，内存优化版

支持两种 I/O 模式:
1. 文件模式（推荐，大图优先）: inputFile / outputFile 指定路径
2. base64 模式（兼容旧调用）: stdin/stdout 传递 base64 JSON

输入格式 (JSON):
{
  "image": "<base64>",           // base64 模式
  "inputFile": "/tmp/in.png",   // 文件模式（优先）
  "outputFile": "/tmp/out.png", // 输出文件路径
  "scale": 2 | 4,
  "tileSize": 256,
  "model": "realesrgan-x4plus-fp16"
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
import tempfile

try:
    import numpy as np
    from PIL import Image
    import onnxruntime as ort
except ImportError as e:
    result = {"success": False, "error": f"缺少依赖: {e}"}
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    sys.exit(1)

_ONNX_MODELS_DIR = os.environ.get(
    "ONNX_MODELS_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "onnx-models")
)

_MODEL_FILES = {
    "realesrgan-x4plus": "realesrgan-x4plus.onnx",
    "realesrgan-x4plus-fp16": "realesrgan-x4plus-fp16.onnx",
}

_session_cache = {}


def get_session(model_name):
    if model_name in _session_cache:
        return _session_cache[model_name]
    if model_name not in ("realesrgan-x4plus-fp16",):
        model_name = "realesrgan-x4plus-fp16"
    model_file = _MODEL_FILES.get(model_name, "realesrgan-x4plus-fp16.onnx")
    model_path = os.path.join(_ONNX_MODELS_DIR, model_file)
    if not os.path.exists(model_path):
        fp16_path = os.path.join(_ONNX_MODELS_DIR, "realesrgan-x4plus-fp16.onnx")
        if os.path.exists(fp16_path):
            model_path = fp16_path
            model_name = "realesrgan-x4plus-fp16"
        else:
            raise FileNotFoundError(f"ONNX 模型文件不存在: {model_path}")
    print(f"[upscale_onnx] Loading model: {model_path}", file=sys.stderr)
    sess_options = ort.SessionOptions()
    # 限制线程数，降低内存峰值
    sess_options.intra_op_num_threads = 2
    sess_options.inter_op_num_threads = 1
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(model_path, sess_options=sess_options, providers=['CPUExecutionProvider'])
    _session_cache[model_name] = session
    return session


def process_tile(session, tile_img):
    """处理单个 tile，返回 PIL Image"""
    img_array = np.array(tile_img).astype(np.float16) / 255.0
    img_chw = np.transpose(img_array, (2, 0, 1))
    input_tensor = np.expand_dims(img_chw, axis=0)
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: input_tensor})
    out = output[0][0]
    out = np.transpose(out, (1, 2, 0))
    out = np.clip(out * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def upscale_image_tiled(img, scale=4, tile_size=256, model_name="realesrgan-x4plus-fp16", output_file=None):
    """
    分块放大 — 逐行拼接，内存优化版

    核心优化:
    - 逐行处理 tile → 横向拼接后立即写入临时文件 → 释放行内存
    - 最终从临时文件逐行读取纵向拼接
    - 内存峰值 = 单行高度 × 输出宽度（而非全图）
    - 大图自动切换到文件输出（outputFile）
    """
    session = get_session(model_name)
    w, h = img.size
    cols = max(1, math.ceil(w / tile_size))
    rows = max(1, math.ceil(h / tile_size))
    total_tiles = cols * rows
    overlap = max(8, tile_size // 10)
    model_scale = 4
    # 输出尺寸 = 目标倍率（而非固定的 4x）
    target_scale = scale
    target_w = w * target_scale
    target_h = h * target_scale

    print(f"[upscale_onnx] Image: {w}x{h}, Grid: {cols}x{rows}={total_tiles} tiles, "
          f"tile_size={tile_size}, overlap={overlap}, target={target_scale}x", file=sys.stderr)

    # 计算 tile 坐标
    tile_coords = []
    for row in range(rows):
        for col in range(cols):
            x1 = max(0, col * tile_size - (overlap if col > 0 else 0))
            y1 = max(0, row * tile_size - (overlap if row > 0 else 0))
            x2 = min(w, (col + 1) * tile_size + (overlap if col < cols - 1 else 0))
            y2 = min(h, (row + 1) * tile_size + (overlap if row < rows - 1 else 0))
            tile_coords.append((row, col, x1, y1, x2, y2))

    tmp_dir = tempfile.mkdtemp(prefix="upscale_onnx_")
    row_files = []

    try:
        for row_idx in range(rows):
            row_tiles = [(c, r, x1, y1, x2, y2) for r, c, x1, y1, x2, y2 in tile_coords if r == row_idx]
            row_tiles.sort(key=lambda t: t[0])

            # 处理当前行的每个 tile
            row_strips = []
            for col_idx, _, x1, y1, x2, y2 in row_tiles:
                tile_idx = row_idx * cols + col_idx
                tile = img.crop((x1, y1, x2, y2))
                tile_w, tile_h = tile.size

                t0 = time.time()
                result = process_tile(session, tile)
                elapsed = time.time() - t0
                print(f"[upscale_onnx] Tile {tile_idx+1}/{total_tiles}: "
                      f"({x1},{y1})-({x2},{y2}) {tile_w}x{tile_h} -> {result.size} "
                      f"[{elapsed:.1f}s]", file=sys.stderr)

                # 裁剪掉重叠区域
                res_w, res_h = result.size
                crop_left = overlap * model_scale if x1 > 0 else 0
                crop_right = res_w - (overlap * model_scale if x2 < w else 0)
                crop_top = overlap * model_scale if y1 > 0 else 0
                crop_bottom = res_h - (overlap * model_scale if y2 < h else 0)

                if crop_right > crop_left and crop_bottom > crop_top:
                    cropped = result.crop((crop_left, crop_top, crop_right, crop_bottom))

                    # 如果目标倍率不是 4x，在 tile 级别就缩放，避免拼大图后再缩
                    if target_scale != model_scale:
                        new_w = int(cropped.width * target_scale / model_scale)
                        new_h = int(cropped.height * target_scale / model_scale)
                        cropped = cropped.resize((new_w, new_h), Image.LANCZOS)

                    # 计算在目标尺寸行拼接中的 paste 位置
                    paste_x = int((x1 + (overlap if x1 > 0 else 0)) * target_scale - (overlap * target_scale if x1 > 0 else 0))
                    # 简化：直接按累积宽度拼接
                    row_strips.append((paste_x, cropped))

                del result, tile

            # 横向拼接当前行（在目标尺寸下）
            if row_strips:
                # 按 paste_x 排序
                row_strips.sort(key=lambda t: t[0])
                # 直接顺序拼接（strip 之间无间隙）
                row_height = row_strips[0][1].height
                row_img = Image.new('RGB', (target_w, row_height))
                x_cursor = 0
                for paste_x, strip in row_strips:
                    # 使用累积位置拼接，避免空隙
                    actual_x = max(paste_x, x_cursor)
                    row_img.paste(strip, (actual_x, 0))
                    x_cursor = actual_x + strip.width
                del row_strips

                # 保存行到临时文件，释放内存
                row_file = os.path.join(tmp_dir, f"row_{row_idx:04d}.png")
                row_img.save(row_file, format="PNG")
                row_files.append(row_file)
                print(f"[upscale_onnx] Row {row_idx+1}/{rows} saved ({row_img.size})", file=sys.stderr)
                del row_img

        # 纵向拼接所有行 — 逐行读取（在目标尺寸下）
        total_h = 0
        for rf in row_files:
            ri = Image.open(rf)
            total_h += ri.height
            ri.close()

        print(f"[upscale_onnx] Assembling {len(row_files)} rows, final: {target_w}x{total_h}", file=sys.stderr)

        final_img = Image.new('RGB', (target_w, total_h))
        y_offset = 0
        for rf in row_files:
            ri = Image.open(rf)
            final_img.paste(ri, (0, y_offset))
            y_offset += ri.height
            ri.close()

        # 修正高度（理论上 total_h 应等于 target_h，可能因取整有 1-2px 差异）
        if final_img.size != (target_w, target_h):
            final_img = final_img.resize((target_w, target_h), Image.LANCZOS)
            print(f"[upscale_onnx] Adjusted to exact target: {target_w}x{target_h}", file=sys.stderr)

        # 输出
        if output_file:
            final_img.save(output_file, format="PNG", optimize=True)
            print(f"[upscale_onnx] Saved to file: {output_file}", file=sys.stderr)
            del final_img
            _cleanup_tmp(tmp_dir, row_files)
            return output_file
        else:
            _cleanup_tmp(tmp_dir, row_files)
            return final_img

    except Exception:
        _cleanup_tmp(tmp_dir, row_files)
        raise


def _cleanup_tmp(tmp_dir, row_files):
    for f in row_files:
        try:
            os.remove(f)
        except:
            pass
    try:
        os.rmdir(tmp_dir)
    except:
        pass


def main():
    input_data = sys.stdin.read()
    try:
        params = json.loads(input_data)
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({"success": False, "error": f"JSON 解析失败: {e}"}))
        return

    image_b64 = params.get("image", "")
    input_file = params.get("inputFile", "")
    output_file = params.get("outputFile", "")
    scale = params.get("scale", 4)
    tile_size = params.get("tileSize", 256)
    model_name = params.get("model", "realesrgan-x4plus-fp16")

    if not image_b64 and not input_file:
        sys.stdout.write(json.dumps({"success": False, "error": "缺少 image 或 inputFile 参数"}))
        return

    if scale not in (2, 4):
        scale = 4
    tile_size = max(64, min(512, tile_size))

    try:
        # 加载图片
        if input_file and os.path.exists(input_file):
            img = Image.open(input_file).convert("RGB")
        else:
            image_bytes = base64.b64decode(image_b64)
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        orig_w, orig_h = img.size
        print(f"[upscale_onnx] Input: {orig_w}x{orig_h}, scale: {scale}x, tile: {tile_size}", file=sys.stderr)

        # 大图 (>512x512) 强制使用文件输出，避免 base64 内存膨胀
        use_file = bool(output_file) or (orig_w * orig_h > 512 * 512)
        if use_file and not output_file:
            output_file = os.path.join(tempfile.gettempdir(), f"upscale_onnx_{int(time.time())}_{orig_w}x{orig_h}.png")

        t_start = time.time()
        result_obj = upscale_image_tiled(img, scale, tile_size, model_name, output_file)
        elapsed = time.time() - t_start
        del img

        if isinstance(result_obj, str):
            # 文件输出
            out_img = Image.open(result_obj)
            out_w, out_h = out_img.size
            out_img.close()
            result = {
                "success": True,
                "outputFile": result_obj,
                "engine": "onnx-realesrgan",
                "originalSize": [orig_w, orig_h],
                "outputSize": [out_w, out_h],
                "model": model_name,
                "elapsed": round(elapsed, 1),
            }
        else:
            # base64 输出
            out_w, out_h = result_obj.size
            buf = io.BytesIO()
            result_obj.save(buf, format="PNG", optimize=True)
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
            del result_obj

        print(f"[upscale_onnx] Done: {out_w}x{out_h}, {elapsed:.1f}s", file=sys.stderr)
        sys.stdout.write(json.dumps(result))

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[upscale_onnx] Error: {tb}", file=sys.stderr)
        sys.stdout.write(json.dumps({"success": False, "error": str(e)[:500]}))


if __name__ == "__main__":
    main()
