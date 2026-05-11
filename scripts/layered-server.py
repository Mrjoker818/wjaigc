#!/usr/bin/env python3
"""
Qwen-Image-Layered 图像分层服务

基于 QwenLM/Qwen-Image-Layered 项目:
https://github.com/QwenLM/Qwen-Image-Layered

将图像分解为多个 RGBA 图层，实现固有的可编辑性：
- 每个图层可以独立操作，不影响其他内容
- 支持高保真基本操作：调整大小、重新定位、重新着色
- 通过将语义/结构组件物理隔离到不同图层中

使用方法:
1. 安装依赖:
   pip install torch diffusers transformers flask pillow psd-tools python-pptx requests
   pip install git+https://github.com/huggingface/diffusers
2. 下载模型权重 (首次运行自动下载):
   模型: Qwen/Qwen-Image-Layered
3. 运行: python layered-server.py --port 8101

API 接口:
  GET  /health              - 健康检查
  POST /decompose           - 执行 RGBA 图层分解
    Body: {
      "image_url": "...",
      "layers": 4,
      "resolution": 640,
      "prompt": "",
      "negative_prompt": " ",
      "num_inference_steps": 50,
      "true_cfg_scale": 4.0,
      "seed": 777,
      "cfg_normalize": true,
      "use_en_prompt": true,
      "export_format": "psd" | "zip" | "both"
    }
    Response: {
      "success": true,
      "layers": [
        { "id": 0, "name": "Layer 1", "image_url": "/outputs/xxx_layer_0.png", "width": 640, "height": 640 }
      ],
      "psd_url": "/outputs/xxx.psd",  (if export_format includes psd)
      "zip_url": "/outputs/xxx.zip",  (if export_format includes zip)
      "composite_url": "/outputs/xxx_composite.png"
    }
"""

import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from pathlib import Path

try:
    from flask import Flask, request, jsonify, send_from_directory
    from PIL import Image
    import requests as http_requests
except ImportError:
    print("请先安装依赖: pip install flask pillow requests")
    sys.exit(1)

app = Flask(__name__)

# 全局配置
CONFIG = {
    'output_dir': '',
    'device': 'cuda',
    'pipeline': None,
}

# 是否使用 GPU
def has_cuda():
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


def init_pipeline():
    """初始化 Qwen-Image-Layered pipeline"""
    if CONFIG['pipeline'] is not None:
        return CONFIG['pipeline']

    try:
        import torch
        from diffusers import QwenImageLayeredPipeline

        print("正在加载 Qwen-Image-Layered 模型...")
        device = CONFIG['device']
        dtype = torch.bfloat16 if device == 'cuda' else torch.float32

        pipeline = QwenImageLayeredPipeline.from_pretrained("Qwen/Qwen-Image-Layered")
        pipeline = pipeline.to(device, dtype)
        pipeline.set_progress_bar_config(disable=None)

        CONFIG['pipeline'] = pipeline
        print("模型加载完成!")
        return pipeline
    except ImportError as e:
        print(f"缺少依赖: {e}")
        print("请安装: pip install git+https://github.com/huggingface/diffusers")
        return None
    except Exception as e:
        print(f"模型加载失败: {e}")
        return None


def download_image(url):
    """下载图片到 PIL Image"""
    if url.startswith('data:'):
        import base64
        import re
        matches = re.match(r'^data:image/(\w+);base64,(.+)$', url)
        if matches:
            buffer = base64.b64decode(matches.group(2))
            return Image.open(io.BytesIO(buffer)).convert('RGBA')
        raise ValueError('Invalid data URL format')

    if url.startswith('/') or url.startswith('file://'):
        local_path = url.replace('file://', '')
        return Image.open(local_path).convert('RGBA')

    resp = http_requests.get(url, timeout=30)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert('RGBA')


def imagelist_to_psd(layer_images, output_path):
    """将 RGBA 图层列表保存为 PSD 文件"""
    try:
        from psd_tools import PSDImage

        width, height = layer_images[0].size
        psd = PSDImage.new(mode='RGBA', size=(width, height))

        for i, img in enumerate(layer_images):
            name = f"Layer {i + 1}"
            layer = psd.create_pixel_layer(image=img, name=name)
            psd.append(layer)

        psd.save(output_path)
        return output_path
    except ImportError:
        print("psd-tools 未安装，跳过 PSD 导出")
        return None


def imagelist_to_zip(layer_images, output_path):
    """将 RGBA 图层列表保存为 ZIP 文件"""
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for i, img in enumerate(layer_images):
            buf = io.BytesIO()
            img.save(buf, 'PNG')
            zipf.writestr(f'layer_{i + 1}.png', buf.getvalue())
    return output_path


@app.route('/health', methods=['GET'])
def health():
    pipeline_loaded = CONFIG['pipeline'] is not None
    return jsonify({
        'status': 'ok',
        'pipeline_loaded': pipeline_loaded,
        'device': CONFIG['device'],
        'cuda_available': has_cuda(),
    })


