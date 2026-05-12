import type { DesignDocument, LayerNode, SceneGraph } from '@/types/designGraph';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportDesignDocument(document: DesignDocument) {
  downloadTextFile(`${document.name || 'wujie-design'}.wujie`, JSON.stringify(document, null, 2), 'application/json;charset=utf-8');
}

function layerToSvg(layer: LayerNode) {
  if (!layer.visible) return '';
  const opacity = Math.max(0, Math.min(1, layer.opacity ?? 1));
  const transform = `translate(${layer.bbox.x} ${layer.bbox.y}) rotate(${layer.transform?.rotation || 0})`;

  if (layer.svg) {
    return `<g id="${escapeXml(layer.id)}" data-name="${escapeXml(layer.name)}" opacity="${opacity}" transform="${transform}">${layer.svg}</g>`;
  }

  if (layer.imageUrl) {
    return `<image id="${escapeXml(layer.id)}" data-name="${escapeXml(layer.name)}" href="${escapeXml(layer.imageUrl)}" x="${layer.bbox.x}" y="${layer.bbox.y}" width="${layer.bbox.width}" height="${layer.bbox.height}" opacity="${opacity}" preserveAspectRatio="xMidYMid meet" />`;
  }

  if (layer.type === 'text') {
    return `<text id="${escapeXml(layer.id)}" x="${layer.bbox.x}" y="${layer.bbox.y}" opacity="${opacity}" fill="${escapeXml(layer.fill || '#ffffff')}" font-family="${escapeXml(layer.fontFamily || 'sans-serif')}">${escapeXml(layer.text || layer.name)}</text>`;
  }

  return '';
}

export function sceneToSvg(scene: SceneGraph) {
  const layers = [...scene.layers].sort((a, b) => a.zIndex - b.zIndex).map(layerToSvg).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">
<rect width="100%" height="100%" fill="${escapeXml(scene.background || 'transparent')}" />
${layers}
</svg>`;
}

export function exportSceneAsSvg(scene: SceneGraph, filename = 'wujie-layer-graph.svg') {
  downloadTextFile(filename, sceneToSvg(scene), 'image/svg+xml;charset=utf-8');
}

export async function importWujieDocument(file: File): Promise<DesignDocument> {
  const text = await file.text();
  const trimmed = text.trim();
  let jsonText: string;
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    const match = trimmed.match(/<script\s+id="wujie-project-data"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    if (!match || !match[1]) {
      throw new Error('不是有效的 .wujie 文件：未找到嵌入数据');
    }
    jsonText = match[1].replace(/<\\\//g, '</');
  } else {
    jsonText = trimmed;
  }
  const doc = JSON.parse(jsonText) as DesignDocument;
  if (doc.schema !== 'wujie.design.v1') {
    throw new Error('不是有效的 .wujie 设计工程文件');
  }
  return doc;
}
