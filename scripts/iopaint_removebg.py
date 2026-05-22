#!/usr/bin/env python3
"""
RemoveBG 去背景脚本 - 被 Node.js 通过 child_process 调用
输入: stdin JSON { image: base64_string, model?: string, gen_mask?: bool }
输出: stdout JSON { success: bool, image?: base64_string, error?: string, model?: string }

支持 4 个模型:
  - isnet-general-use (ISNet 高精度通用, 推荐, 170MB) — F-measure 0.912
  - u2net            (U2Net 通用, 176MB) — F-measure 0.874
  - silueta          (Silueta 人像, 45MB)
  - u2netp           (U2Net 极轻量, 4.5MB)

关键优化:
  - 直接使用 rembg.remove() 而非 IOPaint 包装器
  - alpha_matting=False: 不使用 PyMatting 精细边缘（会导致主体被侵蚀）
  - post_process_mask=True: 仅清理蒙版噪点，不侵蚀主体
  - ISNet 精度显著高于 U2Net (0.912 vs 0.874)
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

# 支持的模型列表 (4 个)
SUPPORTED_MODELS = [
    "isnet-general-use",
    "u2net",
    "u2netp",
    "silueta",
]


def main():
    try:
        # 读取输入
        input_data = json.loads(sys.stdin.read())
        image_b64 = input_data.get("image", "")
        model_name = input_data.get("model", "isnet-general-use")
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

        # 解码图片
        from PIL import Image
        image_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # ===== 直接使用 rembg.remove() =====
        # 不走 IOPaint 包装器，直接使用 rembg 原生管线
        #
        # 关键: 不启用 alpha_matting 和 post_process_mask!
        # alpha_matting 使用 PyMatting 做精细边缘，但它的 foreground_threshold
        # 会把蒙版值 <240 的区域归为"不确定"，再用 binary_erosion 腐蚀，
        # 导致主体细节（手指、头发、细小物体）被误删。
        # post_process_mask 会做形态学 opening(腐蚀+膨胀) + 高斯模糊 + 阈值二值化，
        # 进一步侵蚀细小结构和边缘区域，实测前景面积减少近 50%。
        # 版本 1ac67a9 使用 naive_cutout（直接信任模型蒙版）效果最好。
        from rembg import remove, new_session

        session = new_session(model_name=model_name)

        result = remove(
            image_pil,
            session=session,
            alpha_matting=False,
            post_process_mask=False,
            only_mask=gen_mask,
        )

        if result is None:
            print(json.dumps({"success": False, "error": "RemoveBG 返回空结果"}))
            return

        # 如果需要生成蒙版
        if gen_mask and result.mode == "RGBA":
            import numpy as np
            alpha = result.split()[-1]
            mask_arr = np.array(alpha)
            mask_arr = np.where(mask_arr > 127, 255, 0).astype(np.uint8)
            result = Image.fromarray(mask_arr, mode="L")

        # 编码结果
        buf = io.BytesIO()
        if result.mode in ("RGBA", "LA"):
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
