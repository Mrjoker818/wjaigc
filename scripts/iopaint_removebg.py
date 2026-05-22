#!/usr/bin/env python3
"""
IOPaint RemoveBG 去背景脚本 - 被 Node.js 通过 child_process 调用
输入: stdin JSON { image: base64_string, model?: string, gen_mask?: bool }
输出: stdout JSON { success: bool, image?: base64_string, error?: string, model?: string }

支持的模型 (精简为 3 个):
  - u2netp                 (极轻量快速, 推荐, 4.5MB)
  - silueta                (轻量人像去背景, 45MB)
  - birefnet-general-lite  (高精度, 需大内存≥16GB, 224MB)

需要 rembg >= 2.0.59 以支持 birefnet 模型
"""

import sys
import json
import base64
import io
import os
import traceback

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

# ============================================================
# 持久化模型路径: 优先从环境变量读取，让模型从项目目录加载
# ============================================================
_REMOVEBG_MODELS_DIR = os.environ.get("REMOVEBG_MODELS_DIR", "")

# rembg 使用 U2NET_HOME 环境变量作为模型缓存目录
# 默认值是 ~/.u2net，沙箱重启会被清空
# 设置为项目持久化目录，确保模型不丢失
if _REMOVEBG_MODELS_DIR:
    os.environ.setdefault("U2NET_HOME", _REMOVEBG_MODELS_DIR)
else:
    # 兜底: 如果没有设置 REMOVEBG_MODELS_DIR，使用项目目录
    _fallback_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "removebg")
    if os.path.isdir(_fallback_dir):
        os.environ.setdefault("U2NET_HOME", _fallback_dir)

# 支持的模型列表 (精简为 3 个)
SUPPORTED_MODELS = [
    "u2netp",
    "silueta",
    "birefnet-general-lite",
]

def main():
    try:
        # 读取输入
        input_data = json.loads(sys.stdin.read())
        image_b64 = input_data.get("image", "")
        model_name = input_data.get("model", "u2netp")
        gen_mask = input_data.get("gen_mask", False)

        if not image_b64:
            print(json.dumps({"success": False, "error": "缺少 image 参数"}))
            return

        # 验证模型名
        if model_name not in SUPPORTED_MODELS:
            print(json.dumps({
                "success": False,
                "error": f"不支持的模型: {model_name}, 支持的模型: {SUPPORTED_MODELS}"
            }))
            return

        # 去掉 data:image/...;base64, 前缀
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        image_bytes = base64.b64decode(image_b64)

        # 导入 PIL
        from PIL import Image
        import numpy as np

        # 解码图片
        image_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # 统一使用 IOPaint RemoveBG 处理
        import torch
        from iopaint.plugins.remove_bg import RemoveBG
        rmbg = RemoveBG(model_name=model_name, device="cpu")
        # IOPaint RemoveBG 使用 gen_image/gen_mask 方法，需要 numpy RGB 输入
        import numpy as np
        rgb_np = np.array(image_pil)
        from iopaint.schema import RunPluginRequest
        req = RunPluginRequest(name="remove_bg", image="")
        if gen_mask:
            mask_np = rmbg.gen_mask(rgb_np, req)
            result = Image.fromarray(mask_np, mode="L")
        else:
            rgba_np = rmbg.gen_image(rgb_np, req)
            result = Image.fromarray(rgba_np, mode="RGBA")

        if result is None:
            print(json.dumps({"success": False, "error": "RemoveBG 返回空结果"}))
            return

        # 如果需要生成蒙版而非去背景图片
        if gen_mask and result.mode == "RGBA":
            # 从 alpha 通道生成蒙版: 前景=白色, 背景=黑色
            alpha = result.split()[-1]
            mask_arr = np.array(alpha)
            # alpha > 127 的为前景(白色), 否则为背景(黑色)
            mask_arr = np.where(mask_arr > 127, 255, 0).astype(np.uint8)
            result = Image.fromarray(mask_arr, mode="L")

        # 编码结果
        buf = io.BytesIO()
        if result.mode == "RGBA":
            result.save(buf, format="PNG")
        elif result.mode == "L":
            result.save(buf, format="PNG")
        else:
            result = result.convert("RGBA")
            result.save(buf, format="PNG")

        result_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        print(json.dumps({
            "success": True,
            "image": result_b64,
            "model": model_name
        }))

    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
