#!/usr/bin/env python3
"""
RemoveBG 去背景脚本 - 被 Node.js 通过 child_process 调用
输入: stdin JSON { image: base64_string, model?: string, return_mask?: bool }
输出: stdout JSON { success: bool, image?: base64_string, mask?: base64_string, error?: string, model?: string }

支持 4 个模型:
  - u2net            (U2Net 通用, 176MB) — F-measure 0.874, 主体保留最完整（推荐默认）
  - isnet-general-use (ISNet 高精度, 170MB) — F-measure 0.912, 但蒙版偏紧易切主体
  - silueta          (Silueta 人像, 45MB)
  - u2netp           (U2Net 极轻量, 4.5MB)

关键优化:
  - 直接使用 rembg.remove() 而非 IOPaint 包装器
  - alpha_matting=False: 不使用 PyMatting 精细边缘（会导致主体被侵蚀）
  - post_process_mask=False: 不做形态学 opening（会腐蚀主体边缘）
  - 蒙版膨胀和边缘优化交由 Node.js 后处理（高斯模糊+阈值化+轻微膨胀）
  
return_mask 模式:
  - 同时返回 RGBA 结果图和原始蒙版 PNG
  - Node.js 用原始蒙版做边缘优化后再应用到原图
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
    os.environ["U2NET_HOME"] = _REMOVEBG_MODELS_DIR
else:
    _fallback_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "removebg")
    if os.path.isdir(_fallback_dir):
        os.environ["U2NET_HOME"] = _fallback_dir
    _REMOVEBG_MODELS_DIR = os.environ.get("U2NET_HOME", "")

# 同时确保模型也链接到 iopaint/hub/checkpoints/ 目录
# rembg 内部 new_session() 也会查找 TORCH_HOME/hub/checkpoints/
_IOPAINT_MODELS_DIR = os.environ.get("IOPAINT_MODELS_DIR", os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "iopaint"))
if os.path.isdir(_IOPAINT_MODELS_DIR):
    _rmbg_ckpt_dir = os.path.join(_IOPAINT_MODELS_DIR, "hub", "checkpoints")
    if not os.path.exists(_rmbg_ckpt_dir):
        os.makedirs(_rmbg_ckpt_dir, exist_ok=True)
    for _fname in ["isnet-general-use.onnx", "u2net.onnx", "u2netp.onnx", "silueta.onnx"]:
        _src = os.path.join(_REMOVEBG_MODELS_DIR, _fname)
        _dst = os.path.join(_rmbg_ckpt_dir, _fname)
        if os.path.exists(_src) and not os.path.exists(_dst):
            try:
                os.symlink(_src, _dst)
            except Exception:
                pass

# 支持的模型列表 (4 个), U2Net 排第一作为默认推荐
SUPPORTED_MODELS = [
    "u2net",
    "isnet-general-use",
    "u2netp",
    "silueta",
]


def main():
    try:
        # 读取输入
        input_data = json.loads(sys.stdin.read())
        image_b64 = input_data.get("image", "")
        model_name = input_data.get("model", "u2net")
        return_mask = input_data.get("return_mask", False)

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

        # 解码图片
        from PIL import Image
        import numpy as np
        
        image_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # ===== 直接使用 rembg.remove() =====
        # 关键: 不启用 alpha_matting 和 post_process_mask!
        from rembg import remove, new_session

        session = new_session(model_name=model_name)

        # 先生成 RGBA 结果（获取蒙版）
        result = remove(
            image_pil,
            session=session,
            alpha_matting=False,
            post_process_mask=False,
        )

        if result is None:
            print(json.dumps({"success": False, "error": "RemoveBG 返回空结果"}))
            return

        # 提取原始蒙版（不做任何膨胀，交给 Node.js 后处理）
        if result.mode == "RGBA":
            r, g, b, a = result.split()
            mask_array = np.array(a)
            
            # 检测蒙版是否有效
            foreground_count = np.count_nonzero(mask_array > 127)
            total_pixels = mask_array.shape[0] * mask_array.shape[1]
            fg_ratio = foreground_count / total_pixels
            
            if fg_ratio < 0.01 or fg_ratio > 0.98:
                # 无效蒙版 — 直接返回原图（不透明）
                result = Image.merge("RGBA", (r, g, b, Image.fromarray(np.full_like(mask_array, 255), mode="L")))
                mask_array = np.full_like(mask_array, 255)
        else:
            result = result.convert("RGBA")
            r, g, b, a = result.split()
            mask_array = np.array(a)

        # 保存原始蒙版为 PNG（用于 return_mask 模式）
        # 轻微膨胀 (1 次 3x3 max filter)，确保主体边缘完整
        mask_b64 = None
        if return_mask:
            from scipy.ndimage import maximum_filter
            dilated_mask = maximum_filter(mask_array, size=5)
            # 再做一次膨胀确保更完整
            dilated_mask = maximum_filter(dilated_mask, size=3)
            mask_pil = Image.fromarray(dilated_mask, mode="L")
            mask_buf = io.BytesIO()
            mask_pil.save(mask_buf, format="PNG")
            mask_b64 = base64.b64encode(mask_buf.getvalue()).decode("utf-8")

        # 编码 RGBA 结果
        buf = io.BytesIO()
        result.save(buf, format="PNG")
        result_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        output = {
            "success": True,
            "image": result_b64,
            "model": model_name
        }
        
        if mask_b64:
            output["mask"] = mask_b64

        print(json.dumps(output))

    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
