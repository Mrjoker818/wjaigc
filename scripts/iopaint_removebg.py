#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RemoveBG 本地去背景脚本（基于 rembg 库 + ONNX runtime，无需 torch）。

用法：
  python3 iopaint_removebg.py <input_path> <output_path> [model]
  model: birefnet-general-lite | u2net | u2netp | isnet-general-use | silueta

环境变量：
  REMOVEBG_MODELS_DIR : 模型缓存目录（默认 /space/removebg-models）
"""
import sys
import os


def main() -> int:
    if len(sys.argv) < 3:
        print("[removebg] Usage: iopaint_removebg.py <input> <output> [model]",
              file=sys.stderr)
        return 1

    input_path: str = sys.argv[1]
    output_path: str = sys.argv[2]
    model_name: str = sys.argv[3] if len(sys.argv) >= 4 else "birefnet-general-lite"

    # 允许的模型名称
    allowed_models = {
        "birefnet-general-lite",
        "birefnet-general",
        "u2net",
        "u2netp",
        "isnet-general-use",
        "silueta",
    }
    if model_name not in allowed_models:
        print(f"[removebg] Warning: unknown model '{model_name}', fallback to u2net",
              file=sys.stderr)
        model_name = "u2net"

    # 设置模型缓存目录 (U2NET_HOME 是 rembg 读取的环境变量)
    models_dir = os.environ.get("REMOVEBG_MODELS_DIR") or os.environ.get("U2NET_HOME")
    if not models_dir:
        # 默认优先使用 /space 持久目录
        if os.path.isdir("/space/removebg-models"):
            models_dir = "/space/removebg-models"
        else:
            models_dir = os.path.join(os.path.dirname(__file__), "..", "models", "removebg")
    os.makedirs(models_dir, exist_ok=True)
    os.environ["U2NET_HOME"] = models_dir

    try:
        from rembg import remove, new_session
        from PIL import Image
        import numpy as np
    except ImportError as e:
        print(f"[removebg] ImportError: {e}. "
              "Please install: pip install rembg pillow onnxruntime", file=sys.stderr)
        return 2

    try:
        img = Image.open(input_path).convert("RGBA")
    except Exception as e:
        print(f"[removebg] Failed to open input {input_path}: {e}", file=sys.stderr)
        return 3

    try:
        session = new_session(model_name)
        result = remove(img, session=session)
    except Exception as e:
        print(f"[removebg] Inference failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 4

    try:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        # result 是 RGBA Image，直接保存
        result.save(output_path, format="PNG")
    except Exception as e:
        print(f"[removebg] Failed to save {output_path}: {e}", file=sys.stderr)
        return 5

    # 同时生成黑白蒙版（白色=前景，黑色=背景），供 Node 侧使用
    try:
        alpha = np.array(result.split()[-1])  # A 通道
        mask_path = output_path.replace(".png", "-mask.png")
        if mask_path != output_path:
            mask_img = Image.fromarray(alpha, mode="L")
            mask_img.save(mask_path, format="PNG")
    except Exception:
        pass

    print(f"[removebg] Success model={model_name} size={result.size} output={output_path}",
          flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
