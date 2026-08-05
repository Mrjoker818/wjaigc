#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IOPaint 兼容擦除脚本（LaMa / Anime-LaMa 深度学习推理，ZITS 可选，OpenCV Telea 兜底）。

CLI:
  python3 iopaint_erase.py <input> <mask> <output> [model] [hd_strategy]

- model: lama / anime-lama / zits（默认 lama）
- hd_strategy: Crop / Resize / Original（默认 Crop，大图自动裁剪修复上下文）
- 环境变量:
  - IOPAINT_MODELS_DIR：模型根目录（默认 /space/iopaint-models 或项目 models/iopaint）
  - IOPAINT_NUM_THREADS：torch CPU 推理线程数（默认 4，为 Web 服务预留算力）
  - LAMA_MODEL_URL / ANIME_LAMA_MODEL_URL / ZITS_*_MODEL_URL：显式模型文件路径
"""
import os
import sys

MODEL_FILES = {
    "lama": ("big-lama.pt",),
    "anime-lama": ("anime-manga-big-lama.pt",),
    "zits": (
        "zits-wireframe-0717.pt",
        "zits-edge-line-0717.pt",
        "zits-structure-upsample-0717.pt",
        "zits-inpaint-0717.pt",
    ),
}

ZITS_MODEL_ENV = {
    "zits-wireframe-0717.pt": "ZITS_WIRE_FRAME_MODEL_URL",
    "zits-edge-line-0717.pt": "ZITS_EDGE_LINE_MODEL_URL",
    "zits-structure-upsample-0717.pt": "ZITS_STRUCTURE_UPSAMPLE_MODEL_URL",
    "zits-inpaint-0717.pt": "ZITS_INPAINT_MODEL_URL",
}


def resolve_models_dir():
    configured = os.environ.get("IOPAINT_MODELS_DIR")
    candidates = []
    if configured:
        candidates.append(configured)
    candidates.append("/space/iopaint-models")
    candidates.append(
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "models",
            "iopaint",
        )
    )
    for candidate in candidates:
        if os.path.isdir(candidate):
            return candidate
    return configured or ""


def find_model_file(models_dir, filename):
    for candidate in (
        os.path.join(models_dir, filename),
        os.path.join(models_dir, "hub", "checkpoints", filename),
    ):
        if os.path.isfile(candidate):
            return candidate
    return None


def configure_zits_paths(models_dir):
    for filename, env_name in ZITS_MODEL_ENV.items():
        model_path = find_model_file(models_dir, filename)
        if not model_path:
            return False
        os.environ[env_name] = model_path
    return True


def run_opencv_inpaint(input_path, mask_path, output_path):
    """OpenCV Telea 兜底，保持无 torch/iopaint 依赖时仍可擦除。"""
    try:
        import cv2
        import numpy as np
    except ImportError as error:
        print(
            f"[erase] ImportError: {error}. Please install: pip install opencv-python-headless numpy",
            file=sys.stderr,
        )
        return 2

    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"[erase] Failed to read input: {input_path}", file=sys.stderr)
        return 3
    mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        print(f"[erase] Failed to read mask: {mask_path}", file=sys.stderr)
        return 4

    if img.shape[:2] != mask.shape[:2]:
        mask = cv2.resize(
            mask, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST
        )
    _, mask_bin = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)

    has_alpha = len(img.shape) == 3 and img.shape[2] == 4
    if has_alpha:
        bgr = img[:, :, :3]
        alpha = img[:, :, 3]
    else:
        bgr = img if len(img.shape) == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask_dilated = cv2.dilate(mask_bin, kernel, iterations=2)
    result_bgr = cv2.inpaint(bgr, mask_dilated, 5, cv2.INPAINT_TELEA)

    try:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        if has_alpha:
            alpha_out = alpha.copy()
            alpha_out[mask_dilated > 0] = 255
            result_rgba = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2BGRA)
            result_rgba[:, :, 3] = alpha_out
            cv2.imwrite(output_path, result_rgba)
        else:
            cv2.imwrite(output_path, result_bgr)
    except Exception as error:
        print(f"[erase] Failed to save {output_path}: {error}", file=sys.stderr)
        return 5

    mask_pixels = int(np.count_nonzero(mask_bin))
    total_pixels = int(mask_bin.shape[0] * mask_bin.shape[1])
    print(
        f"[erase] Success method=opencv-telea mask_pixels={mask_pixels}"
        f" ({mask_pixels/total_pixels*100:.1f}%) output={output_path}",
        flush=True,
    )
    return 0


def _load_image_and_mask(input_path, mask_path):
    import cv2
    import numpy as np

    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise RuntimeError(f"Failed to read input: {input_path}")
    mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise RuntimeError(f"Failed to read mask: {mask_path}")
    if img.shape[:2] != mask.shape[:2]:
        mask = cv2.resize(
            mask, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST
        )
    _, mask_bin = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
    return img, mask_bin


def _save_result(result_bgr, mask_bin, input_img, output_path):
    import cv2
    import os

    has_alpha = len(input_img.shape) == 3 and input_img.shape[2] == 4
    if has_alpha:
        alpha = input_img[:, :, 3]
        alpha_out = alpha.copy()
        alpha_out[mask_bin > 0] = 255
        result_rgba = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2BGRA)
        result_rgba[:, :, 3] = alpha_out
        cv2.imwrite(output_path, result_rgba)
    else:
        cv2.imwrite(output_path, result_bgr)


def run_lama_inpaint(input_path, mask_path, output_path, model, model_path):
    """直接用 torch 加载 big-lama / anime-manga-big-lama JIT 模型推理。"""
    import cv2
    import io
    import numpy as np
    import torch

    torch.set_num_threads(max(1, int(os.environ.get("IOPAINT_NUM_THREADS", "4"))))
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass

    input_img, mask_bin = _load_image_and_mask(input_path, mask_path)
    has_alpha = len(input_img.shape) == 3 and input_img.shape[2] == 4
    if has_alpha:
        bgr = input_img[:, :, :3]
    else:
        bgr = input_img if len(input_img.shape) == 3 else cv2.cvtColor(
            input_img, cv2.COLOR_GRAY2BGR
        )
    image_rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    # 兼容含非 ASCII 字符的模型路径（Windows torch JIT 直接 fopen 会失败）
    with open(model_path, "rb") as model_file:
        net = torch.jit.load(io.BytesIO(model_file.read()), map_location="cpu").eval()

    def ceil_modulo(value, mod):
        return value if value % mod == 0 else (value // mod + 1) * mod

    height, width = image_rgb.shape[:2]
    pad_h = ceil_modulo(height, 8)
    pad_w = ceil_modulo(width, 8)
    image_pad = np.pad(
        image_rgb,
        ((0, pad_h - height), (0, pad_w - width), (0, 0)),
        mode="symmetric",
    )
    mask_pad = np.pad(
        mask_bin[:, :, np.newaxis],
        ((0, pad_h - height), (0, pad_w - width), (0, 0)),
        mode="symmetric",
    )[:, :, 0]

    image_tensor = (
        torch.from_numpy(image_pad.astype(np.float32) / 255.0)
        .permute(2, 0, 1)
        .unsqueeze(0)
    )
    mask_tensor = (
        torch.from_numpy((mask_pad > 0).astype(np.float32))
        .unsqueeze(0)
        .unsqueeze(0)
    )

    with torch.no_grad():
        output = net(image_tensor, mask_tensor)
    result_rgb = output[0].permute(1, 2, 0).cpu().numpy()
    result_rgb = np.clip(result_rgb * 255, 0, 255).astype(np.uint8)
    result_rgb = result_rgb[:height, :width, :]
    result_bgr = cv2.cvtColor(result_rgb, cv2.COLOR_RGB2BGR)

    # 蒙版外像素精确还原原图，避免边缘偏差
    result_bgr[mask_bin == 0] = bgr[mask_bin == 0]

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    _save_result(result_bgr, mask_bin, input_img, output_path)

    mask_pixels = int(np.count_nonzero(mask_bin))
    total_pixels = int(mask_bin.shape[0] * mask_bin.shape[1])
    print(
        f"[erase] Success method={model} mask_pixels={mask_pixels}"
        f" ({mask_pixels/total_pixels*100:.1f}%) output={output_path}",
        flush=True,
    )
    return 0


def run_zits_inpaint(input_path, mask_path, output_path):
    """ZITS 结构感知修复（可选，依赖 iopaint 包）。"""
    import torch

    torch.set_num_threads(max(1, int(os.environ.get("IOPAINT_NUM_THREADS", "4"))))
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass

    import cv2
    import numpy as np
    from iopaint.model import ZITS
    from iopaint.schema import InpaintRequest

    input_img, mask_bin = _load_image_and_mask(input_path, mask_path)
    has_alpha = len(input_img.shape) == 3 and input_img.shape[2] == 4
    if has_alpha:
        bgr = input_img[:, :, :3]
    else:
        bgr = input_img if len(input_img.shape) == 3 else cv2.cvtColor(
            input_img, cv2.COLOR_GRAY2BGR
        )
    image_rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    config = InpaintRequest(
        hd_strategy="Crop",
        hd_strategy_resize_limit=int(os.environ.get("IOPAINT_HD_RESIZE_LIMIT", "2048")),
        hd_strategy_crop_trigger_size=int(
            os.environ.get("IOPAINT_HD_CROP_TRIGGER", "800")
        ),
        hd_strategy_crop_margin=128,
    )
    net = ZITS(device="cpu")
    result_bgr = net(image_rgb, mask_bin, config)
    result_bgr[mask_bin == 0] = bgr[mask_bin == 0]

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    _save_result(result_bgr, mask_bin, input_img, output_path)

    mask_pixels = int(np.count_nonzero(mask_bin))
    total_pixels = int(mask_bin.shape[0] * mask_bin.shape[1])
    print(
        f"[erase] Success method=zits mask_pixels={mask_pixels}"
        f" ({mask_pixels/total_pixels*100:.1f}%) output={output_path}",
        flush=True,
    )
    return 0


def main():
    if len(sys.argv) < 4:
        print(
            "[erase] Usage: iopaint_erase.py <input> <mask> <output> [model] [hd_strategy]",
            file=sys.stderr,
        )
        return 1

    input_path = sys.argv[1]
    mask_path = sys.argv[2]
    output_path = sys.argv[3]
    model = sys.argv[4] if len(sys.argv) > 4 else "lama"
    if model not in MODEL_FILES:
        model = "lama"

    models_dir = resolve_models_dir()

    if model == "zits":
        if configure_zits_paths(models_dir):
            try:
                return run_zits_inpaint(input_path, mask_path, output_path)
            except Exception as error:
                print(
                    f"[erase] ZITS engine failed: {error}, falling back to OpenCV",
                    file=sys.stderr,
                )
        else:
            print(
                "[erase] ZITS model files not found, falling back to OpenCV",
                file=sys.stderr,
            )
    else:
        model_path = find_model_file(models_dir, MODEL_FILES[model][0])
        if model_path:
            try:
                return run_lama_inpaint(
                    input_path, mask_path, output_path, model, model_path
                )
            except Exception as error:
                print(
                    f"[erase] LaMa engine ({model}) failed: {error}, falling back to OpenCV",
                    file=sys.stderr,
                )
        else:
            print(
                f"[erase] Model files for {model} not found, falling back to OpenCV",
                file=sys.stderr,
            )

    return run_opencv_inpaint(input_path, mask_path, output_path)


if __name__ == "__main__":
    sys.exit(main())
