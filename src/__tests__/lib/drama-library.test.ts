import { describe, expect, it } from 'vitest';
import { canvasLibraryItems, dramaLibraryItems, mergeLibrary } from '@/lib/drama/library';
import { parseDramaProject } from '@/lib/drama/schema';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';

function shot(patch: Partial<DramaShot>): DramaShot {
  return {
    id: 's', index: 0, title: '', purpose: '', actionBeat: '', prompt: '', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], ...patch,
  };
}

function doc(): DramaProjectV1 {
  return {
    ...createEmptyDramaProject({ title: '招财猫' }),
    cast: [{ id: 'lin', name: '林辰', appearance: '', imageUrlFront: '/f.png', imageUrlFace: '/c.png' }],
    locations: [{ id: 'shop', name: '便利店', imageUrl: '/shop.png' }],
    references: [{ url: '/chat.png', name: '对话图片 1', source: 'chat' }],
    timeline: { transition: 'cut', transitionSec: 0.5, subtitles: true,
      lastRender: { taskId: 'r', status: 'completed', videoUrl: '/film.mp4', thumbnailUrl: '/film.jpg', createdAt: 1 } },
    episodes: [{ id: 'e', index: 0, title: '', logline: '', script: '', scenes: [{ id: 'sc', heading: '', summary: '', shots: [
      shot({ id: 'a', firstFrameUrl: '/a.png', takes: [{ id: 't', status: 'completed', videoUrl: '/a.mp4', createdAt: 1 }] }),
      shot({ id: 'b', firstFrameUrl: 'data:image/png;base64,AAAA' }),
    ] }] }],
  };
}

describe('drama library', () => {
  it('lists every stored image and video of a drama with names the user recognises', () => {
    expect(dramaLibraryItems(doc()).map(item => [item.name, item.kind, item.source])).toEqual([
      ['招财猫 · 林辰正面', 'image', 'drama'],
      ['招财猫 · 林辰面部', 'image', 'drama'],
      ['招财猫 · 场景 便利店', 'image', 'drama'],
      ['招财猫 · 镜头 01首帧', 'image', 'drama'],
      ['招财猫 · 镜头 01', 'video', 'drama'],
      ['招财猫 · 成片', 'video', 'drama'],
      ['对话图片 1', 'image', 'chat'],
    ]);
  });

  it('reads canvas pictures and videos, skipping placeholders, missing media and browser-only addresses', () => {
    const items = canvasLibraryItems([
      { url: '/u/1.png', prompt: '雨夜街景' },
      { url: '/u/2.png', isProcessingPlaceholder: true },
      { url: '/u/3.png', mediaAvailability: 'missing' },
      { url: 'blob:abc' },
      { url: '/thumb.jpg', mediaType: 'video', videoUrl: '/v/1.mp4', thumbnailUrl: '/thumb.jpg', name: '片头' },
      { url: '/u/1.png', prompt: '重复' },
    ]);
    expect(items).toEqual([
      { url: '/u/1.png', kind: 'image', name: '雨夜街景', source: 'canvas' },
      { url: '/v/1.mp4', kind: 'video', name: '片头', source: 'canvas', thumbnailUrl: '/thumb.jpg' },
    ]);
  });

  it('keeps the first source of an address when lists overlap', () => {
    const merged = mergeLibrary(canvasLibraryItems([{ url: '/f.png', prompt: '画布版' }]), dramaLibraryItems(doc()));
    expect(merged.filter(item => item.url === '/f.png')).toEqual([{ url: '/f.png', kind: 'image', name: '画布版', source: 'canvas' }]);
  });

  it('saves images brought in from chat with the document', () => {
    expect(parseDramaProject(doc()).references).toEqual([{ url: '/chat.png', name: '对话图片 1', source: 'chat' }]);
    expect(() => parseDramaProject({ ...doc(), references: [{ url: '/x.png', source: 'email' }] })).toThrow();
  });
});
