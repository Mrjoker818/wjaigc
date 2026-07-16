'use client';

import React, { useEffect, useRef } from 'react';

interface MultiAngleSpherePreviewProps {
  imageUrl: string;
  rotation: number;
  tilt: number;
  zoom: number;
  isMonochrome: boolean;
}

export function MultiAngleSpherePreview({
  imageUrl,
  rotation,
  tilt,
  zoom,
  isMonochrome,
}: MultiAngleSpherePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgDataRef = useRef<ImageData | null>(null);
  const imgLoadingRef = useRef(false);

  useEffect(() => {
    if (imgLoadingRef.current) return;
    imgLoadingRef.current = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxDim = 256;
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const width = Math.floor(img.width * scale);
      const height = Math.floor(img.height * scale);
      const offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const context = offscreen.getContext('2d');
      if (!context) {
        imgLoadingRef.current = false;
        return;
      }
      context.drawImage(img, 0, 0, width, height);
      try {
        imgDataRef.current = context.getImageData(0, 0, width, height);
      } catch {
        imgDataRef.current = null;
      }
      imgLoadingRef.current = false;
    };
    img.onerror = () => {
      imgLoadingRef.current = false;
    };
    img.src = imageUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
      imgLoadingRef.current = false;
    };
  }, [imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    const radius = Math.min(width, height) * 0.38;
    context.clearRect(0, 0, width, height);
    context.fillStyle = isMonochrome ? '#f9fafb' : '#0d0d0d';
    context.fillRect(0, 0, width, height);

    const imageData = imgDataRef.current;
    const yaw = (rotation / 90) * Math.PI * 0.5;
    const pitch = -(tilt / 90) * Math.PI * 0.5;
    const cameraDistance = 2.5 / (zoom === 0 ? 0.7 : zoom === 2 ? 1.5 : 1.0);
    void cameraDistance;

    if (!imageData) {
      context.beginPath();
      context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      context.strokeStyle = '#d4af37';
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = isMonochrome ? '#e5e7eb' : '#1a1a1a';
      context.fill();
      context.fillStyle = isMonochrome ? '#9ca3af' : '#555';
      context.font = '11px sans-serif';
      context.textAlign = 'center';
      context.fillText('加载中...', width / 2, height / 2 + 4);
      return;
    }

    const sourceWidth = imageData.width;
    const sourceHeight = imageData.height;
    const source = imageData.data;
    const centerX = width / 2;
    const centerY = height / 2;
    const renderScale = 0.4;
    const renderWidth = Math.floor(width * renderScale);
    const renderHeight = Math.floor(height * renderScale);
    const renderRadius = radius * renderScale;
    const renderCenterX = renderWidth / 2;
    const renderCenterY = renderHeight / 2;
    const outputImage = context.createImageData(renderWidth, renderHeight);
    const output = outputImage.data;
    const radiusSquared = renderRadius * renderRadius;

    for (let pixelY = 0; pixelY < renderHeight; pixelY++) {
      for (let pixelX = 0; pixelX < renderWidth; pixelX++) {
        const deltaX = pixelX - renderCenterX;
        const deltaY = pixelY - renderCenterY;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared > radiusSquared) continue;

        const deltaZ = Math.sqrt(radiusSquared - distanceSquared);
        const normalX = deltaX / renderRadius;
        const normalY = -deltaY / renderRadius;
        const normalZ = deltaZ / renderRadius;
        const cosYaw = Math.cos(-yaw);
        const sinYaw = Math.sin(-yaw);
        const rotatedX = normalX * cosYaw + normalZ * sinYaw;
        const rotatedZ = -normalX * sinYaw + normalZ * cosYaw;
        const cosPitch = Math.cos(-pitch);
        const sinPitch = Math.sin(-pitch);
        const rotatedY = normalY * cosPitch - rotatedZ * sinPitch;
        const finalZ = normalY * sinPitch + rotatedZ * cosPitch;
        const u = Math.atan2(rotatedX, finalZ) / (2 * Math.PI) + 0.5;
        const v = Math.asin(Math.max(-1, Math.min(1, rotatedY))) / Math.PI + 0.5;
        let sourceX = Math.floor(u * sourceWidth);
        const sourceY = Math.floor((1 - v) * sourceHeight);
        if (sourceX < 0) sourceX += sourceWidth;
        if (sourceX >= sourceWidth) sourceX -= sourceWidth;
        const sourceIndex = (Math.min(sourceY, sourceHeight - 1) * sourceWidth + sourceX) * 4;

        const lightDirection = { x: 0.3, y: 0.5, z: 0.8 };
        const lightLength = Math.sqrt(lightDirection.x ** 2 + lightDirection.y ** 2 + lightDirection.z ** 2);
        const diffuse = Math.max(0.15, normalX * lightDirection.x / lightLength + normalY * lightDirection.y / lightLength + normalZ * lightDirection.z / lightLength);
        const outputIndex = (pixelY * renderWidth + pixelX) * 4;
        output[outputIndex] = Math.min(255, Math.round(source[sourceIndex] * diffuse));
        output[outputIndex + 1] = Math.min(255, Math.round(source[sourceIndex + 1] * diffuse));
        output[outputIndex + 2] = Math.min(255, Math.round(source[sourceIndex + 2] * diffuse));
        output[outputIndex + 3] = 255;
      }
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = renderWidth;
    offscreen.height = renderHeight;
    const offscreenContext = offscreen.getContext('2d');
    if (offscreenContext) offscreenContext.putImageData(outputImage, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(offscreen, 0, 0, renderWidth, renderHeight, 0, 0, width, height);

    context.strokeStyle = 'rgba(212,175,55,0.15)';
    context.lineWidth = 1;
    context.beginPath();
    context.ellipse(centerX, centerY, radius, radius * Math.abs(Math.cos(pitch)) * 0.3, 0, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.ellipse(centerX, centerY, radius * Math.abs(Math.cos(yaw)) * 0.3, radius, 0, 0, Math.PI * 2);
    context.stroke();

    const dotX = centerX + Math.sin(yaw) * radius * 0.85;
    const dotY = centerY - Math.sin(pitch) * radius * 0.6;
    context.beginPath();
    context.arc(dotX, dotY, 5, 0, Math.PI * 2);
    context.fillStyle = '#d4af37';
    context.fill();
    context.strokeStyle = 'rgba(212,175,55,0.5)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(dotX, dotY, 10, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(centerX, centerY, radius + 2, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(212,175,55,0.2)';
    context.lineWidth = 1;
    context.stroke();
  }, [imageUrl, rotation, tilt, zoom, isMonochrome]);

  return (
    <div className="w-full h-full flex items-center justify-center relative">
      <canvas ref={canvasRef} width={260} height={196} className="rounded-xl" style={{ width: '100%', height: '100%' }} />
      <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs ${isMonochrome ? 'bg-white/80 text-gray-500 border border-gray-200' : 'bg-black/60 text-muted-foreground border border-white/10'}`}>
        {Math.abs(rotation) < 10 && Math.abs(tilt) < 10 ? '正面' : rotation > 60 ? '左侧' : rotation < -60 ? '右侧' : tilt > 25 ? '俯视' : tilt < -25 ? '仰视' : '斜视'}
      </div>
    </div>
  );
}
