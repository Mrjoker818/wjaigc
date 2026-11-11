#!/usr/bin/env python3
"""CPU-only, tiled Real-ESRGAN x4 worker for server-owned PNG files."""

import hashlib
import json
import os
from pathlib import Path
import re
import sys

MODEL = "realesrgan-x4plus"
MAX_INPUT_EDGE = 1024
MAX_MODEL_BYTES = 128 * 1024 * 1024
TILE_SIZE = 256
OVERLAP = 32


def load_model():
    if os.environ.get("LOCAL_AI_ENABLED") != "true":
        raise ValueError("local inference is disabled")
    digest = os.environ.get("ONNX_MODEL_SHA256", "").lower()
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("missing trusted model SHA-256")
    checkpoint = Path(os.environ["ONNX_MODELS_DIR"]) / f"{MODEL}.onnx"
    with checkpoint.open("rb") as file:
        model = file.read(MAX_MODEL_BYTES + 1)
    if not model or len(model) > MAX_MODEL_BYTES or hashlib.sha256(model).hexdigest() != digest:
        raise ValueError("model size or SHA-256 verification failed")

    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    # Pass the verified bytes so the runtime cannot reopen a changed checkpoint.
    session = ort.InferenceSession(model, sess_options=options, providers=["CPUExecutionProvider"])
    inputs = session.get_inputs()
    if len(inputs) != 1 or inputs[0].type != "tensor(float)":
        raise ValueError("expected a single FP32 input")
    return session, inputs[0].name


def upscale(image, session, input_name):
    import numpy as np
    from PIL import Image

    width, height = image.size
    output = Image.new("RGB", (width * 4, height * 4))
    for top in range(0, height, TILE_SIZE):
        for left in range(0, width, TILE_SIZE):
            right, bottom = min(left + TILE_SIZE, width), min(top + TILE_SIZE, height)
            x, y = max(0, left - OVERLAP), max(0, top - OVERLAP)
            tile = image.crop((x, y, min(width, right + OVERLAP), min(height, bottom + OVERLAP)))
            tensor = np.asarray(tile, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
            prediction = session.run(None, {input_name: tensor})[0]
            if prediction.shape != (1, 3, tile.height * 4, tile.width * 4):
                raise ValueError("model output has unexpected dimensions")
            if not np.isfinite(prediction).all():
                raise ValueError("model output contains invalid pixels")
            pixels = np.clip(prediction[0].transpose(1, 2, 0) * 255.0, 0, 255).astype(np.uint8)
            core = Image.fromarray(pixels).crop(
                ((left - x) * 4, (top - y) * 4, (right - x) * 4, (bottom - y) * 4)
            )
            output.paste(core, (left * 4, top * 4))
    return output


def main():
    session, input_name = load_model()
    from PIL import Image

    if sys.argv[1:] == ["--check"]:
        upscale(Image.new("RGB", (64, 64)), session, input_name)
        return {"success": True, "model": MODEL}

    job = json.loads(sys.stdin.read(32 * 1024))
    if job.get("model") != MODEL or job.get("scale") != 4:
        raise ValueError("expected the configured x4 model")
    with Image.open(job["inputFile"], formats=["PNG"]) as source:
        if max(source.size) > MAX_INPUT_EDGE:
            raise ValueError("input exceeds the supported dimensions")
        output = upscale(source.convert("RGB"), session, input_name)
    with open(job["outputFile"], "xb") as file:
        output.save(file, format="PNG")
    return {"success": True, "model": MODEL, "outputFile": job["outputFile"]}


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)[:300]}))
        sys.exit(1)
