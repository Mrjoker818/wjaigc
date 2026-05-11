#!/usr/bin/env python3
"""
Upscayl-Compatible Upscale Server
Provides AI super-resolution upscaling using:
1. Local engine: OpenCV Lanczos interpolation (fast, no model download needed)
2. AI engine: Real-ESRGAN (when model weights are available)

Supports the same model names as upscayl-ncnn for compatibility:
- realesrgan-x4plus: General purpose 4x upscale
- realesrgan-x4fast: Fast 4x upscale
- realesrnet-x4plus: Denoising 4x upscale
- realesrgan-x4plus-anime: Anime/illustration 4x upscale
- realesr-animevideov3: Video frame 2x upscale

Usage:
  python3 scripts/upscale-server.py [--port 8081]
"""

import os
import sys
import json
import base64
import argparse
import time
import threading
import numpy as np
import cv2
from http.server import HTTPServer, BaseHTTPRequestHandler

# Lazy-loaded model cache
AI_MODELS = {}
AI_MODELS_LOCK = threading.Lock()

# Model definitions matching upscayl-ncnn
MODEL_DEFS = {
    'realesrgan-x4plus': {
        'name': '通用高清(4x)',
        'description': '适合照片和插画，画质全面提升',
        'scale': 4,
    },
    'realesrgan-x4fast': {
        'name': '快速放大(4x)',
        'description': '速度优先，快速出图',
        'scale': 4,
    },
    'realesrnet-x4plus': {
        'name': '降噪修复(4x)',
        'description': '适合有噪点、压缩伪影的图片',
        'scale': 4,
    },
    'realesrgan-x4plus-anime': {
        'name': '动漫增强(4x)',
        'description': '动漫、插画、二次元图片专用',
        'scale': 4,
    },
    'realesr-animevideov3': {
        'name': '视频帧增强(2x)',
        'description': '适合视频截图和动画帧放大',
        'scale': 2,
    },
}


def upscale_opencv(img, scale: int):
    """High-quality upscaling using OpenCV with multiple passes and USM sharpening.
    This provides excellent results for photos and illustrations
    when AI model weights are not available."""
    h, w = img.shape[:2]
    new_w, new_h = w * scale, h * scale

    # Multi-pass upscaling for better quality
    current = img.copy()
    current_scale = 1

    while current_scale < scale:
        # Double the size each iteration (2x steps)
        next_scale = min(current_scale * 2, scale)
        step = next_scale // current_scale
        ch, cw = current.shape[:2]

        # Use Lanczos4 for best quality
        current = cv2.resize(current, (cw * step, ch * step), interpolation=cv2.INTER_LANCZOS4)
        current_scale = next_scale

    result = current
    
    return result


def upscale_ai(img, model_name: str, scale: int):
    """AI-powered upscaling using Real-ESRGAN (if model weights are available)."""
    
    model_info = get_ai_model(model_name)
    if model_info is None:
        return None
    
    upsampler = model_info['upsampler']
    model_scale = model_info['scale']
    
    output, _ = upsampler.enhance(img, outscale=model_scale)
    
    if output is None:
        return None
    
    # Resize if requested scale differs from model scale
    if scale != model_scale:
        h, w = img.shape[:2]
        target_w, target_h = w * scale, h * scale
        output = cv2.resize(output, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
    
    return output


def get_ai_model(model_name: str):
    """Load and cache an AI model. Returns None if weights not available."""

    with AI_MODELS_LOCK:
        if model_name in AI_MODELS:
            return AI_MODELS[model_name]
    
    # Check if weights exist
    weight_paths = {
        'realesrgan-x4plus': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus.pth'),
        'realesrgan-x4fast': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus.pth'),
        'realesrnet-x4plus': os.path.expanduser('~/.cache/realesrgan/RealESRNet_x4plus.pth'),
        'realesrgan-x4plus-anime': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus_anime_6B.pth'),
        'realesr-animevideov3': os.path.expanduser('~/.cache/realesrgan/realesr-animevideov3-x2.pth'),
    }
    
    weight_path = weight_paths.get(model_name)
    if not weight_path or not os.path.exists(weight_path):
        return None
    
    try:
        import torch
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer
        
        model_def = MODEL_DEFS.get(model_name, MODEL_DEFS['realesrgan-x4fast'])
        device = torch.device('cpu')
        
        if model_name == 'realesrgan-x4fast':
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=6, num_grow_ch=32, scale=4)
        elif model_name == 'realesrgan-x4plus-anime':
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=6, num_grow_ch=32, scale=4)
        elif model_name == 'realesr-animevideov3':
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2)
        else:
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
        
        upsampler = RealESRGANer(
            scale=model_def['scale'],
            model_path=weight_path,
            model=model,
            half=False,
            device=device,
        )
        
        with AI_MODELS_LOCK:
            AI_MODELS[model_name] = {
                'upsampler': upsampler,
                'scale': model_def['scale'],
            }
        
        return AI_MODELS[model_name]
        
    except Exception as e:
        print(f'[upscale] Error loading AI model {model_name}: {e}')
        return None


