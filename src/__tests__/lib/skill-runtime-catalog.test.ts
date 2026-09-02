import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CANVAS_PRESET_SKILLS,
  SIMPLE_CHAT_PRESET_SKILLS,
  listSkillsForSurface,
  requireSkillForSurface,
  SkillSurfaceForbiddenError,
} from '@/lib/skill-runtime/catalog';

const canvasIds = [
  'preset-ecommerce-listing', 'preset-logo-brand', 'preset-storyboard',
  'preset-marketing-brochure', 'preset-social-media', 'preset-ip-character',
  'preset-product-packaging', 'preset-concept-art', 'preset-interior-design',
  'preset-poster-design', 'preset-ppt-design', 'preset-magazine-cover',
  'preset-apparel-fashion', 'preset-business-card', 'preset-book-cover',
  'preset-sticker-emoji', 'preset-comic-manga', 'preset-mockup-showcase',
  'preset-illustration', 'preset-ui-design', 'preset-food-photography',
];

const chatPanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/chat-panel.tsx'),
  'utf8',
);

describe('skill runtime catalog', () => {
  it('保留 21 个画布 Skill 并只授权 canvas/workflow', () => {
    expect(CANVAS_PRESET_SKILLS.map(skill => skill.id)).toEqual(canvasIds);
    expect(listSkillsForSurface('canvas').map(skill => skill.id)).toEqual(canvasIds);
    expect(listSkillsForSurface('workflow').map(skill => skill.id)).toEqual(canvasIds);
    expect(CANVAS_PRESET_SKILLS.every(skill =>
      skill.allowedSurfaces.join(',') === 'canvas,workflow')).toBe(true);
  });

  it('保留 16 个独立对话 Skill 且不泄漏画布目录', () => {
    expect(SIMPLE_CHAT_PRESET_SKILLS).toHaveLength(16);
    expect(listSkillsForSurface('simple-chat')).toHaveLength(16);
    expect(listSkillsForSurface('simple-chat').some(skill => canvasIds.includes(skill.id))).toBe(false);
    expect(() => requireSkillForSurface('preset-ecommerce-listing', 'simple-chat'))
      .toThrow(SkillSurfaceForbiddenError);
  });

  it('画布聊天面板复用唯一的 21 项兼容目录', () => {
    expect(chatPanelSource).toContain(
      "import { CANVAS_PRESET_CHAT_SKILLS } from '@/lib/skill-runtime/canvas-presets';",
    );
    expect(chatPanelSource).toContain(
      'const LOVART_PRESET_SKILLS: ChatSkill[] = useMemo(() => CANVAS_PRESET_CHAT_SKILLS, []);',
    );
    expect(chatPanelSource).not.toContain(
      'const LOVART_PRESET_SKILLS: ChatSkill[] = useMemo(() => [',
    );
  });
});
