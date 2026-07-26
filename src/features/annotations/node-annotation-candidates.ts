import type {
  WorkflowConnection,
  WorkflowNode,
} from '@/lib/workflow-engine';

import type { EditIntentBundle } from './annotation-types';

export interface NodeAnnotationCanvasImage {
  id: string;
  url: string;
  versionId?: string;
}

export interface NodeAnnotationCandidate {
  id: string;
  url: string;
  label: string;
  sourceNodeId: string;
  sourcePortId: string;
  sourceImageId?: string;
  sourceVersionId?: string;
}

interface CollectNodeAnnotationCandidatesOptions {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  results: Record<string, NodeAnnotationExecutionResult>;
  canvasImages: NodeAnnotationCanvasImage[];
  existingBundle?: EditIntentBundle | null;
}

interface NodeAnnotationExecutionResult {
  output?: Record<string, unknown>;
}

function outputUrls(
  node: WorkflowNode,
  result?: NodeAnnotationExecutionResult,
): string[] {
  const urls: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim() && !urls.includes(value)) {
      urls.push(value);
    }
  };
  const addMany = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(add);
  };

  addMany(result?.output?.imageUrls);
  add(result?.output?.imageUrl);
  addMany(node.config?.imageUrls);
  add(node.config?.imageUrl);
  return urls;
}

function sourceIdentity(
  node: WorkflowNode,
  url: string,
  canvasImages: NodeAnnotationCanvasImage[],
): Pick<NodeAnnotationCandidate, 'sourceImageId' | 'sourceVersionId'> {
  const configuredImageId = typeof node.config?.sourceImageId === 'string'
    ? node.config.sourceImageId
    : '';
  const configuredVersionId = typeof node.config?.sourceVersionId === 'string'
    ? node.config.sourceVersionId
    : '';
  if (configuredImageId) {
    const configuredImage = canvasImages.find(
      (image) => image.id === configuredImageId && image.url === url,
    );
    if (configuredImage) {
      return {
        sourceImageId: configuredImage.id,
        sourceVersionId: configuredVersionId || configuredImage.versionId,
      };
    }
  }

  const urlMatches = canvasImages.filter((image) => image.url === url);
  if (urlMatches.length !== 1) return {};
  return {
    sourceImageId: urlMatches[0].id,
    sourceVersionId: urlMatches[0].versionId,
  };
}

export function collectNodeAnnotationCandidates({
  node,
  nodes,
  connections,
  results,
  canvasImages,
  existingBundle = null,
}: CollectNodeAnnotationCandidatesOptions): NodeAnnotationCandidate[] {
  const candidates: NodeAnnotationCandidate[] = [];
  const addCandidate = (
    url: string,
    sourceNode: WorkflowNode,
    sourcePortId: string,
    forcedIdentity?: Pick<NodeAnnotationCandidate, 'sourceImageId' | 'sourceVersionId'>,
  ) => {
    const identity = forcedIdentity || sourceIdentity(
      sourceNode,
      url,
      canvasImages,
    );
    const id = [
      sourceNode.id,
      sourcePortId,
      identity.sourceImageId || 'unowned',
      url,
    ].join('::');
    if (candidates.some((candidate) => candidate.id === id)) return;
    candidates.push({
      id,
      url,
      label: '',
      sourceNodeId: sourceNode.id,
      sourcePortId,
      ...identity,
    });
  };

  const directOutputPort = node.ports.find(
    (port) => port.direction === 'out' && port.type === 'image',
  );
  if (existingBundle) {
    const sourceImage = canvasImages.find(
      (image) => image.id === existingBundle.sourceImageId,
    );
    if (sourceImage && directOutputPort) {
      addCandidate(
        sourceImage.url,
        node,
        directOutputPort.id,
        {
          sourceImageId: sourceImage.id,
          sourceVersionId: sourceImage.versionId,
        },
      );
    }
  }

  if (directOutputPort) {
    for (const url of outputUrls(node, results[node.id])) {
      addCandidate(url, node, directOutputPort.id);
    }
  }

  if (!directOutputPort || candidates.length === 0) {
    const incoming = connections.filter(
      (connection) => connection.toNodeId === node.id
        && connection.type === 'image',
    );
    for (const connection of incoming) {
      const sourceNode = nodes.find(
        (candidate) => candidate.id === connection.fromNodeId,
      );
      if (!sourceNode) continue;
      for (const url of outputUrls(sourceNode, results[sourceNode.id])) {
        addCandidate(url, sourceNode, connection.fromPortId);
      }
    }
  }

  return candidates.map((candidate, index) => ({
    ...candidate,
    label: candidates.length > 1 ? `图片 ${index + 1}` : node.label,
  }));
}
