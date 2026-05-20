#!/usr/bin/env python3
"""
IOPaint RemoveBG 去背景脚本 - 被 Node.js 通过 child_process 调用
输入: stdin JSON { image: base64_string, model?: string }
输出: stdout JSON { success: bool, image?: base64_string, error?: string }
"""

import sys
import json
import base64
import io
import os
import traceback

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

def main():
    try:
        # 读取输入
        input_data = json.loads(sys.stdin.read())
        image_b64 = input_data.get("image", "")
        model_name = input_data.get("model", "birefnet-general-lite")

        if not image_b64:
            print(json.dumps({"success": False, "error": "缺少 image 参数"}))
            return

        # 去掉 data:image/...;base64, 前缀
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        image_bytes = base64.b64decode(image_b64)

        # 导入 PIL
        from PIL import Image

        # 解码图片
        image_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # 导入 RemoveBG
        from iopaint.plugins.remove_bg import RemoveBG

        # 初始化 RemoveBG 模型
        rmbg = RemoveBG(model_name=model_name, device="cpu")

        # 执行去背景
        # RemoveBG(image_pil) 返回带 alpha 通道的 PIL Image
        result_pil = rmbg(image_pil)

        if result_pil is None:
            print(json.dumps({"success": False, "error": "RemoveBG 返回空结果"}))
            return

        # 确保结果有 alpha 通道
        if result_pil.mode != "RGBA":
            result_pil = result_pil.convert("RGBA")

        # 编码结果
        buf = io.BytesIO()
        result_pil.save(buf, format="PNG")
        result_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        print(json.dumps({"success": True, "image": result_b64}))

    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
