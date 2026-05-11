#!/usr/bin/env python3
"""
Lightweight Inpainting Server v2.1
API compatible with IOPaint for seamless integration.

Implements fast boundary-propagation inpainting using vectorized numpy operations.
"""

import base64
import os
import sys
import time
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from loguru import logger

app = FastAPI(title="Inpainting Server", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InpaintRequest(BaseModel):
    image: str
    mask: str
    config: Optional[dict] = None
    prompt: Optional[str] = None


def decode_base64_image(data: str) -> np.ndarray:
    if "," in data:
        data = data.split(",", 1)[1]
    img_bytes = base64.b64decode(data)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image")
    return img


def decode_base64_mask(data: str) -> np.ndarray:
    if "," in data:
        data = data.split(",", 1)[1]
    img_bytes = base64.b64decode(data)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    mask = cv2.imdecode(img_array, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise ValueError("Failed to decode mask")
    return mask


def encode_image_base64(img: np.ndarray) -> str:
    _, buffer = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    return base64.b64encode(buffer).decode("utf-8")


def inpaint_fast_propagation(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """
    Fast boundary-propagation inpainting using vectorized numpy operations.
    
    Instead of processing pixels one by one, we process entire "bands" of 
    boundary pixels at once using convolution. This is orders of magnitude faster.
    
    Algorithm:
    1. Find boundary of mask (masked pixels adjacent to known pixels)
    2. Fill boundary pixels using weighted average of known neighbors (vectorized)
    3. Mark boundary as known, repeat
    4. Final OpenCV inpaint pass for smoothing
    """
    _, binary_mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
    
    h, w = image.shape[:2]
    result = image.copy().astype(np.float32)
    
    # Known pixel map
    known = (binary_mask == 0)
    to_fill = (binary_mask > 0)
    
    total_to_fill = np.sum(to_fill)
    if total_to_fill == 0:
        return image
    
    logger.info(f"Fast propagation: {total_to_fill} pixels to fill ({total_to_fill/(h*w)*100:.1f}%)")
    
    # Precompute: normalized convolution kernel for 8-connected neighbors
    # Weight: closer neighbors get higher weight (1/dist^2)
    kernel_weights = np.array([
        [0.5, 1.0, 0.5],
        [1.0, 0.0, 1.0],
        [0.5, 1.0, 0.5]
    ], dtype=np.float32)
    
    filled_count = 0
    iteration = 0
    max_iterations = max(h, w)
    
    while True:
        iteration += 1
        if iteration > max_iterations:
            break
        
        # Find boundary: masked pixels that have at least one known 8-neighbor
        # Vectorized: dilate known mask and intersect with to_fill
        known_u8 = known.astype(np.uint8)
        # Count known neighbors for each pixel
        known_count = cv2.filter2D(known_u8, -1, (kernel_weights > 0).astype(np.float32))
        
        # Boundary = to_fill pixels with at least 1 known neighbor
        boundary = to_fill & (known_count > 0)
        boundary_count = np.sum(boundary)
        
        if boundary_count == 0:
            break
        
        # Vectorized fill: for each boundary pixel, compute weighted average of known neighbors
        # Use convolution to sum known pixel values, weighted by distance
        known_float = known.astype(np.float32)
        
        # For each channel, compute weighted sum of known neighbors
        for c in range(3):
            channel = result[:, :, c]
            # Weighted sum of all neighbors
            weighted_sum = cv2.filter2D(channel * known_float, -1, kernel_weights)
            # Sum of weights for known neighbors
            weight_sum = cv2.filter2D(known_float, -1, kernel_weights)
            
            # Fill boundary pixels
            valid = boundary & (weight_sum > 0)
            result[valid, c] = weighted_sum[valid] / weight_sum[valid]
        
        # Mark boundary as known
        known[boundary] = True
        filled_count += boundary_count
        
        if iteration % 50 == 0 or boundary_count < 100:
            logger.info(f"  Iter {iteration}: filled {boundary_count} (total: {filled_count}/{total_to_fill})")
    
    logger.info(f"Propagation done: filled {filled_count}/{total_to_fill} in {iteration} iters")
    
    # Final smoothing: OpenCV inpaint on any remaining gaps + edge refinement
    remaining_mask = (~known).astype(np.uint8) * 255
    if np.sum(remaining_mask > 0) > 0:
        result_u8 = np.clip(result, 0, 255).astype(np.uint8)
        result_u8 = cv2.inpaint(result_u8, remaining_mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
        result = result_u8.astype(np.float32)
    
    # Edge smoothing: slight Gaussian blur on the filled region only
    result_u8 = np.clip(result, 0, 255).astype(np.uint8)
    blurred = cv2.GaussianBlur(result_u8, (5, 5), sigmaX=1.5)
    
    # Create smooth transition mask: 1 inside filled region, feathered at edges
    fill_dist = cv2.distanceTransform(binary_mask, cv2.DIST_L2, 5)
    feather_width = 8.0
    feather_mask = np.clip(fill_dist / feather_width, 0, 1)
    feather_mask_3ch = np.stack([feather_mask] * 3, axis=-1)
    
    result_final = (result_u8.astype(np.float32) * (1 - feather_mask_3ch) + 
                   blurred.astype(np.float32) * feather_mask_3ch)
    
    # Restore non-masked pixels
    non_mask_3ch = np.stack([~to_fill] * 3, axis=-1)
    result_final[non_mask_3ch] = image[non_mask_3ch].astype(np.float32)
    
    return np.clip(result_final, 0, 255).astype(np.uint8)


def inpaint_full(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """
    Full inpainting pipeline:
    1. Fast boundary propagation for initial fill
    2. Texture refinement (add noise for realism)
    3. Seamless cloning for integration
    """
    _, binary_mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
    h, w = image.shape[:2]
    total_pixels = h * w
    mask_pixels = np.sum(binary_mask > 0)
    mask_ratio = mask_pixels / total_pixels
    
    logger.info(f"Full inpaint: {w}x{h}, mask {mask_ratio*100:.1f}%")
    
    if mask_ratio < 0.03:
        # Very small: just OpenCV Telea
        logger.info("Small mask: using OpenCV Telea")
        result = cv2.inpaint(image, binary_mask, inpaintRadius=7, flags=cv2.INPAINT_TELEA)
        return result
    
    # Step 1: Boundary propagation
    result = inpaint_fast_propagation(image, mask)
    
    # Step 2: Add texture noise for realism (for larger masks)
    if mask_ratio > 0.05:
        to_fill = (binary_mask > 0)
        
        # Estimate texture complexity from boundary
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
        grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        grad_mag = np.sqrt(grad_x**2 + grad_y**2)
        
        # Average gradient near mask boundary
        boundary_region = cv2.dilate(to_fill.astype(np.uint8), np.ones((11, 11), np.uint8)) & \
                         cv2.erode((~to_fill).astype(np.uint8), np.ones((5, 5), np.uint8))
        
        if np.sum(boundary_region) > 0:
            avg_grad = np.mean(grad_mag[boundary_region > 0])
        else:
            avg_grad = np.mean(grad_mag[~to_fill])
        
        noise_strength = min(avg_grad * 0.15, 8)
        if noise_strength > 0.5:
            noise = np.random.normal(0, noise_strength, result.shape).astype(np.float32)
            noise_mask = np.stack([to_fill] * 3, axis=-1).astype(np.float32)
            # Smooth the noise to avoid salt-and-pepper look
            for c in range(3):
                noise[:,:,c] = cv2.GaussianBlur(noise[:,:,c], (3,3), sigmaX=0.5)
            result = np.clip(result.astype(np.float32) + noise * noise_mask, 0, 255).astype(np.uint8)
            # Restore non-masked pixels
            non_mask_3ch = np.stack([~to_fill] * 3, axis=-1)
            result[non_mask_3ch] = image[non_mask_3ch]
    
    # Step 3: Seamless cloning for smooth boundary integration
    if mask_ratio > 0.02:
        to_fill = (binary_mask > 0)
        try:
            # Create a clean blend mask
            blend_mask = cv2.GaussianBlur(binary_mask, (0, 0), sigmaX=4)
            _, blend_mask = cv2.threshold(blend_mask, 30, 255, cv2.THRESH_BINARY)
            
            moments = cv2.moments(blend_mask)
            if moments["m00"] > 0:
                cx = int(moments["m10"] / moments["m00"])
                cy = int(moments["m01"] / moments["m00"])
                
                cloned = cv2.seamlessClone(result, image, blend_mask, (cx, cy), cv2.NORMAL_CLONE)
                
                # Blend: only in the masked region with feathering
                fill_dist = cv2.distanceTransform(binary_mask, cv2.DIST_L2, 5)
                feather = np.clip(fill_dist / 10.0, 0, 1)
                feather_3ch = np.stack([feather] * 3, axis=-1).astype(np.float32)
                
                result = (image.astype(np.float32) * (1 - feather_3ch) + 
                         cloned.astype(np.float32) * feather_3ch).astype(np.uint8)
        except cv2.error as e:
            logger.warning(f"Seamless clone failed (non-fatal): {e}")
    
    return result


@app.post("/api/v1/inpaint")
async def api_inpaint(request: InpaintRequest):
    """Inpaint endpoint compatible with IOPaint API format."""
    start_time = time.time()
    
    try:
        image = decode_base64_image(request.image)
        mask = decode_base64_mask(request.mask)
        
        logger.info(f"Inpaint request: image={image.shape}, mask={mask.shape}")
        
        if image.shape[:2] != mask.shape:
            raise HTTPException(
                status_code=400,
                detail=f"Image and mask dimensions don't match: {image.shape[:2]} vs {mask.shape}"
            )
        
        config = request.config or {}
        method = config.get("method", "full")
        hd_strategy = config.get("hd_strategy", "Original")
        
        # HD Strategy for large images
        original_h, original_w = image.shape[:2]
        MAX_DIM = 1536
        
        working_image = image
        working_mask = mask
        crop_info = None
        
        if hd_strategy == "Crop" and (original_w > MAX_DIM or original_h > MAX_DIM):
            mask_coords = np.where(mask > 127)
            if len(mask_coords[0]) > 0:
                margin = config.get("hd_strategy_crop_margin", 128)
                crop_trigger = config.get("hd_strategy_crop_trigger_size", 512)
                
                y_min = max(0, np.min(mask_coords[0]) - margin)
                y_max = min(original_h, np.max(mask_coords[0]) + margin)
                x_min = max(0, np.min(mask_coords[1]) - margin)
                x_max = min(original_w, np.max(mask_coords[1]) + margin)
                
                if y_max - y_min < crop_trigger:
                    center_y = (y_min + y_max) // 2
                    y_min = max(0, center_y - crop_trigger // 2)
                    y_max = min(original_h, y_min + crop_trigger)
                if x_max - x_min < crop_trigger:
                    center_x = (x_min + x_max) // 2
                    x_min = max(0, center_x - crop_trigger // 2)
                    x_max = min(original_w, x_min + crop_trigger)
                
                working_image = image[y_min:y_max, x_min:x_max]
                working_mask = mask[y_min:y_max, x_min:x_max]
                crop_info = (y_min, y_max, x_min, x_max)
                logger.info(f"HD Crop: ({y_min},{x_min})-({y_max},{x_max})")
        elif hd_strategy == "Resize" and (original_w > MAX_DIM or original_h > MAX_DIM):
            resize_limit = config.get("hd_strategy_resize_limit", 768)
            scale = min(resize_limit / original_w, resize_limit / original_h)
            new_w, new_h = int(original_w * scale), int(original_h * scale)
            working_image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
            working_mask = cv2.resize(mask, (new_w, new_h), interpolation=cv2.INTER_NEAREST)
            logger.info(f"HD Resize: {original_w}x{original_h} -> {new_w}x{new_h}")
        
        # Run inpainting
        if method in ("full", "hybrid"):
            result = inpaint_full(working_image, working_mask)
        elif method == "propagation":
            result = inpaint_fast_propagation(working_image, working_mask)
        elif method == "telea":
            _, bm = cv2.threshold(working_mask, 127, 255, cv2.THRESH_BINARY)
            result = cv2.inpaint(working_image, bm, inpaintRadius=7, flags=cv2.INPAINT_TELEA)
        elif method in ("ns", "navier-stokes"):
            _, bm = cv2.threshold(working_mask, 127, 255, cv2.THRESH_BINARY)
            result = cv2.inpaint(working_image, bm, inpaintRadius=7, flags=cv2.INPAINT_NS)
        else:
            result = inpaint_full(working_image, working_mask)
        
        # Composite back if we cropped/resized
        if crop_info is not None:
            y_min, y_max, x_min, x_max = crop_info
            final = image.copy()
            crop_h, crop_w = result.shape[:2]
            
            # Feather blend at crop edges
            blend = np.ones((crop_h, crop_w, 3), dtype=np.float32)
            feather = 16
            for i in range(feather):
                alpha = i / feather
                if i < crop_h:
                    blend[i, :, :] = np.minimum(blend[i, :, :], alpha)
                    blend[crop_h - 1 - i, :, :] = np.minimum(blend[crop_h - 1 - i, :, :], alpha)
                if i < crop_w:
                    blend[:, i, :] = np.minimum(blend[:, i, :], alpha)
                    blend[:, crop_w - 1 - i, :] = np.minimum(blend[:, crop_w - 1 - i, :], alpha)
            
            final[y_min:y_max, x_min:x_max] = (
                image[y_min:y_max, x_min:x_max].astype(np.float32) * (1 - blend) +
                result.astype(np.float32) * blend
            ).astype(np.uint8)
            result = final
        elif hd_strategy == "Resize" and (original_w > MAX_DIM or original_h > MAX_DIM):
            result_resized = cv2.resize(result, (original_w, original_h), interpolation=cv2.INTER_LINEAR)
            mask_3ch = np.stack([(mask > 127)] * 3, axis=-1).astype(np.float32)
            smooth_mask = cv2.GaussianBlur(mask_3ch, (0, 0), sigmaX=4)
            result = (image.astype(np.float32) * (1 - smooth_mask) +
                     result_resized.astype(np.float32) * smooth_mask).astype(np.uint8)
        
        result_base64 = encode_image_base64(result)
        
        elapsed = time.time() - start_time
        logger.info(f"Inpaint completed in {elapsed:.2f}s")
        
        return {"image": result_base64}
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Inpaint error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/server-config")
async def server_config():
    return {
        "model": "boundary-propagation-inpaint",
        "device": "cpu",
        "plugins": [],
        "is_lama_available": False,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "model": "boundary-propagation-inpaint"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("INPAINT_PORT", 8080))
    host = os.environ.get("INPAINT_HOST", "0.0.0.0")
    logger.info(f"Starting inpainting server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")
