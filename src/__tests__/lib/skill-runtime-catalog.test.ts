import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CANVAS_PRESET_SKILLS,
  SIMPLE_CHAT_PRESET_SKILLS,
  listSkillsForSurface,
  requireSkillForSurface,
  SkillNotFoundError,
  SkillSurfaceForbiddenError,
} from '@/lib/skill-runtime/catalog';
import { CANVAS_PRESET_CHAT_SKILLS } from '@/lib/skill-runtime/canvas-presets';
import presetBaseline from '@/__tests__/fixtures/skill-runtime-presets.baseline.json';

const canvasIds = [
  'preset-ecommerce-listing', 'preset-logo-brand', 'preset-storyboard',
  'preset-marketing-brochure', 'preset-social-media', 'preset-ip-character',
  'preset-product-packaging', 'preset-concept-art', 'preset-interior-design',
  'preset-poster-design', 'preset-ppt-design', 'preset-magazine-cover',
  'preset-apparel-fashion', 'preset-business-card', 'preset-book-cover',
  'preset-sticker-emoji', 'preset-comic-manga', 'preset-mockup-showcase',
  'preset-illustration', 'preset-ui-design', 'preset-food-photography',
];

const simpleChatIds = [
  'ppt-master', 'poster-design', 'excel-master', 'word-master',
  'pdf-master', 'meeting-notes', 'project-plan', 'email-master',
  'creative-writing', 'code-reviewer', 'mindmap-master', 'flowchart-master',
  'report-master', 'ppt-page-design', 'infographic-design', 'brand-visual-design',
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
    expect(SIMPLE_CHAT_PRESET_SKILLS.map(skill => skill.id)).toEqual(simpleChatIds);
    expect(listSkillsForSurface('simple-chat').map(skill => skill.id)).toEqual(simpleChatIds);
    expect(listSkillsForSurface('simple-chat').some(skill => canvasIds.includes(skill.id))).toBe(false);
  });

  it('机械保留迁移前的画布预设文案、参数槽和对话步骤', () => {
    expect(presetBaseline.sourceCommit).toBe('2faeec0b');
    expect(CANVAS_PRESET_CHAT_SKILLS.map(skill => ({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      description: skill.description,
      systemPrompt: skill.systemPrompt,
      paramSlots: skill.paramSlots.map(slot => ({
        name: slot.name,
        label: slot.label,
        ...(slot.defaultValue === undefined ? {} : { defaultValue: slot.defaultValue }),
        ...(slot.placeholder === undefined ? {} : { placeholder: slot.placeholder }),
      })),
      steps: skill.steps.map(step => ({ role: step.role, content: step.content })),
    }))).toEqual(presetBaseline.canvas);
  });

  it('机械保留迁移前的独立对话预设文案、图标和标签', () => {
    expect(SIMPLE_CHAT_PRESET_SKILLS.map(skill => ({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      description: skill.description,
      systemPrompt: skill.systemPrompt,
      icon: skill.icon,
      tags: skill.tags,
    }))).toEqual(presetBaseline.simpleChat);
  });

  it('返回稳定且完整的 403 禁止访问错误合同', () => {
    let error: unknown;
    try {
      requireSkillForSurface('preset-ecommerce-listing', 'simple-chat');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SkillSurfaceForbiddenError);
    expect((error as Error).constructor).toBe(SkillSurfaceForbiddenError);
    expect(error).toMatchObject({
      code: 'SKILL_SURFACE_FORBIDDEN',
      status: 403,
      message: '此 Skill 不适用于当前工作区',
    });
  });

  it('返回稳定且完整的 404 未找到错误合同', () => {
    let error: unknown;
    try {
      requireSkillForSurface('missing-skill', 'canvas');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SkillNotFoundError);
    expect((error as Error).constructor).toBe(SkillNotFoundError);
    expect(error).toMatchObject({
      code: 'SKILL_NOT_FOUND',
      status: 404,
      message: 'Skill not found: missing-skill',
    });
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
