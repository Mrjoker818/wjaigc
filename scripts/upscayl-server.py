#!/usr/bin/env python3
"""
Upscayl Real-ESRGAN 无损放大服务

基于 upscayl-ncnn (Real-ESRGAN-ncnn-vulkan) 项目:
https://github.com/upscayl/upscayl-ncnn

使用方法:
1. 安装依赖: pip install flask pillow requests
2. 安装 upscayl-ncnn 二进制文件 (需 Vulkan 兼容 GPU)
3. 运行: python upscayl-server.py --port 8100 --bin /path/to/upscayl-bin --models /path/to/models

API 接口:
  GET  /health          - 健康检查
  GET  /models          - 获取可用模型列表
  POST /upscale         - 执行放大
    Body: { "image_url": "...", "model": "realesrgan-x4plus", "scale": 4, "tile_size": 0, "output_format": "png", "compression": 90 }
    Response: { "success": true, "image_url": "...", "original_size": {...}, "upscaled_size": {...} }

支持的模型:
  - realesrgan-x4plus:      通用高清 (4x, 照片/插画)
  - realesrgan-x4fast:      快速放大 (4x, 速度优先)
  - realesrnet-x4plus:      降噪修复 (4x, 有噪点/压缩伪影)
  - realesrgan-x4plus-anime: 动漫增强 (4x, 动漫/二次元)
  - realesr-animevideov3:   视频帧增强 (2x, 视频截图)
  - remacri:                Remacri (4x, 高保真细节)
  - ultrasharp:             UltraSharp (4x, 锐利细节)
  - ultramix-balanced:      UltraMix Balanced (4x, 均衡)
  - hfa2k:                  HFA2k (4x, 高保真艺术)
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

try:
    from flask import Flask, request, jsonify, send_from_directory
    from PIL import Image
    import requests
except ImportError:
    print("请先安装依赖: pip install flask pillow requests")
    sys.exit(1)

app = Flask(__name__)

# 全局配置
CONFIG = {
    'bin_path': '',
    'models_path': '',
    'output_dir': '',
    'max_input_dim': 2048,
    'timeout_seconds': 300,
}

# 模型描述
MODELS = {
    'realesrgan-x4plus': {
        'name': '通用高清',
        'description': '适合照片和插画，画质全面提升',
        'scale': 4,
    },
    'realesrgan-x4fast': {
        'name': '快速放大',
        'description': '速度优先，快速出图',
        'scale': 4,
    },
    'realesrnet-x4plus': {
        'name': '降噪修复',
        'description': '适合有噪点、压缩伪影的图片',
        'scale': 4,
    },
    'realesrgan-x4plus-anime': {
        'name': '动漫增强',
        'description': '动漫、插画、二次元图片专用',
        'scale': 4,
    },
    'realesr-animevideov3': {
        'name': '视频帧增强',
        'description': '适合视频截图和动画帧放大',
        'scale': 2,
    },
    'remacri': {
        'name': 'Remacri 高保真',
        'description': '高保真细节恢复，适合纹理丰富的图片',
        'scale': 4,
    },
    'ultrasharp': {
        'name': 'UltraSharp 锐利',
        'description': '极致锐利细节增强，适合文字和线条',
        'scale': 4,
    },
    'ultramix-balanced': {
        'name': 'UltraMix 均衡',
        'description': '均衡放大，兼顾清晰度和自然感',
        'scale': 4,
    },
    'hfa2k': {
        'name': 'HFA2k 艺术',
        'description': '高保真艺术风格放大，适合绘画和设计',
        'scale': 4,
    },
}


def get_available_models():
    """获取实际可用的模型列表 (基于 models 目录中的 .param 文件)"""
    models_path = CONFIG['models_path']
    if not models_path or not os.path.isdir(models_path):
        return []
    param_files = [f for f in os.listdir(models_path) if f.endswith('.param')]
    return [f.replace('.param', '') for f in param_files]


def download_image(url, tmp_dir):
    """下载图片到临时目录"""
    if url.startswith('data:'):
        import base64
        import re
        matches = re.match(r'^data:image/(\w+);base64,(.+)$', url)
        if matches:
            ext = 'jpg' if matches.group(1) == 'jpeg' else matches.group(1)
            buffer = base64.b64decode(matches.group(2))
            input_path = os.path.join(tmp_dir, f'input.{ext}')
            with open(input_path, 'wb') as f:
                f.write(buffer)
            return input_path
        raise ValueError('Invalid data URL format')

    if url.startswith('/') or url.startswith('file://'):
        local_path = url.replace('file://', '')
        if os.path.exists(local_path):
            return local_path
        raise ValueError(f'Local file not found: {local_path}')

    ext = url.split('.')[-1].split('?')[0].lower() if '.' in url else 'png'
    if ext == 'jpeg':
        ext = 'jpg'
    input_path = os.path.join(tmp_dir, f'input.{ext}')
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    with open(input_path, 'wb') as f:
        f.write(resp.content)
    return input_path


def run_upscayl(input_path, output_path, model_name, scale, tile_size=0, compression=90):
    """执行 upscayl-ncnn 放大"""
    bin_path = CONFIG['bin_path']
    models_path = CONFIG['models_path']

    if not bin_path or not os.path.isfile(bin_path):
        raise RuntimeError('upscayl-ncnn binary not found')

    model_info = MODELS.get(model_name)
    model_scale = model_info['scale'] if model_info else 4
    include_scale = model_scale != scale

    args = [
        bin_path,
        '-i', input_path,
        '-o', output_path,
        '-m', models_path,
        '-n', model_name,
        '-f', 'png',
        '-c', str(compression),
    ]

    if include_scale:
        args.extend(['-s', str(scale)])

    if tile_size > 0:
        args.extend(['-t', str(tile_size)])

    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=CONFIG['timeout_seconds'],
    )

    if result.returncode != 0 and not os.path.exists(output_path):
        raise RuntimeError(f'upscayl-ncnn failed (code {result.returncode}): {result.stderr}')

    if not os.path.exists(output_path):
        raise RuntimeError('upscayl-ncnn output file not found')

    return output_path


@app.route('/health', methods=['GET'])
def health():
    available_models = get_available_models()
    return jsonify({
        'status': 'ok',
        'upscayl_available': bool(CONFIG['bin_path'] and available_models),
        'bin_path': CONFIG['bin_path'],
        'models_path': CONFIG['models_path'],
        'available_models': available_models,
    })


@app.route('/models', methods=['GET'])
def list_models():
    available_ids = get_available_models()
    models = []
    for mid in available_ids:
        info = MODELS.get(mid, {})
        models.append({
            'id': mid,
            'name': info.get('name', mid),
            'description': info.get('description', ''),
            'scale': info.get('scale', 4),
        })
    return jsonify({
        'available': bool(CONFIG['bin_path'] and available_ids),
        'models': models,
    })


@app.route('/upscale', methods=['POST'])
def upscale():
    try:
        body = request.get_json(force=True)
        image_url = body.get('image_url') or body.get('imageUrl')
        model_name = body.get('model', 'realesrgan-x4fast')
        scale = int(body.get('scale', 2))
        tile_size = int(body.get('tile_size', body.get('tileSize', 0)))
        output_format = body.get('output_format', body.get('outputFormat', 'png'))
        compression = int(body.get('compression', 90))

        if not image_url:
            return jsonify({'success': False, 'error': '缺少 image_url'}), 400

        available_models = get_available_models()
        if not available_models:
            return jsonify({'success': False, 'error': 'Upscayl 不可用，请检查二进制和模型文件'}), 503

        if model_name not in available_models:
            # 尝试找第一个可用的
            model_name = available_models[0]

        tmp_dir = tempfile.mkdtemp(prefix='upscayl-')
        try:
            # 下载图片
            input_path = download_image(image_url, tmp_dir)

            # 获取原始尺寸
            with Image.open(input_path) as img:
                orig_width, orig_height = img.size

            # 如果图片太大，先缩小
            if orig_width > CONFIG['max_input_dim'] or orig_height > CONFIG['max_input_dim']:
                ratio = min(CONFIG['max_input_dim'] / orig_width, CONFIG['max_input_dim'] / orig_height)
                new_w = int(orig_width * ratio)
                new_h = int(orig_height * ratio)
                resized_path = os.path.join(tmp_dir, 'input_resized.png')
                with Image.open(input_path) as img:
                    img = img.resize((new_w, new_h), Image.LANCZOS)
                    img.save(resized_path, 'PNG')
                input_path = resized_path

            # 执行放大
            output_path = os.path.join(tmp_dir, f'output.{output_format}')
            run_upscayl(input_path, output_path, model_name, scale, tile_size, compression)

            # 读取结果尺寸
            with Image.open(output_path) as img:
                result_width, result_height = img.size

            # 保存到输出目录
            output_dir = CONFIG['output_dir']
            os.makedirs(output_dir, exist_ok=True)
            output_filename = f'upscayl_{int(time.time())}_{model_name}_{scale}x.{output_format}'
            final_path = os.path.join(output_dir, output_filename)
            os.rename(output_path, final_path)

            return jsonify({
                'success': True,
                'image_url': f'/outputs/{output_filename}',
                'original_size': {'width': orig_width, 'height': orig_height},
                'upscaled_size': {'width': result_width, 'height': result_height},
                'model': model_name,
                'scale': scale,
            })
        finally:
            import shutil
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': '放大超时，请重试'}), 504
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/outputs/<path:filename>', methods=['GET'])
def serve_output(filename):
    return send_from_directory(CONFIG['output_dir'], filename)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Upscayl Real-ESRGAN 无损放大服务')
    parser.add_argument('--port', type=int, default=8100, help='服务端口 (默认 8100)')
    parser.add_argument('--bin', type=str, default='', help='upscayl-ncnn 二进制路径')
    parser.add_argument('--models', type=str, default='', help='模型目录路径')
    parser.add_argument('--output', type=str, default='/tmp/upscayl-outputs', help='输出目录')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='监听地址')
    parser.add_argument('--max-dim', type=int, default=2048, help='最大输入尺寸')
    args = parser.parse_args()

    CONFIG['bin_path'] = args.bin
    CONFIG['models_path'] = args.models
    CONFIG['output_dir'] = args.output
    CONFIG['max_input_dim'] = args.max_dim

    print(f'Upscayl Server starting on {args.host}:{args.port}')
    print(f'  Binary: {args.bin or "(not configured)"}')
    print(f'  Models: {args.models or "(not configured)"}')
    print(f'  Output: {args.output}')

    available = get_available_models()
    print(f'  Available models: {available if available else "(none)"}')

    app.run(host=args.host, port=args.port, debug=False)
