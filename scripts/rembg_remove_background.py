#!/usr/bin/env python3
import base64
import io
import json
import os
import sys


ALLOWED_MODELS = {
    'birefnet-general',
    'birefnet-portrait',
    'birefnet-massive',
}
DEFAULT_MODEL = 'birefnet-general'


def emit(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


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

        from PIL import Image
        from rembg import new_session, remove

        source = Image.open(io.BytesIO(base64.b64decode(image_base64))).convert('RGBA')
        session = new_session(model_name)
        result = remove(
            source,
            session=session,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=10,
        ).convert('RGBA')

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
