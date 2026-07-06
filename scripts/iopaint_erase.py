#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IOPaint 兼容擦除脚本（OpenCV inpaint 实现，无需 torch/iopaint 依赖）。

本脚本保持与原 iopaint_erase.py 相同的 CLI 入参，以便 Node 侧无改动即可调用：
  python3 iopaint_erase.py <input> <mask> <output> [model] [hd_strategy]

功能：
  - 使用 OpenCV 的 inpaint 算法（Telea / NS）对用户涂抹区域进行修复
  - 输入/输出均为 PNG；蒙版白色像素表示要擦除的区域
  - 对于简单背景、纯色背景效果良好；复杂场景云端 AI 路径已在 Node 层优先

注意：
  - 原 LaMa/ZITS/Anime-LaMa 模型需要 torch+iopaint，沙箱环境磁盘不足无法安装
  - 本脚本仅作为本地 CPU 兜底方案，确保「本地」选项不报错
"""
import sys
import os


def main() -> int:
    if len(sys.argv) < 4:
        print("[erase] Usage: iopaint_erase.py <input> <mask> <output> [model] [hd_strategy]",
              file=sys.stderr)
        return 1

    input_path: str = sys.argv[1]
    mask_path: str = sys.argv[2]
    output_path: str = sys.argv[3]
    # model: lama / zits / anime-lama 等参数（此处统一使用 OpenCV inpaint，忽略差异）

    try:
        import cv2
        import numpy as np
    except ImportError as e:
        print(f"[erase] ImportError: {e}. Please install: pip install opencv-python-headless numpy",
              file=sys.stderr)
        return 2

    # 读取原图（BGR）
    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"[erase] Failed to read input: {input_path}", file=sys.stderr)
        return 3

    # 读取蒙版（灰度）
    mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        print(f"[erase] Failed to read mask: {mask_path}", file=sys.stderr)
        return 4

    # 尺寸对齐
    if img.shape[:2] != mask.shape[:2]:
        mask = cv2.resize(mask, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST)

    # 蒙版二值化：灰度>127 视为擦除区域
    _, mask_bin = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)

    # 如果输入有 alpha 通道，需要先分离
    has_alpha = img.shape[2] == 4 if len(img.shape) == 3 else False
    if has_alpha:
        bgr = img[:, :, :3]
        alpha = img[:, :, 3]
    else:
        bgr = img if len(img.shape) == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None

    # 对蒙版做轻微膨胀，避免边缘残留
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask_dilated = cv2.dilate(mask_bin, kernel, iterations=2)

    # OpenCV inpaint 半径（像素），越大修复范围越广
    radius = 5

    # 先使用 Telea 算法
    result_bgr = cv2.inpaint(bgr, mask_dilated, radius, cv2.INPAINT_TELEA)

    # 如果蒙版占比太小 Telea 效果不好，可改用 NS；此处直接用 Telea 作为兜底
    try:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        if has_alpha:
            # alpha 通道也做 inpaint（255 不透明）：擦除区域根据周围 alpha 插值
            alpha_result = cv2.inpaint(
                cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY),  # dummy
                mask_dilated, radius, cv2.INPAINT_TELEA
            )
            # 简单策略：若周围都是不透明则保持不透明，若周围有透明则边缘羽化
            alpha_out = alpha.copy()
            alpha_out[mask_dilated > 0] = 255
            result_rgba = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2BGRA)
            result_rgba[:, :, 3] = alpha_out
            cv2.imwrite(output_path, result_rgba)
        else:
            cv2.imwrite(output_path, result_bgr)
    except Exception as e:
        print(f"[erase] Failed to save {output_path}: {e}", file=sys.stderr)
        return 5

    mask_pixels = int(np.count_nonzero(mask_bin))
    total_pixels = int(mask_bin.shape[0] * mask_bin.shape[1])
    print(f"[erase] Success method=opencv-telea mask_pixels={mask_pixels}"
          f" ({mask_pixels/total_pixels*100:.1f}%) output={output_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
