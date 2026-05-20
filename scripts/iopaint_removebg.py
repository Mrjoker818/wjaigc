#!/usr/bin/env python3
"""
IOPaint RemoveBG 去背景脚本 - 被 Node.js 通过 child_process 调用
输入: stdin JSON { image: base64_string, model?: string, gen_mask?: bool }
输出: stdout JSON { success: bool, image?: base64_string, error?: string, model?: string }

支持的模型 (与 IOPaint 最新版一致):
  - birefnet-general-lite  (推荐默认, BiRefNet轻量通用, 高精度)
  - birefnet-general       (BiRefNet通用, 精度最高)
  - birefnet-portrait      (BiRefNet人像专用)
  - birefnet-dis           (BiRefNet显著性检测)
  - birefnet-hrsod         (BiRefNet高精度)
  - birefnet-cod           (BiRefNet伪装目标检测)
  - birefnet-massive       (BiRefNet大规模)
  - briaai/RMBG-1.4        (商用级去背景, PyTorch原生)
  - briaai/RMBG-2.0        (商用级最新, PyTorch原生)
  - u2net                  (rembg通用去背景)
  - u2netp                 (rembg轻量版, 速度快)
  - u2net_human_seg        (rembg人体分割)
  - u2net_cloth_seg        (rembg衣服分割)
  - silueta                (rembg轻量去背景)
  - isnet-general-use      (rembg通用高精度)

需要 rembg >= 2.0.59 以支持 birefnet 模型
"""

import sys
import json
import base64
import io
import os
import traceback

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

# 支持的模型列表 (与 IOPaint RemoveBGModel 一致)
SUPPORTED_MODELS = [
    "birefnet-general-lite",
    "birefnet-general",
    "birefnet-portrait",
    "birefnet-dis",
    "birefnet-hrsod",
    "birefnet-cod",
    "birefnet-massive",
    "briaai/RMBG-1.4",
    "briaai/RMBG-2.0",
    "u2net",
    "u2netp",
    "u2net_human_seg",
    "u2net_cloth_seg",
    "silueta",
    "isnet-general-use",
]

def main():
    try:
        # 读取输入
        input_data = json.loads(sys.stdin.read())
        image_b64 = input_data.get("image", "")
        model_name = input_data.get("model", "birefnet-general-lite")
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

        # 根据模型类型选择处理路径
        if model_name.startswith("briaai/"):
            result = _process_briaai(image_pil, model_name)
        elif model_name.startswith("birefnet"):
            result = _process_birefnet(image_pil, model_name)
        else:
            # rembg 系列模型
            result = _process_rembg(image_pil, model_name)

        if result is None:
            print(json.dumps({"success": False, "error": "RemoveBG 返回空结果"}))
            return

        # 如果需要生成蒙版而非去背景图片
        if gen_mask and result.mode == "RGBA":
            # 从 alpha 通道生成蒙版: 前景=白色, 背景=黑色
            alpha = result.split()[-1]
            import numpy as np
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


def _process_briaai(image_pil, model_name: str):
    """处理 briaai 模型 (PyTorch 原生, 不依赖 rembg)"""
    from iopaint.plugins.remove_bg import RemoveBG
    rmbg = RemoveBG(model_name=model_name, device="cpu")
    return rmbg(image_pil)


def _process_birefnet(image_pil, model_name: str):
    """处理 birefnet 模型 (通过 rembg >= 2.0.59)"""
    try:
        import rembg
        if rembg.__version__ < "2.0.59":
            import warnings
            warnings.warn(f"rembg {rembg.__version__} < 2.0.59, birefnet 可能不可用, 请升级: pip install -U rembg")
    except ImportError:
        pass

    from iopaint.plugins.remove_bg import RemoveBG
    rmbg = RemoveBG(model_name=model_name, device="cpu")
    return rmbg(image_pil)


def _process_rembg(image_pil, model_name: str):
    """处理 rembg 系列模型 (u2net, u2netp, silueta 等)"""
    from iopaint.plugins.remove_bg import RemoveBG
    rmbg = RemoveBG(model_name=model_name, device="cpu")
    return rmbg(image_pil)


if __name__ == "__main__":
    main()
