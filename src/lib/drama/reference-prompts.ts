/** Image prompts for cast turnarounds and location plates. Kept separate so the workbench and tests share them. */
import { DIRECTOR_STYLES, type DirectorStyle } from '@/lib/video-director/director-styles';
import type { DramaCastMember, DramaLocation } from './types';

const clean = (parts: Array<string | undefined>) => parts.map(part => part?.trim()).filter(Boolean).join(', ');

export function castImagePrompt(member: DramaCastMember, view: 'front' | 'side', style: DirectorStyle): string {
  const angle = view === 'front'
    ? 'front view, facing camera, bust portrait, centered, frontal eye-level angle'
    : '3/4 side view, bust portrait, side angle';
  return clean([
    'character design reference sheet',
    member.name, member.age, member.gender,
    member.frontPrompt && view === 'front' ? member.frontPrompt : member.appearance,
    member.costume ? `wearing ${member.costume}` : undefined,
    member.hair,
    angle,
    'plain light grey background, even studio lighting, high detail, no text, no watermark, sharp focus',
    `视觉风格：${DIRECTOR_STYLES[style].planDescription}`,
  ]);
}

export function locationImagePrompt(location: DramaLocation, style: DirectorStyle): string {
  return clean([
    'establishing shot of an empty film set, no people',
    location.name, location.scenePrompt || location.description, location.location,
    location.timeOfDay, location.weather, location.lighting, location.mood,
    'cinematic composition, high detail, no text, no watermark',
    `视觉风格：${DIRECTOR_STYLES[style].planDescription}`,
  ]);
}

/** Location plates follow the project ratio so they can serve as a first frame. */
export function locationImageSize(aspectRatio: string): string {
  if (aspectRatio === '9:16' || aspectRatio === '3:4') return '1024x1536';
  if (aspectRatio === '16:9' || aspectRatio === '4:3' || aspectRatio === '21:9') return '1536x1024';
  return '1024x1024';
}

export const CAST_IMAGE_SIZE = '1024x1536';
