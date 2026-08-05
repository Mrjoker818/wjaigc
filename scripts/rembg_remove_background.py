#!/usr/bin/env python3
import base64
import io
import json
import os
import sys

# 6 vCPU 部署下限制 onnxruntime 推理线程，避免抢占 Web 服务算力。
os.environ.setdefault("OMP_NUM_THREADS", "4")

ALLOWED_MODELS = {
    'birefnet-general-lite',
    'birefnet-general',
    'birefnet-portrait',
    'birefnet-massive',
}
DEFAULT_MODEL = 'birefnet-general-lite'
MAX_PROCESSING_EDGE = 2048


def emit(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def resize_for_processing(source):
    width, height = source.size
    longest_edge = max(width, height)
    if longest_edge <= MAX_PROCESSING_EDGE:
        return source
    scale = MAX_PROCESSING_EDGE / longest_edge
    return source.resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.Resampling.LANCZOS,
    )


def main():
    try:
        payload = json.load(sys.stdin)
        image_base64 = payload.get('image', '')
        model_name = payload.get('model', DEFAULT_MODEL)
        if not image_base64:
            raise ValueError('image is required')
        if model_name not in ALLOWED_MODELS:
            raise ValueError(f'unsupported rembg model: {model_name}')

        models_dir = os.environ.get('REMOVEBG_MODELS_DIR') or os.environ.get('U2NET_HOME')
        if models_dir:
            os.makedirs(models_dir, exist_ok=True)
            os.environ['U2NET_HOME'] = models_dir

        import glob
        from PIL import Image
        from rembg import new_session, remove

        # 优先精确文件名（大小写不敏感），其次兼容 epoch 后缀（如 BiRefNet-general-epoch_244.onnx）
        model_path = None
        if models_dir:
            exact = os.path.join(models_dir, f'{model_name}.onnx')
            if os.path.isfile(exact):
                model_path = exact
            else:
                matches = []
                try:
                    for f in os.listdir(models_dir):
                        if f.lower().startswith(f'{model_name.lower()}-') and f.lower().endswith('.onnx'):
                            matches.append(os.path.join(models_dir, f))
                except Exception:
                    matches = []
                if matches:
                    model_path = sorted(matches)[0]

        source = Image.open(io.BytesIO(base64.b64decode(image_base64))).convert('RGBA')
        original_size = source.size
        processing_source = resize_for_processing(source)
        session = new_session(model_name, model_path) if model_path else new_session(model_name)
        result = remove(
            processing_source,
            session=session,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=10,
        ).convert('RGBA')
        if result.size != original_size:
            result = result.resize(original_size, Image.Resampling.LANCZOS)

        rgba = io.BytesIO()
        result.save(rgba, format='PNG')
        mask = io.BytesIO()
        result.getchannel('A').save(mask, format='PNG')
        emit({
            'success': True,
            'model': model_name,
            'rgbaBase64': base64.b64encode(rgba.getvalue()).decode('ascii'),
            'maskBase64': base64.b64encode(mask.getvalue()).decode('ascii'),
        })
    except Exception as error:
        emit({'success': False, 'error': str(error)})


if __name__ == '__main__':
    main()
