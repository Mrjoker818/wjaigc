#!/usr/bin/env python3
"""
RemoveBG 脚本 — 使用 rembg 模型去除背景

输出：
  默认模式：返回 RGBA PNG（alpha 通道为概率蒙版）
  --gen_mask 模式：返回蒙版 PNG（灰度概率蒙版，已膨胀+模糊优化）

设计原则：
  - rembg 输出的是概率蒙版（0-255），边缘有自然过渡
  - 膨胀 2px 保护主体完整性
  - 高斯模糊 1.5px 让边缘更顺滑
  - 不做 threshold 二值化（保留边缘灰度过渡）
  - 所有蒙版处理在 Python 端完成
"""

import sys
import json
import base64
import io
import numpy as np
from PIL import Image, ImageFilter

def remove_background(input_data, model_name='u2net', gen_mask=False):
    """去除图片背景，返回蒙版和 RGBA 结果"""
    try:
        from rembg import remove, new_session
    except ImportError:
        return {'success': False, 'error': 'rembg not installed'}

    # 加载输入图片
    if isinstance(input_data, str):
        img = Image.open(io.BytesIO(base64.b64decode(input_data)))
    else:
        img = Image.open(io.BytesIO(input_data))
    
    original_size = img.size  # (width, height)
    img = img.convert('RGB')

    # 创建 rembg session
    try:
        session = new_session(model_name)
    except Exception as e:
        return {'success': False, 'error': f'Failed to create session for {model_name}: {e}'}

    # rembg 去背景 — 不使用 postprocess_mask（它会腐蚀蒙版）
    result = remove(img, session=session, post_process_mask=False)
    
    # result 是 RGBA 图片，alpha 通道就是概率蒙版
    if result.mode != 'RGBA':
        result = result.convert('RGBA')
    
    # 提取 alpha 通道作为蒙版
    mask = np.array(result.split()[-1])  # alpha 通道，0-255
    
    # ---- 蒙版优化 ----
    # 1. 轻微膨胀：保护主体完整性（2px）
    #    使用 PIL 的 MaxFilter（膨胀）代替腐蚀
    mask_img = Image.fromarray(mask, mode='L')
    mask_img = mask_img.filter(ImageFilter.MaxFilter(size=5))  # 5x5 最大值滤波 ≈ 膨胀 2px
    
    # 2. 高斯模糊：让边缘顺滑无锯齿（1.5px radius）
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=1.5))
    
    # 3. 将蒙版缩放回原图尺寸（rembg 可能改变了尺寸）
    if mask_img.size != original_size:
        mask_img = mask_img.resize(original_size, Image.LANCZOS)
    
    # 获取优化后的蒙版数组
    optimized_mask = np.array(mask_img)
    
    # 构建 RGBA 结果（用优化后的蒙版作为 alpha）
    result_resized = result.resize(original_size, Image.LANCZOS)
    r, g, b, _ = result_resized.split()
    rgba_result = Image.merge('RGBA', (r, g, b, mask_img))
    
    # 编码输出
    if gen_mask:
        # 返回蒙版 PNG + RGBA PNG
        mask_buf = io.BytesIO()
        mask_img.save(mask_buf, format='PNG')
        mask_b64 = base64.b64encode(mask_buf.getvalue()).decode('ascii')
        
        rgba_buf = io.BytesIO()
        rgba_result.save(rgba_buf, format='PNG')
        rgba_b64 = base64.b64encode(rgba_buf.getvalue()).decode('ascii')
        
        return {
            'success': True,
            'maskBase64': mask_b64,
            'rgbaBase64': rgba_b64,
            'model': model_name,
            'maskSize': list(mask_img.size),
            'originalSize': list(original_size),
        }
    else:
        # 只返回 RGBA PNG
        rgba_buf = io.BytesIO()
        rgba_result.save(rgba_buf, format='PNG')
        rgba_b64 = base64.b64encode(rgba_buf.getvalue()).decode('ascii')
        
        return {
            'success': True,
            'imageBase64': rgba_b64,
            'model': model_name,
            'originalSize': list(original_size),
        }


if __name__ == '__main__':
    # 解析命令行参数
    input_data = sys.stdin.read()
    try:
        params = json.loads(input_data)
    except json.JSONDecodeError as e:
        print(json.dumps({'success': False, 'error': f'Invalid JSON: {e}'}))
        sys.exit(1)
    
    image_data = params.get('image', '')
    model_name = params.get('model', 'u2net')
    gen_mask = params.get('return_mask', False)
    
    if not image_data:
        print(json.dumps({'success': False, 'error': 'No image data provided'}))
        sys.exit(1)
    
    # 将 base64 解码为二进制
    try:
        image_bytes = base64.b64decode(image_data)
    except Exception:
        print(json.dumps({'success': False, 'error': 'Invalid base64 image data'}))
        sys.exit(1)
    
    result = remove_background(image_bytes, model_name, gen_mask)
    print(json.dumps(result))
