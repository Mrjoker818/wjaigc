#!/usr/bin/env python3
"""
Real-ESRGAN ONNX 无损放大脚本 — 纯 CPU 推理，分块处理，内存优化版

支持两种 I/O 模式:
1. 文件模式（推荐，大图优先）: inputFile / outputFile 指定路径
2. base64 模式（兼容旧调用）: stdin/stdout 传递 base64 JSON

分块策略 (v2 — 修复坐标计算):
- 每个分块定义"核心区域" [col*tile, min((col+1)*tile, w)]（不含重叠）
- 在核心区域四周扩展 overlap 像素（受图像边界裁剪）
- 模型推理后，按实际添加的 overlap 量精确裁剪
- 裁剪后的结果精确粘贴到 (core_x * scale, core_y * scale) 位置
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
    requested = model_name if model_name in _MODEL_FILES else "realesrgan-x4plus-fp16"
    model_file = _MODEL_FILES[requested]
    model_path = os.path.join(_ONNX_MODELS_DIR, model_file)
    if not os.path.exists(model_path):
        alt_file = (
            "realesrgan-x4plus.onnx"
            if requested == "realesrgan-x4plus-fp16"
            else "realesrgan-x4plus-fp16.onnx"
        )
        alt_path = os.path.join(_ONNX_MODELS_DIR, alt_file)
        if os.path.exists(alt_path):
            model_path = alt_path
            requested = "realesrgan-x4plus" if alt_file.startswith("realesrgan-x4plus.") else "realesrgan-x4plus-fp16"
        else:
            raise FileNotFoundError(f"ONNX 模型文件不存在: {model_path}")
    print(f"[upscale_onnx] Loading model: {model_path}", file=sys.stderr)
    sess_options = ort.SessionOptions()
    sess_options.intra_op_num_threads = 2
    sess_options.inter_op_num_threads = 1
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(model_path, sess_options=sess_options, providers=['CPUExecutionProvider'])
    _session_cache[requested] = (session, requested)
    return session, requested


def process_tile(session, tile_img, model_name):
    """处理单个 tile，返回 PIL Image（强制释放中间内存）"""
    dtype = np.float16 if "fp16" in model_name else np.float32
    img_array = np.array(tile_img).astype(dtype) / 255.0
    img_chw = np.transpose(img_array, (2, 0, 1))
    input_tensor = np.expand_dims(img_chw, axis=0)
    del img_array, img_chw
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: input_tensor})
    del input_tensor
    out = output[0][0]
    del output
    out = np.transpose(out, (1, 2, 0))
    out = np.clip(out * 255.0, 0, 255).astype(np.uint8)
    result = Image.fromarray(out)
    del out
    import gc; gc.collect()
    return result


def upscale_image_tiled(img, scale=4, tile_size=256, model_name="realesrgan-x4plus-fp16", output_file=None):
    """
    分块放大 — 逐行拼接，内存优化版 (v2 坐标修复)

    坐标策略：
    1. 每个 tile 定义"核心区域" = [col*tile, min((col+1)*tile, w)]
    2. 在核心区域四周扩展 overlap（受边界裁剪）
    3. 模型推理后，按实际添加的 overlap 精确裁剪
    4. 粘贴位置 = 核心区域起点 × target_scale
    """
    session, resolved_model_name = get_session(model_name)
    w, h = img.size
    cols = max(1, math.ceil(w / tile_size))
    rows = max(1, math.ceil(h / tile_size))
    total_tiles = cols * rows
    overlap = max(8, tile_size // 8)
    model_scale = 4
    target_scale = scale
    target_w = w * target_scale
    target_h = h * target_scale

    print(f"[upscale_onnx] Image: {w}x{h}, Grid: {cols}x{rows}={total_tiles} tiles, "
          f"tile_size={tile_size}, overlap={overlap}, target={target_scale}x", file=sys.stderr)

    tmp_dir = tempfile.mkdtemp(prefix="upscale_onnx_")
    row_files = []

    try:
        for row_idx in range(rows):
            row_strips = []  # [(paste_x, cropped_image), ...]

            for col_idx in range(cols):
                tile_idx = row_idx * cols + col_idx

                # ★ 核心区域（不含重叠）
                core_x1 = col_idx * tile_size
                core_y1 = row_idx * tile_size
                core_x2 = min(core_x1 + tile_size, w)
                core_y2 = min(core_y1 + tile_size, h)

                # ★ 在核心区域四周扩展 overlap（受图像边界裁剪）
                exp_x1 = max(0, core_x1 - overlap)
                exp_y1 = max(0, core_y1 - overlap)
                exp_x2 = min(w, core_x2 + overlap)
                exp_y2 = min(h, core_y2 + overlap)

                # 实际在每侧添加的 overlap 像素数
                overlap_left = core_x1 - exp_x1    # 左侧添加了多少 overlap
                overlap_top = core_y1 - exp_y1     # 上侧添加了多少 overlap
                overlap_right = exp_x2 - core_x2   # 右侧添加了多少 overlap
                overlap_bottom = exp_y2 - core_y2   # 下侧添加了多少 overlap

                # 提取扩展后的 tile
                tile = img.crop((exp_x1, exp_y1, exp_x2, exp_y2))
                tile_w, tile_h = tile.size

                t0 = time.time()
                result = process_tile(session, tile, resolved_model_name)
                elapsed = time.time() - t0
                print(f"[upscale_onnx] Tile {tile_idx+1}/{total_tiles}: "
                      f"core=[{core_x1},{core_y1}]-[{core_x2},{core_y2}] "
                      f"exp=[{exp_x1},{exp_y1}]-[{exp_x2},{exp_y2}] "
                      f"{tile_w}x{tile_h} -> {result.size} "
                      f"[{elapsed:.1f}s]", file=sys.stderr)

                # ★ 精确裁剪：按实际添加的 overlap 裁剪输出
                res_w, res_h = result.size
                crop_left = overlap_left * model_scale
                crop_top = overlap_top * model_scale
                crop_right = res_w - overlap_right * model_scale
                crop_bottom = res_h - overlap_bottom * model_scale

                if crop_right > crop_left and crop_bottom > crop_top:
                    cropped = result.crop((crop_left, crop_top, crop_right, crop_bottom))

                    # 如果目标倍率不是 4x，在 tile 级别缩放
                    if target_scale != model_scale:
                        new_w = int(cropped.width * target_scale / model_scale)
                        new_h = int(cropped.height * target_scale / model_scale)
                        if new_w > 0 and new_h > 0:
                            cropped = cropped.resize((new_w, new_h), Image.LANCZOS)

                    # ★ 粘贴位置 = 核心区域起点 × target_scale
                    paste_x = core_x1 * target_scale

                    row_strips.append((paste_x, cropped))

                del result, tile

            # 横向拼接当前行
            if row_strips:
                row_strips.sort(key=lambda t: t[0])
                row_height = row_strips[0][1].height
                row_img = Image.new('RGB', (target_w, row_height))
                for paste_x, strip in row_strips:
                    row_img.paste(strip, (paste_x, 0))
                del row_strips

                # 保存行到临时文件
                row_file = os.path.join(tmp_dir, f"row_{row_idx:04d}.png")
                row_img.save(row_file, format="PNG")
                row_files.append(row_file)
                print(f"[upscale_onnx] Row {row_idx+1}/{rows} saved ({row_img.size})", file=sys.stderr)
                del row_img

        # 纵向拼接所有行 — 流式拼接，内存安全
        row_heights = []
        total_h_actual = 0
        for rf in row_files:
            ri = Image.open(rf)
            rh = ri.height
            row_heights.append(rh)
            total_h_actual += rh
            ri.close()

        print(f"[upscale_onnx] Assembling {len(row_files)} rows, target: {target_w}x{target_h}, actual: {target_w}x{total_h_actual}", file=sys.stderr)

        if output_file:
            # 分批纵向拼接（每批4行），避免超大图 OOM
            BATCH = 4
            batch_files = []
            for batch_start in range(0, len(row_files), BATCH):
                batch_end = min(batch_start + BATCH, len(row_files))
                batch_imgs = []
                batch_h = 0
                for idx in range(batch_start, batch_end):
                    ri = Image.open(row_files[idx])
                    batch_imgs.append(ri)
                    batch_h += row_heights[idx]
                batch_img = Image.new('RGB', (target_w, batch_h))
                y_off = 0
                for ri in batch_imgs:
                    batch_img.paste(ri, (0, y_off))
                    y_off += ri.height
                    ri.close()
                del batch_imgs
                bf = os.path.join(tmp_dir, f"batch_{batch_start:04d}.png")
                batch_img.save(bf, format="PNG")
                batch_files.append(bf)
                print(f"[upscale_onnx] Batch {batch_start//BATCH+1} saved", file=sys.stderr)
                del batch_img

            # 合并所有 batch 文件
            batch_imgs2 = []
            final_h = 0
            for bf in batch_files:
                bi = Image.open(bf)
                batch_imgs2.append(bi)
                final_h += bi.height
            final_img = Image.new('RGB', (target_w, final_h))
            y_off = 0
            for bi in batch_imgs2:
                final_img.paste(bi, (0, y_off))
                y_off += bi.height
                bi.close()
            del batch_imgs2

            # 清理 batch 文件
            for bf in batch_files:
                try: os.remove(bf)
                except: pass

            # 修正高度（最后一次精确调整）
            if final_img.size != (target_w, target_h):
                final_img = final_img.resize((target_w, target_h), Image.LANCZOS)
                print(f"[upscale_onnx] Adjusted to exact target: {target_w}x{target_h}", file=sys.stderr)

            final_img.save(output_file, format="PNG", optimize=True)
            print(f"[upscale_onnx] Saved to file: {output_file}", file=sys.stderr)
            del final_img
            _cleanup_tmp(tmp_dir, row_files)
            return output_file
        else:
            # base64 模式（小图）：直接在内存中拼接
            final_img = Image.new('RGB', (target_w, total_h_actual))
            y_offset = 0
            for rf in row_files:
                ri = Image.open(rf)
                final_img.paste(ri, (0, y_offset))
                y_offset += ri.height
                ri.close()
            if final_img.size != (target_w, target_h):
                final_img = final_img.resize((target_w, target_h), Image.LANCZOS)
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
    scale = int(params.get("scale", 4))
    tile_size = params.get("tileSize", 256)
    model_name = params.get("model", "realesrgan-x4plus-fp16")

    if not image_b64 and not input_file:
        sys.stdout.write(json.dumps({"success": False, "error": "缺少 image 或 inputFile 参数"}))
        return

    if scale < 2:
        scale = 2
    scale = min(scale, 16)  # 安全上限
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

        # 大图 (>512x512) 强制使用文件输出
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