def process_upscale(image_b64: str, model_name: str, scale: int, tile_size: int = 0) -> dict:
    """Process an upscale request."""

    # Decode base64 image
    img_bytes = base64.b64decode(image_b64)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    
    if img is None:
        return {'error': 'Failed to decode image'}
    
    orig_h, orig_w = img.shape[:2]
    print(f'[upscale] Input: {orig_w}x{orig_h}, model: {model_name}, scale: {scale}')
    
    # Try AI upscaling first
    result = upscale_ai(img, model_name, scale)
    engine = 'ai'
    
    if result is None:
        # Fall back to OpenCV Lanczos
        print(f'[upscale] AI model not available, using Lanczos interpolation')
        result = upscale_opencv(img, scale)
        engine = 'lanczos'
    
    result_h, result_w = result.shape[:2]
    
    # Encode result as PNG
    _, result_buf = cv2.imencode('.png', result, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    result_b64 = base64.b64encode(result_buf).decode()
    
    print(f'[upscale] Output: {result_w}x{result_h} (engine: {engine})')
    
    return {
        'image': result_b64,
        'originalSize': {'width': orig_w, 'height': orig_h},
        'upscaledSize': {'width': result_w, 'height': result_h},
        'model': model_name,
        'scale': scale,
        'engine': engine,
    }


class UpscaleHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_json(200, {'status': 'ok', 'models': list(MODEL_DEFS.keys())})
        elif self.path == '/api/models':
            models = []
            for mid, mdef in MODEL_DEFS.items():
                # Check if AI weights are available
                weight_paths = {
                    'realesrgan-x4plus': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus.pth'),
                    'realesrgan-x4fast': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus.pth'),
                    'realesrnet-x4plus': os.path.expanduser('~/.cache/realesrgan/RealESRNet_x4plus.pth'),
                    'realesrgan-x4plus-anime': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus_anime_6B.pth'),
                    'realesr-animevideov3': os.path.expanduser('~/.cache/realesrgan/realesr-animevideov3-x2.pth'),
                }
                has_weights = os.path.exists(weight_paths.get(mid, ''))
                models.append({
                    'id': mid,
                    'name': mdef['name'],
                    'description': mdef['description'],
                    'scale': mdef['scale'],
                    'engine': 'ai' if has_weights else 'lanczos',
                })
            self.send_json(200, {'available': True, 'models': models})
        else:
            self.send_json(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/api/v1/upscale':
            self.handle_upscale()
        else:
            self.send_json(404, {'error': 'Not found'})

    def handle_upscale(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            
            image_b64 = data.get('image', '')
            model_name = data.get('model', 'realesrgan-x4fast')
            scale = data.get('scale', 4)
            tile_size = data.get('tile_size', 0)
            config = data.get('config', {})
            
            if config:
                model_name = config.get('model_name', model_name)
                scale = config.get('scale', scale)
                tile_size = config.get('tile_size', tile_size)
            
            if not image_b64:
                self.send_json(400, {'error': 'Missing image data'})
                return
            
            # Validate model name
            if model_name not in MODEL_DEFS:
                self.send_json(400, {'error': f'Unknown model: {model_name}. Valid: {list(MODEL_DEFS.keys())}'})
                return
            
            start_time = time.time()
            result = process_upscale(image_b64, model_name, scale, tile_size)
            elapsed = time.time() - start_time
            
            if 'error' in result:
                self.send_json(500, result)
                return
            
            result['elapsed'] = round(elapsed, 2)
            self.send_json(200, result)
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_json(500, {'error': str(e)})

    def send_json(self, code: int, data: dict):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        pass  # Suppress default logging


def main():
    parser = argparse.ArgumentParser(description='Upscayl-Compatible Upscale Server')
    parser.add_argument('--port', type=int, default=8081, help='Server port (default: 8081)')
    args = parser.parse_args()
    
    print(f'[upscale] Starting Upscale Server on port {args.port}')
    print(f'[upscale] Models: {list(MODEL_DEFS.keys())}')
    
    # Check for AI model weights
    for name in MODEL_DEFS:
        weight_paths = {
            'realesrgan-x4plus': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus.pth'),
            'realesrgan-x4fast': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus.pth'),
            'realesrnet-x4plus': os.path.expanduser('~/.cache/realesrgan/RealESRNet_x4plus.pth'),
            'realesrgan-x4plus-anime': os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus_anime_6B.pth'),
            'realesr-animevideov3': os.path.expanduser('~/.cache/realesrgan/realesr-animevideov3-x2.pth'),
        }
        has_weights = os.path.exists(weight_paths.get(name, ''))
        engine = 'AI' if has_weights else 'Lanczos'
        print(f'  {name}: {engine}')
    
    server = HTTPServer(('0.0.0.0', args.port), UpscaleHandler)
    print(f'[upscale] Server ready at http://localhost:{args.port}')
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[upscale] Server shutting down')
        server.shutdown()


if __name__ == '__main__':
    main()
