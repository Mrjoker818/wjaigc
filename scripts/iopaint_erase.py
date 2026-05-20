#!/usr/bin/env python3
"""
IOPaint LaMa 擦除脚本 - 被 Node.js 通过 child_process 调用
输入: stdin JSON { image: base64_string, mask: base64_string }
输出: stdout JSON { success: bool, image?: base64_string, error?: string }
"""

import sys
import json
import base64
import io
import os
import traceback

# 抑制 torch 杂项警告
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

def main():
    try:
        # 读取输入
        input_data = json.loads(sys.stdin.read())
        image_b64 = input_data.get("image", "")
        mask_b64 = input_data.get("mask", "")

        if not image_b64 or not mask_b64:
            print(json.dumps({"success": False, "error": "缺少 image 或 mask 参数"}))
            return

        # 去掉 data:image/...;base64, 前缀
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        if "," in mask_b64:
            mask_b64 = mask_b64.split(",", 1)[1]

        image_bytes = base64.b64decode(image_b64)
        mask_bytes = base64.b64decode(mask_b64)

        # 导入 PIL 和 numpy
        from PIL import Image
        import numpy as np

        # 解码图片
        image_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        mask_pil = Image.open(io.BytesIO(mask_bytes)).convert("L")

        # 确保 mask 和 image 尺寸一致
        if mask_pil.size != image_pil.size:
            mask_pil = mask_pil.resize(image_pil.size, Image.NEAREST)

        image_np = np.array(image_pil)
        mask_np = np.array(mask_pil)

        # 导入 LaMa
        from iopaint.model.lama import LaMa

        # 初始化 LaMa 模型 (CPU 模式)
        lama = LaMa(device="cpu")

        # 执行修复
        # LaMa.__call__(image, mask, config) - image: RGB np.array, mask: grayscale np.array (255=inpainted, 0=kept)
        result_np = lama(image_np, mask_np)

        # 编码结果
        result_pil = Image.fromarray(result_np)
        buf = io.BytesIO()
        result_pil.save(buf, format="PNG")
        result_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        print(json.dumps({"success": True, "image": result_b64}))

    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
