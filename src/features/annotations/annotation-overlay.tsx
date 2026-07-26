'use client';

import type { CSSProperties } from 'react';

import type { CanvasAnnotationV2, NormalizedPoint } from './annotation-types';
import type { AnnotationGesture } from './use-annotation-controller';

export interface AnnotationImageBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnnotationOverlayProps {
  annotations: CanvasAnnotationV2[];
  images: AnnotationImageBounds[];
  zoom: number;
  viewOffset: { x: number; y: number };
  gesture?: AnnotationGesture;
  viewportOrigin?: { x: number; y: number };
  brushSize?: number;
  brushScreenWidths?: Record<string, number>;
  selectedAnnotationId?: string | null;
  className?: string;
  style?: CSSProperties;
}

function screenPoint(
  point: NormalizedPoint,
  image: AnnotationImageBounds,
  zoom: number,
  viewOffset: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (image.x + point.x * image.width) * zoom + viewOffset.x,
    y: (image.y + point.y * image.height) * zoom + viewOffset.y,
  };
}

export function AnnotationOverlay({
  annotations,
  images,
  zoom,
  viewOffset,
  gesture = { kind: 'idle' },
  viewportOrigin = { x: 0, y: 0 },
  brushSize = 12,
  brushScreenWidths = {},
  selectedAnnotationId = null,
  className = '',
  style,
}: AnnotationOverlayProps) {
  const imageById = new Map(images.map((image) => [image.id, image]));

  return (
    <svg
      className={`pointer-events-none absolute inset-0 z-40 h-full w-full overflow-visible ${className}`}
      style={style}
      aria-hidden="true"
      data-testid="annotation-overlay"
    >
      <defs>
        <marker
          id="annotation-arrow-head"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>

      {(gesture.kind === 'region' || gesture.kind === 'arrow') && (() => {
        const start = {
          x: gesture.start.x - viewportOrigin.x,
          y: gesture.start.y - viewportOrigin.y,
        };
        const current = {
          x: gesture.current.x - viewportOrigin.x,
          y: gesture.current.y - viewportOrigin.y,
        };

        if (gesture.kind === 'arrow') {
          return (
            <line
              data-annotation-kind="draft-arrow"
              x1={start.x}
              y1={start.y}
              x2={current.x}
              y2={current.y}
              stroke="#3fb950"
              strokeWidth={3}
              strokeLinecap="round"
              markerEnd="url(#annotation-arrow-head)"
            />
          );
        }

        return (
          <rect
            data-annotation-kind="draft-region"
            x={Math.min(start.x, current.x)}
            y={Math.min(start.y, current.y)}
            width={Math.abs(current.x - start.x)}
            height={Math.abs(current.y - start.y)}
            rx={4}
            fill="#58a6ff14"
            stroke="#58a6ff"
            strokeWidth={2}
            strokeDasharray="7 5"
          />
        );
      })()}

      {gesture.kind === 'brush' && (
        <polyline
          data-annotation-kind="draft-brush"
          points={gesture.points
            .map((point) => (
              `${point.x - viewportOrigin.x},${point.y - viewportOrigin.y}`
            ))
            .join(' ')}
          fill="none"
          stroke="#f0883e"
          strokeWidth={Math.max(3, brushSize)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.92}
        />
      )}

      {(gesture.kind === 'text' || gesture.kind === 'semantic-object') && (
        <circle
          data-annotation-kind={`draft-${gesture.kind}`}
          cx={gesture.point.x - viewportOrigin.x}
          cy={gesture.point.y - viewportOrigin.y}
          r={7}
          fill="#0d1117"
          stroke={gesture.kind === 'semantic-object' ? '#d4af37' : '#e6edf3'}
          strokeWidth={2}
        />
      )}

      {annotations.map((annotation, index) => {
        const image = imageById.get(annotation.sourceImageId);
        if (!image) return null;
        const selected = annotation.id === selectedAnnotationId;
        const strokeWidth = selected ? 3 : 2;
        const geometry = annotation.geometry;

        if (geometry.kind === 'region' || geometry.kind === 'semantic-object') {
          const region = geometry.region;
          const x = (image.x + region.x * image.width) * zoom + viewOffset.x;
          const y = (image.y + region.y * image.height) * zoom + viewOffset.y;
          const width = region.w * image.width * zoom;
          const height = region.h * image.height * zoom;
          const semantic = geometry.kind === 'semantic-object';
          const color = semantic ? '#d4af37' : '#58a6ff';
          return (
            <g
              key={annotation.id}
              data-annotation-kind={geometry.kind}
              data-annotation-id={annotation.id}
            >
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={4}
                fill={`${color}14`}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={semantic ? undefined : '7 5'}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={x + 5}
                y={Math.max(14, y - 7)}
                fill={color}
                fontSize={12}
                fontWeight={600}
                paintOrder="stroke"
                stroke="#0d1117"
                strokeWidth={3}
              >
                {semantic ? `@${annotation.label || `对象${index + 1}`}` : `区域 ${index + 1}`}
              </text>
            </g>
          );
        }

        if (geometry.kind === 'brush') {
          const points = geometry.points
            .map((point) => screenPoint(point, image, zoom, viewOffset))
            .map((point) => `${point.x},${point.y}`)
            .join(' ');
          const width = Math.max(
            3,
            brushScreenWidths[annotation.id]
              ?? geometry.width * Math.min(image.width, image.height),
          );
          return (
            <polyline
              key={annotation.id}
              data-annotation-kind="brush"
              data-annotation-id={annotation.id}
              points={points}
              fill="none"
              stroke={selected ? '#f5f5f5' : '#f0883e'}
              strokeWidth={width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.92}
            />
          );
        }

        if (geometry.kind === 'arrow') {
          const start = screenPoint(geometry.start, image, zoom, viewOffset);
          const end = screenPoint(geometry.end, image, zoom, viewOffset);
          return (
            <g
              key={annotation.id}
              data-annotation-kind="arrow"
              data-annotation-id={annotation.id}
            >
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={selected ? '#f5f5f5' : '#3fb950'}
                strokeWidth={strokeWidth + 1}
                strokeLinecap="round"
                markerEnd="url(#annotation-arrow-head)"
              />
              <text
                x={start.x + 5}
                y={start.y - 7}
                fill="#3fb950"
                fontSize={12}
                fontWeight={600}
                paintOrder="stroke"
                stroke="#0d1117"
                strokeWidth={3}
              >
                {annotation.instruction || `箭头 ${index + 1}`}
              </text>
            </g>
          );
        }

        const point = screenPoint(geometry.point, image, zoom, viewOffset);
        return (
          <g
            key={annotation.id}
            data-annotation-kind="text"
            data-annotation-id={annotation.id}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={selected ? 7 : 6}
              fill="#0d1117"
              stroke="#e6edf3"
              strokeWidth={2}
            />
            <text
              x={point.x + 10}
              y={point.y + 4}
              fill="#e6edf3"
              fontSize={12}
              fontWeight={600}
              paintOrder="stroke"
              stroke="#0d1117"
              strokeWidth={3}
            >
              {annotation.instruction || `文字 ${index + 1}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