@app.route('/decompose', methods=['POST'])
def decompose():
    try:
        body = request.get_json(force=True)
        image_url = body.get('image_url') or body.get('imageUrl')
        num_layers = int(body.get('layers', 4))
        resolution = int(body.get('resolution', 640))
        prompt = body.get('prompt', None)
        negative_prompt = body.get('negative_prompt', ' ')
        num_inference_steps = int(body.get('num_inference_steps', 50))
        true_cfg_scale = float(body.get('true_cfg_scale', 4.0))
        seed = int(body.get('seed', 777))
        cfg_normalize = body.get('cfg_normalize', True)
        use_en_prompt = body.get('use_en_prompt', True)
        export_format = body.get('export_format', 'both')  # psd | zip | both

        if not image_url:
            return jsonify({'success': False, 'error': '缺少 image_url'}), 400

        # 初始化 pipeline
        pipeline = init_pipeline()
        if pipeline is None:
            return jsonify({'success': False, 'error': 'Qwen-Image-Layered 模型未加载，请检查依赖和 GPU'}), 503

        import torch

        # 下载图片
        pil_image = download_image(image_url)

        # 准备输入
        inputs = {
            'image': pil_image,
            'generator': torch.Generator(device=CONFIG['device']).manual_seed(seed),
            'true_cfg_scale': true_cfg_scale,
            'negative_prompt': negative_prompt,
            'num_inference_steps': num_inference_steps,
            'num_images_per_prompt': 1,
            'layers': num_layers,
            'resolution': resolution,
            'cfg_normalize': cfg_normalize,
            'use_en_prompt': use_en_prompt,
        }

        if prompt:
            inputs['prompt'] = prompt

        # 执行分解
        print(f"开始分解: layers={num_layers}, resolution={resolution}, steps={num_inference_steps}")
        start_time = time.time()

        with torch.inference_mode():
            output = pipeline(**inputs)
            output_images = output.images[0]  # list of PIL Images (RGBA)

        elapsed = time.time() - start_time
        print(f"分解完成，耗时 {elapsed:.1f}s，生成 {len(output_images)} 个图层")

        # 保存结果
        output_dir = CONFIG['output_dir']
        os.makedirs(output_dir, exist_ok=True)

        task_id = f"layered_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        layer_data = []

        # 保存每个图层
        for i, img in enumerate(output_images):
            filename = f'{task_id}_layer_{i}.png'
            filepath = os.path.join(output_dir, filename)
            img.save(filepath, 'PNG')
            w, h = img.size
            layer_data.append({
                'id': i,
                'name': f'Layer {i + 1}',
                'image_url': f'/outputs/{filename}',
                'width': w,
                'height': h,
            })

        # 合成图
        composite = output_images[0].copy()
        for img in output_images[1:]:
            composite = Image.alpha_composite(composite, img)
        composite_filename = f'{task_id}_composite.png'
        composite.save(os.path.join(output_dir, composite_filename), 'PNG')

        result = {
            'success': True,
            'layers': layer_data,
            'composite_url': f'/outputs/{composite_filename}',
            'num_layers': len(output_images),
            'elapsed_seconds': round(elapsed, 1),
        }

        # 导出 PSD
        if export_format in ('psd', 'both'):
            psd_filename = f'{task_id}.psd'
            psd_path = os.path.join(output_dir, psd_filename)
            psd_result = imagelist_to_psd(output_images, psd_path)
            if psd_result:
                result['psd_url'] = f'/outputs/{psd_filename}'

        # 导出 ZIP
        if export_format in ('zip', 'both'):
            zip_filename = f'{task_id}.zip'
            zip_path = os.path.join(output_dir, zip_filename)
            imagelist_to_zip(output_images, zip_path)
            result['zip_url'] = f'/outputs/{zip_filename}'

        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/outputs/<path:filename>', methods=['GET'])
def serve_output(filename):
    return send_from_directory(CONFIG['output_dir'], filename)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Qwen-Image-Layered 图像分层服务')
    parser.add_argument('--port', type=int, default=8101, help='服务端口 (默认 8101)')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='监听地址')
    parser.add_argument('--output', type=str, default='/tmp/layered-outputs', help='输出目录')
    parser.add_argument('--device', type=str, default='cuda' if has_cuda() else 'cpu', help='计算设备')
    parser.add_argument('--preload', action='store_true', help='启动时预加载模型')
    args = parser.parse_args()

    CONFIG['output_dir'] = args.output
    CONFIG['device'] = args.device

    print(f'Qwen-Image-Layered Server starting on {args.host}:{args.port}')
    print(f'  Device: {args.device}')
    print(f'  Output: {args.output}')
    print(f'  CUDA: {has_cuda()}')

    if args.preload:
        init_pipeline()

    app.run(host=args.host, port=args.port, debug=False)
