#!/usr/bin/env python3
"""
IOPaint 擦除脚本 - 支持 LaMa / Anime-LaMa / ZITS 三种擦除模型
通过 stdin 接收 JSON，stdout 返回 JSON 结果

输入格式:
{
  "image": "<base64 PNG/JPEG>",
  "mask": "<base64 PNG 灰度蒙版，255=擦除区域>",
  "model": "lama" | "anime-lama" | "zits"  (可选，默认 lama)
}

输出格式:
{
  "success": true,
  "image": "<base64 PNG>",
  "engine": "iopaint-lama" | "iopaint-anime-lama" | "iopaint-zits",
  "model": "lama" | "anime-lama" | "zits"
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

import cv2
import numpy as np


def decode_base64_to_np(b64_str: str):
    """解码 base64 字符串为 numpy 数组 (RGB)"""
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("无法解码图片")
    if len(img.shape) == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2RGB)
    elif img.shape[2] == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img


def encode_np_to_base64(img_bgr: np.ndarray) -> str:
    """编码 numpy 数组 (BGR) 为 base64 PNG 字符串"""
    _, buf = cv2.imencode(".png", img_bgr, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    return base64.b64encode(buf).decode("utf-8")


def check_model_available(model_name: str) -> str:
    """检查模型文件是否可用，返回路径或空字符串"""
    from iopaint.helper import get_cache_path_by_url

    if model_name == "lama":
        url = "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt"
        path = get_cache_path_by_url(url)
        if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
            return path
    elif model_name == "anime-lama":
        url = "https://github.com/Sanster/models/releases/download/AnimeMangaInpainting/anime-manga-big-lama.pt"
        path = get_cache_path_by_url(url)
        if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
            return path
    elif model_name == "zits":
        urls = [
            "https://github.com/Sanster/models/releases/download/add_zits/zits-inpaint-0717.pt",
            "https://github.com/Sanster/models/releases/download/add_zits/zits-edge-line-0717.pt",
            "https://github.com/Sanster/models/releases/download/add_zits/zits-structure-upsample-0717.pt",
            "https://github.com/Sanster/models/releases/download/add_zits/zits-wireframe-0717.pt",
        ]
        paths = [get_cache_path_by_url(u) for u in urls]
        if all(os.path.exists(p) and os.path.getsize(p) > 100_000 for p in paths):
            return ",".join(paths)
    return ""


def list_available_models() -> dict:
    """列出所有可用模型"""
    models = {}
    for name in ["lama", "anime-lama", "zits"]:
        path = check_model_available(name)
        models[name] = {
            "available": bool(path),
            "path": path,
        }
    return models


def run_erase(image_b64: str, mask_b64: str, model_name: str = "lama"):
    """执行擦除操作"""
    # 限制 CPU 线程数，避免内存溢出
    torch_path = None
    try:
        import torch
        torch_path = torch.__file__
        torch.set_num_threads(2)
    except ImportError:
        pass

    from iopaint.model.lama import LaMa
    from iopaint.model.zits import ZITS
    from iopaint.schema import InpaintRequest, HDStrategy

    # 解码图片
    image_rgb = decode_base64_to_np(image_b64)
    mask_gray = decode_base64_to_np(mask_b64)
    if len(mask_gray.shape) == 3:
        mask_gray = cv2.cvtColor(mask_gray, cv2.COLOR_RGB2GRAY)

    # 限制图片最大尺寸 (CPU 模式下防止内存溢出)
    max_size = 2048
    h, w = image_rgb.shape[:2]
    if max(h, w) > max_size:
        scale = max_size / max(h, w)
        new_w, new_h = int(w * scale), int(h * scale)
        image_rgb = cv2.resize(image_rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)
        mask_gray = cv2.resize(mask_gray, (new_w, new_h), interpolation=cv2.INTER_NEAREST)

    # 选择设备
    device = "cpu"
    try:
        import torch
        if torch.cuda.is_available():
            device = "cuda"
    except Exception:
        pass

    # 初始化模型
    if model_name == "anime-lama":
        from iopaint.model.lama import AnimeLaMa
        model = AnimeLaMa(device=device)
        engine_name = "iopaint-anime-lama"
    elif model_name == "zits":
        model = ZITS(device=device)
        engine_name = "iopaint-zits"
    else:  # lama (default)
        model = LaMa(device=device)
        engine_name = "iopaint-lama"

    # 加载模型权重
    model.init_model(device=device)

    # 构建 InpaintRequest
    config = InpaintRequest()
    config.hd_strategy = HDStrategy.RESIZE
    config.hd_strategy_resize_limit = 1024

    # 执行擦除
    # 输入: image [H, W, C] RGB, mask [H, W]
    # 输出: BGR IMAGE
    result_bgr = model(image_rgb, mask_gray, config)

    # 编码结果
    result_b64 = encode_np_to_base64(result_bgr)

    return {
        "success": True,
        "image": result_b64,
        "engine": engine_name,
        "model": model_name,
    }


def main():
    try:
        # 读取 stdin
        input_data = sys.stdin.read()
        data = json.loads(input_data)

        image_b64 = data.get("image", "")
        mask_b64 = data.get("mask", "")
        model_name = data.get("model", "lama")

        if not image_b64:
            print(json.dumps({"success": False, "error": "缺少 image 参数"}))
            sys.exit(1)
        if not mask_b64:
            print(json.dumps({"success": False, "error": "缺少 mask 参数"}))
            sys.exit(1)

        # 验证模型名
        valid_models = ["lama", "anime-lama", "zits"]
        if model_name not in valid_models:
            print(json.dumps({
                "success": False,
                "error": f"不支持的模型: {model_name}，可用: {', '.join(valid_models)}"
            }))
            sys.exit(1)

        # 检查模型是否可用
        model_path = check_model_available(model_name)
        if not model_path:
            print(json.dumps({
                "success": False,
                "error": f"模型 {model_name} 文件不存在，请先下载模型。运行: bash scripts/download-iopaint-models.sh",
                "modelUnavailable": True,
                "model": model_name,
            }))
            sys.exit(1)

        # 执行擦除
        result = run_erase(image_b64, mask_b64, model_name)
        print(json.dumps(result))

    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    # 检查是否为列表模式
    if len(sys.argv) > 1 and sys.argv[1] == "--list-models":
        models = list_available_models()
        print(json.dumps({"models": models}))
    else:
        main()
