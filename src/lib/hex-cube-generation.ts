import type { CubeFace, HexCubeFaceData, ZoomLevel } from '@/lib/canvas-generation-group';

const REFERENCE_ORDER: CubeFace[] = ['front', 'right', 'back', 'left', 'top', 'bottom'];

const FACE_DESCRIPTIONS: Record<CubeFace, string> = {
  front: 'product front view',
  right: 'product right view',
  back: 'product back view',
  left: 'product left view',
  top: 'product top view',
  bottom: 'product bottom view',
};

const FACE_LABELS: Record<CubeFace, string> = {
  front: '前', right: '右', back: '后', left: '左', top: '上', bottom: '下',
};

const ZOOM_PROMPTS: Record<ZoomLevel, string> = {
  'close-up': 'close-up product framing',
  standard: 'standard product framing',
  wide: 'wide product framing',
};

export interface HexCubeGenerationOptions {
  faces: readonly HexCubeFaceData[];
  rotationY: number;
  tiltX: number;
  zoom: ZoomLevel;
  userPrompt: string;
}

export interface HexCubeGenerationInput {
  prompt: string;
  referenceImages: string[];
  referenceDescriptions: string[];
  referenceMode: 'reference';
}

export function buildHexCubeGenerationInput(options: HexCubeGenerationOptions): HexCubeGenerationInput {
  const faceByType = new Map(options.faces.map(face => [face.face, face]));
  const missingFaces = REFERENCE_ORDER.filter(face => !faceByType.get(face)?.imageUrl?.trim());

  if (missingFaces.length > 0) {
    throw new Error(`请先上传完整的六个产品面：${missingFaces.map(face => FACE_LABELS[face]).join('、')}`);
  }

  const referenceImages = REFERENCE_ORDER.map(face => faceByType.get(face)!.imageUrl!.trim());
  const referenceDescriptions = REFERENCE_ORDER.map(face => FACE_DESCRIPTIONS[face]);
  const yaw = ((options.rotationY % 360) + 360) % 360;
  const pitch = Math.max(-60, Math.min(60, options.tiltX));

  return {
    prompt: [
      '[PRODUCT SIX-VIEW CONTROL]',
      'Use all six ordered reference images as the same physical product. Preserve product identity, shape, proportions, materials, colors, markings, and structural details.',
      'Reference order: 1 front, 2 right, 3 back, 4 left, 5 top, 6 bottom.',
      `Requested virtual camera: yaw ${yaw} degrees around the product from the front view; pitch ${pitch} degrees. ${ZOOM_PROMPTS[options.zoom]}.`,
      `Creative direction: ${options.userPrompt.trim()}`,
    ].join('\n'),
    referenceImages,
    referenceDescriptions,
    referenceMode: 'reference',
  };
}
